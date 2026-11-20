// Folders: one more way to organise notebooks. A folder is a real directory (marked by `.folder`) inside a place;
// notebooks sit at the place root or inside a folder. See lib/paths.mjs for the layout and the max-depth setting.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import {
  PLACES, MAX_FOLDER_DEPTH, FOLDER_MARKER, placeRoot, isGitClone, normalizeFolder, scanPlace, locate,
} from './paths.mjs';

export { MAX_FOLDER_DEPTH };

const availablePlaces = () => PLACES.filter((p) => p === 'local' || isGitClone(p));

/**
 * Folders are one logical thing across places: "databases" is a single folder that holds Local, Saved and Shared
 * notebooks alike. On disk it is a directory in each place that has notebooks in it (made on demand), so this merges
 * them by path: { path, name, parent, depth, notebooks, places: [places with the directory], empty }.
 */
export function listFolders() {
  const byPath = new Map();
  for (const place of availablePlaces()) {
    const { folders, notebooks } = scanPlace(place);
    for (const f of folders) {
      const e = byPath.get(f.path) || { path: f.path, name: f.name, parent: f.parent, depth: f.depth, notebooks: 0, places: [] };
      e.places.push(place);
      e.notebooks += notebooks.filter((n) => n.folder === f.path).length;
      byPath.set(f.path, e);
    }
  }
  const all = [...byPath.values()].sort((x, y) => x.path.localeCompare(y.path));
  return all.map((f) => ({ ...f, empty: !f.notebooks && !all.some((g) => g.parent === f.path) }));
}

const folderExists = (folder) => !folder || listFolders().some((f) => f.path === folder);

/** Create the folder directories (with markers) for `folder` in `place`. Parents are created too, within the depth limit. */
export async function ensureFolder(place, folder) {
  const clean = normalizeFolder(folder);
  let cur = placeRoot(place);
  for (const part of clean.split('/').filter(Boolean)) {
    cur = path.join(cur, part);
    await fs.mkdir(cur, { recursive: true });
    const marker = path.join(cur, FOLDER_MARKER);
    if (!fss.existsSync(marker)) await fs.writeFile(marker, '');
  }
  return clean;
}

/**
 * Create an empty folder. It is recorded locally (always available); a Saved or Shared copy of the directory appears
 * when a notebook of that place is moved into the folder. `parent` must already exist; the name cannot match a notebook.
 */
export async function createFolder(name, { parent = '' } = {}) {
  const leaf = String(name ?? '').trim();
  if (!leaf) throw new Error('Folder name is required');
  const cleanParent = normalizeFolder(parent);
  const rel = normalizeFolder([cleanParent, leaf].filter(Boolean).join('/'));
  if (cleanParent && !folderExists(cleanParent)) throw new Error(`The folder "${cleanParent}" does not exist`);
  if (locate(leaf) || availablePlaces().some((p) => scanPlace(p).notebooks.some((n) => n.name === leaf))) {
    throw new Error(`A notebook called "${leaf}" already exists; folders and notebooks cannot share a name.`);
  }
  if (folderExists(rel)) throw new Error(`The folder "${rel}" already exists`);
  await ensureFolder('local', rel);
  return { path: rel, name: leaf, parent: cleanParent };
}

/** Delete a folder (in every place that has it), only when it holds no notebooks and no sub-folders. */
export async function deleteFolder(folder) {
  const rel = normalizeFolder(folder);
  if (!rel) throw new Error('Folder is required');
  const info = listFolders().find((f) => f.path === rel);
  if (!info) throw new Error(`No folder "${rel}"`);
  if (!info.empty) throw new Error(`The folder "${rel}" is not empty. Move its notebooks out first.`);
  for (const place of info.places) {
    const dir = path.join(placeRoot(place), rel);
    const left = (await fs.readdir(dir)).filter((f) => f !== FOLDER_MARKER);
    if (left.length) throw new Error(`The folder "${rel}" in ${place} has files that are not notebooks; remove them by hand first.`);
  }
  for (const place of info.places) await fs.rm(path.join(placeRoot(place), rel), { recursive: true });
  return { path: rel, places: info.places };
}

/**
 * Rename a folder everywhere: its directory is renamed in every place that has it, sub-folders and notebooks move along
 * (notebooks keep their names, so URLs and the CLI are unaffected). `isBusy(name)` refuses the rename while an agent is
 * working in any notebook inside. Resolves { path, name, from, notebooks } where `notebooks` are the names that moved.
 */
export async function renameFolder(folder, newName, { isBusy } = {}) {
  const from = normalizeFolder(folder);
  if (!from) throw new Error('Folder is required');
  const leaf = String(newName ?? '').trim();
  if (!leaf) throw new Error('Folder name is required');
  const info = listFolders().find((f) => f.path === from);
  if (!info) throw new Error(`No folder "${from}"`);
  const to = normalizeFolder([info.parent, leaf].filter(Boolean).join('/'));
  if (to === from) return { path: from, name: info.name, from, notebooks: [], changed: false };
  if (locate(leaf) || availablePlaces().some((p) => scanPlace(p).notebooks.some((n) => n.name === leaf))) {
    throw new Error(`A notebook called "${leaf}" already exists; folders and notebooks cannot share a name.`);
  }
  if (folderExists(to)) throw new Error(`The folder "${to}" already exists`);
  const inside = new Set();
  for (const place of info.places) {
    for (const n of scanPlace(place).notebooks) if (n.folder === from || n.folder.startsWith(`${from}/`)) inside.add(n.name);
  }
  const busy = [...inside].find((n) => isBusy?.(n));
  if (busy) throw new Error(`An agent request is running on "${busy}". Wait for it to finish (or cancel it) before renaming the folder.`);
  for (const place of info.places) {
    if (fss.existsSync(path.join(placeRoot(place), to))) throw new Error(`The ${place} place already has something called "${to}". Nothing was renamed.`);
  }
  const done = [];
  try {
    for (const place of info.places) {
      await fs.rename(path.join(placeRoot(place), from), path.join(placeRoot(place), to));
      done.push(place);
    }
  } catch (err) {
    for (const place of done) await fs.rename(path.join(placeRoot(place), to), path.join(placeRoot(place), from)).catch(() => {});
    throw new Error(`Could not rename the folder in ${info.places[done.length]}: ${err.message}. Nothing was renamed.`);
  }
  return { path: to, name: leaf, from, notebooks: [...inside].sort(), changed: true };
}

/**
 * Move a notebook into a folder ('' = back to the place root); it stays in its place. The folder must exist (in any place).
 * `isBusy(name)` lets the server refuse while an agent request is working in the notebook.
 */
export async function moveToFolder(name, folder, { isBusy } = {}) {
  const from = locate(name);
  if (!from) throw new Error(`No notebook folder "${name}"`);
  const target = normalizeFolder(folder);
  if (from.folder === target) return { name, place: from.place, folder: target, changed: false };
  if (isBusy?.(name)) throw new Error(`An agent request is running on "${name}". Wait for it to finish (or cancel it) before moving the notebook.`);
  const root = placeRoot(from.place);
  if (!folderExists(target)) throw new Error(`The folder "${target}" does not exist. Create it first.`);
  const dest = path.join(root, target, name);
  if (fss.existsSync(dest)) throw new Error(`"${target || from.place}" already has an entry named "${name}". Nothing was moved.`);
  await ensureFolder(from.place, target); // the folder gets a directory in this notebook's place when it has none yet
  await fs.rename(from.dir, dest);
  return { name, place: from.place, folder: target, from: from.folder, changed: true };
}

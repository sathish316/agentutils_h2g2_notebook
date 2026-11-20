// Where notebooks live. A notebook is in one of three places:
//   local  -> notebooks/<name>/          (untracked, today's default)
//   saved  -> .h2g2/saved/<name>/        (app-managed clone of the user's "saved" git repo)
//   shared -> .h2g2/shared/<name>/       (app-managed clone of the user's "shared" git repo)
// H2G2_DIR / H2G2_NOTEBOOKS_DIR override the locations (used by tests).
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const NOTEBOOKS_DIR = process.env.H2G2_NOTEBOOKS_DIR ? path.resolve(process.env.H2G2_NOTEBOOKS_DIR) : path.join(ROOT, 'notebooks');
export const H2G2_DIR = process.env.H2G2_DIR ? path.resolve(process.env.H2G2_DIR) : path.join(ROOT, '.h2g2');
export const FRAMEWORK_DIR = path.join(ROOT, 'framework');
export const SETTINGS_FILE = path.join(H2G2_DIR, 'settings.json');
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const PLACES = ['local', 'saved', 'shared'];
export const REPO_PLACES = ['saved', 'shared'];
export const ARCHIVED_MARKER = '.archived';
export const TAGS_FILE = '.tags.json'; // tags for empty folders (no notebook.json yet)

export const cloneDir = (place) => path.join(H2G2_DIR, place);
export const placeRoot = (place) => (place === 'local' ? NOTEBOOKS_DIR : cloneDir(place));
export const isGitClone = (place) => fss.existsSync(path.join(cloneDir(place), '.git'));

const isDir = (p) => { try { return fss.statSync(p).isDirectory(); } catch { return false; } };

/**
 * Inside a repo clone only notebook-looking folders count (the repo may hold other things, e.g. docs/):
 * a folder with notebook.json, or an empty-folder notebook (nothing but its archive/tag markers).
 */
export function looksLikeNotebook(dir) {
  if (!isDir(dir)) return false;
  if (fss.existsSync(path.join(dir, 'notebook.json'))) return true;
  return fss.readdirSync(dir).every((f) => f === ARCHIVED_MARKER || f === TAGS_FILE);
}

// ---- folders ------------------------------------------------------------------------------------------
// A folder is a real directory inside a place, marked by an empty `.folder` file (so an empty folder is not mistaken
// for an empty notebook, and git has something to track). Notebooks live at the place root or inside folders:
//   notebooks/<name>/        notebooks/<folder>/<name>/        (and the same inside .h2g2/saved and .h2g2/shared)
// Notebook names stay unique across all folders and places, so URLs, the CLI and the API keep addressing by name.
// MAX_FOLDER_DEPTH is the only place that decides how deep folders may nest (1 = folders hold notebooks, not folders).
// Everything below handles any depth; raise the number (or set H2G2_MAX_FOLDER_DEPTH) to allow nesting.
export const FOLDER_MARKER = '.folder';
export const MAX_FOLDER_DEPTH = Math.max(1, Number.parseInt(process.env.H2G2_MAX_FOLDER_DEPTH, 10) || 1);

export const isFolderDir = (dir) => isDir(dir) && fss.existsSync(path.join(dir, FOLDER_MARKER));

/** Normalize a folder path ('a/b', slashes trimmed); '' is the place root. Throws when invalid or deeper than allowed. */
export function normalizeFolder(folder) {
  const parts = String(folder ?? '').split('/').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) if (!NAME_RE.test(part)) throw new Error(`Invalid folder name: "${part}" (letters, digits, . _ - only)`);
  if (parts.length > MAX_FOLDER_DEPTH) {
    throw new Error(MAX_FOLDER_DEPTH === 1 ? 'Folders cannot be nested (maximum depth is 1).' : `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep.`);
  }
  return parts.join('/');
}

/**
 * Everything in a place: { folders: [{ path, name, parent, depth, dir }], notebooks: [{ name, dir, folder }] } where `folder`
 * is the notebook's folder path ('' at the root). Inside a repo clone only notebook-looking folders count.
 */
export function scanPlace(place) {
  const out = { folders: [], notebooks: [] };
  if (place !== 'local' && !isGitClone(place)) return out;
  const root = placeRoot(place);
  const walk = (folder, depth) => {
    const dir = path.join(root, folder);
    let entries = [];
    try { entries = fss.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || !NAME_RE.test(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = folder ? `${folder}/${e.name}` : e.name;
      if (isFolderDir(full)) {
        if (depth + 1 > MAX_FOLDER_DEPTH) continue; // deeper than allowed (the limit was lowered): leave it alone
        out.folders.push({ path: rel, name: e.name, parent: folder, depth: depth + 1, dir: full });
        walk(rel, depth + 1);
      } else if (place === 'local' || looksLikeNotebook(full)) {
        out.notebooks.push({ name: e.name, dir: full, folder });
      }
    }
  };
  walk('', 0);
  return out;
}

/** Where does notebook `name` live right now? { place, dir, folder } or null. Local wins over saved over shared. */
export function locate(name) {
  if (!NAME_RE.test(name)) return null;
  for (const place of PLACES) {
    if (place !== 'local' && !isGitClone(place)) continue;
    const direct = path.join(placeRoot(place), name); // the common case: at the place root
    if (isDir(direct) && !isFolderDir(direct) && (place === 'local' || looksLikeNotebook(direct))) return { place, dir: direct, folder: '' };
    const hit = scanPlace(place).notebooks.find((n) => n.name === name);
    if (hit) return { place, dir: hit.dir, folder: hit.folder };
  }
  return null;
}

/** Any notebook or folder called `name` in any place (even one that is not notebook-looking). Keeps names unique. */
export function folderPlace(name) {
  for (const place of PLACES) {
    if (place !== 'local' && !isGitClone(place)) continue;
    if (isDir(path.join(placeRoot(place), name))) return place;
    const s = scanPlace(place);
    if (s.notebooks.some((n) => n.name === name) || s.folders.some((f) => f.name === name)) return place;
  }
  return null;
}

/**
 * Split a path relative to a place root (as fs.watch or git report it) into the notebook it belongs to:
 * 'db/kafka/chapters/a.md' -> { name: 'kafka', folder: 'db', rest: 'chapters/a.md' } when 'db' is a folder.
 */
export function splitNotebookPath(root, rel) {
  const segs = String(rel).split(/[\\/]/).filter(Boolean);
  let i = 0;
  while (i < MAX_FOLDER_DEPTH && i < segs.length - 1 && isFolderDir(path.join(root, ...segs.slice(0, i + 1)))) i++;
  if (i >= segs.length) return null;
  return { name: segs[i], folder: segs.slice(0, i).join('/'), rest: segs.slice(i + 1).join('/') };
}

export function notebookDir(name) {
  if (!NAME_RE.test(name)) throw new Error(`Invalid notebook name: ${name}`);
  return locate(name)?.dir ?? path.join(NOTEBOOKS_DIR, name);
}

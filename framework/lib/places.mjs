// Notebook places: configure the saved/shared repo clones, move notebooks between places, sync to the repo.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { git, ok } from './git.mjs';
import {
  H2G2_DIR, SETTINGS_FILE, NAME_RE, PLACES, REPO_PLACES, cloneDir, placeRoot, isGitClone, locate, scanPlace, splitNotebookPath, FOLDER_MARKER,
} from './paths.mjs';
import { ensureFolder } from './folders.mjs';

export { PLACES, REPO_PLACES };
export const DEFAULT_MESSAGES = { saved: 'Saved notes updates', shared: 'Shared notes updates' };

// ---- configured repos ------------------------------------------------------------------------------
/** Configured repo URLs from the per-machine settings file: { saved, shared } ('' when not set). */
export async function repoUrls() {
  const raw = await fs.readFile(SETTINGS_FILE, 'utf8').catch(() => '{}');
  let repos = {};
  try { repos = JSON.parse(raw).repos || {}; } catch { /* unreadable settings: treat as unset */ }
  return { saved: String(repos.saved || ''), shared: String(repos.shared || '') };
}

/** Per place: is a repo configured, and is its clone usable? */
export async function repoStatus() {
  const urls = await repoUrls();
  return Object.fromEntries(REPO_PLACES.map((p) => [p, { url: urls[p], configured: !!urls[p], cloned: isGitClone(p), ready: !!urls[p] && isGitClone(p) }]));
}

/** Visible notices for configured repos whose clone is missing (deleted by hand). */
export async function placeNotices() {
  const st = await repoStatus();
  return REPO_PLACES.filter((p) => st[p].configured && !st[p].cloned).map((p) => ({
    place: p,
    message: `The ${p} repo's local clone is missing or not a git repo, so its notebooks are hidden. Save the ${p} repo URL in Settings again to re-clone it.`,
  }));
}

function notebooksIn(place) {
  return scanPlace(place).notebooks.map((n) => (n.folder ? `${n.folder}/${n.name}` : n.name));
}

/**
 * Make the clone for `place` match `url` ('' clears it). Refuses while notebooks still live in the clone being replaced;
 * a failed clone leaves the previous clone untouched and throws git's error.
 */
export async function applyRepo(place, url, current = '') {
  if (!REPO_PLACES.includes(place)) throw new Error(`Unknown repo: ${place}`);
  url = String(url ?? '').trim();
  const dest = cloneDir(place);
  if (url === current && isGitClone(place)) return;
  if (url !== current || !url) {
    const living = notebooksIn(place);
    if (living.length) {
      throw new Error(`Move these notebooks out of the ${place} repo before changing or clearing it: ${living.join(', ')}`);
    }
  }
  if (!url) { await fs.rm(dest, { recursive: true, force: true }); return; }
  await fs.mkdir(H2G2_DIR, { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  await fs.rm(tmp, { recursive: true, force: true });
  try {
    await git(H2G2_DIR, ['clone', '--', url, tmp]);
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw new Error(`Could not clone ${url}: ${err.message}`);
  }
  if (fss.existsSync(dest)) {
    // A leftover non-git folder may still hold someone's notes: set it aside rather than delete it.
    if (isGitClone(place)) await fs.rm(dest, { recursive: true, force: true });
    else await fs.rename(dest, `${dest}.orphaned-${Date.now()}`);
  }
  await fs.rename(tmp, dest);
}

// ---- moving ------------------------------------------------------------------------------------------
async function moveDir(from, to) {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}

/**
 * Move a notebook's folder to another place. `isBusy(name)` lets the server refuse while an agent request is running.
 * Moving out of a repo clone leaves the removal uncommitted there; the folder is the only copy.
 */
export async function movePlace(name, target, { isBusy } = {}) {
  if (!PLACES.includes(target)) throw new Error(`place must be one of: ${PLACES.join(', ')}`);
  const from = locate(name);
  if (!from) throw new Error(`No notebook folder "${name}"`);
  if (from.place === target) return { name, place: target, changed: false };
  if (isBusy?.(name)) throw new Error(`An agent request is running on "${name}". Wait for it to finish (or cancel it) before moving the notebook.`);
  if (target !== 'local' && !isGitClone(target)) {
    const url = (await repoUrls())[target];
    throw new Error(url ? `The ${target} repo's local clone is missing. Save its URL in Settings again to re-clone it.` : `The ${target} repo is not configured. Set its URL in Settings first.`);
  }
  // The notebook keeps its folder: the same folder is created in the target place when it isn't there yet.
  const dest = path.join(placeRoot(target), from.folder, name);
  if (fss.existsSync(dest)) throw new Error(`The ${target} place already has a folder named "${name}". Nothing was moved.`);
  if (from.folder) await ensureFolder(target, from.folder);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await moveDir(from.dir, dest);
  return { name, place: target, from: from.place, changed: true };
}

// ---- sync ---------------------------------------------------------------------------------------------
const locks = new Map();
function withLock(key, fn) {
  const run = (locks.get(key) || Promise.resolve()).then(fn, fn);
  locks.set(key, run.catch(() => {}));
  return run;
}

/** Notebook names touched by a list of repo-relative paths (a path may sit inside a folder: 'db/kafka/chapters/a.md'). */
const parseNames = (text, cwd) => new Set(text.split('\n')
  .map((l) => l.trim().replace(/^"|"$/g, ''))
  .filter(Boolean)
  .map((l) => splitNotebookPath(cwd, l)?.name)
  .filter((n) => n && NAME_RE.test(n)));

async function hasUpstream(cwd) { return ok(git(cwd, ['rev-parse', '--verify', '-q', '@{u}'])); }

/** Names of notebooks in a repo clone with uncommitted changes or commits not pushed yet. */
export async function pendingNames(place) {
  const out = new Set();
  if (!isGitClone(place)) return out;
  const cwd = cloneDir(place);
  try {
    const status = await git(cwd, ['--no-optional-locks', 'status', '--porcelain', '-uall']);
    for (const line of status.split('\n')) {
      for (const part of line.slice(3).split(' -> ')) for (const n of parseNames(part, cwd)) out.add(n);
    }
    const range = (await hasUpstream(cwd)) ? ['@{u}..HEAD'] : ['HEAD'];
    for (const n of parseNames(await git(cwd, ['log', '--name-only', '--pretty=format:', ...range]).catch(() => ''), cwd)) out.add(n);
  } catch { /* an unreadable repo shows no pending state */ }
  return out;
}

async function unpushedFor(cwd, name) {
  const range = (await hasUpstream(cwd)) ? ['@{u}..HEAD'] : ['HEAD'];
  return (await git(cwd, ['log', '--oneline', ...range, '--', name]).catch(() => '')).trim().length > 0;
}

/**
 * Commit this notebook's uncommitted changes (one commit) and push. `messageFor({ diff, place, name })` may return a
 * commit message (an agent writes it); null, empty or a failure falls back to the place's default message.
 * Resolves { status: 'pushed' | 'nothing', committed, message }; rejects with git's message on any failure.
 */
export function syncNotebook(name, { messageFor } = {}) {
  const loc = locate(name);
  if (!loc) return Promise.reject(new Error(`No notebook folder "${name}"`));
  if (loc.place === 'local') return Promise.reject(new Error(`"${name}" is a local notebook; move it to Saved or Shared to sync it.`));
  const rel = loc.folder ? `${loc.folder}/${name}` : name; // path inside the clone
  return withLock(loc.place, () => doSync(name, rel, loc.folder, loc.place, messageFor));
}

/**
 * Paths to commit for a notebook: its folder in the clone, each enclosing folder's marker (so a new folder reaches the
 * remote with its first notebook), and any other place in the clone where uncommitted changes of the same notebook
 * show up (e.g. the old location after it moved between folders).
 */
async function specsFor(cwd, name, rel, folder) {
  const parts = folder.split('/').filter(Boolean);
  const specs = new Set([rel, ...parts.map((_, i) => `${parts.slice(0, i + 1).join('/')}/${FOLDER_MARKER}`)]);
  const status = await git(cwd, ['--no-optional-locks', 'status', '--porcelain', '-uall']).catch(() => '');
  for (const line of status.split('\n')) {
    for (const part of line.slice(3).split(' -> ')) {
      const hit = splitNotebookPath(cwd, part.trim().replace(/^"|"$/g, ''));
      if (hit?.name === name) specs.add(hit.folder ? `${hit.folder}/${name}` : name);
    }
    // A folder deleted in the app leaves its marker deleted in the clone; the next sync records that.
    const p = line.slice(3).trim().replace(/^"|"$/g, '');
    if (/D/.test(line.slice(0, 2)) && (p === FOLDER_MARKER || p.endsWith(`/${FOLDER_MARKER}`))) specs.add(p);
  }
  return [...specs];
}

async function doSync(name, rel, folder, place, messageFor) {
  const cwd = cloneDir(place);
  const specs = await specsFor(cwd, name, rel, folder);
  const hasHead = await ok(git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']));
  const before = hasHead ? (await git(cwd, ['rev-parse', 'HEAD'])).trim() : null;

  await git(cwd, ['add', '-A', '--', ...specs]);
  const staged = (await git(cwd, ['diff', '--cached', '--name-only', '--', ...specs])).trim();
  let message = null;
  if (staged) {
    let proposed = null;
    if (messageFor) {
      try {
        const diff = await git(cwd, ['diff', '--cached', '--', ...specs]);
        proposed = await messageFor({ diff, place, name });
      } catch { proposed = null; }
    }
    message = String(proposed || '').trim() || DEFAULT_MESSAGES[place];
    await git(cwd, ['commit', '-m', message, '--', ...specs]);
  } else if (!(await unpushedFor(cwd, rel))) {
    return { status: 'nothing', committed: false, message: null };
  }

  const undoCommit = async () => {
    if (!staged) return;
    if (before) await git(cwd, ['reset', '--mixed', before]);
    else { await git(cwd, ['update-ref', '-d', 'HEAD']); await git(cwd, ['reset', '-q']).catch(() => {}); }
  };

  const branch = (await git(cwd, ['symbolic-ref', '--short', 'HEAD'])).trim();
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await git(cwd, ['fetch', 'origin']);
    } catch (err) {
      throw new Error(`${staged ? 'Committed locally, but ' : ''}could not reach the remote: ${err.message}. Sync again to push.`);
    }
    if (await ok(git(cwd, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`]))) {
      try {
        await git(cwd, ['rebase', '--autostash', `origin/${branch}`]);
      } catch (err) {
        await git(cwd, ['rebase', '--abort']).catch(() => {});
        await undoCommit();
        throw new Error(`Sync stopped: your changes conflict with newer commits on the remote. Nothing was pushed. ${err.message}`);
      }
    }
    try {
      await git(cwd, ['push', '-u', 'origin', 'HEAD']);
      return { status: 'pushed', committed: !!staged, message };
    } catch (err) {
      const rejected = /rejected|non-fast-forward|fetch first/i.test(err.message);
      if (rejected && attempt === 1) continue; // the remote moved while we pushed: rebase and retry once
      throw new Error(`${staged ? 'Committed locally, but the push failed: ' : 'Push failed: '}${err.message}. Sync again to push.`);
    }
  }
  throw new Error('Push failed'); // unreachable
}

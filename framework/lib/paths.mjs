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

/** Where does notebook `name` live right now? { place, dir } or null. Local wins over saved over shared. */
export function locate(name) {
  if (!NAME_RE.test(name)) return null;
  for (const place of PLACES) {
    if (place !== 'local' && !isGitClone(place)) continue;
    const dir = path.join(placeRoot(place), name);
    if (place === 'local' ? isDir(dir) : looksLikeNotebook(dir)) return { place, dir };
  }
  return null;
}

/** Any folder called `name` in any place (even one that is not notebook-looking). Keeps names unique. */
export function folderPlace(name) {
  for (const place of PLACES) {
    if (place !== 'local' && !isGitClone(place)) continue;
    if (isDir(path.join(placeRoot(place), name))) return place;
  }
  return null;
}

export function notebookDir(name) {
  if (!NAME_RE.test(name)) throw new Error(`Invalid notebook name: ${name}`);
  return locate(name)?.dir ?? path.join(NOTEBOOKS_DIR, name);
}

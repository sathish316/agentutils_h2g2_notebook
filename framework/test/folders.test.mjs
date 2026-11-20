// Folders: real directories (marked by .folder) inside each place. Hermetic: temp dirs, local bare repos as remotes.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'h2g2-folders-'));
const gitconfig = path.join(tmp, 'gitconfig');
await fs.writeFile(gitconfig, '[init]\n\tdefaultBranch = main\n[user]\n\tname = Test\n\temail = test@example.com\n');
Object.assign(process.env, {
  H2G2_DIR: path.join(tmp, 'h2g2'), H2G2_NOTEBOOKS_DIR: path.join(tmp, 'notebooks'),
  GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1',
});
const { createNotebook, listNotebooks, notebookDir, loadNotebookForViewer, setArchived } = await import('../lib/notebook.mjs');
const { applyRepo, movePlace, syncNotebook, pendingNames } = await import('../lib/places.mjs');
const { createFolder, deleteFolder, renameFolder, moveToFolder, listFolders, MAX_FOLDER_DEPTH } = await import('../lib/folders.mjs');
const { H2G2_DIR, NOTEBOOKS_DIR, cloneDir, locate, splitNotebookPath, normalizeFolder } = await import('../lib/paths.mjs');

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const exists = (p) => fs.access(p).then(() => true, () => false);
let counter = 0;

async function configure(place) {
  const remote = path.join(tmp, `remote-${place}-${++counter}.git`);
  sh(tmp, 'init', '--bare', '-q', remote);
  await applyRepo(place, remote, '');
  const file = path.join(H2G2_DIR, 'settings.json');
  const settings = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'));
  settings.repos = { ...settings.repos, [place]: remote };
  await fs.writeFile(file, JSON.stringify(settings));
  return remote;
}

beforeEach(async () => {
  await fs.rm(H2G2_DIR, { recursive: true, force: true });
  await fs.rm(NOTEBOOKS_DIR, { recursive: true, force: true });
  await fs.mkdir(H2G2_DIR, { recursive: true });
  await fs.mkdir(NOTEBOOKS_DIR, { recursive: true });
});

test('depth is one level by default, and checked in one place', () => {
  assert.equal(MAX_FOLDER_DEPTH, 1);
  assert.equal(normalizeFolder('/db/'), 'db');
  assert.equal(normalizeFolder(''), '');
  assert.throws(() => normalizeFolder('db/kafka'), /cannot be nested/);
  assert.throws(() => normalizeFolder('bad name'), /Invalid folder name/);
});

test('create a folder, move a notebook in and out, list it once', async () => {
  await createNotebook('alpha', { title: 'Alpha' });
  await createNotebook('rootnb', { title: 'Root' });
  await createFolder('db');
  assert.ok(await exists(path.join(NOTEBOOKS_DIR, 'db', '.folder')));
  assert.deepEqual(await moveToFolder('alpha', 'db'), { name: 'alpha', place: 'local', folder: 'db', from: '', changed: true });
  assert.equal(locate('alpha').folder, 'db');
  assert.equal(notebookDir('alpha'), path.join(NOTEBOOKS_DIR, 'db', 'alpha'));
  const all = await listNotebooks();
  assert.deepEqual(all.map((n) => [n.name, n.folder]), [['alpha', 'db'], ['rootnb', '']]);
  assert.equal((await loadNotebookForViewer('alpha')).meta.title, 'Alpha');
  assert.deepEqual(listFolders().map((f) => [f.path, f.notebooks, f.empty, f.places]), [['db', 1, false, ['local']]]);
  assert.equal((await moveToFolder('alpha', '')).changed, true);
  assert.equal(locate('alpha').folder, '');
  assert.deepEqual(listFolders().map((f) => [f.path, f.empty]), [['db', true]]);
});

test('folder rules: unique names, existing target, no nesting, delete only when empty', async () => {
  await createNotebook('alpha', { title: 'A' });
  await assert.rejects(createFolder('alpha'), /cannot share a name/);
  await createFolder('db');
  await assert.rejects(createFolder('db'), /already exists/);
  await assert.rejects(createFolder('inner', { parent: 'db' }), /cannot be nested/);
  await assert.rejects(moveToFolder('alpha', 'nope'), /does not exist/);
  await assert.rejects(createNotebook('beta', { title: 'B', folder: 'nope' }), /does not exist/);
  await assert.rejects(createNotebook('db', { title: 'x' }), /already used by a folder/);
  await moveToFolder('alpha', 'db');
  await assert.rejects(deleteFolder('db'), /not empty/);
  await moveToFolder('alpha', '');
  await deleteFolder('db');
  assert.equal(listFolders().length, 0);
});

test('a new notebook can be created inside a folder; an empty folder is not mistaken for a notebook', async () => {
  await createFolder('db');
  assert.deepEqual((await listNotebooks()).map((n) => n.name), []);
  await createNotebook('kafka', { title: 'Kafka', folder: 'db' });
  assert.equal(locate('kafka').folder, 'db');
  await setArchived('kafka', true);
  assert.equal((await listNotebooks())[0].archived, true);
});

test('a notebook cannot be moved while an agent works on it', async () => {
  await createNotebook('alpha', { title: 'A' });
  await createFolder('db');
  await assert.rejects(moveToFolder('alpha', 'db', { isBusy: () => true }), /agent request is running/);
  assert.equal(locate('alpha').folder, '');
});

test('one folder spans places: no place to pick, its directory appears where a notebook goes', async () => {
  await configure('saved');
  await createNotebook('alpha', { title: 'A' });
  await createNotebook('beta', { title: 'B' });
  const f = await createFolder('db');
  assert.deepEqual(Object.keys(f), ['path', 'name', 'parent']);
  assert.deepEqual(listFolders().map((x) => [x.path, x.places]), [['db', ['local']]]);
  await movePlace('beta', 'saved');
  await moveToFolder('beta', 'db'); // beta lives in saved: its directory is made there on demand
  assert.deepEqual(locate('beta'), { place: 'saved', dir: path.join(cloneDir('saved'), 'db', 'beta'), folder: 'db' });
  assert.ok(await exists(path.join(cloneDir('saved'), 'db', '.folder')));
  await moveToFolder('alpha', 'db');
  const [db] = listFolders();
  assert.deepEqual([db.path, db.notebooks, db.places], ['db', 2, ['local', 'saved']]); // one folder, notebooks of both places
  assert.deepEqual((await listNotebooks()).map((n) => `${n.name}:${n.place}:${n.folder}`), ['alpha:local:db', 'beta:saved:db']);
});

test('moving between places keeps the folder; deleting a folder clears every place', async () => {
  await configure('saved');
  await createNotebook('alpha', { title: 'A' });
  await createFolder('db');
  await moveToFolder('alpha', 'db');
  await movePlace('alpha', 'saved');
  assert.equal(locate('alpha').folder, 'db');
  await movePlace('alpha', 'local');
  assert.equal(locate('alpha').folder, 'db');
  await assert.rejects(deleteFolder('db'), /not empty/);
  await moveToFolder('alpha', '');
  assert.deepEqual(listFolders().map((x) => x.places), [['local', 'saved']]);
  assert.deepEqual((await deleteFolder('db')).places, ['local', 'saved']);
  assert.equal(listFolders().length, 0);
  assert.ok(!(await exists(path.join(cloneDir('saved'), 'db'))));
});

test('sync from a folder commits the notebook and the folder marker; a clone of the repo sees the folder', async () => {
  const remote = await configure('saved');
  await createNotebook('alpha', { title: 'A' });
  await createFolder('db');
  await moveToFolder('alpha', 'db');
  await movePlace('alpha', 'saved');
  assert.ok((await pendingNames('saved')).has('alpha'));
  assert.equal((await syncNotebook('alpha')).status, 'pushed');
  assert.equal((await pendingNames('saved')).size, 0);
  const files = sh(remote, 'ls-tree', '-r', '--name-only', 'main').split('\n');
  assert.ok(files.includes('db/.folder'));
  assert.ok(files.includes('db/alpha/notebook.json'));

  // moving it to the root of the repo is one more sync: the old location is committed as removed
  await moveToFolder('alpha', '');
  assert.ok((await pendingNames('saved')).has('alpha'));
  assert.equal((await syncNotebook('alpha')).status, 'pushed');
  assert.equal((await pendingNames('saved')).size, 0);
  assert.ok(sh(remote, 'ls-tree', '-r', '--name-only', 'main').split('\n').includes('alpha/notebook.json'));
  assert.ok(!sh(remote, 'ls-tree', '-r', '--name-only', 'main').includes('db/alpha'));

  // deleting the (now empty) folder is also recorded by the next sync
  await deleteFolder('db');
  await createNotebook('gamma', { title: 'G' });
  await movePlace('gamma', 'saved');
  assert.equal((await syncNotebook('gamma')).status, 'pushed');
  assert.ok(!sh(remote, 'ls-tree', '-r', '--name-only', 'main').includes('db/.folder'));
});

test('paths from the file watcher resolve to the notebook inside a folder', async () => {
  await createFolder('db');
  await createNotebook('kafka', { title: 'K', folder: 'db' });
  assert.deepEqual(splitNotebookPath(NOTEBOOKS_DIR, 'db/kafka/chapters/a.md'), { name: 'kafka', folder: 'db', rest: 'chapters/a.md' });
  assert.deepEqual(splitNotebookPath(NOTEBOOKS_DIR, 'kafka/toc.json'), { name: 'kafka', folder: '', rest: 'toc.json' });
});

test('rename a folder everywhere: local and saved directories, notebooks keep their names', async () => {
  const remote = await configure('saved');
  await createNotebook('alpha', { title: 'A' });
  await createNotebook('beta', { title: 'B' });
  await createFolder('db');
  await moveToFolder('alpha', 'db');
  await movePlace('beta', 'saved');
  await moveToFolder('beta', 'db');
  assert.deepEqual(listFolders().map((f) => f.places), [['local', 'saved']]);

  const r = await renameFolder('db', 'databases');
  assert.deepEqual([r.path, r.from, r.notebooks, r.changed], ['databases', 'db', ['alpha', 'beta'], true]);
  assert.deepEqual(listFolders().map((f) => [f.path, f.places, f.notebooks]), [['databases', ['local', 'saved'], 2]]);
  assert.equal(locate('alpha').folder, 'databases');
  assert.equal(locate('beta').folder, 'databases');
  assert.ok(await exists(path.join(NOTEBOOKS_DIR, 'databases', 'alpha', 'notebook.json')));
  assert.ok(!(await exists(path.join(NOTEBOOKS_DIR, 'db'))));
  assert.ok(await exists(path.join(cloneDir('saved'), 'databases', '.folder')));
  assert.deepEqual((await renameFolder('databases', 'databases')).changed, false);

  // the saved copy: one sync records the new folder and removes the old one from the remote
  assert.ok((await pendingNames('saved')).has('beta'));
  assert.equal((await syncNotebook('beta')).status, 'pushed');
  assert.equal((await pendingNames('saved')).size, 0);
  const files = sh(remote, 'ls-tree', '-r', '--name-only', 'main').split('\n');
  assert.ok(files.includes('databases/beta/notebook.json') && files.includes('databases/.folder'));
  assert.ok(!files.some((f) => f.startsWith('db/')));
});

test('rename rules: unique names, no clashes, not while an agent is working', async () => {
  await createNotebook('alpha', { title: 'A' });
  await createFolder('db');
  await createFolder('ops');
  await moveToFolder('alpha', 'db');
  await assert.rejects(renameFolder('db', 'ops'), /already exists/);
  await assert.rejects(renameFolder('db', 'alpha'), /cannot share a name/);
  await assert.rejects(renameFolder('db', 'bad name'), /Invalid folder name/);
  await assert.rejects(renameFolder('nope', 'x'), /No folder/);
  await assert.rejects(renameFolder('db', 'databases', { isBusy: (n) => n === 'alpha' }), /agent request is running on "alpha"/);
  assert.equal(locate('alpha').folder, 'db');
});

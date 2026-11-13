// Saved/shared notebook places. Hermetic: temp dirs for notebooks and .h2g2, local bare repos as remotes, no network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'h2g2-places-'));
const gitconfig = path.join(tmp, 'gitconfig');
await fs.writeFile(gitconfig, '[init]\n\tdefaultBranch = main\n[user]\n\tname = Test\n\temail = test@example.com\n');
Object.assign(process.env, {
  H2G2_DIR: path.join(tmp, 'h2g2'), H2G2_NOTEBOOKS_DIR: path.join(tmp, 'notebooks'),
  GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1',
});
const nbLib = await import('../lib/notebook.mjs');
const places = await import('../lib/places.mjs');
const { createNotebook, listNotebooks, setArchived, setTags, notebookDir } = nbLib;
const { applyRepo, movePlace, syncNotebook, repoStatus, placeNotices, pendingNames } = places;
const { H2G2_DIR, NOTEBOOKS_DIR, cloneDir } = await import('../lib/paths.mjs');

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const exists = (p) => fs.access(p).then(() => true, () => false);
let counter = 0;

/** Create an empty bare remote and configure it as the saved/shared repo (clone + settings.json). */
async function configure(place) {
  const remote = path.join(tmp, `remote-${place}-${++counter}.git`);
  sh(tmp, 'init', '--bare', '-q', remote);
  await applyRepo(place, remote, '');
  const settings = JSON.parse(await fs.readFile(path.join(H2G2_DIR, 'settings.json'), 'utf8').catch(() => '{}'));
  settings.repos = { ...settings.repos, [place]: remote };
  await fs.writeFile(path.join(H2G2_DIR, 'settings.json'), JSON.stringify(settings));
  return remote;
}
const remoteLog = (remote, ...extra) => sh(remote, 'log', '--format=%s', ...extra).split('\n').filter(Boolean);
const remoteCount = (remote) => { try { return Number(sh(remote, 'rev-list', '--count', 'main')); } catch { return 0; } };

beforeEach(async () => {
  await fs.rm(H2G2_DIR, { recursive: true, force: true });
  await fs.rm(NOTEBOOKS_DIR, { recursive: true, force: true });
  await fs.mkdir(H2G2_DIR, { recursive: true });
  await fs.mkdir(NOTEBOOKS_DIR, { recursive: true });
});

test('a new notebook is local by default and lists with its place', async () => {
  await createNotebook('alpha', { title: 'Alpha' });
  const [nb] = await listNotebooks();
  assert.equal(nb.place, 'local');
  assert.ok(await exists(path.join(NOTEBOOKS_DIR, 'alpha', 'notebook.json')));
});

test('repo setup: a bad URL fails with git\'s error and keeps the previous setting', async () => {
  const remote = await configure('saved');
  const before = await fs.readFile(path.join(cloneDir('saved'), '.git', 'HEAD'), 'utf8');
  await assert.rejects(applyRepo('saved', path.join(tmp, 'does-not-exist.git'), remote), /Could not clone/);
  assert.equal(await fs.readFile(path.join(cloneDir('saved'), '.git', 'HEAD'), 'utf8'), before);
  assert.deepEqual((await repoStatus()).saved.ready, true);
  assert.equal((await repoStatus()).shared.configured, false);
});

test('move local -> saved -> shared -> local keeps the notebook openable and listed once', async () => {
  await configure('saved');
  await configure('shared');
  await createNotebook('beta', { title: 'Beta' });
  await setTags('beta', ['x']);
  await setArchived('beta', true);

  assert.deepEqual(await movePlace('beta', 'saved'), { name: 'beta', place: 'saved', from: 'local', changed: true });
  assert.ok(!(await exists(path.join(NOTEBOOKS_DIR, 'beta'))), 'gone from notebooks/');
  assert.ok(await exists(path.join(cloneDir('saved'), 'beta', 'notebook.json')));
  assert.equal(notebookDir('beta'), path.join(cloneDir('saved'), 'beta'));
  let all = await listNotebooks();
  assert.deepEqual(all.map((n) => [n.name, n.place, n.archived, n.tags]), [['beta', 'saved', true, ['x']]]);

  await setTags('beta', ['x', 'y']); // edits keep working in place
  await movePlace('beta', 'shared');
  assert.ok(!(await exists(path.join(cloneDir('saved'), 'beta'))));
  assert.equal((await listNotebooks())[0].place, 'shared');
  assert.deepEqual((await listNotebooks())[0].tags, ['x', 'y']);

  await movePlace('beta', 'local');
  all = await listNotebooks();
  assert.deepEqual(all.map((n) => [n.name, n.place]), [['beta', 'local']]);
  assert.ok(await exists(path.join(NOTEBOOKS_DIR, 'beta', 'notebook.json')));
});

test('moving to a repo that is not configured is refused', async () => {
  await createNotebook('gamma', { title: 'G' });
  await assert.rejects(movePlace('gamma', 'saved'), /not configured/);
  assert.ok(await exists(path.join(NOTEBOOKS_DIR, 'gamma')));
});

test('a name clash in the target place refuses the move and changes nothing', async () => {
  await configure('saved');
  await createNotebook('dup', { title: 'Local dup' });
  await fs.mkdir(path.join(cloneDir('saved'), 'dup'));
  await fs.writeFile(path.join(cloneDir('saved'), 'dup', 'keep.txt'), 'x');
  await assert.rejects(movePlace('dup', 'saved'), /already has a folder named "dup"/);
  assert.ok(await exists(path.join(NOTEBOOKS_DIR, 'dup', 'notebook.json')));
  assert.ok(await exists(path.join(cloneDir('saved'), 'dup', 'keep.txt')));
  assert.equal((await listNotebooks()).filter((n) => n.name === 'dup').length, 1, 'never listed twice');
});

test('creating a notebook whose name is taken by a repo folder is refused', async () => {
  await configure('shared');
  await fs.mkdir(path.join(cloneDir('shared'), 'docs'));
  await fs.writeFile(path.join(cloneDir('shared'), 'docs', 'README.md'), '# docs');
  await assert.rejects(createNotebook('docs', { title: 'Docs' }), /already used by a folder in the shared repo/);
  assert.deepEqual((await listNotebooks()).map((n) => n.name), [], 'non-notebook repo folders are not listed');
});

test('moving is refused while an agent request is running on the notebook', async () => {
  await configure('saved');
  await createNotebook('busy', { title: 'Busy' });
  await assert.rejects(movePlace('busy', 'saved', { isBusy: (n) => n === 'busy' }), /agent request is running/);
  assert.ok(await exists(path.join(NOTEBOOKS_DIR, 'busy', 'notebook.json')));
  await movePlace('busy', 'saved', { isBusy: () => false });
});

test('empty-folder notebooks move and keep their archive and tag markers', async () => {
  await configure('saved');
  const dir = path.join(NOTEBOOKS_DIR, 'hollow');
  await fs.mkdir(dir);
  await setArchived('hollow', true);
  await setTags('hollow', ['idea']);
  await movePlace('hollow', 'saved');
  const [nb] = await listNotebooks();
  assert.deepEqual([nb.name, nb.place, nb.initialized, nb.archived, nb.tags], ['hollow', 'saved', false, true, ['idea']]);
  await createNotebook('hollow', { title: 'Started' }); // starting it keeps it in the saved repo
  assert.equal((await listNotebooks())[0].place, 'saved');
});

test('a missing clone hides its notebooks with a notice, and saving the URL again re-clones', async () => {
  const remote = await configure('saved');
  await createNotebook('lost', { title: 'Lost' });
  await movePlace('lost', 'saved');
  await syncNotebook('lost');
  await fs.rm(cloneDir('saved'), { recursive: true, force: true });
  assert.deepEqual(await listNotebooks(), []);
  const notices = await placeNotices();
  assert.equal(notices.length, 1);
  assert.match(notices[0].message, /saved repo/);
  await applyRepo('saved', remote, remote);
  assert.deepEqual((await listNotebooks()).map((n) => [n.name, n.place]), [['lost', 'saved']]);
  assert.deepEqual(await placeNotices(), []);
});

test('changing or clearing the URL is refused while notebooks live in the old clone', async () => {
  const remote = await configure('saved');
  await createNotebook('stay', { title: 'Stay' });
  await movePlace('stay', 'saved');
  const other = path.join(tmp, 'other.git');
  sh(tmp, 'init', '--bare', '-q', other);
  await assert.rejects(applyRepo('saved', other, remote), /Move these notebooks out.*stay/);
  await assert.rejects(applyRepo('saved', '', remote), /Move these notebooks out.*stay/);
  assert.ok(await exists(path.join(cloneDir('saved'), 'stay', 'notebook.json')));
  await movePlace('stay', 'local');
  await applyRepo('saved', '', remote); // now allowed
  assert.ok(!(await exists(cloneDir('saved'))));
});

test('sync commits and pushes with the default message for each place', async () => {
  const savedRemote = await configure('saved');
  const sharedRemote = await configure('shared');
  await createNotebook('s1', { title: 'S1' });
  await createNotebook('h1', { title: 'H1' });
  await movePlace('s1', 'saved');
  await movePlace('h1', 'shared');
  assert.ok((await pendingNames('saved')).has('s1'));

  assert.deepEqual(await syncNotebook('s1'), { status: 'pushed', committed: true, message: 'Saved notes updates' });
  assert.deepEqual(await syncNotebook('h1'), { status: 'pushed', committed: true, message: 'Shared notes updates' });
  assert.deepEqual(remoteLog(savedRemote), ['Saved notes updates']);
  assert.deepEqual(remoteLog(sharedRemote), ['Shared notes updates']);
  assert.ok(!(await pendingNames('saved')).has('s1'));
});

test('sync with no changes makes no commit and says so', async () => {
  const remote = await configure('saved');
  await createNotebook('quiet', { title: 'Quiet' });
  await movePlace('quiet', 'saved');
  await syncNotebook('quiet');
  const count = remoteCount(remote);
  assert.deepEqual(await syncNotebook('quiet'), { status: 'nothing', committed: false, message: null });
  assert.equal(remoteCount(remote), count);
  await assert.rejects(syncNotebook('nope'), /No notebook folder/);
});

test('sync commits only that notebook, using the agent message when there is one', async () => {
  const remote = await configure('saved');
  for (const n of ['one', 'two']) { await createNotebook(n, { title: n }); await movePlace(n, 'saved'); }
  await syncNotebook('one');
  await syncNotebook('two');
  await setTags('one', ['a']);
  await setTags('two', ['b']);
  let seen;
  const r = await syncNotebook('one', { messageFor: async (ctx) => { seen = ctx; return 'Tag the one notebook'; } });
  assert.equal(r.message, 'Tag the one notebook');
  assert.equal(seen.place, 'saved');
  assert.match(seen.diff, /"a"/);
  assert.deepEqual(sh(remote, 'show', '--name-only', '--format=', 'main').split('\n'), ['one/notebook.json']);
  assert.ok((await pendingNames('saved')).has('two'), 'the other notebook is still uncommitted');
  assert.ok(!(await pendingNames('saved')).has('one'));
});

test('a failing or empty agent message falls back to the default, and the commit still happens', async () => {
  const remote = await configure('shared');
  await createNotebook('fb', { title: 'Fb' });
  await movePlace('fb', 'shared');
  await syncNotebook('fb', { messageFor: async () => { throw new Error('agent timed out'); } });
  await setTags('fb', ['t']);
  await syncNotebook('fb', { messageFor: async () => '   ' });
  assert.deepEqual(remoteLog(remote), ['Shared notes updates', 'Shared notes updates']);
});

test('remote has new commits: sync rebases onto them and pushes', async () => {
  const remote = await configure('saved');
  await createNotebook('rb', { title: 'Rb' });
  await movePlace('rb', 'saved');
  await syncNotebook('rb');
  const other = path.join(tmp, `other-${++counter}`);
  sh(tmp, 'clone', '-q', remote, other);
  await fs.writeFile(path.join(other, 'README.md'), 'hello');
  sh(other, 'add', '.'); sh(other, 'commit', '-qm', 'elsewhere'); sh(other, 'push', '-q');
  await setTags('rb', ['mine']);
  assert.equal((await syncNotebook('rb')).status, 'pushed');
  assert.deepEqual(remoteLog(remote), ['Saved notes updates', 'elsewhere', 'Saved notes updates']);
});

test('rebase conflict: nothing is pushed, the rebase is aborted and the notebook is as it was', async () => {
  const remote = await configure('saved');
  await createNotebook('cf', { title: 'Cf' });
  await movePlace('cf', 'saved');
  await syncNotebook('cf');
  const other = path.join(tmp, `other-${++counter}`);
  sh(tmp, 'clone', '-q', remote, other);
  await fs.writeFile(path.join(other, 'cf', 'notebook.json'), '{"title":"remote edit"}\n');
  sh(other, 'commit', '-qam', 'remote edit'); sh(other, 'push', '-q');
  const mine = path.join(cloneDir('saved'), 'cf', 'notebook.json');
  await fs.writeFile(mine, '{"title":"local edit"}\n');
  const head = sh(cloneDir('saved'), 'rev-parse', 'HEAD');

  await assert.rejects(syncNotebook('cf'), /conflict with newer commits/);
  assert.deepEqual(remoteLog(remote), ['remote edit', 'Saved notes updates'], 'nothing pushed');
  assert.equal(sh(cloneDir('saved'), 'rev-parse', 'HEAD'), head, 'our commit was undone');
  assert.ok(!(await exists(path.join(cloneDir('saved'), '.git', 'rebase-merge'))), 'rebase aborted');
  assert.equal(await fs.readFile(mine, 'utf8'), '{"title":"local edit"}\n', 'edit kept');
  assert.ok((await pendingNames('saved')).has('cf'), 'still shows as having changes');
});

test('push failure keeps the commit locally and the next sync pushes it', async () => {
  const remote = await configure('saved');
  await createNotebook('off', { title: 'Off' });
  await movePlace('off', 'saved');
  await syncNotebook('off');
  const moved = `${remote}.away`;
  await fs.rename(remote, moved); // remote unreachable
  await setTags('off', ['t']);
  await assert.rejects(syncNotebook('off'), /Committed locally, but could not reach the remote/);
  assert.equal(sh(cloneDir('saved'), 'log', '-1', '--format=%s'), 'Saved notes updates');
  assert.ok((await pendingNames('saved')).has('off'), 'unpushed commit still pending');
  await fs.rename(moved, remote);
  assert.deepEqual(await syncNotebook('off'), { status: 'pushed', committed: false, message: null });
  assert.equal(remoteCount(remote), 2);
});

test('local notebooks cannot be synced', async () => {
  await createNotebook('loc', { title: 'Loc' });
  await assert.rejects(syncNotebook('loc'), /local notebook/);
});

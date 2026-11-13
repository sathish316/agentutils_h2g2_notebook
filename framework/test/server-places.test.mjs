// End to end over HTTP: settings -> clone, create, move to saved, sync (agent message and default), sync again.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'h2g2-server-'));
const gitconfig = path.join(tmp, 'gitconfig');
await fs.writeFile(gitconfig, '[init]\n\tdefaultBranch = main\n[user]\n\tname = Test\n\temail = test@example.com\n');
const FAKE = fileURLToPath(new URL('./fixtures/fake-acp-agent.mjs', import.meta.url));
const SERVER = fileURLToPath(new URL('../server/index.mjs', import.meta.url));
const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); }); });
const base = `http://127.0.0.1:${port}`;
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
let server;

async function call(method, url, body) {
  const res = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

before(async () => {
  server = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', H2G2_DIR: path.join(tmp, 'h2g2'), H2G2_NOTEBOOKS_DIR: path.join(tmp, 'notebooks'), GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' },
    stdio: 'ignore',
  });
  await fs.mkdir(path.join(tmp, 'notebooks'), { recursive: true });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${base}/api/places`).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => server?.kill());

test('saved repo: a bad URL is an error and keeps the previous setting, a good one clones', async () => {
  const bad = await call('PUT', '/api/settings', { repos: { saved: path.join(tmp, 'missing.git') } });
  assert.equal(bad.ok, false);
  assert.match(bad.data.error, /Could not clone/);
  assert.equal((await call('GET', '/api/settings')).data.repos.saved, '');

  const remote = path.join(tmp, 'saved.git');
  sh(tmp, 'init', '--bare', '-q', remote);
  const good = await call('PUT', '/api/settings', { repos: { saved: remote } });
  assert.ok(good.ok, JSON.stringify(good.data));
  const places = (await call('GET', '/api/places')).data;
  assert.equal(places.repos.saved.ready, true);
  assert.equal(places.repos.shared.configured, false);
});

test('move to saved, still opens, sync commits with the default message, then says nothing to sync', async () => {
  const remote = path.join(tmp, 'saved.git');
  assert.ok((await call('POST', '/api/notebooks', { name: 'demo', title: 'Demo', scope: 'general' })).ok);
  assert.equal((await call('GET', '/api/notebooks')).data[0].place, 'local');
  assert.equal((await call('PUT', '/api/notebooks/demo/place', { place: 'shared' })).status, 400, 'shared is not configured');

  const moved = await call('PUT', '/api/notebooks/demo/place', { place: 'saved' });
  assert.deepEqual(moved.data, { name: 'demo', place: 'saved', from: 'local', changed: true });
  assert.ok(!(await fs.access(path.join(tmp, 'notebooks', 'demo')).then(() => true, () => false)));
  const list = (await call('GET', '/api/notebooks')).data;
  assert.deepEqual(list.map((n) => [n.name, n.place, n.dirty]), [['demo', 'saved', true]]);
  assert.equal((await call('GET', '/api/notebooks/demo')).data.meta.title, 'Demo');
  assert.equal((await call('GET', '/notebooks/demo/notebook.json')).data.title, 'Demo');

  const first = await call('POST', '/api/notebooks/demo/sync');
  assert.deepEqual(first.data, { status: 'pushed', committed: true, message: 'Saved notes updates' });
  assert.equal(sh(remote, 'log', '--format=%s'), 'Saved notes updates');
  assert.equal((await call('GET', '/api/notebooks')).data[0].dirty, false);

  const again = await call('POST', '/api/notebooks/demo/sync');
  assert.deepEqual(again.data, { status: 'nothing', committed: false, message: null });
  assert.equal(sh(remote, 'rev-list', '--count', 'main'), '1');
});

test('with a commit message agent, sync uses its message', async () => {
  const remote = path.join(tmp, 'saved.git');
  assert.ok((await call('PUT', '/api/settings', { agents: { fake: { name: 'Fake', command: process.execPath, args: [FAKE], env: { FAKE_REPLY: 'Tag the demo notebook' } } } })).ok);
  assert.ok((await call('PUT', '/api/settings', { commitAgent: 'fake' })).ok);
  assert.ok((await call('PUT', '/api/notebooks/demo/tags', { tags: ['x'] })).ok);
  const r = await call('POST', '/api/notebooks/demo/sync');
  assert.equal(r.data.message, 'Tag the demo notebook');
  assert.equal(sh(remote, 'log', '-1', '--format=%s'), 'Tag the demo notebook');
});

test('moving back to local, and the URL can be cleared once the repo is empty of notebooks', async () => {
  assert.ok((await call('PUT', '/api/notebooks/demo/place', { place: 'local' })).ok);
  assert.equal((await call('GET', '/api/notebooks')).data[0].place, 'local');
  assert.ok((await call('PUT', '/api/settings', { repos: { saved: '' } })).ok);
  assert.equal((await call('GET', '/api/places')).data.repos.saved.configured, false);
});

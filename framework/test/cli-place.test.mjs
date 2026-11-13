// CLI: `place` moves a notebook between places and `list` shows the place. Hermetic dirs, local bare remote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'h2g2-cli-'));
const gitconfig = path.join(tmp, 'gitconfig');
await fs.writeFile(gitconfig, '[init]\n\tdefaultBranch = main\n[user]\n\tname = Test\n\temail = test@example.com\n');
const env = { ...process.env, H2G2_DIR: path.join(tmp, 'h2g2'), H2G2_NOTEBOOKS_DIR: path.join(tmp, 'notebooks'), GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' };
const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
const exists = (p) => fs.access(p).then(() => true, () => false);

test('place and list', async () => {
  const remote = path.join(tmp, 'saved.git');
  execFileSync('git', ['init', '--bare', '-q', remote], { env });
  await fs.mkdir(env.H2G2_DIR, { recursive: true });
  await fs.writeFile(path.join(env.H2G2_DIR, 'settings.json'), JSON.stringify({ repos: { saved: remote } }));
  execFileSync('git', ['clone', '-q', remote, path.join(env.H2G2_DIR, 'saved')], { env });

  assert.equal(cli('new', 'cli-nb', '--title', 'Cli').status, 0);
  assert.match(cli('list').stdout, /cli-nb\s+local\s+0 chapters/);
  assert.equal(cli('place', 'cli-nb').stdout.trim(), 'local');

  const moved = cli('place', 'cli-nb', 'saved');
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(moved.stdout, /local -> saved/);
  assert.ok(!(await exists(path.join(env.H2G2_NOTEBOOKS_DIR, 'cli-nb'))));
  assert.ok(await exists(path.join(env.H2G2_DIR, 'saved', 'cli-nb', 'notebook.json')));
  assert.match(cli('list').stdout, /cli-nb\s+saved\s+0 chapters/);
  assert.equal(cli('validate', 'cli-nb').status, 0, 'other commands follow the notebook');

  assert.match(cli('place', 'cli-nb', 'saved').stdout, /already saved/);
  const bad = cli('place', 'cli-nb', 'shared');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /shared repo is not configured/);
  assert.equal(cli('place', 'cli-nb', 'nowhere').status, 1);
  assert.equal(cli('place', 'missing', 'saved').status, 1);
  assert.equal(cli('place', 'cli-nb', 'local').status, 0);
  assert.ok(await exists(path.join(env.H2G2_NOTEBOOKS_DIR, 'cli-nb', 'notebook.json')));
});

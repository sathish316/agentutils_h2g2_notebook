// Commit-message agent: uses a fake ACP agent (test/fixtures/fake-acp-agent.mjs). Hermetic settings dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'h2g2-commitmsg-'));
process.env.H2G2_DIR = path.join(tmp, 'h2g2');
process.env.H2G2_NOTEBOOKS_DIR = path.join(tmp, 'notebooks');
const FAKE = fileURLToPath(new URL('./fixtures/fake-acp-agent.mjs', import.meta.url));
const { saveSettings, loadSettings } = await import('../server/settings.mjs');
const { agentCommitMessage, cleanMessage, promptFor } = await import('../server/commit-message.mjs');

const useFake = (mode, extra = {}) => saveSettings({ agents: { fake: { name: 'Fake', command: process.execPath, args: [FAKE], env: { FAKE_MODE: mode, ...extra } } } });

test('cleanMessage keeps the first line, strips quotes and caps the length', () => {
  assert.equal(cleanMessage('"Add retries chapter"\n\nBody'), 'Add retries chapter');
  assert.equal(cleanMessage('Commit message: `Fix typo`'), 'Fix typo');
  assert.equal(cleanMessage('   \n  '), '');
  assert.equal(cleanMessage('x'.repeat(300)).length, 100);
});

test('no commit agent configured: null (the caller uses the default message)', async () => {
  assert.equal((await loadSettings()).commitAgent, null);
  assert.equal(await agentCommitMessage({ diff: 'd', name: 'n' }), null);
});

test('the commit agent must be a known agent', async () => {
  await assert.rejects(saveSettings({ commitAgent: 'nope' }), /Unknown agent/);
  assert.equal((await loadSettings()).commitAgent, null);
});

test('the agent writes the message from the diff', async () => {
  await useFake('ok', { FAKE_REPLY: 'Add notes on retries' });
  await saveSettings({ commitAgent: 'fake' });
  assert.equal(await agentCommitMessage({ diff: '+hello', name: 'kafka' }), 'Add notes on retries');
  await useFake('multiline');
  assert.equal(await agentCommitMessage({ diff: '+hello', name: 'kafka' }), 'Add chapter on retries');
  assert.match(promptFor({ name: 'kafka', diff: '+hello' }), /notebook "kafka"[\s\S]*\+hello/);
});

test('an agent error or timeout rejects, which sync turns into the default message', async () => {
  await saveSettings({ commitAgent: 'fake' });
  await useFake('fail');
  await assert.rejects(agentCommitMessage({ diff: 'd', name: 'n' }), /boom/);
  await useFake('hang');
  const started = Date.now();
  await assert.rejects(agentCommitMessage({ diff: 'd', name: 'n' }, { timeoutMs: 400 }), /timed out/);
  assert.ok(Date.now() - started < 5000);
});

test('"None" clears the commit agent', async () => {
  await saveSettings({ commitAgent: null });
  assert.equal((await loadSettings()).commitAgent, null);
});

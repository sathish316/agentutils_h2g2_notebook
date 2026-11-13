import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { FRAMEWORK_DIR, SETTINGS_FILE as LOCAL } from '../lib/paths.mjs';
import { applyRepo, REPO_PLACES } from '../lib/places.mjs';

// repos: git URLs of the saved and shared notebook repos ('' = not set). commitAgent: ACP agent id that writes sync
// commit messages, or null for the default message.
const DEFAULTS = { defaultAgent: 'rovo', permissionMode: 'ask', agents: {}, repos: { saved: '', shared: '' }, commitAgent: null };
export const PERMISSION_MODES = ['ask', 'auto'];

export async function loadSettings() {
  const raw = await fs.readFile(LOCAL, 'utf8').catch(() => '{}');
  const loaded = JSON.parse(raw);
  return { ...DEFAULTS, ...loaded, repos: { ...DEFAULTS.repos, ...loaded.repos } };
}

export async function saveSettings(patch) {
  const cur = await loadSettings();
  const next = { ...cur };
  if (patch.defaultAgent !== undefined) next.defaultAgent = String(patch.defaultAgent);
  if (patch.permissionMode !== undefined) {
    if (!PERMISSION_MODES.includes(patch.permissionMode)) throw new Error('invalid permissionMode');
    next.permissionMode = patch.permissionMode;
  }
  if (patch.agents) {
    next.agents = { ...cur.agents };
    for (const [id, o] of Object.entries(patch.agents)) {
      if (o === null) { delete next.agents[id]; continue; }
      next.agents[id] = {
        ...(o.command ? { command: String(o.command) } : {}),
        ...(Array.isArray(o.args) ? { args: o.args.map(String) } : {}),
        ...(o.env && typeof o.env === 'object' ? { env: Object.fromEntries(Object.entries(o.env).map(([k, v]) => [k, String(v)])) } : {}),
        ...(o.name ? { name: String(o.name) } : {}),
      };
    }
  }
  if (patch.commitAgent !== undefined) {
    next.commitAgent = patch.commitAgent ? String(patch.commitAgent) : null;
    if (next.commitAgent) await getAgent(next.commitAgent); // unknown agent id -> error, nothing saved
  }
  let failure = null;
  if (patch.repos) {
    next.repos = { ...cur.repos };
    for (const place of REPO_PLACES) {
      if (patch.repos[place] === undefined) continue;
      try {
        const url = String(patch.repos[place] ?? '').trim();
        await applyRepo(place, url, cur.repos[place]); // clones; a bad URL throws and the previous setting is kept
        next.repos[place] = url;
      } catch (err) {
        failure = err;
        break;
      }
    }
  }
  await fs.mkdir(path.dirname(LOCAL), { recursive: true });
  await fs.writeFile(LOCAL, JSON.stringify(next, null, 2) + '\n');
  if (failure) throw failure;
  return next;
}

/** Built-in agents merged with local overrides (and locally-added agents). */
export async function listAgents() {
  const builtin = JSON.parse(await fs.readFile(path.join(FRAMEWORK_DIR, 'agents.json'), 'utf8')).agents;
  const { agents: overrides } = await loadSettings();
  const out = builtin.map((a) => ({ ...a, ...(overrides[a.id] || {}), builtin: true, overridden: !!overrides[a.id] }));
  for (const [id, o] of Object.entries(overrides)) {
    if (!builtin.some((a) => a.id === id) && o.command) out.push({ id, name: o.name || id, args: [], ...o, builtin: false });
  }
  return out;
}

export async function getAgent(id) {
  const a = (await listAgents()).find((x) => x.id === id);
  if (!a) throw new Error(`Unknown agent: ${id}`);
  return a;
}

/** Is the agent's command on PATH? (Does not start it.) */
export function checkAgent(agent) {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', 'command -v "$1"', 'sh', agent.command], (err, stdout) => {
      resolve({ id: agent.id, available: !err && !!stdout.trim(), path: stdout.trim() || null });
    });
  });
}

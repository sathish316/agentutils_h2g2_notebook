// Commit messages for sync: ask the configured ACP agent for a short message from the notebook's diff.
// Never blocks a sync: no agent, an agent error or a timeout all return null (the caller uses the default message).
import { AcpConnection, PROTOCOL_VERSION } from './acp-client.mjs';
import { getAgent, loadSettings } from './settings.mjs';
import { ROOT } from '../lib/paths.mjs';

const MAX_DIFF = 30_000;
const TIMEOUT_MS = 60_000;

/** First non-empty line, stripped of quotes/backticks/bullets and capped at 100 characters; '' when nothing usable. */
export function cleanMessage(text) {
  const line = String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.replace(/^(commit message:?|[-*#>]+)\s*/i, '').replace(/^["'`]+|["'`]+$/g, '').trim().slice(0, 100);
}

export function promptFor({ name, diff }) {
  const clipped = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n… (diff truncated)` : diff;
  return `Write a git commit message for these changes to the notebook "${name}".\n`
    + 'Reply with ONLY the message: one line, imperative mood, at most 72 characters, no quotes, no prefix. '
    + 'Do not use any tools and do not edit any files.\n\n```diff\n' + clipped + '\n```';
}

export async function agentCommitMessage({ diff, name }, { timeoutMs = TIMEOUT_MS } = {}) {
  const { commitAgent } = await loadSettings();
  if (!commitAgent) return null;
  const agent = await getAgent(commitAgent);
  const deny = async () => { throw new Error('Not allowed while writing a commit message'); };
  const conn = new AcpConnection({
    command: agent.command, args: agent.args, cwd: ROOT, env: agent.env,
    handlers: {
      'session/request_permission': async () => ({ outcome: { outcome: 'cancelled' } }),
      'fs/read_text_file': deny, 'fs/write_text_file': deny,
    },
  });
  let text = '';
  let sessionId = null;
  conn.on('notification', (method, params) => {
    const u = params?.update;
    if (method === 'session/update' && params?.sessionId === sessionId && u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') text += u.content.text;
  });
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('commit message agent timed out')), timeoutMs); });
  try {
    await Promise.race([deadline, (async () => {
      const init = await conn.initialize();
      if (init?.protocolVersion !== PROTOCOL_VERSION) throw new Error('unsupported ACP protocol version');
      sessionId = (await conn.newSession(ROOT)).sessionId;
      await conn.prompt(sessionId, promptFor({ name, diff }));
    })()]);
    return cleanMessage(text) || null;
  } finally {
    clearTimeout(timer);
    conn.kill();
  }
}

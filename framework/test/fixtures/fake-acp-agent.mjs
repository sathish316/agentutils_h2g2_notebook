// Minimal fake ACP agent for tests. FAKE_MODE: ok (default) | multiline | fail | hang. FAKE_REPLY sets the answer text.
import readline from 'node:readline';

const mode = process.env.FAKE_MODE || 'ok';
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') return send({ id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'fake' }, authMethods: [] } });
  if (msg.method === 'session/new') return send({ id: msg.id, result: { sessionId: 's1' } });
  if (msg.method !== 'session/prompt') return;
  if (mode === 'hang') return;
  if (mode === 'fail') return send({ id: msg.id, error: { code: -32603, message: 'boom' } });
  const reply = mode === 'multiline' ? '"Add chapter on retries"\n\nThis commit adds…' : (process.env.FAKE_REPLY || 'Add notes on consumer groups');
  send({ method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply } } } });
  send({ id: msg.id, result: { stopReason: 'end_turn' } });
});

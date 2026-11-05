// H2G2 notebook server: static viewer + notebook files + JSON API + SSE events + ACP session manager.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ROOT, NOTEBOOKS_DIR, FRAMEWORK_DIR, NAME_RE, listNotebooks, loadNotebookForViewer, isNotebook, validateNotebook, createNotebook } from '../lib/notebook.mjs';
import { AcpConnection } from './acp-client.mjs';
import { SessionManager } from './sessions.mjs';
import { MODES } from './prompts.mjs';
import { listAgents, getAgent, checkAgent, loadSettings, saveSettings, PERMISSION_MODES } from './settings.mjs';

const PORT = Number(process.env.PORT || 4242);
const HOST = process.env.HOST || '127.0.0.1';
const VIEWER = path.join(FRAMEWORK_DIR, 'viewer');
const VENDOR = {
  marked: path.join(ROOT, 'node_modules/marked/lib'),
  dompurify: path.join(ROOT, 'node_modules/dompurify/dist'),
  mermaid: path.join(ROOT, 'node_modules/mermaid/dist'),
  'sql.js': path.join(ROOT, 'node_modules/sql.js/dist'),
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.wasm': 'application/wasm', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.sql': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};

const sessions = new SessionManager();

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
};
const json = (res, status, data) => send(res, status, JSON.stringify(data), { 'content-type': MIME['.json'] });

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

async function serveFile(res, baseDir, rel) {
  const file = path.resolve(baseDir, '.' + path.posix.normalize('/' + rel));
  if (!file.startsWith(baseDir)) return send(res, 403, 'Forbidden');
  if (path.basename(file).startsWith('.')) return send(res, 404, 'Not found');
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
}

function sse(req, res, notebook) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(`event: hello\ndata: ${JSON.stringify({ state: sessions.state(notebook) })}\n\n`);
  const unsub = sessions.subscribe(notebook, (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(ping); unsub(); });
}

// Notify browsers when notebook or viewer files change (agents write files; viewers live-refresh).
function watch() {
  const timers = new Map();
  const debounce = (key, fn) => { clearTimeout(timers.get(key)); timers.set(key, setTimeout(fn, 250)); };
  const pending = new Map();
  try {
    fs.watch(NOTEBOOKS_DIR, { recursive: true }, (_e, file) => {
      if (!file) return;
      const [nb, ...rest] = file.split(path.sep);
      if (!NAME_RE.test(nb) || rest.some((p) => p.startsWith('.'))) return;
      const files = pending.get(nb) || new Set();
      files.add(rest.join('/'));
      pending.set(nb, files);
      debounce(nb, () => {
        sessions.emit(nb, 'notebook_changed', { files: [...(pending.get(nb) || [])] });
        pending.delete(nb);
      });
    });
    fs.watch(VIEWER, { recursive: true }, () => debounce('__viewer', () => sessions.emitAll('framework_changed')));
  } catch (err) {
    console.warn(`File watching unavailable (${err.message}); viewers won't live-refresh.`);
  }
}

async function api(req, res, parts) {
  const method = req.method;
  // /api/notebooks
  if (parts[0] === 'notebooks' && parts.length === 1 && method === 'GET') return json(res, 200, await listNotebooks());
  if (parts[0] === 'notebooks' && parts.length === 1 && method === 'POST') {
    const { name, title, scope, description, message, agentId } = await readBody(req);
    await createNotebook(String(name || ''), { title, scope, description });
    const job = message?.trim() ? await sessions.ask(name, { agentId, mode: 'new-chapter', message, autoApprove: true }) : null;
    return json(res, 201, { name, jobId: job?.id || null });
  }
  if (parts[0] === 'notebooks' && parts.length >= 2) {
    const name = parts[1];
    if (!(await isNotebook(name))) return json(res, 404, { error: `No notebook "${name}". Create it with: node framework/cli.mjs new ${name} --title "…" --scope general|org` });
    const action = parts[2];
    if (!action && method === 'GET') return json(res, 200, await loadNotebookForViewer(name));
    if (action === 'events' && method === 'GET') return sse(req, res, name);
    if (action === 'state' && method === 'GET') return json(res, 200, sessions.state(name));
    if (action === 'validate' && method === 'GET') return json(res, 200, await validateNotebook(name));
    if (action === 'ask' && method === 'POST') {
      const job = await sessions.ask(name, await readBody(req));
      return json(res, 202, { jobId: job.id });
    }
    if (action === 'cancel' && method === 'POST') { sessions.cancel(name); return json(res, 200, { ok: true }); }
    if (action === 'reset' && method === 'POST') { sessions.reset(name); return json(res, 200, { ok: true }); }
    if (action === 'auto-approve' && method === 'POST') {
      const { on } = await readBody(req);
      sessions.setAutoApprove(name, !!on);
      return json(res, 200, { ok: true, on: !!on });
    }
    if (action === 'permission' && method === 'POST') {
      const { requestId, optionId } = await readBody(req);
      sessions.respondPermission(name, requestId, optionId || null);
      return json(res, 200, { ok: true });
    }
  }
  if (parts[0] === 'agents' && parts[2] === 'test' && method === 'POST') return json(res, 200, await testAgent(parts[1]));
  if (parts[0] === 'agents' && method === 'GET') {
    const agents = await listAgents();
    const checks = await Promise.all(agents.map(checkAgent));
    return json(res, 200, { agents: agents.map((a, i) => ({ ...a, ...checks[i] })) });
  }
  if (parts[0] === 'modes' && method === 'GET') return json(res, 200, MODES);
  if (parts[0] === 'settings' && method === 'GET') return json(res, 200, { ...(await loadSettings()), permissionModes: PERMISSION_MODES });
  if (parts[0] === 'settings' && method === 'PUT') return json(res, 200, await saveSettings(await readBody(req)));
  return json(res, 404, { error: 'Not found' });
}

/** Spawn the agent, run the ACP handshake + session/new, then shut it down. */
async function testAgent(id) {
  const agent = await getAgent(id);
  const started = Date.now();
  const conn = new AcpConnection({ command: agent.command, args: agent.args, cwd: ROOT, env: agent.env });
  try {
    const init = await conn.initialize();
    let session = null;
    let sessionError = null;
    try { session = await conn.newSession(ROOT); } catch (err) { sessionError = err.message; }
    return {
      ok: !!session, ms: Date.now() - started, protocolVersion: init?.protocolVersion, agentInfo: init?.agentInfo || null,
      authMethods: (init?.authMethods || []).map((a) => a.name || a.id), sessionError,
      hint: sessionError && agent.loginHint ? `Try: ${agent.loginHint}` : undefined,
    };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err.message };
  } finally {
    conn.kill();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) return await api(req, res, p.slice(5).split('/').filter(Boolean));
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (p === '/' || p === '/index.html') return serveFile(res, VIEWER, 'home.html');
    if (p === '/settings' || p === '/settings.html') return serveFile(res, VIEWER, 'settings.html');
    if (p.startsWith('/framework/')) return serveFile(res, VIEWER, p.slice('/framework/'.length));
    if (p.startsWith('/vendor/')) {
      const [, , lib, ...rest] = p.split('/');
      return VENDOR[lib] ? serveFile(res, VENDOR[lib], rest.join('/')) : send(res, 404, 'Not found');
    }
    const m = /^\/notebooks\/([^/]+)(\/.*)?$/.exec(p);
    if (m) {
      const [, name, rest = ''] = m;
      if (!NAME_RE.test(name)) return send(res, 404, 'Not found');
      if (!rest) return send(res, 302, '', { location: `/notebooks/${name}/` });
      if (rest === '/' || rest === '/index.html') return serveFile(res, VIEWER, 'notebook.html');
      return serveFile(res, path.join(NOTEBOOKS_DIR, name), rest.slice(1));
    }
    send(res, 404, 'Not found');
  } catch (err) {
    if (!res.headersSent) json(res, err.status || 400, { error: err.message });
    else res.end();
  }
});

watch();
server.listen(PORT, HOST, () => console.log(`H2G2 running at http://${HOST}:${PORT}/`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { sessions.shutdown(); process.exit(0); });

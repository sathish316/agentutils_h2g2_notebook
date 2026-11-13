// ACP session manager: one long-lived agent session per (notebook, agent) started in the repo root (so the
// agent reads AGENTS.md), a FIFO job queue per
// notebook, an event log per notebook streamed to browsers, and permission requests relayed to the UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AcpConnection, AcpError, PROTOCOL_VERSION } from './acp-client.mjs';
import { buildPrompt, MODES } from './prompts.mjs';
import { ROOT, notebookDir, validateNotebook } from '../lib/notebook.mjs';
import { getAgent, loadSettings } from './settings.mjs';

const BACKLOG = 2000;
const IDLE_MS = 2 * 60 * 60_000; // keep conversations alive for follow-ups
const PERMISSION_TIMEOUT_MS = 15 * 60_000;

const within = (file, dir) => {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const textOf = (content) => (content && content.type === 'text' ? content.text : '');
const clip = (s, n = 2000) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

function summarizeToolContent(content) {
  if (!Array.isArray(content)) return undefined;
  return content.map((c) => {
    if (c.type === 'diff') return { type: 'diff', path: c.path };
    if (c.type === 'content') return { type: 'text', text: clip(textOf(c.content)) };
    return { type: c.type };
  });
}

export class SessionManager {
  channels = new Map();
  sessions = new Map();
  globalSubscribers = new Set();

  constructor() {
    this.reaper = setInterval(() => this.#reap(), 60_000).unref();
  }

  // ---- events ---------------------------------------------------------------
  #channel(notebook) {
    let ch = this.channels.get(notebook);
    if (!ch) {
      ch = { seq: 0, events: [], subscribers: new Set(), queue: [], running: null, permissions: new Map() };
      this.channels.set(notebook, ch);
    }
    return ch;
  }

  emit(notebook, type, data = {}) {
    const ch = this.#channel(notebook);
    const ev = { seq: ++ch.seq, ts: Date.now(), type, ...data };
    const last = ch.events[ch.events.length - 1];
    // Coalesce streaming chunks in the backlog; live subscribers still get each delta.
    if ((type === 'message' || type === 'thought') && last && last.type === type && last.jobId === ev.jobId) {
      last.text += ev.text;
    } else {
      ch.events.push({ ...ev });
      if (ch.events.length > BACKLOG) ch.events.splice(0, ch.events.length - BACKLOG);
    }
    for (const fn of ch.subscribers) fn(ev);
    return ev;
  }

  emitAll(type, data = {}) {
    for (const fn of this.globalSubscribers) fn({ ts: Date.now(), type, ...data });
  }

  /** Subscribe to a notebook's events. Replays the full backlog first. */
  subscribe(notebook, fn) {
    const ch = this.#channel(notebook);
    for (const ev of ch.events) fn(ev);
    ch.subscribers.add(fn);
    this.globalSubscribers.add(fn);
    return () => { ch.subscribers.delete(fn); this.globalSubscribers.delete(fn); };
  }

  state(notebook) {
    const ch = this.#channel(notebook);
    const pub = (j) => j && { id: j.id, mode: j.mode, agentId: j.agentId, chapterId: j.chapterId, topicId: j.topicId, message: j.message, createdAt: j.createdAt };
    return {
      running: pub(ch.running),
      queue: ch.queue.map(pub),
      permissions: [...ch.permissions.entries()].map(([requestId, p]) => ({ requestId, jobId: p.jobId, toolCall: p.toolCall, options: p.options })),
      sessions: [...this.sessions.values()].filter((s) => s.notebook === notebook).map((s) => ({
        agentId: s.agentId, sessionId: s.sessionId, ready: !!s.sessionId, agentInfo: s.agentInfo, turns: s.turns,
      })),
    };
  }

  // ---- jobs -----------------------------------------------------------------
  async ask(notebook, { agentId, mode = 'new-chapter', chapterId, topicId, message }) {
    if (!MODES[mode]) throw new Error(`Unknown mode: ${mode}`);
    if (!message?.trim()) throw new Error('message is required');
    agentId ||= (await loadSettings()).defaultAgent;
    await getAgent(agentId);
    const ch = this.#channel(notebook);
    const job = { id: randomUUID().slice(0, 8), notebook, agentId, mode, chapterId, topicId, message: message.trim(), createdAt: Date.now() };
    ch.queue.push(job);
    this.emit(notebook, 'job_queued', { jobId: job.id, job: this.state(notebook).queue.at(-1), position: ch.queue.length + (ch.running ? 1 : 0) });
    queueMicrotask(() => this.#pump(notebook));
    return job;
  }

  async #pump(notebook) {
    const ch = this.#channel(notebook);
    if (ch.running || !ch.queue.length) return;
    const job = (ch.running = ch.queue.shift());
    this.emit(notebook, 'job_started', { jobId: job.id, job: this.state(notebook).running });
    try {
      const sess = await this.#session(notebook, job);
      job.sessionKey = sess.key;
      const prompt = await buildPrompt(notebook, job, { warm: sess.turns > 0 });
      if (job.cancelled) throw new AcpError('Cancelled', 'cancelled');
      const res = await sess.conn.prompt(sess.sessionId, prompt);
      sess.turns++;
      sess.lastUsed = Date.now();
      this.emit(notebook, 'job_done', { jobId: job.id, stopReason: res?.stopReason || 'end_turn' });
      if (MODES[job.mode].writes && !MODES[job.mode].framework) {
        const v = await validateNotebook(notebook);
        if (v.errors.length || v.warnings.length) this.emit(notebook, 'validation', { jobId: job.id, ...v });
      }
    } catch (err) {
      if (job.cancelled) this.emit(notebook, 'job_done', { jobId: job.id, stopReason: 'cancelled' });
      else this.emit(notebook, 'job_error', { jobId: job.id, error: err.message });
    } finally {
      ch.running = null;
      this.emit(notebook, 'idle', {});
      this.#pump(notebook);
    }
  }

  cancel(notebook) {
    const ch = this.#channel(notebook);
    for (const job of ch.queue.splice(0)) this.emit(notebook, 'job_done', { jobId: job.id, stopReason: 'cancelled' });
    for (const [requestId, p] of ch.permissions) {
      p.resolve({ outcome: { outcome: 'cancelled' } });
      ch.permissions.delete(requestId);
      this.emit(notebook, 'permission_resolved', { requestId, jobId: p.jobId, optionId: null });
    }
    const job = ch.running;
    if (job) {
      job.cancelled = true;
      const sess = this.sessions.get(job.sessionKey);
      if (sess?.sessionId) try { sess.conn.cancel(sess.sessionId); } catch { /* gone */ }
    }
  }

  /** Cancel everything and drop the notebook's agent sessions (next ask starts fresh context). */
  reset(notebook) {
    this.cancel(notebook);
    for (const [key, s] of this.sessions) if (s.notebook === notebook) { s.conn.kill(); this.sessions.delete(key); }
    this.emit(notebook, 'session_reset', {});
  }

  respondPermission(notebook, requestId, optionId) {
    const ch = this.#channel(notebook);
    const p = ch.permissions.get(requestId);
    if (!p) throw new Error('No such pending permission request');
    if (optionId && !p.options.some((o) => o.optionId === optionId)) throw new Error('Invalid optionId');
    ch.permissions.delete(requestId);
    p.resolve(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } });
    this.emit(notebook, 'permission_resolved', { requestId, jobId: p.jobId, optionId });
  }

  // ---- agent sessions ---------------------------------------------------------
  async #session(notebook, job) {
    const key = `${notebook}|${job.agentId}`;
    const existing = this.sessions.get(key);
    if (existing && !existing.conn.closed) return existing.ready;

    const agent = await getAgent(job.agentId);
    const cwd = ROOT;
    // Notebook requests may only write inside their notebook; framework requests anywhere in the repo.
    const writeRoot = (j) => (j && MODES[j.mode].framework ? ROOT : notebookDir(notebook));
    const sess = { key, notebook, agentId: agent.id, cwd, sessionId: null, turns: 0, lastUsed: Date.now() };
    const ch = this.#channel(notebook);
    const current = () => ch.running;

    this.emit(notebook, 'status', { jobId: job.id, text: `Starting ${agent.name} (${[agent.command, ...(agent.args || [])].join(' ')})…` });
    sess.conn = new AcpConnection({
      command: agent.command, args: agent.args, cwd, env: agent.env,
      handlers: {
        'session/request_permission': (params) => this.#permission(notebook, current(), params),
        'fs/read_text_file': async ({ path: file, line, limit }) => {
          if (!path.isAbsolute(file) || !within(path.resolve(file), ROOT)) throw new Error(`Read outside the repository is not allowed: ${file}`);
          let content = await fs.readFile(file, 'utf8');
          if (line || limit) {
            const lines = content.split('\n');
            const start = Math.max(0, (line || 1) - 1);
            content = lines.slice(start, limit ? start + limit : undefined).join('\n');
          }
          return { content };
        },
        'fs/write_text_file': async ({ path: file, content }) => {
          const job = current();
          if (job && !MODES[job.mode].writes) throw new Error('This request is answer-only; file changes are not allowed');
          const root = writeRoot(job);
          if (!path.isAbsolute(file) || !within(path.resolve(file), root)) throw new Error(`Write outside ${path.relative(ROOT, root) || 'the repo'} is not allowed: ${file}`);
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, content);
          this.emit(notebook, 'file_written', { jobId: job?.id, path: path.relative(ROOT, file) });
          return null;
        },
      },
    });
    sess.conn.on('notification', (method, params) => {
      if (method !== 'session/update' || params?.sessionId !== sess.sessionId) return;
      sess.lastUsed = Date.now();
      this.#onUpdate(notebook, current()?.id, params.update || {});
    });
    sess.conn.on('stderr', (t) => this.emit(notebook, 'stderr', { jobId: current()?.id, agentId: agent.id, text: clip(t, 4000) }));
    sess.conn.on('exit', () => {
      if (this.sessions.get(key) === sess) this.sessions.delete(key);
      this.emit(notebook, 'session_closed', { agentId: agent.id });
    });

    this.sessions.set(key, sess);
    sess.ready = (async () => {
      try {
        const init = await sess.conn.initialize();
        if (init?.protocolVersion !== PROTOCOL_VERSION) {
          throw new Error(`${agent.name} speaks ACP protocol v${init?.protocolVersion}; h2g2 supports v${PROTOCOL_VERSION}`);
        }
        sess.agentInfo = init.agentInfo || null;
        sess.authMethods = init.authMethods || [];
        let res;
        try {
          res = await sess.conn.newSession(cwd);
        } catch (err) {
          if (err.code === -32000 || /auth/i.test(err.message)) {
            throw new Error(`${agent.name} needs authentication. ${agent.loginHint ? `Run \`${agent.loginHint}\` in a terminal, then retry.` : ''} (${err.message})`);
          }
          throw err;
        }
        sess.sessionId = res.sessionId;
        this.emit(notebook, 'session_ready', { jobId: job.id, agentId: agent.id, sessionId: res.sessionId, agentInfo: sess.agentInfo });
        return sess;
      } catch (err) {
        sess.conn.kill();
        this.sessions.delete(key);
        throw err;
      }
    })();
    return sess.ready;
  }

  #onUpdate(notebook, jobId, u) {
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': return this.emit(notebook, 'message', { jobId, text: textOf(u.content) });
      case 'agent_thought_chunk': return this.emit(notebook, 'thought', { jobId, text: textOf(u.content) });
      case 'tool_call':
        return this.emit(notebook, 'tool_call', {
          jobId, toolCallId: u.toolCallId, title: u.title, kind: u.kind, status: u.status || 'pending',
          locations: u.locations?.map((l) => l.path), content: summarizeToolContent(u.content),
        });
      case 'tool_call_update':
        return this.emit(notebook, 'tool_call_update', {
          jobId, toolCallId: u.toolCallId, status: u.status, title: u.title,
          locations: u.locations?.map((l) => l.path), content: summarizeToolContent(u.content),
        });
      case 'plan': return this.emit(notebook, 'plan', { jobId, entries: u.entries || [] });
      default: return undefined; // user_message_chunk, available_commands_update, mode updates…
    }
  }

  async #permission(notebook, job, { toolCall, options = [] }) {
    const { permissionMode } = await loadSettings();
    const ch = this.#channel(notebook);
    if (permissionMode === 'auto' && job && MODES[job.mode].writes) {
      const pick = options.find((o) => o.kind === 'allow_always') || options.find((o) => o.kind === 'allow_once');
      if (pick) {
        this.emit(notebook, 'permission_auto', { jobId: job.id, title: toolCall?.title, optionId: pick.optionId });
        return { outcome: { outcome: 'selected', optionId: pick.optionId } };
      }
    }
    const requestId = randomUUID().slice(0, 8);
    const tc = { title: toolCall?.title, kind: toolCall?.kind, locations: toolCall?.locations?.map((l) => l.path), content: summarizeToolContent(toolCall?.content) };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (ch.permissions.delete(requestId)) {
          resolve({ outcome: { outcome: 'cancelled' } });
          this.emit(notebook, 'permission_resolved', { requestId, jobId: job?.id, optionId: null });
        }
      }, PERMISSION_TIMEOUT_MS);
      ch.permissions.set(requestId, { jobId: job?.id, toolCall: tc, options, resolve: (v) => { clearTimeout(timer); resolve(v); } });
      this.emit(notebook, 'permission_request', { requestId, jobId: job?.id, toolCall: tc, options });
    });
  }

  #reap() {
    const now = Date.now();
    for (const [key, s] of this.sessions) {
      const ch = this.channels.get(s.notebook);
      const busy = ch?.running?.sessionKey === key;
      if (!busy && now - s.lastUsed > IDLE_MS) {
        s.conn.kill();
        this.sessions.delete(key);
      }
    }
  }

  shutdown() {
    clearInterval(this.reaper);
    for (const s of this.sessions.values()) s.conn.kill();
    this.sessions.clear();
  }
}

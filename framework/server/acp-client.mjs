// Minimal Agent Client Protocol (ACP) client: JSON-RPC 2.0, newline-delimited, over a child's stdio.
// Spec: https://agentclientprotocol.com
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export const PROTOCOL_VERSION = 1;

export class AcpError extends Error {
  constructor(message, code, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/**
 * Events: 'notification' (method, params), 'stderr' (text), 'exit' ({code, signal}).
 * Incoming agent->client requests are dispatched to `handlers[method](params)`.
 */
export class AcpConnection extends EventEmitter {
  constructor({ command, args = [], cwd, env = {}, handlers = {} }) {
    super();
    this.handlers = handlers;
    this.nextId = 1;
    this.pending = new Map();
    this.stderrTail = '';
    this.closed = false;
    this.child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.#onLine(line);
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (t) => {
      this.stderrTail = (this.stderrTail + t).slice(-4000);
      this.emit('stderr', t);
    });
    this.child.stdin.on('error', () => {});
    const fail = (err) => {
      if (this.closed) return;
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    };
    this.child.on('error', (err) => {
      fail(new AcpError(`Failed to start agent "${command}": ${err.message}`, 'spawn'));
      this.emit('exit', { code: null, signal: null, error: err });
    });
    this.child.on('exit', (code, signal) => {
      const tail = this.stderrTail.trim().split('\n').slice(-8).join('\n');
      fail(new AcpError(`Agent exited (code ${code ?? signal})${tail ? `:\n${tail}` : ''}`, 'exit'));
      this.emit('exit', { code, signal });
    });
  }

  #send(msg) {
    if (this.closed) throw new AcpError('Agent connection is closed', 'closed');
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  }

  request(method, params, { timeoutMs } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let timer;
      if (timeoutMs) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new AcpError(`ACP request timed out: ${method}`, 'timeout'));
        }, timeoutMs);
      }
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        this.#send({ id, method, params });
      } catch (err) {
        this.pending.get(id)?.reject(err);
        this.pending.delete(id);
      }
    });
  }

  notify(method, params) {
    this.#send({ method, params });
  }

  async #onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.emit('stderr', `[non-JSON stdout] ${line}\n`);
      return;
    }
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new AcpError(msg.error.message || 'ACP error', msg.error.code, msg.error.data));
      else p.resolve(msg.result ?? null);
      return;
    }
    if (msg.id === undefined) {
      this.emit('notification', msg.method, msg.params);
      return;
    }
    const handler = this.handlers[msg.method];
    if (!handler) {
      this.#safeSend({ id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
      return;
    }
    try {
      const result = await handler(msg.params || {});
      this.#safeSend({ id: msg.id, result: result ?? null });
    } catch (err) {
      this.#safeSend({ id: msg.id, error: { code: err.code && Number.isInteger(err.code) ? err.code : -32603, message: err.message } });
    }
  }

  #safeSend(msg) {
    try { this.#send(msg); } catch { /* agent already gone */ }
  }

  kill() {
    if (!this.closed) this.child.kill('SIGTERM');
    setTimeout(() => { if (this.child.exitCode === null) this.child.kill('SIGKILL'); }, 3000).unref();
  }

  // --- Typed helpers -------------------------------------------------------
  initialize() {
    return this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'h2g2', title: 'H2G2 Notebooks', version: '0.1.0' },
    }, { timeoutMs: 60_000 });
  }

  newSession(cwd, mcpServers = []) {
    return this.request('session/new', { cwd, mcpServers }, { timeoutMs: 120_000 });
  }

  prompt(sessionId, text) {
    return this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] });
  }

  cancel(sessionId) {
    this.notify('session/cancel', { sessionId });
  }
}

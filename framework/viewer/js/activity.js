// Agent activity drawer: renders the ACP session event stream (messages, tool calls, plans, permissions).
import { h, icon, toast } from './util.js';
import { api } from './api.js';
import { agentPref, autoApprovePref, autoApproveToggle } from './ask.js';
import { renderMarkdown } from './render/markdown.js';

const TOOL_ICONS = { read: '📖', edit: '✏️', delete: '🗑', move: '↔', search: '🔎', execute: '⌘', think: '💭', fetch: '🌐', other: '•' };
const STATUS_ICONS = { pending: '◌', in_progress: '◐', completed: '✓', failed: '✕' };

export class Activity {
  constructor({ notebook, agents, modes, defaultAgent, currentChapter, onNotebookChanged, onFrameworkChanged, onBusy }) {
    Object.assign(this, { notebook, agents, modes, defaultAgent, currentChapter, onNotebookChanged, onFrameworkChanged, onBusy });
    this.jobs = new Map();
    this.lastJob = null;
    this.body = h('div', { class: 'drawer-body' });
    this.chat = this.#chatBox();
    this.cancelBtn = h('button', { class: 'tbtn', title: 'Stop the running request', onclick: () => api.cancel(notebook), html: `${icon('stop', 16)} Stop` });
    this.el = h('aside', { class: 'drawer', 'aria-label': 'Agent activity' },
      h('div', { class: 'drawer-head' },
        h('h3', {}, 'Agent'),
        this.cancelBtn,
        h('button', { class: 'tbtn', title: 'Start a fresh agent session (forgets conversation context)', onclick: () => this.#reset(), html: `${icon('reset', 16)} New session` }),
        h('button', { class: 'tbtn', title: 'Close', onclick: () => this.close(), html: icon('close', 18) })),
      this.body,
      this.chat.el);
    document.body.append(this.el);
    this.#empty();
    this.#updateHint();
    api.autoApprove(notebook, autoApprovePref.get(notebook)).catch(() => {});
    this.connect();
  }

  open() { this.el.classList.add('open'); this.#scrollEnd(); }
  close() { this.el.classList.remove('open'); }
  toggle() { this.el.classList.toggle('open'); }

  async #reset() {
    if (!confirm('Start a new agent session? Running and queued requests are cancelled and the agent forgets this conversation.')) return;
    await api.reset(this.notebook);
  }

  // Follow-up chat: continues the same ACP session (same agent as the last request) so the agent keeps context.
  #chatBox() {
    const text = h('textarea', { rows: 2, placeholder: 'Follow up — ask about the chapter or ask for a change…' });
    const send = h('button', { class: 'send', type: 'submit' }, 'Send');
    const hint = h('span', { class: 'chat-hint' });
    const el = h('form', { class: 'drawer-chat' }, text, h('div', { class: 'row' }, hint, h('span', { class: 'chat-actions' }, autoApproveToggle(this.notebook), send)));
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.requestSubmit(); }
    });
    el.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = text.value.trim();
      if (!message) return text.focus();
      send.disabled = true;
      try {
        const chapter = this.currentChapter?.();
        await api.ask(this.notebook, {
          agentId: this.#chatAgent(), autoApprove: autoApprovePref.get(this.notebook), mode: 'followup', message,
          chapterId: chapter?.status === 'planned' ? this.lastJob?.chapterId : (chapter?.id || this.lastJob?.chapterId),
        });
        text.value = '';
      } catch (err) {
        toast(err.message);
      } finally {
        send.disabled = false;
        text.focus();
      }
    });
    return { el, text, hint, focus: () => text.focus() };
  }

  #chatAgent() { return this.lastJob?.agentId || agentPref.get(this.notebook, this.defaultAgent); }

  #updateHint() {
    const ch = this.currentChapter?.();
    const about = ch && ch.status !== 'planned' ? ` · about “${ch.title}”` : '';
    this.chat.hint.textContent = `${this.#agentName(this.#chatAgent())}${this.lastJob ? ' · same session' : ''}${about}`;
  }

  /** Called by the viewer when the reader turns to another page. */
  pageChanged() { this.#updateHint(); }

  #scrollEnd(force = false) {
    const b = this.body;
    if (force || b.scrollHeight - b.scrollTop - b.clientHeight < 120) requestAnimationFrame(() => { b.scrollTop = b.scrollHeight; });
  }

  #empty() {
    if (!this.jobs.size) this.body.replaceChildren(h('div', { class: 'drawer-empty' }, 'Nothing yet — ask a question on any page and the agent’s work shows up here.'));
  }

  connect() {
    this.es?.close();
    this.es = api.events(this.notebook);
    this.es.addEventListener('hello', () => {
      this.connectedAt = Date.now();
      this.jobs.clear();
      this.lastJob = null;
      this.body.replaceChildren();
      this.#empty();
      this.#busy();
    });
    this.es.onmessage = (m) => {
      try { this.#handle(JSON.parse(m.data)); } catch (err) { console.error('[h2g2] event', err); }
    };
  }

  #live(ev) { return ev.ts >= (this.connectedAt || 0) - 500; }

  #agentName(id) { return this.agents.find((a) => a.id === id)?.name || id; }

  #job(id, job) {
    let j = this.jobs.get(id);
    if (j) return j;
    if (!this.jobs.size) this.body.replaceChildren();
    const status = h('span', { class: 'job-status' }, 'queued');
    const body = h('div', { class: 'job-body' });
    const el = h('section', { class: 'job' },
      h('div', { class: 'job-head' },
        h('div', { class: 'q' }, job?.message || '(request)'),
        h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' } }, status,
          h('span', { class: 'tag' }, job ? `${this.modes[job.mode]?.label || job.mode} · ${this.#agentName(job.agentId)}` : ''))),
      body);
    this.body.append(el);
    if (job) { this.lastJob = job; this.#updateHint(); }
    j = { el, status, body, tools: new Map(), msg: null, thought: null, plan: null, stderr: null, state: 'queued' };
    this.jobs.set(id, j);
    return j;
  }

  #setState(j, state, label = state) {
    j.state = state;
    j.status.className = `job-status ${state}`;
    j.status.textContent = label;
    this.#busy();
  }

  #busy() {
    const busy = [...this.jobs.values()].some((j) => j.state === 'running' || j.state === 'queued');
    this.cancelBtn.disabled = !busy;
    this.onBusy?.(busy);
  }

  #line(j, cls, content) {
    j.msg = null;
    j.thought = null;
    const el = h('div', { class: cls }, content);
    j.body.append(el);
    return el;
  }

  #handle(ev) {
    const live = this.#live(ev);
    const j = ev.jobId ? this.#job(ev.jobId, ev.job) : null;
    switch (ev.type) {
      case 'job_queued':
        if (ev.position > 1) this.#line(j, 'ev-status', `Queued (position ${ev.position})`);
        break;
      case 'job_started': this.#setState(j, 'running', 'working…'); break;
      case 'status': this.#line(j, 'ev-status', ev.text); break;
      case 'session_ready':
        if (j) this.#line(j, 'ev-status', `Connected${ev.agentInfo?.name ? ` to ${ev.agentInfo.title || ev.agentInfo.name} ${ev.agentInfo.version || ''}` : ''}`);
        break;
      case 'message': {
        if (!j) break;
        if (!j.msg) {
          j.thought = null;
          j.msg = { el: h('div', { class: 'ev-msg' }), text: '' };
          j.body.append(j.msg.el);
        }
        j.msg.text += ev.text;
        const m = j.msg;
        cancelAnimationFrame(m.raf);
        m.raf = requestAnimationFrame(() => { m.el.innerHTML = renderMarkdown(m.text); });
        break;
      }
      case 'thought': {
        if (!j) break;
        if (!j.thought) {
          j.msg = null;
          const pre = h('div');
          j.thought = { pre, el: h('details', { class: 'ev-thought' }, h('summary', {}, 'thinking…'), pre) };
          j.body.append(j.thought.el);
        }
        j.thought.pre.textContent += ev.text;
        break;
      }
      case 'tool_call': case 'tool_call_update': {
        if (!j) break;
        let t = j.tools.get(ev.toolCallId);
        if (!t) {
          const ic = h('span', { class: 'ic' });
          const title = h('span', { class: 't' });
          const st = h('span', { class: 'ic' });
          t = { el: this.#line(j, 'ev-tool', [ic, title, st]), ic, title, st, kind: ev.kind };
          j.tools.set(ev.toolCallId, t);
        }
        if (ev.kind) t.kind = ev.kind;
        t.ic.textContent = TOOL_ICONS[t.kind] || TOOL_ICONS.other;
        if (ev.title) t.title.textContent = ev.title;
        if (ev.locations?.length) t.title.title = ev.locations.join('\n');
        if (ev.status) { t.st.textContent = STATUS_ICONS[ev.status] || ''; t.el.classList.toggle('failed', ev.status === 'failed'); }
        break;
      }
      case 'plan': {
        if (!j) break;
        const list = h('ul', { class: 'ev-plan' }, ev.entries.map((e) => h('li', { class: e.status }, `${e.status === 'completed' ? '☑' : e.status === 'in_progress' ? '◐' : '☐'} ${e.content}`)));
        if (j.plan?.isConnected) j.plan.replaceWith(list); else j.body.append(list);
        j.plan = list;
        j.msg = null;
        break;
      }
      case 'permission_request': {
        if (!j) break;
        const opts = h('div', { class: 'opts' }, ev.options.map((o) => h('button', {
          class: `pill${o.kind?.startsWith('allow') ? ' primary' : ''}`,
          onclick: () => api.permission(this.notebook, ev.requestId, o.optionId).catch((e) => toast(e.message)),
        }, o.name)));
        const card = this.#line(j, 'ev-perm', [
          h('div', { class: 't' }, `Permission: ${ev.toolCall?.title || 'tool call'}`),
          ev.toolCall?.locations?.length ? h('div', { class: 'loc' }, ev.toolCall.locations.join('\n')) : null,
          opts,
        ]);
        card.dataset.req = ev.requestId;
        this.#setState(j, 'running', 'needs you');
        if (live) { this.open(); toast('The agent is asking for permission', { action: 'Review', onAction: () => this.open() }); }
        break;
      }
      case 'permission_resolved': {
        const card = this.body.querySelector(`.ev-perm[data-req="${CSS.escape(ev.requestId)}"]`);
        if (card) {
          card.querySelector('.opts').replaceWith(h('div', { class: 'ev-status' }, ev.optionId ? `→ ${ev.optionId}` : '→ cancelled'));
          card.style.opacity = '.6';
        }
        if (j && j.state === 'running') this.#setState(j, 'running', 'working…');
        break;
      }
      case 'permission_auto': this.#line(j, 'ev-status', `auto-approved: ${ev.title || ev.optionId}`); break;
      case 'file_written': this.#line(j, 'ev-status', `✎ wrote ${ev.path}`); break;
      case 'validation': {
        const lines = [...ev.errors.map((e) => `✕ ${e}`), ...ev.warnings.map((w) => `⚠ ${w}`)];
        this.#line(j, 'ev-valid', `Validation\n${lines.join('\n')}`);
        break;
      }
      case 'stderr': {
        if (!j) break;
        if (!j.stderr?.isConnected) {
          const pre = h('pre');
          j.stderr = h('details', { class: 'ev-stderr' }, h('summary', {}, 'agent logs'), pre);
          j.body.append(j.stderr);
        }
        const pre = j.stderr.querySelector('pre');
        pre.textContent = (pre.textContent + ev.text).slice(-8000);
        break;
      }
      case 'job_done': {
        const cancelled = ev.stopReason === 'cancelled';
        this.#setState(j, cancelled ? 'error' : 'done', cancelled ? 'cancelled' : ev.stopReason === 'end_turn' ? 'done' : ev.stopReason);
        if (live && !cancelled) {
          if (this.el.classList.contains('open')) this.chat.focus();
          else toast('✓ The agent finished', { action: 'Follow up', onAction: () => { this.open(); this.chat.focus(); } });
        }
        break;
      }
      case 'job_error':
        this.#line(j, 'ev-err', ev.error);
        this.#setState(j, 'error', 'failed');
        if (live) { this.open(); toast('The agent request failed'); }
        break;
      case 'session_reset':
        for (const job of this.jobs.values()) if (job.state === 'running' || job.state === 'queued') this.#setState(job, 'error', 'cancelled');
        this.lastJob = null;
        this.#updateHint();
        if (live) toast('Started a new agent session');
        break;
      case 'notebook_changed': if (live) this.onNotebookChanged?.(ev.files || []); break;
      case 'framework_changed': if (live) this.onFrameworkChanged?.(); break;
      default: break;
    }
    if (j && this.el.classList.contains('open')) this.#scrollEnd(ev.type === 'job_queued' && live);
  }
}

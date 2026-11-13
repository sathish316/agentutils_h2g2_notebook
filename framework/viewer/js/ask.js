// Sticky-note composer: the reader's side of the two-way channel with the ACP agent.
import { h, icon } from './util.js';
import { api } from './api.js';

const PLACEHOLDERS = {
  'new-chapter': 'What should the next chapter teach?',
  'add-topic': 'What should be added to this chapter?',
  'edit-chapter': 'What should change on this page?',
  answer: 'Ask a question — the agent replies without editing',
  framework: 'Describe a new primitive or viewer change…',
};

export const agentPref = {
  get: (nb, fallback) => localStorage.getItem(`h2g2:agent:${nb}`) || fallback,
  set: (nb, id) => localStorage.setItem(`h2g2:agent:${nb}`, id),
};

// Auto-approve permission requests for this notebook (default on). Shared by every composer and the drawer chat.
export const autoApprovePref = {
  get: (nb) => localStorage.getItem(`h2g2:auto:${nb}`) !== 'off',
  set(nb, on) {
    localStorage.setItem(`h2g2:auto:${nb}`, on ? 'on' : 'off');
    window.dispatchEvent(new CustomEvent('h2g2:auto', { detail: { nb, on } }));
    return api.autoApprove(nb, on).catch(() => {});
  },
};

/** Checkbox kept in sync across every composer on the page. */
export function autoApproveToggle(notebook) {
  const cb = h('input', { type: 'checkbox', checked: autoApprovePref.get(notebook) });
  cb.addEventListener('change', () => autoApprovePref.set(notebook, cb.checked));
  window.addEventListener('h2g2:auto', (e) => { if (e.detail.nb === notebook) cb.checked = e.detail.on; });
  return h('label', { class: 'auto-approve', title: 'Auto-approve the agent’s permission requests (file edits, commands) while it writes. Uncheck to be asked each time.' }, cb, 'Auto-approve');
}

/**
 * opts: { notebook, chapter?, topic?, modes, agents, defaultAgent, mode?, allowedModes?, message?, title?, floating?, onSent(jobId), onClose() }
 */
export function createComposer(opts) {
  const { notebook, chapter, topic, modes } = opts;
  const allowed = Object.entries(modes).filter(([id, m]) => !m.hidden && (chapter || !m.needsChapter) && (!opts.allowedModes || opts.allowedModes.includes(id)));
  let mode = opts.mode && modes[opts.mode] ? opts.mode : allowed[0][0];

  const text = h('textarea', { placeholder: PLACEHOLDERS[mode], rows: 2 });
  if (opts.message) text.value = opts.message;
  const modeBtns = allowed.map(([id, m]) => {
    const b = h('button', { class: `mode${id === mode ? ' on' : ''}`, type: 'button' }, m.label);
    b.addEventListener('click', () => {
      mode = id;
      modeBtns.forEach((x) => x.classList.toggle('on', x === b));
      text.placeholder = PLACEHOLDERS[id];
      text.focus();
    });
    return b;
  });

  const agentSel = h('select', { title: 'Agent' });
  const current = agentPref.get(notebook, opts.defaultAgent);
  for (const a of opts.agents) {
    agentSel.append(h('option', { value: a.id, selected: a.id === current }, `${a.name}${a.available ? '' : ' (not found)'}`));
  }
  agentSel.addEventListener('change', () => agentPref.set(notebook, agentSel.value));

  const send = h('button', { class: 'send', type: 'submit' }, 'Send →');
  const ctx = topic ? `about “${topic.title}”` : chapter ? `on “${chapter.title}”` : '';
  const form = h('form', { class: `sticky${opts.floating ? ' floating' : ''}` },
    h('h4', {}, opts.title || (topic ? 'Ask about this topic' : chapter ? 'Ask for more' : 'Start here')),
    h('div', { class: 'modes' }, modeBtns),
    text,
    h('div', { class: 'row' },
      h('span', { class: 'ctx' }, ctx),
      h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, autoApproveToggle(notebook), agentSel, send)));
  if (opts.floating) {
    form.append(h('button', { class: 'close', type: 'button', title: 'Close', onclick: () => opts.onClose?.(), html: icon('close', 16) }));
  }

  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === 'Escape' && opts.floating) opts.onClose?.();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = text.value.trim();
    if (!message) return text.focus();
    send.disabled = true;
    try {
      const { jobId } = await api.ask(notebook, { agentId: agentSel.value, autoApprove: autoApprovePref.get(notebook), mode, chapterId: chapter?.id, topicId: topic?.id, message });
      text.value = '';
      send.textContent = 'Sent ✓';
      setTimeout(() => { send.textContent = 'Send →'; }, 1800);
      opts.onSent?.(jobId);
    } catch (err) {
      send.textContent = 'Failed';
      text.setCustomValidity(err.message);
      text.reportValidity();
      setTimeout(() => { text.setCustomValidity(''); send.textContent = 'Send →'; }, 3000);
    } finally {
      send.disabled = false;
    }
  });
  return { el: form, focus: () => text.focus() };
}

/** Floating sticky note anchored near an element (topic "ask" buttons). */
export function openFloatingComposer(anchor, opts) {
  document.querySelector('.sticky.floating')?.remove();
  let composer;
  const close = () => { composer.el.remove(); document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!composer.el.contains(e.target)) close(); };
  composer = createComposer({ ...opts, floating: true, onClose: close, onSent: (id) => { opts.onSent?.(id); close(); } });
  document.body.append(composer.el);
  const r = anchor.getBoundingClientRect();
  const w = composer.el.offsetWidth, hgt = composer.el.offsetHeight;
  composer.el.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.left))}px`;
  composer.el.style.top = `${Math.max(70, Math.min(innerHeight - hgt - 12, r.bottom + 8))}px`;
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  composer.focus();
  return composer;
}

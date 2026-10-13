// Library: notebooks as covers on a shelf, plus "new notebook".
import { api } from './api.js';
import { h, icon, colorsFor, toast } from './util.js';
import { storedProgress } from './progress.js';

function fraction(nb) {
  const p = storedProgress(nb.name);
  if (!p || !nb.chapterCount) return 0;
  return Math.min(1, (p.chapters?.length || 0) / nb.chapterCount);
}

function cover(nb) {
  if (!nb.initialized) {
    return h('div', {},
      h('a', { class: 'cover blank', href: '#', onclick: (e) => { e.preventDefault(); newNotebook(nb.name); } },
        h('div', { class: 'label', style: { background: 'transparent', boxShadow: 'none', padding: 0 } }, h('div', { class: 't' }, nb.name)),
        h('div', { class: 'plus' }, '+ Start this notebook')),
      h('div', { class: 'under' }, 'empty folder'));
  }
  const [c1, c2] = colorsFor(nb.name);
  const fr = fraction(nb);
  return h('div', {},
    h('a', { class: 'cover', href: `/notebooks/${encodeURIComponent(nb.name)}/`, style: { '--c1': c1, '--c2': c2 } },
      h('span', { class: 'band' }),
      h('div', { class: 'label' }, h('div', { class: 't' }, nb.title), nb.description ? h('div', { class: 'd' }, nb.description) : null),
      h('div', { class: 'foot' },
        h('span', {}, `${nb.chapterCount} chapter${nb.chapterCount === 1 ? '' : 's'}`),
        h('span', {}, nb.scope === 'org' ? 'org' : 'general')),
      h('div', { class: 'prog' }, h('i', { style: { width: `${fr * 100}%` } }))),
    h('div', { class: 'under' }, `${Math.round(fr * 100)}% read`));
}

async function newNotebook(name = '') {
  const [{ agents }, settings] = await Promise.all([api.agents(), api.settings()]);
  const err = h('div', { class: 'err-text' });
  const f = (label, input) => h('label', { class: 'field' }, label, input);
  const nameIn = h('input', { name: 'name', required: true, pattern: '[A-Za-z0-9][A-Za-z0-9._-]*', value: name, placeholder: 'kafka' });
  const titleIn = h('input', { name: 'title', required: true, placeholder: 'Apache Kafka' });
  const descIn = h('input', { name: 'description', placeholder: 'One line about what this guide covers' });
  const scopeIn = h('select', { name: 'scope' }, h('option', { value: 'general' }, 'General — research the internet'), h('option', { value: 'org' }, 'Org-specific — Confluence + Teamwork Graph'));
  const msgIn = h('textarea', { name: 'message', placeholder: 'What do you want to learn first? e.g. "How does Kafka guarantee ordering, and how do consumer groups work?"' });
  const agentIn = h('select', { name: 'agentId' }, agents.map((a) => h('option', { value: a.id, selected: a.id === settings.defaultAgent }, `${a.name}${a.available ? '' : ' (not found)'}`)));
  const form = h('form', { class: 'dlg', method: 'dialog' },
    h('h2', {}, 'New notebook'),
    f('Folder name', nameIn), f('Title', titleIn), f('Description', descIn), f('Scope', scopeIn),
    f('First question (the agent writes chapter 1 from it — optional)', msgIn), f('Agent', agentIn),
    err,
    h('div', { class: 'actions' },
      h('button', { class: 'pill', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
      h('button', { class: 'pill primary', type: 'submit' }, 'Create')));
  const dlg = h('dialog', {}, form);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(form));
      await api.createNotebook(body);
      if (body.message) localStorage.setItem(`h2g2:agent:${body.name}`, body.agentId);
      location.href = `/notebooks/${encodeURIComponent(body.name)}/`;
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
  dlg.showModal();
  (name ? titleIn : nameIn).focus();
}

async function boot() {
  const bar = h('header', { class: 'toolbar' },
    h('span', { class: 'title' }, '📓 H2G2'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'tbtn', onclick: () => newNotebook(), html: `${icon('plus')}<span>New notebook</span>` }),
    h('a', { class: 'tbtn', href: '/settings', title: 'Settings', html: icon('gear') }));
  const shelf = h('div', { class: 'shelf' });
  document.body.append(bar, h('main', { class: 'library' },
    h('h1', {}, 'Library'),
    h('p', { class: 'sub' }, 'The Hitchhiker’s Guide to the Galaxy — living notebooks your agents write with you.'),
    shelf));
  try {
    const list = await api.notebooks();
    shelf.replaceChildren(...list.map(cover),
      h('div', {}, h('a', { class: 'cover blank', href: '#', onclick: (e) => { e.preventDefault(); newNotebook(); } }, h('div', { class: 'plus' }, '+ New notebook')), h('div', { class: 'under' }, '')));
  } catch (err) {
    toast(err.message);
  }
}
boot();

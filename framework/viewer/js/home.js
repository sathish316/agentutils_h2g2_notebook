// Library: notebooks as covers on a shelf, plus "new notebook".
import { api } from './api.js';
import { h, icon, colorsFor, toast } from './util.js';
import { storedProgress } from './progress.js';

function fraction(nb) {
  const p = storedProgress(nb.name);
  if (!p || !nb.chapterCount) return 0;
  return Math.min(1, (p.chapters?.length || 0) / nb.chapterCount);
}

let notebooks = [];
let places = { repos: {}, notices: [] };
const PLACE_LABEL = { local: 'Local', saved: 'Saved', shared: 'Shared' };
const syncing = new Set();
// Tag filter: a notebook matches when it has ANY selected tag; no selection shows everything.
const FILTER_KEY = 'h2g2:tagFilter';
const selected = new Set((() => { try { return JSON.parse(localStorage.getItem(FILTER_KEY) || '[]'); } catch { return []; } })());
const saveFilter = () => localStorage.setItem(FILTER_KEY, JSON.stringify([...selected]));
function toggleFilter(tag) {
  if (selected.has(tag)) selected.delete(tag); else selected.add(tag);
  saveFilter();
  render();
}
const normalizeTag = (t) => {
  const s = String(t ?? '').trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+/, '').slice(0, 32);
  return /^[a-z0-9][a-z0-9._-]{0,31}$/.test(s) ? s : '';
};
function tagCounts() {
  const m = new Map();
  for (const n of notebooks) for (const t of n.tags || []) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

const view = () => (location.hash === '#archived' ? 'archived' : 'active');

async function setArchived(nb, archived) {
  try {
    await api.archive(nb.name, archived);
    nb.archived = archived;
    render();
    toast(archived ? `Archived “${nb.title}”` : `Restored “${nb.title}”`, {
      action: 'Undo', onAction: () => setArchived(nb, !archived),
    });
  } catch (err) {
    toast(err.message);
  }
}

function archiveBtn(nb) {
  const on = !!nb.archived;
  return h('button', {
    class: 'cover-archive', type: 'button', title: on ? 'Unarchive (show in Notebooks)' : 'Archive (hide from Notebooks)',
    'aria-label': on ? `Unarchive ${nb.title}` : `Archive ${nb.title}`,
    html: icon(on ? 'unarchive' : 'archive', 16),
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); setArchived(nb, !on); },
  });
}

// Local is the default place, so only Saved and Shared covers get a badge.
const badge = (nb) => (!nb.place || nb.place === 'local' ? null
  : h('span', { class: `place-badge ${nb.place}`, title: `${PLACE_LABEL[nb.place]} notebook` }, PLACE_LABEL[nb.place]));

function gearBtn(nb) {
  return h('button', {
    class: 'cover-gear', type: 'button', title: 'Notebook settings (where it lives, sync)', 'aria-label': `Settings for ${nb.title}`,
    html: icon('gear', 16), onclick: (e) => { e.preventDefault(); e.stopPropagation(); placeDialog(nb); },
  });
}

function syncBtn(nb) {
  if (!nb.place || nb.place === 'local') return null;
  const busy = syncing.has(nb.name);
  const state = busy ? 'busy' : nb.dirty ? 'dirty' : 'clean';
  return h('button', {
    class: `cover-sync ${state}`, type: 'button', disabled: busy,
    title: busy ? 'Syncing…' : nb.dirty ? `Sync: commit and push this notebook's changes to the ${nb.place} repo` : `Nothing to sync (${nb.place} repo is up to date)`,
    'aria-label': `Sync ${nb.title}`, html: icon('sync', 16),
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); syncNow(nb); },
  });
}

async function syncNow(nb) {
  if (syncing.has(nb.name)) return;
  syncing.add(nb.name);
  render();
  try {
    const r = await api.sync(nb.name);
    toast(r.status === 'nothing' ? `Nothing to sync for “${nb.title}”.` : `Committed and pushed “${nb.title}”${r.message ? `: ${r.message}` : ' (earlier commit)'}.`, { timeout: 7000 });
  } catch (err) {
    toast(err.message, { timeout: 15000 });
  } finally {
    syncing.delete(nb.name);
    await refresh();
  }
}

/** Gear dialog: shows where the notebook lives and moves it (Local / Saved / Shared); sync is here too. */
function placeDialog(nb) {
  const err = h('div', { class: 'err-text' });
  const current = nb.place || 'local';
  let choice = current;
  const rows = ['local', 'saved', 'shared'].map((p) => {
    const repo = places.repos?.[p];
    const reason = p === 'local' ? '' : !repo?.configured ? `No ${p} repo is set. Add its git URL in Settings.` : !repo.cloned ? `The ${p} repo's local clone is missing. Save its URL in Settings again.` : '';
    const input = h('input', { type: 'radio', name: 'place', value: p, checked: p === current, disabled: !!reason && p !== current, onchange: () => { choice = p; } });
    return h('label', { class: `place-opt${reason ? ' off' : ''}` }, input,
      h('span', { class: 'l' }, PLACE_LABEL[p], p === current ? h('em', {}, ' · now') : null),
      h('span', { class: 'why' }, reason || { local: 'notebooks/ on this machine, not tracked by git', saved: 'your saved repo (private or public)', shared: 'your shared repo, for notebooks others should read' }[p]));
  });
  const form = h('form', { class: 'dlg', method: 'dialog' },
    h('h2', {}, 'Notebook settings'),
    h('p', { class: 'sub' }, nb.title),
    h('div', { class: 'place-opts', role: 'radiogroup', 'aria-label': 'Where this notebook lives' }, rows),
    h('p', { class: 'hint' }, 'Changing the place moves the notebook’s folder. It stays one copy; moving back to Local moves it back.'),
    err,
    h('div', { class: 'actions' },
      current !== 'local' ? h('button', { class: 'pill', type: 'button', onclick: () => { dlg.close(); syncNow(nb); } }, h('span', { html: icon('sync', 14) }), 'Sync now') : null,
      h('button', { class: 'pill', type: 'button', onclick: () => dlg.close() }, 'Close'),
      h('button', { class: 'pill primary', type: 'submit' }, 'Move')));
  const dlg = h('dialog', {}, form);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (choice === current) { dlg.close(); return; }
    try {
      await api.setPlace(nb.name, choice);
      dlg.close();
      toast(`Moved “${nb.title}” to ${PLACE_LABEL[choice]}.`);
      await refresh();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
  dlg.showModal();
}

function cover(nb) {
  if (!nb.initialized) {
    return h('div', { class: 'cover-wrap' },
      badge(nb), syncBtn(nb), gearBtn(nb), archiveBtn(nb),
      h('a', { class: 'cover blank', href: '#', onclick: (e) => { e.preventDefault(); newNotebook(nb.name); } },
        h('div', { class: 'label', style: { background: 'transparent', boxShadow: 'none', padding: 0 } }, h('div', { class: 't' }, nb.name)),
        h('div', { class: 'plus' }, '+ Start this notebook')),
      h('div', { class: 'under' }, 'empty folder'),
      tagRow(nb));
  }
  const [c1, c2] = colorsFor(nb.name);
  const fr = fraction(nb);
  return h('div', { class: 'cover-wrap' },
    badge(nb), syncBtn(nb), gearBtn(nb), archiveBtn(nb),
    h('a', { class: 'cover', href: `/notebooks/${encodeURIComponent(nb.name)}/`, style: { '--c1': c1, '--c2': c2 } },
      h('span', { class: 'band' }),
      h('div', { class: 'label' }, h('div', { class: 't' }, nb.title), nb.description ? h('div', { class: 'd' }, nb.description) : null),
      h('div', { class: 'foot' },
        h('span', {}, `${nb.chapterCount} chapter${nb.chapterCount === 1 ? '' : 's'}`),
        h('span', {}, nb.scope === 'org' ? 'org' : 'general')),
      h('div', { class: 'prog' }, h('i', { style: { width: `${fr * 100}%` } }))),
    h('div', { class: 'under' }, `${Math.round(fr * 100)}% read`),
    tagRow(nb));
}

function tagRow(nb) {
  return h('div', { class: 'cover-tags' },
    (nb.tags || []).map((t) => h('button', {
      class: `tag${selected.has(t) ? ' on' : ''}`, type: 'button', title: selected.has(t) ? `Stop filtering by #${t}` : `Show notebooks tagged #${t}`,
      onclick: () => toggleFilter(t),
    }, `#${t}`)),
    h('button', { class: 'tag add', type: 'button', title: 'Add or remove tags', 'aria-label': `Edit tags for ${nb.title}`, onclick: () => tagDialog(nb), html: icon('plus', 14) }));
}

/** Modal: add a new tag, or search and pick from tags used by any notebook. Changes save immediately. */
function tagDialog(nb) {
  const input = h('input', { type: 'text', placeholder: 'Search or create a tag…', autocomplete: 'off', spellcheck: false, 'aria-label': 'Tag' });
  const current = h('div', { class: 'tag-current' });
  const list = h('div', { class: 'tag-options', role: 'listbox' });
  const err = h('div', { class: 'err-text' });
  let active = 0;

  async function save(next) {
    try {
      const { tags } = await api.setTags(nb.name, next);
      nb.tags = tags;
      err.textContent = '';
      draw();
      render();
    } catch (ex) {
      err.textContent = ex.message;
    }
  }
  const toggle = (t) => save(nb.tags.includes(t) ? nb.tags.filter((x) => x !== t) : [...nb.tags, t]);

  function options() {
    const q = normalizeTag(input.value);
    const counts = tagCounts();
    const known = [...counts.keys()].sort();
    const matches = known.filter((t) => !q || t.includes(q));
    const opts = matches.map((t) => ({ tag: t, label: `#${t}`, count: counts.get(t), on: nb.tags.includes(t) }));
    if (q && !counts.has(q)) opts.unshift({ tag: q, label: `Create #${q}`, create: true });
    return opts;
  }

  function draw() {
    current.replaceChildren(...(nb.tags.length ? nb.tags.map((t) => h('span', { class: 'tag on' }, `#${t}`,
      h('button', { type: 'button', class: 'x', title: `Remove #${t}`, 'aria-label': `Remove ${t}`, onclick: () => toggle(t), html: icon('close', 12) })))
      : [h('span', { class: 'none' }, 'No tags yet.')]));
    const opts = options();
    active = Math.min(active, Math.max(0, opts.length - 1));
    list.replaceChildren(...(opts.length ? opts.map((o, i) => h('button', {
      type: 'button', role: 'option', 'aria-selected': String(i === active),
      class: `tag-opt${o.on ? ' on' : ''}${o.create ? ' create' : ''}${i === active ? ' active' : ''}`,
      onclick: () => { toggle(o.tag); if (o.create) input.value = ''; input.focus(); },
    }, h('span', { class: 'check' }, o.create ? '+' : o.on ? '✓' : ''), h('span', { class: 'l' }, o.label), o.count ? h('span', { class: 'n' }, String(o.count)) : null))
      : [h('div', { class: 'none' }, input.value.trim() ? 'Tags use letters, digits, - . _' : 'Type to create your first tag.')]));
  }

  input.addEventListener('input', () => { active = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    const opts = options();
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, opts.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const o = opts[active];
      if (o) { toggle(o.tag); input.value = ''; active = 0; }
    } else if (e.key === 'Backspace' && !input.value && nb.tags.length) toggle(nb.tags.at(-1));
  });

  const form = h('form', { class: 'dlg tag-dlg', method: 'dialog' },
    h('h2', {}, 'Tags'),
    h('p', { class: 'sub' }, nb.title),
    current, input, list, err,
    h('div', { class: 'actions' }, h('button', { class: 'pill primary', type: 'submit' }, 'Done')));
  const dlg = h('dialog', {}, form);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  draw();
  dlg.showModal();
  input.focus();
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

async function refresh() {
  try {
    [notebooks, places] = await Promise.all([api.notebooks(), api.places()]);
    render();
  } catch (err) {
    toast(err.message);
  }
}

function render() {
  $notices.replaceChildren(...(places.notices || []).map((n) => h('div', { class: 'place-notice', role: 'alert' }, n.message)));
  const archived = notebooks.filter((n) => n.archived);
  const active = notebooks.filter((n) => !n.archived);
  const v = view() === 'archived' && archived.length ? 'archived' : 'active';
  const tab = (id, label, count) => h('a', { class: `lib-tab${v === id ? ' on' : ''}`, href: id === 'archived' ? '#archived' : '#' }, label, h('span', { class: 'n' }, String(count)));
  $tabs.replaceChildren(tab('active', 'Notebooks', active.length), archived.length ? tab('archived', 'Archived', archived.length) : '');
  const inView = v === 'archived' ? archived : active;
  renderFilter(inView);
  const shown = selected.size ? inView.filter((n) => (n.tags || []).some((t) => selected.has(t))) : inView;
  const empty = selected.size && !shown.length
    ? [h('p', { class: 'shelf-empty' }, `No ${v === 'archived' ? 'archived ' : ''}notebooks tagged ${[...selected].map((t) => `#${t}`).join(' or ')}.`)]
    : [];
  if (v === 'archived') {
    $shelf.replaceChildren(...shown.map(cover), ...empty);
    return;
  }
  $shelf.replaceChildren(...shown.map(cover), ...empty,
    h('div', {}, h('a', { class: 'cover blank', href: '#', onclick: (e) => { e.preventDefault(); newNotebook(); } }, h('div', { class: 'plus' }, '+ New notebook')), h('div', { class: 'under' }, '')));
}

function renderFilter(inView) {
  const counts = new Map();
  for (const n of inView) for (const t of n.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  for (const t of selected) if (!counts.has(t)) counts.set(t, 0); // keep selected chips visible so they can be cleared
  if (!counts.size) { $filter.replaceChildren(); $filter.hidden = true; return; }
  $filter.hidden = false;
  $filter.replaceChildren(
    h('span', { class: 'lbl' }, 'Tags'),
    ...[...counts.keys()].sort().map((t) => h('button', {
      type: 'button', class: `tag${selected.has(t) ? ' on' : ''}`, 'aria-pressed': String(selected.has(t)), onclick: () => toggleFilter(t),
    }, `#${t}`, h('span', { class: 'n' }, String(counts.get(t))))),
    selected.size ? h('button', { type: 'button', class: 'tag clear', onclick: () => { selected.clear(); saveFilter(); render(); } }, 'Clear') : null,
    h('span', { class: 'hint' }, selected.size ? 'showing notebooks with any selected tag' : 'all notebooks'));
}

const $notices = h('div', { class: 'place-notices' });
const $tabs = h('nav', { class: 'lib-tabs', 'aria-label': 'Library view' });
const $filter = h('div', { class: 'tag-filter', role: 'group', 'aria-label': 'Filter by tag' });
const $shelf = h('div', { class: 'shelf' });

async function boot() {
  const bar = h('header', { class: 'toolbar' },
    h('span', { class: 'title' }, '📓 H2G2'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'tbtn', onclick: () => newNotebook(), html: `${icon('plus')}<span>New notebook</span>` }),
    h('a', { class: 'tbtn', href: '/settings', title: 'Settings', html: icon('gear') }));
  document.body.append(bar, h('main', { class: 'library' },
    h('h1', {}, 'Library'),
    h('p', { class: 'sub' }, 'The Hitchhiker’s Guide to the Galaxy — living notebooks your agents write with you.'),
    $notices, $tabs, $filter, $shelf));
  window.addEventListener('hashchange', render);
  await refresh();
  // Sync state follows edits made elsewhere (agents, CLI): refresh when the tab regains focus and every 20 s while visible.
  window.addEventListener('focus', refresh);
  setInterval(() => { if (!document.hidden && notebooks.some((n) => n.place && n.place !== 'local')) refresh(); }, 20_000);
}
boot();

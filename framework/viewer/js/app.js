// Notebook viewer: outline, paper pages with page-turns, topic progress, sticky-note asks, live refresh.
import { api } from './api.js';
import { h, $, $$, icon, toast, prefs, isDark, applyTheme, TAB_COLORS } from './util.js';
import { Progress } from './progress.js';
import { renderMarkdown } from './render/markdown.js';
import { hydrate } from './primitives/index.js';
import { slugify } from './shared/slug.js';
import { turn, onSwipe } from './pageflip.js';
import { createComposer, openFloatingComposer } from './ask.js';
import { Activity } from './activity.js';

const NAME = decodeURIComponent(location.pathname.split('/')[2] || '');
const BASE = new URL(`/notebooks/${encodeURIComponent(NAME)}/`, location.origin);
const PAPERS = ['dotted', 'grid', 'lined', 'plain'];

const S = {
  nb: null, pages: [], index: -1, sheet: null, agents: [], modes: {}, defaultAgent: 'rovo',
  progress: new Progress(NAME), activity: null, pageState: {}, newIds: new Set(JSON.parse(sessionStorage.getItem(`h2g2:new:${NAME}`) || '[]')),
};
const flat = (chapters, depth = 0, out = []) => {
  for (const c of chapters || []) { out.push({ ...c, depth }); flat(c.children, depth + 1, out); }
  return out;
};
const sketch = () => localStorage.getItem('h2g2:sketch') !== 'off';

// ---------------------------------------------------------------- data
function buildPages() {
  const chapters = flat(S.nb.toc.chapters);
  S.chapters = chapters;
  S.written = chapters.filter((c) => c.status !== 'planned');
  S.pages = [{ type: 'contents', id: '' }, ...chapters.map((c, i) => ({ type: 'chapter', id: c.id, chapter: c, n: i + 1 })), { type: 'references', id: 'references' }];
  S.files = new Map(chapters.map((c) => [c.file, c.id]));
  S.refIndex = new Map();
  let n = 0;
  for (const cat of S.nb.references.categories || []) for (const ref of cat.items || []) S.refIndex.set(ref.id, { n: ++n, ref, cat });
}

async function load() {
  S.nb = await api.notebook(NAME);
  document.title = `${S.nb.meta.title} · H2G2`;
  buildPages();
}

function ctx(chapter) {
  return {
    notebook: NAME, baseUrl: BASE, chapter, refIndex: S.refIndex, files: S.files,
    pageState: S.pageState, dark: isDark(), sketch: sketch(), navigate: (hash) => { location.hash = hash; },
  };
}

// ---------------------------------------------------------------- chrome
function toolbar() {
  const paperSeg = h('div', { class: 'seg', title: 'Paper' }, PAPERS.map((p) => h('button', {
    class: prefs.paper === p ? 'on' : '', onclick: (e) => {
      prefs.paper = p;
      $$('button', paperSeg).forEach((b) => b.classList.toggle('on', b === e.currentTarget));
      applyPaper();
    },
  }, p)));
  const sketchBtn = h('button', { class: `tbtn${sketch() ? ' on' : ''}`, title: 'Hand-drawn diagrams', html: `${icon('pen')}<span>sketch</span>` });
  sketchBtn.onclick = () => {
    localStorage.setItem('h2g2:sketch', sketch() ? 'off' : 'on');
    sketchBtn.classList.toggle('on', sketch());
    rerenderCurrent();
  };
  const themeBtn = h('button', { class: 'tbtn', title: 'Theme', html: icon(isDark() ? 'sun' : 'moon') });
  themeBtn.onclick = () => {
    prefs.theme = isDark() ? 'light' : 'dark';
    themeBtn.innerHTML = icon(isDark() ? 'sun' : 'moon');
    rerenderCurrent();
  };
  S.agentBtn = h('button', { class: 'tbtn', title: 'Agent activity', html: `${icon('agent')}<span>Agent</span>`, onclick: () => S.activity.toggle() });
  return h('header', { class: 'toolbar' },
    h('button', { class: 'tbtn', title: 'Outline', onclick: () => $('.workspace').classList.toggle('outline-closed'), html: icon('menu') }),
    h('a', { class: 'tbtn', href: '/', title: 'Library', html: icon('shelf') }),
    h('span', { class: 'title' }, S.nb.meta.title),
    h('span', { class: 'spacer' }),
    paperSeg, sketchBtn, themeBtn, S.agentBtn,
    h('a', { class: 'tbtn', href: '/settings', title: 'Settings', html: icon('gear') }));
}

function applyPaper() {
  const desk = $('.desk');
  PAPERS.forEach((p) => desk.classList.toggle(`paper-${p}`, prefs.paper === p));
}

function ring(fr) {
  const r = 6.5, c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 16 16"><circle cx="8" cy="8" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="2"/><circle cx="8" cy="8" r="${r}" fill="none" stroke="var(--ok)" stroke-width="2" stroke-dasharray="${c * fr} ${c}" transform="rotate(-90 8 8)" stroke-linecap="round"/></svg>`;
}

function renderOutline() {
  const el = $('.outline');
  const fr = S.progress.overall(S.written);
  const cur = S.pages[S.index];
  const item = (c, i) => {
    const page = S.pages.findIndex((p) => p.id === c.id);
    const planned = c.status === 'planned';
    const li = h('li', { class: `ol-item${cur?.id === c.id ? ' active' : ''}${planned ? ' planned' : ''}` },
      h('a', { class: 'ol-row', href: `#/${c.id}`, title: planned ? `Planned: ${c.summary || c.title}` : c.title },
        h('span', { class: 'ol-num' }, String(page)),
        h('span', { class: 'ol-title' }, c.title),
        S.newIds.has(c.id) ? h('span', { class: 'ol-new' }, 'new') : null,
        planned ? h('span', { class: 'tag-planned' }, 'planned') : h('span', { html: ring(S.progress.chapterFraction(c)) })));
    if (cur?.id === c.id && c.topics?.length) {
      li.append(h('ul', { class: 'ol-topics' }, c.topics.map((t) => {
        const cb = h('input', { type: 'checkbox', class: 'check', title: 'Mark as read' });
        cb.checked = S.progress.isTopicRead(c.id, t.id);
        cb.onchange = () => S.progress.setTopicRead(c, t.id, cb.checked);
        return h('li', {}, cb, h('a', { href: `#/${c.id}/${t.id}` }, t.title));
      })));
    }
    if (c.children?.length) li.append(h('ul', { class: 'ol-children' }, c.children.map((ch) => item(S.chapters.find((x) => x.id === ch.id)))));
    return li;
  };
  el.replaceChildren(
    h('h2', {}, S.nb.meta.title),
    h('div', { class: 'meta' }, `${S.written.length} of ${S.chapters.length} chapter${S.chapters.length === 1 ? '' : 's'} written · ${S.nb.meta.scope === 'org' ? 'org-specific' : 'general'} · ${Math.round(fr * 100)}% read`),
    h('div', { class: 'progress' }, h('i', { style: { width: `${fr * 100}%` } })),
    h('ul', { class: 'ol-list' },
      h('li', { class: `ol-item${cur?.type === 'contents' ? ' active' : ''}` }, h('a', { class: 'ol-row', href: '#/' }, h('span', { class: 'ol-num' }, '✦'), h('span', { class: 'ol-title' }, 'Contents'))),
      S.nb.toc.chapters.map((c) => item(S.chapters.find((x) => x.id === c.id))),
      h('li', { class: `ol-item${cur?.type === 'references' ? ' active' : ''}` }, h('a', { class: 'ol-row', href: '#/references' }, h('span', { class: 'ol-num' }, '§'), h('span', { class: 'ol-title' }, 'References')))));
}

function renderTabs() {
  const tabs = $('.tabs');
  const top = S.nb.toc.chapters.slice(0, 14);
  const cur = S.pages[S.index];
  const curTop = cur?.chapter ? topLevelOf(cur.chapter.id) : null;
  tabs.replaceChildren(
    h('button', { class: `tab${cur?.type === 'contents' ? ' active' : ''}`, style: { background: '#e8e2d4' }, title: 'Contents', onclick: () => { location.hash = '#/'; } }, '✦'),
    ...top.map((c, i) => h('button', {
      class: `tab${curTop === c.id ? ' active' : ''}${c.status === 'planned' ? ' planned' : ''}`, style: { background: TAB_COLORS[i % TAB_COLORS.length] }, title: c.title,
      onclick: () => { location.hash = `#/${c.id}`; },
    }, String(S.pages.findIndex((p) => p.id === c.id)))),
    h('button', { class: `tab${cur?.type === 'references' ? ' active' : ''}`, style: { background: '#d6dbe6' }, title: 'References', onclick: () => { location.hash = '#/references'; } }, '§'));
}

function topLevelOf(id) {
  const walk = (list, root) => {
    for (const c of list || []) {
      if (c.id === id) return root || c.id;
      const hit = walk(c.children, root || c.id);
      if (hit) return hit;
    }
    return null;
  };
  return walk(S.nb.toc.chapters, null);
}

function composer(extra) {
  return createComposer({ notebook: NAME, modes: S.modes, agents: S.agents, defaultAgent: S.defaultAgent, onSent: () => S.activity.open(), ...extra }).el;
}

// ---------------------------------------------------------------- pages
function sheetFor(content) {
  const page = h('div', { class: 'page' }, content);
  const scroll = h('div', { class: 'sheet-scroll' }, page);
  return { sheet: h('div', { class: 'sheet' }, scroll, h('div', { class: 'shade' })), scroll, page };
}

function pageFooter(i) {
  const prev = S.pages[i - 1], next = S.pages[i + 1];
  const label = (p) => (p.type === 'contents' ? 'Contents' : p.type === 'references' ? 'References' : p.chapter.title);
  return h('div', { class: 'nav' },
    prev ? h('a', { class: 'pill', href: `#/${prev.id}`, html: `${icon('back', 14)} ${escapeText(label(prev))}` }) : null,
    next ? h('a', { class: 'pill primary', href: `#/${next.id}`, html: `${escapeText(label(next))} ${icon('next', 14)}` }) : null);
}
const escapeText = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function contentsPage() {
  const { meta } = S.nb;
  const fr = S.progress.overall(S.written);
  const list = (chapters) => h('ul', { class: 'contents' }, chapters.map((c) => {
    const n = S.pages.findIndex((p) => p.id === c.id);
    const planned = c.status === 'planned';
    return h('li', { class: planned ? 'planned' : '' },
      h('a', { class: 'row', href: `#/${c.id}` },
        h('span', { class: 'n' }, String(n)),
        h('span', { class: 't' }, c.title, c.summary ? h('span', { class: 's' }, c.summary) : null),
        planned ? h('span', { class: 'tag-planned' }, 'planned') : h('span', { html: ring(S.progress.chapterFraction(S.chapters.find((x) => x.id === c.id))) })),
      c.children?.length ? list(c.children) : null);
  }));
  const content = h('div', {},
    h('div', { class: 'page-head' }, h('span', { class: 'page-kicker' }, 'The Hitchhiker’s Guide to')),
    h('h1', { class: 'cover-title' }, meta.title),
    meta.description ? h('p', { class: 'cover-desc' }, meta.description) : null,
    h('span', { class: `scope ${meta.scope}` }, meta.scope === 'org' ? 'org-specific' : 'general'),
    S.chapters.length ? h('div', { class: 'progress', style: { maxWidth: '320px', marginTop: '18px' } }, h('i', { style: { width: `${fr * 100}%` } })) : null,
    S.chapters.length && S.written.length < S.chapters.length
      ? h('p', { class: 'plan-note' }, 'Greyed-out chapters are the planned learning path. They’re written one at a time when you ask, and the plan adapts to your questions.')
      : null,
    S.chapters.length ? list(S.nb.toc.chapters) : h('div', { class: 'empty-page' },
      h('div', { class: 'big' }, 'Fresh notebook. Don’t panic.'),
      h('p', { style: { color: 'var(--ink-soft)' } }, 'Tell the agent what you want to learn and it will write the first chapter.')),
    composer({ mode: 'new-chapter', title: S.chapters.length ? 'What next?' : 'What do you want to learn?' }));
  return content;
}

function referencesPage() {
  const cats = S.nb.references.categories || [];
  const titleOf = (id) => S.chapters.find((c) => c.id === id)?.title || id;
  return h('div', {},
    h('div', { class: 'page-head' }, h('span', { class: 'page-kicker' }, 'sources')),
    h('h1', { class: 'cover-title', style: { fontSize: '44px' } }, 'References'),
    cats.length ? null : h('p', { style: { color: 'var(--ink-soft)' } }, 'No references yet.'),
    cats.map((cat) => h('section', { class: 'refs-cat' },
      h('h2', {}, cat.title),
      h('ol', {}, (cat.items || []).map((r) => h('li', { id: `ref-${r.id}` },
        h('span', { class: 'rn' }, `${S.refIndex.get(r.id)?.n}.`),
        h('span', {},
          r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.title) : h('strong', {}, r.title),
          h('span', { class: 'src' }, r.source || ''),
          r.note ? h('span', { class: 'note' }, r.note) : null,
          r.chapters?.length ? h('span', { class: 'used' }, 'Used in: ', r.chapters.flatMap((id, i) => [i ? ', ' : '', h('a', { href: `#/${id}` }, titleOf(id))])) : null)))))));
}

async function renderChapterBody(md, chapter, mdEl) {
  // Dispose per-page runtime state (JS realms) before re-render.
  S.pageState.jsFrame?.remove();
  S.pageState = {};
  mdEl.innerHTML = renderMarkdown(md);
  decorateTopics(mdEl, chapter);
  await hydrate(mdEl, ctx(chapter));
}

function decorateTopics(mdEl, chapter) {
  const h2s = $$(':scope > h2', mdEl);
  h2s.forEach((el, i) => {
    const t = chapter.topics?.[i] || { id: slugify(el.textContent), title: el.textContent };
    el.id = t.id;
    const cb = h('input', { type: 'checkbox', class: 'check', title: 'Mark topic as read' });
    cb.checked = S.progress.isTopicRead(chapter.id, t.id);
    el.classList.toggle('is-read', cb.checked);
    cb.onchange = () => S.progress.setTopicRead(chapter, t.id, cb.checked);
    const ask = h('button', { class: 'topic-ask', title: 'Ask about this topic', html: icon('pen', 16) });
    ask.onclick = () => openFloatingComposer(ask, { notebook: NAME, chapter, topic: t, modes: S.modes, agents: S.agents, defaultAgent: S.defaultAgent, mode: 'add-topic', onSent: () => S.activity.open() });
    el.prepend(h('span', { class: 'topic-ctl' }, cb, ask));
  });
}

function plannedPage(page, i) {
  const { chapter } = page;
  const prevWritten = S.pages.slice(0, i).reverse().find((p) => p.type === 'chapter' && p.chapter.status !== 'planned');
  return h('div', { class: 'planned-page' },
    h('div', { class: 'page-head' }, h('span', { class: 'page-num' }, `${page.n}.`), h('span', { class: 'page-kicker' }, 'planned chapter')),
    h('div', { class: 'md' }, h('h1', {}, chapter.title)),
    chapter.summary ? h('p', { class: 'cover-desc' }, chapter.summary) : null,
    h('p', { class: 'plan-note' }, 'This page is part of the learning plan but hasn’t been written yet. Ask for it below. You can also steer it: tell the agent what you want it to focus on.'),
    h('div', { class: 'page-foot' }, h('span'), h('span', { class: 'pager' }, `page ${i} of ${S.pages.length - 1}`), pageFooter(i)),
    composer({
      chapter, mode: 'new-chapter', allowedModes: ['new-chapter', 'answer'], title: 'Write this chapter',
      message: `Write the planned chapter "${chapter.title}".${prevWritten ? '' : ''}`,
    }));
}

async function chapterPage(page, i) {
  const { chapter } = page;
  if (chapter.status === 'planned') return plannedPage(page, i);
  const mdEl = h('div', { class: 'md' });
  const readCb = h('input', { type: 'checkbox', class: 'check' });
  readCb.checked = S.progress.isChapterRead(chapter);
  readCb.onchange = () => S.progress.setChapterRead(chapter, readCb.checked);
  const content = h('div', {},
    h('div', { class: 'page-head' }, h('span', { class: 'page-num' }, `${page.n}.`), h('span', { class: 'page-kicker' }, S.nb.meta.title)),
    mdEl,
    h('div', { class: 'page-foot' },
      h('label', { class: 'mark-read' }, readCb, 'I’ve read this page'),
      h('span', { class: 'pager' }, `page ${i} of ${S.pages.length - 1}`),
      pageFooter(i)),
    composer({ chapter, mode: 'new-chapter' }));
  content.dataset.chapter = chapter.id;
  const md = await fetch(new URL(`${chapter.file}?t=${Date.now()}`, BASE)).then((r) => (r.ok ? r.text() : `# ${chapter.title}\n\n> [!WARNING]\n> Chapter file \`${chapter.file}\` is missing.`));
  await renderChapterBody(md, chapter, mdEl);
  return content;
}

async function buildPage(i) {
  const page = S.pages[i];
  let content;
  if (page.type === 'contents') content = contentsPage();
  else if (page.type === 'references') content = referencesPage();
  else content = await chapterPage(page, i);
  if (page.type !== 'chapter') content.append(h('div', { class: 'page-foot' }, h('span'), h('span', { class: 'pager' }, page.type === 'contents' ? '' : `page ${i} of ${S.pages.length - 1}`), pageFooter(i)));
  const s = sheetFor(content);
  if (S.pages[i + 1]) s.page.append(h('div', { class: 'dogear', title: 'Turn the page', onclick: () => go(i + 1) }));
  return s;
}

// ---------------------------------------------------------------- navigation
function parseHash() {
  const [id = '', sub = ''] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const idx = Math.max(0, S.pages.findIndex((p) => p.id === id));
  return { idx, sub };
}

function go(i) {
  const p = S.pages[i];
  if (p) location.hash = `#/${p.id}`;
}

let navToken = 0;
async function route() {
  const { idx, sub } = parseHash();
  const token = ++navToken;
  if (idx !== S.index || !S.sheet) {
    const dir = S.index < 0 ? 0 : Math.sign(idx - S.index);
    const built = await buildPage(idx);
    if (token !== navToken) return;
    const old = S.sheet;
    S.index = idx;
    S.sheet = built.sheet;
    S.scroll = built.scroll;
    renderOutline();
    renderTabs();
    await turn($('.stage'), old, built.sheet, dir);
  }
  if (sub) {
    const target = S.pages[idx].type === 'references' ? $(`#ref-${CSS.escape(sub)}`, S.sheet) : $(`#${CSS.escape(sub)}`, S.sheet);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1600);
    }
  } else if (S.scroll) {
    S.scroll.scrollTop = 0;
  }
}

async function rerenderCurrent() {
  const page = S.pages[S.index];
  if (!page) return;
  const top = S.scroll?.scrollTop || 0;
  if (page.type === 'chapter') {
    const mdEl = $('.md', S.sheet);
    const md = await fetch(new URL(`${page.chapter.file}?t=${Date.now()}`, BASE)).then((r) => r.text());
    await renderChapterBody(md, page.chapter, mdEl);
    S.scroll.scrollTop = top;
  } else {
    const built = await buildPage(S.index);
    S.sheet.replaceWith(built.sheet);
    S.sheet = built.sheet;
    S.scroll = built.scroll;
    S.scroll.scrollTop = top;
  }
}

// ---------------------------------------------------------------- live updates
async function onNotebookChanged(files) {
  const beforeIds = new Set(S.chapters.map((c) => c.id));
  const cur = S.pages[S.index];
  try { await load(); } catch (err) { return toast(`Reload failed: ${err.message}`); }
  const added = S.chapters.filter((c) => !beforeIds.has(c.id));
  for (const c of added) S.newIds.add(c.id);
  sessionStorage.setItem(`h2g2:new:${NAME}`, JSON.stringify([...S.newIds]));
  S.index = Math.max(0, S.pages.findIndex((p) => p.id === cur?.id));
  if (cur && !S.pages.some((p) => p.id === cur.id)) { S.index = -1; location.hash = '#/'; route(); return; }
  const page = S.pages[S.index];
  const touched = page.type !== 'chapter' || files.some((f) => f === page.chapter.file || f.endsWith('.json') || f.startsWith('assets/'));
  if (touched) await rerenderCurrent();
  renderOutline();
  renderTabs();
  for (const c of added) toast(`New chapter: ${c.title}`, { action: 'Open', onAction: () => { location.hash = `#/${c.id}`; }, timeout: 9000 });
  if (!added.length && touched && page.type === 'chapter') toast('Page updated');
}

// ---------------------------------------------------------------- boot
async function boot() {
  if (!NAME) { location.href = '/'; return; }
  try {
    const [, agents, modes, settings] = await Promise.all([load(), api.agents(), api.modes(), api.settings()]);
    S.agents = agents.agents;
    S.modes = modes;
    S.defaultAgent = settings.defaultAgent;
  } catch (err) {
    document.body.replaceChildren(h('div', { class: 'library' }, h('h1', {}, 'Notebook not found'), h('p', { class: 'sub' }, err.message), h('a', { href: '/' }, '← Library')));
    return;
  }
  const desk = h('main', { class: 'desk' }, h('div', { class: 'stage' }, h('div', { class: 'tabs' })));
  const ws = h('div', { class: `workspace${innerWidth < 1200 ? ' outline-closed' : ''}` }, h('nav', { class: 'outline' }), desk);
  document.body.append(toolbar(), ws);
  applyPaper();

  S.activity = new Activity({
    notebook: NAME, agents: S.agents, modes: S.modes,
    onNotebookChanged,
    onFrameworkChanged: () => toast('The framework was updated', { action: 'Reload', onAction: () => location.reload(), timeout: 0 }),
    onBusy: (busy) => {
      S.agentBtn.classList.toggle('on', busy);
      S.agentBtn.innerHTML = `${busy ? '<span class="spinner"></span>' : icon('agent')}<span>Agent</span>`;
    },
  });
  S.progress.addEventListener('change', () => {
    renderOutline();
    const page = S.pages[S.index];
    if (page?.type === 'chapter') {
      for (const el of $$('.md > h2', S.sheet)) {
        const read = S.progress.isTopicRead(page.chapter.id, el.id);
        el.classList.toggle('is-read', read);
        const cb = $('.check', el);
        if (cb) cb.checked = read;
      }
      const all = $('.mark-read .check', S.sheet);
      if (all) all.checked = S.progress.isChapterRead(page.chapter);
    }
  });

  // Wheel over the desk scrolls the page; arrows and swipes turn pages.
  desk.addEventListener('wheel', (e) => {
    if (!S.scroll || S.sheet.contains(e.target) || e.ctrlKey) return;
    S.scroll.scrollBy({ top: e.deltaY });
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') go(S.index + 1);
    if (e.key === 'ArrowLeft') go(S.index - 1);
    if (e.key === '[') $('.workspace').classList.toggle('outline-closed');
  });
  onSwipe(desk, (d) => go(S.index + d));
  window.addEventListener('hashchange', route);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); rerenderCurrent(); });
  route();
}

boot();

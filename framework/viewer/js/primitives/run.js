// Runnable code blocks (```python run, ```sql run, ```js run). Engines live in ./runners/ and load lazily.
import { h, icon } from '../util.js';
import { makeFigure } from './figure.js';
import { makeSortable } from './table.js';

export const kind = 'run';

const ENGINES = { python: 'python', py: 'python', sql: 'sql', sqlite: 'sql', js: 'js', javascript: 'js' };
const LABELS = { python: 'python · wasm', sql: 'sqlite · wasm', js: 'javascript' };
export const match = (info) => info.flags.has('run') && !!ENGINES[info.lang];

const engines = {};
const engine = (name) => (engines[name] ||= import(`./runners/${name}.js`));

function renderOutput(out, items) {
  out.replaceChildren();
  for (const it of items) {
    if (it.type === 'table') {
      const table = h('table', {},
        h('thead', {}, h('tr', {}, it.columns.map((c) => h('th', {}, c)))),
        h('tbody', {}, it.rows.map((r) => h('tr', {}, r.map((v) => h('td', {}, v === null ? 'NULL' : String(v)))))));
      makeSortable(table);
      out.append(h('div', { class: 'table-wrap' }, table));
      if (it.truncated) out.append(h('div', { class: 'run-status' }, `… showing first ${it.rows.length} rows`));
    } else if (it.type === 'html') {
      out.append(h('div', { html: it.html }));
    } else {
      out.append(h('span', { class: it.type === 'err' ? 'err' : it.type === 'res' ? 'res' : '' }, it.text));
    }
  }
}

export function mount(el, src, info, ctx) {
  const name = ENGINES[info.lang];
  const fig = makeFigure({ kind: LABELS[name], title: info.opts.title || '' });
  const editor = h('textarea', { class: 'run-editor', spellcheck: 'false', rows: Math.min(24, src.split('\n').length + 1) });
  editor.value = src;
  const out = h('div', { class: 'run-out', 'aria-live': 'polite' });
  const status = h('span', { class: 'run-status' });
  fig.body.append(editor, out);
  fig.actions.append(status);
  el.replaceChildren(fig.el);
  if (info.flags.has('hidden')) fig.el.classList.add('hidden');

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      exec();
    }
  });

  let running = false;
  async function exec() {
    if (running) return;
    running = true;
    runBtn.disabled = true;
    const t0 = performance.now();
    status.textContent = 'running…';
    try {
      const mod = await engine(name);
      const items = await mod.run(editor.value, ctx.pageState, (msg) => { status.textContent = msg; });
      renderOutput(out, items.length ? items : [{ type: 'res', text: '✓ done (no output)' }]);
      status.textContent = `${Math.round(performance.now() - t0)} ms`;
    } catch (err) {
      renderOutput(out, [{ type: 'err', text: String(err?.message || err) }]);
      status.textContent = 'error';
    } finally {
      running = false;
      runBtn.disabled = false;
    }
  }
  const runBtn = fig.addAction('play', 'Run (⌘/ctrl+enter)', exec, 'primary');
  runBtn.insertAdjacentText('beforeend', ' Run');
  fig.addAction('reset', 'Reset code', () => { editor.value = src; out.replaceChildren(); status.textContent = ''; });

  return info.flags.has('autorun') ? { autorun: exec } : undefined;
}

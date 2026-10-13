import { h } from '../util.js';

export const name = 'tables';

const num = (s) => {
  const t = s.replace(/[,\s%$€£]/g, '');
  return t !== '' && !Number.isNaN(Number(t)) ? Number(t) : null;
};

export function makeSortable(table) {
  const ths = [...table.querySelectorAll('thead th')];
  ths.forEach((th, col) => th.addEventListener('click', () => {
    const dir = th.dataset.sort === 'asc' ? 'desc' : 'asc';
    ths.forEach((t) => delete t.dataset.sort);
    th.dataset.sort = dir;
    const body = table.tBodies[0];
    const rows = [...body.rows];
    const val = (r) => r.cells[col]?.textContent.trim() ?? '';
    const numeric = rows.every((r) => val(r) === '' || num(val(r)) !== null);
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = numeric ? (num(x) ?? -Infinity) - (num(y) ?? -Infinity) : x.localeCompare(y, undefined, { numeric: true });
      return dir === 'asc' ? c : -c;
    });
    body.append(...rows);
  }));
}

export function enhance(root) {
  for (const table of root.querySelectorAll('table')) {
    if (table.closest('.table-wrap')) continue;
    const wrap = h('div', { class: 'table-wrap' });
    table.replaceWith(wrap);
    wrap.append(table);
    if (table.tHead && table.tBodies[0]) makeSortable(table);
    const rows = table.tBodies[0] ? [...table.tBodies[0].rows] : [];
    if (rows.length > 8) {
      const input = h('input', { class: 'table-filter', type: 'search', placeholder: `Filter ${rows.length} rows…` });
      input.addEventListener('input', () => {
        const q = input.value.toLowerCase();
        for (const r of rows) r.style.display = !q || r.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
      wrap.prepend(input);
    }
  }
}

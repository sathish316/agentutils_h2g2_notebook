// SQLite via sql.js (WASM), vendored from node_modules. One in-memory database per page.
let ready = null;
const MAX_ROWS = 500;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: () => reject(new Error(`Failed to load ${src}`)) });
    document.head.append(s);
  });
}

async function sqljs(progress) {
  if (!ready) {
    progress('loading SQLite…');
    ready = (async () => {
      if (!window.initSqlJs) await loadScript('/vendor/sql.js/sql-wasm.js');
      return window.initSqlJs({ locateFile: (f) => `/vendor/sql.js/${f}` });
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export async function run(code, state, progress) {
  const SQL = await sqljs(progress);
  state.db ||= new SQL.Database();
  progress('running…');
  const results = state.db.exec(code);
  if (!results.length) return [{ type: 'res', text: `✓ ok (${state.db.getRowsModified()} rows changed)` }];
  return results.map((r) => ({
    type: 'table', columns: r.columns, rows: r.values.slice(0, MAX_ROWS), truncated: r.values.length > MAX_ROWS,
  }));
}

// JavaScript in a sandboxed, hidden iframe (no access to the notebook page). One realm per page.
const TIMEOUT_MS = 15000;
const RUNTIME = `<script>
const fmt = (v) => { if (typeof v === 'string') return v; try { const s = JSON.stringify(v, null, 2); return s === undefined ? String(v) : s; } catch { return String(v); } };
addEventListener('message', async (e) => {
  const { id, code } = e.data || {};
  if (!id) return;
  const out = [];
  const log = (type) => (...a) => out.push({ type, text: a.map(fmt).join(' ') + '\\n' });
  console.log = console.info = console.debug = log('out');
  console.warn = console.error = log('err');
  console.table = (d) => { const rows = Array.isArray(d) ? d : Object.values(d || {}); const cols = [...new Set(rows.flatMap((r) => Object.keys(r || {})))]; out.push({ type: 'table', columns: cols, rows: rows.map((r) => cols.map((c) => r?.[c] === undefined ? '' : fmt(r[c]))) }); };
  try {
    let r = (0, eval)(code);
    if (r && typeof r.then === 'function') r = await r;
    if (r !== undefined) out.push({ type: 'res', text: fmt(r) });
  } catch (err) { out.push({ type: 'err', text: String(err && err.stack || err) }); }
  parent.postMessage({ id, out }, '*');
});
<\/script>`;

function realm(state) {
  if (state.jsFrame?.isConnected) return state.jsFrame;
  const f = document.createElement('iframe');
  f.sandbox = 'allow-scripts';
  f.style.display = 'none';
  f.srcdoc = RUNTIME;
  document.body.append(f);
  state.jsFrame = f;
  state.jsReady = new Promise((r) => f.addEventListener('load', r, { once: true }));
  return f;
}

export async function run(code, state) {
  const frame = realm(state);
  await state.jsReady;
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      removeEventListener('message', onMsg);
      frame.remove();
      resolve([{ type: 'err', text: `Timed out after ${TIMEOUT_MS / 1000}s (realm reset)` }]);
    }, TIMEOUT_MS);
    function onMsg(e) {
      if (e.source !== frame.contentWindow || e.data?.id !== id) return;
      clearTimeout(timer);
      removeEventListener('message', onMsg);
      resolve(e.data.out);
    }
    addEventListener('message', onMsg);
    frame.contentWindow.postMessage({ id, code }, '*');
  });
}

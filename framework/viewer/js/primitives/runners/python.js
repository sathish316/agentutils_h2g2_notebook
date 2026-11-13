// CPython in the browser via Pyodide (WASM). One interpreter per tab; one globals namespace per page.
const VERSION = '314.0.7';
const CDN = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;
let ready = null;

async function pyodide(progress) {
  if (!ready) {
    progress('loading Python (first run downloads ~10 MB)…');
    ready = import(`${CDN}pyodide.mjs`).then(({ loadPyodide }) => loadPyodide({ indexURL: CDN }));
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export async function run(code, state, progress) {
  const py = await pyodide(progress);
  state.pyGlobals ||= py.globals.get('dict')();
  const out = [];
  py.setStdout({ batched: (s) => out.push({ type: 'out', text: `${s}\n` }) });
  py.setStderr({ batched: (s) => out.push({ type: 'err', text: `${s}\n` }) });
  progress('loading packages…');
  await py.loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: () => {} });
  progress('running…');
  try {
    let result = await py.runPythonAsync(code, { globals: state.pyGlobals });
    if (result !== undefined && result !== null) {
      const text = String(result);
      if (result?.destroy) result.destroy();
      result = text;
      out.push({ type: 'res', text });
    }
  } catch (err) {
    // Trim Pyodide's internal frames; keep the user's traceback.
    const msg = String(err.message || err);
    const i = msg.indexOf('File "<exec>"');
    out.push({ type: 'err', text: i >= 0 ? `Traceback (most recent call last):\n  ${msg.slice(i)}` : msg });
  }
  return out;
}

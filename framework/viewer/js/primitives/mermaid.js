import { makeFigure } from './figure.js';
import { mountZoomPan, downloadSvg } from './zoompan.js';
import { slugify } from '../shared/slug.js';

export const kind = 'mermaid';
export const match = (info) => info.lang === 'mermaid';

let mod = null;
let configured = '';
let seq = 0;

async function mermaid(ctx, look) {
  mod ||= (await import('/vendor/mermaid/mermaid.esm.min.mjs')).default;
  const key = `${ctx.dark}|${look}`;
  if (configured !== key) {
    mod.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: ctx.dark ? 'dark' : 'neutral',
      look,
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      themeVariables: ctx.dark ? {} : { background: 'transparent' },
    });
    configured = key;
  }
  return mod;
}

// mermaid.initialize is global; serialize renders so per-diagram `look` options don't race.
let queue = Promise.resolve();

export async function mount(el, src, info, ctx) {
  const fig = makeFigure({ kind: 'diagram', title: info.opts.title });
  el.replaceChildren(fig.el);
  const look = info.opts.look || (ctx.sketch ? 'handDrawn' : 'classic');
  const job = queue.then(async () => {
    const m = await mermaid(ctx, look);
    const id = `mmd-${Date.now().toString(36)}-${seq++}`;
    try {
      const { svg } = await m.render(id, src);
      return svg;
    } finally {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = job.catch(() => {});
  let svgText;
  try {
    svgText = await job;
  } catch (err) {
    fig.body.append(Object.assign(document.createElement('div'), { className: 'fig-error', textContent: `Mermaid error: ${err.message || err}\n\n${src}` }));
    return;
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = svgText;
  const svgEl = tpl.content.querySelector('svg');
  mountZoomPan(fig, svgEl, { height: Number(info.opts.height) || undefined });
  fig.addAction('download', 'Download SVG', () => downloadSvg(svgEl, slugify(info.opts.title || 'diagram')));
}

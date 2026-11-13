import { h } from '../util.js';
import { makeFigure } from './figure.js';

export const kind = 'viz';
export const match = (info) => info.lang === 'viz' || info.lang === 'html-viz';

// Scripts run, but without same-origin: the visualization can't touch the notebook page or its storage.
const SANDBOX = 'allow-scripts allow-popups allow-modals allow-downloads allow-pointer-lock';

export function mount(el, src, info, ctx) {
  const fig = makeFigure({ kind: 'interactive', title: info.opts.title });
  el.replaceChildren(fig.el);
  const height = Number(info.opts.height) || 360;
  const frame = h('iframe', { class: 'viz-frame', sandbox: SANDBOX, loading: 'lazy', title: info.opts.title || 'visualization', style: { height: `${height}px` } });
  const load = () => {
    if (info.opts.src) {
      const url = new URL(info.opts.src, ctx.baseUrl);
      url.searchParams.set('theme', ctx.dark ? 'dark' : 'light');
      frame.src = url.href;
    } else {
      const base = `<meta charset="utf-8"><style>html{color-scheme:${ctx.dark ? 'dark' : 'light'}}body{margin:12px;font-family:Inter,system-ui,sans-serif;background:transparent;color:${ctx.dark ? '#e8e6ee' : '#2b2a33'}}</style>`;
      frame.srcdoc = /<head[^>]*>/i.test(src) ? src.replace(/<head[^>]*>/i, (m) => m + base) : base + src;
    }
  };
  load();
  fig.body.append(h('div', { class: 'viz-wrap' }, frame));
  fig.addAction('reset', 'Reload', () => { frame.removeAttribute('src'); frame.removeAttribute('srcdoc'); load(); });
  if (info.opts.src) fig.addAction('external', 'Open in new tab', () => window.open(new URL(info.opts.src, ctx.baseUrl), '_blank', 'noopener'));
  fig.addAction('expand', 'Fullscreen', () => fig.toggleFullscreen());
}

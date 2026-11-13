import { makeFigure } from './figure.js';
import { mountZoomPan, downloadSvg } from './zoompan.js';
import { sanitizeSvg } from '../render/markdown.js';
import { slugify } from '../shared/slug.js';

export const kind = 'svg';
export const match = (info) => info.lang === 'svg';

export async function mount(el, src, info, ctx) {
  const fig = makeFigure({ kind: 'figure', title: info.opts.title });
  el.replaceChildren(fig.el);
  let text = src;
  if (info.opts.src) {
    const res = await fetch(new URL(info.opts.src, ctx.baseUrl));
    if (!res.ok) throw new Error(`Could not load ${info.opts.src} (${res.status})`);
    text = await res.text();
  }
  const tpl = document.createElement('template');
  tpl.innerHTML = sanitizeSvg(text);
  const svgEl = tpl.content.querySelector('svg');
  if (!svgEl) throw new Error('No <svg> element found');
  svgEl.style.color = 'var(--ink)';
  mountZoomPan(fig, svgEl, { height: Number(info.opts.height) || undefined });
  fig.addAction('download', 'Download SVG', () => downloadSvg(svgEl, slugify(info.opts.title || 'figure')));
}

/** `![alt](assets/x.svg)` images become zoomable figures too. */
export const imageEnhancer = {
  name: 'svg-images',
  enhance(root) {
    for (const img of root.querySelectorAll('img[src$=".svg"]')) {
      if (img.closest('.figure, a')) continue;
      const fig = makeFigure({ kind: 'figure', title: img.alt });
      const host = img.parentElement?.tagName === 'P' && img.parentElement.childNodes.length === 1 ? img.parentElement : img;
      host.replaceWith(fig.el);
      mountZoomPan(fig, img);
    }
  },
};

import { h, icon } from '../util.js';

/**
 * Zoom/pan viewer. `content` is an <svg> or <img>. Ctrl/⌘+wheel or pinch zooms, drag pans, double-click fits.
 * In fullscreen, plain wheel pans and ctrl-wheel zooms.
 */
export function mountZoomPan(figure, content, { height } = {}) {
  const canvas = h('div', { class: 'zp-canvas' }, content);
  const zoomLabel = h('span', { class: 'zp-zoom fbtn' }, '100%');
  const view = h('div', { class: 'zp-view' }, canvas, h('span', { class: 'zp-hint' }, 'drag · ⌘/ctrl+scroll to zoom · dbl-click to fit'));
  figure.body.append(view);

  let s = 1, x = 0, y = 0, natW = 0, natH = 0;
  const apply = () => {
    canvas.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    zoomLabel.textContent = `${Math.round(s * 100)}%`;
  };
  const measure = () => {
    if (content instanceof SVGSVGElement) {
      const vb = content.viewBox?.baseVal;
      natW = vb && vb.width ? vb.width : content.getBBox?.().width || 600;
      natH = vb && vb.height ? vb.height : content.getBBox?.().height || 400;
      content.setAttribute('width', natW);
      content.setAttribute('height', natH);
      content.style.maxWidth = 'none';
    } else {
      natW = content.naturalWidth || 600;
      natH = content.naturalHeight || 400;
      content.style.width = `${natW}px`;
    }
  };
  const fit = () => {
    const vw = view.clientWidth, vh = view.clientHeight;
    if (!vw || !vh) return;
    s = Math.min((vw - 32) / natW, (vh - 32) / natH, figure.el.classList.contains('fullscreen') ? 3 : 1.5);
    x = (vw - natW * s) / 2;
    y = (vh - natH * s) / 2;
    apply();
  };
  const zoomAt = (factor, cx, cy) => {
    const ns = Math.min(12, Math.max(0.1, s * factor));
    x = cx - ((cx - x) * ns) / s;
    y = cy - ((cy - y) * ns) / s;
    s = ns;
    apply();
  };
  const center = () => [view.clientWidth / 2, view.clientHeight / 2];

  view.addEventListener('wheel', (e) => {
    const fs = figure.el.classList.contains('fullscreen');
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = view.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0045), e.clientX - r.left, e.clientY - r.top);
    } else if (fs) {
      e.preventDefault();
      x -= e.deltaX; y -= e.deltaY; apply();
    }
  }, { passive: false });

  const pointers = new Map();
  let pinch = null;
  view.addEventListener('pointerdown', (e) => {
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    view.classList.add('dragging');
  });
  view.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (pointers.size === 2) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = view.getBoundingClientRect();
      if (pinch) zoomAt(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      pinch = d;
      return;
    }
    x += e.clientX - prev.x; y += e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    apply();
  });
  const up = (e) => { pointers.delete(e.pointerId); pinch = null; if (!pointers.size) view.classList.remove('dragging'); };
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', up);
  view.addEventListener('dblclick', fit);

  figure.addAction('minus', 'Zoom out', () => zoomAt(1 / 1.25, ...center()));
  figure.actions.append(zoomLabel);
  zoomLabel.addEventListener('click', () => { const [cx, cy] = center(); zoomAt(1 / s, cx, cy); });
  figure.addAction('plus', 'Zoom in', () => zoomAt(1.25, ...center()));
  figure.addAction('fit', 'Fit', fit);
  figure.addAction('expand', 'Fullscreen', () => figure.toggleFullscreen());
  figure.onFullscreen(() => fit());

  // Height follows the diagram's aspect ratio at the current width (unless fixed via height=).
  // Recomputed on resize because pages are built off-screen, before they have a width.
  let lastW = 0;
  const size = () => {
    if (!natW || figure.el.classList.contains('fullscreen')) return;
    const vw = view.clientWidth;
    if (!vw) return;
    if (height) view.style.setProperty('--zp-h', `${height}px`);
    else if (vw !== lastW) {
      const auto = Math.round(natH * Math.min(1.5, (vw - 32) / natW) + 32);
      view.style.setProperty('--zp-h', `${Math.max(140, Math.min(640, auto))}px`);
    }
    lastW = vw;
    fit();
  };
  const init = () => { measure(); size(); };
  if (content instanceof HTMLImageElement && !content.complete) content.addEventListener('load', init, { once: true });
  else requestAnimationFrame(init);
  new ResizeObserver(size).observe(view);
  return { fit };
}

export function downloadSvg(svgEl, name = 'diagram') {
  const blob = new Blob([new XMLSerializer().serializeToString(svgEl)], { type: 'image/svg+xml' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${name}.svg` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

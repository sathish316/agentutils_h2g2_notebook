import { h, icon } from '../util.js';

/** A framed figure with a title bar; supports a modal "fullscreen" mode. */
export function makeFigure({ kind, title, className = '' }) {
  const actions = h('div', { style: { display: 'flex', gap: '2px' } });
  const bar = h('div', { class: 'figure-bar' }, h('span', { class: 'kind' }, kind), h('span', { class: 'ttl' }, title || ''), actions);
  const body = h('div', { class: 'figure-body' });
  const el = h('figure', { class: `figure ${className}` }, bar, body);
  const listeners = new Set();
  const notify = (on) => {
    el.classList.toggle('fullscreen', on);
    requestAnimationFrame(() => listeners.forEach((fn) => fn(on)));
  };

  // Preferred: native Fullscreen API. The element moves to the browser's top layer, escaping the page
  // sheet (whose transform would otherwise trap position:fixed) without moving it in the DOM, so
  // iframes and diagram state are preserved.
  const native = document.fullscreenEnabled && el.requestFullscreen;
  if (native) {
    el.addEventListener('fullscreenchange', () => notify(document.fullscreenElement === el));
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.fullscreenElement === el) document.exitFullscreen(); });
  }

  // Fallback (e.g. iPhone Safari): move the figure to <body> and back, keeping its place with a marker.
  let backdrop = null;
  let marker = null;
  const onKey = (e) => { if (e.key === 'Escape') toggle(false); };
  function fallback(on) {
    if (on) {
      marker = document.createComment('figure');
      el.before(marker);
      backdrop = h('div', { class: 'fs-backdrop', onclick: () => toggle(false) });
      document.body.append(backdrop, el);
      document.addEventListener('keydown', onKey);
    } else {
      marker?.replaceWith(el);
      backdrop?.remove();
      marker = backdrop = null;
      document.removeEventListener('keydown', onKey);
    }
    notify(on);
  }

  function toggle(on = !el.classList.contains('fullscreen')) {
    if (on === el.classList.contains('fullscreen')) return;
    if (native) {
      const p = on ? el.requestFullscreen() : document.exitFullscreen();
      p?.catch?.(() => fallback(on));
    } else {
      fallback(on);
    }
  }
  const addAction = (name, label, onclick, cls = '') => {
    const b = h('button', { class: `fbtn ${cls}`, title: label, 'aria-label': label, onclick, html: icon(name, 15) });
    actions.append(b);
    return b;
  };
  return { el, bar, body, actions, addAction, toggleFullscreen: toggle, onFullscreen: (fn) => listeners.add(fn) };
}

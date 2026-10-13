import { h, icon } from '../util.js';

/** A framed figure with a title bar; supports a modal "fullscreen" mode. */
export function makeFigure({ kind, title, className = '' }) {
  const actions = h('div', { style: { display: 'flex', gap: '2px' } });
  const bar = h('div', { class: 'figure-bar' }, h('span', { class: 'kind' }, kind), h('span', { class: 'ttl' }, title || ''), actions);
  const body = h('div', { class: 'figure-body' });
  const el = h('figure', { class: `figure ${className}` }, bar, body);
  let backdrop = null;
  const listeners = new Set();
  const onKey = (e) => { if (e.key === 'Escape') toggle(false); };
  function toggle(on = !el.classList.contains('fullscreen')) {
    if (on === el.classList.contains('fullscreen')) return;
    el.classList.toggle('fullscreen', on);
    if (on) {
      backdrop = h('div', { class: 'fs-backdrop', onclick: () => toggle(false) });
      document.body.append(backdrop);
      document.addEventListener('keydown', onKey);
    } else {
      backdrop?.remove();
      document.removeEventListener('keydown', onKey);
    }
    requestAnimationFrame(() => listeners.forEach((fn) => fn(on)));
  }
  const addAction = (name, label, onclick, cls = '') => {
    const b = h('button', { class: `fbtn ${cls}`, title: label, 'aria-label': label, onclick, html: icon(name, 15) });
    actions.append(b);
    return b;
  };
  return { el, bar, body, actions, addAction, toggleFullscreen: toggle, onFullscreen: (fn) => listeners.add(fn) };
}

import { h } from '../util.js';

export const name = 'callouts';

const TYPES = {
  note: ['Note', 'ℹ︎'], tip: ['Tip', '💡'], important: ['Important', '❗'], warning: ['Warning', '⚠︎'],
  caution: ['Caution', '⛔'], deepdive: ['Deep dive', '🔍'], exercise: ['Try it', '✏️'],
};

export function enhance(root) {
  for (const bq of root.querySelectorAll('blockquote')) {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== 'P') continue;
    const m = /^\s*\[!(\w+)\]([^\n<]*)(?:\n|<br>)?/i.exec(p.innerHTML);
    if (!m) continue;
    const type = m[1].toLowerCase();
    if (!TYPES[type]) continue;
    const [label, emoji] = TYPES[type];
    const title = m[2].trim() || label;
    p.innerHTML = p.innerHTML.slice(m[0].length);
    if (!p.textContent.trim() && !p.children.length) p.remove();
    const body = h('div', { class: 'callout-body' }, ...bq.childNodes);
    let el;
    if (type === 'deepdive') {
      el = h('details', { class: 'callout deepdive' }, h('summary', { class: 'callout-title' }, `${emoji} ${title}`), body);
    } else {
      el = h('div', { class: `callout ${type}` }, h('div', { class: 'callout-title' }, `${emoji} ${title}`), body);
    }
    bq.replaceWith(el);
  }
}

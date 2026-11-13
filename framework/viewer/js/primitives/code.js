import { h, icon } from '../util.js';

export const kind = 'code';
export const match = () => true;

export function addCopy(container, getText) {
  const btn = h('button', { class: 'copy-btn', title: 'Copy', html: icon('copy', 14) });
  btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(getText());
    btn.textContent = '✓';
    setTimeout(() => { btn.innerHTML = icon('copy', 14); }, 1200);
  });
  container.append(btn);
}

export function mount(el, src, info) {
  const pre = h('pre', {}, h('code', { class: info.lang ? `language-${info.lang}` : '' }, src));
  const box = h('div', { class: 'codeblock' }, pre);
  if (info.lang) box.append(h('span', { class: 'lang' }, info.lang));
  addCopy(box, () => src);
  el.replaceChildren(box);
}

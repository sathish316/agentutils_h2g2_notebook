export const name = 'citations';

export function enhance(root, ctx) {
  for (const sup of root.querySelectorAll('sup.cite')) {
    const hit = ctx.refIndex.get(sup.dataset.ref);
    const a = sup.querySelector('a');
    if (!hit) {
      sup.classList.add('missing');
      a.textContent = '?';
      a.title = `Missing reference: ${sup.dataset.ref}`;
      continue;
    }
    a.textContent = String(hit.n);
    a.title = hit.ref.title;
  }
}

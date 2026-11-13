export const name = 'links';

export function enhance(root, ctx) {
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^(https?:)?\/\//i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      continue;
    }
    // chapters/foo.md or ../chapters/foo.md(#topic) → #/foo(/topic)
    const m = /^(?:\.\.?\/)*(?:chapters\/)?([^/#?]+\.md)(?:#(.+))?$/.exec(href);
    if (m) {
      const id = ctx.files.get(`chapters/${m[1]}`);
      if (id) a.setAttribute('href', `#/${id}${m[2] ? `/${m[2]}` : ''}`);
    }
  }
}

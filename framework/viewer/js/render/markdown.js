// Markdown → sanitized HTML. Fenced blocks become primitive placeholders that primitives/index.js hydrates.
import { Marked } from '/vendor/marked/marked.esm.js';
import DOMPurify from '/vendor/dompurify/purify.es.mjs';
import { escapeHtml, parseInfo } from '../util.js';
import { kindFor } from '../primitives/index.js';

const citation = {
  name: 'cite',
  level: 'inline',
  start(src) { const i = src.indexOf('[@'); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^\[@([A-Za-z0-9._-]+)\]/.exec(src);
    if (m) return { type: 'cite', raw: m[0], id: m[1] };
    return undefined;
  },
  renderer(tok) { return `<sup class="cite" data-ref="${escapeHtml(tok.id)}"><a href="#/references/${escapeHtml(tok.id)}">?</a></sup>`; },
};

const marked = new Marked({
  gfm: true,
  extensions: [citation],
  renderer: {
    code({ text, lang }) {
      const info = lang || '';
      const kind = kindFor(parseInfo(info));
      return `<div class="prim" data-kind="${kind}" data-info="${escapeHtml(info)}"><pre class="prim-src">${escapeHtml(text)}</pre></div>`;
    },
  },
});

export function renderMarkdown(md) {
  const raw = marked.parse(String(md || ''));
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'object', 'embed'],
  });
}

export function sanitizeSvg(svg) {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['foreignObject'] });
}

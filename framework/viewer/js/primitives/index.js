// Primitive registry. Two kinds:
//   blocks    — fenced code blocks, chosen by kindFor(info) at markdown render time, mounted at hydrate time.
//   enhancers — DOM passes over rendered chapter HTML (tables, callouts, citations, links, svg images).
// To add a primitive: create a module exporting { kind, match(info), mount(el, src, info, ctx) } (block)
// or { name, enhance(root, ctx) } (enhancer), add it below, and document its syntax in framework/FORMAT.md.
import { parseInfo } from '../util.js';
import * as mermaid from './mermaid.js';
import * as svg from './svg.js';
import * as viz from './viz.js';
import * as run from './run.js';
import * as code from './code.js';
import * as table from './table.js';
import * as callout from './callout.js';
import * as cite from './cite.js';
import * as links from './links.js';

export const blocks = [mermaid, svg, viz, run, code]; // code is the fallback; keep it last
export const enhancers = [callout, table, cite, links, svg.imageEnhancer];

export function kindFor(info) {
  return (blocks.find((b) => b.match(info)) || code).kind;
}

/**
 * ctx: { notebook, baseUrl, chapter, refIndex: Map(id -> {n, ref}), files: Map(file -> chapterId),
 *        pageState: {}, dark, sketch, navigate(hash) }
 */
export async function hydrate(root, ctx) {
  for (const e of enhancers) {
    try { e.enhance(root, ctx); } catch (err) { console.error(`[h2g2] enhancer ${e.name} failed`, err); }
  }
  const autoruns = [];
  const mounts = [...root.querySelectorAll('.prim')].map(async (el) => {
    const info = parseInfo(el.dataset.info || '');
    const src = el.querySelector('.prim-src')?.textContent ?? '';
    const block = blocks.find((b) => b.kind === el.dataset.kind) || code;
    try {
      const res = await block.mount(el, src, info, ctx);
      if (res?.autorun) autoruns.push(res.autorun);
    } catch (err) {
      console.error(`[h2g2] ${block.kind} failed`, err);
      el.innerHTML = '';
      el.append(Object.assign(document.createElement('div'), { className: 'fig-error', textContent: `${block.kind}: ${err.message}` }));
    }
  });
  await Promise.all(mounts);
  // Autorun blocks run sequentially in document order (setup blocks feed later ones).
  (async () => { for (const fn of autoruns) await fn().catch(() => {}); })();
}

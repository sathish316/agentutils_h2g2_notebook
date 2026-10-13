import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify, extractTopics } from '../viewer/js/shared/slug.js';

export { slugify, extractTopics };

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const NOTEBOOKS_DIR = path.join(ROOT, 'notebooks');
export const FRAMEWORK_DIR = path.join(ROOT, 'framework');
export const SCOPES = ['general', 'org'];
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function notebookDir(name) {
  if (!NAME_RE.test(name)) throw new Error(`Invalid notebook name: ${name}`);
  return path.join(NOTEBOOKS_DIR, name);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback);
    throw new Error(`${path.relative(ROOT, file)}: ${err.message}`);
  }
}

async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fs.rename(tmp, file);
}

export const EMPTY_TOC = { chapters: [] };
export const EMPTY_REFS = { categories: [] };

export async function isNotebook(name) {
  return NAME_RE.test(name) && fss.existsSync(path.join(notebookDir(name), 'notebook.json'));
}

export async function listNotebooks() {
  const entries = await fs.readdir(NOTEBOOKS_DIR, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !NAME_RE.test(e.name)) continue;
    const dir = path.join(NOTEBOOKS_DIR, e.name);
    const meta = await readJson(path.join(dir, 'notebook.json'), null).catch(() => null);
    if (!meta) {
      out.push({ name: e.name, title: e.name, initialized: false });
      continue;
    }
    const toc = await readJson(path.join(dir, 'toc.json'), EMPTY_TOC).catch(() => EMPTY_TOC);
    out.push({ ...meta, name: e.name, initialized: true, chapterCount: flatten(toc.chapters).length });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function flatten(chapters, depth = 0, parent = null, out = []) {
  for (const c of chapters || []) {
    out.push({ ...c, depth, parent });
    flatten(c.children, depth + 1, c.id, out);
  }
  return out;
}

export async function loadNotebook(name) {
  const dir = notebookDir(name);
  const meta = await readJson(path.join(dir, 'notebook.json'));
  const toc = await readJson(path.join(dir, 'toc.json'), EMPTY_TOC);
  const references = await readJson(path.join(dir, 'references.json'), EMPTY_REFS);
  return { dir, meta: { ...meta, name }, toc, references };
}

/** Notebook payload for the viewer: TOC enriched with topics parsed from each chapter. */
export async function loadNotebookForViewer(name) {
  const nb = await loadNotebook(name);
  const enrich = async (chapters) => Promise.all((chapters || []).map(async (c) => {
    let topics = [];
    let missing = false;
    if (c.status === 'planned') return { ...c, topics, missing, children: await enrich(c.children) };
    try {
      topics = extractTopics(await fs.readFile(path.join(nb.dir, c.file), 'utf8'));
    } catch {
      missing = true;
    }
    return { ...c, topics, missing, children: await enrich(c.children) };
  }));
  return { meta: nb.meta, toc: { chapters: await enrich(nb.toc.chapters) }, references: nb.references };
}

export async function createNotebook(name, { title, scope = 'general', description = '' } = {}) {
  if (!SCOPES.includes(scope)) throw new Error(`scope must be one of: ${SCOPES.join(', ')}`);
  const dir = notebookDir(name);
  if (fss.existsSync(path.join(dir, 'notebook.json'))) throw new Error(`Notebook ${name} already exists`);
  await fs.mkdir(path.join(dir, 'chapters'), { recursive: true });
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  const now = new Date().toISOString();
  await writeJson(path.join(dir, 'notebook.json'), {
    title: title || name, description, scope, created: now, updated: now,
  });
  await writeJson(path.join(dir, 'toc.json'), EMPTY_TOC);
  await writeJson(path.join(dir, 'references.json'), EMPTY_REFS);
  return dir;
}

async function touch(nb) {
  nb.meta.updated = new Date().toISOString();
  const { name, ...meta } = nb.meta;
  await writeJson(path.join(nb.dir, 'notebook.json'), meta);
}

function findIn(chapters, id) {
  for (let i = 0; i < (chapters || []).length; i++) {
    if (chapters[i].id === id) return { list: chapters, index: i, node: chapters[i] };
    const hit = findIn(chapters[i].children, id);
    if (hit) return hit;
  }
  return null;
}

async function ensureChapterFile(nb, file, title) {
  const abs = path.resolve(nb.dir, file);
  if (!abs.startsWith(nb.dir + path.sep)) throw new Error('Chapter file must be inside the notebook');
  if (!fss.existsSync(abs)) {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, `# ${title}\n\n`);
  }
  return abs;
}

/**
 * Add a chapter to the TOC (and create its markdown file if missing).
 * Position: { after } | { before } | { parent } (appended as child) | {} (appended at top level).
 * planned: true adds a TOC-only entry (status "planned", no file) — part of the learning plan, not written yet.
 * If `id` names an existing planned entry, it is promoted to a written chapter in place.
 */
export async function addChapter(name, { id, title, summary, after, before, parent, file, planned = false }) {
  const nb = await loadNotebook(name);
  const existing = id && findIn(nb.toc.chapters, id);
  if (existing && existing.node.status === 'planned' && !planned) {
    const node = existing.node;
    if (title) node.title = title;
    if (summary) node.summary = summary;
    node.file = file || `chapters/${node.id}.md`;
    delete node.status;
    const abs = await ensureChapterFile(nb, node.file, node.title);
    await writeJson(path.join(nb.dir, 'toc.json'), nb.toc);
    await touch(nb);
    return { ...node, path: abs, promoted: true };
  }
  if (!title) throw new Error('title is required');
  id = id || slugify(title);
  if (existing || findIn(nb.toc.chapters, id)) throw new Error(`Chapter id already exists: ${id}`);
  let entry;
  let abs = null;
  if (planned) {
    entry = { id, title, ...(summary ? { summary } : {}), status: 'planned' };
  } else {
    file = file || `chapters/${id}.md`;
    abs = await ensureChapterFile(nb, file, title);
    entry = { id, title, file, ...(summary ? { summary } : {}) };
  }
  const anchor = after || before;
  if (anchor) {
    const hit = findIn(nb.toc.chapters, anchor);
    if (!hit) throw new Error(`No chapter with id ${anchor}`);
    hit.list.splice(hit.index + (after ? 1 : 0), 0, entry);
  } else if (parent) {
    const hit = findIn(nb.toc.chapters, parent);
    if (!hit) throw new Error(`No chapter with id ${parent}`);
    (hit.node.children ||= []).push(entry);
  } else {
    nb.toc.chapters.push(entry);
  }
  await writeJson(path.join(nb.dir, 'toc.json'), nb.toc);
  await touch(nb);
  return { ...entry, path: abs };
}

export async function addReference(name, { category, title, url, source = 'web', chapter, note, id }) {
  if (!category || !title) throw new Error('category and title are required');
  const nb = await loadNotebook(name);
  const catId = slugify(category);
  let cat = nb.references.categories.find((c) => c.id === catId);
  if (!cat) nb.references.categories.push((cat = { id: catId, title: category, items: [] }));
  const all = nb.references.categories.flatMap((c) => c.items);
  // Same URL already cited: just attach the chapter.
  const existing = url && all.find((r) => r.url === url);
  if (existing) {
    if (chapter && !(existing.chapters ||= []).includes(chapter)) existing.chapters.push(chapter);
    await writeJson(path.join(nb.dir, 'references.json'), nb.references);
    return existing;
  }
  let base = id || slugify(title).slice(0, 40);
  let refId = base;
  for (let n = 2; all.some((r) => r.id === refId); n++) refId = `${base}-${n}`;
  const ref = {
    id: refId, title, ...(url ? { url } : {}), source,
    ...(chapter ? { chapters: [chapter] } : {}), ...(note ? { note } : {}),
    accessed: new Date().toISOString().slice(0, 10),
  };
  cat.items.push(ref);
  await writeJson(path.join(nb.dir, 'references.json'), nb.references);
  await touch(nb);
  return ref;
}

/** Structural checks an agent should run after editing a notebook. Returns { errors, warnings }. */
export async function validateNotebook(name) {
  const errors = [];
  const warnings = [];
  let nb;
  try {
    nb = await loadNotebook(name);
  } catch (err) {
    return { errors: [err.message], warnings };
  }
  if (!SCOPES.includes(nb.meta.scope)) errors.push(`notebook.json: scope must be one of ${SCOPES.join(', ')}`);
  if (!nb.meta.title) errors.push('notebook.json: title is required');
  if (!Array.isArray(nb.toc.chapters)) errors.push('toc.json: "chapters" must be an array');
  if (!Array.isArray(nb.references.categories)) errors.push('references.json: "categories" must be an array');
  if (errors.length) return { errors, warnings };

  const refIds = new Set();
  for (const cat of nb.references.categories) {
    if (!cat.id || !cat.title || !Array.isArray(cat.items)) errors.push(`references.json: category needs id, title, items[]`);
    for (const r of cat.items || []) {
      if (!r.id || !r.title) errors.push(`references.json: item in "${cat.title}" needs id and title`);
      if (refIds.has(r.id)) errors.push(`references.json: duplicate reference id ${r.id}`);
      refIds.add(r.id);
    }
  }

  const ids = new Set();
  const files = new Set();
  const cited = new Set();
  for (const c of flatten(nb.toc.chapters)) {
    if (c.id && ids.has(c.id)) errors.push(`toc.json: duplicate chapter id ${c.id}`);
    if (c.id) ids.add(c.id);
    if (c.status === 'planned') {
      if (!c.id || !c.title) errors.push(`toc.json: planned entry needs id and title (${JSON.stringify(c.title || c.id)})`);
      if (c.file) warnings.push(`toc.json: planned chapter ${c.id} has a file; remove "status" once it is written`);
      continue;
    }
    if (c.status) errors.push(`toc.json: ${c.id} has unknown status "${c.status}" (only "planned" is allowed)`);
    if (!c.id || !c.title || !c.file) { errors.push(`toc.json: entry needs id, title, file (${JSON.stringify(c.title || c.id)})`); continue; }
    const abs = path.resolve(nb.dir, c.file);
    files.add(abs);
    let md;
    try { md = await fs.readFile(abs, 'utf8'); } catch { errors.push(`toc.json: ${c.id} points to missing file ${c.file}`); continue; }
    if (!/^#\s+/m.test(md)) warnings.push(`${c.file}: no "# Title" heading`);
    for (const m of md.matchAll(/\[@([A-Za-z0-9._-]+)\]/g)) {
      cited.add(m[1]);
      if (!refIds.has(m[1])) errors.push(`${c.file}: citation [@${m[1]}] has no entry in references.json`);
    }
    for (const m of md.matchAll(/^\s*```\s*(?:viz|svg)\b[^\n]*\bsrc=["']?([^\s"'`]+)/gm)) {
      if (!fss.existsSync(path.resolve(nb.dir, m[1]))) errors.push(`${c.file}: embedded file not found: ${m[1]}`);
    }
    for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
      if (!/^[a-z]+:/i.test(m[1]) && !fss.existsSync(path.resolve(nb.dir, m[1]))) errors.push(`${c.file}: image not found: ${m[1]}`);
    }
    let fences = 0;
    for (const line of md.split('\n')) if (/^\s*(```|~~~)/.test(line)) fences++;
    if (fences % 2) errors.push(`${c.file}: unbalanced code fence`);
  }
  const chapterDir = path.join(nb.dir, 'chapters');
  for (const f of await fs.readdir(chapterDir).catch(() => [])) {
    if (f.endsWith('.md') && !files.has(path.join(chapterDir, f))) warnings.push(`chapters/${f} is not listed in toc.json`);
  }
  for (const id of refIds) if (!cited.has(id)) warnings.push(`reference ${id} is never cited with [@${id}]`);
  return { errors, warnings };
}

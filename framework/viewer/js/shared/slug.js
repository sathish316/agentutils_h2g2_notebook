// Shared by the browser viewer and the Node server/CLI. Keep dependency-free.
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'section';
}

// Topics are the `## ` headings of a chapter. Ids are unique within a chapter.
export function extractTopics(markdown) {
  const topics = [];
  const seen = new Map();
  let inFence = false;
  for (const line of String(markdown).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slugify(m[1]);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    topics.push({ id: n ? `${base}-${n}` : base, title: m[1].replace(/[`*_]/g, '') });
  }
  return topics;
}

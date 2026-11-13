import fs from 'node:fs/promises';
import path from 'node:path';
import { FRAMEWORK_DIR, ROOT, flatten, loadNotebookForViewer } from '../lib/notebook.mjs';

export const MODES = {
  'new-chapter': { label: 'New chapter', writes: true },
  'add-topic': { label: 'Add topic to this chapter', writes: true, needsChapter: true },
  'edit-chapter': { label: 'Change this chapter', writes: true, needsChapter: true },
  answer: { label: 'Just answer', writes: false },
  framework: { label: 'Change the framework', writes: true, framework: true },
};

const SCOPE_SOURCES = {
  general: 'research on the public internet (official docs, papers, reputable blogs).',
  org: 'research in Confluence and with the Teamwork Graph CLI (`twg`) first (internal docs, Jira, Bitbucket, owners); use the internet only for public background. Ask the reader if something is ambiguous.',
};

const render = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));

function tocText(chapters) {
  const rows = flatten(chapters).map((c) => {
    const pad = '  '.repeat(c.depth);
    const topics = c.topics?.length ? ` — topics: ${c.topics.map((t) => t.title).join('; ')}` : '';
    return `${pad}- ${c.title} (\`${c.id}\`, ${c.file})${topics}`;
  });
  return rows.join('\n') || '(empty — this will be the first chapter)';
}

export async function buildPrompt(notebook, { mode, chapterId, topicId, message }) {
  if (!MODES[mode]) throw new Error(`Unknown mode: ${mode}`);
  if (!message?.trim()) throw new Error('message is required');
  const nb = await loadNotebookForViewer(notebook);
  const chapter = chapterId ? flatten(nb.toc.chapters).find((c) => c.id === chapterId) : null;
  if (MODES[mode].needsChapter && !chapter) throw new Error(`Mode ${mode} needs a valid chapterId`);
  const topic = chapter && topicId ? chapter.topics.find((t) => t.id === topicId) : null;

  const vars = {
    name: notebook,
    title: nb.meta.title,
    description: nb.meta.description || '(none)',
    scope: nb.meta.scope,
    scopeSources: SCOPE_SOURCES[nb.meta.scope] || SCOPE_SOURCES.general,
    notebookDir: path.join(ROOT, 'notebooks', notebook),
    root: ROOT,
    formatDoc: path.join(FRAMEWORK_DIR, 'FORMAT.md'),
    today: new Date().toISOString().slice(0, 10),
    toc: tocText(nb.toc.chapters),
    request: message.trim().replace(/\n/g, '\n> '),
    chapterId: chapter?.id,
    chapterTitle: chapter?.title,
    chapterFile: chapter?.file,
    topicLine: topic ? `, topic **${topic.title}** (\`## ${topic.title}\`)` : '',
    contextSuffix: chapter
      ? ` while reading "${chapter.title}" (\`${chapter.id}\`)${topic ? `, topic "${topic.title}"` : ''}`
      : '',
    contextLine: chapter
      ? `Context: the reader is on chapter "${chapter.title}" (\`${chapter.file}\`)${topic ? `, topic "${topic.title}"` : ''}. Read it first.`
      : 'Context: the whole notebook.',
  };
  const read = (f) => fs.readFile(path.join(FRAMEWORK_DIR, 'prompts', f), 'utf8');
  return `${render(await read('base.md'), vars)}\n${render(await read(`${mode}.md`), vars)}`;
}

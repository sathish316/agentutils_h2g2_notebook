import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NOTEBOOKS_DIR, createNotebook, addChapter, addReference, validateNotebook, loadNotebookForViewer, slugify, extractTopics } from '../lib/notebook.mjs';
import { parseInfo } from '../viewer/js/shared/fence.js';

const NAME = `zz-test-${process.pid}`;

test('slugify and topics', () => {
  assert.equal(slugify('Consumer Groups & Rebalancing!'), 'consumer-groups-rebalancing');
  const topics = extractTopics('# T\n## A\n```md\n## not a topic\n```\n## A\n## `B` *c*');
  assert.deepEqual(topics.map((t) => t.id), ['a', 'a-1', 'b-c']);
});

test('fence info parsing', () => {
  const i = parseInfo('python run autorun title="Hello world" height=300');
  assert.equal(i.lang, 'python');
  assert.ok(i.flags.has('run') && i.flags.has('autorun'));
  assert.deepEqual(i.opts, { title: 'Hello world', height: '300' });
});

test('notebook lifecycle + validation', async (t) => {
  t.after(() => fs.rm(path.join(NOTEBOOKS_DIR, NAME), { recursive: true, force: true }));
  await createNotebook(NAME, { title: 'Test', scope: 'general' });
  await addChapter(NAME, { title: 'Intro' });
  await addChapter(NAME, { title: 'Before intro', before: 'intro' });
  await addChapter(NAME, { title: 'Child', parent: 'intro' });
  const ref = await addReference(NAME, { category: 'Docs', title: 'Spec', url: 'https://example.com', chapter: 'intro' });
  const again = await addReference(NAME, { category: 'Docs', title: 'Spec 2', url: 'https://example.com', chapter: 'child' });
  assert.equal(again.id, ref.id);
  const file = path.join(NOTEBOOKS_DIR, NAME, 'chapters/intro.md');
  await fs.writeFile(file, `# Intro\n\n## One\nText [@${ref.id}] and [@missing].\n`);
  const v = await validateNotebook(NAME);
  assert.deepEqual(v.errors, ['chapters/intro.md: citation [@missing] has no entry in references.json']);
  const nb = await loadNotebookForViewer(NAME);
  assert.deepEqual(nb.toc.chapters.map((c) => c.id), ['before-intro', 'intro']);
  assert.equal(nb.toc.chapters[1].children[0].id, 'child');
  assert.deepEqual(nb.toc.chapters[1].topics, [{ id: 'one', title: 'One' }]);
});

test('planned chapters are promoted in place', async (t) => {
  const name = `${NAME}-plan`;
  t.after(() => fs.rm(path.join(NOTEBOOKS_DIR, name), { recursive: true, force: true }));
  await createNotebook(name, { title: 'Plan', scope: 'general' });
  await addChapter(name, { title: 'One' });
  await addChapter(name, { title: 'Two', summary: 'later', planned: true });
  await addChapter(name, { title: 'Three', planned: true });
  assert.deepEqual((await validateNotebook(name)).errors, []);
  let nb = await loadNotebookForViewer(name);
  assert.equal(nb.toc.chapters[1].status, 'planned');
  assert.equal(nb.toc.chapters[1].file, undefined);
  const promoted = await addChapter(name, { id: 'two' });
  assert.ok(promoted.promoted);
  nb = await loadNotebookForViewer(name);
  assert.deepEqual(nb.toc.chapters.map((c) => [c.id, c.status || 'written']), [['one', 'written'], ['two', 'written'], ['three', 'planned']]);
  assert.equal(nb.toc.chapters[1].summary, 'later');
  assert.deepEqual((await validateNotebook(name)).errors, []);
});

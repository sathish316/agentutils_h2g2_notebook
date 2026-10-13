#!/usr/bin/env node
// h2g2 CLI: the tool surface agents use to create and maintain notebooks.
// Run from anywhere: node <repo>/framework/cli.mjs <command> ...
import { parseArgs } from 'node:util';
import path from 'node:path';
import {
  createNotebook, addChapter, addReference, validateNotebook, listNotebooks,
  loadNotebookForViewer, flatten, ROOT,
} from './lib/notebook.mjs';

const HELP = `h2g2 — notebook tools

  new <name> --title "T" --scope general|org [--description "D"]
      Scaffold notebooks/<name>/ (notebook.json, toc.json, references.json, chapters/, assets/).

  chapter <name> --title "T" [--id ID] [--summary "S"] [--after ID | --before ID | --parent ID] [--file F]
      Add a TOC entry and create chapters/<id>.md (with "# T") if it does not exist.

  plan <name> --title "T" [--id ID] [--summary "S"] [--after ID | --before ID | --parent ID]
      Add a PLANNED chapter to the TOC (no file yet; shown greyed out in the viewer).
      Write it later with: chapter <name> --id ID   (promotes the planned entry in place)

  ref <name> --category "C" --title "T" [--url U] [--source web|confluence|twg|jira|bitbucket|other]
             [--chapter ID] [--note "N"] [--id ID]
      Add a reference (deduplicated by URL). Prints the id to cite as [@id].

  validate <name>      Check TOC, files, citations, embeds. Exit 1 on errors.
  toc <name>           Print the TOC with topics.
  list                 List notebooks.

Add --json to any command for machine-readable output.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' }, scope: { type: 'string' }, description: { type: 'string' },
    id: { type: 'string' }, summary: { type: 'string' }, after: { type: 'string' },
    before: { type: 'string' }, parent: { type: 'string' }, file: { type: 'string' },
    category: { type: 'string' }, url: { type: 'string' }, source: { type: 'string' },
    chapter: { type: 'string' }, note: { type: 'string' },
    json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});

const [cmd, name] = positionals;
const print = (human, data) => console.log(values.json ? JSON.stringify(data, null, 2) : human);
const need = (v, what) => { if (!v) throw new Error(`missing ${what}\n\n${HELP}`); return v; };

try {
  switch (values.help ? 'help' : cmd) {
    case 'new': {
      const dir = await createNotebook(need(name, '<name>'), values);
      print(`Created ${path.relative(ROOT, dir)}/\nView at /notebooks/${name}/`, { dir });
      break;
    }
    case 'chapter': {
      const c = await addChapter(need(name, '<name>'), values);
      print(`${c.promoted ? 'Promoted planned chapter' : 'Added chapter'} ${c.id} -> ${path.relative(ROOT, c.path)}`, c);
      break;
    }
    case 'plan': {
      const c = await addChapter(need(name, '<name>'), { ...values, planned: true });
      print(`Planned chapter ${c.id}`, c);
      break;
    }
    case 'ref': {
      const r = await addReference(need(name, '<name>'), values);
      print(`Reference ${r.id} — cite as [@${r.id}]`, r);
      break;
    }
    case 'validate': {
      const res = await validateNotebook(need(name, '<name>'));
      const lines = [...res.errors.map((e) => `error: ${e}`), ...res.warnings.map((w) => `warn:  ${w}`)];
      print(lines.length ? lines.join('\n') : 'ok', res);
      if (res.errors.length) process.exitCode = 1;
      break;
    }
    case 'toc': {
      const nb = await loadNotebookForViewer(need(name, '<name>'));
      const lines = flatten(nb.toc.chapters).map((c) => {
        const pad = '  '.repeat(c.depth);
        const topics = c.topics.map((t) => `${pad}    · ${t.title}`).join('\n');
        return `${pad}- ${c.title}  [${c.id}] ${c.status === 'planned' ? '(planned)' : c.file}${c.missing ? '  (MISSING)' : ''}${topics ? '\n' + topics : ''}`;
      });
      print(`${nb.meta.title} (${nb.meta.scope})\n${lines.join('\n') || '(no chapters)'}`, nb.toc);
      break;
    }
    case 'list': {
      const all = await listNotebooks();
      print(all.map((n) => `${n.name.padEnd(16)} ${n.initialized ? `${n.chapterCount} chapters  ${n.scope}` : '(not initialized)'}`).join('\n'), all);
      break;
    }
    default:
      console.log(HELP);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}

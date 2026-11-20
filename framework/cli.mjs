#!/usr/bin/env node
// h2g2 CLI: the tool surface agents use to create and maintain notebooks.
// Run from anywhere: node <repo>/framework/cli.mjs <command> ...
import { parseArgs } from 'node:util';
import path from 'node:path';
import { movePlace } from './lib/places.mjs';
import { locate } from './lib/paths.mjs';
import { createFolder, deleteFolder, renameFolder, listFolders, moveToFolder, MAX_FOLDER_DEPTH } from './lib/folders.mjs';
import {
  createNotebook, addChapter, addReference, validateNotebook, listNotebooks,
  loadNotebookForViewer, flatten, setArchived, setTags, ROOT,
} from './lib/notebook.mjs';

const HELP = `h2g2 — notebook tools

  new <name> --title "T" --scope general|org [--description "D"] [--folder F]
      Scaffold notebooks/<name>/ (notebook.json, toc.json, references.json, chapters/, assets/); with --folder it is
      created inside that existing local folder.

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
  tag <name> <tag...>    Add tags (shown as #tag under the cover; filterable in the library).
  untag <name> <tag...>  Remove tags.
  archive <name>       Hide a notebook from the library (it stays on disk).
  unarchive <name>     Show an archived notebook in the library again.
  place <name> [local|saved|shared]
      Show where a notebook lives, or move its folder there: local = notebooks/, saved / shared = the clone of the
      repo set in Settings (.h2g2/saved, .h2g2/shared). Refused if that repo is not configured or the name is taken.
  folder list                      List folders and how many notebooks each holds.
  folder new <path>                Create an empty folder. A folder is one thing across Local, Saved and Shared: it
      holds notebooks of any place, and its directory appears in a place when one of that place's notebooks goes in.
      Nesting is limited by MAX_FOLDER_DEPTH in framework/lib/paths.mjs (now ${MAX_FOLDER_DEPTH}).
  folder rename <path> <new-name>  Rename a folder in every place that has it (notebooks keep their names).
  folder rm <path>                 Delete an empty folder (in every place that has it).
  folder move <name> [<folder>]    Move a notebook into a folder; omit <folder> (or give /) to move it back to the
      top level. The notebook stays in its place, and keeps its folder if you move it to another place.
  list                 List notebooks with their place (local, saved or shared); archived ones are marked.

Add --json to any command for machine-readable output.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' }, scope: { type: 'string' }, description: { type: 'string' },
    id: { type: 'string' }, summary: { type: 'string' }, after: { type: 'string' },
    before: { type: 'string' }, parent: { type: 'string' }, file: { type: 'string' },
    category: { type: 'string' }, url: { type: 'string' }, source: { type: 'string' },
    chapter: { type: 'string' }, note: { type: 'string' }, folder: { type: 'string' },
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
    case 'tag': case 'untag': {
      need(name, '<name>');
      const given = positionals.slice(2);
      if (!given.length) throw new Error(`missing <tag...>\n\n${HELP}`);
      const cur = (await listNotebooks()).find((n) => n.name === name);
      if (!cur) throw new Error(`No notebook folder "${name}"`);
      const drop = new Set(given.map((t) => String(t).replace(/^#+/, '').toLowerCase()));
      const next = cmd === 'tag' ? [...cur.tags, ...given] : cur.tags.filter((t) => !drop.has(t));
      const tags = await setTags(name, next);
      print(tags.length ? tags.map((t) => `#${t}`).join(' ') : '(no tags)', { name, tags });
      break;
    }
    case 'archive': case 'unarchive': {
      const archived = await setArchived(need(name, '<name>'), cmd === 'archive');
      print(`${archived ? 'archived' : 'unarchived'} ${name}`, { name, archived });
      break;
    }
    case 'place': {
      need(name, '<name>');
      const target = positionals[2];
      const here = locate(name);
      if (!here) throw new Error(`No notebook folder "${name}"`);
      if (!target) { print(here.place, { name, place: here.place }); break; }
      const r = await movePlace(name, target);
      print(r.changed ? `moved ${name}: ${r.from} -> ${r.place}` : `${name} is already ${r.place}`, r);
      break;
    }
    case 'folder': {
      const [, sub, a, b] = positionals;
      if (sub === 'list' || !sub) {
        const all = listFolders();
        print(all.length ? all.map((f) => `${f.path.padEnd(20)} ${f.notebooks} notebook${f.notebooks === 1 ? '' : 's'}`).join('\n') : '(no folders)', { maxDepth: MAX_FOLDER_DEPTH, folders: all });
      } else if (sub === 'new') {
        const parts = need(a, '<path>').split('/').filter(Boolean);
        const f = await createFolder(parts.pop(), { parent: parts.join('/') });
        print(`Created folder ${f.path}`, f);
      } else if (sub === 'rename') {
        const r = await renameFolder(need(a, '<path>'), need(b, '<new-name>'));
        print(r.changed ? `renamed ${r.from} -> ${r.path}${r.notebooks.length ? ` (${r.notebooks.join(', ')})` : ''}` : `${a} already has that name`, r);
      } else if (sub === 'rm') {
        const f = await deleteFolder(need(a, '<path>'));
        print(`Deleted folder ${f.path}`, f);
      } else if (sub === 'move') {
        const target = !b || b === '/' ? '' : b;
        const r = await moveToFolder(need(a, '<name>'), target);
        print(r.changed ? `moved ${a}: ${r.from || '/'} -> ${r.folder || '/'}` : `${a} is already in ${r.folder || '/'}`, r);
      } else {
        throw new Error(`unknown folder command "${sub}"\n\n${HELP}`);
      }
      break;
    }
    case 'list': {
      const all = await listNotebooks();
      print(all.map((n) => `${n.name.padEnd(16)} ${n.place.padEnd(7)} ${n.initialized ? `${n.chapterCount} chapters  ${n.scope}` : '(not initialized)'}${n.folder ? `  in ${n.folder}/` : ''}${n.archived ? '  [archived]' : ''}${n.tags.length ? `  ${n.tags.map((t) => `#${t}`).join(' ')}` : ''}`).join('\n'), all);
      break;
    }
    default:
      console.log(HELP);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
}

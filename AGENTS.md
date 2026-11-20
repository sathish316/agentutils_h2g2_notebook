# AGENTS.md

H2G2 (Hitchhiker's Guide to the Galaxy) builds **dynamic notebooks**: structured, evolving learning guides on any topic. See `README.md` for the vision and `framework/FORMAT.md` for the exact file format and rendering primitives.

## Using the framework

```bash
npm install            # once
npm start              # http://127.0.0.1:4242  (PORT/HOST env vars to change)
```

- **Library** `/` — notebooks as covers; "New notebook" creates one from the browser. Hover a cover to archive it (sets `"archived": true` in `notebook.json`); archived notebooks move to the **Archived** tab, where they can be restored. **New folder** makes a folder (one level deep). A folder is one thing across places: it holds Local, Saved and Shared notebooks alike (its directory appears in a place when one of that place's notebooks goes in). Click a folder to browse its notebooks, and move a notebook into one from the cover's gear dialog (a notebook keeps its folder when moved between places). The **+** under a cover opens a tag picker (create a tag, or search existing ones); tags show as `#tag` and the **Tags** filter above the shelf shows notebooks with any selected tag (none selected = all).
- **Notebook** `/notebooks/<name>/` — paper pages with page turns, outline, read/unread checkboxes, and a sticky-note composer on every page (plus a ✎ per topic) to ask the ACP agent for: *new chapter · add topic · change this chapter · just answer · change the framework*. Agent progress streams into the **Agent** drawer, which has a follow-up chat box: it continues the same agent session (context kept for 2 h idle), and the agent either answers or edits the chapter (mode `followup`). Pages live-reload when files change.
- **Settings** `/settings` — default ACP agent, per-machine command overrides, connection test, permission mode (ask / auto).
- **CLI** (agents should use it for structure): `node framework/cli.mjs new|chapter|plan|ref|validate|toc|list|tag|untag|archive|unarchive|place|folder` — run with no args for help.

## Notebook anatomy

`notebooks/<name>/` contains `notebook.json` (title, description, scope `general|org`), `toc.json` (ordered chapter tree; entries with `"status": "planned"` are the not-yet-written learning plan), `references.json` (categorised sources), `chapters/<id>.md`, and `assets/`. `## ` headings are **topics** (each gets a read checkbox), so make each one self-contained.

## Two agent roles

- **Primary agent** (opened in this repo by the user): creates a notebook and its first chapter.
- **ACP agent** (Rovo, Codex, Pi, Fx, Claude… picked in the viewer): started by the server **in the repo root**, so it reads this file. Every request names the target notebook — only modify `notebooks/<that-name>/` unless the request is a framework change.

## Creating a notebook (primary agent)

**The first request produces exactly three things:**
1. **A table of contents that is an ideal learning plan**: chapter 1 (written) followed by **planned** chapters, typically 5–10, ordered from fundamentals to advanced. Planned chapters have a title and a one-line summary but no file; the viewer shows them greyed out as "planned".
2. **The first chapter**, answering the user's initial question.
3. **References for that chapter only.**

Do not write more than one chapter. The plan is a living proposal: at the end of each chapter the reader asks for what they want next, and agents then write a planned chapter (promoting it), or add, rename, reorder or drop planned entries to follow the reader's direction.

1. Decide scope: **general** or **org**. If unclear, ask the user.
2. `node framework/cli.mjs new <name> --title "…" --scope general|org --description "…"`
3. Research (sources below), then `node framework/cli.mjs chapter <name> --title "…"` and write **only** the first chapter, answering the user's initial question.
4. Lay out the learning plan: `node framework/cli.mjs plan <name> --title "…" --summary "…"` for each planned chapter, in reading order.
5. Add each source used by that chapter: `node framework/cli.mjs ref <name> --category "…" --title "…" --url … --source … --chapter <id>`; cite as `[@id]`.
6. `node framework/cli.mjs validate <name>` — fix every error. Tell the user to open `/notebooks/<name>/`.

## Adding to a notebook (ACP agent)

One request = one change: a single new chapter, a single topic, or one edit. Never generate several chapters in one go. If the request matches a planned chapter, write that one: `node framework/cli.mjs chapter <name> --id <planned-id>` promotes it in place. Keep the plan current: add, rename, reorder or drop **planned** entries when the reader's questions change direction, but never delete written chapters. Read the current TOC, write in the requested place (don't just append), keep existing topic headings stable (they key reading progress), add references, validate, and reply with a 2–4 line summary.

## Sources by scope

| Scope | Sources |
|---|---|
| General | Internet |
| Org | Confluence and Teamwork Graph CLI (`twg`) first; internet for public background |

## Chapter guidelines

- Use the primitives in `framework/FORMAT.md`: mermaid / svg (zoomable), `viz` HTML (sandboxed), runnable `python`/`sql`/`js` blocks, callouts, sortable tables, citations.
- Explain → visualise → let the reader explore. End with "Key takeaways".
- Cite every non-obvious claim. Never invent org-specific facts; if a source can't be found, say so.
- Keep chapters focused (5–15 min read); split large topics.

## Changing the framework

Viewer: `framework/viewer/` (no build step, ES modules; new primitives in `js/primitives/`, registered in `primitives/index.js`). Server: `framework/server/` (ACP client, session manager). Prompts: `framework/prompts/`. Document any new primitive in `framework/FORMAT.md`. Run `npm test` after lib/server changes.

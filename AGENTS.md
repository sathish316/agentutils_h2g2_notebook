# AGENTS.md

H2G2 (Hitchhiker's Guide to the Galaxy) builds **dynamic notebooks**: structured, evolving learning guides on any topic. See `README.md` for the vision and `framework/FORMAT.md` for the exact file format and rendering primitives.

## Using the framework

```bash
npm install            # once
npm start              # http://127.0.0.1:4242  (PORT/HOST env vars to change)
```

- **Library** `/` — notebooks as covers; "New notebook" creates one from the browser.
- **Notebook** `/notebooks/<name>/` — paper pages with page turns, outline, read/unread checkboxes, and a sticky-note composer on every page (plus a ✎ per topic) to ask the ACP agent for: *new chapter · add topic · change this chapter · just answer · change the framework*. Agent progress streams into the **Agent** drawer; pages live-reload when files change.
- **Settings** `/settings` — default ACP agent, per-machine command overrides, connection test, permission mode (ask / auto).
- **CLI** (agents should use it for structure): `node framework/cli.mjs new|chapter|ref|validate|toc|list` — run with no args for help.

## Notebook anatomy

`notebooks/<name>/` contains `notebook.json` (title, description, scope `general|org`), `toc.json` (ordered chapter tree), `references.json` (categorised sources), `chapters/<id>.md`, and `assets/`. `## ` headings are **topics** (each gets a read checkbox), so make each one self-contained.

## Two agent roles

- **Primary agent** (opened in this repo by the user): creates a notebook and its first chapter.
- **ACP agent** (Rovo, Codex, Pi, Fx, Claude… picked in the viewer): started by the server **in the repo root**, so it reads this file. Every request names the target notebook — only modify `notebooks/<that-name>/` unless the request is a framework change.

## Creating a notebook (primary agent)

1. Decide scope: **general** or **org**. If unclear, ask the user.
2. `node framework/cli.mjs new <name> --title "…" --scope general|org --description "…"`
3. Research (sources below), then `node framework/cli.mjs chapter <name> --title "…"` and write the chapter.
4. Add each source: `node framework/cli.mjs ref <name> --category "…" --title "…" --url … --source … --chapter <id>`; cite as `[@id]`.
5. `node framework/cli.mjs validate <name>` — fix every error. Tell the user to open `/notebooks/<name>/`.

## Adding to a notebook (ACP agent)

Read the current TOC, write in the requested place (don't just append), keep existing topic headings stable (they key reading progress), add references, validate, and reply with a 2–4 line summary.

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

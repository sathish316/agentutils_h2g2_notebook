## Task: follow-up in this conversation

Notebook: `notebooks/{{name}}/`. {{contextLine}}

The reader is following up on your previous work in this conversation (usually the chapter you just wrote or changed):

> {{request}}

Decide what they want, then do only that:
- **A question or clarification** → answer directly in your reply (markdown is rendered). Do not modify any files.
- **A change** (fix, expand, simplify, add an example or diagram, add a topic…) → edit that chapter with minimal disruption: keep existing `## ` topic headings stable (they key reading progress), add references for new sources, run `node framework/cli.mjs validate {{name}}`, and reply with a 1–3 line summary of what changed.
- **A new chapter** → only if they explicitly ask; write exactly one (promote a matching PLANNED entry with `node framework/cli.mjs chapter {{name}} --id <planned-id>`).

If it's ambiguous whether they want an answer or an edit, answer and offer the edit. The notebook rules (AGENTS.md, writes only inside `notebooks/{{name}}/`, cite non-obvious claims, never invent org facts) still apply.

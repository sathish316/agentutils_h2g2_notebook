# AGENTS.md

H2G2 (Hitchhiker's Guide to the Galaxy) builds **dynamic notebooks**: structured, evolving learning guides on any topic. See `README.md` for the full vision.

## Notebook anatomy

Each notebook lives in `notebooks/{name}/` and is served at `http://host:port/notebooks/{name}/index.html`. It has:

1. **Table of contents** – living outline; update it whenever a chapter is added or moved.
2. **Chapters** – notes, visuals (mermaid, SVG, HTML visualizations), hands-on explorations, deep dives.
3. **References** – sources used, grouped into reference categories.
4. **Scope metadata** – `general` or `org-specific`; persisted so ACP agents generating later chapters inherit it.

The viewer provides per-topic read/unread checkboxes (browser storage) and a per-chapter question box that triggers new chapters.

## Two agent roles

- **Primary agent** (you, opened in this repo): creates a notebook and its first chapter from the user's initial questions. Determines scope and records it for subsequent agents.
- **ACP agent** (Rovo, Alta, Codex, Pi, Fx, … chosen in the notebook settings page): runs in the notebook's directory, receives a base prompt + the user's follow-up question, and adds the next chapter.

## Creating a notebook (primary agent)

1. Pick a short notebook name; create `notebooks/{name}/` if missing.
2. Decide scope: **general** or **org-specific**. If unclear, ask the user.
3. Research using the sources for that scope (below).
4. Write chapter 1 answering the user's initial questions.
5. Create the table of contents, references, and scope metadata.

## Adding a chapter (ACP agent)

1. Read the existing TOC, references, and scope metadata.
2. Write the chapter answering the user's question.
3. Insert it at the right place in the TOC (not just appended).
4. Add the sources used to the references under the appropriate category.

## Sources by scope

| Scope | Sources |
|---|---|
| General | Internet |
| Org-specific | Confluence, Teamwork Graph CLI (`twg`), plus internet for background |

## Chapter guidelines

- Prefer diagrams (mermaid/SVG/HTML) where they clarify structure or flow.
- Include hands-on examples or explorations where the topic allows.
- Cite every non-obvious claim; every source must appear in references.
- Never invent org-specific facts. If a source can't be found, say so.
- Keep chapters focused; split large topics into multiple chapters.

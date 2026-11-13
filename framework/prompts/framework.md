## Task: change the H2G2 framework

The reader, working in notebook "{{name}}", asked for a change to the framework itself:

> {{request}}

For this request you may edit the framework in `framework/` (and `AGENTS.md`/`README.md` if usage changes):
- `framework/viewer/` — browser viewer (no build step; ES modules). New rendering primitives go in `framework/viewer/js/primitives/` and are registered in `primitives/index.js`.
- `framework/server/` — Node HTTP server, ACP client, session manager.
- `framework/prompts/` — these prompt templates.
- `framework/lib/notebook.mjs` + `framework/cli.mjs` — notebook model and CLI.
- `framework/FORMAT.md` — the primitives reference. **Document any new primitive there**, since other agents rely on it.

Keep changes small and consistent with the existing code style. Don't add npm dependencies unless necessary. Don't change existing notebook content. Run `npm test` if you touched lib/server code. Reply with a short summary and whether the server needs a restart (viewer changes only need a browser refresh).

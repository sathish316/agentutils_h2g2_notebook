## Task: write ONE new chapter

The reader asked{{contextSuffix}}:

> {{request}}
{{firstNote}}
1. If the request matches a PLANNED chapter in the TOC, write that one by promoting it (`node framework/cli.mjs chapter <nb> --id <planned-id>`). Otherwise decide where the chapter belongs in the TOC (after the chapter it builds on, or as a child of a broader chapter). Don't just append.
2. Create it with the CLI, then write the chapter: `# Title`, a short "why this matters" intro, `## ` topics, at least one visual (mermaid/svg/viz) and, where useful, a runnable exploration, then "Key takeaways".
3. Adjust the plan if the reader's direction has changed: add, rename, reorder or drop **planned** entries (`node framework/cli.mjs plan …`, or edit toc.json). Never delete written chapters.
4. Add references for this chapter only and validate. Don't create further chapters; if the topic is big, mention in your reply what the reader could ask for next.

# Overview

Hitchhiker's guide to the galaxy is a dynamic notebook that can build a structured guide to learn about any topic.

Every notebook is a structured guide to learn about a topic. Every notebook contains:
1. Table of contents - outline of the notebook, which is living and constantly evolving.
2. Chapters - notes about specific topics, informational, visual (mermaid diagrams, svg diagrams, html visualizations etc), hands-on explorations and deep dives about a specific topic
3. References - list of references to the sources of information.

The first chapter is created based on the initial user questions about a topic. The first request generates only the table of contents, the first chapter, and the references used by that chapter, never multiple chapters in one go. The initial table of contents is an ideal learning plan: besides the first chapter it lists planned chapters, shown greyed out as pending. Based on what the user asks at the end of each chapter, the table of contents is revised (planned chapters added, edited, reordered or dropped), and each chapter or topic is generated one at a time, when the reader asks for it.
After a chapter is read by a user, they can track read/unread topics in a checkbox per topic using Browser memory.
Every chapter comes with a textbox that allows the user to ask further questions and get new chapters or topics generated per topic.

H2G2 dynamic notebooks come with a set of foundational tools to use markdown, markdown to html viewers, mermaid diagram, svg diagrams, html visualizations and other tools to create dynamic and interactive notebooks.

The first chapter of the notebook is created by opening this repo in your agent and asking it to create a notebook about a specific topic.

The notebooks are hosted as a web service (http://host:port/notebooks/{name}/index.html) and have ACP (agent client protocol) based connection to available ACP based agents. Supported ACP based agents are: Rovo, Codex, Pi, Fx etc. The notebook comes with a settings page where the user can select the ACP based agent they would like to use to create subsequent chapters. The ACP based agent is initialized in the repo root (so it reads AGENTS.md for instructions on using the notebook and the framework), and each request tells it which notebook to update. It is provided with a set of tools to create further chapters. When a user asks for a new chapter, a base prompt appended with user request is sent to the ACP based agent to generate the next chapter. The ACP agent will create a chapter, add the chapter in the right place in table of contents, and update references list with the references used in a set of reference categories.

The agent that generates the first chapter and ACP agent that generates subsequent chapters use the following tools and resources:
1. Internet access for general topics
2. Confluence for org specific topics
3. Teamwork graph CLI for org specific topics

If the agent is unsure whether the topic is general or org specific, it can ask the user. The primary agent is responsible for passing this general or org specific metadata to the ACP agent for subsequent chapters.

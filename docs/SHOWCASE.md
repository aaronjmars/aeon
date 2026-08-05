<p align="center">
  <img src="assets/aeon.jpg" alt="Aeon" width="80" />
</p>

<h1 align="center">Showcase</h1>

<p align="center">
  How Aeon compares to the agent tools you've already heard of.
</p>

---

## How Aeon compares

Aeon is one of many ways to build agentic systems. Here's where it sits next to the other tools developers commonly evaluate.

|  | **Aeon** | Claude Code | Hermes | OpenClaw |
|--|----------|-------------|--------|----------|
| **Runtime** | GitHub Actions (no machine) | Local terminal | Local — terminal + chat | Local — your computer |
| **Operator posture** | Configure once, walk away | Interactive, you drive each session | Autonomous, on your machine | Autonomous, on your machine |
| **Stays on without you** | Yes — runs in the cloud on a schedule | No — needs your terminal open | No — needs your machine running | No — needs your machine running |
| **Scheduling** | Cron, native to runtime | None — you invoke it | Chat / event driven | Chat / event driven |
| **Skill format** | Plain Markdown (`SKILL.md`) | Markdown skills + MCP | Skill documents | Plugins / skills |
| **Persistent memory** | File-based, version-controlled | Session + `CLAUDE.md` | Persistent memory | Persistent memory |
| **Self-healing** | Yes — `skill-health` + `skill-repair` auto-patch failing skills | No | No | No |
| **Quality scoring** | Every run scored 1–5 by a model | No | No | No |
| **Reactive triggers** | Yes — `schedule: "reactive"` fires on conditions | No | Message triggers | Message triggers |
| **Setup floor** | `git clone` + secrets | Install the CLI | Install + pick a provider | Install + pick a provider |
| **Hosting cost** | Free on public repos (Actions minutes) | Your machine | Your machine | Your machine |
| **External integration** | MCP server | MCP | MCP / tools | Tools / connectors |

### One-line summary

- **Claude Code** — Anthropic's interactive coding agent in your terminal. Best when you're in the loop, pairing on code session by session.
- **Hermes** — Nous Research's open-source, model-agnostic agent across your terminal and chat apps. Best when you want a self-improving assistant you talk to that runs on your own machine.
- **OpenClaw** — Open-source computer-use agent that runs locally and lives in your chat apps. Best when you want an agent driving your own machine — files, shell, browser — on demand.
- **Aeon** — A configured-and-forgotten background agent on GitHub Actions. Best when the work is *recurring* (briefs, monitoring, PR reviews, research digests) and you want it to run without you — and without your machine on — score itself, and patch itself when it breaks.

The real distinction is *where it runs and who's watching it*. Claude Code is a tool you drive, session by session. Hermes and OpenClaw are autonomous, but they live on your machine and in your chats — you keep the host running. Aeon runs in the cloud on GitHub Actions: point it at a goal and leave. The cron, the memory, the self-healing, and the public dashboard come included, and nothing on your desk has to stay on.

If you need an agent you watch, pick one of the others. If you need an agent that watches itself, this is the lane.

---

## Corrections

Maintainers of the listed tools: corrections to the comparison are welcome — open an issue or a PR.

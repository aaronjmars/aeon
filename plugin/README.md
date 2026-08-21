# Aeon operator console (plugin)

The operator-facing skill for [Aeon](https://github.com/aeonfun/aeon), an autonomous
agent framework that runs your own skills on a schedule in GitHub Actions. This
plugin ships that one skill so you can drive an Aeon instance straight from your
coding agent: get started from scratch, turn skills on or off, schedule or
reschedule what runs, edit what a skill does, debug a skill that will not fire,
set the `STRATEGY.md` north star and soul voice, and mine past coding-agent chats
into new scheduled skills.

It is a self-contained copy of the setup skill only - installing it never pulls in
the unattended framework catalog. Full setup guide:
[`docs/aeon-setup.md`](https://github.com/aeonfun/aeon/blob/main/docs/aeon-setup.md).

## Install

**Claude Code**

```
/plugin marketplace add aeonfun/aeon
/plugin install aeon@aeon
```

**Codex**

```
codex plugin marketplace add aeonfun/aeon
codex plugin add aeon@aeon
```

Then type `/aeon` (or mention Aeon / `aeon.yml` / "schedule a skill") and point it
at your instance repo when it asks.

## What it needs

- The [GitHub CLI](https://cli.github.com/) (`gh`) authenticated - the skill drives
  everything through `gh`, the same way the dashboard does.
- An Aeon instance repo to operate on (create one from the
  [template](https://github.com/aeonfun/aeon)).

Everything the skill does is plain `gh` + `./aeon` commands, so nothing about it is
tied to one coding agent beyond where the skill file is loaded from.

## License

MIT - see [`LICENSE`](./LICENSE).

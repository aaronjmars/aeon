// Aeon CLI — non-interactive control of an Aeon repo. Reuses apps/dashboard/lib
// so every command returns/does exactly what the dashboard's /api/* routes do.
import { setJsonMode, setDryRun, c, fail } from './output.ts'
import { skillsCommand } from './commands/skills.ts'
import { runsCommand } from './commands/runs.ts'
import { secretsCommand } from './commands/secrets.ts'
import { configCommand } from './commands/config.ts'
import { memoryCommand } from './commands/memory.ts'
import { authCommand } from './commands/auth.ts'
import { syncCommand } from './commands/sync.ts'
import { strategyCommand } from './commands/strategy.ts'
import { soulCommand } from './commands/soul.ts'
import { packsCommand } from './commands/packs.ts'
import { mcpCommand } from './commands/mcp.ts'
import { telegramCommand } from './commands/telegram.ts'

const USAGE = `${c.bold('aeon')} — command-line control of this Aeon repo

Usage: aeon <command> [subcommand] [options]

Read:
  skills ls|<name>    Skill roster + per-skill detail
  runs ls|logs <id>   Recent workflow runs + a run's log/summary
  secrets ls          Credential vault (names + set-state, never values)
  config show         Top-level settings (model, harness, gateway) from aeon.yml
  memory …            Browse memory (logs, topics, issues, search)
  packs ls            Skill packs (first-party + community)
  mcp ls|catalog      MCP servers in .mcp.json + the featured catalog
  strategy show       STRATEGY.md   ·   soul show → soul/SOUL.md + STYLE.md

Write:
  skills enable|disable|schedule|set|rm|run <name>
  secrets set|rm <NAME>          config set model|harness|gateway <v>
  auth --oauth|--key <k>         sync [--status]
  strategy set|build             soul build
  packs install <owner/repo>     mcp add|rm            telegram register

Global options:
  --json       Machine-readable JSON output
  --dry-run    Preview a mutating command without writing / dispatching / pushing
  -h, --help   Help (works per-command too, e.g. \`aeon skills --help\`)`

// Partial: `cmd` is argv, so the miss is real — without it the `if (!handler)`
// guard below is dead code the compiler believes can never fire.
const COMMANDS: Partial<Record<string, (argv: string[]) => void | Promise<void>>> = {
  skills: skillsCommand,
  runs: runsCommand,
  secrets: secretsCommand,
  config: configCommand,
  memory: memoryCommand,
  auth: authCommand,
  sync: syncCommand,
  strategy: strategyCommand,
  soul: soulCommand,
  packs: packsCommand,
  mcp: mcpCommand,
  telegram: telegramCommand,
}

async function main() {
  // Pull the global flags out of argv wherever they appear, so commands only see
  // their own args.
  let argv = process.argv.slice(2)
  if (argv.includes('--json')) { setJsonMode(true); argv = argv.filter(a => a !== '--json') }
  if (argv.includes('--dry-run')) { setDryRun(true); argv = argv.filter(a => a !== '--dry-run') }

  const cmd = argv[0]
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE)
    return
  }

  const handler = COMMANDS[cmd]
  if (!handler) {
    fail(`unknown command: ${cmd}\n\nRun \`aeon --help\` for the command list.`)
  }

  await handler(argv.slice(1))
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  // Surface the gh/git failures the shared lib throws as clean CLI errors.
  fail(msg)
})

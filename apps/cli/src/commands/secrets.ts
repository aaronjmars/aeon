import { readFileSync } from 'node:fs'
import {
  getSecrets, setSecret, deleteSecret, VALID_SECRET_NAME,
} from '../../../dashboard/lib/secrets-catalog.ts'
import type { Secret } from '../../../dashboard/lib/types.ts'
import { emit, table, c, fail, isDryRun, requireGh, truncate } from '../output.ts'

const USAGE = `aeon secrets — the credential vault (names + set-state, never values)

Read:
  aeon secrets ls [--set] [--unset]    List every known secret, grouped

Write (uses gh; never prints values):
  aeon secrets set <NAME> --stdin      Set from stdin (recommended)
  aeon secrets set <NAME> <value>      Set from an argument (leaks in shell history)
  aeon secrets rm <NAME>               Delete a secret

Options:
  --set / --unset   Filter \`ls\`
  --dry-run         Preview a write without calling gh
  --json            Machine-readable output`

export async function secretsCommand(argv: string[]) {
  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'ls'
  if (sub === 'help' || argv.includes('-h') || argv.includes('--help')) { console.log(USAGE); return }
  if (sub === 'set') return setCmd(argv.slice(1))
  if (sub === 'rm') return rmCmd(argv.slice(1))
  if (sub !== 'ls') fail(`unknown subcommand: ${sub}\n\n${USAGE}`)

  const { secrets, ghReady } = getSecrets()
  if (!ghReady) fail('GitHub CLI not authenticated — cannot read secret state. Run: gh auth login')

  const onlySet = argv.includes('--set')
  const onlyUnset = argv.includes('--unset')
  let rows = secrets
  if (onlySet) rows = rows.filter(s => s.isSet)
  if (onlyUnset) rows = rows.filter(s => !s.isSet)

  emit(rows, () => {
    if (rows.length === 0) { console.log(c.dim('(no matching secrets)')); return }
    const groups = new Map<string, Secret[]>()
    for (const s of rows) {
      const g = groups.get(s.group) ?? []
      g.push(s)
      groups.set(s.group, g)
    }
    for (const [group, items] of groups) {
      console.log(c.bold(group))
      table(
        ['', 'NAME', 'NOTE'],
        items.map(s => [
          s.isSet ? c.green('✓') : c.dim('·'),
          s.isSet ? s.name : c.dim(s.name),
          truncate(s.description, 64),
        ]),
      )
      console.log()
    }
    const set = rows.filter(s => s.isSet).length
    console.log(c.dim(`${rows.length} secrets · ${set} set`))
  })
}

function requireSecretName(args: string[]): string {
  const name = args.find(a => !a.startsWith('-'))
  if (!name) fail('a secret NAME is required')
  if (!VALID_SECRET_NAME.test(name)) fail('invalid secret name — use UPPER_SNAKE_CASE')
  return name
}

async function setCmd(args: string[]) {
  requireGh()
  const name = requireSecretName(args)
  let value: string
  if (args.includes('--stdin')) {
    value = readFileSync(0, 'utf-8').replace(/\n$/, '')
  } else {
    const positional = args.filter(a => !a.startsWith('-') && a !== name)[0]
    if (positional === undefined) fail('provide a value: `--stdin` (recommended) or a positional value')
    value = positional
  }
  if (!value) fail('empty value')

  if (isDryRun()) {
    return emit({ label: `set ${name}`, dryRun: true }, () =>
      console.log(c.yellow('dry-run: ') + `would set secret ${name} (${value.length} chars) via gh`))
  }
  await setSecret(name, value)
  emit({ ok: true, set: name }, () => console.log(c.green('✓ ') + `set ${name}`))
}

async function rmCmd(args: string[]) {
  requireGh()
  const name = requireSecretName(args)
  if (isDryRun()) {
    return emit({ label: `rm ${name}`, dryRun: true }, () =>
      console.log(c.yellow('dry-run: ') + `would delete secret ${name} via gh`))
  }
  await deleteSecret(name)
  emit({ ok: true, deleted: name }, () => console.log(c.green('✓ ') + `deleted ${name}`))
}

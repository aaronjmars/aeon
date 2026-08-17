import { parseArgs } from 'node:util'
import { getSkills } from '../../../dashboard/lib/skills.ts'
import { updateSkillInConfig, upsertSkillInConfig, removeSkillFromConfig } from '../../../dashboard/lib/config.ts'
import { getFileContent, saveFile, deleteDirectory, commitAndPush } from '../../../dashboard/lib/github.ts'
import { runSkill, buildSkillRunArgs } from '../../../dashboard/lib/run-skill.ts'
import type { Skill } from '../../../dashboard/lib/types.ts'
import { emit, table, c, fail, isDryRun, truncate } from '../output.ts'
import { applyConfig, reportConfig, printSync } from '../mutate.ts'

const USAGE = `aeon skills — inspect and configure the skill roster

Read:
  aeon skills ls [--enabled] [--pack <key>]   List skills with their live config
  aeon skills <name>                          Show one skill's detail

Write (edit aeon.yml, commit + push):
  aeon skills enable <name>                   Turn a skill on
  aeon skills disable <name>                  Turn a skill off
  aeon skills schedule <name> "<cron>"        Set its cron schedule
  aeon skills set <name> [--var …] [--model …] [--harness grok|claude]
  aeon skills rm <name> --yes                 Delete the skill dir + config entry
  aeon skills run <name> [--var …] [--model …]  Dispatch a run (gh workflow run)

Options:
  --enabled / --pack <key>   Filter \`ls\`
  --dry-run                  Preview a write without committing
  --json                     Machine-readable output`

const NAME_RE = /^[a-z][a-z0-9-]*$/

export async function skillsCommand(argv: string[]) {
  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'ls'
  const rest = argv[0] === sub ? argv.slice(1) : argv

  if (sub === 'help' || argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE); return
  }

  switch (sub) {
    case 'ls': return listSkills((await getSkills()).skills, rest)
    case 'enable': return toggle(rest, true)
    case 'disable': return toggle(rest, false)
    case 'schedule': return schedule(rest)
    case 'set': return setFields(rest)
    case 'rm': return remove(rest)
    case 'run': return run(rest)
    default: return showSkill((await getSkills()).skills, sub)
  }
}

function requireName(args: string[]): string {
  const name = args.find(a => !a.startsWith('-'))
  if (!name) fail('a skill name is required')
  if (!NAME_RE.test(name)) fail(`invalid skill name: ${name}`)
  return name
}

// Guard the upsert path: `upsertSkillInConfig` creates a missing entry, so a
// typo'd name would otherwise write a bogus skill into aeon.yml. Skills are
// enumerated from disk, so this is the authoritative check.
async function requireInstalled(name: string) {
  const { skills } = await getSkills()
  if (!skills.some(s => s.name === name)) {
    fail(`unknown skill: ${name} — no skills/${name}/SKILL.md. Run \`aeon skills ls\` to see what's installed.`)
  }
}

async function toggle(args: string[], enabled: boolean) {
  const name = requireName(args)
  // Enabling upserts (a new skill has no entry yet); disabling only edits an
  // existing entry — no entry already means disabled, so there's nothing to write.
  if (!enabled) {
    const res = await applyConfig(raw => updateSkillInConfig(raw, name, { enabled }), `chore: disable ${name}`)
    reportConfig(res, `disable ${name}`)
    return
  }
  await requireInstalled(name)
  const res = await applyConfig(raw => upsertSkillInConfig(raw, name, { enabled }), `chore: enable ${name}`)
  reportConfig(res, `enable ${name}`)
}

async function schedule(args: string[]) {
  const name = requireName(args)
  const cron = args.filter(a => !a.startsWith('-') && a !== name)[0]
  if (!cron) fail('usage: aeon skills schedule <name> "<cron>"')
  await requireInstalled(name)
  const res = await applyConfig(raw => upsertSkillInConfig(raw, name, { schedule: cron }), `chore: schedule ${name}`)
  reportConfig(res, `schedule ${name} → ${cron}`)
}

async function setFields(args: string[]) {
  const name = requireName(args)
  let values: { var?: string; model?: string; harness?: string }
  try {
    ;({ values } = parseArgs({ args: args.filter(a => a !== name), options: {
      var: { type: 'string' }, model: { type: 'string' }, harness: { type: 'string' },
    }, allowPositionals: true }))
  } catch (e) { fail(e instanceof Error ? e.message : 'bad arguments') }
  const updates: Parameters<typeof updateSkillInConfig>[2] = {}
  if (typeof values.var === 'string') updates.var = values.var
  if (typeof values.model === 'string') updates.model = values.model
  if (typeof values.harness === 'string') updates.harness = values.harness
  if (Object.keys(updates).length === 0) fail('nothing to set — pass --var, --model, or --harness')
  await requireInstalled(name)
  const res = await applyConfig(raw => upsertSkillInConfig(raw, name, updates), `chore: update ${name} config`)
  reportConfig(res, `set ${name} ${Object.entries(updates).map(([k, v]) => `${k}=${v || '(clear)'}`).join(' ')}`)
}

async function remove(args: string[]) {
  const name = requireName(args)
  const yes = args.includes('--yes') || args.includes('-y')
  if (!yes && !isDryRun()) {
    fail(`refusing to delete "${name}" without --yes. This removes skills/${name}/ and its aeon.yml entry, then pushes to main.`)
  }
  if (isDryRun()) {
    emit({ label: `remove ${name}`, dryRun: true }, () =>
      console.log(c.yellow('dry-run: ') + `would delete skills/${name}/ and its aeon.yml entry, then push`))
    return
  }
  await deleteDirectory(`skills/${name}`, `chore: delete ${name} skill`)
  let configError: string | undefined
  try {
    const { content } = await getFileContent('aeon.yml')
    const updated = removeSkillFromConfig(content, name)
    if (updated !== content) await saveFile('aeon.yml', updated, { updateMsg: `chore: remove ${name} from config`, createMsg: '' })
  } catch (e) { configError = e instanceof Error ? e.message : 'failed to update aeon.yml' }
  const sync = commitAndPush(['aeon.yml', `skills/${name}`], `chore: remove ${name} skill`)
  emit({ label: `remove ${name}`, synced: sync.synced, syncError: sync.reason, configError }, () => {
    console.log(c.green('✓ ') + `removed skill ${name}`)
    if (configError) console.log(c.yellow('  aeon.yml: ') + configError)
    printSync(sync)
  })
}

function run(args: string[]) {
  const name = requireName(args)
  let values: { var?: string; model?: string }
  try {
    ;({ values } = parseArgs({ args: args.filter(a => a !== name), options: {
      var: { type: 'string' }, model: { type: 'string' },
    }, allowPositionals: true }))
  } catch (e) { fail(e instanceof Error ? e.message : 'bad arguments') }
  if (isDryRun()) {
    const ghArgs = buildSkillRunArgs(name, values)
    emit({ label: `run ${name}`, dryRun: true, command: ['gh', ...ghArgs] }, () =>
      console.log(c.yellow('dry-run: ') + 'gh ' + ghArgs.join(' ')))
    return
  }
  runSkill(name, values)
  emit({ ok: true, dispatched: name }, () => console.log(c.green('✓ ') + `dispatched ${name} — watch it with \`aeon runs ls\``))
}

function listSkills(skills: Skill[], args: string[]) {
  let opts: { values: { enabled?: boolean; pack?: string } }
  try {
    opts = parseArgs({ args, options: {
      enabled: { type: 'boolean' },
      pack: { type: 'string' },
    }, allowPositionals: false })
  } catch (e) {
    fail(e instanceof Error ? e.message : 'bad arguments')
  }

  let rows = skills
  if (opts.values.enabled) rows = rows.filter(s => s.enabled)
  if (opts.values.pack) rows = rows.filter(s => s.pack === opts.values.pack)
  rows = [...rows].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))

  emit(rows, () => {
    if (rows.length === 0) { console.log(c.dim('(no matching skills)')); return }
    table(
      ['SKILL', 'ON', 'SCHEDULE', 'PACK', 'DESCRIPTION'],
      rows.map(s => [
        s.name,
        s.enabled ? c.green('●') : c.dim('○'),
        s.enabled ? s.schedule : c.dim(s.schedule),
        s.pack,
        truncate(s.description, 60),
      ]),
    )
    const on = rows.filter(s => s.enabled).length
    console.log(c.dim(`\n${rows.length} skills · ${on} enabled`))
  })
}

function showSkill(skills: Skill[], name: string) {
  const s = skills.find(x => x.name === name)
  if (!s) fail(`no such skill: ${name}`)
  emit(s, () => {
    console.log(c.bold(s.name) + '  ' + (s.enabled ? c.green('enabled') : c.dim('disabled')))
    console.log(s.description)
    console.log()
    const rows: [string, string][] = [
      ['pack', `${s.pack}${s.packName ? ` (${s.packName})` : ''}`],
      ['category', s.category],
      ['schedule', s.schedule],
      ['var', s.var || c.dim('—')],
      ['model', s.model || c.dim('(inherit)')],
      ['harness', s.harness || c.dim('(inherit)')],
      ['requires', s.requires.map(r => r.key + (r.optional ? '?' : '')).join(', ') || c.dim('—')],
      ['mcp', s.mcp.map(m => m.slug + (m.optional ? '?' : '')).join(', ') || c.dim('—')],
    ]
    for (const [k, v] of rows) console.log(c.dim(k.padEnd(10)) + v)
  })
}

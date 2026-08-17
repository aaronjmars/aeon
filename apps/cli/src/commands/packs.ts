import { getPacks } from '../../../dashboard/lib/packs.ts'
import { runSkill, buildSkillRunArgs } from '../../../dashboard/lib/run-skill.ts'
import { emit, table, c, fail, isDryRun, requireGh, truncate } from '../output.ts'

const USAGE = `aeon packs — skill packs (first-party + community)

  aeon packs ls                          List packs with enabled/installed counts
  aeon packs install <owner/repo> [slugs…] [--branch <b>]
                                         Install a community pack (dispatches install-skill)

Options:
  --dry-run   Preview the install dispatch
  --json      Machine-readable output

Installed skills land DISABLED and security-scanned — enable them with
\`aeon skills enable <name>\` after setting any required secrets.`

export async function packsCommand(argv: string[]) {
  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'ls'
  if (sub === 'help' || argv.includes('-h') || argv.includes('--help')) { console.log(USAGE); return }
  if (sub === 'ls') return list()
  if (sub === 'install') return install(argv.slice(1))
  fail(`unknown subcommand: ${sub}\n\n${USAGE}`)
}

async function list() {
  const { firstParty, community } = await getPacks()
  emit({ firstParty, community }, () => {
    if (firstParty.length) {
      console.log(c.bold('First-party'))
      table(['PACK', 'ENABLED', 'DESCRIPTION'],
        firstParty.map(p => [p.key, `${p.enabled}/${p.total}`, truncate(p.description, 56)]))
    }
    if (community.length) {
      console.log('\n' + c.bold('Community'))
      table(['PACK', 'INSTALLED', 'REPO'],
        community.map(p => [p.name, `${p.installedCount}/${p.skills.length}`, p.repo]))
    }
    if (!firstParty.length && !community.length) console.log(c.dim('(no pack manifests found)'))
  })
}

function install(args: string[]) {
  // Everything after `install` is the install-skill var: `owner/repo [slugs] [flags]`.
  const varArg = args.join(' ').trim()
  if (!/^[\w.-]+\/[\w.-]+/.test(varArg)) fail('usage: aeon packs install <owner/repo> [skill-slugs…] [--branch <b>]')

  if (isDryRun()) {
    const ghArgs = buildSkillRunArgs('install-skill', { var: varArg })
    return emit({ dryRun: true, var: varArg, command: ['gh', ...ghArgs] }, () =>
      console.log(c.yellow('dry-run: ') + 'gh ' + ghArgs.join(' ')))
  }
  requireGh()
  runSkill('install-skill', { var: varArg })
  emit({ ok: true, installing: varArg }, () =>
    console.log(c.green('✓ ') + `dispatched install-skill for "${varArg}" — it opens an auto-merging PR; watch \`aeon runs ls\``))
}

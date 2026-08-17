import { parseArgs } from 'node:util'
import { listRuns, getRunLogs } from '../../../dashboard/lib/runs.ts'
import { emit, table, c, fail, requireGh, truncate } from '../output.ts'

const USAGE = `aeon runs — recent Aeon-launched workflow runs

  aeon runs ls [--limit <n>]     List recent runs (default 30)
  aeon runs logs <id>            Show a run's Run-step output + Summary

Options:
  --json     Machine-readable output`

export async function runsCommand(argv: string[]) {
  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'ls'
  if (sub === 'help' || argv.includes('-h') || argv.includes('--help')) { console.log(USAGE); return }

  requireGh()

  if (sub === 'ls') return listRunsCmd(argv.slice(argv[0] === 'ls' ? 1 : 0))
  if (sub === 'logs') return logsCmd(argv.slice(1))
  fail(`unknown subcommand: ${sub}\n\n${USAGE}`)
}

function listRunsCmd(args: string[]) {
  let limit = 30
  try {
    const { values } = parseArgs({ args, options: { limit: { type: 'string' } }, allowPositionals: true })
    if (values.limit) {
      const n = Number(values.limit)
      if (!Number.isInteger(n) || n < 1 || n > 100) fail('--limit must be an integer 1–100')
      limit = n
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : 'bad arguments')
  }

  const runs = listRuns(limit)
  emit(runs, () => {
    if (runs.length === 0) { console.log(c.dim('(no recent Aeon runs)')); return }
    table(
      ['ID', 'STATUS', 'WORKFLOW', 'WHEN'],
      runs.map(r => [String(r.id), statusCell(r.status, r.conclusion), truncate(r.workflow, 48), rel(r.created_at)]),
    )
  })
}

function logsCmd(args: string[]) {
  const id = args.find(a => !a.startsWith('-'))
  if (!id) fail('usage: aeon runs logs <id>')
  let logs
  try {
    logs = getRunLogs(id)
  } catch (e) {
    fail(e instanceof Error ? e.message : 'failed to fetch logs')
  }
  emit(logs, () => {
    console.log(c.bold(logs.title || `run ${logs.id}`) + '  ' + statusCell(logs.status, logs.conclusion))
    if (logs.summary) {
      console.log('\n' + c.cyan('── Summary ──'))
      console.log(logs.summary.trim())
    }
    console.log('\n' + c.cyan('── Run log ──'))
    console.log(logs.logs.trim())
  })
}

function statusCell(status: string, conclusion: string | null) {
  if (status !== 'completed') return c.yellow(status)
  if (conclusion === 'success') return c.green('success')
  if (conclusion === 'failure') return c.red('failure')
  return c.dim(conclusion || status)
}

// Compact relative time. Avoids Date.now() concerns — this runs live in the CLI,
// not in a resumable workflow, so wall-clock is fine here.
function rel(iso: string) {
  const then = new Date(iso).getTime()
  const secs = Math.round((Date.now() - then) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

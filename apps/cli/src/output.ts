// Output helpers shared by every command. A single `--json` switch flips all
// human rendering to machine-parseable JSON so the CLI drops into scripts.

import { ghAvailable } from '../../dashboard/lib/gh.ts'

let jsonMode = false
export function setJsonMode(on: boolean) { jsonMode = on }

let dryRun = false
export function setDryRun(on: boolean) { dryRun = on }
export function isDryRun() { return dryRun }

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const wrap = (code: number, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
export const c = {
  dim: (s: string) => wrap(2, s),
  bold: (s: string) => wrap(1, s),
  green: (s: string) => wrap(32, s),
  red: (s: string) => wrap(31, s),
  yellow: (s: string) => wrap(33, s),
  cyan: (s: string) => wrap(36, s),
}

// Render `data` as JSON when --json is set, otherwise run the human printer.
export function emit(data: unknown, human: () => void) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  } else {
    human()
  }
}

// Print a left-aligned column table. `headers` label the columns; each row is a
// string per column. Column widths size to the widest cell (header included).
export function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function table(headers: string[], rows: string[][]) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => stripAnsi(r[i] ?? '').length)))
  const pad = (cell: string, i: number) => {
    const visible = stripAnsi(cell).length
    return cell + ' '.repeat(Math.max(0, widths[i] - visible))
  }
  console.log(headers.map((h, i) => c.dim(pad(h, i))).join('  '))
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell ?? '', i)).join('  '))
  }
}

function stripAnsi(s: string) {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

// Print an error and exit non-zero. Never used for JSON mode success paths.
export function fail(message: string, code = 1): never {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ error: message }, null, 2) + '\n')
  } else {
    console.error(c.red('error: ') + message)
  }
  process.exit(code)
}

// Guard for every command that shells out to `gh`. Sites that need to say what
// specifically failed (e.g. `secrets ls`) keep their own `fail(...)` message.
export function requireGh(): void {
  if (!ghAvailable()) fail('GitHub CLI not authenticated. Run: gh auth login')
}

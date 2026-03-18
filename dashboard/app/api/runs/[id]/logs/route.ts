import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { resolve } from 'path'

const REPO_ROOT = resolve(process.cwd(), '..')

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    // Validate run ID
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 })
    }

    // Get run status first
    const infoRaw = execSync(
      `gh run view ${id} --json status,conclusion,displayTitle,jobs`,
      { stdio: 'pipe', cwd: REPO_ROOT, timeout: 15000 },
    ).toString()
    const info = JSON.parse(infoRaw)

    // Get logs — use --log-failed for failed runs, --log for completed
    let logs = ''
    try {
      const logCmd = info.conclusion === 'failure'
        ? `gh run view ${id} --log-failed`
        : `gh run view ${id} --log`
      logs = execSync(logCmd, {
        stdio: 'pipe',
        cwd: REPO_ROOT,
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      }).toString()
    } catch {
      // Log fetch can fail for in-progress runs
      logs = '(Logs not available yet — run may still be in progress)'
    }

    // Extract the interesting part: the "Run" step output from Claude
    // Lines look like: "run<TAB>Run<TAB>2024-01-01T..."
    const lines = logs.split('\n')
    const runStepLines: string[] = []
    let inRunStep = false

    for (const line of lines) {
      // gh log format: jobName\tstepName\tlogLine
      const parts = line.split('\t')
      if (parts.length >= 3) {
        const stepName = parts[1]
        if (stepName === 'Run' || stepName === 'Collect and dispatch messages') {
          inRunStep = true
          runStepLines.push(parts.slice(2).join('\t'))
        } else if (inRunStep && stepName !== 'Run' && stepName !== 'Collect and dispatch messages') {
          inRunStep = false
        }
      } else if (inRunStep) {
        runStepLines.push(line)
      }
    }

    // Use filtered logs if we found the Run step, otherwise show everything
    const output = runStepLines.length > 0 ? runStepLines.join('\n') : logs

    // Trim to last 500 lines max
    const trimmedLines = output.split('\n')
    const trimmed = trimmedLines.length > 500
      ? '... (truncated, showing last 500 lines)\n' + trimmedLines.slice(-500).join('\n')
      : output

    return NextResponse.json({
      id,
      title: info.displayTitle,
      status: info.status,
      conclusion: info.conclusion,
      logs: trimmed,
    })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to fetch logs'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

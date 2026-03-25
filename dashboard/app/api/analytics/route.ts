import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { resolve } from 'path'
import { readdirSync, readFileSync } from 'fs'

const REPO_ROOT = resolve(process.cwd(), '..')

interface RunRecord {
  name: string
  status: string
  conclusion: string | null
  createdAt: string
  updatedAt: string
}

interface SkillMetrics {
  name: string
  total: number
  success: number
  failure: number
  cancelled: number
  inProgress: number
  successRate: number
  lastRun: string | null
  lastConclusion: string | null
  avgDurationMin: number | null
  streak: number // positive = consecutive successes, negative = consecutive failures
}

interface Insight {
  type: 'warning' | 'info' | 'success'
  message: string
}

export async function GET() {
  try {
    // Fetch up to 200 recent runs from GitHub Actions
    const out = execSync(
      'gh run list --json name,status,conclusion,createdAt,updatedAt --limit 200',
      { stdio: 'pipe', cwd: REPO_ROOT, timeout: 30000 },
    ).toString()
    const raw: RunRecord[] = JSON.parse(out)

    // Group by skill name (extract from "skill: <name>" or "skill: <name> (<var>)")
    const bySkill = new Map<string, RunRecord[]>()
    for (const run of raw) {
      const match = run.name.match(/^skill:\s*(\S+)/)
      if (!match) continue
      const skill = match[1]
      if (!bySkill.has(skill)) bySkill.set(skill, [])
      bySkill.get(skill)!.push(run)
    }

    // Compute per-skill metrics
    const skills: SkillMetrics[] = []
    for (const [name, runs] of bySkill) {
      const sorted = runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      const success = sorted.filter(r => r.conclusion === 'success').length
      const failure = sorted.filter(r => r.conclusion === 'failure').length
      const cancelled = sorted.filter(r => r.conclusion === 'cancelled').length
      const inProgress = sorted.filter(r => r.status === 'in_progress').length
      const total = sorted.length

      // Calculate average duration for completed runs
      let avgDurationMin: number | null = null
      const completedRuns = sorted.filter(r => r.conclusion && r.createdAt && r.updatedAt)
      if (completedRuns.length > 0) {
        const totalMs = completedRuns.reduce((sum, r) => {
          return sum + (new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime())
        }, 0)
        avgDurationMin = Math.round((totalMs / completedRuns.length / 60000) * 10) / 10
      }

      // Calculate streak
      let streak = 0
      if (sorted.length > 0) {
        const first = sorted[0].conclusion
        if (first === 'success' || first === 'failure') {
          const dir = first === 'success' ? 1 : -1
          for (const r of sorted) {
            if (r.conclusion === first) streak += dir
            else break
          }
        }
      }

      skills.push({
        name,
        total,
        success,
        failure,
        cancelled,
        inProgress,
        successRate: total > 0 ? Math.round((success / (total - inProgress)) * 100) : 0,
        lastRun: sorted[0]?.createdAt || null,
        lastConclusion: sorted[0]?.conclusion || null,
        avgDurationMin,
        streak,
      })
    }

    // Sort by total runs descending
    skills.sort((a, b) => b.total - a.total)

    // Generate insights
    const insights: Insight[] = []
    const now = Date.now()
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000

    // Check for skills with high failure rates
    for (const s of skills) {
      if (s.total >= 3 && s.successRate < 50) {
        insights.push({
          type: 'warning',
          message: `${s.name} has a ${s.successRate}% success rate (${s.failure} failures out of ${s.total} runs)`,
        })
      }
    }

    // Check for skills on a failure streak
    for (const s of skills) {
      if (s.streak <= -3) {
        insights.push({
          type: 'warning',
          message: `${s.name} has failed ${Math.abs(s.streak)} times in a row`,
        })
      }
    }

    // Check for skills that haven't run recently
    // Read aeon.yml to find enabled skills
    try {
      const ymlPath = resolve(REPO_ROOT, 'aeon.yml')
      const yml = readFileSync(ymlPath, 'utf-8')
      const enabledSkills: string[] = []
      const lines = yml.split('\n')
      for (const line of lines) {
        const m = line.match(/^\s+(\S+):\s*\{.*enabled:\s*true/)
        if (m) enabledSkills.push(m[1])
      }

      for (const skillName of enabledSkills) {
        const metrics = skills.find(s => s.name === skillName)
        if (!metrics) {
          insights.push({
            type: 'info',
            message: `${skillName} is enabled but has no recorded runs`,
          })
        } else if (metrics.lastRun && now - new Date(metrics.lastRun).getTime() > threeDaysMs) {
          const daysAgo = Math.floor((now - new Date(metrics.lastRun).getTime()) / (24 * 60 * 60 * 1000))
          insights.push({
            type: 'info',
            message: `${metrics.name} hasn't run in ${daysAgo} days`,
          })
        }
      }
    } catch {
      // aeon.yml not readable, skip enabled-skill insights
    }

    // Highlight top performers
    for (const s of skills) {
      if (s.total >= 5 && s.successRate === 100) {
        insights.push({
          type: 'success',
          message: `${s.name} has a perfect 100% success rate across ${s.total} runs`,
        })
      }
    }

    // Overall stats
    const totalRuns = skills.reduce((s, sk) => s + sk.total, 0)
    const totalSuccess = skills.reduce((s, sk) => s + sk.success, 0)
    const totalFailure = skills.reduce((s, sk) => s + sk.failure, 0)
    const overallRate = totalRuns > 0 ? Math.round((totalSuccess / totalRuns) * 100) : 0

    return NextResponse.json({
      skills,
      insights,
      summary: {
        totalRuns,
        totalSuccess,
        totalFailure,
        overallSuccessRate: overallRate,
        uniqueSkills: skills.length,
        periodDays: raw.length > 0
          ? Math.ceil((now - new Date(raw[raw.length - 1].createdAt).getTime()) / (24 * 60 * 60 * 1000))
          : 0,
      },
    })
  } catch {
    return NextResponse.json({ skills: [], insights: [], summary: { totalRuns: 0, totalSuccess: 0, totalFailure: 0, overallSuccessRate: 0, uniqueSkills: 0, periodDays: 0 } })
  }
}

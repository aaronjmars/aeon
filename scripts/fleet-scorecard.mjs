#!/usr/bin/env node
// fleet-scorecard — gather fleet run/token data and compute the scorecard IN-RUN.
//
// Pricing, aggregation and table generation are deterministic, so they live in
// committed code rather than being left to the model — the skill run just invokes this.
//
// Auth: reads its token from the environment — GH_READ_PAT (an optional read-only PAT injected
// via the skill's `requires:`) is preferred; otherwise it falls back to GH_GLOBAL / GH_TOKEN /
// GITHUB_TOKEN (the run's repo-wide token), which reads the same PRIVATE managed instances — the
// normal single-key setup, not a degraded path. The token is read from process.env INSIDE this
// script, so no secret ever touches a command line (the caller runs a bare `node scripts/fleet-scorecard.mjs`).
//
// Writes /tmp/fleet-scorecard/{scorecard-body.md,metrics.json} — the same shape the
// fleet-control scorecard view consumes. Token mapping + pricing match skills/cost-report:
//   prompt = input + cache_read + cache_creation ; cached = cache_read ; completion = output
//   cost   = input·in + output·out + cache_creation·cw + cache_read·cr  (per-1M list price)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const TOKEN = process.env.GH_READ_PAT || process.env.GH_GLOBAL || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const DIR = '/tmp/fleet-scorecard';
const WINDOW_DAYS = 14;
mkdirSync(DIR, { recursive: true });

async function gh(path, { raw = false } = {}) {
  const headers = {
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'aeon-fleet-scorecard',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  return fetch(`https://api.github.com/${path}`, { headers });
}

// Paginated JSON GET (arrays, or {workflow_runs:[…]}). Cap at 30 pages (3000 runs) as a backstop.
async function ghAllPages(pathBase) {
  const out = [];
  const sep = pathBase.includes('?') ? '&' : '?';
  for (let page = 1; page <= 30; page++) {
    const res = await gh(`${pathBase}${sep}per_page=100&page=${page}`);
    if (!res.ok) break;
    const body = await res.json();
    const items = Array.isArray(body) ? body : (body.workflow_runs || []);
    if (!items.length) break;
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

// ---- 0. discover the fleet (self + non-archived registry entries) ----------
const self = process.env.GITHUB_REPOSITORY || '';
let registry = [];
if (existsSync('memory/instances.json')) {
  try {
    const j = JSON.parse(readFileSync('memory/instances.json', 'utf8'));
    registry = (j.instances || [])
      .filter((i) => i.archived !== true && (i.status || '') !== 'archived')
      .map((i) => i.repo)
      .filter(Boolean);
  } catch { /* malformed registry — treat as empty */ }
}
const repos = [];
for (const r of [self, ...registry]) if (r && !repos.includes(r)) repos.push(r);
if (!repos.length) {
  console.error('fleet-scorecard: no repos resolved (no GITHUB_REPOSITORY, empty registry) — skipping');
  process.exit(0);
}
console.error(`fleet-scorecard: fleet = ${repos.join(' ')}${TOKEN ? '' : ' (UNAUTHENTICATED — set GH_READ_PAT or GH_GLOBAL)'}`);

// ---- 1. fetch runs + defined-skill counts + token-usage.csv ----------------
const runs = [];          // {repo,name,conclusion,created_at,head_branch}
const defined = {};       // repo -> count of skills/ subdirs
const rows = [];          // [repo,date,skill,model,input,output,cache_read,cache_creation]
for (const repo of repos) {
  try {
    const wf = await ghAllPages(`repos/${repo}/actions/runs`);
    for (const w of wf) runs.push({ repo, name: w.name, conclusion: w.conclusion, created_at: w.created_at, head_branch: w.head_branch });
  } catch (e) { console.error(`fleet-scorecard: WARN runs fetch failed for ${repo}: ${e}`); }
  try {
    const res = await gh(`repos/${repo}/contents/skills`);
    const arr = res.ok ? await res.json() : [];
    defined[repo] = Array.isArray(arr) ? arr.filter((x) => x.type === 'dir').length : 0;
  } catch { defined[repo] = 0; }
  try {
    const res = await gh(`repos/${repo}/contents/memory/token-usage.csv`, { raw: true });
    if (res.ok) {
      const txt = await res.text();
      const lines = txt.split('\n');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');
        if (!line) continue;
        const c = line.split(',');
        if (c.length === 7) rows.push([repo, ...c]); // -> 8 fields
      }
    }
  } catch (e) { console.error(`fleet-scorecard: WARN token-usage.csv fetch failed for ${repo}: ${e}`); }
}

// ---- pricing + formatters ----
function priceRate(model, kind) {
  let i, o, cw, cr;
  if (/opus/.test(model)) { i = 15; o = 75; cw = 18.75; cr = 1.50; }
  else if (/sonnet/.test(model)) { i = 3; o = 15; cw = 3.75; cr = 0.30; }
  else if (/haiku/.test(model)) { i = 0.80; o = 4; cw = 1.00; cr = 0.08; }
  else { i = 15; o = 75; cw = 18.75; cr = 1.50; } // unknown -> conservative (Opus)
  return { in: i, out: o, cw, cr }[kind] / 1e6;
}
const commafy = (x) => Math.trunc(x).toLocaleString('en-US');
const hum = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${Math.trunc(n)}`;
const basename = (p) => String(p).replace(/.*\//, '');
const baseName = (name) => String(name || '(none)').replace(/ \(.*$/, ''); // strip " (…)" suffix
const num = (x) => Number(x) || 0;

// ---- run-level aggregates --------------------------------------------------
const TR = runs.length;
const TS = runs.filter((r) => r.conclusion === 'success').length;
const TF = runs.filter((r) => r.conclusion === 'failure').length;
const TC = runs.filter((r) => r.conclusion === 'cancelled').length;

// per-repo run stats
const runStat = {}; // repo -> {tot,succ,skills:Set}
for (const r of runs) {
  const s = (runStat[r.repo] ||= { tot: 0, succ: 0, skills: new Set() });
  s.tot++;
  if (r.conclusion === 'success') s.succ++;
  if (/^skill:/.test(r.name || '')) s.skills.add(baseName(String(r.name).replace(/^skill: /, '')));
}

// ---- token aggregates (fleet, per-repo, per-skill) -------------------------
const fleet = { g: 0, prompt: 0, cr: 0, out: 0, actual: 0, base: 0 };
const perRepo = {};  // repo -> {g,prompt,cr,comp,cost,base}
const perSkill = {}; // skill -> {g,prompt,cr,cost,repos:Set}
for (const row of rows) {
  const [repo, , skill, model, inS, outS, crS, cwS] = row;
  const input = num(inS), output = num(outS), cacheRead = num(crS), cacheCreation = num(cwS);
  const prompt = input + cacheRead + cacheCreation;
  const cost = input * priceRate(model, 'in') + output * priceRate(model, 'out') + cacheCreation * priceRate(model, 'cw') + cacheRead * priceRate(model, 'cr');
  const base = prompt * priceRate(model, 'in') + output * priceRate(model, 'out');

  fleet.g++; fleet.prompt += prompt; fleet.cr += cacheRead; fleet.out += output; fleet.actual += cost; fleet.base += base;

  const pr = (perRepo[repo] ||= { g: 0, prompt: 0, cr: 0, comp: 0, cost: 0, base: 0 });
  pr.g++; pr.prompt += prompt; pr.cr += cacheRead; pr.comp += output; pr.cost += cost; pr.base += base;

  const ps = (perSkill[skill] ||= { g: 0, prompt: 0, cr: 0, cost: 0, repos: new Set() });
  ps.g++; ps.prompt += prompt; ps.cr += cacheRead; ps.cost += cost; ps.repos.add(basename(repo));
}

const pct = (n, d) => (d > 0 ? (n * 100 / d).toFixed(1) : '0.0');

// ---- 3. compute markdown body ----------------------------------------------
const L = [];
L.push('## Fleet totals', '');
L.push('| Metric | Value |', '|---|---:|');
L.push(`| Workflow runs (all-time) | ${commafy(TR)} |`);
L.push(`| ├ success / failure / cancelled | ${commafy(TS)} / ${commafy(TF)} / ${commafy(TC)} |`);
L.push(`| ├ success rate | ${pct(TS, TR)}% |`);
L.push(`| Generations logged | ${commafy(fleet.g)} |`);
L.push(`| **prompt_tokens** | **${commafy(fleet.prompt)}** (${hum(fleet.prompt)}) |`);
L.push(`| ├ cached_tokens | ${commafy(fleet.cr)} — ${pct(fleet.cr, fleet.prompt)}% of prompt |`);
L.push(`| **completion_tokens** | **${commafy(fleet.out)}** (${hum(fleet.out)}) |`);
L.push(`| **total_tokens** | **${commafy(fleet.prompt + fleet.out)}** (${hum(fleet.prompt + fleet.out)}) |`);
L.push(`| **usage — est. cost** | **$${commafy(fleet.actual)}** |`);
L.push(`| cache_discount (saved vs uncached) | $${commafy(fleet.base - fleet.actual)} |`);
L.push('', '> `cached_tokens` ⊆ `prompt_tokens` (OpenRouter shape). Cost = Anthropic list price (estimate).', '');

L.push('## Per-repo', '');
L.push('| Repo | Runs | Success | Skills (ran/defined) | Gens | prompt_tokens | cached % | total_tokens | cost | cache_discount |');
L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const repo of repos) {
  const rs = runStat[repo] || { tot: 0, succ: 0, skills: new Set() };
  const tk = perRepo[repo] || { g: 0, prompt: 0, cr: 0, comp: 0, cost: 0, base: 0 };
  L.push(`| ${repo} | ${commafy(rs.tot)} | ${pct(rs.succ, rs.tot)}% | ${rs.skills.size} / ${defined[repo] || 0} | ${commafy(tk.g)} | ${hum(tk.prompt)} | ${pct(tk.cr, tk.prompt)}% | ${hum(tk.prompt + tk.comp)} | $${commafy(tk.cost)} | $${commafy(tk.base - tk.cost)} |`);
}
L.push('');

L.push('## Top 12 skills by est. cost (fleet-wide)', '');
L.push('| Skill | Repo(s) | Gens | prompt_tokens | cached % | cost |');
L.push('|---|---|---:|---:|---:|---:|');
Object.entries(perSkill).sort((a, b) => b[1].cost - a[1].cost).slice(0, 12).forEach(([skill, s]) => {
  L.push(`| ${skill} | ${[...s.repos].join(',')} | ${commafy(s.g)} | ${hum(s.prompt)} | ${pct(s.cr, s.prompt)}% | $${commafy(s.cost)} |`);
});
L.push('');

// Least reliable — windowed (default-branch only), ≥3 runs, sorted by fail rate.
L.push(`## Least reliable skills (last ${WINDOW_DAYS}d, ≥3 runs)`, '');
L.push(`_Rolling ${WINDOW_DAYS}-day window — resolved incidents age out, so this reflects current health (not lifetime totals)._`, '');
L.push(`| Skill | Repo | Failures / Runs (${WINDOW_DAYS}d) | Fail % |`);
L.push('|---|---|---:|---:|');
const cutoff = Date.now() - WINDOW_DAYS * 86400 * 1000;
const grp = {}; // key repo|skill -> {repo,skill,total,fail}
for (const r of runs) {
  if (r.head_branch !== 'main') continue;
  const t = Date.parse(r.created_at || '');
  if (!(t >= cutoff)) continue;
  const skill = baseName(r.name);
  const key = `${r.repo}|${skill}`;
  const g = (grp[key] ||= { repo: r.repo, skill, total: 0, fail: 0 });
  g.total++;
  if (r.conclusion === 'failure') g.fail++;
}
const unreliable = Object.values(grp).filter((g) => g.total >= 3 && g.fail > 0).sort((a, b) => b.fail / b.total - a.fail / a.total).slice(0, 10);
if (!unreliable.length) {
  L.push(`| ✅ none — no skill failed in the last ${WINDOW_DAYS}d | — | — | — |`);
} else {
  for (const g of unreliable) L.push(`| ${g.skill} | ${g.repo} | ${g.fail} / ${g.total} | ${(Math.round(g.fail * 1000 / g.total) / 10).toFixed(1)}% |`);
}

writeFileSync(`${DIR}/scorecard-body.md`, L.join('\n') + '\n');

// ---- 4. metrics.json (for day-over-day deltas) -----------------------------
const metrics = {
  total_runs: TR, total_failures: TF, generations: fleet.g,
  prompt_tokens: Math.trunc(fleet.prompt), cached_tokens: Math.trunc(fleet.cr),
  completion_tokens: Math.trunc(fleet.out), total_tokens: Math.trunc(fleet.prompt + fleet.out),
  est_cost_usd: Number(fleet.actual.toFixed(2)), cache_discount_usd: Number((fleet.base - fleet.actual).toFixed(2)),
};
writeFileSync(`${DIR}/metrics.json`, JSON.stringify(metrics) + '\n');

console.error(`fleet-scorecard: done — ${TR} runs, ${rows.length} token rows across ${repos.length} repo(s)`);
console.error(`fleet-scorecard: metrics -> ${JSON.stringify(metrics)}`);

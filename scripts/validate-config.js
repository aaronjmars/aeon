#!/usr/bin/env node
'use strict';

// validate-config.js — Deterministic structural validator for aeon.yml and the
// run workflow. One pass over the three invariant classes that have caused full
// outages; run in CI (and callable from any skill) so they don't have to be
// re-derived from inline snippets. Replaces the former config-validator skill.
//
// Checks:
//   1. Checkout ordering  — .github/workflows/aeon.yml must check out the repo
//      before the skill-run step, with a checkout whose condition covers the run
//      step's (unconditional, or the same if:), so the repo is never absent when
//      Run executes (checkout-ordering class).
//   2. Duplicate skill keys — a shadowed key in aeon.yml silently disables a skill
//      (duplicate-key class).
//   3. Skill-reference integrity — every skill named in aeon.yml resolves to a real
//      skills/<name>/SKILL.md (missing-file / dangling-reference class). Skills are
//      markdown with no compiler, so a reference left behind after a prune only
//      surfaces when a cron fires and the scheduler launches a skill that no longer
//      exists. This validates the full reference surface a forker edits by hand: the
//      whole skills: block (enabled or not, inline `{ }` or multi-line) AND every
//      skill wired into a chains: pipeline (parallel / skill / consume).
//   4. Reactive-trigger integrity - every target skill and `on:` source in the
//      reactive: block resolves to a real skill, and every `when:` parses to a
//      condition scripts/reactive_when.sh can evaluate (same dangling-reference /
//      dead-config class as 3, for the event-driven dispatch path).
//
// Output contract:
//   - Exit 0 + only PASS lines  => CLEAN
//   - Exit 1 + FAIL: / WARN: lines on stdout => ISSUES
//
// Reads local files only — no network, no dependencies.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AEON_YML = path.join(ROOT, 'aeon.yml');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'aeon.yml');
const SKILLS_DIR = path.join(ROOT, 'skills');

const out = [];
let failed = false;
function pass(line) { out.push(line); }
function fail(line) { out.push(line); failed = true; }

// ---------------------------------------------------------------------------
// Check 1 — checkout ordering.
// The run workflow has no single unconditional checkout by design: it checks out
// on the issues path ("Early checkout", if: issues) and again on the scheduled
// path ("Checkout repo", if: mode != ''), and the two steps that run before either
// checkout only read GitHub context — they never touch repo files. So the real
// invariant is not "checkout is unconditional and first" but: the skill-run step
// (id: run / name "Run") must be preceded by a checkout whose condition COVERS the
// run step's — i.e. the checkout is unconditional, or carries the exact same if:
// — so the repo can never be absent while Run executes. analyzeCheckout() is pure
// (takes the workflow YAML text) so it can be unit-tested against fixtures.
// ---------------------------------------------------------------------------
function parseSteps(text) {
  const lines = text.split('\n');
  let inSteps = false;
  const steps = [];
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s{4,6}steps:/.test(line)) { inSteps = true; continue; }
    if (!inSteps) continue;
    // dedent back to a job-/top-level key (<=4 spaces) ends the steps block
    if (/^ {0,4}[A-Za-z]/.test(line)) { inSteps = false; cur = null; continue; }

    if (/^\s{6}- /.test(line)) {
      if (cur) steps.push(cur);
      cur = { lineNum: i + 1, name: null, id: null, isCheckout: false, ifCond: null };
      const nm = line.match(/^\s{6}-\s+name:\s*(.+?)\s*$/);
      if (nm) cur.name = nm[1].replace(/["']/g, '');
    }
    if (!cur) continue;

    // step-body fields live at 8 spaces (one level under the "- " marker); anchoring
    // to that indent avoids matching `name=`/`if [ ... ]` inside run: shell blocks.
    let m;
    if ((m = line.match(/^\s{8}name:\s*(.+?)\s*$/))) cur.name = m[1].replace(/["']/g, '');
    if ((m = line.match(/^\s{8}id:\s*(.+?)\s*$/))) cur.id = m[1].replace(/["']/g, '');
    if (/^\s{8}uses:\s*actions\/checkout/.test(line)) cur.isCheckout = true;
    if ((m = line.match(/^\s{8}if:\s*(.+?)\s*$/)) && cur.ifCond === null) cur.ifCond = m[1];
  }
  if (cur) steps.push(cur);

  // a step named "... checkout" (e.g. "Early checkout") is a checkout too
  steps.forEach((s) => { if (s.name && /checkout/i.test(s.name)) s.isCheckout = true; });
  return steps;
}

const normCond = (c) => (c == null ? null : c.trim().replace(/\s+/g, ' '));

// Pure: returns { ok, line } for the checkout-ordering invariant.
function analyzeCheckout(text) {
  const steps = parseSteps(text);

  const checkouts = steps.filter((s) => s.isCheckout);
  if (checkouts.length === 0) {
    return { ok: false, line: 'FAIL: no checkout step (actions/checkout) found in jobs.run.steps' };
  }

  const runIdx = steps.findIndex((s) => s.id === 'run' || (s.name && /^run$/i.test(s.name.trim())));
  if (runIdx === -1) {
    return { ok: false, line: 'FAIL: could not locate the skill-run step (expected `id: run` or a step named "Run") — checkout-ordering cannot be verified' };
  }
  const runStep = steps[runIdx];
  const runCond = normCond(runStep.ifCond);

  // A preceding checkout "covers" Run if it is unconditional, or shares Run's exact
  // condition, so it can never be skipped in a run where Run itself executes.
  const covering = checkouts.find((s) => {
    if (steps.indexOf(s) >= runIdx) return false;
    const c = normCond(s.ifCond);
    return c === null || c === runCond;
  });

  if (covering) {
    const how = covering.ifCond == null
      ? 'unconditional'
      : 'condition matches the run step (if: ' + covering.ifCond + ')';
    return { ok: true, line: 'PASS checkout: a checkout (line ' + covering.lineNum + ') precedes the skill-run step (line ' + runStep.lineNum + ') and is ' + how };
  }

  const preceding = checkouts.find((s) => steps.indexOf(s) < runIdx);
  if (!preceding) {
    return { ok: false, line: 'FAIL: skill-run step (line ' + runStep.lineNum + ') has no checkout step before it — repo would be absent when Run executes' };
  }
  return {
    ok: false,
    line: 'FAIL: the checkout before the skill-run step (line ' + preceding.lineNum + ', if: ' + (preceding.ifCond || 'none')
      + ') does not cover the run step condition (if: ' + (runStep.ifCond || 'none')
      + ') — checkout could be skipped while Run executes',
  };
}

function checkCheckoutOrdering() {
  if (!fs.existsSync(WORKFLOW)) {
    fail('FAIL: run workflow not found at .github/workflows/aeon.yml');
    return;
  }
  const res = analyzeCheckout(fs.readFileSync(WORKFLOW, 'utf8'));
  (res.ok ? pass : fail)(res.line);
}

// ---------------------------------------------------------------------------
// Shared aeon.yml block reader: returns the line indices (0-based) of the
// `skills:` and `chains:` blocks. A block runs until the next column-0 key.
// ---------------------------------------------------------------------------
function readAeonYml() {
  if (!fs.existsSync(AEON_YML)) return null;
  return fs.readFileSync(AEON_YML, 'utf8').split('\n');
}

function* blockLines(lines, header) {
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (new RegExp('^' + header + ':\\s*$').test(line)) { inBlock = true; continue; }
    if (inBlock && /^[A-Za-z]/.test(line)) { inBlock = false; }
    if (inBlock) yield [i, line];
  }
}

// ---------------------------------------------------------------------------
// Check 2 — duplicate skill keys (mirrors SKILL.md step 2).
// ---------------------------------------------------------------------------
function checkDuplicateKeys(lines) {
  const seen = {};
  let dupes = 0;
  for (const [i, line] of blockLines(lines, 'skills')) {
    const m = line.match(/^  ([a-z][a-z0-9-]+):/);
    if (!m) continue;
    const key = m[1];
    if (seen[key]) {
      fail('FAIL: Duplicate skill key "' + key + '" at line ' + (i + 1) + ' (first seen line ' + seen[key] + ')');
      dupes++;
    } else {
      seen[key] = i + 1;
    }
  }
  if (dupes === 0) {
    pass('PASS duplicates: no duplicate skill keys (' + Object.keys(seen).length + ' skills)');
  }
}

// ---------------------------------------------------------------------------
// Check 3 — skill-reference integrity (strengthened beyond SKILL.md step 3,
// which only covered enabled inline entries). Validates every reference in the
// skills: block (any enabled state, inline or multi-line) and every skill wired
// into a chains: pipeline.
// ---------------------------------------------------------------------------
function skillExists(name) {
  return fs.existsSync(path.join(SKILLS_DIR, name, 'SKILL.md'));
}

function collectChainRefs(lines) {
  const refs = [];
  const push = (name, lineNum) => {
    const n = String(name).trim().replace(/["']/g, '');
    if (n) refs.push({ name: n, lineNum });
  };
  for (const [i, raw] of blockLines(lines, 'chains')) {
    if (/^\s*#/.test(raw)) continue; // skip comments (the documented example is commented out)
    let m;
    if ((m = raw.match(/parallel:\s*\[([^\]]*)\]/))) {
      m[1].split(',').forEach((s) => push(s, i + 1));
    }
    if ((m = raw.match(/consume:\s*\[([^\]]*)\]/))) {
      m[1].split(',').forEach((s) => push(s, i + 1));
    }
    if ((m = raw.match(/(?:^|[\s-])skill:\s*([a-z0-9-]+)/))) {
      push(m[1], i + 1);
    }
  }
  return refs;
}

function checkSkillRefs(lines) {
  if (!fs.existsSync(SKILLS_DIR)) {
    fail('FAIL: skills/ directory not found at ' + SKILLS_DIR);
    return;
  }

  const dangling = [];
  let scheduled = 0;
  for (const [i, line] of blockLines(lines, 'skills')) {
    const m = line.match(/^  ([a-z][a-z0-9-]+):/);
    if (!m) continue; // section comments and nested props are skipped
    scheduled++;
    if (!skillExists(m[1])) {
      dangling.push('FAIL: aeon.yml skills entry "' + m[1] + '" (line ' + (i + 1) + ') has no skills/' + m[1] + '/SKILL.md');
    }
  }

  let chained = 0;
  for (const ref of collectChainRefs(lines)) {
    chained++;
    if (!skillExists(ref.name)) {
      dangling.push('FAIL: aeon.yml chain references skill "' + ref.name + '" (line ' + ref.lineNum + ') with no skills/' + ref.name + '/SKILL.md');
    }
  }

  if (dangling.length > 0) {
    dangling.forEach(fail);
  } else {
    pass('PASS skill-refs: all ' + scheduled + ' scheduled + ' + chained + ' chained skill references resolve to skills/<name>/SKILL.md');
  }
}

// ---------------------------------------------------------------------------
// Check 4 - reactive-trigger integrity. The `reactive:` block wires event-driven
// dispatch: a target skill fires when a `when:` condition holds for a source
// skill (scripts/reactive_when.sh evaluates the condition at scheduler time).
// Nothing validated these references before, so a reactive trigger naming a
// pruned skill, or a mistyped `when:`, was a silent no-op that only showed up as
// a dispatch that never happened. Mirror the skill-refs check for both the target
// and the `on:` source, and reject a `when:` the evaluator cannot parse.
// ---------------------------------------------------------------------------

// A `when:` the scheduler's evaluator (scripts/reactive_when.sh) can parse. Keep
// these three patterns in lockstep with that script.
function validateWhen(when) {
  const w = String(when).trim();
  return /^consecutive_failures\s*>=\s*\d+$/.test(w)
    || /^last_status\s*=\s*[a-z]+$/.test(w)
    || /^success_rate\s*(<=|>=|<|>)\s*[0-9]+(\.[0-9]+)?$/.test(w);
}

// Pure: returns { targets, sources, conditions }, each an array of {name/when, lineNum}.
// Skips comment lines so the documented (commented-out) example doesn't register.
function collectReactiveRefs(lines) {
  const targets = [];
  const sources = [];
  const conditions = [];
  for (const [i, raw] of blockLines(lines, 'reactive')) {
    if (/^\s*#/.test(raw)) continue;
    let m;
    // A target skill is a 2-space key with nothing after the colon (`trigger:` is
    // deeper-indented and the `- { on:, when: }` rows carry no bare 2-space key).
    if ((m = raw.match(/^ {2}([a-z][a-z0-9-]+):\s*$/))) targets.push({ name: m[1], lineNum: i + 1 });
    if ((m = raw.match(/\bon:\s*"?([a-zA-Z0-9_*-]+)"?/))) sources.push({ name: m[1], lineNum: i + 1 });
    if ((m = raw.match(/\bwhen:\s*"([^"]+)"/))) conditions.push({ when: m[1], lineNum: i + 1 });
  }
  return { targets, sources, conditions };
}

function checkReactiveRefs(lines) {
  if (!fs.existsSync(SKILLS_DIR)) return; // checkSkillRefs already failed on this
  const { targets, sources, conditions } = collectReactiveRefs(lines);
  const problems = [];

  for (const t of targets) {
    if (!skillExists(t.name)) {
      problems.push('FAIL: aeon.yml reactive target "' + t.name + '" (line ' + t.lineNum + ') has no skills/' + t.name + '/SKILL.md');
    }
  }
  for (const s of sources) {
    if (s.name === '*') continue; // wildcard: any source skill
    if (!skillExists(s.name)) {
      problems.push('FAIL: aeon.yml reactive trigger on: "' + s.name + '" (line ' + s.lineNum + ') names no skills/' + s.name + '/SKILL.md');
    }
  }
  for (const c of conditions) {
    if (!validateWhen(c.when)) {
      problems.push('FAIL: aeon.yml reactive when: "' + c.when + '" (line ' + c.lineNum + ') is not a condition reactive_when.sh can evaluate (consecutive_failures >= N | last_status = <v> | success_rate <op> X)');
    }
  }

  if (problems.length > 0) {
    problems.forEach(fail);
  } else if (targets.length === 0) {
    pass('PASS reactive: no reactive triggers defined');
  } else {
    pass('PASS reactive: ' + targets.length + ' target(s), ' + sources.length + ' source ref(s), ' + conditions.length + ' condition(s) all valid');
  }
}

function main() {
  checkCheckoutOrdering();

  const lines = readAeonYml();
  if (lines === null) {
    fail('FAIL: aeon.yml not found at repo root');
  } else {
    checkDuplicateKeys(lines);
    checkSkillRefs(lines);
    checkReactiveRefs(lines);
  }

  out.forEach((l) => console.log(l));
  if (failed) {
    console.log('');
    console.log('config: ISSUES — see FAIL lines above.');
    process.exit(1);
  }
  console.log('config: CLEAN — all structural invariants hold.');
  process.exit(0);
}

if (require.main === module) main();

module.exports = { analyzeCheckout, parseSteps, collectReactiveRefs, validateWhen };

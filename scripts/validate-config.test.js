'use strict';

// Fixture tests for the checkout-ordering invariant in validate-config.js.
//   node --test scripts/validate-config.test.js
//
// The run workflow deliberately has no unconditional checkout (it checks out on
// the issues path and again on the scheduled path). These fixtures pin the real
// invariant: the skill-run step must be preceded by a checkout whose condition
// covers it — and guard against a regression to the old "unconditional & first"
// rule, which false-failed on the live workflow.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { analyzeCheckout, collectReactiveRefs, validateWhen, validateChainWhen } = require('./validate-config.js');

// Wrap an indented steps body in a minimal single-job workflow.
const wf = (steps) => `name: run
on: { schedule: [{ cron: '0 * * * *' }] }
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
${steps}`;

test('PASS: conditional checkout covers a run step with the same condition', () => {
  const r = analyzeCheckout(wf(
`      - name: Determine skill
        id: skill
        run: echo hi
      - name: Checkout repo
        if: steps.work.outputs.mode != ''
        uses: actions/checkout@v7
      - name: Run
        id: run
        if: steps.work.outputs.mode != ''
        run: claude`));
  assert.equal(r.ok, true, r.line);
});

test('PASS: an unconditional checkout covers any run step', () => {
  const r = analyzeCheckout(wf(
`      - name: Checkout repo
        uses: actions/checkout@v7
      - name: Run
        id: run
        if: steps.work.outputs.mode != ''
        run: claude`));
  assert.equal(r.ok, true, r.line);
});

test("FAIL: the run step's condition is not covered by the preceding checkout", () => {
  const r = analyzeCheckout(wf(
`      - name: Checkout repo
        if: github.event_name == 'issues'
        uses: actions/checkout@v7
      - name: Run
        id: run
        if: steps.work.outputs.mode != ''
        run: claude`));
  assert.equal(r.ok, false);
  assert.match(r.line, /does not cover/);
});

test('FAIL: checkout appears after the run step (ordering)', () => {
  const r = analyzeCheckout(wf(
`      - name: Run
        id: run
        if: steps.work.outputs.mode != ''
        run: claude
      - name: Checkout repo
        if: steps.work.outputs.mode != ''
        uses: actions/checkout@v7`));
  assert.equal(r.ok, false);
  assert.match(r.line, /no checkout step before it/);
});

test('FAIL: no checkout step at all', () => {
  const r = analyzeCheckout(wf(
`      - name: Run
        id: run
        run: claude`));
  assert.equal(r.ok, false);
  assert.match(r.line, /no checkout step/);
});

test('FAIL: the skill-run step cannot be located', () => {
  const r = analyzeCheckout(wf(
`      - name: Checkout repo
        uses: actions/checkout@v7
      - name: Do a thing
        run: echo hi`));
  assert.equal(r.ok, false);
  assert.match(r.line, /could not locate the skill-run step/);
});

// Regression guard: the live workflow (two conditional checkouts by design) must
// PASS. The old "unconditional & first" rule false-failed here once the if:
// detection actually worked.
test('PASS: the live .github/workflows/aeon.yml', () => {
  const wfPath = path.resolve(__dirname, '..', '.github', 'workflows', 'aeon.yml');
  const r = analyzeCheckout(fs.readFileSync(wfPath, 'utf8'));
  assert.equal(r.ok, true, r.line);
});

// --- Check 4: reactive-trigger reference + condition parsing ---

// A reactive: block with one target, one wildcard source, and a valid condition.
const reactiveBlock = (body) => `reactive:
${body}
chains:
  # example
`.split('\n');

test('collectReactiveRefs: parses target, on: source, and when:', () => {
  const r = collectReactiveRefs(reactiveBlock(
`  skill-repair:
    trigger:
      - { on: "*", when: "consecutive_failures >= 3" }
  autoresearch:
    trigger:
      - { on: skill-health, when: "last_status = success" }`));
  assert.deepEqual(r.targets.map((t) => t.name), ['skill-repair', 'autoresearch']);
  assert.deepEqual(r.sources.map((s) => s.name), ['*', 'skill-health']);
  assert.deepEqual(r.conditions.map((c) => c.when), ['consecutive_failures >= 3', 'last_status = success']);
});

test('collectReactiveRefs: ignores commented-out example rows', () => {
  const r = collectReactiveRefs(reactiveBlock(
`  # skill-repair:
  #   trigger:
  #     - { on: "*", when: "consecutive_failures >= 3" }`));
  assert.equal(r.targets.length, 0);
  assert.equal(r.sources.length, 0);
  assert.equal(r.conditions.length, 0);
});

test('validateWhen: accepts the three documented condition forms', () => {
  assert.equal(validateWhen('consecutive_failures >= 3'), true);
  assert.equal(validateWhen('last_status = success'), true);
  assert.equal(validateWhen('success_rate < 0.5'), true);
  assert.equal(validateWhen('success_rate >= 0.9'), true);
});

test('validateWhen: rejects malformed / unsupported conditions', () => {
  assert.equal(validateWhen('score > abc'), false);
  assert.equal(validateWhen('consecutive_failures > 3'), false); // only >= supported
  assert.equal(validateWhen('success_rate = 0.5'), false);       // no = for rate
  assert.equal(validateWhen('last_status = 5'), false);          // value not [a-z]+
  assert.equal(validateWhen(''), false);
});

// The live aeon.yml ships the reactive examples commented out, so it must parse to
// zero references (and therefore never fail the reactive check).
test('the live aeon.yml has no uncommented reactive references', () => {
  const ymlPath = path.resolve(__dirname, '..', 'aeon.yml');
  const lines = fs.readFileSync(ymlPath, 'utf8').split('\n');
  const r = collectReactiveRefs(lines);
  assert.equal(r.targets.length, 0, 'unexpected uncommented reactive target(s)');
});

// --- Check 5: chain when: expression syntax ---

test('validateChainWhen: accepts score ordering and string equality', () => {
  assert.equal(validateChainWhen('score > 5'), true);
  assert.equal(validateChainWhen('score <= 5'), true);
  assert.equal(validateChainWhen('score >= 10'), true);
  assert.equal(validateChainWhen('verdict == pass'), true);
  assert.equal(validateChainWhen('verdict != fail'), true);
});

test('validateChainWhen: rejects malformed and non-integer ordering', () => {
  assert.equal(validateChainWhen('score > abc'), false); // ordering needs integer
  assert.equal(validateChainWhen('score is big'), false); // no valid operator
  assert.equal(validateChainWhen('score >'), false);      // no value
  assert.equal(validateChainWhen('> 5'), false);          // no key
  assert.equal(validateChainWhen(''), false);
});

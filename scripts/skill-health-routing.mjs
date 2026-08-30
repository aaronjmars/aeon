#!/usr/bin/env node
/**
 * Compare attributable skill-health quality with token usage by harness.
 *
 * This is deliberately recommend-only: it reads memory files and prints a
 * comparison. It never edits aeon.yml, memory, or any other repository file.
 *
 * token-usage.csv predates harness tagging and is keyed by model, so rows are
 * attributed conservatively: exact model names from the skill's tagged health
 * history win; only stable native-default/model-family aliases are inferred.
 * Ambiguous or unknown rows are reported as unattributed rather than guessed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIN_SAMPLES = 5;
const ROOT = process.cwd();
const HEALTH_DIR = join(ROOT, 'memory', 'skill-health');
const TOKEN_FILE = join(ROOT, 'memory', 'token-usage.csv');
// Harness allowlist mirrors scripts/resolve-harness.sh; keep in sync.
const HARNESSES = new Set(['claude', 'grok', 'codex', 'pi', 'vibe', 'kimi', 'fx', 'cursor', 'hermes']);

function usage() {
  console.error(`usage: node scripts/skill-health-routing.mjs <skill-name>`);
}

function fail(message) {
  console.error(`skill-health-routing: ${message}`);
  process.exitCode = 2;
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function csvFields(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

function readHealth(skill) {
  const file = join(HEALTH_DIR, `${skill}.json`);
  if (!existsSync(file)) throw new Error(`health file not found: ${file}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`could not parse ${file}: ${error.message}`);
  }
  if (!Array.isArray(parsed.history)) throw new Error(`${file} has no history array`);
  return parsed.history;
}

function taggedScores(history) {
  const groups = new Map();
  const modelHints = new Map();
  for (const entry of history) {
    const harness = typeof entry?.harness === 'string' ? entry.harness.trim() : '';
    const score = number(entry?.score);
    if (!harness || score === null) continue;
    if (!groups.has(harness)) groups.set(harness, []);
    groups.get(harness).push({ date: entry.date || '', score, model: entry.model || '' });
    if (entry.model) {
      if (!modelHints.has(entry.model)) modelHints.set(entry.model, new Set());
      modelHints.get(entry.model).add(harness);
    }
  }
  return { groups, modelHints };
}

function knownHarnessForModel(model, modelHints) {
  const exact = modelHints.get(model);
  if (exact?.size === 1) return [...exact][0];
  if (exact?.size > 1) return null;

  // `<harness>-default` is emitted by the adapter when a harness runs on its
  // native default model (aeon.yml: EFFECTIVE_MODEL="${RH_MODEL_ARG:-$HARNESS-default}").
  // Validate the captured name against the resolve-harness.sh allowlist so a row is
  // never attributed to a non-harness. Do not broaden without a matching workflow
  // invariant and a test.
  const nativeDefault = /^([a-z0-9]+)-default$/.exec(model);
  if (nativeDefault && HARNESSES.has(nativeDefault[1])) return nativeDefault[1];

  if (/(^|\/)gpt-[^/]*-codex/.test(model)) return 'codex';
  if (/^grok-/.test(model)) return 'grok';
  if (/^moonshotai\//.test(model)) return 'kimi';
  if (/^mistralai\//.test(model)) return 'vibe';
  if (/^claude-/.test(model) || /^anthropic\//.test(model)) return 'claude';
  return null;
}

function readTokenRows(skill, modelHints) {
  if (!existsSync(TOKEN_FILE)) return { rows: [], unattributed: [], invalid: [] };
  const lines = readFileSync(TOKEN_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { rows: [], unattributed: [], invalid: [] };
  const header = csvFields(lines[0]);
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const rows = [];
  const unattributed = [];
  const invalid = [];
  for (const line of lines.slice(1)) {
    const fields = csvFields(line);
    if (fields.length < header.length || fields[index.skill] !== skill) continue;
    const input = number(fields[index.input_tokens]);
    const cacheRead = number(fields[index.cache_read]);
    if (input === null || cacheRead === null) {
      invalid.push({ model: fields[index.model] || '', reason: 'invalid token counts' });
      continue;
    }
    const row = {
      date: fields[index.date] || '',
      model: fields[index.model] || '',
      input,
      cacheRead,
    };
    const harness = knownHarnessForModel(row.model, modelHints);
    if (harness) rows.push({ ...row, harness });
    else unattributed.push({ ...row, reason: 'model-to-harness mapping unavailable' });
  }
  return { rows, unattributed, invalid };
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + row[field], 0);
}

function avg(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function integer(value) {
  return Math.round(value).toLocaleString('en-US');
}

function ratio(cacheRead, input) {
  const total = cacheRead + input;
  return total > 0 ? `${(cacheRead / total * 100).toFixed(1)}%` : 'n/a';
}

function printComparison(skill, scoreGroups, tokenData) {
  const harnesses = new Set([...scoreGroups.keys(), ...tokenData.rows.map((row) => row.harness)]);
  const ordered = [...harnesses].sort();
  const eligible = ordered
    .map((harness) => ({ harness, scores: scoreGroups.get(harness) || [] }))
    .filter((group) => group.scores.length >= MIN_SAMPLES)
    .map((group) => ({ ...group, average: avg(group.scores.map((x) => x.score)) }))
    .sort((a, b) => b.average - a.average);

  console.log(`skill: ${skill}`);
  console.log(`minimum harness samples: ${MIN_SAMPLES} (five observations limits recommendations from one- or two-run noise while fitting the 30-entry rolling history)`);
  console.log('quality by harness:');
  if (!ordered.length) console.log('  none — no harness-tagged history or attributable token rows');
  for (const harness of ordered) {
    const scores = scoreGroups.get(harness) || [];
    const missing = Math.max(0, MIN_SAMPLES - scores.length);
    if (scores.length >= MIN_SAMPLES) {
      const average = avg(scores.map((x) => x.score));
      console.log(`  ${harness}: avg ${average.toFixed(2)} (n=${scores.length}; eligible)`);
    } else {
      console.log(`  ${harness}: insufficient data (n=${scores.length}; need ${missing} more)`);
    }
  }

  console.log('token cost proxy from memory/token-usage.csv:');
  for (const harness of ordered) {
    const rows = tokenData.rows.filter((row) => row.harness === harness);
    if (!rows.length) {
      console.log(`  ${harness}: no attributable token rows`);
      continue;
    }
    const input = sum(rows, 'input');
    const cacheRead = sum(rows, 'cacheRead');
    console.log(`  ${harness}: ${rows.length} rows, input_tokens=${integer(input)}, cache_read=${integer(cacheRead)}, cache_read_ratio=${ratio(cacheRead, input)}, avg_input/run=${integer(input / rows.length)}, avg_cache_read/run=${integer(cacheRead / rows.length)}`);
  }
  if (tokenData.unattributed.length) {
    const input = sum(tokenData.unattributed, 'input');
    const cacheRead = sum(tokenData.unattributed, 'cacheRead');
    console.log(`  unattributed: ${tokenData.unattributed.length} rows, input_tokens=${integer(input)}, cache_read=${integer(cacheRead)} (not guessed)`);
  }
  if (tokenData.invalid.length) console.log(`  invalid token rows: ${tokenData.invalid.length} (excluded)`);

  if (eligible.length < 2) {
    console.log('recommendation: none — insufficient real multi-harness history; keep collecting tagged runs. aeon.yml was not changed.');
    return;
  }
  const leader = eligible[0];
  const runnerUp = eligible[1];
  const qualityDelta = leader.average - runnerUp.average;
  const leaderRows = tokenData.rows.filter((row) => row.harness === leader.harness);
  const runnerRows = tokenData.rows.filter((row) => row.harness === runnerUp.harness);
  const leaderInput = leaderRows.length ? sum(leaderRows, 'input') / leaderRows.length : null;
  const runnerInput = runnerRows.length ? sum(runnerRows, 'input') / runnerRows.length : null;
  const leaderCache = leaderRows.length ? sum(leaderRows, 'cacheRead') / leaderRows.length : null;
  const runnerCache = runnerRows.length ? sum(runnerRows, 'cacheRead') / runnerRows.length : null;
  const delta = (a, b) => a === null || b === null ? 'unavailable' : `${integer(a - b)} tokens/run`;
  console.log(`recommendation: review ${leader.harness} vs ${runnerUp.harness} — quality delta +${qualityDelta.toFixed(2)} for ${leader.harness}; input delta ${delta(leaderInput, runnerInput)}, cache_read delta ${delta(leaderCache, runnerCache)}. Human approval required; aeon.yml was not changed.`);
}

const skill = process.argv[2];
if (!skill || skill.startsWith('-')) {
  usage();
  process.exitCode = 2;
} else {
  try {
    const history = readHealth(skill);
    const { groups, modelHints } = taggedScores(history);
    const tokenData = readTokenRows(skill, modelHints);
    printComparison(skill, groups, tokenData);
  } catch (error) {
    fail(error.message);
  }
}

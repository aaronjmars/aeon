#!/usr/bin/env node
// test-taskmarket.js — deterministic tests for skills/taskmarket-delegate.
// Read-only + local (uses the live PUBLIC browse endpoint, no key, nothing spent).
// Exit 0 on pass, 1 on fail.
const { execFileSync } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'taskmarket.js');
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

async function main() {
  // 1. usage guard: no args -> exit 2
  try {
    execFileSync('node', [SCRIPT], { stdio: 'pipe' });
    check('no-args exits nonzero', false, 'expected exit 2');
  } catch (e) {
    check('no-args exits nonzero', e.status === 2);
  }

  // 2. write action without key -> exit 3 (not authorized)
  try {
    execFileSync('node', [SCRIPT, 'create', 't', 'd'], { stdio: 'pipe', env: { ...process.env, TASKMARKET_API_KEY: '' } });
    check('create without key blocked', false);
  } catch (e) {
    check('create without key blocked', e.status === 3);
  }

  // 3. live public browse returns ranked open tasks (read-only, no key)
  const out = execFileSync('node', [SCRIPT, 'browse'], { stdio: 'pipe', env: { ...process.env, TASKMARKET_API_KEY: '' } }).toString();
  const lines = out.trim().split('\n').filter(Boolean);
  check('browse returns lines', lines.length > 0, `${lines.length} lines`);
  const first = lines[0];
  check('browse lines ranked+compact', /^0x[0-9a-f]{6,8} reward=/.test(first), first.slice(0, 60));
  check('browse includes expiry', /expiry=/.test(first));

  // 4. unknown action -> exit 2
  try {
    execFileSync('node', [SCRIPT, 'nonsense'], { stdio: 'pipe' });
    check('unknown action exits nonzero', false);
  } catch (e) {
    check('unknown action exits nonzero', e.status === 2);
  }

  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('test harness error:', e.message);
  process.exit(1);
});

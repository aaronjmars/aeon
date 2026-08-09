#!/usr/bin/env node
// taskmarket.js — TaskMarket (api.taskmarket.dev) delegation client for the
// taskmarket-delegate Aeon skill. Zero-dependency, standalone.
//
// Usage:
//   node taskmarket.js browse [query]          # public, no key needed
//   node taskmarket.js create <title> <description> [reward] [tags]
//   node taskmarket.js submit <taskId> <message> [github_url]
//
// Writes require TASKMARKET_API_KEY (env). Exit codes:
//   0 success | 2 bad usage | 3 not authorized | 4 api error
const BASE = 'https://api.taskmarket.dev';

function exit(code, msg) {
  if (msg) console.error(msg);
  process.exit(code);
}

async function main() {
  const [action, ...rest] = process.argv.slice(2);
  if (!action) exit(2, 'usage: taskmarket.js <browse|create|submit> [...]');

  if (action === 'browse') {
    const res = await fetch(`${BASE}/api/tasks?limit=100`);
    if (!res.ok) exit(4, `browse failed: HTTP ${res.status}`);
    const data = await res.json();
    const tasks = data.tasks || data.items || data.data || [];
    const open = tasks.filter((t) => t.status === 'open' && t.submissionWindowOpen !== false);
    // default: a compact, winnable-first ranked view
    open.sort((a, b) => (a.submissionCount || 0) - (b.submissionCount || 0));
    for (const t of open.slice(0, 20)) {
      const id = String(t.id || '').slice(0, 8);
      const title = (t.title || (t.description || '').split('\n')[0] || '').slice(0, 60);
      console.log(`${id} reward=${t.reward} subs=${t.submissionCount || 0} expiry=${(t.expiryTime || '').slice(0, 10)} | ${title}`);
    }
    if (rest.includes('--json')) console.log(JSON.stringify(open.slice(0, 20), null, 1));
    return;
  }

  // ----- read-only vs write gate -----
  if (action === 'create' || action === 'submit') {
    if (!process.env.TASKMARKET_API_KEY) exit(3, 'TASKMARKET_API_KEY not set; write actions require it');
  }

  if (action === 'create') {
    const [title, description, reward, tags] = rest;
    if (!title || !description) exit(2, 'create requires "<title>" "<description>" [reward] [tags]');
    const res = await fetch(`${BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TASKMARKET_API_KEY },
      body: JSON.stringify({
        title,
        description,
        reward: reward ? Number(reward) : undefined,
        tags: tags ? tags.split(/[ ,]+/).filter(Boolean) : [],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) exit(4, `create failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    console.log(`created task id: ${body.id || body.task_id || '(see response)'}`);
    console.log(JSON.stringify(body).slice(0, 400));
    return;
  }

  if (action === 'submit') {
    const [taskId, message, githubUrl] = rest;
    if (!taskId || !message) exit(4, 'submit requires <taskId> <message> [github_url]');
    const res = await fetch(`${BASE}/api/tasks/${taskId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TASKMARKET_API_KEY },
      body: JSON.stringify({ worker_address: process.env.TASKMARKET_WORKER_ADDRESS || '', message, github_url: githubUrl || '' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) exit(4, `submit failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    console.log('submit recorded:', JSON.stringify(body).slice(0, 300));
    return;
  }

  exit(2, `unknown action: ${action}`);
}

main().catch((e) => exit(4, 'error: ' + (e && e.message)));
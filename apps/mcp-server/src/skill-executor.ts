/**
 * Aeon skill executor — shared core for loading the skill catalog and running a
 * skill through the configured harness via harness-adapter's `run-harness`,
 * identical to how GitHub Actions invokes it.
 *
 * Extracted from the MCP server so the load → prompt → spawn → parse logic lives
 * in one testable place. Any future transport (HTTP, a queue worker, another
 * protocol bridge) can import this instead of re-implementing skill execution.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawn, spawnSync } from "child_process";

export interface Skill {
  slug: string;
  name: string;
  description: string;
  category: string;
  schedule: string;
  var: string;
}

interface SkillsManifest {
  version: string;
  repo: string;
  skills: Skill[];
}

/** Load the skill catalog from <repoRoot>/catalog/skills.json. Returns [] if missing. */
export function loadSkills(repoRoot: string, logPrefix = "[aeon]"): Skill[] {
  const manifestPath = join(repoRoot, "catalog", "skills.json");
  if (!existsSync(manifestPath)) {
    process.stderr.write(`${logPrefix} catalog/skills.json not found at ${manifestPath}\n`);
    return [];
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as SkillsManifest;
  return manifest.skills ?? [];
}

/**
 * Build the prompt the CLI receives — mirrors the GitHub Actions invocation so a
 * local run is identical to a scheduled one.
 */
export function buildSkillPrompt(slug: string, varValue: string): string {
  const today = new Date().toISOString().split("T")[0];
  let prompt = `Today is ${today}. Read and execute the skill defined in skills/${slug}/SKILL.md`;
  if (varValue.trim()) {
    prompt += `\n\nUse this variable (override the default in the skill file):\nvar=${varValue.trim()}`;
  }
  return prompt;
}

/** Every harness harness-adapter's run-harness can dispatch to. */
export const HARNESSES = ["claude", "grok", "codex", "pi", "vibe", "kimi", "fx", "cursor", "hermes", "glm"] as const;
export type Harness = (typeof HARNESSES)[number];
const isHarness = (v: string): v is Harness =>
  (HARNESSES as readonly string[]).includes(v);

/**
 * Which agent harness runs the skill. Mirrors scripts/resolve-harness.sh's
 * precedence so a local MCP run matches a scheduled one: the AEON_HARNESS env
 * wins, else the skill's own `harness:` override in aeon.yml, else the repo's
 * global `harness:`, else `claude`. Any unknown value → `claude`.
 *
 * `slug` is optional so non-skill callers get the repo-global answer, matching
 * resolve-harness.sh's optional skill-name argument.
 */
export function resolveHarness(repoRoot: string, slug?: string): Harness {
  let picked = (process.env.AEON_HARNESS || "").trim().toLowerCase();
  if (!picked) {
    try {
      const cfg = readFileSync(join(repoRoot, "aeon.yml"), "utf-8");
      // Per-skill override. aeon.yml's skills map is INLINE flow-mapping on one
      // line (`  my-skill: { enabled: true, harness: "vibe" }`), and that is the
      // only form resolve-harness.sh matches — keep the two greps equivalent.
      if (slug) {
        picked = cfg
          .match(new RegExp(`^ {2}${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:.*$`, "m"))?.[0]
          ?.match(/harness:\s*"([^"]*)"/)?.[1]
          ?.toLowerCase() ?? "";
      }
      if (!picked) picked = cfg.match(/^harness:\s*["']?([A-Za-z]+)/m)?.[1].toLowerCase() ?? "";
    } catch {
      /* no aeon.yml → default */
    }
  }
  // Allowlist LAST, as resolve-harness.sh does: a value that is set but
  // unrecognized falls back to claude rather than to the next level down. A
  // skill pinned to a harness that was removed must not silently inherit the
  // repo default.
  //
  // One deliberate divergence: resolve-harness.sh strips no quotes from the
  // GLOBAL key, so a hand-written `harness: "codex"` reaches its allowlist as
  // `"codex"` and is rewritten to claude. That is a bug in that script, not a
  // contract, so this reads the YAML correctly instead of reproducing it.
  return isHarness(picked) ? picked : "claude";
}

/**
 * The skill's capability tier and toolset, from the same scripts/skill_mode.sh
 * that aeon.yml calls — NOT re-derived here. `--mode read-only` is what makes
 * run-harness apply its OS sandbox (harness-adapter/run-harness gates
 * sandbox_prefix on it), so getting this wrong silently drops the write boundary
 * for the skills that declare `mode: read-only`.
 *
 * Returns null when the tier cannot be determined. Callers must fail rather than
 * assume `write`: guessing the permissive tier is exactly the mistake this
 * function exists to prevent.
 */
function resolveMode(repoRoot: string, slug: string): { mode: string; allowedTools: string } | null {
  const script = join(repoRoot, "scripts", "skill_mode.sh");
  if (!existsSync(script)) return null;
  const run = (...args: string[]) =>
    spawnSync("bash", [script, ...args], { cwd: repoRoot, encoding: "utf-8" });

  const modeRes = run("mode", slug);
  if (modeRes.status !== 0) return null;
  const mode = (modeRes.stdout || "").trim();
  if (mode !== "read-only" && mode !== "write") return null;

  const toolsRes = run("allowed-tools", mode);
  if (toolsRes.status !== 0) return null;
  const allowedTools = (toolsRes.stdout || "").trim();
  if (!allowedTools) return null;

  return { mode, allowedTools };
}

// Single-flight queue. spawnSync used to serialize runs by freezing the event
// loop; moving to async spawn removes that accidental lock, so runs must be
// serialized explicitly. Every run shares `cwd: repoRoot`, so two concurrent
// write-mode skills would race the same working tree: `.git/index.lock`
// collisions on commit, plus interleaved writes to memory/, output/ and
// cron-state.json. This keeps one skill running at a time; a second tools/call
// waits its turn instead of corrupting the tree.
let runQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = runQueue.then(task, task);
  // Keep the chain alive regardless of this run's outcome so one failure does
  // not wedge every later run.
  runQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

interface HarnessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
}

/**
 * Async replacement for spawnSync with the same result shape
 * (status/stdout/stderr/error) so the parsing below is unchanged, but it awaits
 * `close` instead of blocking the Node event loop for the whole 10-minute run.
 * Enforces the same timeout and combined output cap, surfacing each as `error`
 * the way spawnSync did (ETIMEDOUT / ENOBUFS).
 */
function spawnHarness(
  args: string[],
  opts: {
    input: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
  }
): Promise<HarnessResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", args, { cwd: opts.cwd, env: opts.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killReason: "timeout" | "buffer" | null = null;

    const timer = setTimeout(() => {
      killReason = "timeout";
      child.kill("SIGKILL");
    }, opts.timeout);

    const capture = (chunk: Buffer, sink: "out" | "err") => {
      if (sink === "out") stdout += chunk.toString("utf-8");
      else stderr += chunk.toString("utf-8");
      if (stdout.length + stderr.length > opts.maxBuffer) {
        killReason = "buffer";
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", (c: Buffer) => capture(c, "out"));
    child.stderr.on("data", (c: Buffer) => capture(c, "err"));

    const finish = (r: HarnessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    child.on("error", (err) =>
      finish({ status: null, stdout, stderr, error: err as NodeJS.ErrnoException })
    );
    child.on("close", (code) => {
      let error: NodeJS.ErrnoException | undefined;
      if (killReason === "timeout") {
        error = Object.assign(
          new Error(`run-harness timed out after ${opts.timeout} ms`),
          { code: "ETIMEDOUT" }
        );
      } else if (killReason === "buffer") {
        error = Object.assign(
          new Error(`run-harness output exceeded ${opts.maxBuffer} bytes`),
          { code: "ENOBUFS" }
        );
      }
      finish({ status: code, stdout, stderr, error });
    });

    // Feed the prompt on stdin, matching spawnSync's `input`. Ignore EPIPE if the
    // child exits before the write finishes.
    child.stdin.on("error", () => {});
    child.stdin.write(opts.input);
    child.stdin.end();
  });
}

/**
 * Run a skill and return its text output. Serialized through `enqueue` (one skill
 * at a time, since they share the repo working tree) and dispatched through
 * harness-adapter's `run-harness`, which emits one `{ result, usage }` envelope
 * for every harness, so parsing is shared. Failure modes (missing skill, missing
 * CLI, non-zero exit, empty output) are returned as human-readable strings rather
 * than thrown, so callers can surface them without special-casing.
 *
 * Async so a running skill no longer freezes the whole stdio MCP server: the old
 * spawnSync parked the Node event loop for up to 10 minutes per call, blocking
 * every other request (tools/list, pings, a second tool call). This awaits the
 * child instead.
 */
export function runSkill(
  repoRoot: string,
  slug: string,
  varValue: string,
  logPrefix = "[aeon]"
): Promise<string> {
  return enqueue(() => runSkillInner(repoRoot, slug, varValue, logPrefix));
}

async function runSkillInner(
  repoRoot: string,
  slug: string,
  varValue: string,
  logPrefix: string
): Promise<string> {
  const skillFile = join(repoRoot, "skills", slug, "SKILL.md");
  if (!existsSync(skillFile)) {
    return [
      `Error: skill '${slug}' not found.`,
      `Expected SKILL.md at: ${skillFile}`,
      `Make sure you're running from inside an Aeon repo clone.`,
    ].join("\n");
  }

  const capability = resolveMode(repoRoot, slug);
  if (!capability) {
    return [
      `Error: could not resolve the capability tier for '${slug}'.`,
      `scripts/skill_mode.sh must be present and runnable from: ${repoRoot}`,
      `Refusing to run rather than defaulting to write mode.`,
    ].join("\n");
  }

  const prompt = buildSkillPrompt(slug, varValue);
  const harness = resolveHarness(repoRoot, slug);
  process.stderr.write(
    `${logPrefix} Running skill: ${slug}${varValue ? ` (var=${varValue})` : ""} [harness: ${harness}, mode: ${capability.mode}]\n`
  );

  // Every harness goes through harness-adapter's run-harness — the same dispatcher
  // aeon.yml uses — so a local MCP run behaves like a scheduled one and adapter-level
  // fixes (grok's MCP folder --trust, codex's TOML config translation, kimi's
  // config overlay) apply here too. This path used to call `claude -p -` and
  // scripts/run-grok.sh directly, which is how it missed those fixes.
  //
  // --mode/--allowed-tools come from scripts/skill_mode.sh, matching aeon.yml's
  // RH_ARGS. They used to be hardcoded to write, so the twelve skills declaring
  // `mode: read-only` ran unsandboxed with the full write toolset on this path -
  // the same two-path drift the run-path consolidation removed, one layer up.
  const runHarness = join(repoRoot, "harness-adapter", "run-harness");
  const args = [
    runHarness, harness,
    "--mode", capability.mode,
    "--allowed-tools", capability.allowedTools,
    "--timeout", "600",
  ];
  if (existsSync(join(repoRoot, ".mcp.json"))) {
    args.push("--mcp-config", join(repoRoot, ".mcp.json"));
  }

  const result = await spawnHarness(args, {
    input: prompt,
    cwd: repoRoot,
    env: process.env,
    timeout: 600_000, // 10 minutes - same as the GitHub Actions timeout
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  });

  if (result.error) {
    const enoent = result.error.code === "ENOENT";
    const msg = enoent
      ? `'bash' or harness-adapter/run-harness not found — run from inside an Aeon repo clone.`
      : `Failed to spawn run-harness: ${result.error.message}`;
    return `Error: ${msg}`;
  }

  if (result.status !== 0) {
    const output = (result.stderr || result.stdout || "").trim();
    return `Skill '${slug}' failed (exit ${result.status}):\n${output}`;
  }

  const stdout = (result.stdout || "").trim();
  if (!stdout) {
    return `Skill '${slug}' produced no output.`;
  }

  // run-harness normalizes every harness to { result: "..." }, so this parse is
  // harness-agnostic.
  try {
    const parsed = JSON.parse(stdout) as { result?: string };
    return parsed.result ?? stdout;
  } catch {
    return stdout;
  }
}

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
import { spawnSync } from "child_process";

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
export const HARNESSES = ["claude", "grok", "codex", "pi", "vibe", "kimi"] as const;
export type Harness = (typeof HARNESSES)[number];
const isHarness = (v: string): v is Harness =>
  (HARNESSES as readonly string[]).includes(v);

/**
 * Which agent harness runs the skill. Mirrors aeon.yml's resolution so a local
 * MCP run matches a scheduled one: the AEON_HARNESS env wins, else the repo's
 * global `harness:` in aeon.yml, else `claude`. Any unknown value → `claude`.
 */
export function resolveHarness(repoRoot: string): Harness {
  const envH = (process.env.AEON_HARNESS || "").trim().toLowerCase();
  if (isHarness(envH)) return envH;
  try {
    const cfg = readFileSync(join(repoRoot, "aeon.yml"), "utf-8");
    const m = cfg.match(/^harness:\s*["']?([A-Za-z]+)/m);
    const configured = m?.[1].toLowerCase();
    if (configured && isHarness(configured)) return configured;
  } catch {
    /* no aeon.yml → default */
  }
  return "claude";
}

/**
 * Run a skill synchronously and return its text output. Dispatches through
 * harness-adapter's `run-harness`, which emits one `{ result, usage }` envelope
 * for every harness, so parsing is shared. Failure modes (missing skill, missing
 * CLI, non-zero exit, empty output) are returned as human-readable strings rather
 * than thrown, so callers can surface them without special-casing.
 */
export function runSkill(
  repoRoot: string,
  slug: string,
  varValue: string,
  logPrefix = "[aeon]"
): string {
  const skillFile = join(repoRoot, "skills", slug, "SKILL.md");
  if (!existsSync(skillFile)) {
    return [
      `Error: skill '${slug}' not found.`,
      `Expected SKILL.md at: ${skillFile}`,
      `Make sure you're running from inside an Aeon repo clone.`,
    ].join("\n");
  }

  const prompt = buildSkillPrompt(slug, varValue);
  const harness = resolveHarness(repoRoot);
  process.stderr.write(
    `${logPrefix} Running skill: ${slug}${varValue ? ` (var=${varValue})` : ""} [harness: ${harness}]\n`
  );

  // Every harness goes through harness-adapter's run-harness — the same dispatcher
  // aeon.yml uses — so a local MCP run behaves like a scheduled one and adapter-level
  // fixes (grok's MCP folder --trust, codex's TOML config translation, kimi's
  // config overlay) apply here too. This path used to call `claude -p -` and
  // scripts/run-grok.sh directly, which is how it missed those fixes.
  // Write mode: a skill run may edit memory, commit, and notify.
  const runHarness = join(repoRoot, "harness-adapter", "run-harness");
  const args = [runHarness, harness, "--mode", "write", "--timeout", "600"];
  if (existsSync(join(repoRoot, ".mcp.json"))) {
    args.push("--mcp-config", join(repoRoot, ".mcp.json"));
  }

  const result = spawnSync("bash", args, {
    input: prompt,
    cwd: repoRoot,
    env: process.env,
    timeout: 600_000, // 10 minutes — same as the GitHub Actions timeout
    maxBuffer: 10 * 1024 * 1024, // 10 MB
    encoding: "utf-8",
  });

  if (result.error) {
    const enoent = (result.error as NodeJS.ErrnoException).code === "ENOENT";
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

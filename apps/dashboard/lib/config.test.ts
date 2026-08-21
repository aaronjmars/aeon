/**
 * Tests for apps/dashboard/lib/config.ts - YAML config parsing and manipulation.
 *
 * Run with:  node --import tsx --test apps/dashboard/lib/config.test.ts
 *
 * Uses node:test + node:assert (no framework deps) to match the
 * existing test convention in api-gate.test.ts.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  parseConfig,
  updateSkillInConfig,
  updateModelInConfig,
  updateHarnessInConfig,
  updateGatewayInConfig,
  updateJsonrenderInConfig,
  removeSkillFromConfig,
  addSkillToConfig,
  upsertSkillInConfig,
} from "./config";

// ── Minimal valid config ─────────────────────────────────────────────

const MINIMAL_YAML = `skills:
  heartbeat: { enabled: true, schedule: "0 12 * * *" }

model: claude-sonnet-5
`;

const FULL_YAML = `# Aeon configuration
skills:
  morning-brief: { enabled: false, schedule: "0 7 * * *" }
  market-pulse: { enabled: true, schedule: "0 12 * * *", model: "claude-sonnet-5" }
  heartbeat: { enabled: true, schedule: "0 12 * * *" }

model: claude-opus-4-8

gateway:
  provider: direct

channels:
  jsonrender:
    enabled: true
`;

// ── parseConfig ──────────────────────────────────────────────────────

describe("parseConfig", () => {
  it("parses a minimal config", () => {
    const config = parseConfig(MINIMAL_YAML);
    assert.equal(Object.keys(config.skills).length, 1);
    assert.equal(config.skills["heartbeat"].enabled, true);
    assert.equal(config.skills["heartbeat"].schedule, "0 12 * * *");
    assert.equal(config.skills["heartbeat"].var, "");
    assert.equal(config.skills["heartbeat"].model, "");
    assert.equal(config.model, "claude-sonnet-5");
  });

  it("parses a full config with all fields", () => {
    const config = parseConfig(FULL_YAML);
    assert.equal(Object.keys(config.skills).length, 3);
    assert.equal(config.skills["morning-brief"].enabled, false);
    assert.equal(config.skills["morning-brief"].schedule, "0 7 * * *");
    assert.equal(config.skills["market-pulse"].enabled, true);
    assert.equal(config.skills["market-pulse"].model, "claude-sonnet-5");
    assert.equal(config.model, "claude-opus-4-8");
    assert.equal(config.gateway.provider, "direct");
    assert.equal(config.jsonrenderEnabled, true);
  });

  it("defaults model to claude-sonnet-5 when absent", () => {
    const yaml = `skills:\n  test: { enabled: false, schedule: "0 0 * * *" }\n`;
    const config = parseConfig(yaml);
    assert.equal(config.model, "claude-sonnet-5");
  });

  it("defaults gateway to auto when absent", () => {
    const config = parseConfig(MINIMAL_YAML);
    assert.equal(config.gateway.provider, "auto");
  });

  it("parses an explicit auto gateway", () => {
    const yaml = `skills: {}\n\ngateway:\n  provider: auto\n`;
    const config = parseConfig(yaml);
    assert.equal(config.gateway.provider, "auto");
  });

  it("defaults jsonrenderEnabled to false when absent", () => {
    const config = parseConfig(MINIMAL_YAML);
    assert.equal(config.jsonrenderEnabled, false);
  });

  it("parses bankr gateway", () => {
    const yaml = `skills: {}\n\ngateway:\n  provider: bankr\n`;
    const config = parseConfig(yaml);
    assert.equal(config.gateway.provider, "bankr");
  });

  it("parses a skill with var field", () => {
    const yaml = `skills:\n  pr-review: { enabled: false, schedule: "0 9 * * *", var: "owner/repo" }\n`;
    const config = parseConfig(yaml);
    assert.equal(config.skills["pr-review"].var, "owner/repo");
  });

  it("handles empty skills section", () => {
    // yaml library parses `skills:` with no entries as null, not an empty map
    const yaml = `skills:\n\nmodel: claude-sonnet-5\n`;
    const config = parseConfig(yaml);
    assert.equal(Object.keys(config.skills).length, 0);
  });
});

// ── updateSkillInConfig ──────────────────────────────────────────────

describe("updateSkillInConfig", () => {
  it("enables a disabled skill", () => {
    const updated = updateSkillInConfig(MINIMAL_YAML, "heartbeat", { enabled: false });
    assert.ok(updated.includes("heartbeat: { enabled: false"));
  });

  it("changes the schedule", () => {
    const updated = updateSkillInConfig(MINIMAL_YAML, "heartbeat", { schedule: "0 9 * * 1" });
    assert.ok(updated.includes("schedule: '0 9 * * 1'") || updated.includes('schedule: "0 9 * * 1"'));
  });

  it("sets a var on a skill", () => {
    const updated = updateSkillInConfig(MINIMAL_YAML, "heartbeat", { var: "test-value" });
    assert.ok(updated.includes("var: test-value") || updated.includes("var: 'test-value'"));
  });

  it("clears a var when empty string", () => {
    const yaml = `skills:\n  heartbeat: { enabled: true, schedule: "0 12 * * *", var: "old" }\n`;
    const updated = updateSkillInConfig(yaml, "heartbeat", { var: "" });
    // The 'var' key should be deleted from the inline map
    assert.ok(!updated.includes("var:") || updated.includes("var: ''"));
  });

  it("sets a model override on a skill", () => {
    const updated = updateSkillInConfig(MINIMAL_YAML, "heartbeat", { model: "claude-sonnet-5" });
    assert.ok(updated.includes("model: claude-sonnet-5") || updated.includes("model: 'claude-sonnet-5'"));
  });

  it("returns original yaml for non-existent skill", () => {
    const updated = updateSkillInConfig(MINIMAL_YAML, "nonexistent", { enabled: true });
    assert.equal(updated, MINIMAL_YAML);
  });

  it("updates multiple fields at once", () => {
    const updated = updateSkillInConfig(MINIMAL_YAML, "heartbeat", {
      enabled: false,
      schedule: "0 3 * * *",
      var: "hello",
    });
    const config = parseConfig(updated);
    assert.equal(config.skills["heartbeat"].enabled, false);
    assert.equal(config.skills["heartbeat"].schedule, "0 3 * * *");
    assert.equal(config.skills["heartbeat"].var, "hello");
  });

  it("does not fold a long one-liner value across lines", () => {
    // A save must not wrap long scalars (yaml lib default lineWidth: 80). A chain
    // step written as a long one-liner has to survive on a single physical line,
    // or the scheduler's single-line bash parser reads only the first line and
    // runs the step with an empty brief.
    const longVar =
      "step1: research the topic thoroughly across many sources and " +
      "summarize; step2: draft a report; step3: review and refine the final " +
      "output before publishing it to the configured channel";
    const yaml = `skills:\n  chain-step: { enabled: true, schedule: "0 12 * * *", var: "${longVar}" }\n`;
    const updated = updateSkillInConfig(yaml, "chain-step", { enabled: false });
    // The whole value stays on one physical line (no fold).
    assert.ok(
      updated.split("\n").some((line) => line.includes(longVar)),
      "long var value was folded across lines",
    );
    // And it still round-trips intact.
    assert.equal(parseConfig(updated).skills["chain-step"].var, longVar);
  });
});

// ── updateModelInConfig ──────────────────────────────────────────────

describe("updateModelInConfig", () => {
  it("updates the top-level model", () => {
    const updated = updateModelInConfig(MINIMAL_YAML, "claude-opus-4-8");
    const config = parseConfig(updated);
    assert.equal(config.model, "claude-opus-4-8");
  });

  it("replaces an existing model", () => {
    const updated = updateModelInConfig(FULL_YAML, "claude-haiku-4-5-20251001");
    const config = parseConfig(updated);
    assert.equal(config.model, "claude-haiku-4-5-20251001");
  });
});

// ── harness (parse + update) ─────────────────────────────────────────

describe("harness config", () => {
  it("defaults harness to claude when absent", () => {
    assert.equal(parseConfig(MINIMAL_YAML).harness, "claude");
  });

  it("parses an explicit grok harness", () => {
    const yaml = `skills: {}\n\nharness: grok\n`;
    assert.equal(parseConfig(yaml).harness, "grok");
  });

  it("falls back to claude for an unknown harness value", () => {
    const yaml = `skills: {}\n\nharness: bogus\n`;
    assert.equal(parseConfig(yaml).harness, "claude");
  });

  it("parses a per-skill harness override", () => {
    const yaml = `skills:\n  digest: { enabled: true, schedule: "0 9 * * *", harness: "grok" }\n`;
    assert.equal(parseConfig(yaml).skills["digest"].harness, "grok");
  });

  it("updateHarnessInConfig sets the top-level harness", () => {
    const updated = updateHarnessInConfig(MINIMAL_YAML, "grok");
    assert.equal(parseConfig(updated).harness, "grok");
  });

  it("updateHarnessInConfig flips back to claude", () => {
    const grok = updateHarnessInConfig(MINIMAL_YAML, "grok");
    const updated = updateHarnessInConfig(grok, "claude");
    assert.equal(parseConfig(updated).harness, "claude");
  });

  it("updateSkillInConfig pins grok per-skill", () => {
    const updated = updateSkillInConfig(MINIMAL_YAML, "heartbeat", { harness: "grok" });
    assert.equal(parseConfig(updated).skills["heartbeat"].harness, "grok");
  });

  it("updateSkillInConfig clears the per-skill override when set to claude", () => {
    const yaml = `skills:\n  heartbeat: { enabled: true, schedule: "0 12 * * *", harness: "grok" }\n`;
    const updated = updateSkillInConfig(yaml, "heartbeat", { harness: "claude" });
    assert.equal(parseConfig(updated).skills["heartbeat"].harness, "");
  });
});

// ── updateGatewayInConfig ────────────────────────────────────────────

describe("updateGatewayInConfig", () => {
  it("flips an existing provider to bankr", () => {
    const updated = updateGatewayInConfig(FULL_YAML, "bankr");
    assert.equal(parseConfig(updated).gateway.provider, "bankr");
  });

  it("flips back to direct", () => {
    const bankr = updateGatewayInConfig(FULL_YAML, "bankr");
    const updated = updateGatewayInConfig(bankr, "direct");
    assert.equal(parseConfig(updated).gateway.provider, "direct");
  });

  it("creates the gateway block when absent", () => {
    const updated = updateGatewayInConfig(MINIMAL_YAML, "bankr");
    assert.equal(parseConfig(updated).gateway.provider, "bankr");
  });
});

// ── updateJsonrenderInConfig ─────────────────────────────────────────

describe("updateJsonrenderInConfig", () => {
  it("enables jsonrender when channels block exists", () => {
    const updated = updateJsonrenderInConfig(FULL_YAML, true);
    const config = parseConfig(updated);
    assert.equal(config.jsonrenderEnabled, true);
  });

  it("disables jsonrender", () => {
    const updated = updateJsonrenderInConfig(FULL_YAML, false);
    const config = parseConfig(updated);
    assert.equal(config.jsonrenderEnabled, false);
  });

  it("returns original when no channels block exists", () => {
    // MINIMAL_YAML has no channels block
    const updated = updateJsonrenderInConfig(MINIMAL_YAML, true);
    assert.equal(updated, MINIMAL_YAML);
  });
});

// ── removeSkillFromConfig ───────────────────────────────────────────

describe("removeSkillFromConfig", () => {
  it("removes a skill entry", () => {
    const updated = removeSkillFromConfig(FULL_YAML, "market-pulse");
    const config = parseConfig(updated);
    assert.equal(config.skills["market-pulse"], undefined);
    assert.equal(config.skills["morning-brief"].enabled, false);
    assert.equal(config.skills["heartbeat"].enabled, true);
  });

  it("returns original when skill does not exist", () => {
    const updated = removeSkillFromConfig(MINIMAL_YAML, "nonexistent");
    assert.equal(updated, MINIMAL_YAML);
  });

  it("removes the only skill", () => {
    const updated = removeSkillFromConfig(MINIMAL_YAML, "heartbeat");
    const config = parseConfig(updated);
    assert.equal(Object.keys(config.skills).length, 0);
  });
});

// ── addSkillToConfig ─────────────────────────────────────────────────

describe("addSkillToConfig", () => {
  it("adds a new skill with defaults", () => {
    const updated = addSkillToConfig(MINIMAL_YAML, "new-skill");
    const config = parseConfig(updated);
    assert.ok(config.skills["new-skill"]);
    assert.equal(config.skills["new-skill"].enabled, false);
    assert.equal(config.skills["new-skill"].schedule, "0 12 * * *");
  });

  it("does not duplicate an existing skill", () => {
    const updated = addSkillToConfig(MINIMAL_YAML, "heartbeat");
    assert.equal(updated, MINIMAL_YAML);
  });

  it("adds with custom config", () => {
    const updated = addSkillToConfig(MINIMAL_YAML, "custom-skill", {
      enabled: true,
      schedule: "0 9 * * 1",
    });
    const config = parseConfig(updated);
    assert.equal(config.skills["custom-skill"].enabled, true);
    assert.equal(config.skills["custom-skill"].schedule, "0 9 * * 1");
  });

  it("inserts before the heartbeat fallback entry", () => {
    const updated = addSkillToConfig(FULL_YAML, "brand-new");
    // The new skill should appear before heartbeat in the YAML
    const heartbeatIdx = updated.indexOf("heartbeat:");
    const brandNewIdx = updated.indexOf("brand-new:");
    assert.ok(brandNewIdx < heartbeatIdx, "new skill should be inserted before heartbeat");
  });

  it("inserts at end when heartbeat is absent", () => {
    const yaml = `skills:\n  alpha: { enabled: false, schedule: "0 0 * * *" }\n\nmodel: claude-sonnet-5\n`;
    const updated = addSkillToConfig(yaml, "beta");
    const config = parseConfig(updated);
    assert.ok(config.skills["beta"]);
  });
});

// ── Round-trip: parse → update → parse ──────────────────────────────

describe("round-trip config mutations", () => {
  it("add → update → parse preserves all fields", () => {
    let yaml = MINIMAL_YAML;
    yaml = addSkillToConfig(yaml, "deep-research", { enabled: false, schedule: "0 14 * * *" });
    yaml = updateSkillInConfig(yaml, "deep-research", { enabled: true, var: "quantum computing" });
    const config = parseConfig(yaml);
    assert.equal(config.skills["deep-research"].enabled, true);
    assert.equal(config.skills["deep-research"].var, "quantum computing");
    assert.equal(config.skills["deep-research"].schedule, "0 14 * * *");
    // Original skills still intact
    assert.equal(config.skills["heartbeat"].enabled, true);
  });

  it("add → remove → add again works", () => {
    let yaml = addSkillToConfig(MINIMAL_YAML, "temp-skill");
    assert.ok(parseConfig(yaml).skills["temp-skill"]);
    yaml = removeSkillFromConfig(yaml, "temp-skill");
    assert.equal(parseConfig(yaml).skills["temp-skill"], undefined);
    yaml = addSkillToConfig(yaml, "temp-skill");
    assert.ok(parseConfig(yaml).skills["temp-skill"]);
  });

  it("update model and gateway independently", () => {
    let yaml = updateModelInConfig(MINIMAL_YAML, "claude-opus-4-8");
    const config1 = parseConfig(yaml);
    assert.equal(config1.model, "claude-opus-4-8");

    // Model change should not affect skills
    assert.equal(config1.skills["heartbeat"].enabled, true);
  });
});

// ── upsertSkillInConfig ──────────────────────────────────────────────

describe("upsertSkillInConfig", () => {
  it("creates and enables an entry that does not exist yet", () => {
    // The regression: updateSkillInConfig no-ops here, so `aeon skills enable`
    // silently did nothing for a freshly created SKILL.md.
    assert.equal(
      updateSkillInConfig(MINIMAL_YAML, "brand-new", { enabled: true }),
      MINIMAL_YAML,
    );

    const yaml = upsertSkillInConfig(MINIMAL_YAML, "brand-new", { enabled: true });
    assert.equal(parseConfig(yaml).skills["brand-new"].enabled, true);
  });

  it("creates with the given schedule rather than the default", () => {
    const yaml = upsertSkillInConfig(MINIMAL_YAML, "brand-new", { schedule: "0 8 * * 1-5" });
    const entry = parseConfig(yaml).skills["brand-new"];
    assert.equal(entry.schedule, "0 8 * * 1-5");
    // Scheduling alone must not turn the skill on.
    assert.equal(entry.enabled, false);
  });

  it("updates an existing entry without duplicating it", () => {
    const yaml = upsertSkillInConfig(FULL_YAML, "market-pulse", { schedule: "0 6 * * *" });
    const config = parseConfig(yaml);
    assert.equal(config.skills["market-pulse"].schedule, "0 6 * * *");
    // Pre-existing fields survive, and the key appears exactly once.
    assert.equal(config.skills["market-pulse"].model, "claude-sonnet-5");
    assert.equal(yaml.match(/^\s*market-pulse:/gm)?.length, 1);
  });

  it("keeps heartbeat last when creating", () => {
    const yaml = upsertSkillInConfig(MINIMAL_YAML, "brand-new", { enabled: true });
    const names = [...yaml.matchAll(/^ {2}([a-z][a-z0-9-]*):/gm)].map(m => m[1]);
    assert.equal(names[names.length - 1], "heartbeat");
  });

  it("is idempotent", () => {
    const once = upsertSkillInConfig(MINIMAL_YAML, "brand-new", { enabled: true });
    const twice = upsertSkillInConfig(once, "brand-new", { enabled: true });
    assert.equal(once, twice);
  });
});

// ── Scheduler parseability ───────────────────────────────────────────
//
// .github/workflows/scheduler.yml reads aeon.yml with a bash regex that only
// matches a DOUBLE-QUOTED cron:
//     [[ "$INLINE" =~ schedule:\ *\"([^\"]+)\" ]]
// An unquoted `schedule: 0 12 * * *` is valid YAML but invisible to it, and the
// empty-schedule guard then skips the skill — it silently never fires. Any
// function that writes a schedule must emit the quoted form.

describe("generated entries are readable by the scheduler", () => {
  const SCHEDULER_INLINE_RE = /schedule: *"([^"]+)"/;

  const scheduleLine = (yaml: string, name: string) =>
    yaml.split("\n").find(l => l.trim().startsWith(`${name}:`)) ?? "";

  it("addSkillToConfig quotes the default schedule", () => {
    const line = scheduleLine(addSkillToConfig(MINIMAL_YAML, "brand-new"), "brand-new");
    assert.match(line, SCHEDULER_INLINE_RE);
  });

  it("addSkillToConfig quotes an explicit schedule", () => {
    const yaml = addSkillToConfig(MINIMAL_YAML, "brand-new", { schedule: "0 8 * * 1-5" });
    const line = scheduleLine(yaml, "brand-new");
    assert.match(line, SCHEDULER_INLINE_RE);
    assert.equal(line.match(SCHEDULER_INLINE_RE)![1], "0 8 * * 1-5");
  });

  it("upsertSkillInConfig quotes on create", () => {
    const yaml = upsertSkillInConfig(MINIMAL_YAML, "brand-new", { schedule: "*/30 * * * *" });
    assert.match(scheduleLine(yaml, "brand-new"), SCHEDULER_INLINE_RE);
  });

  it("upsertSkillInConfig keeps the quotes when updating", () => {
    const yaml = upsertSkillInConfig(FULL_YAML, "market-pulse", { schedule: "0 6 * * *" });
    assert.match(scheduleLine(yaml, "market-pulse"), SCHEDULER_INLINE_RE);
  });
});
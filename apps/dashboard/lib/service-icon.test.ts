/**
 * Tests for components/ui/ServiceIcon - the brand marks beside every credential
 * in Settings > Access Keys (regression: five native-harness secrets and two
 * GitHub PATs were added to lib/secrets-catalog.ts without a matching row in the
 * icon map, so they rendered as grey two-letter badges instead of a logo).
 *
 * Run with:  node --import tsx --test apps/dashboard/lib/service-icon.test.ts
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { resolveServiceMark } from "../components/ui/ServiceIcon";
import { BUILTIN_SECRETS } from "./secrets-catalog";

describe("resolveServiceMark", () => {
  it("gives every catalogued secret a logo or a glyph, never the initials badge", () => {
    const unmarked = BUILTIN_SECRETS
      .map(s => s.name)
      .filter(name => {
        const { src, glyph } = resolveServiceMark({ name });
        return !src && !glyph;
      });
    assert.deepEqual(unmarked, [], `secrets missing an icon: ${unmarked.join(", ")}`);
  });

  it("routes a credential to its brand favicon", () => {
    assert.match(resolveServiceMark({ name: "CODEX_AUTH" }).src ?? "", /openai\.com/);
    assert.match(resolveServiceMark({ name: "GH_SECRETS_PAT" }).src ?? "", /github\.com/);
  });

  it("prefers a vendored logo over the favicon service", () => {
    assert.equal(resolveServiceMark({ domain: "langfuse.com" }).src, "/icons/langfuse.svg");
  });

  it("falls back to the initials badge for an unknown custom secret", () => {
    const { src, glyph } = resolveServiceMark({ name: "SOME_CUSTOM_KEY" });
    assert.equal(src, undefined);
    assert.equal(glyph, undefined);
  });
});

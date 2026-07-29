/**
 * Tests for lib/service-icons.ts - the brand marks beside every credential in
 * Settings > Access Keys (regression: five native-harness secrets and two GitHub
 * PATs were added to lib/secrets-catalog.ts without a matching row in the icon
 * map, so they rendered as grey two-letter badges instead of a logo).
 *
 * Run with:  node --import tsx --test apps/dashboard/lib/service-icon.test.ts
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { resolveServiceMark } from "./service-icons";
import { BUILTIN_SECRETS, describeMcpSecret } from "./secrets-catalog";
import { MCP_CATALOG, tokenVar, oauthVar, MCP_SECRET_RE, mcpServerLabel } from "./mcp-catalog";

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

  it("gives every featured MCP server's credentials its catalog logo", () => {
    for (const entry of MCP_CATALOG) {
      for (const name of [tokenVar(entry.slug), oauthVar(entry.slug)]) {
        assert.equal(resolveServiceMark({ name }).src, entry.logo, `${name} should carry ${entry.name}'s logo`);
      }
    }
  });

  it("gives a custom MCP server's credential the server glyph, not initials", () => {
    const { src, glyph } = resolveServiceMark({ name: "MCP_MY_SERVER_TOKEN" });
    assert.equal(src, undefined);
    assert.equal(glyph, "server");
  });
});

describe("MCP credential grouping", () => {
  it("matches only the names tokenVar/oauthVar mint", () => {
    assert.ok(MCP_SECRET_RE.test("MCP_GLIM_TOKEN"));
    assert.ok(MCP_SECRET_RE.test("MCP_ROBINHOOD_TRADING_OAUTH"));
    // Near-misses that must stay in the Skill Keys catch-all.
    assert.ok(!MCP_SECRET_RE.test("MCP_TOKEN"));
    assert.ok(!MCP_SECRET_RE.test("GH_SECRETS_PAT"));
    assert.ok(!MCP_SECRET_RE.test("MCP_GLIM_TOKEN_BACKUP"));
  });

  it("labels a featured server by brand and a custom one by slug", () => {
    assert.equal(mcpServerLabel("MCP_ROBINHOOD_TRADING_TOKEN"), "Robinhood Trading");
    assert.equal(mcpServerLabel("MCP_MY_SERVER_OAUTH"), "my server");
  });

  it("tells an OAuth-minted token apart from a pasted static bearer", () => {
    const oauthManaged = describeMcpSecret("MCP_GLIM_TOKEN", new Set(["MCP_GLIM_TOKEN", "MCP_GLIM_OAUTH"]));
    assert.match(oauthManaged, /re-minted/);
    const staticBearer = describeMcpSecret("MCP_GLIM_TOKEN", new Set(["MCP_GLIM_TOKEN"]));
    assert.match(staticBearer, /Static bearer/);
  });
});

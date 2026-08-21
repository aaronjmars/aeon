/**
 * Tests for lib/workflow-secrets.ts - auto-allowlisting MCP secret names into the
 * workflow ALL_SECRETS blob.
 *
 * Run with:  node --import tsx --test apps/dashboard/lib/workflow-secrets.test.ts
 * Uses node:test + node:assert (no framework deps) to match the sibling suites.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { referencedSecrets, patchWorkflowContent } from "./workflow-secrets";

// A minimal stand-in for the real ALL_SECRETS block: a `>-` folded scalar whose
// value is one physical line of minified JSON.
const BLOB_LINE =
  '            {"ALCHEMY_API_KEY":${{ toJSON(secrets.ALCHEMY_API_KEY) }},"XAI_API_KEY":${{ toJSON(secrets.XAI_API_KEY) }}}';
const WORKFLOW = ["env:", "          ALL_SECRETS: >-", BLOB_LINE, "          OTHER: x", ""].join("\n");

describe("referencedSecrets", () => {
  it("extracts unique ${VAR} names from a servers object", () => {
    const servers = {
      finance: { url: "https://x", headers: { Authorization: "Bearer ${FINANCE_API_KEY}" } },
      other: { headers: { A: "${FINANCE_API_KEY}", B: "${GLIM_TOKEN}" } },
    };
    assert.deepEqual(referencedSecrets(servers).sort(), ["FINANCE_API_KEY", "GLIM_TOKEN"]);
  });

  it("returns [] when nothing is referenced", () => {
    assert.deepEqual(referencedSecrets({ x: { url: "https://y" } }), []);
  });

  it("ignores lowercase / malformed placeholders", () => {
    assert.deepEqual(referencedSecrets({ a: "${lower_case} ${123BAD} ${OK_KEY}" }), ["OK_KEY"]);
  });
});

describe("patchWorkflowContent", () => {
  it("splices a new secret before the blob's closing brace", () => {
    const { content, added } = patchWorkflowContent(WORKFLOW, ["FINANCE_API_KEY"]);
    assert.deepEqual(added, ["FINANCE_API_KEY"]);
    assert.ok(content.includes('"FINANCE_API_KEY":${{ toJSON(secrets.FINANCE_API_KEY) }}'));
    // Inserted before the final `}` (still inside the JSON object).
    assert.ok(content.includes('"XAI_API_KEY":${{ toJSON(secrets.XAI_API_KEY) }},"FINANCE_API_KEY":'));
  });

  it("keeps the blob on a single physical line", () => {
    const { content } = patchWorkflowContent(WORKFLOW, ["FINANCE_API_KEY"]);
    const blob = content.split("\n").find((l) => l.trimStart().startsWith('{"'));
    assert.ok(blob);
    assert.ok(blob!.includes("FINANCE_API_KEY"));
    // The line count is unchanged - no fold/newline introduced.
    assert.equal(content.split("\n").length, WORKFLOW.split("\n").length);
  });

  it("preserves the blob line's indentation", () => {
    const { content } = patchWorkflowContent(WORKFLOW, ["FINANCE_API_KEY"]);
    const blob = content.split("\n").find((l) => l.includes("FINANCE_API_KEY"));
    assert.ok(blob!.startsWith("            {"));
  });

  it("is idempotent - an already-present name is not re-added", () => {
    const { content, added } = patchWorkflowContent(WORKFLOW, ["XAI_API_KEY"]);
    assert.deepEqual(added, []);
    assert.equal(content, WORKFLOW);
    // Exactly one occurrence of the key.
    assert.equal(content.split('"XAI_API_KEY":').length - 1, 1);
  });

  it("adds only the missing names when some already exist", () => {
    const { content, added } = patchWorkflowContent(WORKFLOW, ["XAI_API_KEY", "GLIM_TOKEN"]);
    assert.deepEqual(added, ["GLIM_TOKEN"]);
    assert.ok(content.includes('"GLIM_TOKEN":${{ toJSON(secrets.GLIM_TOKEN) }}'));
  });

  it("returns the content unchanged when there is no blob line", () => {
    const noBlob = "env:\n  FOO: bar\n";
    const { content, added } = patchWorkflowContent(noBlob, ["FINANCE_API_KEY"]);
    assert.equal(content, noBlob);
    assert.deepEqual(added, []);
  });

  it("still parses as one JSON object after the splice", () => {
    const { content } = patchWorkflowContent(WORKFLOW, ["FINANCE_API_KEY"]);
    const blob = content.split("\n").find((l) => l.trimStart().startsWith('{"'))!.trim();
    // Strip the ${{ … }} expressions to a placeholder so the skeleton is JSON.
    const skeleton = blob.replace(/\$\{\{[^}]*\}\}/g, '"x"');
    const parsed = JSON.parse(skeleton) as Record<string, string>;
    assert.deepEqual(
      Object.keys(parsed).sort(),
      ["ALCHEMY_API_KEY", "FINANCE_API_KEY", "XAI_API_KEY"],
    );
  });
});

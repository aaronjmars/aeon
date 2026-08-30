/**
 * Smoke tests for the dashboard API gate. Pure stdlib (`node:test` +
 * `node:assert`) so this file runs with `node --test` without a
 * framework dep - the dashboard doesn't ship a test runner today.
 *
 *   node --import tsx --test apps/dashboard/lib/security/api-gate.test.ts
 */
import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  gateRequest,
  isAllowedHost,
  isSameOriginWrite,
  parseAllowedHosts,
  stripPort,
} from "./api-gate";

function headers(map: Record<string, string | null>) {
  return {
    get(name: string) {
      const v = map[name.toLowerCase()];
      return v === undefined ? null : v;
    },
  };
}

describe("stripPort", () => {
  it("preserves bare hostnames", () => {
    assert.equal(stripPort("localhost"), "localhost");
    assert.equal(stripPort("127.0.0.1"), "127.0.0.1");
  });
  it("strips ipv4 + dns ports", () => {
    assert.equal(stripPort("localhost:5555"), "localhost");
    assert.equal(stripPort("127.0.0.1:5555"), "127.0.0.1");
  });
  it("strips ipv6 ports while keeping brackets", () => {
    assert.equal(stripPort("[::1]:5555"), "[::1]");
    assert.equal(stripPort("[::1]"), "[::1]");
  });
  it("lower-cases", () => {
    assert.equal(stripPort("LOCALHOST:5555"), "localhost");
  });
});

describe("parseAllowedHosts", () => {
  it("returns an empty set on missing / empty input", () => {
    assert.equal(parseAllowedHosts(undefined).size, 0);
    assert.equal(parseAllowedHosts("").size, 0);
  });
  it("splits + trims + lowercases + strips ports", () => {
    const set = parseAllowedHosts("Aeon.local, HOST-A:8080 , host-b");
    assert.deepEqual([...set].sort(), ["aeon.local", "host-a", "host-b"]);
  });
});

describe("isAllowedHost", () => {
  it("accepts loopback variants on any port", () => {
    assert.equal(isAllowedHost("127.0.0.1:5555"), true);
    assert.equal(isAllowedHost("localhost"), true);
    assert.equal(isAllowedHost("[::1]:5555"), true);
  });
  it("rejects attacker hosts", () => {
    assert.equal(isAllowedHost("attacker.example"), false);
    assert.equal(isAllowedHost("localhost.attacker.example"), false);
    assert.equal(isAllowedHost("127.0.0.2"), false);
  });
  it("rejects empty / null", () => {
    assert.equal(isAllowedHost(null), false);
    assert.equal(isAllowedHost(""), false);
  });
  it("respects extraAllowed", () => {
    const extras = parseAllowedHosts("aeon.local");
    assert.equal(isAllowedHost("aeon.local:5555", { extraAllowed: extras }), true);
    assert.equal(isAllowedHost("attacker.example", { extraAllowed: extras }), false);
  });
  it("allowAny=true bypasses the check", () => {
    assert.equal(isAllowedHost("attacker.example", { allowAny: true }), true);
    assert.equal(isAllowedHost(null, { allowAny: true }), true);
  });
});

describe("isSameOriginWrite", () => {
  it("safe methods skip the check", () => {
    assert.equal(isSameOriginWrite("GET", headers({})), true);
    assert.equal(isSameOriginWrite("HEAD", headers({})), true);
    assert.equal(isSameOriginWrite("OPTIONS", headers({})), true);
  });
  it("POST with same-origin Origin passes", () => {
    assert.equal(
      isSameOriginWrite(
        "POST",
        headers({ host: "localhost:5555", origin: "http://localhost:5555" }),
      ),
      true,
    );
    assert.equal(
      isSameOriginWrite(
        "POST",
        headers({ host: "127.0.0.1:5555", origin: "http://127.0.0.1:5555" }),
      ),
      true,
    );
  });
  it("POST with a different loopback alias fails", () => {
    assert.equal(
      isSameOriginWrite(
        "POST",
        headers({ host: "127.0.0.1:5555", origin: "http://localhost:5555" }),
      ),
      false,
    );
  });
  it("POST with cross-origin Origin fails", () => {
    assert.equal(
      isSameOriginWrite(
        "POST",
        headers({ host: "localhost:5555", origin: "http://attacker.example" }),
      ),
      false,
    );
  });
  it("POST falls back to Referer when Origin is absent", () => {
    assert.equal(
      isSameOriginWrite(
        "POST",
        headers({ host: "localhost:5555", referer: "http://localhost:5555/dashboard" }),
      ),
      true,
    );
    assert.equal(
      isSameOriginWrite(
        "POST",
        headers({ host: "127.0.0.1:5555", referer: "http://localhost:5555/dashboard" }),
      ),
      false,
    );
    assert.equal(
      isSameOriginWrite(
        "POST",
        headers({ host: "localhost:5555", referer: "http://attacker.example/p" }),
      ),
      false,
    );
  });
  it("POST with neither Origin nor Referer is rejected", () => {
    assert.equal(isSameOriginWrite("POST", headers({ host: "localhost:5555" })), false);
  });
  it("POST with missing or malformed Host is rejected", () => {
    assert.equal(
      isSameOriginWrite("POST", headers({ origin: "http://localhost:5555" })),
      false,
    );
    assert.equal(
      isSameOriginWrite(
        "POST",
        headers({ host: "localhost:5555/path", origin: "http://localhost:5555" }),
      ),
      false,
    );
  });
  it("POST with malformed Origin is rejected", () => {
    assert.equal(
      isSameOriginWrite(
        "POST",
        headers({ host: "localhost:5555", origin: "not-a-url" }),
      ),
      false,
    );
  });
});

describe("gateRequest (env-driven wrapper)", () => {
  afterEach(() => {
    delete process.env.AEON_DASHBOARD_ALLOWED_HOSTS;
    delete process.env.AEON_DASHBOARD_ALLOW_ANY_HOST;
  });

  it("accepts a same-origin POST from localhost", () => {
    const result = gateRequest({
      method: "POST",
      headers: headers({ host: "localhost:5555", origin: "http://localhost:5555" }),
    });
    assert.equal(result, null);
  });

  it("accepts an exact same-origin POST from 127.0.0.1", () => {
    const result = gateRequest({
      method: "POST",
      headers: headers({ host: "127.0.0.1:5555", origin: "http://127.0.0.1:5555" }),
    });
    assert.equal(result, null);
  });

  it("rejects a POST when loopback Host and Origin aliases differ", async () => {
    const result = gateRequest({
      method: "POST",
      headers: headers({ host: "127.0.0.1:5555", origin: "http://localhost:5555" }),
    });
    assert.ok(result instanceof Response, "expected 403 Response");
    assert.equal(result!.status, 403);
    const body = await result!.json();
    assert.equal(body.error, "Cross-origin write rejected");
  });

  it("rejects an attacker.example Host (DNS rebinding)", async () => {
    const result = gateRequest({
      method: "GET",
      headers: headers({ host: "attacker.example" }),
    });
    assert.ok(result instanceof Response, "expected 403 Response");
    assert.equal(result!.status, 403);
    const body = await result!.json();
    assert.equal(body.error, "Host not allowed");
  });

  it("rejects a same-Host but cross-origin POST (CSRF)", async () => {
    const result = gateRequest({
      method: "POST",
      headers: headers({ host: "localhost:5555", origin: "http://attacker.example" }),
    });
    assert.ok(result instanceof Response, "expected 403 Response");
    assert.equal(result!.status, 403);
    const body = await result!.json();
    assert.equal(body.error, "Cross-origin write rejected");
  });

  it("rejects a POST with no Origin header (CSRF fallback path)", async () => {
    const result = gateRequest({
      method: "POST",
      headers: headers({ host: "localhost:5555" }),
    });
    assert.ok(result instanceof Response, "expected 403 Response");
    assert.equal(result!.status, 403);
  });

  it("AEON_DASHBOARD_ALLOWED_HOSTS extends the allowlist", () => {
    process.env.AEON_DASHBOARD_ALLOWED_HOSTS = "aeon.local";
    const result = gateRequest({
      method: "POST",
      headers: headers({ host: "aeon.local:5555", origin: "http://aeon.local:5555" }),
    });
    assert.equal(result, null);
  });

  it("AEON_DASHBOARD_ALLOW_ANY_HOST=1 bypasses both checks (proxy mode)", () => {
    process.env.AEON_DASHBOARD_ALLOW_ANY_HOST = "1";
    const result = gateRequest({
      method: "POST",
      headers: headers({ host: "attacker.example", origin: "http://attacker.example" }),
    });
    assert.equal(result, null);
  });
});

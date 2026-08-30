/**
 * Local-only access gate for the dashboard API surface.
 *
 * Threat model
 * ============
 *
 * The dashboard ships as a Next.js app that the operator launches on
 * `http://localhost:5555` via `./aeon`. The `/api/*` routes hold the
 * keys to the GitHub Actions kingdom for this repo:
 *
 *   - `POST /api/skills/[name]/run`        - triggers `gh workflow run aeon.yml`
 *   - `POST/DELETE /api/secrets`           - sets/deletes any GitHub secret
 *   - `POST /api/auth`                     - writes `CLAUDE_CODE_OAUTH_TOKEN`
 *
 * None of these have any application-level authentication today: the
 * implicit assumption is "the dashboard only listens on localhost, so the
 * filesystem-level user boundary is the auth boundary." Two failure
 * modes break that assumption:
 *
 *   1. **DNS rebinding** - a malicious page loaded in the operator's own
 *      browser at `attacker.example` flips DNS to `127.0.0.1` and POSTs
 *      to `/api/secrets`. The browser dials the loopback IP but sends
 *      `Host: attacker.example`. Without a Host-header gate, the request
 *      hits the route and the attacker has read/write on every GitHub
 *      secret in the repo (incl. `ANTHROPIC_API_KEY`,
 *      `CLAUDE_CODE_OAUTH_TOKEN`, `GH_GLOBAL`).
 *
 *   2. **Cross-origin CSRF** - a malicious page on any origin can
 *      `fetch("http://localhost:5555/api/skills/foo/run", { method: "POST",
 *      mode: "no-cors", body: "{}" })` and the browser will deliver it.
 *      No-cors POSTs with `Content-Type: text/plain` skip preflight, so
 *      CORS alone does not protect state-changing routes.
 *
 * The validator answers both with two independent checks:
 *
 *   - `assertLoopbackHost` - `Host` must be a loopback variant (or an
 *      operator-extended allowlist entry). Defeats #1.
 *   - `assertSameOriginIfWriting` - for non-`GET`/`HEAD`, `Origin` (or
 *      `Referer` fallback) must resolve to the same loopback set.
 *      Defeats #2.
 *
 * The hatches `AEON_DASHBOARD_ALLOWED_HOSTS` (comma-separated extra
 * hosts) and `AEON_DASHBOARD_ALLOW_ANY_HOST=1` (full bypass, intended
 * for reverse-proxy mode) exist so an operator running the dashboard
 * behind Caddy / Tailscale / a remote tunnel can keep working. The
 * bypass is loudly insecure and is not the default.
 */

const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "0.0.0.0", // some test runners and `next dev` itself send 0.0.0.0
]);

/**
 * Strip the optional port from a Host header. Handles IPv4 / DNS
 * (`localhost:5555`) and bracketed IPv6 (`[::1]:5555`).
 */
export function stripPort(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) return trimmed;
    return trimmed.slice(0, end + 1);
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon === -1) return trimmed;
  const after = trimmed.slice(colon + 1);
  if (after.length > 0 && /^\d+$/.test(after)) return trimmed.slice(0, colon);
  return trimmed;
}

function normalizeRequestHost(headerHost: string | null): string | null {
  if (!headerHost) return null;
  const trimmed = headerHost.trim();
  if (!trimmed || /[/?#@\\]/.test(trimmed)) return null;

  const authorityPattern = trimmed.startsWith("[")
    ? /^\[[^\]]+\](?::\d+)?$/
    : /^[^:]+(?::\d+)?$/;
  if (!authorityPattern.test(trimmed)) return null;

  try {
    const url = new URL(`http://${trimmed}`);
    if (!url.host || url.username || url.password) return null;
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Parse `AEON_DASHBOARD_ALLOWED_HOSTS` into a normalized set.
 */
export function parseAllowedHosts(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const v = part.trim().toLowerCase();
    if (v) out.add(stripPort(v));
  }
  return out;
}

export type GateOptions = {
  extraAllowed?: Set<string> | string[];
  allowAny?: boolean;
};

/**
 * Returns true iff `headerHost` resolves to a loopback variant, an
 * operator-extended allowlist entry, or `allowAny` is enabled.
 *
 * An empty/null host is treated as not allowed - HTTP/1.1 requires
 * a Host header, so a missing one is anomalous.
 */
export function isAllowedHost(
  headerHost: string | null | undefined,
  opts: GateOptions = {},
): boolean {
  if (opts.allowAny) return true;
  if (!headerHost) return false;
  const host = stripPort(headerHost);
  if (!host) return false;
  if (LOOPBACK_HOSTS.has(host)) return true;
  const extras =
    opts.extraAllowed instanceof Set
      ? opts.extraAllowed
      : new Set((opts.extraAllowed ?? []).map((h) => stripPort(h.toLowerCase())));
  return extras.has(host);
}

/**
 * Returns true iff the `Origin` (or `Referer`) of a state-changing
 * request resolves to the same allowed host as the request Host.
 * GET/HEAD/OPTIONS skip the check because they shouldn't have side effects.
 *
 * `Origin` is preferred; modern browsers send it on every fetch /
 * XHR / form POST. `Referer` is a fallback for old clients that omit
 * `Origin`. A request with neither header is rejected - that
 * combination doesn't happen from a real browser making a cross-origin
 * request to a state-changing endpoint.
 */
export function isSameOriginWrite(
  method: string,
  headers: { get(name: string): string | null },
  opts: GateOptions = {},
): boolean {
  if (opts.allowAny) return true;
  const safe = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (safe) return true;

  const requestHost = normalizeRequestHost(headers.get("host"));
  if (!requestHost || !isAllowedHost(requestHost, opts)) return false;

  const originUrl = headers.get("origin") || headers.get("referer");
  if (!originUrl) return false;

  let originHost: string;
  try {
    originHost = new URL(originUrl).host.toLowerCase();
  } catch {
    return false;
  }

  return originHost === requestHost && isAllowedHost(originHost, opts);
}

/**
 * Top-level gate used by `apps/dashboard/proxy.ts`. Reads the two env
 * vars once and applies both checks. Returns `null` on success or a
 * `Response` with a 403 + JSON body explaining the rejection.
 */
export function gateRequest(req: {
  method: string;
  headers: { get(name: string): string | null };
}): Response | null {
  const opts: GateOptions = {
    extraAllowed: parseAllowedHosts(process.env.AEON_DASHBOARD_ALLOWED_HOSTS),
    allowAny: process.env.AEON_DASHBOARD_ALLOW_ANY_HOST === "1",
  };

  if (!isAllowedHost(req.headers.get("host"), opts)) {
    return new Response(
      JSON.stringify({
        error: "Host not allowed",
        hint:
          "The Aeon dashboard API accepts loopback Hosts only (127.0.0.1, localhost, ::1) by default. " +
          "If you're fronting the dashboard at a non-loopback hostname (LAN, Tailscale, .local), add it to " +
          "AEON_DASHBOARD_ALLOWED_HOSTS (comma-separated). For trusted reverse-proxy setups that terminate " +
          "Host upstream, set AEON_DASHBOARD_ALLOW_ANY_HOST=1 - this disables the gate, do not use it on a " +
          "public origin without an authenticating proxy in front.",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }

  if (!isSameOriginWrite(req.method, req.headers, opts)) {
    return new Response(
      JSON.stringify({
        error: "Cross-origin write rejected",
        hint:
          "State-changing requests must include an Origin (or Referer) header that resolves to the same " +
          "loopback host as the dashboard. This protects /api/secrets, /api/skills/.../run, and /api/auth " +
          "from being driven by a malicious page on a different origin.",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }

  return null;
}

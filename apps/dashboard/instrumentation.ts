/**
 * OpenTelemetry registration for the Aeon dashboard.
 *
 * Opt-in + no-op, mirroring scripts/langfuse-otel.sh: nothing is exported unless
 * OTEL_EXPORTER_OTLP_ENDPOINT is set. `@vercel/otel` reads the standard OTEL_*
 * env vars (endpoint, headers, protocol) to configure the OTLP exporter, so the
 * operator points it wherever the run-trace shim already points — or at any
 * generic OTLP collector. A bad/unreachable endpoint degrades to "no traces",
 * never a broken dashboard: export is out-of-band from request handling.
 *
 * Next.js auto-loads this file's `register()` once per server process (nodejs
 * runtime). The dynamic import keeps the SDK off the module graph when telemetry
 * is disabled.
 */
export async function register() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return
  const { registerOTel } = await import('@vercel/otel')
  registerOTel({ serviceName: process.env.OTEL_SERVICE_NAME || 'aeon-dashboard' })
}

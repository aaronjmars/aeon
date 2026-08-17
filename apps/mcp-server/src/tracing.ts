/**
 * OpenTelemetry tracing for the Aeon MCP server.
 *
 * Opt-in + no-op, mirroring scripts/langfuse-otel.sh: no provider is registered
 * and no spans are exported unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * `trace.getTracer()` returns a silent no-op tracer when nothing is registered,
 * so the call sites stay unconditional and telemetry-off costs nothing.
 *
 * SimpleSpanProcessor (not Batch) on purpose: the MCP server is a short-lived
 * stdio process, and a BatchSpanProcessor's queued spans can be lost when the
 * client disconnects and the process exits. SimpleSpanProcessor exports each
 * span synchronously on end, so nothing is buffered across the exit.
 *
 * OTLP/HTTP protobuf exporter (`-proto`) reads the standard OTEL_* env vars
 * (endpoint, headers, protocol) and appends /v1/traces — compatible with both
 * Langfuse's OTLP endpoint and a generic OTLP collector.
 */
import { trace, type Tracer } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

let provider: NodeTracerProvider | null = null;

/**
 * Register the OTLP tracer provider when telemetry is configured, and return a
 * Tracer for the server to instrument its handlers with. Returns a no-op tracer
 * (no provider registered) when OTEL_EXPORTER_OTLP_ENDPOINT is unset.
 */
export function initTracing(): Tracer {
  const name = process.env.OTEL_SERVICE_NAME || "aeon-mcp-server";
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: name,
        [ATTR_SERVICE_VERSION]: "1.0.0",
      }),
      spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter())],
    });
    provider.register();
    const shutdown = () => {
      void provider?.shutdown().catch(() => {});
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    process.once("beforeExit", shutdown);
  }
  return trace.getTracer(name);
}

#!/usr/bin/env node
/**
 * Aeon MCP Server
 *
 * Exposes all Aeon skills as MCP tools so any Claude Desktop or Claude Code
 * user can invoke them directly from their Claude interface.
 *
 * Tool naming: aeon-{slug} (e.g. aeon-article, aeon-hn-digest)
 * Each tool accepts a single optional `var` argument (the skill's variable input).
 *
 * Skill execution: spawns the configured harness through harness-adapter's
 * `run-harness` with the skill prompt, exactly as GitHub Actions does, so local
 * runs are identical to scheduled runs.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SpanStatusCode } from "@opentelemetry/api";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { type Skill, loadSkills, runSkill } from "./skill-executor.js";
import { initTracing } from "./tracing.js";

// Opt-in + no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set (see tracing.ts).
const tracer = initTracing();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// apps/mcp-server/dist/index.js → apps/mcp-server/ → apps/ → repo root
const REPO_ROOT = join(__dirname, "..", "..", "..");

const LOG_PREFIX = "[aeon-mcp]";

function skillToToolName(slug: string): string {
  return `aeon-${slug}`;
}

function toolNameToSlug(toolName: string): string {
  return toolName.replace(/^aeon-/, "");
}

function buildTools(skills: Skill[]) {
  return skills.map((skill) => ({
    name: skillToToolName(skill.slug),
    description: buildDescription(skill),
    inputSchema: {
      type: "object" as const,
      properties: {
        var: {
          type: "string",
          description: buildVarDescription(skill),
        },
      },
      required: [],
    },
  }));
}

function buildDescription(skill: Skill): string {
  const categoryLabel = categoryName(skill.category);
  const scheduleLabel =
    skill.schedule === "on-demand"
      ? "on-demand"
      : `cron: ${skill.schedule}`;
  return `[Aeon · ${categoryLabel}] ${skill.description} (${scheduleLabel})`;
}

function buildVarDescription(skill: Skill): string {
  if (skill.var) return skill.var;
  const defaults: Record<string, string> = {
    core: "Skill-specific input (e.g. a skill name, owner/repo, or 'name: purpose'). See the skill's SKILL.md for its var contract.",
    evolution: "Optional target (a skill slug to author/evolve/heal, or a focus area). Leave empty to operate across the fleet.",
    basics: "Optional focus (topic, repo, token, or tx hash). Leave empty for the skill's default behaviour.",
    dev: "Repo in owner/repo format to narrow scope. Leave empty to scan all watched repos.",
    crypto: "Token symbol or contract address to focus on. Leave empty for all tracked tokens.",
    productivity: "Focus area or goal. Leave empty for general operation.",
  };
  return (
    defaults[skill.category] ??
    `Optional variable input for the ${skill.name} skill.`
  );
}

function categoryName(category: string): string {
  const labels: Record<string, string> = {
    core: "Core",
    evolution: "Evolution",
    basics: "Basics",
    dev: "Dev",
    crypto: "Crypto",
    productivity: "Productivity",
  };
  return labels[category] ?? category;
}

// ---- Server setup ----

const server = new Server(
  { name: "aeon-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const skills = loadSkills(REPO_ROOT, LOG_PREFIX);
const tools = buildTools(skills);

process.stderr.write(
  `${LOG_PREFIX} Loaded ${skills.length} skills from ${REPO_ROOT}\n`
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  return tracer.startActiveSpan(`mcp.call_tool ${toolName}`, (span) => {
    const slug = toolNameToSlug(toolName);
    const skill = skills.find((s) => s.slug === slug);
    span.setAttribute("aeon.mcp.tool", toolName);
    span.setAttribute("aeon.skill", slug);

    if (!skill) {
      span.setAttribute("aeon.mcp.unknown_tool", true);
      span.setStatus({ code: SpanStatusCode.ERROR, message: "unknown tool" });
      span.end();
      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown Aeon tool: ${toolName}\nAvailable tools: ${tools.map((t) => t.name).join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const varArg = request.params.arguments?.var;
      const varValue = typeof varArg === "string" ? varArg : "";
      const output = runSkill(REPO_ROOT, slug, varValue, LOG_PREFIX);
      span.setAttribute("aeon.output_bytes", output.length);
      return {
        content: [{ type: "text" as const, text: output }],
      };
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[aeon-mcp] Server running on stdio\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`[aeon-mcp] Fatal error: ${err}\n`);
  process.exit(1);
});

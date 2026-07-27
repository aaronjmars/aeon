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
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { type Skill, loadSkills, runSkill } from "./skill-executor.js";
import { listOkfResources, readOkfResource } from "./okf.js";

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
  { capabilities: { tools: {}, resources: {} } }
);

const skills = loadSkills(REPO_ROOT, LOG_PREFIX);
const tools = buildTools(skills);

process.stderr.write(
  `${LOG_PREFIX} Loaded ${skills.length} skills from ${REPO_ROOT}\n`
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const slug = toolNameToSlug(toolName);
  const skill = skills.find((s) => s.slug === slug);

  if (!skill) {
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

  const varArg = request.params.arguments?.var;
  const varValue = typeof varArg === "string" ? varArg : "";
  const output = runSkill(REPO_ROOT, slug, varValue, LOG_PREFIX);

  return {
    content: [{ type: "text" as const, text: output }],
  };
});

// ---- OKF knowledge bundle (read-only resources) ----
// memory/topics/ is a native OKF v0.1 bundle; expose it (plus skills as
// `type: Skill` concepts) so consumption agents can traverse Aeon's knowledge
// over MCP without cloning the repo. See apps/mcp-server/src/okf.ts.

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: listOkfResources(REPO_ROOT, skills),
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const resolved = readOkfResource(REPO_ROOT, uri, skills);
  if (!resolved) {
    throw new Error(`Unknown OKF resource: ${uri}`);
  }
  return {
    contents: [{ uri, mimeType: resolved.mimeType, text: resolved.text }],
  };
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

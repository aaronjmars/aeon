/**
 * TaskMarket MCP tools.
 *
 * Exposes TaskMarket marketplace operations as MCP tools so that Aeon skills
 * (and any other Claude Desktop / Claude Code client) can browse available
 * tasks, create new tasks, submit work, and track results — all from within
 * the agent harness.
 *
 * The tools shell out to the first-party `taskmarket` CLI, which handles
 * EIP-191 signing, X402 payment flow, and wallet management. This module
 * only parses CLI output and formats it for MCP transport.
 */

import { spawnSync } from "child_process";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Re-export the MCP SDK type for consistency
export type TaskmarketToolResult = CallToolResult;

/**
 * The full list of TaskMarket tools exposed by this MCP server.
 * Each entry mirrors a subcommand of `taskmarket task`.
 */
export const TASKMARKET_TOOLS: ToolSpec[] = [
  {
    name: "taskmarket_list_tasks",
    description:
      "Browse open TaskMarket tasks. Filter by tags (e.g. 'crypto', 'agents', 'benchmark', 'arcade'). Returns reward, deadline, and submission counts. var is optional — leave empty for the default browse.",
    inputSchema: {
      type: "object",
      properties: {
        tags: {
          type: "string",
          description:
            "Comma-separated tags to filter (e.g. 'crypto,agents,benchmark'). Leave empty for all open tasks.",
        },
        limit: {
          type: "number",
          description: "Max tasks to return. Default 20, max 100.",
          default: 20,
        },
      },
    },
  },
  {
    name: "taskmarket_get_task",
    description:
      "Fetch full details of a single TaskMarket task by its 0x-prefixed task ID. Returns the complete description, reward, mode, status, deadlines, and pending actions.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description:
            "The 0x-prefixed 32-byte task ID, e.g. 0x8e416ba0f3e473d2dddc7f7afc03ca35ab12b95972818808e9eff0d1e98e31fb",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "taskmarket_my_submissions",
    description:
      "List all submissions made by the caller's wallet across all tasks. Returns each task, its status, and deliverable hash.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "taskmarket_submissions",
    description:
      "List submissions for a specific task — useful for evaluators or to see the competitive field before submitting.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The 0x-prefixed task ID.",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "taskmarket_create_task",
    description:
      "Create and fund a new TaskMarket task on Base. Requires wallet balance. The caller authorizes and funds the escrow. Use this to delegate work from Aeon to the TaskMarket worker market. Cost: the full reward amount in USDC (plus platform fee).",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Short title (shown in listings). Max ~100 chars.",
        },
        description: {
          type: "string",
          description:
            "Full task description. Include required work, deliverable, acceptance criteria, and evidence requirements.",
        },
        reward_usdc: {
          type: "string",
          description:
            "Reward in USDC, e.g. '5.00'. This is the gross reward escrowed; platform fee (~7.5%) is deducted.",
        },
        mode: {
          type: "string",
          enum: ["bounty", "claim", "pitch", "benchmark", "auction"],
          description:
            "Task mode. bounty = any worker submits; claim = worker claims then only they submit; benchmark = worker submits a proof; pitch = workers submit paid pitches. Default bounty.",
          default: "bounty",
        },
        duration_hours: {
          type: "number",
          description:
            "Task duration in hours. Default 168 (7 days). Min 1.",
          default: 168,
        },
        tags: {
          type: "string",
          description:
            "Comma-separated tags for categorization (e.g. 'ai,agents,research').",
        },
        min_stake_usdc: {
          type: "string",
          description:
            "Optional minimum worker stake in USDC (security deposit returned on completion). Use for high-value tasks.",
        },
      },
      required: ["title", "description", "reward_usdc"],
    },
  },
  {
    name: "taskmarket_submit",
    description:
      "Submit work for an open TaskMarket task. Provides the deliverable hash. var should be a path to the deliverable file (markdown/text) or a URL. The CLI signs and anchors the submission on-chain.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The 0x-prefixed task ID.",
        },
        file: {
          type: "string",
          description:
            "Path to the deliverable file (e.g. a markdown report). Required for the final submission.",
        },
        attachments: {
          type: "string",
          description:
            "Optional comma-separated list of additional file paths to attach.",
        },
      },
      required: ["taskId", "file"],
    },
  },
  {
    name: "taskmarket_pitch",
    description:
      "Submit a paid pitch for a pitch-mode task. var should be a concise pitch document path. The CLI anchors the pitch hash on-chain (costs 0.001 USDC).",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The 0x-prefixed task ID (must be in pitch mode).",
        },
        file: {
          type: "string",
          description:
            "Path to the pitch markdown file.",
        },
      },
      required: ["taskId", "file"],
    },
  },
  {
    name: "taskmarket_accept",
    description:
      "Accept a submission as the requester (costs 0.001 USDC). var is the 0x-prefixed task ID plus the worker address to award.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The 0x-prefixed task ID.",
        },
        worker: {
          type: "string",
          description:
            "The 0x-prefixed worker address to award the full reward to.",
        },
      },
      required: ["taskId", "worker"],
    },
  },
  {
    name: "taskmarket_wallet_balance",
    description:
      "Check the TaskMarket wallet balance and address. No arguments needed.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "taskmarket_address",
    description:
      "Print the TaskMarket wallet address. No arguments needed.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ---- Helpers ----

const PATH = (process.env.HOME ?? "/home/ubuntu") + "/.npm-global/bin:" + (process.env.HOME ?? "/home/ubuntu") + "/.npm-global/bin:" + process.env.PATH;

function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync("taskmarket", args, {
    env: { ...process.env, PATH },
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 1_024 * 1024,
  });
  return {
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? "").trim(),
    code: res.status ?? -1,
  };
}

function tryParseJson(text: string): { ok: boolean; data?: unknown; error?: string } {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "ok" in parsed) {
      return { ok: true, data: parsed.data, error: parsed.error };
    }
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, error: "Not JSON" };
  }
}

function safeParse(text: string): { ok: boolean; data?: any; error?: string } {
  const r = tryParseJson(text);
  if (r.ok) return r;
  // If not JSON, wrap as raw text
  return { ok: true, data: text, error: undefined };
}

function usdcToDisplay(baseUnits: string): string {
  const n = Number(baseUnits) / 1_000_000;
  return n.toFixed(2);
}

function formatTaskSummary(t: any): string {
  const title = (t.description || "").split("\n")[0].replace(/^#+\s*/, "").slice(0, 80);
  const reward = usdcToDisplay(t.reward || "0");
  const net = usdcToDisplay(t.netReward || "0");
  const tags = (t.tags || []).join(", ");
  return [
    `Task: ${t.id?.slice(0, 16)}...`,
    `  Title: ${title}`,
    `  Mode: ${t.mode} | Reward: ${reward} USDC (net: ${net})`,
    `  Status: ${t.status} | Phase: ${t.phase}`,
    `  Tags: ${tags}`,
    `  Submissions: ${t.submissionCount || 0} | Deadline: ${t.expiryTime || "N/A"}`,
    `  Window open: ${t.submissionWindowOpen ? "yes" : "no"}`,
  ].join("\n");
}

// ---- Tool handlers ----

export async function handleTaskmarketTool(
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  // stderr logging for MCP — visible when running with --debug or stdio transport logs
  process.stderr.write(`[aeon-mcp] taskmarket tool call: ${name}\n`);

  switch (name) {
    case "taskmarket_list_tasks": {
      const tags = typeof args.tags === "string" ? args.tags.trim() : "";
      const limit = typeof args.limit === "number" ? args.limit : 20;
      const cliArgs = ["task", "list", "--limit", String(limit)];
      if (tags) {
        const cleanTags = tags.split(",").map((s) => s.trim()).filter(Boolean).join(",");
        cliArgs.push("--tags", cleanTags);
      }
      const res = runCli(cliArgs);
      if (res.code !== 0) {
        return { content: [{ type: "text", text: `TaskMarket list failed:\n${res.stderr}` }], isError: true };
      }
      const parsed = safeParse(res.stdout);
      if (!parsed.ok || !parsed.data?.tasks) {
        return { content: [{ type: "text", text: `Unexpected output:\n${res.stdout}` }], isError: true };
      }
      const tasks: any[] = parsed.data.tasks;
      const lines: string[] = [];
      for (const t of tasks) {
        lines.push(formatTaskSummary(t));
        lines.push("");
      }
      return { content: [{ type: "text", text: `Found ${tasks.length} open tasks:\n\n${lines.join("\n")}` }] };
    }

    case "taskmarket_get_task": {
      const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
      if (!taskId || !taskId.startsWith("0x")) {
        return { content: [{ type: "text", text: "taskId must be a 0x-prefixed task ID." }], isError: true };
      }
      const res = runCli(["task", "get", taskId, "--json"]);
      if (res.code !== 0) {
        return { content: [{ type: "text", text: `Task get failed:\n${res.stderr}` }], isError: true };
      }
      const parsed = safeParse(res.stdout);
      if (!parsed.ok || !parsed.data) {
        return { content: [{ type: "text", text: `Unexpected output:\n${res.stdout}` }], isError: true };
      }
      const t = parsed.data;
      const fullOutput = [
        formatTaskSummary(t),
        "",
        `Description:\n${t.description}`,
        ``,
        `Requesterc: ${t.requester || "N/A"}`,
        `Requester pubkey: ${t.requesterPubkey || "null"}`,
        `Platform fee: ${t.platformFeeBps ? Number(t.platformFeeBps) / 100 : 7.5}%`,
        `Primary award: ${t.primaryAward || "none yet"}`,
      ].join("\n");
      return { content: [{ type: "text", text: fullOutput }] };
    }

    case "taskmarket_my_submissions": {
      const res = runCli(["task", "my-submissions"]);
      if (res.code !== 0) {
        return { content: [{ type: "text", text: `my-submissions failed:\n${res.stderr}` }], isError: true };
      }
      const parsed = safeParse(res.stdout);
      if (!parsed.ok) {
        return { content: [{ type: "text", text: `Unexpected output:\n${res.stdout}` }], isError: true };
      }
      const subs: any[] = parsed.data || [];
      if (subs.length === 0) {
        return { content: [{ type: "text", text: "No submissions found from this wallet." }] };
      }
      const lines: string[] = [];
      for (const s of subs) {
        const reward = usdcToDisplay(s.taskReward || "0");
        lines.push(
          `Task: ${s.taskId?.slice(0, 16)}... | Reward: ${reward} USDC | Status: ${s.taskStatus} | Submitted: ${s.submittedAt}`
        );
        if (s.rejectedAt) lines.push(`  REJECTED at ${s.rejectedAt}`);
      }
      return { content: [{ type: "text", text: `Your ${subs.length} submissions:\n\n${lines.join("\n")}` }] };
    }

    case "taskmarket_submissions": {
      const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
      if (!taskId || !taskId.startsWith("0x")) {
        return { content: [{ type: "text", text: "taskId must be a 0x-prefixed task ID." }], isError: true };
      }
      const res = runCli(["task", "submissions", taskId]);
      if (res.code !== 0) {
        return { content: [{ type: "text", text: `submissions failed:\n${res.stderr}` }], isError: true };
      }
      const parsed = safeParse(res.stdout);
      if (!parsed.ok) {
        return { content: [{ type: "text", text: `Unexpected output:\n${res.stdout}` }], isError: true };
      }
      const subs: any[] = parsed.data || [];
      if (subs.length === 0) {
        return { content: [{ type: "text", text: `No submissions for task ${taskId.slice(0, 16)}...` }] };
      }
      const lines: string[] = [];
      for (const s of subs) {
        const reward = usdcToDisplay(s.taskReward || "0");
        lines.push(
          `Worker: ${s.workerAddress?.slice(0, 16)}... | Reward: ${reward} USDC | Status: ${s.taskStatus} | Submitted: ${s.submittedAt}`
        );
        const artifacts = s.artifacts || [];
        if (artifacts.length > 0) {
          lines.push(`  Artifacts: ${artifacts.map((a: any) => a.fileName).join(", ")}`);
        }
      }
      return { content: [{ type: "text", text: `${subs.length} submissions for ${taskId.slice(0, 16)}...\n\n${lines.join("\n")}` }] };
    }

    case "taskmarket_create_task": {
      const title = typeof args.title === "string" ? args.title.trim() : "";
      const description = typeof args.description === "string" ? args.description.trim() : "";
      const rewardUsdc = typeof args.reward_usdc === "string" ? args.reward_usdc.trim() : "";
      const mode = typeof args.mode === "string" ? args.mode : "bounty";
      const duration = typeof args.duration_hours === "number" ? args.duration_hours : 168;
      const tags = typeof args.tags === "string" ? args.tags.trim() : "";
      const stake = typeof args.min_stake_usdc === "string" ? args.min_stake_usdc.trim() : undefined;

      if (!title || !description || !rewardUsdc) {
        return {
          content: [
            {
              type: "text",
              text: "title, description, and reward_usdc are required.",
            },
          ],
          isError: true,
        };
      }

      const cliArgs = [
        "task", "create",
        "--title", title,
        "--description", description,
        "--reward", rewardUsdc,
        "--mode", mode,
        "--duration", String(duration),
      ];
      if (tags) cliArgs.push("--tags", tags);
      if (stake) cliArgs.push("--min-stake", stake);

      const res = runCli(cliArgs);
      if (res.code !== 0) {
        return { content: [{ type: "text", text: `Task create failed:\n${res.stderr}\n${res.stdout}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Task created:\n${res.stdout}` }] };
    }

    case "taskmarket_submit": {
      const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
      const file = typeof args.file === "string" ? args.file.trim() : "";
      const attachments = typeof args.attachments === "string" ? args.attachments.trim() : "";

      if (!taskId || !taskId.startsWith("0x")) {
        return { content: [{ type: "text", text: "taskId must be a 0x-prefixed task ID." }], isError: true };
      }
      if (!file) {
        return { content: [{ type: "text", text: "file path is required." }], isError: true };
      }

      // First run the side-effect gate: re-fetch the task
      const gateRes = runCli(["task", "get", taskId, "--json"]);
      if (gateRes.code !== 0) {
        return { content: [{ type: "text", text: `Could not fetch task (gate):\n${gateRes.stderr}` }], isError: true };
      }
      const parsed = safeParse(gateRes.stdout);
      const task = parsed.data;
      if (
        task?.status !== "open" &&
        task?.status !== "claimed" &&
        task?.status !== "worker_selected"
      ) {
        return {
          content: [
            {
              type: "text",
              text: `Task is not in a submittable phase (status=${task?.status}). Submission window: ${task?.submissionWindowOpen ? "open" : "closed"}.`,
            },
          ],
          isError: true,
        };
      }
      if (task && task.submissionWindowOpen === false) {
        return {
          content: [
            {
              type: "text",
              text: `Task is not in a submittable phase (status=${task?.status}). Submission window: closed.`,
            },
          ],
          isError: true,
        };
      }

      const cliArgs = ["task", "submit", taskId, "--file", file, "--role", "final"];
      if (attachments) {
        for (const a of attachments.split(",").map((s) => s.trim()).filter(Boolean)) {
          cliArgs.push("--file", a, "--role", "attachment");
        }
      }

      const res = runCli(cliArgs);
      if (res.code !== 0) {
        return { content: [{ type: "text", text: `Submission failed:\n${res.stderr}\n${res.stdout}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Submission complete:\n${res.stdout}` }] };
    }

    case "taskmarket_pitch": {
      const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
      const file = typeof args.file === "string" ? args.file.trim() : "";

      if (!taskId || !taskId.startsWith("0x")) {
        return { content: [{ type: "text", text: "taskId must be a 0x-prefixed task ID." }], isError: true };
      }
      if (!file) {
        return { content: [{ type: "text", text: "pitch file path is required." }], isError: true };
      }

      const res = runCli(["task", "pitch", taskId, "--file", file]);
      if (res.code !== 0) {
        return { content: [{ type: "text", text: `Pitch failed:\n${res.stderr}\n${res.stdout}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Pitch submitted:\n${res.stdout}` }] };
    }

    case "taskmarket_accept": {
      const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
      const worker = typeof args.worker === "string" ? args.worker.trim() : "";

      if (!taskId || !taskId.startsWith("0x")) {
        return { content: [{ type: "text", text: "taskId must be a 0x-prefixed task ID." }], isError: true };
      }
      if (!worker || !worker.startsWith("0x")) {
        return { content: [{ type: "text", text: "worker must be a 0x-prefixed address." }], isError: true };
      }

      const res = runCli(["task", "accept", taskId, "--worker", worker]);
      if (res.code !== 0) {
        return { content: [{ type: "text", text: `Accept failed:\n${res.stderr}\n${res.stdout}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Worker accepted:\n${res.stdout}` }] };
    }

    case "taskmarket_wallet_balance": {
      const res = runCli(["wallet", "balance"]);
      if (res.code !== 0) {
        return { content: [{ type: "text", text: `Balance query failed:\n${res.stderr}` }], isError: true };
      }
      const parsed = safeParse(res.stdout);
      const data = parsed.data as { address: string; balanceUsdc: string; balanceBaseUnits: string } | undefined;
      if (!data) {
        return { content: [{ type: "text", text: `Unexpected output:\n${res.stdout}` }], isError: true };
      }
      return {
        content: [
          {
            type: "text",
            text: `Address: ${data.address}\nBalance: ${data.balanceUsdc} USDC (${data.balanceBaseUnits} base units)`,
          },
        ],
      };
    }

    case "taskmarket_address": {
      const res = runCli(["address"]);
      if (res.code !== 0) {
        return { content: [{ type: "text", text: `Address query failed:\n${res.stderr}` }], isError: true };
      }
      const parsed = safeParse(res.stdout);
      const data = parsed.data as { address: string } | undefined;
      if (!data) {
        return { content: [{ type: "text", text: `Unexpected output:\n${res.stdout}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Wallet address: ${data.address}` }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

/**
 * Tests for the TaskMarket MCP tools module.
 *
 * These tests verify that the taskmarket-tools module correctly registers
 * all expected tools, parses arguments, and formats output. The TaskMarket
 * CLI is mocked via child_process.spawnSync interception.
 *
 * Run: npx vitest run src/taskmarket-tools.test.ts
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// The mock must be hoisted before imports so it's ready when
// taskmarket-tools.ts imports child_process.
vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
}));

// After hoisting, we can access the mocked spawnSync
import { spawnSync } from "child_process";
import { TASKMARKET_TOOLS, handleTaskmarketTool } from "./taskmarket-tools.js";

const mockSpawn = spawnSync as unknown as Mock;

function mockCli(stdout: string, stderr = "", code = 0) {
  mockSpawn.mockReturnValue({
    stdout: stdout,
    stderr: stderr,
    status: code,
    error: undefined,
  });
}

// Helper: safely extract text content from MCP result
function getResultText(result: { content?: Array<{ type?: string; text?: string }> }): string {
  return result.content?.[0]?.text ?? "";
}

describe("TASKMARKET_TOOLS registration", () => {
  it("should expose at least 8 tools", () => {
    expect(TASKMARKET_TOOLS.length).toBeGreaterThanOrEqual(8);
  });

  it("should include all core operations", () => {
    const names = TASKMARKET_TOOLS.map((t) => t.name);
    const expected = [
      "taskmarket_list_tasks",
      "taskmarket_get_task",
      "taskmarket_my_submissions",
      "taskmarket_submissions",
      "taskmarket_create_task",
      "taskmarket_submit",
      "taskmarket_pitch",
      "taskmarket_accept",
      "taskmarket_wallet_balance",
      "taskmarket_address",
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  it("should have input schemas with correct required fields", () => {
    const getTask = TASKMARKET_TOOLS.find((t) => t.name === "taskmarket_get_task");
    const getTaskProps = getTask?.inputSchema.properties as Record<string, unknown> | undefined;
    expect(getTaskProps).toHaveProperty("taskId");
    const getTaskRequired = getTask?.inputSchema.required as string[] | undefined;
    expect(getTaskRequired).toContain("taskId");

    const createTask = TASKMARKET_TOOLS.find((t) => t.name === "taskmarket_create_task");
    const createRequired = createTask?.inputSchema.required as string[] | undefined;
    expect(createRequired).toEqual(
      expect.arrayContaining(["title", "description", "reward_usdc"])
    );

    const submitTask = TASKMARKET_TOOLS.find((t) => t.name === "taskmarket_submit");
    const submitRequired = submitTask?.inputSchema.required as string[] | undefined;
    expect(submitRequired).toContain("taskId");
    expect(submitRequired).toContain("file");
  });

  it("should have mode enum for create_task", () => {
    const tool = TASKMARKET_TOOLS.find((t) => t.name === "taskmarket_create_task");
    const modeProp = (tool?.inputSchema.properties as Record<string, any>)?.mode;
    expect(modeProp.enum).toEqual(["bounty", "claim", "pitch", "benchmark", "auction"]);
    expect(modeProp.default).toBe("bounty");
  });
});

describe("handleTaskmarketTool — list_tasks", () => {
  beforeEach(() => mockCli('{"ok":true,"data":{"tasks":[{"id":"0xabc123","description":"# Test Task","mode":"bounty","reward":"5000000","netReward":"4625000","status":"open","phase":"open","tags":["crypto"],"submissionCount":3,"expiryTime":"2026-08-16T12:00:00Z","submissionWindowOpen":true}]}}'));

  it("should format task list correctly", async () => {
    const result = await handleTaskmarketTool("taskmarket_list_tasks", {});
    expect(result.isError).toBeFalsy();
    const text = getResultText(result as any);
    expect(text).toContain("Found 1 open tasks");
    expect(text).toContain("Test Task");
    expect(text).toContain("bounty");
  });

  it("should handle errors gracefully", async () => {
    mockCli("", "CLI not found", 1);
    const result = await handleTaskmarketTool("taskmarket_list_tasks", {});
    expect(result.isError).toBe(true);
    const text = getResultText(result as any);
    expect(text).toContain("TaskMarket list failed");
  });
});

describe("handleTaskmarketTool — get_task", () => {
  beforeEach(() => {
    mockCli(JSON.stringify({
      ok: true,
      data: {
        id: "0x8e416ba0f3e473d2dddc7f7afc03ca35ab12b95972818808e9eff0d1e98e31fb",
        description: "# Test Task\nFull description here",
        mode: "bounty",
        reward: "5000000",
        status: "open",
        phase: "open",
        requester: "0xrequester",
        requesterPubkey: null,
        platformFeeBps: 750,
        submissionWindowOpen: true,
      },
    }));
  });

  it("should return task details for valid 0x task ID", async () => {
    const result = await handleTaskmarketTool("taskmarket_get_task", {
      taskId: "0x8e416ba0f3e473d2dddc7f7afc03ca35ab12b95972818808e9eff0d1e98e31fb",
    });
    expect(result.isError).toBeFalsy();
    const text = getResultText(result as any);
    expect(text).toContain("Test Task");
    expect(text).toContain("Full description here");
  });

  it("should reject non-0x task IDs", async () => {
    const result = await handleTaskmarketTool("taskmarket_get_task", {
      taskId: "abc123",
    });
    expect(result.isError).toBe(true);
    const text = getResultText(result as any);
    expect(text).toContain("taskId must be a 0x-prefixed task ID");
  });
});

describe("handleTaskmarketTool — submit", () => {
  it("should run the side-effect gate before submitting", async () => {
    // First call: task get (gate check)
    // Second call: task submit
    mockSpawn
      .mockReturnValueOnce({
        stdout: JSON.stringify({
          ok: true,
          data: { id: "0xtask", status: "open", submissionWindowOpen: true },
        }),
        stderr: "",
        status: 0,
        error: undefined,
      })
      .mockReturnValueOnce({
        stdout: JSON.stringify({ ok: true, data: { submissionId: "sub_123" } }),
        stderr: "",
        status: 0,
        error: undefined,
      });

    const result = await handleTaskmarketTool("taskmarket_submit", {
      taskId: "0xtask123test",
      file: "/tmp/report.md",
    });

    expect(result.isError).toBeFalsy();
    const text = getResultText(result as any);
    expect(text).toContain("Submission complete");
    // Should have called task get first (gate)
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      ["task", "get", "0xtask123test", "--json"],
      expect.any(Object)
    );
  });

  it("should reject submission when window is closed", async () => {
    mockCli(
      JSON.stringify({
        ok: true,
        data: { id: "0xtask", status: "open", submissionWindowOpen: false },
      })
    );

    const result = await handleTaskmarketTool("taskmarket_submit", {
      taskId: "0xtask",
      file: "/tmp/report.md",
    });

    expect(result.isError).toBe(true);
    const text = getResultText(result as any);
    expect(text).toContain("not in a submittable phase");
  });
});

describe("handleTaskmarketTool — wallet_balance", () => {
  it("should format balance output", async () => {
    mockCli(
      JSON.stringify({
        ok: true,
        data: { address: "0x1234...", balanceUsdc: "9.489903", balanceBaseUnits: "9489903" },
      })
    );

    const result = await handleTaskmarketTool("taskmarket_wallet_balance", {});
    expect(result.isError).toBeFalsy();
    const text = getResultText(result as any);
    expect(text).toContain("9.489903 USDC");
    expect(text).toContain("0x1234...");
  });
});

describe("handleTaskmarketTool — unknown tool", () => {
  it("should return error for unknown tool", async () => {
    const result = await handleTaskmarketTool("taskmarket_unknown_tool", {});
    expect(result.isError).toBe(true);
  });
});
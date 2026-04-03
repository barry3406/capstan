import { describe, expect, it } from "bun:test";

import type {
  AgentTool,
} from "../../packages/ai/src/types.ts";
import {
  createTurnEngineState,
} from "../../packages/ai/src/loop/state.ts";
import {
  executeToolRequests,
} from "../../packages/ai/src/loop/tool-orchestrator.ts";

describe("loop tool orchestrator", () => {
  it("runs concurrency-safe tool groups in parallel while preserving request order", async () => {
    let active = 0;
    let maxActive = 0;
    const executionOrder: string[] = [];

    const tools: AgentTool[] = [
      {
        name: "slow-safe",
        description: "slow but safe",
        isConcurrencySafe: true,
        async execute() {
          active++;
          maxActive = Math.max(maxActive, active);
          executionOrder.push("slow:start");
          await new Promise((resolve) => setTimeout(resolve, 15));
          executionOrder.push("slow:end");
          active--;
          return "slow";
        },
      },
      {
        name: "fast-safe",
        description: "fast but safe",
        isConcurrencySafe: true,
        async execute() {
          active++;
          maxActive = Math.max(maxActive, active);
          executionOrder.push("fast:start");
          await new Promise((resolve) => setTimeout(resolve, 1));
          executionOrder.push("fast:end");
          active--;
          return "fast";
        },
      },
    ];

    const state = createTurnEngineState(
      { goal: "Run safe tools in parallel" },
      tools,
    );
    state.pendingToolRequests = [
      {
        id: "req_slow",
        name: "slow-safe",
        args: {},
        order: 0,
        assistantMessage:
          '{"tools":[{"tool":"slow-safe","arguments":{}},{"tool":"fast-safe","arguments":{}}]}',
      },
      {
        id: "req_fast",
        name: "fast-safe",
        args: {},
        order: 1,
        assistantMessage:
          '{"tools":[{"tool":"slow-safe","arguments":{}},{"tool":"fast-safe","arguments":{}}]}',
      },
    ];

    const outcome = await executeToolRequests(state, undefined, false);

    expect(maxActive).toBeGreaterThan(1);
    expect(executionOrder).toContain("slow:start");
    expect(executionOrder).toContain("fast:start");
    expect(outcome.records.map((record) => record.tool)).toEqual([
      "slow-safe",
      "fast-safe",
    ]);
    expect(outcome.records.map((record) => record.result)).toEqual([
      "slow",
      "fast",
    ]);
    expect(outcome.remaining).toEqual([]);
  });

  it("stops on approval_required before executing later queued requests", async () => {
    let executed = 0;
    const tools: AgentTool[] = [
      {
        name: "lookup",
        description: "lookup",
        async execute() {
          executed++;
          return { ok: true };
        },
      },
      {
        name: "delete",
        description: "delete",
        async execute() {
          executed++;
          return { deleted: true };
        },
      },
    ];

    const state = createTurnEngineState(
      { goal: "Queue two tools" },
      tools,
    );
    state.pendingToolRequests = [
      {
        id: "req_lookup",
        name: "lookup",
        args: { id: "a" },
        order: 0,
        assistantMessage: '{"tools":[...]}',
      },
      {
        id: "req_delete",
        name: "delete",
        args: { id: "a" },
        order: 1,
        assistantMessage: '{"tools":[...]}',
      },
    ];

    const outcome = await executeToolRequests(
      state,
      {
        beforeToolCall: async (tool) =>
          tool === "delete"
            ? { allowed: false, reason: "approval required" }
            : { allowed: true },
      },
      false,
    );

    expect(executed).toBe(1);
    expect(outcome.records).toHaveLength(1);
    expect(outcome.records[0]?.tool).toBe("lookup");
    expect(outcome.blockedApproval).toEqual({
      kind: "tool",
      tool: "delete",
      args: { id: "a" },
      reason: "approval required",
    });
    expect(outcome.remaining.map((request) => request.name)).toEqual(["delete"]);
  });

  it("halts later groups after a hard tool failure", async () => {
    let laterExecuted = false;
    const tools: AgentTool[] = [
      {
        name: "hard-fail",
        description: "fails hard",
        failureMode: "hard",
        async execute() {
          throw new Error("boom");
        },
      },
      {
        name: "later",
        description: "should not run",
        async execute() {
          laterExecuted = true;
          return "later";
        },
      },
    ];

    const state = createTurnEngineState(
      { goal: "Stop after hard failure" },
      tools,
    );
    state.pendingToolRequests = [
      {
        id: "req_hard",
        name: "hard-fail",
        args: {},
        order: 0,
        assistantMessage: '{"tools":[...]}',
      },
      {
        id: "req_later",
        name: "later",
        args: {},
        order: 1,
        assistantMessage: '{"tools":[...]}',
      },
    ];

    const outcome = await executeToolRequests(state, undefined, false);

    expect(laterExecuted).toBe(false);
    expect(outcome.haltedByHardFailure).toBe(true);
    expect(outcome.records).toHaveLength(1);
    expect(outcome.records[0]).toEqual(
      expect.objectContaining({
        tool: "hard-fail",
        status: "error",
        result: { error: "boom" },
      }),
    );
    expect(outcome.remaining.map((request) => request.name)).toEqual(["later"]);
  });
});

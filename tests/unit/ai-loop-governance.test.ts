import { describe, expect, it } from "bun:test";

import { createHarness, runAgentLoop } from "../../packages/ai/src/index.ts";
import type {
  AgentTool,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "../../packages/ai/src/index.ts";
import { createTurnEngineState } from "../../packages/ai/src/loop/state.ts";
import { executeToolRequests } from "../../packages/ai/src/loop/tool-orchestrator.ts";
import { submitTaskRequests } from "../../packages/ai/src/loop/task-orchestrator.ts";
import { InMemoryAgentTaskRuntime } from "../../packages/ai/src/task/runtime.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function constantLLM(content: string): LLMProvider {
  return {
    name: "governance-mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      return { content, model: "mock-1" };
    },
  };
}

describe("governance v2", () => {
  it("turns tool deny decisions into error records without forcing approval", async () => {
    const tools: AgentTool[] = [
      {
        name: "wipe",
        description: "dangerous tool",
        async execute() {
          return "should not run";
        },
      },
      {
        name: "read",
        description: "safe tool",
        async execute() {
          return "ok";
        },
      },
    ];
    const state = createTurnEngineState({ goal: "run tools" }, tools);
    state.pendingToolRequests = [
      {
        id: "req_wipe",
        name: "wipe",
        args: { target: "db" },
        order: 0,
        assistantMessage: '{"tools":[{"tool":"wipe","arguments":{"target":"db"}},{"tool":"read","arguments":{}}]}',
      },
      {
        id: "req_read",
        name: "read",
        args: {},
        order: 1,
        assistantMessage: '{"tools":[{"tool":"wipe","arguments":{"target":"db"}},{"tool":"read","arguments":{}}]}',
      },
    ];

    const decisions: Array<{ name: string; action: string }> = [];
    const outcome = await executeToolRequests(
      state,
      {
        governToolCall: async (input) =>
          input.name === "wipe"
            ? {
                action: "deny",
                reason: "wipe is forbidden",
                policyId: "policy.deny.wipe",
                risk: "critical",
              }
            : { action: "allow" },
        onGovernanceDecision: async (input) => {
          decisions.push({ name: input.name, action: input.decision.action });
        },
      },
      false,
    );

    expect(decisions).toEqual([
      { name: "wipe", action: "deny" },
      { name: "read", action: "allow" },
    ]);
    expect(outcome.blockedApproval).toBeUndefined();
    expect(outcome.records).toEqual([
      expect.objectContaining({
        tool: "wipe",
        status: "error",
        result: expect.objectContaining({
          error: "wipe is forbidden",
          governance: expect.objectContaining({
            action: "deny",
            policyId: "policy.deny.wipe",
            risk: "critical",
          }),
        }),
      }),
      expect.objectContaining({
        tool: "read",
        status: "success",
        result: "ok",
      }),
    ]);
  });

  it("returns approval_required when governance requests approval", async () => {
    const result = await runAgentLoop(
      constantLLM(JSON.stringify({ tool: "wipe", arguments: { target: "db" } })),
      { goal: "wipe the database" },
      [
        {
          name: "wipe",
          description: "dangerous",
          async execute() {
            return "wiped";
          },
        },
      ],
      {
        governToolCall: async () => ({
          action: "require_approval",
          reason: "high-risk destructive tool",
          risk: "critical",
        }),
      },
    );

    expect(result.status).toBe("approval_required");
    expect(result.pendingApproval).toEqual({
      kind: "tool",
      tool: "wipe",
      args: { target: "db" },
      reason: "high-risk destructive tool",
    });
  });

  it("still invokes onToolCall before governance blocks execution", async () => {
    const observedCalls: Array<{ tool: string; args: unknown }> = [];

    const result = await runAgentLoop(
      constantLLM(JSON.stringify({ tool: "wipe", arguments: { target: "db" } })),
      { goal: "attempt wipe" },
      [
        {
          name: "wipe",
          description: "dangerous",
          async execute() {
            return "should not run";
          },
        },
      ],
      {
        onToolCall: async (tool, args) => {
          observedCalls.push({ tool, args });
        },
        governToolCall: async () => ({
          action: "require_approval",
          reason: "needs review",
        }),
      },
    );

    expect(result.status).toBe("approval_required");
    expect(observedCalls).toEqual([
      { tool: "wipe", args: { target: "db" } },
    ]);
  });

  it("materializes denied task governance into synthetic failed notifications", async () => {
    const runtime = new InMemoryAgentTaskRuntime();
    const state = createTurnEngineState(
      {
        goal: "run tasks",
        tasks: [
          {
            name: "dangerous_task",
            description: "should be denied",
            kind: "workflow",
            async execute() {
              return "nope";
            },
          },
        ],
      },
      [],
    );

    const submission = await submitTaskRequests(
      state,
      [
        {
          id: "req_task",
          name: "dangerous_task",
          args: { target: "db" },
          order: 0,
          assistantMessage: '{"tool":"dangerous_task","arguments":{"target":"db"}}',
        },
      ],
      runtime,
      {
        runId: "deny-task-run",
        governTaskCall: async () => ({
          action: "deny",
          reason: "task blocked by policy",
          policyId: "policy.deny.task",
        }),
      },
      false,
    );

    expect(submission.submitted.records).toEqual([]);
    expect(submission.blockedApproval).toBeUndefined();
    expect(submission.deniedNotifications).toEqual([
      expect.objectContaining({
        requestId: "req_task",
        name: "dangerous_task",
        kind: "workflow",
        status: "failed",
        error: "task blocked by policy",
      }),
    ]);
  });

  it("fails closed when a governance hook returns an invalid decision payload", async () => {
    const state = createTurnEngineState(
      { goal: "run invalid governance tool" },
      [
        {
          name: "wipe",
          description: "dangerous tool",
          async execute() {
            return "should not run";
          },
        },
      ],
    );
    state.pendingToolRequests = [
      {
        id: "req_invalid",
        name: "wipe",
        args: { target: "db" },
        order: 0,
        assistantMessage: '{"tool":"wipe","arguments":{"target":"db"}}',
      },
    ];

    const decisions: Array<{ action: string; source?: string; reason?: string }> = [];
    const outcome = await executeToolRequests(
      state,
      {
        governToolCall: async () => ({}) as never,
        onGovernanceDecision: async (input) => {
          decisions.push({
            action: input.decision.action,
            source: input.decision.source,
            reason: input.decision.reason,
          });
        },
      },
      false,
    );

    expect(decisions).toEqual([
      {
        action: "deny",
        reason: 'Invalid governance decision returned for tool "wipe"',
        source: "governance_validation",
      },
    ]);
    expect(outcome.records).toEqual([
      expect.objectContaining({
        tool: "wipe",
        status: "error",
        result: expect.objectContaining({
          error: 'Invalid governance decision returned for tool "wipe"',
          governance: expect.objectContaining({
            action: "deny",
            source: "governance_validation",
          }),
        }),
      }),
    ]);
  });

  it("fails closed when a governance hook throws synchronously", async () => {
    const state = createTurnEngineState(
      { goal: "run throwing governance tool" },
      [
        {
          name: "wipe",
          description: "dangerous tool",
          async execute() {
            return "should not run";
          },
        },
      ],
    );
    state.pendingToolRequests = [
      {
        id: "req_throw",
        name: "wipe",
        args: { target: "db" },
        order: 0,
        assistantMessage: '{"tool":"wipe","arguments":{"target":"db"}}',
      },
    ];

    const outcome = await executeToolRequests(
      state,
      {
        governToolCall() {
          throw new Error("classifier crashed");
        },
      },
      false,
    );

    expect(outcome.records).toEqual([
      expect.objectContaining({
        tool: "wipe",
        status: "error",
        result: expect.objectContaining({
          error: 'Governance hook failed for tool "wipe": classifier crashed',
          governance: expect.objectContaining({
            action: "deny",
            source: "governance_error",
          }),
        }),
      }),
    ]);
  });

  it("still invokes onTaskCall before governance denies task submission", async () => {
    const observedCalls: Array<{ task: string; args: unknown }> = [];
    const runtime = new InMemoryAgentTaskRuntime();
    const state = createTurnEngineState(
      {
        goal: "run tasks",
        tasks: [
          {
            name: "dangerous_task",
            description: "should be denied",
            kind: "workflow",
            async execute() {
              return "nope";
            },
          },
        ],
      },
      [],
    );

    const submission = await submitTaskRequests(
      state,
      [
        {
          id: "req_task",
          name: "dangerous_task",
          args: { target: "db" },
          order: 0,
          assistantMessage: '{"tool":"dangerous_task","arguments":{"target":"db"}}',
        },
      ],
      runtime,
      {
        runId: "deny-task-run",
        onTaskCall: async (task, args) => {
          observedCalls.push({ task, args });
        },
        governTaskCall: async () => ({
          action: "deny",
          reason: "task blocked by policy",
        }),
      },
      false,
    );

    expect(submission.submitted.records).toEqual([]);
    expect(observedCalls).toEqual([
      { task: "dangerous_task", args: { target: "db" } },
    ]);
  });

  it("applies denied task notifications before returning approval_required for a later task", async () => {
    const result = await runAgentLoop(
      constantLLM(
        JSON.stringify({
          tools: [
            { tool: "deny_soft", arguments: { target: "one" } },
            { tool: "needs_review", arguments: { target: "two" } },
          ],
        }),
      ),
      {
        goal: "deny first task and block second",
        tasks: [
          {
            name: "deny_soft",
            description: "soft denied task",
            kind: "workflow",
            async execute() {
              return "should not run";
            },
          },
          {
            name: "needs_review",
            description: "approval gated task",
            kind: "workflow",
            async execute() {
              return "should not run";
            },
          },
        ],
      },
      [],
      {
        governTaskCall: async (input) =>
          input.name === "deny_soft"
            ? { action: "deny", reason: "first task denied" }
            : { action: "require_approval", reason: "second task needs approval" },
      },
    );

    expect(result.status).toBe("approval_required");
    expect(result.taskCalls).toEqual([
      expect.objectContaining({
        task: "deny_soft",
        kind: "workflow",
        status: "error",
        result: { error: "first task denied" },
      }),
    ]);
    expect(result.pendingApproval).toEqual({
      kind: "task",
      tool: "needs_review",
      args: { target: "two" },
      reason: "second task needs approval",
    });
  });

  it("halts task submission immediately when a hard-failure task is denied by governance", async () => {
    const runtime = new InMemoryAgentTaskRuntime();
    const state = createTurnEngineState(
      {
        goal: "run hard denied task",
        tasks: [
          {
            name: "deny_hard",
            description: "hard failure task",
            kind: "workflow",
            failureMode: "hard",
            async execute() {
              return "should not run";
            },
          },
          {
            name: "later_task",
            description: "must never be considered after hard deny",
            kind: "workflow",
            async execute() {
              return "should not run";
            },
          },
        ],
      },
      [],
    );

    const submission = await submitTaskRequests(
      state,
      [
        {
          id: "req_hard",
          name: "deny_hard",
          args: { target: "prod" },
          order: 0,
          assistantMessage: '{"tools":[{"tool":"deny_hard","arguments":{"target":"prod"}},{"tool":"later_task","arguments":{}}]}',
        },
        {
          id: "req_later",
          name: "later_task",
          args: {},
          order: 1,
          assistantMessage: '{"tools":[{"tool":"deny_hard","arguments":{"target":"prod"}},{"tool":"later_task","arguments":{}}]}',
        },
      ],
      runtime,
      {
        runId: "hard-deny-run",
        governTaskCall: async (input) =>
          input.name === "deny_hard"
            ? { action: "deny", reason: "hard stop" }
            : { action: "allow" },
      },
      false,
    );

    expect(submission.submitted.records).toEqual([]);
    expect(submission.blockedApproval).toBeUndefined();
    expect(submission.haltedByHardFailure).toBe(true);
    expect(submission.deniedNotifications).toEqual([
      expect.objectContaining({
        requestId: "req_hard",
        name: "deny_hard",
        kind: "workflow",
        status: "failed",
        hardFailure: true,
        error: "hard stop",
      }),
    ]);
  });

  it("emits governance_decision runtime events through harness integration", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "capstan-governance-"));
    try {
      const harness = await createHarness({
        llm: constantLLM(JSON.stringify({ tool: "wipe", arguments: { target: "db" } })),
        runtime: {
          rootDir,
          governToolCall: async () => ({
            action: "deny",
            reason: "never wipe in tests",
            policyId: "policy.tests.no_wipe",
            risk: "critical",
          }),
        },
      });

      const result = await harness.run(
        {
          goal: "try wipe",
          tools: [
            {
              name: "wipe",
              description: "dangerous",
              async execute() {
                return "should not run";
              },
            },
          ],
          maxIterations: 1,
        },
      );

      expect(result.status).toBe("max_iterations");
      const events = await harness.getEvents(result.runId);
      expect(
        events.some(
          (event) =>
            event.type === "governance_decision" &&
            event.data.action === "deny" &&
            event.data.name === "wipe",
        ),
      ).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

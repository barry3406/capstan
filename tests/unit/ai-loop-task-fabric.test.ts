import { describe, expect, it } from "bun:test";

import { runAgentLoop } from "../../packages/ai/src/agent-loop.ts";
import type {
  AgentLoopCheckpoint,
  AgentLoopControlDecision,
  AgentTask,
  AgentTool,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "../../packages/ai/src/types.ts";

function mockLLM(
  responses: Array<string | Error | ((messages: LLMMessage[]) => Promise<string> | string)>,
  sink?: LLMMessage[][],
): LLMProvider {
  let index = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      sink?.push(messages.map((message) => ({ ...message })));
      const next = responses[index++];
      if (next instanceof Error) {
        throw next;
      }
      return {
        content: typeof next === "function" ? await next(messages) : next,
        model: "mock-1",
      };
    },
  };
}

describe("task fabric inside the turn engine", () => {
  it("executes task requests and folds their results back into the next turn", async () => {
    const captured: LLMMessage[][] = [];
    const llm = mockLLM(
      [
        JSON.stringify({ tool: "deploy", arguments: { version: "2026.04" } }),
        (messages) => {
          expect(messages.some((message) => message.content.includes('Task "deploy" completed'))).toBe(
            true,
          );
          return "deployment verified";
        },
      ],
      captured,
    );

    const result = await runAgentLoop(
      llm,
      {
        goal: "deploy one version",
        tasks: [
          {
            name: "deploy",
            description: "deploys one version",
            kind: "workflow",
            async execute(args) {
              return { deployed: args.version };
            },
          },
        ],
      },
      [],
    );

    expect(result.status).toBe("completed");
    expect(result.taskCalls).toEqual([
      expect.objectContaining({
        task: "deploy",
        status: "success",
        result: { deployed: "2026.04" },
      }),
    ]);
    expect(result.toolCalls).toEqual([]);
    expect(captured).toHaveLength(2);
  });

  it("preserves mixed tool/task ordering across a single assistant action batch", async () => {
    const executionOrder: string[] = [];
    const result = await runAgentLoop(
      mockLLM([
        JSON.stringify({
          tools: [
            { tool: "lookup", arguments: { id: "alpha" } },
            { tool: "deploy", arguments: { id: "alpha" } },
            { tool: "notify", arguments: { id: "alpha" } },
          ],
        }),
        "done",
      ]),
      {
        goal: "run mixed actions",
        tasks: [
          {
            name: "deploy",
            description: "deploys one item",
            kind: "workflow",
            async execute(args) {
              executionOrder.push(`task:${args.id as string}`);
              return { deployed: args.id };
            },
          },
        ],
      },
      [
        {
          name: "lookup",
          description: "looks up one item",
          async execute(args) {
            executionOrder.push(`tool:${args.id as string}:lookup`);
            return { found: args.id };
          },
        },
        {
          name: "notify",
          description: "notifies one item",
          async execute(args) {
            executionOrder.push(`tool:${args.id as string}:notify`);
            return { notified: args.id };
          },
        },
      ],
    );

    expect(result.status).toBe("completed");
    expect(executionOrder).toEqual([
      "tool:alpha:lookup",
      "task:alpha",
      "tool:alpha:notify",
    ]);
    expect(result.toolCalls.map((call) => call.tool)).toEqual(["lookup", "notify"]);
    expect(result.taskCalls.map((call) => call.task)).toEqual(["deploy"]);
  });

  it("cancels sibling tasks and skips later groups after a hard task failure", async () => {
    const toolCalls: string[] = [];
    const result = await runAgentLoop(
      mockLLM([
        JSON.stringify({
          tools: [
            { tool: "fanout_a", arguments: { id: "a" } },
            { tool: "fanout_b", arguments: { id: "b" } },
            { tool: "cleanup", arguments: { id: "later" } },
          ],
        }),
        "done after failure",
      ]),
      {
        goal: "fan out tasks",
        tasks: [
          {
            name: "fanout_a",
            description: "fails hard",
            kind: "workflow",
            isConcurrencySafe: true,
            failureMode: "hard",
            async execute() {
              throw new Error("primary failure");
            },
          },
          {
            name: "fanout_b",
            description: "would keep running",
            kind: "workflow",
            isConcurrencySafe: true,
            async execute(_args, context) {
              await new Promise<void>((resolve, reject) => {
                context.signal.addEventListener(
                  "abort",
                  () => reject(new Error("aborted sibling")),
                  { once: true },
                );
              });
              throw new Error("unreachable");
            },
          },
        ],
      },
      [
        {
          name: "cleanup",
          description: "should not run after the hard failure",
          async execute(args) {
            toolCalls.push(String(args.id));
            return { ok: true };
          },
        },
      ],
    );

    expect(result.status).toBe("completed");
    expect(toolCalls).toEqual([]);
    expect(result.taskCalls).toEqual([
      expect.objectContaining({
        task: "fanout_a",
        status: "error",
      }),
      expect.objectContaining({
        task: "fanout_b",
        status: "canceled",
      }),
    ]);
  });

  it("pauses during task_wait, preserves pending tasks in the checkpoint, and can resume them", async () => {
    let gateResolved = false;
    let releaseTask: (() => void) | undefined;

    const checkpointHolder: { value?: AgentLoopCheckpoint } = {};
    const paused = await runAgentLoop(
      mockLLM([
        JSON.stringify({ tool: "long_task", arguments: { id: "resume-me" } }),
      ]),
      {
        goal: "pause during task wait",
        tasks: [
          {
            name: "long_task",
            description: "waits for a release gate",
            kind: "workflow",
            async execute(args, context) {
              await new Promise<void>((resolve, reject) => {
                releaseTask = resolve;
                context.signal.addEventListener(
                  "abort",
                  () => reject(new Error("paused while waiting")),
                  { once: true },
                );
              });
              gateResolved = true;
              return { resumed: args.id };
            },
          },
        ],
      },
      [],
      {
        getControlState: async (phase): Promise<AgentLoopControlDecision> => {
          if (phase === "during_task_wait") {
            return { action: "pause" };
          }
          return { action: "continue" };
        },
        onCheckpoint: async (checkpoint) => {
          checkpointHolder.value = checkpoint;
          return checkpoint;
        },
      },
    );

    expect(paused.status).toBe("paused");
    expect(paused.checkpoint?.stage).toBe("task_wait");
    expect(paused.checkpoint?.pendingTaskRequests?.map((request) => request.name)).toEqual([
      "long_task",
    ]);
    expect(gateResolved).toBe(false);

    const resumed = await runAgentLoop(
      mockLLM([
        "resumed successfully",
      ]),
      {
        goal: "pause during task wait",
        tasks: [
          {
            name: "long_task",
            description: "waits for a release gate",
            kind: "workflow",
            async execute(args) {
              return { resumed: args.id };
            },
          },
        ],
      },
      [],
      {
        checkpoint: checkpointHolder.value,
      },
    );

    expect(resumed.status).toBe("completed");
    expect(resumed.taskCalls).toEqual([
      expect.objectContaining({
        task: "long_task",
        result: { resumed: "resume-me" },
      }),
    ]);
    releaseTask?.();
  });

  it("treats task policy blocks as approval_required", async () => {
    const result = await runAgentLoop(
      mockLLM([
        JSON.stringify({ tool: "deploy", arguments: { id: "blocked" } }),
      ]),
      {
        goal: "block one task",
        tasks: [
          {
            name: "deploy",
            description: "deploys something",
            kind: "workflow",
            async execute() {
              return { ok: true };
            },
          },
        ],
      },
      [],
      {
        beforeTaskCall: async () => ({
          allowed: false,
          reason: "task approval needed",
        }),
      },
    );

    expect(result.status).toBe("approval_required");
    expect(result.pendingApproval).toEqual({
      kind: "task",
      tool: "deploy",
      args: { id: "blocked" },
      reason: "task approval needed",
    });
    expect(result.taskCalls).toEqual([]);
  });
});

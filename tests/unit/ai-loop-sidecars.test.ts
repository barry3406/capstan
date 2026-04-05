import { describe, expect, it } from "bun:test";

import { runAgentLoop } from "../../packages/ai/src/agent-loop.ts";
import type {
  AgentLoopCheckpoint,
  AgentLoopSidecarRequest,
  AgentTool,
  AgentTask,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "../../packages/ai/src/types.ts";

function mockLLM(
  responses: Array<string | Error | ((messages: LLMMessage[]) => Promise<string> | string)>,
): LLMProvider {
  let index = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const next = responses[index++];
      if (next instanceof Error) {
        throw next;
      }
      const content =
        typeof next === "function" ? await next(messages) : (next ?? "done");
      return { content, model: "mock-1" };
    },
  };
}

describe("agent loop sidecar lifecycle", () => {
  it("flushes queued turn sidecars after tool results and persists a running_sidecars checkpoint", async () => {
    let pendingSidecars = false;
    const sidecarRequests: AgentLoopSidecarRequest[] = [];
    const checkpoints: AgentLoopCheckpoint[] = [];

    const tools: AgentTool[] = [
      {
        name: "lookup",
        description: "looks things up",
        async execute() {
          return { ok: true };
        },
      },
    ];

    const result = await runAgentLoop(
      mockLLM([
        JSON.stringify({ tool: "lookup", arguments: { id: 1 } }),
        "done",
      ]),
      { goal: "use a tool once" },
      tools,
      {
        afterToolCall: async () => {
          pendingSidecars = true;
        },
        hasPendingSidecars: () => pendingSidecars,
        runSidecars: async (request) => {
          sidecarRequests.push(request);
          pendingSidecars = false;
        },
        onCheckpoint: async (checkpoint) => {
          checkpoints.push(structuredClone(checkpoint));
          return checkpoint;
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(sidecarRequests).toHaveLength(1);
    expect(sidecarRequests[0]?.stage).toBe("tool_result");
    expect(sidecarRequests[0]?.phaseBeforeSidecars).toBe("applying_tool_results");
    expect(sidecarRequests[0]?.transitionReason).toBe("next_turn");
    expect(sidecarRequests[0]?.checkpoint.orchestration?.phase).toBe("running_sidecars");

    const toolResultPhases = checkpoints
      .filter((checkpoint) => checkpoint.stage === "tool_result")
      .map((checkpoint) => checkpoint.orchestration?.phase);
    expect(toolResultPhases).toContain("running_sidecars");
    expect(toolResultPhases).toContain("applying_tool_results");
  });

  it("flushes pending sidecars before pausing during task_wait so settled task side effects are not lost", async () => {
    let pendingSidecars = false;
    const sidecarRequests: AgentLoopSidecarRequest[] = [];
    const checkpoints: AgentLoopCheckpoint[] = [];

    const tasks: AgentTask[] = [
      {
        name: "fast",
        description: "fast task",
        kind: "workflow",
        isConcurrencySafe: true,
        async execute() {
          return { fast: true };
        },
      },
      {
        name: "slow",
        description: "slow task",
        kind: "workflow",
        isConcurrencySafe: true,
        async execute(_args, context) {
          return await new Promise<unknown>((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
        },
      },
    ];

    const result = await runAgentLoop(
      mockLLM([
        JSON.stringify({
          tools: [
            { tool: "fast", arguments: { id: 1 } },
            { tool: "slow", arguments: { id: 2 } },
          ],
        }),
      ]),
      { goal: "pause while tasks are running", tasks, maxIterations: 3 },
      [],
      {
        afterTaskCall: async (task) => {
          if (task === "fast") {
            pendingSidecars = true;
          }
        },
        hasPendingSidecars: () => pendingSidecars,
        runSidecars: async (request) => {
          sidecarRequests.push(request);
          pendingSidecars = false;
        },
        onCheckpoint: async (checkpoint) => {
          checkpoints.push(structuredClone(checkpoint));
          return checkpoint;
        },
        getControlState: async (phase) => {
          if (phase === "during_task_wait" && pendingSidecars) {
            return { action: "pause" };
          }
          return { action: "continue" };
        },
      },
    );

    expect(result.status).toBe("paused");
    expect(result.checkpoint?.stage).toBe("task_wait");
    expect(sidecarRequests).toHaveLength(1);
    expect(sidecarRequests[0]?.stage).toBe("task_wait");
    expect(sidecarRequests[0]?.phaseBeforeSidecars).toBe("waiting_on_tasks");
    expect(sidecarRequests[0]?.checkpoint.orchestration?.phase).toBe("running_sidecars");
    expect(
      checkpoints.some(
        (checkpoint) =>
          checkpoint.stage === "task_wait" &&
          checkpoint.orchestration?.phase === "running_sidecars",
      ),
    ).toBe(true);
  });

  it("flushes pending sidecars before canceling during task_wait so settled task side effects are not lost", async () => {
    let pendingSidecars = false;
    const sidecarRequests: AgentLoopSidecarRequest[] = [];
    const checkpoints: AgentLoopCheckpoint[] = [];

    const tasks: AgentTask[] = [
      {
        name: "fast",
        description: "fast task",
        kind: "workflow",
        isConcurrencySafe: true,
        async execute() {
          return { fast: true };
        },
      },
      {
        name: "slow",
        description: "slow task",
        kind: "workflow",
        isConcurrencySafe: true,
        async execute(_args, context) {
          return await new Promise<unknown>((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
        },
      },
    ];

    const result = await runAgentLoop(
      mockLLM([
        JSON.stringify({
          tools: [
            { tool: "fast", arguments: { id: 1 } },
            { tool: "slow", arguments: { id: 2 } },
          ],
        }),
      ]),
      { goal: "cancel while tasks are running", tasks, maxIterations: 3 },
      [],
      {
        afterTaskCall: async (task) => {
          if (task === "fast") {
            pendingSidecars = true;
          }
        },
        hasPendingSidecars: () => pendingSidecars,
        runSidecars: async (request) => {
          sidecarRequests.push(request);
          pendingSidecars = false;
        },
        onCheckpoint: async (checkpoint) => {
          checkpoints.push(structuredClone(checkpoint));
          return checkpoint;
        },
        getControlState: async (phase) => {
          if (phase === "during_task_wait" && pendingSidecars) {
            return { action: "cancel" };
          }
          return { action: "continue" };
        },
      },
    );

    expect(result.status).toBe("canceled");
    expect(result.checkpoint?.stage).toBe("task_wait");
    expect(sidecarRequests).toHaveLength(1);
    expect(sidecarRequests[0]?.stage).toBe("task_wait");
    expect(sidecarRequests[0]?.phaseBeforeSidecars).toBe("waiting_on_tasks");
    expect(sidecarRequests[0]?.checkpoint.orchestration?.phase).toBe("running_sidecars");
    expect(
      checkpoints.some(
        (checkpoint) =>
          checkpoint.stage === "task_wait" &&
          checkpoint.orchestration?.phase === "running_sidecars",
      ),
    ).toBe(true);
  });

  it("applies checkpoint updates returned by runSidecars before the next model turn", async () => {
    const seenSidecarNote: boolean[] = [];
    let pendingSidecars = false;

    const result = await runAgentLoop(
      mockLLM([
        JSON.stringify({ tool: "lookup", arguments: { id: 1 } }),
        (messages) => {
          seenSidecarNote.push(
            messages.some((message) => message.content.includes("sidecar note")),
          );
          return "done";
        },
      ]),
      { goal: "use a tool once" },
      [
        {
          name: "lookup",
          description: "looks things up",
          async execute() {
            return { ok: true };
          },
        },
      ],
      {
        afterToolCall: async () => {
          pendingSidecars = true;
        },
        hasPendingSidecars: () => pendingSidecars,
        runSidecars: async (request) => {
          pendingSidecars = false;
          return {
            checkpoint: {
              ...request.checkpoint,
              messages: [
                ...request.checkpoint.messages,
                {
                  role: "user",
                  content: "sidecar note",
                },
              ],
            },
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(seenSidecarNote).toEqual([true]);
  });

  it("flushes pending sidecars before pausing after tool execution", async () => {
    let pendingSidecars = false;
    const sidecarRequests: AgentLoopSidecarRequest[] = [];

    const result = await runAgentLoop(
      mockLLM([
        JSON.stringify({ tool: "lookup", arguments: { id: 1 } }),
        "done",
      ]),
      { goal: "pause after a tool" },
      [
        {
          name: "lookup",
          description: "looks things up",
          async execute() {
            return { ok: true };
          },
        },
      ],
      {
        afterToolCall: async () => {
          pendingSidecars = true;
        },
        hasPendingSidecars: () => pendingSidecars,
        runSidecars: async (request) => {
          sidecarRequests.push(request);
          pendingSidecars = false;
        },
        getControlState: async (phase) => {
          if (phase === "after_tool" && pendingSidecars) {
            return { action: "pause" };
          }
          return { action: "continue" };
        },
      },
    );

    expect(result.status).toBe("paused");
    expect(result.checkpoint?.stage).toBe("tool_result");
    expect(sidecarRequests).toHaveLength(1);
    expect(sidecarRequests[0]).toMatchObject({
      stage: "tool_result",
      phaseBeforeSidecars: "paused",
      transitionReason: "pause_requested",
    });
    expect(sidecarRequests[0]?.checkpoint.orchestration?.phase).toBe("running_sidecars");
  });

  it("does not invoke runSidecars when control pauses without pending sidecars", async () => {
    let sidecarCalls = 0;

    const result = await runAgentLoop(
      mockLLM(["done"]),
      { goal: "pause before llm" },
      [],
      {
        hasPendingSidecars: () => false,
        runSidecars: async () => {
          sidecarCalls += 1;
        },
        getControlState: async (phase) => {
          if (phase === "before_llm") {
            return { action: "pause" };
          }
          return { action: "continue" };
        },
      },
    );

    expect(result.status).toBe("paused");
    expect(sidecarCalls).toBe(0);
  });
});

import { describe, expect, it } from "bun:test";

import {
  thinkStream,
  runAgentLoop,
} from "@zauso-ai/capstan-ai";
import type {
  AgentLoopControlDecision,
  AgentTool,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,
} from "@zauso-ai/capstan-ai";

function mockLLM(
  responses: Array<string | Error | (() => Promise<string> | string)>,
  sink?: LLMMessage[][],
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      sink?.push(messages.map((message) => ({ ...message })));
      const next = responses[callIndex++];
      if (next instanceof Error) {
        throw next;
      }
      const content =
        typeof next === "function" ? await next() : (next ?? "done");
      return { content, model: "mock-1" };
    },
  };
}

function hostContext(): LLMMessage {
  return {
    role: "system",
    content: "Host context is authoritative for this turn.",
  };
}

describe("Stage 3A host-driven turn engine", () => {
  it("drives a multi-tool turn while keeping host injections and checkpoint rewrites compatible", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const hostSystemContent = hostContext().content;
    const toolOnePayload = "secret payload ".repeat(24);
    const llm = mockLLM(
      [
        JSON.stringify({ tool: "fetch", arguments: { id: "alpha" } }),
        JSON.stringify({ tool: "summarize", arguments: { id: "alpha" } }),
        "Turn complete.",
      ],
      capturedMessages,
    );

    const fetchTool: AgentTool = {
      name: "fetch",
      description: "returns a large payload",
      async execute() {
        return {
          id: "alpha",
          body: toolOnePayload,
        };
      },
    };

    const summarizeTool: AgentTool = {
      name: "summarize",
      description: "summarizes the fetched payload",
      async execute(args) {
        return {
          id: args.id,
          summary: "compressed summary",
        };
      },
    };

    const result = await runAgentLoop(llm, { goal: "Inspect two records" }, [
      fetchTool,
      summarizeTool,
    ], {
      prepareMessages: async (checkpoint) => [hostContext(), ...checkpoint.messages],
      onCheckpoint: async (checkpoint) => {
        if (checkpoint.stage !== "tool_result" || checkpoint.toolCalls.length !== 1) {
          return checkpoint;
        }

        return {
          ...checkpoint,
          messages: checkpoint.messages.map((message) => ({
            ...message,
            content: message.content.includes(toolOnePayload)
              ? "[COMPRESSED TOOL RESULT]"
              : message.content,
          })),
        };
      },
    });

    expect(result.status).toBe("completed");
    expect(result.iterations).toBe(3);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map((call) => call.tool)).toEqual(["fetch", "summarize"]);
    expect(result.toolCalls[0]!.result).toEqual({
      id: "alpha",
      body: toolOnePayload,
    });
    expect(result.toolCalls[1]!.result).toEqual({
      id: "alpha",
      summary: "compressed summary",
    });

    expect(capturedMessages).toHaveLength(3);
    expect(capturedMessages.every((messages) => messages.some((message) => message.content === hostSystemContent))).toBe(true);
    expect(capturedMessages[0]![0]!.role).toBe("system");
    expect(capturedMessages[1]!.some((message) => message.content.includes(toolOnePayload))).toBe(false);
    expect(capturedMessages[2]!.some((message) => message.content.includes(toolOnePayload))).toBe(false);
    expect(result.checkpoint?.messages.some((message) => message.content.includes(toolOnePayload))).toBe(false);
    expect(
      result.checkpoint?.messages.some((message) => message.content.includes("[COMPRESSED TOOL RESULT]")),
    ).toBe(true);
  });

  const controlCases: Array<{
    name: string;
    phase: "before_llm" | "before_tool" | "after_tool";
    action: "pause" | "cancel";
    reason?: string;
    expectedStatus: "paused" | "canceled";
    expectedIterations: number;
    expectedToolCalls: number;
    expectedModelCalls: number;
    expectedResult: unknown;
    expectedCheckpointStage: "initialized" | "assistant_response" | "tool_result";
  }> = [
    {
      name: "pauses before the first model call",
      phase: "before_llm",
      action: "pause",
      expectedStatus: "paused",
      expectedIterations: 0,
      expectedToolCalls: 0,
      expectedModelCalls: 0,
      expectedResult: null,
      expectedCheckpointStage: "initialized",
    },
    {
      name: "pauses before tool execution",
      phase: "before_tool",
      action: "pause",
      expectedStatus: "paused",
      expectedIterations: 1,
      expectedToolCalls: 0,
      expectedModelCalls: 1,
      expectedResult: null,
      expectedCheckpointStage: "assistant_response",
    },
    {
      name: "cancels before the first model call and surfaces the reason",
      phase: "before_llm",
      action: "cancel",
      reason: "host canceled before planning",
      expectedStatus: "canceled",
      expectedIterations: 0,
      expectedToolCalls: 0,
      expectedModelCalls: 0,
      expectedResult: "host canceled before planning",
      expectedCheckpointStage: "canceled",
    },
    {
      name: "cancels before tool execution and surfaces the reason",
      phase: "before_tool",
      action: "cancel",
      reason: "host canceled before tool",
      expectedStatus: "canceled",
      expectedIterations: 1,
      expectedToolCalls: 0,
      expectedModelCalls: 1,
      expectedResult: "host canceled before tool",
      expectedCheckpointStage: "canceled",
    },
    {
      name: "cancels after tool execution and surfaces the reason",
      phase: "after_tool",
      action: "cancel",
      reason: "host canceled after tool",
      expectedStatus: "canceled",
      expectedIterations: 1,
      expectedToolCalls: 1,
      expectedModelCalls: 1,
      expectedResult: "host canceled after tool",
      expectedCheckpointStage: "canceled",
    },
  ];

  for (const testCase of controlCases) {
    it(testCase.name, async () => {
      const capturedMessages: LLMMessage[][] = [];
      const llm = mockLLM(
        [
          JSON.stringify({ tool: "step", arguments: { value: 1 } }),
          "completed",
        ],
        capturedMessages,
      );

      const stepTool: AgentTool = {
        name: "step",
        description: "records a step",
        async execute() {
          return { ok: true };
        },
      };

      const result = await runAgentLoop(
        llm,
        { goal: "Exercise control boundaries" },
        [stepTool],
        {
          getControlState: async (phase): Promise<AgentLoopControlDecision> => {
            if (phase === testCase.phase) {
              return {
                action: testCase.action,
                ...(testCase.reason ? { reason: testCase.reason } : {}),
              };
            }
            return { action: "continue" };
          },
        },
      );

      expect(result.status).toBe(testCase.expectedStatus);
      expect(result.iterations).toBe(testCase.expectedIterations);
      expect(result.toolCalls).toHaveLength(testCase.expectedToolCalls);
      expect(capturedMessages).toHaveLength(testCase.expectedModelCalls);
      expect(result.result).toBe(testCase.expectedResult);
      expect(result.checkpoint?.stage).toBe(testCase.expectedCheckpointStage);
    });
  }

  it("blocks tool execution with approval_required and preserves the blocking reason", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "delete", arguments: { id: "123" } }),
    ]);

    const deleteTool: AgentTool = {
      name: "delete",
      description: "deletes a record",
      async execute() {
        return { deleted: true };
      },
    };

    const result = await runAgentLoop(
      llm,
      { goal: "Delete a record" },
      [deleteTool],
      {
        beforeToolCall: async () => ({
          allowed: false,
          reason: "manual approval required",
        }),
      },
    );

    expect(result.status).toBe("approval_required");
    expect(result.pendingApproval).toEqual({
      kind: "tool",
      tool: "delete",
      args: { id: "123" },
      reason: "manual approval required",
    });
    expect(result.checkpoint?.stage).toBe("approval_required");
  });

  it("replays a paused pending-tool checkpoint without re-running the policy gate", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const llm = mockLLM(
      [
        JSON.stringify({ tool: "step", arguments: { value: 1 } }),
        "Resume complete.",
      ],
      capturedMessages,
    );

    let policyChecks = 0;
    const stepTool: AgentTool = {
      name: "step",
      description: "records a step",
      async execute(args) {
        return { ok: true, value: args.value };
      },
    };

    const paused = await runAgentLoop(
      llm,
      { goal: "Pause after planning" },
      [stepTool],
      {
        getControlState: async (phase): Promise<AgentLoopControlDecision> => {
          if (phase === "before_tool") {
            return { action: "pause" };
          }
          return { action: "continue" };
        },
      },
    );

    expect(paused.status).toBe("paused");
    expect(paused.checkpoint?.pendingToolCall).toBeDefined();
    expect(paused.toolCalls).toHaveLength(0);
    expect(capturedMessages).toHaveLength(1);

    const resumed = await runAgentLoop(
      llm,
      { goal: "Pause after planning" },
      [stepTool],
      {
        checkpoint: paused.checkpoint,
        resumePendingTool: true,
        beforeToolCall: async () => {
          policyChecks++;
          throw new Error("policy hook should be skipped when resuming a pending tool");
        },
      },
    );

    expect(resumed.status).toBe("completed");
    expect(resumed.iterations).toBe(2);
    expect(resumed.toolCalls).toHaveLength(1);
    expect(resumed.toolCalls[0]!.result).toEqual({ ok: true, value: 1 });
    expect(resumed.checkpoint?.stage).toBe("completed");
    expect(policyChecks).toBe(0);
  });

  it("streams chunks when the provider exposes stream() and fails clearly when it does not", async () => {
    const streamedMessages: LLMMessage[][] = [];
    const streamProvider: LLMProvider = {
      name: "streaming-mock",
      async chat(): Promise<LLMResponse> {
        return { content: "chat fallback", model: "mock-1" };
      },
      async *stream(messages: LLMMessage[], _opts?: LLMOptions): AsyncIterable<LLMStreamChunk> {
        streamedMessages.push(messages.map((message) => ({ ...message })));
        yield { content: "chunk-1", done: false };
        yield { content: "chunk-2", done: false };
        yield { content: "", done: true };
        yield { content: "ignored", done: false };
      },
    };

    const chunks: string[] = [];
    for await (const chunk of thinkStream(streamProvider, "Stream this", {
      systemPrompt: "Be concise",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["chunk-1", "chunk-2"]);
    expect(streamedMessages).toHaveLength(1);
    expect(streamedMessages[0]![0]!.content).toBe("Be concise");
    expect(streamedMessages[0]![1]!.content).toBe("Stream this");

    const noStreamProvider: LLMProvider = {
      name: "no-stream",
      async chat(): Promise<LLMResponse> {
        return { content: "fallback", model: "mock-1" };
      },
    };

    await expect(
      (async () => {
        for await (const _chunk of thinkStream(noStreamProvider, "Stream this")) {
          // no-op
        }
      })(),
    ).rejects.toThrow("LLM provider does not support streaming");
  });
});

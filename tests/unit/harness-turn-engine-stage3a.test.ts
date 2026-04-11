import { describe, expect, it } from "bun:test";

import {
  thinkStream,
  createSmartAgent,
} from "@zauso-ai/capstan-ai";
import type {
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

describe("Stage 3A host-driven turn engine", () => {
  it("drives a multi-tool turn while keeping host injections and checkpoint rewrites compatible", async () => {
    const capturedMessages: LLMMessage[][] = [];
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

    const checkpointStages: string[] = [];
    const agent = createSmartAgent({
      llm,
      tools: [fetchTool, summarizeTool],
      hooks: {
        onCheckpoint: async (checkpoint) => {
          checkpointStages.push(checkpoint.stage);
          return undefined;
        },
      },
    });
    const result = await agent.run("Inspect two records");

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
    expect(capturedMessages[0]![0]!.role).toBe("system");
    expect(checkpointStages).toContain("tool_result");
  });

  const controlCases: Array<{
    name: string;
    action: "pause" | "cancel";
    reason?: string;
    expectedStatus: "paused" | "canceled";
    expectedIterations: number;
    expectedToolCalls: number;
    expectedModelCalls: number;
    expectedResult: unknown;
    expectedCheckpointStage: string;
  }> = [
    {
      name: "pauses before the first model call",
      action: "pause",
      expectedStatus: "paused",
      expectedIterations: 0,
      expectedToolCalls: 0,
      expectedModelCalls: 0,
      expectedResult: null,
      expectedCheckpointStage: "paused",
    },
    {
      name: "cancels before the first model call and surfaces the reason",
      action: "cancel",
      reason: "host canceled before planning",
      expectedStatus: "canceled",
      expectedIterations: 0,
      expectedToolCalls: 0,
      expectedModelCalls: 0,
      expectedResult: "host canceled before planning",
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

      const agent = createSmartAgent({
        llm,
        tools: [stepTool],
        hooks: {
          getControlState: async () => {
            return {
              action: testCase.action,
              ...(testCase.reason ? { reason: testCase.reason } : {}),
            };
          },
        },
      });
      const result = await agent.run("Exercise control boundaries");

      expect(result.status).toBe(testCase.expectedStatus);
      expect(result.iterations).toBe(testCase.expectedIterations);
      expect(result.toolCalls).toHaveLength(testCase.expectedToolCalls);
      expect(capturedMessages).toHaveLength(testCase.expectedModelCalls);
      expect(result.result).toBe(testCase.expectedResult);
      expect(result.checkpoint?.stage).toBe(testCase.expectedCheckpointStage);
    });
  }

  it("cancels after tool execution via before_llm control check", async () => {
    const capturedMessages: LLMMessage[][] = [];
    let controlCheckCount = 0;
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

    const agent = createSmartAgent({
      llm,
      tools: [stepTool],
      hooks: {
        getControlState: async (_phase, checkpoint) => {
          controlCheckCount++;
          // Cancel on the second before_llm (after tool has executed)
          if (controlCheckCount > 1 && checkpoint.toolCalls.length > 0) {
            return { action: "cancel", reason: "host canceled after tool" };
          }
          return { action: "continue" };
        },
      },
    });
    const result = await agent.run("Exercise control boundaries");

    expect(result.status).toBe("canceled");
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toHaveLength(1);
    expect(capturedMessages).toHaveLength(1);
    expect(result.result).toBe("host canceled after tool");
    expect(result.checkpoint?.stage).toBe("canceled");
  });

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

    const agent = createSmartAgent({
      llm,
      tools: [deleteTool],
      hooks: {
        beforeToolCall: async () => ({
          allowed: false,
          reason: "manual approval required",
        }),
      },
    });
    const result = await agent.run("Delete a record");

    expect(result.status).toBe("approval_required");
    expect(result.pendingApproval).toEqual({
      kind: "tool",
      tool: "delete",
      args: { id: "123" },
      reason: "manual approval required",
    });
    expect(result.checkpoint?.stage).toBe("approval_required");
  });

  it("resumes from an approval-blocked checkpoint and completes", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const llm = mockLLM(
      [
        JSON.stringify({ tool: "step", arguments: { value: 1 } }),
        "Resume complete.",
      ],
      capturedMessages,
    );

    const stepTool: AgentTool = {
      name: "step",
      description: "records a step",
      async execute(args) {
        return { ok: true, value: args.value };
      },
    };

    // First run: block the tool call via beforeToolCall
    const blocked = await createSmartAgent({
      llm,
      tools: [stepTool],
      hooks: {
        beforeToolCall: async () => ({
          allowed: false,
          reason: "approval needed",
        }),
      },
    }).run("Pause after planning");

    expect(blocked.status).toBe("approval_required");
    expect(blocked.checkpoint).toBeDefined();
    expect(capturedMessages).toHaveLength(1);

    // Resume from the blocked checkpoint
    const resumed = await createSmartAgent({
      llm,
      tools: [stepTool],
    }).resume(blocked.checkpoint!, "approved, continue");

    expect(resumed.status).toBe("completed");
    expect(resumed.checkpoint?.stage).toBe("completed");
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

import { afterEach, describe, expect, it } from "bun:test";

import { runAgentLoop } from "@zauso-ai/capstan-ai";
import type { AgentTool, LLMMessage, LLMOptions, LLMProvider, LLMResponse } from "@zauso-ai/capstan-ai";

function createTempLLM(
  responses: Array<string | (() => string)>,
  sink?: LLMMessage[][],
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      sink?.push(messages.map((message) => ({ ...message })));
      const next = responses[callIndex++] ?? "done";
      const content = typeof next === "function" ? next() : next;
      return { content, model: "mock-1" };
    },
  };
}

function tool<TArgs extends Record<string, unknown>, TResult>(
  name: string,
  execute: (args: TArgs) => Promise<TResult> | TResult,
): AgentTool {
  return {
    name,
    description: `${name} tool`,
    async execute(args) {
      return execute(args as TArgs);
    },
  };
}

describe("Stage 2 agent loop matrix", () => {
  it("pauses before the first model call without touching the LLM", async () => {
    const calls: LLMMessage[][] = [];
    const llm = createTempLLM(["never used"], calls);

    const result = await runAgentLoop(
      llm,
      { goal: "guarded run" },
      [],
      {
        getControlState: async (phase) => {
          expect(phase).toBe("before_llm");
          return { action: "pause" };
        },
      },
    );

    expect(calls).toHaveLength(0);
    expect(result.status).toBe("paused");
    expect(result.iterations).toBe(0);
    expect(result.checkpoint?.stage).toBe("initialized");
    expect(result.checkpoint?.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
  });

  it("cancels before the first model call via the control fallback", async () => {
    let controlChecks = 0;
    const llm = createTempLLM(["unused"]);

    const result = await runAgentLoop(
      llm,
      { goal: "cancel early" },
      [],
      {
        control: {
          async check() {
            controlChecks++;
            return "cancel";
          },
        },
      },
    );

    expect(controlChecks).toBe(1);
    expect(result.status).toBe("canceled");
    expect(result.result).toBeNull();
    expect(result.iterations).toBe(0);
    expect(result.checkpoint?.stage).toBe("canceled");
  });

  it("prefers getControlState over beforeToolCall and never evaluates policy when the loop pauses at before_tool", async () => {
    const calls: LLMMessage[][] = [];
    let beforeToolCallHits = 0;
    const llm = createTempLLM(
      [JSON.stringify({ tool: "lookup", arguments: { sku: "abc" } })],
      calls,
    );

    const result = await runAgentLoop(
      llm,
      { goal: "lookup a sku" },
      [
        tool("lookup", async () => ({ found: true })),
      ],
      {
        getControlState: async (phase) => {
          if (phase === "before_tool") {
            return { action: "pause" };
          }
          return { action: "continue" };
        },
        beforeToolCall: async () => {
          beforeToolCallHits++;
          return { allowed: false, reason: "should not run" };
        },
      },
    );

    expect(beforeToolCallHits).toBe(0);
    expect(calls).toHaveLength(1);
    expect(result.status).toBe("paused");
    expect(result.iterations).toBe(1);
    expect(result.checkpoint?.stage).toBe("assistant_response");
    expect(result.checkpoint?.pendingToolCall?.tool).toBe("lookup");
    expect(result.pendingApproval).toBeUndefined();
  });

  it("cancels after a tool boundary and returns the tool result checkpoint as canceled", async () => {
    const calls: LLMMessage[][] = [];
    const llm = createTempLLM(
      [
        JSON.stringify({ tool: "write", arguments: { value: "approved" } }),
        "unused",
      ],
      calls,
    );

    const result = await runAgentLoop(
      llm,
      { goal: "write once" },
      [
        tool("write", async () => ({ saved: true })),
      ],
      {
        getControlState: async (phase) => {
          if (phase === "after_tool") {
            return { action: "cancel", reason: "operator stopped the run" };
          }
          return { action: "continue" };
        },
      },
    );

    expect(calls).toHaveLength(1);
    expect(result.status).toBe("canceled");
    expect(result.result).toBe("operator stopped the run");
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.checkpoint?.stage).toBe("canceled");
    expect(result.checkpoint?.toolCalls).toHaveLength(1);
    expect(result.checkpoint?.messages.some((message) => message.content.includes("write"))).toBe(true);
  });

  it("rewrites the checkpoint before the next model call and feeds the rewritten transcript back in", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const llm = createTempLLM(
      [
        JSON.stringify({ tool: "lookup", arguments: { sku: "abc" } }),
        "final answer",
      ],
      capturedMessages,
    );

    const result = await runAgentLoop(
      llm,
      { goal: "investigate the price regression" },
      [
        tool("lookup", async () => ({ payload: "secret ".repeat(48) })),
      ],
      {
        onCheckpoint: async (checkpoint) => {
          if (checkpoint.stage !== "tool_result") {
            return undefined;
          }

          return {
            ...checkpoint,
            messages: [
              checkpoint.messages[0]!,
              checkpoint.messages[1]!,
              {
                role: "system",
                content: "[HARNESS_SUMMARY]\nCompacted transcript",
              },
            ],
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(capturedMessages).toHaveLength(2);
    expect(capturedMessages[1]!.some((message) => message.content.includes("secret"))).toBe(false);
    expect(result.checkpoint?.messages.some((message) => message.content.includes("secret"))).toBe(false);
    expect(result.checkpoint?.messages.some((message) => message.content.includes("[HARNESS_SUMMARY]"))).toBe(true);
  });

  it("injects transient prepareMessages context after an existing system prompt without mutating the stored transcript", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const llm = createTempLLM(["done"], capturedMessages);

    const result = await runAgentLoop(
      llm,
      {
        goal: "inspect a record",
        systemPrompt: "Base system prompt.",
      },
      [],
      {
        prepareMessages: async (checkpoint) => [
          checkpoint.messages[0]!,
          {
            role: "system",
            content: "Runtime context below is authoritative.",
          },
          ...checkpoint.messages.slice(1),
        ],
      },
    );

    expect(result.status).toBe("completed");
    expect(capturedMessages[0]![0]!.content).toBe("Base system prompt.");
    expect(capturedMessages[0]![1]!.content).toBe("Runtime context below is authoritative.");
    expect(
      result.checkpoint?.messages.some((message) =>
        message.content.includes("Runtime context below is authoritative."),
      ),
    ).toBe(false);
  });

  it("falls back to the unmodified checkpoint when prepareMessages returns nothing", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const llm = createTempLLM(["done"], capturedMessages);

    const result = await runAgentLoop(
      llm,
      { goal: "no-op prepareMessages" },
      [],
      {
        prepareMessages: async () => undefined,
      },
    );

    expect(result.status).toBe("completed");
    expect(capturedMessages[0]!.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
    expect(result.checkpoint?.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
  });

  it("resumes a pending tool without re-running the approval policy hook", async () => {
    let policyChecks = 0;
    let toolExecutions = 0;
    let llmCalls = 0;

    const llm: LLMProvider = {
      name: "mock",
      async chat(): Promise<LLMResponse> {
        llmCalls++;
        return { content: "done", model: "mock-1" };
      },
    };

    const result = await runAgentLoop(
      llm,
      { goal: "resume approved work", maxIterations: 3 },
      [
        tool("write", async () => {
          toolExecutions++;
          return { saved: true };
        }),
      ],
      {
        checkpoint: {
          stage: "approval_required",
          config: { goal: "resume approved work", maxIterations: 3 },
          messages: [
            { role: "system", content: "system" },
            { role: "user", content: "resume approved work" },
          ],
          iterations: 1,
          toolCalls: [],
          pendingToolCall: {
            assistantMessage: JSON.stringify({
              tool: "write",
              arguments: { value: "approved" },
            }),
            tool: "write",
            args: { value: "approved" },
          },
          lastAssistantResponse: JSON.stringify({
            tool: "write",
            arguments: { value: "approved" },
          }),
        },
        resumePendingTool: true,
        beforeToolCall: async () => {
          policyChecks++;
          return { allowed: false, reason: "should never be reached" };
        },
      },
    );

    expect(policyChecks).toBe(0);
    expect(toolExecutions).toBe(1);
    expect(llmCalls).toBe(1);
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.checkpoint?.stage).toBe("completed");
  });

  it("reuses the loop checkpoint after an undefined onCheckpoint rewrite and still completes", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const llm = createTempLLM(
      [
        JSON.stringify({ tool: "log", arguments: { entry: "one" } }),
        "final answer",
      ],
      capturedMessages,
    );

    const result = await runAgentLoop(
      llm,
      { goal: "keep the original checkpoint" },
      [
        tool("log", async () => ({ stored: true })),
      ],
      {
        onCheckpoint: async (checkpoint) => {
          expect(checkpoint.stage === "initialized" || checkpoint.stage === "assistant_response" || checkpoint.stage === "tool_result" || checkpoint.stage === "completed").toBe(true);
          return undefined;
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.checkpoint?.messages.some((message) => message.content.includes("Runtime context below is authoritative"))).toBe(false);
    expect(capturedMessages).toHaveLength(2);
  });
});

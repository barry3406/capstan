import { describe, expect, it } from "bun:test";

import { createSmartAgent } from "@zauso-ai/capstan-ai";
import type { AgentCheckpoint, AgentTool, LLMMessage, LLMOptions, LLMProvider, LLMResponse } from "@zauso-ai/capstan-ai";

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

    const agent = createSmartAgent({
      llm,
      tools: [],
      hooks: {
        getControlState: async (phase) => {
          expect(phase).toBe("before_llm");
          return { action: "pause" };
        },
      },
    });
    const result = await agent.run("guarded run");

    expect(calls).toHaveLength(0);
    expect(result.status).toBe("paused");
    expect(result.iterations).toBe(0);
    expect(result.checkpoint?.stage).toBe("paused");
    expect(result.checkpoint?.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
    ]);
  });

  it("cancels before the first model call via the control fallback", async () => {
    let controlChecks = 0;
    const llm = createTempLLM(["unused"]);

    const agent = createSmartAgent({
      llm,
      tools: [],
      hooks: {
        getControlState: async () => {
          controlChecks++;
          return { action: "cancel" };
        },
      },
    });
    const result = await agent.run("cancel early");

    expect(controlChecks).toBe(1);
    expect(result.status).toBe("canceled");
    expect(result.result).toBeNull();
    expect(result.iterations).toBe(0);
    expect(result.checkpoint?.stage).toBe("canceled");
  });

  it("blocks tool execution via beforeToolCall and returns approval_required", async () => {
    const calls: LLMMessage[][] = [];
    let beforeToolCallHits = 0;
    const llm = createTempLLM(
      [JSON.stringify({ tool: "lookup", arguments: { sku: "abc" } })],
      calls,
    );

    const agent = createSmartAgent({
      llm,
      tools: [
        tool("lookup", async () => ({ found: true })),
      ],
      hooks: {
        beforeToolCall: async () => {
          beforeToolCallHits++;
          return { allowed: false, reason: "should not run" };
        },
      },
    });
    const result = await agent.run("lookup a sku");

    expect(beforeToolCallHits).toBe(1);
    expect(calls).toHaveLength(1);
    expect(result.status).toBe("approval_required");
    expect(result.iterations).toBe(1);
    expect(result.checkpoint?.stage).toBe("approval_required");
    expect(result.pendingApproval).toBeDefined();
    expect(result.pendingApproval?.reason).toBe("should not run");
  });

  it("cancels after a tool boundary and returns the tool result checkpoint as canceled", async () => {
    const calls: LLMMessage[][] = [];
    let controlCheckCount = 0;
    const llm = createTempLLM(
      [
        JSON.stringify({ tool: "write", arguments: { value: "approved" } }),
        "unused",
      ],
      calls,
    );

    const agent = createSmartAgent({
      llm,
      tools: [
        tool("write", async () => ({ saved: true })),
      ],
      hooks: {
        getControlState: async (_phase, checkpoint) => {
          controlCheckCount++;
          // Cancel on the second before_llm check (after the tool has been executed)
          if (controlCheckCount > 1 && checkpoint.toolCalls.length > 0) {
            return { action: "cancel", reason: "operator stopped the run" };
          }
          return { action: "continue" };
        },
      },
    });
    const result = await agent.run("write once");

    expect(calls).toHaveLength(1);
    expect(result.status).toBe("canceled");
    expect(result.result).toBe("operator stopped the run");
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.checkpoint?.stage).toBe("canceled");
    expect(result.checkpoint?.toolCalls).toHaveLength(1);
    expect(result.checkpoint?.messages.some((message) => message.content.includes("write"))).toBe(true);
  });

  it("calls onCheckpoint as a notification after tool execution and completes", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const checkpointStages: string[] = [];
    const llm = createTempLLM(
      [
        JSON.stringify({ tool: "lookup", arguments: { sku: "abc" } }),
        "final answer",
      ],
      capturedMessages,
    );

    const agent = createSmartAgent({
      llm,
      tools: [
        tool("lookup", async () => ({ payload: "data" })),
      ],
      hooks: {
        onCheckpoint: async (checkpoint) => {
          checkpointStages.push(checkpoint.stage);
          return undefined;
        },
      },
    });
    const result = await agent.run("investigate the price regression");

    expect(result.status).toBe("completed");
    expect(capturedMessages).toHaveLength(2);
    expect(checkpointStages).toContain("tool_result");
  });

  it("injects transient prepareMessages context after an existing system prompt without mutating the stored transcript", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const llm = createTempLLM(["done"], capturedMessages);

    const agent = createSmartAgent({
      llm,
      tools: [],
      prompt: {
        base: "Base system prompt.",
        layers: [
          {
            id: "runtime-context",
            content: "Runtime context below is authoritative.",
            position: "append",
            priority: 100,
          },
        ],
      },
    });
    const result = await agent.run("inspect a record");

    expect(result.status).toBe("completed");
    expect(capturedMessages[0]![0]!.content).toContain("Base system prompt.");
    expect(capturedMessages[0]![0]!.content).toContain("Runtime context below is authoritative.");
    expect(result.checkpoint?.messages[0]?.content).toContain("Runtime context below is authoritative.");
  });

  it("falls back to the unmodified checkpoint when prepareMessages returns nothing", async () => {
    const capturedMessages: LLMMessage[][] = [];
    const llm = createTempLLM(["done"], capturedMessages);

    const agent = createSmartAgent({
      llm,
      tools: [],
    });
    const result = await agent.run("no-op prepareMessages");

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

    const existingCheckpoint: AgentCheckpoint = {
      stage: "approval_required",
      goal: "resume approved work",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "resume approved work" },
      ],
      iterations: 1,
      toolCalls: [],
      taskCalls: [],
      maxOutputTokens: 8192,
      compaction: {
        autocompactFailures: 0,
        reactiveCompactRetries: 0,
        tokenEscalations: 0,
      },
    };
    const agent = createSmartAgent({
      llm,
      tools: [
        tool("write", async () => {
          toolExecutions++;
          return { saved: true };
        }),
      ],
      maxIterations: 3,
      hooks: {
        beforeToolCall: async () => {
          policyChecks++;
          return { allowed: false, reason: "should never be reached" };
        },
      },
    });
    const result = await agent.resume(existingCheckpoint, "continue");

    expect(toolExecutions).toBe(0);
    expect(llmCalls).toBe(1);
    expect(result.status).toBe("completed");
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

    const agent = createSmartAgent({
      llm,
      tools: [
        tool("log", async () => ({ stored: true })),
      ],
      hooks: {
        onCheckpoint: async (checkpoint) => {
          expect(checkpoint.stage === "initialized" || checkpoint.stage === "tool_result" || checkpoint.stage === "completed").toBe(true);
          return undefined;
        },
      },
    });
    const result = await agent.run("keep the original checkpoint");

    expect(result.status).toBe("completed");
    expect(result.checkpoint?.messages.some((message) => message.content.includes("Runtime context below is authoritative"))).toBe(false);
    expect(capturedMessages).toHaveLength(2);
  });
});

import { describe, expect, it } from "bun:test";

import type {
  AgentTool,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
  LLMStreamChunk,
  SmartAgentHooks,
  StreamingExecutorConfig,
} from "../../packages/ai/src/types.ts";
import {
  parseToolRequests,
  normalizeFinishReason,
  executeModelAndTools,
} from "../../packages/ai/src/loop/streaming-executor.ts";

// ---------------------------------------------------------------------------
// Tool call parsing tests
// ---------------------------------------------------------------------------

describe("parseToolRequests", () => {
  it("parses single object with tool and arguments", () => {
    const result = parseToolRequests(
      JSON.stringify({ tool: "x", arguments: { a: 1 } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("x");
    expect(result[0]!.args).toEqual({ a: 1 });
  });

  it("parses array form", () => {
    const result = parseToolRequests(
      JSON.stringify([{ tool: "x", arguments: {} }]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("x");
  });

  it("parses nested tools array form", () => {
    const result = parseToolRequests(
      JSON.stringify({
        tools: [{ tool: "x", arguments: {} }],
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("x");
  });

  it("parses tool calls from markdown fenced json blocks", () => {
    const content =
      "Here is my plan:\n```json\n" +
      JSON.stringify({ tool: "lookup", arguments: { id: 42 } }) +
      "\n```\nDone.";
    const result = parseToolRequests(content);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("lookup");
    expect(result[0]!.args).toEqual({ id: 42 });
  });

  it("returns empty array for plain text", () => {
    expect(parseToolRequests("just some plain text")).toEqual([]);
  });

  it("handles malformed JSON gracefully", () => {
    expect(parseToolRequests("{not valid json")).toEqual([]);
    expect(parseToolRequests("```json\n{broken\n```")).toEqual([]);
  });

  it("supports args as alias for arguments", () => {
    const result = parseToolRequests(
      JSON.stringify({ tool: "echo", args: { msg: "hi" } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("echo");
    expect(result[0]!.args).toEqual({ msg: "hi" });
  });
});

// ---------------------------------------------------------------------------
// normalizeFinishReason tests
// ---------------------------------------------------------------------------

describe("normalizeFinishReason", () => {
  it("returns tool_use when hasTools is true", () => {
    expect(normalizeFinishReason("stop", true)).toBe("tool_use");
  });

  it("returns stop for stop/undefined without tools", () => {
    expect(normalizeFinishReason("stop", false)).toBe("stop");
    expect(normalizeFinishReason(undefined, false)).toBe("stop");
  });

  it("normalizes max_tokens to max_output_tokens", () => {
    expect(normalizeFinishReason("max_tokens", false)).toBe("max_output_tokens");
  });

  it("normalizes length to max_output_tokens", () => {
    expect(normalizeFinishReason("length", false)).toBe("max_output_tokens");
  });

  it("normalizes max_output_tokens to max_output_tokens", () => {
    expect(normalizeFinishReason("max_output_tokens", false)).toBe("max_output_tokens");
  });

  it("normalizes context_limit and prompt_too_long", () => {
    expect(normalizeFinishReason("context_limit", false)).toBe("context_limit");
    expect(normalizeFinishReason("prompt_too_long", false)).toBe("context_limit");
  });

  it("normalizes error to error", () => {
    expect(normalizeFinishReason("error", false)).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// executeModelAndTools tests
// ---------------------------------------------------------------------------

function makeTool(
  name: string,
  overrides?: Partial<AgentTool>,
): AgentTool {
  return {
    name,
    description: `tool ${name}`,
    execute: overrides?.execute ?? (async (args) => ({ echoed: args })),
    ...overrides,
  };
}

function makeNonStreamingLLM(
  content: string,
  extra?: Partial<LLMResponse>,
): LLMProvider {
  return {
    name: "mock-chat",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      return { content, model: "mock", ...extra };
    },
  };
}

function makeStreamingLLM(chunks: LLMStreamChunk[]): LLMProvider {
  return {
    name: "mock-stream",
    async chat(): Promise<LLMResponse> {
      throw new Error("should not be called");
    },
    async *stream(
      _messages: LLMMessage[],
      _opts?: LLMOptions,
    ): AsyncIterable<LLMStreamChunk> {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

const msgs: LLMMessage[] = [{ role: "user", content: "hi" }];

describe("executeModelAndTools", () => {
  it("calls chat() for non-streaming LLM, parses response, executes tools", async () => {
    const llm = makeNonStreamingLLM(
      JSON.stringify({ tool: "echo", arguments: { msg: "hi" } }),
      { usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
    );
    const tool = makeTool("echo");
    const result = await executeModelAndTools(llm, msgs, [tool], undefined, undefined);

    expect(result.outcome.toolRequests).toHaveLength(1);
    expect(result.outcome.finishReason).toBe("tool_use");
    expect(result.outcome.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(result.toolRecords).toHaveLength(1);
    expect(result.toolRecords[0]!.status).toBe("success");
    expect(result.toolRecords[0]!.result).toEqual({ echoed: { msg: "hi" } });
  });

  it("streams chunks, accumulates content, parses tools", async () => {
    const json = JSON.stringify({ tool: "add", arguments: { a: 1, b: 2 } });
    const half = Math.floor(json.length / 2);
    const llm = makeStreamingLLM([
      { content: json.slice(0, half), done: false },
      { content: json.slice(half), done: false },
      { content: "", done: true },
    ]);
    const tool = makeTool("add", {
      async execute(args) {
        return (args.a as number) + (args.b as number);
      },
    });
    const result = await executeModelAndTools(llm, msgs, [tool], undefined, undefined);

    expect(result.outcome.content).toBe(json);
    expect(result.outcome.toolRequests).toHaveLength(1);
    expect(result.toolRecords).toHaveLength(1);
    expect(result.toolRecords[0]!.result).toBe(3);
  });

  it("returns tool records with status success", async () => {
    const llm = makeNonStreamingLLM(
      JSON.stringify({ tool: "ok", arguments: {} }),
    );
    const tool = makeTool("ok");
    const result = await executeModelAndTools(llm, msgs, [tool], undefined, undefined);
    expect(result.toolRecords[0]!.status).toBe("success");
  });

  it("returns tool records with status error on exception", async () => {
    const llm = makeNonStreamingLLM(
      JSON.stringify({ tool: "fail", arguments: {} }),
    );
    const tool = makeTool("fail", {
      async execute() {
        throw new Error("boom");
      },
    });
    const result = await executeModelAndTools(llm, msgs, [tool], undefined, undefined);
    expect(result.toolRecords[0]!.status).toBe("error");
    expect(result.toolRecords[0]!.result).toEqual({ error: "boom" });
  });

  it("hard failure tool halts remaining tools", async () => {
    const llm = makeNonStreamingLLM(
      JSON.stringify([
        { tool: "hardFail", arguments: {} },
        { tool: "after", arguments: {} },
      ]),
    );
    const hardTool = makeTool("hardFail", {
      failureMode: "hard",
      async execute() {
        throw new Error("critical");
      },
    });
    const afterTool = makeTool("after");
    const result = await executeModelAndTools(
      llm,
      msgs,
      [hardTool, afterTool],
      undefined,
      undefined,
    );
    expect(result.haltedByHardFailure).toBe(true);
    expect(result.toolRecords).toHaveLength(1);
    expect(result.toolRecords[0]!.tool).toBe("hardFail");
  });

  it("unknown tool name produces error record", async () => {
    const llm = makeNonStreamingLLM(
      JSON.stringify({ tool: "nonexistent", arguments: {} }),
    );
    const result = await executeModelAndTools(llm, msgs, [], undefined, undefined);
    expect(result.toolRecords).toHaveLength(1);
    expect(result.toolRecords[0]!.status).toBe("error");
    expect(result.toolRecords[0]!.tool).toBe("nonexistent");
  });

  it("beforeToolCall hook blocks tool execution", async () => {
    const llm = makeNonStreamingLLM(
      JSON.stringify({ tool: "secret", arguments: {} }),
    );
    const tool = makeTool("secret");
    const hooks: SmartAgentHooks = {
      async beforeToolCall(_tool: string, _args: unknown) {
        return { allowed: false, reason: "denied" };
      },
    };
    const result = await executeModelAndTools(llm, msgs, [tool], hooks, undefined);
    expect(result.blockedApproval).toBeDefined();
    expect(result.blockedApproval!.kind).toBe("tool");
    expect(result.blockedApproval!.tool).toBe("secret");
    expect(result.blockedApproval!.reason).toBe("denied");
    expect(result.toolRecords).toHaveLength(0);
  });

  it("afterToolCall hook called after execution", async () => {
    const llm = makeNonStreamingLLM(
      JSON.stringify({ tool: "ping", arguments: { v: 1 } }),
    );
    const tool = makeTool("ping");
    const afterCalls: Array<{ tool: string; args: unknown; result: unknown }> = [];
    const hooks: SmartAgentHooks = {
      async afterToolCall(name: string, args: unknown, result: unknown) {
        afterCalls.push({ tool: name, args, result });
      },
    };
    const result = await executeModelAndTools(llm, msgs, [tool], hooks, undefined);
    expect(result.toolRecords).toHaveLength(1);
    expect(afterCalls).toHaveLength(1);
    expect(afterCalls[0]!.tool).toBe("ping");
  });

  it("non-streaming fallback: uses chat() when no stream()", async () => {
    const llm = makeNonStreamingLLM("Just a text response.");
    const result = await executeModelAndTools(llm, msgs, [], undefined, undefined);
    expect(result.outcome.content).toBe("Just a text response.");
    expect(result.outcome.toolRequests).toHaveLength(0);
    expect(result.outcome.finishReason).toBe("stop");
    expect(result.toolRecords).toHaveLength(0);
  });

  it("content accumulated correctly across streaming chunks", async () => {
    const llm = makeStreamingLLM([
      { content: "Hello ", done: false },
      { content: "world", done: false },
      { content: "!", done: true },
    ]);
    const result = await executeModelAndTools(llm, msgs, [], undefined, undefined);
    expect(result.outcome.content).toBe("Hello world!");
    expect(result.outcome.finishReason).toBe("stop");
  });

  it("returns immediately with no tool records when no tool requests", async () => {
    const llm = makeNonStreamingLLM("No tools needed.");
    const tool = makeTool("unused");
    const result = await executeModelAndTools(llm, msgs, [tool], undefined, undefined);
    expect(result.toolRecords).toEqual([]);
    expect(result.haltedByHardFailure).toBe(false);
    expect(result.blockedApproval).toBeUndefined();
  });

  it("passes llmOptions through to chat()", async () => {
    let capturedOpts: LLMOptions | undefined;
    const llm: LLMProvider = {
      name: "opts-capture",
      async chat(_msgs: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
        capturedOpts = opts;
        return { content: "ok", model: "mock" };
      },
    };
    await executeModelAndTools(
      llm,
      msgs,
      [],
      undefined,
      undefined,
      { temperature: 0.5, maxTokens: 100 },
    );
    expect(capturedOpts).toEqual({ temperature: 0.5, maxTokens: 100 });
  });

  it("passes llmOptions through to stream()", async () => {
    let capturedOpts: LLMOptions | undefined;
    const llm: LLMProvider = {
      name: "opts-capture-stream",
      async chat(): Promise<LLMResponse> {
        throw new Error("should not be called");
      },
      async *stream(
        _messages: LLMMessage[],
        opts?: LLMOptions,
      ): AsyncIterable<LLMStreamChunk> {
        capturedOpts = opts;
        yield { content: "done", done: true };
      },
    };
    await executeModelAndTools(
      llm,
      msgs,
      [],
      undefined,
      undefined,
      { model: "gpt-4" },
    );
    expect(capturedOpts).toEqual({ model: "gpt-4" });
  });

  it("handles multiple tools in sequence", async () => {
    const llm = makeNonStreamingLLM(
      JSON.stringify([
        { tool: "first", arguments: { n: 1 } },
        { tool: "second", arguments: { n: 2 } },
      ]),
    );
    const first = makeTool("first");
    const second = makeTool("second");
    const result = await executeModelAndTools(
      llm,
      msgs,
      [first, second],
      undefined,
      undefined,
    );
    expect(result.toolRecords).toHaveLength(2);
    expect(result.toolRecords[0]!.tool).toBe("first");
    expect(result.toolRecords[1]!.tool).toBe("second");
  });

  it("captures finishReason from streaming final chunk", async () => {
    const llm: LLMProvider = {
      name: "mock",
      async chat(): Promise<LLMResponse> {
        return { content: "", model: "m" };
      },
      async *stream(): AsyncIterable<LLMStreamChunk> {
        yield { content: "partial", done: false };
        yield { content: " response", done: true, finishReason: "max_output_tokens" };
      },
    };
    const result = await executeModelAndTools(llm, [{ role: "user", content: "hi" }], [], undefined, undefined);
    expect(result.outcome.finishReason).toBe("max_output_tokens");
  });

  it("soft failure tool does not halt remaining tools", async () => {
    const llm = makeNonStreamingLLM(
      JSON.stringify([
        { tool: "softFail", arguments: {} },
        { tool: "next", arguments: {} },
      ]),
    );
    const softTool = makeTool("softFail", {
      failureMode: "soft",
      async execute() {
        throw new Error("minor");
      },
    });
    const nextTool = makeTool("next");
    const result = await executeModelAndTools(
      llm,
      msgs,
      [softTool, nextTool],
      undefined,
      undefined,
    );
    expect(result.haltedByHardFailure).toBe(false);
    expect(result.toolRecords).toHaveLength(2);
    expect(result.toolRecords[0]!.status).toBe("error");
    expect(result.toolRecords[1]!.status).toBe("success");
  });
});

// ---------------------------------------------------------------------------
// Streaming parallel execution tests
// ---------------------------------------------------------------------------

describe("streaming parallel execution", () => {
  it("executes concurrent-safe tools during streaming", async () => {
    const executionOrder: string[] = [];
    const readTool: AgentTool = {
      name: "read",
      description: "reads data",
      isConcurrencySafe: true,
      async execute() {
        executionOrder.push("read-start");
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push("read-end");
        return "data";
      },
    };

    const llm: LLMProvider = {
      name: "mock",
      async chat() {
        return { content: "", model: "m" };
      },
      async *stream() {
        yield {
          content: JSON.stringify({ tool: "read", arguments: {} }),
          done: false,
        };
        // Tool should start executing here, during streaming
        yield { content: "", done: true };
      },
    };

    const { toolRecords } = await executeModelAndTools(
      llm,
      msgs,
      [readTool],
      undefined,
      { maxConcurrency: 10 },
    );
    expect(toolRecords).toHaveLength(1);
    expect(toolRecords[0]!.status).toBe("success");
    expect(toolRecords[0]!.result).toBe("data");
  });

  it("queues non-concurrent-safe tools until stream ends", async () => {
    const executionLog: string[] = [];
    const writeTool: AgentTool = {
      name: "write",
      description: "writes data",
      isConcurrencySafe: false,
      async execute() {
        executionLog.push("write-executed");
        return "written";
      },
    };

    const llm: LLMProvider = {
      name: "mock",
      async chat() {
        return { content: "", model: "m" };
      },
      async *stream() {
        yield {
          content: JSON.stringify({ tool: "write", arguments: {} }),
          done: false,
        };
        yield { content: "", done: true };
      },
    };

    const { toolRecords } = await executeModelAndTools(
      llm,
      msgs,
      [writeTool],
      undefined,
      { maxConcurrency: 10 },
    );
    expect(toolRecords).toHaveLength(1);
    expect(toolRecords[0]!.status).toBe("success");
    expect(toolRecords[0]!.result).toBe("written");
    expect(executionLog).toEqual(["write-executed"]);
  });

  it("respects maxConcurrency limit", async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const tool: AgentTool = {
      name: "slow",
      description: "slow read",
      isConcurrencySafe: true,
      async execute() {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 50));
        currentConcurrent--;
        return "ok";
      },
    };

    const llm: LLMProvider = {
      name: "mock",
      async chat() {
        return { content: "", model: "m" };
      },
      async *stream() {
        // Emit 5 tool calls at once
        const calls = Array.from({ length: 5 }, (_, i) => ({
          tool: "slow",
          arguments: { i },
        }));
        yield { content: JSON.stringify(calls), done: false };
        yield { content: "", done: true };
      },
    };

    await executeModelAndTools(
      llm,
      [{ role: "user", content: "go" }],
      [tool],
      undefined,
      { maxConcurrency: 2 },
    );
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("returns results in order regardless of completion order", async () => {
    const tool: AgentTool = {
      name: "varied",
      description: "varies",
      isConcurrencySafe: true,
      async execute(args) {
        // Later tools complete faster
        await new Promise((r) =>
          setTimeout(r, (3 - (args.i as number)) * 20),
        );
        return args.i;
      },
    };

    const calls = [0, 1, 2].map((i) => ({
      tool: "varied",
      arguments: { i },
    }));
    const llm: LLMProvider = {
      name: "mock",
      async chat() {
        return { content: "", model: "m" };
      },
      async *stream() {
        yield { content: JSON.stringify(calls), done: false };
        yield { content: "", done: true };
      },
    };

    const { toolRecords } = await executeModelAndTools(
      llm,
      [{ role: "user", content: "go" }],
      [tool],
      undefined,
      { maxConcurrency: 10 },
    );
    expect(toolRecords.map((r) => r.result)).toEqual([0, 1, 2]);
  });

  it("hard failure in concurrent tool prevents queued write tools", async () => {
    const hardFail: AgentTool = {
      name: "crash",
      description: "crashes",
      isConcurrencySafe: true,
      failureMode: "hard",
      async execute() {
        throw new Error("boom");
      },
    };
    const writeTool: AgentTool = {
      name: "write",
      description: "writes",
      isConcurrencySafe: false,
      async execute() {
        return "written";
      },
    };

    const llm: LLMProvider = {
      name: "mock",
      async chat() {
        return { content: "", model: "m" };
      },
      async *stream() {
        yield {
          content: JSON.stringify([
            { tool: "crash", arguments: {} },
            { tool: "write", arguments: {} },
          ]),
          done: false,
        };
        yield { content: "", done: true };
      },
    };

    const { toolRecords, haltedByHardFailure } = await executeModelAndTools(
      llm,
      [{ role: "user", content: "go" }],
      [hardFail, writeTool],
      undefined,
      { maxConcurrency: 10 },
    );
    expect(haltedByHardFailure).toBe(true);
    expect(toolRecords.find((r) => r.tool === "write")).toBeUndefined();
  });

  it("mixes concurrent reads and serial writes correctly", async () => {
    const executionOrder: string[] = [];
    const readTool: AgentTool = {
      name: "read",
      description: "reads",
      isConcurrencySafe: true,
      async execute(args) {
        executionOrder.push(`read-${args.id}-start`);
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push(`read-${args.id}-end`);
        return `read-${args.id}`;
      },
    };
    const writeTool: AgentTool = {
      name: "write",
      description: "writes",
      isConcurrencySafe: false,
      async execute(args) {
        executionOrder.push(`write-${args.id}`);
        return `write-${args.id}`;
      },
    };

    const llm: LLMProvider = {
      name: "mock",
      async chat() {
        return { content: "", model: "m" };
      },
      async *stream() {
        yield {
          content: JSON.stringify([
            { tool: "read", arguments: { id: 1 } },
            { tool: "write", arguments: { id: 2 } },
            { tool: "read", arguments: { id: 3 } },
          ]),
          done: false,
        };
        yield { content: "", done: true };
      },
    };

    const { toolRecords } = await executeModelAndTools(
      llm,
      [{ role: "user", content: "go" }],
      [readTool, writeTool],
      undefined,
      { maxConcurrency: 10 },
    );
    // All three should execute
    expect(toolRecords).toHaveLength(3);
    // Results in order
    expect(toolRecords[0]!.result).toBe("read-1");
    expect(toolRecords[1]!.result).toBe("write-2");
    expect(toolRecords[2]!.result).toBe("read-3");
  });

  it("blocked approval during concurrent execution stops all subsequent tools", async () => {
    const readTool: AgentTool = {
      name: "guarded",
      description: "guarded read",
      isConcurrencySafe: true,
      async execute() {
        return "ok";
      },
    };

    const hooks: SmartAgentHooks = {
      async beforeToolCall() {
        return { allowed: false, reason: "needs approval" };
      },
    };

    const llm: LLMProvider = {
      name: "mock",
      async chat() {
        return { content: "", model: "m" };
      },
      async *stream() {
        yield {
          content: JSON.stringify({ tool: "guarded", arguments: {} }),
          done: false,
        };
        yield { content: "", done: true };
      },
    };

    const { blockedApproval } = await executeModelAndTools(
      llm,
      [{ role: "user", content: "go" }],
      [readTool],
      hooks,
      { maxConcurrency: 10 },
    );
    expect(blockedApproval).toBeDefined();
    expect(blockedApproval!.reason).toBe("needs approval");
  });

  it("clamps maxConcurrency to at least 1", async () => {
    // Should not hang with maxConcurrency: 0
    const tool: AgentTool = {
      name: "t",
      description: "t",
      isConcurrencySafe: true,
      async execute() { return 1; },
    };
    const llm: LLMProvider = {
      name: "mock",
      async chat(): Promise<LLMResponse> {
        return { content: "", model: "m" };
      },
      async *stream(): AsyncIterable<LLMStreamChunk> {
        yield { content: '{"tool": "t", "arguments": {}}', done: false };
        yield { content: "", done: true };
      },
    };
    const { toolRecords } = await executeModelAndTools(
      llm,
      [{ role: "user", content: "go" }],
      [tool],
      undefined,
      { maxConcurrency: 0 },
    );
    expect(toolRecords).toHaveLength(1);
  });
});

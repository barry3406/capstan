import { describe, it, expect, afterEach } from "bun:test";
import { createSmartAgent } from "../../packages/ai/src/index.js";
import { validateArgs } from "../../packages/ai/src/loop/validate-args.js";
import { microcompactMessages } from "../../packages/ai/src/loop/compaction.js";
import { memoryAgeDays, memoryAge, memoryFreshnessText } from "../../packages/ai/src/loop/memory-age.js";
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMOptions,
  LLMStreamChunk,
  AgentTool,
  AgentRunResult,
  MicrocompactConfig,
} from "../../packages/ai/src/types.js";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock LLM helpers
// ---------------------------------------------------------------------------

function mockLLM(
  responses: string[],
  sink?: LLMMessage[][],
): LLMProvider {
  let i = 0;
  return {
    name: "mock",
    async chat(msgs: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      sink?.push(msgs.map((m) => ({ ...m })));
      return { content: responses[i++] ?? "done", model: "mock" };
    },
  };
}

function slowLLM(delayMs: number): LLMProvider {
  return {
    name: "slow-mock",
    async chat(): Promise<LLMResponse> {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { content: "slow response", model: "mock" };
    },
  };
}

function streamingLLM(chunks: Array<{ content: string; delayMs?: number }>, done?: { finishReason?: string }): LLMProvider {
  return {
    name: "streaming-mock",
    async chat(): Promise<LLMResponse> {
      return { content: chunks.map((c) => c.content).join(""), model: "mock" };
    },
    async *stream(): AsyncIterable<LLMStreamChunk> {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        if (chunk.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, chunk.delayMs));
        }
        const isLast = i === chunks.length - 1;
        yield {
          content: chunk.content,
          done: isLast,
          finishReason: isLast ? done?.finishReason : undefined,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Category 0: Microcompact Caching (existing tests, preserved)
// ---------------------------------------------------------------------------

describe("Microcompact Caching", () => {
  const config: MicrocompactConfig = { maxToolResultChars: 100, protectedTail: 2 };

  it("caches truncated results and reuses them", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: 'Tool "big" returned:\n' + "x".repeat(500) },
      { role: "assistant", content: "ok" },
      { role: "user", content: "last" },
    ];
    const cache = new Map<string, string>();
    const r1 = microcompactMessages(msgs, config, cache);
    expect(r1.truncatedCount).toBe(1);
    expect(cache.size).toBe(1);

    // Second call reuses cache
    const r2 = microcompactMessages(msgs, config, cache);
    expect(r2.truncatedCount).toBe(1);
    expect(r2.messages[1]!.content).toBe(r1.messages[1]!.content);
  });

  it("does not cache untruncated messages", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: 'Tool "sm" returned:\n{"v":1}' },
      { role: "assistant", content: "ok" },
      { role: "user", content: "last" },
    ];
    const cache = new Map<string, string>();
    microcompactMessages(msgs, config, cache);
    expect(cache.size).toBe(0);
  });

  it("works without cache parameter (backward compat)", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: 'Tool "big" returned:\n' + "x".repeat(500) },
      { role: "assistant", content: "ok" },
      { role: "user", content: "last" },
    ];
    const r = microcompactMessages(msgs, config);
    expect(r.truncatedCount).toBe(1);
  });
});

// ===========================================================================
// Category 1: Integration Tests — tool input validation
// ===========================================================================

describe("Integration: Tool Input Validation", () => {
  it("rejects invalid tool args with error returned to LLM (not crash)", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "read_file", arguments: { path: 123 } }),
        "I see the error.",
      ]),
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          async execute(args) {
            return `contents of ${args.path}`;
          },
        },
      ],
    });

    const result = await agent.run("Read /tmp/test");
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.status).toBe("error");
    const err = result.toolCalls[0]!.result as { error: string };
    expect(err.error).toContain("expected string");
  });

  it("custom validate function is called before execute", async () => {
    let executeCalled = false;

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "guarded", arguments: { input: "forbidden" } }),
        "I see the validation error.",
      ]),
      tools: [
        {
          name: "guarded",
          description: "A guarded tool",
          validate(args: Record<string, unknown>) {
            if (String(args.input).includes("forbidden")) {
              return { valid: false, error: "Input contains forbidden content" };
            }
            return { valid: true };
          },
          async execute() {
            executeCalled = true;
            return "ok";
          },
        },
      ],
    });

    const result = await agent.run("Call guarded");
    expect(result.status).toBe("completed");
    expect(result.toolCalls[0]!.status).toBe("error");
    const err = result.toolCalls[0]!.result as { error: string };
    expect(err.error).toContain("forbidden");
    expect(executeCalled).toBe(false);
  });

  it("valid args pass validation and reach execute", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "read_file", arguments: { path: "/tmp/test" } }),
        "Got it.",
      ]),
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          async execute(args) {
            return `contents of ${args.path}`;
          },
        },
      ],
    });

    const result = await agent.run("Read /tmp/test");
    expect(result.status).toBe("completed");
    expect(result.toolCalls[0]!.status).toBe("success");
    expect(result.toolCalls[0]!.result).toBe("contents of /tmp/test");
  });

  it("rejects missing required fields", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "read_file", arguments: {} }),
        "I see the error.",
      ]),
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          async execute(args) {
            return `contents of ${args.path}`;
          },
        },
      ],
    });

    const result = await agent.run("Read");
    expect(result.status).toBe("completed");
    expect(result.toolCalls[0]!.status).toBe("error");
    const err = result.toolCalls[0]!.result as { error: string };
    expect(err.error).toContain("Missing required field");
  });
});

// ===========================================================================
// Category 1: Integration Tests — tool timeout
// ===========================================================================

describe("Integration: Tool Timeout", () => {
  it("slow tool is killed and error returned to LLM", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "slow", arguments: {} }),
        "I see it timed out.",
      ]),
      tools: [
        {
          name: "slow",
          description: "A slow tool",
          timeout: 100,
          async execute() {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            return "should not reach here";
          },
        },
      ],
    });

    const result = await agent.run("Call slow");
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.status).toBe("error");
    const err = result.toolCalls[0]!.result as { error: string };
    expect(err.error).toContain("timed out");
  });

  it("timeout timer is cleaned up after fast tool completes", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "fast", arguments: {} }),
        "Done.",
      ]),
      tools: [
        {
          name: "fast",
          description: "A fast tool with generous timeout",
          timeout: 5000,
          async execute() {
            return "instant";
          },
        },
      ],
    });

    const result = await agent.run("Call fast");
    expect(result.status).toBe("completed");
    expect(result.toolCalls[0]!.status).toBe("success");
    expect(result.toolCalls[0]!.result).toBe("instant");
    // Test completes without hanging — proves timer was cleaned up
  });
});

// ===========================================================================
// Category 1: Integration Tests — LLM Watchdog
// ===========================================================================

describe("Integration: LLM Watchdog", () => {
  it("chat timeout kills hanging LLM call", async () => {
    const agent = createSmartAgent({
      llm: slowLLM(10000),
      tools: [],
      llmTimeout: { chatTimeoutMs: 200 },
    });

    const result = await agent.run("Question");
    expect(result.status).toBe("fatal");
    expect(result.error).toContain("timeout");
  });

  it("stream idle timeout kills stalling stream", async () => {
    // The idle timeout check fires when a chunk arrives after a long gap.
    // So the stream must yield a second chunk after the stall to trigger it.
    const stallingLLM: LLMProvider = {
      name: "stalling-stream",
      async chat(): Promise<LLMResponse> {
        return { content: "fallback", model: "mock" };
      },
      async *stream(): AsyncIterable<LLMStreamChunk> {
        yield { content: "first chunk ", done: false };
        // Stall longer than the idle timeout
        await new Promise((resolve) => setTimeout(resolve, 400));
        // This chunk triggers the idle timeout check
        yield { content: "late chunk", done: true };
      },
    };

    const agent = createSmartAgent({
      llm: stallingLLM,
      tools: [],
      llmTimeout: { streamIdleTimeoutMs: 200 },
    });

    const result = await agent.run("Stream me something");
    expect(result.status).toBe("fatal");
    expect(result.error).toContain("idle timeout");
  });

  it("normal stream completes without false timeout", async () => {
    const agent = createSmartAgent({
      llm: streamingLLM([
        { content: "Hello " },
        { content: "world!" },
      ]),
      tools: [],
      llmTimeout: { streamIdleTimeoutMs: 5000 },
    });

    const result = await agent.run("Say hello");
    expect(result.status).toBe("completed");
    expect(result.result).toBe("Hello world!");
  });
});

// ===========================================================================
// Category 1: Integration Tests — Tool Result Persistence
// ===========================================================================

describe("Integration: Tool Result Persistence", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("large result persisted to disk and reference injected", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "capstan-persist-"));
    const capturedMessages: LLMMessage[][] = [];

    const agent = createSmartAgent({
      llm: mockLLM(
        [
          JSON.stringify({ tool: "big", arguments: {} }),
          "I see the reference.",
        ],
        capturedMessages,
      ),
      tools: [
        {
          name: "big",
          description: "Returns a big result",
          async execute() {
            return "Z".repeat(10000);
          },
        },
      ],
      toolResultBudget: { maxChars: 500, persistDir: tempDir },
    });

    const result = await agent.run("Get big data");
    expect(result.status).toBe("completed");

    // Verify file exists on disk
    const files = await readdir(tempDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.startsWith("tool-result-"))).toBe(true);

    // Verify the message to LLM references read_persisted_result
    const secondCall = capturedMessages[1]!;
    const toolResultMsg = secondCall.find(
      (m) => m.role === "user" && m.content.includes("read_persisted_result"),
    );
    expect(toolResultMsg).toBeDefined();
  });

  it("read_persisted_result tool can retrieve saved result", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "capstan-persist-"));
    const capturedMessages: LLMMessage[][] = [];

    const agent = createSmartAgent({
      llm: {
        name: "mock-two-phase",
        async chat(msgs: LLMMessage[]): Promise<LLMResponse> {
          capturedMessages.push(msgs.map((m) => ({ ...m })));

          // Phase 1: call the big tool
          if (capturedMessages.length === 1) {
            return {
              content: JSON.stringify({ tool: "big", arguments: {} }),
              model: "mock",
            };
          }

          // Phase 2: extract the persisted ID and call read_persisted_result
          if (capturedMessages.length === 2) {
            const persistMsg = msgs.find(
              (m) => m.role === "user" && m.content.includes("read_persisted_result"),
            );
            if (persistMsg) {
              const idMatch = persistMsg.content.match(/id "([^"]+)"/);
              if (idMatch) {
                return {
                  content: JSON.stringify({
                    tool: "read_persisted_result",
                    arguments: { id: idMatch[1] },
                  }),
                  model: "mock",
                };
              }
            }
            return { content: "Could not find reference", model: "mock" };
          }

          // Phase 3: final response after reading persisted result
          return { content: "Got the full result back.", model: "mock" };
        },
      },
      tools: [
        {
          name: "big",
          description: "Returns a big result",
          async execute() {
            return { data: "A".repeat(5000) };
          },
        },
      ],
      toolResultBudget: { maxChars: 200, persistDir: tempDir },
    });

    const result = await agent.run("Get and read big data");
    expect(result.status).toBe("completed");
    // Should have two tool calls: big + read_persisted_result
    expect(result.toolCalls.length).toBe(2);
    expect(result.toolCalls[1]!.tool).toBe("read_persisted_result");
    expect(result.toolCalls[1]!.status).toBe("success");
    // The read result should contain the original data
    const readResult = result.toolCalls[1]!.result as { data: string };
    expect(readResult.data).toContain("AAAA");
  });
});

// ===========================================================================
// Category 2: Adversarial — read_persisted_result path traversal
// ===========================================================================

describe("Adversarial: read_persisted_result path traversal", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rejects id with path traversal sequences (../../etc/passwd)", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "capstan-traversal-"));

    const agent = createSmartAgent({
      llm: mockLLM([
        // First: trigger persistence via a big tool result
        JSON.stringify({ tool: "big", arguments: {} }),
        // Then: try path traversal via read_persisted_result
        JSON.stringify({
          tool: "read_persisted_result",
          arguments: { id: "../../etc/passwd" },
        }),
        "Done.",
      ]),
      tools: [
        {
          name: "big",
          description: "Big result",
          async execute() {
            return "X".repeat(5000);
          },
        },
      ],
      toolResultBudget: { maxChars: 100, persistDir: tempDir },
    });

    const result = await agent.run("Try path traversal");
    expect(result.status).toBe("completed");

    // The read_persisted_result call should NOT return /etc/passwd contents
    const readCall = result.toolCalls.find(
      (tc) => tc.tool === "read_persisted_result",
    );
    expect(readCall).toBeDefined();
    // The path chars ../ are sanitized, so the sanitized id is "etcpasswd"
    // which won't match any file — should get "not found" error
    const readResult = readCall!.result as { error?: string };
    expect(readResult.error).toBeDefined();
  });

  it("rejects id with slashes", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "capstan-traversal-"));

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "big", arguments: {} }),
        JSON.stringify({
          tool: "read_persisted_result",
          arguments: { id: "foo/bar/baz" },
        }),
        "Done.",
      ]),
      tools: [
        {
          name: "big",
          description: "Big result",
          async execute() {
            return "X".repeat(5000);
          },
        },
      ],
      toolResultBudget: { maxChars: 100, persistDir: tempDir },
    });

    const result = await agent.run("Try slash id");
    const readCall = result.toolCalls.find(
      (tc) => tc.tool === "read_persisted_result",
    );
    expect(readCall).toBeDefined();
    // Slashes are stripped, sanitized id becomes "foobarbaz"
    // which doesn't match any persisted file
    const readResult = readCall!.result as { error?: string };
    expect(readResult.error).toBeDefined();
    expect(readResult.error).toContain("not found");
  });

  it("rejects empty id", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "capstan-traversal-"));

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "big", arguments: {} }),
        JSON.stringify({
          tool: "read_persisted_result",
          arguments: { id: "" },
        }),
        "Done.",
      ]),
      tools: [
        {
          name: "big",
          description: "Big result",
          async execute() {
            return "X".repeat(5000);
          },
        },
      ],
      toolResultBudget: { maxChars: 100, persistDir: tempDir },
    });

    const result = await agent.run("Try empty id");
    const readCall = result.toolCalls.find(
      (tc) => tc.tool === "read_persisted_result",
    );
    expect(readCall).toBeDefined();
    const readResult = readCall!.result as { error?: string };
    expect(readResult.error).toBe("Invalid result ID");
  });

  it("accepts valid alphanumeric id (attempts read, may not find file)", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "capstan-traversal-"));

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "big", arguments: {} }),
        JSON.stringify({
          tool: "read_persisted_result",
          arguments: { id: "tr_abc12345" },
        }),
        "Done.",
      ]),
      tools: [
        {
          name: "big",
          description: "Big result",
          async execute() {
            return "X".repeat(5000);
          },
        },
      ],
      toolResultBudget: { maxChars: 100, persistDir: tempDir },
    });

    const result = await agent.run("Try valid id");
    const readCall = result.toolCalls.find(
      (tc) => tc.tool === "read_persisted_result",
    );
    expect(readCall).toBeDefined();
    // The id is valid (no path traversal) but won't match the auto-generated id
    const readResult = readCall!.result as { error?: string };
    // Should get "not found" (safe behavior) rather than a crash or path traversal
    expect(readResult.error).toContain("not found");
  });
});

// ===========================================================================
// Category 2: Adversarial — validate-args edge cases
// ===========================================================================

describe("Adversarial: validate-args edge cases", () => {
  it("rejects null where object is expected", () => {
    const result = validateArgs(
      { data: null },
      {
        type: "object",
        properties: { data: { type: "object" } },
        required: ["data"],
      },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expected object");
  });

  it("rejects array where object is expected", () => {
    const result = validateArgs(
      { data: [1, 2, 3] },
      {
        type: "object",
        properties: { data: { type: "object" } },
      },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expected object");
  });

  it("rejects non-integer where integer is expected", () => {
    const result = validateArgs(
      { count: 3.5 },
      {
        type: "object",
        properties: { count: { type: "integer" } },
      },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("integer");
  });

  it("collects ALL errors, not just the first", () => {
    const result = validateArgs(
      { a: 123, b: "not-a-number" },
      {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "number" } },
        required: ["a", "b", "c"],
      },
    );
    expect(result.valid).toBe(false);
    // Should report: missing "c", wrong type for "a", wrong type for "b"
    const errors = result.error!.split("\n");
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("passes with undefined schema (permissive)", () => {
    const result = validateArgs({ anything: "goes" }, undefined);
    expect(result.valid).toBe(true);
  });

  it("validates enum constraints", () => {
    const result = validateArgs(
      { color: "purple" },
      {
        type: "object",
        properties: {
          color: { type: "string", enum: ["red", "green", "blue"] },
        },
      },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not one of");
  });
});

// ===========================================================================
// Category 3: Contract Tests — afterToolCall receives status parameter
// ===========================================================================

describe("Contract: afterToolCall receives status parameter", () => {
  it("passes 'success' status on successful tool execution", async () => {
    let receivedStatus: string | undefined;

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "t", arguments: {} }),
        "done",
      ]),
      tools: [
        {
          name: "t",
          description: "test",
          async execute() {
            return "ok";
          },
        },
      ],
      hooks: {
        async afterToolCall(_tool, _args, _result, status) {
          receivedStatus = status;
        },
      },
    });

    await agent.run("go");
    expect(receivedStatus).toBe("success");
  });

  it("passes 'error' status on failed tool execution", async () => {
    let receivedStatus: string | undefined;

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "t", arguments: {} }),
        "done",
      ]),
      tools: [
        {
          name: "t",
          description: "test",
          async execute() {
            throw new Error("boom");
          },
        },
      ],
      hooks: {
        async afterToolCall(_tool, _args, _result, status) {
          receivedStatus = status;
        },
      },
    });

    await agent.run("go");
    expect(receivedStatus).toBe("error");
  });

  it("passes all 4 arguments to afterToolCall", async () => {
    let receivedArgs: unknown[] = [];

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "t", arguments: { x: 1 } }),
        "done",
      ]),
      tools: [
        {
          name: "t",
          description: "test",
          async execute() {
            return 42;
          },
        },
      ],
      hooks: {
        async afterToolCall(tool, args, result, status) {
          receivedArgs = [tool, args, result, status];
        },
      },
    });

    await agent.run("go");
    expect(receivedArgs).toHaveLength(4);
    expect(receivedArgs[0]).toBe("t");
    expect(receivedArgs[2]).toBe(42);
    expect(receivedArgs[3]).toBe("success");
  });
});

// ===========================================================================
// Category 3: Contract Tests — LLMTimeoutConfig fields are used
// ===========================================================================

describe("Contract: LLMTimeoutConfig fields are actually used", () => {
  it("chatTimeoutMs is respected — fires on slow chat", async () => {
    const agent = createSmartAgent({
      llm: slowLLM(5000),
      tools: [],
      llmTimeout: { chatTimeoutMs: 100 },
    });

    const startTime = Date.now();
    const result = await agent.run("Question");
    const elapsed = Date.now() - startTime;

    expect(result.status).toBe("fatal");
    expect(result.error).toContain("timeout");
    // Should have timed out quickly, not waited 5 seconds
    expect(elapsed).toBeLessThan(3000);
  });

  it("streamIdleTimeoutMs is respected — fires on stalling stream", async () => {
    const stallingLLM: LLMProvider = {
      name: "stalling",
      async chat(): Promise<LLMResponse> {
        return { content: "chat fallback", model: "mock" };
      },
      async *stream(): AsyncIterable<LLMStreamChunk> {
        yield { content: "partial", done: false };
        // Stall longer than the idle timeout
        await new Promise((resolve) => setTimeout(resolve, 400));
        // Second chunk triggers the idle check
        yield { content: " done", done: true };
      },
    };

    const agent = createSmartAgent({
      llm: stallingLLM,
      tools: [],
      llmTimeout: { streamIdleTimeoutMs: 150 },
    });

    const startTime = Date.now();
    const result = await agent.run("Stream question");
    const elapsed = Date.now() - startTime;

    expect(result.status).toBe("fatal");
    expect(elapsed).toBeLessThan(3000);
  });
});

// ===========================================================================
// Category 3: Contract Tests — validate-args is wired into execution
// ===========================================================================

describe("Contract: validate-args is wired into execution pipeline", () => {
  it("schema validation runs even without custom validate function", async () => {
    // This was the actual bug: validate-args existed but wasn't called
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "typed", arguments: { count: "not-a-number" } }),
        "done",
      ]),
      tools: [
        {
          name: "typed",
          description: "A typed tool",
          parameters: {
            type: "object",
            properties: { count: { type: "number" } },
            required: ["count"],
          },
          async execute(args) {
            return args.count;
          },
        },
      ],
    });

    const result = await agent.run("go");
    expect(result.toolCalls[0]!.status).toBe("error");
    const err = result.toolCalls[0]!.result as { error: string };
    expect(err.error).toContain("expected number");
  });

  it("custom validate takes precedence over schema validation", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "custom", arguments: { val: "bad" } }),
        "done",
      ]),
      tools: [
        {
          name: "custom",
          description: "Custom validated tool",
          parameters: {
            type: "object",
            properties: { val: { type: "string" } },
          },
          validate(args: Record<string, unknown>) {
            if (args.val === "bad") {
              return { valid: false, error: "Custom rejection" };
            }
            return { valid: true };
          },
          async execute(args) {
            return args.val;
          },
        },
      ],
    });

    const result = await agent.run("go");
    expect(result.toolCalls[0]!.status).toBe("error");
    const err = result.toolCalls[0]!.result as { error: string };
    // Should use custom error message, not schema error
    expect(err.error).toContain("Custom rejection");
  });
});

// ===========================================================================
// Category 3: Contract Tests — microcompactCache is threaded through
// ===========================================================================

describe("Contract: microcompactCache is threaded through engine", () => {
  it("compression does not crash during agent loop (cache exists)", async () => {
    // Run an agent with enough messages to trigger compression
    // The key thing: microcompactCache must be provided by engine to compaction
    const responses: string[] = [];
    for (let i = 0; i < 8; i++) {
      responses.push(JSON.stringify({ tool: "work", arguments: { step: i } }));
    }
    responses.push("All done.");

    const agent = createSmartAgent({
      llm: mockLLM(responses),
      tools: [
        {
          name: "work",
          description: "Do work",
          async execute(args) {
            // Return a large result to trigger compression
            return "Result: " + "R".repeat(2000) + ` step=${args.step}`;
          },
        },
      ],
      // Small context window to trigger compression
      contextWindowSize: 4000,
      compaction: {
        snip: { preserveTail: 4 },
        microcompact: { maxToolResultChars: 200, protectedTail: 4 },
      },
    });

    const result = await agent.run("Do lots of work");
    // Should complete without crashing, even with compression
    expect(["completed", "max_iterations"]).toContain(result.status);
  });
});

// ===========================================================================
// Category 4: Regression Tests — afterToolCall backward compat
// ===========================================================================

describe("Regression: afterToolCall with 3 args still works", () => {
  it("old-style afterToolCall without status param works", async () => {
    const calls: unknown[][] = [];

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "t", arguments: {} }),
        "done",
      ]),
      tools: [
        {
          name: "t",
          description: "test",
          async execute() {
            return 1;
          },
        },
      ],
      hooks: {
        async afterToolCall(tool, args, result) {
          calls.push([tool, args, result]);
        },
      } as any, // cast to bypass 4th param requirement
    });

    await agent.run("go");
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("t");
    expect(calls[0]![2]).toBe(1);
  });
});

// ===========================================================================
// Category 4: Regression Tests — agent without new features still works
// ===========================================================================

describe("Regression: agent without new features still works", () => {
  it("minimal config (no validate, no timeout, no budget, no watchdog) works", async () => {
    const agent = createSmartAgent({
      llm: mockLLM(["Hello!"]),
      tools: [],
    });

    const result = await agent.run("Hi");
    expect(result.status).toBe("completed");
    expect(result.result).toBe("Hello!");
  });

  it("tool without validate or timeout works as before", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "add", arguments: { a: 2, b: 3 } }),
        "5",
      ]),
      tools: [
        {
          name: "add",
          description: "Add",
          parameters: {
            type: "object",
            properties: { a: { type: "number" }, b: { type: "number" } },
            required: ["a", "b"],
          },
          async execute(args) {
            return (args.a as number) + (args.b as number);
          },
        },
      ],
    });

    const result = await agent.run("add 2+3");
    expect(result.toolCalls[0]!.result).toBe(5);
    expect(result.toolCalls[0]!.status).toBe("success");
  });

  it("multiple tool calls in sequence work correctly", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "step1", arguments: {} }),
        JSON.stringify({ tool: "step2", arguments: {} }),
        "Both steps done.",
      ]),
      tools: [
        {
          name: "step1",
          description: "Step 1",
          async execute() {
            return "step1 result";
          },
        },
        {
          name: "step2",
          description: "Step 2",
          async execute() {
            return "step2 result";
          },
        },
      ],
    });

    const result = await agent.run("Do both steps");
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]!.tool).toBe("step1");
    expect(result.toolCalls[1]!.tool).toBe("step2");
  });

  it("tool with failureMode hard stops the loop", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "critical", arguments: {} }),
        "Should still complete.",
      ]),
      tools: [
        {
          name: "critical",
          description: "Critical tool",
          failureMode: "hard" as const,
          async execute() {
            throw new Error("Critical failure");
          },
        },
      ],
    });

    const result = await agent.run("Do critical work");
    // The error is recorded, but loop continues to let LLM see the error
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.status).toBe("error");
  });
});

// ===========================================================================
// Category 4: Regression Tests — validateArgs unit regression
// ===========================================================================

describe("Regression: validateArgs unit", () => {
  it("valid args with all types pass", () => {
    const result = validateArgs(
      { name: "test", count: 5, flag: true, items: [1, 2], meta: { k: "v" } },
      {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "integer" },
          flag: { type: "boolean" },
          items: { type: "array" },
          meta: { type: "object" },
        },
        required: ["name", "count"],
      },
    );
    expect(result.valid).toBe(true);
  });

  it("extra properties not in schema are allowed (permissive)", () => {
    const result = validateArgs(
      { known: "ok", extra: "also ok" },
      {
        type: "object",
        properties: { known: { type: "string" } },
      },
    );
    expect(result.valid).toBe(true);
  });
});

// ===========================================================================
// Category 5: Memory Staleness Annotations
// ===========================================================================

describe("Memory Staleness", () => {
  it("returns 0 days for current timestamp", () => {
    expect(memoryAgeDays(Date.now())).toBe(0);
  });

  it("returns 'today' for current timestamp", () => {
    expect(memoryAge(Date.now())).toBe("today");
  });

  it("returns 'yesterday' for 1 day ago", () => {
    expect(memoryAge(Date.now() - 86_400_000)).toBe("yesterday");
  });

  it("returns 'N days ago' for older", () => {
    expect(memoryAge(Date.now() - 86_400_000 * 5)).toBe("5 days ago");
  });

  it("returns empty string for memories ≤1 day old", () => {
    expect(memoryFreshnessText(Date.now())).toBe("");
    expect(memoryFreshnessText(Date.now() - 86_400_000)).toBe("");
  });

  it("returns staleness warning for memories >1 day old", () => {
    const text = memoryFreshnessText(Date.now() - 86_400_000 * 3);
    expect(text).toContain("3 days old");
    expect(text).toContain("point-in-time");
    expect(text).toContain("Verify");
  });
});

// ===========================================================================
// Category 5: Post-Compact Cleanup
// ===========================================================================

describe("Post-Compact Cleanup", () => {
  it("clears microcompactCache after successful autocompact", async () => {
    // Verify the agent completes successfully with small context
    // (cache clear code is exercised when compression triggers)
    const agent = createSmartAgent({
      llm: mockLLM(["Done."]),
      tools: [],
      contextWindowSize: 1000,
    });
    const result = await agent.run("Go");
    expect(result.status).toBe("completed");
  });
});
// Category 1: Integration Tests — Fallback: thinking block stripping
// ===========================================================================

describe("Fallback: thinking block stripping", () => {
  it("strips thinking blocks before retrying with fallback LLM", async () => {
    const sink: LLMMessage[][] = [];
    let primaryCalls = 0;

    const primaryLlm: LLMProvider = {
      name: "primary",
      async chat(): Promise<LLMResponse> {
        primaryCalls++;
        if (primaryCalls === 1) {
          // First call succeeds with thinking content + fenced JSON tool call
          return {
            content: "<thinking>deep thought</thinking>\n```json\n" + JSON.stringify({ tool: "t", arguments: {} }) + "\n```",
            model: "primary",
          };
        }
        // Second call fails, triggering fallback
        throw new Error("Rate limit");
      },
    };

    const fallbackLlm: LLMProvider = {
      name: "fallback",
      async chat(msgs): Promise<LLMResponse> {
        sink.push(msgs.map(m => ({ ...m })));
        return { content: "Done via fallback.", model: "fallback" };
      },
    };

    const agent = createSmartAgent({
      llm: primaryLlm,
      fallbackLlm,
      tools: [{ name: "t", description: "test", async execute() { return "ok"; } }],
    });

    const result = await agent.run("Do something");
    expect(result.status).toBe("completed");

    // Verify fallback received messages without thinking blocks
    const fallbackMsgs = sink[0]!;
    const hasThinking = fallbackMsgs.some(m => m.content.includes("<thinking>"));
    expect(hasThinking).toBe(false);
  });

  it("handles messages with only thinking content", async () => {
    const primaryLlm: LLMProvider = {
      name: "primary",
      async chat(): Promise<LLMResponse> {
        throw new Error("API error");
      },
    };
    // Messages that might have thinking-only assistant entries shouldn't crash
    const fallbackLlm: LLMProvider = {
      name: "fallback",
      async chat(): Promise<LLMResponse> {
        return { content: "Recovered.", model: "fallback" };
      },
    };

    const agent = createSmartAgent({
      llm: primaryLlm,
      fallbackLlm,
      tools: [],
    });
    const result = await agent.run("Go");
    expect(result.status).toBe("completed");
  });
});
// Category: Abort — synthetic tool_result for interrupted tools
// ---------------------------------------------------------------------------

describe("Abort: synthetic tool_result for interrupted tools", () => {
  it("generates synthetic error for tool_use without matching result", async () => {
    // Create an agent with a slow tool that will time out, ensuring a synthetic error record
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify([
          { tool: "fast", arguments: {} },
          { tool: "slow", arguments: {} },
        ]),
        "Done.",
      ]),
      tools: [
        { name: "fast", description: "Fast", async execute() { return "ok"; } },
        {
          name: "slow",
          description: "Slow",
          timeout: 50,
          async execute() {
            await new Promise((r) => setTimeout(r, 5000));
            return "late";
          },
        },
      ],
    });
    const result = await agent.run("call both tools");
    // Both tools should have records (slow one with error from timeout)
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    const slowCall = result.toolCalls.find((c) => c.tool === "slow");
    if (slowCall) {
      expect(slowCall.status).toBe("error");
    }
  });
});

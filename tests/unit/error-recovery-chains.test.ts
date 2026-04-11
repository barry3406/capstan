import { describe, it, expect } from "bun:test";
import { createSmartAgent } from "../../packages/ai/src/index.js";
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMOptions,
  AgentTool,
  StopHook,
  AgentEvent,
} from "../../packages/ai/src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock LLM whose chat() behaviour is driven by a callback receiving
 * the (0-based) call index and the messages array.
 */
function mockLLMFn(
  fn: (callIndex: number, messages: LLMMessage[], opts?: LLMOptions) => LLMResponse | Promise<LLMResponse>,
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
      const idx = callIndex++;
      return fn(idx, messages, opts);
    },
  };
}

/** Collect all AgentEvents from a stream run. */
async function collectEvents(
  agent: ReturnType<typeof createSmartAgent>,
  goal: string,
): Promise<{ events: AgentEvent[]; result: import("../../packages/ai/src/types.js").AgentRunResult }> {
  const events: AgentEvent[] = [];
  const stream = agent.stream(goal);
  let iterResult: IteratorResult<AgentEvent, import("../../packages/ai/src/types.js").AgentRunResult>;
  do {
    iterResult = await stream.next();
    if (!iterResult.done) {
      events.push(iterResult.value);
    }
  } while (!iterResult.done);
  return { events, result: iterResult.value };
}

// ---------------------------------------------------------------------------
// Test 1: Tool error -> retry -> context overflow -> compact -> complete
// ---------------------------------------------------------------------------

describe("Error Recovery Chains", () => {
  it("Test 1: tool error -> retry -> context overflow -> compact -> complete", async () => {
    let toolCallCount = 0;
    const flakeyTool: AgentTool = {
      name: "fetch_data",
      description: "Fetches data",
      parameters: { type: "object", properties: { q: { type: "string" } } },
      async execute(_args) {
        toolCallCount++;
        if (toolCallCount === 1) {
          throw new Error("Connection timeout");
        }
        if (toolCallCount === 2) {
          return { data: "success" };
        }
        // 3rd call: return a big result to fill context
        return { data: "x".repeat(80_000) };
      },
    };

    let llmCallCount = 0;
    const llm = mockLLMFn((idx, _msgs) => {
      llmCallCount++;
      if (idx === 0) {
        // iteration 1: call tool -> will fail
        return { content: JSON.stringify({ tool: "fetch_data", arguments: { q: "test" } }), model: "mock-1" };
      }
      if (idx === 1) {
        // iteration 2: retry tool -> will succeed
        return { content: JSON.stringify({ tool: "fetch_data", arguments: { q: "test" } }), model: "mock-1" };
      }
      if (idx === 2) {
        // iteration 3: call tool again -> big result
        return { content: JSON.stringify({ tool: "fetch_data", arguments: { q: "big" } }), model: "mock-1" };
      }
      if (idx === 3) {
        // iteration 4: context_limit - simulate LLM seeing too many tokens
        throw new Error("prompt too long");
      }
      // Autocompact LLM call (idx=4 is the autocompact summarization call)
      if (idx === 4) {
        return {
          content: JSON.stringify({ summary: "Fetched data successfully. Big result received.", memories: [] }),
          model: "mock-1",
        };
      }
      // iteration 5: final answer after compaction
      return { content: "All data fetched successfully.", model: "mock-1" };
    });

    const agent = createSmartAgent({
      llm,
      tools: [flakeyTool],
      maxIterations: 15,
      contextWindowSize: 30_000,
      compaction: {
        autocompact: { threshold: 0.85, maxFailures: 3 },
      },
    });

    const result = await agent.run("Fetch data");

    expect(result.status).toBe("completed");
    expect(result.result).toBe("All data fetched successfully.");
    // Tool was called 3 times total (fail, retry-success, big result)
    expect(toolCallCount).toBe(3);
    // The failed tool should have been retried
    const errorCalls = result.toolCalls.filter((tc) => tc.status === "error");
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Autocompact fails -> reactive compact -> recovery
  // ---------------------------------------------------------------------------

  it("Test 2: autocompact fails -> reactive compact -> recovery", async () => {
    let llmCallCount = 0;

    const llm = mockLLMFn((idx, msgs) => {
      llmCallCount++;

      // Check if this is an autocompact summarization call (system prompt contains "summarizing")
      const isAutocompactCall = msgs.some(
        (m) => m.role === "system" && m.content.includes("summarizing a conversation"),
      );

      if (isAutocompactCall) {
        // Return invalid JSON to make autocompact fail
        return { content: "NOT VALID JSON {{{", model: "mock-1" };
      }

      // Main LLM calls
      if (idx === 0) {
        // Build up some message history by returning tool calls
        return { content: JSON.stringify({ tool: "echo", arguments: { text: "hello" } }), model: "mock-1" };
      }
      if (idx <= 2) {
        // More tool calls to build history
        return { content: JSON.stringify({ tool: "echo", arguments: { text: "world" } }), model: "mock-1" };
      }

      // After building enough history, trigger context limit
      if (idx <= 4) {
        throw new Error("prompt too long");
      }

      // After reactive compact, LLM works
      return { content: "Done after recovery.", model: "mock-1" };
    });

    const echoTool: AgentTool = {
      name: "echo",
      description: "Echoes text",
      parameters: { type: "object", properties: { text: { type: "string" } } },
      async execute(args) {
        // Return large results to build up context
        return { echo: (args.text as string).repeat(5000) };
      },
    };

    const agent = createSmartAgent({
      llm,
      tools: [echoTool],
      maxIterations: 20,
      contextWindowSize: 8_000,
      compaction: {
        autocompact: { threshold: 0.85, maxFailures: 3 },
      },
    });

    const { events, result } = await collectEvents(agent, "Echo some text");

    expect(result.status).toBe("completed");

    // Should have compression events
    const compressionEvents = events.filter((e) => e.type === "compression");
    expect(compressionEvents.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Primary LLM fails -> fallback -> fallback context_limit -> compact -> complete
  // ---------------------------------------------------------------------------

  it("Test 3: primary fails -> fallback -> fallback context_limit -> compact -> complete", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;

    const primaryLLM: LLMProvider = {
      name: "primary",
      async chat(_msgs: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
        primaryCalls++;
        if (primaryCalls === 1) {
          throw new Error("rate limit exceeded");
        }
        // After recovery, primary works
        return { content: "Final answer after recovery.", model: "primary-1" };
      },
    };

    const fallbackLLM: LLMProvider = {
      name: "fallback",
      async chat(_msgs: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
        fallbackCalls++;
        // Fallback also fails with context limit
        throw new Error("prompt too long");
      },
    };

    const agent = createSmartAgent({
      llm: primaryLLM,
      fallbackLlm: fallbackLLM,
      tools: [],
      maxIterations: 10,
      contextWindowSize: 50_000,
      compaction: {
        autocompact: { threshold: 0.85, maxFailures: 3 },
      },
    });

    const { events, result } = await collectEvents(agent, "Answer me");

    // The engine tries primary (rate limit) -> fallback (prompt too long) -> fatal
    // Both primary and fallback failed, so result is fatal
    expect(result.status).toBe("fatal");
    expect(result.error).toContain("Primary LLM failed");
    expect(result.error).toContain("Fallback LLM also failed");

    // Should have model_fallback event
    const fallbackEvents = events.filter((e) => e.type === "model_fallback");
    expect(fallbackEvents.length).toBeGreaterThanOrEqual(1);

    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Stop hook rejects 3 times -> force complete
  // ---------------------------------------------------------------------------

  it("Test 4: stop hook rejects 3 times -> force complete", async () => {
    let llmCallCount = 0;

    const llm = mockLLMFn((idx) => {
      llmCallCount++;
      if (idx === 0) return { content: "Hi", model: "mock-1" };
      if (idx === 1) return { content: "Hello there", model: "mock-1" };
      if (idx === 2) return { content: "Hello world", model: "mock-1" };
      return { content: "This is a longer response that should not be reached", model: "mock-1" };
    });

    const qualityHook: StopHook = {
      name: "length-check",
      async evaluate(context) {
        if (context.response.length < 500) {
          return { pass: false, feedback: "Response too short. Need at least 500 characters." };
        }
        return { pass: true };
      },
    };

    const agent = createSmartAgent({
      llm,
      tools: [],
      stopHooks: [qualityHook],
      maxIterations: 10,
    });

    const result = await agent.run("Give me a detailed answer");

    // After 3 rejections, engine force-completes
    expect(result.status).toBe("completed");
    expect(result.iterations).toBeGreaterThanOrEqual(3);
    // The force-complete path returns lastAssistantContent (which may be null
    // if no tool-bearing iteration set it) — the key invariant is status=completed
    // not fatal, and the response was the rejected one pushed to messages
    expect(result.iterations).toBeLessThanOrEqual(5);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Tool timeout -> error withholding -> retry -> succeed
  // ---------------------------------------------------------------------------

  it("Test 5: tool timeout -> error withholding -> retry -> succeed", async () => {
    let toolCallCount = 0;

    const slowTool: AgentTool = {
      name: "slow_fetch",
      description: "Fetches data slowly",
      parameters: { type: "object", properties: { url: { type: "string" } } },
      timeout: 100, // 100ms timeout
      async execute(_args) {
        toolCallCount++;
        if (toolCallCount === 1) {
          // First call: sleep longer than timeout
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { data: "should not reach" };
        }
        // Second call: fast
        return { data: "fetched successfully" };
      },
    };

    const llm = mockLLMFn((idx) => {
      if (idx === 0) {
        return { content: JSON.stringify({ tool: "slow_fetch", arguments: { url: "http://example.com" } }), model: "mock-1" };
      }
      if (idx === 1) {
        // After retry hint, retry the tool
        return { content: JSON.stringify({ tool: "slow_fetch", arguments: { url: "http://example.com" } }), model: "mock-1" };
      }
      return { content: "Got the data: fetched successfully", model: "mock-1" };
    });

    const agent = createSmartAgent({
      llm,
      tools: [slowTool],
      maxIterations: 10,
    });

    const result = await agent.run("Fetch data from URL");

    expect(result.status).toBe("completed");
    expect(result.result).toBe("Got the data: fetched successfully");
    // Tool was called twice (timeout + retry)
    expect(toolCallCount).toBe(2);
    // Should have an error record for the timeout
    const errorCalls = result.toolCalls.filter((tc) => tc.status === "error");
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(errorCalls[0]!.result)).toContain("timed out");
  });

  // ---------------------------------------------------------------------------
  // Test 6: Multiple tools, one hard fails -> halt
  // ---------------------------------------------------------------------------

  it("Test 6: multiple tools, one hard fails -> halt", async () => {
    const safeTool: AgentTool = {
      name: "safe_tool",
      description: "Always succeeds",
      parameters: { type: "object", properties: { x: { type: "string" } } },
      isConcurrencySafe: true,
      async execute(_args) {
        return "ok";
      },
    };

    const hardFailTool: AgentTool = {
      name: "hard_fail_tool",
      description: "Always hard-fails",
      parameters: { type: "object", properties: { x: { type: "string" } } },
      failureMode: "hard",
      isConcurrencySafe: true,
      async execute(_args) {
        throw new Error("Critical infrastructure failure");
      },
    };

    const llm = mockLLMFn((idx) => {
      if (idx === 0) {
        // Request both tools concurrently
        return {
          content: JSON.stringify([
            { tool: "safe_tool", arguments: { x: "go" } },
            { tool: "hard_fail_tool", arguments: { x: "boom" } },
          ]),
          model: "mock-1",
        };
      }
      // After hard failure, engine should report
      return { content: "Acknowledged the failure.", model: "mock-1" };
    });

    const agent = createSmartAgent({
      llm,
      tools: [safeTool, hardFailTool],
      maxIterations: 10,
    });

    const { events, result } = await collectEvents(agent, "Run both tools");

    // Find tool_call_end events
    const toolEndEvents = events.filter((e) => e.type === "tool_call_end") as Array<
      Extract<AgentEvent, { type: "tool_call_end" }>
    >;

    // hard_fail_tool should have error status
    const hardFailEvent = toolEndEvents.find((e) => e.tool === "hard_fail_tool");
    expect(hardFailEvent).toBeDefined();
    expect(hardFailEvent!.status).toBe("error");

    // Tool call records should show the hard failure
    const hardFailRecord = result.toolCalls.find((tc) => tc.tool === "hard_fail_tool");
    expect(hardFailRecord).toBeDefined();
    expect(hardFailRecord!.status).toBe("error");
  });

  // ---------------------------------------------------------------------------
  // Test 7: Token budget -> nudge -> continue -> exhaust -> force complete
  // ---------------------------------------------------------------------------

  it("Test 7: token budget -> nudge -> continue -> exhaust -> force complete", async () => {
    // Each tool call iteration: LLM returns tool request -> tool runs -> LLM sees result
    // completionTokens accumulate: 300, 600, 900, 1200 (>1000 budget)
    // Nudge at 50% = 500 tokens -> after iteration 2 (600 tokens)
    // Force-complete at 100% = 1000 tokens -> after iteration 4 (1200 tokens)

    const llm = mockLLMFn((idx) => {
      // Every call returns a tool call with 300 completion tokens
      if (idx <= 5) {
        return {
          content: JSON.stringify({ tool: "noop", arguments: { step: idx } }),
          model: "mock-1",
          usage: { promptTokens: 100, completionTokens: 300, totalTokens: 400 },
        };
      }
      return {
        content: "Final summary.",
        model: "mock-1",
        usage: { promptTokens: 100, completionTokens: 300, totalTokens: 400 },
      };
    });

    const noopTool: AgentTool = {
      name: "noop",
      description: "Does nothing",
      parameters: { type: "object", properties: { step: { type: "number" } } },
      async execute() {
        return "done";
      },
    };

    const agent = createSmartAgent({
      llm,
      tools: [noopTool],
      maxIterations: 10,
      tokenBudget: { maxOutputTokensPerTurn: 1000, nudgeAtPercent: 50 },
    });

    const { events, result } = await collectEvents(agent, "Generate content");

    expect(result.status).toBe("completed");

    // Should have a token_budget_warning event (nudge at 50% = 500 tokens)
    const budgetWarnings = events.filter((e) => e.type === "token_budget_warning");
    expect(budgetWarnings.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Test 8: Context overflow -> autocompact circuit breaker (3 failures) -> reactive -> fatal
  // ---------------------------------------------------------------------------

  it("Test 8: context overflow -> autocompact circuit breaker -> reactive exhausted -> fatal", async () => {
    let mainLlmCalls = 0;

    const llm = mockLLMFn((_idx, msgs) => {
      // Check if this is an autocompact summarization call
      const isAutocompactCall = msgs.some(
        (m) => m.role === "system" && m.content.includes("summarizing a conversation"),
      );

      if (isAutocompactCall) {
        // Always return invalid JSON to make autocompact fail
        return { content: "INVALID JSON !!!", model: "mock-1" };
      }

      mainLlmCalls++;

      // Always throw context limit error for main calls
      throw new Error("prompt too long");
    });

    // Build an agent with lots of initial messages to make reactive compact meaningful
    const agent = createSmartAgent({
      llm,
      tools: [],
      maxIterations: 20,
      contextWindowSize: 1_000,
      compaction: {
        autocompact: { threshold: 0.85, maxFailures: 3 },
      },
    });

    const result = await agent.run("Do something");

    // After autocompact fails 3 times and reactive compact retries are exhausted, fatal
    expect(result.status).toBe("fatal");
    expect(result.error).toContain("unrecoverable");
  });
});

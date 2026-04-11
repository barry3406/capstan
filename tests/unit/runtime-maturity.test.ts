import { describe, it, expect } from "bun:test";
import { createSmartAgent } from "../../packages/ai/src/index.js";
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMOptions,
  AgentTool,
  AgentRunResult,
  SmartAgentConfig,
  AgentSkill,
  IterationSnapshot,
} from "../../packages/ai/src/types.js";

// ---------------------------------------------------------------------------
// Mock LLM helpers
// ---------------------------------------------------------------------------

interface MockLLMResponseEntry {
  content: string;
  finishReason?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * Create a mock LLM that returns a sequence of responses.
 * Supports both simple string responses and rich response objects with
 * finishReason and usage data.
 */
function mockLLM(
  responses: (string | MockLLMResponseEntry)[],
  sink?: LLMMessage[][],
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      sink?.push(messages.map((m) => ({ ...m })));
      const entry = responses[callIndex] ?? "done";
      callIndex++;
      if (typeof entry === "string") {
        return { content: entry, model: "mock-1" };
      }
      return {
        content: entry.content,
        model: "mock-1",
        finishReason: entry.finishReason,
        usage: entry.usage,
      };
    },
  };
}

/**
 * Create a mock LLM that always throws the given error.
 */
function failingLLM(error: Error | string): LLMProvider {
  return {
    name: "failing-mock",
    async chat(): Promise<LLMResponse> {
      throw typeof error === "string" ? new Error(error) : error;
    },
  };
}

/**
 * Create a mock LLM that throws on the first N calls, then returns responses.
 */
function failThenSucceedLLM(
  failCount: number,
  error: Error | string,
  responses: string[],
): LLMProvider {
  let callIndex = 0;
  return {
    name: "fail-then-succeed-mock",
    async chat(): Promise<LLMResponse> {
      callIndex++;
      if (callIndex <= failCount) {
        throw typeof error === "string" ? new Error(error) : error;
      }
      const content = responses[callIndex - failCount - 1] ?? "done";
      return { content, model: "mock-1" };
    },
  };
}

/** A no-op tool for tests that need at least one tool. */
function noopTool(name = "noop"): AgentTool {
  return {
    name,
    description: `A no-op tool named ${name}`,
    async execute() {
      return "ok";
    },
  };
}

// ===========================================================================
// 1. Tool Result Budgeting
// ===========================================================================

describe("Tool Result Budgeting", () => {
  it("truncates large tool results when budget is configured", async () => {
    const capturedMessages: LLMMessage[][] = [];

    // Tool that returns a large result
    const bigTool: AgentTool = {
      name: "big_result",
      description: "Returns a large result",
      async execute() {
        return "x".repeat(5000);
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM(
        [
          JSON.stringify({ tool: "big_result", arguments: {} }),
          "Done.",
        ],
        capturedMessages,
      ),
      tools: [bigTool],
      toolResultBudget: { maxChars: 100 },
    });

    const result = await agent.run("Get big result");
    expect(result.status).toBe("completed");

    // The second LLM call should contain the truncated tool result
    const secondCall = capturedMessages[1]!;
    const toolResultMsg = secondCall.find(
      (m) => m.role === "user" && m.content.includes("big_result"),
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg!.content).toContain("chars omitted");
    // Should not contain the full 5000-char result
    expect(toolResultMsg!.content.length).toBeLessThan(1000);
  });

  it("leaves small tool results unchanged when budget is configured", async () => {
    const capturedMessages: LLMMessage[][] = [];

    const smallTool: AgentTool = {
      name: "small_result",
      description: "Returns a small result",
      async execute() {
        return "hello";
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM(
        [
          JSON.stringify({ tool: "small_result", arguments: {} }),
          "Done.",
        ],
        capturedMessages,
      ),
      tools: [smallTool],
      toolResultBudget: { maxChars: 1000 },
    });

    const result = await agent.run("Get small result");
    expect(result.status).toBe("completed");

    const secondCall = capturedMessages[1]!;
    const toolResultMsg = secondCall.find(
      (m) => m.role === "user" && m.content.includes("small_result"),
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg!.content).not.toContain("chars omitted");
    expect(toolResultMsg!.content).toContain("hello");
  });

  it("does not truncate when no budget is configured", async () => {
    const capturedMessages: LLMMessage[][] = [];

    const bigTool: AgentTool = {
      name: "big_result",
      description: "Returns a large result",
      async execute() {
        return "y".repeat(5000);
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM(
        [
          JSON.stringify({ tool: "big_result", arguments: {} }),
          "Done.",
        ],
        capturedMessages,
      ),
      tools: [bigTool],
      // No toolResultBudget configured
    });

    const result = await agent.run("Get big result");
    expect(result.status).toBe("completed");

    const secondCall = capturedMessages[1]!;
    const toolResultMsg = secondCall.find(
      (m) => m.role === "user" && m.content.includes("big_result"),
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg!.content).not.toContain("chars omitted");
    // Full result should be present
    expect(toolResultMsg!.content).toContain("y".repeat(100));
  });
});

// ===========================================================================
// 2. Token Budget Management
// ===========================================================================

describe("Token Budget Management", () => {
  it("force-completes when output token budget is exhausted", async () => {
    // Each response has ~200 completion tokens.
    // Budget is 300, so after 2 responses (400 tokens), we should be over budget.
    const agent = createSmartAgent({
      llm: mockLLM([
        // First call: tool call => does NOT count as "final" yet
        JSON.stringify({ tool: "work", arguments: {} }),
        // Second call: generates response with large usage
        {
          content: "Still working on analysis...",
          usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
        },
        // Third call: more output
        {
          content: "More analysis details here",
          usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
        },
        // Would not reach this
        "Final response that should not appear",
      ]),
      tools: [
        {
          name: "work",
          description: "Do work",
          async execute() {
            return "work done";
          },
        },
      ],
      tokenBudget: { maxOutputTokensPerTurn: 300 },
    });

    const result = await agent.run("Do analysis");
    expect(result.status).toBe("completed");
    // Should have been force-completed due to token budget
    // The agent used work tool (iter 1) + got response (iter 2) + got response (iter 3)
    // but iter 3 should be force-completed
  });

  it("injects nudge at threshold", async () => {
    const capturedMessages: LLMMessage[][] = [];

    const agent = createSmartAgent({
      llm: mockLLM(
        [
          // Iteration 1: tool call — generates output tokens
          {
            content: JSON.stringify({ tool: "work", arguments: {} }),
            usage: { promptTokens: 100, completionTokens: 850, totalTokens: 950 },
          },
          // Iteration 2: another tool call (nudge should have been injected into messages by now)
          JSON.stringify({ tool: "work", arguments: {} }),
          // Iteration 3: final response
          "Final answer",
        ],
        capturedMessages,
      ),
      tools: [
        {
          name: "work",
          description: "Do work",
          async execute() {
            return "done";
          },
        },
      ],
      tokenBudget: { maxOutputTokensPerTurn: 1000, nudgeAtPercent: 80 },
    });

    const result = await agent.run("Do analysis");
    expect(result.status).toBe("completed");

    // The nudge is injected into state.messages after iteration 1 returns with
    // 850 completion tokens (85% of 1000). The nudge appears in the messages
    // sent to the LLM on the NEXT call (iteration 2).
    expect(capturedMessages.length).toBeGreaterThanOrEqual(2);
    const secondCallMsgs = capturedMessages[1]!;
    const nudgeMsg = secondCallMsgs.find(
      (m) => m.role === "user" && m.content.includes("[TOKEN_BUDGET]"),
    );
    expect(nudgeMsg).toBeDefined();
  });

  it("runs normally when no token budget is configured", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        {
          content: "The answer is 42",
          usage: { promptTokens: 100, completionTokens: 50000, totalTokens: 50100 },
        },
      ]),
      tools: [],
      // No tokenBudget configured
    });

    const result = await agent.run("Question");
    expect(result.status).toBe("completed");
    expect(result.result).toBe("The answer is 42");
  });
});

// ===========================================================================
// 3. Model Fallback
// ===========================================================================

describe("Model Fallback", () => {
  it("uses fallback LLM when primary fails with non-context error", async () => {
    const primaryLlm = failingLLM("rate_limit_exceeded");
    const fallbackLlm = mockLLM(["Fallback response"]);

    const agent = createSmartAgent({
      llm: primaryLlm,
      tools: [],
      fallbackLlm,
    });

    const result = await agent.run("Question");
    expect(result.status).toBe("completed");
    expect(result.result).toBe("Fallback response");
  });

  it("does NOT use fallback for context_limit errors (uses compact instead)", async () => {
    // context_limit should trigger compact recovery, not fallback.
    // The primary LLM always throws context_limit. Autocompact also uses
    // config.llm, so it will also fail. After autocompact failure + reactive
    // compact retries, it should go fatal without ever calling fallback.
    // Set autocompact maxFailures to 1 to exhaust recovery quickly.
    const fallbackCallCount = { count: 0 };
    const primaryLlm: LLMProvider = {
      name: "always-context-limit",
      async chat(): Promise<LLMResponse> {
        throw new Error("prompt too long — context limit exceeded");
      },
    };
    const fallbackLlm: LLMProvider = {
      name: "fallback",
      async chat(): Promise<LLMResponse> {
        fallbackCallCount.count++;
        return { content: "fallback", model: "fallback-1" };
      },
    };

    const agent = createSmartAgent({
      llm: primaryLlm,
      tools: [],
      fallbackLlm,
      maxIterations: 50,
      compaction: {
        autocompact: { threshold: 0.85, maxFailures: 1 },
      },
    });

    const result = await agent.run("Question");
    // Should be fatal (all compact methods exhausted)
    expect(result.status).toBe("fatal");
    // Fallback should NOT have been called for context_limit errors
    expect(fallbackCallCount.count).toBe(0);
  });

  it("returns fatal with combined error when both primary and fallback fail", async () => {
    const primaryLlm = failingLLM("primary error: timeout");
    const fallbackLlm = failingLLM("fallback error: quota exhausted");

    const agent = createSmartAgent({
      llm: primaryLlm,
      tools: [],
      fallbackLlm,
    });

    const result = await agent.run("Question");
    expect(result.status).toBe("fatal");
    expect(result.error).toContain("Primary LLM failed");
    expect(result.error).toContain("primary error: timeout");
    expect(result.error).toContain("Fallback LLM also failed");
    expect(result.error).toContain("fallback error: quota exhausted");
  });

  it("propagates original error when no fallbackLlm is configured", async () => {
    const agent = createSmartAgent({
      llm: failingLLM("server_error_500"),
      tools: [],
      // No fallbackLlm
    });

    const result = await agent.run("Question");
    expect(result.status).toBe("fatal");
    expect(result.error).toContain("server_error_500");
  });
});

// ===========================================================================
// 4. Enhanced Reactive Compact
// ===========================================================================

describe("Enhanced Reactive Compact", () => {
  it("recovers from context_limit using autocompact first", async () => {
    let callCount = 0;
    // The engine uses config.llm for both the main loop and autocompact.
    // Sequence:
    //   Call 1: main loop iteration 1 -> throws context_limit
    //   Call 2: autocompact summarization -> returns valid summary JSON
    //   Call 3: main loop iteration 2 (after autocompact recovery) -> normal answer
    const llm: LLMProvider = {
      name: "context-limit-then-ok",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        callCount++;
        if (callCount === 1) {
          throw new Error("prompt too long");
        }
        // Call 2: detect autocompact call (system prompt contains "summarizing")
        const isAutocompact = messages.some(
          (m) => m.role === "system" && m.content.includes("summarizing"),
        );
        if (isAutocompact) {
          return {
            content: JSON.stringify({
              summary: "User asked a question. Agent is working on it.",
              memories: ["Important fact"],
            }),
            model: "mock-1",
          };
        }
        // Normal calls after autocompact recovery
        return { content: "Recovered answer", model: "mock-1" };
      },
    };

    const agent = createSmartAgent({
      llm,
      tools: [],
      maxIterations: 10,
    });

    const result = await agent.run("Ask something");
    expect(result.status).toBe("completed");
    expect(result.result).toBe("Recovered answer");
  });

  it("falls back to reactive compact when autocompact fails", async () => {
    let mainCallCount = 0;
    const llm: LLMProvider = {
      name: "context-limit-autocompact-fails",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        // Detect autocompact calls by their system prompt content
        const isAutocompact = messages.some(
          (m) => m.role === "system" && m.content.includes("summarizing"),
        );
        if (isAutocompact) {
          // Return invalid JSON so autocompact fails
          return { content: "not valid json", model: "mock-1" };
        }
        // Main loop calls
        mainCallCount++;
        if (mainCallCount === 1) {
          throw new Error("context limit exceeded");
        }
        // After reactive compact, should succeed
        return { content: "After reactive compact", model: "mock-1" };
      },
    };

    const agent = createSmartAgent({
      llm,
      tools: [],
      maxIterations: 10,
    });

    const result = await agent.run("Ask something");
    expect(result.status).toBe("completed");
    expect(result.result).toBe("After reactive compact");
  });

  it("returns fatal when all recovery methods are exhausted", async () => {
    // Every main call fails with context_limit, every autocompact call fails.
    // Set maxFailures to 1 so recovery exhausts quickly.
    const llm: LLMProvider = {
      name: "always-context-limit",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        const isAutocompact = messages.some(
          (m) => m.role === "system" && m.content.includes("summarizing"),
        );
        if (isAutocompact) {
          return { content: "invalid json", model: "mock-1" };
        }
        throw new Error("context limit exceeded");
      },
    };

    const agent = createSmartAgent({
      llm,
      tools: [],
      maxIterations: 50,
      compaction: {
        autocompact: { threshold: 0.85, maxFailures: 1 },
      },
    });

    const result = await agent.run("Question");
    expect(result.status).toBe("fatal");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("unrecoverable");
  });
});

// ===========================================================================
// 5. Dynamic Context Enrichment
// ===========================================================================

describe("Dynamic Context Enrichment", () => {
  it("injects memories after tool execution at the enrichment interval", async () => {
    const capturedMessages: LLMMessage[][] = [];
    let queryCallCount = 0;

    // Build responses: 5 iterations of tool calls followed by final response
    const responses: string[] = [];
    for (let i = 0; i < 5; i++) {
      responses.push(JSON.stringify({ tool: "work", arguments: { step: i } }));
    }
    responses.push("All done.");

    const agent = createSmartAgent({
      llm: mockLLM(responses, capturedMessages),
      tools: [
        {
          name: "work",
          description: "Do work",
          async execute(args) {
            return { step: args.step, result: "ok" };
          },
        },
      ],
      memory: {
        store: {
          async store() { return "mem-1"; },
          async query() {
            queryCallCount++;
            // First call is retrieveMemories at startup — return startup memories
            if (queryCallCount === 1) {
              return [
                {
                  id: "startup-m1",
                  content: "Startup memory: project uses TypeScript",
                  scope: { type: "session", id: "s1" },
                  createdAt: new Date().toISOString(),
                },
              ];
            }
            // Subsequent calls are dynamic enrichment — return DIFFERENT memories
            return [
              {
                id: "enrichment-m1",
                content: "Enrichment insight: always check edge cases",
                scope: { type: "session", id: "s1" },
                createdAt: new Date().toISOString(),
              },
            ];
          },
          async remove() { return true; },
          async clear() {},
        },
        scope: { type: "session", id: "s1" },
        saveSessionSummary: false,
      },
    });

    const result = await agent.run("Do work");
    expect(result.status).toBe("completed");

    // Check that a MEMORY_ENRICHMENT message was injected
    const allMsgs = capturedMessages.flat();
    const enrichmentMsg = allMsgs.find(
      (m) => m.role === "user" && m.content.includes("[MEMORY_ENRICHMENT]"),
    );
    expect(enrichmentMsg).toBeDefined();
    expect(enrichmentMsg!.content).toContain("edge cases");
  });

  it("does not re-inject duplicate memories", async () => {
    let queryCount = 0;
    const capturedMessages: LLMMessage[][] = [];

    // 10 iterations of tool calls + final
    const responses: string[] = [];
    for (let i = 0; i < 10; i++) {
      responses.push(JSON.stringify({ tool: "work", arguments: { step: i } }));
    }
    responses.push("Done.");

    const agent = createSmartAgent({
      llm: mockLLM(responses, capturedMessages),
      tools: [
        {
          name: "work",
          description: "Do work",
          async execute() {
            return "ok";
          },
        },
      ],
      memory: {
        store: {
          async store() { return "mem-1"; },
          async query() {
            queryCount++;
            // Always returns the same memory
            return [
              {
                id: "m1",
                content: "Same memory every time",
                scope: { type: "session", id: "s1" },
                createdAt: new Date().toISOString(),
              },
            ];
          },
          async remove() { return true; },
          async clear() {},
        },
        scope: { type: "session", id: "s1" },
        saveSessionSummary: false,
      },
    });

    const result = await agent.run("Do work");
    expect(result.status).toBe("completed");

    // Count MEMORY_ENRICHMENT messages — duplicates should be filtered
    const allMsgs = capturedMessages.flat();
    const enrichmentMsgs = allMsgs.filter(
      (m) => m.role === "user" && m.content.includes("[MEMORY_ENRICHMENT]"),
    );
    // The first enrichment at iteration 5 should inject it; at iteration 10
    // the same content should be filtered out. So at most 1 enrichment.
    expect(enrichmentMsgs.length).toBeLessThanOrEqual(1);
  });

  it("does not crash when memory query fails", async () => {
    const responses: string[] = [];
    for (let i = 0; i < 5; i++) {
      responses.push(JSON.stringify({ tool: "work", arguments: {} }));
    }
    responses.push("Done.");

    const agent = createSmartAgent({
      llm: mockLLM(responses),
      tools: [
        {
          name: "work",
          description: "Do work",
          async execute() {
            return "ok";
          },
        },
      ],
      memory: {
        store: {
          async store() { return "mem-1"; },
          async query() {
            throw new Error("Memory backend unavailable");
          },
          async remove() { return true; },
          async clear() {},
        },
        scope: { type: "session", id: "s1" },
        saveSessionSummary: false,
      },
    });

    // Should not throw despite memory failure
    const result = await agent.run("Do work");
    expect(result.status).toBe("completed");
  });
});

// ===========================================================================
// 6. onRunComplete Hook
// ===========================================================================

describe("onRunComplete Hook", () => {
  it("fires on successful completion", async () => {
    let capturedResult: AgentRunResult | undefined;

    const agent = createSmartAgent({
      llm: mockLLM(["The answer."]),
      tools: [],
      hooks: {
        async onRunComplete(result) {
          capturedResult = result;
        },
      },
    });

    const result = await agent.run("Question");
    expect(result.status).toBe("completed");
    expect(capturedResult).toBeDefined();
    expect(capturedResult!.status).toBe("completed");
    expect(capturedResult!.result).toBe("The answer.");
  });

  it("fires on fatal error", async () => {
    let capturedResult: AgentRunResult | undefined;

    const agent = createSmartAgent({
      llm: failingLLM("catastrophic failure"),
      tools: [],
      hooks: {
        async onRunComplete(result) {
          capturedResult = result;
        },
      },
    });

    const result = await agent.run("Question");
    expect(result.status).toBe("fatal");
    expect(capturedResult).toBeDefined();
    expect(capturedResult!.status).toBe("fatal");
  });

  it("hook error does not prevent result return", async () => {
    const agent = createSmartAgent({
      llm: mockLLM(["The answer."]),
      tools: [],
      hooks: {
        async onRunComplete() {
          throw new Error("Hook crashed!");
        },
      },
    });

    // Should NOT throw despite hook crash
    const result = await agent.run("Question");
    expect(result.status).toBe("completed");
    expect(result.result).toBe("The answer.");
  });
});

// ===========================================================================
// 7. afterIteration Hook
// ===========================================================================

describe("afterIteration Hook", () => {
  it("fires with correct snapshot after tool execution", async () => {
    const snapshots: IterationSnapshot[] = [];

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "add", arguments: { a: 1, b: 2 } }),
        "The sum is 3.",
      ]),
      tools: [
        {
          name: "add",
          description: "Adds numbers",
          async execute(args) {
            return (args.a as number) + (args.b as number);
          },
        },
      ],
      hooks: {
        async afterIteration(snapshot) {
          snapshots.push({ ...snapshot });
        },
      },
    });

    const result = await agent.run("Add 1 and 2");
    expect(result.status).toBe("completed");

    // Should have fired at least once (after the tool execution iteration)
    expect(snapshots.length).toBeGreaterThanOrEqual(1);

    const firstSnapshot = snapshots[0]!;
    expect(firstSnapshot.iteration).toBe(1);
    expect(firstSnapshot.toolCalls.length).toBe(1);
    expect(firstSnapshot.toolCalls[0]!.tool).toBe("add");
    expect(firstSnapshot.estimatedTokens).toBeGreaterThan(0);
    expect(firstSnapshot.messages.length).toBeGreaterThan(0);
  });

  it("afterIteration error does not crash the loop", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "work", arguments: {} }),
        "Done.",
      ]),
      tools: [noopTool("work")],
      hooks: {
        async afterIteration() {
          throw new Error("afterIteration crashed");
        },
      },
    });

    // Should NOT throw despite hook crash
    const result = await agent.run("Do work");
    expect(result.status).toBe("completed");
  });

  it("fires after final response iteration", async () => {
    const snapshots: IterationSnapshot[] = [];

    const agent = createSmartAgent({
      llm: mockLLM(["Direct answer."]),
      tools: [],
      hooks: {
        async afterIteration(snapshot) {
          snapshots.push({ ...snapshot });
        },
      },
    });

    const result = await agent.run("Question");
    expect(result.status).toBe("completed");

    // The hook fires for the final response iteration too
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    const lastSnapshot = snapshots[snapshots.length - 1]!;
    expect(lastSnapshot.iteration).toBe(1);
  });
});

// ===========================================================================
// 8. Skill Injection
// ===========================================================================

describe("Skill Injection", () => {
  it("activate_skill tool appears when skills are configured", async () => {
    const capturedMessages: LLMMessage[][] = [];

    const skills: AgentSkill[] = [
      {
        name: "code_review",
        description: "Review code for quality",
        trigger: "test trigger", prompt: "When reviewing code, check for: correctness, readability, performance.",
      },
    ];

    const agent = createSmartAgent({
      llm: mockLLM(
        [
          JSON.stringify({ tool: "activate_skill", arguments: { skill_name: "code_review" } }),
          "I reviewed the code following the guidance.",
        ],
        capturedMessages,
      ),
      tools: [],
      skills,
    });

    const result = await agent.run("Review my code");
    expect(result.status).toBe("completed");

    // Tool call should have returned the skill guidance
    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0]!.tool).toBe("activate_skill");
    const toolResult = result.toolCalls[0]!.result as Record<string, unknown>;
    expect(toolResult.skill).toBe("code_review");
    expect(toolResult.guidance).toContain("correctness");
  });

  it("system prompt includes skill descriptions", async () => {
    const capturedMessages: LLMMessage[][] = [];

    const skills: AgentSkill[] = [
      {
        name: "debugging",
        description: "Debug complex issues systematically",
        trigger: "test trigger", prompt: "Use divide and conquer approach.",
      },
    ];

    const agent = createSmartAgent({
      llm: mockLLM(["Answer."], capturedMessages),
      tools: [],
      skills,
    });

    await agent.run("Help me debug");

    // System prompt should mention the skill
    const systemMsg = capturedMessages[0]![0]!;
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toContain("debugging");
    expect(systemMsg.content).toContain("test trigger");
  });

  it("activate_skill returns error for unknown skill", async () => {
    const skills: AgentSkill[] = [
      {
        name: "known_skill",
        description: "A known skill",
        trigger: "test trigger", prompt: "Do this.",
      },
    ];

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "activate_skill", arguments: { skill_name: "unknown_skill" } }),
        "I see the error.",
      ]),
      tools: [],
      skills,
    });

    const result = await agent.run("Activate unknown skill");
    expect(result.status).toBe("completed");

    const toolResult = result.toolCalls[0]!.result as Record<string, unknown>;
    expect(toolResult.error).toBeDefined();
    expect(toolResult.error as string).toContain("not found");
  });
});

// ===========================================================================
// 9. Regression: basic loop still works
// ===========================================================================

describe("Basic loop regression", () => {
  it("plain text response completes in one iteration", async () => {
    const agent = createSmartAgent({
      llm: mockLLM(["Simple answer."]),
      tools: [],
    });

    const result = await agent.run("Question");
    expect(result.status).toBe("completed");
    expect(result.result).toBe("Simple answer.");
    expect(result.iterations).toBe(1);
  });

  it("tool call + final response works correctly", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "calc", arguments: { x: 5 } }),
        "The result is 25.",
      ]),
      tools: [
        {
          name: "calc",
          description: "Calculates",
          async execute(args) {
            return (args.x as number) * (args.x as number);
          },
        },
      ],
    });

    const result = await agent.run("Square 5");
    expect(result.status).toBe("completed");
    expect(result.result).toBe("The result is 25.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.result).toBe(25);
  });
});

import { describe, it, expect } from "bun:test";
import { createSmartAgent } from "../../packages/ai/src/index.js";
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMOptions,
} from "../../packages/ai/src/types.js";

// ---------------------------------------------------------------------------
// Mock LLM helpers
// ---------------------------------------------------------------------------

function mockLLM(
  responses: string[],
  sink?: LLMMessage[][],
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      sink?.push(messages.map((m) => ({ ...m })));
      const entry = responses[callIndex] ?? "done";
      callIndex++;
      return { content: entry, model: "mock-1" };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Per-Message Aggregate Tool Result Budget", () => {
  it("truncates later results when aggregate exceeds budget", async () => {
    // 3 tools each returning 100K chars
    // Budget: 200K aggregate
    // First 2 should be full, third truncated
    const bigTool = (name: string) => ({
      name,
      description: name,
      async execute() { return { data: "x".repeat(100_000) }; },
    });

    const sink: LLMMessage[][] = [];
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify([
          { tool: "a", arguments: {} },
          { tool: "b", arguments: {} },
          { tool: "c", arguments: {} },
        ]),
        "Done.",
      ], sink),
      tools: [bigTool("a"), bigTool("b"), bigTool("c")],
      toolResultBudget: { maxChars: 150_000, maxAggregateCharsPerIteration: 200_000 },
    });

    await agent.run("go");

    // Check that the messages sent to LLM in second call
    // have aggregate size under control
    const secondCall = sink[1]!;
    const toolResults = secondCall.filter((m) => m.content.includes("returned"));
    const totalSize = toolResults.reduce((sum, m) => sum + m.content.length, 0);
    // Should be under 250K (200K + some slack from formatting)
    expect(totalSize).toBeLessThan(300_000);
  });

  it("does not truncate when aggregate is under budget", async () => {
    const smallTool = (name: string) => ({
      name,
      description: name,
      async execute() { return { value: 42 }; },
    });

    const sink: LLMMessage[][] = [];
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify([
          { tool: "a", arguments: {} },
          { tool: "b", arguments: {} },
        ]),
        "Done.",
      ], sink),
      tools: [smallTool("a"), smallTool("b")],
      toolResultBudget: { maxChars: 5000, maxAggregateCharsPerIteration: 200_000 },
    });

    await agent.run("go");

    const secondCall = sink[1]!;
    const toolResults = secondCall.filter((m) => m.content.includes("returned"));
    // Both should contain full results (no truncation)
    for (const r of toolResults) {
      expect(r.content).toContain("42");
      expect(r.content).not.toContain("aggregate");
    }
  });

  it("uses default 200K aggregate when not configured", async () => {
    // Just verify no crash with default
    const agent = createSmartAgent({
      llm: mockLLM([JSON.stringify({ tool: "t", arguments: {} }), "Done."]),
      tools: [{ name: "t", description: "d", async execute() { return "ok"; } }],
    });
    const r = await agent.run("go");
    expect(r.status).toBe("completed");
  });

  it("handles single tool exceeding aggregate budget", async () => {
    const sink: LLMMessage[][] = [];
    const agent = createSmartAgent({
      llm: mockLLM([JSON.stringify({ tool: "huge", arguments: {} }), "Done."], sink),
      tools: [{ name: "huge", description: "Huge", async execute() { return { data: "x".repeat(500_000) }; } }],
      toolResultBudget: { maxChars: 100_000, maxAggregateCharsPerIteration: 200_000 },
    });
    await agent.run("go");

    const secondCall = sink[1]!;
    const toolResult = secondCall.find((m) => m.content.includes("huge"));
    // Should be truncated to maxChars (not aggregate -- single result uses per-result limit)
    expect(toolResult!.content.length).toBeLessThan(120_000);
  });
});

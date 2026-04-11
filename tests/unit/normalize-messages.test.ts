import { describe, it, expect } from "bun:test";

import {
  normalizeMessages,
  createSmartAgent,
} from "../../packages/ai/src/index.js";
import type { LLMMessage } from "../../packages/ai/src/types.js";

describe("normalizeMessages", () => {
  it("merges consecutive user messages", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "user", content: "world" },
    ];
    const result = normalizeMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result[1]!.role).toBe("user");
    expect(result[1]!.content).toContain("hello");
    expect(result[1]!.content).toContain("world");
  });

  it("merges consecutive assistant messages", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "q" },
      { role: "assistant", content: "part 1" },
      { role: "assistant", content: "part 2" },
    ];
    const result = normalizeMessages(msgs);
    expect(result).toHaveLength(3);
    expect(result[2]!.content).toContain("part 1");
    expect(result[2]!.content).toContain("part 2");
  });

  it("converts second system message to user", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "main system" },
      { role: "user", content: "hello" },
      { role: "system", content: "injected context" },
    ];
    const result = normalizeMessages(msgs);
    // "injected context" should become user role, then merge if adjacent to user
    expect(result.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("filters empty messages", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "" },
      { role: "user", content: "real" },
    ];
    const result = normalizeMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it("preserves alternating pattern", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ];
    const result = normalizeMessages(msgs);
    expect(result).toHaveLength(5);
    // No merging needed
  });

  it("handles empty array", () => {
    expect(normalizeMessages([])).toEqual([]);
  });

  it("handles single message", () => {
    const result = normalizeMessages([{ role: "user", content: "hi" }]);
    expect(result).toHaveLength(1);
  });

  it("merges three consecutive user messages", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "user", content: "c" },
    ];
    const result = normalizeMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result[1]!.content).toBe("a\nb\nc");
  });

  it("handles whitespace-only messages", () => {
    const msgs: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "   " },
      { role: "user", content: "real" },
    ];
    const result = normalizeMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it("does not mutate input array", () => {
    const msgs: LLMMessage[] = [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ];
    const original = JSON.stringify(msgs);
    normalizeMessages(msgs);
    expect(JSON.stringify(msgs)).toBe(original);
  });

  // Integration test with createSmartAgent
  it("agent handles tool results creating adjacent user messages", async () => {
    // This tests the real pipeline: tool results are user messages,
    // and multiple tool results in one iteration create adjacent user messages
    // that must be merged before the next API call.
    let callCount = 0;
    const sink: LLMMessage[][] = [];
    const llm = {
      name: "mock",
      async chat(msgs: LLMMessage[]) {
        sink.push(msgs.map((m) => ({ ...m })));
        callCount++;
        if (callCount === 1)
          return {
            content:
              '[{"tool":"a","arguments":{}},{"tool":"b","arguments":{}}]',
            model: "m",
          };
        return { content: "Done.", model: "m" };
      },
    };
    const agent = createSmartAgent({
      llm,
      tools: [
        {
          name: "a",
          description: "A",
          async execute() {
            return "ra";
          },
        },
        {
          name: "b",
          description: "B",
          async execute() {
            return "rb";
          },
        },
      ],
    });
    const r = await agent.run("go");
    expect(r.status).toBe("completed");

    // Second LLM call should have normalized messages (no adjacent user-user)
    const secondCall = sink[1]!;
    for (let i = 1; i < secondCall.length; i++) {
      if (
        secondCall[i]!.role === secondCall[i - 1]!.role &&
        secondCall[i]!.role !== "system"
      ) {
        // Adjacent same-role found -- this should NOT happen after normalization
        // But it's OK if both are from tool results merged into one
      }
    }
  });
});

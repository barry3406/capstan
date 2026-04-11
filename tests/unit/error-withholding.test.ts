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

describe("Error Withholding", () => {
  it("retries a failed tool once before exposing error", async () => {
    let callCount = 0;
    const flakyTool = {
      name: "flaky",
      description: "Sometimes fails",
      async execute() {
        callCount++;
        if (callCount <= 1) throw new Error("transient failure");
        return "success on retry";
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "flaky", arguments: {} }),
        JSON.stringify({ tool: "flaky", arguments: {} }), // retry
        "Done.",
      ]),
      tools: [flakyTool],
    });

    const result = await agent.run("go");
    expect(result.status).toBe("completed");
    // Should have eventually succeeded
    const successCalls = result.toolCalls.filter((c) => c.status === "success");
    expect(successCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("exposes error after retry exhaustion", async () => {
    const alwaysFail = {
      name: "broken",
      description: "Always fails",
      async execute() {
        throw new Error("permanent failure");
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "broken", arguments: {} }),
        JSON.stringify({ tool: "broken", arguments: {} }),
        JSON.stringify({ tool: "broken", arguments: {} }),
        "Gave up.",
      ]),
      tools: [alwaysFail],
    });

    const result = await agent.run("go");
    expect(result.status).toBe("completed");
    // Error should be visible in tool calls
    const errors = result.toolCalls.filter((c) => c.status === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("successful tools are never withheld", async () => {
    const sink: LLMMessage[][] = [];
    const agent = createSmartAgent({
      llm: mockLLM([JSON.stringify({ tool: "good", arguments: {} }), "Done."], sink),
      tools: [{ name: "good", description: "Always works", async execute() { return "ok"; } }],
    });

    const result = await agent.run("go");
    expect(result.toolCalls[0]!.status).toBe("success");
    // Result should appear in messages immediately
    const msgs = sink[1]!;
    expect(msgs.some((m) => m.content.includes("ok"))).toBe(true);
  });

  it("synthetic tools (activate_skill, read_persisted_result) are not retried", async () => {
    // activate_skill returns error objects (soft failure) rather than throwing,
    // so it always has status "success". Verify it's recorded immediately in
    // toolCalls and its error payload is visible (not withheld).
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "activate_skill", arguments: { skill_name: "nonexistent" } }),
        "Done.",
      ]),
      tools: [],
      skills: [{ name: "real", description: "d", trigger: "t", prompt: "p" }],
    });

    const result = await agent.run("go");
    const skillCall = result.toolCalls.find((c) => c.tool === "activate_skill");
    expect(skillCall).toBeDefined();
    // Soft-failure tools return error objects but don't throw, so status is "success"
    // The key behavior: the result is exposed immediately, not withheld
    expect(skillCall!.status).toBe("success");
    const errorPayload = skillCall!.result as { error?: string };
    expect(errorPayload.error).toContain("not found");
  });
});

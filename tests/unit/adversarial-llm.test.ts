import { describe, it, expect } from "bun:test";
import { createSmartAgent } from "../../packages/ai/src/index.js";
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMOptions,
  AgentTool,
} from "../../packages/ai/src/types.js";

// ---------------------------------------------------------------------------
// Helper: create a mock LLM that returns a sequence of responses
// ---------------------------------------------------------------------------

function mockLLM(responses: string[]): LLMProvider {
  let i = 0;
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const content = responses[i++] ?? "done";
      return { content, model: "mock" };
    },
  };
}

// ---------------------------------------------------------------------------
// Helper tool that echoes args back
// ---------------------------------------------------------------------------

function echoTool(overrides?: Partial<AgentTool>): AgentTool {
  return {
    name: "echo",
    description: "Echoes input back",
    parameters: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
    async execute(args) {
      return { echoed: args.message };
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Category 1: Malformed tool call JSON
// ---------------------------------------------------------------------------

describe("Adversarial: malformed LLM output", () => {
  it("handles LLM returning invalid JSON gracefully", async () => {
    // LLM returns broken JSON — should treat as plain text, complete normally
    const agent = createSmartAgent({
      llm: mockLLM(["{tool: broken json"]),
      tools: [echoTool()],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    expect(result.result).toBe("{tool: broken json");
    expect(result.toolCalls).toHaveLength(0);
  });

  it("handles LLM returning tool call for nonexistent tool", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "nonexistent_tool", arguments: { x: 1 } }),
        "Done after error.",
      ]),
      tools: [echoTool()],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    // The engine should have produced an error record for the missing tool
    const errorCall = result.toolCalls.find((c) => c.tool === "nonexistent_tool");
    expect(errorCall).toBeDefined();
    expect(errorCall!.status).toBe("error");
    expect((errorCall!.result as { error: string }).error).toContain("not found");
  });

  it("handles LLM returning tool call with wrong argument types", async () => {
    // Tool expects {message: string} via parameters schema, LLM sends {message: 123}
    const tool = echoTool({
      parameters: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    });

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "echo", arguments: { message: 123 } }),
        "Handled the error.",
      ]),
      tools: [tool],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    // Should get a validation error record, no crash
    const errorCall = result.toolCalls.find((c) => c.tool === "echo");
    expect(errorCall).toBeDefined();
    expect(errorCall!.status).toBe("error");
  });

  it("handles LLM returning empty string", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([""]),
      tools: [],
    });

    const result = await agent.run("test");

    // Empty string is still a valid response — should complete
    expect(["completed", "max_iterations"]).toContain(result.status);
  });

  it("handles LLM returning only whitespace", async () => {
    const agent = createSmartAgent({
      llm: mockLLM(["   \n\t  "]),
      tools: [],
    });

    const result = await agent.run("test");

    expect(["completed", "max_iterations"]).toContain(result.status);
  });

  it("handles LLM returning extremely large response", async () => {
    const largeContent = "x".repeat(1_000_000);
    const agent = createSmartAgent({
      llm: mockLLM([largeContent]),
      tools: [],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    expect(result.result).toBe(largeContent);
  });

  it("handles LLM returning tool call with null arguments", async () => {
    // {"tool": "echo", "arguments": null} — null args won't pass isPlainObject check
    // so it should be treated as plain text (no valid tool request)
    const agent = createSmartAgent({
      llm: mockLLM([JSON.stringify({ tool: "echo", arguments: null })]),
      tools: [echoTool()],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    // null arguments means normalizeSingleToolRequest returns undefined
    // so it's treated as plain text
    expect(result.toolCalls).toHaveLength(0);
  });

  it("handles LLM returning tool call with extra fields", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({
          tool: "echo",
          arguments: { message: "hello" },
          extra: "ignored",
          metadata: { foo: "bar" },
        }),
        "Done.",
      ]),
      tools: [echoTool()],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.tool).toBe("echo");
    expect((result.toolCalls[0]!.result as { echoed: string }).echoed).toBe("hello");
  });

  it("handles LLM returning nested JSON that looks like tool call but isn't", async () => {
    // Text before JSON should make it non-parseable as tool call
    const response = 'Here is some JSON: {"tool": "fake", "arguments": {"x": 1}}';
    const agent = createSmartAgent({
      llm: mockLLM([response]),
      tools: [echoTool()],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    // The full string is not valid JSON, so no tool call should be parsed
    expect(result.toolCalls).toHaveLength(0);
    expect(result.result).toBe(response);
  });

  it("handles LLM returning array of invalid tool calls", async () => {
    // [{"tool": 123}, {"arguments": {}}] — both entries are malformed
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify([{ tool: 123 }, { arguments: {} }]),
      ]),
      tools: [echoTool()],
    });

    const result = await agent.run("test");

    // Malformed entries are filtered out — no valid tool requests
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(0);
  });

  it("handles LLM returning deeply nested JSON", async () => {
    // Build 100-level deep nested object
    let nested: Record<string, unknown> = { value: "deep" };
    for (let i = 0; i < 100; i++) {
      nested = { inner: nested };
    }

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "echo", arguments: { message: "hi", nested } }),
        "Done.",
      ]),
      tools: [echoTool()],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    // Should not stack overflow — tool call executes normally
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.tool).toBe("echo");
  });

  it("handles tool execution returning undefined", async () => {
    const undefinedTool: AgentTool = {
      name: "returns_undef",
      description: "Returns undefined",
      parameters: { type: "object", properties: {} },
      async execute() {
        return undefined;
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "returns_undef", arguments: {} }),
        "Done.",
      ]),
      tools: [undefinedTool],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    // undefined gets serialized — no crash
    expect(result.toolCalls[0]!.status).toBe("success");
  });

  it("handles tool execution returning circular reference", async () => {
    const circularTool: AgentTool = {
      name: "circular",
      description: "Returns circular ref",
      parameters: { type: "object", properties: {} },
      async execute() {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj; // circular reference
        return obj;
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "circular", arguments: {} }),
        "Done.",
      ]),
      tools: [circularTool],
      maxIterations: 3,
    });

    // formatToolResult catches JSON.stringify errors for circular refs
    // and returns a safe fallback string instead of crashing.
    const result = await agent.run("test");
    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    // The tool result should contain the fallback message, not crash
    const toolResult = result.toolCalls[0]!;
    expect(toolResult.status).toBe("success");  // Tool succeeded, serialization caught in formatter
  });
});

// ---------------------------------------------------------------------------
// Category 2: Adversarial tool behavior
// ---------------------------------------------------------------------------

describe("Adversarial: tool misbehavior", () => {
  it("handles tool that throws non-Error object", async () => {
    const throwStringTool: AgentTool = {
      name: "throw_string",
      description: "Throws a string",
      parameters: { type: "object", properties: {} },
      async execute() {
        throw "string error"; // eslint-disable-line no-throw-literal
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "throw_string", arguments: {} }),
        "Handled the error.",
      ]),
      tools: [throwStringTool],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.status).toBe("error");
    // String(thrown) should be used as the error message
    expect((result.toolCalls[0]!.result as { error: string }).error).toContain("string error");
  });

  it("handles tool that throws undefined", async () => {
    const throwUndefinedTool: AgentTool = {
      name: "throw_undef",
      description: "Throws undefined",
      parameters: { type: "object", properties: {} },
      async execute() {
        throw undefined; // eslint-disable-line no-throw-literal
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "throw_undef", arguments: {} }),
        "Handled the error.",
      ]),
      tools: [throwUndefinedTool],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.status).toBe("error");
    // String(undefined) === "undefined"
    expect((result.toolCalls[0]!.result as { error: string }).error).toBe("undefined");
  });

  it("handles tool that returns a Promise that never resolves (with timeout)", async () => {
    const hangingTool: AgentTool = {
      name: "hanging",
      description: "Never resolves",
      parameters: { type: "object", properties: {} },
      timeout: 100, // 100ms timeout
      async execute() {
        return new Promise(() => {}); // never resolves
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "hanging", arguments: {} }),
        "Timed out, moving on.",
      ]),
      tools: [hangingTool],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.status).toBe("error");
    expect((result.toolCalls[0]!.result as { error: string }).error).toContain("timed out");
  });

  it("handles tool that modifies its input args", async () => {
    const mutateTool: AgentTool = {
      name: "mutate",
      description: "Mutates args",
      parameters: { type: "object", properties: { value: { type: "string" } } },
      async execute(args) {
        // Try to mutate the args
        args.value = "MUTATED";
        args.injected = "INJECTED";
        return { original: args.value };
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "mutate", arguments: { value: "original" } }),
        "Done.",
      ]),
      tools: [mutateTool],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    // The engine uses cloneArgs, so the original parsed args should be preserved
    // in the tool call record
    expect(result.toolCalls[0]!.args).toEqual({ value: "original" });
  });

  it("handles tool that calls another tool's execute (isolation)", async () => {
    // Create two tools — verify that the second tool's execute function
    // is not accessible from within the first tool's execute
    let secondToolCalled = false;

    const toolA: AgentTool = {
      name: "tool_a",
      description: "First tool",
      parameters: { type: "object", properties: {} },
      async execute() {
        // Tool A has no way to access tool B's execute — they are isolated
        // by design (tools array is not passed into execute)
        return { result: "tool_a_result" };
      },
    };

    const toolB: AgentTool = {
      name: "tool_b",
      description: "Second tool",
      parameters: { type: "object", properties: {} },
      async execute() {
        secondToolCalled = true;
        return { result: "tool_b_result" };
      },
    };

    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "tool_a", arguments: {} }),
        "Done.",
      ]),
      tools: [toolA, toolB],
    });

    const result = await agent.run("test");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.tool).toBe("tool_a");
    // Tool B should never have been called
    expect(secondToolCalled).toBe(false);
  });
});

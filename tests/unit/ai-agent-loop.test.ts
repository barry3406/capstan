import { describe, it, expect } from "bun:test";
import { runAgentLoop, createAI, BuiltinMemoryBackend, createMemoryAccessor } from "@zauso-ai/capstan-ai";
import type { LLMProvider, LLMMessage, LLMResponse, LLMOptions, AgentTool } from "@zauso-ai/capstan-ai";

// ---------------------------------------------------------------------------
// Helper: create a mock LLM that returns a sequence of responses
// ---------------------------------------------------------------------------

function mockLLM(responses: string[]): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const content = responses[callIndex] ?? "done";
      callIndex++;
      return { content, model: "mock-1" };
    },
  };
}

// ---------------------------------------------------------------------------
// runAgentLoop
// ---------------------------------------------------------------------------

describe("runAgentLoop", () => {
  it("returns final result when LLM responds with plain text (no tool call)", async () => {
    const llm = mockLLM(["The answer is 42."]);

    const result = await runAgentLoop(llm, { goal: "What is the answer?" }, []);

    expect(result.status).toBe("completed");
    expect(result.result).toBe("The answer is 42.");
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toHaveLength(0);
  });

  it("executes tool when LLM returns a tool call JSON", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "add", arguments: { a: 2, b: 3 } }),
      "The sum is 5.",
    ]);

    const addTool: AgentTool = {
      name: "add",
      description: "Adds two numbers",
      parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
      async execute(args) {
        return (args.a as number) + (args.b as number);
      },
    };

    const result = await runAgentLoop(llm, { goal: "Add 2 and 3" }, [addTool]);

    expect(result.status).toBe("completed");
    expect(result.result).toBe("The sum is 5.");
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.tool).toBe("add");
    expect(result.toolCalls[0]!.result).toBe(5);
  });

  it("feeds tool result back to LLM in messages", async () => {
    const capturedMessages: LLMMessage[][] = [];
    let callIndex = 0;
    const responses = [
      JSON.stringify({ tool: "lookup", arguments: { key: "foo" } }),
      "The value of foo is bar.",
    ];

    const llm: LLMProvider = {
      name: "mock",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        capturedMessages.push([...messages]);
        const content = responses[callIndex] ?? "done";
        callIndex++;
        return { content, model: "mock-1" };
      },
    };

    const lookupTool: AgentTool = {
      name: "lookup",
      description: "Looks up a value",
      async execute() {
        return "bar";
      },
    };

    await runAgentLoop(llm, { goal: "Look up foo" }, [lookupTool]);

    // Second call should include the tool result in messages
    const secondCallMessages = capturedMessages[1]!;
    const lastMsg = secondCallMessages[secondCallMessages.length - 1]!;
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toContain("lookup");
    expect(lastMsg.content).toContain("bar");
  });

  it("stops at maxIterations and returns max_iterations status", async () => {
    // LLM always returns tool calls, never plain text
    const llm = mockLLM(
      Array.from({ length: 20 }, () => JSON.stringify({ tool: "noop", arguments: {} })),
    );

    const noopTool: AgentTool = {
      name: "noop",
      description: "Does nothing",
      async execute() {
        return "ok";
      },
    };

    const result = await runAgentLoop(
      llm,
      { goal: "Do something", maxIterations: 3 },
      [noopTool],
    );

    expect(result.status).toBe("max_iterations");
    expect(result.iterations).toBe(3);
    expect(result.toolCalls).toHaveLength(3);
  });

  it("returns approval_required when beforeToolCall blocks", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "delete", arguments: { id: "123" } }),
    ]);

    const deleteTool: AgentTool = {
      name: "delete",
      description: "Deletes a resource",
      async execute() {
        return "deleted";
      },
    };

    const result = await runAgentLoop(
      llm,
      { goal: "Delete resource 123" },
      [deleteTool],
      {
        beforeToolCall: async (tool) => ({
          allowed: false,
          reason: `Tool ${tool} requires admin approval`,
        }),
      },
    );

    expect(result.status).toBe("approval_required");
    expect(result.pendingApproval).toBeDefined();
    expect(result.pendingApproval!.tool).toBe("delete");
    expect(result.pendingApproval!.args).toEqual({ id: "123" });
    expect(result.pendingApproval!.reason).toContain("admin approval");
  });

  it("handles tool execution error gracefully", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "failing", arguments: {} }),
      "The tool failed, but that's okay.",
    ]);

    const failingTool: AgentTool = {
      name: "failing",
      description: "Always fails",
      async execute() {
        throw new Error("Something went wrong");
      },
    };

    const result = await runAgentLoop(llm, { goal: "Try the tool" }, [failingTool]);

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.result).toEqual({ error: "Something went wrong" });
  });

  it("handles unknown tool name by sending error to LLM", async () => {
    const capturedMessages: LLMMessage[][] = [];
    let callIndex = 0;
    const responses = [
      JSON.stringify({ tool: "nonexistent", arguments: {} }),
      "I see that tool doesn't exist. Here's my answer.",
    ];

    const llm: LLMProvider = {
      name: "mock",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        capturedMessages.push([...messages]);
        const content = responses[callIndex] ?? "done";
        callIndex++;
        return { content, model: "mock-1" };
      },
    };

    const result = await runAgentLoop(llm, { goal: "Use a tool" }, []);

    expect(result.status).toBe("completed");
    expect(result.iterations).toBe(2);
    // The second call should contain an error message about the nonexistent tool
    const secondCallMessages = capturedMessages[1]!;
    const lastMsg = secondCallMessages[secondCallMessages.length - 1]!;
    expect(lastMsg.content).toContain("nonexistent");
    expect(lastMsg.content).toContain("not found");
  });

  it("excludes tools in callStack (recursion guard)", async () => {
    const capturedMessages: LLMMessage[][] = [];
    let callIndex = 0;
    const responses = [
      // LLM tries to call the excluded tool
      JSON.stringify({ tool: "recursive-api", arguments: {} }),
      "I couldn't find that tool. Moving on.",
    ];

    const llm: LLMProvider = {
      name: "mock",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        capturedMessages.push([...messages]);
        const content = responses[callIndex] ?? "done";
        callIndex++;
        return { content, model: "mock-1" };
      },
    };

    const recursiveTool: AgentTool = {
      name: "recursive-api",
      description: "Would cause recursion",
      async execute() {
        return "should not run";
      },
    };

    const safeTool: AgentTool = {
      name: "safe-tool",
      description: "A safe tool",
      async execute() {
        return "safe result";
      },
    };

    const result = await runAgentLoop(
      llm,
      { goal: "Do something" },
      [recursiveTool, safeTool],
      { callStack: new Set(["recursive-api"]) },
    );

    expect(result.status).toBe("completed");
    // The recursive-api tool call should fail as "not found"
    const secondCallMessages = capturedMessages[1]!;
    const lastMsg = secondCallMessages[secondCallMessages.length - 1]!;
    expect(lastMsg.content).toContain("not found");
  });

  it("returns toolCalls history with all executed tools", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "step1", arguments: { x: 1 } }),
      JSON.stringify({ tool: "step2", arguments: { y: 2 } }),
      "All done.",
    ]);

    const step1: AgentTool = {
      name: "step1",
      description: "Step 1",
      async execute(args) {
        return { result: (args.x as number) * 10 };
      },
    };

    const step2: AgentTool = {
      name: "step2",
      description: "Step 2",
      async execute(args) {
        return { result: (args.y as number) * 20 };
      },
    };

    const result = await runAgentLoop(llm, { goal: "Do two steps" }, [step1, step2]);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]!.tool).toBe("step1");
    expect(result.toolCalls[0]!.args).toEqual({ x: 1 });
    expect(result.toolCalls[0]!.result).toEqual({ result: 10 });
    expect(result.toolCalls[1]!.tool).toBe("step2");
    expect(result.toolCalls[1]!.args).toEqual({ y: 2 });
    expect(result.toolCalls[1]!.result).toEqual({ result: 40 });
  });

  it("with no tools available returns immediately on first LLM response", async () => {
    const llm = mockLLM(["No tools available, here is my best answer."]);

    const result = await runAgentLoop(llm, { goal: "Answer a question" }, []);

    expect(result.status).toBe("completed");
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.result).toBe("No tools available, here is my best answer.");
  });

  it("calls afterToolCall hook after successful execution", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "greet", arguments: { name: "Alice" } }),
      "Greeted Alice.",
    ]);

    const afterCalls: Array<{ tool: string; args: unknown; result: unknown }> = [];

    const greetTool: AgentTool = {
      name: "greet",
      description: "Greets someone",
      async execute(args) {
        return `Hello, ${args.name}!`;
      },
    };

    await runAgentLoop(llm, { goal: "Greet Alice" }, [greetTool], {
      afterToolCall: async (tool, args, result) => {
        afterCalls.push({ tool, args, result });
      },
    });

    expect(afterCalls).toHaveLength(1);
    expect(afterCalls[0]!.tool).toBe("greet");
    expect(afterCalls[0]!.result).toBe("Hello, Alice!");
  });

  it("uses custom systemPrompt when provided", async () => {
    const capturedMessages: LLMMessage[][] = [];

    const llm: LLMProvider = {
      name: "mock",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        capturedMessages.push([...messages]);
        return { content: "done", model: "mock-1" };
      },
    };

    await runAgentLoop(
      llm,
      { goal: "Test", systemPrompt: "You are a pirate." },
      [],
    );

    const firstCallMessages = capturedMessages[0]!;
    expect(firstCallMessages[0]!.role).toBe("system");
    expect(firstCallMessages[0]!.content).toBe("You are a pirate.");
  });

  it("defaults maxIterations to 10", async () => {
    let callCount = 0;
    const llm: LLMProvider = {
      name: "mock",
      async chat(): Promise<LLMResponse> {
        callCount++;
        return {
          content: JSON.stringify({ tool: "noop", arguments: {} }),
          model: "mock-1",
        };
      },
    };

    const noopTool: AgentTool = {
      name: "noop",
      description: "Does nothing",
      async execute() {
        return "ok";
      },
    };

    const result = await runAgentLoop(llm, { goal: "Loop" }, [noopTool]);

    expect(result.status).toBe("max_iterations");
    expect(result.iterations).toBe(10);
    expect(callCount).toBe(10);
  });

  it("calls onMemoryEvent hook after tool execution", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "calc", arguments: { op: "multiply" } }),
      "Done.",
    ]);

    const memoryEvents: string[] = [];

    const calcTool: AgentTool = {
      name: "calc",
      description: "Calculates",
      async execute() {
        return 42;
      },
    };

    await runAgentLoop(llm, { goal: "Calculate" }, [calcTool], {
      onMemoryEvent: async (content) => {
        memoryEvents.push(content);
      },
    });

    expect(memoryEvents).toHaveLength(1);
    expect(memoryEvents[0]).toContain("calc");
    expect(memoryEvents[0]).toContain("42");
  });

  it("beforeToolCall allows execution when returning allowed: true", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "action", arguments: {} }),
      "Action completed.",
    ]);

    const actionTool: AgentTool = {
      name: "action",
      description: "An action",
      async execute() {
        return "success";
      },
    };

    const result = await runAgentLoop(llm, { goal: "Do action" }, [actionTool], {
      beforeToolCall: async () => ({ allowed: true }),
    });

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.result).toBe("success");
  });

  // --- JSON parsing edge cases ---

  it("valid JSON object without 'tool' field → treated as final response", async () => {
    const llm = mockLLM([JSON.stringify({ result: "done" })]);

    const result = await runAgentLoop(llm, { goal: "test" }, []);

    expect(result.status).toBe("completed");
    expect(result.result).toBe(JSON.stringify({ result: "done" }));
    expect(result.toolCalls).toHaveLength(0);
  });

  it("valid JSON array → treated as final response", async () => {
    const llm = mockLLM([JSON.stringify([1, 2, 3])]);

    const result = await runAgentLoop(llm, { goal: "test" }, []);

    expect(result.status).toBe("completed");
    expect(result.result).toBe(JSON.stringify([1, 2, 3]));
    expect(result.toolCalls).toHaveLength(0);
  });

  it("valid JSON string → treated as final response", async () => {
    const llm = mockLLM([JSON.stringify("hello")]);

    const result = await runAgentLoop(llm, { goal: "test" }, []);

    expect(result.status).toBe("completed");
    expect(result.result).toBe('"hello"');
    expect(result.toolCalls).toHaveLength(0);
  });

  it("tool call then plain text → 2 iterations, 1 tool call", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "echo", arguments: { msg: "hi" } }),
      "All done.",
    ]);

    const echoTool: AgentTool = {
      name: "echo",
      description: "Echoes input",
      async execute(args) {
        return args.msg;
      },
    };

    const result = await runAgentLoop(llm, { goal: "Echo hi" }, [echoTool]);

    expect(result.status).toBe("completed");
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.tool).toBe("echo");
    expect(result.result).toBe("All done.");
  });

  // --- Tool execution edge cases ---

  it("tool throws a non-Error object (string) → uses String(err)", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "bad", arguments: {} }),
      "Handled the error.",
    ]);

    const badTool: AgentTool = {
      name: "bad",
      description: "Throws a string",
      async execute() {
        throw "string error";
      },
    };

    const result = await runAgentLoop(llm, { goal: "test" }, [badTool]);

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.result).toEqual({ error: "string error" });
  });

  it("tool throws undefined → handles gracefully", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "throws-undef", arguments: {} }),
      "Handled.",
    ]);

    const throwsUndefTool: AgentTool = {
      name: "throws-undef",
      description: "Throws undefined",
      async execute() {
        throw undefined;
      },
    };

    const result = await runAgentLoop(llm, { goal: "test" }, [throwsUndefTool]);

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.result).toEqual({ error: "undefined" });
  });

  // --- Max iterations ---

  it("maxIterations=1 → only one LLM call then max_iterations", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "noop", arguments: {} }),
    ]);

    const noopTool: AgentTool = {
      name: "noop",
      description: "Does nothing",
      async execute() {
        return "ok";
      },
    };

    const result = await runAgentLoop(
      llm,
      { goal: "test", maxIterations: 1 },
      [noopTool],
    );

    expect(result.status).toBe("max_iterations");
    expect(result.iterations).toBe(1);
    expect(result.toolCalls).toHaveLength(1);
  });

  it("LLM keeps returning tool calls until maxIterations → correct count", async () => {
    const maxIter = 5;
    const llm = mockLLM(
      Array.from({ length: maxIter + 5 }, () =>
        JSON.stringify({ tool: "counter", arguments: {} }),
      ),
    );

    let count = 0;
    const counterTool: AgentTool = {
      name: "counter",
      description: "Counts invocations",
      async execute() {
        return ++count;
      },
    };

    const result = await runAgentLoop(
      llm,
      { goal: "count", maxIterations: maxIter },
      [counterTool],
    );

    expect(result.status).toBe("max_iterations");
    expect(result.iterations).toBe(maxIter);
    expect(result.toolCalls).toHaveLength(maxIter);
    expect(count).toBe(maxIter);
  });

  // --- beforeToolCall ---

  it("beforeToolCall blocks with no reason → uses default reason", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "action", arguments: {} }),
    ]);

    const actionTool: AgentTool = {
      name: "action",
      description: "An action",
      async execute() {
        return "ok";
      },
    };

    const result = await runAgentLoop(llm, { goal: "test" }, [actionTool], {
      beforeToolCall: async () => ({ allowed: false }),
    });

    expect(result.status).toBe("approval_required");
    expect(result.pendingApproval!.reason).toBe("Tool call blocked by policy");
  });

  // --- onMemoryEvent ---

  it("onMemoryEvent receives exact formatted string with tool name, args, and result", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "lookup", arguments: { key: "x", value: 42 } }),
      "Done.",
    ]);

    const memoryEvents: string[] = [];

    const lookupTool: AgentTool = {
      name: "lookup",
      description: "Looks up",
      async execute() {
        return { found: true };
      },
    };

    await runAgentLoop(llm, { goal: "test" }, [lookupTool], {
      onMemoryEvent: async (content) => {
        memoryEvents.push(content);
      },
    });

    expect(memoryEvents).toHaveLength(1);
    expect(memoryEvents[0]).toBe(
      `Tool lookup called with ${JSON.stringify({ key: "x", value: 42 })} => ${JSON.stringify({ found: true })}`,
    );
  });

  // --- callStack ---

  it("tool in callStack is excluded from available tools in system prompt", async () => {
    const capturedMessages: LLMMessage[][] = [];

    const llm: LLMProvider = {
      name: "mock",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        capturedMessages.push([...messages]);
        return { content: "done", model: "mock-1" };
      },
    };

    const excludedTool: AgentTool = {
      name: "excluded-tool",
      description: "Should be excluded",
      async execute() {
        return "should not run";
      },
    };

    const includedTool: AgentTool = {
      name: "included-tool",
      description: "Should be included",
      async execute() {
        return "ok";
      },
    };

    await runAgentLoop(
      llm,
      { goal: "test" },
      [excludedTool, includedTool],
      { callStack: new Set(["excluded-tool"]) },
    );

    // The system prompt should NOT mention excluded-tool
    const systemMsg = capturedMessages[0]![0]!.content;
    expect(systemMsg).not.toContain("excluded-tool");
    expect(systemMsg).toContain("included-tool");
  });

  it("multiple tools in callStack → all excluded", async () => {
    const capturedMessages: LLMMessage[][] = [];

    const llm: LLMProvider = {
      name: "mock",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        capturedMessages.push([...messages]);
        return { content: "done", model: "mock-1" };
      },
    };

    const tool1: AgentTool = { name: "blocked-1", description: "Blocked 1", async execute() { return "no"; } };
    const tool2: AgentTool = { name: "blocked-2", description: "Blocked 2", async execute() { return "no"; } };
    const tool3: AgentTool = { name: "allowed", description: "Allowed", async execute() { return "yes"; } };

    await runAgentLoop(
      llm,
      { goal: "test" },
      [tool1, tool2, tool3],
      { callStack: new Set(["blocked-1", "blocked-2"]) },
    );

    const systemMsg = capturedMessages[0]![0]!.content;
    expect(systemMsg).not.toContain("blocked-1");
    expect(systemMsg).not.toContain("blocked-2");
    expect(systemMsg).toContain("allowed");
  });

  // --- Empty/null edge cases ---

  it("empty goal string → still works", async () => {
    const llm = mockLLM(["response to empty goal"]);

    const result = await runAgentLoop(llm, { goal: "" }, []);

    expect(result.status).toBe("completed");
    expect(result.result).toBe("response to empty goal");
  });

  it("config.systemPrompt overrides default system prompt completely", async () => {
    const capturedMessages: LLMMessage[][] = [];

    const llm: LLMProvider = {
      name: "mock",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        capturedMessages.push([...messages]);
        return { content: "done", model: "mock-1" };
      },
    };

    await runAgentLoop(
      llm,
      { goal: "test", systemPrompt: "Custom system prompt only." },
      [],
    );

    const systemMsg = capturedMessages[0]![0]!;
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toBe("Custom system prompt only.");
    // Should NOT contain the default "You are a helpful agent" text
    expect(systemMsg.content).not.toContain("You are a helpful agent");
  });

  it("tools array with duplicate names → first match wins", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "dup", arguments: {} }),
      "Done.",
    ]);

    const tool1: AgentTool = {
      name: "dup",
      description: "First dup",
      async execute() {
        return "first";
      },
    };

    const tool2: AgentTool = {
      name: "dup",
      description: "Second dup",
      async execute() {
        return "second";
      },
    };

    const result = await runAgentLoop(llm, { goal: "test" }, [tool1, tool2]);

    expect(result.toolCalls).toHaveLength(1);
    // find() returns the first match
    expect(result.toolCalls[0]!.result).toBe("first");
  });
});

// ---------------------------------------------------------------------------
// createAI
// ---------------------------------------------------------------------------

describe("createAI", () => {
  it("returns an object with all AIContext methods", () => {
    const llm = mockLLM(["ok"]);
    const ai = createAI({ llm });

    expect(typeof ai.think).toBe("function");
    expect(typeof ai.generate).toBe("function");
    expect(typeof ai.thinkStream).toBe("function");
    expect(typeof ai.generateStream).toBe("function");
    expect(typeof ai.remember).toBe("function");
    expect(typeof ai.recall).toBe("function");
    expect(typeof ai.memory.about).toBe("function");
    expect(typeof ai.memory.forget).toBe("function");
    expect(typeof ai.memory.assembleContext).toBe("function");
    expect(typeof ai.agent.run).toBe("function");
  });

  it("think delegates to the LLM provider", async () => {
    const llm = mockLLM(["The sky is blue."]);
    const ai = createAI({ llm });

    const answer = await ai.think("What color is the sky?");
    expect(answer).toBe("The sky is blue.");
  });

  it("generate delegates to the LLM provider", async () => {
    const llm = mockLLM(["Generated text."]);
    const ai = createAI({ llm });

    const text = await ai.generate("Write something.");
    expect(text).toBe("Generated text.");
  });

  it("remember stores content in memory and recall retrieves it", async () => {
    const llm = mockLLM([]);
    const ai = createAI({ llm });

    const id = await ai.remember("User likes TypeScript");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const results = await ai.recall("TypeScript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.content).toBe("User likes TypeScript");
  });

  it("memory.about creates an accessor for a different scope", async () => {
    const llm = mockLLM([]);
    const ai = createAI({ llm });

    const userMemory = ai.memory.about("user", "u-456");
    await userMemory.remember("Prefers dark mode");

    // Recall in the user scope should find it
    const results = await userMemory.recall("dark mode");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.content).toBe("Prefers dark mode");

    // Recall in the default scope should NOT find it
    const defaultResults = await ai.recall("dark mode");
    const match = defaultResults.find(r => r.content === "Prefers dark mode");
    expect(match).toBeUndefined();
  });

  it("memory.forget removes a memory entry", async () => {
    const llm = mockLLM([]);
    const ai = createAI({ llm });

    const id = await ai.remember("Temporary note");
    const removed = await ai.memory.forget(id);
    expect(removed).toBe(true);

    // Second forget should return false
    const removedAgain = await ai.memory.forget(id);
    expect(removedAgain).toBe(false);
  });

  it("agent.run executes an agent loop", async () => {
    const llm = mockLLM(["The final answer is 7."]);
    const ai = createAI({ llm });

    const result = await ai.agent.run({ goal: "Compute something" });
    expect(result.status).toBe("completed");
    expect(result.result).toBe("The final answer is 7.");
  });

  it("with no memory config → memory still works (BuiltinMemoryBackend created)", async () => {
    const llm = mockLLM([]);
    // No memory config at all
    const ai = createAI({ llm });

    const id = await ai.remember("test memory");
    expect(typeof id).toBe("string");

    const results = await ai.recall("test memory");
    expect(results.length).toBe(1);
    expect(results[0]!.content).toBe("test memory");
  });

  it("with no defaultScope → uses { type: 'default', id: 'default' }", async () => {
    const llm = mockLLM([]);
    const ai = createAI({ llm }); // no defaultScope

    await ai.remember("default scoped entry keyword");
    const results = await ai.recall("default scoped entry keyword");
    expect(results.length).toBe(1);
    // The entry should be stored under the default scope
    expect(results[0]!.scope).toEqual({ type: "default", id: "default" });
  });

  it("memory.about creates independent accessor (store in about scope, recall from default returns nothing)", async () => {
    const llm = mockLLM([]);
    const ai = createAI({ llm });

    const projectMemory = ai.memory.about("project", "p-999");
    await projectMemory.remember("project specific data keyword");

    // Recall from default scope should NOT find it
    const defaultResults = await ai.recall("project specific data keyword");
    expect(defaultResults).toEqual([]);

    // Recall from the about scope should find it
    const projectResults = await projectMemory.recall("project specific data keyword");
    expect(projectResults.length).toBe(1);
    expect(projectResults[0]!.content).toBe("project specific data keyword");
  });

  it("memory.forget delegates to backend", async () => {
    const llm = mockLLM([]);
    const ai = createAI({ llm });

    const id = await ai.remember("to be forgotten keyword");
    // Verify it exists
    const before = await ai.recall("to be forgotten keyword");
    expect(before.length).toBe(1);

    // Forget via memory.forget
    const removed = await ai.memory.forget(id);
    expect(removed).toBe(true);

    // Verify it's gone
    const after = await ai.recall("to be forgotten keyword");
    expect(after).toEqual([]);

    // Second forget returns false
    const removedAgain = await ai.memory.forget(id);
    expect(removedAgain).toBe(false);
  });

  it("agent.run passes tools from config", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "multiply", arguments: { a: 3, b: 4 } }),
      "The result is 12.",
    ]);
    const ai = createAI({ llm });

    const multiplyTool: AgentTool = {
      name: "multiply",
      description: "Multiplies two numbers",
      async execute(args) {
        return (args.a as number) * (args.b as number);
      },
    };

    const result = await ai.agent.run({
      goal: "Multiply 3 and 4",
      tools: [multiplyTool],
    });

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.tool).toBe("multiply");
    expect(result.toolCalls[0]!.result).toBe(12);
    expect(result.result).toBe("The result is 12.");
  });
});

// ---------------------------------------------------------------------------
// BuiltinMemoryBackend & createMemoryAccessor (direct usage)
// ---------------------------------------------------------------------------

describe("BuiltinMemoryBackend", () => {
  it("store and query round-trip works", async () => {
    const backend = new BuiltinMemoryBackend();
    const scope = { type: "test", id: "t-1" };

    const id = await backend.store({
      content: "Hello world",
      scope,
    });

    expect(typeof id).toBe("string");

    const results = await backend.query(scope, "Hello", 5);
    expect(results.length).toBe(1);
    expect(results[0]!.content).toBe("Hello world");
    expect(results[0]!.id).toBe(id);
  });

  it("remove deletes an entry", async () => {
    const backend = new BuiltinMemoryBackend();
    const scope = { type: "test", id: "t-2" };

    const id = await backend.store({ content: "To be deleted", scope });
    expect(await backend.remove(id)).toBe(true);
    expect(await backend.remove(id)).toBe(false);

    const results = await backend.query(scope, "deleted", 5);
    expect(results).toHaveLength(0);
  });

  it("clear removes all entries for a scope", async () => {
    const backend = new BuiltinMemoryBackend();
    const scope1 = { type: "user", id: "u-1" };
    const scope2 = { type: "user", id: "u-2" };

    await backend.store({ content: "Entry 1", scope: scope1 });
    await backend.store({ content: "Entry 2", scope: scope1 });
    await backend.store({ content: "Entry 3", scope: scope2 });

    await backend.clear(scope1);

    const r1 = await backend.query(scope1, "Entry", 10);
    const r2 = await backend.query(scope2, "Entry", 10);
    expect(r1).toHaveLength(0);
    expect(r2).toHaveLength(1);
  });
});

describe("createMemoryAccessor", () => {
  it("assembleContext builds a context string from stored memories", async () => {
    const backend = new BuiltinMemoryBackend();
    const scope = { type: "session", id: "s-1" };
    const accessor = createMemoryAccessor(scope, backend);

    await accessor.remember("The user is a developer");
    await accessor.remember("The user prefers TypeScript");

    const ctx = await accessor.assembleContext({ query: "developer" });
    expect(ctx).toContain("The user is a developer");
  });
});

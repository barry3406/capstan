import { describe, it, expect } from "bun:test";
import {
  createSmartAgent,
  defineSkill,
  createActivateSkillTool,
  formatSkillDescriptions,
  validateArgs,
  BuiltinMemoryBackend,
  createMemoryAccessor,
  InMemoryEvolutionStore,
  buildExperience,
  buildStrategyLayer,
  shouldCapture,
} from "../../packages/ai/src/index.js";
import { parseStrategies } from "../../packages/ai/src/evolution/distiller.js";
import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMOptions,
  AgentRunResult,
} from "../../packages/ai/src/types.js";
import type { EvolutionConfig } from "../../packages/ai/src/evolution/types.js";

// ---------------------------------------------------------------------------
// Helper: mock LLM
// ---------------------------------------------------------------------------

function mockLLM(responses: string[]): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const content = responses[callIndex] ?? "done";
      callIndex++;
      return { content, model: "mock-1" };
    },
  };
}

// Helper: build a minimal AgentRunResult for testing evolution functions
function fakeRunResult(overrides?: Partial<AgentRunResult>): AgentRunResult {
  return {
    result: "done",
    iterations: 1,
    toolCalls: [],
    taskCalls: [],
    status: "completed",
    ...overrides,
  };
}

// ===========================================================================
// Category 1: Every public API callable
// ===========================================================================

describe("Smoke: public API functions", () => {
  it("createSmartAgent with minimal config", async () => {
    const agent = createSmartAgent({ llm: mockLLM(["Hi"]), tools: [] });
    const r = await agent.run("Hello");
    expect(r.status).toBe("completed");
  });

  it("defineSkill returns valid AgentSkill", () => {
    const skill = defineSkill({ name: "s", description: "d", trigger: "t", prompt: "p" });
    expect(skill.name).toBe("s");
    expect(skill.source).toBe("developer");
    expect(skill.utility).toBe(1.0);
  });

  it("defineSkill preserves explicit source and utility", () => {
    const skill = defineSkill({ name: "s", description: "d", trigger: "t", prompt: "p", source: "evolved", utility: 0.5 });
    expect(skill.source).toBe("evolved");
    expect(skill.utility).toBe(0.5);
  });

  it("createActivateSkillTool returns valid AgentTool", async () => {
    const tool = createActivateSkillTool([defineSkill({ name: "s", description: "d", trigger: "t", prompt: "p" })]);
    expect(tool.name).toBe("activate_skill");
    const r = await tool.execute({ skill_name: "s" });
    expect((r as any).skill).toBe("s");
  });

  it("createActivateSkillTool returns error for unknown skill", async () => {
    const tool = createActivateSkillTool([defineSkill({ name: "s", description: "d", trigger: "t", prompt: "p" })]);
    const r = await tool.execute({ skill_name: "unknown" });
    expect((r as any).error).toContain("not found");
  });

  it("formatSkillDescriptions with empty array returns empty", () => {
    expect(formatSkillDescriptions([])).toBe("");
  });

  it("formatSkillDescriptions with skills returns formatted string", () => {
    const skills = [defineSkill({ name: "s1", description: "d1", trigger: "t1", prompt: "p1" })];
    const result = formatSkillDescriptions(skills);
    expect(result).toContain("s1");
    expect(result).toContain("Available Skills");
  });

  it("validateArgs with no schema returns valid", () => {
    expect(validateArgs({}, undefined).valid).toBe(true);
  });

  it("validateArgs catches missing required field", () => {
    const schema = { type: "object", properties: { x: { type: "number" } }, required: ["x"] };
    const result = validateArgs({}, schema);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("x");
  });

  it("validateArgs accepts valid args", () => {
    const schema = { type: "object", properties: { x: { type: "number" } }, required: ["x"] };
    expect(validateArgs({ x: 42 }, schema).valid).toBe(true);
  });

  it("BuiltinMemoryBackend store and query", async () => {
    const mem = new BuiltinMemoryBackend();
    const id = await mem.store({ content: "test", scope: { type: "t", id: "1" } });
    expect(typeof id).toBe("string");
    const results = await mem.query({ type: "t", id: "1" }, "test", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("BuiltinMemoryBackend remove and clear", async () => {
    const mem = new BuiltinMemoryBackend();
    const id = await mem.store({ content: "removable", scope: { type: "t", id: "1" } });
    const removed = await mem.remove(id);
    expect(removed).toBe(true);
    const removedAgain = await mem.remove(id);
    expect(removedAgain).toBe(false);
    await mem.store({ content: "clearable", scope: { type: "t", id: "2" } });
    await mem.clear({ type: "t", id: "2" });
    const afterClear = await mem.query({ type: "t", id: "2" }, "clearable", 5);
    expect(afterClear).toHaveLength(0);
  });

  it("createMemoryAccessor remember and recall", async () => {
    const mem = new BuiltinMemoryBackend();
    const acc = createMemoryAccessor({ type: "t", id: "1" }, mem);
    await acc.remember("important fact");
    const recalled = await acc.recall("important");
    expect(recalled.length).toBeGreaterThanOrEqual(1);
  });

  it("createMemoryAccessor forget and about", async () => {
    const mem = new BuiltinMemoryBackend();
    const acc = createMemoryAccessor({ type: "t", id: "1" }, mem);
    const id = await acc.remember("to forget");
    const forgotten = await acc.forget(id);
    expect(forgotten).toBe(true);
    const sub = acc.about("sub", "2");
    await sub.remember("sub-scoped data");
    const subRecall = await sub.recall("sub-scoped");
    expect(subRecall.length).toBeGreaterThanOrEqual(1);
  });

  it("createMemoryAccessor assembleContext", async () => {
    const mem = new BuiltinMemoryBackend();
    const acc = createMemoryAccessor({ type: "t", id: "1" }, mem);
    await acc.remember("context piece one");
    await acc.remember("context piece two");
    const ctx = await acc.assembleContext({ query: "context piece", maxTokens: 2000 });
    expect(ctx).toContain("Relevant Context");
  });

  it("InMemoryEvolutionStore CRUD", async () => {
    const store = new InMemoryEvolutionStore();
    const id = await store.recordExperience({ goal: "g", outcome: "success", trajectory: [], iterations: 1, tokenUsage: 0, duration: 100, skillsUsed: [] });
    expect(typeof id).toBe("string");
    const stats = await store.getStats();
    expect(stats.totalExperiences).toBe(1);
  });

  it("InMemoryEvolutionStore strategies lifecycle", async () => {
    const store = new InMemoryEvolutionStore();
    const id = await store.storeStrategy({ content: "rule 1", source: ["e1"], utility: 0.5, applications: 0 });
    expect(typeof id).toBe("string");
    await store.updateStrategyUtility(id, 0.2);
    await store.incrementStrategyApplications(id);
    const strategies = await store.queryStrategies("rule", 10);
    expect(strategies.length).toBe(1);
    expect(strategies[0]!.utility).toBeCloseTo(0.7);
    expect(strategies[0]!.applications).toBe(1);
  });

  it("InMemoryEvolutionStore skills", async () => {
    const store = new InMemoryEvolutionStore();
    const id = await store.storeSkill({ name: "test-skill", description: "d", trigger: "t", prompt: "p" });
    expect(typeof id).toBe("string");
    const skills = await store.querySkills("test", 10);
    expect(skills.length).toBe(1);
  });

  it("InMemoryEvolutionStore pruneStrategies", async () => {
    const store = new InMemoryEvolutionStore();
    await store.storeStrategy({ content: "low", source: ["e1"], utility: 0.1, applications: 0 });
    await store.storeStrategy({ content: "high", source: ["e2"], utility: 0.9, applications: 5 });
    const pruned = await store.pruneStrategies({ minUtility: 0.5 });
    expect(pruned).toBe(1);
    const remaining = await store.queryStrategies("", 10);
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.content).toBe("high");
  });

  it("buildExperience produces valid Experience shape", () => {
    const exp = buildExperience("goal", fakeRunResult({ iterations: 2 }), Date.now(), []);
    expect(exp.goal).toBe("goal");
    expect(exp.outcome).toBe("success");
    expect(exp.iterations).toBe(2);
  });

  it("buildExperience maps fatal to failure", () => {
    const exp = buildExperience("goal", fakeRunResult({ status: "fatal" }), Date.now(), []);
    expect(exp.outcome).toBe("failure");
  });

  it("buildExperience maps max_iterations to partial", () => {
    const exp = buildExperience("goal", fakeRunResult({ status: "max_iterations" }), Date.now(), []);
    expect(exp.outcome).toBe("partial");
  });

  it("shouldCapture respects every-run", () => {
    const config: EvolutionConfig = { store: new InMemoryEvolutionStore(), capture: "every-run" };
    expect(shouldCapture(config, fakeRunResult())).toBe(true);
    expect(shouldCapture(config, fakeRunResult({ status: "fatal" }))).toBe(true);
  });

  it("shouldCapture respects on-success", () => {
    const config: EvolutionConfig = { store: new InMemoryEvolutionStore(), capture: "on-success" };
    expect(shouldCapture(config, fakeRunResult())).toBe(true);
    expect(shouldCapture(config, fakeRunResult({ status: "fatal" }))).toBe(false);
  });

  it("shouldCapture respects on-failure", () => {
    const config: EvolutionConfig = { store: new InMemoryEvolutionStore(), capture: "on-failure" };
    expect(shouldCapture(config, fakeRunResult())).toBe(false);
    expect(shouldCapture(config, fakeRunResult({ status: "fatal" }))).toBe(true);
  });

  it("buildStrategyLayer with empty strategies returns null", () => {
    expect(buildStrategyLayer([])).toBeNull();
  });

  it("buildStrategyLayer with strategies returns PromptLayer", () => {
    const layer = buildStrategyLayer([{ id: "s1", content: "rule 1", source: ["e1"], utility: 0.8, applications: 3, createdAt: "", updatedAt: "" }]);
    expect(layer).not.toBeNull();
    expect(layer!.id).toBe("evolution-strategies");
    expect(layer!.position).toBe("append");
    expect(layer!.content).toContain("rule 1");
  });

  it("parseStrategies with valid JSON", () => {
    const result = parseStrategies('[{"content":"rule 1","source":["e1"]}]');
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("rule 1");
  });

  it("parseStrategies with malformed JSON returns empty", () => {
    expect(parseStrategies("not json")).toEqual([]);
  });

  it("parseStrategies with markdown fenced JSON", () => {
    const result = parseStrategies('```json\n[{"content":"fenced","source":"s1"}]\n```');
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("fenced");
  });

  it("parseStrategies with empty string returns empty", () => {
    expect(parseStrategies("")).toEqual([]);
  });

  it("parseStrategies with non-array JSON returns empty", () => {
    expect(parseStrategies('{"content":"not array"}')).toEqual([]);
  });
});

// ===========================================================================
// Category 2: Config combinations
// ===========================================================================

describe("Smoke: config combinations", () => {
  it("all optional fields undefined", async () => {
    const r = await createSmartAgent({ llm: mockLLM(["ok"]), tools: [] }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with fallbackLlm", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      fallbackLlm: mockLLM(["fallback"]),
      tools: [],
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with tokenBudget as number", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      tokenBudget: 50000,
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with tokenBudget as object", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      tokenBudget: { maxOutputTokensPerTurn: 50000, nudgeAtPercent: 90 },
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with toolResultBudget", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      toolResultBudget: { maxChars: 1000 },
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with llmTimeout", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      llmTimeout: { chatTimeoutMs: 60000 },
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with skills", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      skills: [defineSkill({ name: "s", description: "d", trigger: "t", prompt: "p" })],
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with memory", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      memory: { store: new BuiltinMemoryBackend(), scope: { type: "t", id: "1" } },
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with stopHooks", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      stopHooks: [{ name: "h", async evaluate() { return { pass: true }; } }],
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with maxIterations", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      maxIterations: 5,
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with contextWindowSize", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      contextWindowSize: 50000,
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with prompt config", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      prompt: {
        base: "You are a helpful assistant.",
        layers: [{ id: "l1", content: "Be concise.", position: "append" }],
      },
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with all hooks", async () => {
    const r = await createSmartAgent({
      llm: mockLLM([JSON.stringify({ tool: "t", arguments: {} }), "ok"]),
      tools: [{ name: "t", description: "d", async execute() { return 1; } }],
      hooks: {
        async beforeToolCall() { return { allowed: true }; },
        async afterToolCall() {},
        async onCheckpoint() {},
        async onMemoryEvent() {},
        async onRunComplete() {},
        async afterIteration() {},
      },
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with compaction config", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      compaction: { snip: { preserveTail: 5 }, microcompact: { maxToolResultChars: 500, protectedTail: 3 }, autocompact: { threshold: 0.9, maxFailures: 2, bufferTokens: 10000 } },
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with streaming config", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      streaming: { maxConcurrency: 4 },
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with toolCatalog config", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      toolCatalog: { deferThreshold: 20 },
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with evolution config", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      tools: [],
      evolution: { store: new InMemoryEvolutionStore(), capture: "every-run" },
    }).run("go");
    expect(r.status).toBe("completed");
  });

  it("with ALL config fields set simultaneously", async () => {
    const r = await createSmartAgent({
      llm: mockLLM(["ok"]),
      fallbackLlm: mockLLM(["fb"]),
      tools: [{ name: "t", description: "d", async execute() { return 1; }, validate: (_a) => ({ valid: true }), timeout: 5000 }],
      skills: [defineSkill({ name: "s", description: "d", trigger: "t", prompt: "p" })],
      tokenBudget: 100000,
      toolResultBudget: { maxChars: 5000 },
      llmTimeout: { chatTimeoutMs: 60000, streamIdleTimeoutMs: 30000 },
      maxIterations: 100,
      contextWindowSize: 50000,
      memory: { store: new BuiltinMemoryBackend(), scope: { type: "t", id: "1" } },
      stopHooks: [{ name: "h", async evaluate() { return { pass: true }; } }],
      hooks: { async onRunComplete() {} },
      compaction: { snip: { preserveTail: 5 } },
      streaming: { maxConcurrency: 2 },
      toolCatalog: { deferThreshold: 10 },
      evolution: { store: new InMemoryEvolutionStore(), capture: "on-success" },
      prompt: { base: "base prompt" },
    }).run("go");
    expect(r.status).toBe("completed");
  });
});

// ===========================================================================
// Category 3: Tool option combinations
// ===========================================================================

describe("Smoke: AgentTool option combinations", () => {
  it("tool with only name + description + execute", async () => {
    const r = await createSmartAgent({
      llm: mockLLM([JSON.stringify({ tool: "t", arguments: {} }), "ok"]),
      tools: [{ name: "t", description: "d", async execute() { return 1; } }],
    }).run("go");
    expect(r.toolCalls[0]!.status).toBe("success");
  });

  it("tool with validate + timeout + parameters + concurrencySafe + failureMode", async () => {
    const r = await createSmartAgent({
      llm: mockLLM([JSON.stringify({ tool: "t", arguments: { x: 1 } }), "ok"]),
      tools: [{
        name: "t", description: "d",
        parameters: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
        validate: (args) => ({ valid: typeof args.x === "number" }),
        timeout: 5000,
        isConcurrencySafe: true,
        failureMode: "soft" as const,
        async execute(args) { return args.x; },
      }],
    }).run("go");
    expect(r.toolCalls[0]!.status).toBe("success");
  });

  it("tool with failureMode hard that throws", async () => {
    const r = await createSmartAgent({
      llm: mockLLM([JSON.stringify({ tool: "t", arguments: {} }), "ok"]),
      tools: [{ name: "t", description: "d", failureMode: "hard" as const, async execute() { throw new Error("hard fail"); } }],
    }).run("go");
    expect(r.toolCalls[0]!.status).toBe("error");
  });

  it("tool with validate returning invalid", async () => {
    const r = await createSmartAgent({
      llm: mockLLM([JSON.stringify({ tool: "t", arguments: { x: "not a number" } }), "ok"]),
      tools: [{
        name: "t", description: "d",
        validate: (args) => ({ valid: false, error: "x must be number" }),
        async execute(args) { return args.x; },
      }],
    }).run("go");
    expect(r.toolCalls[0]!.status).toBe("error");
  });

  it("multiple tools in one agent", async () => {
    const r = await createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "a", arguments: {} }),
        JSON.stringify({ tool: "b", arguments: {} }),
        "ok",
      ]),
      tools: [
        { name: "a", description: "tool a", async execute() { return "a-result"; } },
        { name: "b", description: "tool b", async execute() { return "b-result"; } },
      ],
    }).run("go");
    expect(r.status).toBe("completed");
    expect(r.toolCalls).toHaveLength(2);
    expect(r.toolCalls[0]!.tool).toBe("a");
    expect(r.toolCalls[1]!.tool).toBe("b");
  });
});

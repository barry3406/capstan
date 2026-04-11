import { describe, it, expect } from "bun:test";
import {
  buildExperience,
  shouldCapture,
  buildStrategyLayer,
  runPostRunEvolution,
  parseStrategies,
  InMemoryEvolutionStore,
} from "../../packages/ai/src/evolution/index.js";
import type {
  AgentRunResult,
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMOptions,
  PromptLayer,
} from "../../packages/ai/src/types.js";
import type {
  EvolutionConfig,
  Strategy,
} from "../../packages/ai/src/evolution/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockLLM(response: string): LLMProvider {
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      return { content: response, model: "mock-1" };
    },
  };
}

function makeResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    result: "done",
    iterations: 2,
    toolCalls: [
      { tool: "search", args: { q: "test" }, result: "found", status: "success" },
    ],
    taskCalls: [],
    status: "completed",
    ...overrides,
  };
}

function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    id: "strat-1",
    content: "Test strategy",
    source: ["test"],
    utility: 0.5,
    applications: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildExperience
// ---------------------------------------------------------------------------

describe("buildExperience", () => {
  it("maps a successful AgentRunResult correctly", () => {
    const startTime = Date.now() - 1000;
    const result = makeResult();
    const exp = buildExperience("find files", result, startTime, ["search-skill"]);

    expect(exp.goal).toBe("find files");
    expect(exp.outcome).toBe("success");
    expect(exp.iterations).toBe(2);
    expect(exp.trajectory).toHaveLength(1);
    expect(exp.trajectory[0]!.tool).toBe("search");
    expect(exp.skillsUsed).toEqual(["search-skill"]);
    expect(exp.tokenUsage).toBe(0);
    expect(exp.duration).toBeGreaterThanOrEqual(1000);
  });

  it("maps a failed AgentRunResult with error message", () => {
    const result = makeResult({
      status: "fatal",
      error: "timeout",
      toolCalls: [],
    });
    const exp = buildExperience("deploy app", result, Date.now(), []);

    expect(exp.outcome).toBe("failure");
    expect(exp.trajectory).toHaveLength(0);
  });

  it("maps a partial AgentRunResult (max_iterations)", () => {
    const result = makeResult({ status: "max_iterations" });
    const exp = buildExperience("partial task", result, Date.now(), []);

    expect(exp.outcome).toBe("partial");
  });

  it("handles empty toolCalls array", () => {
    const result = makeResult({ toolCalls: [] });
    const exp = buildExperience("think", result, Date.now(), []);

    expect(exp.trajectory).toHaveLength(0);
  });

  it("maps toolCalls to trajectory steps with correct fields", () => {
    const result = makeResult({
      toolCalls: [
        { tool: "read", args: { path: "a.ts" }, result: "code", status: "success", order: 0 },
        { tool: "write", args: { path: "b.ts", content: "x" }, result: "ok", status: "error", order: 1 },
      ],
    });
    const exp = buildExperience("multi", result, Date.now(), []);

    expect(exp.trajectory).toHaveLength(2);
    expect(exp.trajectory[0]!.tool).toBe("read");
    expect(exp.trajectory[0]!.status).toBe("success");
    expect(exp.trajectory[0]!.iteration).toBe(0);
    expect(exp.trajectory[1]!.tool).toBe("write");
    expect(exp.trajectory[1]!.status).toBe("error");
    expect(exp.trajectory[1]!.iteration).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// shouldCapture
// ---------------------------------------------------------------------------

describe("shouldCapture", () => {
  const store = new InMemoryEvolutionStore();

  it("every-run: captures both success and failure", () => {
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "manual" };
    expect(shouldCapture(config, makeResult({ status: "completed" }))).toBe(true);
    expect(shouldCapture(config, makeResult({ status: "fatal" }))).toBe(true);
  });

  it("on-failure: captures only failures", () => {
    const config: EvolutionConfig = { store, capture: "on-failure", distillation: "manual" };
    expect(shouldCapture(config, makeResult({ status: "completed" }))).toBe(false);
    expect(shouldCapture(config, makeResult({ status: "fatal" }))).toBe(true);
    expect(shouldCapture(config, makeResult({ status: "max_iterations" }))).toBe(true);
  });

  it("on-success: captures only successes", () => {
    const config: EvolutionConfig = { store, capture: "on-success", distillation: "manual" };
    expect(shouldCapture(config, makeResult({ status: "completed" }))).toBe(true);
    expect(shouldCapture(config, makeResult({ status: "fatal" }))).toBe(false);
  });

  it("custom function: delegates to the function", () => {
    const config: EvolutionConfig = {
      store,
      capture: (r) => r.iterations > 3,
      distillation: "manual",
    };
    expect(shouldCapture(config, makeResult({ iterations: 5 }))).toBe(true);
    expect(shouldCapture(config, makeResult({ iterations: 1 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseStrategies
// ---------------------------------------------------------------------------

describe("parseStrategies", () => {
  it("parses valid JSON array with string source (wraps to array)", () => {
    const input = '[{"content":"use caching","source":"perf-trace"}]';
    const result = parseStrategies(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("use caching");
    expect(result[0]!.source).toEqual(["perf-trace"]);
  });

  it("parses valid JSON array with array source (keeps as-is)", () => {
    const input = '[{"content":"use caching","source":["perf-trace","opt-trace"]}]';
    const result = parseStrategies(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toEqual(["perf-trace", "opt-trace"]);
  });

  it("parses JSON inside markdown code fences", () => {
    const input = '```json\n[{"content":"retry on fail","source":"error-trace"}]\n```';
    const result = parseStrategies(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("retry on fail");
    expect(result[0]!.source).toEqual(["error-trace"]);
  });

  it("parses JSON inside plain code fences", () => {
    const input = '```\n[{"content":"check deps","source":"build-trace"}]\n```';
    const result = parseStrategies(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("check deps");
  });

  it("returns empty array for malformed JSON", () => {
    expect(parseStrategies("{not valid json")).toEqual([]);
    expect(parseStrategies("[{broken")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseStrategies("")).toEqual([]);
    expect(parseStrategies("   ")).toEqual([]);
  });

  it("filters out items missing content field", () => {
    const input = '[{"content":"valid","source":"ok"},{"other":"field"}]';
    const result = parseStrategies(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("valid");
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseStrategies('{"content":"not array","source":"x"}')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildStrategyLayer
// ---------------------------------------------------------------------------

describe("buildStrategyLayer", () => {
  it("returns null for empty strategies array", () => {
    expect(buildStrategyLayer([])).toBeNull();
  });

  it("returns a valid PromptLayer for non-empty strategies", () => {
    const strategies = [
      makeStrategy({ content: "Use caching for repeated queries" }),
      makeStrategy({ content: "Validate inputs before processing" }),
    ];

    const layer = buildStrategyLayer(strategies);

    expect(layer).not.toBeNull();
    expect(layer!.id).toBe("evolution-strategies");
    expect(layer!.position).toBe("append");
    expect(layer!.content).toContain("Learned Strategies");
    expect(layer!.content).toContain("Use caching for repeated queries");
    expect(layer!.content).toContain("Validate inputs before processing");
  });

  it("includes priority field", () => {
    const layer = buildStrategyLayer([makeStrategy()]);
    expect(layer!.priority).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// runPostRunEvolution — integration with InMemoryEvolutionStore
// ---------------------------------------------------------------------------

describe("runPostRunEvolution", () => {
  it("records experience when shouldCapture returns true", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "manual" };
    const llm = mockLLM("[]");
    const result = makeResult();

    await runPostRunEvolution(config, llm, "test goal", result, Date.now() - 100, ["s1"], []);

    const experiences = await store.queryExperiences({ goal: "test" });
    expect(experiences).toHaveLength(1);
    expect(experiences[0]!.goal).toBe("test goal");
  });

  it("does not record experience when shouldCapture returns false", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "on-failure", distillation: "manual" };
    const llm = mockLLM("[]");
    const result = makeResult({ status: "completed" });

    await runPostRunEvolution(config, llm, "test goal", result, Date.now(), [], []);

    const experiences = await store.queryExperiences({});
    expect(experiences).toHaveLength(0);
  });

  it("updates utility of retrieved strategies on success (+0.1)", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "manual" };
    const llm = mockLLM("[]");
    const stratId = await store.storeStrategy({ content: "test", source: ["t"], utility: 0.5, applications: 0 });
    const strategies = await store.queryStrategies("", 100);

    await runPostRunEvolution(config, llm, "goal", makeResult({ status: "completed" }), Date.now(), [], strategies);

    const updated = await store.queryStrategies("", 100);
    expect(updated[0]!.utility).toBeCloseTo(0.6);
    expect(updated[0]!.applications).toBe(1);
  });

  it("updates utility of retrieved strategies on failure (-0.05)", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "manual" };
    const llm = mockLLM("[]");
    await store.storeStrategy({ content: "test", source: ["t"], utility: 0.5, applications: 0 });
    const strategies = await store.queryStrategies("", 100);

    await runPostRunEvolution(config, llm, "goal", makeResult({ status: "fatal" }), Date.now(), [], strategies);

    const updated = await store.queryStrategies("", 100);
    expect(updated[0]!.utility).toBeCloseTo(0.45);
    expect(updated[0]!.applications).toBe(1);
  });

  it("clamps utility at 0 (never negative)", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "manual" };
    const llm = mockLLM("[]");
    await store.storeStrategy({ content: "test", source: ["t"], utility: 0.02, applications: 0 });
    const strategies = await store.queryStrategies("", 100);

    await runPostRunEvolution(config, llm, "goal", makeResult({ status: "fatal" }), Date.now(), [], strategies);

    const updated = await store.queryStrategies("", 100);
    expect(updated[0]!.utility).toBe(0);
  });

  it("clamps utility at 1 (never exceeds)", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "manual" };
    const llm = mockLLM("[]");
    await store.storeStrategy({ content: "test", source: ["t"], utility: 0.95, applications: 0 });
    const strategies = await store.queryStrategies("", 100);

    await runPostRunEvolution(config, llm, "goal", makeResult({ status: "completed" }), Date.now(), [], strategies);

    const updated = await store.queryStrategies("", 100);
    expect(updated[0]!.utility).toBe(1);
  });

  it("triggers distillation when post-run and >= 3 experiences", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "post-run" };
    const llm = mockLLM('[{"content":"new strat","source":"distilled"}]');

    // Pre-populate 2 experiences, the run will add a third
    await store.recordExperience({ goal: "g1", outcome: "success", trajectory: [], iterations: 1, tokenUsage: 0, duration: 100, skillsUsed: [] });
    await store.recordExperience({ goal: "g2", outcome: "failure", trajectory: [], iterations: 2, tokenUsage: 0, duration: 200, skillsUsed: [] });

    await runPostRunEvolution(config, llm, "g3", makeResult(), Date.now() - 100, [], []);

    const strategies = await store.queryStrategies("", 100);
    expect(strategies.length).toBeGreaterThanOrEqual(1);
    expect(strategies.some((s) => s.content === "new strat")).toBe(true);
  });

  it("does not distill when fewer than 3 experiences", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "post-run" };
    let llmCalled = false;
    const llm: LLMProvider = {
      name: "mock",
      async chat(): Promise<LLMResponse> {
        llmCalled = true;
        return { content: "[]", model: "mock-1" };
      },
    };

    // Only 1 experience after adding the current one
    await runPostRunEvolution(config, llm, "g1", makeResult(), Date.now(), [], []);

    expect(llmCalled).toBe(false);
  });

  it("never throws even if store fails", async () => {
    const brokenStore = {
      async recordExperience(): Promise<string> { throw new Error("store error"); },
      async queryExperiences() { return []; },
      async storeStrategy() { return ""; },
      async queryStrategies() { return []; },
      async updateStrategyUtility() {},
      async incrementStrategyApplications() {},
      async storeSkill() { return ""; },
      async querySkills() { return []; },
      async pruneStrategies() { return 0; },
      async getStats() { return { totalExperiences: 0, totalStrategies: 0, totalEvolvedSkills: 0, averageUtility: 0 }; },
    };
    const config: EvolutionConfig = { store: brokenStore as any, capture: "every-run", distillation: "manual" };
    const llm = mockLLM("[]");

    // Should not throw
    await runPostRunEvolution(config, llm, "goal", makeResult(), Date.now(), [], []);
  });

  it("never throws even if LLM fails", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "post-run" };
    const failingLLM: LLMProvider = {
      name: "failing",
      async chat(): Promise<LLMResponse> { throw new Error("LLM down"); },
    };

    // Pre-populate enough experiences
    await store.recordExperience({ goal: "g1", outcome: "success", trajectory: [], iterations: 1, tokenUsage: 0, duration: 100, skillsUsed: [] });
    await store.recordExperience({ goal: "g2", outcome: "success", trajectory: [], iterations: 1, tokenUsage: 0, duration: 100, skillsUsed: [] });

    await runPostRunEvolution(config, failingLLM, "g3", makeResult(), Date.now(), [], []);
    // No assertion needed — test passes if no exception
  });
});

// ---------------------------------------------------------------------------
// Skill promotion
// ---------------------------------------------------------------------------

describe("skill promotion", () => {
  it("promotes strategy with utility >= 0.7 and applications >= 5", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "manual" };
    const llm = mockLLM("[]");

    // Add a strategy that meets the promotion threshold
    const stratId = await store.storeStrategy({ content: "high value", source: ["test"], utility: 0.75, applications: 5 });

    await runPostRunEvolution(config, llm, "goal", makeResult(), Date.now(), [], []);

    const skills = await store.querySkills("", 100);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.description).toBe("high value");
    expect(skills[0]!.name).toBe(`skill-${stratId}`);
    expect(skills[0]!.source).toBe("evolved");
    expect(skills[0]!.utility).toBe(0.75);
  });

  it("does not promote strategy below utility threshold", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "manual" };
    const llm = mockLLM("[]");

    await store.storeStrategy({ content: "low value", source: ["test"], utility: 0.3, applications: 10 });

    await runPostRunEvolution(config, llm, "goal", makeResult(), Date.now(), [], []);

    const skills = await store.querySkills("", 100);
    expect(skills).toHaveLength(0);
  });

  it("does not promote strategy below applications threshold", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "manual" };
    const llm = mockLLM("[]");

    await store.storeStrategy({ content: "new but good", source: ["test"], utility: 0.8, applications: 2 });

    await runPostRunEvolution(config, llm, "goal", makeResult(), Date.now(), [], []);

    const skills = await store.querySkills("", 100);
    expect(skills).toHaveLength(0);
  });

  it("does not promote an already-promoted strategy", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = { store, capture: "every-run", distillation: "manual" };
    const llm = mockLLM("[]");

    await store.storeStrategy({ content: "promoted", source: ["test"], utility: 0.8, applications: 6 });

    // Run once to promote
    await runPostRunEvolution(config, llm, "goal", makeResult(), Date.now(), [], []);
    // Run again — should not duplicate
    await runPostRunEvolution(config, llm, "goal", makeResult(), Date.now(), [], []);

    const skills = await store.querySkills("", 100);
    expect(skills).toHaveLength(1);
  });

  it("respects custom skillPromotion config thresholds", async () => {
    const store = new InMemoryEvolutionStore();
    const config: EvolutionConfig = {
      store,
      capture: "every-run",
      distillation: "manual",
      skillPromotion: { minUtility: 0.9, minApplications: 10 },
    };
    const llm = mockLLM("[]");

    // This would be promoted with defaults but not with custom thresholds
    await store.storeStrategy({ content: "good but not great", source: ["test"], utility: 0.75, applications: 5 });

    await runPostRunEvolution(config, llm, "goal", makeResult(), Date.now(), [], []);

    const skills = await store.querySkills("", 100);
    expect(skills).toHaveLength(0);
  });
});

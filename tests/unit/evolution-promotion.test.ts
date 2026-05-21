import { describe, it, expect } from "bun:test";
import { InMemoryEvolutionStore } from "../../packages/ai/src/evolution/store-memory.ts";
import { runPostRunEvolution } from "../../packages/ai/src/evolution/engine.ts";
import type { AgentRunResult, LLMProvider } from "../../packages/ai/src/types.ts";
import type { EvolutionConfig } from "../../packages/ai/src/evolution/types.ts";

const dummyLlm: LLMProvider = { name: "dummy", async chat() { return { content: "", model: "dummy" }; } };
const completed: AgentRunResult = { result: "ok", iterations: 1, toolCalls: [], taskCalls: [], status: "completed" };

async function seedStrategy(store: InMemoryEvolutionStore, content: string, utility: number, applications: number): Promise<void> {
  // storeStrategy sets createdAt/updatedAt/id; utility & applications come from input.
  await store.storeStrategy({ content, source: ["seed"], utility, applications });
}

function promoCfg(store: InMemoryEvolutionStore, minUtility: number, minApplications: number): EvolutionConfig {
  return {
    store,
    capture: () => false, // don't record extra experiences
    skillPromotion: { enabled: true, minUtility, minApplications },
  };
}

describe("evolution skill promotion (runPostRunEvolution step 5)", () => {
  it("promotes a strategy that meets utility AND applications thresholds into an evolved skill", async () => {
    const store = new InMemoryEvolutionStore();
    await seedStrategy(store, "Always validate inputs before calling tools.", 0.8, 5);

    await runPostRunEvolution(promoCfg(store, 0.7, 5), dummyLlm, "goal", completed, Date.now(), [], []);

    const skills = await store.querySkills("", 100);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.source).toBe("evolved");
    expect(skills[0]!.prompt).toBe("Always validate inputs before calling tools.");
    expect(skills[0]!.name).toMatch(/^skill-/);
  });

  it("does NOT promote when utility is below the threshold", async () => {
    const store = new InMemoryEvolutionStore();
    await seedStrategy(store, "low-utility strategy", 0.5, 10);
    await runPostRunEvolution(promoCfg(store, 0.7, 5), dummyLlm, "goal", completed, Date.now(), [], []);
    expect(await store.querySkills("", 100)).toHaveLength(0);
  });

  it("does NOT promote when applications are below the threshold", async () => {
    const store = new InMemoryEvolutionStore();
    await seedStrategy(store, "high-utility but unproven", 0.9, 2);
    await runPostRunEvolution(promoCfg(store, 0.7, 5), dummyLlm, "goal", completed, Date.now(), [], []);
    expect(await store.querySkills("", 100)).toHaveLength(0);
  });

  it("does NOT double-promote the same strategy on a second pass (idempotent)", async () => {
    const store = new InMemoryEvolutionStore();
    await seedStrategy(store, "proven strategy", 0.85, 6);
    const cfg = promoCfg(store, 0.7, 5);
    await runPostRunEvolution(cfg, dummyLlm, "goal", completed, Date.now(), [], []);
    await runPostRunEvolution(cfg, dummyLlm, "goal", completed, Date.now(), [], []);
    expect(await store.querySkills("", 100)).toHaveLength(1);
  });

  it("uses the configured default thresholds (0.7 / 5) when skillPromotion is omitted", async () => {
    const store = new InMemoryEvolutionStore();
    // utility 0.75 >= 0.7 default, applications 5 >= 5 default => should promote
    await seedStrategy(store, "default-threshold strategy", 0.75, 5);
    await runPostRunEvolution({ store, capture: () => false }, dummyLlm, "goal", completed, Date.now(), [], []);
    expect(await store.querySkills("", 100)).toHaveLength(1);
  });
});

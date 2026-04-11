import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { InMemoryEvolutionStore } from "../../packages/ai/src/evolution/store-memory.js";
import { SqliteEvolutionStore } from "../../packages/ai/src/evolution/store-sqlite.js";
import type { EvolutionStore } from "../../packages/ai/src/evolution/types.js";
import type { AgentSkill } from "../../packages/ai/src/types.js";

/* ------------------------------------------------------------------ */
/*  Shared test factory — runs identical tests against both stores     */
/* ------------------------------------------------------------------ */

function makeExperience(overrides: Record<string, unknown> = {}) {
  return {
    goal: "fix login bug",
    outcome: "success" as const,
    trajectory: [
      {
        tool: "read_file",
        args: { path: "auth.ts" },
        result: "code",
        status: "success" as const,
        iteration: 0,
      },
    ],
    iterations: 3,
    tokenUsage: 1000,
    duration: 5000,
    skillsUsed: ["debug"],
    ...overrides,
  };
}

function makeStrategy(overrides: Record<string, unknown> = {}) {
  return {
    content: "When tests fail, read the test first",
    source: ["exp_1"],
    utility: 0.5,
    applications: 0,
    ...overrides,
  };
}

function makeSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    name: "tdd-debug",
    description: "Test-driven debugging skill",
    trigger: "on test failure",
    prompt: "When a test fails, read the test file first...",
    source: "evolved",
    utility: 0.8,
    ...overrides,
  };
}

function runStoreTests(
  label: string,
  createStore: () => EvolutionStore,
) {
  describe(label, () => {
    let store: EvolutionStore;

    beforeEach(() => {
      store = createStore();
    });

    /* ============= Experiences ============= */

    describe("experiences", () => {
      it("records and queries experiences by goal keyword", async () => {
        const id = await store.recordExperience(makeExperience());
        expect(id).toMatch(/^exp_/);

        const results = await store.queryExperiences({ goal: "login" });
        expect(results).toHaveLength(1);
        expect(results[0]!.goal).toBe("fix login bug");
        expect(results[0]!.outcome).toBe("success");
        expect(results[0]!.id).toBe(id);
      });

      it("filters by outcome", async () => {
        await store.recordExperience(makeExperience({ goal: "task A", outcome: "success" }));
        await store.recordExperience(makeExperience({ goal: "task B", outcome: "failure" }));
        await store.recordExperience(makeExperience({ goal: "task C", outcome: "partial" }));

        const failures = await store.queryExperiences({ outcome: "failure" });
        expect(failures).toHaveLength(1);
        expect(failures[0]!.goal).toBe("task B");

        const successes = await store.queryExperiences({ outcome: "success" });
        expect(successes).toHaveLength(1);
        expect(successes[0]!.goal).toBe("task A");
      });

      it("filters by since date", async () => {
        await store.recordExperience(makeExperience({ goal: "old task" }));

        // Small delay to ensure timestamp ordering
        const sinceDate = new Date(Date.now() + 1000).toISOString();

        const results = await store.queryExperiences({ since: sinceDate });
        expect(results).toHaveLength(0);

        // Query without since should find the old task
        const allResults = await store.queryExperiences({});
        expect(allResults.length).toBeGreaterThanOrEqual(1);
      });

      it("respects limit", async () => {
        for (let i = 0; i < 5; i++) {
          await store.recordExperience(makeExperience({ goal: `task ${i}` }));
        }
        const results = await store.queryExperiences({ limit: 3 });
        expect(results).toHaveLength(3);
      });

      it("returns empty for non-matching keyword", async () => {
        await store.recordExperience(makeExperience({ goal: "fix login bug" }));
        const results = await store.queryExperiences({ goal: "database" });
        expect(results).toHaveLength(0);
      });

      it("preserves trajectory data", async () => {
        const trajectory = [
          { tool: "read_file", args: { path: "a.ts" }, result: "code", status: "success" as const, iteration: 0 },
          { tool: "write_file", args: { path: "a.ts", content: "fixed" }, result: "ok", status: "success" as const, iteration: 1 },
          { tool: "run_test", args: {}, result: "fail", status: "error" as const, iteration: 2 },
        ];
        await store.recordExperience(makeExperience({ trajectory }));
        const results = await store.queryExperiences({});
        expect(results[0]!.trajectory).toHaveLength(3);
        expect(results[0]!.trajectory[2]!.status).toBe("error");
      });

      it("preserves metadata", async () => {
        const metadata = { source: "test", priority: 5, tags: ["a", "b"] };
        await store.recordExperience(makeExperience({ metadata }));
        const results = await store.queryExperiences({});
        expect(results[0]!.metadata).toEqual(metadata);
      });

      it("sets recordedAt automatically", async () => {
        const before = new Date().toISOString();
        await store.recordExperience(makeExperience());
        const after = new Date().toISOString();
        const results = await store.queryExperiences({});
        expect(results[0]!.recordedAt >= before).toBe(true);
        expect(results[0]!.recordedAt <= after).toBe(true);
      });

      it("empty store returns empty results", async () => {
        const results = await store.queryExperiences({});
        expect(results).toHaveLength(0);
      });

      it("handles large trajectory arrays", async () => {
        const bigTrajectory = Array.from({ length: 100 }, (_, i) => ({
          tool: `tool_${i}`,
          args: { index: i, data: "x".repeat(100) },
          result: { value: i },
          status: "success" as const,
          iteration: i,
        }));
        await store.recordExperience(makeExperience({ trajectory: bigTrajectory }));
        const results = await store.queryExperiences({});
        expect(results[0]!.trajectory).toHaveLength(100);
      });
    });

    /* ============= Strategies ============= */

    describe("strategies", () => {
      it("stores and queries strategies by keyword", async () => {
        const id = await store.storeStrategy(makeStrategy());
        expect(id).toMatch(/^strat_/);

        const results = await store.queryStrategies("tests fail", 5);
        expect(results).toHaveLength(1);
        expect(results[0]!.content).toContain("tests fail");
      });

      it("empty query returns all strategies sorted by utility", async () => {
        await store.storeStrategy(makeStrategy({ content: "Low utility", utility: 0.2 }));
        await store.storeStrategy(makeStrategy({ content: "High utility", utility: 0.9 }));
        await store.storeStrategy(makeStrategy({ content: "Mid utility", utility: 0.5 }));

        const results = await store.queryStrategies("", 10);
        expect(results).toHaveLength(3);
        expect(results[0]!.content).toBe("High utility");
        expect(results[1]!.content).toBe("Mid utility");
        expect(results[2]!.content).toBe("Low utility");
      });

      it("keyword search ranks by relevance then utility", async () => {
        await store.storeStrategy(makeStrategy({ content: "Always check error logs first", utility: 0.3 }));
        await store.storeStrategy(makeStrategy({ content: "Read error messages carefully, check error codes", utility: 0.9 }));
        await store.storeStrategy(makeStrategy({ content: "Unrelated strategy about deployment", utility: 0.8 }));

        const results = await store.queryStrategies("error", 5);
        expect(results).toHaveLength(2);
        // Both match "error", non-matching "deployment" excluded
        expect(results.every((r) => r.content.includes("error"))).toBe(true);
      });

      it("updates utility with positive delta", async () => {
        const id = await store.storeStrategy(makeStrategy({ content: "Check logs", utility: 0.5 }));
        await store.updateStrategyUtility(id, 0.1);

        const results = await store.queryStrategies("logs", 5);
        expect(results[0]!.utility).toBeCloseTo(0.6);
      });

      it("updates utility with negative delta", async () => {
        const id = await store.storeStrategy(makeStrategy({ content: "Check logs", utility: 0.5 }));
        await store.updateStrategyUtility(id, -0.2);

        const results = await store.queryStrategies("logs", 5);
        expect(results[0]!.utility).toBeCloseTo(0.3);
      });

      it("clamps utility to 1 on overflow", async () => {
        const id = await store.storeStrategy(makeStrategy({ content: "Test clamp up", utility: 0.95 }));
        await store.updateStrategyUtility(id, 0.2);

        const results = await store.queryStrategies("clamp", 5);
        expect(results[0]!.utility).toBe(1.0);
      });

      it("clamps utility to 0 on underflow", async () => {
        const id = await store.storeStrategy(makeStrategy({ content: "Test clamp down", utility: 0.05 }));
        await store.updateStrategyUtility(id, -0.3);

        const results = await store.queryStrategies("clamp", 5);
        expect(results[0]!.utility).toBe(0.0);
      });

      it("increments applications", async () => {
        const id = await store.storeStrategy(makeStrategy({ content: "Apply X always", utility: 0.5 }));
        await store.incrementStrategyApplications(id);
        await store.incrementStrategyApplications(id);
        await store.incrementStrategyApplications(id);

        const results = await store.queryStrategies("Apply", 5);
        expect(results[0]!.applications).toBe(3);
      });

      it("sets createdAt and updatedAt automatically", async () => {
        const before = new Date().toISOString();
        await store.storeStrategy(makeStrategy());
        const after = new Date().toISOString();

        const results = await store.queryStrategies("", 1);
        expect(results[0]!.createdAt >= before).toBe(true);
        expect(results[0]!.createdAt <= after).toBe(true);
        expect(results[0]!.updatedAt >= before).toBe(true);
      });

      it("updatedAt changes on utility update", async () => {
        const id = await store.storeStrategy(makeStrategy({ content: "Update test" }));
        const before = await store.queryStrategies("Update test", 1);
        const originalUpdatedAt = before[0]!.updatedAt;

        // Small delay to ensure different timestamp
        await new Promise((r) => setTimeout(r, 10));
        await store.updateStrategyUtility(id, 0.1);

        const after = await store.queryStrategies("Update test", 1);
        expect(after[0]!.updatedAt >= originalUpdatedAt).toBe(true);
      });

      it("handles special characters in content", async () => {
        const content = `When seeing "error 404", check URL encoding & query params: path?key=val&key2=val2`;
        await store.storeStrategy(makeStrategy({ content }));
        const results = await store.queryStrategies("error", 5);
        expect(results[0]!.content).toBe(content);
      });

      it("empty store returns empty results", async () => {
        const results = await store.queryStrategies("anything", 5);
        expect(results).toHaveLength(0);
      });

      it("respects k limit", async () => {
        for (let i = 0; i < 10; i++) {
          await store.storeStrategy(makeStrategy({ content: `Strategy item ${i}`, utility: i / 10 }));
        }
        const results = await store.queryStrategies("", 3);
        expect(results).toHaveLength(3);
      });
    });

    /* ============= Evolved Skills ============= */

    describe("evolved skills", () => {
      it("stores and queries skills", async () => {
        const id = await store.storeSkill(makeSkill());
        expect(id).toMatch(/^skill_/);

        const results = await store.querySkills("debug", 5);
        expect(results).toHaveLength(1);
        expect(results[0]!.name).toBe("tdd-debug");
        expect(results[0]!.description).toBe("Test-driven debugging skill");
      });

      it("searches across name, description, and trigger", async () => {
        await store.storeSkill(makeSkill({ name: "alpha", description: "First skill", trigger: "on startup" }));
        await store.storeSkill(makeSkill({ name: "beta", description: "Second skill", trigger: "on deploy" }));

        // Search by name
        const byName = await store.querySkills("alpha", 5);
        expect(byName).toHaveLength(1);

        // Search by description
        const byDesc = await store.querySkills("Second", 5);
        expect(byDesc).toHaveLength(1);

        // Search by trigger
        const byTrigger = await store.querySkills("deploy", 5);
        expect(byTrigger).toHaveLength(1);
        expect(byTrigger[0]!.name).toBe("beta");
      });

      it("empty query returns all skills", async () => {
        await store.storeSkill(makeSkill({ name: "skill-a" }));
        await store.storeSkill(makeSkill({ name: "skill-b" }));
        const results = await store.querySkills("", 10);
        expect(results).toHaveLength(2);
      });

      it("respects k limit", async () => {
        for (let i = 0; i < 5; i++) {
          await store.storeSkill(makeSkill({ name: `skill-${i}` }));
        }
        const results = await store.querySkills("", 3);
        expect(results).toHaveLength(3);
      });

      it("preserves skill fields", async () => {
        const skill = makeSkill({
          tools: ["read_file", "write_file"],
          metadata: { origin: "test" },
        });
        await store.storeSkill(skill);

        const results = await store.querySkills("debug", 5);
        expect(results[0]!.tools).toEqual(["read_file", "write_file"]);
        expect(results[0]!.source).toBe("evolved");
        expect(results[0]!.utility).toBe(0.8);
      });
    });

    /* ============= Pruning ============= */

    describe("pruning", () => {
      it("prunes strategies below minUtility", async () => {
        await store.storeStrategy(makeStrategy({ content: "Good", utility: 0.8 }));
        await store.storeStrategy(makeStrategy({ content: "Bad", utility: 0.05 }));
        await store.storeStrategy(makeStrategy({ content: "OK", utility: 0.3 }));

        const pruned = await store.pruneStrategies({ minUtility: 0.1 });
        expect(pruned).toBe(1);

        const remaining = await store.queryStrategies("", 10);
        expect(remaining).toHaveLength(2);
        expect(remaining.every((r) => r.utility >= 0.1)).toBe(true);
      });

      it("caps at maxStrategies keeping highest utility", async () => {
        await store.storeStrategy(makeStrategy({ content: "Top", utility: 0.9 }));
        await store.storeStrategy(makeStrategy({ content: "Mid", utility: 0.5 }));
        await store.storeStrategy(makeStrategy({ content: "Low", utility: 0.1 }));

        const pruned = await store.pruneStrategies({ maxStrategies: 2 });
        expect(pruned).toBe(1);

        const remaining = await store.queryStrategies("", 10);
        expect(remaining).toHaveLength(2);
        expect(remaining[0]!.content).toBe("Top");
        expect(remaining[1]!.content).toBe("Mid");
      });

      it("combines minUtility and maxStrategies", async () => {
        await store.storeStrategy(makeStrategy({ content: "A", utility: 0.9 }));
        await store.storeStrategy(makeStrategy({ content: "B", utility: 0.7 }));
        await store.storeStrategy(makeStrategy({ content: "C", utility: 0.3 }));
        await store.storeStrategy(makeStrategy({ content: "D", utility: 0.05 }));

        const pruned = await store.pruneStrategies({ minUtility: 0.1, maxStrategies: 2 });
        // D removed by minUtility, then C removed by maxStrategies cap
        expect(pruned).toBe(2);

        const remaining = await store.queryStrategies("", 10);
        expect(remaining).toHaveLength(2);
      });

      it("returns 0 when nothing to prune", async () => {
        await store.storeStrategy(makeStrategy({ content: "Fine", utility: 0.8 }));
        const pruned = await store.pruneStrategies({ minUtility: 0.1, maxStrategies: 100 });
        expect(pruned).toBe(0);
      });

      it("handles empty store", async () => {
        const pruned = await store.pruneStrategies({ minUtility: 0.1, maxStrategies: 10 });
        expect(pruned).toBe(0);
      });
    });

    /* ============= Stats ============= */

    describe("stats", () => {
      it("returns correct stats", async () => {
        await store.recordExperience(makeExperience({ goal: "a" }));
        await store.recordExperience(makeExperience({ goal: "b" }));
        await store.storeStrategy(makeStrategy({ content: "S1", utility: 0.6 }));
        await store.storeStrategy(makeStrategy({ content: "S2", utility: 0.8 }));
        await store.storeSkill(makeSkill({ name: "sk1" }));

        const stats = await store.getStats();
        expect(stats.totalExperiences).toBe(2);
        expect(stats.totalStrategies).toBe(2);
        expect(stats.totalEvolvedSkills).toBe(1);
        expect(stats.averageUtility).toBeCloseTo(0.7);
      });

      it("returns zero averageUtility for empty store", async () => {
        const stats = await store.getStats();
        expect(stats.totalExperiences).toBe(0);
        expect(stats.totalStrategies).toBe(0);
        expect(stats.totalEvolvedSkills).toBe(0);
        expect(stats.averageUtility).toBe(0);
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Run tests for InMemoryEvolutionStore                               */
/* ------------------------------------------------------------------ */

runStoreTests("InMemoryEvolutionStore", () => new InMemoryEvolutionStore());

/* ------------------------------------------------------------------ */
/*  Run tests for SqliteEvolutionStore                                 */
/* ------------------------------------------------------------------ */

runStoreTests("SqliteEvolutionStore", () => {
  const db = new Database(":memory:");
  return new SqliteEvolutionStore(db as never);
});

/* ------------------------------------------------------------------ */
/*  SQLite-specific tests                                              */
/* ------------------------------------------------------------------ */

describe("SqliteEvolutionStore (persistence)", () => {
  it("persists data across instances on the same database", async () => {
    const db = new Database(":memory:");
    const store1 = new SqliteEvolutionStore(db as never);

    const expId = await store1.recordExperience(makeExperience({ goal: "persist test" }));
    const stratId = await store1.storeStrategy(makeStrategy({ content: "persistent strategy" }));
    const skillId = await store1.storeSkill(makeSkill({ name: "persistent-skill" }));

    // Create a new instance on the same DB (simulates reopening)
    const store2 = new SqliteEvolutionStore(db as never);

    const exps = await store2.queryExperiences({ goal: "persist" });
    expect(exps).toHaveLength(1);
    expect(exps[0]!.id).toBe(expId);

    const strats = await store2.queryStrategies("persistent", 5);
    expect(strats).toHaveLength(1);
    expect(strats[0]!.id).toBe(stratId);

    const skills = await store2.querySkills("persistent", 5);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("persistent-skill");
  });

  it("creates tables automatically on construction", () => {
    const db = new Database(":memory:");
    new SqliteEvolutionStore(db as never);

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(tables).toContain("capstan_experiences");
    expect(tables).toContain("capstan_strategies");
    expect(tables).toContain("capstan_evolved_skills");
  });

  it("creates indexes", () => {
    const db = new Database(":memory:");
    new SqliteEvolutionStore(db as never);

    const indexes = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .all() as { name: string }[]
    ).map((r) => r.name);

    expect(indexes).toContain("idx_experiences_outcome");
    expect(indexes).toContain("idx_strategies_utility");
  });

  it("handles corrupted JSON gracefully", async () => {
    const db = new Database(":memory:");
    const store = new SqliteEvolutionStore(db as never);

    // Manually insert a row with bad JSON
    db.exec(
      `INSERT INTO capstan_experiences (id, goal, outcome, trajectory, iterations, token_usage, duration, skills_used, recorded_at, metadata) VALUES ('exp_bad', 'test', 'success', 'not-json', 1, 0, 0, 'not-json', '2024-01-01', '{broken')`,
    );

    const results = await store.queryExperiences({});
    expect(results).toHaveLength(1);
    expect(results[0]!.goal).toBe("test");
    // Corrupted fields fall back to defaults
    expect(results[0]!.trajectory).toEqual([]);
    expect(results[0]!.skillsUsed).toEqual([]);
  });

  it("handles concurrent writes (100 rapid inserts)", async () => {
    const db = new Database(":memory:");
    const store = new SqliteEvolutionStore(db as never);

    const promises: Promise<string>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        store.recordExperience(makeExperience({ goal: `concurrent task ${i}` })),
      );
    }
    const ids = await Promise.all(promises);
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);

    const stats = await store.getStats();
    expect(stats.totalExperiences).toBe(100);
  });

  it("special characters in goal and content are preserved", async () => {
    const db = new Database(":memory:");
    const store = new SqliteEvolutionStore(db as never);

    const goal = `Fix "error 404" & encode: path?key=val\nnewline\ttab\u00e9\u{1F600}`;
    await store.recordExperience(makeExperience({ goal }));

    const results = await store.queryExperiences({});
    expect(results[0]!.goal).toBe(goal);

    const content = `Strategy with 'quotes' and "double quotes" & special <chars>`;
    await store.storeStrategy(makeStrategy({ content }));
    const strats = await store.queryStrategies("quotes", 5);
    expect(strats[0]!.content).toBe(content);
  });
});

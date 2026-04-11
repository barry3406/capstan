# Evolution Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add self-evolution primitives — structured experience recording, strategy distillation, skill crystallization, and the evolution lifecycle. Agents get smarter across runs.

**Architecture:** New `packages/ai/src/evolution/` module with: types, SqliteEvolutionStore, LlmDistiller, and engine integration. The evolution engine hooks into `onRunComplete` (from Plan 1) to record experiences and trigger post-run distillation. Strategies are injected into the system prompt as a prompt layer at run start. High-utility strategies are promoted to AgentSkill (from Plan 2).

**Tech Stack:** TypeScript, Bun test, SQLite (via better-sqlite3/bun:sqlite), existing LLMProvider for distillation

**Dependencies:** Plan 1 (onRunComplete hook), Plan 2 (AgentSkill type, defineSkill)

---

## File Structure

```
packages/ai/src/
  evolution/
    types.ts                CREATE — Experience, Strategy, TrajectoryStep, Distiller,
                                     EvolutionStore, EvolutionConfig, etc.
    store-sqlite.ts         CREATE — SqliteEvolutionStore implementation
    store-memory.ts         CREATE — InMemoryEvolutionStore (for tests)
    distiller.ts            CREATE — LlmDistiller + prompts
    engine.ts               CREATE — buildExperience(), runPostRunEvolution(),
                                     injectStrategies(), updateUtility()
    index.ts                CREATE — re-exports
  loop/engine.ts            MODIFY — wire evolution into run lifecycle
  index.ts                  MODIFY — export evolution module

tests/unit/
  evolution-store.test.ts   CREATE — SqliteEvolutionStore + InMemoryEvolutionStore CRUD tests
  evolution-engine.test.ts  CREATE — experience recording, distillation, utility feedback, promotion
```

---

### Task 1: Evolution types

**Files:**
- Create: `packages/ai/src/evolution/types.ts`

- [ ] **Step 1: Create evolution types**

```typescript
import type { AgentRunResult, AgentSkill, LLMProvider } from "../types.js";

// === Trajectory ===
export interface TrajectoryStep {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  status: "success" | "error";
  iteration: number;
}

// === Experience ===
export interface Experience {
  id: string;
  goal: string;
  outcome: "success" | "failure" | "partial";
  trajectory: TrajectoryStep[];
  iterations: number;
  tokenUsage: number;
  duration: number;
  skillsUsed: string[];
  recordedAt: string;
  metadata?: Record<string, unknown> | undefined;
}

// === Strategy ===
export interface Strategy {
  id: string;
  content: string;
  source: string[];
  utility: number;
  applications: number;
  createdAt: string;
  updatedAt: string;
}

// === Distiller ===
export interface Distiller {
  distill(experiences: Experience[]): Promise<Strategy[]>;
  consolidate(strategies: Strategy[]): Promise<Strategy[]>;
}

// === Pruning ===
export interface PruningConfig {
  maxStrategies?: number | undefined;
  minUtility?: number | undefined;
  maxAgeDays?: number | undefined;
}

// === Skill Promotion ===
export interface SkillPromotionConfig {
  enabled?: boolean | undefined;
  minApplications?: number | undefined;
  minUtility?: number | undefined;
}

// === Experience Query ===
export interface ExperienceQuery {
  goal?: string | undefined;
  outcome?: "success" | "failure" | "partial" | undefined;
  limit?: number | undefined;
  since?: string | undefined;
}

// === Evolution Stats ===
export interface EvolutionStats {
  totalExperiences: number;
  totalStrategies: number;
  totalEvolvedSkills: number;
  averageUtility: number;
}

// === Evolution Store ===
export interface EvolutionStore {
  recordExperience(exp: Omit<Experience, "id" | "recordedAt">): Promise<string>;
  queryExperiences(query: ExperienceQuery): Promise<Experience[]>;
  storeStrategy(strategy: Omit<Strategy, "id" | "createdAt" | "updatedAt">): Promise<string>;
  queryStrategies(query: string, k: number): Promise<Strategy[]>;
  updateStrategyUtility(id: string, delta: number): Promise<void>;
  incrementStrategyApplications(id: string): Promise<void>;
  storeSkill(skill: AgentSkill): Promise<string>;
  querySkills(query: string, k: number): Promise<AgentSkill[]>;
  pruneStrategies(config: PruningConfig): Promise<number>;
  getStats(): Promise<EvolutionStats>;
}

// === Evolution Config (on SmartAgentConfig) ===
export interface EvolutionConfig {
  store: EvolutionStore;
  capture?: "every-run" | "on-failure" | "on-success" | ((result: AgentRunResult) => boolean) | undefined;
  distillation?: "post-run" | "manual" | undefined;
  distiller?: Distiller | undefined;
  pruning?: PruningConfig | undefined;
  skillPromotion?: SkillPromotionConfig | undefined;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ai/src/evolution/types.ts
git commit -m "feat: add evolution type definitions (Experience, Strategy, Distiller, EvolutionStore)"
```

---

### Task 2: InMemoryEvolutionStore (for tests)

**Files:**
- Create: `packages/ai/src/evolution/store-memory.ts`
- Test: `tests/unit/evolution-store.test.ts`

- [ ] **Step 1: Write store tests**

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { InMemoryEvolutionStore } from "../../packages/ai/src/evolution/store-memory.js";
import type { Experience, Strategy } from "../../packages/ai/src/evolution/types.js";

describe("InMemoryEvolutionStore", () => {
  let store: InMemoryEvolutionStore;

  beforeEach(() => {
    store = new InMemoryEvolutionStore();
  });

  describe("experiences", () => {
    it("records and queries experiences", async () => {
      const id = await store.recordExperience({
        goal: "fix login bug",
        outcome: "success",
        trajectory: [{ tool: "read_file", args: { path: "auth.ts" }, result: "code", status: "success", iteration: 0 }],
        iterations: 3,
        tokenUsage: 1000,
        duration: 5000,
        skillsUsed: [],
      });
      expect(typeof id).toBe("string");

      const results = await store.queryExperiences({ goal: "login" });
      expect(results).toHaveLength(1);
      expect(results[0]!.goal).toBe("fix login bug");
      expect(results[0]!.outcome).toBe("success");
    });

    it("filters by outcome", async () => {
      await store.recordExperience({ goal: "task A", outcome: "success", trajectory: [], iterations: 1, tokenUsage: 0, duration: 0, skillsUsed: [] });
      await store.recordExperience({ goal: "task B", outcome: "failure", trajectory: [], iterations: 1, tokenUsage: 0, duration: 0, skillsUsed: [] });

      const failures = await store.queryExperiences({ outcome: "failure" });
      expect(failures).toHaveLength(1);
      expect(failures[0]!.goal).toBe("task B");
    });
  });

  describe("strategies", () => {
    it("stores and queries strategies", async () => {
      await store.storeStrategy({ content: "When tests fail, read the test first", source: ["exp1"], utility: 0.5, applications: 0 });
      const results = await store.queryStrategies("tests fail", 5);
      expect(results).toHaveLength(1);
      expect(results[0]!.content).toContain("tests fail");
    });

    it("updates utility", async () => {
      const id = await store.storeStrategy({ content: "Always check logs", source: [], utility: 0.5, applications: 0 });
      await store.updateStrategyUtility(id, 0.1);
      const results = await store.queryStrategies("logs", 5);
      expect(results[0]!.utility).toBeCloseTo(0.6);
    });

    it("clamps utility to [0, 1]", async () => {
      const id = await store.storeStrategy({ content: "Test", source: [], utility: 0.95, applications: 0 });
      await store.updateStrategyUtility(id, 0.2);
      const results = await store.queryStrategies("Test", 5);
      expect(results[0]!.utility).toBe(1.0);
    });

    it("increments applications", async () => {
      const id = await store.storeStrategy({ content: "Apply X", source: [], utility: 0.5, applications: 0 });
      await store.incrementStrategyApplications(id);
      await store.incrementStrategyApplications(id);
      const results = await store.queryStrategies("Apply", 5);
      expect(results[0]!.applications).toBe(2);
    });
  });

  describe("evolved skills", () => {
    it("stores and queries skills", async () => {
      await store.storeSkill({ name: "tdd-debug", description: "TDD debug", trigger: "on failure", prompt: "...", source: "evolved", utility: 0.8 });
      const results = await store.querySkills("debug", 5);
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe("tdd-debug");
    });
  });

  describe("pruning", () => {
    it("prunes strategies below minUtility", async () => {
      await store.storeStrategy({ content: "Good", source: [], utility: 0.8, applications: 5 });
      await store.storeStrategy({ content: "Bad", source: [], utility: 0.05, applications: 1 });
      await store.storeStrategy({ content: "OK", source: [], utility: 0.3, applications: 2 });

      const pruned = await store.pruneStrategies({ minUtility: 0.1 });
      expect(pruned).toBe(1);

      const remaining = await store.queryStrategies("", 10);
      expect(remaining).toHaveLength(2);
    });
  });

  describe("stats", () => {
    it("returns correct stats", async () => {
      await store.recordExperience({ goal: "a", outcome: "success", trajectory: [], iterations: 1, tokenUsage: 0, duration: 0, skillsUsed: [] });
      await store.storeStrategy({ content: "S1", source: [], utility: 0.6, applications: 0 });
      await store.storeStrategy({ content: "S2", source: [], utility: 0.8, applications: 0 });
      await store.storeSkill({ name: "sk1", description: "", trigger: "", prompt: "", source: "evolved", utility: 0.7 });

      const stats = await store.getStats();
      expect(stats.totalExperiences).toBe(1);
      expect(stats.totalStrategies).toBe(2);
      expect(stats.totalEvolvedSkills).toBe(1);
      expect(stats.averageUtility).toBeCloseTo(0.7);
    });
  });
});
```

- [ ] **Step 2: Implement InMemoryEvolutionStore**

```typescript
import type { Experience, ExperienceQuery, Strategy, EvolutionStore, EvolutionStats, PruningConfig, AgentSkill } from "./types.js";

export class InMemoryEvolutionStore implements EvolutionStore {
  private experiences: Experience[] = [];
  private strategies: Strategy[] = [];
  private skills: (AgentSkill & { id: string })[] = [];

  async recordExperience(exp: Omit<Experience, "id" | "recordedAt">): Promise<string> {
    const id = `exp_${crypto.randomUUID()}`;
    this.experiences.push({ ...exp, id, recordedAt: new Date().toISOString() });
    return id;
  }

  async queryExperiences(query: ExperienceQuery): Promise<Experience[]> {
    let results = [...this.experiences];
    if (query.outcome) results = results.filter(e => e.outcome === query.outcome);
    if (query.since) results = results.filter(e => e.recordedAt >= query.since!);
    if (query.goal) {
      const terms = query.goal.toLowerCase().split(/\W+/).filter(Boolean);
      results = results.filter(e => {
        const content = e.goal.toLowerCase();
        return terms.some(t => content.includes(t));
      });
    }
    return results.slice(0, query.limit ?? 50);
  }

  async storeStrategy(s: Omit<Strategy, "id" | "createdAt" | "updatedAt">): Promise<string> {
    const id = `strat_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.strategies.push({ ...s, id, createdAt: now, updatedAt: now });
    return id;
  }

  async queryStrategies(query: string, k: number): Promise<Strategy[]> {
    if (!query) return this.strategies.sort((a, b) => b.utility - a.utility).slice(0, k);
    const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
    return this.strategies
      .map(s => {
        const content = s.content.toLowerCase();
        const score = terms.filter(t => content.includes(t)).length / Math.max(terms.length, 1);
        return { s, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || b.s.utility - a.s.utility)
      .slice(0, k)
      .map(x => x.s);
  }

  async updateStrategyUtility(id: string, delta: number): Promise<void> {
    const s = this.strategies.find(x => x.id === id);
    if (s) {
      s.utility = Math.max(0, Math.min(1, s.utility + delta));
      s.updatedAt = new Date().toISOString();
    }
  }

  async incrementStrategyApplications(id: string): Promise<void> {
    const s = this.strategies.find(x => x.id === id);
    if (s) {
      s.applications++;
      s.updatedAt = new Date().toISOString();
    }
  }

  async storeSkill(skill: AgentSkill): Promise<string> {
    const id = `skill_${crypto.randomUUID()}`;
    this.skills.push({ ...skill, id });
    return id;
  }

  async querySkills(query: string, k: number): Promise<AgentSkill[]> {
    if (!query) return this.skills.slice(0, k);
    const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
    return this.skills
      .filter(s => {
        const content = `${s.name} ${s.description} ${s.trigger}`.toLowerCase();
        return terms.some(t => content.includes(t));
      })
      .slice(0, k);
  }

  async pruneStrategies(config: PruningConfig): Promise<number> {
    const before = this.strategies.length;
    this.strategies = this.strategies.filter(s => s.utility >= (config.minUtility ?? 0));
    if (config.maxStrategies && this.strategies.length > config.maxStrategies) {
      this.strategies.sort((a, b) => b.utility - a.utility);
      this.strategies = this.strategies.slice(0, config.maxStrategies);
    }
    return before - this.strategies.length;
  }

  async getStats(): Promise<EvolutionStats> {
    const avgUtility = this.strategies.length > 0
      ? this.strategies.reduce((sum, s) => sum + s.utility, 0) / this.strategies.length
      : 0;
    return {
      totalExperiences: this.experiences.length,
      totalStrategies: this.strategies.length,
      totalEvolvedSkills: this.skills.length,
      averageUtility: avgUtility,
    };
  }
}
```

- [ ] **Step 3: Run tests**

```bash
bun test tests/unit/evolution-store.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/evolution/store-memory.ts tests/unit/evolution-store.test.ts
git commit -m "feat: add InMemoryEvolutionStore with full CRUD + pruning"
```

---

### Task 3: SqliteEvolutionStore

**Files:**
- Create: `packages/ai/src/evolution/store-sqlite.ts`
- Modify: `tests/unit/evolution-store.test.ts` (add SQLite tests)

- [ ] **Step 1: Implement SqliteEvolutionStore**

Same interface as InMemoryEvolutionStore but backed by SQLite. Follow the exact pattern from `packages/ai/src/memory-sqlite.ts` (import SqliteConnection type, create tables, WAL mode, keyword search).

Schema:
```sql
CREATE TABLE IF NOT EXISTS capstan_experiences (
  id TEXT PRIMARY KEY, goal TEXT NOT NULL, outcome TEXT NOT NULL,
  trajectory TEXT NOT NULL, iterations INTEGER NOT NULL,
  token_usage INTEGER, duration INTEGER, skills_used TEXT,
  recorded_at TEXT NOT NULL, metadata TEXT
);
CREATE TABLE IF NOT EXISTS capstan_strategies (
  id TEXT PRIMARY KEY, content TEXT NOT NULL, source TEXT NOT NULL,
  utility REAL NOT NULL DEFAULT 0.5, applications INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS capstan_evolved_skills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
  trigger_text TEXT NOT NULL, prompt TEXT NOT NULL, utility REAL NOT NULL DEFAULT 0.5,
  tools TEXT, source TEXT, created_at TEXT NOT NULL, metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_strategies_utility ON capstan_strategies(utility DESC);
CREATE INDEX IF NOT EXISTS idx_experiences_outcome ON capstan_experiences(outcome);
```

- [ ] **Step 2: Add SQLite tests to evolution-store.test.ts**

Run the same test cases against SqliteEvolutionStore (using a temp file).

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/evolution/store-sqlite.ts tests/unit/evolution-store.test.ts
git commit -m "feat: add SqliteEvolutionStore — persistent evolution storage"
```

---

### Task 4: LLM Distiller

**Files:**
- Create: `packages/ai/src/evolution/distiller.ts`
- Test: `tests/unit/evolution-engine.test.ts`

- [ ] **Step 1: Implement LlmDistiller**

```typescript
import type { LLMProvider } from "../types.js";
import type { Distiller, Experience, Strategy } from "./types.js";

const DISTILLATION_PROMPT = `You are analyzing agent execution traces to extract reusable strategies.

For each experience, identify:
1. What approach worked (or failed) and why
2. General rules that would help in similar future tasks

Output as JSON array:
[{ "content": "When X happens, do Y because Z", "source": ["exp_id"] }]

Rules:
- Strategies must be general, not specific to one file or variable name
- Use "when/then/because" format
- Merge similar insights into one strategy
- Maximum 5 strategies per batch`;

const CONSOLIDATION_PROMPT = `You have a list of strategies that may overlap or contradict.
Merge duplicates, resolve contradictions (prefer higher-utility ones), and return a consolidated list.
Output as JSON array: [{ "content": "...", "source": [...all merged source IDs] }]
Maximum 10 consolidated strategies.`;

export class LlmDistiller implements Distiller {
  constructor(private llm: LLMProvider) {}

  async distill(experiences: Experience[]): Promise<Omit<Strategy, "id" | "createdAt" | "updatedAt">[]> {
    if (experiences.length === 0) return [];
    const input = experiences.map(e => ({
      id: e.id,
      goal: e.goal,
      outcome: e.outcome,
      tools: e.trajectory.map(t => `${t.tool}(${t.status})`).join(" -> "),
      iterations: e.iterations,
    }));

    const response = await this.llm.chat([
      { role: "system", content: DISTILLATION_PROMPT },
      { role: "user", content: JSON.stringify(input, null, 2) },
    ]);

    return parseStrategies(response.content);
  }

  async consolidate(strategies: Strategy[]): Promise<Omit<Strategy, "id" | "createdAt" | "updatedAt">[]> {
    if (strategies.length <= 5) return strategies.map(s => ({ content: s.content, source: s.source, utility: s.utility, applications: s.applications }));
    const input = strategies.map(s => ({ id: s.id, content: s.content, utility: s.utility, source: s.source }));

    const response = await this.llm.chat([
      { role: "system", content: CONSOLIDATION_PROMPT },
      { role: "user", content: JSON.stringify(input, null, 2) },
    ]);

    return parseStrategies(response.content);
  }
}

function parseStrategies(content: string): Omit<Strategy, "id" | "createdAt" | "updatedAt">[] {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as Array<{ content: string; source?: string[] }>;
    return parsed
      .filter(s => typeof s.content === "string" && s.content.length > 0)
      .map(s => ({
        content: s.content,
        source: s.source ?? [],
        utility: 0.5,
        applications: 0,
      }));
  } catch {
    return [];
  }
}

export { DISTILLATION_PROMPT, CONSOLIDATION_PROMPT, parseStrategies };
```

- [ ] **Step 2: Write tests for parseStrategies and distiller**

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/evolution/distiller.ts tests/unit/evolution-engine.test.ts
git commit -m "feat: add LlmDistiller — experience-to-strategy distillation"
```

---

### Task 5: Evolution engine integration

**Files:**
- Create: `packages/ai/src/evolution/engine.ts`
- Create: `packages/ai/src/evolution/index.ts`
- Modify: `packages/ai/src/types.ts` — add `evolution?: EvolutionConfig`
- Modify: `packages/ai/src/loop/engine.ts` — wire evolution into lifecycle
- Modify: `packages/ai/src/index.ts` — export evolution module

- [ ] **Step 1: Create evolution/engine.ts — core lifecycle functions**

```typescript
import type { AgentRunResult, AgentSkill, LLMProvider, PromptLayer } from "../types.js";
import type { EvolutionConfig, Experience, Strategy, TrajectoryStep } from "./types.js";
import { LlmDistiller } from "./distiller.js";

export function buildExperience(
  goal: string,
  result: AgentRunResult,
  startTime: number,
  skillsUsed: string[],
): Omit<Experience, "id" | "recordedAt"> {
  return {
    goal,
    outcome: result.status === "completed" ? "success" : result.status === "fatal" ? "failure" : "partial",
    trajectory: result.toolCalls.map((tc, i) => ({
      tool: tc.tool,
      args: (tc.args ?? {}) as Record<string, unknown>,
      result: tc.result,
      status: tc.status ?? "success",
      iteration: i,
    })),
    iterations: result.iterations,
    tokenUsage: 0,
    duration: Date.now() - startTime,
    skillsUsed,
  };
}

export function shouldCapture(config: EvolutionConfig, result: AgentRunResult): boolean {
  const policy = config.capture ?? "every-run";
  if (typeof policy === "function") return policy(result);
  if (policy === "every-run") return true;
  if (policy === "on-success") return result.status === "completed";
  if (policy === "on-failure") return result.status === "fatal";
  return true;
}

export async function runPostRunEvolution(
  config: EvolutionConfig,
  llm: LLMProvider,
  goal: string,
  result: AgentRunResult,
  startTime: number,
  skillsUsed: string[],
  retrievedStrategies: Strategy[],
): Promise<void> {
  try {
    // 1. Record experience
    if (shouldCapture(config, result)) {
      const exp = buildExperience(goal, result, startTime, skillsUsed);
      await config.store.recordExperience(exp);
    }

    // 2. Update utility of retrieved strategies
    for (const s of retrievedStrategies) {
      const delta = result.status === "completed" ? 0.1 : -0.05;
      await config.store.updateStrategyUtility(s.id, delta);
    }

    // 3. Distill (if post-run)
    if (config.distillation === "post-run") {
      const distiller = config.distiller ?? new LlmDistiller(llm);
      const recentExps = await config.store.queryExperiences({ limit: 10 });
      if (recentExps.length >= 3) {
        const newStrategies = await distiller.distill(recentExps);
        for (const s of newStrategies) {
          await config.store.storeStrategy(s);
        }
      }
    }

    // 4. Prune if configured
    if (config.pruning) {
      await config.store.pruneStrategies(config.pruning);
    }

    // 5. Skill promotion
    const promo = config.skillPromotion;
    if (promo?.enabled !== false) {
      const allStrategies = await config.store.queryStrategies("", 100);
      for (const s of allStrategies) {
        if (
          s.utility >= (promo?.minUtility ?? 0.7) &&
          s.applications >= (promo?.minApplications ?? 5)
        ) {
          const existing = await config.store.querySkills(s.content.slice(0, 30), 1);
          if (existing.length === 0) {
            await config.store.storeSkill({
              name: s.content.slice(0, 40).replace(/\W+/g, "-").toLowerCase(),
              description: s.content,
              trigger: s.content.split(",")[0] ?? s.content.slice(0, 60),
              prompt: s.content,
              source: "evolved",
              utility: s.utility,
            });
          }
        }
      }
    }
  } catch {
    // Evolution failure is non-fatal
  }
}

export function buildStrategyLayer(strategies: Strategy[]): PromptLayer | null {
  if (strategies.length === 0) return null;
  const lines = strategies.map(s => `- ${s.content} (reliability: ${Math.round(s.utility * 100)}%)`).join("\n");
  return {
    id: "evolution-strategies",
    content: `## Learned Strategies\n\nBased on past experience, these approaches have been effective:\n\n${lines}\n\nApply relevant strategies. They are guidelines, not mandates.`,
    position: "append",
    priority: 80,
  };
}
```

- [ ] **Step 2: Create evolution/index.ts re-exports**

```typescript
export type { Experience, Strategy, TrajectoryStep, Distiller, EvolutionStore, EvolutionConfig, ExperienceQuery, PruningConfig, SkillPromotionConfig, EvolutionStats } from "./types.js";
export { InMemoryEvolutionStore } from "./store-memory.js";
export { SqliteEvolutionStore, createSqliteEvolutionStore } from "./store-sqlite.js";
export { LlmDistiller } from "./distiller.js";
export { buildExperience, shouldCapture, runPostRunEvolution, buildStrategyLayer } from "./engine.js";
```

- [ ] **Step 3: Add `evolution` to SmartAgentConfig**

In `packages/ai/src/types.ts`, import and add:

```typescript
import type { EvolutionConfig } from "./evolution/types.js";
// In SmartAgentConfig:
  evolution?: EvolutionConfig | undefined;
```

- [ ] **Step 4: Wire evolution into loop/engine.ts**

At run start (after memory retrieval, before system prompt composition):

```typescript
  // Retrieve evolved strategies + skills
  let retrievedStrategies: Strategy[] = [];
  if (config.evolution?.store && !checkpoint) {
    retrievedStrategies = await config.evolution.store.queryStrategies(goal, 5);
    for (const s of retrievedStrategies) {
      await config.evolution.store.incrementStrategyApplications(s.id);
    }
    const strategyLayer = buildStrategyLayer(retrievedStrategies);
    if (strategyLayer) {
      promptConfig.layers = [...(promptConfig.layers ?? []), strategyLayer];
    }
    // Load evolved skills
    const evolvedSkills = await config.evolution.store.querySkills(goal, 5);
    if (evolvedSkills.length > 0) {
      // Merge with developer skills
      const allSkills = [...(config.skills ?? []), ...evolvedSkills];
      // Update config.skills reference for skill tool injection
      (config as any)._mergedSkills = allSkills;
    }
  }
```

In the `onRunComplete` hook (or after the main loop returns), trigger post-run evolution:

```typescript
  if (config.evolution) {
    // Fire-and-forget: don't block the return
    runPostRunEvolution(
      config.evolution,
      config.llm,
      goal,
      result,
      state.runStartTime,
      [], // skillsUsed — tracked via activate_skill calls
      retrievedStrategies,
    ).catch(() => {});
  }
```

- [ ] **Step 5: Export from index.ts**

Add to `packages/ai/src/index.ts`:

```typescript
// Evolution engine
export { InMemoryEvolutionStore, SqliteEvolutionStore, createSqliteEvolutionStore, LlmDistiller } from "./evolution/index.js";
export type { Experience, Strategy, TrajectoryStep, Distiller, EvolutionStore, EvolutionConfig, ExperienceQuery, PruningConfig, SkillPromotionConfig, EvolutionStats } from "./evolution/index.js";
```

- [ ] **Step 6: Write integration test**

Append to `tests/unit/evolution-engine.test.ts`:

```typescript
describe("Evolution integration", () => {
  it("records experience after successful run", async () => {
    const store = new InMemoryEvolutionStore();
    const agent = createSmartAgent({
      llm: mockLLM(["Done."]),
      tools: [],
      evolution: { store, capture: "every-run", distillation: "manual" },
    });

    await agent.run("Test goal");

    const exps = await store.queryExperiences({});
    expect(exps).toHaveLength(1);
    expect(exps[0]!.goal).toBe("Test goal");
    expect(exps[0]!.outcome).toBe("success");
  });

  it("injects strategies from store into prompt", async () => {
    const store = new InMemoryEvolutionStore();
    await store.storeStrategy({ content: "Always read tests first", source: [], utility: 0.8, applications: 3 });

    const sink: LLMMessage[][] = [];
    const agent = createSmartAgent({
      llm: mockLLM(["Done."], sink),
      tools: [],
      evolution: { store, distillation: "manual" },
    });

    await agent.run("Fix bug");

    const systemPrompt = sink[0]![0]!.content;
    expect(systemPrompt).toContain("Learned Strategies");
    expect(systemPrompt).toContain("Always read tests first");
  });
});
```

- [ ] **Step 7: Run all tests**

```bash
bun test tests/unit/evolution-store.test.ts tests/unit/evolution-engine.test.ts
npm test
```

- [ ] **Step 8: Commit**

```bash
git add packages/ai/src/evolution/ packages/ai/src/types.ts packages/ai/src/loop/engine.ts packages/ai/src/index.ts tests/unit/evolution-store.test.ts tests/unit/evolution-engine.test.ts
git commit -m "feat: add evolution engine — experience recording, distillation, strategy injection, skill promotion"
```

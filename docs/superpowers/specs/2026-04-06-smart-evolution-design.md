# Capstan Smart Agent + Self-Evolution Unified Design

## 1. Goals & Principles

**Goal**: Let developers build agents as smart as Claude Code in any domain, with self-evolution that makes them smarter over time, in ~30 lines of code.

**Two axes, one system:**
- **Axis 1 (Runtime Maturity)**: Close the engineering gap with Claude Code — reactive recovery, model fallback, tool result budgeting, token budget management, dynamic context enrichment
- **Axis 2 (Self-Evolution)**: Novel primitives — structured experience capture, strategy distillation, skill crystallization, evolution lifecycle

**The intersection is the Skill layer** — skills are both "what makes agents smart today" (strategies the developer defines) and "the output of evolution" (strategies the agent discovers).

**Design principles:**
- Framework provides interfaces + 1-2 built-in implementations; developers can replace anything
- New features are additive to `SmartAgentConfig` — zero breaking changes
- Every new primitive is independently useful; you don't need evolution to use skills, or skills to use reactive compact

---

## 2. Developer API

### Minimal (existing behavior preserved)

```typescript
const agent = createSmartAgent({
  llm: provider,
  tools: [readFile, writeFile],
});
await agent.run("Fix the bug in auth.ts");
```

### With runtime maturity

```typescript
const agent = createSmartAgent({
  llm: provider,
  fallbackLlm: cheapProvider,
  tools: [readFile, writeFile, runTests],
  tokenBudget: 80_000,
  toolResultBudget: { maxChars: 5000 },
});
```

### With skills

```typescript
const agent = createSmartAgent({
  llm: provider,
  tools: [readFile, writeFile, runTests, searchCode],
  skills: [
    defineSkill({
      name: "tdd-debug",
      trigger: "when tests fail or a bug needs fixing",
      prompt: "1. Read the failing test to understand the expected behavior\n"
        + "2. Read the source code being tested\n"
        + "3. Identify the discrepancy\n"
        + "4. Fix the source code\n"
        + "5. Run tests to verify\n"
        + "6. If still failing, repeat from step 1",
      tools: ["read_file", "write_file", "run_tests"],
    }),
  ],
});
```

### With self-evolution

```typescript
const agent = createSmartAgent({
  llm: provider,
  tools: [readFile, writeFile, runTests, searchCode],
  skills: [ /* developer-defined skills */ ],
  evolution: {
    store: new SqliteEvolutionStore("./agent-evolution.db"),
    capture: "every-run",
    distillation: "post-run",
  },
});

// Run 1: agent solves the task, experience recorded
await agent.run("Fix the login timeout bug");

// Run 10: agent has accumulated strategies, solves similar tasks faster
await agent.run("Fix the session expiry bug");

// Run 50: agent has crystallized a "debug auth issues" skill
```

---

## 3. New & Extended Type Definitions

### 3.1 SmartAgentConfig Extensions

```typescript
interface SmartAgentConfig {
  // --- EXISTING (unchanged) ---
  llm: LLMProvider;
  tools: AgentTool[];
  tasks?: AgentTask[];
  memory?: SmartAgentMemoryConfig;
  prompt?: PromptComposerConfig;
  stopHooks?: StopHook[];
  maxIterations?: number;
  contextWindowSize?: number;
  compaction?: Partial<{ snip: SnipConfig; microcompact: MicrocompactConfig; autocompact: AutocompactConfig }>;
  streaming?: StreamingExecutorConfig;
  toolCatalog?: ToolCatalogConfig;
  hooks?: SmartAgentHooks;

  // --- NEW: Runtime Maturity ---
  fallbackLlm?: LLMProvider;
  tokenBudget?: number | TokenBudgetConfig;
  toolResultBudget?: ToolResultBudgetConfig;

  // --- NEW: Skill Layer ---
  skills?: AgentSkill[];

  // --- NEW: Evolution ---
  evolution?: EvolutionConfig;
}
```

### 3.2 Runtime Maturity Types

```typescript
interface TokenBudgetConfig {
  maxOutputTokensPerTurn: number;
  nudgeAtPercent?: number;          // default 80 — inject "you have X% budget left" at this threshold
}

interface ToolResultBudgetConfig {
  maxChars: number;                 // default 5000 — truncate tool results beyond this
  preserveStructure?: boolean;      // default true — truncate at JSON boundary, not mid-value
}
```

### 3.3 Skill Types

```typescript
interface AgentSkill {
  name: string;
  description: string;
  trigger: string;                  // natural language: "when tests fail", "when debugging"
  prompt: string;                   // full strategy/instructions injected when skill is activated
  tools?: string[];                 // preferred tools for this skill (hints, not constraints)
  source?: "developer" | "evolved"; // origin — developer-defined or distilled from experience
  utility?: number;                 // 0-1 score, updated by evolution engine
  metadata?: Record<string, unknown>;
}

// Helper for ergonomic skill definition
function defineSkill(def: AgentSkill): AgentSkill;
```

### 3.4 Evolution Types

```typescript
// --- Experience: structured run trajectory ---
interface Experience {
  id: string;
  goal: string;
  outcome: "success" | "failure" | "partial";
  trajectory: TrajectoryStep[];
  iterations: number;
  tokenUsage: number;
  duration: number;
  skillsUsed: string[];
  recordedAt: string;
  metadata?: Record<string, unknown>;
}

interface TrajectoryStep {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  status: "success" | "error";
  iteration: number;
}

// --- Strategy: distilled from experiences ---
interface Strategy {
  id: string;
  content: string;                  // natural language rule: "when X, do Y because Z"
  source: string[];                 // experience IDs this was distilled from
  utility: number;                  // 0-1, updated on every application
  applications: number;             // how many times retrieved
  createdAt: string;
  updatedAt: string;
}

// --- Distiller: transforms experiences into strategies ---
interface Distiller {
  distill(experiences: Experience[]): Promise<Strategy[]>;
  consolidate(strategies: Strategy[]): Promise<Strategy[]>;
}

// --- Evolution Store: persistence for the evolution engine ---
interface EvolutionStore {
  // Experiences
  recordExperience(exp: Omit<Experience, "id" | "recordedAt">): Promise<string>;
  queryExperiences(query: ExperienceQuery): Promise<Experience[]>;

  // Strategies
  storeStrategy(strategy: Omit<Strategy, "id" | "createdAt" | "updatedAt">): Promise<string>;
  queryStrategies(query: string, k: number): Promise<Strategy[]>;
  updateStrategyUtility(id: string, delta: number): Promise<void>;

  // Evolved skills
  storeSkill(skill: AgentSkill): Promise<string>;
  querySkills(query: string, k: number): Promise<AgentSkill[]>;

  // Lifecycle
  pruneStrategies(config: PruningConfig): Promise<number>;
  getStats(): Promise<EvolutionStats>;
}

interface ExperienceQuery {
  goal?: string;                    // semantic search on goal text
  outcome?: "success" | "failure" | "partial";
  limit?: number;
  since?: string;                   // ISO date
}

interface PruningConfig {
  maxStrategies?: number;           // default 200
  minUtility?: number;              // default 0.1 — below this, prune
  maxAge?: number;                  // days — prune older than this
}

interface EvolutionStats {
  totalExperiences: number;
  totalStrategies: number;
  totalEvolvedSkills: number;
  averageUtility: number;
}

// --- Evolution Config: what developers set ---
interface EvolutionConfig {
  store: EvolutionStore;
  capture?: "every-run" | "on-failure" | "on-success" | ((result: AgentRunResult) => boolean);
  distillation?: "post-run" | "manual";
  distiller?: Distiller;            // default: LlmDistiller (uses config.llm)
  pruning?: PruningConfig;
  skillPromotion?: SkillPromotionConfig;
}

interface SkillPromotionConfig {
  enabled?: boolean;                // default true
  minExperiences?: number;          // default 5 — need N successful uses before promoting to skill
  minUtility?: number;              // default 0.7 — strategy must have this utility to become a skill
}
```

### 3.5 Background Agent Types

```typescript
interface BackgroundAgentConfig {
  llm?: LLMProvider;                // default: parent's llm
  tools?: AgentTool[];              // restricted tool set
  maxIterations?: number;           // default: 5
  systemPrompt?: string;
}

// Added to SmartAgentHooks
interface SmartAgentHooks {
  // ... existing hooks ...

  // NEW: fired after each iteration completes (tools executed, before next LLM call)
  afterIteration?: (state: IterationSnapshot) => Promise<void>;

  // NEW: fired when run completes (success or failure), before returning
  onRunComplete?: (result: AgentRunResult) => Promise<void>;
}

interface IterationSnapshot {
  iteration: number;
  messages: LLMMessage[];
  toolCalls: AgentToolCallRecord[];
  estimatedTokens: number;
}
```

---

## 4. Layer 1: Runtime Maturity

### 4.1 Reactive Compact (enhanced)

**Current**: engine.ts catch block calls `reactiveCompact()` which just keeps system + last 4 messages.

**New**: Two-phase recovery on context_limit:
1. Try `autocompact()` first (LLM-driven, extracts memories)
2. If autocompact fails, fall back to existing aggressive `reactiveCompact()`
3. If both fail after MAX_REACTIVE_COMPACT_RETRIES (2), return fatal

**Changes to**: `engine.ts` catch block (lines 219-259), `continuation.ts` decideContinuation.

```typescript
// engine.ts — enhanced error handler
if (finishReason === "context_limit") {
  // Phase 1: try LLM-driven compact
  if (state.compaction.autocompactFailures < maxAutocompactFailures) {
    const acResult = await autocompact(config.llm, state.messages, autocompactConfig);
    if (!acResult.failed) {
      state.messages = acResult.messages;
      // persist memory candidates
      if (config.memory && acResult.memoryCandidates.length > 0) {
        for (const c of acResult.memoryCandidates) {
          await config.memory.store.store({ content: c, scope: config.memory.scope });
        }
      }
      continue; // retry with compacted context
    }
    state.compaction.autocompactFailures++;
  }
  // Phase 2: aggressive reactive compact
  if (state.compaction.reactiveCompactRetries < MAX_REACTIVE_COMPACT_RETRIES) {
    state.messages = reactiveCompact(state.messages);
    state.compaction.reactiveCompactRetries++;
    continue;
  }
  // Phase 3: fatal
  return { result: null, status: "fatal", error: "Context overflow unrecoverable", ... };
}
```

### 4.2 Model Fallback

**New field**: `fallbackLlm?: LLMProvider` on `SmartAgentConfig`.

**Changes to**: `streaming-executor.ts` `executeModelAndTools()`.

When the primary LLM call throws a non-context-limit error (network error, rate limit, 500), retry once with `fallbackLlm` if configured.

```typescript
// streaming-executor.ts — in both streaming and non-streaming paths
try {
  response = await llm.chat(messages, llmOptions);
} catch (error) {
  if (fallbackLlm && !isContextLimitError(error)) {
    response = await fallbackLlm.chat(messages, llmOptions);
  } else {
    throw error;
  }
}
```

No retry loop — single fallback attempt. The engine's existing continuation logic handles further recovery.

### 4.3 Tool Result Budgeting

**New field**: `toolResultBudget?: ToolResultBudgetConfig` on `SmartAgentConfig`.

**Changes to**: `engine.ts` `formatToolResult()`.

```typescript
function formatToolResult(tool: string, result: unknown, budget?: ToolResultBudgetConfig): string {
  const json = JSON.stringify(result, null, 2);
  const maxChars = budget?.maxChars ?? Infinity;
  if (json.length <= maxChars) {
    return `Tool "${tool}" returned:\n${json}`;
  }
  const truncated = budget?.preserveStructure
    ? truncateAtJsonBoundary(json, maxChars)
    : json.slice(0, maxChars);
  return `Tool "${tool}" returned (truncated, ${json.length} chars total):\n${truncated}\n[...${json.length - maxChars} chars omitted]`;
}
```

### 4.4 Token Budget Management

**New field**: `tokenBudget?: number | TokenBudgetConfig` on `SmartAgentConfig`.

**Changes to**: `engine.ts` main loop, `state.ts` EngineState.

Track cumulative output tokens per run. After each LLM response, check budget:

```typescript
// In engine.ts, after executeModelAndTools returns successfully
if (config.tokenBudget) {
  const budget = typeof config.tokenBudget === "number"
    ? { maxOutputTokensPerTurn: config.tokenBudget }
    : config.tokenBudget;

  state.outputTokensUsed += outcome.usage?.completionTokens ?? estimateTokens([{ role: "assistant", content: outcome.content }]);

  const pct = state.outputTokensUsed / budget.maxOutputTokensPerTurn;
  if (pct >= 1.0) {
    // Force completion
    return { result: outcome.content, status: "completed", ... };
  }
  if (pct >= (budget.nudgeAtPercent ?? 80) / 100 && !state.budgetNudgeSent) {
    state.messages.push({
      role: "user",
      content: `Note: you have used ${Math.round(pct * 100)}% of your token budget. Wrap up efficiently.`,
    });
    state.budgetNudgeSent = true;
  }
}
```

### 4.5 Dynamic Context Enrichment

**Changes to**: `engine.ts` main loop (after tool execution, before next LLM call).

Currently, memories are only retrieved at initialization. Add per-iteration memory refresh:

```typescript
// In engine.ts, inside the while loop, after tool results are appended
if (config.memory && toolRecords.length > 0 && state.iterations % 5 === 0) {
  // Every 5 iterations, check for newly relevant memories
  const recentContext = toolRecords.map(r => `${r.tool}: ${JSON.stringify(r.result)}`).join("\n");
  const freshMemories = await config.memory.store.query(config.memory.scope, recentContext, 3);
  const existingContent = new Set(memoryStrings);
  const newMemories = freshMemories
    .map(m => m.content)
    .filter(c => !existingContent.has(c));

  if (newMemories.length > 0) {
    state.messages.push({
      role: "user",
      content: `Relevant memories surfaced:\n${newMemories.map(m => `- ${m}`).join("\n")}`,
    });
    for (const m of newMemories) memoryStrings.push(m);
  }
}
```

Throttled to every 5 iterations to avoid excessive queries. The `memoryStrings` set deduplicates.

---

## 5. Layer 2: Skill Layer

### 5.1 Core Concepts

**Skills are NOT tools.** Tools have inputs/outputs and execute code. Skills are *strategic guidance* — prompts that teach the agent HOW to approach a class of problems.

| Aspect | Tool | Skill |
|--------|------|-------|
| Nature | Operation | Strategy |
| Interface | `execute(args) → result` | `prompt` (text) |
| When used | Model outputs `{"tool": "name"}` | Model calls `activate_skill` tool |
| Example | `read_file(path)` | "When debugging: read test → read source → fix → verify" |

### 5.2 Skill Integration into Agent Loop

Skills integrate via two mechanisms:

**A. Skill descriptions in system prompt** (always present):

```
## Available Skills

Skills are high-level strategies you can activate for complex tasks.
To use a skill, call the activate_skill tool with the skill name.

- tdd-debug: when tests fail or a bug needs fixing
- code-review: when reviewing code for quality issues
```

**B. `activate_skill` synthetic tool** (auto-injected when skills are configured):

```typescript
const activateSkillTool: AgentTool = {
  name: "activate_skill",
  description: "Activate a skill to get strategic guidance for the current task. "
    + "Skills provide step-by-step approaches for complex problems.",
  parameters: {
    type: "object",
    properties: { name: { type: "string", description: "Skill name to activate" } },
    required: ["name"],
  },
  async execute(args) {
    const skill = skills.find(s => s.name === args.name);
    if (!skill) return { error: `Skill "${args.name}" not found. Available: ${skills.map(s => s.name).join(", ")}` };
    return {
      skill: skill.name,
      guidance: skill.prompt,
      preferredTools: skill.tools ?? [],
      message: `Skill "${skill.name}" activated. Follow the guidance above.`,
    };
  },
};
```

When the agent activates a skill, the skill's prompt is returned as a tool result and becomes part of the conversation context.

### 5.3 defineSkill Helper

```typescript
export function defineSkill(def: AgentSkill): AgentSkill {
  return {
    source: "developer",
    utility: 1.0,
    ...def,
  };
}
```

### 5.4 Prompt Composer Integration

Skills are formatted into the system prompt via a new `formatSkillDescriptions()` function in `prompt-composer.ts`, added after tool descriptions:

```typescript
export function formatSkillDescriptions(skills: AgentSkill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map(s => `- ${s.name}: ${s.trigger}`);
  return "## Available Skills\n\n"
    + "Skills are high-level strategies. Activate one with the activate_skill tool.\n\n"
    + lines.join("\n");
}
```

---

## 6. Layer 3: Background Agent

### 6.1 Core Primitive

A background agent is a **lightweight fork of the main agent** that runs independently with restricted capabilities. Used by:
- Evolution engine (post-run distillation)
- Dynamic context enrichment (async memory prefetch)
- Future extensibility (code analysis, security scanning)

```typescript
export async function forkBackgroundAgent(
  parentConfig: SmartAgentConfig,
  task: BackgroundAgentTask,
): Promise<AgentRunResult> {
  const bgConfig: SmartAgentConfig = {
    llm: task.llm ?? parentConfig.llm,
    tools: task.tools ?? [],
    maxIterations: task.maxIterations ?? 5,
    prompt: task.systemPrompt ? { base: task.systemPrompt } : undefined,
    // No evolution, no skills, no hooks — pure execution
  };
  return runSmartLoop(bgConfig, task.goal);
}

interface BackgroundAgentTask {
  goal: string;
  llm?: LLMProvider;
  tools?: AgentTool[];
  maxIterations?: number;
  systemPrompt?: string;
}
```

### 6.2 Usage in Evolution (post-run distillation)

After a run completes, if `evolution.distillation === "post-run"`:

```typescript
// Fire-and-forget background distillation
forkBackgroundAgent(config, {
  goal: `Analyze this agent run and extract reusable strategies.\n\nGoal: ${goal}\nOutcome: ${result.status}\nIterations: ${result.iterations}\nTool calls: ${JSON.stringify(result.toolCalls.map(tc => ({ tool: tc.tool, status: tc.status })))}`,
  systemPrompt: DISTILLATION_SYSTEM_PROMPT,
  maxIterations: 3,
}).then(distillResult => {
  // Parse strategies from distillResult.result
  // Store via evolution.store.storeStrategy()
});
```

### 6.3 New Hook: onRunComplete

```typescript
// Added to SmartAgentHooks
onRunComplete?: (result: AgentRunResult) => Promise<void>;
```

Called at the end of `runSmartLoop()` before returning. The evolution engine registers this hook to trigger post-run processing.

---

## 7. Layer 4: Evolution Engine

### 7.1 Experience Recording

After each run, if `evolution.capture` matches, record a structured experience:

```typescript
function buildExperience(config: SmartAgentConfig, goal: string, result: AgentRunResult): Omit<Experience, "id" | "recordedAt"> {
  return {
    goal,
    outcome: result.status === "completed" ? "success" : result.status === "fatal" ? "failure" : "partial",
    trajectory: result.toolCalls.map((tc, i) => ({
      tool: tc.tool,
      args: tc.args as Record<string, unknown>,
      result: tc.result,
      status: tc.status ?? "success",
      iteration: i,
    })),
    iterations: result.iterations,
    tokenUsage: 0, // estimated from messages if available
    duration: 0,   // tracked via Date.now() in engine
    skillsUsed: [], // tracked when activate_skill is called
  };
}
```

### 7.2 Built-in LLM Distiller

```typescript
export class LlmDistiller implements Distiller {
  constructor(private llm: LLMProvider) {}

  async distill(experiences: Experience[]): Promise<Strategy[]> {
    const prompt = formatDistillationPrompt(experiences);
    const response = await this.llm.chat([
      { role: "system", content: DISTILLATION_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);
    return parseStrategies(response.content);
  }

  async consolidate(strategies: Strategy[]): Promise<Strategy[]> {
    if (strategies.length <= 10) return strategies;
    const prompt = formatConsolidationPrompt(strategies);
    const response = await this.llm.chat([
      { role: "system", content: CONSOLIDATION_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);
    return parseStrategies(response.content);
  }
}
```

**DISTILLATION_SYSTEM_PROMPT:**
```
You are analyzing agent execution traces to extract reusable strategies.

For each experience, identify:
1. What approach worked (or failed) and why
2. General rules that would help in similar future tasks
3. Tool usage patterns that were effective

Output as JSON array:
[{ "content": "When X happens, do Y because Z", "source": ["exp_id_1", "exp_id_2"] }]

Rules:
- Strategies must be general (not specific to one task)
- Strategies must be actionable (tell the agent what TO DO)
- Prefer "when/then" format
- Merge similar strategies rather than creating duplicates
```

### 7.3 Strategy Retrieval & Injection

At the start of each run, if evolution is configured, query strategies:

```typescript
// In engine.ts initialization, after retrieveMemories
if (config.evolution?.store) {
  const relevantStrategies = await config.evolution.store.queryStrategies(goal, 5);
  if (relevantStrategies.length > 0) {
    const strategySection = relevantStrategies
      .map(s => `- ${s.content} (utility: ${s.utility.toFixed(2)})`)
      .join("\n");
    // Inject as prompt layer
    const strategyLayer: PromptLayer = {
      id: "evolution-strategies",
      content: `## Learned Strategies\n\nBased on past experience, these approaches have been effective:\n\n${strategySection}\n\nApply these strategies where relevant. They are guidelines, not mandates.`,
      position: "append",
      priority: 80,
    };
    // Add to prompt config layers
  }
}
```

### 7.4 Skill Crystallization

When a strategy accumulates enough utility (tracked via `applications` and `utility`), promote it to a skill:

```typescript
async function maybePromoteStrategies(
  store: EvolutionStore,
  config: SkillPromotionConfig,
): Promise<AgentSkill[]> {
  const strategies = await store.queryStrategies("", 100);
  const promoted: AgentSkill[] = [];

  for (const s of strategies) {
    if (
      s.utility >= (config.minUtility ?? 0.7) &&
      s.applications >= (config.minExperiences ?? 5)
    ) {
      const skill: AgentSkill = {
        name: slugify(s.content.slice(0, 40)),
        description: s.content,
        trigger: extractTrigger(s.content),
        prompt: s.content,
        source: "evolved",
        utility: s.utility,
      };
      await store.storeSkill(skill);
      promoted.push(skill);
    }
  }
  return promoted;
}
```

Evolved skills are loaded alongside developer-defined skills at run start.

### 7.5 Utility Feedback Loop

After each run, update strategy utility based on outcome:

```typescript
// If strategies were retrieved for this run:
for (const strategy of retrievedStrategies) {
  const delta = result.status === "completed" ? +0.1 : -0.05;
  await evolution.store.updateStrategyUtility(strategy.id, delta);
}
```

Simple reinforcement: success → +0.1, failure → -0.05. Asymmetric to prevent rapid decay from one bad run.

### 7.6 SqliteEvolutionStore

Built-in persistent implementation:

```typescript
export class SqliteEvolutionStore implements EvolutionStore {
  constructor(pathOrDb: string | SqliteConnection);
}
```

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS capstan_experiences (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  outcome TEXT NOT NULL,
  trajectory TEXT NOT NULL,    -- JSON
  iterations INTEGER NOT NULL,
  token_usage INTEGER,
  duration INTEGER,
  skills_used TEXT,            -- JSON array
  recorded_at TEXT NOT NULL,
  metadata TEXT                -- JSON
);

CREATE TABLE IF NOT EXISTS capstan_strategies (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source TEXT NOT NULL,        -- JSON array of experience IDs
  utility REAL NOT NULL DEFAULT 0.5,
  applications INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capstan_evolved_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  trigger_text TEXT NOT NULL,
  prompt TEXT NOT NULL,
  utility REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL,
  metadata TEXT                -- JSON
);

CREATE INDEX idx_strategies_utility ON capstan_strategies(utility DESC);
CREATE INDEX idx_experiences_outcome ON capstan_experiences(outcome);
```

Keyword search on strategies/experiences, sorted by utility. Same pattern as `SqliteMemoryBackend`.

---

## 8. The Unified Flow

```
Developer defines:  createSmartAgent({ tools, skills, evolution })
                    ↓
Run 1:              agent.run("Fix login bug")
                    ↓
Engine init:        1. Retrieve memories (existing)
                    2. Query evolution strategies (NEW — inject as prompt layer)
                    3. Load developer skills + evolved skills (NEW)
                    4. Inject skill descriptions into prompt (NEW)
                    5. Compose system prompt
                    ↓
Agent loop:         6. LLM call → tool execution → result formatting
                    │  NEW: model fallback on LLM error
                    │  NEW: tool result budgeting (truncation)
                    │  NEW: token budget check after each response
                    │  NEW: dynamic memory refresh every 5 iterations
                    │  NEW: activate_skill tool available
                    ↓
                    7. Context compression (existing 3 layers)
                    │  NEW: enhanced reactive compact (autocompact first)
                    ↓
                    8. Stop hooks → continuation decision → loop or complete
                    ↓
Run complete:       9. Save session summary (existing)
                    10. Record experience (NEW — if evolution.capture matches)
                    11. Fire onRunComplete hook (NEW)
                    ↓
Post-run (async):   12. Distill experience → strategies (NEW — background agent)
                    13. Update strategy utility (NEW — reinforcement)
                    14. Maybe promote strategies → evolved skills (NEW)
                    15. Prune low-utility strategies (NEW)
                    ↓
Run 2+:             Strategies and evolved skills from step 2-3 make agent smarter
```

---

## 9. File Structure

```
packages/ai/src/
  types.ts                          MODIFY — add new types (TokenBudgetConfig, ToolResultBudgetConfig,
                                             AgentSkill, Experience, Strategy, Distiller,
                                             EvolutionStore, EvolutionConfig, etc.)
  smart-agent.ts                    MODIFY — pass new config fields to engine
  index.ts                          MODIFY — export new types and implementations

  loop/
    engine.ts                       MODIFY — reactive compact enhancement, token budget,
                                             dynamic context enrichment, evolution integration,
                                             skill injection, onRunComplete hook
    state.ts                        MODIFY — add outputTokensUsed, budgetNudgeSent to EngineState
    compaction.ts                   NO CHANGE (autocompact already exists)
    continuation.ts                 MODIFY — enhanced reactive compact path
    prompt-composer.ts              MODIFY — add formatSkillDescriptions()
    streaming-executor.ts           MODIFY — model fallback support
    stop-hooks.ts                   NO CHANGE
    tool-catalog.ts                 NO CHANGE

  skill.ts                          CREATE — defineSkill(), createActivateSkillTool(),
                                             formatSkillDescriptions()
  background-agent.ts               CREATE — forkBackgroundAgent()

  evolution/
    types.ts                        CREATE — Experience, Strategy, Distiller, EvolutionStore,
                                             EvolutionConfig, etc.
    engine.ts                       CREATE — buildExperience(), runPostRunEvolution(),
                                             injectStrategies(), updateUtility()
    distiller.ts                    CREATE — LlmDistiller, DISTILLATION_SYSTEM_PROMPT
    store-sqlite.ts                 CREATE — SqliteEvolutionStore
    store-memory.ts                 CREATE — InMemoryEvolutionStore (for tests/dev)
    promotion.ts                    CREATE — maybePromoteStrategies()
```

---

## 10. Testing Strategy

### Unit Tests (mock LLM)

| Area | Test Cases |
|------|-----------|
| **Reactive compact** | context_limit → autocompact first → fallback to reactive → fatal after retries |
| **Model fallback** | primary fails → fallback succeeds; both fail → error propagated |
| **Tool result budget** | result > maxChars → truncated; structure preserved; within budget → unchanged |
| **Token budget** | nudge at threshold; force complete at limit; no nudge when disabled |
| **Skill injection** | skills in prompt; activate_skill tool works; unknown skill → error |
| **defineSkill** | sets defaults; preserves overrides |
| **Experience recording** | captures trajectory; respects capture policy; handles failures gracefully |
| **Strategy distillation** | LlmDistiller output parsed; consolidation merges |
| **Utility feedback** | success → +0.1; failure → -0.05; bounds [0, 1] |
| **Skill promotion** | utility >= threshold + applications >= min → promoted; below → not |
| **SqliteEvolutionStore** | CRUD for experiences, strategies, skills; pruning; keyword search |
| **Background agent** | forkBackgroundAgent runs independently; restricted tools; maxIterations honored |

### Real LLM Tests (extend existing e2e suite)

| Layer | Test |
|-------|------|
| **Smoke** | Agent with 2 skills correctly activates one based on context |
| **Long-run** | Agent with evolution store accumulates strategies across 3 sequential runs |
| **Scenario** | Agent with evolution fixes similar bugs faster on 2nd/3rd attempt (fewer iterations) |

---

## 11. Non-Goals (Explicit Exclusions)

- **Training/fine-tuning**: No model weight updates. Evolution is purely environment-centric.
- **Multi-agent topology evolution**: Out of scope. Single-agent evolution only.
- **Meta-evolution**: The memory architecture itself does not evolve (MemEvolve pattern deferred to future).
- **Skill-as-code**: Evolved skills are prompt-based, not executable code (Voyager pattern deferred).
- **Cross-agent skill transfer**: Skills are per-agent instance. Sharing deferred to future.

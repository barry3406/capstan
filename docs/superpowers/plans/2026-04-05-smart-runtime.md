# Smart Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Capstan agent loop into a smart runtime that handles context compression, error recovery, streaming tool execution, and long-term memory automatically — so developers get Claude Code-level agent intelligence by default.

**Architecture:** Replace the thin turn engine with a smart runtime built on 6 modules: three-layer compaction, 6-branch continuation decision tree, streaming tool executor, dynamic prompt composer, deferred tool catalog, and stop hooks. Memory is simplified (LLM decides content) and integrated as the "output" of context compression. `createSmartAgent` is the sole public API.

**Tech Stack:** TypeScript (strict, ESM, `.js` extensions), Bun test runner, Zod for schema validation where needed.

**Spec:** `docs/superpowers/specs/2026-04-05-smart-runtime-design.md`

---

## File Map

### New files (create)

| File | Responsibility | LOC |
|------|---------------|-----|
| `packages/ai/src/loop/compaction.ts` | Three-layer context compression (snip, microcompact, autocompact) | ~350 |
| `packages/ai/src/loop/streaming-executor.ts` | Stream-aware tool execution + tool call parsing (replaces sampler.ts) | ~300 |
| `packages/ai/src/loop/prompt-composer.ts` | Dynamic system prompt assembly from layers | ~180 |
| `packages/ai/src/loop/tool-catalog.ts` | Deferred tool loading with discover_tools meta-tool | ~130 |
| `packages/ai/src/loop/stop-hooks.ts` | Post-response validation hooks | ~80 |
| `packages/ai/src/smart-agent.ts` | `createSmartAgent` public API | ~120 |
| `tests/unit/ai-compaction.test.ts` | Compaction tests | ~700 |
| `tests/unit/ai-continuation-tree.test.ts` | Continuation decision tree tests | ~600 |
| `tests/unit/ai-streaming-executor.test.ts` | Streaming executor tests | ~600 |
| `tests/unit/ai-prompt-composer.test.ts` | Prompt composer tests | ~350 |
| `tests/unit/ai-tool-catalog.test.ts` | Tool catalog tests | ~250 |
| `tests/unit/ai-stop-hooks.test.ts` | Stop hooks tests | ~250 |
| `tests/unit/ai-memory-simplified.test.ts` | Simplified memory tests | ~350 |
| `tests/unit/ai-smart-agent.test.ts` | Integration + regression tests (replaces old ai-agent-loop.test.ts) | ~500 |

### Rewrite files (modify)

| File | What changes |
|------|-------------|
| `packages/ai/src/types.ts` | Delete old types, add SmartAgentConfig/SmartAgent/simplified MemoryEntry |
| `packages/ai/src/memory.ts` | Strip importance/type/accessCount/lastAccessedAt/updatedAt |
| `packages/ai/src/loop/continuation.ts` | 2 branches → 6-branch decision tree with token escalation |
| `packages/ai/src/loop/state.ts` | Simplified orchestration state with compaction/memory fields |
| `packages/ai/src/loop/engine.ts` | Full rewrite: smart runtime main loop |
| `packages/ai/src/index.ts` | Export createSmartAgent as sole public API |

### Delete files

| File | Reason |
|------|--------|
| `packages/ai/src/loop/kernel.ts` | Redundant wrapper |
| `packages/ai/src/loop/messages.ts` | Replaced by prompt-composer.ts |
| `packages/ai/src/loop/sampler.ts` | Replaced by streaming-executor.ts |
| `packages/ai/src/agent-loop.ts` | Replaced by createSmartAgent |
| `packages/ai/src/context.ts` | Replaced by createSmartAgent |
| `tests/unit/ai-agent-loop.test.ts` | Replaced by ai-smart-agent.test.ts |

### Keep unchanged

| File | Reason |
|------|--------|
| `packages/ai/src/loop/tool-orchestrator.ts` | Concurrency grouping logic is correct |
| `packages/ai/src/loop/task-orchestrator.ts` | Task submission/wait logic is correct |
| `packages/ai/src/think.ts` | Standalone utility |
| `packages/ai/src/harness/*` | Separate concern |

---

## Task 1: Rewrite types.ts — Foundation types

**Files:**
- Rewrite: `packages/ai/src/types.ts`
- Test: `(no separate test — types are validated by compilation and downstream tests)`

- [ ] **Step 1: Read the current types.ts**

Read `packages/ai/src/types.ts` to understand every type currently defined. Note which types are used by `tool-orchestrator.ts` and `task-orchestrator.ts` (kept files) — those types MUST be preserved.

- [ ] **Step 2: Write the new types.ts**

Rewrite `packages/ai/src/types.ts` with:

```typescript
// === LLM Types (unchanged) ===
export interface MemoryEmbedder { embed(texts: string[]): Promise<number[][]>; dimensions: number; }
export interface LLMMessage { role: "system" | "user" | "assistant"; content: string; }
export interface LLMResponse { content: string; model: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; finishReason?: string; }
export interface LLMStreamChunk { content: string; done: boolean; }
export interface LLMOptions { model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; responseFormat?: Record<string, unknown>; }
export interface LLMProvider { name: string; chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>; stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>; }

// === Think/Generate (unchanged) ===
export interface ThinkOptions<T = unknown> { schema?: { parse: (data: unknown) => T }; model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; }
export interface GenerateOptions { model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; }

// === Memory Types (simplified) ===
export interface MemoryEntry {
  id: string;
  content: string;
  scope: MemoryScope;
  embedding?: number[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}
export interface MemoryScope { type: string; id: string; }
export interface MemoryBackend {
  store(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<string>;
  query(scope: MemoryScope, text: string, k: number): Promise<MemoryEntry[]>;
  remove(id: string): Promise<boolean>;
  clear(scope: MemoryScope): Promise<void>;
}

// === Agent Tool/Task Types (kept for tool-orchestrator.ts, task-orchestrator.ts) ===
export interface AgentTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  isConcurrencySafe?: boolean;
  failureMode?: "soft" | "hard";
  execute(args: Record<string, unknown>): Promise<unknown>;
}
export type AgentTaskKind = "shell" | "workflow" | "remote" | "subagent" | "custom";
export interface AgentTaskExecutionContext {
  signal: AbortSignal;
  runId?: string;
  requestId: string;
  taskId: string;
  order: number;
  callStack?: ReadonlySet<string>;
}
export interface AgentTask {
  name: string;
  description: string;
  kind?: AgentTaskKind;
  parameters?: Record<string, unknown>;
  isConcurrencySafe?: boolean;
  failureMode?: "soft" | "hard";
  execute(args: Record<string, unknown>, context: AgentTaskExecutionContext): Promise<unknown>;
}
export interface AgentToolCallRecord {
  tool: string;
  args: unknown;
  result: unknown;
  requestId?: string;
  order?: number;
  status?: "success" | "error";
}
export interface AgentTaskCallRecord {
  task: string;
  args: unknown;
  result: unknown;
  requestId?: string;
  taskId?: string;
  order?: number;
  status?: "success" | "error" | "canceled";
  kind?: AgentTaskKind;
}

// === Tool Request (used by streaming-executor, engine) ===
export interface ToolRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
  order: number;
}

// === Agent Run Status ===
export type AgentRunStatus = "completed" | "max_iterations" | "approval_required" | "paused" | "canceled" | "fatal";

// === Model Finish Reason ===
export type ModelFinishReason = "stop" | "tool_use" | "max_output_tokens" | "context_limit" | "error";

// === Checkpoint (simplified) ===
export interface AgentCheckpoint {
  stage: "initialized" | "tool_result" | "task_wait" | "approval_required" | "paused" | "completed" | "max_iterations" | "canceled";
  goal: string;
  messages: LLMMessage[];
  iterations: number;
  toolCalls: AgentToolCallRecord[];
  taskCalls: AgentTaskCallRecord[];
  maxOutputTokens: number;
  compaction: {
    autocompactFailures: number;
    reactiveCompactRetries: number;
    tokenEscalations: number;
  };
}

// === Stop Hook Types ===
export interface StopHook {
  name: string;
  evaluate(context: StopHookContext): Promise<StopHookResult>;
}
export interface StopHookContext {
  response: string;
  messages: LLMMessage[];
  toolCalls: AgentToolCallRecord[];
  goal: string;
}
export interface StopHookResult {
  pass: boolean;
  feedback?: string;
}

// === Prompt Composer Types ===
export interface PromptLayer {
  id: string;
  content: string;
  position: "prepend" | "append" | "replace_base";
  priority?: number;
}
export interface PromptComposerConfig {
  base?: string;
  layers?: PromptLayer[];
  dynamicLayers?: (context: PromptContext) => PromptLayer[];
}
export interface PromptContext {
  tools: AgentTool[];
  iteration: number;
  memories: string[];
  tokenBudget: number;
}

// === Memory Config ===
export interface SmartAgentMemoryConfig {
  store: MemoryBackend;
  scope: MemoryScope;
  readScopes?: MemoryScope[];
  embedding?: MemoryEmbedder;
  maxMemoryTokens?: number;
  saveSessionSummary?: boolean;
}

// === Compaction Config ===
export interface SnipConfig { preserveTail: number; }
export interface MicrocompactConfig { maxToolResultChars: number; protectedTail: number; }
export interface AutocompactConfig { threshold: number; maxFailures: number; }

// === Streaming Config ===
export interface StreamingExecutorConfig { maxConcurrency: number; }

// === Tool Catalog Config ===
export interface ToolCatalogConfig { deferThreshold: number; }

// === Lifecycle Hooks ===
export interface SmartAgentHooks {
  beforeToolCall?: (tool: string, args: unknown) => Promise<{ allowed: boolean; reason?: string }>;
  afterToolCall?: (tool: string, args: unknown, result: unknown) => Promise<void>;
  beforeTaskCall?: (task: string, args: unknown) => Promise<{ allowed: boolean; reason?: string }>;
  afterTaskCall?: (task: string, args: unknown, result: unknown) => Promise<void>;
  onCheckpoint?: (checkpoint: AgentCheckpoint) => Promise<AgentCheckpoint | void>;
  onMemoryEvent?: (content: string) => Promise<void>;
  getControlState?: (phase: "before_llm" | "before_tool" | "after_tool" | "during_task_wait", checkpoint: AgentCheckpoint) => Promise<{ action: "continue" | "pause" | "cancel"; reason?: string }>;
}

// === Smart Agent Config (the ONE config type) ===
export interface SmartAgentConfig {
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
}

// === Agent Run Result ===
export interface AgentRunResult {
  result: unknown;
  iterations: number;
  toolCalls: AgentToolCallRecord[];
  taskCalls: AgentTaskCallRecord[];
  status: AgentRunStatus;
  error?: string;
  checkpoint?: AgentCheckpoint;
  pendingApproval?: { kind: "tool" | "task"; tool: string; args: unknown; reason: string };
}

// === Smart Agent Interface ===
export interface SmartAgent {
  run(goal: string): Promise<AgentRunResult>;
  resume(checkpoint: AgentCheckpoint, message: string): Promise<AgentRunResult>;
}
```

Key changes from old types:
- `MemoryEntry` stripped to 5 fields (was 10)
- `MemoryBackend.store()` accepts simplified entry (no importance/type/accessCount/lastAccessedAt)
- `AgentCheckpoint` replaces `AgentLoopCheckpoint` — flatter, includes compaction state
- `SmartAgentConfig` replaces `AgentRunConfig` + `AgentLoopOptions` — one bag
- `SmartAgentHooks` replaces `AgentLoopOptions` hooks — cleaner naming
- `ToolRequest` replaces `AgentLoopToolRequest` — shorter name
- `ModelFinishReason` replaces `AgentLoopModelFinishReason` — shorter name
- All `AgentLoop` prefix types removed

- [ ] **Step 3: Verify tool-orchestrator.ts and task-orchestrator.ts still compile**

These files import from `../types.js`. Verify the types they use still exist. The key types they need:
- `AgentTool`, `AgentToolCallRecord` (tool-orchestrator)
- `AgentTask`, `AgentTaskKind`, `AgentTaskCallRecord` (task-orchestrator)

If any imports break, fix them. The type names for these are unchanged.

Run: `cd /root/capstan && npx tsc --noEmit --project packages/ai/tsconfig.json 2>&1 | head -30`

Note: This WILL show errors for files that import deleted types. That's expected — we fix those files in later tasks.

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/types.ts
git commit -m "refactor: rewrite types.ts for smart runtime — simplified MemoryEntry, unified SmartAgentConfig"
```

---

## Task 2: Rewrite memory.ts — Simplified memory backend

**Files:**
- Rewrite: `packages/ai/src/memory.ts`
- Test: `tests/unit/ai-memory-simplified.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/unit/ai-memory-simplified.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { BuiltinMemoryBackend } from "../../packages/ai/src/memory.js";
import type { MemoryScope } from "../../packages/ai/src/types.js";

const scope: MemoryScope = { type: "worker", id: "alice" };
const teamScope: MemoryScope = { type: "team", id: "ops" };

describe("BuiltinMemoryBackend", () => {
  it("stores and queries entries by scope", async () => {
    const mem = new BuiltinMemoryBackend();
    await mem.store({ content: "Store X API is flaky", scope });
    const results = await mem.query(scope, "flaky API", 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("Store X API is flaky");
    expect(results[0]!.id).toBeTruthy();
    expect(results[0]!.createdAt).toBeTruthy();
  });

  it("returns empty for different scope", async () => {
    const mem = new BuiltinMemoryBackend();
    await mem.store({ content: "Store X API is flaky", scope });
    const results = await mem.query(teamScope, "flaky API", 5);
    expect(results).toHaveLength(0);
  });

  it("removes an entry by id", async () => {
    const mem = new BuiltinMemoryBackend();
    const id = await mem.store({ content: "temp note", scope });
    expect(await mem.remove(id)).toBe(true);
    const results = await mem.query(scope, "temp", 5);
    expect(results).toHaveLength(0);
  });

  it("returns false when removing non-existent id", async () => {
    const mem = new BuiltinMemoryBackend();
    expect(await mem.remove("non-existent")).toBe(false);
  });

  it("clears all entries for a scope", async () => {
    const mem = new BuiltinMemoryBackend();
    await mem.store({ content: "entry 1", scope });
    await mem.store({ content: "entry 2", scope });
    await mem.store({ content: "team entry", scope: teamScope });
    await mem.clear(scope);
    expect(await mem.query(scope, "entry", 10)).toHaveLength(0);
    expect(await mem.query(teamScope, "entry", 10)).toHaveLength(1);
  });

  it("limits results to k", async () => {
    const mem = new BuiltinMemoryBackend();
    for (let i = 0; i < 10; i++) {
      await mem.store({ content: `entry ${i}`, scope });
    }
    const results = await mem.query(scope, "entry", 3);
    expect(results).toHaveLength(3);
  });

  it("keyword search ranks by overlap", async () => {
    const mem = new BuiltinMemoryBackend();
    await mem.store({ content: "the cat sat on the mat", scope });
    await mem.store({ content: "the quick brown fox", scope });
    const results = await mem.query(scope, "cat mat", 2);
    expect(results[0]!.content).toContain("cat");
  });

  it("stores metadata and returns it", async () => {
    const mem = new BuiltinMemoryBackend();
    const id = await mem.store({ content: "note", scope, metadata: { source: "autocompact" } });
    const results = await mem.query(scope, "note", 1);
    expect(results[0]!.metadata).toEqual({ source: "autocompact" });
  });

  it("uses embeddings for semantic search when provider is set", async () => {
    const mockEmbedder = {
      dimensions: 3,
      async embed(texts: string[]) {
        return texts.map(() => [0.1, 0.2, 0.3]);
      },
    };
    const mem = new BuiltinMemoryBackend({ embedding: mockEmbedder });
    await mem.store({ content: "semantic content", scope });
    const results = await mem.query(scope, "search query", 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("deduplicates entries with very similar embeddings", async () => {
    const mockEmbedder = {
      dimensions: 3,
      async embed(texts: string[]) {
        return texts.map(() => [1.0, 0.0, 0.0]);
      },
    };
    const mem = new BuiltinMemoryBackend({ embedding: mockEmbedder });
    const id1 = await mem.store({ content: "first version", scope });
    const id2 = await mem.store({ content: "second version", scope });
    // Same embeddings = high similarity, should merge
    expect(id2).toBe(id1);
    const results = await mem.query(scope, "version", 10);
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain("second version");
  });

  it("entry has no importance, type, accessCount, lastAccessedAt, or updatedAt", async () => {
    const mem = new BuiltinMemoryBackend();
    await mem.store({ content: "clean entry", scope });
    const results = await mem.query(scope, "clean", 1);
    const entry = results[0]!;
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("content");
    expect(entry).toHaveProperty("scope");
    expect(entry).toHaveProperty("createdAt");
    expect(entry).not.toHaveProperty("importance");
    expect(entry).not.toHaveProperty("type");
    expect(entry).not.toHaveProperty("accessCount");
    expect(entry).not.toHaveProperty("lastAccessedAt");
    expect(entry).not.toHaveProperty("updatedAt");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/capstan && bun test tests/unit/ai-memory-simplified.test.ts`
Expected: Failures because memory.ts still has old interface.

- [ ] **Step 3: Rewrite memory.ts**

Rewrite `packages/ai/src/memory.ts`. Keep the existing `BuiltinMemoryBackend` class structure but:
1. Remove `importance`, `type`, `accessCount`, `lastAccessedAt`, `updatedAt` from stored entries
2. Simplify the `store()` method signature to match new `MemoryBackend` interface
3. Keep the `cosineDistanceSimple` helper for embedding dedup
4. Keep keyword-based query fallback when no embeddings
5. Remove the `createMemoryAccessor` function (old API)

The core logic stays: `Map<scopeKey, Map<id, MemoryEntry>>`, embedding-based dedup at 92% similarity, keyword overlap scoring.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /root/capstan && bun test tests/unit/ai-memory-simplified.test.ts`
Expected: All 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/memory.ts tests/unit/ai-memory-simplified.test.ts
git commit -m "refactor: simplify MemoryEntry — strip importance/type/accessCount, LLM decides content"
```

---

## Task 3: Compaction module — Three-layer context compression

**Files:**
- Create: `packages/ai/src/loop/compaction.ts`
- Test: `tests/unit/ai-compaction.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/unit/ai-compaction.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  snipMessages,
  microcompactMessages,
  autocompact,
  estimateTokens,
} from "../../packages/ai/src/loop/compaction.js";
import type { LLMMessage, LLMProvider } from "../../packages/ai/src/types.js";

function msg(role: "system" | "user" | "assistant", content: string): LLMMessage {
  return { role, content };
}

function mockLLM(response: string): LLMProvider {
  return {
    name: "mock",
    async chat() {
      return { content: response, model: "mock" };
    },
  };
}

// --- estimateTokens ---

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    const messages = [msg("user", "a".repeat(400))];
    const estimate = estimateTokens(messages);
    expect(estimate).toBeGreaterThanOrEqual(90);
    expect(estimate).toBeLessThanOrEqual(110);
  });

  it("returns 0 for empty messages", () => {
    expect(estimateTokens([])).toBe(0);
  });
});

// --- snipMessages ---

describe("snipMessages", () => {
  it("keeps system prompt and last N pairs", () => {
    const messages = [
      msg("system", "You are an agent"),
      msg("user", "old message 1"),
      msg("assistant", "old response 1"),
      msg("user", "old message 2"),
      msg("assistant", "old response 2"),
      msg("user", "recent message"),
      msg("assistant", "recent response"),
    ];
    const result = snipMessages(messages, { preserveTail: 1 });
    expect(result.messages).toHaveLength(3); // system + 1 pair
    expect(result.messages[0]!.role).toBe("system");
    expect(result.messages[1]!.content).toBe("recent message");
    expect(result.messages[2]!.content).toBe("recent response");
    expect(result.snippedCount).toBe(4);
  });

  it("does nothing when messages fit within tail", () => {
    const messages = [
      msg("system", "prompt"),
      msg("user", "hello"),
      msg("assistant", "hi"),
    ];
    const result = snipMessages(messages, { preserveTail: 5 });
    expect(result.messages).toHaveLength(3);
    expect(result.snippedCount).toBe(0);
  });

  it("always keeps system prompt even with preserveTail=0", () => {
    const messages = [
      msg("system", "prompt"),
      msg("user", "hello"),
      msg("assistant", "hi"),
    ];
    const result = snipMessages(messages, { preserveTail: 0 });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe("system");
  });

  it("handles no system prompt", () => {
    const messages = [
      msg("user", "hello"),
      msg("assistant", "hi"),
      msg("user", "bye"),
      msg("assistant", "goodbye"),
    ];
    const result = snipMessages(messages, { preserveTail: 1 });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.content).toBe("bye");
  });

  it("inserts snip marker when messages are removed", () => {
    const messages = [
      msg("system", "prompt"),
      msg("user", "old1"), msg("assistant", "old2"),
      msg("user", "old3"), msg("assistant", "old4"),
      msg("user", "recent"), msg("assistant", "latest"),
    ];
    const result = snipMessages(messages, { preserveTail: 1 });
    expect(result.messages[1]!.role).toBe("system");
    expect(result.messages[1]!.content).toContain("4 earlier messages");
  });
});

// --- microcompactMessages ---

describe("microcompactMessages", () => {
  it("truncates long tool results outside protected tail", () => {
    const longResult = "x".repeat(1000);
    const messages = [
      msg("system", "prompt"),
      msg("user", `Tool "fetch" returned:\n${longResult}`),
      msg("assistant", "I see the result"),
      msg("user", "recent question"),
      msg("assistant", "recent answer"),
    ];
    const result = microcompactMessages(messages, { maxToolResultChars: 100, protectedTail: 2 });
    expect(result.messages[1]!.content.length).toBeLessThan(200);
    expect(result.messages[1]!.content).toContain("[...truncated");
    expect(result.truncatedCount).toBe(1);
  });

  it("does not truncate messages in protected tail", () => {
    const longResult = "x".repeat(1000);
    const messages = [
      msg("system", "prompt"),
      msg("user", `Tool "fetch" returned:\n${longResult}`),
      msg("assistant", "response"),
    ];
    const result = microcompactMessages(messages, { maxToolResultChars: 100, protectedTail: 3 });
    expect(result.messages[1]!.content.length).toBe(messages[1]!.content.length);
    expect(result.truncatedCount).toBe(0);
  });

  it("does not truncate short messages", () => {
    const messages = [
      msg("system", "prompt"),
      msg("user", "short tool result"),
      msg("assistant", "ok"),
      msg("user", "question"),
      msg("assistant", "answer"),
    ];
    const result = microcompactMessages(messages, { maxToolResultChars: 500, protectedTail: 2 });
    expect(result.truncatedCount).toBe(0);
  });

  it("never truncates system prompt", () => {
    const longSystem = "x".repeat(5000);
    const messages = [
      msg("system", longSystem),
      msg("user", "hi"),
      msg("assistant", "hello"),
    ];
    const result = microcompactMessages(messages, { maxToolResultChars: 100, protectedTail: 2 });
    expect(result.messages[0]!.content).toBe(longSystem);
  });
});

// --- autocompact ---

describe("autocompact", () => {
  it("summarizes conversation and extracts memory candidates", async () => {
    const llm = mockLLM(JSON.stringify({
      summary: "User asked to check stores. Stores 1-5 checked, 3 orders flagged.",
      memories: ["Store 3 has high refund rate", "SF Express API is unstable"],
    }));
    const messages = [
      msg("system", "You are an agent"),
      msg("user", "Check all stores"),
      msg("assistant", "Checking store 1..."),
      msg("user", "Tool result: 5 orders"),
      msg("assistant", "Checking store 2..."),
      msg("user", "Tool result: 3 orders"),
      msg("assistant", "Done with stores 1-5"),
      msg("user", "What next?"),
      msg("assistant", "Let me continue"),
    ];
    const result = await autocompact(llm, messages, { threshold: 0.85, maxFailures: 3 });
    expect(result.memoryCandidates).toEqual(["Store 3 has high refund rate", "SF Express API is unstable"]);
    // Should keep system prompt + summary + last 4 messages
    expect(result.messages[0]!.role).toBe("system");
    expect(result.messages[0]!.content).toBe("You are an agent");
    // Summary inserted as system message
    expect(result.messages.some(m => m.content.includes("Stores 1-5 checked"))).toBe(true);
    // Last 4 messages preserved
    expect(result.messages[result.messages.length - 1]!.content).toBe("Let me continue");
  });

  it("returns original messages on LLM failure", async () => {
    const llm = mockLLM("this is not valid json");
    const messages = [
      msg("system", "prompt"),
      msg("user", "hello"),
      msg("assistant", "hi"),
    ];
    const result = await autocompact(llm, messages, { threshold: 0.85, maxFailures: 3 });
    expect(result.messages).toEqual(messages);
    expect(result.memoryCandidates).toEqual([]);
    expect(result.failed).toBe(true);
  });

  it("preserves at least system + last 4 messages when conversation is short", async () => {
    const llm = mockLLM(JSON.stringify({ summary: "short", memories: [] }));
    const messages = [
      msg("system", "prompt"),
      msg("user", "hello"),
      msg("assistant", "hi"),
    ];
    // Nothing to compact (only 3 messages total, less than system + 4)
    const result = await autocompact(llm, messages, { threshold: 0.85, maxFailures: 3 });
    expect(result.messages).toEqual(messages);
  });

  it("handles LLM throwing an error", async () => {
    const llm: LLMProvider = {
      name: "mock",
      async chat() { throw new Error("API down"); },
    };
    const messages = [
      msg("system", "prompt"),
      msg("user", "q1"), msg("assistant", "a1"),
      msg("user", "q2"), msg("assistant", "a2"),
      msg("user", "q3"), msg("assistant", "a3"),
    ];
    const result = await autocompact(llm, messages, { threshold: 0.85, maxFailures: 3 });
    expect(result.messages).toEqual(messages);
    expect(result.failed).toBe(true);
  });

  it("extracts memories as empty array when LLM omits them", async () => {
    const llm = mockLLM(JSON.stringify({ summary: "did some work" }));
    const messages = [
      msg("system", "prompt"),
      msg("user", "q1"), msg("assistant", "a1"),
      msg("user", "q2"), msg("assistant", "a2"),
      msg("user", "q3"), msg("assistant", "a3"),
    ];
    const result = await autocompact(llm, messages, { threshold: 0.85, maxFailures: 3 });
    expect(result.memoryCandidates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/capstan && bun test tests/unit/ai-compaction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement compaction.ts**

Create `packages/ai/src/loop/compaction.ts` with:

1. `estimateTokens(messages)`: Sum all message content lengths, divide by 4 (rough chars-per-token estimate).

2. `snipMessages(messages, config)`: Keep system prompt (if first message is system) + last `preserveTail * 2` messages. Insert a `[COMPACTED]` system message noting how many messages were removed. Return `{ messages, snippedCount }`.

3. `microcompactMessages(messages, config)`: For messages outside the protected tail (last `protectedTail`), find user messages containing `Tool "..." returned:` and truncate content beyond `maxToolResultChars`. Append `[...truncated N chars]`. Never touch system prompt (index 0). Return `{ messages, truncatedCount, charsFreed }`.

4. `autocompact(llm, messages, config)`: 
   - If messages.length <= 5 (system + 4), return unchanged (nothing to compact).
   - Take messages between system prompt and last 4.
   - Format them as text and ask LLM to summarize (using the autocompact system prompt from the spec).
   - Parse JSON response for `summary` and `memories`.
   - Build new message list: `[system, {role: "system", content: "[AUTOCOMPACT]\n" + summary}, ...last4]`.
   - On parse failure or LLM error, return original messages with `failed: true`.
   - Return `{ messages, memoryCandidates, tokensFreed, failed? }`.

The autocompact LLM prompt is defined as a constant in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /root/capstan && bun test tests/unit/ai-compaction.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/loop/compaction.ts tests/unit/ai-compaction.test.ts
git commit -m "feat: add three-layer context compression (snip, microcompact, autocompact)"
```

---

## Task 4: Stop hooks module

**Files:**
- Create: `packages/ai/src/loop/stop-hooks.ts`
- Test: `tests/unit/ai-stop-hooks.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/unit/ai-stop-hooks.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { runStopHooks } from "../../packages/ai/src/loop/stop-hooks.js";
import type { StopHook, StopHookContext } from "../../packages/ai/src/types.js";

const baseContext: StopHookContext = {
  response: "Here is my final answer with detailed explanation.",
  messages: [],
  toolCalls: [],
  goal: "Explain the architecture",
};

describe("runStopHooks", () => {
  it("returns pass when no hooks configured", async () => {
    const result = await runStopHooks([], baseContext);
    expect(result.pass).toBe(true);
  });

  it("returns pass when all hooks pass", async () => {
    const hooks: StopHook[] = [
      { name: "a", async evaluate() { return { pass: true }; } },
      { name: "b", async evaluate() { return { pass: true }; } },
    ];
    const result = await runStopHooks(hooks, baseContext);
    expect(result.pass).toBe(true);
  });

  it("returns fail with feedback from first failing hook", async () => {
    const hooks: StopHook[] = [
      { name: "length-check", async evaluate({ response }) {
        if (response.length < 10) return { pass: false, feedback: "Too short" };
        return { pass: true };
      }},
      { name: "always-fail", async evaluate() {
        return { pass: false, feedback: "Nope" };
      }},
    ];
    const shortContext = { ...baseContext, response: "Hi" };
    const result = await runStopHooks(hooks, shortContext);
    expect(result.pass).toBe(false);
    expect(result.feedback).toContain("Too short");
    expect(result.hookName).toBe("length-check");
  });

  it("stops at first failing hook (does not run later hooks)", async () => {
    let secondCalled = false;
    const hooks: StopHook[] = [
      { name: "fail", async evaluate() { return { pass: false, feedback: "No" }; } },
      { name: "track", async evaluate() { secondCalled = true; return { pass: true }; } },
    ];
    await runStopHooks(hooks, baseContext);
    expect(secondCalled).toBe(false);
  });

  it("handles hook throwing an error gracefully", async () => {
    const hooks: StopHook[] = [
      { name: "broken", async evaluate() { throw new Error("hook crashed"); } },
    ];
    const result = await runStopHooks(hooks, baseContext);
    expect(result.pass).toBe(true); // Broken hooks don't block
  });

  it("passes full context to hook evaluate", async () => {
    let receivedContext: StopHookContext | undefined;
    const hooks: StopHook[] = [
      { name: "spy", async evaluate(ctx) { receivedContext = ctx; return { pass: true }; } },
    ];
    await runStopHooks(hooks, baseContext);
    expect(receivedContext).toEqual(baseContext);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/capstan && bun test tests/unit/ai-stop-hooks.test.ts`

- [ ] **Step 3: Implement stop-hooks.ts**

Create `packages/ai/src/loop/stop-hooks.ts`:

```typescript
import type { StopHook, StopHookContext, StopHookResult } from "../types.js";

export interface StopHooksResult {
  pass: boolean;
  feedback?: string;
  hookName?: string;
}

export async function runStopHooks(
  hooks: StopHook[],
  context: StopHookContext,
): Promise<StopHooksResult> {
  for (const hook of hooks) {
    try {
      const result = await hook.evaluate(context);
      if (!result.pass) {
        return {
          pass: false,
          feedback: result.feedback,
          hookName: hook.name,
        };
      }
    } catch {
      // Broken hooks don't block the agent — fail open
      continue;
    }
  }
  return { pass: true };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /root/capstan && bun test tests/unit/ai-stop-hooks.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/loop/stop-hooks.ts tests/unit/ai-stop-hooks.test.ts
git commit -m "feat: add stop hooks for post-response validation"
```

---

## Task 5: Continuation decision tree — 6-branch rewrite

**Files:**
- Rewrite: `packages/ai/src/loop/continuation.ts`
- Test: `tests/unit/ai-continuation-tree.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/unit/ai-continuation-tree.test.ts`. This file must test all 6 branches of the decision tree. Key tests:

1. Tool requests present → continue with "tool_results_pending"
2. max_output_tokens + escalations < 3 → continue with "token_budget_continuation", escalate maxTokens
3. max_output_tokens + escalations >= 3 → complete
4. context_limit + autocompact not tried → continue with "autocompact_recovery"
5. context_limit + reactiveCompactRetries < 2 → continue with "reactive_compact_retry"
6. context_limit + all retries exhausted → fatal
7. Stop hook fails → continue with "stop_hook_rejected"
8. Stop hook passes → complete
9. Tool errors in last turn → continue with "tool_error_recovery"
10. Clean final response → complete
11. Token escalation stages: 8192 → 16384 → 65536
12. Reactive compact produces correct condensed messages
13. `applyContinuation` correctly sets continuation prompt for each reason
14. `clearContinuation` resets state

Write 25 tests covering these scenarios. Each test constructs a minimal compaction state and model outcome, calls `decideContinuation`, and asserts the returned action.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /root/capstan && bun test tests/unit/ai-continuation-tree.test.ts`

- [ ] **Step 3: Rewrite continuation.ts**

Rewrite `packages/ai/src/loop/continuation.ts` with:

```typescript
import type { LLMMessage, ModelFinishReason, StopHookResult, ToolRequest } from "../types.js";
import type { StopHooksResult } from "./stop-hooks.js";

// --- Constants ---
const DEFAULT_ESCALATION_STAGES = [8192, 16384, 65536];
const MAX_REACTIVE_COMPACT_RETRIES = 2;

// --- Types ---
export type ContinuationReason =
  | "tool_results_pending"
  | "token_budget_continuation"
  | "reactive_compact_retry"
  | "autocompact_recovery"
  | "stop_hook_rejected"
  | "tool_error_recovery";

export type ContinuationAction =
  | { action: "continue"; reason: ContinuationReason }
  | { action: "complete" }
  | { action: "fatal"; error: string };

export interface CompactionState {
  autocompactFailures: number;
  reactiveCompactRetries: number;
  tokenEscalations: number;
}

export interface ModelOutcome {
  content: string;
  toolRequests: ToolRequest[];
  finishReason: ModelFinishReason;
  hasToolErrors?: boolean;
}

// --- Core Decision Function ---
export function decideContinuation(
  outcome: ModelOutcome,
  compactionState: CompactionState,
  stopHookResult?: StopHooksResult,
  escalationStages: number[] = DEFAULT_ESCALATION_STAGES,
): ContinuationAction { ... }

// --- Continuation Applicators ---
export function getEscalatedMaxTokens(
  compactionState: CompactionState,
  stages: number[],
): number { ... }

export function applyContinuationPrompt(reason: ContinuationReason): string | undefined { ... }

export function reactiveCompact(messages: LLMMessage[]): LLMMessage[] { ... }
```

The decision tree follows the spec exactly (6 branches, top-to-bottom evaluation).

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /root/capstan && bun test tests/unit/ai-continuation-tree.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/loop/continuation.ts tests/unit/ai-continuation-tree.test.ts
git commit -m "feat: rewrite continuation as 6-branch decision tree with token escalation"
```

---

## Task 6: Prompt composer — Dynamic system prompt assembly

**Files:**
- Create: `packages/ai/src/loop/prompt-composer.ts`
- Test: `tests/unit/ai-prompt-composer.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/unit/ai-prompt-composer.test.ts`. Key tests (~15):

1. Returns default base prompt when no config
2. Custom base prompt replaces default
3. Prepend layers appear before base
4. Append layers appear after base
5. replace_base layer replaces the base entirely
6. Multiple layers sorted by priority (higher priority = earlier)
7. Memory section appended when memories present
8. No memory section when memories array is empty
9. Dynamic layers called with correct context
10. Tool descriptions section included when tools provided
11. Token budget trimming truncates content to fit
12. Layers with same position sorted by priority descending
13. Empty base + layers works correctly

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement prompt-composer.ts**

Create `packages/ai/src/loop/prompt-composer.ts`:

```typescript
import type { PromptComposerConfig, PromptContext, PromptLayer, AgentTool } from "../types.js";

const DEFAULT_BASE_PROMPT = `You are an autonomous agent. Accomplish the user's goal using the available tools. When finished, respond with a final summary in plain text.

To call tools, respond with JSON:
{"tool": "<name>", "arguments": { ... }}

For multiple concurrent calls:
[{"tool": "<name>", "arguments": { ... }}, ...]

To finish, respond with plain text (no JSON tool call).`;

export function composeSystemPrompt(
  config: PromptComposerConfig | undefined,
  context: PromptContext,
): string { ... }

export function formatToolDescriptions(tools: AgentTool[]): string { ... }

export function formatMemorySection(memories: string[]): string { ... }
```

Implementation:
1. Start with `config?.base ?? DEFAULT_BASE_PROMPT`
2. Collect static layers + dynamic layers (call `config.dynamicLayers?.(context)`)
3. Separate by position: prepend, append, replace_base
4. If any replace_base layer exists, use the highest-priority one as base
5. Sort prepend layers by priority descending, join
6. Sort append layers by priority descending, join
7. Build: `[prepend] + [base] + [tool descriptions] + [memory section] + [append]`
8. If total length > `context.tokenBudget * 4` (rough char estimate), truncate from the end

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/loop/prompt-composer.ts tests/unit/ai-prompt-composer.test.ts
git commit -m "feat: add dynamic system prompt composer with layers and memory injection"
```

---

## Task 7: Tool catalog — Deferred tool loading

**Files:**
- Create: `packages/ai/src/loop/tool-catalog.ts`
- Test: `tests/unit/ai-tool-catalog.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/unit/ai-tool-catalog.test.ts`. Key tests (~10):

1. Inline mode when tools count <= threshold
2. Deferred mode when tools count > threshold
3. Inline prompt section lists all tool names and descriptions
4. Deferred prompt section shows tool count
5. discover_tools meta-tool returns matching tools by name keyword
6. discover_tools meta-tool returns matching tools by description keyword
7. discover_tools meta-tool returns empty array for no matches
8. discover_tools is marked isConcurrencySafe
9. All original tools remain in the tools map (not removed)
10. Custom threshold works

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement tool-catalog.ts**

Create `packages/ai/src/loop/tool-catalog.ts`:

```typescript
import type { AgentTool, ToolCatalogConfig } from "../types.js";

const DEFAULT_DEFER_THRESHOLD = 15;

export interface ToolCatalogResult {
  mode: "inline" | "deferred";
  promptSection: string;
  discoverTool?: AgentTool;
}

export function createToolCatalog(
  tools: AgentTool[],
  config?: ToolCatalogConfig,
): ToolCatalogResult { ... }
```

Implementation follows the spec exactly. The `discover_tools` meta-tool searches by lowercase substring match on name + description.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/loop/tool-catalog.ts tests/unit/ai-tool-catalog.test.ts
git commit -m "feat: add deferred tool loading with discover_tools meta-tool"
```

---

## Task 8: Streaming executor — Stream-aware tool execution

**Files:**
- Create: `packages/ai/src/loop/streaming-executor.ts`
- Test: `tests/unit/ai-streaming-executor.test.ts`

This is the most complex new module. It replaces `sampler.ts` and handles both streaming and non-streaming paths.

- [ ] **Step 1: Write the test file**

Create `tests/unit/ai-streaming-executor.test.ts`. Key tests (~25):

**Parsing tests (migrated from sampler logic):**
1. Parses `{"tool": "x", "arguments": {}}` from content
2. Parses `[{"tool": "x", "arguments": {}}]` array form
3. Parses `{"tools": [{"tool": "x", "arguments": {}}]}` nested form
4. Parses tool calls from markdown fenced JSON blocks
5. Returns empty array for plain text (no tool calls)
6. Handles malformed JSON gracefully
7. Supports `args` as alias for `arguments`

**Streaming execution tests:**
8. Executes read-only tools immediately during streaming
9. Queues write tools for execution after stream ends
10. Respects maxConcurrency limit
11. drain() waits for all in-flight tools
12. getCompletedResults() returns finished tools during streaming
13. Non-streaming fallback: feeds chat() response as single chunk

**Tool execution tests:**
14. Records successful tool result with status "success"
15. Records failed tool result with status "error"
16. Hard failure mode halts remaining tools
17. Soft failure mode continues with remaining tools
18. Unknown tool name produces error record
19. Calls beforeToolCall hook and blocks on denial
20. Calls afterToolCall hook after execution
21. Concurrent-safe tools execute in parallel
22. Non-concurrent tools execute serially

**Finish reason normalization:**
23. "stop" → "stop"
24. "max_tokens" / "length" → "max_output_tokens"
25. "tool_use" → "tool_use"

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement streaming-executor.ts**

Create `packages/ai/src/loop/streaming-executor.ts`:

```typescript
import type {
  AgentTool,
  AgentToolCallRecord,
  LLMProvider,
  LLMMessage,
  LLMStreamChunk,
  ToolRequest,
  ModelFinishReason,
  SmartAgentHooks,
  StreamingExecutorConfig,
} from "../types.js";

// --- Tool call parsing (migrated from sampler.ts) ---
export function parseToolRequests(content: string): ToolRequest[] { ... }
export function normalizeFinishReason(reason: string | undefined, hasTools: boolean): ModelFinishReason { ... }

// --- Model outcome ---
export interface ModelOutcome {
  content: string;
  toolRequests: ToolRequest[];
  finishReason: ModelFinishReason;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// --- Execute a model call and tools in one pass ---
export async function executeModelAndTools(
  llm: LLMProvider,
  messages: LLMMessage[],
  tools: Map<string, AgentTool>,
  hooks: SmartAgentHooks | undefined,
  config: StreamingExecutorConfig,
  maxTokens?: number,
): Promise<{
  outcome: ModelOutcome;
  toolRecords: AgentToolCallRecord[];
  blockedApproval?: { kind: "tool"; tool: string; args: unknown; reason: string };
  haltedByHardFailure: boolean;
}> { ... }
```

The key insight: this module combines model sampling + tool execution into ONE function. The engine calls `executeModelAndTools` and gets back both the model response AND the tool results. No separate "sample then execute" steps.

Internally:
- If `llm.stream` exists: stream chunks, accumulate content, detect tool calls as they appear, dispatch read-only tools immediately
- If `llm.stream` does not exist: call `llm.chat`, parse tool calls from full response
- After model completes: execute remaining (write) tools
- Return combined outcome + tool records

Tool execution reuses the existing `tool-orchestrator.ts` logic for concurrency grouping and policy checks. Import `executeToolRequests` from `./tool-orchestrator.js` and adapt its interface.

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /root/capstan && bun test tests/unit/ai-streaming-executor.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/loop/streaming-executor.ts tests/unit/ai-streaming-executor.test.ts
git commit -m "feat: add streaming tool executor replacing sampler.ts"
```

---

## Task 9: Rewrite state.ts — Simplified orchestration state

**Files:**
- Rewrite: `packages/ai/src/loop/state.ts`

- [ ] **Step 1: Rewrite state.ts**

The current state.ts is 634 lines of checkpoint management with complex nested types. Rewrite to ~200 lines with the simplified `AgentCheckpoint` from types.ts.

Core functions to keep (rewritten):
- `createEngineState(config, tools, checkpoint?)` — initialize state from config or checkpoint
- `buildCheckpoint(state)` — serialize current state to checkpoint
- `applyCheckpoint(state, checkpoint)` — restore state from checkpoint

Remove all `AgentLoopOrchestrationState`, `AgentLoopRuntimeState`, `AgentLoopRecoveryState` types (replaced by flat `AgentCheckpoint.compaction`).

The state struct for the engine:

```typescript
export interface EngineState {
  goal: string;
  maxIterations: number;
  messages: LLMMessage[];
  tools: Map<string, AgentTool>;
  tasks: AgentTask[];
  toolCalls: AgentToolCallRecord[];
  taskCalls: AgentTaskCallRecord[];
  iterations: number;
  maxOutputTokens: number;
  compaction: CompactionState;
  continuationPrompt?: string;
  lastAssistantContent?: string;
}
```

- [ ] **Step 2: Verify tool-orchestrator.ts and task-orchestrator.ts still work**

These files import types from `./state.js`. Update their imports to use the new `EngineState` type. The internal interfaces they use (`PendingToolExecution`, `RunAgentLoopOptions`) need to be adapted or the orchestrators updated to accept the new state shape.

Important: Do NOT rewrite tool-orchestrator.ts or task-orchestrator.ts logic. Only update their type imports and function signatures to accept the new EngineState.

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/loop/state.ts packages/ai/src/loop/tool-orchestrator.ts packages/ai/src/loop/task-orchestrator.ts
git commit -m "refactor: simplify engine state with flat CompactionState"
```

---

## Task 10: Rewrite engine.ts — The smart runtime main loop

**Files:**
- Rewrite: `packages/ai/src/loop/engine.ts`

This is the keystone. It integrates ALL modules from Tasks 3-8.

- [ ] **Step 1: Rewrite engine.ts**

Rewrite `packages/ai/src/loop/engine.ts` following the pseudocode in spec section 7. The engine:

1. Creates engine state from config (or checkpoint for resume)
2. Builds tool catalog (inline or deferred)
3. Retrieves memories from store (if configured)
4. Composes system prompt via prompt composer
5. Enters main loop:
   a. Run compression check (snip + microcompact at 60%, autocompact at 85%)
   b. Check control state (pause/cancel)
   c. Call `executeModelAndTools` (streaming executor)
   d. Handle model errors via continuation decision tree
   e. Apply tool results to messages
   f. If no tool calls: run stop hooks, decide continuation
   g. Persist checkpoint after each major state change
   h. Persist memory candidates from autocompact
6. On exit: persist session summary (if memory configured)
7. Return AgentRunResult

Key imports:
```typescript
import { snipMessages, microcompactMessages, autocompact, estimateTokens } from "./compaction.js";
import { decideContinuation, applyContinuationPrompt, reactiveCompact, getEscalatedMaxTokens } from "./continuation.js";
import { executeModelAndTools } from "./streaming-executor.js";
import { composeSystemPrompt } from "./prompt-composer.js";
import { createToolCatalog } from "./tool-catalog.js";
import { runStopHooks } from "./stop-hooks.js";
import { createEngineState, buildCheckpoint } from "./state.js";
```

The main exported function:

```typescript
export async function runSmartLoop(
  config: SmartAgentConfig,
  goal: string,
  checkpoint?: AgentCheckpoint,
  resumeMessage?: string,
): Promise<AgentRunResult> { ... }
```

- [ ] **Step 2: Commit**

```bash
git add packages/ai/src/loop/engine.ts
git commit -m "feat: rewrite engine.ts as smart runtime main loop"
```

---

## Task 11: Public API — createSmartAgent + index.ts

**Files:**
- Create: `packages/ai/src/smart-agent.ts`
- Rewrite: `packages/ai/src/index.ts`

- [ ] **Step 1: Create smart-agent.ts**

Create `packages/ai/src/smart-agent.ts`:

```typescript
import type { SmartAgentConfig, SmartAgent, AgentRunResult, AgentCheckpoint } from "./types.js";
import { runSmartLoop } from "./loop/engine.js";

export function createSmartAgent(config: SmartAgentConfig): SmartAgent {
  return {
    async run(goal: string): Promise<AgentRunResult> {
      return runSmartLoop(config, goal);
    },
    async resume(checkpoint: AgentCheckpoint, message: string): Promise<AgentRunResult> {
      return runSmartLoop(config, checkpoint.goal, checkpoint, message);
    },
  };
}
```

- [ ] **Step 2: Rewrite index.ts**

Rewrite `packages/ai/src/index.ts`:

```typescript
// === Public API ===
export { createSmartAgent } from "./smart-agent.js";
export { think, generate, thinkStream, generateStream } from "./think.js";
export { BuiltinMemoryBackend } from "./memory.js";

// === Types ===
export type {
  // Core
  SmartAgent, SmartAgentConfig, SmartAgentHooks, SmartAgentMemoryConfig,
  AgentRunResult, AgentRunStatus, AgentCheckpoint,
  // LLM
  LLMProvider, LLMMessage, LLMResponse, LLMStreamChunk, LLMOptions,
  // Tools
  AgentTool, AgentTask, AgentTaskKind, AgentTaskExecutionContext,
  AgentToolCallRecord, AgentTaskCallRecord, ToolRequest,
  // Memory
  MemoryEntry, MemoryScope, MemoryBackend, MemoryEmbedder,
  // Config
  PromptComposerConfig, PromptLayer, PromptContext,
  SnipConfig, MicrocompactConfig, AutocompactConfig,
  StreamingExecutorConfig, ToolCatalogConfig,
  StopHook, StopHookContext, StopHookResult,
  // Think/Generate
  ThinkOptions, GenerateOptions,
  // Finish reason
  ModelFinishReason,
} from "./types.js";

// === Internal utilities (for harness and advanced users) ===
export { InMemoryAgentTaskRuntime } from "./task/runtime.js";
export { createShellTask } from "./task/shell-task.js";
export { createWorkflowTask } from "./task/workflow-task.js";
export { createRemoteTask } from "./task/remote-task.js";
export { createSubagentTask } from "./task/subagent-task.js";
export type { AgentTaskStatus, AgentTaskRecord, AgentTaskNotification, AgentTaskRuntime } from "./task/types.js";

// Harness (unchanged)
export { createHarness } from "./harness/index.js";
// ... (keep all harness exports as-is)
```

Note: Keep ALL harness exports unchanged. Only the loop/ and top-level API exports change.

- [ ] **Step 3: Commit**

```bash
git add packages/ai/src/smart-agent.ts packages/ai/src/index.ts
git commit -m "feat: add createSmartAgent as sole public API"
```

---

## Task 12: Delete old files

**Files:**
- Delete: `packages/ai/src/loop/kernel.ts`
- Delete: `packages/ai/src/loop/messages.ts`
- Delete: `packages/ai/src/loop/sampler.ts`
- Delete: `packages/ai/src/agent-loop.ts`
- Delete: `packages/ai/src/context.ts`
- Delete: `tests/unit/ai-agent-loop.test.ts`

- [ ] **Step 1: Delete files**

```bash
cd /root/capstan
rm packages/ai/src/loop/kernel.ts
rm packages/ai/src/loop/messages.ts
rm packages/ai/src/loop/sampler.ts
rm packages/ai/src/agent-loop.ts
rm packages/ai/src/context.ts
rm tests/unit/ai-agent-loop.test.ts
```

- [ ] **Step 2: Search for dangling imports**

```bash
grep -r "agent-loop" packages/ai/src/ --include="*.ts" -l
grep -r "context\.js" packages/ai/src/ --include="*.ts" -l
grep -r "sampler" packages/ai/src/ --include="*.ts" -l
grep -r "kernel" packages/ai/src/ --include="*.ts" -l
grep -r "messages\.js" packages/ai/src/loop/ --include="*.ts" -l
```

Fix any remaining imports that reference deleted files.

- [ ] **Step 3: Check cron ai-loop.ts**

Read `packages/cron/src/ai-loop.ts`. It likely imports `runAgentLoop` from `@zauso-ai/capstan-ai`. Update to use `createSmartAgent`:

```typescript
// OLD:
import { runAgentLoop } from "@zauso-ai/capstan-ai";
// NEW:
import { createSmartAgent } from "@zauso-ai/capstan-ai";
```

Update the handler to create a smart agent and call `.run()`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete old API files (agent-loop, context, sampler, kernel, messages)"
```

---

## Task 13: Integration + regression tests

**Files:**
- Create: `tests/unit/ai-smart-agent.test.ts`

- [ ] **Step 1: Write integration test file**

Create `tests/unit/ai-smart-agent.test.ts`. This file:

1. **Migrates all 56 old tests** from `ai-agent-loop.test.ts` to use `createSmartAgent().run()` instead of `runAgentLoop()`. Same behaviors, new API.

2. **Adds new integration tests** for smart runtime features:

```typescript
import { describe, it, expect } from "bun:test";
import { createSmartAgent, BuiltinMemoryBackend } from "@zauso-ai/capstan-ai";
import type { LLMProvider, LLMMessage, LLMResponse, AgentTool, SmartAgentConfig } from "@zauso-ai/capstan-ai";

function mockLLM(responses: string[], sink?: LLMMessage[][]): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[]): Promise<LLMResponse> {
      sink?.push(messages.map(m => ({ ...m })));
      const content = responses[callIndex] ?? "done";
      callIndex++;
      return { content, model: "mock-1" };
    },
  };
}

const addTool: AgentTool = {
  name: "add",
  description: "Adds two numbers",
  parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
  async execute(args) { return (args.a as number) + (args.b as number); },
};

// --- Regression: basic behaviors from old test suite ---

describe("createSmartAgent - basic behaviors", () => {
  it("returns final result when LLM responds with plain text", async () => {
    const agent = createSmartAgent({ llm: mockLLM(["The answer is 42."]), tools: [] });
    const result = await agent.run("What is the answer?");
    expect(result.status).toBe("completed");
    expect(result.result).toBe("The answer is 42.");
    expect(result.iterations).toBe(1);
  });

  it("executes tool when LLM returns a tool call JSON", async () => {
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "add", arguments: { a: 2, b: 3 } }),
        "The sum is 5.",
      ]),
      tools: [addTool],
    });
    const result = await agent.run("Add 2 and 3");
    expect(result.status).toBe("completed");
    expect(result.result).toBe("The sum is 5.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.result).toBe(5);
  });

  it("handles tool execution errors gracefully", async () => {
    const failTool: AgentTool = {
      name: "fail",
      description: "Always fails",
      async execute() { throw new Error("boom"); },
    };
    const agent = createSmartAgent({
      llm: mockLLM([
        JSON.stringify({ tool: "fail", arguments: {} }),
        "The tool failed, moving on.",
      ]),
      tools: [failTool],
    });
    const result = await agent.run("Try the tool");
    expect(result.status).toBe("completed");
    expect(result.toolCalls[0]!.status).toBe("error");
  });

  it("respects maxIterations", async () => {
    const agent = createSmartAgent({
      llm: mockLLM(Array(50).fill(JSON.stringify({ tool: "add", arguments: { a: 1, b: 1 } }))),
      tools: [addTool],
      maxIterations: 5,
    });
    const result = await agent.run("Loop forever");
    expect(result.status).toBe("max_iterations");
    expect(result.iterations).toBe(5);
  });
});

// --- New: Smart runtime features ---

describe("createSmartAgent - context compression", () => {
  it("compresses context when messages grow large", async () => {
    const longResult = "x".repeat(10000);
    let callCount = 0;
    const llm: LLMProvider = {
      name: "mock",
      async chat(messages) {
        callCount++;
        if (callCount <= 10) {
          return { content: JSON.stringify({ tool: "fetch", arguments: {} }), model: "mock" };
        }
        return { content: "Done after many calls.", model: "mock" };
      },
    };
    const fetchTool: AgentTool = {
      name: "fetch",
      description: "Returns lots of data",
      async execute() { return longResult; },
    };
    const agent = createSmartAgent({
      llm,
      tools: [fetchTool],
      maxIterations: 15,
      contextWindowSize: 5000, // Small window to trigger compression
    });
    const result = await agent.run("Fetch data repeatedly");
    expect(result.status).toBe("completed");
    // Should have completed without crashing due to context overflow
  });
});

describe("createSmartAgent - stop hooks", () => {
  it("stop hook rejects insufficient response and forces continuation", async () => {
    const agent = createSmartAgent({
      llm: mockLLM(["short", "This is a much more detailed and complete response."]),
      tools: [],
      stopHooks: [{
        name: "length-check",
        async evaluate({ response }) {
          if (response.length < 20) return { pass: false, feedback: "Too short, elaborate." };
          return { pass: true };
        },
      }],
    });
    const result = await agent.run("Give me a detailed answer");
    expect(result.status).toBe("completed");
    expect(result.iterations).toBe(2);
  });
});

describe("createSmartAgent - memory integration", () => {
  it("retrieves memories at start and persists session summary", async () => {
    const mem = new BuiltinMemoryBackend();
    const scope = { type: "worker", id: "alice" };
    // Pre-seed a memory
    await mem.store({ content: "Store X API is unreliable", scope });

    const captured: LLMMessage[][] = [];
    const agent = createSmartAgent({
      llm: mockLLM(["I'll check the stores carefully."], captured),
      tools: [],
      memory: {
        store: mem,
        scope,
        maxMemoryTokens: 2000,
        saveSessionSummary: true,
      },
    });
    const result = await agent.run("Check all stores");
    expect(result.status).toBe("completed");
    // System prompt should contain the memory
    const systemMsg = captured[0]?.[0];
    expect(systemMsg?.content).toContain("Store X API is unreliable");
  });
});

describe("createSmartAgent - resume", () => {
  it("resumes from checkpoint with new message", async () => {
    let callCount = 0;
    const llm: LLMProvider = {
      name: "mock",
      async chat(messages) {
        callCount++;
        if (callCount === 1) return { content: "Initial work done.", model: "mock" };
        // On resume, should see the feedback message
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.content.includes("Fix image 7")) {
          return { content: "Fixed image 7 as requested.", model: "mock" };
        }
        return { content: "Done.", model: "mock" };
      },
    };
    const agent = createSmartAgent({ llm, tools: [] });

    // First run
    const result1 = await agent.run("Generate product images");
    expect(result1.status).toBe("completed");
    expect(result1.checkpoint).toBeTruthy();

    // Resume with PM feedback
    const result2 = await agent.resume(result1.checkpoint!, "Fix image 7, background too dark");
    expect(result2.status).toBe("completed");
    expect(result2.result).toContain("Fixed image 7");
  });
});
```

Migrate ALL 56 tests from the old `ai-agent-loop.test.ts`, adapting:
- `runAgentLoop(llm, { goal }, tools)` → `createSmartAgent({ llm, tools }).run(goal)`
- `result.result` stays the same
- `result.status` stays the same
- `result.toolCalls` stays the same
- `opts.beforeToolCall` → `hooks: { beforeToolCall }`
- `opts.onCheckpoint` → `hooks: { onCheckpoint }`
- `opts.onMemoryEvent` → `hooks: { onMemoryEvent }`

- [ ] **Step 2: Run all tests**

Run: `cd /root/capstan && bun test tests/unit/ai-smart-agent.test.ts tests/unit/ai-compaction.test.ts tests/unit/ai-continuation-tree.test.ts tests/unit/ai-streaming-executor.test.ts tests/unit/ai-prompt-composer.test.ts tests/unit/ai-tool-catalog.test.ts tests/unit/ai-stop-hooks.test.ts tests/unit/ai-memory-simplified.test.ts`

All tests must pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/ai-smart-agent.test.ts
git commit -m "test: add integration + regression tests for smart runtime"
```

---

## Task 14: Final verification + cleanup

- [ ] **Step 1: Run full test suite**

```bash
cd /root/capstan && bun test tests/unit/ai-*.test.ts
```

All tests must pass. Count total tests — should be 170+.

- [ ] **Step 2: Check for TypeScript errors**

```bash
cd /root/capstan && npx tsc --noEmit --project packages/ai/tsconfig.json
```

Must compile clean. Fix any type errors.

- [ ] **Step 3: Verify no references to deleted APIs**

```bash
grep -r "runAgentLoop\|createAI\|AIContext\|AgentRunConfig\b\|AgentLoopOptions\b" packages/ --include="*.ts" -l
```

Any hits outside test files or the unmerged worktree need fixing. The cron `ai-loop.ts` should have been updated in Task 12.

- [ ] **Step 4: Check LOC counts**

```bash
wc -l packages/ai/src/loop/compaction.ts packages/ai/src/loop/streaming-executor.ts packages/ai/src/loop/prompt-composer.ts packages/ai/src/loop/tool-catalog.ts packages/ai/src/loop/stop-hooks.ts packages/ai/src/loop/continuation.ts packages/ai/src/loop/state.ts packages/ai/src/loop/engine.ts packages/ai/src/smart-agent.ts packages/ai/src/memory.ts packages/ai/src/types.ts

wc -l tests/unit/ai-*.test.ts
```

Implementation should be ~1500 LOC. Tests should be ~3500 LOC (at least 2x implementation).

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: smart runtime verification — all tests pass, no dead imports"
```

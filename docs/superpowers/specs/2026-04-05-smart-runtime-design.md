# Smart Runtime: Agent Loop Rewrite

**Date:** 2026-04-05
**Status:** Draft
**Scope:** `packages/ai/src/loop/`, `packages/ai/src/memory.ts`, `packages/ai/src/types.ts`

## 1. Goal

Rewrite Capstan's agent loop so that developers can build Claude Code-level agentic programs by providing an LLM and tools. The framework handles context management, error recovery, streaming execution, and long-term memory automatically. No planning modules, no reflection modules -- the LLM does the thinking, the runtime keeps it running.

Design philosophy borrowed from Claude Code (`query.ts`, 1900 LOC):

> Don't make the framework think. Make the framework ensure the LLM can think in an environment that never crashes, never wastes context, and never blocks on tool execution.

## 2. Validated Use Cases

**Alice (order interceptor):** Cron-triggered, processes 20 stores / 80+ orders per hour. Needs: context compression (large tool results), error recovery (store APIs fail), memory (track processed orders across sessions).

**James (product designer):** Event-triggered, generates 15 detail images per product via Gemini. Needs: long sessions with PM feedback loops (checkpoint/resume), creative memory accumulation (design experience), SOP adaptation based on past learnings.

Both use the same runtime. The difference is configuration, not architecture.

## 3. What to Delete

No legacy users. No backward compatibility. Delete everything that doesn't earn its place.

| File | Action | Reason |
|------|--------|--------|
| `loop/planner.ts` | Delete (worktree only) | LLM plans naturally; framework-level plans are over-engineering |
| `loop/reflection.ts` | Delete (worktree only) | Extra LLM calls waste tokens; stop hooks replace this correctly |
| `loop/recovery.ts` | Delete (worktree only) | Error classification merges into continuation decision tree |
| `loop/kernel.ts` | **Delete** | Thin wrapper, identical to `agent-loop.ts` |
| `loop/messages.ts` | **Delete** | Replaced by `prompt-composer.ts` |
| `agent-loop.ts` | **Delete** | Replaced by `createSmartAgent`. No wrapper needed |
| `context.ts` | **Delete** | `createAI` replaced by `createSmartAgent`. Old API is dead |
| `loop/sampler.ts` | **Rewrite** | Streaming executor fundamentally changes sampling; old sync-only path replaced |

The worktree branch `worktree-agent-a18f26ad` (planner/reflection/recovery) must NOT be merged.

## 4. Architecture Overview

```
createSmartAgent({ llm, tools, memory? })
  │
  ▼
┌─────────────────────────────────────────────────┐
│              Smart Runtime (engine.ts)            │
│                                                   │
│  ┌───────────────────────────────────────────┐   │
│  │         Context Pipeline                   │   │
│  │  system prompt composer                    │   │
│  │    → memory retrieval                      │   │
│  │    → deferred tool catalog                 │   │
│  │    → conversation messages                 │   │
│  └───────────────────────────────────────────┘   │
│                     │                             │
│                     ▼                             │
│  ┌───────────────────────────────────────────┐   │
│  │         Turn Loop                          │   │
│  │  sample model (streaming)                  │   │
│  │    → streaming tool executor               │   │
│  │    → continuation decision tree            │   │
│  │    → three-layer compression               │   │
│  │    → memory promotion                      │   │
│  │    → stop hooks                            │   │
│  │    → checkpoint persistence                │   │
│  └───────────────────────────────────────────┘   │
│                     │                             │
│                     ▼                             │
│              AgentRunResult                       │
└─────────────────────────────────────────────────┘
```

## 5. Module Design

### 5.1 Three-Layer Context Compression (`compaction.ts` ~350 LOC)

Reference: Claude Code `services/compact/autoCompact.ts` + `query.ts` lines 414-454.

Three layers, applied in order from cheapest to most expensive:

**Layer 1: Snip** -- Delete oldest message pairs beyond a sliding window.

```typescript
interface SnipConfig {
  /** Number of recent message pairs to preserve. Default: 20 */
  preserveTail: number;
}

function snipMessages(messages: LLMMessage[], config: SnipConfig): SnipResult {
  // Keep system prompt (index 0) always
  // Keep last `preserveTail * 2` messages (user+assistant pairs)
  // Delete everything in between
  // Return { messages, snippedCount }
}
```

When: Applied proactively when message count exceeds `preserveTail * 2 + 10`.

**Layer 2: Microcompact** -- Truncate large tool results in older messages.

```typescript
interface MicrocompactConfig {
  /** Max characters per tool result in older messages. Default: 500 */
  maxToolResultChars: number;
  /** Messages within this tail count are never truncated. Default: 6 */
  protectedTail: number;
}

function microcompactMessages(
  messages: LLMMessage[],
  config: MicrocompactConfig,
): MicrocompactResult {
  // For each message outside the protected tail:
  //   If it contains a tool result longer than maxToolResultChars:
  //     Truncate to maxToolResultChars + "[...truncated N chars]"
  // Return { messages, truncatedCount, charsFreed }
}
```

When: Applied after snip, before each model call, when estimated token count > 60% of context window.

**Layer 3: Autocompact** -- Use an LLM call to summarize the conversation and extract memory candidates.

```typescript
interface AutocompactConfig {
  /** Fraction of context window that triggers autocompact. Default: 0.85 */
  threshold: number;
  /** Max consecutive autocompact failures before giving up. Default: 3 */
  maxFailures: number;
}

interface AutocompactResult {
  /** Compressed messages replacing the old ones */
  messages: LLMMessage[];
  /** Observations worth persisting to long-term memory */
  memoryCandidates: string[];
  /** Tokens freed */
  tokensFreed: number;
}

async function autocompact(
  llm: LLMProvider,
  messages: LLMMessage[],
  config: AutocompactConfig,
): Promise<AutocompactResult> {
  // 1. Take all messages except system prompt and last 4
  // 2. Ask LLM to produce:
  //    a) A concise summary of the conversation so far
  //    b) A list of key observations worth remembering long-term
  // 3. Replace old messages with: [system, summary_message, ...last_4]
  // 4. Return memoryCandidates for the memory system to persist
}
```

When: Applied when estimated tokens > threshold * contextWindowSize.

**Autocompact system prompt** (the LLM call that does the summarization):

```
You are summarizing a conversation between a user and an agent.

Produce a JSON response with two fields:
1. "summary": A concise summary of the conversation so far. Include:
   - The original goal
   - What has been accomplished
   - What is in progress
   - Key decisions made and their rationale
   - Any errors encountered and how they were handled

2. "memories": An array of strings, each a standalone observation worth
   remembering for future sessions. Only include genuinely useful insights,
   not routine facts. Examples of good memories:
   - "Store X's API returns 503 during peak hours (10am-2pm)"
   - "PM Wang prefers dark backgrounds for premium product images"
   - "The logistics intercept API requires tracking_id, not order_id"
```

**Integration into engine.ts:**

Before each model call:
1. Estimate token count of messages
2. If > 60%: apply snip + microcompact
3. If > 85%: apply autocompact, persist memory candidates
4. If autocompact fails 3 times: fall through to reactive compact (existing behavior)

### 5.2 Continuation Decision Tree (`continuation.ts` ~250 LOC)

Reference: Claude Code `query.ts` lines 893-1266 (multi-stage recovery hierarchy).

Replace the current 2-branch continuation with a 6-branch decision tree:

```typescript
type ContinuationAction =
  | { action: "continue"; reason: ContinuationReason }
  | { action: "complete" }
  | { action: "fatal"; error: string };

type ContinuationReason =
  | "tool_results_pending"        // Model emitted tool calls
  | "token_budget_continuation"   // Hit max_output_tokens, can escalate
  | "reactive_compact_retry"      // Context overflow, compacted and retrying
  | "stop_hook_rejected"          // Stop hook said "not done yet"
  | "tool_error_recovery"         // Tool failed, error injected, let LLM adapt
  | "autocompact_recovery";       // Autocompact freed space, continue

function decideContinuation(
  state: TurnEngineState,
  outcome: ModelSampleOutcome,
  stopHookResult?: StopHookResult,
): ContinuationAction
```

**Decision tree (evaluated top-to-bottom, first match wins):**

```
1. outcome has tool requests?
   → { action: "continue", reason: "tool_results_pending" }

2. outcome.finishReason === "max_output_tokens"?
   2a. tokenEscalations < 3?
       → escalate max_tokens (8K → 16K → 64K)
       → { action: "continue", reason: "token_budget_continuation" }
   2b. tokenEscalations >= 3?
       → { action: "complete" }  // Give up gracefully

3. outcome.finishReason === "context_limit" or model error is prompt-too-long?
   3a. autocompact not yet tried?
       → run autocompact
       → { action: "continue", reason: "autocompact_recovery" }
   3b. reactiveCompactRetries < 2?
       → run reactive compact (existing: keep last 4 messages)
       → { action: "continue", reason: "reactive_compact_retry" }
   3c. all retries exhausted?
       → { action: "fatal", error: "Context overflow unrecoverable" }

4. Stop hooks configured and outcome is final response?
   4a. Stop hook returns { pass: false, feedback }?
       → inject feedback as user message
       → { action: "continue", reason: "stop_hook_rejected" }
   4b. Stop hook returns { pass: true }?
       → fall through to step 5

5. Last tool execution had errors AND model didn't address them?
   → { action: "continue", reason: "tool_error_recovery" }
   (error context already in messages; LLM will see it and adapt)

6. No tool calls, finish reason is "stop", hooks pass:
   → { action: "complete" }
```

**Token escalation** (new capability):

```typescript
interface TokenEscalationConfig {
  /** Escalation stages for max_output_tokens. Default: [8192, 16384, 65536] */
  stages: number[];
}
```

When the model hits `max_output_tokens`, instead of just appending "continue where you left off", we ALSO increase `maxTokens` on the next LLM call. This matches Claude Code's behavior (`maxOutputTokensRecoveryCount` in `query.ts`).

### 5.3 Streaming Tool Execution (`streaming-executor.ts` ~300 LOC)

Reference: Claude Code `services/tools/StreamingToolExecutor.ts`.

Execute tools while the model is still streaming, rather than waiting for the full response.

```typescript
interface StreamingToolExecutor {
  /** Feed a chunk from the model stream */
  onChunk(chunk: LLMStreamChunk): void;

  /** Signal that the model stream has ended */
  onStreamEnd(): void;

  /** Get completed tool results (may be called before stream ends) */
  getCompletedResults(): AgentToolCallRecord[];

  /** Wait for all dispatched tools to complete */
  drain(): Promise<AgentToolCallRecord[]>;
}

function createStreamingToolExecutor(
  tools: Map<string, AgentTool>,
  config: StreamingExecutorConfig,
): StreamingToolExecutor {
  // Internal state:
  // - Accumulates streamed content
  // - Attempts to parse tool calls from partial content
  // - When a complete tool call is detected:
  //     If tool.isConcurrencySafe or tool is read-only: execute immediately
  //     Else: queue for execution after stream ends
  // - Tracks: queued → executing → completed
}
```

**This module replaces `sampler.ts`.** The old sampler's tool request parsing logic (`parseToolRequests`, `normalizeToolRequests`, `extractFencedJson`, `normalizeFinishReason`) moves here. The streaming executor is the single code path for both streaming and non-streaming LLM providers.

**Integration into engine.ts:**

The current flow is:
```
model.chat() → wait → parse tool calls → execute tools
```

The new flow is:
```
model.stream() → for each chunk:
  executor.onChunk(chunk)        // may detect and start tool execution
→ executor.onStreamEnd()
→ executor.drain()               // wait for any in-flight tools
→ results already available       // no additional wait
```

**Non-streaming fallback:** If the LLM provider only has `chat()` (no `stream()`), the executor calls `chat()`, feeds the full response as a single chunk, then proceeds identically. One code path, not two.

**Concurrency rules** (matching Claude Code `toolOrchestration.ts`):

```typescript
interface StreamingExecutorConfig {
  /** Max concurrent tool executions. Default: 10 */
  maxConcurrency: number;
  /** Read-only tool name patterns that can execute during streaming. Default: all */
  readOnlyPatterns?: string[];
}
```

- Read-only tools (`isConcurrencySafe === true`): execute immediately during streaming, up to `maxConcurrency`
- Write tools: queued, executed serially after stream ends
- If model output is not streaming (provider only has `chat()`): fall back to current behavior (no streaming executor)

### 5.4 Dynamic System Prompt Composer (`prompt-composer.ts` ~180 LOC)

Reference: Claude Code `utils/systemPrompt.ts` + `constants/systemPromptSections.ts`.

Compose the system prompt from layers, not a static template.

```typescript
interface PromptLayer {
  /** Unique identifier for this layer */
  id: string;
  /** Content to include */
  content: string;
  /** Where to place this layer */
  position: "prepend" | "append" | "replace_base";
  /** Priority for ordering within position group (higher = earlier). Default: 0 */
  priority?: number;
}

interface SystemPromptComposerConfig {
  /** Base system prompt. If omitted, uses default agent prompt */
  base?: string;
  /** Static layers added at creation time */
  layers?: PromptLayer[];
  /** Dynamic layer provider called before each model turn */
  dynamicLayers?: (context: PromptContext) => PromptLayer[];
}

interface PromptContext {
  /** Available tools (for dynamic tool description injection) */
  tools: AgentTool[];
  /** Current iteration count */
  iteration: number;
  /** Retrieved memories for this turn */
  memories: string[];
  /** Estimated token budget remaining for prompt */
  tokenBudget: number;
}

function composeSystemPrompt(
  config: SystemPromptComposerConfig,
  context: PromptContext,
): string {
  // 1. Start with base prompt (default or custom)
  // 2. Collect all layers (static + dynamic)
  // 3. Sort by position, then priority
  // 4. Apply: prepend layers, then base, then append layers
  //    (replace_base swaps the base entirely)
  // 5. If tool catalog is deferred, omit tool descriptions from base
  // 6. If memories present, append memory section
  // 7. Trim to tokenBudget
}
```

**Default base prompt** (replaces the current static template in `messages.ts`):

```
You are an autonomous agent. Accomplish the user's goal using the
available tools. When finished, respond with a final summary in plain text.

To call tools, respond with JSON:
{"tool": "<name>", "arguments": { ... }}

For multiple concurrent calls:
[{"tool": "<name>", "arguments": { ... }}, ...]

To finish, respond with plain text (no JSON tool call).
```

**Memory layer** (injected dynamically when memories are retrieved):

```
## Relevant Memories

The following are observations from your past experience that may be
relevant to the current task:

{memories joined by newlines}

Use these memories to inform your decisions. Do not mention them
explicitly unless asked.
```

### 5.5 Deferred Tool Loading (`tool-catalog.ts` ~130 LOC)

Reference: Claude Code `tools/ToolSearchTool/` + deferred tool loading pattern.

When the tool count exceeds a threshold, switch from listing all tools in the system prompt to providing a meta-tool for discovery.

```typescript
interface ToolCatalogConfig {
  /** Tools above this count trigger deferred loading. Default: 15 */
  deferThreshold: number;
}

function createToolCatalog(
  tools: AgentTool[],
  config: ToolCatalogConfig,
): ToolCatalogResult {
  if (tools.length <= config.deferThreshold) {
    // Inline mode: return all tool descriptions for system prompt
    return { mode: "inline", promptSection: formatToolDescriptions(tools) };
  }

  // Deferred mode: create a discover_tools meta-tool
  const discoverTool: AgentTool = {
    name: "discover_tools",
    description:
      "Search for available tools by keyword. Returns matching tool names " +
      "and descriptions. Use this before calling a tool you haven't seen yet.",
    isConcurrencySafe: true,
    async execute(args) {
      const query = (args.query as string ?? "").toLowerCase();
      const matches = tools.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query),
      );
      return matches.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    },
  };

  return {
    mode: "deferred",
    promptSection: `You have ${tools.length} tools available. Use the "discover_tools" tool to find the right tool for each task.`,
    discoverTool,
  };
}
```

**Integration:** When `mode === "deferred"`, the engine adds `discoverTool` to the available tools and uses the short prompt section instead of the full tool listing. All original tools remain executable -- they're just not described upfront.

### 5.6 Stop Hooks (`stop-hooks.ts` ~80 LOC)

Reference: Claude Code stop hooks in `query.ts` lines 1200-1250.

Stop hooks evaluate the agent's final response before the loop completes. They replace the deleted reflection module with a simpler, more correct mechanism.

```typescript
interface StopHook {
  /** Hook name for identification */
  name: string;
  /** Evaluate the agent's final response. Return pass=false to force continuation */
  evaluate(context: StopHookContext): Promise<StopHookResult>;
}

interface StopHookContext {
  /** The agent's final response text */
  response: string;
  /** Full message history */
  messages: LLMMessage[];
  /** All tool calls made during the run */
  toolCalls: AgentToolCallRecord[];
  /** The original goal */
  goal: string;
}

interface StopHookResult {
  /** Whether the response is acceptable */
  pass: boolean;
  /** Feedback to inject if pass=false (agent sees this and tries again) */
  feedback?: string;
}
```

**Integration into engine.ts:**

After the model produces a final response (no tool calls, finish_reason="stop"):

1. Run all stop hooks in sequence
2. If any hook returns `{ pass: false, feedback }`:
   - Inject feedback as a user message: `[STOP_HOOK: {hook.name}] {feedback}`
   - Continue the loop (reason: `stop_hook_rejected`)
3. If all hooks pass: complete the run

**Example stop hook** (developer-defined):

```typescript
const qualityGate: StopHook = {
  name: "quality-gate",
  async evaluate({ response, goal }) {
    if (response.length < 50 && goal.length > 100) {
      return { pass: false, feedback: "Response seems too brief for this task. Please elaborate." };
    }
    return { pass: true };
  },
};
```

### 5.7 Memory Integration (`memory.ts` rewrite ~200 LOC)

**Changes to MemoryEntry (simplify):**

```typescript
// BEFORE (over-engineered)
interface MemoryEntry {
  id: string;
  content: string;
  scope: MemoryScope;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  importance?: "low" | "medium" | "high" | "critical";  // DELETE
  type?: "fact" | "event" | "preference" | "instruction"; // DELETE
  accessCount: number;           // DELETE
  lastAccessedAt: string;        // DELETE
}

// AFTER (let LLM decide content, framework manages plumbing)
interface MemoryEntry {
  id: string;
  content: string;
  scope: MemoryScope;
  embedding?: number[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}
```

**Memory pipeline integration points:**

1. **Before first model call:** Retrieve relevant memories for the goal + inject into system prompt via prompt composer
2. **During autocompact:** `memoryCandidates` from the autocompact LLM call are persisted to the memory store
3. **On session end:** A session summary is stored as a memory entry (configurable)

**No changes to MemoryBackend interface.** The `store()`, `query()`, `remove()`, `clear()` methods remain the same. Callers just pass fewer fields.

**`createSmartAgent` memory config:**

```typescript
interface SmartAgentMemoryConfig {
  /** Memory store backend (in-memory, SQLite, PostgreSQL) */
  store: MemoryBackend;
  /** Primary scope for this agent's memories */
  scope: MemoryScope;
  /** Additional scopes this agent can read from */
  readScopes?: MemoryScope[];
  /** Embedding provider for semantic search. If omitted, keyword-only */
  embedding?: MemoryEmbedder;
  /** Max tokens of memory to inject per turn. Default: 2000 */
  maxMemoryTokens?: number;
  /** Save session summary on completion. Default: true */
  saveSessionSummary?: boolean;
}
```

## 6. Public API

### 6.1 `createSmartAgent` (new top-level API)

```typescript
interface SmartAgentConfig {
  /** LLM provider */
  llm: LLMProvider;
  /** Available tools */
  tools: AgentTool[];
  /** Available tasks (long-running async work) */
  tasks?: AgentTask[];
  /** Memory configuration (optional) */
  memory?: SmartAgentMemoryConfig;
  /** System prompt configuration */
  prompt?: SystemPromptComposerConfig;
  /** Stop hooks for post-response validation */
  stopHooks?: StopHook[];
  /** Max iterations per run. Default: 200 */
  maxIterations?: number;
  /** Context window size in tokens. Default: 200000 */
  contextWindowSize?: number;
  /** Compaction configuration overrides */
  compaction?: Partial<{
    snip: SnipConfig;
    microcompact: MicrocompactConfig;
    autocompact: AutocompactConfig;
  }>;
  /** Streaming executor configuration */
  streaming?: StreamingExecutorConfig;
  /** Tool catalog configuration */
  toolCatalog?: ToolCatalogConfig;
  /** Lifecycle hooks */
  hooks?: AgentLoopOptions;
}

interface SmartAgent {
  /** Start a new agent run */
  run(goal: string): Promise<AgentRunResult>;
  /** Resume a paused run with a new message (e.g., PM feedback) */
  resume(checkpoint: AgentLoopCheckpoint, message: string): Promise<AgentRunResult>;
}

function createSmartAgent(config: SmartAgentConfig): SmartAgent;
```

### 6.2 Old APIs Removed

| Old API | Replacement |
|---------|-------------|
| `runAgentLoop(llm, config, tools, opts)` | `createSmartAgent({ llm, tools }).run(goal)` |
| `createAI(config)` | `createSmartAgent(config)` |
| `runTurnEngine(...)` | Internal to engine.ts, not exported |
| `createAgentLoopRuntimeState(...)` | Internal to engine.ts, not exported |

No shims, no re-exports, no deprecation warnings. Old functions are deleted.

## 7. Engine Rewrite (`engine.ts`)

The main loop pseudocode after rewrite:

```
function runTurnEngine(llm, config, tools, opts):
  state = createTurnEngineState(config, tools, opts)
  toolCatalog = createToolCatalog(tools, config.toolCatalog)
  memoryContext = await retrieveMemories(config.memory, config.goal)
  systemPrompt = composeSystemPrompt(config.prompt, { tools, memories: memoryContext })
  state.messages[0] = { role: "system", content: systemPrompt }

  while state.iterations < state.maxIterations:
    // === COMPRESSION CHECK (before each model call) ===
    estimatedTokens = estimateTokens(state.messages)
    if estimatedTokens > 0.60 * contextWindow:
      state.messages = snip(state.messages) + microcompact(state.messages)
    if estimatedTokens > 0.85 * contextWindow:
      { messages, memoryCandidates } = await autocompact(llm, state.messages)
      state.messages = messages
      await persistMemoryCandidates(memoryCandidates, config.memory)

    // === CONTROL CHECK ===
    controlled = await evaluateControl("before_llm")
    if controlled: return controlled

    // === MODEL CALL ===
    state.iterations += 1
    if llm.stream:
      executor = createStreamingToolExecutor(tools)
      for await chunk of llm.stream(state.messages, { maxTokens }):
        executor.onChunk(chunk)
      executor.onStreamEnd()
      records = await executor.drain()
      // Content and tool requests extracted from streaming
    else:
      outcome = await sampleModel(llm, state.messages)
      records = await executeToolRequests(state, outcome.toolRequests)

    // === ERROR HANDLING ===
    catch modelError:
      decision = decideContinuation(state, errorOutcome)
      if decision.action === "continue": apply and continue
      if decision.action === "fatal": return fatal result

    // === CONTINUATION DECISION ===
    if records.length > 0:
      applyToolResults(state, records)
      continue  // next iteration

    decision = decideContinuation(state, outcome, await runStopHooks(state))
    if decision.action === "continue":
      applyContinuation(state, decision.reason)
      continue
    if decision.action === "complete":
      await persistSessionSummary(state, config.memory)
      return completedResult

  // Max iterations reached
  await persistSessionSummary(state, config.memory)
  return maxIterationsResult
```

## 8. Files Changed

### New files

| File | LOC | Purpose |
|------|-----|---------|
| `loop/compaction.ts` | ~350 | Three-layer context compression (snip, microcompact, autocompact) |
| `loop/streaming-executor.ts` | ~300 | Streaming tool execution during model output |
| `loop/prompt-composer.ts` | ~180 | Dynamic system prompt assembly from layers |
| `loop/tool-catalog.ts` | ~130 | Deferred tool loading with discover_tools meta-tool |
| `loop/stop-hooks.ts` | ~80 | Post-response validation hooks |

### Rewritten files

| File | Change |
|------|--------|
| `loop/engine.ts` | Full rewrite. The smart runtime main loop. |
| `loop/continuation.ts` | Full rewrite. 2 branches → 6-branch decision tree with token escalation. |
| `loop/state.ts` | Rewrite. Simplified orchestration state, add compaction/memory/streaming fields. |
| `types.ts` | Rewrite. Delete old MemoryEntry fields, delete old AgentRunConfig/AgentLoopOptions, replace with SmartAgentConfig and clean types. |
| `memory.ts` | Rewrite. Strip importance/type/accessCount/lastAccessedAt. Keep store/query/remove core. |
| `index.ts` | Rewrite. Export createSmartAgent as the sole public API. Clean up re-exports. |

### Deleted files

| File | Reason |
|------|--------|
| `loop/kernel.ts` | Redundant wrapper of engine.ts |
| `loop/messages.ts` | Replaced by prompt-composer.ts |
| `loop/sampler.ts` | Replaced by streaming-executor.ts (which includes parsing logic) |
| `agent-loop.ts` | Replaced by createSmartAgent |
| `context.ts` | Replaced by createSmartAgent |

### Files kept (no changes needed)

| File | Reason |
|------|--------|
| `loop/tool-orchestrator.ts` | Concurrency grouping logic is correct. Streaming executor wraps this for non-streaming path. |
| `loop/task-orchestrator.ts` | Task submission/wait logic is correct. |
| `think.ts` | Standalone utility, separate concern. |
| `harness/*` | Separate concern, no changes. |

## 9. Test Strategy

Test code should be at least 2x the implementation code.

### Unit tests (one file per module)

| Test file | Tests | Covers |
|-----------|-------|--------|
| `ai-compaction.test.ts` | ~30 | snip, microcompact, autocompact, memory candidate extraction, failure recovery, token estimation |
| `ai-continuation-tree.test.ts` | ~25 | All 6 decision branches, token escalation, max retries, stop hook integration |
| `ai-streaming-executor.test.ts` | ~25 | Partial JSON parsing, concurrent execution, read-only detection, stream end drain, fallback to non-streaming |
| `ai-prompt-composer.test.ts` | ~15 | Layer ordering, memory injection, base replacement, token budget trimming |
| `ai-tool-catalog.test.ts` | ~10 | Inline vs deferred threshold, discover_tools search, parameter forwarding |
| `ai-stop-hooks.test.ts` | ~10 | Pass/fail, feedback injection, multiple hooks, hook ordering |
| `ai-memory-integration.test.ts` | ~15 | Retrieval at start, promotion during autocompact, session summary on end, scope isolation |

### Integration tests

| Test file | Tests | Covers |
|-----------|-------|--------|
| `ai-smart-agent.test.ts` | ~20 | Full createSmartAgent → run → result cycle. Multi-turn with tool calls. Resume from checkpoint. Context compression under load. Memory persistence across runs. |

### Regression

The old `ai-agent-loop.test.ts` (56 tests) uses the deleted `runAgentLoop` API. These tests are **rewritten** against `createSmartAgent().run()` in `ai-smart-agent.test.ts`. Every behavior the old tests verified must still pass under the new API. Old test file is deleted.

**Total: ~170+ tests, ~3500+ LOC test code vs ~1500 LOC implementation.**

## 10. Migration

No migration. No production users. No backward compatibility shims.

- `runAgentLoop` → deleted. Use `createSmartAgent().run()`.
- `createAI` → deleted. Use `createSmartAgent()`.
- `MemoryEntry.importance/type/accessCount/lastAccessedAt` → deleted. LLM decides content.
- `AgentRunConfig` → replaced by `SmartAgentConfig`. Cleaner, fewer fields.
- `AgentLoopOptions` → merged into `SmartAgentConfig.hooks`. No separate options bag.
- Worktree branch `worktree-agent-a18f26ad` → abandoned, never merged.

## 11. What This Does NOT Include

- **Multi-agent coordination** -- Out of scope. Each agent is independent.
- **Browser/filesystem sandboxes** -- Separate harness concern. Unchanged.
- **Cron integration** -- Already works via `ai-loop.ts`. Smart agent is a better engine underneath. `createAgentCron` will need a one-line update to use `createSmartAgent` instead of `runAgentLoop`.
- **Specific LLM provider implementations** -- `LLMProvider` interface unchanged.
- **Approval workflows** -- The `beforeToolCall` / `afterToolCall` hooks move into `SmartAgentConfig.hooks`. Same behavior, cleaner location.

## 12. What Was Killed

For clarity, a complete list of concepts that are gone, not deprecated:

| Concept | Reason for death |
|---------|-----------------|
| `runAgentLoop()` | Replaced by `createSmartAgent().run()` |
| `createAI()` / `AIContext` | Replaced by `createSmartAgent()` / `SmartAgent` |
| `AgentRunConfig` | Replaced by `SmartAgentConfig` |
| `AgentLoopOptions` (standalone) | Merged into `SmartAgentConfig.hooks` |
| `MemoryEntry.importance` | LLM decides importance in content |
| `MemoryEntry.type` | LLM describes type in content |
| `MemoryEntry.accessCount` | Access frequency is not a useful signal |
| `MemoryEntry.lastAccessedAt` | Same |
| `MemoryEntry.updatedAt` | Entries are immutable; new observations create new entries |
| `sampler.ts` | Parsing logic absorbed by `streaming-executor.ts` |
| `messages.ts` | Prompt building absorbed by `prompt-composer.ts` |
| `kernel.ts` | Redundant indirection |
| `agent-loop.ts` | Redundant indirection |
| `context.ts` | Old API surface |
| Planner/Reflection/Recovery | Wrong direction; never merged |

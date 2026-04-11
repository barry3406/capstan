# Engineering Maturity Design — Closing the Gap with Claude Code

## 1. Overview

Four critical engineering gaps between Capstan and Claude Code, all affecting how robust and long-running agents built on Capstan can be. Each is designed as a framework primitive with sensible defaults.

**Scope**: Tool input validation, compression improvements, tool execution robustness, LLM call watchdog.

---

## 2. Tool Input Validation

### Problem
`AgentTool.parameters` is only used as prompt decoration. LLM sends malformed args → tool.execute() crashes at runtime with opaque errors.

### Design

Add optional `validate` hook to AgentTool. If not provided, the engine performs lightweight JSON Schema validation using the existing `parameters` field.

```typescript
interface AgentTool {
  // ... existing fields ...
  validate?: (args: Record<string, unknown>) => { valid: boolean; error?: string };
}
```

**Engine validation pipeline** (in streaming-executor.ts, before calling execute):

```
1. If tool.validate exists → call it
2. Else if tool.parameters exists → run built-in JSON Schema check
3. Validation fails → return error to LLM as tool result (don't call execute)
4. Validation passes → proceed to execute
```

**Built-in JSON Schema validator** — new file `packages/ai/src/loop/validate-args.ts`:
- Check `required` fields exist
- Check `type` matches (string, number, boolean, array, object)
- Check `enum` values
- No nested object validation (keep it lightweight; developers who need deep validation provide `validate`)

**Error format returned to LLM**:
```
Tool "read_file" input validation failed:
- Missing required field: "path"
- Field "timeout": expected number, got string
```

This matches Claude Code's pattern where `InputValidationError` is formatted with Zod error details and returned as a tool_result block.

---

## 3. Compression Improvements

### 3a. Microcompact Caching

**Problem**: `microcompactMessages()` re-scans and re-truncates the entire message history every iteration. Wasted work.

**Design**: Add a `cache: Map<string, string>` that maps `hash(message.content) → truncated content`. Only process messages not in cache.

```typescript
// In compaction.ts
export function microcompactMessages(
  messages: LLMMessage[],
  config: MicrocompactConfig,
  cache?: Map<string, string>,  // NEW optional param
): MicrocompactResult
```

- On first encounter: truncate → store in cache
- On subsequent encounters: use cached truncation
- Cache lives on EngineState, persisted across iterations
- No cache invalidation needed (content-addressed — same content always hashes to same key)

Reference: Claude Code uses `cachedMicrocompact.ts` with hash-keyed cache and `COMPACTABLE_TOOLS` set.

### 3b. Autocompact Circuit Breaker

**Problem**: If autocompact LLM call fails, the engine retries up to `maxFailures` but currently this count resets each iteration. Multiple consecutive failures waste API calls.

**Design**: Track `consecutiveAutocompactFailures` on EngineState (already exists as `autocompactFailures`). After 3 consecutive failures, stop attempting autocompact for the rest of the run.

```typescript
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;

// In engine.ts compression check:
if (state.compaction.autocompactFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
  // Skip autocompact entirely — circuit breaker tripped
} else {
  const result = await autocompact(...);
  if (result.failed) {
    state.compaction.autocompactFailures++;
  } else {
    state.compaction.autocompactFailures = 0; // Reset on success
  }
}
```

Reference: Claude Code's `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` with reset on success (autoCompact.ts line 332).

### 3c. Autocompact Buffer Threshold

**Problem**: Our threshold is `contextWindowSize * 0.85` (hardcoded ratio). Claude Code uses `contextWindow - 13,000` (absolute buffer), which adapts better to different context window sizes.

**Design**: Change threshold to configurable absolute buffer:

```typescript
interface AutocompactConfig {
  threshold?: number;       // existing (deprecated, kept for compat)
  bufferTokens?: number;    // NEW — default 13,000
  maxFailures: number;
}
```

Threshold calculation: `contextWindowSize - (config.bufferTokens ?? 13_000)`.

---

## 4. Tool Execution Robustness

### 4a. Tool Timeout

**Problem**: Tool.execute() with no timeout → agent hangs forever on stuck tools.

**Design**: Add `timeout?: number` (ms) to AgentTool. Engine wraps execute() with AbortSignal:

```typescript
interface AgentTool {
  // ... existing ...
  timeout?: number;  // milliseconds, default: no timeout
}
```

In streaming-executor.ts `executeSingleTool`:
```typescript
const toolTimeout = tool.timeout;
let result: unknown;
if (toolTimeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), toolTimeout);
  try {
    result = await Promise.race([
      tool.execute(cloneArgs(request.args)),
      new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error(`Tool "${request.name}" timed out after ${toolTimeout}ms`)),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
} else {
  result = await tool.execute(cloneArgs(request.args));
}
```

Timeout produces a soft error (recorded as `status: "error"` in tool record, LLM sees the timeout message).

Reference: Claude Code uses AbortController hierarchy (parent → sibling → per-tool) with cascade abort on Bash errors. We keep it simpler — per-tool timeout only.

### 4b. Tool Result Persistence

**Problem**: `toolResultBudget.maxChars` truncates results (lossy). The LLM can never see the full result.

**Design**: Add `persistDir?: string` to ToolResultBudgetConfig. When a result exceeds maxChars AND persistDir is configured:
1. Write full result to `{persistDir}/tool-result-{uuid}.json`
2. Inject truncated version + file path reference into messages
3. Auto-inject a `read_persisted_result` synthetic tool so the LLM can retrieve full results on demand

```typescript
interface ToolResultBudgetConfig {
  maxChars: number;
  preserveStructure?: boolean;
  persistDir?: string;   // NEW — if set, large results persisted to disk
}
```

Message format when persisted:
```
Tool "search_code" returned (truncated, 45000 chars total):
{first 5000 chars}
[...40000 chars omitted — full result saved. Use read_persisted_result tool with id "tr_abc123" to access.]
```

Reference: Claude Code's `contentReplacementState` and `processToolResultBlock()` persist large results and replace with references.

### 4c. Separate Success/Failure Post-Tool Hook

**Problem**: `afterToolCall` doesn't tell you if the tool succeeded or failed.

**Design**: Add `status` parameter:

```typescript
interface SmartAgentHooks {
  afterToolCall?: (tool: string, args: unknown, result: unknown, status: "success" | "error") => Promise<void>;
  // ... rest unchanged
}
```

This is a **breaking change** to the hook signature. Mitigate by checking function arity — if the hook function has 3 params, call old-style; if 4, call new-style. Or just break it (it's a pre-1.0 framework).

Reference: Claude Code has separate `runPostToolUseHooks` and `runPostToolUseFailureHooks` functions.

---

## 5. LLM Call Watchdog

### Problem
`llm.chat()` and `llm.stream()` have no timeout. API hangs → agent hangs forever.

### Design

New config on SmartAgentConfig:
```typescript
interface LLMTimeoutConfig {
  chatTimeoutMs?: number;         // default 120_000 (2 min)
  streamIdleTimeoutMs?: number;   // default 90_000 (90s between chunks)
  stallWarningMs?: number;        // default 30_000 (log after 30s gap)
}
```

```typescript
interface SmartAgentConfig {
  // ... existing ...
  llmTimeout?: LLMTimeoutConfig;
}
```

**Implementation** in streaming-executor.ts:

**For `llm.chat()` (non-streaming)**:
```typescript
const timeout = config?.chatTimeoutMs ?? 120_000;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeout);
try {
  response = await llm.chat(messages, { ...llmOptions, signal: controller.signal });
} finally {
  clearTimeout(timer);
}
```

Note: This requires LLMOptions to optionally accept `signal?: AbortSignal`. Add it to the type. Providers that don't support it can ignore it — the timeout still works via `Promise.race`.

**For `llm.stream()` (streaming)**:
```typescript
let lastChunkTime = Date.now();
const idleTimeout = config?.streamIdleTimeoutMs ?? 90_000;
const stallWarning = config?.stallWarningMs ?? 30_000;
let stallWarned = false;

for await (const chunk of llm.stream(messages, llmOptions)) {
  const gap = Date.now() - lastChunkTime;
  
  if (gap > idleTimeout) {
    throw new Error(`LLM stream idle timeout: no chunks for ${gap}ms (limit: ${idleTimeout}ms)`);
  }
  if (gap > stallWarning && !stallWarned) {
    // Log warning (non-fatal)
    stallWarned = true;
  }
  
  lastChunkTime = Date.now();
  stallWarned = false;
  // ... process chunk
}
```

Reference: Claude Code uses 90s idle timeout, 45s warning, 30s stall detection in their streaming loop (api/claude.ts). We use similar values.

---

## 6. Type Changes Summary

```typescript
// AgentTool additions
interface AgentTool {
  validate?: (args: Record<string, unknown>) => { valid: boolean; error?: string };
  timeout?: number;
}

// SmartAgentConfig additions
interface SmartAgentConfig {
  llmTimeout?: LLMTimeoutConfig;
}

// LLMOptions addition
interface LLMOptions {
  signal?: AbortSignal;  // NEW
}

// SmartAgentHooks change
interface SmartAgentHooks {
  afterToolCall?: (tool: string, args: unknown, result: unknown, status: "success" | "error") => Promise<void>;
}

// ToolResultBudgetConfig addition
interface ToolResultBudgetConfig {
  persistDir?: string;
}

// AutocompactConfig addition
interface AutocompactConfig {
  bufferTokens?: number;
}

// EngineState additions
interface EngineState {
  microcompactCache: Map<string, string>;
}
```

---

## 7. File Changes

```
packages/ai/src/
  types.ts                          MODIFY — add validate, timeout to AgentTool;
                                             add signal to LLMOptions;
                                             add llmTimeout to SmartAgentConfig;
                                             add persistDir to ToolResultBudgetConfig;
                                             update afterToolCall signature
  loop/
    validate-args.ts                CREATE — built-in JSON Schema validator
    engine.ts                       MODIFY — validation before execute, circuit breaker,
                                             pass microcompact cache, persist tool results
    state.ts                        MODIFY — add microcompactCache
    compaction.ts                   MODIFY — microcompact caching param, buffer-based threshold
    streaming-executor.ts           MODIFY — tool timeout, LLM watchdog (chat + stream),
                                             input validation, afterToolCall status param
  index.ts                          MODIFY — export new types

tests/unit/
  validate-args.test.ts             CREATE — JSON Schema validator tests
  engineering-maturity.test.ts      CREATE — watchdog, timeout, persistence, cache tests
```

---

## 8. Testing Strategy

| Feature | Test Cases |
|---------|-----------|
| **Input validation** | Missing required field → error; wrong type → error; valid input → passes; custom validate → called first; no parameters → skip validation |
| **Microcompact cache** | Same content → cached; different content → not cached; cache reduces iterations; cache passed across iterations |
| **Circuit breaker** | 3 failures → stop; success resets counter; fewer than 3 → keep trying |
| **Tool timeout** | Slow tool → timeout error returned to LLM; fast tool → normal result; no timeout configured → no limit |
| **Result persistence** | Large result → file written + reference in message; small result → no persistence; read_persisted_result tool works |
| **afterToolCall status** | Success → status "success"; error → status "error" |
| **Chat timeout** | Slow API → timeout error; fast API → normal response |
| **Stream idle timeout** | Long gap between chunks → timeout; normal stream → completes; stall warning logged |

---

## 9. Non-Goals

- **Deep JSON Schema validation** (nested objects, anyOf, allOf) — developers provide `validate` for that
- **Context collapse** — deferred (optimization, not correctness)
- **Forked agent for autocompact** — deferred (requires forkBackgroundAgent primitive, already designed but not yet fully integrated)
- **Session memory compact** — deferred (harness already has this; will be pulled down later)
- **Tool abort cascade** (Bash error aborts siblings) — deferred (Claude Code-specific pattern for shell tools)

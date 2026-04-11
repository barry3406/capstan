# Testing Strategy

## Overview

Capstan has 3800+ tests across 222+ files. The test suite covers both the
framework itself and the applications it scaffolds, verifies, and helps
operate. Agent tests are the primary focus, organized into 7 categories.

## Agent Testing

### 1. Unit Tests with Mock LLM

Use the `mockLLM()` pattern to create deterministic LLM responses for fast,
offline testing. No API keys needed.

```typescript
import { describe, it, expect } from "bun:test";
import { createSmartAgent } from "@zauso-ai/capstan-ai";
import type { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from "@zauso-ai/capstan-ai";

function mockLLM(responses: string[]): LLMProvider {
  let i = 0;
  return {
    name: "mock",
    async chat(_msgs: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      return { content: responses[i++] ?? "done", model: "mock" };
    },
  };
}

it("validates tool arguments before execution", () => {
  const tool = {
    name: "write_file",
    description: "Write a file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    validate(args: Record<string, unknown>) {
      if (typeof args.path !== "string" || args.path.includes(".."))
        return { valid: false, error: "Invalid path" };
      return { valid: true };
    },
    async execute(args: Record<string, unknown>) {
      return { written: args.path };
    },
  };

  expect(tool.validate({ path: "../etc/passwd" })).toEqual({
    valid: false,
    error: "Invalid path",
  });
});
```

What to test with mock LLM:

- Tool execution and result handling
- Tool input validation (`validate` hook)
- Context compression (snip, microcompact, autocompact triggers)
- Token budget nudge and force-complete behavior
- Tool result budget truncation and disk persistence
- Lifecycle hooks (`afterIteration`, `afterToolCall`, `onRunComplete`)
- Checkpoint serialization and resume
- Error withholding and retry logic
- Memory staleness annotations
- Model fallback with thinking block stripping

### 2. Real LLM End-to-End Tests

Configure `.env.test` with real LLM credentials:

```
# .env.test
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini

# Optional secondary provider for cross-model testing
LLM_SECONDARY_PROVIDER=anthropic
LLM_SECONDARY_API_KEY=sk-ant-...
LLM_SECONDARY_MODEL=claude-sonnet-4-20250514
```

The `describeWithLLM` helper runs test suites once per configured provider,
skipping gracefully when no credentials are available:

```typescript
import { describeWithLLM } from "./helpers/env.js";

describeWithLLM("Smoke — agent basics", (provider) => {
  it("calls a single tool correctly", async () => {
    const agent = createSmartAgent({
      llm: provider,
      tools: [multiplyTool],
      maxIterations: 10,
    });
    const result = await agent.run("What is 17 * 23? Use the multiply tool.");
    expect(result.status).toBe("completed");
    expect(result.toolCalls.find(c => c.tool === "multiply")!.result).toBe(391);
  }, 120_000);
});
```

Three test layers:

- **Smoke** (`tests/e2e/llm/smoke.test.ts`) -- 7 tests, 2 min timeout each.
  Single tool calls, tool chaining, tool selection from multiple options,
  error recovery, skill activation, no-tool responses.
- **Long-run** (`tests/e2e/llm/long-run.test.ts`) -- 4 tests, 10 min timeout
  each. 25+ sequential lookups with context compression, stop hook rejection
  loops, 8-stage pipeline with retries, cross-run evolution with strategy
  injection.
- **Scenario** (`tests/e2e/llm/scenario.test.ts`) -- 2 tests, 10 min timeout
  each. Real filesystem workspace: code generation from scratch with test
  verification, bug diagnosis and fix with `bun test` validation.

### 3. Adversarial Tests (18 cases)

File: `tests/unit/adversarial-llm.test.ts`

Test that the agent runtime handles malformed or hostile LLM output without
crashing:

- **Malformed JSON** -- invalid JSON in tool call arguments, partial JSON,
  extra trailing characters
- **Nonexistent tools** -- LLM calls a tool name that does not exist in the
  registry
- **Circular references** -- tool A calls tool B which calls tool A; the
  call stack guard should detect and break cycles
- **Huge responses** -- tool results exceeding `toolResultBudget.maxChars`;
  the runtime should truncate and optionally persist the full result to
  `persistDir`
- **Null arguments** -- tool calls with null, undefined, or empty args
- **Path traversal** -- tool arguments containing `../` or absolute paths
  outside the sandbox; the `validate` hook should reject these
- **Type coercion** -- wrong argument types (string where number expected)
- **Missing required fields** -- tool calls omitting required parameters

### 4. Long-Chain Tests (6 cases)

File: `tests/unit/long-chain-idempotency.test.ts` (long-chain section)

Test agent behavior over 50+ iterations with context compression:

```typescript
it("survives 50+ iterations with autocompact", async () => {
  const agent = createSmartAgent({
    llm: provider,
    tools: longRunningTools,
    maxIterations: 60,
    contextWindowSize: 16_000,
    compaction: {
      autocompact: { threshold: 0.85, maxFailures: 3 },
      microcompact: { maxToolResultChars: 2000, protectedTail: 4 },
      snip: { preserveTail: 6 },
    },
  });
  const result = await agent.run("Process all 50 items in the queue.");
  expect(result.status).toBe("completed");
  expect(result.iterations).toBeGreaterThan(30);
}, 600_000);
```

What long-chain tests verify:

- Context compression fires correctly under pressure
- Accumulated state survives compaction (running sums, counters)
- Multiple compression tiers activate in sequence
- Agent maintains goal coherence across compact boundaries
- Tool call history is preserved after snip/microcompact
- No infinite loops when compression cannot free enough space

### 5. Idempotency Tests (6 cases)

File: `tests/unit/long-chain-idempotency.test.ts` (idempotency section)

Test checkpoint resume and deterministic replay:

- Save a checkpoint mid-run via `onCheckpoint` hook
- Resume from the saved checkpoint with `agent.resume(checkpoint, message)`
- Verify the resumed run produces the same outcome as a fresh run
- Test that checkpoint serialization round-trips cleanly (JSON parse/stringify)
- Evolution store deduplication (same experience recorded twice produces one entry)
- Deterministic replay of tool call sequences from saved state

### 6. Smoke Tests (55+ cases)

Files: `tests/unit/runtime-maturity.test.ts` (27 cases),
`tests/unit/skill-layer.test.ts` (45 cases),
`tests/unit/validate-args.test.ts` (17 cases)

Test every public API and configuration combination:

- With and without `fallbackLlm`
- With and without `skills`
- With and without `evolution` (InMemoryEvolutionStore, SqliteEvolutionStore)
- With and without `llmTimeout` (`LLMTimeoutConfig`)
- With and without `compaction` at each tier (snip, microcompact, autocompact)
- With and without `toolResultBudget`
- With `tokenBudget` as a number vs. a `TokenBudgetConfig` object
- All `AgentTool` option permutations (`validate`, `timeout`, `parameters`)
- Skill lifecycle: `defineSkill`, `createActivateSkillTool`, system prompt injection
- Evolution lifecycle: `buildExperience`, `shouldCapture`, `buildStrategyLayer`,
  `runPostRunEvolution`, `parseStrategies`

### 7. Engineering Maturity Tests (50 cases)

File: `tests/unit/engineering-maturity.test.ts`

Comprehensive tests for production-grade agent infrastructure:

- **Integration** (validation pipeline, tool timeout, LLM watchdog, disk
  persistence of large results, microcompact with caching)
- **Adversarial** (path traversal in validate, edge cases in JSON Schema
  validation, malformed tool parameters)
- **Contract** (`afterToolCall` status values, `LLMTimeoutConfig` shape,
  streaming idle timeout behavior, `persistDir` file creation)
- **Regression** (backward compatibility with minimal config, default
  timeout values, compaction with zero-length messages)

---

## Web App Testing

### Testing defineAPI Routes

Test an API handler directly by calling the handler function:

```typescript
import { describe, test, expect } from "bun:test";
import { GET } from "../app/routes/api/tickets/index.api.ts";

test("returns tickets filtered by status", async () => {
  const result = await GET.handler({
    input: { status: "open" },
    params: {},
    ctx: {
      auth: { isAuthenticated: true, type: "human", userId: "u1" },
      request: new Request("http://localhost/api/tickets?status=open"),
      env: {},
    },
  });
  expect(result.tickets).toBeArray();
  expect(result.tickets.every(t => t.status === "open")).toBe(true);
});
```

### Testing Policies

```typescript
import { definePolicy } from "@zauso-ai/capstan-core";

const policy = definePolicy({
  key: "testPolicy",
  title: "Test",
  effect: "deny",
  async check({ ctx }) {
    if (!ctx.auth.isAuthenticated) return { effect: "deny", reason: "Not authenticated" };
    return { effect: "allow" };
  },
});

test("denies unauthenticated requests", async () => {
  const result = await policy.check({
    ctx: { auth: { isAuthenticated: false, type: "anonymous" } },
    input: {},
  });
  expect(result.effect).toBe("deny");
});
```

### Testing Approval Workflows

```typescript
import { createApproval, resolveApproval, clearApprovals } from "@zauso-ai/capstan-core";

beforeEach(() => clearApprovals());

test("approval lifecycle", async () => {
  const approval = createApproval({
    route: "POST /tickets",
    input: { title: "New ticket" },
    reason: "Agent write requires review",
    requestedBy: { type: "agent", agentId: "agent_1" },
  });
  expect(approval.status).toBe("pending");

  const resolved = resolveApproval(approval.id, {
    action: "approve",
    reviewedBy: { type: "human", userId: "admin_1" },
  });
  expect(resolved.status).toBe("approved");
});
```

### Integration Test with Dev Server

```typescript
import { createDevServer } from "@zauso-ai/capstan-dev";

test("health endpoint responds", async () => {
  const server = await createDevServer({
    routesDir: join(projectDir, "app/routes"),
    port: 0,
  });
  await server.start();

  const res = await fetch(`http://localhost:${server.port}/api/health`);
  expect(res.status).toBe(200);
  expect((await res.json()).ok).toBe(true);

  await server.stop();
});
```

### Performance Benchmarks

Capstan keeps a committed benchmark suite under `benchmarks/`. Current gates:

- React SSR render hot paths
- Route scanning and matching on synthetic app trees
- In-memory runtime request handling
- Page runtime document and navigation payload generation

Run with `npm run perf:check` to enforce budgets.

---

## Running Tests

```bash
# Full suite (3800+ tests)
npm test

# Real LLM tests (requires .env.test)
npm run test:llm

# Smoke only (fast, 2 min timeout)
npm run test:llm:smoke

# Long-run + scenario (slow, 10 min timeout)
npm run test:llm:long

# Node contract suite (Vitest)
npm run test:node

# Vitest-only workflow
npm run test:vitest

# Browser e2e (Playwright)
npm run test:e2e

# Single file
bun test tests/unit/engineering-maturity.test.ts

# Performance gate
npm run perf:check
```

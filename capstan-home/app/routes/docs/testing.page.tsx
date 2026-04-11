import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function TestingPage() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "Testing Strategy"),
    createElement("p", null,
      "Capstan has 3800+ tests across 222+ files. The test suite covers both the framework itself and the applications it scaffolds, verifies, and helps operate. ",
      "Agent tests are the primary focus, organized into 7 categories."
    ),

    // ── Agent Testing ────────────────────────────────────────────────
    createElement("h2", null, "Agent Testing"),

    // 1. Unit Tests with Mock LLM
    createElement("h3", null, "1. Unit Tests with Mock LLM"),
    createElement("p", null,
      "Use the ", createElement("code", null, "mockLLM()"),
      " pattern to create deterministic LLM responses for fast, offline testing. No API keys needed."
    ),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { describe, it, expect } from "bun:test";
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
});`
      )
    ),
    createElement("p", null, "What to test with mock LLM:"),
    createElement("ul", null,
      createElement("li", null, "Tool execution and result handling"),
      createElement("li", null, "Tool input validation (", createElement("code", null, "validate"), " hook)"),
      createElement("li", null, "Context compression (snip, microcompact, autocompact triggers)"),
      createElement("li", null, "Token budget nudge and force-complete behavior"),
      createElement("li", null, "Tool result budget truncation and disk persistence"),
      createElement("li", null, "Lifecycle hooks (", createElement("code", null, "afterIteration"), ", ", createElement("code", null, "afterToolCall"), ", ", createElement("code", null, "onRunComplete"), ")"),
      createElement("li", null, "Checkpoint serialization and resume"),
      createElement("li", null, "Error withholding and retry logic"),
      createElement("li", null, "Memory staleness annotations"),
      createElement("li", null, "Model fallback with thinking block stripping")
    ),

    // 2. Real LLM End-to-End Tests
    createElement("h3", null, "2. Real LLM End-to-End Tests"),
    createElement("p", null,
      "Configure ", createElement("code", null, ".env.test"),
      " with real LLM credentials. The ", createElement("code", null, "describeWithLLM"),
      " helper runs test suites once per configured provider, skipping gracefully when no credentials are available."
    ),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { describeWithLLM } from "./helpers/env.js";

describeWithLLM("Smoke -- agent basics", (provider) => {
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
});`
      )
    ),
    createElement("p", null, "Three test layers:"),
    createElement("ul", null,
      createElement("li", null,
        createElement("strong", null, "Smoke"), " (", createElement("code", null, "tests/e2e/llm/smoke.test.ts"),
        ") -- 7 tests, 2 min timeout each. Single tool calls, tool chaining, tool selection, error recovery, skill activation."
      ),
      createElement("li", null,
        createElement("strong", null, "Long-run"), " (", createElement("code", null, "tests/e2e/llm/long-run.test.ts"),
        ") -- 4 tests, 10 min timeout each. 25+ sequential lookups with context compression, stop hook rejection loops, cross-run evolution."
      ),
      createElement("li", null,
        createElement("strong", null, "Scenario"), " (", createElement("code", null, "tests/e2e/llm/scenario.test.ts"),
        ") -- 2 tests, 10 min timeout each. Real filesystem workspace: code generation with test verification, bug diagnosis and fix."
      )
    ),

    // 3. Adversarial Tests
    createElement("h3", null, "3. Adversarial Tests (18 cases)"),
    createElement("p", null,
      "File: ", createElement("code", null, "tests/unit/adversarial-llm.test.ts"),
      ". Test that the agent runtime handles malformed or hostile LLM output without crashing:"
    ),
    createElement("ul", null,
      createElement("li", null, "Malformed JSON in tool call arguments"),
      createElement("li", null, "Nonexistent tools -- LLM calls a tool name not in the registry"),
      createElement("li", null, "Huge responses exceeding ", createElement("code", null, "toolResultBudget.maxChars")),
      createElement("li", null, "Null arguments, missing required fields"),
      createElement("li", null, "Path traversal -- ", createElement("code", null, "../"), " in tool arguments; ", createElement("code", null, "validate"), " hook should reject"),
      createElement("li", null, "Type coercion -- wrong argument types (string where number expected)")
    ),

    // 4. Long-Chain Tests
    createElement("h3", null, "4. Long-Chain Tests (6 cases)"),
    createElement("p", null, "Test agent behavior over 50+ iterations with context compression:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`it("survives 50+ iterations with autocompact", async () => {
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
}, 600_000);`
      )
    ),
    createElement("p", null, "What long-chain tests verify: compression fires correctly, accumulated state survives compaction, multiple compression tiers activate in sequence, goal coherence across compact boundaries, no infinite loops when compression cannot free enough space."),

    // 5. Idempotency Tests
    createElement("h3", null, "5. Idempotency Tests (6 cases)"),
    createElement("p", null, "Test checkpoint resume and deterministic replay:"),
    createElement("ul", null,
      createElement("li", null, "Save a checkpoint mid-run via ", createElement("code", null, "onCheckpoint"), " hook"),
      createElement("li", null, "Resume from saved checkpoint with ", createElement("code", null, "agent.resume(checkpoint, message)")),
      createElement("li", null, "Verify the resumed run produces the same outcome as a fresh run"),
      createElement("li", null, "Checkpoint serialization round-trips cleanly (JSON parse/stringify)"),
      createElement("li", null, "Evolution store deduplication (same experience recorded twice produces one entry)")
    ),

    // 6. Smoke Tests
    createElement("h3", null, "6. Smoke Tests (55+ cases)"),
    createElement("p", null,
      "Test every public API and configuration combination: with and without ",
      createElement("code", null, "fallbackLlm"), ", ",
      createElement("code", null, "skills"), ", ",
      createElement("code", null, "evolution"), ", ",
      createElement("code", null, "llmTimeout"), ", ",
      createElement("code", null, "compaction"), " at each tier, ",
      createElement("code", null, "toolResultBudget"), ", ",
      createElement("code", null, "tokenBudget"), " as number vs. object. All ",
      createElement("code", null, "AgentTool"), " option permutations. Skill lifecycle. Evolution lifecycle."
    ),

    // 7. Engineering Maturity Tests
    createElement("h3", null, "7. Engineering Maturity Tests (50 cases)"),
    createElement("p", null,
      "File: ", createElement("code", null, "tests/unit/engineering-maturity.test.ts"),
      ". Comprehensive tests for production-grade agent infrastructure:"
    ),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, "Integration"), " -- validation pipeline, tool timeout, LLM watchdog, disk persistence of large results, microcompact with caching"),
      createElement("li", null, createElement("strong", null, "Adversarial"), " -- path traversal in validate, edge cases in JSON Schema validation, malformed tool parameters"),
      createElement("li", null, createElement("strong", null, "Contract"), " -- ", createElement("code", null, "afterToolCall"), " status values, ", createElement("code", null, "LLMTimeoutConfig"), " shape, streaming idle timeout behavior, ", createElement("code", null, "persistDir"), " file creation"),
      createElement("li", null, createElement("strong", null, "Regression"), " -- backward compatibility with minimal config, default timeout values, compaction with zero-length messages")
    ),

    // ── Web App Testing ──────────────────────────────────────────────
    createElement("h2", null, "Web App Testing"),

    // Testing defineAPI Routes
    createElement("h3", null, "Testing defineAPI Routes"),
    createElement("p", null, "Test an API handler directly by calling the handler function:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { describe, test, expect } from "bun:test";
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
});`
      )
    ),

    // Testing Policies
    createElement("h3", null, "Testing Policies"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { definePolicy } from "@zauso-ai/capstan-core";

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
});`
      )
    ),

    // Testing Approval Workflows
    createElement("h3", null, "Testing Approval Workflows"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { createApproval, resolveApproval, clearApprovals } from "@zauso-ai/capstan-core";

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
});`
      )
    ),

    // Performance Benchmarks
    createElement("h3", null, "Performance Benchmarks"),
    createElement("p", null,
      "Capstan keeps a committed benchmark suite under ",
      createElement("code", null, "benchmarks/"),
      ". Current gates: React SSR render hot paths, route scanning and matching on synthetic app trees, in-memory runtime request handling, page runtime document and navigation payload generation."
    ),
    createElement("p", null,
      "Run with ", createElement("code", null, "npm run perf:check"), " to enforce budgets."
    ),

    // ── Running Tests ────────────────────────────────────────────────
    createElement("h2", null, "Running Tests"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`# Full suite (3800+ tests)
npm test

# Real LLM tests (requires .env.test)
npm run test:llm

# Smoke only (fast, 2 min timeout)
npm run test:llm:smoke

# Long-run + scenario (slow, 10 min timeout)
npm run test:llm:long

# Node contract suite (Vitest)
npm run test:node

# Browser e2e (Playwright)
npm run test:e2e

# Single file
bun test tests/unit/engineering-maturity.test.ts

# Performance gate
npm run perf:check`
      )
    )
  );
}

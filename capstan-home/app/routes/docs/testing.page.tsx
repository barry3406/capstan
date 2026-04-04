import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function TestingPage() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "Testing Strategy"),
    createElement("p", null,
      "Capstan has two products at once: the framework itself, and the applications the framework scaffolds, verifies, and helps operate. ",
      "That means we do not only test package internals. We also test whether generated software remains correct, stable, recoverable, and agent-operable."
    ),

    // ── Quality Goals ─────────────────────────────────────────────
    createElement("h2", null, "Quality Goals"),
    createElement("p", null, "The test strategy protects five things:"),
    createElement("ol", null,
      createElement("li", null, "Shared contract correctness"),
      createElement("li", null, "Executable runtime behavior"),
      createElement("li", null, "Recoverability of long-running work"),
      createElement("li", null, "Human and agent surface agreement"),
      createElement("li", null, "Structured release confidence")
    ),

    // ── Test Layers ───────────────────────────────────────────────
    createElement("h2", null, "Test Layers"),

    // Unit Tests
    createElement("h3", null, "Unit Tests"),
    createElement("p", null,
      "Protect local logic inside a package or module. Typical targets include contract normalization and naming, policy and auth helpers, task state transitions, queue and supervision helpers, and release validation helpers."
    ),
    createElement("p", null, "Expected traits: fast, deterministic, no network, minimal fixture setup."),

    // Integration Tests
    createElement("h3", null, "Integration Tests"),
    createElement("p", null,
      "Verify a command, runtime boundary, or cross-package contract end to end. Typical targets include scaffold or verify commands over fixture apps, runtime contract agreement across HTTP, MCP, A2A, and manifests, semantic ops persistence across runtime, SQLite store, and CLI projections, harness lifecycle behavior across persistence boundaries, and build and release commands over fixture apps."
    ),
    createElement("p", null, "Expected traits: may touch the filesystem, use explicit fixture apps and fixture contracts, focus on behavior across boundaries."),

    // Generated-App Tests
    createElement("h3", null, "Generated-App Tests"),
    createElement("p", null,
      "Prove that scaffolded output is a working product, not just valid source text. Typical targets include generated app build and typecheck, generated operator surface projections and action wiring, generated control-plane discovery and execution, and generated assertions and verify output."
    ),
    createElement("p", null, "Expected traits: black-box mindset over generated output, validate both human and machine surfaces, guard against drift between templates and runtime behavior."),

    // E2E Tests
    createElement("h3", null, "End-To-End Tests"),
    createElement("p", null,
      "Verify complete operator and agent workflows from the outside. Typical targets include scaffold -> run -> operate a generated app, execute long-running work with approval, input, retry, and resume, verify a broken app, repair it, and verify again, and preview or release an app through a framework-managed flow."
    ),
    createElement("p", null, "Expected traits: exercise real system seams, prefer realistic supervision and recovery flows, validate behavior, not just status codes."),

    // ── Fixtures and Artifacts ─────────────────────────────────────
    createElement("h2", null, "Fixtures and Artifacts"),
    createElement("p", null, "Capstan maintains explicit fixtures instead of ad hoc samples. Recommended categories:"),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "tests/fixtures/contracts"), " -- capability, task, and policy inputs"),
      createElement("li", null, createElement("code", null, "tests/fixtures/apps"), " -- scaffolded or hand-authored fixture apps"),
      createElement("li", null, createElement("code", null, "tests/fixtures/broken-apps"), " -- intentionally failing repair scenarios"),
      createElement("li", null, createElement("code", null, "tests/fixtures/harness"), " -- long-running workflow and recovery scenarios"),
      createElement("li", null, "Golden snapshots for manifests, diagnostics, release records, and surface projections")
    ),

    // ── Tooling ───────────────────────────────────────────────────
    createElement("h2", null, "Tooling"),
    createElement("p", null, "Tooling may evolve, but the test layers should stay stable. Current default posture:"),
    createElement("ul", null,
      createElement("li", null, "Unit and integration: Bun and Vitest where appropriate"),
      createElement("li", null, "Browser-level operator flows: Playwright"),
      createElement("li", null, "Snapshots: versioned golden files for diagnostics, manifests, and generated projections")
    ),

    // ── Performance Benchmarks ────────────────────────────────────
    createElement("h2", null, "Performance Benchmarks"),
    createElement("p", null, "Capstan keeps a committed benchmark suite under ", createElement("code", null, "benchmarks/"), ". Purpose: protect hot paths that can regress without changing public APIs, make framework performance budgets explicit and reviewable, and fail CI when measured latency drifts beyond committed thresholds."),
    createElement("p", null, "Current benchmark gates cover:"),
    createElement("ul", null,
      createElement("li", null, "React SSR render hot paths"),
      createElement("li", null, "Page runtime document and navigation payload generation"),
      createElement("li", null, "Route scanning and route matching on a synthetic mid-sized app tree"),
      createElement("li", null, "In-memory runtime request handling for document, navigation, and scoped not-found responses")
    ),
    createElement("p", null, "Working rules: benchmark scenarios should stay deterministic and synthetic, isolate framework overhead (not network conditions), every committed scenario must have a budget, and budget changes should be reviewed like any other runtime contract."),

    // ── Coverage By Kernel ────────────────────────────────────────
    createElement("h2", null, "Coverage By Kernel"),

    createElement("h3", null, "Contract"),
    createElement("p", null, "Required coverage: capability, task, policy, and artifact contract agreement; manifest and projection input stability; generated contract drift detection; protocol-level agreement across HTTP, MCP, A2A, and OpenAPI."),
    createElement("p", null, createElement("strong", null, "Release gate:"), " No new contract surface ships without generated-app proof that humans and agents see the same semantics."),

    createElement("h3", null, "Harness"),
    createElement("p", null, "Required coverage: durable runs, checkpoints, approvals, input requests, retries, and replay; artifact persistence and event streaming; browser, shell, and filesystem sandbox boundary behavior; recurring execution behavior when it reuses harness contracts."),
    createElement("p", null, createElement("strong", null, "Release gate:"), " No long-running runtime feature ships without recovery-path tests."),

    createElement("h3", null, "Surface"),
    createElement("p", null, "Required coverage: generated human surface route, field, and action projection; top-level attention inbox and grouped queue-lane behavior; task/resource/route drill-down continuity; generated control-plane discovery, execution, and error contracts; semantic ops event, incident, and health views over real runtime state."),
    createElement("p", null, createElement("strong", null, "Release gate:"), " No new operator or agent surface ships without proving it remains a projection of shared runtime state."),

    createElement("h3", null, "Feedback"),
    createElement("p", null, "Required coverage: ", createElement("code", null, "capstan verify --json"), " success and failure paths; structured diagnostic output and repair-checklist snapshots; generated-app assertions and runtime smoke checks; break -> verify -> repair -> verify loops on realistic fixtures."),
    createElement("p", null, createElement("strong", null, "Release gate:"), " Common failures must be explainable in structured, actionable terms."),

    createElement("h3", null, "Release"),
    createElement("p", null, "Required coverage: build outputs and deployment-manifest validation; environment and migration contract checks; preview, release, rollback, and history flows; linkage between verification outcomes and release records."),
    createElement("p", null, createElement("strong", null, "Release gate:"), " No release feature ships without failure-path coverage and traceable output."),

    // ── Default Release Gates ─────────────────────────────────────
    createElement("h2", null, "Default Release Gates"),
    createElement("p", null, "Capstan should not promote a milestone unless:"),
    createElement("ul", null,
      createElement("li", null, "At least one generated app proves the intended loop end to end"),
      createElement("li", null, "New runtime behavior has a recovery-path test where recovery matters"),
      createElement("li", null, "New surface behavior has generated-app coverage, not just local unit tests"),
      createElement("li", null, "New release behavior has validation, execution, and rollback coverage"),
      createElement("li", null, "Generated diagnostics remain structured enough for an agent to act on")
    ),

    // ── Working Rule ──────────────────────────────────────────────
    createElement("h2", null, "Working Rule"),
    createElement("p", null, "When deciding whether to add a test, ask:"),
    createElement("ol", null,
      createElement("li", null, "Does this protect the shared contract?"),
      createElement("li", null, "Does this prove real execution instead of template output only?"),
      createElement("li", null, "Does this cover recovery or supervision where recovery or supervision matters?"),
      createElement("li", null, "Would a regression here break an agent's ability to converge without manual guesswork?")
    ),
    createElement("p", null, "If the answer is yes, the test belongs on the critical path."),

    // ── Testing Patterns and Helpers ──────────────────────────────
    createElement("h2", null, "Testing Patterns and Helpers"),

    // Mock LLM
    createElement("h3", null, "Mock LLM for Agent Tests"),
    createElement("p", null, "Use ", createElement("code", null, "mockLLM()"), " from ", createElement("code", null, "@zauso-ai/capstan-ai"), " to create deterministic LLM responses:"),
    createElement("pre", null,
      createElement("code", null,
`import { mockLLM, createHarness } from "@zauso-ai/capstan-ai";

const llm = mockLLM([
  { role: "assistant", content: "Analysis complete." },
  { role: "assistant", tool_calls: [{ name: "create_ticket", arguments: { title: "Bug" } }] },
  { role: "assistant", content: "Ticket created." },
]);

const harness = createHarness({
  appName: "test-app",
  runtimeDir: tmpDir,
});`
      )
    ),

    // Testing defineAPI Routes
    createElement("h3", null, "Testing defineAPI Routes"),
    createElement("p", null, "Test an API handler directly by calling the handler function:"),
    createElement("pre", null,
      createElement("code", null,
`import { describe, test, expect } from "bun:test";
import { GET } from "../app/routes/api/tickets/index.api.ts";

describe("GET /api/tickets", () => {
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
});`
      )
    ),

    // Testing Policies
    createElement("h3", null, "Testing Policies"),
    createElement("pre", null,
      createElement("code", null,
`import { definePolicy } from "@zauso-ai/capstan-core";

const policy = definePolicy({
  key: "testPolicy",
  title: "Test",
  effect: "deny",
  async check({ ctx }) {
    if (!ctx.auth.isAuthenticated) {
      return { effect: "deny", reason: "Not authenticated" };
    }
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

test("allows authenticated requests", async () => {
  const result = await policy.check({
    ctx: { auth: { isAuthenticated: true, type: "human", userId: "u1" } },
    input: {},
  });
  expect(result.effect).toBe("allow");
});`
      )
    ),

    // Testing Model Data Preparation
    createElement("h3", null, "Testing Model Data Preparation"),
    createElement("pre", null,
      createElement("code", null,
`import { defineModel, field, prepareCreateData } from "@zauso-ai/capstan-db";

const Ticket = defineModel("ticket", {
  fields: {
    id: field.id(),
    title: field.string({ required: true, min: 1 }),
    status: field.enum(["open", "closed"], { default: "open" }),
    createdAt: field.datetime({ default: "now" }),
  },
});

test("applies defaults on create", () => {
  const data = prepareCreateData(Ticket, { title: "Bug report" });
  expect(data.id).toBeString();
  expect(data.status).toBe("open");
  expect(data.createdAt).toBeString();
});

test("rejects missing required fields", () => {
  expect(() => prepareCreateData(Ticket, {})).toThrow();
});`
      )
    ),

    // Integration Test with Dev Server
    createElement("h3", null, "Integration Test with Dev Server"),
    createElement("pre", null,
      createElement("code", null,
`import { createDevServer } from "@zauso-ai/capstan-dev";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: Awaited<ReturnType<typeof createDevServer>>;
let projectDir: string;

beforeAll(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "capstan-test-"));
  await mkdir(join(projectDir, "app/routes/api"), { recursive: true });

  // Write a test route
  await writeFile(join(projectDir, "app/routes/api/health.api.ts"), \`
    import { defineAPI } from "@zauso-ai/capstan-core";
    import { z } from "zod";
    export const GET = defineAPI({
      output: z.object({ ok: z.boolean() }),
      description: "Health",
      capability: "read",
      async handler() { return { ok: true }; },
    });
  \`);

  server = await createDevServer({ routesDir: join(projectDir, "app/routes"), port: 0 });
  await server.start();
});

afterAll(async () => {
  await server.stop();
  await rm(projectDir, { recursive: true });
});

test("health endpoint responds", async () => {
  const res = await fetch(\`http://localhost:\${server.port}/api/health\`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
});`
      )
    ),

    // Testing Approval Workflows
    createElement("h3", null, "Testing Approval Workflows"),
    createElement("pre", null,
      createElement("code", null,
`import { createApproval, resolveApproval, clearApprovals } from "@zauso-ai/capstan-core";

beforeEach(() => clearApprovals());

test("approval lifecycle", async () => {
  // Create approval
  const approval = createApproval({
    route: "POST /tickets",
    input: { title: "New ticket" },
    reason: "Agent write requires review",
    requestedBy: { type: "agent", agentId: "agent_1" },
  });

  expect(approval.status).toBe("pending");

  // Approve
  const resolved = resolveApproval(approval.id, {
    action: "approve",
    reviewedBy: { type: "human", userId: "admin_1" },
  });

  expect(resolved.status).toBe("approved");
});`
      )
    ),

    // Testing Harness Runs
    createElement("h3", null, "Testing Harness Runs"),
    createElement("pre", null,
      createElement("code", null,
`import { createHarness, mockLLM } from "@zauso-ai/capstan-ai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "harness-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true });
});

test("harness run persists events", async () => {
  const llm = mockLLM([
    { role: "assistant", content: "Done." },
  ]);

  const harness = createHarness({
    appName: "test",
    runtimeDir: tmpDir,
  });

  const run = await harness.start({
    trigger: "manual",
    metadata: { test: true },
  });

  // Execute with mock LLM
  await run.execute(llm, "Do something");

  // Verify persistence
  const events = await harness.getEvents(run.id);
  expect(events.length).toBeGreaterThan(0);
  expect(events.some(e => e.kind === "run.completed")).toBe(true);
});`
      )
    ),

    // Testing Route Scanning
    createElement("h3", null, "Testing Route Scanning"),
    createElement("pre", null,
      createElement("code", null,
`import { scanRoutes } from "@zauso-ai/capstan-router";

test("scans routes correctly", async () => {
  const manifest = await scanRoutes(join(projectDir, "app/routes"));

  expect(manifest.routes.length).toBeGreaterThan(0);
  expect(manifest.diagnostics?.length ?? 0).toBe(0); // No conflicts

  const apiRoute = manifest.routes.find(r => r.type === "api");
  expect(apiRoute).toBeDefined();
  expect(apiRoute!.methods).toContain("GET");
});`
      )
    ),

    // waitFor Helper
    createElement("h3", null, "waitFor Helper"),
    createElement("p", null, "Poll until a condition is met (useful for async/eventual consistency):"),
    createElement("pre", null,
      createElement("code", null,
`async function waitFor(
  fn: () => boolean | Promise<boolean>,
  { timeout = 5000, interval = 50 } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(\`waitFor timed out after \${timeout}ms\`);
}

// Usage
await waitFor(() => harness.getStatus(runId) === "completed");`
      )
    )
  );
}

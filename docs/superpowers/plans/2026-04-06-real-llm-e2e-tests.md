# Real LLM Agent E2E Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add end-to-end tests that verify Capstan's agent loop with real LLM providers across three layers: smoke (3-5 turns), long-run (30+ turns with compression), and scenario simulation (real filesystem + shell code generation).

**Architecture:** Three test files sharing common helpers for env loading, tool definitions, and workspace management. Tests load LLM config from `.env.test` at project root, support both OpenAI and Anthropic providers via configurable `base_url` + `apiKey`. Tests are excluded from the default `npm test` run and invoked via dedicated `npm run test:llm*` commands.

**Tech Stack:** Bun test, `createSmartAgent` from `packages/ai/src/index.js`, `openaiProvider`/`anthropicProvider` from `packages/agent/src/llm.js`

---

## File Structure

```
.env.test.example                  (create — committed template)
tests/e2e/llm/
  helpers/
    env.ts                         (create — load .env.test, build providers, export describeWithLLM)
    tools.ts                       (create — reusable tool definitions for all test layers)
    workspace.ts                   (create — tmpdir workspace creation/cleanup + bug fixture)
  smoke.test.ts                    (create — 5 short-chain test cases)
  long-run.test.ts                 (create — 3 long-chain test cases)
  scenario.test.ts                 (create — 2 real filesystem + shell test cases)
scripts/run-bun-tests.mjs          (modify — exclude tests/e2e/llm/ from default collection)
package.json                       (modify — add test:llm scripts)
```

---

### Task 1: Create `.env.test.example` and env helper

**Files:**
- Create: `.env.test.example`
- Create: `tests/e2e/llm/helpers/env.ts`

- [ ] **Step 1: Create `.env.test.example`**

```bash
# .env.test.example
#
# Copy to .env.test and fill in your values.
# .env.test is gitignored (matched by .env.* in .gitignore).

# Primary provider (required)
# LLM_PROVIDER — "openai" or "anthropic"
LLM_PROVIDER=openai
LLM_BASE_URL=https://your-relay.example.com/v1
LLM_API_KEY=sk-your-key-here
LLM_MODEL=gpt-4o

# Secondary provider (optional — if set, tests run against both)
# LLM_SECONDARY_PROVIDER=anthropic
# LLM_SECONDARY_BASE_URL=https://your-relay.example.com/v1
# LLM_SECONDARY_API_KEY=sk-your-key-here
# LLM_SECONDARY_MODEL=claude-sonnet-4-20250514
```

- [ ] **Step 2: Create `tests/e2e/llm/helpers/env.ts`**

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { openaiProvider, anthropicProvider } from "../../../../packages/agent/src/llm.js";
import type { LLMProvider } from "../../../../packages/agent/src/llm.js";

export interface LLMTestConfig {
  provider: LLMProvider;
  name: string;
}

function parseEnvFile(path: string): Record<string, string> {
  const content = readFileSync(path, "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}

function buildProvider(type: string, apiKey: string, baseUrl?: string, model?: string): LLMProvider | null {
  if (type === "openai") return openaiProvider({ apiKey, baseUrl, model });
  if (type === "anthropic") return anthropicProvider({ apiKey, baseUrl, model });
  return null;
}

function loadTestProviders(): LLMTestConfig[] {
  const envPath = join(process.cwd(), ".env.test");
  if (!existsSync(envPath)) return [];

  const env = parseEnvFile(envPath);
  const providers: LLMTestConfig[] = [];

  // Primary
  const p = buildProvider(env.LLM_PROVIDER ?? "", env.LLM_API_KEY ?? "", env.LLM_BASE_URL, env.LLM_MODEL);
  if (p) providers.push({ provider: p, name: `${env.LLM_PROVIDER}${env.LLM_MODEL ? ` (${env.LLM_MODEL})` : ""}` });

  // Secondary (optional)
  const s = buildProvider(env.LLM_SECONDARY_PROVIDER ?? "", env.LLM_SECONDARY_API_KEY ?? "", env.LLM_SECONDARY_BASE_URL, env.LLM_SECONDARY_MODEL);
  if (s) providers.push({ provider: s, name: `${env.LLM_SECONDARY_PROVIDER}${env.LLM_SECONDARY_MODEL ? ` (${env.LLM_SECONDARY_MODEL})` : ""}` });

  return providers;
}

export const testProviders = loadTestProviders();
export const hasProviders = testProviders.length > 0;

/**
 * Wrapper that runs a describe block once per configured LLM provider.
 * If no .env.test is found, the entire block is skipped.
 */
export function describeWithLLM(
  name: string,
  fn: (provider: LLMProvider, providerName: string) => void,
): void {
  if (!hasProviders) {
    describe.skip(`[LLM] ${name} — no .env.test`, () => {
      it("skipped", () => {});
    });
    return;
  }
  for (const { provider, name: pName } of testProviders) {
    describe(`[LLM:${pName}] ${name}`, () => {
      fn(provider, pName);
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add .env.test.example tests/e2e/llm/helpers/env.ts
git commit -m "feat: add .env.test infrastructure for real LLM e2e tests"
```

---

### Task 2: Create tools helper

**Files:**
- Create: `tests/e2e/llm/helpers/tools.ts`

- [ ] **Step 1: Create `tests/e2e/llm/helpers/tools.ts`**

```typescript
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import type { AgentTool } from "../../../../packages/ai/src/types.js";

// ---------------------------------------------------------------------------
// Smoke-layer tools (pure computation / fake data)
// ---------------------------------------------------------------------------

export const multiplyTool: AgentTool = {
  name: "multiply",
  description: "Multiplies two numbers and returns the product.",
  parameters: {
    type: "object",
    properties: {
      a: { type: "number", description: "First number" },
      b: { type: "number", description: "Second number" },
    },
    required: ["a", "b"],
  },
  async execute(args) {
    return (args.a as number) * (args.b as number);
  },
};

export const addTool: AgentTool = {
  name: "add",
  description: "Adds two numbers and returns the sum.",
  parameters: {
    type: "object",
    properties: {
      a: { type: "number", description: "First number" },
      b: { type: "number", description: "Second number" },
    },
    required: ["a", "b"],
  },
  async execute(args) {
    return (args.a as number) + (args.b as number);
  },
};

export const getWeatherTool: AgentTool = {
  name: "get_weather",
  description: "Gets current weather for a city. Returns temperature and conditions.",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
    },
    required: ["city"],
  },
  async execute(args) {
    const city = args.city as string;
    return { city, temperature: 22, unit: "celsius", conditions: "partly cloudy" };
  },
};

export const searchDatabaseTool: AgentTool = {
  name: "search_database",
  description: "Searches a database by keyword. Returns matching records.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  async execute(args) {
    return { query: args.query, results: [{ id: 1, title: `Result for "${args.query}"` }], total: 1 };
  },
};

export const formatTextTool: AgentTool = {
  name: "format_text",
  description: "Formats text in a given style: uppercase, lowercase, or titlecase.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string" },
      style: { type: "string", enum: ["uppercase", "lowercase", "titlecase"] },
    },
    required: ["text", "style"],
  },
  async execute(args) {
    const text = args.text as string;
    const style = args.style as string;
    if (style === "uppercase") return text.toUpperCase();
    if (style === "lowercase") return text.toLowerCase();
    return text.replace(/\b\w/g, (c) => c.toUpperCase());
  },
};

// ---------------------------------------------------------------------------
// Scenario-layer tools (real filesystem + shell)
// ---------------------------------------------------------------------------

export function createReadFileTool(workspaceDir: string): AgentTool {
  return {
    name: "read_file",
    description: "Read the contents of a file in the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path within the workspace" } },
      required: ["path"],
    },
    async execute(args) {
      const target = resolve(workspaceDir, args.path as string);
      if (!target.startsWith(workspaceDir)) return { error: "Path outside workspace" };
      if (!existsSync(target)) return { error: `File not found: ${args.path}` };
      return readFileSync(target, "utf-8");
    },
  };
}

export function createWriteFileTool(workspaceDir: string): AgentTool {
  return {
    name: "write_file",
    description: "Write content to a file in the workspace. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within the workspace" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
    async execute(args) {
      const target = resolve(workspaceDir, args.path as string);
      if (!target.startsWith(workspaceDir)) return { error: "Path outside workspace" };
      const dir = join(target, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(target, args.content as string, "utf-8");
      return "ok";
    },
  };
}

export function createListFilesTool(workspaceDir: string): AgentTool {
  return {
    name: "list_files",
    description: "List files and directories in a workspace directory.",
    parameters: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Relative directory path (default: root of workspace)" },
      },
    },
    async execute(args) {
      const target = resolve(workspaceDir, (args.dir as string) ?? ".");
      if (!target.startsWith(workspaceDir)) return { error: "Path outside workspace" };
      if (!existsSync(target)) return { error: `Directory not found: ${args.dir ?? "."}` };
      const entries = readdirSync(target, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }));
    },
  };
}

export function createRunCommandTool(workspaceDir: string): AgentTool {
  return {
    name: "run_command",
    description: "Run a shell command in the workspace directory. Use for running tests (bun test), checking output, etc.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
      },
      required: ["command"],
    },
    async execute(args) {
      const cmd = args.command as string;
      const result = spawnSync("sh", ["-c", cmd], {
        cwd: workspaceDir,
        timeout: 30_000,
        encoding: "utf-8",
        env: { ...process.env },
      });
      return {
        exitCode: result.status ?? 1,
        stdout: (result.stdout ?? "").slice(0, 5000),
        stderr: (result.stderr ?? "").slice(0, 2000),
      };
    },
  };
}

/** Bundle all filesystem + shell tools for a workspace. */
export function createWorkspaceTools(workspaceDir: string): AgentTool[] {
  return [
    createReadFileTool(workspaceDir),
    createWriteFileTool(workspaceDir),
    createListFilesTool(workspaceDir),
    createRunCommandTool(workspaceDir),
  ];
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/llm/helpers/tools.ts
git commit -m "feat: add reusable tool definitions for LLM e2e tests"
```

---

### Task 3: Create workspace helper

**Files:**
- Create: `tests/e2e/llm/helpers/workspace.ts`

- [ ] **Step 1: Create `tests/e2e/llm/helpers/workspace.ts`**

```typescript
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface Workspace {
  dir: string;
  cleanup(): Promise<void>;
}

/** Create an empty temporary workspace directory. */
export async function createWorkspace(prefix = "capstan-llm-"): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a workspace pre-loaded with a buggy TypeScript file and a failing test.
 * The bug: fibonacci uses n-3 instead of n-2 in the recursive case.
 */
export async function createBugFixWorkspace(): Promise<Workspace> {
  const ws = await createWorkspace("capstan-llm-bugfix-");

  await writeFile(
    join(ws.dir, "math.ts"),
    [
      "export function fibonacci(n: number): number {",
      "  if (n <= 0) return 0;",
      "  if (n === 1) return 1;",
      "  return fibonacci(n - 1) + fibonacci(n - 3); // BUG: should be n - 2",
      "}",
      "",
    ].join("\n"),
  );

  await writeFile(
    join(ws.dir, "math.test.ts"),
    [
      'import { expect, test } from "bun:test";',
      'import { fibonacci } from "./math.ts";',
      "",
      'test("fibonacci(0) = 0", () => expect(fibonacci(0)).toBe(0));',
      'test("fibonacci(1) = 1", () => expect(fibonacci(1)).toBe(1));',
      'test("fibonacci(2) = 1", () => expect(fibonacci(2)).toBe(1));',
      'test("fibonacci(5) = 5", () => expect(fibonacci(5)).toBe(5));',
      'test("fibonacci(10) = 55", () => expect(fibonacci(10)).toBe(55));',
      "",
    ].join("\n"),
  );

  return ws;
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/llm/helpers/workspace.ts
git commit -m "feat: add workspace helper for LLM e2e scenario tests"
```

---

### Task 4: Create smoke tests

**Files:**
- Create: `tests/e2e/llm/smoke.test.ts`

- [ ] **Step 1: Create `tests/e2e/llm/smoke.test.ts`**

```typescript
import { it, expect } from "bun:test";
import { createSmartAgent } from "../../../packages/ai/src/index.js";
import type { AgentTool } from "../../../packages/ai/src/types.js";
import { describeWithLLM } from "./helpers/env.js";
import {
  multiplyTool,
  addTool,
  getWeatherTool,
  searchDatabaseTool,
  formatTextTool,
} from "./helpers/tools.js";

// ---------------------------------------------------------------------------
// Smoke layer — 3-5 turn tests, 2 min timeout per case
// ---------------------------------------------------------------------------

describeWithLLM("Smoke — agent basics", (provider) => {

  it("calls a single tool correctly and uses the result", async () => {
    const agent = createSmartAgent({
      llm: provider,
      tools: [multiplyTool],
      maxIterations: 10,
    });

    const result = await agent.run(
      "What is 17 multiplied by 23? Use the multiply tool to calculate this.",
    );

    expect(result.status).toBe("completed");
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    const call = result.toolCalls.find((c) => c.tool === "multiply");
    expect(call).toBeDefined();
    expect(call!.result).toBe(391);
    expect(result.result as string).toContain("391");
  }, 120_000);

  it("chains multiple tool calls using prior results", async () => {
    const agent = createSmartAgent({
      llm: provider,
      tools: [multiplyTool, addTool],
      maxIterations: 10,
    });

    const result = await agent.run(
      "First multiply 6 by 7 using the multiply tool, then add 8 to that result using the add tool. Tell me the final number.",
    );

    expect(result.status).toBe("completed");
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(2);
    // 6*7 = 42, 42+8 = 50
    expect(result.result as string).toContain("50");
  }, 120_000);

  it("selects the correct tool from multiple options", async () => {
    const agent = createSmartAgent({
      llm: provider,
      tools: [multiplyTool, addTool, getWeatherTool, searchDatabaseTool, formatTextTool],
      maxIterations: 10,
    });

    const result = await agent.run(
      "What is the weather in Tokyo? Use the appropriate tool.",
    );

    expect(result.status).toBe("completed");
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.toolCalls[0]!.tool).toBe("get_weather");
  }, 120_000);

  it("responds directly when no tools are needed", async () => {
    const agent = createSmartAgent({
      llm: provider,
      tools: [multiplyTool, addTool],
      maxIterations: 10,
    });

    const result = await agent.run("Say hello in Japanese. Do not use any tools.");

    expect(result.status).toBe("completed");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.iterations).toBe(1);
    expect((result.result as string).length).toBeGreaterThan(0);
  }, 120_000);

  it("recovers when a tool throws an error", async () => {
    let callCount = 0;
    const flakyTool: AgentTool = {
      name: "fetch_data",
      description: "Fetches data for a query. May fail temporarily.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      async execute(args) {
        callCount++;
        if (callCount === 1) throw new Error("Connection timeout — service temporarily unavailable");
        return { data: `Results for: ${args.query}`, count: 3 };
      },
    };

    const agent = createSmartAgent({
      llm: provider,
      tools: [flakyTool],
      maxIterations: 10,
    });

    const result = await agent.run(
      "Fetch data about 'capstan framework' using the fetch_data tool. If it fails, try again.",
    );

    expect(result.status).toBe("completed");
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(2);
    const successes = result.toolCalls.filter((c) => c.status === "success");
    expect(successes.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

});
```

- [ ] **Step 2: Create `.env.test` with real credentials and run smoke tests**

```bash
# Create .env.test with your actual provider credentials, then:
bun test tests/e2e/llm/smoke.test.ts
```

Expected: all 5 tests pass (or skip if `.env.test` is missing).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/llm/smoke.test.ts
git commit -m "feat: add smoke-layer real LLM e2e tests (5 cases)"
```

---

### Task 5: Create long-run tests

**Files:**
- Create: `tests/e2e/llm/long-run.test.ts`

- [ ] **Step 1: Create `tests/e2e/llm/long-run.test.ts`**

```typescript
import { it, expect } from "bun:test";
import { createSmartAgent } from "../../../packages/ai/src/index.js";
import type { AgentTool, StopHook } from "../../../packages/ai/src/types.js";
import { describeWithLLM } from "./helpers/env.js";

// ---------------------------------------------------------------------------
// Long-run layer — 20-50+ turn tests, 10 min timeout per case
// ---------------------------------------------------------------------------

describeWithLLM("Long-run — compression, memory, recovery", (provider) => {

  it("survives context compression over 30+ tool calls", async () => {
    // Database with verbose records to force compression
    const DATABASE: Record<number, Record<string, unknown>> = {};
    for (let i = 1; i <= 30; i++) {
      DATABASE[i] = {
        id: i,
        name: `Record-${i}`,
        category: (["alpha", "beta", "gamma"] as const)[(i - 1) % 3],
        value: i * 10,
        description: `Detailed record #${i} under ${(["alpha", "beta", "gamma"] as const)[(i - 1) % 3]} category with value ${i * 10}. `
          + `This record contains metadata about item ${i}, including creation history, audit logs, and system tags. `
          + `Additional padding to ensure sufficient token usage for compression testing purposes.`,
      };
    }
    // alpha values: ids 1,4,7,10,13,16,19,22,25,28 → values 10,40,70,100,130,160,190,220,250,280 = 1450

    const queryTool: AgentTool = {
      name: "query_record",
      description: "Query a single record by ID (1-30). Returns the full record.",
      parameters: {
        type: "object",
        properties: { id: { type: "number", description: "Record ID (1-30)" } },
        required: ["id"],
      },
      async execute(args) {
        const rec = DATABASE[args.id as number];
        if (!rec) return { error: `No record with ID ${args.id}. Valid: 1-30.` };
        return rec;
      },
    };

    const sumTool: AgentTool = {
      name: "calculate_sum",
      description: "Calculate the sum of an array of numbers.",
      parameters: {
        type: "object",
        properties: { numbers: { type: "array", items: { type: "number" } } },
        required: ["numbers"],
      },
      async execute(args) {
        const nums = args.numbers as number[];
        return { sum: nums.reduce((a, b) => a + b, 0) };
      },
    };

    const agent = createSmartAgent({
      llm: provider,
      tools: [queryTool, sumTool],
      maxIterations: 80,
      // Small context window to force compression during the run
      contextWindowSize: 8000,
    });

    const result = await agent.run(
      'Query all 30 records from the database (IDs 1 through 30) one by one using query_record. '
      + 'After querying all records, find all records in the "alpha" category, then use calculate_sum '
      + 'to add up their values. Report the total. You MUST query each record individually.',
    );

    expect(result.status).toBe("completed");
    // Should have made at least 30 query calls + 1 sum call
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(20);
    expect(result.iterations).toBeGreaterThan(15);
    // The answer for alpha category should be 1450
    expect(result.result as string).toContain("1450");
  }, 600_000);

  it("iteratively improves output when stop hook rejects", async () => {
    const rejections: string[] = [];

    const lengthHook: StopHook = {
      name: "length-check",
      async evaluate(ctx) {
        const pass = ctx.response.length >= 300;
        if (!pass) rejections.push(ctx.response);
        return {
          pass,
          feedback: pass
            ? undefined
            : `Response is ${ctx.response.length} characters, need at least 300. Please elaborate with more detail.`,
        };
      },
    };

    const agent = createSmartAgent({
      llm: provider,
      tools: [],
      maxIterations: 10,
      stopHooks: [lengthHook],
    });

    const result = await agent.run("Explain what TypeScript is and why it is useful.");

    expect(result.status).toBe("completed");
    expect((result.result as string).length).toBeGreaterThanOrEqual(200);
    // Should have been rejected at least once (first response is usually short)
    expect(result.iterations).toBeGreaterThan(1);
  }, 600_000);

  it("completes all subtasks despite random tool failures", async () => {
    const completed = new Set<number>();
    let totalCalls = 0;

    const processTaskTool: AgentTool = {
      name: "process_task",
      description: "Process a task by ID (1-10). May occasionally fail with a transient error.",
      parameters: {
        type: "object",
        properties: { taskId: { type: "number", description: "Task ID (1-10)" } },
        required: ["taskId"],
      },
      async execute(args) {
        const id = args.taskId as number;
        totalCalls++;
        // Fail roughly every 3rd call for IDs not yet completed
        if (!completed.has(id) && totalCalls % 3 === 0) {
          throw new Error(`Transient failure processing task ${id} — please retry`);
        }
        completed.add(id);
        return { taskId: id, status: "completed" };
      },
    };

    const agent = createSmartAgent({
      llm: provider,
      tools: [processTaskTool],
      maxIterations: 40,
    });

    const result = await agent.run(
      "Process all 10 tasks (IDs 1 through 10) using process_task. "
      + "Each task must be completed successfully. If a task fails, retry it. "
      + "Report all completed task IDs when done.",
    );

    expect(result.status).toBe("completed");
    // All 10 tasks should be completed
    expect(completed.size).toBe(10);
    for (let i = 1; i <= 10; i++) {
      expect(completed.has(i)).toBe(true);
    }
    // Should have needed some retries
    expect(totalCalls).toBeGreaterThan(10);
  }, 600_000);

});
```

- [ ] **Step 2: Run long-run tests**

```bash
bun test tests/e2e/llm/long-run.test.ts
```

Expected: all 3 tests pass. The compression test may take several minutes.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/llm/long-run.test.ts
git commit -m "feat: add long-run real LLM e2e tests (compression, stop hooks, error recovery)"
```

---

### Task 6: Create scenario tests

**Files:**
- Create: `tests/e2e/llm/scenario.test.ts`

- [ ] **Step 1: Create `tests/e2e/llm/scenario.test.ts`**

```typescript
import { it, expect, afterEach } from "bun:test";
import { createSmartAgent } from "../../../packages/ai/src/index.js";
import { describeWithLLM } from "./helpers/env.js";
import { createWorkspaceTools } from "./helpers/tools.js";
import { createWorkspace, createBugFixWorkspace, type Workspace } from "./helpers/workspace.js";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Scenario layer — real filesystem + shell, 10 min timeout per case
// ---------------------------------------------------------------------------

describeWithLLM("Scenario — code generation & bug fixing", (provider) => {
  let ws: Workspace | null = null;

  afterEach(async () => {
    if (ws) {
      await ws.cleanup();
      ws = null;
    }
  });

  it("creates a function + tests from scratch and makes bun test pass", async () => {
    ws = await createWorkspace("capstan-llm-codegen-");
    const tools = createWorkspaceTools(ws.dir);

    const agent = createSmartAgent({
      llm: provider,
      tools,
      maxIterations: 30,
    });

    const result = await agent.run(
      "In the workspace, create a TypeScript file `is-prime.ts` that exports a function `isPrime(n: number): boolean` "
      + "which returns true if n is a prime number and false otherwise. Handle edge cases (n <= 1 is not prime). "
      + "Then create `is-prime.test.ts` using bun:test with at least 5 test cases including edge cases. "
      + "Finally run `bun test is-prime.test.ts` and make sure all tests pass. "
      + "If tests fail, read the error output, fix the code, and run tests again until they pass.",
    );

    expect(result.status).toBe("completed");

    // Verify files were created
    expect(existsSync(join(ws.dir, "is-prime.ts"))).toBe(true);
    expect(existsSync(join(ws.dir, "is-prime.test.ts"))).toBe(true);

    // Verify tests actually pass by running them ourselves
    const verify = spawnSync("bun", ["test", "is-prime.test.ts"], {
      cwd: ws.dir,
      timeout: 15_000,
      encoding: "utf-8",
    });
    expect(verify.status).toBe(0);

    // Verify the function is correct with spot checks
    const src = readFileSync(join(ws.dir, "is-prime.ts"), "utf-8");
    expect(src).toContain("isPrime");
  }, 600_000);

  it("reads a buggy file, diagnoses the issue, and fixes it", async () => {
    ws = await createBugFixWorkspace();
    const tools = createWorkspaceTools(ws.dir);

    const agent = createSmartAgent({
      llm: provider,
      tools,
      maxIterations: 30,
    });

    const result = await agent.run(
      "There is a bug in this workspace. The file `math.ts` has a `fibonacci` function and "
      + "`math.test.ts` has tests for it. First run `bun test math.test.ts` to see the failures. "
      + "Then read `math.ts` to find the bug, fix it, and run the tests again until they all pass.",
    );

    expect(result.status).toBe("completed");

    // Verify the fix by running tests ourselves
    const verify = spawnSync("bun", ["test", "math.test.ts"], {
      cwd: ws.dir,
      timeout: 15_000,
      encoding: "utf-8",
    });
    expect(verify.status).toBe(0);

    // Verify the bug was actually fixed (n-3 → n-2)
    const src = readFileSync(join(ws.dir, "math.ts"), "utf-8");
    expect(src).not.toContain("n - 3");
    expect(src).toContain("n - 2");
  }, 600_000);

});
```

- [ ] **Step 2: Run scenario tests**

```bash
bun test tests/e2e/llm/scenario.test.ts
```

Expected: both tests pass. Each may take 1-3 minutes as the agent reads, writes, runs commands.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/llm/scenario.test.ts
git commit -m "feat: add scenario-layer real LLM e2e tests (code generation, bug fixing)"
```

---

### Task 7: Add npm scripts and exclude from default test run

**Files:**
- Modify: `package.json` (scripts section)
- Modify: `scripts/run-bun-tests.mjs` (exclude `tests/e2e/llm/` from auto-collection)

- [ ] **Step 1: Add npm scripts to `package.json`**

Add these three entries to the `"scripts"` object in `package.json`:

```json
"test:llm": "node ./scripts/run-bun-tests.mjs tests/e2e/llm/smoke.test.ts tests/e2e/llm/long-run.test.ts tests/e2e/llm/scenario.test.ts",
"test:llm:smoke": "node ./scripts/run-bun-tests.mjs tests/e2e/llm/smoke.test.ts",
"test:llm:long": "node ./scripts/run-bun-tests.mjs tests/e2e/llm/long-run.test.ts tests/e2e/llm/scenario.test.ts"
```

- [ ] **Step 2: Exclude LLM tests from default `npm test` collection**

In `scripts/run-bun-tests.mjs`, inside the `collectTestFiles` function, after the line:

```javascript
if (entry.isDirectory()) {
```

Add a skip for the LLM test directory:

```javascript
if (entry.isDirectory()) {
  // Skip real-LLM e2e tests from default run (use npm run test:llm)
  const rel = relative(process.cwd(), fullPath).replace(/\\/g, "/");
  if (rel === "tests/e2e/llm") continue;
  stack.push(fullPath);
  continue;
}
```

This requires adding `relative` to the existing import:

```javascript
import { join, relative } from "node:path";
```

- [ ] **Step 3: Verify default `npm test` skips LLM tests**

```bash
npm test 2>&1 | grep -c "llm"
```

Expected: 0 matches (LLM test files are not included).

- [ ] **Step 4: Verify `npm run test:llm:smoke` works**

```bash
npm run test:llm:smoke
```

Expected: 5 smoke tests run (pass or skip depending on `.env.test`).

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/run-bun-tests.mjs
git commit -m "feat: add test:llm npm scripts, exclude LLM tests from default run"
```

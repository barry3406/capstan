# Getting Started

Capstan is a Bun-native AI agent framework. This guide walks you through building an agent first (the primary use case), then covers full-stack web apps.

## Prerequisites

- **Bun 1.1+** or **Node.js 20+** (ES2022, ESM-only)
- An LLM API key (OpenAI, Anthropic, or any OpenAI-compatible endpoint)

## Installation

```bash
# Bun
bun add @zauso-ai/capstan-ai @zauso-ai/capstan-agent

# npm
npm install @zauso-ai/capstan-ai @zauso-ai/capstan-agent
```

---

## Path 1: Build an AI Agent

### Step 1: Your first agent

```typescript
import { createSmartAgent } from "@zauso-ai/capstan-ai";
import { openaiProvider } from "@zauso-ai/capstan-agent";

const agent = createSmartAgent({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  tools: [],
});

const result = await agent.run("Explain TypeScript in one sentence");
console.log(result.result);
```

With no tools the agent is a simple chat wrapper. `run()` returns an `AgentRunResult` with:

- `result` -- the agent's final output
- `status` -- `"completed"`, `"max_iterations"`, `"approval_required"`, `"paused"`, `"canceled"`, or `"fatal"`
- `iterations` -- number of LLM round-trips
- `toolCalls` -- array of every tool invocation

To use Anthropic instead:

```typescript
import { anthropicProvider } from "@zauso-ai/capstan-agent";

const agent = createSmartAgent({
  llm: anthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  tools: [],
});
```

Both providers accept an optional `model` and `baseUrl` override:

```typescript
openaiProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o",
  baseUrl: "https://api.openai.com/v1",
});

anthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: "claude-sonnet-4-20250514",
});
```

### Step 2: Add tools

Tools are operations with defined inputs and outputs. The agent decides when to call them.

```typescript
import { createSmartAgent } from "@zauso-ai/capstan-ai";
import type { AgentTool } from "@zauso-ai/capstan-ai";
import { openaiProvider } from "@zauso-ai/capstan-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const readFile: AgentTool = {
  name: "read_file",
  description: "Read the contents of a file at the given path",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute file path" },
    },
    required: ["path"],
  },
  async execute(args) {
    return readFileSync(args.path as string, "utf-8");
  },
};

const writeFile: AgentTool = {
  name: "write_file",
  description: "Write content to a file, creating or overwriting it",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute file path" },
      content: { type: "string", description: "File content to write" },
    },
    required: ["path", "content"],
  },
  async execute(args) {
    writeFileSync(args.path as string, args.content as string);
    return "File written successfully";
  },
};

const runCommand: AgentTool = {
  name: "run_command",
  description: "Execute a shell command and return its output",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run" },
    },
    required: ["command"],
  },
  timeout: 30_000,
  async execute(args) {
    return execSync(args.command as string, { encoding: "utf-8" });
  },
};

const agent = createSmartAgent({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  tools: [readFile, writeFile, runCommand],
  maxIterations: 20,
});

const result = await agent.run("Read package.json and list the dependencies");
console.log(result.result);
```

Every tool has:

| Field | Type | Purpose |
|-------|------|---------|
| `name` | `string` | Unique identifier the agent uses to call the tool |
| `description` | `string` | Tells the agent what the tool does |
| `parameters` | JSON Schema object | Defines the input shape; the agent generates arguments matching this schema |
| `execute` | `(args) => Promise<unknown>` | The function that runs when the agent calls the tool |
| `validate` | `(args) => { valid, error? }` | Optional argument validator, runs before `execute` |
| `timeout` | `number` | Optional max execution time in milliseconds |
| `failureMode` | `"soft" \| "hard"` | `"soft"` returns the error to the agent; `"hard"` (default) aborts the run |
| `isConcurrencySafe` | `boolean` | Whether the tool can run concurrently with other tools |

When `validate` is defined, the agent's arguments are checked before `execute` runs. Invalid arguments produce an error message that the agent sees and can self-correct.

### Step 3: Add skills

Skills are strategies -- high-level guidance for how to approach a class of problems. They differ from tools: tools are operations (read a file, run a test), while skills are playbooks (how to debug a failing test).

```typescript
import { createSmartAgent, defineSkill } from "@zauso-ai/capstan-ai";
import { openaiProvider } from "@zauso-ai/capstan-agent";

const tddDebug = defineSkill({
  name: "tdd-debug",
  description: "Test-driven debugging workflow",
  trigger: "when tests fail or a bug needs fixing",
  prompt: [
    "1. Read the failing test to understand the expected behavior",
    "2. Read the source code under test",
    "3. Identify the root cause",
    "4. Write the fix",
    "5. Re-run tests to confirm the fix",
    "6. If tests still fail, repeat from step 1",
  ].join("\n"),
  tools: ["read_file", "write_file", "run_command"],
});

const codeReview = defineSkill({
  name: "code-review",
  description: "Structured code review process",
  trigger: "when asked to review code or a pull request",
  prompt: [
    "1. Read the diff or changed files",
    "2. Check for correctness, edge cases, and error handling",
    "3. Check for style consistency",
    "4. Summarize findings with file:line references",
  ].join("\n"),
  tools: ["read_file", "run_command"],
});

const agent = createSmartAgent({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  tools: [readFile, writeFile, runCommand],
  skills: [tddDebug, codeReview],
});
```

When skills are configured, the agent automatically gets an `activate_skill` meta-tool. During a run, the agent can call `activate_skill({ skill_name: "tdd-debug" })` to receive the skill's guidance prompt injected into the conversation.

The `trigger` field tells the agent when a skill is relevant. The `tools` field (optional) lists which tools the skill recommends using.

### Step 4: Add self-evolution

Evolution makes the agent learn from experience. After each run, the agent's trajectory is captured, distilled into strategies, and applied to future runs.

```typescript
import { createSmartAgent, defineSkill } from "@zauso-ai/capstan-ai";
import { SqliteEvolutionStore } from "@zauso-ai/capstan-ai/evolution";
import { SqliteMemoryBackend } from "@zauso-ai/capstan-ai";
import { openaiProvider } from "@zauso-ai/capstan-agent";

const agent = createSmartAgent({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  tools: [readFile, writeFile, runCommand],
  skills: [tddDebug],
  evolution: {
    store: new SqliteEvolutionStore("./agent-evolution.db"),
    capture: "every-run",
    distillation: "post-run",
    pruning: {
      maxStrategies: 50,
      minUtility: 0.2,
    },
    skillPromotion: {
      minUtility: 0.7,
      minApplications: 5,
    },
  },

  // Scoped memory with LLM-driven reconciliation
  memory: {
    store: new SqliteMemoryBackend("./agent-memory.db"),
    scope: { type: "project", id: "my-project" },
    reconciler: "llm",  // new facts automatically reconcile with existing memories
  },
});
```

What each option does:

| Option | Values | Effect |
|--------|--------|--------|
| `store` | `EvolutionStore` | Where experiences, strategies, and evolved skills are persisted |
| `capture` | `"every-run"`, `"on-failure"`, `"on-success"`, or `(result) => boolean` | When to record the run's trajectory as an experience |
| `distillation` | `"post-run"` or `"manual"` | When to extract strategies from accumulated experiences |
| `pruning.maxStrategies` | `number` | Cap on total stored strategies; lowest-utility are dropped |
| `pruning.minUtility` | `number` | Strategies below this utility score are pruned |
| `skillPromotion.minUtility` | `number` | Minimum utility score for a strategy to be promoted to a skill |
| `skillPromotion.minApplications` | `number` | Minimum times a strategy must be applied before promotion |

What happens across multiple runs:

1. **Run 1-5**: The agent solves tasks. Each run's trajectory (tool calls, outcomes) is captured as an experience.
2. **Run 5-20**: Post-run distillation extracts strategies from experiences. The agent queries relevant strategies before starting new tasks.
3. **Run 20+**: High-performing strategies that exceed the utility and application thresholds are promoted to reusable skills automatically.

The `memory` block adds scoped, persistent memory. When `reconciler: "llm"` is set, storing a new fact triggers an LLM pass over all active memories -- the model decides which existing facts to keep, supersede, revise, or remove. This keeps the memory store consistent without manual cleanup. See [Core Concepts -- Memory Reconciler](./core-concepts.md#memory-reconciler) for details.

### Step 5: Production hardening

Add resilience, cost controls, and timeout protection for production deployments.

```typescript
const agent = createSmartAgent({
  // Primary LLM
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY!, model: "gpt-4o" }),

  // Fallback LLM -- used automatically when the primary fails
  fallbackLlm: anthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),

  tools: [readFile, writeFile, runCommand],

  // Max LLM round-trips before stopping
  maxIterations: 30,

  // Token budget -- caps output tokens per turn and nudges the agent to wrap up
  tokenBudget: {
    maxOutputTokensPerTurn: 16_000,
    nudgeAtPercent: 80,
  },

  // Tool result budget -- truncates large tool outputs to control context size
  toolResultBudget: {
    maxChars: 50_000,
    preserveStructure: true,
    persistDir: "./tool-results",
    maxAggregateCharsPerIteration: 200_000,
  },

  // LLM timeout -- protects against stalled API calls
  llmTimeout: {
    chatTimeoutMs: 120_000,
    streamIdleTimeoutMs: 90_000,
    stallWarningMs: 30_000,
  },

  // Lifecycle hooks -- monitor, gate, or log tool calls
  hooks: {
    beforeToolCall: async (tool, args) => {
      console.log(`Calling ${tool}`, args);
      return { allowed: true };
    },
    afterToolCall: async (tool, args, result, status) => {
      console.log(`${tool} ${status}`);
    },
    onRunComplete: async (result) => {
      console.log(`Run finished: ${result.status}, ${result.iterations} iterations`);
    },
  },
});
```

| Option | Purpose |
|--------|---------|
| `fallbackLlm` | Automatic failover when the primary LLM returns errors |
| `maxIterations` | Hard cap on LLM round-trips to prevent runaway loops |
| `tokenBudget` | Controls output token spend per turn; `nudgeAtPercent` tells the agent to finish up |
| `toolResultBudget` | Truncates oversized tool results; `persistDir` writes full results to disk for debugging |
| `llmTimeout` | Timeouts for chat calls, stream idle gaps, and stall warnings |
| `hooks` | Lifecycle callbacks for logging, gating, and monitoring |

### Step 6: Testing your agent

#### Configure LLM providers for tests

Create a `.env.test` file in your project root:

```bash
# .env.test
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o

# Optional secondary provider (tests run once per provider)
LLM_SECONDARY_PROVIDER=anthropic
LLM_SECONDARY_API_KEY=sk-ant-...
LLM_SECONDARY_MODEL=claude-sonnet-4-20250514
```

#### Write tests with describeWithLLM

The `describeWithLLM` helper runs your test suite once per configured provider and auto-skips when no `.env.test` is present.

```typescript
import { it, expect } from "bun:test";
import { createSmartAgent } from "@zauso-ai/capstan-ai";
import { describeWithLLM } from "./helpers/env.js";

describeWithLLM("My agent", (provider) => {
  it("can read a file", async () => {
    const agent = createSmartAgent({
      llm: provider,
      tools: [readFile],
      maxIterations: 10,
    });

    const result = await agent.run("Read package.json and tell me the project name");

    expect(result.status).toBe("completed");
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.toolCalls[0].tool).toBe("read_file");
  }, 120_000); // LLM tests need generous timeouts

  it("handles missing files gracefully", async () => {
    const agent = createSmartAgent({
      llm: provider,
      tools: [readFile],
      maxIterations: 5,
    });

    const result = await agent.run("Read /nonexistent/file.txt");

    // Agent should complete (soft failure) and report the error
    expect(result.status).toBe("completed");
  }, 60_000);
});
```

#### Run the tests

```bash
# Run all LLM tests
bun test tests/e2e/llm/

# Run a specific test file
bun test tests/e2e/llm/smoke.test.ts
```

Tests using `describeWithLLM` are automatically skipped in CI when `LLM_API_KEY` is not set, so they never break your pipeline.

---

## Path 2: Build a Full-Stack Web App

Capstan also drives HTTP APIs, server-rendered React pages, database models, and multi-protocol agent endpoints from a single codebase.

### Create a project

```bash
# Bun
bunx create-capstan-app my-app

# Or with npm
npx create-capstan-app my-app --template blank

cd my-app
bun install  # or npm install
bunx capstan dev
```

The scaffolder supports two templates:

| Template | Description |
|----------|-------------|
| `blank` | Minimal project with a health check API and home page |
| `tickets` | Full example with a Ticket model, CRUD API routes, and auth policy |

### Project structure

```
my-app/
  app/
    routes/
      _layout.tsx          # Root layout (wraps all pages)
      index.page.tsx       # Home page
      api/
        health.api.ts      # Health check endpoint
    models/                # Data model definitions
    styles/
      main.css             # CSS entry point
    migrations/            # Database migration files
    policies/
      index.ts             # Permission policies
  capstan.config.ts        # Framework configuration
  package.json
  tsconfig.json
  AGENTS.md                # AI coding agent guide
```

### Add an API

Create `app/routes/api/greet.api.ts`:

```typescript
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  input: z.object({
    name: z.string().optional(),
  }),
  output: z.object({
    message: z.string(),
  }),
  description: "Greet a user by name",
  capability: "read",
  async handler({ input }) {
    return { message: `Hello, ${input.name ?? "world"}!` };
  },
});

export const POST = defineAPI({
  input: z.object({
    name: z.string().min(1),
  }),
  output: z.object({
    message: z.string(),
    timestamp: z.string(),
  }),
  description: "Create a personalized greeting",
  capability: "write",
  policy: "requireAuth",
  async handler({ input }) {
    return {
      message: `Hello, ${input.name}!`,
      timestamp: new Date().toISOString(),
    };
  },
});
```

Each exported constant (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`) maps to the corresponding HTTP method. `defineAPI()` provides:

- **Input/output validation** via Zod schemas (automatic 400 on invalid input)
- **Multi-protocol projection** -- the same definition drives MCP tools, A2A skills, and OpenAPI specs

Test it:

```bash
curl http://localhost:3000/api/greet?name=Alice
curl -X POST http://localhost:3000/api/greet \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice"}'
```

### Add a model

Create `app/models/ticket.model.ts`:

```typescript
import { defineModel } from "@zauso-ai/capstan-db";
import { text, integer } from "drizzle-orm/sqlite-core";

export const Ticket = defineModel("tickets", {
  title: text("title").notNull(),
  description: text("description"),
  priority: integer("priority").default(0),
  status: text("status").default("open"),
});
```

Run migrations:

```bash
bunx capstan db migrate
```

`defineModel` generates type-safe CRUD route helpers automatically.

### Add a page

Create `app/routes/index.page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main>
      <h1>Welcome to Capstan</h1>
      <p>Your AI-powered application is running.</p>
    </main>
  );
}
```

Pages use React SSR with selective hydration. Use `<Link>` from `@zauso-ai/capstan-react/client` for client-side navigation:

```tsx
import { Link } from "@zauso-ai/capstan-react/client";

<Link href="/dashboard" prefetch="viewport">Dashboard</Link>
```

### Auto-generated agent endpoints

Once the dev server is running, these endpoints are available automatically:

| Endpoint | Purpose |
|----------|---------|
| `GET /.well-known/capstan.json` | Capstan agent manifest |
| `GET /.well-known/agent.json` | A2A agent card |
| `POST /.well-known/a2a` | A2A JSON-RPC handler |
| `GET /openapi.json` | OpenAPI 3.1.0 spec |
| `bunx capstan mcp` | MCP server over stdio (for Claude Desktop, Cursor) |
| `GET /capstan/approvals` | Approval workflow management |

### Run

```bash
# Development
bunx capstan dev

# Production build
bunx capstan build

# Start production server
bunx capstan start
```

---

## Next Steps

- [Core Concepts](./core-concepts.md) -- defineAPI, multi-protocol architecture, smart agent runtime
- [API Reference](./api-reference.md) -- full API surfaces across all Capstan packages
- [Database](./database.md) -- defineModel, CRUD helpers, migrations, vector search
- [Authentication](./authentication.md) -- JWT sessions, API keys, OAuth
- [Deployment](./deployment.md) -- production build and deployment

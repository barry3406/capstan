import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function GettingStarted() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "Getting Started"),

    createElement("p", null,
      "Capstan is a Bun-native AI agent framework. This guide walks you through building an agent first (the primary use case), then covers full-stack web apps."
    ),

    // Prerequisites
    createElement("h2", null, "Prerequisites"),
    createElement("ul", null,
      createElement("li", null,
        createElement("strong", null, "Bun 1.1+"),
        " or ",
        createElement("strong", null, "Node.js 20+"),
        " (ES2022, ESM-only)"
      ),
      createElement("li", null,
        "An LLM API key (OpenAI, Anthropic, or any OpenAI-compatible endpoint)"
      )
    ),

    // Installation
    createElement("h2", null, "Installation"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`# Bun
bun add @zauso-ai/capstan-ai @zauso-ai/capstan-agent

# npm
npm install @zauso-ai/capstan-ai @zauso-ai/capstan-agent`
      )
    ),

    // ── Path 1: Build an AI Agent ──────────────────────────────────
    createElement("h2", null, "Path 1: Build an AI Agent"),

    // Step 1
    createElement("h3", null, "Step 1: Your first agent"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { createSmartAgent } from "@zauso-ai/capstan-ai";
import { openaiProvider } from "@zauso-ai/capstan-agent";

const agent = createSmartAgent({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  tools: [],
});

const result = await agent.run("Explain TypeScript in one sentence");
console.log(result.result);`
      )
    ),
    createElement("p", null,
      "With no tools the agent is a simple chat wrapper. ",
      createElement("code", null, "run()"),
      " returns an ",
      createElement("code", null, "AgentRunResult"),
      " with:"
    ),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "result"), " -- the agent's final output"),
      createElement("li", null, createElement("code", null, "status"), " -- ", createElement("code", null, '"completed"'), ", ", createElement("code", null, '"max_iterations"'), ", ", createElement("code", null, '"approval_required"'), ", ", createElement("code", null, '"paused"'), ", ", createElement("code", null, '"canceled"'), ", or ", createElement("code", null, '"fatal"')),
      createElement("li", null, createElement("code", null, "iterations"), " -- number of LLM round-trips"),
      createElement("li", null, createElement("code", null, "toolCalls"), " -- array of every tool invocation")
    ),
    createElement("p", null, "To use Anthropic instead:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { anthropicProvider } from "@zauso-ai/capstan-agent";

const agent = createSmartAgent({
  llm: anthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  tools: [],
});`
      )
    ),
    createElement("p", null, "Both providers accept an optional ", createElement("code", null, "model"), " and ", createElement("code", null, "baseUrl"), " override:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`openaiProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o",
  baseUrl: "https://api.openai.com/v1",
});

anthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: "claude-sonnet-4-20250514",
});`
      )
    ),

    // Step 2: Add tools
    createElement("h3", null, "Step 2: Add tools"),
    createElement("p", null, "Tools are operations with defined inputs and outputs. The agent decides when to call them."),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { createSmartAgent } from "@zauso-ai/capstan-ai";
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
console.log(result.result);`
      )
    ),
    createElement("p", null, "Every tool has:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Field"),
          createElement("th", null, "Type"),
          createElement("th", null, "Purpose")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "name")),
          createElement("td", null, createElement("code", null, "string")),
          createElement("td", null, "Unique identifier the agent uses to call the tool")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "description")),
          createElement("td", null, createElement("code", null, "string")),
          createElement("td", null, "Tells the agent what the tool does")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "parameters")),
          createElement("td", null, "JSON Schema"),
          createElement("td", null, "Defines the input shape; auto-validated before execute")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "execute")),
          createElement("td", null, createElement("code", null, "(args) => Promise<unknown>")),
          createElement("td", null, "The function that runs when the agent calls the tool")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "validate")),
          createElement("td", null, createElement("code", null, "(args) => { valid, error? }")),
          createElement("td", null, "Optional argument validator, runs before execute")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "timeout")),
          createElement("td", null, createElement("code", null, "number")),
          createElement("td", null, "Optional max execution time in milliseconds")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "failureMode")),
          createElement("td", null, createElement("code", null, '"soft" | "hard"')),
          createElement("td", null, '"soft" returns error to agent; "hard" (default) aborts')
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "isConcurrencySafe")),
          createElement("td", null, createElement("code", null, "boolean")),
          createElement("td", null, "Whether the tool can run concurrently with others")
        )
      )
    ),

    // Step 3: Add skills
    createElement("h3", null, "Step 3: Add skills"),
    createElement("p", null,
      "Skills are strategies -- high-level guidance for how to approach a class of problems. They differ from tools: tools are operations (read a file, run a test), while skills are playbooks (how to debug a failing test)."
    ),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { createSmartAgent, defineSkill } from "@zauso-ai/capstan-ai";
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
  ].join("\\n"),
  tools: ["read_file", "write_file", "run_command"],
});

const agent = createSmartAgent({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  tools: [readFile, writeFile, runCommand],
  skills: [tddDebug],
});`
      )
    ),
    createElement("p", null,
      "When skills are configured, the agent automatically gets an ",
      createElement("code", null, "activate_skill"),
      " meta-tool. During a run, the agent can call ",
      createElement("code", null, 'activate_skill({ skill_name: "tdd-debug" })'),
      " to receive the skill's guidance prompt injected into the conversation."
    ),

    // Step 4: Add self-evolution
    createElement("h3", null, "Step 4: Add self-evolution"),
    createElement("p", null,
      "Evolution makes the agent learn from experience. After each run, the agent's trajectory is captured, distilled into strategies, and applied to future runs."
    ),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { createSmartAgent } from "@zauso-ai/capstan-ai";
import { SqliteEvolutionStore } from "@zauso-ai/capstan-ai/evolution";
import { openaiProvider } from "@zauso-ai/capstan-agent";

const agent = createSmartAgent({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  tools: [readFile, writeFile, runCommand],
  skills: [tddDebug],
  evolution: {
    store: new SqliteEvolutionStore("./agent-evolution.db"),
    capture: "every-run",
    distillation: "post-run",
    pruning: { maxStrategies: 50, minUtility: 0.2 },
    skillPromotion: { minUtility: 0.7, minApplications: 5 },
  },
});`
      )
    ),
    createElement("p", null, "What happens across multiple runs:"),
    createElement("ol", null,
      createElement("li", null,
        createElement("strong", null, "Run 1-5: "),
        "The agent solves tasks. Each run's trajectory (tool calls, outcomes) is captured as an experience."
      ),
      createElement("li", null,
        createElement("strong", null, "Run 5-20: "),
        "Post-run distillation extracts strategies from experiences. The agent queries relevant strategies before starting new tasks."
      ),
      createElement("li", null,
        createElement("strong", null, "Run 20+: "),
        "High-performing strategies that exceed the utility and application thresholds are promoted to reusable skills automatically."
      )
    ),

    // Step 5: Production hardening
    createElement("h3", null, "Step 5: Production hardening"),
    createElement("p", null, "Add resilience, cost controls, and timeout protection for production deployments."),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`const agent = createSmartAgent({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY!, model: "gpt-4o" }),
  fallbackLlm: anthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  tools: [readFile, writeFile, runCommand],
  maxIterations: 30,
  tokenBudget: { maxOutputTokensPerTurn: 16_000, nudgeAtPercent: 80 },
  toolResultBudget: {
    maxChars: 50_000,
    persistDir: "./tool-results",
    maxAggregateCharsPerIteration: 200_000,
  },
  llmTimeout: {
    chatTimeoutMs: 120_000,
    streamIdleTimeoutMs: 90_000,
    stallWarningMs: 30_000,
  },
  hooks: {
    beforeToolCall: async (tool, args) => {
      console.log(\`Calling \${tool}\`, args);
      return { allowed: true };
    },
    afterToolCall: async (tool, args, result, status) => {
      console.log(\`\${tool} \${status}\`);
    },
    onRunComplete: async (result) => {
      console.log(\`Run finished: \${result.status}, \${result.iterations} iterations\`);
    },
  },
});`
      )
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Option"),
          createElement("th", null, "Purpose")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "fallbackLlm")),
          createElement("td", null, "Automatic failover when the primary LLM returns errors")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "maxIterations")),
          createElement("td", null, "Hard cap on LLM round-trips to prevent runaway loops")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "tokenBudget")),
          createElement("td", null, "Controls output token spend per turn; nudgeAtPercent tells the agent to finish up")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "toolResultBudget")),
          createElement("td", null, "Truncates oversized tool results; persistDir writes full results to disk for debugging")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "llmTimeout")),
          createElement("td", null, "Timeouts for chat calls, stream idle gaps, and stall warnings")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "hooks")),
          createElement("td", null, "Lifecycle callbacks for logging, gating, and monitoring")
        )
      )
    ),

    // Step 6: Testing
    createElement("h3", null, "Step 6: Testing your agent"),
    createElement("p", null,
      "Create a ",
      createElement("code", null, ".env.test"),
      " file with LLM credentials, then use ",
      createElement("code", null, "describeWithLLM"),
      " to run tests once per configured provider:"
    ),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { it, expect } from "bun:test";
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
  }, 120_000);
});`
      )
    ),
    createElement("p", null,
      "Tests using ",
      createElement("code", null, "describeWithLLM"),
      " are automatically skipped in CI when ",
      createElement("code", null, "LLM_API_KEY"),
      " is not set, so they never break your pipeline."
    ),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`# Run all LLM tests
bun test tests/e2e/llm/

# Run a specific test file
bun test tests/e2e/llm/smoke.test.ts`
      )
    ),

    // ── Path 2: Build a Full-Stack Web App ─────────────────────────
    createElement("h2", null, "Path 2: Build a Full-Stack Web App"),

    createElement("p", null,
      "Capstan also drives HTTP APIs, server-rendered React pages, database models, and multi-protocol agent endpoints from a single codebase."
    ),

    createElement("h3", null, "Create a project"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`bunx create-capstan-app@beta my-app
cd my-app
bun install
bunx capstan dev`
      )
    ),
    createElement("p", null, "The scaffolder supports two templates:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Template"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "blank")),
          createElement("td", null, "Minimal project with a health check API and home page")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "tickets")),
          createElement("td", null, "Full example with a Ticket model, CRUD API routes, and auth policy")
        )
      )
    ),

    createElement("h3", null, "Project structure"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`my-app/
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
  AGENTS.md                # AI coding agent guide`
      )
    ),

    createElement("h3", null, "Add an API"),
    createElement("p", null, "Create ", createElement("code", null, "app/routes/api/greet.api.ts"), ":"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  input: z.object({ name: z.string().optional() }),
  output: z.object({ message: z.string() }),
  description: "Greet a user by name",
  capability: "read",
  async handler({ input }) {
    return { message: \`Hello, \${input.name ?? "world"}!\` };
  },
});`
      )
    ),
    createElement("p", null,
      createElement("code", null, "defineAPI()"),
      " provides input/output validation via Zod schemas and multi-protocol projection -- the same definition drives MCP tools, A2A skills, and OpenAPI specs."
    ),

    createElement("h3", null, "Auto-generated agent endpoints"),
    createElement("p", null, "Once the dev server is running, these endpoints are available automatically:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Endpoint"),
          createElement("th", null, "Purpose")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "GET /.well-known/capstan.json")),
          createElement("td", null, "Capstan agent manifest")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "GET /.well-known/agent.json")),
          createElement("td", null, "A2A agent card")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "POST /.well-known/a2a")),
          createElement("td", null, "A2A JSON-RPC handler")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "GET /openapi.json")),
          createElement("td", null, "OpenAPI 3.1.0 spec")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "bunx capstan mcp")),
          createElement("td", null, "MCP server over stdio")
        )
      )
    ),

    createElement("h3", null, "Run"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`# Development
bunx capstan dev

# Production build
bunx capstan build

# Start production server
bunx capstan start`
      )
    ),

    // Next Steps
    createElement("h2", null, "Next Steps"),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, "Core Concepts"), " -- createSmartAgent, agent loop, defineAPI, multi-protocol"),
      createElement("li", null, createElement("strong", null, "API Reference"), " -- full API surfaces across all Capstan packages"),
      createElement("li", null, createElement("strong", null, "Database"), " -- defineModel, CRUD helpers, migrations, vector search"),
      createElement("li", null, createElement("strong", null, "Authentication"), " -- JWT sessions, API keys, OAuth"),
      createElement("li", null, createElement("strong", null, "Deployment"), " -- production build and deployment")
    ),

    createElement("div", { className: "callout callout-tip" },
      createElement("strong", null, "Tip: "),
      "Use ", createElement("code", null, "<Link>"), " from ",
      createElement("code", null, "@zauso-ai/capstan-react/client"),
      " instead of plain ", createElement("code", null, "<a>"),
      " tags for client-side navigation with automatic prefetching and SPA transitions."
    )
  );
}

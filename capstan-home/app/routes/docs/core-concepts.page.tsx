import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function CoreConcepts() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "Core Concepts"),

    createElement("p", null,
      "Capstan serves two roles: (1) an AI agent framework for building intelligent agents with durable execution, self-evolution, and production robustness, and (2) a full-stack web framework for building typed HTTP/MCP/A2A/OpenAPI applications. ",
      "Both share the same Bun-native runtime. This document covers the agent framework first (Part 1) because it is the primary use case, then the web framework (Part 2)."
    ),

    // ══════════════════════════════════════════════════════════════
    // Part 1: Smart Agent
    // ══════════════════════════════════════════════════════════════

    createElement("h2", null, "Part 1: Smart Agent"),

    // ── createSmartAgent ─────────────────────────────────────────
    createElement("h3", null, "createSmartAgent"),
    createElement("p", null,
      createElement("code", null, "createSmartAgent"),
      " is the central API. It takes a configuration object and returns a ",
      createElement("code", null, "SmartAgent"),
      " with two methods: ",
      createElement("code", null, "run(goal)"),
      " and ",
      createElement("code", null, "resume(checkpoint, message)"),
      "."
    ),
    createElement("p", null, "Here is a production agent in 30 lines:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { createSmartAgent } from "@zauso-ai/capstan-ai";
import { anthropicProvider } from "@zauso-ai/capstan-agent";

const agent = createSmartAgent({
  llm: anthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: "claude-sonnet-4-20250514",
  }),
  tools: [readFile, writeFile, runCommand, searchCode],
  skills: [debuggingSkill, refactoringSkill],
  evolution: {
    store: myEvolutionStore,
    capture: "every-run",
    distillation: "post-run",
  },
  maxIterations: 200,
  contextWindowSize: 200_000,
  fallbackLlm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY!, model: "gpt-4o" }),
  llmTimeout: { chatTimeoutMs: 120_000, streamIdleTimeoutMs: 90_000 },
});

const result = await agent.run("Fix the failing test in src/parser.test.ts");

console.log(result.status);      // "completed" | "max_iterations" | "fatal" | ...
console.log(result.iterations);  // how many loop iterations it took
console.log(result.toolCalls);   // full tool call trace`
      )
    ),

    createElement("h4", null, "SmartAgentConfig Reference"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Property"),
          createElement("th", null, "Type"),
          createElement("th", null, "Required"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "llm")),
          createElement("td", null, createElement("code", null, "LLMProvider")),
          createElement("td", null, "Yes"),
          createElement("td", null, "Primary language model")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "tools")),
          createElement("td", null, createElement("code", null, "AgentTool[]")),
          createElement("td", null, "Yes"),
          createElement("td", null, "Operations the agent can invoke")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "skills")),
          createElement("td", null, createElement("code", null, "AgentSkill[]")),
          createElement("td", null, "No"),
          createElement("td", null, "Strategic guidance the agent can activate")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "evolution")),
          createElement("td", null, createElement("code", null, "EvolutionConfig")),
          createElement("td", null, "No"),
          createElement("td", null, "Self-evolution: experience capture, distillation")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "memory")),
          createElement("td", null, createElement("code", null, "SmartAgentMemoryConfig")),
          createElement("td", null, "No"),
          createElement("td", null, "Scoped memory with pluggable backend")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "maxIterations")),
          createElement("td", null, createElement("code", null, "number")),
          createElement("td", null, "No"),
          createElement("td", null, "Max loop iterations (default: 10)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "contextWindowSize")),
          createElement("td", null, createElement("code", null, "number")),
          createElement("td", null, "No"),
          createElement("td", null, "Context window size for compression decisions")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "fallbackLlm")),
          createElement("td", null, createElement("code", null, "LLMProvider")),
          createElement("td", null, "No"),
          createElement("td", null, "Backup model when primary fails")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "tokenBudget")),
          createElement("td", null, createElement("code", null, "number | TokenBudgetConfig")),
          createElement("td", null, "No"),
          createElement("td", null, "Output token budget with nudge + force-complete")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "toolResultBudget")),
          createElement("td", null, createElement("code", null, "ToolResultBudgetConfig")),
          createElement("td", null, "No"),
          createElement("td", null, "Per-result and aggregate truncation limits")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "llmTimeout")),
          createElement("td", null, createElement("code", null, "LLMTimeoutConfig")),
          createElement("td", null, "No"),
          createElement("td", null, "Watchdog timeouts for chat and streaming")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "hooks")),
          createElement("td", null, createElement("code", null, "SmartAgentHooks")),
          createElement("td", null, "No"),
          createElement("td", null, "Lifecycle hooks (before/after tool calls, etc.)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "compaction")),
          createElement("td", null, createElement("code", null, "Partial<CompactionConfig>")),
          createElement("td", null, "No"),
          createElement("td", null, "Compression tuning (snip, microcompact, autocompact)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "stopHooks")),
          createElement("td", null, createElement("code", null, "StopHook[]")),
          createElement("td", null, "No"),
          createElement("td", null, "Quality gates on final responses")
        )
      )
    ),

    // ── The Agent Loop ───────────────────────────────────────────
    createElement("h3", null, "The Agent Loop"),
    createElement("p", null,
      createElement("code", null, "runSmartLoop"),
      " is the engine inside ",
      createElement("code", null, "createSmartAgent"),
      ". It implements an 8-phase iteration cycle."
    ),

    createElement("h4", null, "Phase 1: Initialization"),
    createElement("p", null, "Before the first iteration:"),
    createElement("ol", null,
      createElement("li", null, "Create engine state from config (tools, messages, counters)"),
      createElement("li", null, "Build tool catalog (inline all tools, or defer large sets behind a ", createElement("code", null, "discover_tool"), " meta-tool)"),
      createElement("li", null, "Inject ", createElement("code", null, "activate_skill"), " synthetic tool if skills are configured"),
      createElement("li", null, "Retrieve relevant memories from memory store"),
      createElement("li", null, "Compose system prompt (base prompt + tool descriptions + skill catalog + memories + strategies)"),
      createElement("li", null, "Set initial messages: [system prompt, user goal]")
    ),

    createElement("h4", null, "Phase 2: Main Loop"),
    createElement("p", null, "Each iteration runs these steps:"),
    createElement("ol", null,
      createElement("li", null,
        createElement("strong", null, "Compression Check"),
        " -- if tokens exceed 60%, run snip + microcompact; if 85%, run autocompact (LLM-driven summarization)"
      ),
      createElement("li", null,
        createElement("strong", null, "Control Check"),
        " -- operator can return ", createElement("code", null, '"pause"'), " or ", createElement("code", null, '"cancel"'), " via ", createElement("code", null, "getControlState"), " hook"
      ),
      createElement("li", null,
        createElement("strong", null, "Model + Tool Execution"),
        " -- call LLM, parse tool calls, validate arguments (JSON Schema + custom validate), execute tools with timeout and concurrency"
      ),
      createElement("li", null,
        createElement("strong", null, "Error Handling"),
        " -- on context limit error: autocompact recovery then reactive compact then fatal; on other error: try fallbackLlm"
      ),
      createElement("li", null,
        createElement("strong", null, "Token Budget"),
        " -- at nudge threshold inject wrap-up message; at 100% force-complete"
      ),
      createElement("li", null,
        createElement("strong", null, "Result Processing"),
        " -- error withholding (retry once), tool result budgeting, memory event hook"
      ),
      createElement("li", null,
        createElement("strong", null, "Dynamic Context Enrichment"),
        " -- every 5 iterations, query memory for fresh relevant context"
      ),
      createElement("li", null,
        createElement("strong", null, "Continuation Decision"),
        " -- run stop hooks; if rejected, inject feedback and continue (max 3 rejections); otherwise complete"
      )
    ),

    createElement("h4", null, "Phase 3: Post-Loop"),
    createElement("p", null,
      "If the loop exits due to ",
      createElement("code", null, "maxIterations"),
      ", the last assistant message becomes the result with status ",
      createElement("code", null, '"max_iterations"'),
      "."
    ),

    // ── Tools ────────────────────────────────────────────────────
    createElement("h3", null, "Tools"),
    createElement("p", null,
      "Tools are operations with defined inputs and outputs -- reading files, running commands, calling APIs. They are validated in two phases before execution: JSON Schema validation (", createElement("code", null, "parameters"), ") and custom validation (", createElement("code", null, "validate"), ")."
    ),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import type { AgentTool } from "@zauso-ai/capstan-ai";

const readFile: AgentTool = {
  name: "read_file",
  description: "Read the contents of a file at the given path",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute file path" },
      offset: { type: "integer", description: "Line to start reading from" },
      limit: { type: "integer", description: "Max lines to read" },
    },
    required: ["path"],
  },
  validate(args) {
    if ((args.path as string).includes(".."))
      return { valid: false, error: "Path traversal not allowed" };
    return { valid: true };
  },
  timeout: 10_000,
  isConcurrencySafe: true,
  failureMode: "soft",
  async execute(args) {
    const content = await Bun.file(args.path as string).text();
    return { content, lines: content.split("\\n").length };
  },
};`
      )
    ),
    createElement("p", null, "Tool result budgeting: large results are truncated and optionally persisted to disk. The agent gets a ", createElement("code", null, "read_persisted_result"), " tool automatically to retrieve the full data."),
    createElement("p", null, "Concurrent execution: tools marked ", createElement("code", null, "isConcurrencySafe: true"), " can execute in parallel. Configure max parallelism with ", createElement("code", null, "streaming: { maxConcurrency: 4 }"), "."),

    // ── Skills ───────────────────────────────────────────────────
    createElement("h3", null, "Skills"),
    createElement("p", null, "Skills are strategies, not operations. They provide high-level guidance for how to approach a class of problems. When activated, a skill's prompt is injected into the conversation."),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Aspect"),
          createElement("th", null, "Tool"),
          createElement("th", null, "Skill")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, "What it is"),
          createElement("td", null, "An operation with I/O"),
          createElement("td", null, "A strategy with guidance text")
        ),
        createElement("tr", null,
          createElement("td", null, "Invocation"),
          createElement("td", null, "Model calls it with arguments"),
          createElement("td", null, "Model activates it by name")
        ),
        createElement("tr", null,
          createElement("td", null, "Result"),
          createElement("td", null, "Concrete data (file contents, etc.)"),
          createElement("td", null, "Injected guidance prompt")
        ),
        createElement("tr", null,
          createElement("td", null, "Side effects"),
          createElement("td", null, "Yes (reads/writes/network)"),
          createElement("td", null, "No (read-only prompt injection)")
        ),
        createElement("tr", null,
          createElement("td", null, "Source"),
          createElement("td", null, "Developer-defined"),
          createElement("td", null, "Developer-defined or auto-evolved")
        )
      )
    ),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { defineSkill } from "@zauso-ai/capstan-ai";

const debuggingSkill = defineSkill({
  name: "debugging",
  description: "Systematic debugging methodology",
  trigger: "When encountering bugs, test failures, or unexpected behavior",
  prompt: \`## Debugging Strategy
1. REPRODUCE: Confirm the failure by running the exact failing test.
2. ISOLATE: Narrow down to the smallest reproducing case.
3. HYPOTHESIZE: Form a specific hypothesis about the root cause.
4. VERIFY: Test the hypothesis with targeted reads/searches.
5. FIX: Apply the minimal fix that addresses the root cause.
6. CONFIRM: Re-run the original failing test to verify.\`,
  tools: ["read_file", "run_command", "search_code"],
});`
      )
    ),
    createElement("p", null, "At runtime: skills are listed in the system prompt, the runtime injects a synthetic ", createElement("code", null, "activate_skill"), " tool, and the agent calls it when needed."),

    // ── Memory ───────────────────────────────────────────────────
    createElement("h3", null, "Memory"),
    createElement("p", null, "The memory system provides scoped, searchable memory that persists across agent runs."),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`const agent = createSmartAgent({
  // ...
  memory: {
    store: new BuiltinMemoryBackend(),
    scope: { type: "project", id: "my-app" },
    readScopes: [{ type: "global", id: "shared" }],
    maxMemoryTokens: 4000,
    saveSessionSummary: true,
  },
});`
      )
    ),
    createElement("p", null, "Features: initial retrieval before the first iteration, staleness annotations (age-based freshness notes), dynamic enrichment every 5 iterations, session summary auto-save. Backends: ", createElement("code", null, "BuiltinMemoryBackend"), " (in-memory), ", createElement("code", null, "SqliteMemoryBackend"), " (persistent), or custom."),

    // ── Self-Evolution ───────────────────────────────────────────
    createElement("h3", null, "Self-Evolution"),
    createElement("p", null, "Self-evolution enables agents to learn from their runs and improve over time:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null, "Experience (run trajectory) --> Strategy (distilled pattern) --> Skill (promoted guidance)")
    ),
    createElement("ol", null,
      createElement("li", null,
        createElement("strong", null, "Run 1-5: "),
        "Raw experience capture. Each run records goal, outcome, tool call trajectory, iterations, duration."
      ),
      createElement("li", null,
        createElement("strong", null, "Run 3+: "),
        "Strategy distillation. The LLM-driven distiller analyzes trajectories and extracts generalizable strategies."
      ),
      createElement("li", null,
        createElement("strong", null, "Run 10+: "),
        "Strategy refinement. Consolidator merges overlapping strategies, resolves contradictions. Utility scores: +0.1 success, -0.05 failure."
      ),
      createElement("li", null,
        createElement("strong", null, "Run 50+: "),
        "Skill promotion. Strategies reaching utility >= 0.7 after >= 5 applications are auto-promoted to reusable skills."
      )
    ),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`evolution: {
  store: new SqliteEvolutionStore("./agent-evolution.db"),
  capture: "every-run",          // "every-run" | "on-failure" | "on-success" | custom
  distillation: "post-run",      // "post-run" | "manual"
  pruning: { maxStrategies: 50, minUtility: 0.2 },
  skillPromotion: { minUtility: 0.7, minApplications: 5 },
}`
      )
    ),

    // ── Production Robustness ────────────────────────────────────
    createElement("h3", null, "Production Robustness"),
    createElement("p", null, "The agent loop includes nine robustness mechanisms:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Mechanism"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Model fallback")),
          createElement("td", null, "When primary LLM fails, strip thinking blocks and retry with fallbackLlm")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Reactive compression")),
          createElement("td", null, "3-phase: autocompact -> reactive compact -> fatal")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Token budget")),
          createElement("td", null, "Nudge at 80% + force-complete at 100%")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "LLM watchdog")),
          createElement("td", null, "Chat timeout (120s), stream idle timeout (90s), stall warning (30s)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Tool timeout")),
          createElement("td", null, "Per-tool configurable timeout via Promise.race")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Error withholding")),
          createElement("td", null, "Retry failed tools once before exposing error to LLM")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Message normalization")),
          createElement("td", null, "Merge adjacent same-role messages, filter empties")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Input validation")),
          createElement("td", null, "Two-layer: JSON Schema + custom validate hook")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("strong", null, "Abort handling")),
          createElement("td", null, "Blocked tool calls produce synthetic results so the LLM can adjust")
        )
      )
    ),

    // ── Lifecycle Hooks ──────────────────────────────────────────
    createElement("h3", null, "Lifecycle Hooks"),
    createElement("p", null, "Hooks provide fine-grained control over agent execution. All hooks are optional and non-fatal."),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Hook"),
          createElement("th", null, "When"),
          createElement("th", null, "Purpose")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "beforeToolCall")),
          createElement("td", null, "Before each tool execution"),
          createElement("td", null, "Gate: return { allowed: false } to block")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "afterToolCall")),
          createElement("td", null, "After each tool execution"),
          createElement("td", null, "Observe results. Status is \"success\" or \"error\"")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "onCheckpoint")),
          createElement("td", null, "At initialization, tool_result, completion"),
          createElement("td", null, "Save or modify checkpoints")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "getControlState")),
          createElement("td", null, "Before LLM, before/after tools"),
          createElement("td", null, "Operator control: pause or cancel")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "onRunComplete")),
          createElement("td", null, "Once at end of run"),
          createElement("td", null, "Final notification/logging")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "afterIteration")),
          createElement("td", null, "After each iteration"),
          createElement("td", null, "Progress monitoring")
        )
      )
    ),

    // ── Checkpoints and Resume ────────────────────────────────────
    createElement("h3", null, "Checkpoints and Resume"),
    createElement("p", null, "Every agent run produces checkpoints that can be used to resume interrupted runs:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`const result = await agent.run("Deploy the new feature");

if (result.status === "paused") {
  const resumed = await agent.resume(result.checkpoint!, "Approved. Continue deployment.");
}

if (result.status === "approval_required") {
  const { tool, args, reason } = result.pendingApproval!;
  // After human approval:
  const resumed = await agent.resume(result.checkpoint!, "Approved. Proceed.");
}`
      )
    ),

    // ── Stop Hooks ───────────────────────────────────────────────
    createElement("h3", null, "Stop Hooks (Guardrails)"),
    createElement("p", null, "Stop hooks are quality gates evaluated when the model produces a final response. If any hook fails, the response is rejected with feedback and the agent continues. After 3 consecutive rejections, the agent is force-completed."),

    // ══════════════════════════════════════════════════════════════
    // Part 2: Full-Stack Web
    // ══════════════════════════════════════════════════════════════

    createElement("h2", null, "Part 2: Full-Stack Web"),

    // ── defineAPI() ──────────────────────────────────────────────
    createElement("h3", null, "defineAPI()"),
    createElement("p", null,
      createElement("code", null, "defineAPI()"),
      " is the central building block for web endpoints. A single call defines a typed handler projected to HTTP, MCP, A2A, and OpenAPI."
    ),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const POST = defineAPI({
  input: z.object({
    title: z.string().min(1).max(200),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
  }),
  output: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
  }),
  description: "Create a new ticket",
  capability: "write",
  resource: "ticket",
  policy: "requireAuth",
  async handler({ input, ctx }) {
    return { id: crypto.randomUUID(), title: input.title, status: "open" };
  },
});`
      )
    ),

    // ── Multi-Protocol Projection ────────────────────────────────
    createElement("h3", null, "Multi-Protocol Projection"),
    createElement("p", null, "One ", createElement("code", null, "defineAPI()"), " call simultaneously creates endpoints across four protocols:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`defineAPI() --> CapabilityRegistry
                  |-- HTTP JSON API (Hono)
                  |-- MCP Tools (@modelcontextprotocol/sdk)
                  |-- A2A Skills (Google Agent-to-Agent)
                  +-- OpenAPI 3.1 Spec`
      )
    ),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, "HTTP"), " -- Input from query params (GET) or JSON body (POST/PUT/PATCH/DELETE)"),
      createElement("li", null, createElement("strong", null, "MCP"), " -- Each route becomes a tool. ", createElement("code", null, "GET /tickets"), " becomes ", createElement("code", null, "get_tickets")),
      createElement("li", null, createElement("strong", null, "A2A"), " -- Each route becomes a skill via JSON-RPC ", createElement("code", null, "tasks/send")),
      createElement("li", null, createElement("strong", null, "OpenAPI"), " -- Each route becomes an operation with full schema generation")
    ),

    createElement("h4", null, "Auto-Generated Endpoints"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Endpoint"),
          createElement("th", null, "Protocol"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "GET /.well-known/capstan.json")),
          createElement("td", null, "Capstan"),
          createElement("td", null, "Agent manifest with all capabilities")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "GET /.well-known/agent.json")),
          createElement("td", null, "A2A"),
          createElement("td", null, "Agent card with skills list")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "POST /.well-known/a2a")),
          createElement("td", null, "A2A"),
          createElement("td", null, "JSON-RPC task handler")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "POST /.well-known/mcp")),
          createElement("td", null, "MCP"),
          createElement("td", null, "Streamable HTTP MCP endpoint")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "GET /openapi.json")),
          createElement("td", null, "OpenAPI"),
          createElement("td", null, "OpenAPI 3.1 specification")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "GET /capstan/approvals")),
          createElement("td", null, "Capstan"),
          createElement("td", null, "Approval workflow management")
        )
      )
    ),

    // ── File-Based Routing ───────────────────────────────────────
    createElement("h3", null, "File-Based Routing"),
    createElement("p", null, "Routes live in ", createElement("code", null, "app/routes/"), ". The router scans the directory tree and maps files to URL patterns."),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "File Pattern"),
          createElement("th", null, "Route Type"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "*.api.ts")),
          createElement("td", null, "API"),
          createElement("td", null, "API handler (exports HTTP methods)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "*.page.tsx")),
          createElement("td", null, "Page"),
          createElement("td", null, "React page component (SSR)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "_layout.tsx")),
          createElement("td", null, "Layout"),
          createElement("td", null, "Wraps nested routes via <Outlet>")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "_middleware.ts")),
          createElement("td", null, "Middleware"),
          createElement("td", null, "Runs before handlers in scope")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "_loading.tsx")),
          createElement("td", null, "Loading"),
          createElement("td", null, "Suspense fallback for pages")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "_error.tsx")),
          createElement("td", null, "Error"),
          createElement("td", null, "Error boundary for pages")
        )
      )
    ),
    createElement("p", null, "Dynamic segments use ", createElement("code", null, "[param]"), ", catch-all uses ", createElement("code", null, "[...param]"), ", route groups use ", createElement("code", null, "(name)"), " (transparent in URL)."),

    // ── definePolicy ─────────────────────────────────────────────
    createElement("h3", null, "definePolicy()"),
    createElement("p", null, "Policies define permission rules evaluated before route handlers."),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { definePolicy } from "@zauso-ai/capstan-core";

export const requireAuth = definePolicy({
  key: "requireAuth",
  title: "Require Authentication",
  effect: "deny",
  async check({ ctx }) {
    if (!ctx.auth.isAuthenticated) {
      return { effect: "deny", reason: "Authentication required" };
    }
    return { effect: "allow" };
  },
});`
      )
    ),
    createElement("h4", null, "Policy Effects"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Effect"),
          createElement("th", null, "Behavior")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "allow")),
          createElement("td", null, "Request proceeds normally")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "deny")),
          createElement("td", null, "Request is rejected with 403 Forbidden")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "approve")),
          createElement("td", null, "Request is held for human approval (returns 202 with approval ID)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "redact")),
          createElement("td", null, "Request proceeds but response data may be filtered")
        )
      )
    ),
    createElement("p", null, "When multiple policies apply, all are evaluated and the most restrictive effect wins: ", createElement("code", null, "allow < redact < approve < deny"), "."),

    // ── defineModel ──────────────────────────────────────────────
    createElement("h3", null, "defineModel (Database)"),
    createElement("p", null, "Capstan uses Drizzle ORM for data modeling. ", createElement("code", null, "defineModel()"), " creates typed table definitions with auto-generated CRUD route helpers."),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { defineModel } from "@zauso-ai/capstan-db";
import { text, integer } from "drizzle-orm/sqlite-core";

export const ticket = defineModel("ticket", {
  title: text("title").notNull(),
  priority: text("priority").default("medium"),
  status: text("status").default("open"),
});`
      )
    ),
    createElement("p", null, "Features: migrations, vector search, and generated CRUD endpoints that integrate with ", createElement("code", null, "defineAPI()"), " and the multi-protocol registry."),

    // ── Verification Loop ────────────────────────────────────────
    createElement("h3", null, "Verification Loop"),
    createElement("p", null, createElement("code", null, "capstan verify --json"), " runs an 8-step cascade against your application:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Step"),
          createElement("th", null, "Checks")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "structure")),
          createElement("td", null, "Required files exist")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "config")),
          createElement("td", null, "Config file loads and has a valid export")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "routes")),
          createElement("td", null, "API files export handlers, write endpoints have policies")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "models")),
          createElement("td", null, "Model definitions valid")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "typecheck")),
          createElement("td", null, "tsc --noEmit passes")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "contracts")),
          createElement("td", null, "Models match routes, policy references valid")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "manifest")),
          createElement("td", null, "Agent manifest matches live routes")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "protocols")),
          createElement("td", null, "HTTP, MCP, A2A, OpenAPI schema consistency")
        )
      )
    ),
    createElement("p", null, "Output includes ", createElement("code", null, "repairChecklist"), " with ", createElement("code", null, "fixCategory"), " and ", createElement("code", null, "autoFixable"), " flags, enabling an AI self-repair loop."),

    // ── AI in Web Handlers ───────────────────────────────────────
    createElement("h3", null, "AI in Web Handlers"),
    createElement("p", null, "The AI toolkit integrates with web handlers via the request context:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`export const POST = defineAPI({
  // ...
  async handler({ input, ctx }) {
    const analysis = await ctx.think(input.message, {
      schema: z.object({ intent: z.string(), confidence: z.number() }),
    });

    await ctx.remember(\`User asked about: \${analysis.intent}\`);
    const history = await ctx.recall(input.message);

    return { analysis, relatedHistory: history };
  },
});`
      )
    ),
    createElement("p", null,
      createElement("code", null, "think()"), " returns structured data via Zod schema parsing. ",
      createElement("code", null, "generate()"), " returns raw text. Both have streaming variants."
    )
  );
}

import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function ApiReferencePage() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "API Reference"),
    createElement("p", null,
      "Complete reference for all Capstan framework packages. The AI agent package (",
      createElement("code", null, "@zauso-ai/capstan-ai"),
      ") is documented first and in greatest detail; other packages follow in condensed form."
    ),

    // ══════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-ai (Smart Agent)
    // ══════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-ai" }, "@zauso-ai/capstan-ai (Smart Agent)"),
    createElement("p", null,
      "Standalone AI toolkit. Works independently or with the Capstan framework. Includes the smart agent loop, tool validation, token budgets, skills, memory, evolution, compression, harness mode, and utility functions."
    ),

    // ── createSmartAgent ─────────────────────────────────────────
    createElement("h3", { id: "createSmartAgent" }, "createSmartAgent(config)"),
    createElement("p", null,
      "Create a fully-configured smart agent with tool validation, token budgets, skills, evolution, and lifecycle hooks."
    ),
    createElement("pre", { className: "code-block" },
      createElement("code", null, "function createSmartAgent(config: SmartAgentConfig): SmartAgent")
    ),
    createElement("p", null, createElement("strong", null, "SmartAgentConfig"), " -- full configuration:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface SmartAgentConfig {
  llm: LLMProvider;                         // Primary LLM (required)
  tools: AgentTool[];                       // Available tools (required)
  tasks?: AgentTask[];                      // Background tasks via task fabric
  memory?: SmartAgentMemoryConfig;          // Scoped memory with pluggable backend
  prompt?: PromptComposerConfig;            // System prompt layering
  stopHooks?: StopHook[];                   // Post-response quality gates
  maxIterations?: number;                   // Max loop iterations (default: 10)
  contextWindowSize?: number;               // Context window for compression
  compaction?: Partial<{
    snip: SnipConfig;
    microcompact: MicrocompactConfig;
    autocompact: AutocompactConfig;
  }>;
  streaming?: StreamingExecutorConfig;      // Concurrent tool execution
  toolCatalog?: ToolCatalogConfig;          // Deferred tool loading
  hooks?: SmartAgentHooks;                  // Lifecycle hooks
  fallbackLlm?: LLMProvider;               // Backup model on primary failure
  tokenBudget?: number | TokenBudgetConfig; // Output token budget
  toolResultBudget?: ToolResultBudgetConfig; // Tool result size limits
  skills?: AgentSkill[];                    // Activatable strategies
  evolution?: EvolutionConfig;              // Self-evolution configuration
  llmTimeout?: LLMTimeoutConfig;            // Timeout and stall detection
}`
      )
    ),
    createElement("p", null, "Usage:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { createSmartAgent, defineSkill } from "@zauso-ai/capstan-ai";

const agent = createSmartAgent({
  llm: myProvider,
  tools: [readFile, writeFile],
  maxIterations: 20,
  fallbackLlm: cheaperProvider,
  tokenBudget: { maxOutputTokensPerTurn: 8192, nudgeAtPercent: 85 },
  toolResultBudget: { maxChars: 50_000, persistDir: "./overflow" },
  llmTimeout: { chatTimeoutMs: 120_000, streamIdleTimeoutMs: 90_000 },
  skills: [codeReviewSkill],
  evolution: {
    store: myEvolutionStore,
    capture: "every-run",
    distillation: "post-run",
  },
});

const result = await agent.run("Refactor the auth module");`
      )
    ),

    // ── SmartAgent ───────────────────────────────────────────────
    createElement("h3", { id: "SmartAgent" }, "SmartAgent"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface SmartAgent {
  run(goal: string): Promise<AgentRunResult>;
  resume(checkpoint: AgentCheckpoint, message: string): Promise<AgentRunResult>;
}`
      )
    ),

    // ── AgentTool ───────────────────────────────────────────────
    createElement("h3", { id: "AgentTool" }, "AgentTool"),
    createElement("p", null, "Tool definition with optional input validation and per-tool timeout."),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface AgentTool {
  name: string;                          // Unique tool identifier
  description: string;                   // LLM-facing description
  parameters?: Record<string, unknown>;  // JSON Schema for input
  isConcurrencySafe?: boolean;           // Safe for parallel execution
  failureMode?: "soft" | "hard";         // "soft" = non-fatal, "hard" = aborts
  execute(args: Record<string, unknown>): Promise<unknown>;
  validate?: (args: Record<string, unknown>) => { valid: boolean; error?: string };
  timeout?: number;                      // Per-tool timeout in ms
}`
      )
    ),

    // ── AgentTask ───────────────────────────────────────────────
    createElement("h3", { id: "AgentTask" }, "AgentTask"),
    createElement("p", null, "Background task submitted via the task fabric."),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`type AgentTaskKind = "shell" | "workflow" | "remote" | "subagent" | "custom";

interface AgentTask {
  name: string;
  description: string;
  kind?: AgentTaskKind;
  parameters?: Record<string, unknown>;
  isConcurrencySafe?: boolean;
  failureMode?: "soft" | "hard";
  execute(args: Record<string, unknown>, context: AgentTaskExecutionContext): Promise<unknown>;
}`
      )
    ),
    createElement("p", null, "Task factory helpers: ", createElement("code", null, "createShellTask"), ", ", createElement("code", null, "createWorkflowTask"), ", ", createElement("code", null, "createRemoteTask"), ", ", createElement("code", null, "createSubagentTask"), "."),

    // ── AgentSkill ──────────────────────────────────────────────
    createElement("h3", { id: "AgentSkill" }, "AgentSkill"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface AgentSkill {
  name: string;                    // Unique skill identifier
  description: string;             // What the skill does
  trigger: string;                 // When to use this skill
  prompt: string;                  // Guidance text injected on activation
  tools?: string[];                // Preferred tool names when active
  source?: "developer" | "evolved"; // Origin
  utility?: number;                // Effectiveness score (0.0 - 1.0)
  metadata?: Record<string, unknown>;
}`
      )
    ),

    createElement("h4", null, "Skill Functions"),
    createElement("ul", null,
      createElement("li", null,
        createElement("code", null, "defineSkill(def)"),
        " -- create a skill with sensible defaults (source: \"developer\", utility: 1.0)"
      ),
      createElement("li", null,
        createElement("code", null, "createActivateSkillTool(skills)"),
        " -- create the ", createElement("code", null, "activate_skill"), " meta-tool"
      ),
      createElement("li", null,
        createElement("code", null, "formatSkillDescriptions(skills)"),
        " -- format skills for system prompt inclusion"
      )
    ),

    // ── LLMProvider ─────────────────────────────────────────────
    createElement("h3", { id: "LLMProvider" }, "LLMProvider"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface LLMProvider {
  name: string;
  chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
  stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;
}

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LLMResponse {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason?: string;
}`
      )
    ),

    // ── LLMTimeoutConfig ────────────────────────────────────────
    createElement("h3", { id: "LLMTimeoutConfig" }, "LLMTimeoutConfig"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface LLMTimeoutConfig {
  chatTimeoutMs?: number;          // Max wait for chat() response (default: 120_000)
  streamIdleTimeoutMs?: number;    // Max idle between stream chunks (default: 90_000)
  stallWarningMs?: number;         // Warning threshold (default: 30_000)
}`
      )
    ),

    // ── TokenBudgetConfig ───────────────────────────────────────
    createElement("h3", { id: "TokenBudgetConfig" }, "TokenBudgetConfig"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface TokenBudgetConfig {
  maxOutputTokensPerTurn: number;  // Hard cap on output tokens per LLM call
  nudgeAtPercent?: number;         // Inject "wrapping up" nudge at this %
}`
      )
    ),
    createElement("p", null, "When ", createElement("code", null, "tokenBudget"), " is set to a plain number, it is treated as ", createElement("code", null, "{ maxOutputTokensPerTurn: n }"), "."),

    // ── ToolResultBudgetConfig ──────────────────────────────────
    createElement("h3", { id: "ToolResultBudgetConfig" }, "ToolResultBudgetConfig"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface ToolResultBudgetConfig {
  maxChars: number;                    // Max chars per individual tool result
  preserveStructure?: boolean;         // Preserve JSON structure when truncating
  persistDir?: string;                 // Save overflow results to disk
  maxAggregateCharsPerIteration?: number; // Cap total result chars per iteration (default: 200_000)
}`
      )
    ),

    // ── SmartAgentHooks ─────────────────────────────────────────
    createElement("h3", { id: "SmartAgentHooks" }, "SmartAgentHooks"),
    createElement("p", null, "Lifecycle hooks for observability, policy enforcement, and post-run processing."),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Hook"),
          createElement("th", null, "When"),
          createElement("th", null, "Return")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "beforeToolCall")),
          createElement("td", null, "Before each tool execution"),
          createElement("td", null, createElement("code", null, "{ allowed, reason? }"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "afterToolCall")),
          createElement("td", null, "After each tool execution"),
          createElement("td", null, createElement("code", null, "void"), " (receives status: \"success\" | \"error\")")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "beforeTaskCall")),
          createElement("td", null, "Before each task submission"),
          createElement("td", null, createElement("code", null, "{ allowed, reason? }"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "afterTaskCall")),
          createElement("td", null, "After each task completes"),
          createElement("td", null, createElement("code", null, "void"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "onCheckpoint")),
          createElement("td", null, "At init, tool_result, completion"),
          createElement("td", null, createElement("code", null, "AgentCheckpoint | void"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "getControlState")),
          createElement("td", null, "Before LLM, before/after tools"),
          createElement("td", null, createElement("code", null, '{ action: "continue" | "pause" | "cancel" }'))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "onRunComplete")),
          createElement("td", null, "Once at end of run"),
          createElement("td", null, createElement("code", null, "void"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "afterIteration")),
          createElement("td", null, "After each iteration"),
          createElement("td", null, createElement("code", null, "void"), " (receives IterationSnapshot)")
        )
      )
    ),

    // ── AgentRunResult ──────────────────────────────────────────
    createElement("h3", { id: "AgentRunResult" }, "AgentRunResult"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`type AgentRunStatus =
  | "completed" | "max_iterations" | "approval_required"
  | "paused" | "canceled" | "fatal";

interface AgentRunResult {
  result: unknown;                    // The agent's final output
  iterations: number;                 // Loop iterations executed
  toolCalls: AgentToolCallRecord[];   // All tool calls made
  taskCalls: AgentTaskCallRecord[];   // All task calls made
  status: AgentRunStatus;             // Terminal status
  error?: string;                     // Error message (when "fatal")
  checkpoint?: AgentCheckpoint;       // Resumable checkpoint
  pendingApproval?: {                 // Blocked approval details
    kind: "tool" | "task";
    tool: string;
    args: unknown;
    reason: string;
  };
}`
      )
    ),

    // ── AgentCheckpoint ─────────────────────────────────────────
    createElement("h3", { id: "AgentCheckpoint" }, "AgentCheckpoint"),
    createElement("p", null, "Serializable checkpoint for pause/resume workflows."),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface AgentCheckpoint {
  stage: "initialized" | "tool_result" | "task_wait" | "approval_required"
       | "paused" | "completed" | "max_iterations" | "canceled";
  goal: string;
  messages: LLMMessage[];
  iterations: number;
  toolCalls: AgentToolCallRecord[];
  taskCalls: AgentTaskCallRecord[];
  maxOutputTokens: number;
  compaction: { autocompactFailures: number; reactiveCompactRetries: number; tokenEscalations: number };
  pendingApproval?: { kind: "tool" | "task"; tool: string; args: unknown; reason: string };
}`
      )
    ),

    // ── Compression Config ──────────────────────────────────────
    createElement("h3", { id: "compression" }, "Compression Config"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface SnipConfig { preserveTail: number }
interface MicrocompactConfig { maxToolResultChars: number; protectedTail: number }
interface AutocompactConfig { threshold: number; maxFailures: number; bufferTokens?: number }
interface StreamingExecutorConfig { maxConcurrency: number }
interface ToolCatalogConfig { deferThreshold: number }`
      )
    ),

    // ── Stop Hooks ──────────────────────────────────────────────
    createElement("h3", { id: "StopHook" }, "StopHook"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface StopHook {
  name: string;
  evaluate(context: StopHookContext): Promise<StopHookResult>;
}

interface StopHookContext { response: string; messages: LLMMessage[]; toolCalls: AgentToolCallRecord[]; goal: string }
interface StopHookResult { pass: boolean; feedback?: string }`
      )
    ),

    // ── Prompt Composer ─────────────────────────────────────────
    createElement("h3", { id: "PromptComposer" }, "Prompt Composer"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface PromptComposerConfig {
  base?: string;
  layers?: PromptLayer[];
  dynamicLayers?: (context: PromptContext) => PromptLayer[];
}

interface PromptLayer {
  id: string;
  content: string;
  position: "prepend" | "append" | "replace_base";
  priority?: number;
}`
      )
    ),

    // ── Memory ──────────────────────────────────────────────────
    createElement("h3", { id: "memory" }, "Memory"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface MemoryBackend {
  store(entry: Omit<MemoryEntry, "id" | "createdAt">): Promise<string>;
  query(scope: MemoryScope, text: string, k: number): Promise<MemoryEntry[]>;
  remove(id: string): Promise<boolean>;
  clear(scope: MemoryScope): Promise<void>;
}

interface SmartAgentMemoryConfig {
  store: MemoryBackend;
  scope: MemoryScope;
  readScopes?: MemoryScope[];
  embedding?: MemoryEmbedder;
  maxMemoryTokens?: number;
  saveSessionSummary?: boolean;
}`
      )
    ),
    createElement("p", null, "Built-in backends: ", createElement("code", null, "BuiltinMemoryBackend"), " (in-memory), ", createElement("code", null, "SqliteMemoryBackend"), " (persistent). Use ", createElement("code", null, "createMemoryAccessor()"), " for the high-level ", createElement("code", null, "remember / recall / forget / about / assembleContext"), " API."),

    // ── Evolution ───────────────────────────────────────────────
    createElement("h3", { id: "evolution" }, "Evolution"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface EvolutionConfig {
  store: EvolutionStore;
  capture?: "every-run" | "on-failure" | "on-success" | ((result: AgentRunResult) => boolean);
  distillation?: "post-run" | "manual";
  distiller?: Distiller;
  pruning?: PruningConfig;
  skillPromotion?: SkillPromotionConfig;
}

interface EvolutionStore {
  recordExperience(exp: Omit<Experience, "id" | "recordedAt">): Promise<string>;
  queryExperiences(query: ExperienceQuery): Promise<Experience[]>;
  storeStrategy(strategy: Omit<Strategy, "id" | "createdAt" | "updatedAt">): Promise<string>;
  queryStrategies(query: string, k: number): Promise<Strategy[]>;
  updateStrategyUtility(id: string, delta: number): Promise<void>;
  incrementStrategyApplications(id: string): Promise<void>;
  storeSkill(skill: AgentSkill): Promise<string>;
  querySkills(query: string, k: number): Promise<AgentSkill[]>;
  pruneStrategies(config: PruningConfig): Promise<number>;
  getStats(): Promise<EvolutionStats>;
}`
      )
    ),
    createElement("p", null, "Two built-in stores: ", createElement("code", null, "InMemoryEvolutionStore"), " (testing) and ", createElement("code", null, "SqliteEvolutionStore"), " (production persistence)."),
    createElement("p", null, "Key types:"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface Experience {
  id: string; goal: string; outcome: "success" | "failure" | "partial";
  trajectory: TrajectoryStep[]; iterations: number; tokenUsage: number;
  duration: number; skillsUsed: string[]; recordedAt: string;
}

interface Strategy {
  id: string; content: string; source: string[];
  utility: number; applications: number; createdAt: string; updatedAt: string;
}

interface PruningConfig { maxStrategies?: number; minUtility?: number; maxAgeDays?: number }
interface SkillPromotionConfig { enabled?: boolean; minApplications?: number; minUtility?: number }`
      )
    ),
    createElement("p", null, "Engine functions: ", createElement("code", null, "buildExperience()"), ", ", createElement("code", null, "shouldCapture()"), ", ", createElement("code", null, "runPostRunEvolution()"), ", ", createElement("code", null, "buildStrategyLayer()"), ". The ", createElement("code", null, "LlmDistiller"), " class handles distillation and consolidation."),

    // ── Utility Functions ───────────────────────────────────────
    createElement("h3", { id: "utilities" }, "Utility Functions"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Function"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "validateArgs(args, schema)")),
          createElement("td", null, "JSON Schema validator for tool inputs; collects all errors")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "normalizeMessages(messages)")),
          createElement("td", null, "Merge same-role, filter empties, convert duplicate system messages")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "estimateTokens(messages)")),
          createElement("td", null, "Rough token estimate (content length / 4)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "memoryFreshnessText(timestampMs)")),
          createElement("td", null, "Staleness caveat text for the LLM")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "think(llm, prompt, opts?)")),
          createElement("td", null, "Single LLM call with optional Zod schema parsing")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "generate(llm, prompt, opts?)")),
          createElement("td", null, "Single LLM call returning raw text")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "thinkStream / generateStream")),
          createElement("td", null, "Streaming variants of think/generate")
        )
      )
    ),

    // ══════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-agent
    // ══════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-agent" }, "@zauso-ai/capstan-agent"),
    createElement("p", null, "LLM providers, machine surfaces, and interop."),

    createElement("h3", null, "LLM Providers"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { openaiProvider, anthropicProvider } from "@zauso-ai/capstan-agent";

const openai = openaiProvider({ apiKey: "...", model: "gpt-4o", baseUrl: "..." });
const claude = anthropicProvider({ apiKey: "...", model: "claude-sonnet-4-20250514" });`
      )
    ),

    createElement("h3", null, "CapabilityRegistry"),
    createElement("p", null, "Collects all ", createElement("code", null, "defineAPI()"), " routes and projects them to MCP tools, A2A skills, and OpenAPI operations."),

    createElement("h3", null, "MCP"),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "createMcpServer()"), " -- MCP server with stdio or streamable-http transport"),
      createElement("li", null, createElement("code", null, "createMcpClient()"), " -- consume tools from external MCP servers")
    ),

    createElement("h3", null, "A2A"),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "createA2AHandler()"), " -- JSON-RPC handler for the A2A protocol"),
      createElement("li", null, createElement("code", null, "generateAgentCard()"), " -- generate the agent card at ", createElement("code", null, "/.well-known/agent.json"))
    ),

    createElement("h3", null, "LangChain Integration"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`import { toLangChainTools } from "@zauso-ai/capstan-agent";
const tools = toLangChainTools(registry, { filter: (r) => r.capability === "read" });`
      )
    ),

    // ══════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-core
    // ══════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-core" }, "@zauso-ai/capstan-core"),
    createElement("p", null, "Core framework: server, routing primitives, policy engine, approval workflow, verification."),

    createElement("h3", null, "defineAPI(def)"),
    createElement("p", null, "Define a typed API route handler with input/output validation and agent introspection."),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`function defineAPI<TInput, TOutput>(def: APIDefinition<TInput, TOutput>): APIDefinition<TInput, TOutput>

interface APIDefinition<TInput, TOutput> {
  input?: z.ZodType<TInput>;
  output?: z.ZodType<TOutput>;
  description?: string;
  capability?: "read" | "write" | "external";
  resource?: string;
  policy?: string;
  handler: (args: { input: TInput; ctx: CapstanContext }) => Promise<TOutput>;
}`
      )
    ),

    createElement("h3", null, "defineConfig(config)"),
    createElement("p", null, "Identity function providing type-checking for the app configuration."),
    createElement("pre", { className: "code-block" },
      createElement("code", null, "function defineConfig(config: CapstanConfig): CapstanConfig")
    ),

    createElement("h3", null, "definePolicy(def)"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`function definePolicy(def: PolicyDefinition): PolicyDefinition

interface PolicyDefinition {
  key: string;
  title: string;
  effect: "allow" | "deny" | "approve" | "redact";
  check: (args: { ctx: CapstanContext; input?: unknown }) => Promise<PolicyCheckResult>;
}`
      )
    ),

    createElement("h3", null, "defineMiddleware(def)"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`function defineMiddleware(def: MiddlewareDefinition | MiddlewareHandler): MiddlewareDefinition`
      )
    ),

    createElement("h3", null, "defineRateLimit(config)"),
    createElement("pre", { className: "code-block" },
      createElement("code", null,
`interface RateLimitConfig {
  default: { requests: number; window: string };
  perAuthType?: { anonymous?: ...; human?: ...; agent?: ... };
}`
      )
    ),

    createElement("h3", null, "Other Core Exports"),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "enforcePolicies(policies, ctx, input?)"), " -- evaluate all policies, return most restrictive"),
      createElement("li", null, createElement("code", null, "env(key)"), " -- read env variable (returns \"\" if unset)"),
      createElement("li", null, createElement("code", null, "createCapstanApp(config)"), " -- build a Hono-backed Capstan app"),
      createElement("li", null, createElement("code", null, "definePlugin(def)"), " -- extend with routes, policies, middleware"),
      createElement("li", null, createElement("code", null, "defineWebSocket(path, handlers)"), " -- WebSocket endpoint"),
      createElement("li", null, createElement("code", null, "WebSocketRoom"), " -- pub/sub room for broadcasting"),
      createElement("li", null, createElement("code", null, "defineCompliance(config)"), " -- EU AI Act compliance primitives"),
      createElement("li", null, createElement("code", null, "createApproval / resolveApproval / clearApprovals"), " -- approval workflow"),
      createElement("li", null, createElement("code", null, "RedisStore"), " -- Redis backend for approvals, rate limits, DPoP, audit")
    ),

    // ══════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-db
    // ══════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-db" }, "@zauso-ai/capstan-db"),
    createElement("p", null, "Data modeling, Drizzle ORM integration, migrations, vector search, and CRUD generation."),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "defineModel(name, fields)"), " -- define a data model with fields, relations, indexes"),
      createElement("li", null, createElement("code", null, "field"), " -- field builders: ", createElement("code", null, "id(), string(), text(), integer(), number(), boolean(), date(), datetime(), json(), enum(), vector()")),
      createElement("li", null, createElement("code", null, "relation"), " -- relation builders: ", createElement("code", null, "belongsTo(), hasMany(), hasOne(), manyToMany()")),
      createElement("li", null, createElement("code", null, "generateCrudRoutes(model)"), " -- auto-generate CRUD API routes from a model"),
      createElement("li", null, createElement("code", null, "defineEmbedding(name, config)"), " -- configure an embedding model for RAG"),
      createElement("li", null, createElement("code", null, "vectorSearch(db, opts)"), " -- query by cosine similarity"),
      createElement("li", null, "Providers: ", createElement("code", null, "sqlite"), ", ", createElement("code", null, "libsql"), ", ", createElement("code", null, "postgres"), ", ", createElement("code", null, "mysql"))
    ),

    // ══════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-auth
    // ══════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-auth" }, "@zauso-ai/capstan-auth"),
    createElement("p", null, "Dual authentication for humans (JWT) and agents (API keys), plus OAuth, DPoP, and SPIFFE/mTLS."),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "signSession(payload, secret, maxAge?)"), " -- create signed JWT"),
      createElement("li", null, createElement("code", null, "verifySession(token, secret)"), " -- verify JWT (timing-safe)"),
      createElement("li", null, createElement("code", null, "generateApiKey()"), " -- returns { key, hash, prefix }"),
      createElement("li", null, createElement("code", null, "verifyApiKey(key, hash)"), " -- timing-safe verification"),
      createElement("li", null, createElement("code", null, "createAuthMiddleware(config, finders)"), " -- resolve auth context from requests"),
      createElement("li", null, createElement("code", null, "googleProvider() / githubProvider()"), " -- OAuth provider helpers"),
      createElement("li", null, createElement("code", null, "createOAuthHandlers(config)"), " -- full OAuth code flow handlers"),
      createElement("li", null, createElement("code", null, "checkPermission(required, granted)"), " -- resource:action permission checking with wildcards")
    ),

    // ══════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-router
    // ══════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-router" }, "@zauso-ai/capstan-router"),
    createElement("p", null, "File-based route discovery and manifest generation."),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "scanRoutes(dir)"), " -- scan directory tree, return route manifest with diagnostics"),
      createElement("li", null, createElement("code", null, "matchRoute(url, manifest)"), " -- match a URL against the route manifest"),
      createElement("li", null, "Supports: ", createElement("code", null, "*.api.ts"), ", ", createElement("code", null, "*.page.tsx"), ", ", createElement("code", null, "_layout.tsx"), ", ", createElement("code", null, "_middleware.ts"), ", ", createElement("code", null, "_loading.tsx"), ", ", createElement("code", null, "_error.tsx"), ", ", createElement("code", null, "not-found.tsx"))
    ),

    // ══════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-react
    // ══════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-react" }, "@zauso-ai/capstan-react"),
    createElement("p", null, "Human application shell: streaming SSR, selective hydration, layouts, client router."),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "Outlet"), " -- render child routes inside layouts"),
      createElement("li", null, createElement("code", null, "useLoaderData<T>()"), " -- read server loader data"),
      createElement("li", null, createElement("code", null, "ServerOnly"), " -- skip hydration for components"),
      createElement("li", null, createElement("code", null, "Link"), " (client) -- SPA navigation with prefetch"),
      createElement("li", null, createElement("code", null, "useRouter()"), " (client) -- navigation, params, search params"),
      createElement("li", null, createElement("code", null, "withViewTransition()"), " -- View Transitions API integration")
    ),

    // ══════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-cli
    // ══════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-cli" }, "@zauso-ai/capstan-cli"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Command"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan dev")),
          createElement("td", null, "Start development server with hot reload")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan build")),
          createElement("td", null, "Build for production")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan start")),
          createElement("td", null, "Start production server")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan mcp")),
          createElement("td", null, "Start MCP server over stdio")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan verify")),
          createElement("td", null, "Run the 8-step verification cascade")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan db:migrate")),
          createElement("td", null, "Generate migration from model changes")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan db:push")),
          createElement("td", null, "Apply pending migrations")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan db:status")),
          createElement("td", null, "Show migration status")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan add api|page|model|policy <name>")),
          createElement("td", null, "Scaffold new files")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan deploy:init --target <target>")),
          createElement("td", null, "Generate deployment files")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan ops:events|incidents|health|tail")),
          createElement("td", null, "Inspect semantic ops store")
        )
      )
    ),

    // ══════════════════════════════════════════════════════════════
    // Remaining packages
    // ══════════════════════════════════════════════════════════════
    createElement("h2", { id: "other-packages" }, "Other Packages"),

    createElement("h3", null, "@zauso-ai/capstan-cron"),
    createElement("p", null, "Recurring execution for agent jobs and long-running automation. Pair with the harness runtime for scheduled agent tasks."),

    createElement("h3", null, "@zauso-ai/capstan-ops"),
    createElement("p", null, "Semantic operations kernel: events, incidents, snapshots, SQLite persistence, querying, and CLI/operator consumption."),

    createElement("h3", null, "@zauso-ai/capstan-dev"),
    createElement("p", null, "Local development runtime with CSS pipeline, file watching, and hot route reloading. Creates dev server with ", createElement("code", null, "createDevServer()"), "."),

    createElement("h3", null, "create-capstan-app"),
    createElement("p", null, "Project scaffolder. Supports ", createElement("code", null, "blank"), " and ", createElement("code", null, "tickets"), " templates. Generates AGENTS.md for AI coding agents.")
  );
}

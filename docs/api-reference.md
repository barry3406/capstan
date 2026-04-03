# API Reference

## @zauso-ai/capstan-core

The core framework package. Provides the server, routing primitives, policy engine, approval workflow, and application verifier.

### defineAPI(def)

Define a typed API route handler with input/output validation and agent introspection.

```typescript
function defineAPI<TInput = unknown, TOutput = unknown>(
  def: APIDefinition<TInput, TOutput>,
): APIDefinition<TInput, TOutput>
```

**Parameters:**

```typescript
interface APIDefinition<TInput = unknown, TOutput = unknown> {
  input?: z.ZodType<TInput>;
  output?: z.ZodType<TOutput>;
  description?: string;
  capability?: "read" | "write" | "external";
  resource?: string;
  policy?: string;
  handler: (args: { input: TInput; ctx: CapstanContext }) => Promise<TOutput>;
}
```

The handler is wrapped to validate input (before) and output (after) against the provided Zod schemas. The definition is registered in a global registry for agent manifest generation.

---

### defineConfig(config)

Identity function that provides type-checking and editor auto-complete for the app configuration.

```typescript
function defineConfig(config: CapstanConfig): CapstanConfig
```

**CapstanConfig:**

```typescript
interface CapstanConfig {
  app?: {
    name?: string;
    title?: string;
    description?: string;
  };
  database?: {
    provider?: "sqlite" | "postgres" | "mysql";
    url?: string;
  };
  auth?: {
    providers?: Array<{ type: string; [key: string]: unknown }>;
    session?: {
      strategy?: "jwt" | "database";
      secret?: string;
      maxAge?: string;
    };
  };
  agent?: {
    manifest?: boolean;
    mcp?: boolean;
    openapi?: boolean;
    rateLimit?: {
      default?: { requests: number; window: string };
      perAgent?: boolean;
    };
  };
  server?: {
    port?: number;
    host?: string;
  };
}
```

---

### defineMiddleware(def)

Define a middleware for the request pipeline.

```typescript
function defineMiddleware(
  def: MiddlewareDefinition | MiddlewareDefinition["handler"],
): MiddlewareDefinition

interface MiddlewareDefinition {
  name?: string;
  handler: (args: {
    request: Request;
    ctx: CapstanContext;
    next: () => Promise<Response>;
  }) => Promise<Response>;
}
```

Accepts either a full definition object or a bare handler function.

---

### definePolicy(def)

Define a named permission policy.

```typescript
function definePolicy(def: PolicyDefinition): PolicyDefinition

interface PolicyDefinition {
  key: string;
  title: string;
  effect: PolicyEffect;
  check: (args: {
    ctx: CapstanContext;
    input?: unknown;
  }) => Promise<PolicyCheckResult>;
}

type PolicyEffect = "allow" | "deny" | "approve" | "redact";

interface PolicyCheckResult {
  effect: PolicyEffect;
  reason?: string;
}
```

---

### defineRateLimit(config)

Define rate limiting rules with per-auth-type windows.

```typescript
function defineRateLimit(config: RateLimitConfig): RateLimitConfig

interface RateLimitConfig {
  default: { requests: number; window: string };
  perAuthType?: {
    anonymous?: { requests: number; window: string };
    human?: { requests: number; window: string };
    agent?: { requests: number; window: string };
  };
}
```

---

### enforcePolicies(policies, ctx, input?)

Run all provided policies and return the most restrictive result.

```typescript
function enforcePolicies(
  policies: PolicyDefinition[],
  ctx: CapstanContext,
  input?: unknown,
): Promise<PolicyCheckResult>
```

All policies are evaluated (no short-circuiting). Severity order: `allow < redact < approve < deny`.

---

### env(key)

Read an environment variable, returning an empty string if not set.

```typescript
function env(key: string): string
```

---

### createCapstanApp(config)

Build a fully-wired Capstan application backed by a Hono server.

```typescript
function createCapstanApp(config: CapstanConfig): CapstanApp

interface CapstanApp {
  app: Hono;
  routeRegistry: RouteMetadata[];
  registerAPI: (
    method: HttpMethod,
    path: string,
    apiDef: APIDefinition,
    policies?: PolicyDefinition[],
  ) => void;
}
```

The returned `registerAPI` method mounts an API definition as an HTTP route and records metadata in `routeRegistry`. The Hono app includes CORS middleware, context injection, approval endpoints, and the agent manifest endpoint at `/.well-known/capstan.json`.

---

### clearAPIRegistry()

Clear all entries from the global API registry. Called automatically by `createCapstanApp()`.

```typescript
function clearAPIRegistry(): void
```

---

### getAPIRegistry()

Return all API definitions registered via `defineAPI()`.

```typescript
function getAPIRegistry(): ReadonlyArray<APIDefinition>
```

---

### createContext(honoCtx)

Create a `CapstanContext` from a Hono context.

```typescript
function createContext(honoCtx: HonoContext): CapstanContext
```

---

### createCapstanOpsContext(config)

Create the semantic ops context used by the runtime request logger, policy
engine, approval flow, and health snapshots.

```typescript
function createCapstanOpsContext(config?: {
  enabled?: boolean;
  appName?: string;
  source?: string;
  recentWindowMs?: number;
  retentionLimit?: number;
  sink?: {
    recordEvent(event: CapstanOpsEvent): Promise<void> | void;
    close?(): Promise<void> | void;
  };
}): CapstanOpsContext | undefined
```

When present on `CapstanContext`, the ops context can record request,
capability, policy, approval, and health lifecycle events while keeping local
queries available to the running process.

---

### createCapstanOpsRuntime(config)

Create the in-process semantic ops runtime used by `createCapstanOpsContext()`.

```typescript
function createCapstanOpsRuntime(config?: {
  enabled?: boolean;
  appName?: string;
  source?: string;
  recentWindowMs?: number;
  retentionLimit?: number;
}): CapstanOpsRuntime
```

The runtime records normalized events, derives incidents, emits health
snapshots, and can fan out those normalized events to one or more sinks.

---

### Approval Functions

```typescript
// Create a pending approval
function createApproval(opts: {
  method: string;
  path: string;
  input: unknown;
  policy: string;
  reason: string;
}): PendingApproval

// Get an approval by ID
function getApproval(id: string): PendingApproval | undefined

// List approvals, optionally filtered by status
function listApprovals(
  status?: "pending" | "approved" | "denied",
): PendingApproval[]

// Approve or deny a pending approval
function resolveApproval(
  id: string,
  decision: "approved" | "denied",
  resolvedBy?: string,
): PendingApproval | undefined

// Clear all approvals
function clearApprovals(): void

interface PendingApproval {
  id: string;
  method: string;
  path: string;
  input: unknown;
  policy: string;
  reason: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  result?: unknown;
}
```

---

### mountApprovalRoutes(app, handlerRegistry)

Mount the approval management HTTP endpoints on a Hono app.

```typescript
function mountApprovalRoutes(
  app: Hono,
  handlerRegistry: HandlerRegistry,
): void
```

---

### verifyCapstanApp(appRoot)

Run the 7-step verification cascade against a Capstan application.

```typescript
function verifyCapstanApp(appRoot: string): Promise<VerifyReport>

interface VerifyReport {
  status: "passed" | "failed";
  appRoot: string;
  timestamp: string;
  steps: VerifyStep[];
  repairChecklist: Array<{
    index: number;
    step: string;
    message: string;
    file?: string;
    line?: number;
    hint?: string;
    fixCategory?: string;
    autoFixable?: boolean;
  }>;
  summary: {
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    errorCount: number;
    warningCount: number;
  };
}
```

---

### renderRuntimeVerifyText(report)

Render a `VerifyReport` as human-readable text.

```typescript
function renderRuntimeVerifyText(report: VerifyReport): string
```

---

### definePlugin(def)

Define a reusable plugin that can add routes, policies, and middleware to a Capstan app.

```typescript
function definePlugin(def: PluginDefinition): PluginDefinition

interface PluginDefinition {
  name: string;
  version?: string;
  setup: (ctx: PluginSetupContext) => void;
}

interface PluginSetupContext {
  addRoute: (method: HttpMethod, path: string, handler: APIDefinition) => void;
  addPolicy: (policy: PolicyDefinition) => void;
  addMiddleware: (path: string, handler: MiddlewareDefinition["handler"]) => void;
  config: Readonly<CapstanConfig>;
}
```

Load plugins via the `plugins` array in `defineConfig()`.

---

### KeyValueStore\<T\>

Pluggable key-value store interface used by approvals, rate limiting, and DPoP replay detection. Swap the default in-memory store for Redis or any external backend.

```typescript
interface KeyValueStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  values(): Promise<T[]>;
  clear(): Promise<void>;
}
```

---

### MemoryStore

Default in-memory implementation of `KeyValueStore<T>`.

```typescript
class MemoryStore<T> implements KeyValueStore<T> {
  constructor();
}
```

---

### setApprovalStore(store)

Replace the default in-memory approval store with a custom `KeyValueStore`.

```typescript
function setApprovalStore(store: KeyValueStore<PendingApproval>): void
```

---

### setRateLimitStore(store)

Replace the default in-memory rate limit store.

```typescript
function setRateLimitStore(store: KeyValueStore<RateLimitEntry>): void
```

---

### setDpopReplayStore(store)

Replace the default in-memory DPoP replay cache.

```typescript
function setDpopReplayStore(store: KeyValueStore<boolean>): void
```

---

### setAuditStore(store)

Replace the default in-memory audit log store with a custom `KeyValueStore`.

```typescript
function setAuditStore(store: KeyValueStore<AuditEntry>): void
```

---

### RedisStore

Redis-backed implementation of `KeyValueStore<T>`. Uses `ioredis` (optional peer dependency) for communication. All keys are prefixed with a configurable namespace to avoid collisions.

```typescript
class RedisStore<T> implements KeyValueStore<T> {
  constructor(redis: any, prefix?: string); // default prefix: "capstan:"
}
```

**Usage:**

```typescript
import Redis from "ioredis";
import { RedisStore, setApprovalStore, setAuditStore } from "@zauso-ai/capstan-core";

const redis = new Redis();
setApprovalStore(new RedisStore(redis, "myapp:approvals:"));
setAuditStore(new RedisStore(redis, "myapp:audit:"));
```

---

### defineCompliance(config)

Declare EU AI Act compliance metadata and enable audit logging.

```typescript
function defineCompliance(config: ComplianceConfig): void

interface ComplianceConfig {
  riskLevel: "minimal" | "limited" | "high" | "unacceptable";
  auditLog?: boolean;
  transparency?: {
    description?: string;
    provider?: string;
    contact?: string;
  };
}
```

When `auditLog` is `true`, every `defineAPI()` handler invocation is automatically recorded. The audit log is served at `GET /capstan/audit`.

---

### recordAuditEntry(entry)

Manually record a custom audit log entry.

```typescript
function recordAuditEntry(entry: {
  action: string;
  authType?: string;
  userId?: string;
  resource?: string;
  detail?: unknown;
}): void
```

---

### getAuditLog(filter?)

Retrieve audit log entries, optionally filtered.

```typescript
function getAuditLog(filter?: {
  action?: string;
  authType?: string;
  since?: string;
}): AuditEntry[]
```

---

### clearAuditLog()

Clear all audit log entries (useful in tests).

```typescript
function clearAuditLog(): void
```

---

### defineWebSocket(path, handler)

Define a WebSocket route handler for real-time bidirectional communication.

```typescript
function defineWebSocket(
  path: string,
  handler: WebSocketHandler,
): WebSocketRoute

interface WebSocketHandler {
  onOpen?: (ws: WebSocketClient) => void;
  onMessage?: (ws: WebSocketClient, message: string | ArrayBuffer) => void;
  onClose?: (ws: WebSocketClient, code: number, reason: string) => void;
  onError?: (ws: WebSocketClient, error: Error) => void;
}

interface WebSocketClient {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

interface WebSocketRoute {
  path: string;
  handler: WebSocketHandler;
}
```

**Usage:**

```typescript
import { defineWebSocket } from "@zauso-ai/capstan-core";

export const chat = defineWebSocket("/ws/chat", {
  onOpen(ws) { console.log("client connected"); },
  onMessage(ws, message) { ws.send(`echo: ${message}`); },
  onClose(ws, code, reason) { console.log("disconnected", code); },
});
```

---

### WebSocketRoom

Pub/sub room for broadcasting messages across connected clients.

```typescript
class WebSocketRoom {
  join(client: WebSocketClient): void;
  leave(client: WebSocketClient): void;
  broadcast(message: string, exclude?: WebSocketClient): void;
  get size(): number;
  close(): void;
}
```

**Usage:**

```typescript
import { defineWebSocket, WebSocketRoom } from "@zauso-ai/capstan-core";

const lobby = new WebSocketRoom();

export const ws = defineWebSocket("/ws/lobby", {
  onOpen(ws) { lobby.join(ws); },
  onMessage(ws, msg) { lobby.broadcast(String(msg), ws); },
  onClose(ws) { lobby.leave(ws); },
});
```

---

### cacheSet(key, data, opts?)

Store a value in the cache with optional TTL, tags, and ISR revalidation.

```typescript
function cacheSet<T>(key: string, data: T, opts?: CacheOptions): Promise<void>

interface CacheOptions {
  ttl?: number;        // Time-to-live in seconds
  tags?: string[];     // Cache tags for bulk invalidation
  revalidate?: number; // Revalidate interval in seconds (ISR)
}
```

---

### cacheGet(key)

Retrieve a cached value. Returns `undefined` on miss. Supports stale-while-revalidate when `revalidate` was set.

```typescript
function cacheGet<T>(key: string): Promise<T | undefined>
```

---

### cacheInvalidateTag(tag)

Invalidate all cache entries associated with a tag. Also invalidates response cache entries with the same tag (cross-invalidation).

```typescript
function cacheInvalidateTag(tag: string): Promise<void>
```

---

### cached(fn, opts?)

Stale-while-revalidate decorator. Wraps an async function with caching. Subsequent calls return the cached value until TTL expires, then revalidate in the background.

```typescript
function cached<T>(
  fn: () => Promise<T>,
  opts?: CacheOptions & { key?: string },
): () => Promise<T>
```

---

### setCacheStore(store)

Replace the default in-memory cache store with a custom `KeyValueStore`.

```typescript
function setCacheStore(store: KeyValueStore<CacheEntry<unknown>>): void
```

---

### ResponseCacheEntry

Full-page response cache entry used by ISR render strategies.

```typescript
interface ResponseCacheEntry {
  html: string;
  headers: Record<string, string>;
  statusCode: number;
  createdAt: number;
  revalidateAfter: number | null;
  tags: string[];
}
```

---

### responseCacheGet(key)

Retrieve a cached page response. Returns the entry and a `stale` boolean indicating whether it's past `revalidateAfter`.

```typescript
function responseCacheGet(key: string): Promise<{ entry: ResponseCacheEntry; stale: boolean } | undefined>
```

---

### responseCacheSet(key, entry, opts?)

Store a page response in the cache.

```typescript
function responseCacheSet(
  key: string,
  entry: ResponseCacheEntry,
  opts?: { ttlMs?: number },
): Promise<void>
```

---

### responseCacheInvalidateTag(tag)

Delete all response cache entries associated with a tag. Returns the number of invalidated entries.

```typescript
function responseCacheInvalidateTag(tag: string): Promise<number>
```

---

### responseCacheInvalidate(key)

Delete a single response cache entry by key.

```typescript
function responseCacheInvalidate(key: string): Promise<boolean>
```

---

### responseCacheClear()

Clear all entries in the response cache.

```typescript
function responseCacheClear(): Promise<void>
```

---

### setResponseCacheStore(store)

Replace the default in-memory response cache store with a custom `KeyValueStore`.

```typescript
function setResponseCacheStore(store: KeyValueStore<ResponseCacheEntry>): void
```

---

## @zauso-ai/capstan-ops

Semantic operations kernel used by the runtime and CLI.

### createCapstanOpsRuntime(options)

Create the persistent ops runtime that records events, incidents, and health
snapshots into an `OpsStore`.

```typescript
function createCapstanOpsRuntime(options: {
  store: OpsStore;
  serviceName?: string;
  environment?: string;
}): {
  recordEvent(input: OpsRecordEventInput): Promise<OpsEventRecord>;
  recordIncident(input: OpsRecordIncidentInput): Promise<OpsIncidentRecord>;
  captureSnapshot(input: OpsCaptureSnapshotInput): Promise<OpsSnapshotRecord>;
  captureDerivedSnapshot(timestamp?: string): Promise<OpsSnapshotRecord>;
  createOverview(): OpsOverview;
}
```

### InMemoryOpsStore

```typescript
class InMemoryOpsStore implements OpsStore {
  constructor(options?: {
    retention?: OpsRetentionConfig;
    eventRetentionMs?: number;
    incidentRetentionMs?: number;
    snapshotRetentionMs?: number;
  });
}
```

### SqliteOpsStore

```typescript
class SqliteOpsStore implements OpsStore {
  constructor(options: {
    path: string;
    retention?: OpsRetentionConfig;
  });
}
```

Capstan dev and portable runtime builds use this store shape to persist
structured data at `.capstan/ops/ops.db`, and the CLI inspects it with
`ops:events`, `ops:incidents`, `ops:health`, and `ops:tail`.

---

---

## @zauso-ai/capstan-agent — LLM Providers

Built-in LLM provider adapters for chat completion and streaming.

### openaiProvider(config)

Create an OpenAI-compatible LLM provider.

```typescript
function openaiProvider(config: {
  apiKey: string;
  baseUrl?: string;  // default: "https://api.openai.com/v1"
  model?: string;    // default: "gpt-4o"
}): LLMProvider
```

Works with any OpenAI-compatible API (OpenAI, Azure OpenAI, Ollama, etc.) by setting `baseUrl`. Supports both `chat()` and `stream()`.

---

### anthropicProvider(config)

Create an Anthropic LLM provider.

```typescript
function anthropicProvider(config: {
  apiKey: string;
  model?: string;    // default: "claude-sonnet-4-20250514"
  baseUrl?: string;  // default: "https://api.anthropic.com/v1"
}): LLMProvider
```

Supports `chat()`. System prompts are extracted from messages and sent via the Anthropic `system` parameter.

---

### LLM Types

```typescript
interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

interface LLMStreamChunk {
  content: string;
  done: boolean;
}

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  responseFormat?: Record<string, unknown>;
}

interface LLMProvider {
  name: string;
  chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
  stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;
}
```

---

## @zauso-ai/capstan-ai

Standalone AI toolkit. Works independently or with the Capstan framework, including browser/filesystem harness mode.

### createAI(config)

Factory function that creates a standalone AI instance with all capabilities. No Capstan framework required.

```typescript
function createAI(config: AIConfig): AIContext

interface AIConfig {
  llm: LLMProvider;
  memory?: {
    backend?: MemoryBackend;
    embedding?: { embed(texts: string[]): Promise<number[][]>; dimensions: number };
    autoExtract?: boolean;
  };
  defaultScope?: MemoryScope;
}

interface AIContext {
  think<T = string>(prompt: string, opts?: ThinkOptions<T>): Promise<T>;
  generate(prompt: string, opts?: GenerateOptions): Promise<string>;
  thinkStream(prompt: string, opts?: Omit<ThinkOptions, "schema">): AsyncIterable<string>;
  generateStream(prompt: string, opts?: GenerateOptions): AsyncIterable<string>;
  remember(content: string, opts?: RememberOptions): Promise<string>;
  recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]>;
  memory: {
    about(type: string, id: string): MemoryAccessor;
    forget(entryId: string): Promise<boolean>;
    assembleContext(opts: AssembleContextOptions): Promise<string>;
  };
  agent: {
    run(config: AgentRunConfig): Promise<AgentRunResult>;
  };
}

interface AgentRunConfig {
  goal: string;
  tools?: AgentTool[];
  tasks?: AgentTask[];
  maxIterations?: number;
  systemPrompt?: string;
}
```

**Usage:**

```typescript
import { createAI } from "@zauso-ai/capstan-ai";
import { openaiProvider } from "@zauso-ai/capstan-agent";

const ai = createAI({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});

// Structured reasoning with Zod schema
const result = await ai.think("Classify this ticket", {
  schema: z.object({ category: z.string(), priority: z.enum(["low", "medium", "high"]) }),
});

// Text generation
const summary = await ai.generate("Summarize this document...");
```

Task helpers are exported directly from `@zauso-ai/capstan-ai`:

```typescript
import {
  createShellTask,
  createWorkflowTask,
  createRemoteTask,
  createSubagentTask,
} from "@zauso-ai/capstan-ai";
```

---

### createHarness(config)

Durable harness runtime for long-running agents. Adds browser/filesystem sandboxes, verification hooks, persisted runs/events/artifacts/checkpoints, and runtime lifecycle control on top of `runAgentLoop()`.

```typescript
function createHarness(config: HarnessConfig): Promise<Harness>

interface HarnessConfig {
  llm: LLMProvider;
  sandbox?: {
    browser?: boolean | BrowserSandboxConfig;
    fs?: boolean | FsSandboxConfig;
  };
  verify?: {
    enabled?: boolean;
    maxRetries?: number;
    verifier?: HarnessVerifierFn;
  };
  observe?: {
    logger?: HarnessLogger;
    onEvent?: (event: HarnessEvent) => void;
  };
  context?: {
    enabled?: boolean;
    maxPromptTokens?: number;
    reserveOutputTokens?: number;
    maxMemories?: number;
    maxArtifacts?: number;
    maxRecentMessages?: number;
    maxRecentToolResults?: number;
    microcompactToolResultChars?: number;
    sessionCompactThreshold?: number;
    defaultScopes?: MemoryScope[];
    autoPromoteObservations?: boolean;
    autoPromoteSummaries?: boolean;
  };
  runtime?: {
    rootDir?: string;
    maxConcurrentRuns?: number;
    driver?: HarnessSandboxDriver;
    beforeToolCall?: HarnessToolPolicyFn;
    beforeTaskCall?: HarnessTaskPolicyFn;
  };
}

interface BrowserSandboxConfig {
  engine?: "playwright" | "camoufox";
  platform?: string;
  accountId?: string;
  guardMode?: "vision" | "hybrid";
  headless?: boolean;
  proxy?: string;
  viewport?: { width: number; height: number };
}

interface FsSandboxConfig {
  rootDir: string;
  allowWrite?: boolean;
  allowDelete?: boolean;
  maxFileSize?: number;
}

interface Harness {
  startRun(config: AgentRunConfig): Promise<HarnessRunHandle>;
  run(config: AgentRunConfig): Promise<HarnessRunResult>;
  pauseRun(runId: string): Promise<HarnessRunRecord>;
  cancelRun(runId: string): Promise<HarnessRunRecord>;
  resumeRun(runId: string, options?: HarnessResumeOptions): Promise<HarnessRunResult>;
  getRun(runId: string): Promise<HarnessRunRecord | undefined>;
  listRuns(): Promise<HarnessRunRecord[]>;
  getEvents(runId?: string): Promise<HarnessRunEventRecord[]>;
  getTasks(runId: string): Promise<HarnessTaskRecord[]>;
  getArtifacts(runId: string): Promise<HarnessArtifactRecord[]>;
  getCheckpoint(runId: string): Promise<AgentLoopCheckpoint | undefined>;
  getSessionMemory(runId: string): Promise<HarnessSessionMemoryRecord | undefined>;
  getLatestSummary(runId: string): Promise<HarnessSummaryRecord | undefined>;
  listSummaries(runId?: string): Promise<HarnessSummaryRecord[]>;
  rememberMemory(input: HarnessMemoryInput): Promise<HarnessMemoryRecord>;
  recallMemory(query: HarnessMemoryQuery): Promise<HarnessMemoryMatch[]>;
  assembleContext(runId: string, options?: HarnessContextAssembleOptions): Promise<HarnessContextPackage>;
  replayRun(runId: string): Promise<HarnessReplayReport>;
  getPaths(): HarnessRuntimePaths;
  destroy(): Promise<void>;
}
```

**Usage:**

```typescript
import { createHarness } from "@zauso-ai/capstan-ai";

const harness = await createHarness({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  sandbox: {
    browser: { engine: "camoufox", platform: "jd", accountId: "price-monitor-01" },
    fs: { rootDir: "./workspace" },
  },
  runtime: {
    rootDir: process.cwd(),
    maxConcurrentRuns: 2,
  },
  verify: { enabled: true },
});

const started = await harness.startRun({
  goal: "Research the storefront and save notes to workspace/report.md",
});

const result = await started.result;
const checkpoint = await harness.getCheckpoint(started.runId);

await harness.destroy();
```

`engine: "playwright"` is the lightweight default. `engine: "camoufox"` enables the kernel adapter with stealth engines, persistent profiles, and platform guards.

`runtime.driver` defaults to `LocalHarnessSandboxDriver`, which creates an isolated sandbox directory per run under `.capstan/harness/sandboxes/<runId>/`. The runtime store persists:
- `runs/` — current run records
- `events/` + `events.ndjson` — per-run and global lifecycle event logs
- `tasks/` — per-run task execution records used by the task fabric and control plane
- `artifacts/` — screenshots and other persisted tool outputs
- `checkpoints/` — resumable loop checkpoints
- `session-memory/` — structured run-scoped working memory
- `summaries/` — compacted summaries for pause/resume and long histories
- `memory/` — long-term runtime memory entries used during context assembly

Use `openHarnessRuntime(rootDir?)` when you need an independent control plane that can inspect paused/completed runs without a live harness instance.

When you need runtime supervision with auth, the control plane also accepts an object form:

```typescript
const runtime = await openHarnessRuntime({
  rootDir: process.cwd(),
  authorize(request) {
    // request.action -> "run:read" | "run:pause" | "checkpoint:read" | ...
    // request.runId   -> optional run scope
    // return { allowed: true } or { allowed: false, reason: "..." }
    return { allowed: true };
  },
});
```

Control-plane and live harness methods now accept an optional access context as their final argument, so server routes, supervision surfaces, and CLI wrappers can pass the caller identity through to the authorizer without binding `@zauso-ai/capstan-ai` to a specific auth implementation.

Task-aware runs emit `task_call` and `task_result` lifecycle events and accumulate persisted `HarnessTaskRecord` entries. This makes shell-like background work inspectable without scraping transcript text.

The CLI harness commands also support local grant simulation with `--grants '<json>'` and optional `--subject '<json>'`, which is useful for testing scoped `run:*`, `artifact:read`, `checkpoint:read`, `context:read`, and `approval:approve` behavior against persisted runs.

---

### think(llm, prompt, opts?)

Structured reasoning: sends a prompt to the LLM and optionally parses the response against a schema.

```typescript
function think<T = string>(
  llm: LLMProvider,
  prompt: string,
  opts?: ThinkOptions<T>,
): Promise<T>

interface ThinkOptions<T = unknown> {
  schema?: { parse: (data: unknown) => T };
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  memory?: boolean;
  about?: [string, string];
}
```

When `schema` is provided, the LLM is asked for JSON output and the result is parsed and validated. Without a schema, the raw text is returned.

---

### generate(llm, prompt, opts?)

Text generation: sends a prompt to the LLM and returns the raw text response.

```typescript
function generate(
  llm: LLMProvider,
  prompt: string,
  opts?: GenerateOptions,
): Promise<string>

interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  memory?: boolean;
  about?: [string, string];
}
```

---

### thinkStream(llm, prompt, opts?)

Streaming text generation. Requires the LLM provider to support `stream()`. Yields text chunks as tokens are generated.

```typescript
function thinkStream(
  llm: LLMProvider,
  prompt: string,
  opts?: GenerateOptions,
): AsyncIterable<string>
```

Throws if the LLM provider does not implement `stream()`.

---

### generateStream(llm, prompt, opts?)

Alias for `thinkStream`. Streaming text generation that yields chunks as the LLM generates tokens.

```typescript
function generateStream(
  llm: LLMProvider,
  prompt: string,
  opts?: GenerateOptions,
): AsyncIterable<string>
```

---

### MemoryAccessor

The developer-facing memory interface, returned by `createMemoryAccessor()` or `ai.memory.about()`.

```typescript
interface MemoryAccessor {
  remember(content: string, opts?: RememberOptions): Promise<string>;
  recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]>;
  forget(entryId: string): Promise<boolean>;
  about(type: string, id: string): MemoryAccessor;
  assembleContext(opts: AssembleContextOptions): Promise<string>;
}

interface RememberOptions {
  scope?: MemoryScope;
  type?: "fact" | "event" | "preference" | "instruction";
  importance?: "low" | "medium" | "high" | "critical";
  metadata?: Record<string, unknown>;
}

interface RecallOptions {
  scope?: MemoryScope;
  limit?: number;         // Max results (default: 10)
  minScore?: number;      // Minimum relevance score
  types?: string[];       // Filter by memory type
}

interface MemoryScope {
  type: string;
  id: string;
}

interface MemoryEntry {
  id: string;
  content: string;
  scope: MemoryScope;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  importance?: "low" | "medium" | "high" | "critical";
  type?: "fact" | "event" | "preference" | "instruction";
  accessCount: number;
  lastAccessedAt: string;
}

interface AssembleContextOptions {
  query: string;
  maxTokens?: number;     // Default: 4000
  scopes?: MemoryScope[];
}
```

`remember()` stores a memory, automatically deduplicating (>0.92 cosine similarity merges with existing) and embedding for vector search. Returns the memory ID.

`recall()` retrieves relevant memories using hybrid search: vector similarity (0.7 weight) + keyword matching (0.3 weight) + recency decay (30-day half-life).

`about()` returns a new `MemoryAccessor` scoped to a specific entity. All subsequent operations are isolated to that scope.

`assembleContext()` builds an LLM-ready context string from stored memories, sorted by importance and packed within a token budget.

**Usage:**

```typescript
const customerMemory = ai.memory.about("customer", "cust_123");
await customerMemory.remember("Prefers email communication", { type: "preference" });
const relevant = await customerMemory.recall("communication preferences");
await ai.memory.forget(relevant[0].id);
```

---

### runAgentLoop(llm, config, tools, opts?)

Self-orchestrating agent loop. The LLM reasons about a goal, selects and executes tools, feeds results back, and repeats until done or the iteration limit is reached.

```typescript
function runAgentLoop(
  llm: LLMProvider,
  config: AgentRunConfig,
  tools: AgentTool[],
  opts?: {
    beforeToolCall?: (tool: string, args: unknown) => Promise<{ allowed: boolean; reason?: string }>;
    afterToolCall?: (tool: string, args: unknown, result: unknown) => Promise<void>;
    callStack?: Set<string>;
    onMemoryEvent?: (content: string) => Promise<void>;
  },
): Promise<AgentRunResult>

interface AgentTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

interface AgentRunConfig {
  goal: string;
  about?: [string, string];
  maxIterations?: number;  // Default: 10
  memory?: boolean;
  tools?: AgentTool[];
  systemPrompt?: string;
  excludeRoutes?: string[];
}

interface AgentRunResult {
  result: unknown;
  iterations: number;
  toolCalls: Array<{ tool: string; args: unknown; result: unknown }>;
  status: "completed" | "max_iterations" | "approval_required";
  pendingApproval?: { tool: string; args: unknown; reason: string };
}
```

The loop uses JSON-based tool calling: the LLM responds with `{"tool": "name", "arguments": {...}}` to invoke a tool, or plain text to finish. The `beforeToolCall` hook enables policy enforcement -- returning `{ allowed: false }` stops the loop with `"approval_required"` status. Tools in the `callStack` set are excluded to prevent recursion.

**Usage via `ai.agent.run()`:**

```typescript
const result = await ai.agent.run({
  goal: "Research the customer's recent issues and draft a summary",
  about: ["customer", "cust_123"],
  tools: [searchTickets, getCustomerHistory],
});
// result.status, result.result, result.iterations, result.toolCalls
```

---

### BuiltinMemoryBackend

Default in-memory backend with optional vector search support. Suitable for development and testing. No external dependencies.

```typescript
class BuiltinMemoryBackend implements MemoryBackend {
  constructor(opts?: { embedding?: MemoryEmbedder });
}

interface MemoryEmbedder {
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number;
}
```

Features: keyword-only fallback when no embedder is provided, hybrid search (vector + keyword + recency decay) when embedder is present, auto-dedup at >0.92 cosine similarity.

---

### MemoryBackend (Interface)

Pluggable backend interface for memory storage. Implement for custom backends (Mem0, Hindsight, Redis, etc.).

```typescript
interface MemoryBackend {
  store(entry: Omit<MemoryEntry, "id" | "accessCount" | "lastAccessedAt" | "createdAt" | "updatedAt">): Promise<string>;
  query(scope: MemoryScope, text: string, k: number): Promise<MemoryEntry[]>;
  remove(id: string): Promise<boolean>;
  clear(scope: MemoryScope): Promise<void>;
}
```

---

## @zauso-ai/capstan-cron

Recurring job scheduler for Capstan AI workflows. Works with Bun-native cron when available and falls back to a simple interval runner elsewhere.

### defineCron(config)

Declarative helper that returns the cron config unchanged.

```typescript
function defineCron(config: CronJobConfig): CronJobConfig
```

### createCronRunner()

Interval-based scheduler for simple cron expressions.

```typescript
function createCronRunner(): CronRunner

interface CronJobConfig {
  name: string;
  pattern: string;
  handler: () => Promise<void>;
  timezone?: string;
  maxConcurrent?: number;
  onError?: (err: Error) => void;
  enabled?: boolean;
}

interface CronRunner {
  add(config: CronJobConfig): string;
  remove(id: string): boolean;
  start(): void;
  stop(): void;
  getJobs(): CronJobInfo[];
}
```

`createCronRunner()` is intentionally lightweight. It approximates the supported cron patterns as intervals, so use it for simple `*/N` minute/hour schedules rather than timezone-sensitive calendar rules.

### createBunCronRunner()

Use Bun's native cron implementation when running on Bun:

```typescript
function createBunCronRunner(): CronRunner
```

When `Bun.cron` is unavailable, this falls back to `createCronRunner()`.

### createAgentCron(config)

Create a cron job that submits scheduled runs into a harness runtime. If you do not provide a runtime, it falls back to bootstrapping `createHarness()` on demand for compatibility.

```typescript
function createAgentCron(config: AgentCronConfig): CronJobConfig

interface AgentCronConfig {
  cron: string;
  name: string;
  goal: string | (() => string);
  timezone?: string;
  llm?: unknown;
  harnessConfig?: Record<string, unknown>;
  run?: {
    about?: [string, string];
    maxIterations?: number;
    memory?: boolean;
    systemPrompt?: string;
    excludeRoutes?: string[];
  };
  triggerMetadata?: Record<string, unknown>;
  runtime?: {
    harness?: { startRun(config: unknown, options?: unknown): Promise<{ runId: string; result: Promise<unknown> }> };
    createHarness?: () => Promise<{ startRun(config: unknown, options?: unknown): Promise<{ runId: string; result: Promise<unknown> }> }>;
    reuseHarness?: boolean;
  };
  onQueued?: (meta: { runId: string; trigger: unknown }) => void;
  onResult?: (result: unknown, meta: { runId: string; trigger: unknown }) => void;
  onError?: (err: Error) => void;
}
```

**Usage:**

```typescript
import { createCronRunner, createAgentCron } from "@zauso-ai/capstan-cron";
import { createHarness } from "@zauso-ai/capstan-ai";

const harness = await createHarness({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  sandbox: {
    browser: { engine: "camoufox", platform: "jd", accountId: "price-monitor-01" },
    fs: { rootDir: "./workspace" },
  },
});

const runner = createCronRunner();

runner.add(createAgentCron({
  cron: "0 */2 * * *",
  name: "price-monitor",
  goal: "Check the storefront and refresh workspace/report.md",
  runtime: {
    harness,
  },
}));

runner.start();
```

---

## Shared Types

```typescript
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface CapstanAuthContext {
  isAuthenticated: boolean;
  type: "human" | "agent" | "anonymous";
  userId?: string;
  role?: string;
  email?: string;
  agentId?: string;
  agentName?: string;
  permissions?: string[];
}

interface CapstanContext {
  auth: CapstanAuthContext;
  request: Request;
  env: Record<string, string | undefined>;
  honoCtx: HonoContext;
}

interface RouteMetadata {
  method: HttpMethod;
  path: string;
  description?: string;
  capability?: "read" | "write" | "external";
  resource?: string;
  policy?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}
```

---

## @zauso-ai/capstan-db

Database layer with model definitions, schema generation, migrations, and CRUD route scaffolding.

### defineModel(name, config)

Declare a data model with fields, relations, and indexes.

```typescript
function defineModel(
  name: string,
  config: {
    fields: Record<string, FieldDefinition>;
    relations?: Record<string, RelationDefinition>;
    indexes?: IndexDefinition[];
  },
): ModelDefinition
```

---

### field

Field builder namespace with helpers for each scalar type.

```typescript
const field: {
  id(): FieldDefinition;
  string(opts?: FieldOptions): FieldDefinition;
  text(opts?: FieldOptions): FieldDefinition;
  integer(opts?: FieldOptions): FieldDefinition;
  number(opts?: FieldOptions): FieldDefinition;
  boolean(opts?: FieldOptions): FieldDefinition;
  date(opts?: FieldOptions): FieldDefinition;
  datetime(opts?: FieldOptions): FieldDefinition;
  json<T = unknown>(opts?: FieldOptions): FieldDefinition;
  enum(values: readonly string[], opts?: FieldOptions): FieldDefinition;
  vector(dimensions: number): FieldDefinition;
}
```

---

### relation

Relation builder namespace.

```typescript
const relation: {
  belongsTo(model: string, opts?: { foreignKey?: string; through?: string }): RelationDefinition;
  hasMany(model: string, opts?: { foreignKey?: string; through?: string }): RelationDefinition;
  hasOne(model: string, opts?: { foreignKey?: string; through?: string }): RelationDefinition;
  manyToMany(model: string, opts?: { foreignKey?: string; through?: string }): RelationDefinition;
}
```

---

### createDatabase(config)

Create a Drizzle database instance for the specified provider.

```typescript
function createDatabase(config: DatabaseConfig): Promise<DatabaseInstance>

interface DatabaseConfig {
  provider: "sqlite" | "postgres" | "mysql";
  url: string;
}

interface DatabaseInstance {
  db: unknown;       // Drizzle ORM instance
  close: () => void; // Close the connection
}
```

---

### Migration Functions

```typescript
// Generate SQL migration statements from model diffs
function generateMigration(
  fromModels: ModelDefinition[],
  toModels: ModelDefinition[],
): string[]

// Execute SQL statements in a transaction
function applyMigration(
  db: { $client: { exec: (sql: string) => void } },
  sql: string[],
): void

// Create the _capstan_migrations tracking table
function ensureTrackingTable(
  client: MigrationDbClient,
  provider?: DbProvider,
): void

// Get list of applied migration names
function getAppliedMigrations(client: MigrationDbClient): string[]

// Get full migration status (applied + pending)
function getMigrationStatus(
  client: MigrationDbClient,
  allMigrationNames: string[],
  provider?: DbProvider,
): MigrationStatus

// Apply pending migrations with tracking
function applyTrackedMigrations(
  client: MigrationDbClient,
  migrations: Array<{ name: string; sql: string }>,
  provider?: DbProvider,
): string[]
```

---

### generateCrudRoutes(model)

Generate CRUD API route files from a model definition.

```typescript
function generateCrudRoutes(model: ModelDefinition): CrudRouteFiles[]

interface CrudRouteFiles {
  path: string;    // Relative to app/routes/
  content: string; // File content
}
```

---

### pluralize(word)

Naive English pluralizer for model-to-table name conversion.

```typescript
function pluralize(word: string): string
```

---

### defineEmbedding(modelName, config)

Configure an embedding model for vector generation.

```typescript
function defineEmbedding(
  modelName: string,
  config: {
    dimensions: number;
    adapter: EmbeddingAdapter;
  },
): EmbeddingInstance

interface EmbeddingInstance {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}
```

---

### openaiEmbeddings(opts)

Create an embedding adapter using the OpenAI embeddings API.

```typescript
function openaiEmbeddings(opts: {
  apiKey: string;
  model?: string;      // default: inferred from defineEmbedding modelName
  baseUrl?: string;     // for compatible providers
}): EmbeddingAdapter
```

---

### Types

```typescript
type ScalarType = "string" | "integer" | "number" | "boolean" | "date" | "datetime" | "text" | "json";
type DbProvider = "sqlite" | "postgres" | "mysql";
type RelationKind = "belongsTo" | "hasMany" | "hasOne" | "manyToMany";

interface FieldDefinition {
  type: ScalarType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  enum?: readonly string[];
  updatedAt?: boolean;
  autoId?: boolean;
  references?: string;
}

interface RelationDefinition {
  kind: RelationKind;
  model: string;
  foreignKey?: string;
  through?: string;
}

interface IndexDefinition {
  fields: string[];
  unique?: boolean;
  order?: "asc" | "desc";
}

interface ModelDefinition {
  name: string;
  fields: Record<string, FieldDefinition>;
  relations: Record<string, RelationDefinition>;
  indexes: IndexDefinition[];
}
```

---

## @zauso-ai/capstan-auth

Authentication and authorization: JWT sessions, API keys, middleware, permissions.

### signSession(payload, secret, maxAge?)

Create a signed JWT containing session data.

```typescript
function signSession(
  payload: Omit<SessionPayload, "iat" | "exp">,
  secret: string,
  maxAge?: string, // default: "7d"
): string
```

---

### verifySession(token, secret)

Verify a JWT signature and expiration. Returns the payload on success, `null` on failure.

```typescript
function verifySession(token: string, secret: string): SessionPayload | null
```

---

### generateApiKey(prefix?)

Generate a new API key with hash and lookup prefix.

```typescript
function generateApiKey(prefix?: string): {
  key: string;    // Full plaintext key (show once)
  hash: string;   // SHA-256 hex digest (store in DB)
  prefix: string; // Lookup prefix (store for indexed queries)
}
```

---

### verifyApiKey(key, storedHash)

Verify a plaintext API key against a stored SHA-256 hash. Uses timing-safe comparison.

```typescript
function verifyApiKey(key: string, storedHash: string): Promise<boolean>
```

---

### extractApiKeyPrefix(key)

Extract the lookup prefix from a full plaintext API key.

```typescript
function extractApiKeyPrefix(key: string): string
```

---

### createAuthMiddleware(config, deps)

Create a middleware function that resolves auth context from a request.

```typescript
function createAuthMiddleware(
  config: AuthConfig,
  deps: AuthResolverDeps,
): (request: Request) => Promise<AuthContext>

interface AuthConfig {
  session: { secret: string; maxAge?: string };
  apiKeys?: { prefix?: string; headerName?: string };
}

interface AuthResolverDeps {
  findAgentByKeyPrefix?: (prefix: string) => Promise<AgentCredential | null>;
}
```

---

### checkPermission(required, granted)

Check whether a required permission is satisfied by the granted set.

```typescript
function checkPermission(
  required: { resource: string; action: "read" | "write" | "delete" },
  granted: string[],
): boolean
```

Supports wildcards: `*:read`, `ticket:*`, `*:*`.

---

### derivePermission(capability, resource?)

Derive a permission object from a capability mode.

```typescript
function derivePermission(
  capability: "read" | "write" | "external",
  resource?: string,
): { resource: string; action: string }
```

---

### googleProvider(opts)

Create a pre-configured Google OAuth provider.

```typescript
function googleProvider(opts: {
  clientId: string;
  clientSecret: string;
}): OAuthProvider
```

Returns an `OAuthProvider` configured with Google's authorize, token, and user info endpoints and `["openid", "email", "profile"]` scopes.

---

### githubProvider(opts)

Create a pre-configured GitHub OAuth provider.

```typescript
function githubProvider(opts: {
  clientId: string;
  clientSecret: string;
}): OAuthProvider
```

Returns an `OAuthProvider` configured with GitHub's authorize, token, and user info endpoints and `["user:email"]` scopes.

---

### createOAuthHandlers(config, fetchFn?)

Create OAuth route handlers for the full authorization code flow.

```typescript
function createOAuthHandlers(
  config: OAuthConfig,
  fetchFn?: typeof globalThis.fetch,
): OAuthHandlers

interface OAuthConfig {
  providers: OAuthProvider[];
  callbackPath?: string; // default: "/auth/callback"
  sessionSecret: string;
}

interface OAuthHandlers {
  login: (request: Request, providerName: string) => Response;
  callback: (request: Request) => Promise<Response>;
}
```

The `login` handler redirects to the OAuth provider with a CSRF state parameter. The `callback` handler validates state, exchanges the authorization code for an access token, fetches user info, and creates a signed JWT session cookie.

---

### Types

```typescript
interface OAuthProvider {
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

interface SessionPayload {
  userId: string;
  email?: string;
  role?: string;
  iat: number;
  exp: number;
}

interface AgentCredential {
  id: string;
  name: string;
  apiKeyHash: string;
  apiKeyPrefix: string;
  permissions: string[];
  revokedAt?: string;
}

interface AuthContext {
  isAuthenticated: boolean;
  type: "human" | "agent" | "anonymous";
  userId?: string;
  role?: string;
  email?: string;
  agentId?: string;
  agentName?: string;
  permissions?: string[];
}
```

---

## @zauso-ai/capstan-router

File-based routing: directory scanning, URL matching, and manifest generation.

### scanRoutes(routesDir)

Scan a directory tree and produce a `RouteManifest` describing every route file.

```typescript
function scanRoutes(routesDir: string): Promise<RouteManifest>

interface RouteManifest {
  routes: RouteEntry[];
  scannedAt: string;
  rootDir: string;
}

interface RouteEntry {
  filePath: string;
  type: RouteType;
  urlPattern: string;
  methods?: string[];
  layouts: string[];
  middlewares: string[];
  params: string[];
  isCatchAll: boolean;
}

type RouteType = "page" | "api" | "layout" | "middleware";
```

---

### matchRoute(manifest, method, urlPath)

Match a URL path and HTTP method against a route manifest.

```typescript
function matchRoute(
  manifest: RouteManifest,
  method: string,
  urlPath: string,
): MatchedRoute | null

interface MatchedRoute {
  route: RouteEntry;
  params: Record<string, string>;
}
```

Priority: static segments > dynamic segments > catch-all. For equal specificity, API routes are preferred for non-GET methods, page routes for GET.

---

### generateRouteManifest(manifest)

Extract API route information from a `RouteManifest` for the agent surface layer.

```typescript
function generateRouteManifest(
  manifest: RouteManifest,
): { apiRoutes: AgentApiRoute[] }

interface AgentApiRoute {
  method: string;
  path: string;
  filePath: string;
}
```

---

## @zauso-ai/capstan-agent

Multi-protocol adapter layer: CapabilityRegistry, MCP server, A2A handler, OpenAPI spec.

### CapabilityRegistry

Unified registry for projecting routes to multiple protocol surfaces.

```typescript
class CapabilityRegistry {
  constructor(config: AgentConfig);

  register(route: RouteRegistryEntry): void;
  registerAll(routes: RouteRegistryEntry[]): void;
  getRoutes(): readonly RouteRegistryEntry[];
  getConfig(): Readonly<AgentConfig>;

  toManifest(): AgentManifest;
  toOpenApi(): Record<string, unknown>;
  toMcp(executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>): {
    server: McpServer;
    getToolDefinitions: () => Array<{ name: string; description: string; inputSchema: unknown }>;
  };
  toA2A(executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>): {
    handleRequest: (body: unknown) => Promise<unknown>;
    getAgentCard: () => A2AAgentCard;
  };
}
```

---

### createMcpServer(config, routes, executeRoute)

Create an MCP server that exposes API routes as MCP tools.

```typescript
function createMcpServer(
  config: AgentConfig,
  routes: RouteRegistryEntry[],
  executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>,
): {
  server: McpServer;
  getToolDefinitions: () => Array<{ name: string; description: string; inputSchema: unknown }>;
}
```

Tool naming convention: `GET /tickets` becomes `get_tickets`, `GET /tickets/:id` becomes `get_tickets_by_id`.

---

### serveMcpStdio(server)

Connect an MCP server to stdio transport for use with Claude Desktop, Cursor, etc.

```typescript
function serveMcpStdio(server: McpServer): Promise<void>
```

---

### routeToToolName(method, path)

Convert an HTTP method + URL path into a snake_case MCP tool name.

```typescript
function routeToToolName(method: string, path: string): string
```

---

### generateOpenApiSpec(config, routes)

Generate an OpenAPI 3.1.0 specification from agent config and routes.

```typescript
function generateOpenApiSpec(
  config: AgentConfig,
  routes: RouteRegistryEntry[],
): Record<string, unknown>
```

---

### generateA2AAgentCard(config, routes)

Generate an A2A Agent Card from config and routes.

```typescript
function generateA2AAgentCard(
  config: AgentConfig,
  routes: RouteRegistryEntry[],
): A2AAgentCard

interface A2AAgentCard {
  name: string;
  description?: string;
  url: string;
  version: string;
  capabilities: { streaming?: boolean; pushNotifications?: boolean };
  skills: Array<{
    id: string;
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }>;
  authentication?: { schemes: string[] };
}
```

---

### createMcpClient(options)

Create an MCP client to consume tools from an external MCP server.

```typescript
function createMcpClient(options: McpClientOptions): McpClient

interface McpClientOptions {
  url?: string;                        // Streamable HTTP endpoint
  command?: string;                    // stdio command (alternative to url)
  args?: string[];                     // stdio command args
  transport?: "streamable-http" | "stdio";
}

interface McpClient {
  listTools(): Promise<Array<{ name: string; description?: string; inputSchema: unknown }>>;
  callTool(name: string, args?: unknown): Promise<unknown>;
  close(): Promise<void>;
}
```

---

### McpTestHarness

Test harness for verifying MCP tool behavior without a live server.

```typescript
class McpTestHarness {
  constructor(registry: CapabilityRegistry);

  listTools(): Array<{ name: string; description: string; inputSchema: unknown }>;
  callTool(name: string, args?: unknown): Promise<unknown>;
}
```

---

### toLangChainTools(registry, options?)

Convert registered capabilities into LangChain-compatible `StructuredTool` instances.

```typescript
function toLangChainTools(
  registry: CapabilityRegistry,
  options?: {
    filter?: (route: RouteRegistryEntry) => boolean;
  },
): StructuredTool[]
```

---

### createA2AHandler(config, routes, executeRoute)

Create an A2A JSON-RPC handler supporting `tasks/send`, `tasks/get`, and `agent/card` methods.

```typescript
function createA2AHandler(
  config: AgentConfig,
  routes: RouteRegistryEntry[],
  executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>,
): {
  handleRequest: (body: unknown) => Promise<A2AJsonRpcResponse>;
  getAgentCard: () => A2AAgentCard;
}
```

---

### Types

```typescript
interface AgentManifest {
  capstan: string;
  name: string;
  description?: string;
  baseUrl?: string;
  authentication: {
    schemes: Array<{ type: "bearer"; name: string; header: string; description: string }>;
  };
  resources: Array<{
    key: string;
    title: string;
    description?: string;
    fields: Record<string, { type: string; required?: boolean; enum?: string[] }>;
  }>;
  capabilities: Array<{
    key: string;
    title: string;
    description?: string;
    mode: "read" | "write" | "external";
    resource?: string;
    endpoint: { method: string; path: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> };
    policy?: string;
  }>;
  mcp?: { endpoint: string; transport: string };
}

interface RouteRegistryEntry {
  method: string;
  path: string;
  description?: string;
  capability?: "read" | "write" | "external";
  resource?: string;
  policy?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

interface AgentConfig {
  name: string;
  description?: string;
  baseUrl?: string;
  resources?: Array<{
    key: string;
    title: string;
    description?: string;
    fields: Record<string, { type: string; required?: boolean; enum?: string[] }>;
  }>;
}

interface A2ATask {
  id: string;
  status: "submitted" | "working" | "input-required" | "completed" | "failed" | "canceled";
  skill: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}
```

---

## @zauso-ai/capstan-react

React SSR with loaders, layouts, hydration, Image, Font, Metadata, and ErrorBoundary.

### renderPage(options)

Server-side render a page component to HTML.

```typescript
function renderPage(options: RenderPageOptions): Promise<RenderResult>
```

---

### defineLoader(loader)

Define a data loader for a page component.

```typescript
function defineLoader(loader: LoaderFunction): LoaderFunction

type LoaderFunction = (args: LoaderArgs) => Promise<unknown>;

interface LoaderArgs {
  params: Record<string, string>;
  request: Request;
}
```

---

### useLoaderData()

React hook to access loader data in a page component.

```typescript
function useLoaderData<T = unknown>(): T
```

---

### Outlet

Layout outlet component for rendering nested routes.

```typescript
function Outlet(): JSX.Element
```

---

### OutletProvider

Context provider for the outlet system.

```typescript
function OutletProvider(props: { children: React.ReactNode }): JSX.Element
```

---

### ServerOnly

React component that renders its children only during SSR. Children are excluded from the client hydration bundle, enabling selective hydration.

```typescript
function ServerOnly(props: { children: React.ReactNode }): JSX.Element | null
```

---

### ClientOnly

React component that renders its children only in the browser. During SSR, an optional fallback is rendered instead.

```typescript
function ClientOnly(props: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}): JSX.Element
```

**Usage:**

```typescript
import { ClientOnly } from "@zauso-ai/capstan-react";

export default function Page() {
  return (
    <div>
      <ClientOnly fallback={<p>Loading editor...</p>}>
        <RichTextEditor />
      </ClientOnly>
    </div>
  );
}
```

---

### serverOnly()

Guard function that throws if called in a browser environment. Use at the top of server-only modules to prevent accidental client-side imports.

```typescript
function serverOnly(): void
```

**Usage:**

```typescript
import { serverOnly } from "@zauso-ai/capstan-react";
serverOnly(); // throws if imported in client code

export function getSecretConfig() { /* ... */ }
```

---

### useAuth()

React hook to access auth context in components.

```typescript
function useAuth(): CapstanAuthContext
```

---

### useParams()

React hook to access route parameters.

```typescript
function useParams(): Record<string, string>
```

---

### hydrateCapstanPage()

Client-side hydration entry point.

```typescript
function hydrateCapstanPage(): void
```

---

### PageContext

React context for page data.

```typescript
const PageContext: React.Context<CapstanPageContext>
```

---

### Image

Optimized image component with responsive srcset, lazy loading, and blur-up placeholder.

```typescript
function Image(props: ImageProps): ReactElement

interface ImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;       // eager loading + fetchpriority="high"
  quality?: number;         // 1-100, default 80
  placeholder?: "blur" | "empty";
  blurDataURL?: string;
  sizes?: string;
  loading?: "lazy" | "eager";
  className?: string;
  style?: Record<string, string | number>;
}
```

**Usage:**

```typescript
import { Image } from "@zauso-ai/capstan-react";

<Image src="/hero.jpg" alt="Hero" width={1200} priority placeholder="blur" />
```

---

### defineFont(config)

Configure a font for optimized loading. Returns a className, style object, and CSS variable name.

```typescript
function defineFont(config: FontConfig): FontResult

interface FontConfig {
  family: string;
  src?: string;
  weight?: string | number;
  style?: string;
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
  preload?: boolean;
  subsets?: string[];
  variable?: string;
}

interface FontResult {
  className: string;
  style: { fontFamily: string };
  variable?: string;
}
```

---

### fontPreloadLink(config)

Generate a `<link rel="preload">` element for a font.

```typescript
function fontPreloadLink(config: FontConfig): ReactElement | null
```

---

### defineMetadata(metadata)

Define page metadata for SEO, OpenGraph, and Twitter Cards.

```typescript
function defineMetadata(metadata: Metadata): Metadata

interface Metadata {
  title?: string | { default: string; template?: string };
  description?: string;
  keywords?: string[];
  robots?: string | { index?: boolean; follow?: boolean };
  openGraph?: {
    title?: string;
    description?: string;
    type?: string;
    url?: string;
    image?: string;
    siteName?: string;
  };
  twitter?: {
    card?: "summary" | "summary_large_image";
    title?: string;
    description?: string;
    image?: string;
  };
  icons?: { icon?: string; apple?: string };
  canonical?: string;
  alternates?: Record<string, string>;
}
```

---

### generateMetadataElements(metadata)

Convert a `Metadata` object into an array of React `<meta>`, `<title>`, and `<link>` elements for use in `<head>`.

```typescript
function generateMetadataElements(metadata: Metadata): ReactElement[]
```

---

### mergeMetadata(parent, child)

Merge two metadata objects. Child values override parent. Supports title templates: if parent has `{ template: "%s | Site" }` and child has `title: "Page"`, the result is `"Page | Site"`.

```typescript
function mergeMetadata(parent: Metadata, child: Metadata): Metadata
```

---

### ErrorBoundary

React error boundary component with reset functionality.

```typescript
class ErrorBoundary extends Component<ErrorBoundaryProps> {}

interface ErrorBoundaryProps {
  fallback: ReactElement | ((error: Error, reset: () => void) => ReactElement);
  children?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}
```

**Usage:**

```typescript
import { ErrorBoundary } from "@zauso-ai/capstan-react";

<ErrorBoundary fallback={(error, reset) => (
  <div>
    <p>Something went wrong: {error.message}</p>
    <button onClick={reset}>Try again</button>
  </div>
)}>
  <MyComponent />
</ErrorBoundary>
```

---

### NotFound

Pre-built 404 component for use with error boundaries or route handlers.

```typescript
function NotFound(): ReactElement
```

---

### RenderMode

Type for controlling page rendering strategy.

```typescript
type RenderMode = "ssr" | "ssg" | "isr" | "streaming"
```

---

### RenderStrategy

Interface for pluggable render strategies.

```typescript
interface RenderStrategy {
  render(ctx: RenderStrategyContext): Promise<RenderStrategyResult>
}

interface RenderStrategyContext {
  options: RenderPageOptions;
  url: string;
  revalidate?: number;
  cacheTags?: string[];
}

interface RenderStrategyResult extends RenderResult {
  cacheStatus?: "HIT" | "MISS" | "STALE";
}
```

---

### SSRStrategy

Renders the page on every request. This is the default strategy.

```typescript
class SSRStrategy implements RenderStrategy {}
```

---

### ISRStrategy

Incremental Static Regeneration. Checks the response cache first, serves stale content while revalidating in the background.

```typescript
class ISRStrategy implements RenderStrategy {}
```

---

### SSGStrategy

Static Site Generation — serves pre-rendered HTML from the filesystem, falls back to SSR on cache miss.

```typescript
class SSGStrategy implements RenderStrategy {
  constructor(staticDir?: string)  // default: join(cwd(), "dist", "static")
  render(ctx: RenderStrategyContext): Promise<RenderStrategyResult>
}
```

- **HIT**: Pre-rendered file found at `dist/static/{path}/index.html` — returns instantly
- **MISS**: File not found — delegates to `SSRStrategy.render()` for on-demand rendering

---

### urlToFilePath(url, staticDir)

Maps a URL path to its pre-rendered HTML file path.

```typescript
function urlToFilePath(url: string, staticDir: string): string
```

| URL | File path |
|-----|-----------|
| `/` | `{staticDir}/index.html` |
| `/about` | `{staticDir}/about/index.html` |
| `/blog/123` | `{staticDir}/blog/123/index.html` |

Strips query strings and hash fragments before mapping.

---

### generateStaticParams

Page-level export for SSG pages with dynamic route parameters. Returns the list of param sets to pre-render at build time.

```typescript
// Export from a .page.tsx file with renderMode = "ssg"
export const renderMode = "ssg";
export async function generateStaticParams(): Promise<Array<Record<string, string>>> {
  return [{ id: "1" }, { id: "2" }, { id: "3" }];
}
```

Required when an SSG page has dynamic params (e.g. `[id].page.tsx`). Static SSG pages (no params) don't need it.

---

### createStrategy(mode, opts?)

Factory function to create a render strategy instance.

```typescript
function createStrategy(mode: RenderMode, opts?: { staticDir?: string }): RenderStrategy
```

When `mode` is `"ssg"`, pass `opts.staticDir` to override the default static file directory.

---

### renderPartialStream(options)

Render a page and its inner layouts without the document shell. Used for client-side navigation payloads.

```typescript
function renderPartialStream(options: RenderPageOptions): Promise<RenderStreamResult>
```

---

## @zauso-ai/capstan-react/client

Client-side SPA router, navigation primitives, and prefetching. Import from the `/client` subpath.

```typescript
import { Link, useNavigate, useRouterState, bootstrapClient } from "@zauso-ai/capstan-react/client";
```

---

### Link

Navigation link component that renders a standard `<a>` tag with SPA interception.

```typescript
function Link(props: LinkProps): ReactElement

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  prefetch?: PrefetchStrategy;  // default: "hover"
  replace?: boolean;
  scroll?: boolean;             // default: true
}
```

**Usage:**

```typescript
<Link href="/about">About</Link>
<Link href="/posts" prefetch="viewport">Posts</Link>
<Link href="/settings" replace>Settings</Link>
```

---

### CapstanRouter

Core router class that manages client-side navigation state.

```typescript
class CapstanRouter {
  readonly state: RouterState;
  navigate(url: string, opts?: NavigateOptions): Promise<void>;
  prefetch(url: string): Promise<void>;
  subscribe(listener: (state: RouterState) => void): () => void;
  destroy(): void;
}
```

Access via singleton:

```typescript
import { getRouter, initRouter } from "@zauso-ai/capstan-react/client";

const router = getRouter();           // null if not initialized
const router = initRouter(manifest);  // create singleton
```

---

### NavigationProvider

React context provider that bridges the imperative router with React components.

```typescript
function NavigationProvider(props: {
  children: ReactNode;
  initialLoaderData?: unknown;
  initialParams?: Record<string, string>;
  initialAuth?: { isAuthenticated: boolean; type: string };
}): ReactElement
```

Listens for `capstan:navigate` CustomEvents and updates `PageContext` so `useLoaderData()` and `useParams()` reflect the current route.

---

### useRouterState()

React hook that returns the current router state. Re-renders when state changes.

```typescript
function useRouterState(): RouterState

interface RouterState {
  url: string;
  status: RouterStatus;  // "idle" | "loading" | "error"
  error?: Error;
}
```

---

### useNavigate()

React hook that returns a navigation function.

```typescript
function useNavigate(): (url: string, opts?: { replace?: boolean; scroll?: boolean }) => void
```

---

### bootstrapClient()

Initialize the client router. Reads `window.__CAPSTAN_MANIFEST__`, creates the router singleton, and sets up global `<a>` click delegation.

```typescript
function bootstrapClient(): void
```

---

### NavigationCache

LRU cache for navigation payloads.

```typescript
class NavigationCache {
  constructor(maxSize?: number, ttlMs?: number);  // defaults: 50, 5min
  get(url: string): NavigationPayload | undefined;
  set(url: string, payload: NavigationPayload): void;
  has(url: string): boolean;
  delete(url: string): boolean;
  clear(): void;
  readonly size: number;
}
```

---

### PrefetchManager

Manages link prefetching via IntersectionObserver and pointer events.

```typescript
class PrefetchManager {
  observe(element: Element, strategy: PrefetchStrategy): void;
  unobserve(element: Element): void;
  destroy(): void;
}
```

Strategies: `"viewport"` (IntersectionObserver, 200px margin), `"hover"` (80ms delay), `"none"`.

---

### withViewTransition(fn)

Wrap DOM mutations in the View Transitions API when supported. Falls back to direct execution.

```typescript
function withViewTransition(fn: () => void | Promise<void>): Promise<void>
```

---

### Client Types

```typescript
type RouterStatus = "idle" | "loading" | "error";
type PrefetchStrategy = "none" | "hover" | "viewport";

interface ClientMetadata {
  title?: string;
  description?: string;
  keywords?: string[];
  robots?: string | { index?: boolean; follow?: boolean };
  canonical?: string;
  openGraph?: Record<string, unknown>;
  twitter?: Record<string, unknown>;
  icons?: Record<string, unknown>;
  alternates?: Record<string, string>;
}

interface NavigationPayload {
  url: string;
  layoutKey: string;
  html?: string;
  loaderData: unknown;
  metadata?: ClientMetadata;
  componentType: "server" | "client";
}

interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
  scroll?: boolean;
  noCache?: boolean;
}

interface ClientRouteEntry {
  urlPattern: string;
  componentType: "server" | "client";
  layouts: string[];
}

interface ClientRouteManifest {
  routes: ClientRouteEntry[];
}

interface NavigateEventDetail {
  url: string;
  loaderData: unknown;
  params: Record<string, string>;
  metadata?: ClientMetadata;
}
```

---

### Manifest Utilities

```typescript
function getManifest(): ClientRouteManifest | null;
function matchRoute(manifest: ClientRouteManifest, pathname: string): { route: ClientRouteEntry; params: Record<string, string> } | null;
function findSharedLayout(from: string | undefined, to: string): string;
```

---

### Scroll Utilities

```typescript
function generateScrollKey(): string;
function setCurrentScrollKey(key: string): void;
function saveScrollPosition(): void;
function restoreScrollPosition(key: string | null): boolean;
function scrollToTop(): void;
```

---

## @zauso-ai/capstan-dev

Development server, Vite build pipeline, and deployment adapters.

### createViteConfig(config)

Generate a Vite configuration object for client-side builds. Vite is an optional peer dependency.

```typescript
function createViteConfig(config: CapstanViteConfig): Record<string, unknown>

interface CapstanViteConfig {
  rootDir: string;
  isDev: boolean;
  clientEntry?: string; // default: "app/client.tsx"
}
```

---

### createViteDevMiddleware(config)

Create a Vite dev server in middleware mode for HMR during development. Returns `null` if Vite is not installed.

```typescript
function createViteDevMiddleware(config: CapstanViteConfig): Promise<{
  middleware: unknown;
  close: () => Promise<void>;
} | null>
```

---

### buildClient(config)

Run a production Vite build for client-side code. Silently skips if Vite is not installed.

```typescript
function buildClient(config: CapstanViteConfig): Promise<void>
```

---

### buildStaticPages(options)

Pre-render SSG pages at build time. For each page route with `renderMode === "ssg"`: static routes render once, dynamic routes call `generateStaticParams()` and render for each param set.

```typescript
function buildStaticPages(options: BuildStaticOptions): Promise<BuildStaticResult>

interface BuildStaticOptions {
  rootDir: string;       // Project root directory
  outputDir: string;     // Output dir for pre-rendered files (e.g. dist/static)
  manifest: RouteManifest; // From scanRoutes() — file paths point to compiled .js
}

interface BuildStaticResult {
  pages: number;         // Successfully pre-rendered page count
  paths: string[];       // Pre-rendered URL paths (e.g. ["/about", "/blog/1"])
  errors: string[];      // Errors encountered during rendering
}
```

Output files: `{outputDir}/{path}/index.html` for each page, plus `_ssg_manifest.json` listing all pre-rendered paths.

Called automatically by `capstan build --static`.

---

### createCloudflareHandler(app)

Create a Cloudflare Workers module-format handler from a Capstan/Hono app.

```typescript
function createCloudflareHandler(app: {
  fetch: (req: Request) => Promise<Response>;
}): {
  fetch(request: Request, env: Record<string, unknown>, ctx: { waitUntil: (p: Promise<unknown>) => void }): Promise<Response>;
}
```

**Usage:**

```typescript
import { createCloudflareHandler } from "@zauso-ai/capstan-dev";

const handler = createCloudflareHandler(app);
export default handler;
```

---

### generateWranglerConfig(name)

Generate a `wrangler.toml` configuration string for Cloudflare Workers deployment.

```typescript
function generateWranglerConfig(name: string): string
```

---

### createVercelHandler(app)

Create a Vercel Edge Function handler.

```typescript
function createVercelHandler(app: {
  fetch: (req: Request) => Promise<Response>;
}): (req: Request) => Promise<Response>
```

---

### createVercelNodeHandler(app)

Create a Vercel Node.js serverless function handler. Converts Node.js `IncomingMessage`/`ServerResponse` to Web API `Request`/`Response`.

```typescript
function createVercelNodeHandler(app: {
  fetch: (req: Request) => Promise<Response>;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>
```

---

### createFlyAdapter(config?)

Create a server adapter for Fly.io with optional write replay support. When enabled, mutating requests from non-primary regions return `409` with a `fly-replay` header.

```typescript
function createFlyAdapter(config?: FlyConfig): ServerAdapter

interface FlyConfig {
  primaryRegion?: string;
  replayWrites?: boolean;
}
```

---

### createDevServer(config)

Create and start a development server with file watching and live reload.

```typescript
function createDevServer(config: DevServerConfig): Promise<DevServerInstance>

interface DevServerConfig {
  port?: number;
  appRoot?: string;
}

interface DevServerInstance {
  close: () => void;
}
```

---

### watchRoutes(routesDir, callback)

Watch a routes directory for changes and invoke a callback on file changes.

```typescript
function watchRoutes(
  routesDir: string,
  callback: () => void,
): void
```

---

### loadRouteModule(filePath)

Dynamically import a route module, bypassing cache for hot reload.

```typescript
function loadRouteModule(filePath: string): Promise<unknown>
```

---

### loadApiHandlers(filePath)

Load API handler exports (GET, POST, PUT, DELETE, PATCH) from a route file.

```typescript
function loadApiHandlers(filePath: string): Promise<Record<string, APIDefinition>>
```

---

### loadPageModule(filePath)

Load a page module (default export component + optional loader).

```typescript
function loadPageModule(filePath: string): Promise<PageModule>
```

---

### printStartupBanner(config)

Print the dev server startup banner with port and available endpoints.

```typescript
function printStartupBanner(config: { port: number; routes: number }): void
```

---

## create-capstan-app

Project scaffolder CLI.

### CLI Usage

```bash
# Interactive mode
npx create-capstan-app@beta

# With project name (prompts for template)
npx create-capstan-app@beta my-app

# Fully non-interactive
npx create-capstan-app@beta my-app --template blank
npx create-capstan-app@beta my-app --template tickets

# Help
npx create-capstan-app@beta --help
```

### Templates

| Template  | Includes                                                                            |
| --------- | ----------------------------------------------------------------------------------- |
| `blank`   | Health check API, home page, root layout, requireAuth policy, AGENTS.md             |
| `tickets` | Everything in blank + Ticket model, CRUD routes, auth config, database config        |

### scaffoldProject(config)

Programmatic API for the scaffolder.

```typescript
function scaffoldProject(config: {
  projectName: string;
  template: "blank" | "tickets";
  outputDir: string;
}): Promise<void>
```

import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function ApiReferencePage() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "API Reference"),
    createElement("p", null,
      "Complete reference for every public export across all Capstan packages. This is the authoritative source for function signatures, types, interfaces, and CLI commands."
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-core
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-core" }, "@zauso-ai/capstan-core"),
    createElement("p", null,
      "The core framework package. Provides the server, routing primitives, policy engine, approval workflow, and application verifier."
    ),

    // defineAPI
    createElement("h3", { id: "defineAPI" }, "defineAPI(def)"),
    createElement("p", null,
      "Define a typed API route handler with input/output validation and agent introspection."
    ),
    createElement("pre", null,
      createElement("code", null,
        "function defineAPI<TInput = unknown, TOutput = unknown>(\n" +
        "  def: APIDefinition<TInput, TOutput>,\n" +
        "): APIDefinition<TInput, TOutput>"
      )
    ),
    createElement("p", null, "Parameters:"),
    createElement("pre", null,
      createElement("code", null,
        "interface APIDefinition<TInput = unknown, TOutput = unknown> {\n" +
        "  input?: z.ZodType<TInput>;\n" +
        "  output?: z.ZodType<TOutput>;\n" +
        "  description?: string;\n" +
        '  capability?: "read" | "write" | "external";\n' +
        "  resource?: string;\n" +
        "  policy?: string;\n" +
        "  handler: (args: { input: TInput; ctx: CapstanContext }) => Promise<TOutput>;\n" +
        "}"
      )
    ),
    createElement("p", null,
      "The handler is wrapped to validate input (before) and output (after) against the provided Zod schemas. The definition is registered in a global registry for agent manifest generation."
    ),

    // defineConfig
    createElement("h3", { id: "defineConfig" }, "defineConfig(config)"),
    createElement("p", null,
      "Identity function that provides type-checking and editor auto-complete for the app configuration."
    ),
    createElement("pre", null,
      createElement("code", null,
        "function defineConfig(config: CapstanConfig): CapstanConfig"
      )
    ),
    createElement("p", null, "CapstanConfig:"),
    createElement("pre", null,
      createElement("code", null,
        "interface CapstanConfig {\n" +
        "  app?: {\n" +
        "    name?: string;\n" +
        "    title?: string;\n" +
        "    description?: string;\n" +
        "  };\n" +
        "  database?: {\n" +
        '    provider?: "sqlite" | "postgres" | "mysql";\n' +
        "    url?: string;\n" +
        "  };\n" +
        "  auth?: {\n" +
        "    providers?: Array<{ type: string; [key: string]: unknown }>;\n" +
        "    session?: {\n" +
        '      strategy?: "jwt" | "database";\n' +
        "      secret?: string;\n" +
        "      maxAge?: string;\n" +
        "    };\n" +
        "  };\n" +
        "  agent?: {\n" +
        "    manifest?: boolean;\n" +
        "    mcp?: boolean;\n" +
        "    openapi?: boolean;\n" +
        "    rateLimit?: {\n" +
        "      default?: { requests: number; window: string };\n" +
        "      perAgent?: boolean;\n" +
        "    };\n" +
        "  };\n" +
        "  server?: {\n" +
        "    port?: number;\n" +
        "    host?: string;\n" +
        "  };\n" +
        "}"
      )
    ),

    // defineMiddleware
    createElement("h3", { id: "defineMiddleware" }, "defineMiddleware(def)"),
    createElement("p", null,
      "Define a middleware for the request pipeline. Accepts either a full definition object or a bare handler function."
    ),
    createElement("pre", null,
      createElement("code", null,
        "function defineMiddleware(\n" +
        "  def: MiddlewareDefinition | MiddlewareDefinition[\"handler\"],\n" +
        "): MiddlewareDefinition\n" +
        "\n" +
        "interface MiddlewareDefinition {\n" +
        "  name?: string;\n" +
        "  handler: (args: {\n" +
        "    request: Request;\n" +
        "    ctx: CapstanContext;\n" +
        "    next: () => Promise<Response>;\n" +
        "  }) => Promise<Response>;\n" +
        "}"
      )
    ),

    // definePolicy
    createElement("h3", { id: "definePolicy" }, "definePolicy(def)"),
    createElement("p", null, "Define a named permission policy."),
    createElement("pre", null,
      createElement("code", null,
        "function definePolicy(def: PolicyDefinition): PolicyDefinition\n" +
        "\n" +
        "interface PolicyDefinition {\n" +
        "  key: string;\n" +
        "  title: string;\n" +
        "  effect: PolicyEffect;\n" +
        "  check: (args: {\n" +
        "    ctx: CapstanContext;\n" +
        "    input?: unknown;\n" +
        "  }) => Promise<PolicyCheckResult>;\n" +
        "}\n" +
        "\n" +
        'type PolicyEffect = "allow" | "deny" | "approve" | "redact";\n' +
        "\n" +
        "interface PolicyCheckResult {\n" +
        "  effect: PolicyEffect;\n" +
        "  reason?: string;\n" +
        "}"
      )
    ),

    // defineRateLimit
    createElement("h3", { id: "defineRateLimit" }, "defineRateLimit(config)"),
    createElement("p", null, "Define rate limiting rules with per-auth-type windows."),
    createElement("pre", null,
      createElement("code", null,
        "function defineRateLimit(config: RateLimitConfig): RateLimitConfig\n" +
        "\n" +
        "interface RateLimitConfig {\n" +
        "  default: { requests: number; window: string };\n" +
        "  perAuthType?: {\n" +
        "    anonymous?: { requests: number; window: string };\n" +
        "    human?: { requests: number; window: string };\n" +
        "    agent?: { requests: number; window: string };\n" +
        "  };\n" +
        "}"
      )
    ),

    // enforcePolicies
    createElement("h3", { id: "enforcePolicies" }, "enforcePolicies(policies, ctx, input?)"),
    createElement("p", null,
      "Run all provided policies and return the most restrictive result. All policies are evaluated (no short-circuiting). Severity order: ", createElement("code", null, "allow < redact < approve < deny"), "."
    ),
    createElement("pre", null,
      createElement("code", null,
        "function enforcePolicies(\n" +
        "  policies: PolicyDefinition[],\n" +
        "  ctx: CapstanContext,\n" +
        "  input?: unknown,\n" +
        "): Promise<PolicyCheckResult>"
      )
    ),

    // env
    createElement("h3", { id: "env" }, "env(key)"),
    createElement("p", null, "Read an environment variable, returning an empty string if not set."),
    createElement("pre", null,
      createElement("code", null,
        "function env(key: string): string"
      )
    ),

    // createCapstanApp
    createElement("h3", { id: "createCapstanApp" }, "createCapstanApp(config)"),
    createElement("p", null, "Build a fully-wired Capstan application backed by a Hono server."),
    createElement("pre", null,
      createElement("code", null,
        "function createCapstanApp(config: CapstanConfig): CapstanApp\n" +
        "\n" +
        "interface CapstanApp {\n" +
        "  app: Hono;\n" +
        "  routeRegistry: RouteMetadata[];\n" +
        "  registerAPI: (\n" +
        "    method: HttpMethod,\n" +
        "    path: string,\n" +
        "    apiDef: APIDefinition,\n" +
        "    policies?: PolicyDefinition[],\n" +
        "  ) => void;\n" +
        "}"
      )
    ),
    createElement("p", null,
      "The returned ", createElement("code", null, "registerAPI"), " method mounts an API definition as an HTTP route and records metadata in ", createElement("code", null, "routeRegistry"), ". The Hono app includes CORS middleware, context injection, approval endpoints, and the agent manifest endpoint at ", createElement("code", null, "/.well-known/capstan.json"), "."
    ),

    // clearAPIRegistry
    createElement("h3", { id: "clearAPIRegistry" }, "clearAPIRegistry()"),
    createElement("p", null, "Clear all entries from the global API registry. Called automatically by ", createElement("code", null, "createCapstanApp()"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function clearAPIRegistry(): void"
      )
    ),

    // getAPIRegistry
    createElement("h3", { id: "getAPIRegistry" }, "getAPIRegistry()"),
    createElement("p", null, "Return all API definitions registered via ", createElement("code", null, "defineAPI()"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function getAPIRegistry(): ReadonlyArray<APIDefinition>"
      )
    ),

    // createContext
    createElement("h3", { id: "createContext" }, "createContext(honoCtx)"),
    createElement("p", null, "Create a ", createElement("code", null, "CapstanContext"), " from a Hono context."),
    createElement("pre", null,
      createElement("code", null,
        "function createContext(honoCtx: HonoContext): CapstanContext"
      )
    ),

    // createCapstanOpsContext
    createElement("h3", { id: "createCapstanOpsContext" }, "createCapstanOpsContext(config)"),
    createElement("p", null,
      "Create the semantic ops context used by the runtime request logger, policy engine, approval flow, and health snapshots."
    ),
    createElement("pre", null,
      createElement("code", null,
        "function createCapstanOpsContext(config?: {\n" +
        "  enabled?: boolean;\n" +
        "  appName?: string;\n" +
        "  source?: string;\n" +
        "  recentWindowMs?: number;\n" +
        "  retentionLimit?: number;\n" +
        "  sink?: {\n" +
        "    recordEvent(event: CapstanOpsEvent): Promise<void> | void;\n" +
        "    close?(): Promise<void> | void;\n" +
        "  };\n" +
        "}): CapstanOpsContext | undefined"
      )
    ),

    // createCapstanOpsRuntime (core)
    createElement("h3", { id: "createCapstanOpsRuntime-core" }, "createCapstanOpsRuntime(config)"),
    createElement("p", null,
      "Create the in-process semantic ops runtime. Records normalized events, derives incidents, emits health snapshots, and can fan out events to sinks."
    ),
    createElement("pre", null,
      createElement("code", null,
        "function createCapstanOpsRuntime(config?: {\n" +
        "  enabled?: boolean;\n" +
        "  appName?: string;\n" +
        "  source?: string;\n" +
        "  recentWindowMs?: number;\n" +
        "  retentionLimit?: number;\n" +
        "}): CapstanOpsRuntime"
      )
    ),

    // Approval Functions
    createElement("h3", { id: "approval-functions" }, "Approval Functions"),
    createElement("pre", null,
      createElement("code", null,
        "// Create a pending approval\n" +
        "function createApproval(opts: {\n" +
        "  method: string;\n" +
        "  path: string;\n" +
        "  input: unknown;\n" +
        "  policy: string;\n" +
        "  reason: string;\n" +
        "}): PendingApproval\n" +
        "\n" +
        "// Get an approval by ID\n" +
        "function getApproval(id: string): PendingApproval | undefined\n" +
        "\n" +
        "// List approvals, optionally filtered by status\n" +
        "function listApprovals(\n" +
        '  status?: "pending" | "approved" | "denied",\n' +
        "): PendingApproval[]\n" +
        "\n" +
        "// Approve or deny a pending approval\n" +
        "function resolveApproval(\n" +
        "  id: string,\n" +
        '  decision: "approved" | "denied",\n' +
        "  resolvedBy?: string,\n" +
        "): PendingApproval | undefined\n" +
        "\n" +
        "// Clear all approvals\n" +
        "function clearApprovals(): void"
      )
    ),
    createElement("p", null, "PendingApproval type:"),
    createElement("pre", null,
      createElement("code", null,
        "interface PendingApproval {\n" +
        "  id: string;\n" +
        "  method: string;\n" +
        "  path: string;\n" +
        "  input: unknown;\n" +
        "  policy: string;\n" +
        "  reason: string;\n" +
        '  status: "pending" | "approved" | "denied";\n' +
        "  createdAt: string;\n" +
        "  resolvedAt?: string;\n" +
        "  resolvedBy?: string;\n" +
        "  result?: unknown;\n" +
        "}"
      )
    ),

    // mountApprovalRoutes
    createElement("h3", { id: "mountApprovalRoutes" }, "mountApprovalRoutes(app, handlerRegistry)"),
    createElement("p", null, "Mount the approval management HTTP endpoints on a Hono app."),
    createElement("pre", null,
      createElement("code", null,
        "function mountApprovalRoutes(\n" +
        "  app: Hono,\n" +
        "  handlerRegistry: HandlerRegistry,\n" +
        "): void"
      )
    ),

    // verifyCapstanApp
    createElement("h3", { id: "verifyCapstanApp" }, "verifyCapstanApp(appRoot)"),
    createElement("p", null, "Run the 7-step verification cascade against a Capstan application."),
    createElement("pre", null,
      createElement("code", null,
        "function verifyCapstanApp(appRoot: string): Promise<VerifyReport>\n" +
        "\n" +
        "interface VerifyReport {\n" +
        '  status: "passed" | "failed";\n' +
        "  appRoot: string;\n" +
        "  timestamp: string;\n" +
        "  steps: VerifyStep[];\n" +
        "  repairChecklist: Array<{\n" +
        "    index: number;\n" +
        "    step: string;\n" +
        "    message: string;\n" +
        "    file?: string;\n" +
        "    line?: number;\n" +
        "    hint?: string;\n" +
        "    fixCategory?: string;\n" +
        "    autoFixable?: boolean;\n" +
        "  }>;\n" +
        "  summary: {\n" +
        "    totalSteps: number;\n" +
        "    passedSteps: number;\n" +
        "    failedSteps: number;\n" +
        "    skippedSteps: number;\n" +
        "    errorCount: number;\n" +
        "    warningCount: number;\n" +
        "  };\n" +
        "}"
      )
    ),

    // renderRuntimeVerifyText
    createElement("h3", { id: "renderRuntimeVerifyText" }, "renderRuntimeVerifyText(report)"),
    createElement("p", null, "Render a ", createElement("code", null, "VerifyReport"), " as human-readable text."),
    createElement("pre", null,
      createElement("code", null,
        "function renderRuntimeVerifyText(report: VerifyReport): string"
      )
    ),

    // definePlugin
    createElement("h3", { id: "definePlugin" }, "definePlugin(def)"),
    createElement("p", null, "Define a reusable plugin that can add routes, policies, and middleware to a Capstan app."),
    createElement("pre", null,
      createElement("code", null,
        "function definePlugin(def: PluginDefinition): PluginDefinition\n" +
        "\n" +
        "interface PluginDefinition {\n" +
        "  name: string;\n" +
        "  version?: string;\n" +
        "  setup: (ctx: PluginSetupContext) => void;\n" +
        "}\n" +
        "\n" +
        "interface PluginSetupContext {\n" +
        "  addRoute: (method: HttpMethod, path: string, handler: APIDefinition) => void;\n" +
        "  addPolicy: (policy: PolicyDefinition) => void;\n" +
        '  addMiddleware: (path: string, handler: MiddlewareDefinition["handler"]) => void;\n' +
        "  config: Readonly<CapstanConfig>;\n" +
        "}"
      )
    ),
    createElement("p", null, "Load plugins via the ", createElement("code", null, "plugins"), " array in ", createElement("code", null, "defineConfig()"), "."),

    // KeyValueStore
    createElement("h3", { id: "KeyValueStore" }, "KeyValueStore<T>"),
    createElement("p", null,
      "Pluggable key-value store interface used by approvals, rate limiting, and DPoP replay detection. Swap the default in-memory store for Redis or any external backend."
    ),
    createElement("pre", null,
      createElement("code", null,
        "interface KeyValueStore<T> {\n" +
        "  get(key: string): Promise<T | undefined>;\n" +
        "  set(key: string, value: T, ttlMs?: number): Promise<void>;\n" +
        "  delete(key: string): Promise<void>;\n" +
        "  has(key: string): Promise<boolean>;\n" +
        "  values(): Promise<T[]>;\n" +
        "  clear(): Promise<void>;\n" +
        "}"
      )
    ),

    // MemoryStore
    createElement("h3", { id: "MemoryStore" }, "MemoryStore"),
    createElement("p", null, "Default in-memory implementation of ", createElement("code", null, "KeyValueStore<T>"), "."),
    createElement("pre", null,
      createElement("code", null,
        "class MemoryStore<T> implements KeyValueStore<T> {\n" +
        "  constructor();\n" +
        "}"
      )
    ),

    // setApprovalStore / setRateLimitStore / setDpopReplayStore / setAuditStore
    createElement("h3", { id: "store-setters" }, "Store Setters"),
    createElement("p", null, "Replace the default in-memory stores with custom ", createElement("code", null, "KeyValueStore"), " implementations."),
    createElement("pre", null,
      createElement("code", null,
        "function setApprovalStore(store: KeyValueStore<PendingApproval>): void\n" +
        "function setRateLimitStore(store: KeyValueStore<RateLimitEntry>): void\n" +
        "function setDpopReplayStore(store: KeyValueStore<boolean>): void\n" +
        "function setAuditStore(store: KeyValueStore<AuditEntry>): void"
      )
    ),

    // RedisStore
    createElement("h3", { id: "RedisStore" }, "RedisStore"),
    createElement("p", null,
      "Redis-backed implementation of ", createElement("code", null, "KeyValueStore<T>"), ". Uses ", createElement("code", null, "ioredis"), " (optional peer dependency). All keys are prefixed with a configurable namespace to avoid collisions."
    ),
    createElement("pre", null,
      createElement("code", null,
        "class RedisStore<T> implements KeyValueStore<T> {\n" +
        '  constructor(redis: any, prefix?: string); // default prefix: "capstan:"\n' +
        "}"
      )
    ),
    createElement("p", null, "Usage:"),
    createElement("pre", null,
      createElement("code", null,
        'import Redis from "ioredis";\n' +
        'import { RedisStore, setApprovalStore, setAuditStore } from "@zauso-ai/capstan-core";\n' +
        "\n" +
        "const redis = new Redis();\n" +
        'setApprovalStore(new RedisStore(redis, "myapp:approvals:"));\n' +
        'setAuditStore(new RedisStore(redis, "myapp:audit:"));'
      )
    ),

    // defineCompliance
    createElement("h3", { id: "defineCompliance" }, "defineCompliance(config)"),
    createElement("p", null, "Declare EU AI Act compliance metadata and enable audit logging."),
    createElement("pre", null,
      createElement("code", null,
        "function defineCompliance(config: ComplianceConfig): void\n" +
        "\n" +
        "interface ComplianceConfig {\n" +
        '  riskLevel: "minimal" | "limited" | "high" | "unacceptable";\n' +
        "  auditLog?: boolean;\n" +
        "  transparency?: {\n" +
        "    description?: string;\n" +
        "    provider?: string;\n" +
        "    contact?: string;\n" +
        "  };\n" +
        "}"
      )
    ),
    createElement("p", null, "When ", createElement("code", null, "auditLog"), " is ", createElement("code", null, "true"), ", every ", createElement("code", null, "defineAPI()"), " handler invocation is automatically recorded. The audit log is served at ", createElement("code", null, "GET /capstan/audit"), "."),

    // recordAuditEntry
    createElement("h3", { id: "recordAuditEntry" }, "recordAuditEntry(entry)"),
    createElement("p", null, "Manually record a custom audit log entry."),
    createElement("pre", null,
      createElement("code", null,
        "function recordAuditEntry(entry: {\n" +
        "  action: string;\n" +
        "  authType?: string;\n" +
        "  userId?: string;\n" +
        "  resource?: string;\n" +
        "  detail?: unknown;\n" +
        "}): void"
      )
    ),

    // getAuditLog
    createElement("h3", { id: "getAuditLog" }, "getAuditLog(filter?)"),
    createElement("p", null, "Retrieve audit log entries, optionally filtered."),
    createElement("pre", null,
      createElement("code", null,
        "function getAuditLog(filter?: {\n" +
        "  action?: string;\n" +
        "  authType?: string;\n" +
        "  since?: string;\n" +
        "}): AuditEntry[]"
      )
    ),

    // clearAuditLog
    createElement("h3", { id: "clearAuditLog" }, "clearAuditLog()"),
    createElement("p", null, "Clear all audit log entries (useful in tests)."),
    createElement("pre", null,
      createElement("code", null,
        "function clearAuditLog(): void"
      )
    ),

    // defineWebSocket
    createElement("h3", { id: "defineWebSocket" }, "defineWebSocket(path, handler)"),
    createElement("p", null, "Define a WebSocket route handler for real-time bidirectional communication."),
    createElement("pre", null,
      createElement("code", null,
        "function defineWebSocket(\n" +
        "  path: string,\n" +
        "  handler: WebSocketHandler,\n" +
        "): WebSocketRoute\n" +
        "\n" +
        "interface WebSocketHandler {\n" +
        "  onOpen?: (ws: WebSocketClient) => void;\n" +
        "  onMessage?: (ws: WebSocketClient, message: string | ArrayBuffer) => void;\n" +
        "  onClose?: (ws: WebSocketClient, code: number, reason: string) => void;\n" +
        "  onError?: (ws: WebSocketClient, error: Error) => void;\n" +
        "}\n" +
        "\n" +
        "interface WebSocketClient {\n" +
        "  send(data: string | ArrayBuffer): void;\n" +
        "  close(code?: number, reason?: string): void;\n" +
        "  readonly readyState: number;\n" +
        "}\n" +
        "\n" +
        "interface WebSocketRoute {\n" +
        "  path: string;\n" +
        "  handler: WebSocketHandler;\n" +
        "}"
      )
    ),
    createElement("p", null, "Usage:"),
    createElement("pre", null,
      createElement("code", null,
        'import { defineWebSocket } from "@zauso-ai/capstan-core";\n' +
        "\n" +
        'export const chat = defineWebSocket("/ws/chat", {\n' +
        '  onOpen(ws) { console.log("client connected"); },\n' +
        "  onMessage(ws, message) { ws.send(`echo: ${message}`); },\n" +
        '  onClose(ws, code, reason) { console.log("disconnected", code); },\n' +
        "});"
      )
    ),

    // WebSocketRoom
    createElement("h3", { id: "WebSocketRoom" }, "WebSocketRoom"),
    createElement("p", null, "Pub/sub room for broadcasting messages across connected clients."),
    createElement("pre", null,
      createElement("code", null,
        "class WebSocketRoom {\n" +
        "  join(client: WebSocketClient): void;\n" +
        "  leave(client: WebSocketClient): void;\n" +
        "  broadcast(message: string, exclude?: WebSocketClient): void;\n" +
        "  get size(): number;\n" +
        "  close(): void;\n" +
        "}"
      )
    ),
    createElement("p", null, "Usage:"),
    createElement("pre", null,
      createElement("code", null,
        'import { defineWebSocket, WebSocketRoom } from "@zauso-ai/capstan-core";\n' +
        "\n" +
        "const lobby = new WebSocketRoom();\n" +
        "\n" +
        'export const ws = defineWebSocket("/ws/lobby", {\n' +
        "  onOpen(ws) { lobby.join(ws); },\n" +
        "  onMessage(ws, msg) { lobby.broadcast(String(msg), ws); },\n" +
        "  onClose(ws) { lobby.leave(ws); },\n" +
        "});"
      )
    ),

    // Cache functions
    createElement("h3", { id: "cacheSet" }, "cacheSet(key, data, opts?)"),
    createElement("p", null, "Store a value in the cache with optional TTL, tags, and ISR revalidation."),
    createElement("pre", null,
      createElement("code", null,
        "function cacheSet<T>(key: string, data: T, opts?: CacheOptions): Promise<void>\n" +
        "\n" +
        "interface CacheOptions {\n" +
        "  ttl?: number;        // Time-to-live in seconds\n" +
        "  tags?: string[];     // Cache tags for bulk invalidation\n" +
        "  revalidate?: number; // Revalidate interval in seconds (ISR)\n" +
        "}"
      )
    ),

    createElement("h3", { id: "cacheGet" }, "cacheGet(key)"),
    createElement("p", null, "Retrieve a cached value. Returns ", createElement("code", null, "undefined"), " on miss. Supports stale-while-revalidate when ", createElement("code", null, "revalidate"), " was set."),
    createElement("pre", null,
      createElement("code", null,
        "function cacheGet<T>(key: string): Promise<T | undefined>"
      )
    ),

    createElement("h3", { id: "cacheInvalidateTag" }, "cacheInvalidateTag(tag)"),
    createElement("p", null, "Invalidate all cache entries associated with a tag. Also invalidates response cache entries with the same tag (cross-invalidation)."),
    createElement("pre", null,
      createElement("code", null,
        "function cacheInvalidateTag(tag: string): Promise<void>"
      )
    ),

    createElement("h3", { id: "cached" }, "cached(fn, opts?)"),
    createElement("p", null, "Stale-while-revalidate decorator. Wraps an async function with caching. Subsequent calls return the cached value until TTL expires, then revalidate in the background."),
    createElement("pre", null,
      createElement("code", null,
        "function cached<T>(\n" +
        "  fn: () => Promise<T>,\n" +
        "  opts?: CacheOptions & { key?: string },\n" +
        "): () => Promise<T>"
      )
    ),

    createElement("h3", { id: "setCacheStore" }, "setCacheStore(store)"),
    createElement("p", null, "Replace the default in-memory cache store with a custom ", createElement("code", null, "KeyValueStore"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function setCacheStore(store: KeyValueStore<CacheEntry<unknown>>): void"
      )
    ),

    // Response Cache
    createElement("h3", { id: "response-cache" }, "Response Cache"),
    createElement("p", null, "Full-page response cache used by ISR render strategies."),
    createElement("pre", null,
      createElement("code", null,
        "interface ResponseCacheEntry {\n" +
        "  html: string;\n" +
        "  headers: Record<string, string>;\n" +
        "  statusCode: number;\n" +
        "  createdAt: number;\n" +
        "  revalidateAfter: number | null;\n" +
        "  tags: string[];\n" +
        "}\n" +
        "\n" +
        "function responseCacheGet(key: string): Promise<{ entry: ResponseCacheEntry; stale: boolean } | undefined>\n" +
        "function responseCacheSet(key: string, entry: ResponseCacheEntry, opts?: { ttlMs?: number }): Promise<void>\n" +
        "function responseCacheInvalidateTag(tag: string): Promise<number>\n" +
        "function responseCacheInvalidate(key: string): Promise<boolean>\n" +
        "function responseCacheClear(): Promise<void>\n" +
        "function setResponseCacheStore(store: KeyValueStore<ResponseCacheEntry>): void"
      )
    ),

    // csrfProtection
    createElement("h3", { id: "csrfProtection" }, "csrfProtection"),
    createElement("p", null, "Hono middleware that enforces Double Submit Cookie CSRF protection on state-changing requests (POST/PUT/DELETE/PATCH). Issues fresh tokens on safe requests."),
    createElement("pre", null,
      createElement("code", null,
        "function csrfProtection(): MiddlewareHandler"
      )
    ),

    // createRequestLogger
    createElement("h3", { id: "createRequestLogger" }, "createRequestLogger"),
    createElement("p", null, "Create structured JSON request logging middleware. Respects ", createElement("code", null, "LOG_LEVEL"), " env var (debug/info/warn/error)."),
    createElement("pre", null,
      createElement("code", null,
        "function createRequestLogger(): MiddlewareHandler"
      )
    ),

    // Cache Utilities
    createElement("h3", { id: "cache-utilities" }, "Cache Utilities"),
    createElement("pre", null,
      createElement("code", null,
        "function cacheInvalidate(key: string): void\n" +
        "function cacheInvalidatePath(urlPath: string): void\n" +
        "function cacheClear(): void\n" +
        "function responseCacheInvalidatePath(urlPath: string): void\n" +
        "function normalizeCacheTag(tag: string): string | undefined\n" +
        "function normalizeCacheTags(tags: string[]): string[]\n" +
        "function normalizeCachePath(urlOrPath: string): string\n" +
        'function createPageCacheKey(urlPath: string): string  // prefixed with "page:"'
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-ops
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-ops" }, "@zauso-ai/capstan-ops"),
    createElement("p", null, "Semantic operations kernel used by the runtime and CLI."),

    // createCapstanOpsRuntime (ops)
    createElement("h3", { id: "createCapstanOpsRuntime-ops" }, "createCapstanOpsRuntime(options)"),
    createElement("p", null, "Create the persistent ops runtime that records events, incidents, and health snapshots into an ", createElement("code", null, "OpsStore"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function createCapstanOpsRuntime(options: {\n" +
        "  store: OpsStore;\n" +
        "  serviceName?: string;\n" +
        "  environment?: string;\n" +
        "}): {\n" +
        "  recordEvent(input: OpsRecordEventInput): Promise<OpsEventRecord>;\n" +
        "  recordIncident(input: OpsRecordIncidentInput): Promise<OpsIncidentRecord>;\n" +
        "  captureSnapshot(input: OpsCaptureSnapshotInput): Promise<OpsSnapshotRecord>;\n" +
        "  captureDerivedSnapshot(timestamp?: string): Promise<OpsSnapshotRecord>;\n" +
        "  createOverview(): OpsOverview;\n" +
        "}"
      )
    ),

    // InMemoryOpsStore
    createElement("h3", { id: "InMemoryOpsStore" }, "InMemoryOpsStore"),
    createElement("pre", null,
      createElement("code", null,
        "class InMemoryOpsStore implements OpsStore {\n" +
        "  constructor(options?: {\n" +
        "    retention?: OpsRetentionConfig;\n" +
        "    eventRetentionMs?: number;\n" +
        "    incidentRetentionMs?: number;\n" +
        "    snapshotRetentionMs?: number;\n" +
        "  });\n" +
        "}"
      )
    ),

    // SqliteOpsStore
    createElement("h3", { id: "SqliteOpsStore" }, "SqliteOpsStore"),
    createElement("p", null, "Persists structured ops data at ", createElement("code", null, ".capstan/ops/ops.db"), ". The CLI inspects it with ", createElement("code", null, "ops:events"), ", ", createElement("code", null, "ops:incidents"), ", ", createElement("code", null, "ops:health"), ", and ", createElement("code", null, "ops:tail"), "."),
    createElement("pre", null,
      createElement("code", null,
        "class SqliteOpsStore implements OpsStore {\n" +
        "  constructor(options: {\n" +
        "    path: string;\n" +
        "    retention?: OpsRetentionConfig;\n" +
        "  });\n" +
        "}"
      )
    ),

    // createOpsQuery
    createElement("h3", { id: "createOpsQuery" }, "createOpsQuery(store)"),
    createElement("p", null, "Create a query interface for filtering events, incidents, and snapshots."),
    createElement("pre", null,
      createElement("code", null,
        "function createOpsQuery(store: OpsStore): {\n" +
        "  events(filter?: OpsEventFilter): OpsEventRecord[];\n" +
        "  incidents(filter?: OpsIncidentFilter): OpsIncidentRecord[];\n" +
        "  snapshots(filter?: OpsSnapshotFilter): OpsSnapshotRecord[];\n" +
        "}"
      )
    ),

    // createOpsQueryIndex
    createElement("h3", { id: "createOpsQueryIndex" }, "createOpsQueryIndex(store)"),
    createElement("p", null, "Build an index of aggregate statistics from store contents."),
    createElement("pre", null,
      createElement("code", null,
        "function createOpsQueryIndex(store: OpsStore): OpsQueryIndex\n" +
        "\n" +
        "interface OpsQueryIndex {\n" +
        "  totalEvents: number;\n" +
        "  totalIncidents: number;\n" +
        "  totalSnapshots: number;\n" +
        "  eventsBySeverity: Record<string, number>;\n" +
        "  eventsByStatus: Record<string, number>;\n" +
        "  incidentsBySeverity: Record<string, number>;\n" +
        "  incidentsByStatus: Record<string, number>;\n" +
        "  snapshotsByHealth: Record<string, number>;\n" +
        "}"
      )
    ),

    // createOpsOverview
    createElement("h3", { id: "createOpsOverview" }, "createOpsOverview(query, index)"),
    createElement("p", null, "Generate a complete operational overview from query results and index."),
    createElement("pre", null,
      createElement("code", null,
        "function createOpsOverview(\n" +
        "  query: ReturnType<typeof createOpsQuery>,\n" +
        "  index: OpsQueryIndex,\n" +
        "): OpsOverview\n" +
        "\n" +
        "interface OpsOverview {\n" +
        "  totals: { events: number; incidents: number; snapshots: number };\n" +
        "  incidents: { open: number; acknowledged: number; resolved: number };\n" +
        "  health: OpsHealthStatus;\n" +
        "  recentWindows: { events: OpsEventRecord[]; incidents: OpsIncidentRecord[] };\n" +
        "  index: OpsQueryIndex;\n" +
        "}"
      )
    ),

    // deriveOpsHealthStatus
    createElement("h3", { id: "deriveOpsHealthStatus" }, "deriveOpsHealthStatus(store, options?)"),
    createElement("p", null, "Derive health status from recent events and incidents."),
    createElement("pre", null,
      createElement("code", null,
        "function deriveOpsHealthStatus(\n" +
        "  store: OpsStore,\n" +
        "  options?: { windowMs?: number },\n" +
        "): {\n" +
        "  status: OpsHealthStatus;\n" +
        "  summary: string;\n" +
        "  signals: OpsHealthSignal[];\n" +
        "}\n" +
        "\n" +
        'type OpsHealthStatus = "healthy" | "degraded" | "unhealthy";'
      )
    ),

    // Ops Types
    createElement("h3", { id: "ops-types" }, "Ops Types"),
    createElement("pre", null,
      createElement("code", null,
        'type OpsSeverity = "debug" | "info" | "warning" | "error" | "critical";\n' +
        'type OpsIncidentStatus = "open" | "acknowledged" | "suppressed" | "resolved";\n' +
        'type OpsTarget = "runtime" | "release" | "approval" | "policy"\n' +
        '  | "capability" | "cron" | "ops" | "cli";\n' +
        "\n" +
        "interface OpsEventRecord {\n" +
        "  id: string;\n" +
        "  kind: string;\n" +
        "  timestamp: string;\n" +
        "  severity: OpsSeverity;\n" +
        "  status?: string;\n" +
        "  target: OpsTarget;\n" +
        "  scope?: OpsScope;\n" +
        "  title: string;\n" +
        "  summary?: string;\n" +
        "  message?: string;\n" +
        "  fingerprint?: string;\n" +
        "  tags?: string[];\n" +
        "  correlation?: OpsCorrelation;\n" +
        "  metadata?: Record<string, unknown>;\n" +
        "}\n" +
        "\n" +
        "interface OpsIncidentRecord extends OpsEventRecord {\n" +
        "  incidentStatus: OpsIncidentStatus;\n" +
        "  acknowledgedAt?: string;\n" +
        "  resolvedAt?: string;\n" +
        "}\n" +
        "\n" +
        "interface OpsRetentionConfig {\n" +
        "  events?: { maxAgeMs: number };\n" +
        "  incidents?: { maxAgeMs: number };\n" +
        "  snapshots?: { maxAgeMs: number };\n" +
        "}\n" +
        "\n" +
        "interface OpsEventFilter {\n" +
        "  ids?: string[];\n" +
        "  kinds?: string[];\n" +
        "  severities?: OpsSeverity[];\n" +
        "  statuses?: string[];\n" +
        "  targets?: OpsTarget[];\n" +
        "  tags?: string[];\n" +
        "  scopes?: OpsScopeFilter[];\n" +
        "  from?: string;\n" +
        "  to?: string;\n" +
        '  sort?: "asc" | "desc";\n' +
        "  limit?: number;\n" +
        "}\n" +
        "\n" +
        "interface OpsStore {\n" +
        "  addEvent(record: OpsEventRecord): OpsEventRecord;\n" +
        "  getEvent(id: string): OpsEventRecord | undefined;\n" +
        "  listEvents(filter?: OpsEventFilter): OpsEventRecord[];\n" +
        "  addIncident(record: OpsIncidentRecord): OpsIncidentRecord;\n" +
        "  getIncident(id: string): OpsIncidentRecord | undefined;\n" +
        "  getIncidentByFingerprint(fingerprint: string): OpsIncidentRecord | undefined;\n" +
        "  listIncidents(filter?: OpsIncidentFilter): OpsIncidentRecord[];\n" +
        "  addSnapshot(record: OpsSnapshotRecord): OpsSnapshotRecord;\n" +
        "  listSnapshots(filter?: OpsSnapshotFilter): OpsSnapshotRecord[];\n" +
        "  compact(options?: OpsCompactionOptions): OpsCompactionResult;\n" +
        "  close(): void | Promise<void>;\n" +
        "}"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-agent — LLM Providers
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-agent-llm" }, "@zauso-ai/capstan-agent — LLM Providers"),
    createElement("p", null, "Built-in LLM provider adapters for chat completion and streaming."),

    // openaiProvider
    createElement("h3", { id: "openaiProvider" }, "openaiProvider(config)"),
    createElement("p", null, "Create an OpenAI-compatible LLM provider. Works with any OpenAI-compatible API (OpenAI, Azure OpenAI, Ollama, etc.) by setting ", createElement("code", null, "baseUrl"), ". Supports both ", createElement("code", null, "chat()"), " and ", createElement("code", null, "stream()"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function openaiProvider(config: {\n" +
        "  apiKey: string;\n" +
        '  baseUrl?: string;  // default: "https://api.openai.com/v1"\n' +
        '  model?: string;    // default: "gpt-4o"\n' +
        "}): LLMProvider"
      )
    ),

    // anthropicProvider
    createElement("h3", { id: "anthropicProvider" }, "anthropicProvider(config)"),
    createElement("p", null, "Create an Anthropic LLM provider. Supports ", createElement("code", null, "chat()"), ". System prompts are extracted from messages and sent via the Anthropic ", createElement("code", null, "system"), " parameter."),
    createElement("pre", null,
      createElement("code", null,
        "function anthropicProvider(config: {\n" +
        "  apiKey: string;\n" +
        '  model?: string;    // default: "claude-sonnet-4-20250514"\n' +
        '  baseUrl?: string;  // default: "https://api.anthropic.com/v1"\n' +
        "}): LLMProvider"
      )
    ),

    // LLM Types
    createElement("h3", { id: "llm-types" }, "LLM Types"),
    createElement("pre", null,
      createElement("code", null,
        "interface LLMMessage {\n" +
        '  role: "system" | "user" | "assistant";\n' +
        "  content: string;\n" +
        "}\n" +
        "\n" +
        "interface LLMResponse {\n" +
        "  content: string;\n" +
        "  model: string;\n" +
        "  usage?: {\n" +
        "    promptTokens: number;\n" +
        "    completionTokens: number;\n" +
        "    totalTokens: number;\n" +
        "  };\n" +
        "  finishReason?: string;\n" +
        "}\n" +
        "\n" +
        "interface LLMStreamChunk {\n" +
        "  content: string;\n" +
        "  done: boolean;\n" +
        "}\n" +
        "\n" +
        "interface LLMOptions {\n" +
        "  model?: string;\n" +
        "  temperature?: number;\n" +
        "  maxTokens?: number;\n" +
        "  systemPrompt?: string;\n" +
        "  responseFormat?: Record<string, unknown>;\n" +
        "}\n" +
        "\n" +
        "interface LLMProvider {\n" +
        "  name: string;\n" +
        "  chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;\n" +
        "  stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>;\n" +
        "}"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-ai
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-ai" }, "@zauso-ai/capstan-ai"),
    createElement("p", null, "Standalone AI toolkit. Works independently or with the Capstan framework, including browser/filesystem harness mode."),

    // createAI
    createElement("h3", { id: "createAI" }, "createAI(config)"),
    createElement("p", null, "Factory function that creates a standalone AI instance with all capabilities. No Capstan framework required."),
    createElement("pre", null,
      createElement("code", null,
        "function createAI(config: AIConfig): AIContext\n" +
        "\n" +
        "interface AIConfig {\n" +
        "  llm: LLMProvider;\n" +
        "  memory?: {\n" +
        "    backend?: MemoryBackend;\n" +
        "    embedding?: { embed(texts: string[]): Promise<number[][]>; dimensions: number };\n" +
        "    autoExtract?: boolean;\n" +
        "  };\n" +
        "  defaultScope?: MemoryScope;\n" +
        "}\n" +
        "\n" +
        "interface AIContext {\n" +
        "  think<T = string>(prompt: string, opts?: ThinkOptions<T>): Promise<T>;\n" +
        "  generate(prompt: string, opts?: GenerateOptions): Promise<string>;\n" +
        "  thinkStream(prompt: string, opts?: Omit<ThinkOptions, \"schema\">): AsyncIterable<string>;\n" +
        "  generateStream(prompt: string, opts?: GenerateOptions): AsyncIterable<string>;\n" +
        "  remember(content: string, opts?: RememberOptions): Promise<string>;\n" +
        "  recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]>;\n" +
        "  memory: {\n" +
        "    about(type: string, id: string): MemoryAccessor;\n" +
        "    forget(entryId: string): Promise<boolean>;\n" +
        "    assembleContext(opts: AssembleContextOptions): Promise<string>;\n" +
        "  };\n" +
        "  agent: {\n" +
        "    run(config: AgentRunConfig): Promise<AgentRunResult>;\n" +
        "  };\n" +
        "}\n" +
        "\n" +
        "interface AgentRunConfig {\n" +
        "  goal: string;\n" +
        "  tools?: AgentTool[];\n" +
        "  tasks?: AgentTask[];\n" +
        "  maxIterations?: number;\n" +
        "  systemPrompt?: string;\n" +
        "}"
      )
    ),
    createElement("p", null, "Usage:"),
    createElement("pre", null,
      createElement("code", null,
        'import { createAI } from "@zauso-ai/capstan-ai";\n' +
        'import { openaiProvider } from "@zauso-ai/capstan-agent";\n' +
        "\n" +
        "const ai = createAI({\n" +
        "  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),\n" +
        "});\n" +
        "\n" +
        "// Structured reasoning with Zod schema\n" +
        'const result = await ai.think("Classify this ticket", {\n' +
        '  schema: z.object({ category: z.string(), priority: z.enum(["low", "medium", "high"]) }),\n' +
        "});\n" +
        "\n" +
        "// Text generation\n" +
        'const summary = await ai.generate("Summarize this document...");'
      )
    ),
    createElement("p", null, "Task helpers are exported directly from ", createElement("code", null, "@zauso-ai/capstan-ai"), ":"),
    createElement("pre", null,
      createElement("code", null,
        "import {\n" +
        "  createShellTask,\n" +
        "  createWorkflowTask,\n" +
        "  createRemoteTask,\n" +
        "  createSubagentTask,\n" +
        '} from "@zauso-ai/capstan-ai";'
      )
    ),

    // createHarness
    createElement("h3", { id: "createHarness" }, "createHarness(config)"),
    createElement("p", null, "Durable harness runtime for long-running agents. Adds browser/filesystem sandboxes, verification hooks, persisted runs/events/artifacts/checkpoints, and runtime lifecycle control on top of ", createElement("code", null, "runAgentLoop()"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function createHarness(config: HarnessConfig): Promise<Harness>\n" +
        "\n" +
        "interface HarnessConfig {\n" +
        "  llm: LLMProvider;\n" +
        "  sandbox?: {\n" +
        "    browser?: boolean | BrowserSandboxConfig;\n" +
        "    fs?: boolean | FsSandboxConfig;\n" +
        "  };\n" +
        "  verify?: {\n" +
        "    enabled?: boolean;\n" +
        "    maxRetries?: number;\n" +
        "    verifier?: HarnessVerifierFn;\n" +
        "  };\n" +
        "  observe?: {\n" +
        "    logger?: HarnessLogger;\n" +
        "    onEvent?: (event: HarnessEvent) => void;\n" +
        "  };\n" +
        "  context?: {\n" +
        "    enabled?: boolean;\n" +
        "    maxPromptTokens?: number;\n" +
        "    reserveOutputTokens?: number;\n" +
        "    maxMemories?: number;\n" +
        "    maxArtifacts?: number;\n" +
        "    maxRecentMessages?: number;\n" +
        "    maxRecentToolResults?: number;\n" +
        "    microcompactToolResultChars?: number;\n" +
        "    sessionCompactThreshold?: number;\n" +
        "    defaultScopes?: MemoryScope[];\n" +
        "    autoPromoteObservations?: boolean;\n" +
        "    autoPromoteSummaries?: boolean;\n" +
        "  };\n" +
        "  runtime?: {\n" +
        "    rootDir?: string;\n" +
        "    maxConcurrentRuns?: number;\n" +
        "    driver?: HarnessSandboxDriver;\n" +
        "    beforeToolCall?: HarnessToolPolicyFn;\n" +
        "    beforeTaskCall?: HarnessTaskPolicyFn;\n" +
        "  };\n" +
        "}\n" +
        "\n" +
        "interface BrowserSandboxConfig {\n" +
        '  engine?: "playwright" | "camoufox";\n' +
        "  platform?: string;\n" +
        "  accountId?: string;\n" +
        '  guardMode?: "vision" | "hybrid";\n' +
        "  headless?: boolean;\n" +
        "  proxy?: string;\n" +
        "  viewport?: { width: number; height: number };\n" +
        "}\n" +
        "\n" +
        "interface FsSandboxConfig {\n" +
        "  rootDir: string;\n" +
        "  allowWrite?: boolean;\n" +
        "  allowDelete?: boolean;\n" +
        "  maxFileSize?: number;\n" +
        "}"
      )
    ),
    createElement("p", null, "Harness instance:"),
    createElement("pre", null,
      createElement("code", null,
        "interface Harness {\n" +
        "  startRun(config: AgentRunConfig): Promise<HarnessRunHandle>;\n" +
        "  run(config: AgentRunConfig): Promise<HarnessRunResult>;\n" +
        "  pauseRun(runId: string): Promise<HarnessRunRecord>;\n" +
        "  cancelRun(runId: string): Promise<HarnessRunRecord>;\n" +
        "  resumeRun(runId: string, options?: HarnessResumeOptions): Promise<HarnessRunResult>;\n" +
        "  getRun(runId: string): Promise<HarnessRunRecord | undefined>;\n" +
        "  listRuns(): Promise<HarnessRunRecord[]>;\n" +
        "  getEvents(runId?: string): Promise<HarnessRunEventRecord[]>;\n" +
        "  getTasks(runId: string): Promise<HarnessTaskRecord[]>;\n" +
        "  getArtifacts(runId: string): Promise<HarnessArtifactRecord[]>;\n" +
        "  getCheckpoint(runId: string): Promise<AgentLoopCheckpoint | undefined>;\n" +
        "  getSessionMemory(runId: string): Promise<HarnessSessionMemoryRecord | undefined>;\n" +
        "  getLatestSummary(runId: string): Promise<HarnessSummaryRecord | undefined>;\n" +
        "  listSummaries(runId?: string): Promise<HarnessSummaryRecord[]>;\n" +
        "  rememberMemory(input: HarnessMemoryInput): Promise<HarnessMemoryRecord>;\n" +
        "  recallMemory(query: HarnessMemoryQuery): Promise<HarnessMemoryMatch[]>;\n" +
        "  assembleContext(runId: string, options?: HarnessContextAssembleOptions): Promise<HarnessContextPackage>;\n" +
        "  replayRun(runId: string): Promise<HarnessReplayReport>;\n" +
        "  getPaths(): HarnessRuntimePaths;\n" +
        "  destroy(): Promise<void>;\n" +
        "}"
      )
    ),
    createElement("p", null, "Usage:"),
    createElement("pre", null,
      createElement("code", null,
        'import { createHarness } from "@zauso-ai/capstan-ai";\n' +
        "\n" +
        "const harness = await createHarness({\n" +
        "  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),\n" +
        "  sandbox: {\n" +
        '    browser: { engine: "camoufox", platform: "jd", accountId: "price-monitor-01" },\n' +
        '    fs: { rootDir: "./workspace" },\n' +
        "  },\n" +
        "  runtime: {\n" +
        "    rootDir: process.cwd(),\n" +
        "    maxConcurrentRuns: 2,\n" +
        "  },\n" +
        "  verify: { enabled: true },\n" +
        "});\n" +
        "\n" +
        "const started = await harness.startRun({\n" +
        '  goal: "Research the storefront and save notes to workspace/report.md",\n' +
        "});\n" +
        "\n" +
        "const result = await started.result;\n" +
        "await harness.destroy();"
      )
    ),
    createElement("p", null,
      createElement("code", null, 'engine: "playwright"'), " is the lightweight default. ", createElement("code", null, 'engine: "camoufox"'), " enables the kernel adapter with stealth engines, persistent profiles, and platform guards."
    ),
    createElement("p", null,
      createElement("code", null, "runtime.driver"), " defaults to ", createElement("code", null, "LocalHarnessSandboxDriver"), ", which creates an isolated sandbox directory per run under ", createElement("code", null, ".capstan/harness/sandboxes/<runId>/"), ". The runtime store persists: runs, events, tasks, artifacts, checkpoints, session-memory, summaries, and long-term memory entries."
    ),
    createElement("p", null,
      "Use ", createElement("code", null, "openHarnessRuntime(rootDir?)"), " when you need an independent control plane that can inspect paused/completed runs without a live harness instance. The control plane also accepts an object form with an ", createElement("code", null, "authorize"), " callback for runtime supervision with auth."
    ),

    // think
    createElement("h3", { id: "think" }, "think(llm, prompt, opts?)"),
    createElement("p", null, "Structured reasoning: sends a prompt to the LLM and optionally parses the response against a schema."),
    createElement("pre", null,
      createElement("code", null,
        "function think<T = string>(\n" +
        "  llm: LLMProvider,\n" +
        "  prompt: string,\n" +
        "  opts?: ThinkOptions<T>,\n" +
        "): Promise<T>\n" +
        "\n" +
        "interface ThinkOptions<T = unknown> {\n" +
        "  schema?: { parse: (data: unknown) => T };\n" +
        "  model?: string;\n" +
        "  temperature?: number;\n" +
        "  maxTokens?: number;\n" +
        "  systemPrompt?: string;\n" +
        "  memory?: boolean;\n" +
        "  about?: [string, string];\n" +
        "}"
      )
    ),
    createElement("p", null, "When ", createElement("code", null, "schema"), " is provided, the LLM is asked for JSON output and the result is parsed and validated. Without a schema, the raw text is returned."),

    // generate
    createElement("h3", { id: "generate" }, "generate(llm, prompt, opts?)"),
    createElement("p", null, "Text generation: sends a prompt to the LLM and returns the raw text response."),
    createElement("pre", null,
      createElement("code", null,
        "function generate(\n" +
        "  llm: LLMProvider,\n" +
        "  prompt: string,\n" +
        "  opts?: GenerateOptions,\n" +
        "): Promise<string>\n" +
        "\n" +
        "interface GenerateOptions {\n" +
        "  model?: string;\n" +
        "  temperature?: number;\n" +
        "  maxTokens?: number;\n" +
        "  systemPrompt?: string;\n" +
        "  memory?: boolean;\n" +
        "  about?: [string, string];\n" +
        "}"
      )
    ),

    // thinkStream
    createElement("h3", { id: "thinkStream" }, "thinkStream(llm, prompt, opts?)"),
    createElement("p", null, "Streaming text generation. Requires the LLM provider to support ", createElement("code", null, "stream()"), ". Yields text chunks as tokens are generated. Throws if the LLM provider does not implement ", createElement("code", null, "stream()"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function thinkStream(\n" +
        "  llm: LLMProvider,\n" +
        "  prompt: string,\n" +
        "  opts?: GenerateOptions,\n" +
        "): AsyncIterable<string>"
      )
    ),

    // generateStream
    createElement("h3", { id: "generateStream" }, "generateStream(llm, prompt, opts?)"),
    createElement("p", null, "Alias for ", createElement("code", null, "thinkStream"), ". Streaming text generation that yields chunks as the LLM generates tokens."),
    createElement("pre", null,
      createElement("code", null,
        "function generateStream(\n" +
        "  llm: LLMProvider,\n" +
        "  prompt: string,\n" +
        "  opts?: GenerateOptions,\n" +
        "): AsyncIterable<string>"
      )
    ),

    // MemoryAccessor
    createElement("h3", { id: "MemoryAccessor" }, "MemoryAccessor"),
    createElement("p", null, "The developer-facing memory interface, returned by ", createElement("code", null, "createMemoryAccessor()"), " or ", createElement("code", null, "ai.memory.about()"), "."),
    createElement("pre", null,
      createElement("code", null,
        "interface MemoryAccessor {\n" +
        "  remember(content: string, opts?: RememberOptions): Promise<string>;\n" +
        "  recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]>;\n" +
        "  forget(entryId: string): Promise<boolean>;\n" +
        "  about(type: string, id: string): MemoryAccessor;\n" +
        "  assembleContext(opts: AssembleContextOptions): Promise<string>;\n" +
        "}\n" +
        "\n" +
        "interface RememberOptions {\n" +
        "  scope?: MemoryScope;\n" +
        '  type?: "fact" | "event" | "preference" | "instruction";\n' +
        '  importance?: "low" | "medium" | "high" | "critical";\n' +
        "  metadata?: Record<string, unknown>;\n" +
        "}\n" +
        "\n" +
        "interface RecallOptions {\n" +
        "  scope?: MemoryScope;\n" +
        "  limit?: number;         // Max results (default: 10)\n" +
        "  minScore?: number;      // Minimum relevance score\n" +
        "  types?: string[];       // Filter by memory type\n" +
        "}\n" +
        "\n" +
        "interface MemoryScope {\n" +
        "  type: string;\n" +
        "  id: string;\n" +
        "}\n" +
        "\n" +
        "interface MemoryEntry {\n" +
        "  id: string;\n" +
        "  content: string;\n" +
        "  scope: MemoryScope;\n" +
        "  createdAt: string;\n" +
        "  updatedAt: string;\n" +
        "  metadata?: Record<string, unknown>;\n" +
        "  embedding?: number[];\n" +
        '  importance?: "low" | "medium" | "high" | "critical";\n' +
        '  type?: "fact" | "event" | "preference" | "instruction";\n' +
        "  accessCount: number;\n" +
        "  lastAccessedAt: string;\n" +
        "}\n" +
        "\n" +
        "interface AssembleContextOptions {\n" +
        "  query: string;\n" +
        "  maxTokens?: number;     // Default: 4000\n" +
        "  scopes?: MemoryScope[];\n" +
        "}"
      )
    ),
    createElement("p", null,
      createElement("code", null, "remember()"), " stores a memory, automatically deduplicating (>0.92 cosine similarity merges with existing) and embedding for vector search. Returns the memory ID."
    ),
    createElement("p", null,
      createElement("code", null, "recall()"), " retrieves relevant memories using hybrid search: vector similarity (0.7 weight) + keyword matching (0.3 weight) + recency decay (30-day half-life)."
    ),
    createElement("p", null,
      createElement("code", null, "about()"), " returns a new ", createElement("code", null, "MemoryAccessor"), " scoped to a specific entity. All subsequent operations are isolated to that scope."
    ),
    createElement("p", null,
      createElement("code", null, "assembleContext()"), " builds an LLM-ready context string from stored memories, sorted by importance and packed within a token budget."
    ),
    createElement("p", null, "Usage:"),
    createElement("pre", null,
      createElement("code", null,
        'const customerMemory = ai.memory.about("customer", "cust_123");\n' +
        'await customerMemory.remember("Prefers email communication", { type: "preference" });\n' +
        'const relevant = await customerMemory.recall("communication preferences");\n' +
        "await ai.memory.forget(relevant[0].id);"
      )
    ),

    // runAgentLoop
    createElement("h3", { id: "runAgentLoop" }, "runAgentLoop(llm, config, tools, opts?)"),
    createElement("p", null, "Self-orchestrating agent loop. The LLM reasons about a goal, selects and executes tools, feeds results back, and repeats until done or the iteration limit is reached."),
    createElement("pre", null,
      createElement("code", null,
        "function runAgentLoop(\n" +
        "  llm: LLMProvider,\n" +
        "  config: AgentRunConfig,\n" +
        "  tools: AgentTool[],\n" +
        "  opts?: {\n" +
        "    beforeToolCall?: (tool: string, args: unknown) => Promise<{ allowed: boolean; reason?: string }>;\n" +
        "    afterToolCall?: (tool: string, args: unknown, result: unknown) => Promise<void>;\n" +
        "    callStack?: Set<string>;\n" +
        "    onMemoryEvent?: (content: string) => Promise<void>;\n" +
        "  },\n" +
        "): Promise<AgentRunResult>\n" +
        "\n" +
        "interface AgentTool {\n" +
        "  name: string;\n" +
        "  description: string;\n" +
        "  parameters?: Record<string, unknown>;\n" +
        "  execute(args: Record<string, unknown>): Promise<unknown>;\n" +
        "}\n" +
        "\n" +
        "interface AgentRunConfig {\n" +
        "  goal: string;\n" +
        "  about?: [string, string];\n" +
        "  maxIterations?: number;  // Default: 10\n" +
        "  memory?: boolean;\n" +
        "  tools?: AgentTool[];\n" +
        "  systemPrompt?: string;\n" +
        "  excludeRoutes?: string[];\n" +
        "}\n" +
        "\n" +
        "interface AgentRunResult {\n" +
        "  result: unknown;\n" +
        "  iterations: number;\n" +
        "  toolCalls: Array<{ tool: string; args: unknown; result: unknown }>;\n" +
        '  status: "completed" | "max_iterations" | "approval_required";\n' +
        "  pendingApproval?: { tool: string; args: unknown; reason: string };\n" +
        "}"
      )
    ),
    createElement("p", null,
      'The loop uses JSON-based tool calling: the LLM responds with ', createElement("code", null, '{"tool": "name", "arguments": {...}}'), " to invoke a tool, or plain text to finish. The ", createElement("code", null, "beforeToolCall"), " hook enables policy enforcement -- returning ", createElement("code", null, "{ allowed: false }"), ' stops the loop with "approval_required" status.'
    ),

    // BuiltinMemoryBackend
    createElement("h3", { id: "BuiltinMemoryBackend" }, "BuiltinMemoryBackend"),
    createElement("p", null, "Default in-memory backend with optional vector search support. Suitable for development and testing. No external dependencies."),
    createElement("pre", null,
      createElement("code", null,
        "class BuiltinMemoryBackend implements MemoryBackend {\n" +
        "  constructor(opts?: { embedding?: MemoryEmbedder });\n" +
        "}\n" +
        "\n" +
        "interface MemoryEmbedder {\n" +
        "  embed(texts: string[]): Promise<number[][]>;\n" +
        "  dimensions: number;\n" +
        "}"
      )
    ),
    createElement("p", null, "Features: keyword-only fallback when no embedder is provided, hybrid search (vector + keyword + recency decay) when embedder is present, auto-dedup at >0.92 cosine similarity."),

    // MemoryBackend
    createElement("h3", { id: "MemoryBackend" }, "MemoryBackend (Interface)"),
    createElement("p", null, "Pluggable backend interface for memory storage. Implement for custom backends (Mem0, Hindsight, Redis, etc.)."),
    createElement("pre", null,
      createElement("code", null,
        "interface MemoryBackend {\n" +
        '  store(entry: Omit<MemoryEntry, "id" | "accessCount" | "lastAccessedAt" | "createdAt" | "updatedAt">): Promise<string>;\n' +
        "  query(scope: MemoryScope, text: string, k: number): Promise<MemoryEntry[]>;\n" +
        "  remove(id: string): Promise<boolean>;\n" +
        "  clear(scope: MemoryScope): Promise<void>;\n" +
        "}"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-cron
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-cron" }, "@zauso-ai/capstan-cron"),
    createElement("p", null, "Recurring job scheduler for Capstan AI workflows. Works with Bun-native cron when available and falls back to a simple interval runner elsewhere."),

    // defineCron
    createElement("h3", { id: "defineCron" }, "defineCron(config)"),
    createElement("p", null, "Declarative helper that returns the cron config unchanged."),
    createElement("pre", null,
      createElement("code", null,
        "function defineCron(config: CronJobConfig): CronJobConfig"
      )
    ),

    // createCronRunner
    createElement("h3", { id: "createCronRunner" }, "createCronRunner()"),
    createElement("p", null, "Interval-based scheduler for simple cron expressions. Intentionally lightweight -- approximates supported cron patterns as intervals."),
    createElement("pre", null,
      createElement("code", null,
        "function createCronRunner(): CronRunner\n" +
        "\n" +
        "interface CronJobConfig {\n" +
        "  name: string;\n" +
        "  pattern: string;\n" +
        "  handler: () => Promise<void>;\n" +
        "  timezone?: string;\n" +
        "  maxConcurrent?: number;\n" +
        "  onError?: (err: Error) => void;\n" +
        "  enabled?: boolean;\n" +
        "}\n" +
        "\n" +
        "interface CronRunner {\n" +
        "  add(config: CronJobConfig): string;\n" +
        "  remove(id: string): boolean;\n" +
        "  start(): void;\n" +
        "  stop(): void;\n" +
        "  getJobs(): CronJobInfo[];\n" +
        "}"
      )
    ),

    // createBunCronRunner
    createElement("h3", { id: "createBunCronRunner" }, "createBunCronRunner()"),
    createElement("p", null, "Use Bun's native cron implementation when running on Bun. Falls back to ", createElement("code", null, "createCronRunner()"), " when ", createElement("code", null, "Bun.cron"), " is unavailable."),
    createElement("pre", null,
      createElement("code", null,
        "function createBunCronRunner(): CronRunner"
      )
    ),

    // createAgentCron
    createElement("h3", { id: "createAgentCron" }, "createAgentCron(config)"),
    createElement("p", null, "Create a cron job that submits scheduled runs into a harness runtime. If you do not provide a runtime, it falls back to bootstrapping ", createElement("code", null, "createHarness()"), " on demand."),
    createElement("pre", null,
      createElement("code", null,
        "function createAgentCron(config: AgentCronConfig): CronJobConfig\n" +
        "\n" +
        "interface AgentCronConfig {\n" +
        "  cron: string;\n" +
        "  name: string;\n" +
        "  goal: string | (() => string);\n" +
        "  timezone?: string;\n" +
        "  llm?: unknown;\n" +
        "  harnessConfig?: Record<string, unknown>;\n" +
        "  run?: {\n" +
        "    about?: [string, string];\n" +
        "    maxIterations?: number;\n" +
        "    memory?: boolean;\n" +
        "    systemPrompt?: string;\n" +
        "    excludeRoutes?: string[];\n" +
        "  };\n" +
        "  triggerMetadata?: Record<string, unknown>;\n" +
        "  runtime?: {\n" +
        "    harness?: { startRun(config: unknown, options?: unknown): Promise<{ runId: string; result: Promise<unknown> }> };\n" +
        "    createHarness?: () => Promise<{ startRun(...): ... }>;\n" +
        "    reuseHarness?: boolean;\n" +
        "  };\n" +
        "  onQueued?: (meta: { runId: string; trigger: unknown }) => void;\n" +
        "  onResult?: (result: unknown, meta: { runId: string; trigger: unknown }) => void;\n" +
        "  onError?: (err: Error) => void;\n" +
        "}"
      )
    ),
    createElement("p", null, "Usage:"),
    createElement("pre", null,
      createElement("code", null,
        'import { createCronRunner, createAgentCron } from "@zauso-ai/capstan-cron";\n' +
        'import { createHarness } from "@zauso-ai/capstan-ai";\n' +
        "\n" +
        "const harness = await createHarness({\n" +
        "  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),\n" +
        "  sandbox: {\n" +
        '    browser: { engine: "camoufox", platform: "jd", accountId: "price-monitor-01" },\n' +
        '    fs: { rootDir: "./workspace" },\n' +
        "  },\n" +
        "});\n" +
        "\n" +
        "const runner = createCronRunner();\n" +
        "\n" +
        "runner.add(createAgentCron({\n" +
        '  cron: "0 */2 * * *",\n' +
        '  name: "price-monitor",\n' +
        '  goal: "Check the storefront and refresh workspace/report.md",\n' +
        "  runtime: { harness },\n" +
        "}));\n" +
        "\n" +
        "runner.start();"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // Shared Types
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "shared-types" }, "Shared Types"),
    createElement("pre", null,
      createElement("code", null,
        'type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";\n' +
        "\n" +
        "interface CapstanAuthContext {\n" +
        "  isAuthenticated: boolean;\n" +
        '  type: "human" | "agent" | "anonymous";\n' +
        "  userId?: string;\n" +
        "  role?: string;\n" +
        "  email?: string;\n" +
        "  agentId?: string;\n" +
        "  agentName?: string;\n" +
        "  permissions?: string[];\n" +
        "}\n" +
        "\n" +
        "interface CapstanContext {\n" +
        "  auth: CapstanAuthContext;\n" +
        "  request: Request;\n" +
        "  env: Record<string, string | undefined>;\n" +
        "  honoCtx: HonoContext;\n" +
        "}\n" +
        "\n" +
        "interface RouteMetadata {\n" +
        "  method: HttpMethod;\n" +
        "  path: string;\n" +
        "  description?: string;\n" +
        '  capability?: "read" | "write" | "external";\n' +
        "  resource?: string;\n" +
        "  policy?: string;\n" +
        "  inputSchema?: Record<string, unknown>;\n" +
        "  outputSchema?: Record<string, unknown>;\n" +
        "}"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-db
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-db" }, "@zauso-ai/capstan-db"),
    createElement("p", null, "Database layer with model definitions, schema generation, migrations, and CRUD route scaffolding."),

    // defineModel
    createElement("h3", { id: "defineModel" }, "defineModel(name, config)"),
    createElement("p", null, "Declare a data model with fields, relations, and indexes."),
    createElement("pre", null,
      createElement("code", null,
        "function defineModel(\n" +
        "  name: string,\n" +
        "  config: {\n" +
        "    fields: Record<string, FieldDefinition>;\n" +
        "    relations?: Record<string, RelationDefinition>;\n" +
        "    indexes?: IndexDefinition[];\n" +
        "  },\n" +
        "): ModelDefinition"
      )
    ),

    // field
    createElement("h3", { id: "field" }, "field"),
    createElement("p", null, "Field builder namespace with helpers for each scalar type."),
    createElement("pre", null,
      createElement("code", null,
        "const field: {\n" +
        "  id(): FieldDefinition;\n" +
        "  string(opts?: FieldOptions): FieldDefinition;\n" +
        "  text(opts?: FieldOptions): FieldDefinition;\n" +
        "  integer(opts?: FieldOptions): FieldDefinition;\n" +
        "  number(opts?: FieldOptions): FieldDefinition;\n" +
        "  boolean(opts?: FieldOptions): FieldDefinition;\n" +
        "  date(opts?: FieldOptions): FieldDefinition;\n" +
        "  datetime(opts?: FieldOptions): FieldDefinition;\n" +
        "  json<T = unknown>(opts?: FieldOptions): FieldDefinition;\n" +
        "  enum(values: readonly string[], opts?: FieldOptions): FieldDefinition;\n" +
        "  vector(dimensions: number): FieldDefinition;\n" +
        "}"
      )
    ),

    // relation
    createElement("h3", { id: "relation" }, "relation"),
    createElement("p", null, "Relation builder namespace."),
    createElement("pre", null,
      createElement("code", null,
        "const relation: {\n" +
        "  belongsTo(model: string, opts?: { foreignKey?: string; through?: string }): RelationDefinition;\n" +
        "  hasMany(model: string, opts?: { foreignKey?: string; through?: string }): RelationDefinition;\n" +
        "  hasOne(model: string, opts?: { foreignKey?: string; through?: string }): RelationDefinition;\n" +
        "  manyToMany(model: string, opts?: { foreignKey?: string; through?: string }): RelationDefinition;\n" +
        "}"
      )
    ),

    // createDatabase
    createElement("h3", { id: "createDatabase" }, "createDatabase(config)"),
    createElement("p", null, "Create a Drizzle database instance for the specified provider."),
    createElement("pre", null,
      createElement("code", null,
        "function createDatabase(config: DatabaseConfig): Promise<DatabaseInstance>\n" +
        "\n" +
        "interface DatabaseConfig {\n" +
        '  provider: "sqlite" | "postgres" | "mysql";\n' +
        "  url: string;\n" +
        "}\n" +
        "\n" +
        "interface DatabaseInstance {\n" +
        "  db: unknown;       // Drizzle ORM instance\n" +
        "  close: () => void; // Close the connection\n" +
        "}"
      )
    ),

    // Migration Functions
    createElement("h3", { id: "migration-functions" }, "Migration Functions"),
    createElement("pre", null,
      createElement("code", null,
        "// Generate SQL migration statements from model diffs\n" +
        "function generateMigration(\n" +
        "  fromModels: ModelDefinition[],\n" +
        "  toModels: ModelDefinition[],\n" +
        "): string[]\n" +
        "\n" +
        "// Execute SQL statements in a transaction\n" +
        "function applyMigration(\n" +
        "  db: { $client: { exec: (sql: string) => void } },\n" +
        "  sql: string[],\n" +
        "): void\n" +
        "\n" +
        "// Create the _capstan_migrations tracking table\n" +
        "function ensureTrackingTable(\n" +
        "  client: MigrationDbClient,\n" +
        "  provider?: DbProvider,\n" +
        "): void\n" +
        "\n" +
        "// Get list of applied migration names\n" +
        "function getAppliedMigrations(client: MigrationDbClient): string[]\n" +
        "\n" +
        "// Get full migration status (applied + pending)\n" +
        "function getMigrationStatus(\n" +
        "  client: MigrationDbClient,\n" +
        "  allMigrationNames: string[],\n" +
        "  provider?: DbProvider,\n" +
        "): MigrationStatus\n" +
        "\n" +
        "// Apply pending migrations with tracking\n" +
        "function applyTrackedMigrations(\n" +
        "  client: MigrationDbClient,\n" +
        "  migrations: Array<{ name: string; sql: string }>,\n" +
        "  provider?: DbProvider,\n" +
        "): string[]"
      )
    ),

    // generateCrudRoutes
    createElement("h3", { id: "generateCrudRoutes" }, "generateCrudRoutes(model)"),
    createElement("p", null, "Generate CRUD API route files from a model definition."),
    createElement("pre", null,
      createElement("code", null,
        "function generateCrudRoutes(model: ModelDefinition): CrudRouteFiles[]\n" +
        "\n" +
        "interface CrudRouteFiles {\n" +
        "  path: string;    // Relative to app/routes/\n" +
        "  content: string; // File content\n" +
        "}"
      )
    ),

    // pluralize
    createElement("h3", { id: "pluralize" }, "pluralize(word)"),
    createElement("p", null, "Naive English pluralizer for model-to-table name conversion."),
    createElement("pre", null,
      createElement("code", null,
        "function pluralize(word: string): string"
      )
    ),

    // defineEmbedding
    createElement("h3", { id: "defineEmbedding" }, "defineEmbedding(modelName, config)"),
    createElement("p", null, "Configure an embedding model for vector generation."),
    createElement("pre", null,
      createElement("code", null,
        "function defineEmbedding(\n" +
        "  modelName: string,\n" +
        "  config: {\n" +
        "    dimensions: number;\n" +
        "    adapter: EmbeddingAdapter;\n" +
        "  },\n" +
        "): EmbeddingInstance\n" +
        "\n" +
        "interface EmbeddingInstance {\n" +
        "  embed(text: string): Promise<number[]>;\n" +
        "  embedBatch(texts: string[]): Promise<number[][]>;\n" +
        "  dimensions: number;\n" +
        "}"
      )
    ),

    // openaiEmbeddings
    createElement("h3", { id: "openaiEmbeddings" }, "openaiEmbeddings(opts)"),
    createElement("p", null, "Create an embedding adapter using the OpenAI embeddings API."),
    createElement("pre", null,
      createElement("code", null,
        "function openaiEmbeddings(opts: {\n" +
        "  apiKey: string;\n" +
        "  model?: string;      // default: inferred from defineEmbedding modelName\n" +
        "  baseUrl?: string;     // for compatible providers\n" +
        "}): EmbeddingAdapter"
      )
    ),

    // Schema Generation
    createElement("h3", { id: "generateDrizzleSchema" }, "generateDrizzleSchema(models, provider)"),
    createElement("p", null, "Generate Drizzle ORM schema from model definitions."),
    createElement("pre", null,
      createElement("code", null,
        "function generateDrizzleSchema(\n" +
        "  models: ModelDefinition[],\n" +
        '  provider: "sqlite" | "postgres" | "mysql",\n' +
        "): Record<string, DrizzleTable>"
      )
    ),

    // Database Runtime
    createElement("h3", { id: "db-runtime" }, "Database Runtime"),
    createElement("pre", null,
      createElement("code", null,
        "function createDatabaseRuntime(db: DrizzleClient, schema: Record<string, DrizzleTable>): DatabaseRuntime\n" +
        "function createCrudRepository(db: DrizzleClient, model: ModelDefinition, table: DrizzleTable): CrudRepository\n" +
        "function createCrudRuntime(db: DrizzleClient, models: ModelDefinition[], schema: Record<string, DrizzleTable>): CrudRuntime"
      )
    ),

    // Vector Search
    createElement("h3", { id: "vector-search" }, "Vector Search"),
    createElement("pre", null,
      createElement("code", null,
        "// Calculate cosine distance between two vectors\n" +
        "function cosineDistance(a: number[], b: number[]): number\n" +
        "\n" +
        "// Find K nearest neighbors by vector similarity\n" +
        "function findNearest(\n" +
        "  items: { id: string; vector: number[] }[],\n" +
        "  query: number[],\n" +
        "  k?: number,\n" +
        "): { id: string; score: number }[]\n" +
        "\n" +
        "// Hybrid search combining vector similarity (0.7) + keyword matching (0.3)\n" +
        "function hybridSearch(\n" +
        "  items: { id: string; vector: number[]; text: string }[],\n" +
        "  query: { vector: number[]; text: string },\n" +
        "  k?: number,\n" +
        "): { id: string; score: number }[]"
      )
    ),

    // Data Preparation
    createElement("h3", { id: "data-preparation" }, "Data Preparation"),
    createElement("pre", null,
      createElement("code", null,
        "function prepareCreateData(model: ModelDefinition, input: Record<string, unknown>): Record<string, unknown>\n" +
        "function prepareUpdateData(model: ModelDefinition, input: Record<string, unknown>): Record<string, unknown>"
      )
    ),

    // DB Types
    createElement("h3", { id: "db-types" }, "DB Types"),
    createElement("pre", null,
      createElement("code", null,
        'type ScalarType = "string" | "integer" | "number" | "boolean" | "date" | "datetime" | "text" | "json";\n' +
        'type DbProvider = "sqlite" | "postgres" | "mysql";\n' +
        'type RelationKind = "belongsTo" | "hasMany" | "hasOne" | "manyToMany";\n' +
        "\n" +
        "interface FieldDefinition {\n" +
        "  type: ScalarType;\n" +
        "  required?: boolean;\n" +
        "  unique?: boolean;\n" +
        "  default?: unknown;\n" +
        "  min?: number;\n" +
        "  max?: number;\n" +
        "  enum?: readonly string[];\n" +
        "  updatedAt?: boolean;\n" +
        "  autoId?: boolean;\n" +
        "  references?: string;\n" +
        "}\n" +
        "\n" +
        "interface RelationDefinition {\n" +
        "  kind: RelationKind;\n" +
        "  model: string;\n" +
        "  foreignKey?: string;\n" +
        "  through?: string;\n" +
        "}\n" +
        "\n" +
        "interface IndexDefinition {\n" +
        "  fields: string[];\n" +
        "  unique?: boolean;\n" +
        '  order?: "asc" | "desc";\n' +
        "}\n" +
        "\n" +
        "interface ModelDefinition {\n" +
        "  name: string;\n" +
        "  fields: Record<string, FieldDefinition>;\n" +
        "  relations: Record<string, RelationDefinition>;\n" +
        "  indexes: IndexDefinition[];\n" +
        "}"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-auth
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-auth" }, "@zauso-ai/capstan-auth"),
    createElement("p", null, "Authentication and authorization: JWT sessions, API keys, OAuth, grants, execution identity, DPoP, and SPIFFE."),

    // signSession
    createElement("h3", { id: "signSession" }, "signSession(payload, secret, maxAge?)"),
    createElement("p", null, "Create a signed JWT containing session data."),
    createElement("pre", null,
      createElement("code", null,
        "function signSession(\n" +
        '  payload: Omit<SessionPayload, "iat" | "exp">,\n' +
        "  secret: string,\n" +
        '  maxAge?: string, // default: "7d"\n' +
        "): string"
      )
    ),

    // verifySession
    createElement("h3", { id: "verifySession" }, "verifySession(token, secret)"),
    createElement("p", null, "Verify a JWT signature and expiration. Returns the payload on success, ", createElement("code", null, "null"), " on failure."),
    createElement("pre", null,
      createElement("code", null,
        "function verifySession(token: string, secret: string): SessionPayload | null"
      )
    ),

    // generateApiKey
    createElement("h3", { id: "generateApiKey" }, "generateApiKey(prefix?)"),
    createElement("p", null, "Generate a new API key with hash and lookup prefix."),
    createElement("pre", null,
      createElement("code", null,
        "function generateApiKey(prefix?: string): {\n" +
        "  key: string;    // Full plaintext key (show once)\n" +
        "  hash: string;   // SHA-256 hex digest (store in DB)\n" +
        "  prefix: string; // Lookup prefix (store for indexed queries)\n" +
        "}"
      )
    ),

    // verifyApiKey
    createElement("h3", { id: "verifyApiKey" }, "verifyApiKey(key, storedHash)"),
    createElement("p", null, "Verify a plaintext API key against a stored SHA-256 hash. Uses timing-safe comparison."),
    createElement("pre", null,
      createElement("code", null,
        "function verifyApiKey(key: string, storedHash: string): Promise<boolean>"
      )
    ),

    // extractApiKeyPrefix
    createElement("h3", { id: "extractApiKeyPrefix" }, "extractApiKeyPrefix(key)"),
    createElement("p", null, "Extract the lookup prefix from a full plaintext API key."),
    createElement("pre", null,
      createElement("code", null,
        "function extractApiKeyPrefix(key: string): string"
      )
    ),

    // createAuthMiddleware
    createElement("h3", { id: "createAuthMiddleware" }, "createAuthMiddleware(config, deps)"),
    createElement("p", null, "Create a middleware function that resolves auth context from a request."),
    createElement("pre", null,
      createElement("code", null,
        "function createAuthMiddleware(\n" +
        "  config: AuthConfig,\n" +
        "  deps: AuthResolverDeps,\n" +
        "): (request: Request) => Promise<AuthContext>\n" +
        "\n" +
        "interface AuthConfig {\n" +
        "  session: { secret: string; maxAge?: string };\n" +
        "  apiKeys?: { prefix?: string; headerName?: string };\n" +
        "}\n" +
        "\n" +
        "interface AuthResolverDeps {\n" +
        "  findAgentByKeyPrefix?: (prefix: string) => Promise<AgentCredential | null>;\n" +
        "}"
      )
    ),

    // checkPermission
    createElement("h3", { id: "checkPermission" }, "checkPermission(required, granted)"),
    createElement("p", null, "Check whether a required permission is satisfied by the granted set. Supports wildcards: ", createElement("code", null, "*:read"), ", ", createElement("code", null, "ticket:*"), ", ", createElement("code", null, "*:*"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function checkPermission(\n" +
        '  required: { resource: string; action: "read" | "write" | "delete" },\n' +
        "  granted: string[],\n" +
        "): boolean"
      )
    ),

    // derivePermission
    createElement("h3", { id: "derivePermission" }, "derivePermission(capability, resource?)"),
    createElement("p", null, "Derive a permission object from a capability mode."),
    createElement("pre", null,
      createElement("code", null,
        "function derivePermission(\n" +
        '  capability: "read" | "write" | "external",\n' +
        "  resource?: string,\n" +
        "): { resource: string; action: string }"
      )
    ),

    // OAuth Providers
    createElement("h3", { id: "googleProvider" }, "googleProvider(opts)"),
    createElement("p", null, "Create a pre-configured Google OAuth provider. Returns an ", createElement("code", null, "OAuthProvider"), ' configured with Google\'s authorize, token, and user info endpoints and ["openid", "email", "profile"] scopes.'),
    createElement("pre", null,
      createElement("code", null,
        "function googleProvider(opts: {\n" +
        "  clientId: string;\n" +
        "  clientSecret: string;\n" +
        "}): OAuthProvider"
      )
    ),

    createElement("h3", { id: "githubProvider" }, "githubProvider(opts)"),
    createElement("p", null, "Create a pre-configured GitHub OAuth provider. Returns an ", createElement("code", null, "OAuthProvider"), ' configured with GitHub\'s endpoints and ["user:email"] scopes.'),
    createElement("pre", null,
      createElement("code", null,
        "function githubProvider(opts: {\n" +
        "  clientId: string;\n" +
        "  clientSecret: string;\n" +
        "}): OAuthProvider"
      )
    ),

    // createOAuthHandlers
    createElement("h3", { id: "createOAuthHandlers" }, "createOAuthHandlers(config, fetchFn?)"),
    createElement("p", null, "Create OAuth route handlers for the full authorization code flow."),
    createElement("pre", null,
      createElement("code", null,
        "function createOAuthHandlers(\n" +
        "  config: OAuthConfig,\n" +
        "  fetchFn?: typeof globalThis.fetch,\n" +
        "): OAuthHandlers\n" +
        "\n" +
        "interface OAuthConfig {\n" +
        "  providers: OAuthProvider[];\n" +
        '  callbackPath?: string; // default: "/auth/callback"\n' +
        "  sessionSecret: string;\n" +
        "}\n" +
        "\n" +
        "interface OAuthHandlers {\n" +
        "  login: (request: Request, providerName: string) => Response;\n" +
        "  callback: (request: Request) => Promise<Response>;\n" +
        "}"
      )
    ),
    createElement("p", null, "The ", createElement("code", null, "login"), " handler redirects to the OAuth provider with a CSRF state parameter. The ", createElement("code", null, "callback"), " handler validates state, exchanges the authorization code for an access token, fetches user info, and creates a signed JWT session cookie."),

    // Auth Types
    createElement("h3", { id: "auth-types" }, "Auth Types"),
    createElement("pre", null,
      createElement("code", null,
        "interface OAuthProvider {\n" +
        "  name: string;\n" +
        "  authorizeUrl: string;\n" +
        "  tokenUrl: string;\n" +
        "  userInfoUrl: string;\n" +
        "  clientId: string;\n" +
        "  clientSecret: string;\n" +
        "  scopes: string[];\n" +
        "}\n" +
        "\n" +
        "interface SessionPayload {\n" +
        "  userId: string;\n" +
        "  email?: string;\n" +
        "  role?: string;\n" +
        "  iat: number;\n" +
        "  exp: number;\n" +
        "}\n" +
        "\n" +
        "interface AgentCredential {\n" +
        "  id: string;\n" +
        "  name: string;\n" +
        "  apiKeyHash: string;\n" +
        "  apiKeyPrefix: string;\n" +
        "  permissions: string[];\n" +
        "  revokedAt?: string;\n" +
        "}\n" +
        "\n" +
        "interface AuthContext {\n" +
        "  isAuthenticated: boolean;\n" +
        '  type: "human" | "agent" | "anonymous";\n' +
        "  userId?: string;\n" +
        "  role?: string;\n" +
        "  email?: string;\n" +
        "  agentId?: string;\n" +
        "  agentName?: string;\n" +
        "  permissions?: string[];\n" +
        "}"
      )
    ),

    // Grant-Based Authorization
    createElement("h3", { id: "grant-authorization" }, "Grant-Based Authorization"),
    createElement("p", null, "Fine-grained permission system for runtime and harness actions."),
    createElement("pre", null,
      createElement("code", null,
        "function authorizeGrant(required: AuthGrant, granted: AuthGrant[]): AuthorizationDecision\n" +
        "function checkGrant(required: AuthGrant, granted: AuthGrant[]): boolean\n" +
        "function normalizePermissionsToGrants(permissions: (string | AuthGrant)[]): AuthGrant[]\n" +
        "function serializeGrantsToPermissions(grants: AuthGrant[]): string[]\n" +
        "function createGrant(resource: string, action: string, scope?: Record<string, string>): AuthGrant\n" +
        "\n" +
        "interface AuthGrant {\n" +
        "  resource: string;\n" +
        "  action: string;\n" +
        "  scope?: Record<string, string>;\n" +
        "}"
      )
    ),

    // Runtime Grant Helpers
    createElement("h3", { id: "runtime-grant-helpers" }, "Runtime Grant Helpers"),
    createElement("p", null, "Factory functions for common runtime action grants."),
    createElement("pre", null,
      createElement("code", null,
        "function grantRunActions(actions?: string[], runId?: string): AuthGrant[]\n" +
        "function grantRunCollectionActions(actions?: string[]): AuthGrant[]\n" +
        "function grantApprovalActions(actions?: string[], approvalId?: string): AuthGrant[]\n" +
        "function grantApprovalCollectionActions(actions?: string[]): AuthGrant[]\n" +
        "function grantEventActions(actions?: string[]): AuthGrant[]\n" +
        "function grantEventCollectionActions(actions?: string[]): AuthGrant[]\n" +
        "function grantArtifactActions(actions?: string[]): AuthGrant[]\n" +
        "function grantCheckpointActions(actions?: string[]): AuthGrant[]\n" +
        "function grantTaskActions(actions?: string[]): AuthGrant[]\n" +
        "function grantSummaryActions(actions?: string[]): AuthGrant[]\n" +
        "function grantSummaryCollectionActions(actions?: string[]): AuthGrant[]\n" +
        "function grantMemoryActions(actions?: string[]): AuthGrant[]\n" +
        "function grantContextActions(actions?: string[]): AuthGrant[]\n" +
        "function grantRuntimePathsActions(actions?: string[]): AuthGrant[]"
      )
    ),

    // Runtime Authorizer
    createElement("h3", { id: "runtime-authorizer" }, "Runtime Authorizer"),
    createElement("pre", null,
      createElement("code", null,
        "function deriveRuntimeGrantRequirements(request: RuntimeActionRequest): AuthGrant[]\n" +
        "function authorizeRuntimeAction(request: RuntimeActionRequest, granted: AuthGrant[]): AuthorizationResult\n" +
        "function createRuntimeGrantAuthorizer(granted: AuthGrant[]): RuntimeGrantAuthorizer\n" +
        "function createHarnessGrantAuthorizer(granted: AuthGrant[]): HarnessGrantAuthorizer\n" +
        "function toRuntimeGrantRequest(request: HarnessAuthRequest): RuntimeActionRequest"
      )
    ),

    // Execution Identity
    createElement("h3", { id: "execution-identity" }, "Execution Identity"),
    createElement("pre", null,
      createElement("code", null,
        "function createExecutionIdentity(kind: string, source: string): ExecutionIdentity\n" +
        "function createRequestExecution(request: Request): ExecutionIdentity\n" +
        "function createDelegationLink(from: Identity, to: Identity): DelegationLink"
      )
    ),

    // DPoP & Workload Identity
    createElement("h3", { id: "dpop-spiffe" }, "DPoP and Workload Identity"),
    createElement("pre", null,
      createElement("code", null,
        "// Validate a DPoP proof JWT (RFC 9449)\n" +
        "function validateDpopProof(proof: string, options: DpopValidationOptions): Promise<DpopResult>\n" +
        "\n" +
        "// Clear DPoP replay cache (for testing)\n" +
        "function clearDpopReplayCache(): void\n" +
        "\n" +
        "// Extract SPIFFE workload identity from certificate\n" +
        "function extractWorkloadIdentity(certOrClaim: string): WorkloadIdentity | null\n" +
        "\n" +
        "// Validate SPIFFE ID format\n" +
        "function isValidSpiffeId(uri: string): boolean"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-router
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-router" }, "@zauso-ai/capstan-router"),
    createElement("p", null, "File-based routing: directory scanning, URL matching, and manifest generation."),

    // scanRoutes
    createElement("h3", { id: "scanRoutes" }, "scanRoutes(routesDir)"),
    createElement("p", null, "Scan a directory tree and produce a ", createElement("code", null, "RouteManifest"), " describing every route file."),
    createElement("pre", null,
      createElement("code", null,
        "function scanRoutes(routesDir: string): Promise<RouteManifest>\n" +
        "\n" +
        "interface RouteManifest {\n" +
        "  routes: RouteEntry[];\n" +
        "  scannedAt: string;\n" +
        "  rootDir: string;\n" +
        "}\n" +
        "\n" +
        "interface RouteEntry {\n" +
        "  filePath: string;\n" +
        "  type: RouteType;\n" +
        "  urlPattern: string;\n" +
        "  methods?: string[];\n" +
        "  layouts: string[];\n" +
        "  middlewares: string[];\n" +
        "  params: string[];\n" +
        "  isCatchAll: boolean;\n" +
        "}\n" +
        "\n" +
        'type RouteType = "page" | "api" | "layout" | "middleware";'
      )
    ),

    // matchRoute
    createElement("h3", { id: "matchRoute" }, "matchRoute(manifest, method, urlPath)"),
    createElement("p", null, "Match a URL path and HTTP method against a route manifest. Priority: static segments > dynamic segments > catch-all. For equal specificity, API routes are preferred for non-GET methods, page routes for GET."),
    createElement("pre", null,
      createElement("code", null,
        "function matchRoute(\n" +
        "  manifest: RouteManifest,\n" +
        "  method: string,\n" +
        "  urlPath: string,\n" +
        "): MatchedRoute | null\n" +
        "\n" +
        "interface MatchedRoute {\n" +
        "  route: RouteEntry;\n" +
        "  params: Record<string, string>;\n" +
        "}"
      )
    ),

    // generateRouteManifest
    createElement("h3", { id: "generateRouteManifest" }, "generateRouteManifest(manifest)"),
    createElement("p", null, "Extract API route information from a ", createElement("code", null, "RouteManifest"), " for the agent surface layer."),
    createElement("pre", null,
      createElement("code", null,
        "function generateRouteManifest(\n" +
        "  manifest: RouteManifest,\n" +
        "): { apiRoutes: AgentApiRoute[] }\n" +
        "\n" +
        "interface AgentApiRoute {\n" +
        "  method: string;\n" +
        "  path: string;\n" +
        "  filePath: string;\n" +
        "}"
      )
    ),

    // canonicalizeRouteManifest
    createElement("h3", { id: "canonicalizeRouteManifest" }, "canonicalizeRouteManifest(routes, rootDir)"),
    createElement("p", null, "Canonicalize and validate route entries -- detect conflicts, sort by specificity, generate diagnostics."),
    createElement("pre", null,
      createElement("code", null,
        "function canonicalizeRouteManifest(\n" +
        "  routes: RouteEntry[],\n" +
        "  rootDir: string,\n" +
        "): CanonicalizedRouteManifest\n" +
        "\n" +
        "interface CanonicalizedRouteManifest {\n" +
        "  routes: RouteEntry[];\n" +
        "  diagnostics: RouteDiagnostic[];\n" +
        "}"
      )
    ),

    // validateRouteManifest
    createElement("h3", { id: "validateRouteManifest" }, "validateRouteManifest(routes, rootDir)"),
    createElement("p", null, "Validate route entries and return canonicalized routes with diagnostics. Wrapper for ", createElement("code", null, "canonicalizeRouteManifest"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function validateRouteManifest(\n" +
        "  routes: RouteEntry[],\n" +
        "  rootDir: string,\n" +
        "): CanonicalizedRouteManifest"
      )
    ),

    // createRouteScanCache
    createElement("h3", { id: "createRouteScanCache" }, "createRouteScanCache()"),
    createElement("p", null, "Create a cache instance for storing route scan results to avoid redundant scanning."),
    createElement("pre", null,
      createElement("code", null,
        "function createRouteScanCache(): RouteScanCache\n" +
        "\n" +
        "class RouteScanCache {\n" +
        "  get(rootDir: string): RouteScanCacheState | undefined;\n" +
        "  set(rootDir: string, state: RouteScanCacheState): void;\n" +
        "  clear(rootDir?: string): void;\n" +
        "}"
      )
    ),

    // createRouteConflictError
    createElement("h3", { id: "createRouteConflictError" }, "createRouteConflictError(diagnostics)"),
    createElement("p", null, "Create a structured error from route diagnostics for error handling."),
    createElement("pre", null,
      createElement("code", null,
        "function createRouteConflictError(\n" +
        "  diagnostics: RouteDiagnostic[],\n" +
        "): RouteConflictError\n" +
        "\n" +
        "class RouteConflictError extends Error {\n" +
        '  code: "ROUTE_CONFLICT";\n' +
        "  conflicts: RouteConflict[];\n" +
        "  diagnostics: RouteDiagnostic[];\n" +
        "}"
      )
    ),

    // Router Types
    createElement("h3", { id: "router-types" }, "Router Types"),
    createElement("pre", null,
      createElement("code", null,
        'type RouteType = "page" | "api" | "layout" | "middleware" | "loading" | "error" | "not-found";\n' +
        'type RouteDiagnosticSeverity = "error" | "warning";\n' +
        "\n" +
        "interface RouteDiagnostic {\n" +
        "  code: RouteConflictReason;\n" +
        "  severity: RouteDiagnosticSeverity;\n" +
        "  message: string;\n" +
        "  routeType: RouteType;\n" +
        "  urlPattern: string;\n" +
        "  canonicalPattern: string;\n" +
        "  filePaths: string[];\n" +
        "  directoryDepth?: number;\n" +
        "}\n" +
        "\n" +
        "interface RouteStaticInfo {\n" +
        "  exportNames: string[];\n" +
        "  hasMetadata?: boolean;\n" +
        '  renderMode?: "ssr" | "ssg" | "isr" | "streaming";\n' +
        "  revalidate?: number;\n" +
        "  hasGenerateStaticParams?: boolean;\n" +
        "}"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-agent
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-agent" }, "@zauso-ai/capstan-agent"),
    createElement("p", null, "Multi-protocol adapter layer: CapabilityRegistry, MCP server, A2A handler, OpenAPI spec, LangChain integration."),

    // CapabilityRegistry
    createElement("h3", { id: "CapabilityRegistry" }, "CapabilityRegistry"),
    createElement("p", null, "Unified registry for projecting routes to multiple protocol surfaces."),
    createElement("pre", null,
      createElement("code", null,
        "class CapabilityRegistry {\n" +
        "  constructor(config: AgentConfig);\n" +
        "\n" +
        "  register(route: RouteRegistryEntry): void;\n" +
        "  registerAll(routes: RouteRegistryEntry[]): void;\n" +
        "  getRoutes(): readonly RouteRegistryEntry[];\n" +
        "  getConfig(): Readonly<AgentConfig>;\n" +
        "\n" +
        "  toManifest(): AgentManifest;\n" +
        "  toOpenApi(): Record<string, unknown>;\n" +
        "  toMcp(executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>): {\n" +
        "    server: McpServer;\n" +
        "    getToolDefinitions: () => Array<{ name: string; description: string; inputSchema: unknown }>;\n" +
        "  };\n" +
        "  toA2A(executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>): {\n" +
        "    handleRequest: (body: unknown) => Promise<unknown>;\n" +
        "    getAgentCard: () => A2AAgentCard;\n" +
        "  };\n" +
        "}"
      )
    ),

    // createMcpServer
    createElement("h3", { id: "createMcpServer" }, "createMcpServer(config, routes, executeRoute)"),
    createElement("p", null, "Create an MCP server that exposes API routes as MCP tools. Tool naming convention: ", createElement("code", null, "GET /tickets"), " becomes ", createElement("code", null, "get_tickets"), ", ", createElement("code", null, "GET /tickets/:id"), " becomes ", createElement("code", null, "get_tickets_by_id"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function createMcpServer(\n" +
        "  config: AgentConfig,\n" +
        "  routes: RouteRegistryEntry[],\n" +
        "  executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>,\n" +
        "): {\n" +
        "  server: McpServer;\n" +
        "  getToolDefinitions: () => Array<{ name: string; description: string; inputSchema: unknown }>;\n" +
        "}"
      )
    ),

    // serveMcpStdio
    createElement("h3", { id: "serveMcpStdio" }, "serveMcpStdio(server)"),
    createElement("p", null, "Connect an MCP server to stdio transport for use with Claude Desktop, Cursor, etc."),
    createElement("pre", null,
      createElement("code", null,
        "function serveMcpStdio(server: McpServer): Promise<void>"
      )
    ),

    // routeToToolName
    createElement("h3", { id: "routeToToolName" }, "routeToToolName(method, path)"),
    createElement("p", null, "Convert an HTTP method + URL path into a snake_case MCP tool name."),
    createElement("pre", null,
      createElement("code", null,
        "function routeToToolName(method: string, path: string): string"
      )
    ),

    // generateOpenApiSpec
    createElement("h3", { id: "generateOpenApiSpec" }, "generateOpenApiSpec(config, routes)"),
    createElement("p", null, "Generate an OpenAPI 3.1.0 specification from agent config and routes."),
    createElement("pre", null,
      createElement("code", null,
        "function generateOpenApiSpec(\n" +
        "  config: AgentConfig,\n" +
        "  routes: RouteRegistryEntry[],\n" +
        "): Record<string, unknown>"
      )
    ),

    // generateA2AAgentCard
    createElement("h3", { id: "generateA2AAgentCard" }, "generateA2AAgentCard(config, routes)"),
    createElement("p", null, "Generate an A2A Agent Card from config and routes."),
    createElement("pre", null,
      createElement("code", null,
        "function generateA2AAgentCard(\n" +
        "  config: AgentConfig,\n" +
        "  routes: RouteRegistryEntry[],\n" +
        "): A2AAgentCard\n" +
        "\n" +
        "interface A2AAgentCard {\n" +
        "  name: string;\n" +
        "  description?: string;\n" +
        "  url: string;\n" +
        "  version: string;\n" +
        "  capabilities: { streaming?: boolean; pushNotifications?: boolean };\n" +
        "  skills: Array<{\n" +
        "    id: string;\n" +
        "    name: string;\n" +
        "    description?: string;\n" +
        "    inputSchema?: Record<string, unknown>;\n" +
        "    outputSchema?: Record<string, unknown>;\n" +
        "  }>;\n" +
        "  authentication?: { schemes: string[] };\n" +
        "}"
      )
    ),

    // createMcpClient
    createElement("h3", { id: "createMcpClient" }, "createMcpClient(options)"),
    createElement("p", null, "Create an MCP client to consume tools from an external MCP server."),
    createElement("pre", null,
      createElement("code", null,
        "function createMcpClient(options: McpClientOptions): McpClient\n" +
        "\n" +
        "interface McpClientOptions {\n" +
        "  url?: string;                        // Streamable HTTP endpoint\n" +
        "  command?: string;                    // stdio command (alternative to url)\n" +
        "  args?: string[];                     // stdio command args\n" +
        '  transport?: "streamable-http" | "stdio";\n' +
        "}\n" +
        "\n" +
        "interface McpClient {\n" +
        "  listTools(): Promise<Array<{ name: string; description?: string; inputSchema: unknown }>>;\n" +
        "  callTool(name: string, args?: unknown): Promise<unknown>;\n" +
        "  close(): Promise<void>;\n" +
        "}"
      )
    ),

    // McpTestHarness
    createElement("h3", { id: "McpTestHarness" }, "McpTestHarness"),
    createElement("p", null, "Test harness for verifying MCP tool behavior without a live server."),
    createElement("pre", null,
      createElement("code", null,
        "class McpTestHarness {\n" +
        "  constructor(registry: CapabilityRegistry);\n" +
        "\n" +
        "  listTools(): Array<{ name: string; description: string; inputSchema: unknown }>;\n" +
        "  callTool(name: string, args?: unknown): Promise<unknown>;\n" +
        "}"
      )
    ),

    // toLangChainTools
    createElement("h3", { id: "toLangChainTools" }, "toLangChainTools(registry, options?)"),
    createElement("p", null, "Convert registered capabilities into LangChain-compatible ", createElement("code", null, "StructuredTool"), " instances."),
    createElement("pre", null,
      createElement("code", null,
        "function toLangChainTools(\n" +
        "  registry: CapabilityRegistry,\n" +
        "  options?: {\n" +
        "    filter?: (route: RouteRegistryEntry) => boolean;\n" +
        "  },\n" +
        "): StructuredTool[]"
      )
    ),

    // createA2AHandler
    createElement("h3", { id: "createA2AHandler" }, "createA2AHandler(config, routes, executeRoute)"),
    createElement("p", null, "Create an A2A JSON-RPC handler supporting ", createElement("code", null, "tasks/send"), ", ", createElement("code", null, "tasks/get"), ", and ", createElement("code", null, "agent/card"), " methods."),
    createElement("pre", null,
      createElement("code", null,
        "function createA2AHandler(\n" +
        "  config: AgentConfig,\n" +
        "  routes: RouteRegistryEntry[],\n" +
        "  executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>,\n" +
        "): {\n" +
        "  handleRequest: (body: unknown) => Promise<A2AJsonRpcResponse>;\n" +
        "  getAgentCard: () => A2AAgentCard;\n" +
        "}"
      )
    ),

    // Agent Types
    createElement("h3", { id: "agent-types" }, "Agent Types"),
    createElement("pre", null,
      createElement("code", null,
        "interface AgentManifest {\n" +
        "  capstan: string;\n" +
        "  name: string;\n" +
        "  description?: string;\n" +
        "  baseUrl?: string;\n" +
        "  authentication: {\n" +
        '    schemes: Array<{ type: "bearer"; name: string; header: string; description: string }>;\n' +
        "  };\n" +
        "  resources: Array<{\n" +
        "    key: string;\n" +
        "    title: string;\n" +
        "    description?: string;\n" +
        "    fields: Record<string, { type: string; required?: boolean; enum?: string[] }>;\n" +
        "  }>;\n" +
        "  capabilities: Array<{\n" +
        "    key: string;\n" +
        "    title: string;\n" +
        "    description?: string;\n" +
        '    mode: "read" | "write" | "external";\n' +
        "    resource?: string;\n" +
        "    endpoint: { method: string; path: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> };\n" +
        "    policy?: string;\n" +
        "  }>;\n" +
        "  mcp?: { endpoint: string; transport: string };\n" +
        "}\n" +
        "\n" +
        "interface RouteRegistryEntry {\n" +
        "  method: string;\n" +
        "  path: string;\n" +
        "  description?: string;\n" +
        '  capability?: "read" | "write" | "external";\n' +
        "  resource?: string;\n" +
        "  policy?: string;\n" +
        "  inputSchema?: Record<string, unknown>;\n" +
        "  outputSchema?: Record<string, unknown>;\n" +
        "}\n" +
        "\n" +
        "interface AgentConfig {\n" +
        "  name: string;\n" +
        "  description?: string;\n" +
        "  baseUrl?: string;\n" +
        "  resources?: Array<{\n" +
        "    key: string;\n" +
        "    title: string;\n" +
        "    description?: string;\n" +
        "    fields: Record<string, { type: string; required?: boolean; enum?: string[] }>;\n" +
        "  }>;\n" +
        "}\n" +
        "\n" +
        "interface A2ATask {\n" +
        "  id: string;\n" +
        '  status: "submitted" | "working" | "input-required" | "completed" | "failed" | "canceled";\n' +
        "  skill: string;\n" +
        "  input?: unknown;\n" +
        "  output?: unknown;\n" +
        "  error?: string;\n" +
        "}"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-react
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-react" }, "@zauso-ai/capstan-react"),
    createElement("p", null, "React SSR with loaders, layouts, hydration, Image, Font, Metadata, and ErrorBoundary."),

    // renderPage
    createElement("h3", { id: "renderPage" }, "renderPage(options)"),
    createElement("p", null, "Server-side render a page component to HTML."),
    createElement("pre", null,
      createElement("code", null,
        "function renderPage(options: RenderPageOptions): Promise<RenderResult>"
      )
    ),

    // defineLoader
    createElement("h3", { id: "defineLoader" }, "defineLoader(loader)"),
    createElement("p", null, "Define a data loader for a page component."),
    createElement("pre", null,
      createElement("code", null,
        "function defineLoader(loader: LoaderFunction): LoaderFunction\n" +
        "\n" +
        "type LoaderFunction = (args: LoaderArgs) => Promise<unknown>;\n" +
        "\n" +
        "interface LoaderArgs {\n" +
        "  params: Record<string, string>;\n" +
        "  request: Request;\n" +
        "}"
      )
    ),

    // useLoaderData
    createElement("h3", { id: "useLoaderData" }, "useLoaderData()"),
    createElement("p", null, "React hook to access loader data in a page component."),
    createElement("pre", null,
      createElement("code", null,
        "function useLoaderData<T = unknown>(): T"
      )
    ),

    // Outlet
    createElement("h3", { id: "Outlet" }, "Outlet"),
    createElement("p", null, "Layout outlet component for rendering nested routes."),
    createElement("pre", null,
      createElement("code", null,
        "function Outlet(): JSX.Element"
      )
    ),

    // OutletProvider
    createElement("h3", { id: "OutletProvider" }, "OutletProvider"),
    createElement("p", null, "Context provider for the outlet system."),
    createElement("pre", null,
      createElement("code", null,
        "function OutletProvider(props: { children: React.ReactNode }): JSX.Element"
      )
    ),

    // ServerOnly
    createElement("h3", { id: "ServerOnly" }, "ServerOnly"),
    createElement("p", null, "React component that renders its children only during SSR. Children are excluded from the client hydration bundle, enabling selective hydration."),
    createElement("pre", null,
      createElement("code", null,
        "function ServerOnly(props: { children: React.ReactNode }): JSX.Element | null"
      )
    ),

    // ClientOnly
    createElement("h3", { id: "ClientOnly" }, "ClientOnly"),
    createElement("p", null, "React component that renders its children only in the browser. During SSR, an optional fallback is rendered instead."),
    createElement("pre", null,
      createElement("code", null,
        "function ClientOnly(props: {\n" +
        "  children: React.ReactNode;\n" +
        "  fallback?: React.ReactNode;\n" +
        "}): JSX.Element"
      )
    ),

    // serverOnly function
    createElement("h3", { id: "serverOnly-fn" }, "serverOnly()"),
    createElement("p", null, "Guard function that throws if called in a browser environment. Use at the top of server-only modules to prevent accidental client-side imports."),
    createElement("pre", null,
      createElement("code", null,
        "function serverOnly(): void"
      )
    ),

    // useAuth
    createElement("h3", { id: "useAuth" }, "useAuth()"),
    createElement("p", null, "React hook to access auth context in components."),
    createElement("pre", null,
      createElement("code", null,
        "function useAuth(): CapstanAuthContext"
      )
    ),

    // useParams
    createElement("h3", { id: "useParams" }, "useParams()"),
    createElement("p", null, "React hook to access route parameters."),
    createElement("pre", null,
      createElement("code", null,
        "function useParams(): Record<string, string>"
      )
    ),

    // hydrateCapstanPage
    createElement("h3", { id: "hydrateCapstanPage" }, "hydrateCapstanPage()"),
    createElement("p", null, "Client-side hydration entry point."),
    createElement("pre", null,
      createElement("code", null,
        "function hydrateCapstanPage(): void"
      )
    ),

    // PageContext
    createElement("h3", { id: "PageContext" }, "PageContext"),
    createElement("p", null, "React context for page data."),
    createElement("pre", null,
      createElement("code", null,
        "const PageContext: React.Context<CapstanPageContext>"
      )
    ),

    // Image
    createElement("h3", { id: "Image" }, "Image"),
    createElement("p", null, "Optimized image component with responsive srcset, lazy loading, and blur-up placeholder."),
    createElement("pre", null,
      createElement("code", null,
        "function Image(props: ImageProps): ReactElement\n" +
        "\n" +
        "interface ImageProps {\n" +
        "  src: string;\n" +
        "  alt: string;\n" +
        "  width?: number;\n" +
        "  height?: number;\n" +
        '  priority?: boolean;       // eager loading + fetchpriority="high"\n' +
        "  quality?: number;         // 1-100, default 80\n" +
        '  placeholder?: "blur" | "empty";\n' +
        "  blurDataURL?: string;\n" +
        "  sizes?: string;\n" +
        '  loading?: "lazy" | "eager";\n' +
        "  className?: string;\n" +
        "  style?: Record<string, string | number>;\n" +
        "}"
      )
    ),

    // defineFont
    createElement("h3", { id: "defineFont" }, "defineFont(config)"),
    createElement("p", null, "Configure a font for optimized loading. Returns a className, style object, and CSS variable name."),
    createElement("pre", null,
      createElement("code", null,
        "function defineFont(config: FontConfig): FontResult\n" +
        "\n" +
        "interface FontConfig {\n" +
        "  family: string;\n" +
        "  src?: string;\n" +
        "  weight?: string | number;\n" +
        "  style?: string;\n" +
        '  display?: "auto" | "block" | "swap" | "fallback" | "optional";\n' +
        "  preload?: boolean;\n" +
        "  subsets?: string[];\n" +
        "  variable?: string;\n" +
        "}\n" +
        "\n" +
        "interface FontResult {\n" +
        "  className: string;\n" +
        "  style: { fontFamily: string };\n" +
        "  variable?: string;\n" +
        "}"
      )
    ),

    // fontPreloadLink
    createElement("h3", { id: "fontPreloadLink" }, "fontPreloadLink(config)"),
    createElement("p", null, 'Generate a <link rel="preload"> element for a font.'),
    createElement("pre", null,
      createElement("code", null,
        "function fontPreloadLink(config: FontConfig): ReactElement | null"
      )
    ),

    // defineMetadata
    createElement("h3", { id: "defineMetadata" }, "defineMetadata(metadata)"),
    createElement("p", null, "Define page metadata for SEO, OpenGraph, and Twitter Cards."),
    createElement("pre", null,
      createElement("code", null,
        "function defineMetadata(metadata: Metadata): Metadata\n" +
        "\n" +
        "interface Metadata {\n" +
        "  title?: string | { default: string; template?: string };\n" +
        "  description?: string;\n" +
        "  keywords?: string[];\n" +
        "  robots?: string | { index?: boolean; follow?: boolean };\n" +
        "  openGraph?: {\n" +
        "    title?: string;\n" +
        "    description?: string;\n" +
        "    type?: string;\n" +
        "    url?: string;\n" +
        "    image?: string;\n" +
        "    siteName?: string;\n" +
        "  };\n" +
        "  twitter?: {\n" +
        '    card?: "summary" | "summary_large_image";\n' +
        "    title?: string;\n" +
        "    description?: string;\n" +
        "    image?: string;\n" +
        "  };\n" +
        "  icons?: { icon?: string; apple?: string };\n" +
        "  canonical?: string;\n" +
        "  alternates?: Record<string, string>;\n" +
        "}"
      )
    ),

    // generateMetadataElements
    createElement("h3", { id: "generateMetadataElements" }, "generateMetadataElements(metadata)"),
    createElement("p", null, "Convert a ", createElement("code", null, "Metadata"), " object into an array of React meta/title/link elements for use in <head>."),
    createElement("pre", null,
      createElement("code", null,
        "function generateMetadataElements(metadata: Metadata): ReactElement[]"
      )
    ),

    // mergeMetadata
    createElement("h3", { id: "mergeMetadata" }, "mergeMetadata(parent, child)"),
    createElement("p", null, 'Merge two metadata objects. Child values override parent. Supports title templates: if parent has { template: "%s | Site" } and child has title: "Page", the result is "Page | Site".'),
    createElement("pre", null,
      createElement("code", null,
        "function mergeMetadata(parent: Metadata, child: Metadata): Metadata"
      )
    ),

    // ErrorBoundary
    createElement("h3", { id: "ErrorBoundary" }, "ErrorBoundary"),
    createElement("p", null, "React error boundary component with reset functionality."),
    createElement("pre", null,
      createElement("code", null,
        "class ErrorBoundary extends Component<ErrorBoundaryProps> {}\n" +
        "\n" +
        "interface ErrorBoundaryProps {\n" +
        "  fallback: ReactElement | ((error: Error, reset: () => void) => ReactElement);\n" +
        "  children?: ReactNode;\n" +
        "  onError?: (error: Error, errorInfo: ErrorInfo) => void;\n" +
        "}"
      )
    ),

    // NotFound
    createElement("h3", { id: "NotFound" }, "NotFound"),
    createElement("p", null, "Pre-built 404 component for use with error boundaries or route handlers."),
    createElement("pre", null,
      createElement("code", null,
        "function NotFound(): ReactElement"
      )
    ),

    // RenderMode / RenderStrategy
    createElement("h3", { id: "RenderMode" }, "RenderMode and RenderStrategy"),
    createElement("pre", null,
      createElement("code", null,
        'type RenderMode = "ssr" | "ssg" | "isr" | "streaming"\n' +
        "\n" +
        "interface RenderStrategy {\n" +
        "  render(ctx: RenderStrategyContext): Promise<RenderStrategyResult>\n" +
        "}\n" +
        "\n" +
        "interface RenderStrategyContext {\n" +
        "  options: RenderPageOptions;\n" +
        "  url: string;\n" +
        "  revalidate?: number;\n" +
        "  cacheTags?: string[];\n" +
        "}\n" +
        "\n" +
        "interface RenderStrategyResult extends RenderResult {\n" +
        '  cacheStatus?: "HIT" | "MISS" | "STALE";\n' +
        "}"
      )
    ),

    // SSRStrategy / ISRStrategy / SSGStrategy
    createElement("h3", { id: "render-strategies" }, "Built-in Render Strategies"),
    createElement("p", null, createElement("code", null, "SSRStrategy"), " -- renders the page on every request (default). ", createElement("code", null, "ISRStrategy"), " -- incremental static regeneration with stale-while-revalidate. ", createElement("code", null, "SSGStrategy"), " -- static site generation, serves pre-rendered HTML from the filesystem."),
    createElement("pre", null,
      createElement("code", null,
        "class SSRStrategy implements RenderStrategy {}\n" +
        "class ISRStrategy implements RenderStrategy {}\n" +
        "class SSGStrategy implements RenderStrategy {\n" +
        '  constructor(staticDir?: string)  // default: join(cwd(), "dist", "static")\n' +
        "}"
      )
    ),

    // urlToFilePath
    createElement("h3", { id: "urlToFilePath" }, "urlToFilePath(url, staticDir)"),
    createElement("p", null, "Maps a URL path to its pre-rendered HTML file path. Strips query strings and hash fragments before mapping."),
    createElement("pre", null,
      createElement("code", null,
        "function urlToFilePath(url: string, staticDir: string): string\n" +
        "// / -> {staticDir}/index.html\n" +
        "// /about -> {staticDir}/about/index.html\n" +
        "// /blog/123 -> {staticDir}/blog/123/index.html"
      )
    ),

    // generateStaticParams
    createElement("h3", { id: "generateStaticParams" }, "generateStaticParams"),
    createElement("p", null, 'Page-level export for SSG pages with dynamic route parameters. Returns the list of param sets to pre-render at build time. Required when an SSG page has dynamic params (e.g. [id].page.tsx).'),
    createElement("pre", null,
      createElement("code", null,
        'export const renderMode = "ssg";\n' +
        "export async function generateStaticParams(): Promise<Array<Record<string, string>>> {\n" +
        '  return [{ id: "1" }, { id: "2" }, { id: "3" }];\n' +
        "}"
      )
    ),

    // createStrategy
    createElement("h3", { id: "createStrategy" }, "createStrategy(mode, opts?)"),
    createElement("p", null, "Factory function to create a render strategy instance."),
    createElement("pre", null,
      createElement("code", null,
        "function createStrategy(mode: RenderMode, opts?: { staticDir?: string }): RenderStrategy"
      )
    ),

    // renderPartialStream
    createElement("h3", { id: "renderPartialStream" }, "renderPartialStream(options)"),
    createElement("p", null, "Render a page and its inner layouts without the document shell. Used for client-side navigation payloads."),
    createElement("pre", null,
      createElement("code", null,
        "function renderPartialStream(options: RenderPageOptions): Promise<RenderStreamResult>"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-react/client
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-react-client" }, "@zauso-ai/capstan-react/client"),
    createElement("p", null, "Client-side SPA router, navigation primitives, and prefetching."),
    createElement("pre", null,
      createElement("code", null,
        'import { Link, useNavigate, useRouterState, bootstrapClient } from "@zauso-ai/capstan-react/client";'
      )
    ),

    // Link (client)
    createElement("h3", { id: "Link-client" }, "Link"),
    createElement("p", null, "Navigation link component that renders a standard <a> tag with SPA interception."),
    createElement("pre", null,
      createElement("code", null,
        "function Link(props: LinkProps): ReactElement\n" +
        "\n" +
        "interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {\n" +
        "  href: string;\n" +
        '  prefetch?: PrefetchStrategy;  // default: "hover"\n' +
        "  replace?: boolean;\n" +
        "  scroll?: boolean;             // default: true\n" +
        "}"
      )
    ),

    // CapstanRouter
    createElement("h3", { id: "CapstanRouter" }, "CapstanRouter"),
    createElement("p", null, "Core router class that manages client-side navigation state."),
    createElement("pre", null,
      createElement("code", null,
        "class CapstanRouter {\n" +
        "  readonly state: RouterState;\n" +
        "  navigate(url: string, opts?: NavigateOptions): Promise<void>;\n" +
        "  prefetch(url: string): Promise<void>;\n" +
        "  subscribe(listener: (state: RouterState) => void): () => void;\n" +
        "  destroy(): void;\n" +
        "}"
      )
    ),
    createElement("p", null, "Access via singleton:"),
    createElement("pre", null,
      createElement("code", null,
        'import { getRouter, initRouter } from "@zauso-ai/capstan-react/client";\n' +
        "\n" +
        "const router = getRouter();           // null if not initialized\n" +
        "const router = initRouter(manifest);  // create singleton"
      )
    ),

    // NavigationProvider
    createElement("h3", { id: "NavigationProvider" }, "NavigationProvider"),
    createElement("p", null, "React context provider that bridges the imperative router with React components. Listens for ", createElement("code", null, "capstan:navigate"), " CustomEvents and updates ", createElement("code", null, "PageContext"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function NavigationProvider(props: {\n" +
        "  children: ReactNode;\n" +
        "  initialLoaderData?: unknown;\n" +
        "  initialParams?: Record<string, string>;\n" +
        "  initialAuth?: { isAuthenticated: boolean; type: string };\n" +
        "}): ReactElement"
      )
    ),

    // useRouterState
    createElement("h3", { id: "useRouterState" }, "useRouterState()"),
    createElement("p", null, "React hook that returns the current router state. Re-renders when state changes."),
    createElement("pre", null,
      createElement("code", null,
        "function useRouterState(): RouterState\n" +
        "\n" +
        "interface RouterState {\n" +
        "  url: string;\n" +
        '  status: RouterStatus;  // "idle" | "loading" | "error"\n' +
        "  error?: Error;\n" +
        "}"
      )
    ),

    // useNavigate
    createElement("h3", { id: "useNavigate" }, "useNavigate()"),
    createElement("p", null, "React hook that returns a navigation function."),
    createElement("pre", null,
      createElement("code", null,
        "function useNavigate(): (url: string, opts?: { replace?: boolean; scroll?: boolean }) => void"
      )
    ),

    // bootstrapClient
    createElement("h3", { id: "bootstrapClient" }, "bootstrapClient()"),
    createElement("p", null, "Initialize the client router. Reads ", createElement("code", null, "window.__CAPSTAN_MANIFEST__"), ", creates the router singleton, and sets up global <a> click delegation."),
    createElement("pre", null,
      createElement("code", null,
        "function bootstrapClient(): void"
      )
    ),

    // NavigationCache
    createElement("h3", { id: "NavigationCache" }, "NavigationCache"),
    createElement("p", null, "LRU cache for navigation payloads."),
    createElement("pre", null,
      createElement("code", null,
        "class NavigationCache {\n" +
        "  constructor(maxSize?: number, ttlMs?: number);  // defaults: 50, 5min\n" +
        "  get(url: string): NavigationPayload | undefined;\n" +
        "  set(url: string, payload: NavigationPayload): void;\n" +
        "  has(url: string): boolean;\n" +
        "  delete(url: string): boolean;\n" +
        "  clear(): void;\n" +
        "  readonly size: number;\n" +
        "}"
      )
    ),

    // PrefetchManager
    createElement("h3", { id: "PrefetchManager" }, "PrefetchManager"),
    createElement("p", null, 'Manages link prefetching via IntersectionObserver and pointer events. Strategies: "viewport" (IntersectionObserver, 200px margin), "hover" (80ms delay), "none".'),
    createElement("pre", null,
      createElement("code", null,
        "class PrefetchManager {\n" +
        "  observe(element: Element, strategy: PrefetchStrategy): void;\n" +
        "  unobserve(element: Element): void;\n" +
        "  destroy(): void;\n" +
        "}"
      )
    ),

    // withViewTransition
    createElement("h3", { id: "withViewTransition" }, "withViewTransition(fn)"),
    createElement("p", null, "Wrap DOM mutations in the View Transitions API when supported. Falls back to direct execution."),
    createElement("pre", null,
      createElement("code", null,
        "function withViewTransition(fn: () => void | Promise<void>): Promise<void>"
      )
    ),

    // Client Types
    createElement("h3", { id: "client-types" }, "Client Types"),
    createElement("pre", null,
      createElement("code", null,
        'type RouterStatus = "idle" | "loading" | "error";\n' +
        'type PrefetchStrategy = "none" | "hover" | "viewport";\n' +
        "\n" +
        "interface ClientMetadata {\n" +
        "  title?: string;\n" +
        "  description?: string;\n" +
        "  keywords?: string[];\n" +
        "  robots?: string | { index?: boolean; follow?: boolean };\n" +
        "  canonical?: string;\n" +
        "  openGraph?: Record<string, unknown>;\n" +
        "  twitter?: Record<string, unknown>;\n" +
        "  icons?: Record<string, unknown>;\n" +
        "  alternates?: Record<string, string>;\n" +
        "}\n" +
        "\n" +
        "interface NavigationPayload {\n" +
        "  url: string;\n" +
        "  layoutKey: string;\n" +
        "  html?: string;\n" +
        "  loaderData: unknown;\n" +
        "  metadata?: ClientMetadata;\n" +
        '  componentType: "server" | "client";\n' +
        "}\n" +
        "\n" +
        "interface NavigateOptions {\n" +
        "  replace?: boolean;\n" +
        "  state?: unknown;\n" +
        "  scroll?: boolean;\n" +
        "  noCache?: boolean;\n" +
        "}\n" +
        "\n" +
        "interface ClientRouteEntry {\n" +
        "  urlPattern: string;\n" +
        '  componentType: "server" | "client";\n' +
        "  layouts: string[];\n" +
        "}\n" +
        "\n" +
        "interface ClientRouteManifest {\n" +
        "  routes: ClientRouteEntry[];\n" +
        "}\n" +
        "\n" +
        "interface NavigateEventDetail {\n" +
        "  url: string;\n" +
        "  loaderData: unknown;\n" +
        "  params: Record<string, string>;\n" +
        "  metadata?: ClientMetadata;\n" +
        "}"
      )
    ),

    // Manifest & Scroll Utilities
    createElement("h3", { id: "client-utilities" }, "Manifest and Scroll Utilities"),
    createElement("pre", null,
      createElement("code", null,
        "function getManifest(): ClientRouteManifest | null;\n" +
        "function matchRoute(manifest: ClientRouteManifest, pathname: string): { route: ClientRouteEntry; params: Record<string, string> } | null;\n" +
        "function findSharedLayout(from: string | undefined, to: string): string;\n" +
        "\n" +
        "function generateScrollKey(): string;\n" +
        "function setCurrentScrollKey(key: string): void;\n" +
        "function saveScrollPosition(): void;\n" +
        "function restoreScrollPosition(key: string | null): boolean;\n" +
        "function scrollToTop(): void;"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-dev
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-dev" }, "@zauso-ai/capstan-dev"),
    createElement("p", null, "Development server, Vite build pipeline, and deployment adapters."),

    // createDevServer
    createElement("h3", { id: "createDevServer" }, "createDevServer(config)"),
    createElement("p", null, "Create and start a development server with file watching and live reload."),
    createElement("pre", null,
      createElement("code", null,
        "function createDevServer(config: DevServerConfig): Promise<DevServerInstance>\n" +
        "\n" +
        "interface DevServerConfig {\n" +
        "  port?: number;\n" +
        "  host?: string;\n" +
        "  routesDir: string;\n" +
        "  publicDir?: string;\n" +
        "  stylesDir?: string;\n" +
        "}\n" +
        "\n" +
        "interface DevServerInstance {\n" +
        "  start(): Promise<void>;\n" +
        "  stop(): Promise<void>;\n" +
        "  port: number;\n" +
        "}"
      )
    ),

    // Vite Integration
    createElement("h3", { id: "vite-integration" }, "Vite Integration"),
    createElement("pre", null,
      createElement("code", null,
        "function createViteConfig(config: CapstanViteConfig): Record<string, unknown>\n" +
        "function createViteDevMiddleware(config: CapstanViteConfig): Promise<{ middleware: unknown; close: () => Promise<void> } | null>\n" +
        "function buildClient(config: CapstanViteConfig): Promise<void>\n" +
        "\n" +
        "interface CapstanViteConfig {\n" +
        "  rootDir: string;\n" +
        "  isDev: boolean;\n" +
        '  clientEntry?: string; // default: "app/client.tsx"\n' +
        "}"
      )
    ),

    // buildStaticPages
    createElement("h3", { id: "buildStaticPages" }, "buildStaticPages(options)"),
    createElement("p", null, "Pre-render SSG pages at build time. For each page route with ", createElement("code", null, 'renderMode === "ssg"'), ": static routes render once, dynamic routes call ", createElement("code", null, "generateStaticParams()"), " and render for each param set. Called automatically by ", createElement("code", null, "capstan build --static"), "."),
    createElement("pre", null,
      createElement("code", null,
        "function buildStaticPages(options: BuildStaticOptions): Promise<BuildStaticResult>\n" +
        "\n" +
        "interface BuildStaticOptions {\n" +
        "  rootDir: string;\n" +
        "  outputDir: string;\n" +
        "  manifest: RouteManifest;\n" +
        "}\n" +
        "\n" +
        "interface BuildStaticResult {\n" +
        "  pages: number;\n" +
        "  paths: string[];\n" +
        "  errors: string[];\n" +
        "}"
      )
    ),

    // buildPortableRuntimeApp
    createElement("h3", { id: "buildPortableRuntimeApp" }, "buildPortableRuntimeApp(config)"),
    createElement("p", null, "Build a portable runtime application without filesystem dependencies."),
    createElement("pre", null,
      createElement("code", null,
        "function buildPortableRuntimeApp(config: PortableRuntimeConfig): RuntimeAppBuild"
      )
    ),

    // CSS Pipeline
    createElement("h3", { id: "css-pipeline" }, "CSS Pipeline"),
    createElement("pre", null,
      createElement("code", null,
        "function buildCSS(entryFile: string, outFile: string, isDev?: boolean): Promise<void>\n" +
        "function detectCSSMode(rootDir: string): CSSMode  // \"tailwind\" | \"lightningcss\" | \"none\"\n" +
        "function buildTailwind(entryFile: string, outFile: string): Promise<void>\n" +
        "function startTailwindWatch(entryFile: string, outFile: string): ChildProcess"
      )
    ),

    // Watchers
    createElement("h3", { id: "watchers" }, "File Watchers"),
    createElement("pre", null,
      createElement("code", null,
        "function watchRoutes(routesDir: string, onChange: (event: string, filePath: string) => void): FSWatcher\n" +
        "function watchStyles(stylesDir: string, onChange: (event: string, filePath: string) => void): FSWatcher"
      )
    ),

    // Module Loaders
    createElement("h3", { id: "module-loaders" }, "Module Loaders"),
    createElement("pre", null,
      createElement("code", null,
        "function loadRouteModule(filePath: string): Promise<unknown>\n" +
        "function loadApiHandlers(filePath: string): Promise<Record<string, APIDefinition>>\n" +
        "function loadPageModule(filePath: string): Promise<PageModule>"
      )
    ),

    // Route Middleware
    createElement("h3", { id: "route-middleware" }, "Route Middleware"),
    createElement("pre", null,
      createElement("code", null,
        "function loadRouteMiddleware(filePath: string): Promise<MiddlewareHandler>\n" +
        "function loadRouteMiddlewares(filePaths: string[]): Promise<MiddlewareHandler[]>\n" +
        "function composeRouteMiddlewares(middlewares: MiddlewareHandler[], handler: RouteHandler): RouteHandler\n" +
        "function runRouteMiddlewares(filePaths: string[], args: RouteHandlerArgs, handler: RouteHandler): Promise<Response>"
      )
    ),

    // Virtual Route Modules
    createElement("h3", { id: "virtual-routes" }, "Virtual Route Modules"),
    createElement("p", null, "Register in-memory virtual route modules for testing or dynamic routes."),
    createElement("pre", null,
      createElement("code", null,
        "function registerVirtualRouteModule(filePath: string, mod: unknown): void\n" +
        "function registerVirtualRouteModules(modules: Map<string, unknown>): void\n" +
        "function clearVirtualRouteModules(filePath?: string): void"
      )
    ),

    // Platform Adapters
    createElement("h3", { id: "platform-adapters" }, "Platform Adapters"),
    createElement("pre", null,
      createElement("code", null,
        "function createCloudflareHandler(app: { fetch: (req: Request) => Promise<Response> }): { fetch(...): Promise<Response> }\n" +
        "function createVercelHandler(app: { fetch: (req: Request) => Promise<Response> }): (req: Request) => Promise<Response>\n" +
        "function createVercelNodeHandler(app: { fetch: (req: Request) => Promise<Response> }): (req: IncomingMessage, res: ServerResponse) => Promise<void>\n" +
        "function createFlyAdapter(config?: FlyConfig): ServerAdapter\n" +
        "function createNodeAdapter(): ServerAdapter\n" +
        "function createBunAdapter(): ServerAdapter\n" +
        "\n" +
        "interface FlyConfig {\n" +
        "  primaryRegion?: string;\n" +
        "  replayWrites?: boolean;\n" +
        "}"
      )
    ),

    // Deployment Config Generators
    createElement("h3", { id: "deploy-config-generators" }, "Deployment Config Generators"),
    createElement("pre", null,
      createElement("code", null,
        "function generateWranglerConfig(name: string): string\n" +
        "function generateVercelConfig(): object\n" +
        "function generateFlyToml(config?: FlyConfig): string"
      )
    ),

    // Other dev utilities
    createElement("h3", { id: "dev-utilities" }, "Other Dev Utilities"),
    createElement("pre", null,
      createElement("code", null,
        "function printStartupBanner(config: { port: number; routes: number }): void\n" +
        "function createPageFetch(request: Request, options?: PageFetchOptions): PageFetchClient\n" +
        "\n" +
        "interface PageFetchClient {\n" +
        "  get(path: string, init?: RequestInit): Promise<Response>;\n" +
        "  post(path: string, body?: unknown, init?: RequestInit): Promise<Response>;\n" +
        "  put(path: string, body?: unknown, init?: RequestInit): Promise<Response>;\n" +
        "  delete(path: string, init?: RequestInit): Promise<Response>;\n" +
        "}\n" +
        "\n" +
        "class PageFetchError extends Error {\n" +
        "  method: string;\n" +
        "  url: string;\n" +
        "  phase: string;\n" +
        "  status?: number;\n" +
        "}\n" +
        "\n" +
        "class RouteMiddlewareLoadError extends Error {}\n" +
        "class RouteMiddlewareExportError extends Error {}"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // @zauso-ai/capstan-cli
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "capstan-cli" }, "@zauso-ai/capstan-cli"),
    createElement("p", null, "Command-line interface for development, building, deployment, verification, and operations."),

    // Development commands
    createElement("h3", { id: "cli-dev" }, "Development"),

    createElement("h4", null, "capstan dev"),
    createElement("p", null, "Start development server with live reload."),
    createElement("pre", null,
      createElement("code", null,
        "capstan dev [--port <number>] [--host <string>]"
      )
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Flag"),
          createElement("th", null, "Default"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--port")),
          createElement("td", null, "3000"),
          createElement("td", null, "Server port")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--host")),
          createElement("td", null, "localhost"),
          createElement("td", null, "Server host")
        )
      )
    ),

    createElement("h4", null, "capstan build"),
    createElement("p", null, "Build for production."),
    createElement("pre", null,
      createElement("code", null,
        "capstan build [--static] [--target <target>]"
      )
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Flag"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--static")),
          createElement("td", null, "Pre-render SSG pages")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--target")),
          createElement("td", null, "Build target: node-standalone, docker, vercel-node, vercel-edge, cloudflare, fly")
        )
      )
    ),
    createElement("p", null, "Output: ", createElement("code", null, "dist/"), " with _capstan_server.js, _capstan_manifest.json, openapi.json, deploy-manifest.json, public/."),

    createElement("h4", null, "capstan start"),
    createElement("p", null, "Start production server from built output."),
    createElement("pre", null,
      createElement("code", null,
        "capstan start [--from <dir>] [--port <number>] [--host <string>]"
      )
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Flag"),
          createElement("th", null, "Default"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--from")),
          createElement("td", null, "."),
          createElement("td", null, "Directory containing dist/")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--port")),
          createElement("td", null, "3000"),
          createElement("td", null, "Server port")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--host")),
          createElement("td", null, "0.0.0.0"),
          createElement("td", null, "Server host")
        )
      )
    ),

    // Scaffolding
    createElement("h3", { id: "cli-scaffolding" }, "Scaffolding"),
    createElement("h4", null, "capstan add"),
    createElement("p", null, "Scaffold new components."),
    createElement("pre", null,
      createElement("code", null,
        "capstan add model <name>    # -> app/models/<name>.model.ts\n" +
        "capstan add api <name>      # -> app/routes/<name>/index.api.ts\n" +
        "capstan add page <name>     # -> app/routes/<name>/index.page.tsx\n" +
        "capstan add policy <name>   # -> app/policies/index.ts (appends)"
      )
    ),

    // Database commands
    createElement("h3", { id: "cli-database" }, "Database"),
    createElement("h4", null, "capstan db:migrate"),
    createElement("p", null, "Generate migration SQL from model definitions."),
    createElement("pre", null,
      createElement("code", null,
        "capstan db:migrate --name <migration-name>"
      )
    ),
    createElement("p", null, "Creates timestamped migration file in ", createElement("code", null, "app/migrations/"), "."),

    createElement("h4", null, "capstan db:push"),
    createElement("p", null, "Apply all pending migrations to the database."),
    createElement("pre", null,
      createElement("code", null,
        "capstan db:push"
      )
    ),

    createElement("h4", null, "capstan db:status"),
    createElement("p", null, "Show migration status: applied, pending, and database state."),
    createElement("pre", null,
      createElement("code", null,
        "capstan db:status"
      )
    ),

    // Verification
    createElement("h3", { id: "cli-verify" }, "Verification"),
    createElement("h4", null, "capstan verify"),
    createElement("p", null, "Run 8-step verification cascade or deployment verification."),
    createElement("pre", null,
      createElement("code", null,
        "capstan verify [<path>] [--json] [--deployment] [--target <target>]"
      )
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Flag"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--json")),
          createElement("td", null, "Output structured JSON for AI agents")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--deployment")),
          createElement("td", null, "Verify deployment mode (requires built dist/)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--target")),
          createElement("td", null, "Specific deployment target to verify")
        )
      )
    ),
    createElement("p", null, "Runtime mode cascade: structure -> config -> routes -> models -> typecheck -> contracts -> manifest -> protocols."),
    createElement("p", null, "Deployment mode: validates integrity hashes, target compatibility, database provider, auth config."),

    // Deployment
    createElement("h3", { id: "cli-deploy" }, "Deployment"),
    createElement("h4", null, "capstan deploy:init"),
    createElement("p", null, "Generate root deployment files for a target."),
    createElement("pre", null,
      createElement("code", null,
        "capstan deploy:init [--target <target>] [--force]"
      )
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Flag"),
          createElement("th", null, "Default"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--target")),
          createElement("td", null, "docker"),
          createElement("td", null, "Deployment target: docker, vercel-node, vercel-edge, cloudflare, fly")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "--force")),
          createElement("td", null, "false"),
          createElement("td", null, "Overwrite existing files")
        )
      )
    ),
    createElement("p", null, "Generates platform-specific configs: Dockerfile, vercel.json, wrangler.toml, fly.toml, .dockerignore, .env.example."),

    // Agent / Protocol
    createElement("h3", { id: "cli-agent" }, "Agent / Protocol"),
    createElement("h4", null, "capstan mcp"),
    createElement("p", null, "Start MCP server via stdio for Claude Desktop / Cursor. Scans routes, extracts defineAPI metadata, converts Zod schemas to JSON Schema, and serves MCP tools via stdio."),
    createElement("pre", null,
      createElement("code", null, "capstan mcp")
    ),

    createElement("h4", null, "capstan agent:manifest"),
    createElement("p", null, "Print the agent manifest JSON to stdout."),
    createElement("pre", null,
      createElement("code", null, "capstan agent:manifest")
    ),

    createElement("h4", null, "capstan agent:openapi"),
    createElement("p", null, "Print the OpenAPI 3.1 spec JSON to stdout."),
    createElement("pre", null,
      createElement("code", null, "capstan agent:openapi")
    ),

    // Operations
    createElement("h3", { id: "cli-ops" }, "Operations"),
    createElement("h4", null, "capstan ops:events"),
    createElement("p", null, "List recent ops events."),
    createElement("pre", null,
      createElement("code", null,
        "capstan ops:events [<path>] [--kind <kind>] [--severity <severity>] [--limit <n>] [--since <timestamp>] [--json]"
      )
    ),

    createElement("h4", null, "capstan ops:incidents"),
    createElement("p", null, "List incidents from the ops store."),
    createElement("pre", null,
      createElement("code", null,
        "capstan ops:incidents [<path>] [--status <status>] [--severity <severity>] [--limit <n>] [--since <timestamp>] [--json]"
      )
    ),

    createElement("h4", null, "capstan ops:health"),
    createElement("p", null, "Show derived health snapshot. Reports: status (healthy/degraded/unhealthy), total events, incidents, open incidents, critical/warning counts, top issues."),
    createElement("pre", null,
      createElement("code", null,
        "capstan ops:health [<path>] [--json]"
      )
    ),

    createElement("h4", null, "capstan ops:tail"),
    createElement("p", null, "Show latest ops feed (merged events + incidents). ", createElement("code", null, "--follow"), " polls every 1 second for new items."),
    createElement("pre", null,
      createElement("code", null,
        "capstan ops:tail [<path>] [--limit <n>] [--follow] [--json]"
      )
    ),

    // Harness Runtime
    createElement("h3", { id: "cli-harness" }, "Harness Runtime"),
    createElement("p", null, "Commands for managing durable AI agent runs. All accept ", createElement("code", null, "--root <dir>"), ", ", createElement("code", null, "--grants <json>"), ", ", createElement("code", null, "--subject <json>"), ", ", createElement("code", null, "--json"), "."),
    createElement("pre", null,
      createElement("code", null,
        "capstan harness:list                    # List persisted runs\n" +
        "capstan harness:get <runId>             # Read one run record\n" +
        "capstan harness:events [<runId>]        # Read runtime events\n" +
        "capstan harness:artifacts <runId>       # List artifacts for a run\n" +
        "capstan harness:checkpoint <runId>      # Read loop checkpoint\n" +
        "capstan harness:approval <approvalId>   # Read one approval record\n" +
        "capstan harness:approvals [<runId>]     # List approvals\n" +
        "capstan harness:approve <runId> [--note <text>]  # Approve a blocked run\n" +
        "capstan harness:deny <runId> [--note <text>]     # Deny and cancel\n" +
        "capstan harness:pause <runId>           # Request cooperative pause\n" +
        "capstan harness:cancel <runId>          # Request cancellation\n" +
        "capstan harness:replay <runId>          # Replay events and verify state\n" +
        "capstan harness:paths                   # Print harness filesystem paths"
      )
    ),

    // ════════════════════════════════════════════════════════════════
    // create-capstan-app
    // ════════════════════════════════════════════════════════════════
    createElement("h2", { id: "create-capstan-app" }, "create-capstan-app"),
    createElement("p", null, "Project scaffolder CLI."),

    createElement("h3", { id: "scaffolder-cli" }, "CLI Usage"),
    createElement("pre", null,
      createElement("code", null,
        "# Interactive mode\n" +
        "npx create-capstan-app@beta\n" +
        "\n" +
        "# With project name (prompts for template)\n" +
        "npx create-capstan-app@beta my-app\n" +
        "\n" +
        "# Fully non-interactive\n" +
        "npx create-capstan-app@beta my-app --template blank\n" +
        "npx create-capstan-app@beta my-app --template tickets\n" +
        "\n" +
        "# With deployment target\n" +
        "npx create-capstan-app my-app --template blank --deploy docker\n" +
        "npx create-capstan-app my-app --template tickets --deploy vercel-node\n" +
        "\n" +
        "# Help\n" +
        "npx create-capstan-app@beta --help"
      )
    ),

    createElement("h3", { id: "scaffolder-templates" }, "Templates"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Template"),
          createElement("th", null, "Includes")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "blank")),
          createElement("td", null, "Health check API, home page, root layout, requireAuth policy, AGENTS.md")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "tickets")),
          createElement("td", null, "Everything in blank + Ticket model, CRUD routes, auth config, database config")
        )
      )
    ),

    createElement("h3", { id: "scaffoldProject" }, "scaffoldProject(config)"),
    createElement("p", null, "Programmatic API for the scaffolder."),
    createElement("pre", null,
      createElement("code", null,
        "function scaffoldProject(config: {\n" +
        "  projectName: string;\n" +
        '  template: "blank" | "tickets";\n' +
        "  outputDir: string;\n" +
        "}): Promise<void>"
      )
    ),

    createElement("h3", { id: "deploy-targets" }, "Deploy Target Generation"),
    createElement("pre", null,
      createElement("code", null,
        'type DeployTarget = "none" | "docker" | "vercel-node" | "vercel-edge" | "cloudflare" | "fly"'
      )
    ),

    createElement("h3", { id: "template-generators" }, "Template Generators"),
    createElement("p", null, "Programmatic template content generators for scaffolding:"),
    createElement("pre", null,
      createElement("code", null,
        "function packageJson(projectName: string, template?: Template): string\n" +
        "function tsconfig(): string\n" +
        "function capstanConfig(projectName: string, title: string, template?: Template): string\n" +
        "function rootLayout(title: string): string\n" +
        "function indexPage(title: string, projectName: string, template?: Template): string\n" +
        "function healthApi(): string\n" +
        "function policiesIndex(): string\n" +
        "function gitignore(): string\n" +
        "function dockerfile(): string\n" +
        "function dockerignore(): string\n" +
        "function envExample(): string\n" +
        "function mainCss(): string\n" +
        "function agentsMd(projectName: string, template: Template): string"
      )
    ),

    createElement("p", null, "Template-specific generators (tickets template):"),
    createElement("pre", null,
      createElement("code", null,
        "function ticketModel(): string\n" +
        "function ticketsIndexApi(): string\n" +
        "function ticketByIdApi(): string"
      )
    ),

    createElement("p", null, "Deployment config generators:"),
    createElement("pre", null,
      createElement("code", null,
        "function flyDockerfile(): string\n" +
        "function flyToml(appName: string): string\n" +
        'function vercelConfig(target: "vercel-node" | "vercel-edge"): string\n' +
        "function wranglerConfig(appName: string): string"
      )
    ),

    createElement("h3", { id: "interactive-prompts" }, "Interactive Prompts"),
    createElement("pre", null,
      createElement("code", null,
        "function runPrompts(): Promise<{\n" +
        "  projectName: string;\n" +
        "  template: Template;\n" +
        "  deploy: DeployTarget;\n" +
        "}>\n" +
        "\n" +
        "function detectPackageManagerRuntime(isBun?: boolean): PackageManagerRuntime\n" +
        "\n" +
        "interface PackageManagerRuntime {\n" +
        "  installCommand: string;\n" +
        "  runCommand: string;\n" +
        "  devCommand: string;\n" +
        "}"
      )
    )
  );
}

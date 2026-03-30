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

### Types

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
function createDatabase(config: DatabaseConfig): DatabaseInstance

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

React SSR with loaders, layouts, and hydration.

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

## @zauso-ai/capstan-dev

Development server with file watching and hot reload.

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
npx create-capstan-app

# With project name (prompts for template)
npx create-capstan-app my-app

# Fully non-interactive
npx create-capstan-app my-app --template blank
npx create-capstan-app my-app --template tickets

# Help
npx create-capstan-app --help
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

# Core Concepts

## defineAPI()

`defineAPI()` is the central building block in Capstan. A single call defines a typed API handler that is simultaneously projected to HTTP, MCP, A2A, and OpenAPI.

```typescript
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const POST = defineAPI({
  // Zod schema for request input (validated automatically)
  input: z.object({
    title: z.string().min(1).max(200),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
  }),

  // Zod schema for response output (validated automatically)
  output: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
  }),

  // Human-readable description (used in OpenAPI, MCP, A2A)
  description: "Create a new ticket",

  // Capability mode: "read", "write", or "external"
  capability: "write",

  // Resource name for permission scoping
  resource: "ticket",

  // Policy key applied before the handler runs
  policy: "requireAuth",

  // The handler function
  async handler({ input, ctx }) {
    return {
      id: crypto.randomUUID(),
      title: input.title,
      status: "open",
    };
  },
});
```

### APIDefinition Properties

| Property      | Type                    | Required | Description                                                    |
| ------------- | ----------------------- | -------- | -------------------------------------------------------------- |
| `input`       | `z.ZodType`             | No       | Zod schema for request validation                              |
| `output`      | `z.ZodType`             | No       | Zod schema for response validation                             |
| `description` | `string`                | No       | Human-readable description for agent surfaces                  |
| `capability`  | `"read" \| "write" \| "external"` | No | Capability mode for permission derivation             |
| `resource`    | `string`                | No       | Domain resource this endpoint operates on                      |
| `policy`      | `string`                | No       | Named policy to enforce before handler execution               |
| `handler`     | `(args) => Promise<T>`  | Yes      | Async function receiving `{ input, ctx }` and returning output |

### Handler Context

Every handler receives a `ctx` object of type `CapstanContext`:

```typescript
interface CapstanContext {
  auth: {
    isAuthenticated: boolean;
    type: "human" | "agent" | "anonymous";
    userId?: string;
    role?: string;
    email?: string;
    agentId?: string;
    agentName?: string;
    permissions?: string[];
  };
  request: Request;
  env: Record<string, string | undefined>;
  honoCtx: HonoContext;
}
```

## Multi-Protocol Projection

One `defineAPI()` call simultaneously creates:

```
defineAPI() --> CapabilityRegistry
                  |-- HTTP JSON API (Hono)
                  |-- MCP Tools (@modelcontextprotocol/sdk)
                  |-- A2A Skills (Google Agent-to-Agent)
                  +-- OpenAPI 3.1 Spec
```

### How It Works

1. `defineAPI()` registers the handler in a global API registry
2. `createCapstanApp()` builds a Hono server and mounts each handler as an HTTP route
3. The `CapabilityRegistry` collects all route metadata and projects it:
   - **HTTP**: Input from query params (GET) or JSON body (POST/PUT/PATCH/DELETE), output as JSON response
   - **MCP**: Each route becomes a tool. Tool name is derived from method + path (e.g., `GET /tickets` becomes `get_tickets`). Input schema from Zod is forwarded as tool parameters.
   - **A2A**: Each route becomes a skill. A JSON-RPC handler processes `tasks/send` requests by routing to the matching skill.
   - **OpenAPI**: Each route becomes an operation. Path parameters, query parameters, request bodies, and response schemas are generated from the Zod definitions.

### MCP Transports

Capstan supports two MCP transports:

- **stdio** -- for local tool use with Claude Desktop, Cursor, and similar clients. Start with `npx capstan mcp`.
- **Streamable HTTP** -- for remote MCP access over HTTP. Automatically mounted at `POST /.well-known/mcp` when the dev server starts. Supports session management and server-sent events for streaming responses.

### MCP Client

Capstan can also act as an MCP client, consuming tools from external MCP servers:

```typescript
import { createMcpClient } from "@zauso-ai/capstan-agent";

const client = createMcpClient({
  url: "https://other-service.example.com/.well-known/mcp",
  transport: "streamable-http", // or "stdio"
});

const tools = await client.listTools();
const result = await client.callTool("get_weather", { city: "Tokyo" });
```

This enables composing capabilities from multiple MCP-compatible services within your Capstan handlers.

### LangChain Integration

Export your registered capabilities as LangChain-compatible tools:

```typescript
import { toLangChainTools } from "@zauso-ai/capstan-agent";

const tools = toLangChainTools(registry, {
  filter: (route) => route.capability === "read",
});
// Returns LangChain StructuredTool[] for use with agents/chains
```

### Auto-Generated Endpoints

| Endpoint                         | Protocol   | Description                          |
| -------------------------------- | ---------- | ------------------------------------ |
| `GET /.well-known/capstan.json`  | Capstan    | Agent manifest with all capabilities |
| `GET /.well-known/agent.json`    | A2A        | Agent card with skills list          |
| `POST /.well-known/a2a`         | A2A        | JSON-RPC task handler                |
| `POST /.well-known/mcp`         | MCP        | Streamable HTTP MCP endpoint         |
| `GET /openapi.json`             | OpenAPI    | OpenAPI 3.1 specification            |
| `GET /capstan/approvals`        | Capstan    | Approval workflow management         |

## Semantic Ops

Capstan's runtime can also project structured operational state. Request,
capability, policy, approval, and health lifecycle signals flow through
`createCapstanOpsContext()` in `@zauso-ai/capstan-core`, while
`@zauso-ai/capstan-ops` provides the persistent event, incident, and snapshot
store behind that contract.

At runtime this means:

- core emits normalized semantic events
- dev and portable runtimes attach a project sink automatically
- the sink writes `.capstan/ops/ops.db` at the app root
- the CLI inspects the resulting store through `capstan ops:events`,
  `capstan ops:incidents`, `capstan ops:health`, and `capstan ops:tail`

```typescript
import { createCapstanOpsContext } from "@zauso-ai/capstan-core";

const ops = createCapstanOpsContext({
  appName: "tickets",
  source: "runtime:dev",
});

await ops?.recordRequestStart({
  requestId: "req_123",
  traceId: "trace_123",
  data: {
    method: "GET",
    path: "/tickets",
  },
});
```

The semantic ops layer is intentionally machine-readable. It is designed so a
human operator, an automated verifier, and a coding agent can all reason about
the same event stream and incident ledger without parsing ad hoc logs.

## File-Based Routing

Capstan uses a file-based routing convention in the `app/routes/` directory. The router scans the directory tree and maps files to URL patterns.

### Route Types

| File Pattern        | Route Type  | Description                         |
| ------------------- | ----------- | ----------------------------------- |
| `*.api.ts`          | API         | API handler (exports HTTP methods)  |
| `*.page.tsx`        | Page        | React page component (SSR)          |
| `_layout.tsx`       | Layout      | Wraps nested routes via `<Outlet>` |
| `_middleware.ts`    | Middleware  | Runs before handlers in scope       |
| `_loading.tsx`      | Loading     | Suspense fallback for pages in scope |
| `_error.tsx`        | Error       | Error boundary for pages in scope    |
| `not-found.tsx` / `not-found.page.tsx` | Not Found | Scoped 404 boundary for unknown routes in scope |

Route groups use directory names like `(marketing)` or `(internal)`. They are transparent in the URL, but their `_layout.tsx`, `_middleware.ts`, `_loading.tsx`, `_error.tsx`, and `not-found` files still participate in inheritance.

### URL Mapping Examples

| File Path                              | URL Pattern           |
| -------------------------------------- | --------------------- |
| `app/routes/index.api.ts`             | `/`                   |
| `app/routes/index.page.tsx`           | `/`                   |
| `app/routes/about.page.tsx`           | `/about`              |
| `app/routes/api/health.api.ts`       | `/api/health`         |
| `app/routes/tickets/index.api.ts`    | `/tickets`            |
| `app/routes/tickets/[id].api.ts`     | `/tickets/:id`        |
| `app/routes/orgs/[orgId]/members/[memberId].api.ts` | `/orgs/:orgId/members/:memberId` |
| `app/routes/docs/[...rest].page.tsx` | `/docs/*`             |
| `app/routes/(marketing)/pricing.page.tsx` | `/pricing`       |
| `app/routes/docs/not-found.tsx`      | `/docs` scope fallback |

### Dynamic Segments

Wrap a filename or directory in square brackets to create a dynamic segment:

```
app/routes/tickets/[id].api.ts     -->  /tickets/:id
app/routes/[orgId]/settings.api.ts -->  /:orgId/settings
```

The parameter value is available in `ctx` via the request URL.

### Catch-All Routes

Use the spread syntax `[...param]` for catch-all segments:

```
app/routes/docs/[...path].page.tsx  -->  /docs/* (matches /docs/a, /docs/a/b, etc.)
```

### Not Found Boundaries

`not-found.tsx` and `not-found.page.tsx` define scoped 404 fallbacks. When no page route matches a `GET` or `HEAD` request, Capstan renders the nearest `not-found` file whose directory scope contains the URL.

```
app/routes/not-found.tsx         --> fallback for all unmatched routes
app/routes/docs/not-found.tsx    --> fallback for /docs/*
```

### Layout Nesting

Layouts defined at `_layout.tsx` wrap all routes in the same directory and its subdirectories. Layouts nest from the outermost (root) to the innermost.

```
app/routes/
  _layout.tsx              # Root layout (wraps everything)
  index.page.tsx           # Rendered inside root layout
  admin/
    _layout.tsx            # Admin layout (wraps admin routes)
    index.page.tsx         # Rendered inside root > admin layout
    users.page.tsx         # Rendered inside root > admin layout
```

### Middleware Scoping

`_middleware.ts` files apply to all routes in their directory and subdirectories. Like layouts, middleware chains from outermost to innermost.

```
app/routes/
  _middleware.ts           # Runs for all routes
  api/
    _middleware.ts         # Runs for all /api/* routes (after root middleware)
```

### Loading & Error Conventions

`_loading.tsx` and `_error.tsx` are file conventions that work like layouts — they apply to all pages in their directory and subdirectories, with the nearest file winning.

```
app/routes/
  _loading.tsx               # Default loading UI for all pages
  _error.tsx                 # Default error UI for all pages
  index.page.tsx
  dashboard/
    _loading.tsx             # Dashboard-specific loading (overrides parent)
    index.page.tsx           # Uses dashboard _loading.tsx + root _error.tsx
```

`_loading.tsx` exports a default component used as a `<Suspense>` fallback during streaming SSR:

```typescript
export default function Loading() {
  return <div className="spinner">Loading...</div>;
}
```

`_error.tsx` exports a default component used as an `<ErrorBoundary>` fallback when the page throws:

```typescript
export default function ErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <p>Something went wrong: {error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

The scanner automatically detects these files and wraps the nearest page in `<Suspense>` / `<ErrorBoundary>` during rendering.

## defineMiddleware()

Create middleware that runs in the request pipeline before handlers.

```typescript
import { defineMiddleware } from "@zauso-ai/capstan-core";

// Full form
export default defineMiddleware({
  name: "logging",
  handler: async ({ request, ctx, next }) => {
    console.log(`${request.method} ${request.url}`);
    const start = performance.now();
    const response = await next();
    console.log(`Completed in ${performance.now() - start}ms`);
    return response;
  },
});

// Shorthand (handler function only)
export default defineMiddleware(async ({ request, ctx, next }) => {
  console.log(`${request.method} ${request.url}`);
  return next();
});
```

The middleware receives `{ request, ctx, next }` where:
- `request` is the standard `Request` object
- `ctx` is the `CapstanContext`
- `next()` calls the next middleware or the route handler

## definePolicy()

Policies define permission rules that are evaluated before route handlers. Each policy returns an effect that determines what happens to the request.

```typescript
import { definePolicy } from "@zauso-ai/capstan-core";

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
});

export const requireAdmin = definePolicy({
  key: "requireAdmin",
  title: "Require Admin Role",
  effect: "deny",
  async check({ ctx }) {
    if (ctx.auth.role !== "admin") {
      return { effect: "deny", reason: "Admin role required" };
    }
    return { effect: "allow" };
  },
});

export const approveHighValue = definePolicy({
  key: "approveHighValue",
  title: "Approve High Value Actions",
  effect: "approve",
  async check({ ctx, input }) {
    if (ctx.auth.type === "agent") {
      return {
        effect: "approve",
        reason: "Agent actions on this resource require human approval",
      };
    }
    return { effect: "allow" };
  },
});
```

### Policy Effects

| Effect    | Behavior                                                                      |
| --------- | ----------------------------------------------------------------------------- |
| `allow`   | Request proceeds normally                                                     |
| `deny`    | Request is rejected with 403 Forbidden                                        |
| `approve` | Request is held for human approval (returns 202 with approval ID and poll URL) |
| `redact`  | Request proceeds but response data may be filtered                            |

### Enforcement Order

When multiple policies apply to a route, they are all evaluated (no short-circuiting). The most restrictive effect wins. Severity order from least to most restrictive:

```
allow < redact < approve < deny
```

## Approval Workflow

When a policy returns `{ effect: "approve" }`, the framework creates a pending approval and responds with:

```json
{
  "status": "approval_required",
  "approvalId": "uuid-here",
  "reason": "This action requires approval",
  "pollUrl": "/capstan/approvals/uuid-here"
}
```

### Approval API

| Method | Endpoint                       | Description                         |
| ------ | ------------------------------ | ----------------------------------- |
| GET    | `/capstan/approvals`           | List all approvals (filter by `?status=pending`) |
| GET    | `/capstan/approvals/:id`       | Get a single approval's status      |
| POST   | `/capstan/approvals/:id`       | Resolve: `{ "decision": "approved" }` or `{ "decision": "denied" }` |

When an approval is approved, the original handler is re-executed with the original input and the result is stored on the approval record. Agents can poll the approval endpoint to check status and retrieve the result.

### Approval Lifecycle

```
Request arrives
    |
    v
Policy evaluates to "approve"
    |
    v
Approval created (status: "pending")
    |
    v
202 response with approvalId returned
    |
    +--> Human reviews at /capstan/approvals/:id
    |
    +--> POST { decision: "approved" }
    |        |
    |        v
    |    Original handler re-executed
    |        |
    |        v
    |    Result stored, status: "approved"
    |
    +--> POST { decision: "denied" }
             |
             v
         Status set to "denied"
```

## capstan verify (AI TDD Self-Loop)

The `verify` command runs a 7-step cascade of checks against your application:

```bash
npx capstan verify          # Human-readable output
npx capstan verify --json   # Structured JSON for AI agent consumption
```

### Verification Steps

| Step        | Checks                                                            |
| ----------- | ----------------------------------------------------------------- |
| structure   | Required files exist (capstan.config.ts, app/routes/, package.json, tsconfig.json) |
| config      | Config file loads and has a valid export                          |
| routes      | API files export HTTP method handlers, write endpoints have policies |
| models      | Model files have exports and recognized schema patterns           |
| typecheck   | `tsc --noEmit` passes                                            |
| contracts   | Models match routes, policy references are valid                  |
| manifest    | Agent manifest matches live routes on disk                        |
| protocols   | Cross-protocol contract testing: verifies MCP tool schemas, A2A skill definitions, and OpenAPI spec all stay consistent with the source `defineAPI()` definitions |

Steps are run in order. If an early step fails, dependent steps are skipped.

### JSON Output Format

The `--json` flag produces a `VerifyReport` with:

- `status`: `"passed"` or `"failed"`
- `steps`: Array of step results with diagnostics
- `repairChecklist`: Actionable items with `fixCategory` and `autoFixable` flags
- `summary`: Counts of errors, warnings, passed/failed/skipped steps

Each diagnostic includes:
- `code`: Machine-readable error code (e.g., `"write_missing_policy"`)
- `severity`: `"error"`, `"warning"`, or `"info"`
- `message`: Human-readable description
- `hint`: Suggested fix
- `fixCategory`: One of `type_error`, `schema_mismatch`, `missing_file`, `policy_violation`, `contract_drift`, `missing_export`
- `autoFixable`: Whether the issue can be fixed automatically

This output is designed for AI agents to consume, understand, and act on -- enabling a self-repair loop where the agent runs `verify`, reads the diagnostics, applies fixes, and re-verifies.

## Plugin System

Extend your Capstan app with reusable plugins. A plugin can add routes, policies, and middleware via the setup context.

```typescript
import { definePlugin } from "@zauso-ai/capstan-core";

export default definePlugin({
  name: "my-analytics",
  version: "1.0.0",
  setup(ctx) {
    // Add an API route
    ctx.addRoute("GET", "/analytics/events", {
      description: "List analytics events",
      capability: "read",
      handler: async ({ input, ctx }) => ({ events: [] }),
    });

    // Add a policy
    ctx.addPolicy({
      key: "analyticsAccess",
      title: "Analytics Access",
      effect: "deny",
      async check({ ctx }) {
        if (ctx.auth.role !== "analyst") {
          return { effect: "deny", reason: "Analyst role required" };
        }
        return { effect: "allow" };
      },
    });

    // Add middleware scoped to a path
    ctx.addMiddleware("/analytics", async ({ request, ctx, next }) => {
      console.log("Analytics request:", request.url);
      return next();
    });
  },
});
```

Load plugins in your config:

```typescript
// capstan.config.ts
import { defineConfig } from "@zauso-ai/capstan-core";
import analyticsPlugin from "./plugins/analytics.js";

export default defineConfig({
  plugins: [
    analyticsPlugin,
  ],
});
```

## WebSocket Support

Capstan provides first-class WebSocket support for real-time bidirectional communication. Use `defineWebSocket()` to declare WebSocket endpoints and `WebSocketRoom` for pub/sub messaging.

### Defining a WebSocket Route

```typescript
import { defineWebSocket } from "@zauso-ai/capstan-core";

export const echo = defineWebSocket("/ws/echo", {
  onOpen(ws) {
    console.log("Client connected");
  },
  onMessage(ws, message) {
    ws.send(`echo: ${message}`);
  },
  onClose(ws, code, reason) {
    console.log(`Disconnected: ${code}`);
  },
});
```

The handler receives lifecycle callbacks: `onOpen`, `onMessage`, `onClose`, and `onError`. All callbacks are optional.

### WebSocketRoom (Pub/Sub)

`WebSocketRoom` manages a set of connected clients and provides `broadcast()` for fan-out messaging:

```typescript
import { defineWebSocket, WebSocketRoom } from "@zauso-ai/capstan-core";

const lobby = new WebSocketRoom();

export const chat = defineWebSocket("/ws/chat", {
  onOpen(ws) {
    lobby.join(ws);
    lobby.broadcast(`User joined (${lobby.size} online)`, ws);
  },
  onMessage(ws, msg) {
    lobby.broadcast(String(msg), ws); // Send to everyone except sender
  },
  onClose(ws) {
    lobby.leave(ws);
    lobby.broadcast(`User left (${lobby.size} online)`);
  },
});
```

Rooms are independent -- a client can belong to multiple rooms, and broadcasting in one room does not affect others. The `broadcast()` method automatically skips clients whose connection is no longer open.

### Node.js Adapter

The dev server's Node.js adapter handles WebSocket upgrades automatically using the `ws` package (optional peer dependency). Register routes via `registerWebSocketRoute()` from `@zauso-ai/capstan-dev`.

## EU AI Act Compliance

Capstan provides built-in compliance primitives for the EU AI Act. Use `defineCompliance()` to declare risk level, enable audit logging, and attach transparency metadata.

```typescript
import { defineCompliance } from "@zauso-ai/capstan-core";

defineCompliance({
  riskLevel: "limited",              // "minimal" | "limited" | "high" | "unacceptable"
  auditLog: true,                    // Enable automatic audit logging
  transparency: {
    description: "AI-powered ticket routing system",
    provider: "Acme Corp",
    contact: "compliance@acme.example",
  },
});
```

When `auditLog` is enabled, every `defineAPI()` handler invocation is recorded with timestamp, auth context, capability, and input/output summaries. The audit log is queryable at `GET /capstan/audit` (requires authentication). Use `recordAuditEntry()` for custom entries, `getAuditLog()` to read programmatically, and `clearAuditLog()` for testing.

## OpenTelemetry Tracing

Capstan instruments all protocol surfaces with OpenTelemetry, providing unified tracing across HTTP, MCP, A2A, and OpenAPI requests. Each request produces a trace span tagged with the protocol, route, capability, and auth type.

Enable tracing in the config:

```typescript
export default defineConfig({
  telemetry: {
    enabled: true,
    exporter: "otlp", // "otlp" | "console" | "none"
    endpoint: env("OTEL_EXPORTER_OTLP_ENDPOINT"),
    serviceName: "my-capstan-app",
  },
});
```

Traces include:
- `capstan.protocol`: which protocol surface handled the request (http, mcp, a2a)
- `capstan.route`: the matched route path
- `capstan.capability`: read, write, or external
- `capstan.auth.type`: human, agent, or anonymous
- `capstan.policy.effect`: the policy decision (allow, deny, approve, redact)

## CSS & Styling

Capstan includes a zero-config CSS pipeline that processes stylesheets automatically during development and production builds.

### File Location

Place CSS files in `app/styles/`. The entry point is `app/styles/main.css`, which is processed and served as `/styles.css`.

### Lightning CSS (Default)

By default, Capstan processes CSS with [Lightning CSS](https://lightningcss.dev/), providing:

- **`@import` resolution** -- inline imported CSS files automatically
- **Vendor prefixing** -- add browser prefixes where needed
- **CSS nesting** -- use nested selectors (CSS Nesting spec)
- **Minification** -- compress output in production builds

No configuration required. Write modern CSS and Capstan handles the rest.

### Tailwind CSS (Auto-Detected)

If `app/styles/main.css` contains `@import "tailwindcss"`, Capstan auto-detects Tailwind v4 and runs the Tailwind CLI instead of Lightning CSS:

```css
/* app/styles/main.css */
@import "tailwindcss";
```

Install Tailwind as a project dependency:

```bash
npm install tailwindcss @tailwindcss/cli
```

Tailwind v4 scans your source files automatically -- no `tailwind.config.js` needed.

### Referencing in Layouts

The root layout (or any layout) should include a `<link>` tag pointing to `/styles.css`. Use React 19's `precedence` prop to auto-hoist the tag into `<head>` and prevent FOUC (Flash of Unstyled Content):

```tsx
<link rel="stylesheet" href="/styles.css" precedence="default" />
```

The scaffolded root layout includes this by default. When no layout exists, Capstan's fallback `DocumentShell` also includes the stylesheet link with `precedence="default"`.

### Static CSS

You can also place pre-built CSS files directly in `app/public/` for static serving without processing:

```
app/public/vendor.css  -->  GET /vendor.css
```

## OAuth Providers

Capstan includes built-in OAuth provider helpers for social login with Google and GitHub. The `createOAuthHandlers()` function returns route handlers that manage the full authorization code flow automatically.

```typescript
import { googleProvider, githubProvider, createOAuthHandlers } from "@zauso-ai/capstan-auth";

const oauth = createOAuthHandlers({
  providers: [
    googleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    githubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  sessionSecret: process.env.SESSION_SECRET!,
});

// Mount: GET /auth/login/:provider  and  GET /auth/callback
```

The flow handles CSRF state validation, token exchange, user info retrieval, and JWT session creation. After a successful login, the user receives a `capstan_session` cookie and is redirected to `/`.

## Redis State Backend

By default, Capstan stores approval state, rate limit counters, DPoP replay caches, and audit logs in memory. For production deployments that require persistence or multi-instance sharing, swap to the built-in `RedisStore`:

```typescript
import Redis from "ioredis";
import { RedisStore, setApprovalStore, setRateLimitStore, setDpopReplayStore, setAuditStore } from "@zauso-ai/capstan-core";

const redis = new Redis(process.env.REDIS_URL);

setApprovalStore(new RedisStore(redis, "approvals:"));
setRateLimitStore(new RedisStore(redis, "ratelimit:"));
setDpopReplayStore(new RedisStore(redis, "dpop:"));
setAuditStore(new RedisStore(redis, "audit:"));
```

`RedisStore` implements the `KeyValueStore<T>` interface and supports TTL-based expiration, key enumeration via `keys()`, and configurable key prefixes to avoid collisions when multiple apps share a Redis instance.

## LLM Integration

Capstan includes built-in LLM provider adapters for OpenAI and Anthropic, with a unified interface for chat completion and streaming.

```typescript
import { openaiProvider, anthropicProvider } from "@zauso-ai/capstan-agent";

// OpenAI (or any compatible API)
const openai = openaiProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o",
});

// Anthropic
const claude = anthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: "claude-sonnet-4-20250514",
});

// Unified chat interface
const response = await openai.chat([
  { role: "user", content: "Summarize this ticket" },
], { temperature: 0.3 });

// Streaming (OpenAI provider)
for await (const chunk of openai.stream!([
  { role: "user", content: "Write a summary" },
])) {
  process.stdout.write(chunk.content);
  if (chunk.done) break;
}
```

The `LLMProvider` interface can be implemented for other providers. Both providers support `systemPrompt`, `temperature`, `maxTokens`, and structured `responseFormat` options.

## AI Toolkit (@zauso-ai/capstan-ai)

`@zauso-ai/capstan-ai` is a standalone AI agent toolkit that works independently OR with the Capstan framework. It provides structured reasoning, text generation, scoped memory primitives with pluggable backends, a host-driven agent loop, first-class task execution, and `createHarness()` for browser/filesystem sandboxing. For recurring runs, pair it with `@zauso-ai/capstan-cron`.

### Standalone Usage (No Capstan Required)

```typescript
import { createAI } from "@zauso-ai/capstan-ai";
import { openaiProvider } from "@zauso-ai/capstan-agent";

const ai = createAI({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});
```

### Structured Reasoning with think()

`think()` sends a prompt to the LLM and parses the response against a Zod schema, returning a fully typed result:

```typescript
import { z } from "zod";

const analysis = await ai.think("Classify this support ticket: 'My payment failed'", {
  schema: z.object({
    category: z.enum(["billing", "technical", "account", "other"]),
    priority: z.enum(["low", "medium", "high"]),
    sentiment: z.enum(["positive", "neutral", "negative"]),
  }),
});
// analysis.category === "billing", analysis.priority === "high", etc.
```

### Text Generation with generate()

`generate()` returns raw text from the LLM:

```typescript
const summary = await ai.generate("Summarize this document in 3 bullet points...");
```

Both `think()` and `generate()` have streaming variants -- `thinkStream()` and `generateStream()` -- that yield partial results as the LLM generates tokens.

### Memory System

The memory system provides searchable memory scoped to any entity. The built-in backend is in-memory; persistence depends on the configured backend:

```typescript
// Store memories
await ai.remember("Customer prefers email communication");
await ai.remember("Last order was #4521, shipped 2024-03-15");

// Retrieve relevant memories (hybrid search: vector + keyword + recency)
const memories = await ai.recall("How does the customer want to be contacted?");

// Scope memory to a specific entity
const customerMemory = ai.memory.about("customer", "cust_123");
await customerMemory.remember("VIP customer since 2022");
const relevant = await customerMemory.recall("customer status");

// Build LLM context from memories
const context = await ai.memory.assembleContext({
  query: "customer communication preferences",
  maxTokens: 2000,
});

// Delete a memory
await ai.memory.forget(memoryId);
```

Memory features:
- **Auto-dedup**: memories with >0.92 cosine similarity are merged
- **Hybrid recall**: vector similarity (0.7 weight) + keyword matching (0.3 weight) + recency decay
- **Entity scoping**: `memory.about(type, id)` isolates memory per entity
- **Pluggable backends**: implement `MemoryBackend` for Mem0, Hindsight, Redis, or custom storage

### Agent Loop

The self-orchestrating agent loop is host-driven: the model proposes the next tools or tasks, and the runtime advances turns, persists checkpoints, and folds results back into the next turn until the goal is achieved:

```typescript
const result = await ai.agent.run({
  goal: "Research the customer's recent issues and draft a response email",
  about: ["customer", "cust_123"],
  tools: [searchTickets, getCustomerHistory, draftEmail],
});
```

Agent loop features:
- **Recursion prevention**: tracks `callStack` to avoid infinite loops
- **`beforeToolCall` hook**: enforce policies or require approval before tool execution
- **Configurable iteration limit**: `maxIterations` (default: 10)
- **Entity-scoped memory**: `about` option automatically scopes all memory operations
- **Task-aware turns**: tools and long-running tasks share one orchestration state machine

### Task Fabric

Use tasks when work should outlive a single tool call or run asynchronously before folding back into the next turn:

```typescript
import {
  createShellTask,
  createWorkflowTask,
  createRemoteTask,
  createSubagentTask,
} from "@zauso-ai/capstan-ai";

const result = await ai.agent.run({
  goal: "Run verification, summarize the findings, and hand back a release note",
  tasks: [
    createShellTask({
      name: "verify",
      command: [process.execPath, "-e", "process.stdout.write('tests green')"],
    }),
    createWorkflowTask({
      name: "release-note",
      async handler() {
        return { summary: "Build green and ready to ship." };
      },
    }),
  ],
});
```

Task features:
- **First-class runtime state**: submitted tasks become persisted runtime records rather than ad hoc background promises
- **Mailbox-style continuation**: task completion, failure, and cancellation feed back into the next turn automatically
- **Concurrency contracts**: the host runtime can batch safe work while still preserving deterministic ordering in the transcript
- **Task families**: shell, workflow, remote, and subagent tasks share one contract and can be mixed in a single run
- **Cooperative recovery**: paused or canceled runs cancel in-flight tasks, persist task records, and can replay pending task requests from checkpoints

### Agent Harness Mode

`createHarness()` wraps the agent loop with an isolated runtime substrate that long-running agents typically need:

```typescript
import { createHarness } from "@zauso-ai/capstan-ai";

const harness = await createHarness({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  sandbox: {
    browser: {
      engine: "camoufox",
      platform: "jd",
      accountId: "price-monitor-01",
      guardMode: "vision",
    },
    fs: { rootDir: "./workspace", allowDelete: false },
  },
  verify: { enabled: true },
});

const result = await harness.run({
  goal: "Check the latest product prices and save a summary to workspace/report.md",
});

await harness.destroy();
```

Harness features:
- **Browser sandbox**: Playwright by default, or Camoufox kernel for persistent profiles and advanced anti-detection
- **Filesystem sandbox**: scoped reads/writes with traversal protection
- **Durable runtime**: each run gets a persisted run record, event log, task store, artifact store, and resumable checkpoint under `.capstan/harness/`
- **Lifecycle control**: `startRun()`, `pauseRun()`, `cancelRun()`, `resumeRun()`, `getCheckpoint()`, and `replayRun()` make supervision and recovery explicit
- **Context kernel**: session memory, persisted summaries, long-term runtime memory, artifact-aware context assembly, and transcript compaction all live under `.capstan/harness/`
- **Task fabric**: `getTasks()` exposes persisted task execution records so supervision surfaces can inspect in-flight and settled background work
- **Pluggable sandbox driver**: local isolation by default, with a runtime driver contract for custom execution backends
- **Verification layer**: post-tool validation hooks plus LLM-based pass/fail classification
- **Observability layer**: event stream, metrics, and trace-friendly lifecycle events

### Scheduled Agent Runs (@zauso-ai/capstan-cron)

Use `@zauso-ai/capstan-cron` to submit scheduled runs into a harness runtime. The recommended pattern is to create one durable harness/runtime and let cron act as the trigger layer:

```typescript
import { createCronRunner, createAgentCron } from "@zauso-ai/capstan-cron";
import { createHarness } from "@zauso-ai/capstan-ai";

const harness = await createHarness({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  sandbox: {
    browser: { engine: "camoufox", platform: "jd", accountId: "price-monitor-01" },
    fs: { rootDir: "./workspace" },
  },
  verify: { enabled: true },
});

const runner = createCronRunner();

runner.add(createAgentCron({
  cron: "0 */2 * * *",
  name: "price-monitor",
  goal: "Review price changes and write a fresh report",
  runtime: {
    harness,
  },
}));

runner.start();
```

`createCronRunner()` is an interval-based fallback for Node.js and simple schedules. For timezone-sensitive or complex calendar rules, prefer `createBunCronRunner()` on Bun so the runtime owns the cron semantics.

### Using with Capstan Handlers

When used inside Capstan `defineAPI()` handlers, the AI toolkit integrates with the request context:

```typescript
export const POST = defineAPI({
  // ...
  async handler({ input, ctx }) {
    const analysis = await ctx.think(input.message, {
      schema: z.object({ intent: z.string(), confidence: z.number() }),
    });

    await ctx.remember(`User asked about: ${analysis.intent}`);
    const history = await ctx.recall(input.message);

    return { analysis, relatedHistory: history };
  },
});
```

## Deployment

### Production Build & Start

```bash
npx capstan build    # Compile TS, generate route manifest, production server entry
npx capstan start    # Start the production server
```

### ClientOnly Component

The inverse of `ServerOnly` -- renders its children only in the browser. During SSR, an optional fallback is shown instead:

```typescript
import { ClientOnly } from "@zauso-ai/capstan-react";

export default function Page() {
  return (
    <div>
      <ClientOnly fallback={<p>Loading map...</p>}>
        <InteractiveMap />
      </ClientOnly>
    </div>
  );
}
```

### serverOnly() Guard

A guard function that throws if called in a browser context. Place it at the top of server-only modules to prevent accidental client-side imports:

```typescript
import { serverOnly } from "@zauso-ai/capstan-react";
serverOnly(); // throws "This module is server-only" in browser

export function getDbConnection() { /* ... */ }
```

### Vite Build Pipeline (Optional)

Capstan includes an optional Vite integration for client-side code splitting and HMR. Install `vite` as a peer dependency to enable it:

```bash
npm install vite
```

Use `createViteConfig()` and `buildClient()` from `@zauso-ai/capstan-dev` to configure the pipeline. If Vite is not installed, the functions gracefully degrade.

### Cloudflare Workers

Deploy to Cloudflare Workers using the built-in adapter:

```typescript
import { createCloudflareHandler } from "@zauso-ai/capstan-dev";
import app from "./app.js";

export default createCloudflareHandler(app);
```

Generate a `wrangler.toml` with `generateWranglerConfig("my-app")`.

### Vercel

Deploy to Vercel using either the Edge or Node.js adapter:

```typescript
import { createVercelHandler } from "@zauso-ai/capstan-dev";
export default createVercelHandler(app); // Edge Function
```

Or for Node.js serverless functions, use `createVercelNodeHandler(app)`.

### Fly.io

Deploy to Fly.io with optional write replay support. When running read replicas, mutating requests are automatically replayed to the primary region:

```typescript
import { createFlyAdapter } from "@zauso-ai/capstan-dev";

const adapter = createFlyAdapter({
  primaryRegion: "iad",
  replayWrites: true,
});
```

## Cache Layer & ISR

Capstan includes a built-in cache layer with TTL, tag-based invalidation, and stale-while-revalidate (ISR) support. The cache is used for server-side data caching and incremental static regeneration patterns.

### Basic Usage

```typescript
import { cacheSet, cacheGet, cacheInvalidateTag } from "@zauso-ai/capstan-core";

// Cache data with TTL (in seconds) and tags
await cacheSet("user:123", userData, {
  ttl: 300,           // Expires after 5 minutes
  tags: ["users"],    // Tag for bulk invalidation
});

// Retrieve cached data
const data = await cacheGet("user:123");

// Invalidate all entries with a given tag
await cacheInvalidateTag("users");
```

### Stale-While-Revalidate with `cached()`

The `cached()` decorator wraps an async function with caching. After the TTL expires, the stale value is returned immediately while a background revalidation runs:

```typescript
import { cached } from "@zauso-ai/capstan-core";

const getUsers = cached(async () => {
  return await db.query.users.findMany();
}, {
  ttl: 60,            // Serve stale for up to 60s while revalidating
  tags: ["users"],    // Invalidate with cacheInvalidateTag("users")
});

// First call fetches from DB, subsequent calls return cached value
const users = await getUsers();
```

### ISR (Incremental Static Regeneration)

Use the `revalidate` option in `cacheSet` to enable ISR-style behavior. The cache entry is served stale while being revalidated in the background at the specified interval:

```typescript
await cacheSet("homepage-data", data, {
  ttl: 3600,          // Hard expiry after 1 hour
  revalidate: 60,     // Revalidate every 60 seconds in the background
  tags: ["pages"],
});
```

### Custom Cache Store

By default, the cache uses an in-memory store. For production, swap to a custom `KeyValueStore` implementation (e.g., Redis):

```typescript
import { setCacheStore } from "@zauso-ai/capstan-core";

setCacheStore(new RedisStore(redis, "cache:"));
```

### Response Cache

The response cache is a separate cache layer for full-page HTML output, used by ISR render strategies. It stores `ResponseCacheEntry` objects containing the rendered HTML, headers, status code, and cache tags.

```typescript
import {
  responseCacheGet,
  responseCacheSet,
  responseCacheInvalidateTag,
  responseCacheInvalidate,
  responseCacheClear,
  setResponseCacheStore,
} from "@zauso-ai/capstan-core";

// Retrieve cached response
const result = await responseCacheGet("/blog");
if (result) {
  const { entry, stale } = result;
  // entry.html, entry.statusCode, entry.headers, entry.tags
  // stale = true means the entry is past its revalidateAfter time
}

// Store a page response
await responseCacheSet("/blog", {
  html: renderedHtml,
  headers: { "content-type": "text/html" },
  statusCode: 200,
  createdAt: Date.now(),
  revalidateAfter: Date.now() + 60_000,
  tags: ["blog"],
});

// Invalidate all entries tagged "blog"
const count = await responseCacheInvalidateTag("blog");

// For production, swap the backend store:
setResponseCacheStore(new RedisStore(redis, "resp:"));
```

**Cross-invalidation:** Calling `cacheInvalidateTag("blog")` from the data cache also evicts response cache entries tagged `"blog"`. This means when you invalidate data, the corresponding ISR pages are automatically re-rendered on the next request.

## Render Strategies

Capstan supports multiple rendering strategies controlled by page-level exports.

### RenderMode

Export `renderMode` from a page to control how it's rendered:

| Mode | Behavior |
|------|----------|
| `"ssr"` | Server-render on every request (default) |
| `"isr"` | Incremental Static Regeneration — serve cached HTML, revalidate in background |
| `"ssg"` | Static Site Generation — pre-render at build time via `capstan build --static` |
| `"streaming"` | Streaming SSR with `renderToReadableStream` |

### ISR Example

```typescript
// app/routes/blog/index.page.tsx
import { useLoaderData } from "@zauso-ai/capstan-react";
import type { LoaderArgs } from "@zauso-ai/capstan-react";

export const renderMode = "isr";
export const revalidate = 60;          // seconds
export const cacheTags = ["blog"];

export async function loader({ fetch }: LoaderArgs) {
  return { posts: await fetch.get("/api/posts") };
}

export default function BlogPage() {
  const { posts } = useLoaderData<{ posts: Array<{ id: string; title: string }> }>();
  return (
    <ul>
      {posts.map(p => <li key={p.id}>{p.title}</li>)}
    </ul>
  );
}
```

ISR behavior:
- **Cache HIT (fresh):** Returns cached HTML immediately
- **Cache HIT (stale):** Returns stale HTML immediately, revalidates in background
- **Cache MISS:** Renders the page, stores in response cache, returns HTML

### Strategy Classes

The framework provides three strategy implementations:

- **`SSRStrategy`** — Renders on every request via `renderPage()` or `renderPageStream()`. This is the default.
- **`ISRStrategy`** — Checks response cache first, uses stale-while-revalidate pattern. Falls back to `SSRStrategy` on cache miss.
- **`SSGStrategy`** — Static Site Generation. Serves pre-rendered HTML from `dist/static/`. Falls back to SSR if the file doesn't exist.

Use `createStrategy(mode)` to instantiate:

```typescript
import { createStrategy } from "@zauso-ai/capstan-react";

const strategy = createStrategy("isr");
const result = await strategy.render({ options, url, revalidate: 60, cacheTags: ["blog"] });
// result.cacheStatus: "HIT" | "MISS" | "STALE"
```

### SSG (Static Site Generation)

Export `renderMode: "ssg"` to pre-render a page at build time. For static routes (no params), the page is rendered once. For dynamic routes, export `generateStaticParams()` to provide the param sets:

```typescript
// app/routes/blog/[id].page.tsx
export const renderMode = "ssg";

export async function generateStaticParams() {
  const posts = await fetchAllPosts();
  return posts.map(p => ({ id: String(p.id) }));
  // → pre-renders /blog/1, /blog/2, /blog/3, ...
}

export async function loader({ params }: LoaderArgs) {
  return { post: await fetchPost(params.id) };
}

export default function BlogPost() {
  const { post } = useLoaderData<{ post: Post }>();
  return <article><h1>{post.title}</h1><p>{post.body}</p></article>;
}
```

Build with `capstan build --static` to pre-render SSG pages to `dist/static/`. The production server serves these files directly (no rendering overhead). Pages without pre-rendered files fall back to SSR automatically.

### Hybrid Output

SSR, ISR, and SSG pages can coexist in the same application:

| Page | renderMode | Behavior |
|------|-----------|----------|
| `/` | (default) | Server-rendered on every request |
| `/blog` | `"isr"` | Cached, revalidated every 60s |
| `/blog/:id` | `"ssg"` | Pre-rendered at build time |
| `/dashboard` | `"ssr"` | Always fresh server render |

## Client-Side Navigation

Capstan includes a built-in client-side SPA router that enables instant page transitions without full-page reloads, while maintaining progressive enhancement — everything works without JavaScript.

### `<Link>` Component

```typescript
import { Link } from "@zauso-ai/capstan-react/client";

<Link href="/about">About</Link>
<Link href="/dashboard" prefetch="viewport">Dashboard</Link>
<Link href="/settings" prefetch="none" replace>Settings</Link>
```

`<Link>` renders a standard `<a>` tag. When the client router is active, clicks are intercepted for SPA navigation. Props:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `href` | `string` | — | Target URL (required) |
| `prefetch` | `"none" \| "hover" \| "viewport"` | `"hover"` | When to prefetch |
| `replace` | `boolean` | `false` | Replace history entry |
| `scroll` | `boolean` | `true` | Scroll to top after nav |

All standard HTML anchor attributes are also supported.

### Programmatic Navigation

```typescript
import { useNavigate, useRouterState } from "@zauso-ai/capstan-react/client";

function MyComponent() {
  const navigate = useNavigate();
  const { url, status, error } = useRouterState();

  return (
    <div>
      {status === "loading" && <Spinner />}
      <button onClick={() => navigate("/dashboard", { replace: true })}>
        Go to Dashboard
      </button>
    </div>
  );
}
```

- `useRouterState()` returns `{ url, status, error? }` where `status` is `"idle" | "loading" | "error"`
- `useNavigate()` returns a function `(url, opts?) => void`

### NavigationProvider

Wrap your app root with `<NavigationProvider>` to bridge the imperative router with React:

```typescript
import { NavigationProvider } from "@zauso-ai/capstan-react/client";

function App({ children }) {
  return (
    <NavigationProvider initialLoaderData={loaderData} initialParams={params}>
      {children}
    </NavigationProvider>
  );
}
```

It listens for `capstan:navigate` CustomEvents dispatched by the router and updates the `PageContext` so `useLoaderData()` and `useParams()` reflect the new route.

### How Navigation Works

When the client router navigates to a new page:

1. **Request:** Fetch the URL with `X-Capstan-Nav: 1` header — the server returns a JSON `NavigationPayload` instead of full HTML
2. **Server components:** The outlet HTML is morphed in-place using idiomorph, preserving layout stability via `data-capstan-layout` / `data-capstan-outlet` attributes
3. **Client components:** A `capstan:navigate` CustomEvent triggers React reconciliation through `NavigationProvider`
4. **History:** `pushState` (or `replaceState`) updates the URL
5. **Scroll:** Scrolls to top (configurable) or restores previous position on back/forward

### Prefetching

The `PrefetchManager` handles two strategies:

- **`"hover"`** (default) — Prefetches after 80ms hover on a `<Link>`. Cancelled if the pointer leaves.
- **`"viewport"`** — Prefetches when a `<Link>` enters the viewport (IntersectionObserver with 200px margin).

Prefetched payloads are stored in a `NavigationCache` (LRU, max 50 entries, 5-minute TTL).

### Scroll Restoration

Scroll positions are saved to `sessionStorage` keyed by a unique scroll key stored in `history.state`. Back/forward navigation automatically restores the previous scroll position.

### View Transitions

DOM mutations during navigation are wrapped in `document.startViewTransition()` when the browser supports it. This gives smooth cross-fade animations between pages with zero configuration. On unsupported browsers, navigation works normally without animation.

### Bootstrap

Call `bootstrapClient()` once at page load to initialize the router:

```typescript
import { bootstrapClient } from "@zauso-ai/capstan-react/client";

bootstrapClient();
```

This reads the `window.__CAPSTAN_MANIFEST__` (injected by the server), creates the router singleton, and sets up global `<a>` click delegation. All internal links automatically get SPA navigation.

To opt out for a specific link, add `data-capstan-external`:

```html
<a href="/legacy-page" data-capstan-external>Full page reload</a>
```

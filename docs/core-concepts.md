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

## File-Based Routing

Capstan uses a file-based routing convention in the `app/routes/` directory. The router scans the directory tree and maps files to URL patterns.

### Route Types

| File Pattern        | Route Type  | Description                         |
| ------------------- | ----------- | ----------------------------------- |
| `*.api.ts`          | API         | API handler (exports HTTP methods)  |
| `*.page.tsx`        | Page        | React page component (SSR)          |
| `_layout.tsx`       | Layout      | Wraps nested routes via `<Outlet>` |
| `_middleware.ts`    | Middleware  | Runs before handlers in scope       |

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

`@zauso-ai/capstan-ai` is a standalone AI agent toolkit that works independently OR with the Capstan framework. It provides structured reasoning, text generation, persistent memory, and a self-orchestrating agent loop.

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

The memory system provides persistent, searchable memory scoped to any entity:

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

The self-orchestrating agent loop reasons about a goal, selects and executes tools, and repeats until the goal is achieved:

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

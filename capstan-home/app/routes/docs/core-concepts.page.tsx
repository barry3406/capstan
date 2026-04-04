import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function CoreConcepts() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "Core Concepts"),

    // ── defineAPI() ─────────────────────────────────────────────────
    createElement("h2", null, "defineAPI()"),
    createElement("p", null,
      createElement("code", null, "defineAPI()"),
      " is the central building block in Capstan. A single call defines a typed API handler that is simultaneously projected to HTTP, MCP, A2A, and OpenAPI."
    ),
    createElement("pre", null,
      createElement("code", null,
`import { defineAPI } from "@zauso-ai/capstan-core";
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
});`
      )
    ),

    createElement("h3", null, "APIDefinition Properties"),
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
          createElement("td", null, createElement("code", null, "input")),
          createElement("td", null, createElement("code", null, "z.ZodType")),
          createElement("td", null, "No"),
          createElement("td", null, "Zod schema for request validation")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "output")),
          createElement("td", null, createElement("code", null, "z.ZodType")),
          createElement("td", null, "No"),
          createElement("td", null, "Zod schema for response validation")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "description")),
          createElement("td", null, createElement("code", null, "string")),
          createElement("td", null, "No"),
          createElement("td", null, "Human-readable description for agent surfaces")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capability")),
          createElement("td", null, createElement("code", null, '"read" | "write" | "external"')),
          createElement("td", null, "No"),
          createElement("td", null, "Capability mode for permission derivation")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "resource")),
          createElement("td", null, createElement("code", null, "string")),
          createElement("td", null, "No"),
          createElement("td", null, "Domain resource this endpoint operates on")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "policy")),
          createElement("td", null, createElement("code", null, "string")),
          createElement("td", null, "No"),
          createElement("td", null, "Named policy to enforce before handler execution")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "handler")),
          createElement("td", null, createElement("code", null, "(args) => Promise<T>")),
          createElement("td", null, "Yes"),
          createElement("td", null, "Async function receiving { input, ctx } and returning output")
        )
      )
    ),

    // ── Handler Context ─────────────────────────────────────────────
    createElement("h2", null, "Handler Context"),
    createElement("p", null, "Every handler receives a ", createElement("code", null, "ctx"), " object of type ", createElement("code", null, "CapstanContext"), ":"),
    createElement("pre", null,
      createElement("code", null,
`interface CapstanContext {
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
}`
      )
    ),

    // ── Multi-Protocol Projection ───────────────────────────────────
    createElement("h2", null, "Multi-Protocol Projection"),
    createElement("p", null, "One ", createElement("code", null, "defineAPI()"), " call simultaneously creates endpoints across four protocols:"),
    createElement("pre", null,
      createElement("code", null,
`defineAPI() --> CapabilityRegistry
                  |-- HTTP JSON API (Hono)
                  |-- MCP Tools (@modelcontextprotocol/sdk)
                  |-- A2A Skills (Google Agent-to-Agent)
                  +-- OpenAPI 3.1 Spec`
      )
    ),

    createElement("h3", null, "How It Works"),
    createElement("ol", null,
      createElement("li", null, createElement("code", null, "defineAPI()"), " registers the handler in a global API registry."),
      createElement("li", null, createElement("code", null, "createCapstanApp()"), " builds a Hono server and mounts each handler as an HTTP route."),
      createElement("li", null, "The ", createElement("code", null, "CapabilityRegistry"), " collects all route metadata and projects it:"),
    ),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, "HTTP"), " -- Input from query params (GET) or JSON body (POST/PUT/PATCH/DELETE), output as JSON response."),
      createElement("li", null, createElement("strong", null, "MCP"), " -- Each route becomes a tool. Tool name is derived from method + path (e.g., ", createElement("code", null, "GET /tickets"), " becomes ", createElement("code", null, "get_tickets"), "). Input schema from Zod is forwarded as tool parameters."),
      createElement("li", null, createElement("strong", null, "A2A"), " -- Each route becomes a skill. A JSON-RPC handler processes ", createElement("code", null, "tasks/send"), " requests by routing to the matching skill."),
      createElement("li", null, createElement("strong", null, "OpenAPI"), " -- Each route becomes an operation. Path parameters, query parameters, request bodies, and response schemas are generated from the Zod definitions.")
    ),

    createElement("h3", null, "MCP Transports"),
    createElement("p", null, "Capstan supports two MCP transports:"),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, "stdio"), " -- for local tool use with Claude Desktop, Cursor, and similar clients. Start with ", createElement("code", null, "npx capstan mcp"), "."),
      createElement("li", null, createElement("strong", null, "Streamable HTTP"), " -- for remote MCP access over HTTP. Automatically mounted at ", createElement("code", null, "POST /.well-known/mcp"), " when the dev server starts. Supports session management and server-sent events for streaming responses.")
    ),

    createElement("h3", null, "MCP Client"),
    createElement("p", null, "Capstan can also act as an MCP client, consuming tools from external MCP servers:"),
    createElement("pre", null,
      createElement("code", null,
`import { createMcpClient } from "@zauso-ai/capstan-agent";

const client = createMcpClient({
  url: "https://other-service.example.com/.well-known/mcp",
  transport: "streamable-http", // or "stdio"
});

const tools = await client.listTools();
const result = await client.callTool("get_weather", { city: "Tokyo" });`
      )
    ),

    createElement("h3", null, "LangChain Integration"),
    createElement("p", null, "Export your registered capabilities as LangChain-compatible tools:"),
    createElement("pre", null,
      createElement("code", null,
`import { toLangChainTools } from "@zauso-ai/capstan-agent";

const tools = toLangChainTools(registry, {
  filter: (route) => route.capability === "read",
});
// Returns LangChain StructuredTool[] for use with agents/chains`
      )
    ),

    createElement("h3", null, "Auto-Generated Endpoints"),
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

    // ── Semantic Ops ────────────────────────────────────────────────
    createElement("h2", null, "Semantic Ops"),
    createElement("p", null,
      "Capstan's runtime projects structured operational state. Request, capability, policy, approval, and health lifecycle signals flow through ",
      createElement("code", null, "createCapstanOpsContext()"),
      " in ",
      createElement("code", null, "@zauso-ai/capstan-core"),
      ", while ",
      createElement("code", null, "@zauso-ai/capstan-ops"),
      " provides the persistent event, incident, and snapshot store."
    ),
    createElement("pre", null,
      createElement("code", null,
`import { createCapstanOpsContext } from "@zauso-ai/capstan-core";

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
});`
      )
    ),
    createElement("p", null,
      "At runtime: core emits normalized semantic events, dev and portable runtimes attach a project sink automatically, the sink writes ",
      createElement("code", null, ".capstan/ops/ops.db"),
      " at the app root, and the CLI inspects the resulting store through ",
      createElement("code", null, "capstan ops:events"),
      ", ",
      createElement("code", null, "capstan ops:incidents"),
      ", ",
      createElement("code", null, "capstan ops:health"),
      ", and ",
      createElement("code", null, "capstan ops:tail"),
      "."
    ),

    // ── File-Based Routing ──────────────────────────────────────────
    createElement("h2", null, "File-Based Routing"),
    createElement("p", null, "Capstan uses a file-based routing convention in the ", createElement("code", null, "app/routes/"), " directory. The router scans the directory tree and maps files to URL patterns."),

    createElement("h3", null, "Route Types"),
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
          createElement("td", null, "Suspense fallback for pages in scope")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "_error.tsx")),
          createElement("td", null, "Error"),
          createElement("td", null, "Error boundary for pages in scope")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "not-found.tsx")),
          createElement("td", null, "Not Found"),
          createElement("td", null, "Scoped 404 boundary for unknown routes in scope")
        )
      )
    ),

    createElement("h3", null, "URL Mapping Examples"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "File Path"),
          createElement("th", null, "URL Pattern")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "app/routes/index.api.ts")),
          createElement("td", null, createElement("code", null, "/"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "app/routes/index.page.tsx")),
          createElement("td", null, createElement("code", null, "/"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "app/routes/about.page.tsx")),
          createElement("td", null, createElement("code", null, "/about"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "app/routes/api/health.api.ts")),
          createElement("td", null, createElement("code", null, "/api/health"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "app/routes/tickets/[id].api.ts")),
          createElement("td", null, createElement("code", null, "/tickets/:id"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "app/routes/orgs/[orgId]/members/[memberId].api.ts")),
          createElement("td", null, createElement("code", null, "/orgs/:orgId/members/:memberId"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "app/routes/docs/[...rest].page.tsx")),
          createElement("td", null, createElement("code", null, "/docs/*"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "app/routes/(marketing)/pricing.page.tsx")),
          createElement("td", null, createElement("code", null, "/pricing"))
        )
      )
    ),

    createElement("h3", null, "Dynamic Segments"),
    createElement("p", null, "Wrap a filename or directory in square brackets to create a dynamic segment:"),
    createElement("pre", null,
      createElement("code", null,
`app/routes/tickets/[id].api.ts     -->  /tickets/:id
app/routes/[orgId]/settings.api.ts -->  /:orgId/settings`
      )
    ),

    createElement("h3", null, "Catch-All Routes"),
    createElement("p", null, "Use the spread syntax ", createElement("code", null, "[...param]"), " for catch-all segments:"),
    createElement("pre", null,
      createElement("code", null,
`app/routes/docs/[...path].page.tsx  -->  /docs/* (matches /docs/a, /docs/a/b, etc.)`
      )
    ),

    createElement("h3", null, "Route Groups"),
    createElement("p", null, "Route groups use directory names like ", createElement("code", null, "(marketing)"), " or ", createElement("code", null, "(internal)"), ". They are transparent in the URL, but their ", createElement("code", null, "_layout.tsx"), ", ", createElement("code", null, "_middleware.ts"), ", ", createElement("code", null, "_loading.tsx"), ", ", createElement("code", null, "_error.tsx"), ", and ", createElement("code", null, "not-found"), " files still participate in inheritance."),

    createElement("h3", null, "Not Found Boundaries"),
    createElement("p", null, createElement("code", null, "not-found.tsx"), " and ", createElement("code", null, "not-found.page.tsx"), " define scoped 404 fallbacks. When no page route matches a GET or HEAD request, Capstan renders the nearest not-found file whose directory scope contains the URL:"),
    createElement("pre", null,
      createElement("code", null,
`app/routes/not-found.tsx         --> fallback for all unmatched routes
app/routes/docs/not-found.tsx    --> fallback for /docs/*`
      )
    ),

    // ── Layouts ─────────────────────────────────────────────────────
    createElement("h2", null, "Layouts"),
    createElement("p", null, "Layouts defined at ", createElement("code", null, "_layout.tsx"), " wrap all routes in the same directory and its subdirectories. Layouts nest from the outermost (root) to the innermost."),
    createElement("pre", null,
      createElement("code", null,
`app/routes/
  _layout.tsx              # Root layout (wraps everything)
  index.page.tsx           # Rendered inside root layout
  admin/
    _layout.tsx            # Admin layout (wraps admin routes)
    index.page.tsx         # Rendered inside root > admin layout
    users.page.tsx         # Rendered inside root > admin layout`
      )
    ),
    createElement("p", null, "A layout component uses ", createElement("code", null, "Outlet"), " to render its children:"),
    createElement("pre", null,
      createElement("code", null,
`import { createElement } from "react";
import { Outlet } from "@zauso-ai/capstan-react";

export default function AdminLayout() {
  return createElement("div", { className: "admin-shell" },
    createElement("nav", null, "Admin Sidebar"),
    createElement(Outlet, null)
  );
}`
      )
    ),

    // ── Loading & Error Conventions ─────────────────────────────────
    createElement("h3", null, "Loading & Error Conventions"),
    createElement("p", null, createElement("code", null, "_loading.tsx"), " and ", createElement("code", null, "_error.tsx"), " work like layouts -- they apply to all pages in their directory and subdirectories, with the nearest file winning."),
    createElement("pre", null,
      createElement("code", null,
`// _loading.tsx -- used as <Suspense> fallback during streaming SSR
export default function Loading() {
  return <div className="spinner">Loading...</div>;
}

// _error.tsx -- used as <ErrorBoundary> fallback when the page throws
export default function ErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <p>Something went wrong: {error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}`
      )
    ),

    // ── Middleware ───────────────────────────────────────────────────
    createElement("h2", null, "Middleware"),
    createElement("p", null, createElement("code", null, "_middleware.ts"), " files apply to all routes in their directory and subdirectories. Like layouts, middleware chains from outermost to innermost."),
    createElement("pre", null,
      createElement("code", null,
`app/routes/
  _middleware.ts           # Runs for all routes
  api/
    _middleware.ts         # Runs for all /api/* routes (after root middleware)`
      )
    ),
    createElement("p", null, "Create middleware with ", createElement("code", null, "defineMiddleware()"), ":"),
    createElement("pre", null,
      createElement("code", null,
`import { defineMiddleware } from "@zauso-ai/capstan-core";

// Full form
export default defineMiddleware({
  name: "logging",
  handler: async ({ request, ctx, next }) => {
    console.log(\`\${request.method} \${request.url}\`);
    const start = performance.now();
    const response = await next();
    console.log(\`Completed in \${performance.now() - start}ms\`);
    return response;
  },
});

// Shorthand (handler function only)
export default defineMiddleware(async ({ request, ctx, next }) => {
  console.log(\`\${request.method} \${request.url}\`);
  return next();
});`
      )
    ),
    createElement("p", null, "The middleware receives ", createElement("code", null, "{ request, ctx, next }"), " where ", createElement("code", null, "request"), " is the standard Request object, ", createElement("code", null, "ctx"), " is the CapstanContext, and ", createElement("code", null, "next()"), " calls the next middleware or the route handler."),

    // ── Loaders ─────────────────────────────────────────────────────
    createElement("h2", null, "Loaders"),
    createElement("p", null, "Use loaders to fetch data on the server for SSR pages. Export a ", createElement("code", null, "loader"), " function and read the data with ", createElement("code", null, "useLoaderData"), ":"),
    createElement("pre", null,
      createElement("code", null,
`import { useLoaderData } from "@zauso-ai/capstan-react";
import type { LoaderArgs } from "@zauso-ai/capstan-react";

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
}`
      )
    ),

    // ── Policies ────────────────────────────────────────────────────
    createElement("h2", null, "Policies"),
    createElement("p", null, "Policies define permission rules that are evaluated before route handlers. Each policy returns an effect that determines what happens to the request."),
    createElement("pre", null,
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
});`
      )
    ),

    createElement("h3", null, "Policy Effects"),
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
          createElement("td", null, "Request is held for human approval (returns 202 with approval ID and poll URL)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "redact")),
          createElement("td", null, "Request proceeds but response data may be filtered")
        )
      )
    ),
    createElement("h3", null, "Enforcement Order"),
    createElement("p", null, "When multiple policies apply to a route, they are all evaluated (no short-circuiting). The most restrictive effect wins. Severity order from least to most restrictive:"),
    createElement("pre", null,
      createElement("code", null, "allow < redact < approve < deny")
    ),

    // ── Approval Workflow ───────────────────────────────────────────
    createElement("h2", null, "Approval Workflow"),
    createElement("p", null, "When a policy returns ", createElement("code", null, '{ effect: "approve" }'), ", the framework creates a pending approval and responds with:"),
    createElement("pre", null,
      createElement("code", null,
`{
  "status": "approval_required",
  "approvalId": "uuid-here",
  "reason": "This action requires approval",
  "pollUrl": "/capstan/approvals/uuid-here"
}`
      )
    ),

    createElement("h3", null, "Approval API"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Method"),
          createElement("th", null, "Endpoint"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, "GET"),
          createElement("td", null, createElement("code", null, "/capstan/approvals")),
          createElement("td", null, "List all approvals (filter by ?status=pending)")
        ),
        createElement("tr", null,
          createElement("td", null, "GET"),
          createElement("td", null, createElement("code", null, "/capstan/approvals/:id")),
          createElement("td", null, "Get a single approval's status")
        ),
        createElement("tr", null,
          createElement("td", null, "POST"),
          createElement("td", null, createElement("code", null, "/capstan/approvals/:id")),
          createElement("td", null, 'Resolve: { "decision": "approved" } or { "decision": "denied" }')
        )
      )
    ),

    createElement("h3", null, "Approval Lifecycle"),
    createElement("pre", null,
      createElement("code", null,
`Request arrives
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
         Status set to "denied"`
      )
    ),

    // ── capstan verify ──────────────────────────────────────────────
    createElement("h2", null, "capstan verify (AI TDD Self-Loop)"),
    createElement("p", null, "The ", createElement("code", null, "verify"), " command runs a 7-step cascade of checks against your application:"),
    createElement("pre", null,
      createElement("code", null,
`npx capstan verify          # Human-readable output
npx capstan verify --json   # Structured JSON for AI agent consumption`
      )
    ),

    createElement("h3", null, "Verification Steps"),
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
          createElement("td", null, "Required files exist (capstan.config.ts, app/routes/, package.json, tsconfig.json)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "config")),
          createElement("td", null, "Config file loads and has a valid export")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "routes")),
          createElement("td", null, "API files export HTTP method handlers, write endpoints have policies")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "models")),
          createElement("td", null, "Model files have exports and recognized schema patterns")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "typecheck")),
          createElement("td", null, "tsc --noEmit passes")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "contracts")),
          createElement("td", null, "Models match routes, policy references are valid")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "manifest")),
          createElement("td", null, "Agent manifest matches live routes on disk")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "protocols")),
          createElement("td", null, "Cross-protocol contract testing: verifies MCP tool schemas, A2A skill definitions, and OpenAPI spec all stay consistent with the source defineAPI() definitions")
        )
      )
    ),
    createElement("p", null, "Steps are run in order. If an early step fails, dependent steps are skipped."),

    createElement("h3", null, "JSON Output Format"),
    createElement("p", null, "The ", createElement("code", null, "--json"), " flag produces a ", createElement("code", null, "VerifyReport"), " with:"),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "status"), ": \"passed\" or \"failed\""),
      createElement("li", null, createElement("code", null, "steps"), ": Array of step results with diagnostics"),
      createElement("li", null, createElement("code", null, "repairChecklist"), ": Actionable items with ", createElement("code", null, "fixCategory"), " and ", createElement("code", null, "autoFixable"), " flags"),
      createElement("li", null, createElement("code", null, "summary"), ": Counts of errors, warnings, passed/failed/skipped steps")
    ),
    createElement("p", null, "Each diagnostic includes:"),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "code"), " -- Machine-readable error code (e.g., ", createElement("code", null, '"write_missing_policy"'), ")"),
      createElement("li", null, createElement("code", null, "severity"), " -- \"error\", \"warning\", or \"info\""),
      createElement("li", null, createElement("code", null, "message"), " -- Human-readable description"),
      createElement("li", null, createElement("code", null, "hint"), " -- Suggested fix"),
      createElement("li", null, createElement("code", null, "fixCategory"), " -- One of type_error, schema_mismatch, missing_file, policy_violation, contract_drift, missing_export"),
      createElement("li", null, createElement("code", null, "autoFixable"), " -- Whether the issue can be fixed automatically")
    ),
    createElement("p", null, "This output is designed for AI agents to consume, understand, and act on -- enabling a self-repair loop where the agent runs verify, reads the diagnostics, applies fixes, and re-verifies."),

    // ── Plugin System ───────────────────────────────────────────────
    createElement("h2", null, "Plugin System"),
    createElement("p", null, "Extend your Capstan app with reusable plugins. A plugin can add routes, policies, and middleware via the setup context."),
    createElement("pre", null,
      createElement("code", null,
`import { definePlugin } from "@zauso-ai/capstan-core";

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
});`
      )
    ),
    createElement("p", null, "Load plugins in your config:"),
    createElement("pre", null,
      createElement("code", null,
`// capstan.config.ts
import { defineConfig } from "@zauso-ai/capstan-core";
import analyticsPlugin from "./plugins/analytics.js";

export default defineConfig({
  plugins: [
    analyticsPlugin,
  ],
});`
      )
    ),

    // ── WebSocket Support ───────────────────────────────────────────
    createElement("h2", null, "WebSocket Support"),
    createElement("p", null, "Capstan provides first-class WebSocket support for real-time bidirectional communication. Use ", createElement("code", null, "defineWebSocket()"), " to declare WebSocket endpoints and ", createElement("code", null, "WebSocketRoom"), " for pub/sub messaging."),

    createElement("h3", null, "Defining a WebSocket Route"),
    createElement("pre", null,
      createElement("code", null,
`import { defineWebSocket } from "@zauso-ai/capstan-core";

export const echo = defineWebSocket("/ws/echo", {
  onOpen(ws) {
    console.log("Client connected");
  },
  onMessage(ws, message) {
    ws.send(\`echo: \${message}\`);
  },
  onClose(ws, code, reason) {
    console.log(\`Disconnected: \${code}\`);
  },
});`
      )
    ),

    createElement("h3", null, "WebSocketRoom (Pub/Sub)"),
    createElement("p", null, createElement("code", null, "WebSocketRoom"), " manages a set of connected clients and provides ", createElement("code", null, "broadcast()"), " for fan-out messaging:"),
    createElement("pre", null,
      createElement("code", null,
`import { defineWebSocket, WebSocketRoom } from "@zauso-ai/capstan-core";

const lobby = new WebSocketRoom();

export const chat = defineWebSocket("/ws/chat", {
  onOpen(ws) {
    lobby.join(ws);
    lobby.broadcast(\`User joined (\${lobby.size} online)\`, ws);
  },
  onMessage(ws, msg) {
    lobby.broadcast(String(msg), ws); // Send to everyone except sender
  },
  onClose(ws) {
    lobby.leave(ws);
    lobby.broadcast(\`User left (\${lobby.size} online)\`);
  },
});`
      )
    ),
    createElement("p", null, "Rooms are independent -- a client can belong to multiple rooms, and broadcasting in one room does not affect others. The ", createElement("code", null, "broadcast()"), " method automatically skips clients whose connection is no longer open."),

    // ── EU AI Act Compliance ────────────────────────────────────────
    createElement("h2", null, "EU AI Act Compliance"),
    createElement("p", null, "Capstan provides built-in compliance primitives for the EU AI Act. Use ", createElement("code", null, "defineCompliance()"), " to declare risk level, enable audit logging, and attach transparency metadata."),
    createElement("pre", null,
      createElement("code", null,
`import { defineCompliance } from "@zauso-ai/capstan-core";

defineCompliance({
  riskLevel: "limited",              // "minimal" | "limited" | "high" | "unacceptable"
  auditLog: true,                    // Enable automatic audit logging
  transparency: {
    description: "AI-powered ticket routing system",
    provider: "Acme Corp",
    contact: "compliance@acme.example",
  },
});`
      )
    ),
    createElement("p", null, "When ", createElement("code", null, "auditLog"), " is enabled, every ", createElement("code", null, "defineAPI()"), " handler invocation is recorded with timestamp, auth context, capability, and input/output summaries. The audit log is queryable at ", createElement("code", null, "GET /capstan/audit"), " (requires authentication). Use ", createElement("code", null, "recordAuditEntry()"), " for custom entries, ", createElement("code", null, "getAuditLog()"), " to read programmatically, and ", createElement("code", null, "clearAuditLog()"), " for testing."),

    // ── OpenTelemetry Tracing ───────────────────────────────────────
    createElement("h2", null, "OpenTelemetry Tracing"),
    createElement("p", null, "Capstan instruments all protocol surfaces with OpenTelemetry, providing unified tracing across HTTP, MCP, A2A, and OpenAPI requests. Each request produces a trace span tagged with the protocol, route, capability, and auth type."),
    createElement("pre", null,
      createElement("code", null,
`export default defineConfig({
  telemetry: {
    enabled: true,
    exporter: "otlp", // "otlp" | "console" | "none"
    endpoint: env("OTEL_EXPORTER_OTLP_ENDPOINT"),
    serviceName: "my-capstan-app",
  },
});`
      )
    ),
    createElement("p", null, "Traces include:"),
    createElement("ul", null,
      createElement("li", null, createElement("code", null, "capstan.protocol"), " -- which protocol surface handled the request (http, mcp, a2a)"),
      createElement("li", null, createElement("code", null, "capstan.route"), " -- the matched route path"),
      createElement("li", null, createElement("code", null, "capstan.capability"), " -- read, write, or external"),
      createElement("li", null, createElement("code", null, "capstan.auth.type"), " -- human, agent, or anonymous"),
      createElement("li", null, createElement("code", null, "capstan.policy.effect"), " -- the policy decision (allow, deny, approve, redact)")
    ),

    // ── CSS & Styling ───────────────────────────────────────────────
    createElement("h2", null, "CSS & Styling"),
    createElement("p", null, "Capstan includes a zero-config CSS pipeline that processes stylesheets automatically during development and production builds."),

    createElement("h3", null, "Lightning CSS (Default)"),
    createElement("p", null, "Place CSS files in ", createElement("code", null, "app/styles/"), ". The entry point is ", createElement("code", null, "app/styles/main.css"), ", which is processed and served as ", createElement("code", null, "/styles.css"), ". By default, Capstan processes CSS with Lightning CSS, providing @import resolution, vendor prefixing, CSS nesting, and minification. No configuration required."),

    createElement("h3", null, "Tailwind CSS (Auto-Detected)"),
    createElement("p", null, "If ", createElement("code", null, "app/styles/main.css"), " contains ", createElement("code", null, '@import "tailwindcss"'), ", Capstan auto-detects Tailwind v4 and runs the Tailwind CLI instead of Lightning CSS:"),
    createElement("pre", null,
      createElement("code", null,
`/* app/styles/main.css */
@import "tailwindcss";`
      )
    ),
    createElement("pre", null,
      createElement("code", null, "npm install tailwindcss @tailwindcss/cli")
    ),
    createElement("p", null, "Tailwind v4 scans your source files automatically -- no tailwind.config.js needed."),

    createElement("h3", null, "Referencing in Layouts"),
    createElement("p", null, "Use React 19's ", createElement("code", null, "precedence"), " prop to auto-hoist the stylesheet into ", createElement("code", null, "<head>"), " and prevent FOUC:"),
    createElement("pre", null,
      createElement("code", null, '<link rel="stylesheet" href="/styles.css" precedence="default" />')
    ),

    // ── OAuth Providers ─────────────────────────────────────────────
    createElement("h2", null, "OAuth Providers"),
    createElement("p", null, "Capstan includes built-in OAuth provider helpers for social login with Google and GitHub. The ", createElement("code", null, "createOAuthHandlers()"), " function returns route handlers that manage the full authorization code flow automatically."),
    createElement("pre", null,
      createElement("code", null,
`import { googleProvider, githubProvider, createOAuthHandlers } from "@zauso-ai/capstan-auth";

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

// Mount: GET /auth/login/:provider  and  GET /auth/callback`
      )
    ),
    createElement("p", null, "The flow handles CSRF state validation, token exchange, user info retrieval, and JWT session creation. After a successful login, the user receives a ", createElement("code", null, "capstan_session"), " cookie and is redirected to ", createElement("code", null, "/"), "."),

    // ── Redis State Backend ─────────────────────────────────────────
    createElement("h2", null, "Redis State Backend"),
    createElement("p", null, "By default, Capstan stores approval state, rate limit counters, DPoP replay caches, and audit logs in memory. For production deployments that require persistence or multi-instance sharing, swap to the built-in ", createElement("code", null, "RedisStore"), ":"),
    createElement("pre", null,
      createElement("code", null,
`import Redis from "ioredis";
import {
  RedisStore,
  setApprovalStore,
  setRateLimitStore,
  setDpopReplayStore,
  setAuditStore,
} from "@zauso-ai/capstan-core";

const redis = new Redis(process.env.REDIS_URL);

setApprovalStore(new RedisStore(redis, "approvals:"));
setRateLimitStore(new RedisStore(redis, "ratelimit:"));
setDpopReplayStore(new RedisStore(redis, "dpop:"));
setAuditStore(new RedisStore(redis, "audit:"));`
      )
    ),
    createElement("p", null, createElement("code", null, "RedisStore"), " implements the ", createElement("code", null, "KeyValueStore<T>"), " interface and supports TTL-based expiration, key enumeration via ", createElement("code", null, "keys()"), ", and configurable key prefixes to avoid collisions when multiple apps share a Redis instance."),

    // ── LLM Integration ─────────────────────────────────────────────
    createElement("h2", null, "LLM Integration"),
    createElement("p", null, "Capstan includes built-in LLM provider adapters for OpenAI and Anthropic, with a unified interface for chat completion and streaming."),
    createElement("pre", null,
      createElement("code", null,
`import { openaiProvider, anthropicProvider } from "@zauso-ai/capstan-agent";

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
}`
      )
    ),
    createElement("p", null, "The ", createElement("code", null, "LLMProvider"), " interface can be implemented for other providers. Both providers support ", createElement("code", null, "systemPrompt"), ", ", createElement("code", null, "temperature"), ", ", createElement("code", null, "maxTokens"), ", and structured ", createElement("code", null, "responseFormat"), " options."),

    // ── AI Toolkit ──────────────────────────────────────────────────
    createElement("h2", null, "AI Toolkit (@zauso-ai/capstan-ai)"),
    createElement("p", null, createElement("code", null, "@zauso-ai/capstan-ai"), " is a standalone AI agent toolkit that works independently OR with the Capstan framework. It provides structured reasoning, text generation, scoped memory primitives with pluggable backends, a host-driven agent loop, first-class task execution, and ", createElement("code", null, "createHarness()"), " for browser/filesystem sandboxing."),

    createElement("h3", null, "Standalone Usage"),
    createElement("pre", null,
      createElement("code", null,
`import { createAI } from "@zauso-ai/capstan-ai";
import { openaiProvider } from "@zauso-ai/capstan-agent";

const ai = createAI({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});`
      )
    ),

    createElement("h3", null, "Structured Reasoning with think()"),
    createElement("p", null, createElement("code", null, "think()"), " sends a prompt to the LLM and parses the response against a Zod schema, returning a fully typed result:"),
    createElement("pre", null,
      createElement("code", null,
`import { z } from "zod";

const analysis = await ai.think("Classify this support ticket: 'My payment failed'", {
  schema: z.object({
    category: z.enum(["billing", "technical", "account", "other"]),
    priority: z.enum(["low", "medium", "high"]),
    sentiment: z.enum(["positive", "neutral", "negative"]),
  }),
});
// analysis.category === "billing", analysis.priority === "high", etc.`
      )
    ),

    createElement("h3", null, "Text Generation with generate()"),
    createElement("pre", null,
      createElement("code", null,
`const summary = await ai.generate("Summarize this document in 3 bullet points...");`
      )
    ),
    createElement("p", null, "Both ", createElement("code", null, "think()"), " and ", createElement("code", null, "generate()"), " have streaming variants -- ", createElement("code", null, "thinkStream()"), " and ", createElement("code", null, "generateStream()"), " -- that yield partial results as the LLM generates tokens."),

    createElement("h3", null, "Memory System"),
    createElement("p", null, "The memory system provides searchable memory scoped to any entity:"),
    createElement("pre", null,
      createElement("code", null,
`// Store memories
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
await ai.memory.forget(memoryId);`
      )
    ),
    createElement("p", null, "Memory features:"),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, "Auto-dedup"), ": memories with >0.92 cosine similarity are merged"),
      createElement("li", null, createElement("strong", null, "Hybrid recall"), ": vector similarity (0.7 weight) + keyword matching (0.3 weight) + recency decay"),
      createElement("li", null, createElement("strong", null, "Entity scoping"), ": ", createElement("code", null, 'memory.about(type, id)'), " isolates memory per entity"),
      createElement("li", null, createElement("strong", null, "Pluggable backends"), ": implement ", createElement("code", null, "MemoryBackend"), " for Mem0, Hindsight, Redis, or custom storage")
    ),

    createElement("h3", null, "Agent Loop"),
    createElement("p", null, "The self-orchestrating agent loop is host-driven: the model proposes the next tools or tasks, and the runtime advances turns, persists checkpoints, and folds results back into the next turn:"),
    createElement("pre", null,
      createElement("code", null,
`const result = await ai.agent.run({
  goal: "Research the customer's recent issues and draft a response email",
  about: ["customer", "cust_123"],
  tools: [searchTickets, getCustomerHistory, draftEmail],
});`
      )
    ),
    createElement("p", null, "Agent loop features:"),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, "Recursion prevention"), ": tracks callStack to avoid infinite loops"),
      createElement("li", null, createElement("strong", null, "beforeToolCall hook"), ": enforce policies or require approval before tool execution"),
      createElement("li", null, createElement("strong", null, "Configurable iteration limit"), ": maxIterations (default: 10)"),
      createElement("li", null, createElement("strong", null, "Entity-scoped memory"), ": about option automatically scopes all memory operations"),
      createElement("li", null, createElement("strong", null, "Task-aware turns"), ": tools and long-running tasks share one orchestration state machine")
    ),

    createElement("h3", null, "Task Fabric"),
    createElement("p", null, "Use tasks when work should outlive a single tool call or run asynchronously before folding back into the next turn:"),
    createElement("pre", null,
      createElement("code", null,
`import {
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
});`
      )
    ),
    createElement("p", null, "Task features:"),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, "First-class runtime state"), ": submitted tasks become persisted runtime records"),
      createElement("li", null, createElement("strong", null, "Mailbox-style continuation"), ": task completion, failure, and cancellation feed back into the next turn automatically"),
      createElement("li", null, createElement("strong", null, "Concurrency contracts"), ": the host runtime can batch safe work while still preserving deterministic ordering"),
      createElement("li", null, createElement("strong", null, "Task families"), ": shell, workflow, remote, and subagent tasks share one contract and can be mixed in a single run"),
      createElement("li", null, createElement("strong", null, "Cooperative recovery"), ": paused or canceled runs cancel in-flight tasks, persist task records, and can replay pending task requests from checkpoints")
    ),

    createElement("h3", null, "Agent Harness Mode"),
    createElement("p", null, createElement("code", null, "createHarness()"), " wraps the agent loop with an isolated runtime substrate that long-running agents typically need:"),
    createElement("pre", null,
      createElement("code", null,
`import { createHarness } from "@zauso-ai/capstan-ai";

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

await harness.destroy();`
      )
    ),
    createElement("p", null, "Harness features:"),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, "Browser sandbox"), ": Playwright by default, or Camoufox kernel for persistent profiles and advanced anti-detection"),
      createElement("li", null, createElement("strong", null, "Filesystem sandbox"), ": scoped reads/writes with traversal protection"),
      createElement("li", null, createElement("strong", null, "Durable runtime"), ": each run gets a persisted run record, event log, task store, artifact store, and resumable checkpoint under ", createElement("code", null, ".capstan/harness/")),
      createElement("li", null, createElement("strong", null, "Lifecycle control"), ": ", createElement("code", null, "startRun()"), ", ", createElement("code", null, "pauseRun()"), ", ", createElement("code", null, "cancelRun()"), ", ", createElement("code", null, "resumeRun()"), ", ", createElement("code", null, "getCheckpoint()"), ", and ", createElement("code", null, "replayRun()")),
      createElement("li", null, createElement("strong", null, "Context kernel"), ": session memory, persisted summaries, long-term runtime memory, artifact-aware context assembly, and transcript compaction"),
      createElement("li", null, createElement("strong", null, "Task fabric"), ": ", createElement("code", null, "getTasks()"), " exposes persisted task execution records for supervision"),
      createElement("li", null, createElement("strong", null, "Pluggable sandbox driver"), ": local isolation by default, with a runtime driver contract for custom execution backends"),
      createElement("li", null, createElement("strong", null, "Verification layer"), ": post-tool validation hooks plus LLM-based pass/fail classification"),
      createElement("li", null, createElement("strong", null, "Observability layer"), ": event stream, metrics, and trace-friendly lifecycle events")
    ),

    createElement("h3", null, "Using with Capstan Handlers"),
    createElement("p", null, "When used inside Capstan ", createElement("code", null, "defineAPI()"), " handlers, the AI toolkit integrates with the request context:"),
    createElement("pre", null,
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

    // ── Scheduled Agent Runs ────────────────────────────────────────
    createElement("h2", null, "Scheduled Agent Runs (@zauso-ai/capstan-cron)"),
    createElement("p", null, "Use ", createElement("code", null, "@zauso-ai/capstan-cron"), " to submit scheduled runs into a harness runtime. The recommended pattern is to create one durable harness/runtime and let cron act as the trigger layer:"),
    createElement("pre", null,
      createElement("code", null,
`import { createCronRunner, createAgentCron } from "@zauso-ai/capstan-cron";
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

runner.start();`
      )
    ),
    createElement("p", null, createElement("code", null, "createCronRunner()"), " is an interval-based fallback for Node.js and simple schedules. For timezone-sensitive or complex calendar rules, prefer ", createElement("code", null, "createBunCronRunner()"), " on Bun so the runtime owns the cron semantics."),

    // ── Deployment ──────────────────────────────────────────────────
    createElement("h2", null, "Deployment"),

    createElement("h3", null, "Production Build & Start"),
    createElement("pre", null,
      createElement("code", null,
`npx capstan build    # Compile TS, generate route manifest, production server entry
npx capstan start    # Start the production server`
      )
    ),

    createElement("h3", null, "ClientOnly Component"),
    createElement("p", null, "Renders its children only in the browser. During SSR, an optional fallback is shown:"),
    createElement("pre", null,
      createElement("code", null,
`import { ClientOnly } from "@zauso-ai/capstan-react";

export default function Page() {
  return (
    <div>
      <ClientOnly fallback={<p>Loading map...</p>}>
        <InteractiveMap />
      </ClientOnly>
    </div>
  );
}`
      )
    ),

    createElement("h3", null, "serverOnly() Guard"),
    createElement("p", null, "A guard function that throws if called in a browser context:"),
    createElement("pre", null,
      createElement("code", null,
`import { serverOnly } from "@zauso-ai/capstan-react";
serverOnly(); // throws "This module is server-only" in browser

export function getDbConnection() { /* ... */ }`
      )
    ),

    createElement("h3", null, "Vite Build Pipeline (Optional)"),
    createElement("p", null, "Capstan includes an optional Vite integration for client-side code splitting and HMR. Install ", createElement("code", null, "vite"), " as a peer dependency to enable it. Use ", createElement("code", null, "createViteConfig()"), " and ", createElement("code", null, "buildClient()"), " from ", createElement("code", null, "@zauso-ai/capstan-dev"), " to configure the pipeline."),

    createElement("h3", null, "Cloudflare Workers"),
    createElement("pre", null,
      createElement("code", null,
`import { createCloudflareHandler } from "@zauso-ai/capstan-dev";
import app from "./app.js";

export default createCloudflareHandler(app);`
      )
    ),
    createElement("p", null, "Generate a ", createElement("code", null, "wrangler.toml"), " with ", createElement("code", null, 'generateWranglerConfig("my-app")'), "."),

    createElement("h3", null, "Vercel"),
    createElement("pre", null,
      createElement("code", null,
`import { createVercelHandler } from "@zauso-ai/capstan-dev";
export default createVercelHandler(app); // Edge Function

// Or for Node.js serverless functions:
// createVercelNodeHandler(app)`
      )
    ),

    createElement("h3", null, "Fly.io"),
    createElement("pre", null,
      createElement("code", null,
`import { createFlyAdapter } from "@zauso-ai/capstan-dev";

const adapter = createFlyAdapter({
  primaryRegion: "iad",
  replayWrites: true,
});`
      )
    ),
    createElement("p", null, "When running read replicas, mutating requests are automatically replayed to the primary region."),

    // ── Cache Layer & ISR ───────────────────────────────────────────
    createElement("h2", null, "Cache Layer & ISR"),
    createElement("p", null, "Capstan includes a built-in cache layer with TTL, tag-based invalidation, and stale-while-revalidate (ISR) support."),

    createElement("h3", null, "Basic Usage"),
    createElement("pre", null,
      createElement("code", null,
`import { cacheSet, cacheGet, cacheInvalidateTag } from "@zauso-ai/capstan-core";

// Cache data with TTL (in seconds) and tags
await cacheSet("user:123", userData, {
  ttl: 300,           // Expires after 5 minutes
  tags: ["users"],    // Tag for bulk invalidation
});

// Retrieve cached data
const data = await cacheGet("user:123");

// Invalidate all entries with a given tag
await cacheInvalidateTag("users");`
      )
    ),

    createElement("h3", null, "Stale-While-Revalidate with cached()"),
    createElement("p", null, "The ", createElement("code", null, "cached()"), " decorator wraps an async function with caching. After the TTL expires, the stale value is returned immediately while a background revalidation runs:"),
    createElement("pre", null,
      createElement("code", null,
`import { cached } from "@zauso-ai/capstan-core";

const getUsers = cached(async () => {
  return await db.query.users.findMany();
}, {
  ttl: 60,            // Serve stale for up to 60s while revalidating
  tags: ["users"],    // Invalidate with cacheInvalidateTag("users")
});

// First call fetches from DB, subsequent calls return cached value
const users = await getUsers();`
      )
    ),

    createElement("h3", null, "ISR (Incremental Static Regeneration)"),
    createElement("p", null, "Use the ", createElement("code", null, "revalidate"), " option in ", createElement("code", null, "cacheSet"), " to enable ISR-style behavior:"),
    createElement("pre", null,
      createElement("code", null,
`await cacheSet("homepage-data", data, {
  ttl: 3600,          // Hard expiry after 1 hour
  revalidate: 60,     // Revalidate every 60 seconds in the background
  tags: ["pages"],
});`
      )
    ),

    createElement("h3", null, "Response Cache"),
    createElement("p", null, "The response cache is a separate cache layer for full-page HTML output, used by ISR render strategies:"),
    createElement("pre", null,
      createElement("code", null,
`import {
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
setResponseCacheStore(new RedisStore(redis, "resp:"));`
      )
    ),
    createElement("p", null, createElement("strong", null, "Cross-invalidation:"), " Calling ", createElement("code", null, 'cacheInvalidateTag("blog")'), " from the data cache also evicts response cache entries tagged \"blog\". This means when you invalidate data, the corresponding ISR pages are automatically re-rendered on the next request."),

    createElement("h3", null, "Custom Cache Store"),
    createElement("p", null, "By default, the cache uses an in-memory store. For production, swap to a custom ", createElement("code", null, "KeyValueStore"), " implementation (e.g., Redis):"),
    createElement("pre", null,
      createElement("code", null,
`import { setCacheStore } from "@zauso-ai/capstan-core";

setCacheStore(new RedisStore(redis, "cache:"));`
      )
    ),

    // ── Render Strategies ───────────────────────────────────────────
    createElement("h2", null, "Render Strategies"),
    createElement("p", null, "Capstan supports multiple rendering strategies controlled by page-level exports."),

    createElement("h3", null, "RenderMode"),
    createElement("p", null, "Export ", createElement("code", null, "renderMode"), " from a page to control how it is rendered:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Mode"),
          createElement("th", null, "Behavior")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, '"ssr"')),
          createElement("td", null, "Server-render on every request (default)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, '"isr"')),
          createElement("td", null, "Incremental Static Regeneration -- serve cached HTML, revalidate in background")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, '"ssg"')),
          createElement("td", null, "Static Site Generation -- pre-render at build time via capstan build --static")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, '"streaming"')),
          createElement("td", null, "Streaming SSR with renderToReadableStream")
        )
      )
    ),

    createElement("h3", null, "ISR Example"),
    createElement("pre", null,
      createElement("code", null,
`// app/routes/blog/index.page.tsx
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
}`
      )
    ),
    createElement("p", null, "ISR behavior:"),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, "Cache HIT (fresh):"), " Returns cached HTML immediately"),
      createElement("li", null, createElement("strong", null, "Cache HIT (stale):"), " Returns stale HTML immediately, revalidates in background"),
      createElement("li", null, createElement("strong", null, "Cache MISS:"), " Renders the page, stores in response cache, returns HTML")
    ),

    createElement("h3", null, "SSG (Static Site Generation)"),
    createElement("p", null, "Export ", createElement("code", null, 'renderMode: "ssg"'), " to pre-render a page at build time. For dynamic routes, export ", createElement("code", null, "generateStaticParams()"), " to provide the param sets:"),
    createElement("pre", null,
      createElement("code", null,
`// app/routes/blog/[id].page.tsx
export const renderMode = "ssg";

export async function generateStaticParams() {
  const posts = await fetchAllPosts();
  return posts.map(p => ({ id: String(p.id) }));
  // pre-renders /blog/1, /blog/2, /blog/3, ...
}

export async function loader({ params }: LoaderArgs) {
  return { post: await fetchPost(params.id) };
}

export default function BlogPost() {
  const { post } = useLoaderData<{ post: Post }>();
  return <article><h1>{post.title}</h1><p>{post.body}</p></article>;
}`
      )
    ),
    createElement("p", null, "Build with ", createElement("code", null, "capstan build --static"), " to pre-render SSG pages to ", createElement("code", null, "dist/static/"), ". Pages without pre-rendered files fall back to SSR automatically."),

    createElement("h3", null, "Hybrid Output"),
    createElement("p", null, "SSR, ISR, and SSG pages can coexist in the same application:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Page"),
          createElement("th", null, "renderMode"),
          createElement("th", null, "Behavior")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "/")),
          createElement("td", null, "(default)"),
          createElement("td", null, "Server-rendered on every request")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "/blog")),
          createElement("td", null, createElement("code", null, '"isr"')),
          createElement("td", null, "Cached, revalidated every 60s")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "/blog/:id")),
          createElement("td", null, createElement("code", null, '"ssg"')),
          createElement("td", null, "Pre-rendered at build time")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "/dashboard")),
          createElement("td", null, createElement("code", null, '"ssr"')),
          createElement("td", null, "Always fresh server render")
        )
      )
    ),

    createElement("h3", null, "Strategy Classes"),
    createElement("p", null, "The framework provides three strategy implementations:"),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, "SSRStrategy"), " -- Renders on every request via renderPage() or renderPageStream(). This is the default."),
      createElement("li", null, createElement("strong", null, "ISRStrategy"), " -- Checks response cache first, uses stale-while-revalidate pattern. Falls back to SSRStrategy on cache miss."),
      createElement("li", null, createElement("strong", null, "SSGStrategy"), " -- Static Site Generation. Serves pre-rendered HTML from dist/static/. Falls back to SSR if the file does not exist.")
    ),
    createElement("pre", null,
      createElement("code", null,
`import { createStrategy } from "@zauso-ai/capstan-react";

const strategy = createStrategy("isr");
const result = await strategy.render({ options, url, revalidate: 60, cacheTags: ["blog"] });
// result.cacheStatus: "HIT" | "MISS" | "STALE"`
      )
    ),

    // ── Client-Side SPA Navigation ──────────────────────────────────
    createElement("h2", null, "Client-Side SPA Navigation"),
    createElement("p", null, "Capstan includes a built-in client-side SPA router that enables instant page transitions without full-page reloads, while maintaining progressive enhancement -- everything works without JavaScript."),

    createElement("h3", null, "Link Component"),
    createElement("pre", null,
      createElement("code", null,
`import { Link } from "@zauso-ai/capstan-react/client";

<Link href="/about">About</Link>
<Link href="/dashboard" prefetch="viewport">Dashboard</Link>
<Link href="/settings" prefetch="none" replace>Settings</Link>`
      )
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Prop"),
          createElement("th", null, "Type"),
          createElement("th", null, "Default"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "href")),
          createElement("td", null, createElement("code", null, "string")),
          createElement("td", null, "--"),
          createElement("td", null, "Target URL (required)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "prefetch")),
          createElement("td", null, createElement("code", null, '"none" | "hover" | "viewport"')),
          createElement("td", null, createElement("code", null, '"hover"')),
          createElement("td", null, "When to prefetch")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "replace")),
          createElement("td", null, createElement("code", null, "boolean")),
          createElement("td", null, createElement("code", null, "false")),
          createElement("td", null, "Replace history entry")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "scroll")),
          createElement("td", null, createElement("code", null, "boolean")),
          createElement("td", null, createElement("code", null, "true")),
          createElement("td", null, "Scroll to top after nav")
        )
      )
    ),

    createElement("h3", null, "Programmatic Navigation"),
    createElement("pre", null,
      createElement("code", null,
`import { useNavigate, useRouterState } from "@zauso-ai/capstan-react/client";

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
}`
      )
    ),
    createElement("p", null,
      createElement("code", null, "useRouterState()"), " returns ", createElement("code", null, '{ url, status, error? }'), " where status is ", createElement("code", null, '"idle" | "loading" | "error"'), ". ",
      createElement("code", null, "useNavigate()"), " returns a function ", createElement("code", null, "(url, opts?) => void"), "."
    ),

    createElement("h3", null, "NavigationProvider"),
    createElement("p", null, "Wrap your app root with ", createElement("code", null, "<NavigationProvider>"), " to bridge the imperative router with React:"),
    createElement("pre", null,
      createElement("code", null,
`import { NavigationProvider } from "@zauso-ai/capstan-react/client";

function App({ children }) {
  return (
    <NavigationProvider initialLoaderData={loaderData} initialParams={params}>
      {children}
    </NavigationProvider>
  );
}`
      )
    ),

    createElement("h3", null, "How Navigation Works"),
    createElement("ol", null,
      createElement("li", null, createElement("strong", null, "Request:"), " Fetch the URL with ", createElement("code", null, "X-Capstan-Nav: 1"), " header -- the server returns a JSON NavigationPayload instead of full HTML."),
      createElement("li", null, createElement("strong", null, "Server components:"), " The outlet HTML is morphed in-place using idiomorph, preserving layout stability via ", createElement("code", null, "data-capstan-layout"), " / ", createElement("code", null, "data-capstan-outlet"), " attributes."),
      createElement("li", null, createElement("strong", null, "Client components:"), " A ", createElement("code", null, "capstan:navigate"), " CustomEvent triggers React reconciliation through NavigationProvider."),
      createElement("li", null, createElement("strong", null, "History:"), " pushState (or replaceState) updates the URL."),
      createElement("li", null, createElement("strong", null, "Scroll:"), " Scrolls to top (configurable) or restores previous position on back/forward.")
    ),

    createElement("h3", null, "Prefetching"),
    createElement("p", null, "The PrefetchManager handles two strategies:"),
    createElement("ul", null,
      createElement("li", null, createElement("strong", null, '"hover"'), " (default) -- Prefetches after 80ms hover on a Link. Cancelled if the pointer leaves."),
      createElement("li", null, createElement("strong", null, '"viewport"'), " -- Prefetches when a Link enters the viewport (IntersectionObserver with 200px margin).")
    ),
    createElement("p", null, "Prefetched payloads are stored in a NavigationCache (LRU, max 50 entries, 5-minute TTL)."),

    createElement("h3", null, "Scroll Restoration"),
    createElement("p", null, "Scroll positions are saved to sessionStorage keyed by a unique scroll key stored in history.state. Back/forward navigation automatically restores the previous scroll position."),

    createElement("h3", null, "View Transitions"),
    createElement("p", null, "DOM mutations during navigation are wrapped in ", createElement("code", null, "document.startViewTransition()"), " when the browser supports it. This gives smooth cross-fade animations between pages with zero configuration. On unsupported browsers, navigation works normally without animation."),

    createElement("h3", null, "Bootstrap"),
    createElement("p", null, "Call ", createElement("code", null, "bootstrapClient()"), " once at page load to initialize the router:"),
    createElement("pre", null,
      createElement("code", null,
`import { bootstrapClient } from "@zauso-ai/capstan-react/client";

bootstrapClient();`
      )
    ),
    createElement("p", null, "This reads the ", createElement("code", null, "window.__CAPSTAN_MANIFEST__"), " (injected by the server), creates the router singleton, and sets up global ", createElement("code", null, "<a>"), " click delegation. All internal links automatically get SPA navigation. To opt out for a specific link, add ", createElement("code", null, "data-capstan-external"), ":"),
    createElement("pre", null,
      createElement("code", null, '<a href="/legacy-page" data-capstan-external>Full page reload</a>')
    )
  );
}

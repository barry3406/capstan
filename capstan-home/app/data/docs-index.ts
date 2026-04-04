/**
 * Documentation content index for search, docs query, and code examples APIs.
 * This data powers the MCP tools that coding agents use to query Capstan docs.
 */

export interface DocPage {
  slug: string;
  title: string;
  section: string;
  url: string;
  content: string;
  keywords: string[];
  topics: string[];
}

export interface DocSection {
  slug: string;
  title: string;
  category: string;
  url: string;
  topics: string[];
  summary: string;
}

export interface CodeExample {
  title: string;
  description: string;
  code: string;
  language: string;
  topics: string[];
  relatedDocs: string;
}

// --- Document sections (high-level index) ---

export const DOC_SECTIONS: DocSection[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    category: "Guide",
    url: "/docs/getting-started",
    topics: ["setup", "installation", "quickstart", "routing"],
    summary: "Install Capstan, create your first project with create-capstan-app, understand file conventions, routing patterns, and the development workflow.",
  },
  {
    slug: "core-concepts",
    title: "Core Concepts",
    category: "Guide",
    url: "/docs/core-concepts",
    topics: ["defineAPI", "routing", "policy", "middleware", "layout", "approval", "verification"],
    summary: "Learn about defineAPI (the central building block), multi-protocol projection, file-based routing, layouts, middleware, policies, approval workflows, and the verification cascade.",
  },
  {
    slug: "database",
    title: "Database",
    category: "Guide",
    url: "/docs/database",
    topics: ["defineModel", "database", "orm", "migration", "vector", "crud"],
    summary: "Define models with typed fields, set up relations, use auto-generated CRUD, run migrations, and implement vector search for RAG applications.",
  },
  {
    slug: "authentication",
    title: "Authentication",
    category: "Guide",
    url: "/docs/authentication",
    topics: ["auth", "jwt", "api-key", "oauth", "dpop", "spiffe", "rate-limiting"],
    summary: "JWT sessions for humans, API key auth for agents, OAuth providers, DPoP (RFC 9449), SPIFFE/mTLS, token-aware rate limiting, and CSRF protection.",
  },
  {
    slug: "deployment",
    title: "Deployment",
    category: "Guide",
    url: "/docs/deployment",
    topics: ["deployment", "build", "docker", "vercel", "cloudflare", "fly", "static"],
    summary: "Build for 6 deployment targets (node-standalone, docker, vercel-node, vercel-edge, cloudflare, fly), static site generation, environment configuration.",
  },
  {
    slug: "api-reference",
    title: "API Reference",
    category: "Reference",
    url: "/docs/api-reference",
    topics: ["api", "reference", "core", "react", "router", "db", "auth", "ai", "agent", "cli", "ops", "cron"],
    summary: "Complete API reference for all 11 Capstan packages: core, react, router, db, auth, ai, agent, cli, dev, ops, cron.",
  },
  {
    slug: "testing",
    title: "Testing",
    category: "Reference",
    url: "/docs/testing",
    topics: ["testing", "verification", "performance", "e2e", "benchmark"],
    summary: "Testing strategy with 1700+ tests, 5 test layers, capstan verify cascade, performance budgets, and writing tests for defineAPI routes.",
  },
  {
    slug: "comparison",
    title: "Comparison",
    category: "Reference",
    url: "/docs/comparison",
    topics: ["comparison", "nextjs", "fastapi", "architecture"],
    summary: "Detailed comparison of Capstan vs Next.js vs FastAPI across 22 dimensions including multi-protocol, agent support, auth, database, AI toolkit, and more.",
  },
];

// --- Detailed documentation content for search ---

export const DOC_PAGES: DocPage[] = [
  // Getting Started
  {
    slug: "getting-started",
    title: "Prerequisites",
    section: "Getting Started",
    url: "/docs/getting-started",
    content: "Node.js 20+ required (ES2022 target, ESM-only). npm ships with Node.js. Optional database drivers: better-sqlite3 (requires C++ toolchain), pg for PostgreSQL, mysql2 for MySQL, @libsql/client for Turso.",
    keywords: ["prerequisites", "node", "npm", "install", "requirements"],
    topics: ["setup", "installation"],
  },
  {
    slug: "getting-started",
    title: "Quick Start",
    section: "Getting Started",
    url: "/docs/getting-started",
    content: "npx create-capstan-app my-app --template blank creates a new project. cd my-app && npm install && npx capstan dev starts the dev server. Two templates available: blank (minimal health check + home page) and tickets (full CRUD app with auth, models, policies).",
    keywords: ["create-capstan-app", "quickstart", "template", "blank", "tickets", "scaffold"],
    topics: ["setup", "quickstart"],
  },
  {
    slug: "getting-started",
    title: "Project Structure",
    section: "Getting Started",
    url: "/docs/getting-started",
    content: "app/routes/ for file-based routing. app/models/ for database models (defineModel). app/styles/ for CSS entry points. app/policies/ for permission policies. app/migrations/ for database migrations. app/public/ for static files served from root. capstan.config.ts for framework configuration. AGENTS.md for AI agent guide.",
    keywords: ["structure", "directory", "files", "routes", "models", "config"],
    topics: ["setup", "routing"],
  },
  {
    slug: "getting-started",
    title: "File Naming Conventions",
    section: "Getting Started",
    url: "/docs/getting-started",
    content: "*.api.ts for API route handlers (exports GET, POST, PUT, DELETE, PATCH). *.page.tsx for React pages with SSR. _layout.tsx for layout wrappers with Outlet. _middleware.ts for scoped middleware. _loading.tsx for Suspense fallback. _error.tsx for error boundary. [param].api.ts for dynamic routes. [...catchAll].api.ts for catch-all. (group)/ for route groups transparent in URL.",
    keywords: ["naming", "conventions", "api.ts", "page.tsx", "layout", "middleware", "dynamic", "catch-all", "group"],
    topics: ["routing"],
  },
  {
    slug: "getting-started",
    title: "CLI Commands",
    section: "Getting Started",
    url: "/docs/getting-started",
    content: "capstan dev — start dev server with live reload. capstan build — compile for production. capstan start — run compiled app. capstan verify --json — run 8-step verification cascade. capstan add api|page|model|policy <name> — scaffold new components. capstan db:migrate — run migrations. capstan db:push — auto-generate from models. capstan mcp — start MCP server.",
    keywords: ["cli", "commands", "dev", "build", "start", "verify", "add", "scaffold", "mcp"],
    topics: ["setup", "cli"],
  },

  // Core Concepts
  {
    slug: "core-concepts",
    title: "defineAPI()",
    section: "Core Concepts",
    url: "/docs/core-concepts",
    content: "defineAPI() is the central building block of Capstan. Every API endpoint is defined with: input (Zod schema for request params/body), output (Zod schema for response), description (human + agent readable), capability ('read' | 'write' | 'external'), resource (optional resource scoping), policy (optional named policy), handler (async function with {input, params, ctx}). A single defineAPI() call automatically generates HTTP JSON API, MCP Tools, A2A Skills, and OpenAPI 3.1 spec.",
    keywords: ["defineAPI", "api", "endpoint", "handler", "input", "output", "zod", "schema", "capability", "resource"],
    topics: ["defineAPI", "api"],
  },
  {
    slug: "core-concepts",
    title: "Handler Context",
    section: "Core Concepts",
    url: "/docs/core-concepts",
    content: "The handler receives ctx with: ctx.auth.isAuthenticated (boolean), ctx.auth.type ('human' | 'agent' | 'anonymous'), ctx.auth.userId, ctx.auth.role, ctx.auth.email, ctx.auth.agentId, ctx.auth.permissions (string[]). Also ctx.request (Request), ctx.env (environment variables), ctx.honoCtx (Hono context).",
    keywords: ["context", "ctx", "auth", "handler", "request", "environment"],
    topics: ["defineAPI", "auth"],
  },
  {
    slug: "core-concepts",
    title: "Multi-Protocol Projection",
    section: "Core Concepts",
    url: "/docs/core-concepts",
    content: "defineAPI() feeds into the CapabilityRegistry which projects to 4 protocol surfaces simultaneously: HTTP JSON API via Hono, MCP Tools via @modelcontextprotocol/sdk for Claude Desktop and Cursor, A2A Skills via Google Agent-to-Agent protocol, OpenAPI 3.1 specification. Auto-generated endpoints: GET /.well-known/capstan.json (agent manifest), GET /openapi.json, GET /.well-known/agent.json (A2A card), POST /.well-known/mcp.",
    keywords: ["multi-protocol", "projection", "http", "mcp", "a2a", "openapi", "capability", "registry", "manifest"],
    topics: ["defineAPI", "api"],
  },
  {
    slug: "core-concepts",
    title: "File-Based Routing",
    section: "Core Concepts",
    url: "/docs/core-concepts",
    content: "Routes live in app/routes/ with conventions: *.api.ts for API handlers, *.page.tsx for React pages, _layout.tsx wraps nested routes via Outlet, _middleware.ts for pre-handler logic, _loading.tsx for Suspense fallback, _error.tsx for error boundary. Dynamic segments: [id].api.ts maps to /tickets/:id. Catch-all: [...path].page.tsx maps to /docs/*. Route groups: (marketing)/pricing.page.tsx maps to /pricing (group not in URL).",
    keywords: ["routing", "file-based", "dynamic", "segments", "catch-all", "groups", "layout", "middleware"],
    topics: ["routing"],
  },
  {
    slug: "core-concepts",
    title: "Policies",
    section: "Core Concepts",
    url: "/docs/core-concepts",
    content: "definePolicy() declares named permission rules with structured effects: 'allow' (permit), 'deny' (reject with 403), 'approve' (hold for human review), 'redact' (execute but filter sensitive fields). Example: definePolicy({ key: 'requireAuth', title: 'Require Authentication', effect: 'deny', async check({ ctx }) { if (!ctx.auth.isAuthenticated) return { effect: 'deny', reason: 'Not authenticated' }; return { effect: 'allow' }; } }). Reference in defineAPI via policy: 'requireAuth'.",
    keywords: ["policy", "definePolicy", "allow", "deny", "approve", "redact", "permission", "access-control"],
    topics: ["policy", "auth"],
  },
  {
    slug: "core-concepts",
    title: "Approval Workflow",
    section: "Core Concepts",
    url: "/docs/core-concepts",
    content: "When a policy returns effect: 'approve', the request is persisted and exposed for human review. Endpoints: GET /capstan/approvals (list pending), GET /capstan/approvals/:id (get status), POST /capstan/approvals/:id (approve or deny with body { action: 'approve' | 'deny' }). This enables human-in-the-loop for sensitive operations triggered by AI agents.",
    keywords: ["approval", "workflow", "human-in-the-loop", "review", "pending"],
    topics: ["policy", "approval"],
  },
  {
    slug: "core-concepts",
    title: "Loaders and Data Fetching",
    section: "Core Concepts",
    url: "/docs/core-concepts",
    content: "Pages can export a loader function for SSR data fetching: export const loader = defineLoader(async (ctx) => { return { data }; }). In the component, use useLoaderData() to access loaded data. Loaders run on the server before rendering. Use internal fetch for calling your own APIs (not HTTP round-trips).",
    keywords: ["loader", "defineLoader", "useLoaderData", "data-fetching", "ssr"],
    topics: ["routing", "ssr"],
  },
  {
    slug: "core-concepts",
    title: "Verification Cascade",
    section: "Core Concepts",
    url: "/docs/core-concepts",
    content: "capstan verify --json runs an 8-step verification: 1. TypeScript compilation, 2. Route scanning, 3. Schema validation, 4. Capability registration, 5. Policy evaluation, 6. Agent manifest generation, 7. OpenAPI spec validation, 8. Health check. Output is JSON designed for AI agents to parse, understand, and repair failures.",
    keywords: ["verify", "verification", "cascade", "tdd", "check"],
    topics: ["verification", "cli"],
  },

  // Database
  {
    slug: "database",
    title: "defineModel()",
    section: "Database",
    url: "/docs/database",
    content: "defineModel() creates typed database models. Field types: field.id() (UUID primary key), field.string(), field.text(), field.integer(), field.number(), field.boolean(), field.date(), field.datetime(), field.enum(), field.json(), field.vector(dimensions). Field options: required, unique, default, min, max, updatedAt, autoId, references. Relations: relation.belongsTo(), relation.hasMany(), relation.hasOne().",
    keywords: ["defineModel", "model", "field", "type", "relation", "belongsTo", "hasMany"],
    topics: ["database", "defineModel"],
  },
  {
    slug: "database",
    title: "Database Providers",
    section: "Database",
    url: "/docs/database",
    content: "4 database providers supported: SQLite via better-sqlite3 (default, filesystem or in-memory), PostgreSQL via pg, MySQL via mysql2, libSQL/Turso via @libsql/client. Configure in capstan.config.ts: database: { provider: 'sqlite' | 'postgres' | 'mysql' | 'libsql', url: './data.db' | 'postgres://...' }.",
    keywords: ["provider", "sqlite", "postgres", "mysql", "libsql", "turso", "configuration"],
    topics: ["database"],
  },
  {
    slug: "database",
    title: "Migrations",
    section: "Database",
    url: "/docs/database",
    content: "Database migration commands: capstan db:migrate (interactive migration prompt), capstan db:push (auto-generate from model definitions), capstan db:status (check current migration state). Uses Drizzle ORM under the hood.",
    keywords: ["migration", "migrate", "push", "status", "drizzle"],
    topics: ["database", "cli"],
  },
  {
    slug: "database",
    title: "Vector Search",
    section: "Database",
    url: "/docs/database",
    content: "field.vector(1536) creates a vector column for embeddings. Enables hybrid search combining keyword and semantic similarity. Useful for RAG (Retrieval-Augmented Generation) applications. Store embeddings from OpenAI, Anthropic, or other providers alongside structured data.",
    keywords: ["vector", "embedding", "search", "rag", "hybrid", "similarity"],
    topics: ["database", "ai"],
  },

  // Authentication
  {
    slug: "authentication",
    title: "JWT Sessions",
    section: "Authentication",
    url: "/docs/authentication",
    content: "For human users: signSession(payload, secret, maxAge) creates a JWT token. verifySession(token, secret) validates and returns the payload. payload contains userId, email, role. Import from @zauso-ai/capstan-auth.",
    keywords: ["jwt", "session", "signSession", "verifySession", "token"],
    topics: ["auth", "jwt"],
  },
  {
    slug: "authentication",
    title: "API Key Authentication",
    section: "Authentication",
    url: "/docs/authentication",
    content: "For AI agents: generateApiKey() returns { key, hash, prefix }. key is shown once to the user (cap_ak_...), hash is stored in DB (SHA-256), prefix is for fast lookup. verifyApiKey(plaintextKey, storedHash) validates. Import from @zauso-ai/capstan-auth.",
    keywords: ["api-key", "generateApiKey", "verifyApiKey", "agent", "key"],
    topics: ["auth", "api-key"],
  },
  {
    slug: "authentication",
    title: "OAuth Providers",
    section: "Authentication",
    url: "/docs/authentication",
    content: "Built-in OAuth providers: googleProvider({ clientId, clientSecret }), githubProvider({ clientId, clientSecret }). Import from @zauso-ai/capstan-auth. Configure in capstan.config.ts auth.providers array.",
    keywords: ["oauth", "google", "github", "provider", "social-login"],
    topics: ["auth", "oauth"],
  },
  {
    slug: "authentication",
    title: "Advanced Auth",
    section: "Authentication",
    url: "/docs/authentication",
    content: "DPoP (RFC 9449): Proof-of-Possession tokens prevent token theft. SPIFFE/mTLS: Service-to-service authentication for microservices. Token-aware rate limiting: Separate buckets for human (1000/hr), agent (100/hr), and anonymous (10/hr). CSRF protection built-in for form submissions.",
    keywords: ["dpop", "spiffe", "mtls", "rate-limit", "csrf", "advanced"],
    topics: ["auth"],
  },

  // Deployment
  {
    slug: "deployment",
    title: "Build Targets",
    section: "Deployment",
    url: "/docs/deployment",
    content: "6 build targets: npx capstan build --target node-standalone (minimal directory), --target docker (emits Dockerfile), --target vercel-node (serverless), --target vercel-edge (Edge runtime), --target cloudflare (Worker), --target fly (multi-region). Default build outputs to dist/ with _capstan_server.js, _capstan_manifest.json, openapi.json, deploy-manifest.json, public/.",
    keywords: ["build", "target", "node", "docker", "vercel", "cloudflare", "fly", "standalone"],
    topics: ["deployment", "build"],
  },
  {
    slug: "deployment",
    title: "Running Production",
    section: "Deployment",
    url: "/docs/deployment",
    content: "npx capstan start runs the production server. Options: --port 8080 (custom port), --from dist/standalone (from build output). Environment variables: PORT, CAPSTAN_HOST, CAPSTAN_PORT, DATABASE_URL, SESSION_SECRET. Static site generation: npx capstan build --static pre-renders all pages to dist/static/.",
    keywords: ["start", "production", "port", "environment", "static", "ssg"],
    topics: ["deployment"],
  },

  // AI Toolkit
  {
    slug: "core-concepts",
    title: "AI Toolkit",
    section: "Core Concepts",
    url: "/docs/core-concepts",
    content: "@zauso-ai/capstan-ai is a standalone AI toolkit. createAI() initializes with an LLM provider. think(llm, prompt, options) for single LLM calls with optional schema for structured output. generate() for streaming. remember(fact) and recall(query) for persistent memory. createHarness() for durable agent runtime with checkpoints, approvals, and recovery.",
    keywords: ["ai", "toolkit", "think", "generate", "remember", "recall", "harness", "llm", "createAI"],
    topics: ["ai", "ai-toolkit"],
  },

  // API Reference highlights
  {
    slug: "api-reference",
    title: "@zauso-ai/capstan-core",
    section: "API Reference",
    url: "/docs/api-reference",
    content: "defineAPI({ input, output, description, capability, resource, policy, handler }): Define an API endpoint. definePolicy({ key, title, effect, check }): Define a permission policy. defineMiddleware(handler): Define route-scoped middleware. defineConfig({ app, database, auth, agent, server }): Define application configuration. env(name): Read environment variable with validation.",
    keywords: ["core", "defineAPI", "definePolicy", "defineMiddleware", "defineConfig", "env"],
    topics: ["api", "reference"],
  },
  {
    slug: "api-reference",
    title: "@zauso-ai/capstan-react",
    section: "API Reference",
    url: "/docs/api-reference",
    content: "Outlet: Renders child routes in layouts. Link: Client-side navigation with prefetch ('hover' | 'viewport' | 'none'). useLoaderData(): Access data from page loaders. defineLoader(fn): Define SSR data loader. defineMetadata({ title, description, openGraph }): Page metadata. Image: Optimized image component with responsive srcset, lazy loading. ErrorBoundary: Error boundary wrapper.",
    keywords: ["react", "Outlet", "Link", "useLoaderData", "defineLoader", "defineMetadata", "Image", "ErrorBoundary"],
    topics: ["api", "reference", "react"],
  },
  {
    slug: "api-reference",
    title: "@zauso-ai/capstan-db",
    section: "API Reference",
    url: "/docs/api-reference",
    content: "defineModel(name, { fields, relations, indexes }): Define a database model. field.id(), field.string(), field.text(), field.integer(), field.number(), field.boolean(), field.date(), field.datetime(), field.enum(values), field.json(), field.vector(dimensions): Field type constructors. relation.belongsTo(), relation.hasMany(), relation.hasOne(): Relation types. createDatabaseClient(config): Create database connection.",
    keywords: ["db", "defineModel", "field", "relation", "createDatabaseClient", "drizzle"],
    topics: ["api", "reference", "database"],
  },
  {
    slug: "api-reference",
    title: "@zauso-ai/capstan-auth",
    section: "API Reference",
    url: "/docs/api-reference",
    content: "signSession(payload, secret, maxAge): Create JWT token. verifySession(token, secret): Validate JWT. generateApiKey(): Generate { key, hash, prefix }. verifyApiKey(key, hash): Validate API key. googleProvider(config): Google OAuth. githubProvider(config): GitHub OAuth.",
    keywords: ["auth", "signSession", "verifySession", "generateApiKey", "verifyApiKey", "oauth"],
    topics: ["api", "reference", "auth"],
  },
  {
    slug: "api-reference",
    title: "@zauso-ai/capstan-ai",
    section: "API Reference",
    url: "/docs/api-reference",
    content: "createAI({ llm }): Initialize AI toolkit. think(llm, prompt, options): Single LLM call with optional Zod schema for structured output. generate(llm, prompt): Streaming LLM call. thinkStream(llm, prompt): Streaming with structured output. remember(fact): Store to long-term memory. recall(query): Retrieve from memory. createHarness({ appName, runtimeDir }): Create durable agent runtime.",
    keywords: ["ai", "createAI", "think", "generate", "thinkStream", "remember", "recall", "createHarness"],
    topics: ["api", "reference", "ai"],
  },
  {
    slug: "api-reference",
    title: "@zauso-ai/capstan-cli",
    section: "API Reference",
    url: "/docs/api-reference",
    content: "capstan dev [--port]: Dev server with HMR. capstan build [--target] [--static]: Production build. capstan start [--port] [--from]: Production server. capstan verify [--json]: Verification cascade. capstan add api|page|model|policy <name>: Scaffold. capstan db:migrate|push|status: Database ops. capstan mcp: MCP server (stdio). capstan ops:events|incidents|health|tail: Operations. capstan harness:list|get|events|artifacts|approve|replay: Harness management.",
    keywords: ["cli", "dev", "build", "start", "verify", "add", "mcp", "ops", "harness"],
    topics: ["api", "reference", "cli"],
  },
  {
    slug: "api-reference",
    title: "@zauso-ai/capstan-cron",
    section: "API Reference",
    url: "/docs/api-reference",
    content: "defineCron({ id, schedule, handler }): Define a scheduled job with cron expression. createCronRunner(): Create runner instance. runner.add(job): Register a job. runner.start(): Start the scheduler. runner.stop(): Stop all jobs.",
    keywords: ["cron", "schedule", "defineCron", "createCronRunner", "job"],
    topics: ["api", "reference", "cron"],
  },
];

// --- Code Examples ---

export const CODE_EXAMPLES: CodeExample[] = [
  {
    title: "Basic API Endpoint",
    description: "Define a simple GET endpoint with input validation and typed output using defineAPI()",
    code: `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  input: z.object({
    status: z.enum(["open", "closed"]).optional(),
  }),
  output: z.object({
    tickets: z.array(z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
    })),
  }),
  description: "List support tickets",
  capability: "read",
  resource: "ticket",
  async handler({ input }) {
    return { tickets: await db.tickets.list(input) };
  },
});`,
    language: "typescript",
    topics: ["defineAPI", "api", "endpoint", "routing"],
    relatedDocs: "/docs/core-concepts",
  },
  {
    title: "POST API with Auth Policy",
    description: "Create endpoint with write capability and authentication policy",
    code: `import { defineAPI } from "@zauso-ai/capstan-core";
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
    return {
      id: crypto.randomUUID(),
      title: input.title,
      status: "open",
    };
  },
});`,
    language: "typescript",
    topics: ["defineAPI", "api", "policy", "auth", "write"],
    relatedDocs: "/docs/core-concepts",
  },
  {
    title: "Database Model",
    description: "Define a typed database model with relations using defineModel()",
    code: `import { defineModel, field, relation } from "@zauso-ai/capstan-db";

export const Ticket = defineModel("ticket", {
  fields: {
    id: field.id(),
    title: field.string({ required: true, min: 1, max: 200 }),
    status: field.enum(["open", "in_progress", "closed"], { default: "open" }),
    priority: field.enum(["low", "medium", "high"], { default: "medium" }),
    assigneeId: field.string({ references: "user" }),
    createdAt: field.datetime({ default: "now" }),
    updatedAt: field.datetime({ updatedAt: true }),
  },
  relations: {
    assignee: relation.belongsTo("user", { foreignKey: "assigneeId" }),
    comments: relation.hasMany("comment"),
  },
  indexes: [
    { fields: ["status"], unique: false },
    { fields: ["assigneeId", "status"], unique: false },
  ],
});`,
    language: "typescript",
    topics: ["defineModel", "database", "model", "field", "relation"],
    relatedDocs: "/docs/database",
  },
  {
    title: "Authentication Policy",
    description: "Define a reusable authentication policy with definePolicy()",
    code: `import { definePolicy } from "@zauso-ai/capstan-core";

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
      return { effect: "deny", reason: "Admin access required" };
    }
    return { effect: "allow" };
  },
});`,
    language: "typescript",
    topics: ["definePolicy", "policy", "auth", "access-control"],
    relatedDocs: "/docs/core-concepts",
  },
  {
    title: "Page with Loader",
    description: "SSR page with server-side data loading using defineLoader and useLoaderData",
    code: `import { createElement } from "react";
import { defineLoader, useLoaderData } from "@zauso-ai/capstan-react";

export const loader = defineLoader(async (ctx) => {
  const tickets = await db.query.ticket.findMany();
  return { tickets };
});

export default function TicketsPage() {
  const { tickets } = useLoaderData();
  return createElement("div", null,
    createElement("h1", null, "Tickets"),
    createElement("ul", null,
      tickets.map(t =>
        createElement("li", { key: t.id }, t.title)
      )
    )
  );
}`,
    language: "typescript",
    topics: ["loader", "defineLoader", "useLoaderData", "page", "ssr", "data-fetching"],
    relatedDocs: "/docs/core-concepts",
  },
  {
    title: "Layout with Navigation",
    description: "Root layout wrapping all routes with shared navigation and footer",
    code: `import { createElement } from "react";
import { Outlet } from "@zauso-ai/capstan-react";

export default function RootLayout() {
  return createElement("html", { lang: "en" },
    createElement("head", null,
      createElement("meta", { charSet: "utf-8" }),
      createElement("title", null, "My App")
    ),
    createElement("body", null,
      createElement("nav", null,
        createElement("a", { href: "/" }, "Home"),
        createElement("a", { href: "/tickets" }, "Tickets")
      ),
      createElement(Outlet, null),
      createElement("footer", null, "Built with Capstan")
    )
  );
}`,
    language: "typescript",
    topics: ["layout", "Outlet", "routing", "navigation"],
    relatedDocs: "/docs/core-concepts",
  },
  {
    title: "Middleware",
    description: "Route-scoped middleware for logging and timing",
    code: `import { defineMiddleware } from "@zauso-ai/capstan-core";

export default defineMiddleware(async (ctx, next) => {
  const start = Date.now();
  console.log(\`[\${ctx.request.method}] \${ctx.request.url}\`);
  await next();
  console.log(\`Completed in \${Date.now() - start}ms\`);
});`,
    language: "typescript",
    topics: ["middleware", "defineMiddleware", "logging"],
    relatedDocs: "/docs/core-concepts",
  },
  {
    title: "JWT Authentication",
    description: "Sign and verify JWT sessions for human users",
    code: `import { signSession, verifySession } from "@zauso-ai/capstan-auth";

// Login handler — create session
const token = signSession(
  { userId: "user_123", email: "alice@example.com", role: "admin" },
  process.env.SESSION_SECRET!,
  "7d"
);

// Verify in middleware or handler
const payload = verifySession(token, process.env.SESSION_SECRET!);
// payload.userId === "user_123"`,
    language: "typescript",
    topics: ["jwt", "auth", "session", "signSession", "verifySession"],
    relatedDocs: "/docs/authentication",
  },
  {
    title: "API Key for Agents",
    description: "Generate and verify API keys for AI agent authentication",
    code: `import { generateApiKey, verifyApiKey } from "@zauso-ai/capstan-auth";

// Generate (show key to user once, store hash in DB)
const { key, hash, prefix } = generateApiKey();
// key:    "cap_ak_a1b2c3d4e5f6..."
// hash:   "sha256hexdigest..."
// prefix: "cap_ak_a1b2c3d4"

// Verify incoming request
const isValid = await verifyApiKey(plaintextKey, storedHash);`,
    language: "typescript",
    topics: ["api-key", "auth", "agent", "generateApiKey", "verifyApiKey"],
    relatedDocs: "/docs/authentication",
  },
  {
    title: "AI Toolkit Usage",
    description: "Standalone AI toolkit with LLM calls and persistent memory",
    code: `import { createAI } from "@zauso-ai/capstan-ai";

const ai = createAI({ llm: openaiProvider({ apiKey: "..." }) });

// Single LLM call
await ai.think("Analyze this data");

// Structured output with Zod schema
const result = await ai.think("Classify this ticket", {
  schema: z.object({
    category: z.enum(["bug", "feature", "question"]),
    priority: z.enum(["low", "medium", "high"]),
  }),
});

// Persistent memory
await ai.remember("User prefers dark mode");
const prefs = await ai.memory.about("customer", "c-42").recall("preferences");`,
    language: "typescript",
    topics: ["ai", "ai-toolkit", "think", "remember", "recall", "llm", "createAI"],
    relatedDocs: "/docs/api-reference",
  },
  {
    title: "Capstan Configuration",
    description: "Full capstan.config.ts with all major options",
    code: `import { defineConfig, env } from "@zauso-ai/capstan-core";

export default defineConfig({
  app: {
    name: "my-app",
    title: "My Application",
    description: "Description for agents",
  },
  database: {
    provider: "sqlite",
    url: "./data.db",
  },
  auth: {
    providers: [{ type: "apiKey" }],
    session: {
      secret: env("SESSION_SECRET"),
      maxAge: "7d",
    },
  },
  agent: {
    manifest: true,
    mcp: true,
    openapi: true,
  },
  server: {
    port: 3000,
  },
});`,
    language: "typescript",
    topics: ["config", "defineConfig", "configuration", "setup"],
    relatedDocs: "/docs/getting-started",
  },
  {
    title: "Scheduled Job",
    description: "Define and run a recurring cron job",
    code: `import { defineCron, createCronRunner } from "@zauso-ai/capstan-cron";

const syncJob = defineCron({
  id: "sync-tickets",
  schedule: "0 * * * *", // Every hour
  handler: async () => {
    console.log("Syncing tickets...");
    // Your sync logic here
  },
});

const runner = createCronRunner();
runner.add(syncJob);
runner.start();`,
    language: "typescript",
    topics: ["cron", "schedule", "defineCron", "job", "recurring"],
    relatedDocs: "/docs/api-reference",
  },
  {
    title: "Docker Deployment",
    description: "Build and deploy with Docker using multi-stage build",
    code: `# Build
npx capstan build --target docker

# The generated Dockerfile uses multi-stage build:
# Stage 1: Build with full Node.js
# Stage 2: Run with minimal Alpine

# Run locally
docker build -t my-app .
docker run -p 3000:3000 my-app`,
    language: "bash",
    topics: ["deployment", "docker", "build", "production"],
    relatedDocs: "/docs/deployment",
  },
  {
    title: "Approval Workflow Policy",
    description: "Policy that requires human approval for high-value operations",
    code: `import { definePolicy } from "@zauso-ai/capstan-core";

export const requireApproval = definePolicy({
  key: "requireApproval",
  title: "Require Human Approval",
  effect: "approve",
  async check({ ctx, input }) {
    if (ctx.auth.type === "agent") {
      return {
        effect: "approve",
        reason: "Agent actions require human approval",
      };
    }
    return { effect: "allow" };
  },
});

// Use in defineAPI:
// policy: "requireApproval"
// Agent requests are held at POST /capstan/approvals/:id`,
    language: "typescript",
    topics: ["policy", "approval", "human-in-the-loop", "definePolicy"],
    relatedDocs: "/docs/core-concepts",
  },
];

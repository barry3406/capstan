// ---------------------------------------------------------------------------
// Template strings for generated Capstan projects
// ---------------------------------------------------------------------------

export function packageJson(
  projectName: string,
  template: "blank" | "tickets" = "blank",
): string {
  const deps: Record<string, string> = {
    "@zauso-ai/capstan-cli": "^1.0.0-beta.3",
    "@zauso-ai/capstan-core": "^1.0.0-beta.3",
    "@zauso-ai/capstan-dev": "^1.0.0-beta.3",
    "@zauso-ai/capstan-react": "^1.0.0-beta.3",
    "@zauso-ai/capstan-router": "^1.0.0-beta.3",
    zod: "^3.23.0",
  };

  // Only include capstan-db for templates that actually use it (native dep
  // issues with better-sqlite3 make it a poor default).
  if (template === "tickets") {
    deps["@zauso-ai/capstan-auth"] = "^1.0.0-beta.3";
    deps["@zauso-ai/capstan-db"] = "^1.0.0-beta.3";
  }

  return JSON.stringify(
    {
      name: projectName,
      version: "0.1.0",
      type: "module",
      private: true,
      scripts: {
        dev: "capstan dev",
        build: "capstan build",
        start: "capstan start",
      },
      dependencies: deps,
      devDependencies: {
        typescript: "^5.9.0",
        "@types/node": "^24.0.0",
      },
    },
    null,
    2,
  );
}

export function tsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        jsx: "react-jsx",
        strict: true,
        outDir: "dist",
        rootDir: ".",
      },
      include: ["app/**/*.ts", "app/**/*.tsx", "capstan.config.ts"],
    },
    null,
    2,
  );
}

export function capstanConfig(
  projectName: string,
  title: string,
  template: "blank" | "tickets" = "blank",
): string {
  const dbBlock =
    template === "tickets"
      ? `
  database: {
    provider: "sqlite",
    url: env("DATABASE_URL") || "./data.db",
  },
  auth: {
    providers: [
      { type: "apiKey" },
    ],
    session: {
      secret: env("SESSION_SECRET") || crypto.randomUUID(),
      maxAge: "7d",
    },
  },`
      : "";

  return `import { defineConfig, env } from "@zauso-ai/capstan-core";

export default defineConfig({
  app: {
    name: "${projectName}",
    title: "${title}",
    description: "A Capstan application",
  },${dbBlock}
  agent: {
    manifest: true,
    mcp: true,
    openapi: true,
  },
});
`;
}

export function rootLayout(title: string): string {
  return `import { Outlet } from "@zauso-ai/capstan-react";

export default function RootLayout() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <link rel="stylesheet" href="/styles.css" precedence="default" />
      </head>
      <body>
        <Outlet />
      </body>
    </html>
  );
}
`;
}

export function indexPage(title: string): string {
  return `export default function HomePage() {
  return (
    <main>
      <h1>Welcome to ${title}</h1>
      <p>Built with Capstan — the AI Agent Native full-stack framework.</p>
      <nav>
        <ul>
          <li><a href="/.well-known/capstan.json">Agent Manifest</a></li>
          <li><a href="/openapi.json">OpenAPI Spec</a></li>
          <li><a href="/health">Health Check</a></li>
        </ul>
      </nav>
    </main>
  );
}
`;
}

export function healthApi(): string {
  return `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  output: z.object({
    status: z.string(),
    timestamp: z.string(),
  }),
  description: "Health check endpoint",
  capability: "read",
  async handler() {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
    };
  },
});
`;
}

export function policiesIndex(): string {
  return `import { definePolicy } from "@zauso-ai/capstan-core";

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
`;
}

export function gitignore(): string {
  return `node_modules/
dist/
.capstan/
*.db
.env
.env.local
`;
}

export function mainCss(): string {
  return `/* app/styles/main.css — processed by Lightning CSS or Tailwind */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  line-height: 1.6;
  color: #1a1a2e;
  background: #f8f9fa;
}

a { color: #0066cc; text-decoration: none; }
a:hover { text-decoration: underline; }

code {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  background: #e9ecef;
  padding: 0.15em 0.3em;
  border-radius: 3px;
  font-size: 0.9em;
}
`;
}

// ---------------------------------------------------------------------------
// AGENTS.md
// ---------------------------------------------------------------------------

export function agentsMd(
  projectName: string,
  template: "blank" | "tickets",
): string {
  const ticketsNote =
    template === "tickets"
      ? `
## Tickets Template

This project was scaffolded with the **tickets** template, which includes:
- \`app/models/ticket.model.ts\` — Ticket data model (status, priority fields)
- \`app/routes/tickets/index.api.ts\` — GET (list) + POST (create) for tickets
- \`app/routes/tickets/[id].api.ts\` — GET ticket by ID

Use these as reference when adding new resources.
`
      : "";

  return `# AGENTS.md — AI Coding Guide for Capstan

This file teaches AI coding agents (Claude Code, Cursor, Codex, etc.) how to build applications with the Capstan framework. Read this entire file before writing any code.

## Project: ${projectName}

## Project Structure

\`\`\`
app/
  routes/              — File-based routing (the core of your app)
    *.api.ts           — API route: export GET, POST, PUT, DELETE handlers
    *.page.tsx         — Page route: export default React component + optional loader
    _layout.tsx        — Layout wrapper: wraps all sibling and child routes
    _middleware.ts     — Middleware: runs before all sibling and child routes
    _loading.tsx       — Suspense fallback for sibling/child pages
    _error.tsx         — Error boundary for sibling/child pages
    [param]/           — Dynamic segment: value available via ctx/params
    [...catchAll]/     — Catch-all segment: matches any remaining path
  models/              — Data model definitions (defineModel)
  policies/            — Permission policies (definePolicy)
  migrations/          — SQL migration files
  public/              — Static assets (CSS, images, fonts) served at root URL
capstan.config.ts      — Framework configuration
\`\`\`
${ticketsNote}
## Commands

\`\`\`bash
capstan dev                 # Dev server with live reload (default port 3000)
capstan dev --port 4000     # Custom port
capstan build               # Production build (tsc + manifest + server entry)
capstan start               # Run production server
capstan verify --json       # AI TDD: structured diagnostics for auto-fix
capstan add model <name>    # Scaffold a model
capstan add api <name>      # Scaffold API routes
capstan add page <name>     # Scaffold a page
capstan add policy <name>   # Scaffold a policy
capstan mcp                 # Start MCP server (stdio, for Claude Desktop)
capstan db:migrate          # Generate migration SQL from models
capstan db:push             # Apply pending migrations to database
capstan db:status           # Show migration status
turbo:build                 # Parallel builds with caching (Turborepo)
\`\`\`

## defineAPI() — Complete Reference

Every API route exports HTTP method handlers created with \`defineAPI()\`:

\`\`\`typescript
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  // --- Schema (required for type safety) ---
  input: z.object({                    // Query params (GET) or request body (POST/PUT)
    status: z.string().optional(),
    page: z.coerce.number().default(1),
  }),
  output: z.object({                   // Response shape (also used for OpenAPI spec)
    items: z.array(z.object({ id: z.string(), title: z.string() })),
    total: z.number(),
  }),

  // --- Metadata (used for MCP/A2A/OpenAPI generation) ---
  description: "List all items",       // Human & agent readable description
  capability: "read",                  // "read" or "write" — determines MCP tool behavior
  resource: "item",                    // Groups related APIs in the agent manifest

  // --- Authorization ---
  policy: "requireAuth",               // Policy key from app/policies/ (optional)

  // --- Handler ---
  async handler({ input, ctx, params }) {
    // input: parsed & validated by Zod (type-safe)
    // ctx.auth: { isAuthenticated, type, userId?, permissions[] }
    // ctx.request: raw Request object
    // ctx.env: process.env record
    // params: route parameters (e.g. params.id for [id].api.ts routes)

    return { items: [], total: 0 };    // Must match output schema
  },
});
\`\`\`

### Handler Context (\`ctx\`) and \`params\`

\`\`\`typescript
interface CapstanContext {
  auth: {
    isAuthenticated: boolean;
    type: "anonymous" | "human" | "agent";
    userId?: string;
    permissions: string[];
  };
  request: Request;           // Standard Web API Request
  env: Record<string, string | undefined>;  // process.env
}

// params: Record<string, string>
// For a route file at app/routes/tickets/[id].api.ts:
//   GET /tickets/abc123 → params.id === "abc123"
\`\`\`

### Rate Limiting

\`\`\`typescript
import { defineRateLimit } from "@zauso-ai/capstan-core";

export const rateLimit = defineRateLimit({
  limit: 100,                         // Max requests per window
  window: "1m",                       // Window duration
  byAuthType: {                       // Per-auth-type overrides (optional)
    human: { limit: 200, window: "1m" },
    agent: { limit: 500, window: "1m" },
    anonymous: { limit: 20, window: "1m" },
  },
});
\`\`\`

Returns \`429 Too Many Requests\` with \`Retry-After\` and \`X-RateLimit-*\` headers when exceeded.

### Multi-protocol: one defineAPI() → four surfaces

Every \`defineAPI()\` call automatically generates:
1. **HTTP JSON API** — standard REST endpoint
2. **MCP Tool** — usable by Claude Desktop, Cursor, etc.
3. **A2A Skill** — Google Agent-to-Agent protocol
4. **OpenAPI 3.1** — auto-generated spec at \`/openapi.json\`

No extra code needed. The \`description\`, \`input\`, \`output\` fields drive all four.

## Page Routes (.page.tsx) — Streaming SSR with Data Loading

Capstan uses React 18 streaming SSR (\`renderToReadableStream\`) for optimal TTFB.

\`\`\`typescript
// app/routes/users/index.page.tsx
import { useLoaderData } from "@zauso-ai/capstan-react";

// Server-side data loader (runs on every request, before render)
export async function loader({ params, request, ctx, fetch }) {
  // fetch.get/post/put/delete call your own API routes in-process (no HTTP round-trip)
  const data = await fetch.get("/api/users");
  return { users: data.users };
}

// React component (server-rendered, then hydrated on client)
export default function UsersPage() {
  const { users } = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>Users ({users.length})</h1>
      <ul>
        {users.map(u => <li key={u.id}>{u.name}</li>)}
      </ul>
    </div>
  );
}
\`\`\`

### Selective Hydration

Pages can export a \`hydration\` constant to control client-side JS behavior:

\`\`\`typescript
// "none" = zero client JS (server-only rendering, no hydration)
// "visible" = lazy hydration via IntersectionObserver (hydrates when scrolled into view)
// "full" = default behavior (immediate hydration)
export const hydration = "none";

export default function StaticPage() {
  return <div>This page ships zero client JS</div>;
}
\`\`\`

### Client Components

Pages with \`"use client"\` at the top are detected as client components:

\`\`\`typescript
"use client";
export default function InteractivePage() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
\`\`\`

### Render Mode & ISR

Control how each page is rendered by exporting \`renderMode\`, \`revalidate\`, and \`cacheTags\`:

\`\`\`typescript
// app/routes/blog/index.page.tsx
export const renderMode = "isr";    // "ssr" (default) | "ssg" | "isr" | "streaming"
export const revalidate = 60;       // Revalidate every 60 seconds (ISR)
export const cacheTags = ["blog"];   // Invalidate via cacheInvalidateTag("blog")

export async function loader({ fetch }: LoaderArgs) {
  return { posts: await fetch.get("/api/posts") };
}

export default function BlogPage() {
  const { posts } = useLoaderData<{ posts: Post[] }>();
  return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
}
\`\`\`

ISR behavior: fresh cache returns immediately, stale cache returns + revalidates in background, miss renders and caches. \`cacheInvalidateTag("blog")\` evicts both data cache and page cache entries.

### Loading & Error Boundaries

\`_loading.tsx\` and \`_error.tsx\` are file conventions like \`_layout.tsx\`. They scope to all pages in the same directory and subdirectories, with the nearest file winning.

\`\`\`
app/routes/
  _loading.tsx           # Default loading UI for all pages
  _error.tsx             # Default error UI for all pages
  index.page.tsx
  dashboard/
    _loading.tsx         # Dashboard-specific loading (overrides parent)
    index.page.tsx
\`\`\`

\`_loading.tsx\` — export a default React component (no props). Used as \`<Suspense>\` fallback:

\`\`\`typescript
export default function Loading() {
  return <div className="spinner">Loading...</div>;
}
\`\`\`

\`_error.tsx\` — export a default React component receiving \`{ error, reset }\`. Used as \`<ErrorBoundary>\` fallback:

\`\`\`typescript
export default function ErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <p>Something went wrong: {error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
\`\`\`

### Client-Side Navigation

Use \`<Link>\` for SPA navigation without full-page reloads:

\`\`\`typescript
import { Link } from "@zauso-ai/capstan-react/client";

<Link href="/about">About</Link>
<Link href="/posts" prefetch="viewport">Posts</Link>
<Link href="/settings" prefetch="none" replace>Settings</Link>
\`\`\`

\`Link\` renders a standard \`<a>\` (works without JS). When the client router is active, clicks are intercepted for instant SPA transitions. Prefetch strategies: \`"hover"\` (default, 80ms delay), \`"viewport"\` (IntersectionObserver), \`"none"\`.

Programmatic navigation:

\`\`\`typescript
import { useNavigate, useRouterState } from "@zauso-ai/capstan-react/client";

function MyComponent() {
  const navigate = useNavigate();
  const { url, status } = useRouterState(); // status: "idle" | "loading" | "error"

  return <button onClick={() => navigate("/dashboard")}>Go</button>;
}
\`\`\`

Add \`data-capstan-external\` to any \`<a>\` tag to opt out of SPA interception. View Transitions are applied automatically when the browser supports \`document.startViewTransition()\`.

### ServerOnly Wrapper

Use \`ServerOnly\` to exclude content from client bundles entirely:

\`\`\`typescript
import { ServerOnly } from "@zauso-ai/capstan-react";

export default function Page() {
  return (
    <div>
      <p>This renders everywhere</p>
      <ServerOnly>
        <SecretAdminPanel />  {/* Never sent to client */}
      </ServerOnly>
    </div>
  );
}
\`\`\`

### Loader context

\`\`\`typescript
export async function loader({ params, request, ctx, fetch }) {
  // params:   route parameters (e.g. params.id for [id].page.tsx)
  // request:  raw Web API Request object
  // ctx.auth: { isAuthenticated, type: "human"|"agent"|"anonymous", userId?, permissions[] }
  // fetch:    in-process fetch to call your own API routes without HTTP overhead
  //           fetch.get<T>(path, queryParams?)
  //           fetch.post<T>(path, body?)
  //           fetch.put<T>(path, body?)
  //           fetch.delete<T>(path)
}
\`\`\`

## Layouts and Middleware

### Layout (\`_layout.tsx\`) — wraps all routes in the same directory and below

The **root layout** must provide the full HTML document structure (\`<html>\`, \`<head>\`, \`<body>\`).
This is where you add CSS, fonts, meta tags, and other \`<head>\` content.

\`\`\`typescript
// app/routes/_layout.tsx  (root layout — provides the HTML document)
import { Outlet } from "@zauso-ai/capstan-react";

export default function RootLayout() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${projectName}</title>
        <link rel="stylesheet" href="/styles.css" precedence="default" />
      </head>
      <body>
        <Outlet />  {/* Child route renders here */}
      </body>
    </html>
  );
}
\`\`\`

### Nested layouts — build a layout hierarchy

Layouts nest automatically by directory. Each \`_layout.tsx\` wraps all sibling and child routes:

\`\`\`
app/routes/
  _layout.tsx              ← Root: <html>, <head>, <body>
  index.page.tsx           ← Wrapped by root layout only
  dashboard/
    _layout.tsx            ← Dashboard shell: sidebar + nav
    index.page.tsx         ← Wrapped by root → dashboard
    settings.page.tsx      ← Wrapped by root → dashboard
\`\`\`

Nested layouts render only their own UI and an \`<Outlet />\` (no \`<html>\`/\`<head>\`):

\`\`\`typescript
// app/routes/dashboard/_layout.tsx
import { Outlet } from "@zauso-ai/capstan-react";

export default function DashboardLayout() {
  return (
    <div className="dashboard">
      <nav>Dashboard Nav</nav>
      <main><Outlet /></main>
    </div>
  );
}
\`\`\`

All layout modules for a route are loaded in parallel for performance.

### Middleware (\`_middleware.ts\`) — runs before all routes in the same directory and below

\`\`\`typescript
// app/routes/api/_middleware.ts
import { defineMiddleware } from "@zauso-ai/capstan-core";

export default defineMiddleware(async ({ ctx, next }) => {
  console.log(\`[\${ctx.request.method}] \${new URL(ctx.request.url).pathname}\`);
  return next();  // Must call next() to continue the chain
});
\`\`\`

## Data Models

\`\`\`typescript
// app/models/user.model.ts
import { defineModel, field, relation } from "@zauso-ai/capstan-db";

export const User = defineModel("user", {
  fields: {
    id: field.id(),                                    // Auto-generated UUID primary key
    name: field.string({ required: true, max: 100 }),
    email: field.string({ required: true, unique: true }),
    role: field.enum(["admin", "user", "guest"], { default: "user" }),
    bio: field.text(),                                 // Long text
    age: field.integer({ min: 0, max: 150 }),
    score: field.number(),                             // Floating point
    isActive: field.boolean({ default: true }),
    metadata: field.json(),                            // Arbitrary JSON
    birthDate: field.date(),                           // Date only (ISO-8601)
    createdAt: field.datetime({ default: "now" }),     // Auto-set on create
    updatedAt: field.datetime({ updatedAt: true }),    // Auto-set on update
  },
  relations: {
    posts: relation.hasMany("post"),                   // User has many Posts
    profile: relation.hasOne("profile"),               // User has one Profile
    department: relation.belongsTo("department"),      // User belongs to Department
    tags: relation.manyToMany("tag", { through: "user_tag" }),
  },
  indexes: [
    { fields: ["email"], unique: true },
    { fields: ["role", "isActive"] },
  ],
});
\`\`\`

### Field types → database mapping

| Field helper      | SQLite    | PostgreSQL      | MySQL           |
|-------------------|-----------|-----------------|-----------------|
| field.id()        | TEXT PK   | TEXT PK         | VARCHAR(36) PK  |
| field.string()    | TEXT      | VARCHAR(255)    | VARCHAR(255)    |
| field.text()      | TEXT      | TEXT            | TEXT            |
| field.integer()   | INTEGER   | INTEGER         | INT             |
| field.number()    | REAL      | DOUBLE PREC.    | DOUBLE          |
| field.boolean()   | INTEGER   | BOOLEAN         | BOOLEAN         |
| field.date()      | TEXT      | TEXT            | TEXT            |
| field.datetime()  | TEXT      | TIMESTAMP       | DATETIME        |
| field.json()      | TEXT      | JSONB           | JSON            |
| field.enum()      | TEXT      | VARCHAR(255)    | VARCHAR(255)    |
| field.vector(dim) | BLOB      | vector(dim)     | BLOB            |

### Vector Search & RAG

Use \`field.vector(dimensions)\` for semantic search and RAG pipelines:

\`\`\`typescript
import { defineModel, field } from "@zauso-ai/capstan-db";
import { defineEmbedding, openaiEmbeddings } from "@zauso-ai/capstan-db";

export const Document = defineModel("document", {
  fields: {
    id: field.id(),
    content: field.text({ required: true }),
    embedding: field.vector(1536),          // Vector field (1536 dims for OpenAI ada-002)
  },
});

// Auto-embed: whenever "content" changes, re-compute "embedding"
export const docEmbedding = defineEmbedding({
  sourceField: "content",
  vectorField: "embedding",
  adapter: openaiEmbeddings({
    apiKey: process.env.OPENAI_API_KEY!,
    model: "text-embedding-ada-002",        // optional, default
    dimensions: 1536,                        // optional, default
  }),
});
\`\`\`

Search utilities:

\`\`\`typescript
import { cosineDistance, findNearest, hybridSearch } from "@zauso-ai/capstan-db";

// Find nearest vectors by cosine distance
const results = await findNearest(db, "document", queryVector, { limit: 10 });

// Cosine distance for custom queries
const dist = cosineDistance(vectorA, vectorB);

// Hybrid search: combines vector similarity + full-text keyword matching
const results = await hybridSearch(db, "document", {
  query: "deployment architecture",
  vector: queryVector,
  limit: 10,
});
\`\`\`

## Database Configuration

\`\`\`typescript
// capstan.config.ts
export default defineConfig({
  database: {
    provider: "sqlite",                    // "sqlite" | "postgres" | "mysql" | "libsql"
    url: env("DATABASE_URL") || "./data.db",
    // PostgreSQL: "postgres://user:pass@host:5432/dbname"
    // MySQL: "mysql://user:pass@host:3306/dbname"
    // libSQL/Turso: "libsql://your-db.turso.io?authToken=..."
  },
});
\`\`\`

Install the driver for your provider:
\`\`\`bash
npm install better-sqlite3              # SQLite
npm install pg                          # PostgreSQL
npm install mysql2                      # MySQL
npm install @libsql/client              # libSQL / Turso
\`\`\`

## Querying the Database in Handlers

\`\`\`typescript
// app/db.ts — shared database instance
import { createDatabase } from "@zauso-ai/capstan-db";

const { db, close } = await createDatabase({ provider: "sqlite", url: "./data.db" });
export { db, close };
\`\`\`

\`\`\`typescript
// app/routes/tickets/index.api.ts — using the database in a handler
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";
import { db } from "../../db.js";

export const GET = defineAPI({
  output: z.object({ items: z.array(z.any()) }),
  description: "List all tickets",
  capability: "read",
  async handler({ input, ctx }) {
    // db is a Drizzle ORM instance — use Drizzle query syntax
    // See: https://orm.drizzle.team/docs/select
    return { items: [] };
  },
});
\`\`\`

\`createDatabase()\` is async — it accepts \`{ provider, url }\` and returns \`Promise<{ db, close }>\`.
- \`db\` — a Drizzle ORM instance (SQLite, PostgreSQL, or MySQL depending on provider)
- \`close()\` — closes the underlying connection pool (call on shutdown)

## Policies — Authorization

\`\`\`typescript
// app/policies/index.ts
import { definePolicy } from "@zauso-ai/capstan-core";

// Four possible effects: "allow" | "deny" | "approve" | "redact"

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
    if (!ctx.auth.permissions.includes("admin:*")) {
      return { effect: "deny", reason: "Admin access required" };
    }
    return { effect: "allow" };
  },
});

// "approve" effect = human-in-the-loop (agent must wait for approval)
export const requireApproval = definePolicy({
  key: "requireApproval",
  title: "Require Human Approval",
  effect: "approve",
  async check({ ctx, input }) {
    return { effect: "approve", reason: "This action requires human approval" };
  },
});
\`\`\`

Reference in API routes: \`policy: "requireAuth"\` or \`policy: "requireAdmin"\`.

## Static Assets

Place files in \`app/public/\`. They are served at the root URL:

\`\`\`
app/public/logo.png       → GET /logo.png
app/public/js/app.js      → GET /js/app.js
\`\`\`

## CSS & Styling

Place CSS files in \`app/styles/\`. The entry point is \`app/styles/main.css\`.

### Default (Lightning CSS)
Capstan auto-processes CSS with Lightning CSS: \`@import\` resolution, vendor prefixing, CSS nesting, and minification.

### With Tailwind CSS
If \`main.css\` contains \`@import "tailwindcss"\`, Capstan auto-detects and runs the Tailwind CLI:
\`\`\`css
/* app/styles/main.css */
@import "tailwindcss";
\`\`\`
Install Tailwind: \`npm install tailwindcss @tailwindcss/cli\`

### Referencing in layouts
\`\`\`tsx
<link rel="stylesheet" href="/styles.css" precedence="default" />
\`\`\`
React 19 auto-hoists \`<link>\` tags to \`<head>\` and prevents FOUC.

## Auto-generated Endpoints

These are created automatically by the framework:

| Endpoint | Description |
|----------|-------------|
| \`GET /.well-known/capstan.json\` | Agent discovery manifest |
| \`GET /.well-known/agent.json\` | A2A agent card |
| \`POST /.well-known/a2a\` | A2A JSON-RPC handler |
| \`POST /.well-known/mcp\` | MCP Streamable HTTP transport |
| \`GET /openapi.json\` | OpenAPI 3.1 specification |
| \`GET /capstan/approvals\` | List pending approval requests |
| \`POST /capstan/approvals/:id/approve\` | Approve a pending action |
| \`POST /capstan/approvals/:id/deny\` | Deny a pending action |

MCP is available via both **stdio** (\`capstan mcp\`) and **Streamable HTTP** (\`POST /.well-known/mcp\`).

### MCP Client — Consuming External MCP Servers

\`\`\`typescript
import { createMcpClient } from "@zauso-ai/capstan-agent";

const client = createMcpClient({ url: "https://other-service.example.com/.well-known/mcp" });
const tools = await client.listTools();
const result = await client.callTool("toolName", { arg: "value" });
\`\`\`

### LangChain Integration

Convert your CapabilityRegistry into LangChain-compatible tools:

\`\`\`typescript
import { registry } from "@zauso-ai/capstan-agent";

const langchainTools = registry.toLangChain({ baseUrl: "http://localhost:3000" });
// Use with LangChain agents, chains, or other LangChain-compatible tooling
\`\`\`

## OAuth Providers (Social Login)

Capstan includes built-in OAuth helpers for Google and GitHub. \`createOAuthHandlers()\` manages the full authorization code flow: CSRF state, token exchange, user info fetching, and JWT session creation.

\`\`\`typescript
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

// Mount these handlers:
// GET /auth/login/:provider  — redirects to OAuth provider
// GET /auth/callback         — handles callback, creates session, redirects to /
\`\`\`

## Authentication — Advanced

### DPoP Sender-Constrained Tokens (RFC 9449)

Capstan supports DPoP (Demonstrating Proof-of-Possession) for sender-constrained tokens, preventing token theft and replay attacks.

### Agent Workload Identity

For service-to-service authentication, Capstan supports SPIFFE/mTLS via \`X-Client-Cert\` headers:

\`\`\`typescript
// capstan.config.ts
export default defineConfig({
  auth: {
    trustedDomains: ["spiffe://cluster.local/ns/prod/sa/my-service"],
    // mTLS certificates validated via X-Client-Cert header
  },
});
\`\`\`

## Testing

### MCP Test Harness

Test MCP tools in-process without starting a server:

\`\`\`typescript
import { McpTestHarness } from "@zauso-ai/capstan-agent";

const harness = new McpTestHarness(registry);
const result = await harness.callTool("listTickets", { status: "open" });
// Assert against result
\`\`\`

### MCP HTTP Test Client

Test MCP endpoints over HTTP:

\`\`\`typescript
import { McpHttpTestClient } from "@zauso-ai/capstan-agent";

const client = new McpHttpTestClient("http://localhost:3000/.well-known/mcp");
const tools = await client.listTools();
const result = await client.callTool("createTicket", { title: "Bug" });
\`\`\`

### Cross-Protocol Contract Testing

\`capstan verify --json\` includes step 8: **cross-protocol** — validates that HTTP, MCP, A2A, and OpenAPI surfaces all expose consistent schemas and capabilities.

## Verification — AI TDD Self-Loop

After every code change, run:
\`\`\`bash
capstan verify --json
\`\`\`

Output includes \`repairChecklist\` with:
- \`fixCategory\`: type_error, schema_mismatch, missing_file, policy_violation, contract_drift, missing_export
- \`autoFixable\`: boolean — whether the AI agent can fix it automatically
- \`description\`: what is wrong and how to fix it

The 8-step verification cascade:
1. **structure** — required files exist
2. **config** — capstan.config.ts loads
3. **routes** — API files export handlers, write endpoints have policies
4. **models** — model definitions valid
5. **typecheck** — tsc --noEmit
6. **contracts** — models ↔ routes consistency, policy references valid
7. **manifest** — agent manifest matches live routes
8. **cross-protocol** — HTTP, MCP, A2A, OpenAPI schema consistency

## Production Deployment

\`\`\`bash
capstan build     # Compiles TS, generates route manifest + production server
capstan start     # Runs the production server (reads PORT env var)
\`\`\`

Environment variables:
- \`PORT\` or \`CAPSTAN_PORT\` — server port (default 3000)
- \`CAPSTAN_HOST\` — bind host (default 0.0.0.0)
- \`DATABASE_URL\` — database connection string
- \`SESSION_SECRET\` — JWT signing secret (required in production)
- \`LOG_LEVEL\` — debug | info | warn | error (default info)

## Conventions & Rules

- API files: \`*.api.ts\` — export \`GET\`, \`POST\`, \`PUT\`, \`DELETE\` (uppercase)
- Page files: \`*.page.tsx\` — export \`default\` React component + optional \`loader\`
- Layout files: \`_layout.tsx\` — export \`default\`, must render \`<Outlet />\`
- Middleware files: \`_middleware.ts\` — export \`default\` from \`defineMiddleware()\`
- Model files: \`*.model.ts\` in \`app/models/\`
- Policy files: in \`app/policies/index.ts\`
- All API handlers MUST use \`defineAPI()\` with Zod input/output schemas
- Write endpoints (POST/PUT/DELETE) SHOULD have a \`policy\` reference
- Use \`import type\` for type-only imports (TypeScript strict mode)
- ESM only — use \`.js\` extensions in relative imports
- Run \`capstan verify --json\` after every change to catch issues early

## Plugins

Extend your Capstan app with reusable plugins. Plugins can add routes, policies, and middleware.

\`\`\`typescript
// capstan.config.ts
import { defineConfig } from "@zauso-ai/capstan-core";
import stripePlugin from "capstan-plugin-stripe";

export default defineConfig({
  plugins: [
    stripePlugin({ apiKey: process.env.STRIPE_KEY }),
  ],
});
\`\`\`

### Writing a Plugin

\`\`\`typescript
import { definePlugin } from "@zauso-ai/capstan-core";

export default definePlugin({
  name: "my-plugin",
  version: "1.0.0",
  setup(ctx) {
    // ctx.addRoute(method, path, handler) — register an API route
    // ctx.addPolicy(policy)               — register a policy
    // ctx.addMiddleware(path, middleware)  — register middleware
    // ctx.config                          — read-only app configuration
  },
});
\`\`\`

## WebSocket Support

Use \`defineWebSocket()\` for real-time bidirectional communication and \`WebSocketRoom\` for pub/sub messaging:

\`\`\`typescript
import { defineWebSocket, WebSocketRoom } from "@zauso-ai/capstan-core";

const room = new WebSocketRoom();

export const chat = defineWebSocket("/ws/chat", {
  onOpen(ws)    { room.join(ws); },
  onMessage(ws, msg) { room.broadcast(String(msg), ws); },
  onClose(ws)   { room.leave(ws); },
});
\`\`\`

The handler accepts \`onOpen\`, \`onMessage\`, \`onClose\`, and \`onError\` callbacks. \`WebSocketRoom.broadcast()\` sends to all open clients except an optional excluded client. The Node.js adapter handles upgrades automatically via the \`ws\` package (optional peer dependency).

## Pluggable State Stores (KeyValueStore)

Capstan uses a \`KeyValueStore<T>\` interface for approvals, rate limiting, DPoP replay detection, and audit logging. By default, an in-memory \`MemoryStore\` is used. For production, use the built-in \`RedisStore\` or implement a custom adapter:

\`\`\`typescript
import Redis from "ioredis";
import {
  RedisStore,
  setApprovalStore,
  setRateLimitStore,
  setDpopReplayStore,
  setAuditStore,
} from "@zauso-ai/capstan-core";

const redis = new Redis(process.env.REDIS_URL);

// Replace in-memory stores with Redis-backed stores
setApprovalStore(new RedisStore(redis, "approvals:"));
setRateLimitStore(new RedisStore(redis, "ratelimit:"));
setDpopReplayStore(new RedisStore(redis, "dpop:"));
setAuditStore(new RedisStore(redis, "audit:"));
\`\`\`

\`RedisStore\` uses \`ioredis\` (optional peer dependency), supports TTL-based expiration, and prefixes keys to avoid collisions.

The \`KeyValueStore<T>\` interface:

\`\`\`typescript
interface KeyValueStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}
\`\`\`

## EU AI Act Compliance

Declare compliance metadata and enable automatic audit logging:

\`\`\`typescript
import { defineCompliance } from "@zauso-ai/capstan-core";

defineCompliance({
  riskLevel: "limited",           // "minimal" | "limited" | "high" | "unacceptable"
  auditLog: true,                 // Log every handler invocation automatically
  transparency: {
    description: "AI ticket routing",
    provider: "Acme Corp",
    contact: "compliance@acme.example",
  },
});
\`\`\`

When \`auditLog: true\`, every \`defineAPI()\` handler call is recorded with timestamp, auth context, and I/O summary. Query the log at \`GET /capstan/audit\` or use \`getAuditLog()\` / \`clearAuditLog()\` programmatically.

## LLM Providers

Capstan includes built-in LLM provider adapters with a unified \`LLMProvider\` interface:

\`\`\`typescript
import { openaiProvider, anthropicProvider } from "@zauso-ai/capstan-agent";

// OpenAI (or any OpenAI-compatible API via baseUrl)
const openai = openaiProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o",           // optional, default "gpt-4o"
});

// Anthropic
const claude = anthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: "claude-sonnet-4-20250514", // optional
});

// Chat
const response = await openai.chat([
  { role: "user", content: "Summarize this ticket" },
], { temperature: 0.3, maxTokens: 500 });
// response.content, response.model, response.usage

// Streaming (OpenAI provider supports stream())
for await (const chunk of openai.stream!([
  { role: "user", content: "Write a summary" },
])) {
  process.stdout.write(chunk.content);
  if (chunk.done) break;
}
\`\`\`

Options: \`model\`, \`temperature\`, \`maxTokens\`, \`systemPrompt\`, \`responseFormat\` (structured output).

## AI Toolkit (@zauso-ai/capstan-ai)

Standalone AI agent toolkit — works independently OR with Capstan. Install separately:

\`\`\`bash
npm install @zauso-ai/capstan-ai
\`\`\`

### Standalone Usage (no Capstan required)

\`\`\`typescript
import { createAI } from "@zauso-ai/capstan-ai";
import { openaiProvider } from "@zauso-ai/capstan-agent";

const ai = createAI({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});

// Structured reasoning — returns typed result matching Zod schema
const analysis = await ai.think("Classify this ticket: 'Payment failed'", {
  schema: z.object({
    category: z.enum(["billing", "technical", "account"]),
    priority: z.enum(["low", "medium", "high"]),
  }),
});

// Text generation
const summary = await ai.generate("Summarize this in 3 bullets...");

// Streaming variants
for await (const chunk of ai.generateStream("Write a report...")) {
  process.stdout.write(chunk);
}
\`\`\`

### Memory (remember / recall)

\`\`\`typescript
// Store memories (auto-dedup: >0.92 cosine similarity → merge)
await ai.remember("Customer prefers email communication");

// Retrieve relevant memories (hybrid: vector 0.7 + keyword 0.3 + recency)
const memories = await ai.recall("contact preferences");

// Scoped memory — isolate per entity
const customerMem = ai.memory.about("customer", "cust_123");
await customerMem.remember("VIP since 2022");
const relevant = await customerMem.recall("status");

// Build LLM context from memories
const context = await ai.memory.assembleContext({
  query: "customer preferences",
  maxTokens: 2000,
});

// Delete a memory
await ai.memory.forget(memoryId);
\`\`\`

### Agent Loop (self-orchestrating)

\`\`\`typescript
const result = await ai.agent.run({
  goal: "Research customer issues and draft a response",
  about: ["customer", "cust_123"],
  tools: [searchTickets, getHistory],
  beforeToolCall: async (tool, args) => {
    // Policy/approval hook — return false to block
    return true;
  },
});
// result.success, result.result, result.iterations, result.callStack
\`\`\`

### Using in Capstan Handlers

\`\`\`typescript
export const POST = defineAPI({
  // ...
  async handler({ input, ctx }) {
    const analysis = await ctx.think(input.message, {
      schema: z.object({ intent: z.string(), confidence: z.number() }),
    });
    await ctx.remember(\`User asked about: \${analysis.intent}\`);
    const history = await ctx.recall(input.message);
    return { analysis, relatedHistory: history };
  },
});
\`\`\`

### Memory Backend

The default \`BuiltinMemoryBackend\` stores in memory. For production, implement the \`MemoryBackend\` interface for Mem0, Hindsight, Redis, or any custom store.

## Build Pipeline (Optional Vite Integration)

Capstan optionally integrates with Vite for client-side code splitting and HMR. Install \`vite\` as a peer dependency to enable:

\`\`\`bash
npm install vite
\`\`\`

\`\`\`typescript
import { createViteConfig, buildClient } from "@zauso-ai/capstan-dev";

// Generate Vite config
const config = createViteConfig({ rootDir: ".", isDev: false });

// Production build
await buildClient({ rootDir: ".", isDev: false });
\`\`\`

If Vite is not installed, these functions gracefully skip without errors.

## Deployment Adapters

Capstan provides production-ready deployment adapters for major platforms:

### Cloudflare Workers
\`\`\`typescript
import { createCloudflareHandler, generateWranglerConfig } from "@zauso-ai/capstan-dev";

// Worker entry
export default createCloudflareHandler(app);

// Generate wrangler.toml
const toml = generateWranglerConfig("my-app");
\`\`\`

### Vercel
\`\`\`typescript
import { createVercelHandler, createVercelNodeHandler } from "@zauso-ai/capstan-dev";

// Edge Function
export default createVercelHandler(app);

// Node.js Serverless Function
export default createVercelNodeHandler(app);
\`\`\`

### Fly.io (with Write Replay)
\`\`\`typescript
import { createFlyAdapter } from "@zauso-ai/capstan-dev";

const adapter = createFlyAdapter({
  primaryRegion: "iad",
  replayWrites: true,  // Mutating requests replay to primary region
});
\`\`\`

### ClientOnly and serverOnly()

In addition to \`ServerOnly\`, Capstan provides:

\`\`\`typescript
import { ClientOnly, serverOnly } from "@zauso-ai/capstan-react";

// ClientOnly — renders children only in browser, shows fallback during SSR
<ClientOnly fallback={<p>Loading...</p>}>
  <InteractiveWidget />
</ClientOnly>

// serverOnly() — guard that throws if imported in client code
serverOnly(); // place at top of server-only modules
\`\`\`

## Image & Font Optimization

\`\`\`typescript
import { Image, defineFont, fontPreloadLink } from "@zauso-ai/capstan-react";

// Optimized image: responsive srcset, lazy loading, blur-up placeholder
<Image src="/hero.jpg" alt="Hero" width={1200} priority placeholder="blur" />

// Font: returns className + style + CSS variable
const inter = defineFont({ family: "Inter", src: "/fonts/inter.woff2", display: "swap" });
// inter.className, inter.style, inter.variable

// Preload link for <head>
fontPreloadLink({ family: "Inter", src: "/fonts/inter.woff2" })
\`\`\`

## Metadata (SEO, OpenGraph, Twitter Cards)

\`\`\`typescript
import { defineMetadata, generateMetadataElements, mergeMetadata } from "@zauso-ai/capstan-react";

const metadata = defineMetadata({
  title: { default: "My App", template: "%s | My App" },
  description: "Built with Capstan",
  openGraph: { title: "My App", image: "/og.png" },
  twitter: { card: "summary_large_image" },
});

// In your layout <head>:
const elements = generateMetadataElements(metadata);

// Merge parent + child metadata (child title "About" → "About | My App"):
const merged = mergeMetadata(parentMetadata, childMetadata);
\`\`\`

## Error Boundaries

\`\`\`typescript
import { ErrorBoundary, NotFound } from "@zauso-ai/capstan-react";

// Wrap components to catch render errors with reset support:
<ErrorBoundary fallback={(error, reset) => (
  <div>
    <p>Error: {error.message}</p>
    <button onClick={reset}>Retry</button>
  </div>
)}>
  <MyComponent />
</ErrorBoundary>

// Pre-built 404 component:
<NotFound />
\`\`\`

## Response Cache

The response cache stores full-page HTML output for ISR render strategies. It is separate from the data cache but shares cross-invalidation.

\`\`\`typescript
import {
  responseCacheGet, responseCacheSet, responseCacheInvalidateTag,
  responseCacheInvalidate, responseCacheClear, setResponseCacheStore,
} from "@zauso-ai/capstan-core";

// Retrieve cached response (includes staleness check)
const result = await responseCacheGet("/blog");
if (result) {
  const { entry, stale } = result;
  // entry: { html, headers, statusCode, createdAt, revalidateAfter, tags }
}

// Store a page response with tags
await responseCacheSet("/blog", {
  html, headers: {}, statusCode: 200,
  createdAt: Date.now(), revalidateAfter: Date.now() + 60000,
  tags: ["blog"],
});

// Cross-invalidation: cacheInvalidateTag() also evicts response cache
await cacheInvalidateTag("blog"); // clears BOTH data cache + response cache entries

// For production, swap the store (default is in-memory):
setResponseCacheStore(new RedisStore(redis, "resp:"));
\`\`\`

## Cache Layer (ISR)

\`\`\`typescript
import { cacheSet, cacheGet, cacheInvalidateTag, cached } from "@zauso-ai/capstan-core";

// Cache with TTL + tags
await cacheSet("user:123", userData, { ttl: 300, tags: ["users"] });
const data = await cacheGet("user:123");

// Stale-while-revalidate decorator
const getUsers = cached(async () => fetchUsers(), { ttl: 60, tags: ["users"] });

// Bulk invalidation by tag
await cacheInvalidateTag("users");
\`\`\`

## Client-Side Router

Capstan includes a built-in SPA router. Import from \`@zauso-ai/capstan-react/client\`:

\`\`\`typescript
import { Link, useNavigate, useRouterState, bootstrapClient } from "@zauso-ai/capstan-react/client";
\`\`\`

### Link Component

\`<Link>\` renders a standard \`<a>\` that works without JavaScript. When the router is active, clicks are intercepted for instant SPA transitions.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| \`href\` | \`string\` | — | Target URL (required) |
| \`prefetch\` | \`"none" \\| "hover" \\| "viewport"\` | \`"hover"\` | When to prefetch the target page |
| \`replace\` | \`boolean\` | \`false\` | Replace history entry instead of push |
| \`scroll\` | \`boolean\` | \`true\` | Scroll to top after navigation |

Plus all standard HTML anchor attributes.

### Programmatic Navigation

\`\`\`typescript
const navigate = useNavigate();
navigate("/dashboard");
navigate("/settings", { replace: true, scroll: false });

const { url, status, error } = useRouterState();
// status: "idle" | "loading" | "error"
\`\`\`

### Bootstrap

Call \`bootstrapClient()\` once at page load. It reads \`window.__CAPSTAN_MANIFEST__\`, initializes the router, and sets up global \`<a>\` click delegation. All internal links get SPA navigation automatically.

To opt out for specific links, add \`data-capstan-external\`:

\`\`\`html
<a href="/legacy" data-capstan-external>Full reload</a>
\`\`\`

View Transitions (\`document.startViewTransition()\`) are applied automatically when the browser supports them.
`;
}

// ---------------------------------------------------------------------------
// Tickets template extras
// ---------------------------------------------------------------------------

export function ticketModel(): string {
  return `import { defineModel, field, relation } from "@zauso-ai/capstan-db";

export const Ticket = defineModel("ticket", {
  fields: {
    id: field.id(),
    title: field.string({ required: true, min: 1, max: 200 }),
    description: field.text(),
    status: field.enum(["open", "in_progress", "closed"], { default: "open" }),
    priority: field.enum(["low", "medium", "high"], { default: "medium" }),
    createdAt: field.datetime({ default: "now" }),
    updatedAt: field.datetime({ updatedAt: true }),
  },
});
`;
}

export function ticketsIndexApi(): string {
  return `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const meta = {
  resource: "ticket",
  description: "Manage support tickets",
};

export const GET = defineAPI({
  input: z.object({
    status: z.enum(["open", "in_progress", "closed", "all"]).optional(),
  }),
  output: z.object({
    tickets: z.array(z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      priority: z.string(),
    })),
  }),
  description: "List all tickets",
  capability: "read",
  resource: "ticket",
  async handler({ input }) {
    // TODO: Replace with real database query
    return {
      tickets: [
        { id: "1", title: "Example ticket", status: "open", priority: "medium" },
      ],
    };
  },
});

export const POST = defineAPI({
  input: z.object({
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
  }),
  output: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string(),
  }),
  description: "Create a new ticket",
  capability: "write",
  resource: "ticket",
  policy: "requireAuth",
  async handler({ input }) {
    // TODO: Replace with real database insert
    return {
      id: crypto.randomUUID(),
      title: input.title,
      status: "open",
      priority: input.priority,
    };
  },
});
`;
}

export function ticketByIdApi(): string {
  return `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const meta = {
  resource: "ticket",
  description: "Manage a specific ticket",
};

export const GET = defineAPI({
  output: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.string(),
    priority: z.string(),
  }),
  description: "Get a ticket by ID",
  capability: "read",
  resource: "ticket",
  async handler({ ctx }) {
    // TODO: Replace with real database query
    return {
      id: "1",
      title: "Example ticket",
      description: "This is an example",
      status: "open",
      priority: "medium",
    };
  },
});
`;
}

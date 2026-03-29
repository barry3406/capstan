// ---------------------------------------------------------------------------
// Template strings for generated Capstan projects
// ---------------------------------------------------------------------------

export function packageJson(
  projectName: string,
  template: "blank" | "tickets" = "blank",
): string {
  const deps: Record<string, string> = {
    "@zauso-ai/capstan-cli": "^1.0.0-beta.2",
    "@zauso-ai/capstan-core": "^1.0.0-beta.2",
    "@zauso-ai/capstan-dev": "^1.0.0-beta.2",
    "@zauso-ai/capstan-react": "^1.0.0-beta.2",
    "@zauso-ai/capstan-router": "^1.0.0-beta.2",
    zod: "^3.23.0",
  };

  // Only include capstan-db for templates that actually use it (native dep
  // issues with better-sqlite3 make it a poor default).
  if (template === "tickets") {
    deps["@zauso-ai/capstan-auth"] = "^1.0.0-beta.2";
    deps["@zauso-ai/capstan-db"] = "^1.0.0-beta.2";
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

### Multi-protocol: one defineAPI() → four surfaces

Every \`defineAPI()\` call automatically generates:
1. **HTTP JSON API** — standard REST endpoint
2. **MCP Tool** — usable by Claude Desktop, Cursor, etc.
3. **A2A Skill** — Google Agent-to-Agent protocol
4. **OpenAPI 3.1** — auto-generated spec at \`/openapi.json\`

No extra code needed. The \`description\`, \`input\`, \`output\` fields drive all four.

## Page Routes (.page.tsx) — SSR with Data Loading

\`\`\`typescript
// app/routes/users/index.page.tsx

// Server-side data loader (runs on every request)
export async function loader({ params, request, ctx, fetch }) {
  // fetch.get/post/put/delete call your own API routes internally
  const data = await fetch.get("/api/users");
  return { users: data.users };
}

// React component (server-rendered)
export default function UsersPage() {
  return (
    <div>
      <h1>Users</h1>
      {/* Loader data is available via window.__CAPSTAN_DATA__ on client */}
    </div>
  );
}
\`\`\`

## Layouts and Middleware

### Layout (\`_layout.tsx\`) — wraps all routes in the same directory and below

\`\`\`typescript
// app/routes/_layout.tsx
import { Outlet } from "@zauso-ai/capstan-react";

export default function RootLayout() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${projectName}</title>
        <link rel="stylesheet" href="/styles.css" />  {/* from app/public/styles.css */}
      </head>
      <body>
        <Outlet />  {/* Child route renders here */}
      </body>
    </html>
  );
}
\`\`\`

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

## Database Configuration

\`\`\`typescript
// capstan.config.ts
export default defineConfig({
  database: {
    provider: "sqlite",                    // "sqlite" | "postgres" | "mysql"
    url: env("DATABASE_URL") || "./data.db",
    // PostgreSQL: "postgres://user:pass@host:5432/dbname"
    // MySQL: "mysql://user:pass@host:3306/dbname"
  },
});
\`\`\`

Install the driver for your provider:
\`\`\`bash
npm install better-sqlite3              # SQLite
npm install pg                          # PostgreSQL
npm install mysql2                      # MySQL
\`\`\`

## Querying the Database in Handlers

\`\`\`typescript
// app/db.ts — shared database instance
import { createDatabase } from "@zauso-ai/capstan-db";

const { db, close } = createDatabase({ provider: "sqlite", url: "./data.db" });
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

\`createDatabase()\` accepts \`{ provider, url }\` and returns \`{ db, close }\`.
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
app/public/styles.css     → GET /styles.css
app/public/logo.png       → GET /logo.png
app/public/js/app.js      → GET /js/app.js
\`\`\`

Reference in layouts: \`<link rel="stylesheet" href="/styles.css" />\`

## Auto-generated Endpoints

These are created automatically by the framework:

| Endpoint | Description |
|----------|-------------|
| \`GET /.well-known/capstan.json\` | Agent discovery manifest |
| \`GET /.well-known/agent.json\` | A2A agent card |
| \`POST /.well-known/a2a\` | A2A JSON-RPC handler |
| \`GET /openapi.json\` | OpenAPI 3.1 specification |
| \`GET /capstan/approvals\` | List pending approval requests |
| \`POST /capstan/approvals/:id/approve\` | Approve a pending action |
| \`POST /capstan/approvals/:id/deny\` | Deny a pending action |

## Verification — AI TDD Self-Loop

After every code change, run:
\`\`\`bash
capstan verify --json
\`\`\`

Output includes \`repairChecklist\` with:
- \`fixCategory\`: type_error, schema_mismatch, missing_file, policy_violation, contract_drift, missing_export
- \`autoFixable\`: boolean — whether the AI agent can fix it automatically
- \`description\`: what is wrong and how to fix it

The 7-step verification cascade:
1. **structure** — required files exist
2. **config** — capstan.config.ts loads
3. **routes** — API files export handlers, write endpoints have policies
4. **models** — model definitions valid
5. **typecheck** — tsc --noEmit
6. **contracts** — models ↔ routes consistency, policy references valid
7. **manifest** — agent manifest matches live routes

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

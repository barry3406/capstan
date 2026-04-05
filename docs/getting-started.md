# Getting Started

## Prerequisites

- **Node.js 20+** (ES2022 target, ESM-only)
- **npm** (ships with Node.js)

Optional, depending on your database provider:

- `better-sqlite3` requires a C++ build toolchain (node-gyp) for SQLite
- `pg` for PostgreSQL
- `mysql2` for MySQL

## Quick Start

```bash
npx create-capstan-app@beta my-app --template blank
cd my-app
npm install
npx capstan dev
```

Capstan is currently published on npm's `beta` tag, so use `create-capstan-app@beta` when bootstrapping a fresh project from npm.

The `create-capstan-app` scaffolder supports three templates:

| Template  | Description                                                                 |
| --------- | --------------------------------------------------------------------------- |
| `agent`   | Agent-first workspace with capabilities, workflows, policies, memory spaces, and operator views |
| `blank`   | Minimal project with a health check API and home page                       |
| `tickets` | Full-featured example with a Ticket model, CRUD API routes, and auth policy |

You can also run the scaffolder interactively (no arguments) and it will prompt for a project name and template.

Agent-first bootstrap example:

```bash
npx create-capstan-app@beta my-agent --template agent
cd my-agent
npm install
npx capstan dev
```

If you choose the `agent` template, read the [Agent Framework Guide](./agent-framework.md) next. It explains the recommended contract order and the intended runtime-vs-framework split.

## Project Structure

After scaffolding, your project looks like this:

```
my-app/
  app/
    agent/                 # Agent contracts (agent template)
      capabilities/
      workflows/
      policies/
      memory/
      views/
      runtime.ts
    routes/
      _layout.tsx          # Root layout (wraps all pages)
      index.page.tsx       # Home page
      api/
        health.api.ts      # Health check endpoint
    models/                # Data model definitions (empty in blank template)
    styles/
      main.css             # CSS entry point (Lightning CSS or Tailwind)
    migrations/            # Database migration files
    policies/
      index.ts             # Permission policies (requireAuth)
  capstan.config.ts        # Framework configuration
  package.json
  tsconfig.json
  AGENTS.md                # AI coding agent guide
  .gitignore
```

The `agent` template adds a contract-first agent graph on top of the normal Capstan app layout:

- `app/agent/capabilities/` defines what the agent can do
- `app/agent/workflows/` defines long-running task flows
- `app/agent/policies/` defines governance and approval rules
- `app/agent/memory/` defines memory spaces and retention
- `app/agent/views/` defines operator-facing projections
- `app/agent/README.md` explains the contract graph and recommended edit order
- `app/routes/api/agent/app.api.ts` exposes the agent contract graph

### File Naming Conventions

| Pattern              | Purpose                            |
| -------------------- | ---------------------------------- |
| `*.api.ts`           | API route handler                  |
| `*.page.tsx`         | React page component (SSR)         |
| `_layout.tsx`        | Layout wrapper (nests via Outlet)  |
| `_middleware.ts`     | Middleware (runs before handlers)  |
| `_loading.tsx`       | Suspense fallback for pages        |
| `_error.tsx`         | Error boundary for pages           |
| `[param].api.ts`     | Dynamic route segment              |
| `[...catchAll].api.ts` | Catch-all route segment          |

## Running the Dev Server

```bash
npx capstan dev
```

The dev server starts on `http://localhost:3000` by default and provides:

- Hot route reloading (file watcher rebuilds routes on change)
- Live reload via SSE (browser pages refresh automatically)
- Static file serving from `app/public/`
- All multi-protocol agent endpoints (see below)

To use a different port:

```bash
npx capstan dev --port 4000
```

## Creating Your First API Endpoint

Create a file at `app/routes/api/greet.api.ts`:

```typescript
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  input: z.object({
    name: z.string().optional(),
  }),
  output: z.object({
    message: z.string(),
  }),
  description: "Greet a user by name",
  capability: "read",
  async handler({ input }) {
    const name = input.name ?? "world";
    return { message: `Hello, ${name}!` };
  },
});

export const POST = defineAPI({
  input: z.object({
    name: z.string().min(1),
  }),
  output: z.object({
    message: z.string(),
    timestamp: z.string(),
  }),
  description: "Create a personalized greeting",
  capability: "write",
  policy: "requireAuth",
  async handler({ input }) {
    return {
      message: `Hello, ${input.name}!`,
      timestamp: new Date().toISOString(),
    };
  },
});
```

Each exported constant (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`) maps to the corresponding HTTP method. The `defineAPI()` wrapper provides:

- **Input validation** via Zod schemas (automatic 400 errors on invalid input)
- **Output validation** via Zod schemas
- **Agent introspection** -- the schema metadata is projected to MCP tools, A2A skills, and OpenAPI specs

Test your endpoint:

```bash
# GET request
curl http://localhost:3000/api/greet?name=Alice

# POST request
curl -X POST http://localhost:3000/api/greet \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice"}'
```

## Viewing Auto-Generated Agent Endpoints

Once your dev server is running, these endpoints are automatically available:

### Agent Manifest

```
GET http://localhost:3000/.well-known/capstan.json
```

Returns a structured JSON manifest describing all your API routes, their input/output schemas, capabilities, and policies. This is designed for AI agent consumption.

### OpenAPI Specification

```
GET http://localhost:3000/openapi.json
```

Returns a full OpenAPI 3.1.0 specification generated from your `defineAPI()` definitions. Compatible with Swagger UI, Postman, and any OpenAPI tooling.

### A2A Agent Card

```
GET http://localhost:3000/.well-known/agent.json
```

Returns a Google Agent-to-Agent protocol agent card listing all skills (derived from your API routes).

### A2A JSON-RPC Endpoint

```
POST http://localhost:3000/.well-known/a2a
```

Accepts JSON-RPC requests following the A2A protocol (`tasks/send`, `tasks/get`, `agent/card` methods).

### MCP Server (stdio)

```bash
npx capstan mcp
```

Starts a Model Context Protocol server over stdio, suitable for connecting to Claude Desktop, Cursor, or any MCP-compatible client. Each API route becomes an MCP tool.

### Approval Workflow

```
GET  http://localhost:3000/capstan/approvals        # List pending approvals
GET  http://localhost:3000/capstan/approvals/:id     # Get approval status
POST http://localhost:3000/capstan/approvals/:id     # Approve or deny
```

When an API route's policy evaluates to `"approve"`, the request is held for human review. See [Core Concepts](./core-concepts.md) for details.

## Client-Side Navigation

Use `<Link>` from `@zauso-ai/capstan-react/client` instead of plain `<a>` tags for client-side navigation with automatic prefetching and SPA transitions:

```typescript
import { Link } from "@zauso-ai/capstan-react/client";

<Link href="/about">About</Link>
<Link href="/dashboard" prefetch="viewport">Dashboard</Link>
```

See [Core Concepts — Client-Side Navigation](./core-concepts.md#client-side-navigation) for full details on the router, programmatic navigation, scroll restoration, and View Transitions.

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
npx create-capstan-app my-app --template blank
cd my-app
npm install
npx capstan dev
```

The `create-capstan-app` scaffolder supports two templates:

| Template  | Description                                                                 |
| --------- | --------------------------------------------------------------------------- |
| `blank`   | Minimal project with a health check API and home page                       |
| `tickets` | Full-featured example with a Ticket model, CRUD API routes, and auth policy |

You can also run the scaffolder interactively (no arguments) and it will prompt for a project name and template.

## Project Structure

After scaffolding, your project looks like this:

```
my-app/
  app/
    routes/
      _layout.tsx          # Root layout (wraps all pages)
      index.page.tsx       # Home page
      api/
        health.api.ts      # Health check endpoint
    models/                # Data model definitions (empty in blank template)
    migrations/            # Database migration files
    policies/
      index.ts             # Permission policies (requireAuth)
  capstan.config.ts        # Framework configuration
  package.json
  tsconfig.json
  AGENTS.md                # AI coding agent guide
  .gitignore
```

### File Naming Conventions

| Pattern              | Purpose                            |
| -------------------- | ---------------------------------- |
| `*.api.ts`           | API route handler                  |
| `*.page.tsx`         | React page component (SSR)         |
| `_layout.tsx`        | Layout wrapper (nests via Outlet)  |
| `_middleware.ts`     | Middleware (runs before handlers)  |
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

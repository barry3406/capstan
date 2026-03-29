**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md)

<div align="center">

<h1>
⚓ Capstan
</h1>

**The AI Agent Native Full-Stack Framework**

One `defineAPI()` call. Four protocol surfaces. Humans and AI agents, served simultaneously.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-177%20passing-brightgreen?logo=bun&logoColor=white)](https://bun.sh)
[![Version](https://img.shields.io/badge/version-1.0.0--beta.3-orange)](https://github.com/barry3406/capstan)
[![ESM](https://img.shields.io/badge/ESM-only-blue)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)

[Quick Start](#-quick-start) · [Why Capstan?](#-why-capstan) · [Architecture](#-architecture) · [Docs](#-documentation) · [Contributing](#-contributing)

</div>

---

## What is Capstan?

**Capstan** is a full-stack TypeScript framework where every API you write is automatically accessible to both humans (via REST) and AI agents (via MCP, A2A, and OpenAPI) — with zero extra code. It combines file-based routing, Zod-validated endpoints, Drizzle ORM models (SQLite, PostgreSQL, or MySQL), and a built-in verification system that AI coding agents use as a self-correcting TDD loop.

Production-ready: `capstan build` compiles your app, `capstan start` serves it — with CSRF protection, configurable CORS, request body limits, and structured JSON logging out of the box.

Think of it as **Next.js if it were designed from day one for a world where half your consumers are LLMs**.

## How It Works

```
                        ┌──────────────────────────────────────────────┐
                        │              defineAPI({ ... })               │
                        │   input: z.object   output: z.object         │
                        │   capability  ·  policy  ·  handler          │
                        └──────────────────┬───────────────────────────┘
                                           │
                                  CapabilityRegistry
                                           │
                    ┌──────────┬───────────┼───────────┬──────────┐
                    ▼          ▼           ▼           ▼          ▼
              ┌──────────┐┌────────┐┌───────────┐┌─────────┐┌────────────┐
              │ HTTP/JSON ││  MCP   ││    A2A    ││ OpenAPI ││  Capstan   │
              │   API     ││ Tools  ││  Skills   ││  3.1    ││  Manifest  │
              │  (Hono)   ││ (stdio)││ (Google)  ││  Spec   ││   .json    │
              └──────────┘└────────┘└───────────┘└─────────┘└────────────┘
                   │           │          │            │           │
                Browsers    Claude     Agent         Swagger    Agent
                 & apps    Desktop    networks       & SDKs   discovery
                                    (SSE stream)
```

**Write once. Serve everywhere.** Your `defineAPI()` call becomes an HTTP endpoint, an MCP tool with typed Zod parameters for Claude Desktop, an A2A skill with SSE streaming for Google's agent-to-agent protocol, and an OpenAPI spec — all automatically.

---

## 🤔 Why Capstan?

| | **Next.js / Remix** | **FastAPI** | **Capstan** |
|---|---|---|---|
| **Primary audience** | Humans | Humans | Humans + AI agents |
| **API definition** | Route handlers | Decorators | `defineAPI()` with Zod schemas |
| **Agent protocols** | Manual integration | Manual integration | Auto-generated MCP, A2A, OpenAPI |
| **Agent discovery** | None | None | `/.well-known/capstan.json` manifest |
| **Auth model** | DIY | DIY | `"human"` / `"agent"` / `"anonymous"` built-in |
| **Policy enforcement** | DIY middleware | Depends middleware | `definePolicy()` with approve / deny / redact |
| **Human-in-the-loop** | Build it yourself | Build it yourself | Built-in approval workflow for agent write ops |
| **AI TDD loop** | None | None | `capstan verify --json` with repair checklist |
| **Auto CRUD** | None | None | `defineModel()` generates typed route files |
| **Database** | BYO | SQLAlchemy | Drizzle ORM (SQLite, PostgreSQL, MySQL) |
| **Production** | `next build` / `next start` | Uvicorn | `capstan build` / `capstan start` |
| **Full stack** | React SSR + API | API only | React SSR + API + Agent protocols |

**The key insight:** every API you build is already an AI tool. No wrappers, no adapters, no second codebase.

---

## 🚀 Quick Start

```bash
# 1. Create a new project
npx create-capstan-app my-app
cd my-app

# Or start from a template
npx create-capstan-app my-app --template tickets

# 2. Start the dev server (live reload via SSE)
npx capstan dev

# 3. Your app is live with all protocol surfaces:
#    http://localhost:3000              — Web app
#    http://localhost:3000/openapi.json — OpenAPI spec
#    http://localhost:3000/.well-known/capstan.json — Agent manifest
#    http://localhost:3000/.well-known/agent.json   — A2A agent card

# 4. Verify everything is wired correctly
npx capstan verify --json
```

### Scaffold features instantly

```bash
npx capstan add model ticket       # → app/models/ticket.model.ts
npx capstan add api tickets        # → app/routes/tickets/index.api.ts (GET + POST)
npx capstan add page tickets       # → app/routes/tickets/index.page.tsx
npx capstan add policy requireAuth # → app/policies/index.ts
```

---

## 📖 Code Examples

### `defineAPI` — Type-safe, multi-protocol endpoints

```typescript
// app/routes/tickets/index.api.ts
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

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
  async handler({ input, ctx }) {
    const tickets = await db.query.tickets.findMany();
    return { tickets };
  },
});

export const POST = defineAPI({
  input: z.object({
    title: z.string().min(1).max(200),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
  }),
  output: z.object({ id: z.string(), title: z.string() }),
  description: "Create a new ticket",
  capability: "write",
  resource: "ticket",
  policy: "requireAuth",  // ← enforced for both humans AND agents
  async handler({ input, ctx }) {
    return { id: crypto.randomUUID(), title: input.title };
  },
});
```

```typescript
// app/routes/tickets/[id].api.ts — Dynamic route with params
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  input: z.object({}),
  output: z.object({ id: z.string(), title: z.string(), status: z.string() }),
  description: "Get a ticket by ID",
  capability: "read",
  resource: "ticket",
  async handler({ input, ctx, params }) {
    //                         ^^^^^^ typed route params
    const ticket = await db.query.tickets.findFirst({
      where: { id: params.id },
    });
    return ticket;
  },
});
```

That single file gives you **all of this** — no extra code:

| Protocol | Endpoint |
|----------|----------|
| REST API | `GET /tickets` · `POST /tickets` · `GET /tickets/:id` |
| MCP Tool | `get_tickets` · `post_tickets` · `get_tickets_by_id` (with typed Zod parameters) |
| A2A Skill | `get_tickets` · `post_tickets` · `get_tickets_by_id` (with SSE streaming) |
| OpenAPI | Documented in `/openapi.json` |

### `defineModel` — Declarative data models with auto CRUD

```typescript
// app/models/ticket.model.ts
import { defineModel, field } from "@zauso-ai/capstan-db";

export const Ticket = defineModel("ticket", {
  fields: {
    id:          field.id(),
    title:       field.string({ required: true, min: 1, max: 200 }),
    description: field.text(),
    status:      field.enum(["open", "in_progress", "closed"], { default: "open" }),
    priority:    field.enum(["low", "medium", "high"], { default: "medium" }),
    createdAt:   field.datetime({ default: "now" }),
    updatedAt:   field.datetime({ updatedAt: true }),
  },
});
```

Run `capstan add api tickets` and Capstan generates fully typed CRUD route files with Zod validation, policy enforcement, and agent metadata — ready to customize. Database provider (SQLite, PostgreSQL, or MySQL) is configured in `capstan.config.ts` — all three are optional peer dependencies.

### `definePolicy` — Permission policies with agent-aware effects

```typescript
// app/policies/index.ts
import { definePolicy } from "@zauso-ai/capstan-core";

export const requireAuth = definePolicy({
  key: "requireAuth",
  title: "Require Authentication",
  effect: "deny",
  async check({ ctx }) {
    if (!ctx.auth.isAuthenticated) {
      return { effect: "deny", reason: "Authentication required" };
    }
    // ctx.auth.type is "human" | "agent" | "anonymous"
    return { effect: "allow" };
  },
});

export const agentApproval = definePolicy({
  key: "agentApproval",
  title: "Agent Actions Require Approval",
  effect: "approve",
  async check({ ctx }) {
    if (ctx.auth.type === "agent") {
      return { effect: "approve", reason: "Agent write ops need human review" };
    }
    return { effect: "allow" };
  },
});
```

Policy effects: **`allow`** | **`deny`** | **`approve`** (human-in-the-loop) | **`redact`** (filter sensitive fields)

When a policy returns `approve`, the request enters the **approval workflow** — agents get a `202` with a `pollUrl`, and humans review at the authenticated `/capstan/approvals` endpoint.

---

## 🔄 AI TDD Self-Loop

Capstan includes a **verifier** designed for AI coding agents. When Claude Code, Cursor, or any AI assistant works on your project, it runs `capstan verify --json` after every change and uses the structured output to self-correct.

```
   ┌───────────┐      ┌────────────┐      ┌─────────────────┐
   │  AI Agent  │─────▶│ Edit Code  │─────▶│ capstan verify   │
   │  (Claude,  │      │            │      │   --json         │
   │   Cursor)  │      └────────────┘      └───────┬─────────┘
   └─────▲──────┘                                  │
         │                                         ▼
         │                              ┌─────────────────────┐
         │                              │  {                   │
         │                              │   "status": "failed",│
         │                              │   "repairChecklist": │
         │                              │   [{                 │
         └──────────────────────────────│     "fixCategory",   │
              Read checklist,           │     "autoFixable",   │
              apply fixes               │     "hint": "..."    │
                                        │   }]                 │
                                        │  }                   │
                                        └─────────────────────┘
```

### The 7-step verification cascade

```bash
$ npx capstan verify --json
```

```json
{
  "status": "failed",
  "steps": [
    { "name": "structure",  "status": "passed", "durationMs": 2 },
    { "name": "config",     "status": "passed", "durationMs": 15 },
    { "name": "routes",     "status": "failed", "durationMs": 8,
      "diagnostics": [{
        "code": "MISSING_POLICY",
        "severity": "warning",
        "message": "POST /tickets has capability 'write' but no policy",
        "hint": "Add policy: \"requireAuth\" to protect write endpoints",
        "file": "app/routes/tickets/index.api.ts",
        "fixCategory": "policy_violation",
        "autoFixable": true
      }]
    },
    { "name": "models",     "status": "passed", "durationMs": 3 },
    { "name": "typecheck",  "status": "failed", "durationMs": 1200 },
    { "name": "contracts",  "status": "skipped" },
    { "name": "manifest",   "status": "skipped" }
  ],
  "repairChecklist": [
    {
      "index": 1,
      "step": "routes",
      "message": "POST /tickets missing policy",
      "hint": "Add policy: \"requireAuth\"",
      "fixCategory": "policy_violation",
      "autoFixable": true
    }
  ]
}
```

**Steps cascade**: structure → config → routes → models → typecheck → contracts → manifest. Early failures skip dependent steps to reduce noise.

**Fix categories**: `type_error` · `schema_mismatch` · `missing_file` · `policy_violation` · `contract_drift` · `missing_export`

---

## 🌐 Multi-Protocol Endpoints

When you run `capstan dev`, these endpoints are auto-generated:

| Endpoint | Protocol | Purpose |
|----------|----------|---------|
| `GET /.well-known/capstan.json` | Capstan | Agent manifest with all capabilities |
| `GET /.well-known/agent.json` | A2A | Google Agent-to-Agent agent card |
| `POST /.well-known/a2a` | A2A | JSON-RPC handler with SSE streaming |
| `GET /openapi.json` | OpenAPI 3.1 | Full API specification |
| `GET /capstan/approvals` | Capstan | Authenticated approval queue |
| `npx capstan mcp` | MCP (stdio) | For Claude Desktop / Cursor |

### Connect to Claude Desktop

```json
{
  "mcpServers": {
    "my-app": {
      "command": "npx",
      "args": ["capstan", "mcp"],
      "cwd": "/path/to/my-app"
    }
  }
}
```

Every `defineAPI()` route becomes an MCP tool with real typed parameters derived from your Zod schemas. Claude can now interact with your app natively.

---

## 🏗 Architecture

```
capstan.config.ts           ← App configuration (DB, auth, agent settings)
app/
  routes/
    index.page.tsx          ← React pages (SSR with loaders)
    index.api.ts            ← API handlers (export GET, POST, PUT, DELETE)
    tickets/
      index.api.ts          ← File-based routing: /tickets
      [id].api.ts           ← Dynamic segments: /tickets/:id
    _layout.tsx             ← Layout wrappers
    _middleware.ts          ← Middleware
  models/
    ticket.model.ts         ← Drizzle ORM + defineModel()
  policies/
    index.ts                ← definePolicy() permission rules
  public/
    favicon.ico             ← Static assets (served automatically)
    logo.svg
```

**Stack:** [Hono](https://hono.dev) (HTTP) · [Drizzle](https://orm.drizzle.team) (ORM — SQLite, PostgreSQL, MySQL) · [React](https://react.dev) (SSR) · [Zod](https://zod.dev) (validation) · [Bun](https://bun.sh) (testing)

**Dev features:** live reload (SSE), static asset serving from `app/public/`, structured JSON logging

**Security:** CSRF protection, request body limits, configurable CORS, authenticated approval endpoints

---

## 🚢 Production Deployment

```bash
# Build for production
npx capstan build

# Start the production server
npx capstan start
```

`capstan build` compiles your routes, models, and configuration into an optimized production bundle. `capstan start` launches the server with security defaults enabled. Configure the listen port, CORS origins, and database provider in `capstan.config.ts`.

---

## 📦 Packages

Capstan ships 9 runtime packages:

| Package | Description |
|---------|-------------|
| `@zauso-ai/capstan-core` | Hono server, `defineAPI`, `defineMiddleware`, `definePolicy`, approval workflow, verifier |
| `@zauso-ai/capstan-router` | File-based routing (`.page.tsx`, `.api.ts`, `_layout.tsx`, `_middleware.ts`) |
| `@zauso-ai/capstan-db` | Drizzle ORM, `defineModel`, field/relation helpers, migrations, auto CRUD (SQLite, PostgreSQL, MySQL) |
| `@zauso-ai/capstan-auth` | JWT sessions, API key auth for agents, permission checking (`"human"` / `"agent"` / `"anonymous"`) |
| `@zauso-ai/capstan-agent` | `CapabilityRegistry`, MCP server (typed params), A2A adapter (SSE), OpenAPI generator |
| `@zauso-ai/capstan-react` | SSR with loaders, layouts, `Outlet`, hydration |
| `@zauso-ai/capstan-dev` | Dev server with file watching, hot route reload, MCP/A2A endpoints |
| `@zauso-ai/capstan-cli` | CLI: `dev`, `build`, `start`, `verify`, `add`, `mcp`, `db:*` |
| `create-capstan-app` | Project scaffolder (`--template blank`, `--template tickets`) |

<details>
<summary>Legacy compiler packages (in <code>packages-legacy/</code>)</summary>

The original compiler system is preserved separately for backward compatibility. These packages are not required for new projects.

| Package | Description |
|---------|-------------|
| `@zauso-ai/capstan-app-graph` | Application graph schema, validation, diffing |
| `@zauso-ai/capstan-brief` | Brief-to-graph compilation |
| `@zauso-ai/capstan-compiler` | Graph-to-app code generation |
| `@zauso-ai/capstan-packs-core` | Composable packs (auth, tenant, workflow, billing, commerce) |
| `@zauso-ai/capstan-surface-web` | Web surface projection |
| `@zauso-ai/capstan-surface-agent` | Agent surface projection |
| `@zauso-ai/capstan-feedback` | Verification and diagnostics |
| `@zauso-ai/capstan-release` | Release planning and rollback |
| `@zauso-ai/capstan-harness` | Durable task runtime |

</details>

---

## 📚 Documentation

Detailed guides live in the [`docs/`](docs/) directory:

- [Getting Started](docs/getting-started.md) — Installation, first project, dev workflow
- [Core Concepts](docs/core-concepts.md) — `defineAPI`, `defineModel`, `definePolicy`, capabilities
- [Architecture](docs/architecture/) — System design, multi-protocol registry, route scanning
- [Authentication](docs/authentication.md) — JWT sessions, API keys, auth types
- [Database](docs/database.md) — SQLite, PostgreSQL, MySQL setup and migrations
- [Deployment](docs/deployment.md) — `capstan build`, `capstan start`, production configuration
- [Testing Strategy](docs/testing-strategy.md) — Unit, integration, and verifier testing
- [API Reference](docs/api-reference.md) — Full API surface documentation
- [Comparison](docs/comparison.md) — Capstan vs Next.js, FastAPI, and others
- [Roadmap](docs/roadmap.md) — What's coming next

---

## 🧑‍💻 Contributing

Capstan is in active beta (`v1.0.0-beta.3`). Contributions are welcome!

```bash
git clone https://github.com/barry3406/capstan.git
cd capstan
npm install
npm run build        # Build 9 runtime packages
npm run test:new     # Bun tests (177 tests, ~500ms)
```

### Conventions

- ESM only, `.js` extensions in imports
- Strict TypeScript (`exactOptionalPropertyTypes`, `verbatimModuleSyntax`)
- All API handlers use `defineAPI()` with Zod schemas
- Write endpoints require a `policy` reference

### Help wanted

- Additional scaffolder templates (beyond `blank` and `tickets`)
- More integration and end-to-end tests
- CSS pipeline (Tailwind / vanilla-extract integration)
- OAuth providers (Google, GitHub, etc.)

---

## 📝 License

[MIT](LICENSE)

---

<div align="center">

**⚓ Capstan** — APIs that speak human and machine.

[Get Started](#-quick-start) · [Documentation](#-documentation) · [GitHub](https://github.com/barry3406/capstan) · [Report a Bug](https://github.com/barry3406/capstan/issues)

</div>

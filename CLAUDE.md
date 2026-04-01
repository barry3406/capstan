# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is Capstan

An AI Agent Native full-stack framework. Like Next.js but designed for both human and AI agent consumption. One `defineAPI()` call simultaneously exposes HTTP, MCP, A2A, and OpenAPI interfaces.

## Commands

```bash
# Build all packages (18 packages, dependency order)
npm run build

# Run new tests (Bun — 1125 tests in ~18s)
npm run test:new


# Dev server
npx capstan dev

# Verify app (AI TDD self-loop — structured JSON diagnostics)
npx capstan verify --json

# Scaffold features
npx capstan add model <name>
npx capstan add api <name>
npx capstan add page <name>
npx capstan add policy <name>

# MCP server (stdio transport for Claude Desktop / Cursor)
npx capstan mcp

# Create new project
npx create-capstan-app
```

## Architecture

### Packages (9 runtime)

- `@zauso-ai/capstan-core` — Hono HTTP server, defineAPI, defineMiddleware, definePolicy, approval workflow, events, circuit breaker, metrics, compliance
- `@zauso-ai/capstan-router` — File-based routing (.page.tsx, .api.ts, _layout.tsx, _middleware.ts)
- `@zauso-ai/capstan-db` — Drizzle ORM, defineModel, field/relation helpers, migration, auto CRUD, vector search, RAG
- `@zauso-ai/capstan-auth` — JWT sessions, API key auth, OAuth providers, DPoP, SPIFFE/mTLS
- `@zauso-ai/capstan-agent` — CapabilityRegistry, MCP server/client, A2A adapter, OpenAPI, LangChain, commerce, testing
- `@zauso-ai/capstan-react` — Streaming SSR, selective hydration, layouts, Outlet, ServerOnly
- `@zauso-ai/capstan-dev` — Dev server, CSS pipeline, multi-runtime adapters, file watching
- `@zauso-ai/capstan-cli` — CLI with colored output, fuzzy matching, grouped help
- `create-capstan-app` — Interactive scaffolder with @clack/prompts

### Multi-Protocol Architecture

```
defineAPI() → CapabilityRegistry
                ├── HTTP JSON API (Hono)
                ├── MCP Tools (@modelcontextprotocol/sdk)
                ├── A2A Skills (Google Agent-to-Agent)
                └── OpenAPI 3.1 Spec
```

Auto-generated endpoints:
- `GET /.well-known/capstan.json` — Capstan agent manifest
- `GET /.well-known/agent.json` — A2A agent card
- `POST /.well-known/a2a` — A2A JSON-RPC handler
- `POST /.well-known/mcp` — MCP tool discovery
- `GET /openapi.json` — OpenAPI spec
- `GET /capstan/approvals` — Approval workflow management

### Key File Locations

- CLI entry: `packages/cli/src/index.ts`
- Dev server: `packages/dev/src/server.ts`
- Core framework: `packages/core/src/` (api.ts, server.ts, policy.ts, verify.ts, approval.ts)
- Route scanner: `packages/router/src/scanner.ts`
- Multi-protocol registry: `packages/agent/src/registry.ts`
- A2A adapter: `packages/agent/src/a2a.ts`
- MCP adapter: `packages/agent/src/mcp.ts`
- Auto CRUD: `packages/db/src/crud.ts`

## Verifier (AI TDD Self-Loop)

`capstan verify --json` runs an 8-step cascade:
1. **structure** — required files exist
2. **config** — capstan.config.ts loads
3. **routes** — API files export handlers, write endpoints have policies
4. **models** — model definitions valid
5. **typecheck** — tsc --noEmit
6. **contracts** — models ↔ routes consistency, policy references valid
7. **manifest** — agent manifest matches live routes
8. **cross-protocol** — HTTP ↔ MCP ↔ A2A ↔ OpenAPI schema consistency

Output includes `repairChecklist` with `fixCategory` and `autoFixable` for AI consumption.

## TypeScript Conventions

- ESM only, NodeNext module resolution, `.js` extensions in imports
- Strict mode with `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`
- Target: ES2022
- `import type` for type-only imports

## Documentation Sync

Whenever you add, change, or remove a user-facing framework capability (new API, new hook, new config option, behavioral change, etc.), you MUST update **all** of the following in the same commit:

1. **Scaffolding template** — `packages/create-capstan/src/templates.ts` → `agentsMd()` function. This generates the `AGENTS.md` that ships with every new Capstan project.
2. **README files** — `README.md`, `README.zh-CN.md`, `README.zh-TW.md`. Keep feature lists, code examples, and comparison tables current across all three languages.
3. **Docs** — the relevant file(s) under `docs/`:
   - `docs/getting-started.md` — setup & quick start
   - `docs/core-concepts.md` — defineAPI, multi-protocol
   - `docs/api-reference.md` — API surface for @zauso-ai/capstan-core
   - `docs/database.md` — defineModel, CRUD, migrations
   - `docs/authentication.md` — JWT sessions, API key auth
   - `docs/deployment.md` — production build & start
   - `docs/comparison.md` — Capstan vs Next.js feature table

Only update the files relevant to the change — not every file every time. The goal is that docs, READMEs, and scaffolded AGENTS.md never drift from the framework's actual capabilities.

## Testing

- New packages: `bun test` (tests/unit/core,router,db,auth,agent + tests/integration/dev-server,full-pipeline)

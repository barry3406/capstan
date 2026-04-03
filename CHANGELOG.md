# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0-beta.7] - 2026-04-03

### Added
- Durable harness runtime in `@zauso-ai/capstan-ai` with persisted runs, events, artifacts, checkpoints, and control-plane inspection
- Harness context kernel with session memory, summaries, long-term runtime memory, and artifact-aware context assembly
- `@zauso-ai/capstan-cron` recurring execution package with `defineCron()`, `createCronRunner()`, `createBunCronRunner()`, and `createAgentCron()`
- Standalone deployment targets and deployment verification for Docker, Vercel Node, Vercel Edge, Cloudflare, and Fly

### Changed
- Root test entrypoints now enumerate the full repository test suite via `scripts/run-bun-tests.mjs`
- Root documentation now reflects the current 11-package workspace and harness runtime architecture

## [1.0.0-beta.6] - 2026-03-30

### Added
- Plugin system: `definePlugin()` with `addRoute`, `addPolicy`, `addMiddleware`
- KeyValueStore pluggable state: `MemoryStore` default, `RedisStore` adapter, `setApprovalStore()` / `setRateLimitStore()` / `setDpopReplayStore()` / `setAuditStore()`
- EU AI Act compliance: `defineCompliance()` with risk levels, audit logging, transparency metadata, `GET /capstan/audit`
- CSS pipeline: Lightning CSS built-in processing, Tailwind v4 auto-detection, `app/styles/main.css` convention
- Interactive CLI: picocolors colored output, grouped help, fuzzy command matching, `@clack/prompts` scaffolder
- OAuth providers: `googleProvider()`, `githubProvider()`, `createOAuthHandlers()`
- CSRF tests (15), approval route tests (19), plugin tests (17), OAuth tests (29), CSS tests (30)
- Community files: CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, issue/PR templates
- Deployment adapters: Vercel, Fly.io skeletons
- CRUD routes now generate working Drizzle queries (no more TODO placeholders)
- `keys()` method on `KeyValueStore` interface for enumeration

### Changed
- Approval store, rate limiter, DPoP replay cache, audit log all use `KeyValueStore`
- `createCapstanApp()` is now async (supports async plugin setup)
- `CapstanConfig.database.provider` includes `"libsql"`

### Fixed
- DPoP timing flake in boundary test (added margin)
- `definePlugin` now exported and wired into server

## [1.0.0-beta.5] - 2026-03-30

### Added
- Comprehensive test suite: 569 tests with 3-pass expert review
- GitHub Actions CI pipeline (Node 22, Bun, per-package builds)
- 13 new test files: dpop, workload, ratelimit, search, embedding, mcp-client, mcp-http, mcp-harness, langchain, telemetry, scanner-rsc, hydration, adapter

### Fixed
- `better-sqlite3` peer dep widened to `>=9.0.0`
- `drizzle-orm` peer dep widened to `>=0.44.0`
- MCP SDK subpath imports use lazy dynamic imports for Node 22 compatibility
- `verify.ts` cross-package imports avoid compile-time resolution

## [1.0.0-beta.4] - 2026-03-29

### Added
- SSR performance overhaul: `renderToReadableStream` streaming SSR
- `renderPageStream()` with `allReady` promise for bot/crawler support
- Module caching with mtime-based invalidation
- Parallel layout loading via `Promise.all()`
- Auth deduplication (reuse middleware context)
- Response streaming via `Readable.fromWeb().pipe()`
- Static file async I/O with `Cache-Control` headers

### Fixed
- `_layout.tsx` being ignored (layouts were hardcoded to `[]`)
- CSS not loading (nested `<html>` from SSR shell wrapping layout output)

## [1.0.0-beta.3] - 2026-03-29

### Added
- Initial runtime framework: 9 packages
- `defineAPI()` with multi-protocol projection (HTTP, MCP, A2A, OpenAPI)
- File-based routing (`.page.tsx`, `.api.ts`, `_layout.tsx`, `_middleware.ts`)
- `defineModel()` with Drizzle ORM (SQLite, PostgreSQL, MySQL)
- `definePolicy()` with allow/deny/approve/redact effects
- Approval workflow for agent write operations
- JWT sessions + API key authentication
- `capstan verify --json` 7-step verification cascade
- Dev server with SSE live reload
- `create-capstan-app` scaffolder (blank + tickets templates)
- MCP server (stdio transport)
- A2A adapter with SSE streaming
- OpenAPI 3.1 spec generation
- Agent manifest at `/.well-known/capstan.json`

## [1.0.0-beta.2] - 2026-03-28

### Added
- Structured JSON logging with request IDs
- CSRF protection middleware
- MCP tool schema generation from Zod
- A2A SSE streaming support

## [1.0.0-beta.1] - 2026-03-28

### Added
- Initial beta release of 9 runtime packages
- Core framework architecture

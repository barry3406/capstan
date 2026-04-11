# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-04-11

Fresh start — all prior `1.0.0-beta.x` versions are deprecated. Version scheme
reset to `0.x` to better reflect pre-1.0 maturity.

### Added
- Smart agent runtime: `createSmartAgent` with host-driven lifecycle, 4-layer context compression, streaming parallel tool execution, and concurrent task fabric
- Self-evolution engine: experience capture, LLM-driven policy distillation, skill promotion
- LLM-driven memory reconciler: facts have lifecycle managed by the model (supersede/revise/remove/keep)
- Skill layer: `defineSkill()` with parameter schemas, scoped memory, and automatic tool projection
- Durable harness runtime with persisted runs, events, artifacts, checkpoints, and control-plane inspection
- Harness context kernel with session memory, summaries, long-term memory, and artifact-aware context assembly
- `@zauso-ai/capstan-cron` recurring execution package with `defineCron()`, `createCronRunner()`, `createBunCronRunner()`, and `createAgentCron()`
- React 19 features: `use()`, preload API, metadata hoisting, selective hydration (visible/idle/interaction)
- Standalone deployment targets for Docker, Vercel Node, Vercel Edge, Cloudflare, and Fly
- Plugin system: `definePlugin()` with `addRoute`, `addPolicy`, `addMiddleware`
- KeyValueStore pluggable state: `MemoryStore` default, `RedisStore` adapter
- EU AI Act compliance: `defineCompliance()` with risk levels, audit logging, transparency metadata
- CSS pipeline: Lightning CSS, Tailwind v4 auto-detection
- OAuth providers: `googleProvider()`, `githubProvider()`, `createOAuthHandlers()`
- DPoP proof support (RFC 9449) with JTI replay cache
- SPIFFE/mTLS workload identity
- Performance benchmark suite with CI budget enforcement
- GitHub Actions CI pipeline (Node 22, Bun, Playwright E2E, performance gates)
- 5,000+ tests across 242 files

### Core (since initial prototype)
- `defineAPI()` with multi-protocol projection (HTTP, MCP, A2A, OpenAPI)
- File-based routing (`.page.tsx`, `.api.ts`, `_layout.tsx`, `_middleware.ts`)
- `defineModel()` with Drizzle ORM (SQLite, PostgreSQL, MySQL)
- `definePolicy()` with allow/deny/approve/redact effects
- Approval workflow for agent write operations
- JWT sessions + API key authentication
- `capstan verify --json` 8-step verification cascade
- Streaming SSR with shell-first rendering
- Dev server with HMR and live reload
- `create-capstan-app` scaffolder (blank + tickets templates)
- MCP server (stdio + HTTP transports)
- A2A adapter with SSE streaming
- OpenAPI 3.1 spec generation
- Agent manifest at `/.well-known/capstan.json`
- Ops kernel: events, incidents, snapshots, SQLite persistence

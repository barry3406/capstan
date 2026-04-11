# Roadmap

## Shipped (v0.3.0)

### Smart Agent Runtime

- `createSmartAgent` with full host-driven lifecycle
- 4-layer context compression:
  - **snip** -- drop old messages, preserve tail
  - **microcompact** -- truncate tool results with caching
  - **autocompact** -- LLM-driven summarization at threshold
  - **reactive** -- emergency compression when context overflows
- Model fallback with automatic thinking block stripping
- Tool input validation (JSON Schema + custom `validate` hook per tool)
- Tool timeout (per-tool configurable, `Promise.race`)
- LLM watchdog (chat timeout 120s, stream idle timeout 90s via `LLMTimeoutConfig`)
- Token budget management (nudge at 80%, force-complete at 100%)
- Tool result budget (per-result `maxChars` + aggregate 200K + disk persistence via `persistDir`)
- Dynamic context enrichment (every 5 iterations)
- Memory staleness annotations (age-based freshness text)
- Message normalization (cross-provider consistency)
- Error withholding (retry once before exposing error to LLM)
- Lifecycle hooks (`onRunComplete`, `afterIteration`, `afterToolCall` with status)
- Concurrent tool dispatch with call-stack cycle detection
- Checkpoint / resume with serializable state
- Stop hooks (guardrails with feedback loop)
- Streaming executor with idle timeout

### Skill Layer

- `defineSkill` with trigger condition and injected prompt
- `activate_skill` synthetic tool for runtime activation
- System prompt injection via prompt layers
- Developer-authored and evolution-sourced skill origins

### Evolution Engine

- Experience recording (structured trajectories with goal, outcome, tool sequence)
- Strategy distillation via `LlmDistiller`
- Utility feedback loop (+0.1 on success, -0.05 on failure, clamped to [0, 1])
- Skill crystallization (auto-promote strategies with utility above threshold)
- `InMemoryEvolutionStore` for testing
- `SqliteEvolutionStore` for production persistence
- Strategy layer injection into agent system prompt

### Full-Stack Framework

- `defineAPI()` with Zod schemas driving HTTP + MCP + A2A + OpenAPI
- File-based routing (`*.api.ts`, `*.page.tsx`, `_layout.tsx`)
- React SSR with streaming, loaders, layouts, and selective hydration
- Client-side SPA router with `<Link>`, prefetch, view transitions
- ISR with response caching (`renderMode: "isr"`)
- `defineModel()` with Drizzle ORM, migrations, vector search
- Generated CRUD route helpers from model definitions
- JWT sessions + API key auth + OAuth + DPoP + SPIFFE/mTLS
- `definePolicy()` with allow/deny/approve/redact effects
- Human-in-the-loop approval workflows
- `defineRateLimit()` per auth type
- OpenTelemetry cross-protocol tracing
- Agent manifest at `/.well-known/capstan.json`
- A2A agent card at `/.well-known/agent.json`
- LangChain integration via `toLangChainTools()`
- `capstan verify --json` (8-step AI TDD cascade)
- `capstan build` / `capstan start` with deployment targets
- Cron scheduler for recurring agent jobs
- Semantic operations kernel (events, incidents, snapshots, SQLite persistence)
- `create-capstan-app` scaffolder

---

## Next Up

### Agent Intelligence v2

- **Context collapse** -- when autocompact fails, collapse the entire context
  to a structured summary and restart the agent loop with recovered state;
  staged and hierarchical collapse strategies
- **Forked agent for autocompact** -- spawn a sub-agent that shares the prompt
  cache to perform summarization, reducing duplicate token costs
- **Session memory compaction** -- after a run completes, distill the session
  into durable memory entries that future runs can recall without replaying
  the full trace
- **Post-compact file/skill re-injection** -- after context collapse, re-inject
  critical file contents and active skill prompts so the agent does not lose
  working state
- **Prompt cache management** -- explicit `cache_control` annotations to
  maximize cache hits across iterations and reduce LLM costs

### Cross-Agent

- **Cross-agent skill transfer** -- allow skills evolved by one agent instance
  to be shared across agents via a shared evolution store, with utility-based
  filtering and conflict resolution
- **Query chain tracking** -- track subagent depth and `chainId` so parent
  agents can observe and reason about delegated work
- **Abort controller cascade** -- when a parent agent aborts, propagate
  cancellation to sibling and child agents through shared abort controllers

### Meta-Evolution

- **Meta-evolution** -- let the evolution engine itself evolve: track which
  distillation prompts produce the highest-utility strategies and auto-tune
  the distiller configuration over time; memory architecture self-optimization
- **Skill-as-code** -- promote high-utility skills from prompt-only to
  executable TypeScript functions, enabling deterministic tool behavior
  alongside LLM-guided strategies

### Operator Surfaces

- Generate a human surface from capabilities, tasks, policies, approvals,
  artifacts, and views
- Top-level attention inbox and grouped queue lanes for durable work
- Task-scoped, resource-scoped, and route-scoped drill-down
- Approve, provide-input, retry, cancel, and inspect flows through shared
  runtime contracts

### Contract Convergence

- Converge file-based apps, generated apps, manifests, and verification onto
  one machine-readable application model
- Make resources, capabilities, tasks, policies, artifacts, and views
  discoverable from the same source
- Contract snapshots and diffs stable enough for CI and agent tooling

### Structured Release

- Environment shape, secret requirements, migrations, and rollout gates as
  explicit contracts
- Preview, promote, rollback, and release history as structured flows
- Verification outcomes linked to deployment records

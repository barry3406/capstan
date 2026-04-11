# Comparison

## Capstan vs Agent Frameworks

Other agent frameworks give you building blocks. Capstan gives you a
production-grade agent runtime with 30+ engineering features built in.

| Feature | Capstan | LangChain | CrewAI | AutoGen |
|---------|---------|-----------|--------|---------|
| Agent loop | Built-in `createSmartAgent` | Custom chains | Custom | Custom |
| Tool validation | JSON Schema + custom `validate` hook | None | None | None |
| Tool timeout | Per-tool configurable (`Promise.race`) | None | None | None |
| LLM watchdog | Chat timeout (120s) + stream idle (90s) | None | None | None |
| Model fallback | Automatic with thinking block stripping | Manual | None | Manual |
| Context compression | 4-layer (snip / microcompact / autocompact / reactive) | None | None | None |
| Token budget | Nudge at 80% + force-complete at 100% | None | None | None |
| Tool result budget | Per-result + aggregate 200K + disk persistence | None | None | None |
| Skill layer | `defineSkill` + `activate_skill` synthetic tool | None | Role prompts (partial) | None |
| Self-evolution | Experience -> Strategy -> Skill promotion | None | None | None |
| Error withholding | Retry once before exposing to LLM | None | None | None |
| Memory staleness | Age annotations on recalled context | None | None | None |
| Checkpoint / resume | Built-in with serializable state | Custom code | None | Custom code |
| Tool concurrency | Built-in concurrent dispatch | None | None | None |
| Stop hooks (guardrails) | Built-in with feedback loop | Custom code | None | None |
| Dynamic context enrichment | Every N iterations | None | None | None |
| Message normalization | Built-in cross-provider | Manual | Manual | Manual |
| Lifecycle hooks | `onRunComplete`, `afterIteration`, `afterToolCall` | None | None | None |
| Full-stack web | React SSR + HTTP + MCP + A2A + OpenAPI | None | None | None |

### When to use Capstan over LangChain / CrewAI / AutoGen

- You want an agent runtime where validation, timeout, compression, fallback,
  skills, and evolution are first-class configuration -- not custom wrapper code
- You need a full-stack framework underneath: database, auth, policies, web UI
- You want multi-protocol surfaces (HTTP, MCP, A2A, OpenAPI) from one definition
- You need production hardening built in, not bolted on after launch

### When to use LangChain / CrewAI / AutoGen over Capstan

- You need Python-first LLM orchestration with a large connector ecosystem
- You are building multi-agent role-based workflows (CrewAI)
- You need conversational multi-agent patterns with shared state (AutoGen)
- Your project is agent logic only, with no web application layer

---

## Capstan vs Web Frameworks

| Feature | Capstan | Next.js | FastAPI |
|---------|---------|---------|---------|
| **Primary audience** | Human users + AI agents | Human users | API consumers |
| **API definition** | `defineAPI()` with Zod schemas | Route handlers | Pydantic models |
| **Multi-protocol** | HTTP + MCP + A2A + OpenAPI from one definition | HTTP only | HTTP + OpenAPI |
| **Agent manifest** | Auto-generated at `/.well-known/capstan.json` | Not available | Not available |
| **MCP server** | Built-in (`capstan mcp`) | Not available | Not available |
| **A2A protocol** | Built-in | Not available | Not available |
| **OpenAPI spec** | Auto-generated from Zod schemas | Requires third-party tools | Built-in |
| **File-based routing** | `*.api.ts`, `*.page.tsx`, `_layout.tsx` | `page.tsx`, `route.ts`, `layout.tsx` | Manual |
| **Server runtime** | Hono (Web Standards) | Custom (Turbopack/Webpack) | Uvicorn/ASGI |
| **Database** | Drizzle ORM with `defineModel()` | BYO (Prisma, Drizzle, etc.) | BYO (SQLAlchemy, etc.) |
| **Auth** | Built-in JWT + API key for agents | NextAuth.js (community) | BYO |
| **Policy engine** | `definePolicy()` with allow/deny/approve/redact | Not available | Not available |
| **Approval workflow** | Built-in human-in-the-loop | Not available | Not available |
| **Verification** | `capstan verify` (8-step AI TDD loop) | `tsc` + linting | Not available |
| **SSR** | React SSR with loaders | React Server Components | Not applicable |
| **ISR** | Built-in `renderMode: "isr"` + response cache | Built-in (page-level `revalidate`) | Not applicable |
| **Client-side router** | Built-in SPA with `<Link>`, prefetch | Built-in (`next/link`) | Not applicable |
| **View Transitions** | Built-in `withViewTransition()` | Experimental | Not applicable |
| **Selective hydration** | `<ServerOnly>` component | React Server Components | Not applicable |
| **RAG / vector search** | Built-in `field.vector()`, `defineEmbedding()` | Not available | Not available |
| **Rate limiting** | Built-in `defineRateLimit()` per auth type | Middleware / third-party | Manual |
| **OpenTelemetry** | Built-in cross-protocol tracing | Manual instrumentation | Manual instrumentation |
| **Workload identity** | SPIFFE/mTLS via `X-Client-Cert` | Not available | Not available |
| **Smart agent runtime** | `createSmartAgent` with 30+ features | Not available | Not available |
| **Skill layer** | `defineSkill` + evolution engine | Not available | Not available |
| **Ecosystem maturity** | Early stage | Mature, large ecosystem | Mature |

### When to use Capstan over Next.js

- You are building an application that AI agents will interact with programmatically
- You want a single `defineAPI()` call to generate HTTP, MCP, A2A, and OpenAPI endpoints
- You need human-in-the-loop approval workflows for agent actions
- You want built-in agent authentication (API keys) alongside human auth (JWT)
- You need a smart agent runtime with production-grade tool execution

### When to use Next.js over Capstan

- You are building a primarily human-facing web application
- You need React Server Components or edge runtime
- You rely on the Next.js ecosystem (Vercel, middleware, etc.)
- Your project requires mature community support and extensive documentation

### When to use FastAPI over Capstan

- You are building a Python API with automatic OpenAPI generation
- You need the Python ML/data science ecosystem
- Your project is API-only with no web UI requirements

---

## Feature Comparison Table

| Feature | Capstan | Next.js | FastAPI | LangChain | CrewAI | AutoGen |
|---------|:-------:|:-------:|:-------:|:---------:|:------:|:------:|
| HTTP API framework | + | + | + | - | - | - |
| MCP server (auto-generated) | + | - | - | - | - | - |
| A2A protocol | + | - | - | - | - | - |
| OpenAPI auto-generation | + | - | + | - | - | - |
| Agent manifest | + | - | - | - | - | - |
| File-based routing | + | + | - | - | - | - |
| React SSR | + | + | - | - | - | - |
| Client-side SPA router | + | + | - | - | - | - |
| ISR (stale-while-revalidate) | + | + | - | - | - | - |
| Built-in database layer | + | - | - | - | - | - |
| Built-in auth (JWT + API key) | + | - | - | - | - | - |
| Policy engine | + | - | - | - | - | - |
| Approval workflow | + | - | - | - | - | ~ |
| AI TDD verification | + | - | - | - | - | - |
| RAG / vector search | + | - | - | ~ | - | - |
| OpenTelemetry tracing | + | - | - | - | - | - |
| Workload identity (SPIFFE) | + | - | - | - | - | - |
| Smart agent runtime | + | - | - | - | - | - |
| Tool input validation | + | - | - | - | - | - |
| Tool timeout (per-tool) | + | - | - | - | - | - |
| LLM watchdog / timeout | + | - | - | - | - | - |
| Model fallback | + | - | - | ~ | - | ~ |
| Context compression (4-layer) | + | - | - | - | - | - |
| Token budget management | + | - | - | - | - | - |
| Tool result budget + persist | + | - | - | - | - | - |
| Skill layer | + | - | - | - | ~ | - |
| Self-evolution | + | - | - | - | - | - |
| Error withholding | + | - | - | - | - | - |
| Memory staleness annotations | + | - | - | - | - | - |
| Checkpoint / resume | + | - | - | ~ | - | ~ |
| Stop hooks (guardrails) | + | - | - | ~ | - | - |
| LLM orchestration | ~ | - | - | + | + | + |
| Multi-agent workflows | ~ | - | - | + | + | + |
| Graph-based state machines | - | - | - | + | - | - |
| TypeScript-first | + | + | - | ~ | - | - |
| Production maturity | beta | mature | mature | early | early | early |

Legend: `+` = built-in, `~` = partial/available via plugins, `-` = not available

## Key Insight

Other agent frameworks give you building blocks. Capstan gives you a
production-grade agent runtime with 30+ engineering features built in --
validation, timeout, compression, fallback, skills, evolution, budgets,
checkpoints, and lifecycle hooks -- alongside a full-stack web framework
with multi-protocol API surfaces. No other framework combines both.

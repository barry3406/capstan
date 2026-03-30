# Comparison with Other Frameworks

## Capstan vs Next.js

| Feature                     | Capstan                                    | Next.js                              |
| --------------------------- | ------------------------------------------ | ------------------------------------ |
| **Primary audience**        | Human users + AI agents                    | Human users                          |
| **API definition**          | `defineAPI()` with Zod schemas             | Route handlers or API routes         |
| **Multi-protocol**          | HTTP + MCP + A2A + OpenAPI from one definition | HTTP only (manual OpenAPI)       |
| **Agent manifest**          | Auto-generated at `/.well-known/capstan.json` | Not available                     |
| **MCP server**              | Built-in (`capstan mcp`)                   | Requires separate implementation     |
| **A2A protocol**            | Built-in                                   | Not available                        |
| **OpenAPI spec**            | Auto-generated from Zod schemas            | Requires third-party tools           |
| **File-based routing**      | `*.api.ts`, `*.page.tsx`, `_layout.tsx`    | `page.tsx`, `route.ts`, `layout.tsx` |
| **Server runtime**          | Hono (lightweight, Web Standards)          | Custom (Turbopack/Webpack)           |
| **Database**                | Drizzle ORM with `defineModel()`           | BYO (Prisma, Drizzle, etc.)          |
| **Auth**                    | Built-in JWT + API key for agents          | NextAuth.js (community package)      |
| **Policy engine**           | `definePolicy()` with allow/deny/approve/redact | Not available                   |
| **Approval workflow**       | Built-in human-in-the-loop                 | Not available                        |
| **Verification**            | `capstan verify` (7-step AI TDD loop)      | `tsc` + linting                      |
| **SSR**                     | React SSR with loaders                     | React Server Components              |
| **Selective hydration**     | `<ServerOnly>` component                   | React Server Components (partial)    |
| **RAG / vector search**     | Built-in `field.vector()`, `defineEmbedding()` | Not available                    |
| **MCP client**              | Built-in `createMcpClient()`               | Not available                        |
| **Rate limiting**           | Built-in `defineRateLimit()` per auth type | Requires middleware / third-party    |
| **OpenTelemetry**           | Built-in cross-protocol tracing            | Requires manual instrumentation      |
| **Workload identity**       | SPIFFE/mTLS via `X-Client-Cert`            | Not available                        |
| **LangChain integration**   | `toLangChainTools()` from registry         | Not available                        |
| **Ecosystem maturity**      | Early stage                                | Mature, large ecosystem              |

### When to use Capstan over Next.js

- You are building an application that AI agents will interact with programmatically
- You want a single `defineAPI()` call to generate HTTP, MCP, A2A, and OpenAPI endpoints
- You need human-in-the-loop approval workflows for agent actions
- You want built-in agent authentication (API keys) alongside human auth (JWT)
- You prefer a lightweight, Hono-based server over Next.js's build infrastructure

### When to use Next.js over Capstan

- You are building a primarily human-facing web application
- You need React Server Components, streaming SSR, or edge runtime
- You rely on the Next.js ecosystem (Vercel, middleware, ISR, etc.)
- Your project requires mature community support and extensive documentation

---

## Capstan vs Mastra

Mastra is a TypeScript framework for building AI agents and workflows.

| Feature                     | Capstan                                    | Mastra                               |
| --------------------------- | ------------------------------------------ | ------------------------------------ |
| **Focus**                   | Full-stack apps consumed by agents + humans | AI agent orchestration and workflows |
| **Approach**                | "App that agents can use"                  | "Agent that uses apps"               |
| **API layer**               | `defineAPI()` with automatic multi-protocol | Agent tools with function calling   |
| **Web UI**                  | File-based routing, React SSR              | Optional playground UI               |
| **Database**                | Built-in Drizzle ORM layer                 | Storage adapters                     |
| **MCP**                     | Auto-generated from API definitions        | MCP client support                   |
| **A2A**                     | Built-in A2A server                        | Not built-in                         |
| **Auth**                    | JWT sessions + API keys                    | BYO authentication                   |
| **Policy engine**           | Built-in with approval workflow            | Not available                        |
| **LLM integration**         | Framework-agnostic (agents call your APIs) | Built-in LLM orchestration          |
| **Workflows**               | Via API composition                        | Built-in workflow engine             |
| **RAG**                     | Built-in vector fields + embeddings        | Built-in RAG pipeline                |

### When to use Capstan over Mastra

- You are building a full-stack application (with pages, database, auth) that agents consume as a service
- You want your existing API to be automatically accessible via MCP, A2A, and OpenAPI
- You need human-facing web pages alongside agent APIs
- You want built-in policies and human-in-the-loop approval for agent actions

### When to use Mastra over Capstan

- You are building an AI agent that orchestrates calls to external services
- You need built-in LLM orchestration (prompt chains, function calling)
- You need RAG pipelines and vector storage
- Your primary concern is agent workflow logic, not serving a web application

---

## Capstan vs LangGraph

LangGraph is a framework for building stateful, multi-actor AI applications using graph-based workflows.

| Feature                     | Capstan                                    | LangGraph                            |
| --------------------------- | ------------------------------------------ | ------------------------------------ |
| **Language**                | TypeScript                                 | Python (primary), TypeScript         |
| **Focus**                   | Full-stack apps with agent interfaces      | Stateful agent workflow graphs       |
| **Architecture**            | Request/response API framework             | Graph-based state machines           |
| **API layer**               | `defineAPI()` with HTTP + MCP + A2A        | Not an API framework                 |
| **Web UI**                  | Built-in file-based routing + React SSR    | LangGraph Studio (separate tool)     |
| **Database**                | Built-in Drizzle ORM                       | Checkpoint storage for graph state   |
| **Auth**                    | Built-in JWT + API keys                    | Not built-in                         |
| **Human-in-the-loop**       | Policy-based approval workflow             | Graph interrupt nodes                |
| **Multi-agent**             | Agents call your APIs independently        | Multi-actor graphs with shared state |
| **Streaming**               | SSE for live reload                        | Built-in streaming support           |
| **Deployment**              | Standard Node.js server                    | LangGraph Cloud or self-hosted       |

### When to use Capstan over LangGraph

- You are building a web application that agents interact with through standard protocols
- You want TypeScript-first with Hono, React SSR, and Drizzle ORM
- You need MCP and A2A protocol support for your application
- Your agents are external clients calling your API, not internal workflow nodes
- You prefer a request/response model over graph-based state machines

### When to use LangGraph over Capstan

- You are building complex multi-step agent workflows with branching logic
- You need stateful, persistent graph execution with checkpointing
- You need multi-actor coordination with shared state
- Your application is primarily agent logic, not a web-facing API
- You prefer Python for AI/ML work

---

## Feature Comparison Table

| Feature                      | Capstan | Next.js | Mastra | LangGraph |
| ---------------------------- | :-----: | :-----: | :----: | :-------: |
| HTTP API framework           |    +    |    +    |   -    |     -     |
| MCP server (auto-generated)  |    +    |    -    |   -    |     -     |
| A2A protocol                 |    +    |    -    |   -    |     -     |
| OpenAPI auto-generation      |    +    |    -    |   -    |     -     |
| Agent manifest               |    +    |    -    |   -    |     -     |
| File-based routing           |    +    |    +    |   -    |     -     |
| React SSR                    |    +    |    +    |   -    |     -     |
| Built-in database layer      |    +    |    -    |   ~    |     -     |
| Built-in auth (JWT + API key)|    +    |    -    |   -    |     -     |
| Policy engine                |    +    |    -    |   -    |     -     |
| Approval workflow            |    +    |    -    |   -    |     ~     |
| AI TDD verification          |    +    |    -    |   -    |     -     |
| RAG / vector search          |    +    |    -    |   +    |     ~     |
| MCP client                   |    +    |    -    |   +    |     -     |
| Selective hydration          |    +    |    ~    |   -    |     -     |
| Rate limiting (per auth type)|    +    |    -    |   -    |     -     |
| OpenTelemetry tracing        |    +    |    -    |   -    |     -     |
| Workload identity (SPIFFE)   |    +    |    -    |   -    |     -     |
| LangChain integration        |    +    |    -    |   ~    |     +     |
| LLM orchestration            |    -    |    -    |   +    |     +     |
| Multi-agent workflows        |    -    |    -    |   +    |     +     |
| Graph-based state machines   |    -    |    -    |   -    |     +     |
| TypeScript-first             |    +    |    +    |   +    |     ~     |
| Production maturity          |   beta  | mature  |  early |   early   |

Legend: `+` = built-in, `~` = partial/available via plugins, `-` = not available

## Summary

**Choose Capstan when** you are building a full-stack application -- with web pages, a database, authentication -- that should also be natively accessible to AI agents via MCP, A2A, and OpenAPI, all generated from a single `defineAPI()` call.

**Choose Next.js when** you are building a primarily human-facing web application and need the mature React ecosystem, Server Components, and Vercel integration.

**Choose Mastra when** you are building AI agents that orchestrate LLM calls, external tool use, and workflows -- your agent is the primary actor, not a consumer of your app.

**Choose LangGraph when** you are building complex, stateful multi-agent systems with graph-based workflow logic, branching, and persistent state checkpointing.

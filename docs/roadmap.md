# Roadmap

## Planning Rule

Capstan grows by closing one complete loop at a time.

The core loop is:

1. A human provides a short product or workflow brief
2. A coding agent scaffolds a Capstan application (`create-capstan-app`)
3. Capstan verifies that application with structured diagnostics (`capstan verify`)
4. A human can use the resulting web application (SSR pages, SPA navigation)
5. Another agent can consume the same application's capabilities (MCP, A2A, OpenAPI)
6. The application can be deployed through adapters (Vercel, Fly, Cloudflare, Bun, Node)

If a milestone does not make that loop more robust, it is not on the critical path.

---

## Shipped

### Foundation (v0.1)

- **`defineAPI()` + multi-protocol** — one function call exposes HTTP, MCP Tools, A2A Skills, and OpenAPI simultaneously via `CapabilityRegistry`
- **File-based routing** — `*.api.ts`, `*.page.tsx`, `_layout.tsx`, `_middleware.ts`, dynamic `[param]`, catch-all `[...rest]`
- **Database layer** — `defineModel()` with Drizzle ORM, field types, relations, auto-migration, auto-CRUD routes
- **Auth** — JWT sessions, API key auth (agent-friendly), OAuth providers (Google, GitHub)
- **Policy engine** — `definePolicy()` with `allow` / `deny` / `approve` / `redact` effects
- **Approval workflow** — human-in-the-loop for agent actions, managed at `/capstan/approvals`
- **8-step verification** — `capstan verify --json` with structured repair checklist for AI agents
- **CLI** — `capstan dev`, `build`, `start`, `verify`, `add`, `mcp`, `db:migrate`, `db:push`
- **Scaffolder** — `create-capstan-app` with interactive prompts and templates
- **Agent integration** — MCP server (stdio), MCP client, A2A adapter, LangChain tools, agent manifests
- **AI toolkit** — `@zauso-ai/capstan-ai` standalone: `createAI`, `think()`, `generate()`, memory (remember/recall/forget), agent loop with tool use

### Server Rendering (v0.1)

- **Streaming SSR** — `renderPage()`, `renderPageStream()` with React
- **Data loaders** — `defineLoader()`, `useLoaderData()`, in-process `fetch` methods
- **Layout nesting** — `_layout.tsx` with `<Outlet>`, arbitrary nesting depth
- **Selective hydration** — `full` / `visible` / `none` per page, `<ServerOnly>`, `<ClientOnly>`, `serverOnly()` guard
- **React components** — `Image` (responsive srcset, lazy, blur-up), `defineFont()`, `defineMetadata()`, `ErrorBoundary`, `NotFound`

### Infrastructure (v0.1)

- **WebSocket** — `defineWebSocket()`, `WebSocketRoom`, connection lifecycle
- **CSS pipeline** — Lightning CSS, Tailwind v4 auto-detection, zero-config
- **Vite integration** — optional client build pipeline, middleware mode for dev
- **Deployment adapters** — Vercel, Fly.io, Cloudflare Workers, Bun, Node
- **Observability** — OpenTelemetry tracing, metrics, circuit breaker, events
- **Security** — DPoP (RFC 9449), SPIFFE/mTLS, CSRF protection, rate limiting per auth type
- **Compliance** — EU AI Act `defineCompliance()`, audit logging
- **State stores** — pluggable `KeyValueStore<T>`, Redis adapter
- **Plugins** — plugin system with setup context

### Caching & Render Strategies (latest)

- **Data cache** — `cacheSet` / `cacheGet` with TTL + tags, `cached()` stale-while-revalidate decorator, `cacheInvalidateTag()` bulk invalidation
- **Response cache** — `responseCacheGet` / `responseCacheSet` for full-page HTML, cross-invalidation with data cache
- **Render strategies** — `SSRStrategy`, `ISRStrategy` (stale-while-revalidate with background revalidation), `SSGStrategy` (stub)
- **Page-level control** — `renderMode` (`"ssr"` / `"isr"` / `"ssg"` / `"streaming"`), `revalidate`, `cacheTags` exports
- **`_loading.tsx` / `_error.tsx`** — file conventions for Suspense fallback and ErrorBoundary, directory-scoped like layouts

### Client-Side Router (latest)

- **`<Link>` component** — renders `<a>`, SPA interception, prefetch strategies (`hover` / `viewport` / `none`)
- **`CapstanRouter`** — navigate, prefetch, subscribe, popstate, View Transitions
- **Navigation payload** — server returns JSON via `X-Capstan-Nav: 1`, morphdom for server components, React reconciliation for client components
- **Prefetching** — `PrefetchManager` with IntersectionObserver (viewport) and hover (80ms delay)
- **Scroll restoration** — sessionStorage-based, keyed by `history.state`
- **View Transitions** — `withViewTransition()` wraps DOM mutations in `document.startViewTransition()`, graceful fallback
- **React hooks** — `useNavigate()`, `useRouterState()`, `NavigationProvider`
- **Manifest** — `window.__CAPSTAN_MANIFEST__` injected in full-page HTML, `bootstrapClient()` global click delegation

---

## Next

### Phase 3: Static Site Generation

- **`SSGStrategy`** — full implementation (currently falls back to SSR)
- **`generateStaticParams()`** — page export that returns an array of params to prerender at build time
- **`capstan build --static`** — scan routes, call `generateStaticParams()`, prerender HTML to `dist/`
- **Hybrid output** — mix SSR, ISR, and SSG pages in the same app

### Phase 4: Navigation Refinements

- **Per-element scroll** — restore scroll for specific scrollable containers, not just `window`
- **Hash fragment navigation** — smooth scroll to `#id` targets
- **Named View Transitions** — CSS `view-transition-name` integration for element-level animation
- **HMR upgrade** — move from full-reload SSE to module-level hot updates (page morphing, CSS stylesheet swap)

### Phase 5: React Server Components

- **Full RSC protocol** — server component serialization, client/server component boundary
- **Streaming boundaries** — incremental streaming with per-component Suspense
- **Server Actions** — form submissions that call server functions directly
- **Partial prerendering** — static shell with dynamic holes

### Phase 6: UI Surface Generation

- **`surface-react`** — generated CRUD pages from `defineModel()` + `defineAPI()` definitions
- **`surface-web`** — embeddable web components for agent-operable UIs
- **Admin dashboard** — auto-generated model browser, API explorer, approval management

### Phase 7: Release Workflows

- **Structured release** — `capstan release` with environment promotion (dev -> staging -> prod)
- **Rollback automation** — automatic rollback on health check failure
- **Migration safety gates** — database migration verification before deploy
- **Deployment traceability** — link releases to git commits, verification results, and approval records

---

## Success Definition

Capstan succeeds when a coding agent can take a short brief and produce an application where:

- Humans can operate it through a polished web interface with SPA navigation
- AI agents can consume it natively through MCP, A2A, and OpenAPI
- Capstan can validate, inspect, and repair it with structured diagnostics
- The application can be deployed and released with confidence through adapters and safety gates

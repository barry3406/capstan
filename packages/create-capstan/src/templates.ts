// ---------------------------------------------------------------------------
// Template strings for generated Capstan projects
// ---------------------------------------------------------------------------

const CAPSTAN_PACKAGE_RANGE = "^1.0.0-beta.7";

export function packageJson(
  projectName: string,
  template: "blank" | "tickets" = "blank",
): string {
  const deps: Record<string, string> = {
    "@zauso-ai/capstan-cli": CAPSTAN_PACKAGE_RANGE,
    "@zauso-ai/capstan-core": CAPSTAN_PACKAGE_RANGE,
    "@zauso-ai/capstan-dev": CAPSTAN_PACKAGE_RANGE,
    "@zauso-ai/capstan-react": CAPSTAN_PACKAGE_RANGE,
    "@zauso-ai/capstan-router": CAPSTAN_PACKAGE_RANGE,
    zod: "^3.23.0",
  };

  // Only include capstan-db for templates that actually use it (native dep
  // issues with better-sqlite3 make it a poor default).
  if (template === "tickets") {
    deps["@zauso-ai/capstan-auth"] = CAPSTAN_PACKAGE_RANGE;
    deps["@zauso-ai/capstan-db"] = CAPSTAN_PACKAGE_RANGE;
  }

  return JSON.stringify(
    {
      name: projectName,
      version: "0.1.0",
      type: "module",
      private: true,
      scripts: {
        dev: "capstan dev",
        build: "capstan build",
        "build:standalone": "capstan build --target node-standalone",
        "build:docker": "capstan build --target docker",
        "build:vercel-node": "capstan build --target vercel-node",
        "build:vercel-edge": "capstan build --target vercel-edge",
        "build:cloudflare": "capstan build --target cloudflare",
        "build:fly": "capstan build --target fly",
        start: "capstan start",
        "start:standalone": "capstan start --from dist/standalone",
        "deploy:init": "capstan deploy:init",
      },
      dependencies: deps,
      devDependencies: {
        typescript: "^5.9.0",
        "@types/node": "^24.0.0",
      },
    },
    null,
    2,
  );
}

export function tsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        jsx: "react-jsx",
        strict: true,
        outDir: "dist",
        rootDir: ".",
      },
      include: ["app/**/*.ts", "app/**/*.tsx", "capstan.config.ts"],
    },
    null,
    2,
  );
}

export function capstanConfig(
  projectName: string,
  title: string,
  template: "blank" | "tickets" = "blank",
): string {
  const dbBlock =
    template === "tickets"
      ? `
  database: {
    provider: "sqlite",
    url: env("DATABASE_URL") || "./data.db",
  },
  auth: {
    providers: [
      { type: "apiKey" },
    ],
    session: {
      secret: env("SESSION_SECRET") || crypto.randomUUID(),
      maxAge: "7d",
    },
  },`
      : "";

  return `import { defineConfig, env } from "@zauso-ai/capstan-core";

export default defineConfig({
  app: {
    name: "${projectName}",
    title: "${title}",
    description: "A Capstan application",
  },${dbBlock}
  agent: {
    manifest: true,
    mcp: true,
    openapi: true,
  },
});
`;
}

export function rootLayout(title: string): string {
  return `import { Outlet } from "@zauso-ai/capstan-react";

export default function RootLayout() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#f4efe6" />
        <title>${title}</title>
        <link rel="stylesheet" href="/styles.css" precedence="default" />
      </head>
      <body className="capstan-shell">
        <Outlet />
      </body>
    </html>
  );
}
`;
}

export function indexPage(
  title: string,
  projectName: string,
  template: "blank" | "tickets" = "blank",
): string {
  const templateTitle = template === "tickets"
    ? "Tickets reference app"
    : "Blank launchpad";
  const templateDescription = template === "tickets"
    ? "A realistic starting point with CRUD routes, auth, and a model you can copy with confidence."
    : "A clean Capstan shell with just enough surface area to ship your first route fast.";
  const templatePointers = template === "tickets"
    ? `
          <li><code>app/routes/tickets/index.api.ts</code> shows a read/write route pair.</li>
          <li><code>app/models/ticket.model.ts</code> is the reference model and migration starting point.</li>
          <li><code>capstan verify --json</code> is the quickest way to check contracts after edits.</li>
`
    : `
          <li><code>app/routes/api/health.api.ts</code> is the smallest complete <code>defineAPI()</code> example.</li>
          <li><code>capstan add api hello</code> is the fastest way to grow from one route to many.</li>
          <li><code>AGENTS.md</code> teaches coding agents the golden path for this app.</li>
`;

  return `export default function HomePage() {
  return (
    <main className="landing-shell">
      <section className="hero-card">
        <p className="eyebrow">Capstan starter · ${templateTitle}</p>
        <h1>Welcome aboard ${title}</h1>
        <p className="hero-copy">
          This app already ships with a page, an API route, agent-readable surfaces, deployment scripts,
          and a project-level <code>AGENTS.md</code> that teaches coding agents how to extend it.
        </p>
        <div className="hero-actions">
          <a className="button button-primary" href="/.well-known/capstan.json">Open agent manifest</a>
          <a className="button button-secondary" href="/openapi.json">View OpenAPI</a>
          <a className="button button-secondary" href="/health">Health check</a>
        </div>
      </section>

      <section className="panel-grid">
        <article className="panel panel-highlight">
          <p className="panel-kicker">Project pulse</p>
          <h2>${projectName}</h2>
          <p>${templateDescription}</p>
          <ul className="resource-list">
            <li><span>Framework contract</span><a href="/.well-known/capstan.json">/.well-known/capstan.json</a></li>
            <li><span>HTTP + tool schema</span><a href="/openapi.json">/openapi.json</a></li>
            <li><span>Runtime status</span><a href="/health">/health</a></li>
          </ul>
        </article>

        <article className="panel">
          <p className="panel-kicker">Edit here first</p>
          <h2>Good first moves</h2>
          <ul className="code-list">
            <li><code>app/routes/index.page.tsx</code> shapes the first impression.</li>
            <li><code>capstan.config.ts</code> is where app metadata and providers live.</li>
            <li><code>app/styles/main.css</code> controls the visual voice of the starter.</li>
            <li><code>AGENTS.md</code> keeps human and coding-agent workflows aligned.</li>
          </ul>
        </article>

        <article className="panel">
          <p className="panel-kicker">Capstan golden path</p>
          <h2>Use the framework, do not fight it</h2>
          <div className="command-stack">
            <code>capstan add api hello</code>
            <code>capstan add page dashboard</code>
            <code>capstan verify --json</code>
            <code>capstan build --target node-standalone</code>
          </div>
        </article>

        <article className="panel">
          <p className="panel-kicker">Template notes</p>
          <h2>What this starter is trying to teach</h2>
          <ul className="code-list">
${templatePointers}          </ul>
        </article>
      </section>
    </main>
  );
}
`;
}

export function healthApi(): string {
  return `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  output: z.object({
    status: z.string(),
    timestamp: z.string(),
  }),
  description: "Health check endpoint",
  capability: "read",
  async handler() {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
    };
  },
});
`;
}

export function policiesIndex(): string {
  return `import { definePolicy } from "@zauso-ai/capstan-core";

export const requireAuth = definePolicy({
  key: "requireAuth",
  title: "Require Authentication",
  effect: "deny",
  async check({ ctx }) {
    if (!ctx.auth.isAuthenticated) {
      return { effect: "deny", reason: "Authentication required" };
    }
    return { effect: "allow" };
  },
});
`;
}

export function gitignore(): string {
  return `node_modules/
dist/
.capstan/
*.db
.env
.env.local
`;
}

export function dockerfile(): string {
  return `FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npx capstan build --target node-standalone

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist/standalone/package.json ./package.json
RUN npm install --omit=dev

COPY --from=builder /app/dist/standalone/dist ./dist

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV CAPSTAN_HOST=0.0.0.0

CMD ["node", "dist/_capstan_server.js"]
`;
}

export function flyDockerfile(): string {
  return `FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npx capstan build --target fly

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist/standalone/package.json ./package.json
RUN npm install --omit=dev

COPY --from=builder /app/dist/standalone/dist ./dist

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV CAPSTAN_HOST=0.0.0.0

CMD ["node", "dist/_capstan_server.js"]
`;
}

export function dockerignore(): string {
  return `node_modules/
dist/
.git/
.DS_Store
npm-debug.log*
`;
}

export function envExample(): string {
  return `PORT=3000
CAPSTAN_HOST=0.0.0.0
# CAPSTAN_PORT=3000
# CAPSTAN_CORS_ORIGIN=https://example.com
# CAPSTAN_MAX_BODY_SIZE=1048576
NODE_ENV=production
# DATABASE_URL=
# SESSION_SECRET=
`;
}

export function vercelConfig(target: "vercel-node" | "vercel-edge"): string {
  return `${JSON.stringify(
    {
      version: 2,
      buildCommand: `npx capstan build --target ${target}`,
      outputDirectory: "dist/standalone",
      functions: {
        "dist/standalone/api/index.js": target === "vercel-edge"
          ? { runtime: "edge" }
          : { runtime: "nodejs20.x" },
      },
      routes: [
        {
          src: "/(.*)",
          dest: "/dist/standalone/api/index",
        },
      ],
    },
    null,
    2,
  )}\n`;
}

export function wranglerConfig(appName: string): string {
  return `name = "${appName}"
main = "dist/standalone/worker.js"
compatibility_date = "2026-03-01"
compatibility_flags = ["nodejs_compat"]
`;
}

export function flyToml(appName: string): string {
  return `app = "${appName}"
primary_region = "iad"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
  processes = ["app"]
`;
}

export function mainCss(): string {
  return `/* app/styles/main.css — processed by Lightning CSS or Tailwind */
:root {
  --paper: #f4efe6;
  --paper-strong: #fff9f0;
  --ink: #1e2433;
  --muted: #5e6575;
  --accent: #0f766e;
  --accent-strong: #0b4f4a;
  --accent-soft: rgba(15, 118, 110, 0.14);
  --line: rgba(30, 36, 51, 0.12);
  --panel: rgba(255, 255, 255, 0.86);
  --shadow: 0 24px 80px rgba(21, 27, 38, 0.14);
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
}

html {
  min-height: 100%;
}

body {
  min-height: 100vh;
  font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
  line-height: 1.6;
  color: var(--ink);
  background:
    radial-gradient(circle at top left, rgba(254, 240, 138, 0.45), transparent 26rem),
    radial-gradient(circle at top right, rgba(45, 212, 191, 0.24), transparent 22rem),
    linear-gradient(180deg, #fbf7f0 0%, var(--paper) 55%, #ede6d8 100%);
}

.capstan-shell {
  position: relative;
}

.capstan-shell::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(30, 36, 51, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(30, 36, 51, 0.03) 1px, transparent 1px);
  background-size: 2rem 2rem;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.35), transparent 70%);
}

a {
  color: inherit;
  text-decoration: none;
}

a:hover {
  text-decoration: none;
}

code {
  font-family: "IBM Plex Mono", "SFMono-Regular", ui-monospace, monospace;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(30, 36, 51, 0.08);
  padding: 0.16em 0.42em;
  border-radius: 999px;
  font-size: 0.9em;
}

.landing-shell {
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 4rem 0 5rem;
}

.hero-card,
.panel {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 1.75rem;
  background: var(--panel);
  backdrop-filter: blur(18px);
  box-shadow: var(--shadow);
}

.hero-card {
  padding: clamp(1.8rem, 4vw, 3.4rem);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(255, 249, 240, 0.88)),
    radial-gradient(circle at top right, rgba(15, 118, 110, 0.18), transparent 18rem);
}

.hero-card::after {
  content: "";
  position: absolute;
  right: -3rem;
  top: -4rem;
  width: 12rem;
  height: 12rem;
  border-radius: 999px;
  background: rgba(15, 118, 110, 0.12);
  filter: blur(8px);
}

.eyebrow,
.panel-kicker {
  font-size: 0.82rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent-strong);
}

.hero-card h1,
.panel h2 {
  font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
  letter-spacing: -0.03em;
}

.hero-card h1 {
  max-width: 11ch;
  margin-top: 0.55rem;
  font-size: clamp(2.9rem, 8vw, 5.4rem);
  line-height: 0.95;
}

.hero-copy {
  max-width: 48rem;
  margin-top: 1.15rem;
  font-size: 1.08rem;
  color: var(--muted);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
  margin-top: 1.8rem;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.9rem;
  padding: 0 1rem;
  border-radius: 999px;
  border: 1px solid transparent;
  font-weight: 600;
  transition: transform 150ms ease, border-color 150ms ease, background 150ms ease;
}

.button:hover {
  transform: translateY(-1px);
}

.button-primary {
  color: white;
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
}

.button-secondary {
  color: var(--ink);
  background: rgba(255, 255, 255, 0.68);
  border-color: var(--line);
}

.panel-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.panel {
  padding: 1.4rem;
}

.panel-highlight {
  background:
    linear-gradient(180deg, rgba(15, 118, 110, 0.1), rgba(255, 255, 255, 0.92)),
    var(--panel);
}

.panel h2 {
  margin-top: 0.35rem;
  font-size: 1.7rem;
}

.panel p,
.panel li,
.resource-list span {
  color: var(--muted);
}

.resource-list,
.code-list {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
  padding: 0;
  list-style: none;
}

.resource-list li {
  display: grid;
  gap: 0.1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(30, 36, 51, 0.08);
}

.resource-list li:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.resource-list a {
  color: var(--ink);
  font-weight: 600;
}

.command-stack {
  display: grid;
  gap: 0.7rem;
  margin-top: 1rem;
}

.command-stack code {
  width: fit-content;
  max-width: 100%;
  padding: 0.55rem 0.8rem;
  border-radius: 1rem;
  background: var(--paper-strong);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

@media (max-width: 760px) {
  .landing-shell {
    width: min(100% - 1rem, 40rem);
    padding: 1rem 0 2rem;
  }

  .panel-grid {
    grid-template-columns: 1fr;
  }

  .hero-actions {
    flex-direction: column;
  }

  .button {
    width: 100%;
  }
}
`;
}

// ---------------------------------------------------------------------------
// AGENTS.md
// ---------------------------------------------------------------------------

export function legacyAgentsMd(
  projectName: string,
  template: "blank" | "tickets",
): string {
  const ticketsNote =
    template === "tickets"
      ? `
## Tickets Template

This project was scaffolded with the **tickets** template, which includes:
- \`app/models/ticket.model.ts\` — Ticket data model (status, priority fields)
- \`app/routes/tickets/index.api.ts\` — GET (list) + POST (create) for tickets
- \`app/routes/tickets/[id].api.ts\` — GET ticket by ID

Use these as reference when adding new resources.
`
      : "";

  return `# AGENTS.md — AI Coding Guide for Capstan

This file teaches AI coding agents (Claude Code, Cursor, Codex, etc.) how to build applications with the Capstan framework. Read this entire file before writing any code.

## Project: ${projectName}

## Project Structure

\`\`\`
app/
  routes/              — File-based routing (the core of your app)
    *.api.ts           — API route: export GET, POST, PUT, DELETE handlers
    *.page.tsx         — Page route: export default React component + optional loader
    _layout.tsx        — Layout wrapper: wraps all sibling and child routes
    _middleware.ts     — Middleware: runs before all sibling and child routes
    _loading.tsx       — Suspense fallback for sibling/child pages
    _error.tsx         — Error boundary for sibling/child pages
    not-found.tsx      — Scoped 404 boundary for unknown routes in scope
    (group)/           — Route group: affects inheritance, not the URL
    [param]/           — Dynamic segment: value available via ctx/params
    [...catchAll]/     — Catch-all segment: matches any remaining path
  models/              — Data model definitions (defineModel)
  policies/            — Permission policies (definePolicy)
  migrations/          — SQL migration files
  public/              — Static assets (CSS, images, fonts) served at root URL
capstan.config.ts      — Framework configuration
\`\`\`
${ticketsNote}
## Commands

\`\`\`bash
capstan dev                 # Dev server with live reload (default port 3000)
capstan dev --port 4000     # Custom port
capstan build               # Production build (tsc + manifests + deploy contract + server entry)
capstan start               # Run production server
capstan verify --json       # AI TDD: structured diagnostics for auto-fix
capstan ops:events          # Inspect structured runtime events from .capstan/ops/ops.db
capstan ops:incidents       # Inspect open/resolved incidents
capstan ops:health          # Inspect the latest health summary
capstan ops:tail            # Tail the latest events and incidents
capstan add model <name>    # Scaffold a model
capstan add api <name>      # Scaffold API routes
capstan add page <name>     # Scaffold a page
capstan add policy <name>   # Scaffold a policy
capstan mcp                 # Start MCP server (stdio, for Claude Desktop)
capstan db:migrate          # Generate migration SQL from models
capstan db:push             # Apply pending migrations to database
capstan db:status           # Show migration status
turbo:build                 # Parallel builds with caching (Turborepo)
\`\`\`

## defineAPI() — Complete Reference

Every API route exports HTTP method handlers created with \`defineAPI()\`:

\`\`\`typescript
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  // --- Schema (required for type safety) ---
  input: z.object({                    // Query params (GET) or request body (POST/PUT)
    status: z.string().optional(),
    page: z.coerce.number().default(1),
  }),
  output: z.object({                   // Response shape (also used for OpenAPI spec)
    items: z.array(z.object({ id: z.string(), title: z.string() })),
    total: z.number(),
  }),

  // --- Metadata (used for MCP/A2A/OpenAPI generation) ---
  description: "List all items",       // Human & agent readable description
  capability: "read",                  // "read" or "write" — determines MCP tool behavior
  resource: "item",                    // Groups related APIs in the agent manifest

  // --- Authorization ---
  policy: "requireAuth",               // Policy key from app/policies/ (optional)

  // --- Handler ---
  async handler({ input, ctx, params }) {
    // input: parsed & validated by Zod (type-safe)
    // ctx.auth: { isAuthenticated, type, userId?, permissions[] }
    // ctx.request: raw Request object
    // ctx.env: process.env record
    // params: route parameters (e.g. params.id for [id].api.ts routes)

    return { items: [], total: 0 };    // Must match output schema
  },
});
\`\`\`

### Handler Context (\`ctx\`) and \`params\`

\`\`\`typescript
interface CapstanContext {
  auth: {
    isAuthenticated: boolean;
    type: "anonymous" | "human" | "agent";
    userId?: string;
    permissions: string[];
  };
  request: Request;           // Standard Web API Request
  env: Record<string, string | undefined>;  // process.env
}

// params: Record<string, string>
// For a route file at app/routes/tickets/[id].api.ts:
//   GET /tickets/abc123 → params.id === "abc123"
\`\`\`

### Rate Limiting

\`\`\`typescript
import { defineRateLimit } from "@zauso-ai/capstan-core";

export const rateLimit = defineRateLimit({
  limit: 100,                         // Max requests per window
  window: "1m",                       // Window duration
  byAuthType: {                       // Per-auth-type overrides (optional)
    human: { limit: 200, window: "1m" },
    agent: { limit: 500, window: "1m" },
    anonymous: { limit: 20, window: "1m" },
  },
});
\`\`\`

Returns \`429 Too Many Requests\` with \`Retry-After\` and \`X-RateLimit-*\` headers when exceeded.

### Multi-protocol: one defineAPI() → four surfaces

Every \`defineAPI()\` call automatically generates:
1. **HTTP JSON API** — standard REST endpoint
2. **MCP Tool** — usable by Claude Desktop, Cursor, etc.
3. **A2A Skill** — Google Agent-to-Agent protocol
4. **OpenAPI 3.1** — auto-generated spec at \`/openapi.json\`

No extra code needed. The \`description\`, \`input\`, \`output\` fields drive all four.

## Page Routes (.page.tsx) — Streaming SSR with Data Loading

Capstan uses React 18 streaming SSR (\`renderToReadableStream\`) for optimal TTFB.

\`\`\`typescript
// app/routes/users/index.page.tsx
import { useLoaderData } from "@zauso-ai/capstan-react";

// Server-side data loader (runs on every request, before render)
export async function loader({ params, request, ctx, fetch }) {
  // fetch.get/post/put/delete call your own API routes in-process (no HTTP round-trip)
  const data = await fetch.get("/api/users");
  return { users: data.users };
}

// React component (server-rendered, then hydrated on client)
export default function UsersPage() {
  const { users } = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>Users ({users.length})</h1>
      <ul>
        {users.map(u => <li key={u.id}>{u.name}</li>)}
      </ul>
    </div>
  );
}
\`\`\`

### Selective Hydration

Pages can export a \`hydration\` constant to control client-side JS behavior:

\`\`\`typescript
// "none" = zero client JS (server-only rendering, no hydration)
// "visible" = lazy hydration via IntersectionObserver (hydrates when scrolled into view)
// "full" = default behavior (immediate hydration)
export const hydration = "none";

export default function StaticPage() {
  return <div>This page ships zero client JS</div>;
}
\`\`\`

### Client Components

Pages with \`"use client"\` at the top are detected as client components:

\`\`\`typescript
"use client";
export default function InteractivePage() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
\`\`\`

### Render Mode & ISR

Control how each page is rendered by exporting \`renderMode\`, \`revalidate\`, and \`cacheTags\`:

\`\`\`typescript
// app/routes/blog/index.page.tsx
export const renderMode = "isr";    // "ssr" (default) | "ssg" | "isr" | "streaming"
export const revalidate = 60;       // Revalidate every 60 seconds (ISR)
export const cacheTags = ["blog"];   // Invalidate via cacheInvalidateTag("blog")

export async function loader({ fetch }: LoaderArgs) {
  return { posts: await fetch.get("/api/posts") };
}

export default function BlogPage() {
  const { posts } = useLoaderData<{ posts: Post[] }>();
  return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
}
\`\`\`

ISR behavior: fresh cache returns immediately, stale cache returns + revalidates in background, miss renders and caches. \`cacheInvalidateTag("blog")\` evicts both data cache and page cache entries.

### Static Site Generation (SSG)

Pages with \`renderMode = "ssg"\` are pre-rendered at build time to static HTML:

\`\`\`typescript
// app/routes/about.page.tsx — static route, no params
export const renderMode = "ssg";
export default function About() {
  return <h1>About Us</h1>;
}
\`\`\`

Dynamic SSG pages must export \`generateStaticParams()\` to define which param combinations to pre-render:

\`\`\`typescript
// app/routes/blog/[id].page.tsx
export const renderMode = "ssg";

export async function generateStaticParams() {
  const posts = await db.select().from(postsTable);
  return posts.map(p => ({ id: String(p.id) }));
}

export async function loader({ params }: LoaderArgs) {
  return { post: await db.select().from(postsTable).where(eq(postsTable.id, Number(params.id))).get() };
}

export default function BlogPost() {
  const { post } = useLoaderData<{ post: Post }>();
  return <article><h1>{post.title}</h1><p>{post.body}</p></article>;
}
\`\`\`

Build: \`capstan build --static\` pre-renders all SSG pages to \`dist/static/\`. The production server serves them as static files (instant, no rendering), falling back to SSR for non-SSG pages. You can mix SSR, ISR, and SSG pages in the same app.

### Loading & Error Boundaries

\`_loading.tsx\` and \`_error.tsx\` are file conventions like \`_layout.tsx\`. They scope to all pages in the same directory and subdirectories, with the nearest file winning.

\`\`\`
app/routes/
  _loading.tsx           # Default loading UI for all pages
  _error.tsx             # Default error UI for all pages
  index.page.tsx
  dashboard/
    _loading.tsx         # Dashboard-specific loading (overrides parent)
    index.page.tsx
\`\`\`

\`_loading.tsx\` — export a default React component (no props). Used as \`<Suspense>\` fallback:

\`\`\`typescript
export default function Loading() {
  return <div className="spinner">Loading...</div>;
}
\`\`\`

\`_error.tsx\` — export a default React component receiving \`{ error, reset }\`. Used as \`<ErrorBoundary>\` fallback:

\`\`\`typescript
export default function ErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <p>Something went wrong: {error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
\`\`\`

### Not Found Boundaries

\`not-found.tsx\` and \`not-found.page.tsx\` provide scoped 404 fallbacks. When a \`GET\` or \`HEAD\` request misses every page route, Capstan renders the nearest \`not-found\` file whose directory scope contains the URL.

\`\`\`
app/routes/
  not-found.tsx           # Root fallback
  docs/
    not-found.tsx         # Used for /docs/*
\`\`\`

Route groups like \`(marketing)\` stay out of the URL, but their layouts, middleware, loading boundaries, error boundaries, and \`not-found\` files still participate in inheritance.

### Client-Side Navigation

Use \`<Link>\` for SPA navigation without full-page reloads:

\`\`\`typescript
import { Link } from "@zauso-ai/capstan-react/client";

<Link href="/about">About</Link>
<Link href="/posts" prefetch="viewport">Posts</Link>
<Link href="/settings" prefetch="none" replace>Settings</Link>
\`\`\`

\`Link\` renders a standard \`<a>\` (works without JS). When the client router is active, clicks are intercepted for instant SPA transitions. Prefetch strategies: \`"hover"\` (default, 80ms delay), \`"viewport"\` (IntersectionObserver), \`"none"\`.

Programmatic navigation:

\`\`\`typescript
import { useNavigate, useRouterState } from "@zauso-ai/capstan-react/client";

function MyComponent() {
  const navigate = useNavigate();
  const { url, status } = useRouterState(); // status: "idle" | "loading" | "error"

  return <button onClick={() => navigate("/dashboard")}>Go</button>;
}
\`\`\`

Add \`data-capstan-external\` to any \`<a>\` tag to opt out of SPA interception. View Transitions are applied automatically when the browser supports \`document.startViewTransition()\`.

### ServerOnly Wrapper

Use \`ServerOnly\` to exclude content from client bundles entirely:

\`\`\`typescript
import { ServerOnly } from "@zauso-ai/capstan-react";

export default function Page() {
  return (
    <div>
      <p>This renders everywhere</p>
      <ServerOnly>
        <SecretAdminPanel />  {/* Never sent to client */}
      </ServerOnly>
    </div>
  );
}
\`\`\`

### Loader context

\`\`\`typescript
export async function loader({ params, request, ctx, fetch }) {
  // params:   route parameters (e.g. params.id for [id].page.tsx)
  // request:  raw Web API Request object
  // ctx.auth: { isAuthenticated, type: "human"|"agent"|"anonymous", userId?, permissions[] }
  // fetch:    in-process fetch to call your own API routes without HTTP overhead
  //           fetch.get<T>(path, queryParams?)
  //           fetch.post<T>(path, body?)
  //           fetch.put<T>(path, body?)
  //           fetch.delete<T>(path)
}
\`\`\`

## Layouts and Middleware

### Layout (\`_layout.tsx\`) — wraps all routes in the same directory and below

The **root layout** must provide the full HTML document structure (\`<html>\`, \`<head>\`, \`<body>\`).
This is where you add CSS, fonts, meta tags, and other \`<head>\` content.

\`\`\`typescript
// app/routes/_layout.tsx  (root layout — provides the HTML document)
import { Outlet } from "@zauso-ai/capstan-react";

export default function RootLayout() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${projectName}</title>
        <link rel="stylesheet" href="/styles.css" precedence="default" />
      </head>
      <body>
        <Outlet />  {/* Child route renders here */}
      </body>
    </html>
  );
}
\`\`\`

### Nested layouts — build a layout hierarchy

Layouts nest automatically by directory. Each \`_layout.tsx\` wraps all sibling and child routes:

\`\`\`
app/routes/
  _layout.tsx              ← Root: <html>, <head>, <body>
  index.page.tsx           ← Wrapped by root layout only
  dashboard/
    _layout.tsx            ← Dashboard shell: sidebar + nav
    index.page.tsx         ← Wrapped by root → dashboard
    settings.page.tsx      ← Wrapped by root → dashboard
\`\`\`

Nested layouts render only their own UI and an \`<Outlet />\` (no \`<html>\`/\`<head>\`):

\`\`\`typescript
// app/routes/dashboard/_layout.tsx
import { Outlet } from "@zauso-ai/capstan-react";

export default function DashboardLayout() {
  return (
    <div className="dashboard">
      <nav>Dashboard Nav</nav>
      <main><Outlet /></main>
    </div>
  );
}
\`\`\`

All layout modules for a route are loaded in parallel for performance.

### Middleware (\`_middleware.ts\`) — runs before all routes in the same directory and below

\`\`\`typescript
// app/routes/api/_middleware.ts
import { defineMiddleware } from "@zauso-ai/capstan-core";

export default defineMiddleware(async ({ ctx, next }) => {
  console.log(\`[\${ctx.request.method}] \${new URL(ctx.request.url).pathname}\`);
  return next();  // Must call next() to continue the chain
});
\`\`\`

## Data Models

\`\`\`typescript
// app/models/user.model.ts
import { defineModel, field, relation } from "@zauso-ai/capstan-db";

export const User = defineModel("user", {
  fields: {
    id: field.id(),                                    // Auto-generated UUID primary key
    name: field.string({ required: true, max: 100 }),
    email: field.string({ required: true, unique: true }),
    role: field.enum(["admin", "user", "guest"], { default: "user" }),
    bio: field.text(),                                 // Long text
    age: field.integer({ min: 0, max: 150 }),
    score: field.number(),                             // Floating point
    isActive: field.boolean({ default: true }),
    metadata: field.json(),                            // Arbitrary JSON
    birthDate: field.date(),                           // Date only (ISO-8601)
    createdAt: field.datetime({ default: "now" }),     // Auto-set on create
    updatedAt: field.datetime({ updatedAt: true }),    // Auto-set on update
  },
  relations: {
    posts: relation.hasMany("post"),                   // User has many Posts
    profile: relation.hasOne("profile"),               // User has one Profile
    department: relation.belongsTo("department"),      // User belongs to Department
    tags: relation.manyToMany("tag", { through: "user_tag" }),
  },
  indexes: [
    { fields: ["email"], unique: true },
    { fields: ["role", "isActive"] },
  ],
});
\`\`\`

### Field types → database mapping

| Field helper      | SQLite    | PostgreSQL      | MySQL           |
|-------------------|-----------|-----------------|-----------------|
| field.id()        | TEXT PK   | TEXT PK         | VARCHAR(36) PK  |
| field.string()    | TEXT      | VARCHAR(255)    | VARCHAR(255)    |
| field.text()      | TEXT      | TEXT            | TEXT            |
| field.integer()   | INTEGER   | INTEGER         | INT             |
| field.number()    | REAL      | DOUBLE PREC.    | DOUBLE          |
| field.boolean()   | INTEGER   | BOOLEAN         | BOOLEAN         |
| field.date()      | TEXT      | TEXT            | TEXT            |
| field.datetime()  | TEXT      | TIMESTAMP       | DATETIME        |
| field.json()      | TEXT      | JSONB           | JSON            |
| field.enum()      | TEXT      | VARCHAR(255)    | VARCHAR(255)    |
| field.vector(dim) | BLOB      | vector(dim)     | BLOB            |

### Vector Search & RAG

Use \`field.vector(dimensions)\` for semantic search and RAG pipelines:

\`\`\`typescript
import { defineModel, field } from "@zauso-ai/capstan-db";
import { defineEmbedding, openaiEmbeddings } from "@zauso-ai/capstan-db";

export const Document = defineModel("document", {
  fields: {
    id: field.id(),
    content: field.text({ required: true }),
    embedding: field.vector(1536),          // Vector field (1536 dims for OpenAI ada-002)
  },
});

// Auto-embed: whenever "content" changes, re-compute "embedding"
export const docEmbedding = defineEmbedding({
  sourceField: "content",
  vectorField: "embedding",
  adapter: openaiEmbeddings({
    apiKey: process.env.OPENAI_API_KEY!,
    model: "text-embedding-ada-002",        // optional, default
    dimensions: 1536,                        // optional, default
  }),
});
\`\`\`

Search utilities:

\`\`\`typescript
import { cosineDistance, findNearest, hybridSearch } from "@zauso-ai/capstan-db";

// Find nearest vectors by cosine distance
const results = await findNearest(db, "document", queryVector, { limit: 10 });

// Cosine distance for custom queries
const dist = cosineDistance(vectorA, vectorB);

// Hybrid search: combines vector similarity + full-text keyword matching
const results = await hybridSearch(db, "document", {
  query: "deployment architecture",
  vector: queryVector,
  limit: 10,
});
\`\`\`

## Database Configuration

\`\`\`typescript
// capstan.config.ts
export default defineConfig({
  database: {
    provider: "sqlite",                    // "sqlite" | "postgres" | "mysql" | "libsql"
    url: env("DATABASE_URL") || "./data.db",
    // PostgreSQL: "postgres://user:pass@host:5432/dbname"
    // MySQL: "mysql://user:pass@host:3306/dbname"
    // libSQL/Turso: "libsql://your-db.turso.io?authToken=..."
  },
});
\`\`\`

Install the driver for your provider:
\`\`\`bash
npm install better-sqlite3              # SQLite
npm install pg                          # PostgreSQL
npm install mysql2                      # MySQL
npm install @libsql/client              # libSQL / Turso
\`\`\`

## Querying the Database in Handlers

\`\`\`typescript
// app/db.ts — shared database instance
import { createDatabase } from "@zauso-ai/capstan-db";

const { db, close } = await createDatabase({ provider: "sqlite", url: "./data.db" });
export { db, close };
\`\`\`

\`\`\`typescript
// app/routes/tickets/index.api.ts — using the database in a handler
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";
import { db } from "../../db.js";

export const GET = defineAPI({
  output: z.object({ items: z.array(z.any()) }),
  description: "List all tickets",
  capability: "read",
  async handler({ input, ctx }) {
    // db is a Drizzle ORM instance — use Drizzle query syntax
    // See: https://orm.drizzle.team/docs/select
    return { items: [] };
  },
});
\`\`\`

\`createDatabase()\` is async — it accepts \`{ provider, url }\` and returns \`Promise<{ db, close }>\`.
- \`db\` — a Drizzle ORM instance (SQLite, PostgreSQL, or MySQL depending on provider)
- \`close()\` — closes the underlying connection pool (call on shutdown)

## Policies — Authorization

\`\`\`typescript
// app/policies/index.ts
import { definePolicy } from "@zauso-ai/capstan-core";

// Four possible effects: "allow" | "deny" | "approve" | "redact"

export const requireAuth = definePolicy({
  key: "requireAuth",
  title: "Require Authentication",
  effect: "deny",
  async check({ ctx }) {
    if (!ctx.auth.isAuthenticated) {
      return { effect: "deny", reason: "Authentication required" };
    }
    return { effect: "allow" };
  },
});

export const requireAdmin = definePolicy({
  key: "requireAdmin",
  title: "Require Admin Role",
  effect: "deny",
  async check({ ctx }) {
    if (!ctx.auth.permissions.includes("admin:*")) {
      return { effect: "deny", reason: "Admin access required" };
    }
    return { effect: "allow" };
  },
});

// "approve" effect = human-in-the-loop (agent must wait for approval)
export const requireApproval = definePolicy({
  key: "requireApproval",
  title: "Require Human Approval",
  effect: "approve",
  async check({ ctx, input }) {
    return { effect: "approve", reason: "This action requires human approval" };
  },
});
\`\`\`

Reference in API routes: \`policy: "requireAuth"\` or \`policy: "requireAdmin"\`.

## Static Assets

Place files in \`app/public/\`. They are served at the root URL:

\`\`\`
app/public/logo.png       → GET /logo.png
app/public/js/app.js      → GET /js/app.js
\`\`\`

## CSS & Styling

Place CSS files in \`app/styles/\`. The entry point is \`app/styles/main.css\`.

### Default (Lightning CSS)
Capstan auto-processes CSS with Lightning CSS: \`@import\` resolution, vendor prefixing, CSS nesting, and minification.

### With Tailwind CSS
If \`main.css\` contains \`@import "tailwindcss"\`, Capstan auto-detects and runs the Tailwind CLI:
\`\`\`css
/* app/styles/main.css */
@import "tailwindcss";
\`\`\`
Install Tailwind: \`npm install tailwindcss @tailwindcss/cli\`

### Referencing in layouts
\`\`\`tsx
<link rel="stylesheet" href="/styles.css" precedence="default" />
\`\`\`
React 19 auto-hoists \`<link>\` tags to \`<head>\` and prevents FOUC.

## Auto-generated Endpoints

These are created automatically by the framework:

| Endpoint | Description |
|----------|-------------|
| \`GET /.well-known/capstan.json\` | Agent discovery manifest |
| \`GET /.well-known/agent.json\` | A2A agent card |
| \`POST /.well-known/a2a\` | A2A JSON-RPC handler |
| \`POST /.well-known/mcp\` | MCP Streamable HTTP transport |
| \`GET /openapi.json\` | OpenAPI 3.1 specification |
| \`GET /capstan/approvals\` | List pending approval requests |
| \`POST /capstan/approvals/:id/approve\` | Approve a pending action |
| \`POST /capstan/approvals/:id/deny\` | Deny a pending action |

MCP is available via both **stdio** (\`capstan mcp\`) and **Streamable HTTP** (\`POST /.well-known/mcp\`).

### MCP Client — Consuming External MCP Servers

\`\`\`typescript
import { createMcpClient } from "@zauso-ai/capstan-agent";

const client = createMcpClient({ url: "https://other-service.example.com/.well-known/mcp" });
const tools = await client.listTools();
const result = await client.callTool("toolName", { arg: "value" });
\`\`\`

### LangChain Integration

Convert your CapabilityRegistry into LangChain-compatible tools:

\`\`\`typescript
import { registry } from "@zauso-ai/capstan-agent";

const langchainTools = registry.toLangChain({ baseUrl: "http://localhost:3000" });
// Use with LangChain agents, chains, or other LangChain-compatible tooling
\`\`\`

## OAuth Providers (Social Login)

Capstan includes built-in OAuth helpers for Google and GitHub. \`createOAuthHandlers()\` manages the full authorization code flow: CSRF state, token exchange, user info fetching, and JWT session creation.

\`\`\`typescript
import { googleProvider, githubProvider, createOAuthHandlers } from "@zauso-ai/capstan-auth";

const oauth = createOAuthHandlers({
  providers: [
    googleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    githubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  sessionSecret: process.env.SESSION_SECRET!,
});

// Mount these handlers:
// GET /auth/login/:provider  — redirects to OAuth provider
// GET /auth/callback         — handles callback, creates session, redirects to /
\`\`\`

## Authentication — Advanced

### DPoP Sender-Constrained Tokens (RFC 9449)

Capstan supports DPoP (Demonstrating Proof-of-Possession) for sender-constrained tokens, preventing token theft and replay attacks.

### Agent Workload Identity

For service-to-service authentication, Capstan supports SPIFFE/mTLS via \`X-Client-Cert\` headers:

\`\`\`typescript
// capstan.config.ts
export default defineConfig({
  auth: {
    trustedDomains: ["spiffe://cluster.local/ns/prod/sa/my-service"],
    // mTLS certificates validated via X-Client-Cert header
  },
});
\`\`\`

## Testing

### MCP Test Harness

Test MCP tools in-process without starting a server:

\`\`\`typescript
import { McpTestHarness } from "@zauso-ai/capstan-agent";

const harness = new McpTestHarness(registry);
const result = await harness.callTool("listTickets", { status: "open" });
// Assert against result
\`\`\`

### MCP HTTP Test Client

Test MCP endpoints over HTTP:

\`\`\`typescript
import { McpHttpTestClient } from "@zauso-ai/capstan-agent";

const client = new McpHttpTestClient("http://localhost:3000/.well-known/mcp");
const tools = await client.listTools();
const result = await client.callTool("createTicket", { title: "Bug" });
\`\`\`

### Cross-Protocol Contract Testing

\`capstan verify --json\` includes step 8: **cross-protocol** — validates that HTTP, MCP, A2A, and OpenAPI surfaces all expose consistent schemas and capabilities.

### Semantic Ops Inspection

Capstan also writes structured runtime operations data to \`.capstan/ops/ops.db\`
in development and portable runtime builds. Use the CLI to inspect it:

\`\`\`bash
capstan ops:events
capstan ops:incidents
capstan ops:health
capstan ops:tail
\`\`\`

## Verification — AI TDD Self-Loop

After every code change, run:
\`\`\`bash
capstan verify --json
\`\`\`

Output includes \`repairChecklist\` with:
- \`fixCategory\`: type_error, schema_mismatch, missing_file, policy_violation, contract_drift, missing_export
- \`autoFixable\`: boolean — whether the AI agent can fix it automatically
- \`description\`: what is wrong and how to fix it

The 8-step verification cascade:
1. **structure** — required files exist
2. **config** — capstan.config.ts loads
3. **routes** — API files export handlers, write endpoints have policies
4. **models** — model definitions valid
5. **typecheck** — tsc --noEmit
6. **contracts** — models ↔ routes consistency, policy references valid
7. **manifest** — agent manifest matches live routes
8. **cross-protocol** — HTTP, MCP, A2A, OpenAPI schema consistency

## Production Deployment

\`\`\`bash
capstan build                         # Compiles TS, generates route manifest + deploy-manifest + production server
capstan build --target node-standalone
capstan build --target docker
capstan build --target vercel-node
capstan build --target vercel-edge
capstan build --target cloudflare
capstan build --target fly
capstan deploy:init --target docker  # Generates target-specific deployment files at project root
capstan start                        # Runs the production server from dist/
capstan start --from dist/standalone # Runs the standalone bundle
capstan verify --deployment --target vercel-edge
\`\`\`

Build outputs:
- \`dist/_capstan_server.js\` — production entrypoint
- \`dist/deploy-manifest.json\` — machine-readable deployment contract
- \`dist/public/\` — static assets copied from \`app/public/\`, served at \`/\`
- \`dist/standalone/\` — self-contained deployment directory emitted by explicit deployment targets
- \`dist/standalone/runtime/\` — portable runtime bundle for \`vercel-edge\` and \`cloudflare\`

Environment variables:
- \`PORT\` or \`CAPSTAN_PORT\` — server port (default 3000)
- \`CAPSTAN_HOST\` — bind host (default 0.0.0.0)
- \`DATABASE_URL\` — database connection string
- \`SESSION_SECRET\` — JWT signing secret (required in production)
- \`LOG_LEVEL\` — debug | info | warn | error (default info)

## Conventions & Rules

- API files: \`*.api.ts\` — export \`GET\`, \`POST\`, \`PUT\`, \`DELETE\` (uppercase)
- Page files: \`*.page.tsx\` — export \`default\` React component + optional \`loader\`
- Layout files: \`_layout.tsx\` — export \`default\`, must render \`<Outlet />\`
- Middleware files: \`_middleware.ts\` — export \`default\` from \`defineMiddleware()\`
- Not-found files: \`not-found.tsx\` or \`not-found.page.tsx\` — export a scoped 404 component
- Route groups: directories like \`(marketing)\` are URL-transparent but still affect layout/middleware/loading/error/not-found inheritance
- Model files: \`*.model.ts\` in \`app/models/\`
- Policy files: in \`app/policies/index.ts\`
- All API handlers MUST use \`defineAPI()\` with Zod input/output schemas
- Write endpoints (POST/PUT/DELETE) SHOULD have a \`policy\` reference
- Use \`import type\` for type-only imports (TypeScript strict mode)
- ESM only — use \`.js\` extensions in relative imports
- Run \`capstan verify --json\` after every change to catch issues early

## Plugins

Extend your Capstan app with reusable plugins. Plugins can add routes, policies, and middleware.

\`\`\`typescript
// capstan.config.ts
import { defineConfig } from "@zauso-ai/capstan-core";
import stripePlugin from "capstan-plugin-stripe";

export default defineConfig({
  plugins: [
    stripePlugin({ apiKey: process.env.STRIPE_KEY }),
  ],
});
\`\`\`

### Writing a Plugin

\`\`\`typescript
import { definePlugin } from "@zauso-ai/capstan-core";

export default definePlugin({
  name: "my-plugin",
  version: "1.0.0",
  setup(ctx) {
    // ctx.addRoute(method, path, handler) — register an API route
    // ctx.addPolicy(policy)               — register a policy
    // ctx.addMiddleware(path, middleware)  — register middleware
    // ctx.config                          — read-only app configuration
  },
});
\`\`\`

## WebSocket Support

Use \`defineWebSocket()\` for real-time bidirectional communication and \`WebSocketRoom\` for pub/sub messaging:

\`\`\`typescript
import { defineWebSocket, WebSocketRoom } from "@zauso-ai/capstan-core";

const room = new WebSocketRoom();

export const chat = defineWebSocket("/ws/chat", {
  onOpen(ws)    { room.join(ws); },
  onMessage(ws, msg) { room.broadcast(String(msg), ws); },
  onClose(ws)   { room.leave(ws); },
});
\`\`\`

The handler accepts \`onOpen\`, \`onMessage\`, \`onClose\`, and \`onError\` callbacks. \`WebSocketRoom.broadcast()\` sends to all open clients except an optional excluded client. The Node.js adapter handles upgrades automatically via the \`ws\` package (optional peer dependency).

## Pluggable State Stores (KeyValueStore)

Capstan uses a \`KeyValueStore<T>\` interface for approvals, rate limiting, DPoP replay detection, and audit logging. By default, an in-memory \`MemoryStore\` is used. For production, use the built-in \`RedisStore\` or implement a custom adapter:

\`\`\`typescript
import Redis from "ioredis";
import {
  RedisStore,
  setApprovalStore,
  setRateLimitStore,
  setDpopReplayStore,
  setAuditStore,
} from "@zauso-ai/capstan-core";

const redis = new Redis(process.env.REDIS_URL);

// Replace in-memory stores with Redis-backed stores
setApprovalStore(new RedisStore(redis, "approvals:"));
setRateLimitStore(new RedisStore(redis, "ratelimit:"));
setDpopReplayStore(new RedisStore(redis, "dpop:"));
setAuditStore(new RedisStore(redis, "audit:"));
\`\`\`

\`RedisStore\` uses \`ioredis\` (optional peer dependency), supports TTL-based expiration, and prefixes keys to avoid collisions.

The \`KeyValueStore<T>\` interface:

\`\`\`typescript
interface KeyValueStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}
\`\`\`

## EU AI Act Compliance

Declare compliance metadata and enable automatic audit logging:

\`\`\`typescript
import { defineCompliance } from "@zauso-ai/capstan-core";

defineCompliance({
  riskLevel: "limited",           // "minimal" | "limited" | "high" | "unacceptable"
  auditLog: true,                 // Log every handler invocation automatically
  transparency: {
    description: "AI ticket routing",
    provider: "Acme Corp",
    contact: "compliance@acme.example",
  },
});
\`\`\`

When \`auditLog: true\`, every \`defineAPI()\` handler call is recorded with timestamp, auth context, and I/O summary. Query the log at \`GET /capstan/audit\` or use \`getAuditLog()\` / \`clearAuditLog()\` programmatically.

## LLM Providers

Capstan includes built-in LLM provider adapters with a unified \`LLMProvider\` interface:

\`\`\`typescript
import { openaiProvider, anthropicProvider } from "@zauso-ai/capstan-agent";

// OpenAI (or any OpenAI-compatible API via baseUrl)
const openai = openaiProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o",           // optional, default "gpt-4o"
});

// Anthropic
const claude = anthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: "claude-sonnet-4-20250514", // optional
});

// Chat
const response = await openai.chat([
  { role: "user", content: "Summarize this ticket" },
], { temperature: 0.3, maxTokens: 500 });
// response.content, response.model, response.usage

// Streaming (OpenAI provider supports stream())
for await (const chunk of openai.stream!([
  { role: "user", content: "Write a summary" },
])) {
  process.stdout.write(chunk.content);
  if (chunk.done) break;
}
\`\`\`

Options: \`model\`, \`temperature\`, \`maxTokens\`, \`systemPrompt\`, \`responseFormat\` (structured output).

## AI Toolkit (@zauso-ai/capstan-ai)

Standalone AI agent toolkit — works independently OR with Capstan. Install separately:

\`\`\`bash
npm install @zauso-ai/capstan-ai
\`\`\`

### Standalone Usage (no Capstan required)

\`\`\`typescript
import { createAI } from "@zauso-ai/capstan-ai";
import { openaiProvider } from "@zauso-ai/capstan-agent";

const ai = createAI({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});

// Structured reasoning — returns typed result matching Zod schema
const analysis = await ai.think("Classify this ticket: 'Payment failed'", {
  schema: z.object({
    category: z.enum(["billing", "technical", "account"]),
    priority: z.enum(["low", "medium", "high"]),
  }),
});

// Text generation
const summary = await ai.generate("Summarize this in 3 bullets...");

// Streaming variants
for await (const chunk of ai.generateStream("Write a report...")) {
  process.stdout.write(chunk);
}
\`\`\`

### Memory (remember / recall)

\`\`\`typescript
// Store memories (auto-dedup: >0.92 cosine similarity → merge)
await ai.remember("Customer prefers email communication");

// Retrieve relevant memories (hybrid: vector 0.7 + keyword 0.3 + recency)
const memories = await ai.recall("contact preferences");

// Scoped memory — isolate per entity
const customerMem = ai.memory.about("customer", "cust_123");
await customerMem.remember("VIP since 2022");
const relevant = await customerMem.recall("status");

// Build LLM context from memories
const context = await ai.memory.assembleContext({
  query: "customer preferences",
  maxTokens: 2000,
});

// Delete a memory
await ai.memory.forget(memoryId);
\`\`\`

### Agent Loop (self-orchestrating)

\`\`\`typescript
const result = await ai.agent.run({
  goal: "Research customer issues and draft a response",
  about: ["customer", "cust_123"],
  tools: [searchTickets, getHistory],
  beforeToolCall: async (tool, args) => {
    // Policy/approval hook — return false to block
    return true;
  },
});
// result.success, result.result, result.iterations, result.callStack
\`\`\`

### Agent Harness Mode

\`\`\`typescript
import { createHarness } from "@zauso-ai/capstan-ai";

const harness = await createHarness({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  sandbox: {
    browser: { engine: "camoufox", platform: "jd", accountId: "price-monitor-01" },
    fs: { rootDir: "./workspace" },
  },
  verify: { enabled: true },
});

const result = await harness.run({
  goal: "Open the storefront, inspect prices, and save a report to workspace/report.md",
});

await harness.destroy();
\`\`\`

### Scheduled Agent Runs

\`\`\`typescript
import { createCronRunner, createAgentCron } from "@zauso-ai/capstan-cron";
import { createHarness } from "@zauso-ai/capstan-ai";

const harness = await createHarness({
  llm: openaiProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  sandbox: {
    browser: { engine: "camoufox", platform: "jd", accountId: "price-monitor-01" },
    fs: { rootDir: "./workspace" },
  },
});

const runner = createCronRunner();

runner.add(createAgentCron({
  cron: "0 */2 * * *",
  name: "price-monitor",
  goal: "Refresh the pricing report",
  runtime: {
    harness,
  },
}));

runner.start();
\`\`\`

### Using in Capstan Handlers

\`\`\`typescript
export const POST = defineAPI({
  // ...
  async handler({ input, ctx }) {
    const analysis = await ctx.think(input.message, {
      schema: z.object({ intent: z.string(), confidence: z.number() }),
    });
    await ctx.remember(\`User asked about: \${analysis.intent}\`);
    const history = await ctx.recall(input.message);
    return { analysis, relatedHistory: history };
  },
});
\`\`\`

### Memory Backend

The default \`BuiltinMemoryBackend\` stores in memory. For production, implement the \`MemoryBackend\` interface for Mem0, Hindsight, Redis, or any custom store.

## Build Pipeline (Optional Vite Integration)

Capstan optionally integrates with Vite for client-side code splitting and HMR. Install \`vite\` as a peer dependency to enable:

\`\`\`bash
npm install vite
\`\`\`

\`\`\`typescript
import { createViteConfig, buildClient } from "@zauso-ai/capstan-dev";

// Generate Vite config
const config = createViteConfig({ rootDir: ".", isDev: false });

// Production build
await buildClient({ rootDir: ".", isDev: false });
\`\`\`

If Vite is not installed, these functions gracefully skip without errors.

## Deployment Adapters

Capstan provides production-ready deployment adapters for major platforms:

### Cloudflare Workers
\`\`\`typescript
import { createCloudflareHandler, generateWranglerConfig } from "@zauso-ai/capstan-dev";

// Worker entry
export default createCloudflareHandler(app);

// Generate wrangler.toml
const toml = generateWranglerConfig("my-app");
\`\`\`

### Vercel
\`\`\`typescript
import { createVercelHandler, createVercelNodeHandler } from "@zauso-ai/capstan-dev";

// Edge Function
export default createVercelHandler(app);

// Node.js Serverless Function
export default createVercelNodeHandler(app);
\`\`\`

### Fly.io (with Write Replay)
\`\`\`typescript
import { createFlyAdapter } from "@zauso-ai/capstan-dev";

const adapter = createFlyAdapter({
  primaryRegion: "iad",
  replayWrites: true,  // Mutating requests replay to primary region
});
\`\`\`

### ClientOnly and serverOnly()

In addition to \`ServerOnly\`, Capstan provides:

\`\`\`typescript
import { ClientOnly, serverOnly } from "@zauso-ai/capstan-react";

// ClientOnly — renders children only in browser, shows fallback during SSR
<ClientOnly fallback={<p>Loading...</p>}>
  <InteractiveWidget />
</ClientOnly>

// serverOnly() — guard that throws if imported in client code
serverOnly(); // place at top of server-only modules
\`\`\`

## Image & Font Optimization

\`\`\`typescript
import { Image, defineFont, fontPreloadLink } from "@zauso-ai/capstan-react";

// Optimized image: responsive srcset, lazy loading, blur-up placeholder
<Image src="/hero.jpg" alt="Hero" width={1200} priority placeholder="blur" />

// Font: returns className + style + CSS variable
const inter = defineFont({ family: "Inter", src: "/fonts/inter.woff2", display: "swap" });
// inter.className, inter.style, inter.variable

// Preload link for <head>
fontPreloadLink({ family: "Inter", src: "/fonts/inter.woff2" })
\`\`\`

## Metadata (SEO, OpenGraph, Twitter Cards)

\`\`\`typescript
import { defineMetadata, mergeMetadata } from "@zauso-ai/capstan-react";

export const metadata = defineMetadata({
  title: { default: "My App", template: "%s | My App" },
  description: "Built with Capstan",
  openGraph: { title: "My App", image: "/og.png" },
  twitter: { card: "summary_large_image" },
});

// Export from a page or layout and Capstan injects the resolved tags into
// <head> during SSR. Client-side navigations keep the managed tags in sync.

// Merge parent + child metadata manually when you need custom composition:
const merged = mergeMetadata(parentMetadata, childMetadata);
\`\`\`

## Error Boundaries

\`\`\`typescript
import { ErrorBoundary, NotFound } from "@zauso-ai/capstan-react";

// Wrap components to catch render errors with reset support:
<ErrorBoundary fallback={(error, reset) => (
  <div>
    <p>Error: {error.message}</p>
    <button onClick={reset}>Retry</button>
  </div>
)}>
  <MyComponent />
</ErrorBoundary>

// Pre-built 404 component:
<NotFound />
\`\`\`

## Response Cache

The response cache stores full-page HTML output for ISR render strategies. It is separate from the data cache but shares cross-invalidation.

\`\`\`typescript
import {
  responseCacheGet, responseCacheSet, responseCacheInvalidateTag,
  responseCacheInvalidate, responseCacheClear, setResponseCacheStore,
} from "@zauso-ai/capstan-core";

// Retrieve cached response (includes staleness check)
const result = await responseCacheGet("/blog");
if (result) {
  const { entry, stale } = result;
  // entry: { html, headers, statusCode, createdAt, revalidateAfter, tags }
}

// Store a page response with tags
await responseCacheSet("/blog", {
  html, headers: {}, statusCode: 200,
  createdAt: Date.now(), revalidateAfter: Date.now() + 60000,
  tags: ["blog"],
});

// Cross-invalidation: cacheInvalidateTag() also evicts response cache
await cacheInvalidateTag("blog"); // clears BOTH data cache + response cache entries

// For production, swap the store (default is in-memory):
setResponseCacheStore(new RedisStore(redis, "resp:"));
\`\`\`

## Cache Layer (ISR)

\`\`\`typescript
import { cacheSet, cacheGet, cacheInvalidateTag, cached } from "@zauso-ai/capstan-core";

// Cache with TTL + tags
await cacheSet("user:123", userData, { ttl: 300, tags: ["users"] });
const data = await cacheGet("user:123");

// Stale-while-revalidate decorator
const getUsers = cached(async () => fetchUsers(), { ttl: 60, tags: ["users"] });

// Bulk invalidation by tag
await cacheInvalidateTag("users");
\`\`\`

## Client-Side Router

Capstan includes a built-in SPA router. Import from \`@zauso-ai/capstan-react/client\`:

\`\`\`typescript
import { Link, useNavigate, useRouterState, bootstrapClient } from "@zauso-ai/capstan-react/client";
\`\`\`

### Link Component

\`<Link>\` renders a standard \`<a>\` that works without JavaScript. When the router is active, clicks are intercepted for instant SPA transitions.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| \`href\` | \`string\` | — | Target URL (required) |
| \`prefetch\` | \`"none" \\| "hover" \\| "viewport"\` | \`"hover"\` | When to prefetch the target page |
| \`replace\` | \`boolean\` | \`false\` | Replace history entry instead of push |
| \`scroll\` | \`boolean\` | \`true\` | Scroll to top after navigation |

Plus all standard HTML anchor attributes.

### Programmatic Navigation

\`\`\`typescript
const navigate = useNavigate();
navigate("/dashboard");
navigate("/settings", { replace: true, scroll: false });

const { url, status, error } = useRouterState();
// status: "idle" | "loading" | "error"
\`\`\`

### Bootstrap

Call \`bootstrapClient()\` once at page load. It reads \`window.__CAPSTAN_MANIFEST__\`, initializes the router, and sets up global \`<a>\` click delegation. All internal links get SPA navigation automatically.

To opt out for specific links, add \`data-capstan-external\`:

\`\`\`html
<a href="/legacy" data-capstan-external>Full reload</a>
\`\`\`

View Transitions (\`document.startViewTransition()\`) are applied automatically when the browser supports them.
`;
}

export function agentsMd(
  projectName: string,
  template: "blank" | "tickets",
): string {
  const templateNotes = template === "tickets"
    ? `
## Template Notes

This app was scaffolded from the **tickets** template.

Use these files as the canonical Capstan examples before inventing a new pattern:
- \`app/models/ticket.model.ts\` — reference data model
- \`app/routes/tickets/index.api.ts\` — list + create route pair
- \`app/routes/tickets/[id].api.ts\` — dynamic route params and record fetch

If you need to add another resource, copy the shape of the tickets flow first.
`
    : `
## Template Notes

This app was scaffolded from the **blank** template.

Treat the generated files as the minimum Capstan slice:
- \`app/routes/index.page.tsx\` — first page route
- \`app/routes/api/health.api.ts\` — smallest complete \`defineAPI()\` example
- \`app/policies/index.ts\` — where reusable policies should live
`;

  return `# AGENTS.md — Capstan Operating Guide

This project was scaffolded by Capstan for **${projectName}**.

Use this file as the default playbook for coding agents. Favor Capstan's explicit
golden path over custom abstractions unless the task clearly requires it.

## Start Here

Read these files first, in order:
1. \`capstan.config.ts\`
2. \`app/routes/\`
3. \`AGENTS.md\`

Then use this loop:
1. Run \`capstan dev\`
2. Make the smallest explicit change
3. Verify with \`capstan verify --json\`
4. Finish with \`capstan build\`

## What Capstan Means

Capstan is **file-based, multi-surface, and machine-readable**.

- A route file defines the product surface.
- A single \`defineAPI()\` becomes **HTTP + MCP + A2A + OpenAPI**.
- Page loaders run on the server and should call internal APIs through loader \`fetch\`, not by hard-coding localhost HTTP calls.
- \`app/public/\` is served from the root URL path, so \`app/public/logo.svg\` becomes \`/logo.svg\`.
- \`dist/deploy-manifest.json\` is the deployment contract after build.

When a user asks for a feature, think in this order:
1. Which route or page owns the behavior?
2. Does it need a model?
3. Does it need a policy?
4. How will it be verified?
5. What agent-visible surface changes automatically because of Capstan?

## Project Map

\`\`\`
app/
  routes/              # File-based routing and page boundaries
    *.api.ts           # API handlers created with defineAPI()
    *.page.tsx         # Pages + optional loader()
    _layout.tsx        # Shared layout wrapper
    _middleware.ts     # Route-scoped middleware
    _loading.tsx       # Route-scoped loading boundary
    _error.tsx         # Route-scoped error boundary
    not-found.tsx      # Route-scoped 404 fallback
    (group)/           # Route group, not part of the URL
    [id]/              # Dynamic segment
    [...rest]/         # Catch-all segment
  models/              # defineModel() files
  policies/            # definePolicy() files
  migrations/          # SQL migrations
  public/              # Static assets, served from /
capstan.config.ts      # App config, providers, metadata
\`\`\`
${templateNotes}
## Commands Agents Should Reach For

\`\`\`bash
capstan dev
capstan build
capstan start
capstan verify --json
capstan add api <name>
capstan add page <name>
capstan add model <name>
capstan add policy <name>
capstan db:migrate
capstan db:push
capstan db:status
capstan ops:health
capstan build --target node-standalone
capstan verify --deployment --target <target>
\`\`\`

## Golden Paths

### Add an API route

Prefer scaffolding first:

\`\`\`bash
capstan add api orders
\`\`\`

Then shape the route around \`defineAPI()\`:

\`\`\`typescript
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  input: z.object({
    status: z.string().optional(),
  }),
  output: z.object({
    items: z.array(z.object({ id: z.string(), title: z.string() })),
  }),
  description: "List orders",
  capability: "read",
  resource: "order",
  async handler({ input, params, ctx }) {
    return { items: [] };
  },
});
\`\`\`

Always set:
- \`input\` and \`output\` when the route has a stable contract
- \`description\`
- \`capability\`
- \`resource\`

Add \`policy\` for write flows or protected reads.

### Add a page route

Prefer scaffolding first:

\`\`\`bash
capstan add page dashboard
\`\`\`

When the page needs data, use a loader and in-process fetch:

\`\`\`typescript
import { useLoaderData } from "@zauso-ai/capstan-react";

export async function loader({ fetch }) {
  return fetch.get("/api/orders");
}

export default function DashboardPage() {
  const data = useLoaderData<typeof loader>();
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
\`\`\`

Use directory boundaries instead of ad hoc conditionals:
- \`_layout.tsx\` for shared UI shell
- \`_loading.tsx\` for suspense fallback
- \`_error.tsx\` for scoped error UI
- \`not-found.tsx\` for scoped 404 behavior

### Add a model

If the feature needs durable data:
1. Create or scaffold a model in \`app/models/\`
2. Run \`capstan db:migrate\`
3. Apply with \`capstan db:push\`
4. Update the route handler or page loader that consumes the data

Use \`defineModel()\` as the default path. Keep fields explicit and predictable.

### Add a policy

Policies live in \`app/policies/\` and are referenced by key from \`defineAPI()\`.

\`\`\`typescript
import { definePolicy } from "@zauso-ai/capstan-core";

export const requireAuth = definePolicy({
  key: "requireAuth",
  title: "Require Authentication",
  effect: "deny",
  async check({ ctx }) {
    return ctx.auth.isAuthenticated
      ? { effect: "allow" }
      : { effect: "deny", reason: "Authentication required" };
  },
});
\`\`\`

## Verification Checklist

Before you call work done, try to cover the narrowest useful set of checks:

### For route or page changes

\`\`\`bash
capstan dev
capstan verify --json
capstan build
\`\`\`

### For model changes

\`\`\`bash
capstan db:migrate
capstan db:status
capstan db:push
\`\`\`

### For deployment-sensitive changes

\`\`\`bash
capstan build --target node-standalone
capstan verify --deployment --target node-standalone
\`\`\`

## Common Mistakes

Avoid these mistakes unless there is a strong reason:

- Do not hand-edit \`dist/\`
- Do not bypass \`capstan add\` if a scaffold command already exists
- Do not forget \`description\`, \`capability\`, or \`resource\` on \`defineAPI()\`
- Do not use external HTTP calls from page loaders when loader \`fetch\` can call internal APIs directly
- Do not put static assets under \`/public/...\` in links; use root paths like \`/logo.svg\`
- Do not rename route files casually; filenames are the routing contract
- Do not add write endpoints without thinking through policy and verification

## Capstan File Conventions That Matter

- \`app/routes/orders/index.api.ts\` -> \`/orders\`
- \`app/routes/orders/[id].api.ts\` -> \`/orders/:id\`
- \`app/routes/orders/index.page.tsx\` -> page route
- \`app/routes/(ops)/dashboard.page.tsx\` -> route group omitted from URL
- \`_layout.tsx\`, \`_middleware.ts\`, \`_loading.tsx\`, \`_error.tsx\`, and \`not-found.tsx\` all inherit by directory scope

## For Coding Agents Working In This App

Optimize for these behaviors:

- Prefer one obvious Capstan-native implementation path
- Keep machine-readable contracts explicit
- Keep routing, policy, and deployment behavior deterministic
- Use the generated examples as reference before introducing a new pattern
- Explain changes in terms of routes, surfaces, policies, models, and verification

If a user asks for "an API", remember Capstan may also change:
- agent manifest
- MCP surface
- A2A surface
- OpenAPI output

If a user asks for "a page", remember to check:
- layout scope
- loading/error/not-found boundaries
- loader data flow
- hydration mode or render mode only if they actually matter

## Good First Files To Edit

- \`app/routes/index.page.tsx\`
- \`app/routes/api/health.api.ts\`
- \`app/styles/main.css\`
- \`capstan.config.ts\`

Keep this file aligned with the project as the app grows.
`;
}

// ---------------------------------------------------------------------------
// Tickets template extras
// ---------------------------------------------------------------------------

export function ticketModel(): string {
  return `import { defineModel, field, relation } from "@zauso-ai/capstan-db";

export const Ticket = defineModel("ticket", {
  fields: {
    id: field.id(),
    title: field.string({ required: true, min: 1, max: 200 }),
    description: field.text(),
    status: field.enum(["open", "in_progress", "closed"], { default: "open" }),
    priority: field.enum(["low", "medium", "high"], { default: "medium" }),
    createdAt: field.datetime({ default: "now" }),
    updatedAt: field.datetime({ updatedAt: true }),
  },
});
`;
}

export function ticketsIndexApi(): string {
  return `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const meta = {
  resource: "ticket",
  description: "Manage support tickets",
};

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
  async handler({ input }) {
    // TODO: Replace with real database query
    return {
      tickets: [
        { id: "1", title: "Example ticket", status: "open", priority: "medium" },
      ],
    };
  },
});

export const POST = defineAPI({
  input: z.object({
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
  }),
  output: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    priority: z.string(),
  }),
  description: "Create a new ticket",
  capability: "write",
  resource: "ticket",
  policy: "requireAuth",
  async handler({ input }) {
    // TODO: Replace with real database insert
    return {
      id: crypto.randomUUID(),
      title: input.title,
      status: "open",
      priority: input.priority,
    };
  },
});
`;
}

export function ticketByIdApi(): string {
  return `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const meta = {
  resource: "ticket",
  description: "Manage a specific ticket",
};

export const GET = defineAPI({
  output: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.string(),
    priority: z.string(),
  }),
  description: "Get a ticket by ID",
  capability: "read",
  resource: "ticket",
  async handler({ ctx }) {
    // TODO: Replace with real database query
    return {
      id: "1",
      title: "Example ticket",
      description: "This is an example",
      status: "open",
      priority: "medium",
    };
  },
});
`;
}

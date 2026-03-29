// ---------------------------------------------------------------------------
// Template strings for generated Capstan projects
// ---------------------------------------------------------------------------

export function packageJson(
  projectName: string,
  template: "blank" | "tickets" = "blank",
): string {
  const deps: Record<string, string> = {
    "@zauso-ai/capstan-cli": "^0.2.0",
    "@zauso-ai/capstan-core": "^0.2.0",
    "@zauso-ai/capstan-dev": "^0.2.0",
    "@zauso-ai/capstan-react": "^0.2.0",
    "@zauso-ai/capstan-router": "^0.2.0",
    zod: "^3.23.0",
  };

  // Only include capstan-db for templates that actually use it (native dep
  // issues with better-sqlite3 make it a poor default).
  if (template === "tickets") {
    deps["@zauso-ai/capstan-auth"] = "^0.2.0";
    deps["@zauso-ai/capstan-db"] = "^0.2.0";
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
        start: "capstan start",
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
      secret: env("SESSION_SECRET") || "dev-secret-change-in-production",
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
        <title>${title}</title>
      </head>
      <body>
        <Outlet />
      </body>
    </html>
  );
}
`;
}

export function indexPage(title: string): string {
  return `export default function HomePage() {
  return (
    <main>
      <h1>Welcome to ${title}</h1>
      <p>Built with Capstan — the AI Agent Native full-stack framework.</p>
      <nav>
        <ul>
          <li><a href="/.well-known/capstan.json">Agent Manifest</a></li>
          <li><a href="/openapi.json">OpenAPI Spec</a></li>
          <li><a href="/health">Health Check</a></li>
        </ul>
      </nav>
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

// ---------------------------------------------------------------------------
// AGENTS.md
// ---------------------------------------------------------------------------

export function agentsMd(
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

  return `# AGENTS.md — AI Coding Guide

This file helps AI coding agents (Claude Code, Cursor, etc.) work efficiently in this Capstan project.

## Project: ${projectName}

## Project Structure

\`\`\`
app/
  routes/          — File-based routing
    *.api.ts       — API handlers (GET, POST, PUT, DELETE exports)
    *.page.tsx     — React pages with SSR
    _layout.tsx    — Layout wrappers
    _middleware.ts — Middleware
    [param]/       — Dynamic route segments
  models/          — Data model definitions
  policies/        — Permission policies
  migrations/      — Database migrations
capstan.config.ts  — Framework configuration
\`\`\`
${ticketsNote}
## Adding a New Feature

### 1. Add a model
\`\`\`bash
capstan add model <name>
\`\`\`
Or manually create \`app/models/<name>.model.ts\`:
\`\`\`typescript
import { defineModel, field } from "@zauso-ai/capstan-db";
export const MyModel = defineModel("<name>", {
  fields: {
    id: field.id(),
    title: field.string({ required: true }),
    createdAt: field.datetime({ default: "now" }),
  },
});
\`\`\`

### 2. Add API routes
\`\`\`bash
capstan add api <name>
\`\`\`
Or manually create \`app/routes/<name>/index.api.ts\`:
\`\`\`typescript
import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const meta = { resource: "<name>", description: "..." };

export const GET = defineAPI({
  output: z.object({ items: z.array(z.object({ id: z.string() })) }),
  description: "List items",
  capability: "read",
  resource: "<name>",
  async handler({ input, ctx }) {
    return { items: [] };
  },
});

export const POST = defineAPI({
  input: z.object({ title: z.string().min(1) }),
  output: z.object({ id: z.string() }),
  description: "Create item",
  capability: "write",
  resource: "<name>",
  policy: "requireAuth",
  async handler({ input, ctx }) {
    return { id: crypto.randomUUID() };
  },
});
\`\`\`

### 3. Add a page (optional)
\`\`\`bash
capstan add page <name>
\`\`\`
Or create \`app/routes/<name>/index.page.tsx\` with a React component.

### 4. Add a policy (if needed)
\`\`\`bash
capstan add policy <name>
\`\`\`
Or add to \`app/policies/index.ts\`:
\`\`\`typescript
export const myPolicy = definePolicy({
  key: "myPolicy",
  title: "My Policy",
  effect: "deny",
  async check({ ctx }) {
    // your logic
    return { effect: "allow" };
  },
});
\`\`\`

## Verification (TDD Loop)
\`\`\`bash
capstan verify --json    # Structured diagnostics for AI consumption
\`\`\`
The verify command checks: types, schemas, policies, routes, contracts.
AI agents should run this after every change and fix any reported issues.

## Key Commands
\`\`\`bash
capstan dev              # Start dev server
capstan verify --json    # Verify everything, output JSON for AI
capstan add model <n>    # Scaffold a model
capstan add api <n>      # Scaffold API routes
capstan add page <n>     # Scaffold a page
capstan add policy <n>   # Scaffold a policy
\`\`\`

## Agent API Endpoints (auto-generated)
- \`GET /.well-known/capstan.json\` — Agent manifest
- \`GET /openapi.json\` — OpenAPI 3.1 spec
- \`MCP\` — via \`capstan mcp\` (stdio transport)

## Conventions
- API files: \`*.api.ts\` export HTTP methods (GET, POST, PUT, DELETE)
- Page files: \`*.page.tsx\` export default React component
- All API handlers use \`defineAPI()\` with Zod schemas
- Write endpoints should have a \`policy\` reference
- Models go in \`app/models/\`, policies in \`app/policies/\`
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

import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function GettingStarted() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "Getting Started"),

    // Prerequisites
    createElement("h2", null, "Prerequisites"),
    createElement("ul", null,
      createElement("li", null,
        createElement("strong", null, "Node.js 20+"),
        " (ES2022 target, ESM-only)"
      ),
      createElement("li", null,
        createElement("strong", null, "npm"),
        " (ships with Node.js)"
      )
    ),
    createElement("p", null, "Optional, depending on your database provider:"),
    createElement("ul", null,
      createElement("li", null,
        createElement("code", null, "better-sqlite3"),
        " requires a C++ build toolchain (node-gyp) for SQLite"
      ),
      createElement("li", null,
        createElement("code", null, "pg"),
        " for PostgreSQL"
      ),
      createElement("li", null,
        createElement("code", null, "mysql2"),
        " for MySQL"
      )
    ),

    // Quick Start
    createElement("h2", null, "Quick Start"),
    createElement("p", null,
      "Capstan is currently published on npm's ",
      createElement("code", null, "beta"),
      " tag. Scaffold a new project with:"
    ),
    createElement("pre", null,
      createElement("code", null,
`npx create-capstan-app@beta my-app --template blank
cd my-app
npm install
npx capstan dev`
      )
    ),
    createElement("p", null, "Your dev server is now running at ",
      createElement("code", null, "http://localhost:3000"),
      "."
    ),

    // Templates
    createElement("h2", null, "Templates"),
    createElement("p", null,
      "The ", createElement("code", null, "create-capstan-app"),
      " scaffolder supports two templates. You can also run the scaffolder interactively (no arguments) and it will prompt for a project name and template."
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Template"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "blank")),
          createElement("td", null, "Minimal project with a health check API and home page")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "tickets")),
          createElement("td", null, "Full-featured example with a Ticket model, CRUD API routes, and auth policy")
        )
      )
    ),

    // Project Structure
    createElement("h2", null, "Project Structure"),
    createElement("p", null, "After scaffolding, your project looks like this:"),
    createElement("pre", null,
      createElement("code", null,
`my-app/
  app/
    routes/
      _layout.tsx          # Root layout (wraps all pages)
      index.page.tsx       # Home page
      api/
        health.api.ts      # Health check endpoint
    models/                # Data model definitions
    styles/
      main.css             # CSS entry point (Lightning CSS or Tailwind)
    migrations/            # Database migration files
    policies/
      index.ts             # Permission policies (requireAuth)
  capstan.config.ts        # Framework configuration
  package.json
  tsconfig.json
  AGENTS.md                # AI coding agent guide
  .gitignore`
      )
    ),

    // File Naming Conventions
    createElement("h2", null, "File Naming Conventions"),
    createElement("p", null, "Capstan uses file suffixes and special prefixes to determine how each file is treated:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Pattern"),
          createElement("th", null, "Purpose")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "*.api.ts")),
          createElement("td", null, "API route handler")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "*.page.tsx")),
          createElement("td", null, "React page component (SSR)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "_layout.tsx")),
          createElement("td", null, "Layout wrapper (nests via Outlet)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "_middleware.ts")),
          createElement("td", null, "Middleware (runs before handlers)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "_loading.tsx")),
          createElement("td", null, "Suspense fallback for pages")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "_error.tsx")),
          createElement("td", null, "Error boundary for pages")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "[param].api.ts")),
          createElement("td", null, "Dynamic route segment")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "[...catchAll].api.ts")),
          createElement("td", null, "Catch-all route segment")
        )
      )
    ),

    // Dev Server
    createElement("h2", null, "Dev Server"),
    createElement("pre", null,
      createElement("code", null, "npx capstan dev")
    ),
    createElement("p", null, "The dev server starts on ",
      createElement("code", null, "http://localhost:3000"),
      " by default and provides:"
    ),
    createElement("ul", null,
      createElement("li", null, "Hot route reloading (file watcher rebuilds routes on change)"),
      createElement("li", null, "Live reload via SSE (browser pages refresh automatically)"),
      createElement("li", null, "Static file serving from ", createElement("code", null, "app/public/")),
      createElement("li", null, "All multi-protocol agent endpoints (MCP, A2A, OpenAPI)")
    ),
    createElement("p", null, "To use a different port:"),
    createElement("pre", null,
      createElement("code", null, "npx capstan dev --port 4000")
    ),

    // First API Endpoint
    createElement("h2", null, "Your First API Endpoint"),
    createElement("p", null, "Create a file at ", createElement("code", null, "app/routes/api/greet.api.ts"), ":"),
    createElement("pre", null,
      createElement("code", null,
`import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const GET = defineAPI({
  input: z.object({
    name: z.string().optional(),
  }),
  output: z.object({
    message: z.string(),
  }),
  description: "Greet a user by name",
  capability: "read",
  async handler({ input }) {
    const name = input.name ?? "world";
    return { message: \`Hello, \${name}!\` };
  },
});

export const POST = defineAPI({
  input: z.object({
    name: z.string().min(1),
  }),
  output: z.object({
    message: z.string(),
    timestamp: z.string(),
  }),
  description: "Create a personalized greeting",
  capability: "write",
  policy: "requireAuth",
  async handler({ input }) {
    return {
      message: \`Hello, \${input.name}!\`,
      timestamp: new Date().toISOString(),
    };
  },
});`
      )
    ),
    createElement("p", null,
      "Each exported constant (", createElement("code", null, "GET"), ", ",
      createElement("code", null, "POST"), ", ", createElement("code", null, "PUT"), ", ",
      createElement("code", null, "DELETE"), ", ", createElement("code", null, "PATCH"),
      ") maps to the corresponding HTTP method. The ", createElement("code", null, "defineAPI()"),
      " wrapper provides:"
    ),
    createElement("ul", null,
      createElement("li", null,
        createElement("strong", null, "Input validation"),
        " via Zod schemas (automatic 400 errors on invalid input)"
      ),
      createElement("li", null,
        createElement("strong", null, "Output validation"),
        " via Zod schemas"
      ),
      createElement("li", null,
        createElement("strong", null, "Agent introspection"),
        " -- the schema metadata is projected to MCP tools, A2A skills, and OpenAPI specs"
      )
    ),
    createElement("p", null, "Test your endpoint:"),
    createElement("pre", null,
      createElement("code", null,
`# GET request
curl http://localhost:3000/api/greet?name=Alice

# POST request
curl -X POST http://localhost:3000/api/greet \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Alice"}'`
      )
    ),

    // Auto-Generated Agent Endpoints
    createElement("h2", null, "Auto-Generated Agent Endpoints"),
    createElement("p", null, "Once your dev server is running, these endpoints are automatically available:"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Endpoint"),
          createElement("th", null, "Protocol"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "GET /.well-known/capstan.json")),
          createElement("td", null, "Capstan"),
          createElement("td", null, "Agent manifest describing all routes, schemas, capabilities, and policies")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "GET /openapi.json")),
          createElement("td", null, "OpenAPI"),
          createElement("td", null, "Full OpenAPI 3.1.0 specification generated from your defineAPI() definitions")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "GET /.well-known/agent.json")),
          createElement("td", null, "A2A"),
          createElement("td", null, "Google Agent-to-Agent protocol agent card listing all skills")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "POST /.well-known/a2a")),
          createElement("td", null, "A2A"),
          createElement("td", null, "JSON-RPC endpoint for A2A protocol (tasks/send, tasks/get, agent/card)")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "npx capstan mcp")),
          createElement("td", null, "MCP"),
          createElement("td", null, "Starts MCP server over stdio for Claude Desktop, Cursor, or any MCP client")
        )
      )
    ),

    createElement("h3", null, "Approval Workflow"),
    createElement("p", null,
      "When an API route's policy evaluates to ", createElement("code", null, '"approve"'),
      ", the request is held for human review:"
    ),
    createElement("pre", null,
      createElement("code", null,
`GET  /capstan/approvals        # List pending approvals
GET  /capstan/approvals/:id     # Get approval status
POST /capstan/approvals/:id     # Approve or deny`
      )
    ),

    // CLI Commands
    createElement("h2", null, "CLI Commands"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Command"),
          createElement("th", null, "Description")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan dev")),
          createElement("td", null, "Start development server with hot reload")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan build")),
          createElement("td", null, "Build for production")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan start")),
          createElement("td", null, "Start production server")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan mcp")),
          createElement("td", null, "Start MCP server over stdio")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan verify")),
          createElement("td", null, "Run the verification cascade")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan db:migrate")),
          createElement("td", null, "Generate a new migration from model changes")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan db:push")),
          createElement("td", null, "Apply pending migrations directly")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan db:status")),
          createElement("td", null, "Show migration status")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan add api <name>")),
          createElement("td", null, "Scaffold a new API route")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan add page <name>")),
          createElement("td", null, "Scaffold a new React page")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan add model <name>")),
          createElement("td", null, "Scaffold a new database model")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "capstan deploy:init --target <target>")),
          createElement("td", null, "Generate deployment files for a target platform")
        )
      )
    ),

    createElement("div", { className: "callout callout-tip" },
      createElement("strong", null, "Tip: "),
      "Use ", createElement("code", null, "<Link>"), " from ",
      createElement("code", null, "@zauso-ai/capstan-react/client"),
      " instead of plain ", createElement("code", null, "<a>"),
      " tags for client-side navigation with automatic prefetching and SPA transitions."
    )
  );
}

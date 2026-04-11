import { createElement } from "react";
import DocsLayout from "../../components/DocsLayout.js";

export default function DeploymentPage() {
  return createElement(DocsLayout, null,

    createElement("h1", null, "Deployment"),
    createElement("p", null,
      "Capstan applications compile to portable bundles that run on Node.js, Docker, serverless platforms, and edge runtimes."
    ),

    // Build Command
    createElement("h2", null, "Build Command"),
    createElement("pre", null,
      createElement("code", null, "npx capstan build")
    ),
    createElement("p", null,
      "The ", createElement("code", null, "build"),
      " command compiles your TypeScript source into JavaScript ready for production. It runs ",
      createElement("code", null, "tsc"), " to compile all files in ",
      createElement("code", null, "app/"), " and ",
      createElement("code", null, "capstan.config.ts"),
      ". Output goes to the ", createElement("code", null, "dist/"),
      " directory as ESM with ", createElement("code", null, ".js"), " extensions."
    ),

    // Build Output
    createElement("h2", null, "Build Output"),
    createElement("p", null, "After a successful build, Capstan writes a deterministic deployment contract to ", createElement("code", null, "dist/"), ":"),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "File"),
          createElement("th", null, "Purpose")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "dist/_capstan_server.js")),
          createElement("td", null, "Production server entrypoint used by ", createElement("code", null, "capstan start"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "dist/_capstan_manifest.json")),
          createElement("td", null, "Compiled route manifest")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "dist/agent-manifest.json")),
          createElement("td", null, "Agent manifest projection")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "dist/openapi.json")),
          createElement("td", null, "OpenAPI projection")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "dist/deploy-manifest.json")),
          createElement("td", null, "Machine-readable deployment contract for tooling and CI")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "dist/public/")),
          createElement("td", null, "Static assets copied from ", createElement("code", null, "app/public/"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "dist/static/")),
          createElement("td", null, "Pre-rendered SSG output when using ", createElement("code", null, "capstan build --static"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "dist/standalone/")),
          createElement("td", null, "Self-contained deployment directory when using an explicit deployment target")
        )
      )
    ),

    // Build Targets
    createElement("h2", null, "Build Targets"),
    createElement("p", null,
      "Capstan supports six build targets. Pass the target name to ", createElement("code", null, "--target"), ":"
    ),
    createElement("pre", null,
      createElement("code", null,
`npx capstan build --target node-standalone
npx capstan build --target docker
npx capstan build --target vercel-node
npx capstan build --target vercel-edge
npx capstan build --target cloudflare
npx capstan build --target fly`
      )
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Target"),
          createElement("th", null, "Extra Files"),
          createElement("th", null, "Deploy Command")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "node-standalone")),
          createElement("td", null, "Runtime-only package.json"),
          createElement("td", null, createElement("code", null, "cd dist/standalone && npm start"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "docker")),
          createElement("td", null, "Dockerfile, .dockerignore"),
          createElement("td", null, createElement("code", null, "docker build dist/standalone"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "vercel-node")),
          createElement("td", null, "api/index.js, vercel.json"),
          createElement("td", null, createElement("code", null, "cd dist/standalone && vercel deploy"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "vercel-edge")),
          createElement("td", null, "api/index.js, vercel.json, runtime/*.js"),
          createElement("td", null, createElement("code", null, "cd dist/standalone && vercel deploy"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "cloudflare")),
          createElement("td", null, "worker.js, wrangler.toml, runtime/*.js"),
          createElement("td", null, createElement("code", null, "cd dist/standalone && wrangler deploy"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "fly")),
          createElement("td", null, "Dockerfile, .dockerignore, fly.toml"),
          createElement("td", null, createElement("code", null, "cd dist/standalone && fly deploy"))
        )
      )
    ),
    createElement("div", { className: "callout callout-info" },
      createElement("strong", null, "Note: "),
      "Edge and worker targets (", createElement("code", null, "vercel-edge"),
      ", ", createElement("code", null, "cloudflare"),
      ") generate a portable runtime bundle under ", createElement("code", null, "runtime/"),
      " that does not rely on runtime filesystem reads. The bundle embeds the route manifest, compiled modules, and static assets."
    ),

    // Production Server
    createElement("h2", null, "Production Server"),
    createElement("pre", null,
      createElement("code", null, "npx capstan start")
    ),
    createElement("p", null, "The ", createElement("code", null, "start"), " command:"),
    createElement("ol", null,
      createElement("li", null, "Loads the compiled ", createElement("code", null, "capstan.config.ts"), " from ", createElement("code", null, "dist/")),
      createElement("li", null, "Reads the pre-built route manifest from ", createElement("code", null, "dist/_capstan_manifest.json")),
      createElement("li", null, "Starts a Hono HTTP server on the configured port"),
      createElement("li", null, "Mounts all API handlers, page renderers, and agent protocol endpoints"),
      createElement("li", null, "Serves static files from ", createElement("code", null, "dist/public/"))
    ),
    createElement("p", null, "To start from a standalone output:"),
    createElement("pre", null,
      createElement("code", null,
`npx capstan start --from dist/standalone
npx capstan start --port 8080`
      )
    ),
    createElement("p", null, "Or configure in ", createElement("code", null, "capstan.config.ts"), ":"),
    createElement("pre", null,
      createElement("code", null,
`export default defineConfig({
  server: {
    port: 8080,
    host: "0.0.0.0",
  },
});`
      )
    ),

    // SSG
    createElement("h2", null, "Static Site Generation"),
    createElement("pre", null,
      createElement("code", null, "npx capstan build --static")
    ),
    createElement("p", null,
      "This crawls all page routes at build time, renders them to HTML, and outputs static files in ",
      createElement("code", null, "dist/static/"),
      ". Serve them from any CDN or static host."
    ),

    // Environment Variables
    createElement("h2", null, "Environment Variables"),
    createElement("p", null, "Capstan reads environment variables using the ", createElement("code", null, "env()"), " helper:"),
    createElement("pre", null,
      createElement("code", null,
`import { env } from "@zauso-ai/capstan-core";

const dbUrl = env("DATABASE_URL");  // Returns "" if not set`
      )
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Variable"),
          createElement("th", null, "Description"),
          createElement("th", null, "Example")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "DATABASE_URL")),
          createElement("td", null, "Database connection string"),
          createElement("td", null, createElement("code", null, "postgres://user:pass@host:5432/db"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "SESSION_SECRET")),
          createElement("td", null, "HMAC signing secret for JWT sessions"),
          createElement("td", null, createElement("code", null, "your-secret-key-here"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "PORT")),
          createElement("td", null, "Platform-provided server port"),
          createElement("td", null, createElement("code", null, "3000"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "CAPSTAN_PORT")),
          createElement("td", null, "Override port for capstan start"),
          createElement("td", null, createElement("code", null, "3000"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "CAPSTAN_HOST")),
          createElement("td", null, "Server bind address"),
          createElement("td", null, createElement("code", null, "0.0.0.0"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "CAPSTAN_CORS_ORIGIN")),
          createElement("td", null, "Explicit allowed origin for CORS"),
          createElement("td", null, createElement("code", null, "https://app.example.com"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "CAPSTAN_MAX_BODY_SIZE")),
          createElement("td", null, "Max request body size in bytes"),
          createElement("td", null, createElement("code", null, "1048576"))
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "NODE_ENV")),
          createElement("td", null, "Environment (production/development)"),
          createElement("td", null, createElement("code", null, "production"))
        )
      )
    ),
    createElement("div", { className: "callout callout-warning" },
      createElement("strong", null, "Important: "),
      "Never commit ", createElement("code", null, ".env"),
      " files to version control. The scaffolder generates a ",
      createElement("code", null, ".gitignore"), " that excludes ",
      createElement("code", null, ".env"), " and ", createElement("code", null, ".env.local"), "."
    ),

    // Docker Deployment
    createElement("h2", null, "Docker Deployment"),
    createElement("p", null, "The ", createElement("code", null, "docker"),
      " target generates a multi-stage Dockerfile:"
    ),
    createElement("pre", null,
      createElement("code", null,
`FROM node:20-alpine AS builder
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
CMD ["node", "dist/_capstan_server.js"]`
      )
    ),
    createElement("p", null, "Running with Docker Compose:"),
    createElement("pre", null,
      createElement("code", null,
`# Build and start
docker compose up -d

# Run migrations
docker compose exec app npx capstan db:push

# View logs
docker compose logs -f app`
      )
    ),

    // Platform Deployments
    createElement("h2", null, "Vercel"),
    createElement("p", null, "Capstan provides both Node.js and Edge deployment targets for Vercel:"),
    createElement("pre", null,
      createElement("code", null,
`# Node.js serverless
npx capstan build --target vercel-node
npx capstan verify --deployment --target vercel-node
cd dist/standalone && vercel deploy

# Edge runtime
npx capstan build --target vercel-edge
npx capstan verify --deployment --target vercel-edge
cd dist/standalone && vercel deploy`
      )
    ),
    createElement("p", null, "Use ", createElement("code", null, "vercel-node"),
      " for apps with Node runtime dependencies or session auth. Use ",
      createElement("code", null, "vercel-edge"),
      " when the app is edge-safe and you want the portable runtime bundle."
    ),

    createElement("h2", null, "Cloudflare Workers"),
    createElement("pre", null,
      createElement("code", null,
`npx capstan build --target cloudflare
npx capstan verify --deployment --target cloudflare
cd dist/standalone && wrangler deploy`
      )
    ),

    createElement("h2", null, "Fly.io"),
    createElement("pre", null,
      createElement("code", null,
`npx capstan build --target fly
npx capstan verify --deployment --target fly
cd dist/standalone && fly deploy`
      )
    ),

    // deploy:init
    createElement("h2", null, "deploy:init"),
    createElement("p", null,
      "To generate project-root deployment assets instead of deploying from ",
      createElement("code", null, "dist/standalone/"), ":"
    ),
    createElement("pre", null,
      createElement("code", null, "npx capstan deploy:init --target docker")
    ),
    createElement("table", null,
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Target"),
          createElement("th", null, "Generated Files")
        )
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "docker")),
          createElement("td", null, "Dockerfile, .dockerignore, .env.example")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "vercel-node")),
          createElement("td", null, "vercel.json, .env.example")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "vercel-edge")),
          createElement("td", null, "vercel.json, .env.example")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "cloudflare")),
          createElement("td", null, "wrangler.toml, .env.example")
        ),
        createElement("tr", null,
          createElement("td", null, createElement("code", null, "fly")),
          createElement("td", null, "Dockerfile, .dockerignore, fly.toml, .env.example")
        )
      )
    ),

    // Deployment Verification
    createElement("h2", null, "Deployment Verification"),
    createElement("p", null, "Run deployment verification after building a target:"),
    createElement("pre", null,
      createElement("code", null,
`npx capstan verify --deployment --target vercel-edge
npx capstan verify --deployment --target cloudflare --json`
      )
    ),
    createElement("p", null, "Verification checks:"),
    createElement("ul", null,
      createElement("li", null, "Target-specific files (vercel.json, wrangler.toml, fly.toml, entrypoints)"),
      createElement("li", null, "Portable runtime bundle files for edge and worker targets"),
      createElement("li", null, "Unsafe SQLite usage on serverless, edge, or multi-region targets"),
      createElement("li", null, "Auth/runtime mismatches for edge deployments"),
      createElement("li", null, createElement("code", null, "node:"), " imports that would break edge or worker runtimes")
    ),

    // Agent Discovery in Production
    createElement("h2", null, "Agent Discovery in Production"),
    createElement("p", null,
      "In production, agent endpoints are served from the build output. Ensure your reverse proxy or CDN does not strip the ",
      createElement("code", null, "/.well-known/"), " path:"
    ),
    createElement("pre", null,
      createElement("code", null,
`# Verify agent discovery is working
curl https://your-app.example.com/.well-known/capstan.json`
      )
    ),

    // Agent Deployment Considerations
    createElement("h2", null, "Agent Deployment Considerations"),
    createElement("p", null,
      "When deploying applications that include AI agents (", createElement("code", null, "createSmartAgent"),
      "), keep these additional considerations in mind:"
    ),
    createElement("ul", null,
      createElement("li", null,
        createElement("strong", null, "LLM API keys: "),
        "Set ", createElement("code", null, "OPENAI_API_KEY"), ", ", createElement("code", null, "ANTHROPIC_API_KEY"),
        ", or other provider keys as environment variables. Never commit them to source control."
      ),
      createElement("li", null,
        createElement("strong", null, "Evolution persistence: "),
        "If using ", createElement("code", null, "SqliteEvolutionStore"),
        ", ensure the database file path points to a persistent volume. Without persistence, learned strategies and evolved skills are lost on restart."
      ),
      createElement("li", null,
        createElement("strong", null, "Tool result persistence: "),
        "If ", createElement("code", null, "toolResultBudget.persistDir"),
        " is set, ensure the directory exists and has adequate disk space for overflow results."
      ),
      createElement("li", null,
        createElement("strong", null, "Harness runtime directory: "),
        "Harness mode writes to ", createElement("code", null, ".capstan/harness/"),
        ". Use a persistent volume for durable run records and event logs."
      ),
      createElement("li", null,
        createElement("strong", null, "Timeout configuration: "),
        "Adjust ", createElement("code", null, "llmTimeout"),
        " values for your deployment environment. Serverless platforms may have lower execution time limits."
      )
    ),

    // Production Checklist
    createElement("h2", null, "Production Checklist"),
    createElement("ol", null,
      createElement("li", null, "Set ", createElement("code", null, "SESSION_SECRET"), " to a strong, unique value"),
      createElement("li", null, "Set ", createElement("code", null, "DATABASE_URL"), " to your production database"),
      createElement("li", null, "Set LLM API keys (", createElement("code", null, "OPENAI_API_KEY"), ", ", createElement("code", null, "ANTHROPIC_API_KEY"), ") as environment variables"),
      createElement("li", null, "Set ", createElement("code", null, "NODE_ENV=production")),
      createElement("li", null, "Run ", createElement("code", null, "capstan verify"), " and ", createElement("code", null, "capstan verify --deployment --target <target>")),
      createElement("li", null, "Run ", createElement("code", null, "capstan build --target <target>"), " and verify the deployment bundle"),
      createElement("li", null, "Run migrations with ", createElement("code", null, "capstan db:push"), " or ", createElement("code", null, "capstan db:migrate")),
      createElement("li", null, "Enable HTTPS via a reverse proxy (nginx, Caddy, or cloud load balancer)"),
      createElement("li", null, "Review policies to ensure write endpoints require authentication"),
      createElement("li", null, "If using agent evolution, ensure ", createElement("code", null, "SqliteEvolutionStore"), " points to a persistent volume")
    ),

    createElement("div", { className: "callout callout-info" },
      createElement("strong", null, "SQLite in production: "),
      "If using SQLite (single-server), use a persistent volume for the database file. WAL mode is enabled by default. Consider PostgreSQL for multi-instance deployments."
    )
  );
}

# Deployment

## Building for Production

```bash
npx capstan build
```

Golden-path deployment targets build on top of the base production output:

```bash
# Minimal standalone runtime directory
npx capstan build --target node-standalone

# Standalone runtime directory plus Dockerfile/.dockerignore
npx capstan build --target docker

# Vercel Node.js serverless bundle
npx capstan build --target vercel-node

# Vercel Edge bundle with portable runtime modules
npx capstan build --target vercel-edge

# Cloudflare Worker bundle with portable runtime modules
npx capstan build --target cloudflare

# Fly.io multi-region bundle
npx capstan build --target fly
```

The `build` command compiles your TypeScript source into JavaScript ready for production:

- Runs `tsc` to compile all files in `app/` and `capstan.config.ts`
- Output goes to the `dist/` directory
- The compiled output uses ESM (ES modules) with `.js` extensions

### Build Outputs

After a successful build, Capstan writes a deterministic deployment contract to `dist/`:

| File | Purpose |
| ---- | ------- |
| `dist/_capstan_server.js` | Production server entrypoint used by `capstan start` |
| `dist/_capstan_manifest.json` | Compiled route manifest |
| `dist/agent-manifest.json` | Agent manifest projection |
| `dist/openapi.json` | OpenAPI projection |
| `dist/deploy-manifest.json` | Machine-readable deployment contract for tooling and CI |
| `dist/public/` | Static assets copied from `app/public/`, served at `/` |
| `dist/static/` | Pre-rendered SSG output when using `capstan build --static` |
| `dist/standalone/` | Self-contained deployment directory when using any explicit deployment target |

### Standalone Target Family

`npx capstan build --target node-standalone` creates the base runtime-focused directory at `dist/standalone/`:

| File | Purpose |
| ---- | ------- |
| `dist/standalone/package.json` | Runtime-only package manifest with a `start` script |
| `dist/standalone/dist/` | Compiled Capstan build output ready to run |
| `dist/standalone/dist/deploy-manifest.json` | Standalone-scoped deployment contract |

All other deployment targets build on top of this standalone bundle. The deploy commands below assume you are deploying from `dist/standalone/`; use `capstan deploy:init --target <target>` if you prefer deploying from the project root.

| Target | Extra files | Runtime profile | Deploy command |
| ------ | ----------- | --------------- | -------------- |
| `docker` | `Dockerfile`, `.dockerignore` | Containerized Node.js | `docker build dist/standalone` |
| `vercel-node` | `api/index.js`, `vercel.json` | Vercel Node.js serverless | `cd dist/standalone && vercel deploy` |
| `vercel-edge` | `api/index.js`, `vercel.json`, `runtime/*.js` | Vercel Edge portable runtime | `cd dist/standalone && vercel deploy` |
| `cloudflare` | `worker.js`, `wrangler.toml`, `runtime/*.js` | Cloudflare Worker portable runtime | `cd dist/standalone && wrangler deploy` |
| `fly` | `Dockerfile`, `.dockerignore`, `fly.toml` | Fly.io Node.js / Machines | `cd dist/standalone && fly deploy` |

To run it locally:

```bash
cd dist/standalone
npm install --omit=dev
npm start
```

Or from the original project root:

```bash
npx capstan start --from dist/standalone
```

### Docker Target

`npx capstan build --target docker` emits the same `dist/standalone/` bundle plus:

| File | Purpose |
| ---- | ------- |
| `dist/standalone/Dockerfile` | Docker build recipe for the standalone bundle |
| `dist/standalone/.dockerignore` | Docker build-context exclusions |

This target is designed so `docker build dist/standalone` works without copying the source tree.

### Edge And Worker Targets

`vercel-edge` and `cloudflare` generate a portable runtime bundle in addition to the standalone output:

| File | Purpose |
| ---- | ------- |
| `dist/standalone/runtime/manifest.js` | Embedded route manifest, agent manifest, and OpenAPI projection |
| `dist/standalone/runtime/modules.js` | In-memory registry of compiled route/layout/middleware modules |
| `dist/standalone/runtime/assets.js` | In-memory provider for `app/public/`, SSG HTML, and React client assets |

These targets do not rely on runtime filesystem reads. They are intended for edge and worker environments where the deployment bundle must be self-contained.

Before building, ensure your `tsconfig.json` is properly configured:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["app/**/*.ts", "app/**/*.tsx", "capstan.config.ts"]
}
```

## Starting the Production Server

```bash
npx capstan start
```

The `start` command:

1. Loads the compiled `capstan.config.ts` from `dist/`
2. Reads the pre-built route manifest from `dist/_capstan_manifest.json`
3. Starts a Hono HTTP server on the configured port
4. Mounts all API handlers, page renderers, and agent protocol endpoints
5. Serves static files copied from `app/public/` to `dist/public/` at the root URL path

To start from a standalone output instead of the current project root:

```bash
npx capstan start --from dist/standalone
```

### Custom Port

```bash
npx capstan start --port 8080
```

Or configure in `capstan.config.ts`:

```typescript
export default defineConfig({
  server: {
    port: 8080,
    host: "0.0.0.0",
  },
});
```

## Environment Variables

Capstan reads environment variables using the `env()` helper:

```typescript
import { env } from "@zauso-ai/capstan-core";

const dbUrl = env("DATABASE_URL");  // Returns "" if not set
```

### Common Environment Variables

| Variable           | Description                        | Example                                  |
| ------------------ | ---------------------------------- | ---------------------------------------- |
| `DATABASE_URL`     | Database connection string         | `postgres://user:pass@host:5432/db`      |
| `SESSION_SECRET`   | HMAC signing secret for JWT sessions | `your-secret-key-here`                 |
| `PORT`             | Platform-provided server port      | `3000`                                   |
| `CAPSTAN_PORT`     | Override port for `capstan start`  | `3000`                                   |
| `CAPSTAN_HOST`     | Server bind address                | `0.0.0.0`                               |
| `CAPSTAN_CORS_ORIGIN` | Explicit allowed origin for CORS | `https://app.example.com`             |
| `CAPSTAN_MAX_BODY_SIZE` | Max request body size in bytes | `1048576`                             |
| `NODE_ENV`         | Environment (production/development) | `production`                           |

### Using .env Files

Create a `.env` file in your project root for local development:

```bash
DATABASE_URL=./data.db
SESSION_SECRET=dev-secret-change-in-production
PORT=3000
```

Load it with a tool like `dotenv-cli` or set variables directly in your shell/deployment platform.

**Important**: Never commit `.env` files to version control. The scaffolder generates a `.gitignore` that excludes `.env` and `.env.local`.

## Deployment Files

### Generate Root Deployment Files

To generate the project-root deployment assets Capstan expects for the golden path:

```bash
npx capstan deploy:init --target docker
```

`deploy:init` also supports `vercel-node`, `vercel-edge`, `cloudflare`, and `fly`.

Target-specific outputs:

| Target | Generated files |
| ------ | --------------- |
| `docker` | `Dockerfile`, `.dockerignore`, `.env.example` |
| `vercel-node` | `vercel.json`, `.env.example` |
| `vercel-edge` | `vercel.json`, `.env.example` |
| `cloudflare` | `wrangler.toml`, `.env.example` |
| `fly` | `Dockerfile`, `.dockerignore`, `fly.toml`, `.env.example` |

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source and build
COPY . .
RUN npx capstan build --target node-standalone

# --- Production stage ---
FROM node:20-alpine AS runner

WORKDIR /app

# Copy standalone package manifest and install production deps only
COPY --from=builder /app/dist/standalone/package.json ./package.json
RUN npm install --omit=dev

# Copy built output
COPY --from=builder /app/dist/standalone/dist ./dist

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV CAPSTAN_HOST=0.0.0.0

CMD ["node", "dist/_capstan_server.js"]
```

### docker-compose.yml

```yaml
version: "3.9"

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://capstan:capstan@db:5432/capstan
      SESSION_SECRET: ${SESSION_SECRET}
      NODE_ENV: production
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: capstan
      POSTGRES_PASSWORD: capstan
      POSTGRES_DB: capstan
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  pgdata:
```

### Running with Docker

```bash
# Build and start
docker compose up -d

# Run migrations
docker compose exec app npx capstan db:push

# View logs
docker compose logs -f app
```

## Static Assets

Place static files in `app/public/`:

```
app/
  public/
    favicon.ico
    robots.txt
    images/
      logo.png
```

The dev server and production server both serve files from `app/public/` at the root URL path. During `capstan build`, those assets are copied to `dist/public/`. For example, `app/public/favicon.ico` is served at `/favicon.ico`.

## Deployment Verification

Run deployment verification after building a target:

```bash
npx capstan verify --deployment --target vercel-edge
```

Deployment verification checks the built deployment contract instead of the source app alone. It validates:

- target-specific files such as `vercel.json`, `wrangler.toml`, `fly.toml`, and generated entrypoints
- portable runtime bundle files for edge and worker targets
- unsafe SQLite usage on serverless, edge, or multi-region targets
- auth/runtime mismatches for edge deployments
- `node:` imports that would break edge or worker runtimes

Use `--json` if you want machine-readable output for CI:

```bash
npx capstan verify --deployment --target cloudflare --json
```

## Production Checklist

Before deploying to production:

1. **Set `SESSION_SECRET`** to a strong, unique value (not the default `crypto.randomUUID()`)
2. **Set `DATABASE_URL`** to your production database
3. **Set `NODE_ENV=production`**
4. **Run `capstan verify`** for application-level issues and **`capstan verify --deployment --target <target>`** for target-specific risks
5. **Run `capstan build --target <target>`** and verify the generated deployment bundle matches your hosting platform
6. **Run migrations** with `capstan db:push` or `capstan db:migrate` against the production database
7. **Enable HTTPS** via a reverse proxy (nginx, Caddy, or cloud load balancer)
8. **Review policies** to ensure write endpoints require authentication

## Platform-Specific Notes

### Node.js Hosting (Railway, Render)

These platforms typically auto-detect Node.js projects. Build with `node-standalone` or `docker`, then set your start command to:

```
npx capstan start --from dist/standalone --port $PORT
```

### Fly.io

Use the built-in Fly target:

```bash
npx capstan build --target fly
npx capstan verify --deployment --target fly
cd dist/standalone && fly deploy
```

`capstan build --target fly` produces a standalone runtime plus `fly.toml`, `Dockerfile`, and `.dockerignore` for Fly Machines deployments. If you want to deploy from the project root instead, run `npx capstan deploy:init --target fly`.

### Cloudflare Workers

Use the Cloudflare deployment target:

```bash
npx capstan build --target cloudflare
npx capstan verify --deployment --target cloudflare
cd dist/standalone && wrangler deploy
```

The standalone output includes `worker.js`, `wrangler.toml`, and a portable runtime bundle under `runtime/`. If you want to deploy from the project root instead, run `npx capstan deploy:init --target cloudflare`.

### Vercel

Capstan provides both Node.js and Edge deployment targets for Vercel:

```bash
# Node.js serverless
npx capstan build --target vercel-node
npx capstan verify --deployment --target vercel-node
cd dist/standalone && vercel deploy

# Edge runtime
npx capstan build --target vercel-edge
npx capstan verify --deployment --target vercel-edge
cd dist/standalone && vercel deploy
```

Use `vercel-node` for apps with Node runtime dependencies or session auth. Use `vercel-edge` when the app is edge-safe and you want the portable runtime bundle. If you want to deploy from the project root instead, run `npx capstan deploy:init --target vercel-node` or `npx capstan deploy:init --target vercel-edge`.

### Serverless

For custom hosting beyond the built-in targets, Capstan's Hono-based server can still be adapted directly. The lower-level adapter helpers remain available from `@zauso-ai/capstan-dev`.

For serverless deployments, consider:

- using an external database for approval state
- pre-scanning routes at build time
- using the generated deployment manifest as the contract your platform wrapper consumes

### SQLite in Production

If using SQLite in production (single-server deployments):

- Use a persistent volume for the database file
- WAL mode is enabled by default for better concurrency
- Consider PostgreSQL for multi-instance deployments

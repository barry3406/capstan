# Deployment

## Building for Production

```bash
npx capstan build
```

The `build` command compiles your TypeScript source into JavaScript ready for production:

- Runs `tsc` to compile all files in `app/` and `capstan.config.ts`
- Output goes to the `dist/` directory
- The compiled output uses ESM (ES modules) with `.js` extensions

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
2. Scans the compiled route files in `dist/app/routes/`
3. Starts a Hono HTTP server on the configured port
4. Mounts all API handlers, page renderers, and agent protocol endpoints
5. Serves static files from `app/public/`

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
| `PORT`             | Server port                        | `3000`                                   |
| `HOST`             | Server bind address                | `0.0.0.0`                               |
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

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npx capstan build

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built output
COPY --from=builder /app/dist ./dist

# Copy static assets
COPY app/public ./app/public

# Copy config (compiled)
COPY --from=builder /app/dist/capstan.config.js ./dist/capstan.config.js

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

CMD ["npx", "capstan", "start"]
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

The dev server and production server both serve files from `app/public/` at the root URL path. For example, `app/public/favicon.ico` is served at `/favicon.ico`.

## Production Checklist

Before deploying to production:

1. **Set `SESSION_SECRET`** to a strong, unique value (not the default `crypto.randomUUID()`)
2. **Set `DATABASE_URL`** to your production database
3. **Set `NODE_ENV=production`**
4. **Run `capstan verify`** to check for issues before deploying
5. **Run `capstan build`** and verify the `dist/` output compiles cleanly
6. **Run migrations** with `capstan db:push` or `capstan db:migrate` against the production database
7. **Enable HTTPS** via a reverse proxy (nginx, Caddy, or cloud load balancer)
8. **Review policies** to ensure write endpoints require authentication

## Platform-Specific Notes

### Node.js Hosting (Railway, Render)

These platforms typically auto-detect Node.js projects. Set your start command to:

```
npx capstan start --port $PORT
```

### Fly.io

Capstan includes a Fly.io adapter with write replay support for multi-region deployments:

```typescript
import { createFlyAdapter } from "@zauso-ai/capstan-dev";

const adapter = createFlyAdapter({
  primaryRegion: "iad",
  replayWrites: true,
});
```

When `replayWrites` is enabled, mutating requests (POST, PUT, DELETE, PATCH) arriving at non-primary regions are automatically replayed to the primary via a `fly-replay` header. Use `fly launch` with a Dockerfile that runs `capstan build && capstan start`.

### Cloudflare Workers

Capstan includes a built-in Cloudflare Workers adapter:

```typescript
import { createCloudflareHandler, generateWranglerConfig } from "@zauso-ai/capstan-dev";

// Worker entry — dist/_worker.js
export default createCloudflareHandler(app);
```

Generate a `wrangler.toml` with `generateWranglerConfig("my-app")`. The generated config enables `nodejs_compat` for full Node.js API support.

### Vercel

Capstan provides both Edge and Node.js adapters for Vercel:

```typescript
import { createVercelHandler, createVercelNodeHandler } from "@zauso-ai/capstan-dev";

// Edge Function (recommended for low latency)
export default createVercelHandler(app);

// Node.js Serverless Function (for native Node.js dependencies)
export default createVercelNodeHandler(app);
```

Use `generateVercelConfig()` to produce a `vercel.json`-compatible configuration object.

### Serverless

For other serverless platforms, Capstan's Hono-based server can be adapted since Hono supports multiple runtime adapters. For serverless deployments, consider:

- Using an external database for approval state (e.g., `RedisStore`)
- Pre-scanning routes at build time
- Using the `Hono` app instance directly with your serverless adapter

### SQLite in Production

If using SQLite in production (single-server deployments):

- Use a persistent volume for the database file
- WAL mode is enabled by default for better concurrency
- Consider PostgreSQL for multi-instance deployments

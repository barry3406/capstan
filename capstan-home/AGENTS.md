# AGENTS.md — Capstan Operating Guide

This project was scaffolded by Capstan for **capstan-home**.

Use this file as the default playbook for coding agents. Favor Capstan's explicit
golden path over custom abstractions unless the task clearly requires it.

## Start Here

Read these files first, in order:
1. `capstan.config.ts`
2. `app/routes/`
3. `AGENTS.md`

Then use this loop:
1. Run `capstan dev`
2. Make the smallest explicit change
3. Verify with `capstan verify --json`
4. Finish with `capstan build`

## What Capstan Means

Capstan is **file-based, multi-surface, and machine-readable**.

- A route file defines the product surface.
- A single `defineAPI()` becomes **HTTP + MCP + A2A + OpenAPI**.
- Page loaders run on the server and should call internal APIs through loader `fetch`, not by hard-coding localhost HTTP calls.
- `app/public/` is served from the root URL path, so `app/public/logo.svg` becomes `/logo.svg`.
- `dist/deploy-manifest.json` is the deployment contract after build.

When a user asks for a feature, think in this order:
1. Which route or page owns the behavior?
2. Does it need a model?
3. Does it need a policy?
4. How will it be verified?
5. What agent-visible surface changes automatically because of Capstan?

## Project Map

```
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
```

## Template Notes

This app was scaffolded from the **blank** template.

Treat the generated files as the minimum Capstan slice:
- `app/routes/index.page.tsx` — first page route
- `app/routes/api/health.api.ts` — smallest complete `defineAPI()` example
- `app/policies/index.ts` — where reusable policies should live

## Commands Agents Should Reach For

```bash
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
```

## Golden Paths

### Add an API route

Prefer scaffolding first:

```bash
capstan add api orders
```

Then shape the route around `defineAPI()`:

```typescript
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
```

Always set:
- `input` and `output` when the route has a stable contract
- `description`
- `capability`
- `resource`

Add `policy` for write flows or protected reads.

### Add a page route

Prefer scaffolding first:

```bash
capstan add page dashboard
```

When the page needs data, use a loader and in-process fetch:

```typescript
import { useLoaderData } from "@zauso-ai/capstan-react";

export async function loader({ fetch }) {
  return fetch.get("/api/orders");
}

export default function DashboardPage() {
  const data = useLoaderData<typeof loader>();
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
```

Use directory boundaries instead of ad hoc conditionals:
- `_layout.tsx` for shared UI shell
- `_loading.tsx` for suspense fallback
- `_error.tsx` for scoped error UI
- `not-found.tsx` for scoped 404 behavior

### Add a model

If the feature needs durable data:
1. Create or scaffold a model in `app/models/`
2. Run `capstan db:migrate`
3. Apply with `capstan db:push`
4. Update the route handler or page loader that consumes the data

Use `defineModel()` as the default path. Keep fields explicit and predictable.

### Add a policy

Policies live in `app/policies/` and are referenced by key from `defineAPI()`.

```typescript
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
```

## Verification Checklist

Before you call work done, try to cover the narrowest useful set of checks:

### For route or page changes

```bash
capstan dev
capstan verify --json
capstan build
```

### For model changes

```bash
capstan db:migrate
capstan db:status
capstan db:push
```

### For deployment-sensitive changes

```bash
capstan build --target node-standalone
capstan verify --deployment --target node-standalone
```

## Common Mistakes

Avoid these mistakes unless there is a strong reason:

- Do not hand-edit `dist/`
- Do not bypass `capstan add` if a scaffold command already exists
- Do not forget `description`, `capability`, or `resource` on `defineAPI()`
- Do not use external HTTP calls from page loaders when loader `fetch` can call internal APIs directly
- Do not put static assets under `/public/...` in links; use root paths like `/logo.svg`
- Do not rename route files casually; filenames are the routing contract
- Do not add write endpoints without thinking through policy and verification

## Capstan File Conventions That Matter

- `app/routes/orders/index.api.ts` -> `/orders`
- `app/routes/orders/[id].api.ts` -> `/orders/:id`
- `app/routes/orders/index.page.tsx` -> page route
- `app/routes/(ops)/dashboard.page.tsx` -> route group omitted from URL
- `_layout.tsx`, `_middleware.ts`, `_loading.tsx`, `_error.tsx`, and `not-found.tsx` all inherit by directory scope

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

- `app/routes/index.page.tsx`
- `app/routes/api/health.api.ts`
- `app/styles/main.css`
- `capstan.config.ts`

Keep this file aligned with the project as the app grows.

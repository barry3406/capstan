import { readFile } from "node:fs/promises";
import path from "node:path";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { scanRoutes } from "@zauso-ai/capstan-router";
import type { RouteManifest, RouteEntry } from "@zauso-ai/capstan-router";
import { toJSONSchema } from "zod";
import {
  createContext,
  createApproval,
  createRequestLogger,
  csrfProtection,
  mountApprovalRoutes,
} from "@zauso-ai/capstan-core";
import type { APIDefinition, HttpMethod, CapstanContext, CapstanAuthContext } from "@zauso-ai/capstan-core";

import { loadApiHandlers, loadLayoutModule, loadPageModule, invalidateModuleCache } from "./loader.js";
import { watchRoutes, watchStyles } from "./watcher.js";
import { printStartupBanner } from "./printer.js";
import type { DevServerConfig, DevServerInstance } from "./types.js";
import type { ServerAdapter } from "./adapter.js";
import { createNodeAdapter, notifyLiveReloadClients } from "./adapter-node.js";
import { detectCSSMode, buildCSS, startTailwindWatch } from "./css.js";

// ---------------------------------------------------------------------------
// Live Reload
// ---------------------------------------------------------------------------

/**
 * Small inline `<script>` tag injected before `</body>` in HTML pages served
 * during development. It opens an SSE connection to the dev server and
 * reloads the page when a "reload" event arrives.
 */
const LIVE_RELOAD_SCRIPT = `<script>
(function(){
  var es = new EventSource('/__capstan_livereload');
  es.onmessage = function(e) { if (e.data === 'reload') location.reload(); };
  es.onerror = function() { setTimeout(function(){ es.close(); es = new EventSource('/__capstan_livereload'); }, 1000); };
})();
</script>`;

/**
 * Inject the live-reload `<script>` into an HTML string by placing it
 * immediately before `</body>`. If `</body>` is not found the script is
 * appended at the end as a best-effort fallback.
 */
function injectLiveReload(html: string): string {
  const idx = html.lastIndexOf("</body>");
  if (idx !== -1) {
    return html.slice(0, idx) + LIVE_RELOAD_SCRIPT + "\n" + html.slice(idx);
  }
  return html + LIVE_RELOAD_SCRIPT;
}

/**
 * Determine if an exported handler value looks like an APIDefinition
 * produced by `defineAPI()` from @zauso-ai/capstan-core.
 */
function isAPIDefinition(value: unknown): value is APIDefinition {
  return (
    value !== null &&
    typeof value === "object" &&
    "handler" in value &&
    typeof (value as APIDefinition).handler === "function"
  );
}

/**
 * Build a minimal `CapstanContext` from a raw `Request` for use outside
 * of the Hono middleware pipeline (e.g. for page loaders).
 */
function buildStandaloneContext(
  request: Request,
  auth?: CapstanAuthContext,
): CapstanContext {
  return {
    auth: auth ?? {
      isAuthenticated: false,
      type: "anonymous",
      permissions: [],
    },
    request,
    env: process.env as Record<string, string | undefined>,
    // In dev mode we don't have a real Hono context for standalone calls.
    // The context is cast to satisfy the type; page loaders should not
    // depend on `honoCtx` directly.
    honoCtx: {} as CapstanContext["honoCtx"],
  };
}

// ---------------------------------------------------------------------------
// MIME types for static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".html": "text/html",
  ".htm": "text/html",
  ".txt": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".map": "application/json",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
};

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/** Hono env type that declares the capstanAuth variable. */
type HonoEnv = { Variables: { capstanAuth: CapstanAuthContext } };

// ---------------------------------------------------------------------------
// Cached framework package imports
// ---------------------------------------------------------------------------
// These dynamic imports are cached at module level so they are resolved at
// most once across rebuilds, avoiding repeated filesystem and module-graph
// resolution overhead.

let _reactPkg: {
  renderPage: (opts: {
    pageModule: { default: unknown; loader?: unknown };
    layouts: Array<{ default: unknown }>;
    params: Record<string, string>;
    request: Request;
    loaderArgs: {
      params: Record<string, string>;
      request: Request;
      ctx: { auth: CapstanContext["auth"] };
      fetch: Record<string, unknown>;
    };
  }) => Promise<{ html: string; loaderData: unknown; statusCode: number }>;
} | null = null;

let _agentPkg: {
  generateA2AAgentCard: (
    cfg: { name: string; description?: string; baseUrl?: string },
    routes: Array<{ method: string; path: string; description?: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> }>,
  ) => unknown;
  createA2AHandler: (
    cfg: { name: string; description?: string; baseUrl?: string },
    routes: Array<{ method: string; path: string; description?: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown> }>,
    executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>,
  ) => {
    handleRequest: (body: unknown) => Promise<unknown>;
  };
  routeToToolName: (method: string, path: string) => string;
  createMcpServer: (
    cfg: { name: string; description?: string },
    routes: Array<{ method: string; path: string; description?: string; inputSchema?: Record<string, unknown> }>,
    executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>,
  ) => { server: unknown; getToolDefinitions: () => Array<{ name: string; description: string; inputSchema: unknown }> };
} | null = null;

async function getAgentPkg(): Promise<NonNullable<typeof _agentPkg>> {
  if (!_agentPkg) {
    const agentModuleName = "@zauso-ai/capstan-agent";
    _agentPkg = (await import(agentModuleName)) as NonNullable<typeof _agentPkg>;
  }
  return _agentPkg;
}

/**
 * Given a scanned route manifest, build a fresh Hono application with all
 * routes registered. Returns the Hono app plus metadata used by the
 * framework endpoints (manifest, openapi, health).
 */
async function buildApp(
  manifest: RouteManifest,
  config: DevServerConfig,
): Promise<{
  app: Hono<HonoEnv>;
  apiRouteCount: number;
  pageRouteCount: number;
  routeRegistry: Array<{
    method: string;
    path: string;
    description?: string;
    capability?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }>;
}> {

  const app = new Hono<HonoEnv>();

  // Global middleware ---------------------------------------------------------
  app.use("*", createRequestLogger());
  app.use("*", cors());

  // --- Auth middleware -------------------------------------------------------
  // If the config includes auth settings, create the auth resolver from
  // @zauso-ai/capstan-auth. Otherwise, fall back to anonymous and warn once.

  let resolveAuth: ((request: Request) => Promise<CapstanAuthContext>) | null =
    null;

  if (config.auth) {
    try {
      const authModuleName = "@zauso-ai/capstan-auth";
      const authPkg = (await import(authModuleName)) as {
        createAuthMiddleware: (
          cfg: typeof config.auth,
          deps: { findAgentByKeyPrefix?: (prefix: string) => Promise<unknown> },
        ) => (request: Request) => Promise<CapstanAuthContext>;
      };
      resolveAuth = authPkg.createAuthMiddleware(config.auth, {});
    } catch {
      // @zauso-ai/capstan-auth is not installed or failed to load — continue without it.
      // eslint-disable-next-line no-console
      console.warn(
        "[capstan] @zauso-ai/capstan-auth not available. Auth middleware disabled.",
      );
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[capstan] No auth config provided. All requests treated as anonymous.",
    );
  }

  // Hono middleware that resolves auth and attaches it to the context so that
  // `createContext(c)` picks it up via `c.get("capstanAuth")`.
  app.use("*", async (c, next) => {
    if (resolveAuth) {
      const authCtx = await resolveAuth(c.req.raw);
      c.set("capstanAuth", authCtx);
    }
    await next();
  });

  // --- CSRF middleware -------------------------------------------------------
  // Only enable CSRF protection when cookie-based session auth is configured.
  // API-key-only setups don't need CSRF because Bearer tokens are not sent
  // automatically by browsers.
  if (config.auth?.session) {
    app.use("*", csrfProtection());
  }

  // Route metadata accumulated for the agent manifest / OpenAPI spec.
  const routeRegistry: Array<{
    method: string;
    path: string;
    description?: string;
    capability?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }> = [];

  /**
   * Handler registry keyed by "METHOD /path" so approved requests can
   * re-execute the original handler without going through the HTTP stack.
   */
  const handlerRegistry = new Map<
    string,
    (input: unknown, ctx: CapstanContext) => Promise<unknown>
  >();

  let apiRouteCount = 0;
  let pageRouteCount = 0;

  // Separate API and page routes from the manifest.
  const apiRoutes: RouteEntry[] = [];
  const pageRoutes: RouteEntry[] = [];

  for (const route of manifest.routes) {
    if (route.type === "api") apiRoutes.push(route);
    if (route.type === "page") pageRoutes.push(route);
  }

  // --- Register API routes --------------------------------------------------

  for (const route of apiRoutes) {
    let handlers: Awaited<ReturnType<typeof loadApiHandlers>>;

    try {
      handlers = await loadApiHandlers(route.filePath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[capstan] Failed to load API route ${route.filePath}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    const methodEntries: Array<[HttpMethod, unknown]> = [
      ["GET", handlers.GET],
      ["POST", handlers.POST],
      ["PUT", handlers.PUT],
      ["DELETE", handlers.DELETE],
      ["PATCH", handlers.PATCH],
    ];

    for (const [method, handler] of methodEntries) {
      if (handler === undefined) continue;

      apiRouteCount++;

      // Record metadata for agent manifest / OpenAPI.
      const entry: (typeof routeRegistry)[number] = {
        method,
        path: route.urlPattern,
      };

      if (isAPIDefinition(handler)) {
        if (handler.description !== undefined) {
          entry.description = handler.description;
        }
        if (handler.capability !== undefined) {
          entry.capability = handler.capability;
        }

        // Extract JSON Schema from Zod input/output schemas so that MCP
        // tools, OpenAPI specs, and A2A skills see real parameters.
        try {
          if (handler.input) {
            entry.inputSchema = toJSONSchema(handler.input) as Record<string, unknown>;
          }
        } catch {
          // Schema conversion is best-effort; silently ignore failures.
        }

        try {
          if (handler.output) {
            entry.outputSchema = toJSONSchema(handler.output) as Record<string, unknown>;
          }
        } catch {
          // Best-effort.
        }
      }

      // Merge additional metadata from the route file's `meta` export
      // (e.g. description, resource) when the handler itself doesn't
      // already provide those fields.
      if (handlers.meta) {
        if (entry.description === undefined && typeof handlers.meta["description"] === "string") {
          entry.description = handlers.meta["description"];
        }
        if (entry.capability === undefined && typeof handlers.meta["capability"] === "string") {
          entry.capability = handlers.meta["capability"] as string;
        }
      }

      routeRegistry.push(entry);

      // Store the handler for approval re-execution.
      if (isAPIDefinition(handler)) {
        const routeKey = `${method} ${route.urlPattern}`;
        const apiHandler = handler;
        handlerRegistry.set(routeKey, async (input: unknown, ctx: CapstanContext) => {
          return apiHandler.handler({ input, ctx, params: {} });
        });
      }

      // Mount the handler on the Hono app.
      const honoMethod = method.toLowerCase() as
        | "get"
        | "post"
        | "put"
        | "delete"
        | "patch";

      app[honoMethod](route.urlPattern, async (c) => {
        const ctx = createContext(c);

        // Parse input from query string (GET) or request body (others).
        let input: unknown;
        try {
          if (method === "GET") {
            input = Object.fromEntries(new URL(c.req.url).searchParams);
          } else {
            const contentType = c.req.header("content-type") ?? "";
            if (contentType.includes("application/json")) {
              input = await c.req.json();
            } else {
              input = {};
            }
          }
        } catch {
          input = {};
        }

        try {
          // --- Policy enforcement -------------------------------------------
          // If the handler declares a policy, enforce it before executing.
          if (isAPIDefinition(handler) && handler.policy) {
            const policyName = handler.policy;
            // requireAuth is a built-in policy: deny anonymous requests.
            if (policyName === "requireAuth") {
              if (!ctx.auth.isAuthenticated) {
                return c.json(
                  { error: "Unauthorized", policy: policyName },
                  401,
                );
              }
            }
            // For custom policies that are not "requireAuth", create a
            // pending approval so a human/supervisor can review the action.
            // The dev server does not maintain a full policy registry, so
            // custom policies are treated as requiring approval in dev mode.
            if (policyName !== "requireAuth") {
              const reason = `Policy "${policyName}" requires approval`;
              const approval = await createApproval({
                method,
                path: route.urlPattern,
                input,
                policy: policyName,
                reason,
              });
              return c.json(
                {
                  status: "approval_required",
                  approvalId: approval.id,
                  reason,
                  pollUrl: `/capstan/approvals/${approval.id}`,
                },
                202,
              );
            }
          }

          if (isAPIDefinition(handler)) {
            const params = c.req.param() as Record<string, string>;
            const result = await handler.handler({ input, ctx, params });
            return c.json(result as object);
          }

          // If the export is a plain function rather than an APIDefinition,
          // invoke it directly with a similar signature.
          if (typeof handler === "function") {
            const params = c.req.param() as Record<string, string>;
            const result = await (
              handler as (args: { input: unknown; ctx: CapstanContext; params: Record<string, string> }) => Promise<unknown>
            )({ input, ctx, params });
            return c.json(result as object);
          }

          return c.json({ error: "Invalid handler export" }, 500);
        } catch (err: unknown) {
          // Zod validation errors
          if (
            err !== null &&
            typeof err === "object" &&
            "issues" in (err as object) &&
            Array.isArray((err as { issues: unknown[] }).issues)
          ) {
            return c.json(
              {
                error: "Validation Error",
                issues: (err as { issues: unknown[] }).issues,
              },
              400,
            );
          }

          const message =
            err instanceof Error ? err.message : "Internal Server Error";
          // eslint-disable-next-line no-console
          console.error(`[capstan] Error in ${method} ${route.urlPattern}:`, message);
          return c.json({ error: message }, 500);
        }
      });
    }
  }

  // --- Register page routes -------------------------------------------------

  for (const route of pageRoutes) {
    let pageModule: Awaited<ReturnType<typeof loadPageModule>>;

    try {
      pageModule = await loadPageModule(route.filePath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[capstan] Failed to load page ${route.filePath}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    if (!pageModule.default) {
      // eslint-disable-next-line no-console
      console.warn(
        `[capstan] Page ${route.filePath} has no default export, skipping.`,
      );
      continue;
    }

    pageRouteCount++;

    app.get(route.urlPattern, async (c) => {
      // In dev mode we do a simplified server render:
      // - Run the loader (if any) to get data
      // - Attempt to render using @zauso-ai/capstan-react's renderPage
      // - Fall back to a minimal HTML shell with loader data if React
      //   rendering is unavailable or fails.

      const request = c.req.raw;
      const params: Record<string, string> = {};
      for (const name of route.params) {
        const value = c.req.param(name);
        if (value !== undefined) {
          params[name] = value;
        }
      }

      // Read auth from Hono context — already resolved by the auth middleware.
      const pageAuth: CapstanAuthContext | undefined = c.get("capstanAuth");

      const ctx = buildStandaloneContext(request, pageAuth);

      // Run loader if present
      let loaderData: unknown = null;
      if (typeof pageModule.loader === "function") {
        try {
          loaderData = await (
            pageModule.loader as (args: {
              params: Record<string, string>;
              request: Request;
              ctx: { auth: CapstanContext["auth"] };
              fetch: Record<string, unknown>;
            }) => Promise<unknown>
          )({
            params,
            request,
            ctx: { auth: ctx.auth },
            fetch: {
              get: async () => null,
              post: async () => null,
              put: async () => null,
              delete: async () => null,
            },
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            `[capstan] Loader error in ${route.filePath}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      // Attempt full SSR via @zauso-ai/capstan-react. If the package is available
      // and the page module has a valid React component, render it.
      // We use a dynamic import so the dev server works even when
      // @zauso-ai/capstan-react is not installed.
      try {
        if (!_reactPkg) {
          const reactModuleName = "@zauso-ai/capstan-react";
          _reactPkg = (await import(reactModuleName)) as NonNullable<typeof _reactPkg>;
        }
        const reactPkg = _reactPkg;

        // Load layout modules in parallel for this route
        const layoutResults = await Promise.all(
          route.layouts.map(async (layoutPath) => {
            try {
              const layoutMod = await loadLayoutModule(layoutPath);
              return layoutMod.default ? { default: layoutMod.default } : null;
            } catch {
              return null;
            }
          })
        );
        const loadedLayouts: Array<{ default: unknown }> = [];
        for (const l of layoutResults) {
          if (l !== null) loadedLayouts.push(l);
        }

        const renderOpts = {
          pageModule: {
            default: pageModule.default,
            loader: pageModule.loader,
          },
          layouts: loadedLayouts,
          params,
          request,
          loaderArgs: {
            params,
            request,
            ctx: { auth: ctx.auth },
            fetch: {
              get: async () => null,
              post: async () => null,
              put: async () => null,
              delete: async () => null,
            },
          },
        };

        // Prefer streaming SSR when available.  We collect the stream to a
        // string so that `injectLiveReload` can insert the SSE script before
        // `</body>`.  This keeps live-reload working while still benefiting
        // from streaming internally (Suspense, reduced memory pressure).
        if (typeof (reactPkg as Record<string, unknown>)["renderPageStream"] === "function") {
          const renderStream = (reactPkg as Record<string, unknown>)["renderPageStream"] as (
            opts: typeof renderOpts,
          ) => Promise<{ stream: ReadableStream<Uint8Array>; loaderData: unknown; statusCode: number }>;
          const { stream, statusCode } = await renderStream(renderOpts);

          // Collect stream to string for live-reload injection
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          let html = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            html += decoder.decode(value, { stream: true });
          }
          html += decoder.decode();

          return c.html(injectLiveReload(html), statusCode as 200);
        }

        const result = await reactPkg.renderPage(renderOpts);

        return c.html(injectLiveReload(result.html), result.statusCode as 200);
      } catch {
        // @zauso-ai/capstan-react not available or render failed -- serve a
        // minimal HTML shell that exposes loader data.
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${config.appName ?? "Capstan App"}</title>
</head>
<body>
  <div id="capstan-root">
    <p>Page: ${route.urlPattern}</p>
  </div>
  <script>window.__CAPSTAN_DATA__ = ${JSON.stringify({ loaderData, params }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}</script>
${LIVE_RELOAD_SCRIPT}
</body>
</html>`;
        return c.html(html);
      }
    });
  }

  // --- Approval management endpoints ----------------------------------------

  mountApprovalRoutes(app, handlerRegistry);

  // --- Framework endpoints --------------------------------------------------

  // Agent manifest
  app.get("/.well-known/capstan.json", (c) => {
    const manifest = {
      capstan: "1.0",
      name: config.appName ?? "capstan-app",
      description: config.appDescription ?? "",
      authentication: {
        schemes: [
          {
            type: "bearer" as const,
            name: "API Key",
            header: "Authorization",
            description: "Bearer token for agent authentication",
          },
        ],
      },
      capabilities: routeRegistry.map((r) => ({
        key: `${r.method} ${r.path}`,
        title: r.description ?? `${r.method} ${r.path}`,
        mode: (r.capability ?? "read") as "read" | "write" | "external",
        endpoint: {
          method: r.method,
          path: r.path,
          ...(r.inputSchema ? { inputSchema: r.inputSchema } : {}),
          ...(r.outputSchema ? { outputSchema: r.outputSchema } : {}),
        },
      })),
    };
    return c.json(manifest);
  });

  // OpenAPI spec
  app.get("/openapi.json", (c) => {
    const paths: Record<string, Record<string, object>> = {};

    for (const r of routeRegistry) {
      const pathKey = r.path.replace(/:(\w+)/g, "{$1}").replace(/\*/g, "{path}");
      if (!paths[pathKey]) {
        paths[pathKey] = {};
      }
      paths[pathKey]![r.method.toLowerCase()] = {
        summary: r.description ?? `${r.method} ${r.path}`,
        operationId: `${r.method.toLowerCase()}_${r.path.replace(/[/:*]/g, "_").replace(/^_/, "")}`,
        responses: {
          "200": {
            description: "Successful response",
            ...(r.outputSchema ? { content: { "application/json": { schema: r.outputSchema } } } : {}),
          },
        },
        ...(r.inputSchema ? { requestBody: { content: { "application/json": { schema: r.inputSchema } } } } : {}),
      };
    }

    const spec = {
      openapi: "3.1.0",
      info: {
        title: config.appName ?? "capstan-app",
        description: config.appDescription ?? "",
        version: "0.1.0",
      },
      paths,
    };

    return c.json(spec);
  });

  // Health check
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // --- A2A endpoints ---------------------------------------------------------
  // GET /.well-known/agent.json — A2A Agent Card discovery
  // POST /.well-known/a2a       — A2A JSON-RPC task handler

  app.get("/.well-known/agent.json", async (c) => {
    try {
      const agentPkg = await getAgentPkg();

      const card = agentPkg.generateA2AAgentCard(
        {
          name: config.appName ?? "capstan-app",
          ...(config.appDescription ? { description: config.appDescription } : {}),
          baseUrl: `http://${config.host ?? "localhost"}:${config.port ?? 3000}`,
        },
        routeRegistry,
      );
      return c.json(card as object);
    } catch {
      return c.json(
        { error: "@zauso-ai/capstan-agent not available — A2A disabled" },
        501,
      );
    }
  });

  app.post("/.well-known/a2a", async (c) => {
    try {
      const agentPkg = await getAgentPkg();

      const executeRoute = async (
        method: string,
        urlPath: string,
        input: unknown,
      ): Promise<unknown> => {
        const url = `http://localhost:${config.port ?? 3000}${urlPath}`;
        const init: RequestInit = {
          method,
          headers: { "Content-Type": "application/json" },
        };
        if (method !== "GET" && method !== "HEAD" && input !== undefined) {
          init.body = JSON.stringify(input);
        }
        const request = new Request(url, init);
        // Use the outer Hono app reference for internal dispatch.
        const response = await app.fetch(request);
        try {
          return await response.json();
        } catch {
          return { status: response.status, body: await response.text() };
        }
      };

      const handler = agentPkg.createA2AHandler(
        {
          name: config.appName ?? "capstan-app",
          ...(config.appDescription ? { description: config.appDescription } : {}),
          baseUrl: `http://${config.host ?? "localhost"}:${config.port ?? 3000}`,
        },
        routeRegistry,
        executeRoute,
      );

      const body = await c.req.json();
      const result = await handler.handleRequest(body);
      return c.json(result as object);
    } catch {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: "@zauso-ai/capstan-agent not available — A2A disabled",
          },
        },
        501,
      );
    }
  });

  // --- MCP discovery endpoint -----------------------------------------------
  // POST /.well-known/mcp returns a JSON description of available MCP tools
  // so that agents can discover capabilities without connecting via stdio.

  app.post("/.well-known/mcp", async (c) => {
    try {
      const agentPkg = await getAgentPkg();

      const tools = routeRegistry.map((r) => ({
        name: agentPkg.routeToToolName(r.method, r.path),
        description: r.description ?? `${r.method} ${r.path}`,
        method: r.method,
        path: r.path,
        inputSchema: r.inputSchema ?? { type: "object", properties: {} },
      }));

      return c.json({
        protocol: "mcp",
        version: "1.0",
        name: config.appName ?? "capstan-app",
        tools,
      });
    } catch {
      // @zauso-ai/capstan-agent not available
      return c.json({
        protocol: "mcp",
        version: "1.0",
        name: config.appName ?? "capstan-app",
        tools: [],
        error: "@zauso-ai/capstan-agent not available",
      });
    }
  });

  // --- Static file serving (app/public/) ------------------------------------
  // Serve files from publicDir as static assets at the root URL path.
  // This is registered AFTER all API/page/framework routes so that named
  // routes always take priority.

  const publicDir = config.publicDir ?? path.join(config.rootDir, "app", "public");

  app.get("*", async (c) => {
    const urlPath = new URL(c.req.url).pathname;

    // Prevent directory traversal
    const resolved = path.resolve(publicDir, `.${urlPath}`);
    if (!resolved.startsWith(publicDir)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    try {
      const content = await readFile(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      return c.notFound();
    }
  });

  return { app, apiRouteCount, pageRouteCount, routeRegistry };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create and return a dev server instance that:
 *
 * 1. Scans `app/routes/` for route files
 * 2. Creates a Hono server with all routes registered
 * 3. Starts an HTTP server on the configured port
 * 4. Watches for file changes and re-builds routes
 * 5. Serves the agent manifest, OpenAPI spec, and health endpoint
 * 6. Prints a startup banner with URLs and route counts
 */
export async function createDevServer(
  config: DevServerConfig,
): Promise<DevServerInstance> {
  const port = config.port ?? 3000;
  const host = config.host ?? "0.0.0.0";
  const routesDir = path.join(config.rootDir, "app", "routes");
  config.publicDir = config.publicDir ?? path.join(config.rootDir, "app", "public");

  // --- Initial route scan ---------------------------------------------------

  let manifest = await scanRoutes(routesDir);
  let { app, apiRouteCount, pageRouteCount, routeRegistry } = await buildApp(
    manifest,
    config,
  );

  // The Node.js HTTP server holds a reference to the current Hono app.
  // When routes change we rebuild the app and swap the reference -- in-flight
  // requests finish against the old app while new requests hit the new one.
  let currentApp = app;

  // --- MCP server instance ---------------------------------------------------
  // Create an MCP server backed by the route registry so that `capstan mcp`
  // can connect to the running dev server's routes. The executeRoute callback
  // invokes the Hono app directly using an internal fetch.

  type McpServerType = { server: unknown; getToolDefinitions: () => Array<{ name: string; description: string; inputSchema: unknown }> };
  let mcpInstance: McpServerType | null = null;

  async function buildMcpServer(): Promise<void> {
    try {
      const agentPkg = await getAgentPkg();

      const executeRoute = async (
        method: string,
        urlPath: string,
        input: unknown,
      ): Promise<unknown> => {
        const url = `http://localhost:${port}${urlPath}`;
        const init: RequestInit = {
          method,
          headers: { "Content-Type": "application/json" },
        };
        if (method !== "GET" && method !== "HEAD" && input !== undefined) {
          init.body = JSON.stringify(input);
        }
        const request = new Request(url, init);
        const response = await currentApp.fetch(request);
        try {
          return await response.json();
        } catch {
          return { status: response.status, body: await response.text() };
        }
      };

      mcpInstance = agentPkg.createMcpServer(
        {
          name: config.appName ?? "capstan-app",
          ...(config.appDescription ? { description: config.appDescription } : {}),
        },
        routeRegistry,
        executeRoute,
      );
    } catch {
      // @zauso-ai/capstan-agent not available — MCP disabled.
      mcpInstance = null;
    }
  }

  await buildMcpServer();

  // --- Runtime adapter selection --------------------------------------------

  let adapter: ServerAdapter;

  // Detect Bun runtime at startup. If `Bun` global exists, use the Bun
  // adapter; otherwise fall back to the Node.js adapter.
  const isBun = typeof (globalThis as Record<string, unknown>)["Bun"] !== "undefined";

  if (isBun) {
    const { createBunAdapter } = await import("./adapter-bun.js");
    adapter = createBunAdapter();
  } else {
    adapter = createNodeAdapter({ maxBodySize: config.maxBodySize });
  }

  // The adapter handle is assigned once `start()` is called.
  let adapterHandle: { close: () => Promise<void> } | null = null;

  // --- File watcher ---------------------------------------------------------

  async function rebuildRoutes(changedFile?: string): Promise<void> {
    try {
      // eslint-disable-next-line no-console
      console.log("[capstan] Routes changed, rebuilding...");
      // Invalidate only the changed file so unchanged modules stay cached.
      invalidateModuleCache(changedFile);
      manifest = await scanRoutes(routesDir);
      const rebuilt = await buildApp(manifest, config);
      currentApp = rebuilt.app;
      apiRouteCount = rebuilt.apiRouteCount;
      pageRouteCount = rebuilt.pageRouteCount;
      routeRegistry = rebuilt.routeRegistry;

      // Rebuild MCP server with updated routes.
      await buildMcpServer();

      // Notify connected browsers to reload.
      notifyLiveReloadClients();

      const totalRoutes = apiRouteCount + pageRouteCount;
      // eslint-disable-next-line no-console
      console.log(
        `[capstan] Rebuilt: ${totalRoutes} routes (${apiRouteCount} API, ${pageRouteCount} pages)`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "[capstan] Failed to rebuild routes:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const watcher = watchRoutes(routesDir, (changedFile) => {
    void rebuildRoutes(changedFile);
  });

  // --- CSS processing -------------------------------------------------------

  const stylesDir = path.join(config.rootDir, "app", "styles");
  const cssEntry = path.join(stylesDir, "main.css");
  const cssOutFile = path.join(
    config.publicDir ?? path.join(config.rootDir, "app", "public"),
    "_capstan",
    "styles.css",
  );

  const cssMode = await detectCSSMode(config.rootDir);

  let cssStylesWatcher: { close: () => void } | null = null;
  let tailwindHandle: { stop: () => void } | null = null;

  if (cssMode === "lightningcss") {
    // Initial build
    try {
      await buildCSS(cssEntry, cssOutFile, true);
      // eslint-disable-next-line no-console
      console.log("[capstan] CSS built (Lightning CSS)");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[capstan] CSS build failed:",
        err instanceof Error ? err.message : err,
      );
    }

    // Watch for CSS changes and rebuild
    cssStylesWatcher = watchStyles(stylesDir, () => {
      void (async () => {
        try {
          await buildCSS(cssEntry, cssOutFile, true);
          notifyLiveReloadClients();
          // eslint-disable-next-line no-console
          console.log("[capstan] CSS rebuilt");
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            "[capstan] CSS rebuild failed:",
            err instanceof Error ? err.message : err,
          );
        }
      })();
    });
  } else if (cssMode === "tailwind") {
    tailwindHandle = startTailwindWatch(cssEntry, cssOutFile);
    // eslint-disable-next-line no-console
    console.log("[capstan] Tailwind CSS watch started");
  }

  // --- DevServerInstance ----------------------------------------------------

  let shuttingDown = false;

  const instance: DevServerInstance = {
    port,
    host,

    async start(): Promise<void> {
      adapterHandle = await adapter.listen(
        { fetch: (req) => currentApp.fetch(req) },
        port,
        host,
      );

      printStartupBanner({
        appName: config.appName ?? "capstan-app",
        port,
        host,
        routeCount: apiRouteCount + pageRouteCount,
        apiRouteCount,
        pageRouteCount,
      });
    },

    async stop(): Promise<void> {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      // eslint-disable-next-line no-console
      console.log("[capstan] Shutting down gracefully...");

      // 1. Close watchers so no more rebuilds are triggered.
      watcher.close();
      if (cssStylesWatcher) {
        cssStylesWatcher.close();
      }
      if (tailwindHandle) {
        tailwindHandle.stop();
      }

      // 2. Close the server via the adapter (handles SSE cleanup, connection
      //    draining, etc. for the Node adapter; simple stop for Bun).
      if (adapterHandle) {
        await adapterHandle.close();
      }
    },
  };

  // --- Signal handlers -------------------------------------------------------
  // Register SIGINT/SIGTERM so that `Ctrl-C` and container stop signals
  // trigger a graceful shutdown instead of an abrupt process exit.

  function onSignal(): void {
    void instance.stop().then(() => {
      process.exit(0);
    });
  }

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return instance;
}

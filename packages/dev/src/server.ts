import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import path from "node:path";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { scanRoutes } from "@capstan/router";
import type { RouteManifest, RouteEntry } from "@capstan/router";
import { createContext } from "@capstan/core";
import type { APIDefinition, HttpMethod, CapstanContext } from "@capstan/core";

import { loadApiHandlers, loadPageModule } from "./loader.js";
import { watchRoutes } from "./watcher.js";
import { printStartupBanner } from "./printer.js";
import type { DevServerConfig, DevServerInstance } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the full request body from an IncomingMessage and return it
 * as a parsed JSON value (or raw string if JSON parsing fails).
 */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (raw.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

/**
 * Determine if an exported handler value looks like an APIDefinition
 * produced by `defineAPI()` from @capstan/core.
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
function buildStandaloneContext(request: Request): CapstanContext {
  return {
    auth: {
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
// Route registration
// ---------------------------------------------------------------------------

/**
 * Given a scanned route manifest, build a fresh Hono application with all
 * routes registered. Returns the Hono app plus metadata used by the
 * framework endpoints (manifest, openapi, health).
 */
async function buildApp(
  manifest: RouteManifest,
  config: DevServerConfig,
): Promise<{
  app: Hono;
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
  const app = new Hono();

  // Global middleware ---------------------------------------------------------
  app.use("*", cors());

  // Route metadata accumulated for the agent manifest / OpenAPI spec.
  const routeRegistry: Array<{
    method: string;
    path: string;
    description?: string;
    capability?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }> = [];

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
      const meta: (typeof routeRegistry)[number] = {
        method,
        path: route.urlPattern,
      };

      if (isAPIDefinition(handler)) {
        if (handler.description !== undefined) {
          meta.description = handler.description;
        }
        if (handler.capability !== undefined) {
          meta.capability = handler.capability;
        }
      }

      routeRegistry.push(meta);

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
          if (isAPIDefinition(handler)) {
            const result = await handler.handler({ input, ctx });
            return c.json(result as object);
          }

          // If the export is a plain function rather than an APIDefinition,
          // invoke it directly with a similar signature.
          if (typeof handler === "function") {
            const result = await (
              handler as (args: { input: unknown; ctx: CapstanContext }) => Promise<unknown>
            )({ input, ctx });
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
      // - Attempt to render using @capstan/react's renderPage
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

      const ctx = buildStandaloneContext(request);

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

      // Attempt full SSR via @capstan/react. If the package is available
      // and the page module has a valid React component, render it.
      // We use a dynamic import so the dev server works even when
      // @capstan/react is not installed.
      try {
        const reactModuleName = "@capstan/react";
        const reactPkg = (await import(reactModuleName)) as {
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
        };

        const result = await reactPkg.renderPage({
          pageModule: {
            default: pageModule.default,
            loader: pageModule.loader,
          },
          layouts: [],
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
        });

        return c.html(result.html, result.statusCode as 200);
      } catch {
        // @capstan/react not available or render failed -- serve a
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
  <script>window.__CAPSTAN_DATA__ = ${JSON.stringify({ loaderData, params })}</script>
</body>
</html>`;
        return c.html(html);
      }
    });
  }

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
          "200": { description: "Successful response" },
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

  // --- Initial route scan ---------------------------------------------------

  let manifest = await scanRoutes(routesDir);
  let { app, apiRouteCount, pageRouteCount } = await buildApp(manifest, config);

  // The Node.js HTTP server holds a reference to the current Hono app.
  // When routes change we rebuild the app and swap the reference -- in-flight
  // requests finish against the old app while new requests hit the new one.
  let currentApp = app;

  // --- HTTP server ----------------------------------------------------------

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);

      // Build a Web API Request from the Node.js IncomingMessage.
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) {
            headers.append(key, v);
          }
        } else {
          headers.set(key, value);
        }
      }

      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      let body: string | undefined;
      if (hasBody) {
        const raw = await readBody(req);
        body = raw !== undefined ? (typeof raw === "string" ? raw : JSON.stringify(raw)) : undefined;
      }

      const init: RequestInit = {
        method: req.method ?? "GET",
        headers,
      };

      if (body !== undefined) {
        init.body = body;
      }

      const request = new Request(url.toString(), init);
      const response = await currentApp.fetch(request);

      // Write the Hono response back through the Node.js response.
      res.writeHead(
        response.status,
        Object.fromEntries(response.headers.entries()),
      );
      const responseBody = await response.text();
      res.end(responseBody);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[capstan] Unhandled request error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  });

  // --- File watcher ---------------------------------------------------------

  async function rebuildRoutes(): Promise<void> {
    try {
      // eslint-disable-next-line no-console
      console.log("[capstan] Routes changed, rebuilding...");
      manifest = await scanRoutes(routesDir);
      const rebuilt = await buildApp(manifest, config);
      currentApp = rebuilt.app;
      apiRouteCount = rebuilt.apiRouteCount;
      pageRouteCount = rebuilt.pageRouteCount;

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

  const watcher = watchRoutes(routesDir, () => {
    void rebuildRoutes();
  });

  // --- DevServerInstance ----------------------------------------------------

  const instance: DevServerInstance = {
    port,
    host,

    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.on("error", (err) => {
          reject(err);
        });

        server.listen(port, host, () => {
          printStartupBanner({
            appName: config.appName ?? "capstan-app",
            port,
            host,
            routeCount: apiRouteCount + pageRouteCount,
            apiRouteCount,
            pageRouteCount,
          });
          resolve();
        });
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        watcher.close();
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
  };

  return instance;
}

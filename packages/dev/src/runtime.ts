import { Hono } from "hono";
import { cors } from "hono/cors";
import { matchRoute } from "@zauso-ai/capstan-router/runtime";
import type { RouteEntry, RouteManifest } from "@zauso-ai/capstan-router/runtime";
import { toJSONSchema } from "zod";
import {
  createApproval,
  createContext,
  createRequestLogger,
  csrfProtection,
  enforcePolicies,
  mountApprovalRoutes,
  createCapstanOpsContext,
} from "@zauso-ai/capstan-core";
import type {
  APIDefinition,
  HttpMethod,
  CapstanAuthContext,
  CapstanContext,
  CapstanOpsContext,
  PolicyDefinition,
  MiddlewareDefinition,
} from "@zauso-ai/capstan-core";
import { createPageFetch } from "./page-fetch.js";
import { runPageRuntime } from "./page-runtime.js";
import type { PageRuntimeOptions } from "./page-runtime.js";
import {
  createRouteRuntimeDiagnostics,
  createRuntimeDiagnostic,
  mergeRuntimeDiagnostics,
  runtimeDiagnosticsHeaders,
  type RuntimeDiagnostic,
} from "./runtime-diagnostics.js";
import { resolveProjectOpsConfig } from "./ops-sink.js";
import type {
  RuntimeAppBuild,
  RuntimeAppConfig,
  RuntimeAssetProvider,
  RuntimeAssetRecord,
  RuntimeRouteRegistryEntry,
} from "./types.js";

interface HonoEnv {
  Variables: {
    capstanAuth: CapstanAuthContext;
    capstanOps?: CapstanOpsContext;
    capstanRequestId?: string;
    capstanTraceId?: string;
  };
}

export interface PortableRuntimeConfig extends Omit<RuntimeAppConfig, "clientDir"> {
  routeModules: Record<string, Record<string, unknown>>;
  agentManifest?: Record<string, unknown>;
  openApiSpec?: Record<string, unknown>;
}

const CAPSTAN_CLIENT_BOOTSTRAP = [
  `import { bootstrapClient } from "/_capstan/client/entry.js";`,
  `bootstrapClient();`,
].join("\n");

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

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function toCapabilityMode(
  value: unknown,
): "read" | "write" | "external" | undefined {
  return value === "read" || value === "write" || value === "external"
    ? value
    : undefined;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function joinPath(...segments: string[]): string {
  const cleaned = segments
    .filter((segment) => segment.length > 0)
    .map((segment, index) => {
      if (index === 0) {
        return segment.replace(/[\\/]+$/g, "");
      }
      return segment.replace(/^[\\/]+|[\\/]+$/g, "");
    })
    .filter((segment) => segment.length > 0);

  if (cleaned.length === 0) {
    return ".";
  }

  return normalizePath(cleaned.join("/"));
}

function resolveRuntimePath(rootDir: string, candidatePath: string): string {
  if (isAbsolutePath(candidatePath)) {
    return normalizePath(candidatePath);
  }

  return joinPath(rootDir, candidatePath);
}

function extname(value: string): string {
  const normalized = normalizePath(value);
  const baseName = normalized.split("/").pop() ?? normalized;
  const dotIndex = baseName.lastIndexOf(".");
  return dotIndex === -1 ? "" : baseName.slice(dotIndex).toLowerCase();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function injectManifest(html: string, manifest: RouteManifest): string {
  const clientRoutes = manifest.routes
    .filter((route) => route.type === "page")
    .map((route) => ({
      urlPattern: route.urlPattern,
      componentType: route.componentType ?? "server",
      layouts: route.layouts,
    }));

  const script = `<script>window.__CAPSTAN_MANIFEST__=${JSON.stringify({ routes: clientRoutes }).replace(/</g, "\\u003c")}</script>`;
  const idx = html.lastIndexOf("</body>");
  if (idx !== -1) {
    return html.slice(0, idx) + script + "\n" + html.slice(idx);
  }
  return html + script;
}

async function collectStreamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    html += decoder.decode(value, { stream: true });
  }

  html += decoder.decode();
  return html;
}

function decoratePageHtml(html: string, manifest: RouteManifest): string {
  return injectManifest(html, manifest);
}

function shouldRenderNotFoundPage(request: Request): boolean {
  if (request.headers.get("X-Capstan-Nav") === "1") {
    return true;
  }

  if (request.headers.get("sec-fetch-dest") === "document") {
    return true;
  }

  if (request.headers.get("sec-fetch-mode") === "navigate") {
    return true;
  }

  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html") || accept.includes("application/xhtml+xml");
}

function isAPIDefinition(value: unknown): value is APIDefinition {
  return (
    value !== null &&
    typeof value === "object" &&
    "handler" in value &&
    typeof (value as APIDefinition).handler === "function"
  );
}

async function materializeAsset(asset: RuntimeAssetRecord): Promise<Uint8Array> {
  if (asset.encoding === "base64") {
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(asset.body, "base64"));
    }

    if (typeof atob === "function") {
      const decoded = atob(asset.body);
      return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    }
  }

  return new TextEncoder().encode(asset.body);
}

function cloneBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function serveProvidedAsset(
  asset: RuntimeAssetRecord | null,
): Promise<Response | null> {
  if (!asset) {
    return null;
  }

  return new Response(cloneBufferSource(await materializeAsset(asset)), {
    status: 200,
    headers: {
      "Content-Type": asset.contentType ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    },
  });
}

interface PolicyEnforcementArgs {
  handler: APIDefinition | { policy?: string };
  input: unknown;
  ctx: CapstanContext;
  method: string;
  path: string;
  policyRegistry?: ReadonlyMap<string, PolicyDefinition>;
  unknownPolicyMode?: "approve" | "deny";
}

async function enforceRoutePolicy(
  args: PolicyEnforcementArgs,
): Promise<Response | null> {
  const policyName = args.handler.policy;
  if (!policyName) {
    return null;
  }

  if (policyName === "requireAuth" && !args.policyRegistry?.has(policyName)) {
    if (!args.ctx.auth.isAuthenticated) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", policy: policyName }),
        {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }
    return null;
  }

  const policyDefinition = args.policyRegistry?.get(policyName);
  if (!policyDefinition) {
    if ((args.unknownPolicyMode ?? "approve") === "approve") {
      const reason = `Policy "${policyName}" requires approval`;
      const approval = await createApproval({
        method: args.method,
        path: args.path,
        input: args.input,
        policy: policyName,
        reason,
        ctx: args.ctx,
      });

      return new Response(
        JSON.stringify({
          status: "approval_required",
          approvalId: approval.id,
          reason,
          pollUrl: `/capstan/approvals/${approval.id}`,
        }),
        {
          status: 202,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        error: "Forbidden",
        reason: `Unknown policy: ${policyName}`,
        policy: policyName,
      }),
      {
        status: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  const result = await enforcePolicies([policyDefinition], args.ctx, args.input);

  if (result.effect === "deny") {
    return new Response(
      JSON.stringify({
        error: "Forbidden",
        reason: result.reason ?? "Policy denied",
        policy: policyName,
      }),
      {
        status: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  if (result.effect === "approve") {
    const approval = await createApproval({
      method: args.method,
      path: args.path,
      input: args.input,
      policy: policyName,
      reason: result.reason ?? "This action requires approval",
      ctx: args.ctx,
    });

    return new Response(
      JSON.stringify({
        status: "approval_required",
        approvalId: approval.id,
        reason: result.reason ?? "This action requires approval",
        pollUrl: `/capstan/approvals/${approval.id}`,
      }),
      {
        status: 202,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  return null;
}

function getRouteModule(
  routeModules: Record<string, Record<string, unknown>>,
  filePath: string,
): Record<string, unknown> {
  const mod = routeModules[filePath];
  if (!mod) {
    throw new Error(`Portable runtime module not found for ${filePath}`);
  }
  return mod;
}

function loadPortableApiHandlers(
  routeModules: Record<string, Record<string, unknown>>,
  filePath: string,
): {
  GET?: unknown;
  POST?: unknown;
  PUT?: unknown;
  DELETE?: unknown;
  PATCH?: unknown;
  meta?: Record<string, unknown>;
} {
  const mod = getRouteModule(routeModules, filePath);
  const result: {
    GET?: unknown;
    POST?: unknown;
    PUT?: unknown;
    DELETE?: unknown;
    PATCH?: unknown;
    meta?: Record<string, unknown>;
  } = {};

  if (mod.GET !== undefined) result.GET = mod.GET;
  if (mod.POST !== undefined) result.POST = mod.POST;
  if (mod.PUT !== undefined) result.PUT = mod.PUT;
  if (mod.DELETE !== undefined) result.DELETE = mod.DELETE;
  if (mod.PATCH !== undefined) result.PATCH = mod.PATCH;
  if (mod.meta && typeof mod.meta === "object") {
    result.meta = mod.meta as Record<string, unknown>;
  }

  return result;
}

function loadPortablePageModule(
  routeModules: Record<string, Record<string, unknown>>,
  filePath: string,
): {
  default?: unknown;
  loader?: unknown;
  componentType?: unknown;
  hydration?: unknown;
  renderMode?: unknown;
  revalidate?: unknown;
  cacheTags?: unknown;
  metadata?: unknown;
  generateStaticParams?: unknown;
} {
  const mod = getRouteModule(routeModules, filePath);
  return {
    ...(mod.default !== undefined ? { default: mod.default } : {}),
    ...(mod.loader !== undefined ? { loader: mod.loader } : {}),
    ...(mod.componentType !== undefined ? { componentType: mod.componentType } : {}),
    ...(mod.hydration !== undefined ? { hydration: mod.hydration } : {}),
    ...(mod.renderMode !== undefined ? { renderMode: mod.renderMode } : {}),
    ...(mod.revalidate !== undefined ? { revalidate: mod.revalidate } : {}),
    ...(mod.cacheTags !== undefined ? { cacheTags: mod.cacheTags } : {}),
    ...(mod.metadata !== undefined ? { metadata: mod.metadata } : {}),
    ...(mod.generateStaticParams !== undefined ? { generateStaticParams: mod.generateStaticParams } : {}),
  };
}

function loadPortableLayoutModule(
  routeModules: Record<string, Record<string, unknown>>,
  filePath: string,
): {
  default?: unknown;
  metadata?: unknown;
} {
  const mod = getRouteModule(routeModules, filePath);
  return {
    ...(mod.default !== undefined ? { default: mod.default } : {}),
    ...(mod.metadata !== undefined ? { metadata: mod.metadata } : {}),
  };
}

function loadPortableBoundaryModule(
  routeModules: Record<string, Record<string, unknown>>,
  filePath: string,
): {
  default?: unknown;
} {
  const mod = getRouteModule(routeModules, filePath);
  return mod.default !== undefined ? { default: mod.default } : {};
}

function normalizeMiddlewareExport(
  exported: unknown,
  filePath: string,
): MiddlewareDefinition {
  if (typeof exported === "function") {
    return { handler: exported as MiddlewareDefinition["handler"] };
  }

  if (
    exported !== null &&
    typeof exported === "object" &&
    "handler" in exported &&
    typeof (exported as MiddlewareDefinition).handler === "function"
  ) {
    return exported as MiddlewareDefinition;
  }

  throw new Error(
    `Invalid middleware export in ${filePath}: expected default export from defineMiddleware() or a function with a handler().`,
  );
}

function loadPortableRouteMiddlewares(
  routeModules: Record<string, Record<string, unknown>>,
  filePaths: string[],
): MiddlewareDefinition[] {
  return filePaths.map((filePath) => {
    const mod = getRouteModule(routeModules, filePath);
    return normalizeMiddlewareExport(mod.default ?? mod, filePath);
  });
}

function composeRouteMiddlewares(
  middlewares: MiddlewareDefinition[],
  terminalHandler: (args: { request: Request; ctx: CapstanContext }) => Promise<Response>,
): (args: { request: Request; ctx: CapstanContext }) => Promise<Response> {
  const chain = middlewares.slice();

  return async function runRouteMiddleware(args): Promise<Response> {
    let index = -1;

    const dispatch = async (position: number): Promise<Response> => {
      if (position <= index) {
        throw new Error("next() called multiple times in route middleware chain");
      }
      index = position;

      const current = chain[position];
      if (!current) {
        return terminalHandler(args);
      }

      return current.handler({
        request: args.request,
        ctx: args.ctx,
        next: async () => dispatch(position + 1),
      });
    };

    return dispatch(0);
  };
}

async function createA2AHelpers() {
  try {
    return await import("@zauso-ai/capstan-agent");
  } catch {
    return null;
  }
}

export async function buildPortableRuntimeApp(
  config: PortableRuntimeConfig,
): Promise<RuntimeAppBuild> {
  const manifest = config.manifest;
  const app = new Hono<HonoEnv>();
  const routeModules = config.routeModules;
  const diagnostics: RuntimeDiagnostic[] = [];
  const routeRegistry: RuntimeRouteRegistryEntry[] = [];
  const opsConfig = resolveProjectOpsConfig(config.ops, {
    rootDir: config.rootDir,
    ...(config.appName ? { appName: config.appName } : {}),
    environment: config.mode ?? "development",
    source: config.mode === "production" ? "portable-runtime:prod" : "portable-runtime:dev",
  });
  const ops = createCapstanOpsContext(opsConfig);
  const handlerRegistry = new Map<
    string,
    (input: unknown, ctx: CapstanContext) => Promise<unknown>
  >();
  const unknownPolicyMode =
    config.unknownPolicyMode ?? (config.mode === "production" ? "deny" : "approve");

  if (ops) {
    app.use("*", async (c, next) => {
      c.set("capstanOps", ops);
      await next();
    });
  }

  app.use("*", createRequestLogger({ ops }));
  if (config.corsOptions !== false) {
    app.use("*", cors(config.corsOptions));
  }

  let resolveAuth:
    | ((request: Request) => Promise<CapstanAuthContext>)
    | null = null;

  if (config.auth) {
    try {
      const authPkg = await import("@zauso-ai/capstan-auth");
      resolveAuth = authPkg.createAuthMiddleware(config.auth, {
        ...(config.findAgentByKeyPrefix
          ? { findAgentByKeyPrefix: config.findAgentByKeyPrefix }
          : {}),
      });
    } catch {
      console.warn(
        "[capstan] @zauso-ai/capstan-auth not available in portable runtime. Auth middleware disabled.",
      );
    }
  }

  app.use("*", async (c, next) => {
    if (resolveAuth) {
      const authCtx = await resolveAuth(c.req.raw);
      c.set("capstanAuth", authCtx);
    }
    await next();
  });

  if (config.auth?.session) {
    app.use("*", csrfProtection());
  }

  let apiRouteCount = 0;
  let pageRouteCount = 0;

  const apiRoutes: RouteEntry[] = [];
  const pageRoutes: RouteEntry[] = [];
  const notFoundRoutes: RouteEntry[] = [];

  for (const route of manifest.routes) {
    if (route.type === "api") apiRoutes.push(route);
    if (route.type === "page") pageRoutes.push(route);
    if (route.type === "not-found") notFoundRoutes.push(route);
  }

  for (const route of apiRoutes) {
    const routeFilePath = resolveRuntimePath(config.rootDir, route.filePath);
    const resolvedMiddlewares = route.middlewares.map((middlewarePath) =>
      resolveRuntimePath(config.rootDir, middlewarePath),
    );

    let handlers: ReturnType<typeof loadPortableApiHandlers>;
    try {
      handlers = loadPortableApiHandlers(routeModules, routeFilePath);
    } catch (err) {
      console.error(
        `[capstan] Failed to load portable API route ${route.filePath}:`,
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
      if (handler === undefined) {
        continue;
      }

      apiRouteCount++;

      const entry: RuntimeRouteRegistryEntry = {
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

        try {
          if (handler.input) {
            entry.inputSchema = toJSONSchema(handler.input) as Record<string, unknown>;
          }
        } catch {}

        try {
          if (handler.output) {
            entry.outputSchema = toJSONSchema(handler.output) as Record<string, unknown>;
          }
        } catch {}
      }

      if (handlers.meta) {
        if (entry.description === undefined && typeof handlers.meta.description === "string") {
          entry.description = handlers.meta.description;
        }
        if (entry.capability === undefined) {
          const capability = toCapabilityMode(handlers.meta.capability);
          if (capability) {
            entry.capability = capability;
          }
        }
      }

      routeRegistry.push(entry);

      const middlewareDefinitions = loadPortableRouteMiddlewares(
        routeModules,
        resolvedMiddlewares,
      );

      if (isAPIDefinition(handler)) {
        const routeKey = `${method} ${route.urlPattern}`;
        const apiHandler = handler;
        handlerRegistry.set(routeKey, async (input: unknown, ctx: CapstanContext) => {
          return apiHandler.handler({ input, ctx, params: {} });
        });
      }

      const honoMethod = method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch";

      app[honoMethod](route.urlPattern, async (c) => {
        const ctx = createContext(c);
        const startTime = Date.now();
        const executeHandler = async (): Promise<Response> => {
          let input: unknown;
          try {
            if (method === "GET") {
              input = Object.fromEntries(new URL(c.req.url).searchParams);
            } else {
              const contentType = c.req.header("content-type") ?? "";
              input = contentType.includes("application/json") ? await c.req.json() : {};
            }
          } catch {
            input = {};
          }

          if (isAPIDefinition(handler)) {
            const policyResponse = await enforceRoutePolicy({
              handler,
              input,
              ctx,
              method,
              path: route.urlPattern,
              unknownPolicyMode,
              ...(config.policyRegistry ? { policyRegistry: config.policyRegistry } : {}),
            });
            if (policyResponse) {
              return policyResponse;
            }
          }

          const params = c.req.param() as Record<string, string>;

          if (ops && isAPIDefinition(handler)) {
            await ops.recordCapabilityInvocation({
              ...(ctx.requestId !== undefined ? { requestId: ctx.requestId } : {}),
              ...(ctx.traceId !== undefined ? { traceId: ctx.traceId } : {}),
              phase: "start",
              data: {
                method,
                path: route.urlPattern,
                ...(handler.capability !== undefined
                  ? { capability: handler.capability }
                  : {}),
                ...(handler.resource !== undefined
                  ? { resource: handler.resource }
                  : {}),
              },
            });
          }

          try {
            if (isAPIDefinition(handler)) {
              const result = await handler.handler({ input, ctx, params });
              if (ops) {
                await ops.recordCapabilityInvocation({
                  ...(ctx.requestId !== undefined ? { requestId: ctx.requestId } : {}),
                  ...(ctx.traceId !== undefined ? { traceId: ctx.traceId } : {}),
                  phase: "end",
                  data: {
                    method,
                    path: route.urlPattern,
                    ...(handler.capability !== undefined
                      ? { capability: handler.capability }
                      : {}),
                    ...(handler.resource !== undefined
                      ? { resource: handler.resource }
                      : {}),
                    status: 200,
                    durationMs: Date.now() - startTime,
                    outcome: "success",
                  },
                });
              }
              return c.json(result as object);
            }

            if (typeof handler === "function") {
              const result = await (
                handler as (args: {
                  input: unknown;
                  ctx: CapstanContext;
                  params: Record<string, string>;
                }) => Promise<unknown>
              )({ input, ctx, params });
              return c.json(result as object);
            }

            return c.json({ error: "Invalid handler export" }, 500);
          } catch (err) {
            if (ops && isAPIDefinition(handler)) {
              await ops.recordCapabilityInvocation({
                ...(ctx.requestId !== undefined ? { requestId: ctx.requestId } : {}),
                ...(ctx.traceId !== undefined ? { traceId: ctx.traceId } : {}),
                phase: "end",
                incidentFingerprint: `capability:${method}:${route.urlPattern}:5xx`,
                data: {
                  method,
                  path: route.urlPattern,
                  ...(handler.capability !== undefined
                    ? { capability: handler.capability }
                    : {}),
                  ...(handler.resource !== undefined
                    ? { resource: handler.resource }
                    : {}),
                  status: 500,
                  durationMs: Date.now() - startTime,
                  outcome: "failure",
                },
              });
            }

            throw err;
          }
        };

        try {
          return await composeRouteMiddlewares(
            middlewareDefinitions,
            async ({ request, ctx }) => executeHandler(),
          )({
            request: c.req.raw,
            ctx,
          });
        } catch (err: unknown) {
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

          const message = err instanceof Error ? err.message : "Internal Server Error";
          console.error(`[capstan] Error in ${method} ${route.urlPattern}:`, message);
          return c.json({ error: message }, 500);
        }
      });
    }
  }

  interface ExecutePageRouteArgs {
    request: Request;
    params: Record<string, string>;
    ctx: CapstanContext;
    isNavRequest: boolean;
    isStaticBuildRequest: boolean;
  }

  const pageRouteExecutors = new Map<
    string,
    (args: ExecutePageRouteArgs) => Promise<Response>
  >();

  const createPageRouteExecutor = async (
    route: RouteEntry,
  ): Promise<((args: ExecutePageRouteArgs) => Promise<Response>) | null> => {
    const routeFilePath = resolveRuntimePath(config.rootDir, route.filePath);
    const resolvedLayouts = route.layouts.map((layoutPath) =>
      resolveRuntimePath(config.rootDir, layoutPath),
    );
    const resolvedMiddlewares = route.middlewares.map((middlewarePath) =>
      resolveRuntimePath(config.rootDir, middlewarePath),
    );
    const resolvedLoading = route.loading
      ? resolveRuntimePath(config.rootDir, route.loading)
      : undefined;
    const resolvedError = route.error
      ? resolveRuntimePath(config.rootDir, route.error)
      : undefined;

    let pageModule: ReturnType<typeof loadPortablePageModule>;
    try {
      pageModule = loadPortablePageModule(routeModules, routeFilePath);
    } catch (err) {
      diagnostics.push(
        createRuntimeDiagnostic(
          "error",
          "runtime.page-module.load-failed",
          `Failed to load portable page route ${route.filePath}.`,
          {
            filePath: route.filePath,
            error: err instanceof Error ? err.message : String(err),
          },
        ),
      );
      console.error(
        `[capstan] Failed to load portable page ${route.filePath}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }

    if (!pageModule.default) {
      diagnostics.push(
        createRuntimeDiagnostic(
          "error",
          "route.page.missing-default",
          `Page route ${route.urlPattern} must export a default React component.`,
          {
            filePath: route.filePath,
            urlPattern: route.urlPattern,
          },
        ),
      );
      console.warn(`[capstan] Page ${route.filePath} has no default export, skipping.`);
      return null;
    }

    const moduleComponentType = (
      pageModule as { componentType?: unknown }
    ).componentType;

    diagnostics.push(
      ...createRouteRuntimeDiagnostics({
        urlPattern: route.urlPattern,
        filePath: route.filePath,
        routeType: route.type,
        ...(route.componentType !== undefined
          ? { routeComponentType: route.componentType }
          : {}),
        ...(moduleComponentType !== undefined
          ? { moduleComponentType }
          : {}),
        hasDefaultExport: Boolean(pageModule.default),
      }),
    );

    const loadedLayouts = resolvedLayouts.map((layoutPath) => {
      const layoutMod = loadPortableLayoutModule(routeModules, layoutPath);
      if (!layoutMod.default) {
        diagnostics.push(
          createRuntimeDiagnostic(
            "error",
            "route.layout.missing-default",
            `Layout ${layoutPath} must export a default React component.`,
            {
              filePath: layoutPath,
              routeFilePath: route.filePath,
            },
          ),
        );
        throw new Error(`Layout ${layoutPath} has no default export.`);
      }
      return {
        default: layoutMod.default as never,
        ...(layoutMod.metadata !== undefined ? { metadata: layoutMod.metadata } : {}),
      };
    });
    const middlewareDefinitions = loadPortableRouteMiddlewares(
      routeModules,
      resolvedMiddlewares,
    );
    const loadingComponent = resolvedLoading
      ? loadPortableBoundaryModule(routeModules, resolvedLoading).default
      : undefined;
    const errorComponent = resolvedError
      ? loadPortableBoundaryModule(routeModules, resolvedError).default
      : undefined;

    return async ({
      request,
      params,
      ctx,
      isNavRequest,
      isStaticBuildRequest,
    }: ExecutePageRouteArgs): Promise<Response> => {
      const executePageRequest = async (): Promise<Response> => {
        const requestDiagnostics: RuntimeDiagnostic[] = [];
        if (pageModule.renderMode === "ssg" && !isStaticBuildRequest) {
          requestDiagnostics.push(
            createRuntimeDiagnostic(
              "info",
              "page-runtime.render-mode-fallback",
              "Runtime downgraded SSG to SSR outside of a static build request.",
              {
                filePath: route.filePath,
                urlPattern: route.urlPattern,
                requestedRenderMode: pageModule.renderMode,
                effectiveRenderMode: "ssr",
              },
            ),
          );
        }

        if (
          route.type === "page" &&
          !isNavRequest &&
          !isStaticBuildRequest &&
          pageModule.renderMode === "ssg" &&
          config.assetProvider?.readStaticHtml
        ) {
          const staticHtml = await config.assetProvider.readStaticHtml(
            new URL(request.url).pathname,
          );
          if (staticHtml !== null) {
            requestDiagnostics.push(
              createRuntimeDiagnostic(
                "info",
                "page-runtime.static-html-hit",
                "Served pre-rendered HTML from the static asset provider.",
                {
                  filePath: route.filePath,
                  urlPattern: route.urlPattern,
                },
              ),
            );
            return new Response(staticHtml, {
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                ...runtimeDiagnosticsHeaders(mergeRuntimeDiagnostics(diagnostics, requestDiagnostics)),
              },
            });
          }
        }

        const metadataChain = loadedLayouts
          .map((layout) => layout.metadata)
          .filter((metadata): metadata is NonNullable<typeof metadata> => metadata !== undefined);

        const loaderArgs = {
          params,
          request,
          ctx: { auth: ctx.auth },
          fetch: createPageFetch(request, {
            fetchImpl: async (internalRequest) => app.fetch(internalRequest),
          }),
        };

        const pageRuntimeOptions = {
          pageModule: {
            default: pageModule.default as never,
            loader: pageModule.loader as never,
            hydration: pageModule.hydration as never,
            renderMode: pageModule.renderMode as never,
            revalidate: pageModule.revalidate as never,
            cacheTags: pageModule.cacheTags as never,
            componentType: route.componentType ?? "server",
            ...(pageModule.metadata !== undefined ? { metadata: pageModule.metadata } : {}),
          } as PageRuntimeOptions["pageModule"],
          layouts: loadedLayouts as PageRuntimeOptions["layouts"],
          params,
          request,
          loaderArgs,
          ...(route.type === "not-found" ? { statusCode: 404 } : {}),
          ...(metadataChain.length > 0 ? { metadataChain } : {}),
          componentType: route.componentType ?? "server",
          layoutKeys: route.layouts,
          renderMode: (
            isStaticBuildRequest
              ? pageModule.renderMode
              : pageModule.renderMode === "ssg"
                ? "ssr"
                : pageModule.renderMode
          ) as "ssr" | "ssg" | "isr" | "streaming" | undefined,
          strategyOptions: {
            staticDir: joinPath(config.rootDir, "static"),
          },
          transport: pageModule.renderMode === "streaming" ? "stream" : "html",
          ...(pageModule.hydration !== undefined
            ? { hydration: pageModule.hydration as PageRuntimeOptions["hydration"] }
            : {}),
          ...(loadingComponent !== undefined
            ? { loadingComponent: loadingComponent as PageRuntimeOptions["loadingComponent"] }
            : {}),
          ...(errorComponent !== undefined
            ? { errorComponent: errorComponent as PageRuntimeOptions["errorComponent"] }
            : {}),
          diagnostics: mergeRuntimeDiagnostics(diagnostics, requestDiagnostics),
        } as PageRuntimeOptions;

        const pageResult = await runPageRuntime(pageRuntimeOptions);
        const responseHeaders = {
          ...pageResult.headers,
          ...runtimeDiagnosticsHeaders(pageResult.diagnostics ?? []),
        };

        if (pageResult.kind === "navigation") {
          return new Response(pageResult.body, {
            status: pageResult.statusCode,
            headers: responseHeaders,
          });
        }

        if (pageResult.transport === "stream") {
          const html = decoratePageHtml(
            await collectStreamToString(pageResult.stream),
            manifest,
          );
          return new Response(html, {
            status: pageResult.statusCode,
            headers: responseHeaders,
          });
        }

        const html = decoratePageHtml(pageResult.html, manifest);
        return new Response(html, {
          status: pageResult.statusCode,
          headers: responseHeaders,
        });
      };

      try {
        return await composeRouteMiddlewares(
          middlewareDefinitions,
          async ({ request, ctx }) => executePageRequest(),
        )({
          request,
          ctx,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal Server Error";
        console.error(`[capstan] Error in page ${route.urlPattern}:`, message);

        if (isNavRequest) {
          return new Response(
            JSON.stringify({ error: message }),
            {
              status: 500,
              headers: {
                "content-type": "application/json; charset=utf-8",
                ...runtimeDiagnosticsHeaders(diagnostics),
              },
            },
          );
        }

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(config.appName ?? "Capstan App")}</title>
</head>
<body>
  <div id="capstan-root">
    <h1>Page Render Error</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;

        return new Response(decoratePageHtml(html, manifest), {
          status: 500,
          headers: {
            "content-type": "text/html; charset=utf-8",
            ...runtimeDiagnosticsHeaders(diagnostics),
          },
        });
      }
    };
  };

  for (const route of [...pageRoutes, ...notFoundRoutes]) {
    const executePageRoute = await createPageRouteExecutor(route);
    if (!executePageRoute) {
      continue;
    }

    pageRouteExecutors.set(route.filePath, executePageRoute);

    if (route.type !== "page") {
      continue;
    }

    pageRouteCount++;

    app.get(route.urlPattern, async (c) => {
      const params: Record<string, string> = {};
      for (const name of route.params) {
        const value = c.req.param(name);
        if (value !== undefined) {
          params[name] = value;
        }
      }

      return executePageRoute({
        request: c.req.raw,
        params,
        ctx: createContext(c),
        isNavRequest: c.req.header("X-Capstan-Nav") === "1",
        isStaticBuildRequest: c.req.header("X-Capstan-Static-Build") === "1",
      });
    });
  }

  mountApprovalRoutes(app, handlerRegistry);

  if (ops) {
    const healthSnapshotInput: Parameters<CapstanOpsContext["recordHealthSnapshot"]>[0] = {
      appName: config.appName ?? "capstan-app",
      routeCount: routeRegistry.length,
      apiRouteCount,
      pageRouteCount,
      approvalCount: 0,
      ...(config.mode !== undefined ? { mode: config.mode } : {}),
      ...(config.policyRegistry !== undefined
        ? { policyCount: config.policyRegistry.size }
        : {}),
      ...(config.ops?.recentWindowMs !== undefined
        ? { recentWindowMs: config.ops.recentWindowMs }
        : {}),
      ...(config.auth?.session ? { notes: ["session-auth-enabled"] } : {}),
    };
    void ops.recordHealthSnapshot(healthSnapshotInput).catch(() => void 0);
  }

  app.get("/_capstan/client.js", () => {
    return new Response(CAPSTAN_CLIENT_BOOTSTRAP, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  });

  app.get("/_capstan/client/*", async (c) => {
    const assetPath = c.req.path.slice("/_capstan/client/".length);
    const asset = await config.assetProvider?.readClientAsset?.(assetPath);
    return (await serveProvidedAsset(asset ?? null)) ?? new Response("Not Found", { status: 404 });
  });

  app.get("/.well-known/capstan.json", (c) => {
    if (config.agentManifest) {
      return c.json(config.agentManifest);
    }

    const agentManifest = {
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
      capabilities: routeRegistry.map((route) => ({
        key: `${route.method} ${route.path}`,
        title: route.description ?? `${route.method} ${route.path}`,
        mode: (route.capability ?? "read") as "read" | "write" | "external",
        endpoint: {
          method: route.method,
          path: route.path,
          ...(route.inputSchema ? { inputSchema: route.inputSchema } : {}),
          ...(route.outputSchema ? { outputSchema: route.outputSchema } : {}),
        },
      })),
    };

    return c.json(agentManifest);
  });

  app.get("/openapi.json", (c) => {
    if (config.openApiSpec) {
      return c.json(config.openApiSpec);
    }

    const paths: Record<string, Record<string, object>> = {};
    for (const route of routeRegistry) {
      const pathKey = route.path.replace(/:(\w+)/g, "{$1}").replace(/\*/g, "{path}");
      if (!paths[pathKey]) {
        paths[pathKey] = {};
      }
      paths[pathKey]![route.method.toLowerCase()] = {
        summary: route.description ?? `${route.method} ${route.path}`,
        operationId: `${route.method.toLowerCase()}_${route.path.replace(/[/:*]/g, "_").replace(/^_/, "")}`,
        responses: {
          "200": {
            description: "Successful response",
            ...(route.outputSchema
              ? { content: { "application/json": { schema: route.outputSchema } } }
              : {}),
          },
        },
        ...(route.inputSchema
          ? { requestBody: { content: { "application/json": { schema: route.inputSchema } } } }
          : {}),
      };
    }

    return c.json({
      openapi: "3.1.0",
      info: {
        title: config.appName ?? "capstan-app",
        description: config.appDescription ?? "",
        version: "0.3.0",
      },
      paths,
    });
  });

  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      uptime:
        typeof process !== "undefined" && typeof process.uptime === "function"
          ? process.uptime()
          : 0,
      timestamp: new Date().toISOString(),
    });
  });

  const agentPkg = await createA2AHelpers();

  app.get("/.well-known/agent.json", async (c) => {
    if (!agentPkg) {
      return c.json(
        { error: "@zauso-ai/capstan-agent not available — A2A disabled" },
        501,
      );
    }

    const card = agentPkg.generateA2AAgentCard(
      {
        name: config.appName ?? "capstan-app",
        ...(config.appDescription ? { description: config.appDescription } : {}),
        baseUrl: `http://${config.host ?? "localhost"}:${config.port ?? 3000}`,
      },
      routeRegistry,
    );
    return c.json(card as object);
  });

  app.post("/.well-known/a2a", async (c) => {
    if (!agentPkg) {
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
  });

  app.post("/.well-known/mcp", async (c) => {
    if (!agentPkg) {
      return c.json({
        protocol: "mcp",
        version: "1.0",
        name: config.appName ?? "capstan-app",
        tools: [],
        error: "@zauso-ai/capstan-agent not available",
      });
    }

    const tools = routeRegistry.map((route) => ({
      name: agentPkg.routeToToolName(route.method, route.path),
      description: route.description ?? `${route.method} ${route.path}`,
      method: route.method,
      path: route.path,
      inputSchema: route.inputSchema ?? { type: "object", properties: {} },
    }));

    return c.json({
      protocol: "mcp",
      version: "1.0",
      name: config.appName ?? "capstan-app",
      tools,
    });
  });

  app.get("*", async (c) => {
    const urlPath = new URL(c.req.url).pathname;
    const publicAsset = await config.assetProvider?.readPublicAsset?.(urlPath);
    const assetResponse = await serveProvidedAsset(publicAsset ?? null);
    if (assetResponse) {
      return assetResponse;
    }

    if (shouldRenderNotFoundPage(c.req.raw)) {
      const matched = matchRoute(manifest, "GET", urlPath);
      if (matched?.route.type === "not-found") {
        const executePageRoute = pageRouteExecutors.get(matched.route.filePath);
        if (executePageRoute) {
          return executePageRoute({
            request: c.req.raw,
            params: matched.params,
            ctx: createContext(c),
            isNavRequest: c.req.header("X-Capstan-Nav") === "1",
            isStaticBuildRequest: c.req.header("X-Capstan-Static-Build") === "1",
          });
        }
      }
    }

    return c.notFound();
  });

  return {
    app,
    apiRouteCount,
    pageRouteCount,
    routeRegistry,
    diagnostics,
  } as RuntimeAppBuild & { diagnostics: RuntimeDiagnostic[] };
}

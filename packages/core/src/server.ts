import { Hono } from "hono";
import type { Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { toJSONSchema } from "zod";
import { clearAPIRegistry } from "./api.js";
import { createContext } from "./context.js";
import { enforcePolicies } from "./policy.js";
import { createApproval } from "./approval.js";
import { mountApprovalRoutes } from "./approval-routes.js";
import { createRequestLogger } from "./logger.js";
import { createCapstanOpsContext, type CapstanOpsContext } from "./ops.js";
import { recordAuditEntry, getAuditLog } from "./compliance.js";
import type { RiskLevel } from "./compliance.js";
import { buildAuditAuthSnapshot, hasAuthGrant } from "./authz.js";
import { counter, histogram, serializeMetrics } from "./metrics.js";
import type {
  APIDefinition,
  CapstanAuthContext,
  CapstanConfig,
  CapstanContext,
  HttpMethod,
  PolicyDefinition,
  RouteMetadata,
} from "./types.js";

/** Hono env binding that carries the CapstanContext through middleware. */
interface CapstanEnv {
  Variables: {
    capstanCtx: CapstanContext;
    capstanOps?: CapstanOpsContext;
    capstanRequestId?: string;
    capstanTraceId?: string;
  };
}

export interface CapstanApp {
  /** The underlying Hono application instance. */
  app: Hono<CapstanEnv>;
  /** All registered route metadata — used by the agent manifest endpoint. */
  routeRegistry: RouteMetadata[];
  /**
   * Register an API definition on the Hono app at the given method + path.
   *
   * This both mounts the HTTP handler and records metadata in `routeRegistry`
   * so the `/.well-known/capstan.json` manifest stays in sync.
   */
  registerAPI: (
    method: HttpMethod,
    path: string,
    apiDef: APIDefinition,
    policies?: PolicyDefinition[],
  ) => void;
}

/**
 * Build a RouteMetadata entry, omitting keys whose value would be undefined
 * (required by exactOptionalPropertyTypes).
 */
function buildRouteMetadata(
  method: HttpMethod,
  path: string,
  apiDef: APIDefinition,
  inputSchema: Record<string, unknown> | undefined,
  outputSchema: Record<string, unknown> | undefined,
): RouteMetadata {
  const meta: RouteMetadata = { method, path };
  if (apiDef.description !== undefined) meta.description = apiDef.description;
  if (apiDef.capability !== undefined) meta.capability = apiDef.capability;
  if (apiDef.resource !== undefined) meta.resource = apiDef.resource;
  if (apiDef.policy !== undefined) meta.policy = apiDef.policy;
  if (inputSchema !== undefined) meta.inputSchema = inputSchema;
  if (outputSchema !== undefined) meta.outputSchema = outputSchema;
  return meta;
}

/**
 * Create a fully-wired Capstan application backed by a Hono server.
 *
 * The returned object contains:
 * - `app`           -- Hono instance ready to handle requests
 * - `routeRegistry` -- array of route metadata for the agent manifest
 * - `registerAPI()` -- helper to register an API definition as an HTTP route
 */
export async function createCapstanApp(config: CapstanConfig): Promise<CapstanApp> {
  // Reset the global API registry so that previous app instances (e.g. from
  // hot reload or prior test cases) don't leak stale definitions.
  clearAPIRegistry();

  const app = new Hono<CapstanEnv>();
  const routeRegistry: RouteMetadata[] = [];
  const ops = createCapstanOpsContext(config.ops);

  /**
   * Handler registry keyed by "METHOD /path" so that approved requests can
   * re-execute the original handler without going through the HTTP stack.
   */
  const handlerRegistry = new Map<
    string,
    (input: unknown, ctx: CapstanContext, params: Record<string, string>) => Promise<unknown>
  >();

  // ------------------------------------------------------------------
  // Global middleware
  // ------------------------------------------------------------------

  // CORS -- allow all origins by default (production apps override via config).
  app.use("*", cors());

  if (ops) {
    app.use("*", async (c, next) => {
      c.set("capstanOps", ops);
      await next();
    });
  }

  app.use("*", createRequestLogger({ ops }));

  // Inject CapstanContext into every request so handlers can retrieve it.
  app.use("*", async (c, next) => {
    const ctx = createContext(c as unknown as HonoContext);
    c.set("capstanCtx", ctx);
    await next();
  });

  // Request metrics middleware — counts requests and records duration.
  const reqCounter = counter("capstan_http_requests_total");
  const reqDuration = histogram("capstan_http_request_duration_ms");

  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const durationMs = Date.now() - start;
    const method = c.req.method;
    const status = String(c.res.status);
    reqCounter.inc({ method, status });
    reqDuration.observe({ method }, durationMs);
  });

  // ------------------------------------------------------------------
  // Prometheus-compatible metrics endpoint
  // ------------------------------------------------------------------

  app.get("/metrics", (c) => {
    return c.text(serializeMetrics());
  });

  // ------------------------------------------------------------------
  // registerAPI -- mount a route + track metadata
  // ------------------------------------------------------------------

  const registerAPI: CapstanApp["registerAPI"] = (
    method,
    path,
    apiDef,
    policies,
  ) => {
    // --- record metadata ------------------------------------------------
    let inputSchema: Record<string, unknown> | undefined;
    let outputSchema: Record<string, unknown> | undefined;

    try {
      if (apiDef.input) {
        inputSchema = toJSONSchema(apiDef.input) as Record<string, unknown>;
      }
    } catch {
      // Schema conversion is best-effort; silently ignore failures.
    }

    try {
      if (apiDef.output) {
        outputSchema = toJSONSchema(apiDef.output) as Record<string, unknown>;
      }
    } catch {
      // Best-effort.
    }

    routeRegistry.push(
      buildRouteMetadata(method, path, apiDef, inputSchema, outputSchema),
    );

    // Store the handler so approved requests can re-execute it.
    const routeKey = `${method} ${path}`;
    handlerRegistry.set(routeKey, async (input: unknown, ctx: CapstanContext, params: Record<string, string>) => {
      return apiDef.handler({ input, ctx, params });
    });

    // --- mount on Hono --------------------------------------------------
    const honoHandler = async (c: HonoContext<CapstanEnv>) => {
      const ctx = c.get("capstanCtx");
      const startTime = Date.now();

      // Parse input once — reused by both policy enforcement and the handler.
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

      // Policy enforcement
      if (policies && policies.length > 0) {
        const policyResult = await enforcePolicies(policies, ctx, input);
        if (policyResult.effect === "deny") {
          return c.json(
            { error: "Forbidden", reason: policyResult.reason ?? "Policy denied" },
            403,
          );
        }
        if (policyResult.effect === "approve") {
          const reason =
            policyResult.reason ?? "This action requires approval";
          const approval = await createApproval({
            method,
            path,
            input,
            params: c.req.param() as Record<string, string>,
            policy: policies.map((p) => p.key).join(", "),
            reason,
            ctx,
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

      // Determine whether this route requires audit logging.
      const compliance = apiDef.compliance;
      const shouldAudit =
        compliance?.auditLog === true || compliance?.riskLevel === "high";

      // Run handler (which already includes input/output validation)
      try {
        if (ops) {
          await ops.recordCapabilityInvocation({
            ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
            ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
            phase: "start",
            data: {
              method,
              path,
              ...(apiDef.capability ? { capability: apiDef.capability } : {}),
              ...(apiDef.resource ? { resource: apiDef.resource } : {}),
            },
          });
        }
        const params = c.req.param() as Record<string, string>;
        const result = await apiDef.handler({ input, ctx, params });

        if (ops) {
          await ops.recordCapabilityInvocation({
            ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
            ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
            phase: "end",
            data: {
              method,
              path,
              ...(apiDef.capability ? { capability: apiDef.capability } : {}),
              ...(apiDef.resource ? { resource: apiDef.resource } : {}),
              status: 200,
              durationMs: Date.now() - startTime,
              outcome: "success",
            },
          });
        }

        if (shouldAudit) {
          const entry: Parameters<typeof recordAuditEntry>[0] = {
            timestamp: new Date().toISOString(),
            requestId: ctx.requestId ?? crypto.randomUUID(),
            method,
            path,
            riskLevel: compliance?.riskLevel ?? ("minimal" as RiskLevel),
            auth: buildAuditAuthSnapshot(ctx.auth),
            input,
            output: result,
            durationMs: Date.now() - startTime,
          };
          if (compliance?.transparency !== undefined) {
            entry.transparency = compliance.transparency;
          }
          await recordAuditEntry(entry);
        }

        return c.json(result as object);
      } catch (err: unknown) {
        if (ops) {
          await ops.recordCapabilityInvocation({
            ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
            ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
            phase: "end",
            data: {
              method,
              path,
              ...(apiDef.capability ? { capability: apiDef.capability } : {}),
              ...(apiDef.resource ? { resource: apiDef.resource } : {}),
              status: 500,
              durationMs: Date.now() - startTime,
              outcome: "failure",
            },
            incidentFingerprint: `capability:${method}:${path}:5xx`,
          });
        }
        // Zod validation errors
        if (
          err != null &&
          typeof err === "object" &&
          "issues" in err &&
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

        // Generic errors
        const message =
          err instanceof Error ? err.message : "Internal Server Error";
        return c.json({ error: message }, 500);
      }
    };

    // Register the handler on the correct HTTP method.
    const lowerMethod = method.toLowerCase() as
      | "get"
      | "post"
      | "put"
      | "delete"
      | "patch";
    (app[lowerMethod] as (path: string, handler: typeof honoHandler) => void)(
      path,
      honoHandler,
    );

    if (ops) {
      void ops.recordHealthSnapshot({
        appName: config.app?.name ?? config.app?.title ?? "capstan-app",
        mode: config.server ? "production" : "development",
        routeCount: routeRegistry.length,
        apiRouteCount: routeRegistry.length,
        pageRouteCount: 0,
        policyCount: policies?.length ?? 0,
        approvalCount: 0,
        ...(config.ops?.recentWindowMs !== undefined
          ? { recentWindowMs: config.ops.recentWindowMs }
          : {}),
      }).catch(() => void 0);
    }
  };

  // ------------------------------------------------------------------
  // Approval management endpoints
  // ------------------------------------------------------------------

  mountApprovalRoutes(app, handlerRegistry);

  // ------------------------------------------------------------------
  // Audit log endpoint
  // ------------------------------------------------------------------

  app.get("/capstan/audit", async (c: HonoContext) => {
    const auth = c.get("capstanAuth") as CapstanAuthContext | undefined;

    if (!auth || !auth.isAuthenticated) {
      return c.json(
        { error: "Authentication required to read audit log" },
        401,
      );
    }

    const isAdmin = auth.role === "admin";
    const hasPermission = hasAuthGrant(auth, { resource: "audit", action: "read" });

    if (!isAdmin && !hasPermission) {
      return c.json(
        { error: "Forbidden: audit:read permission required" },
        403,
      );
    }

    const url = new URL(c.req.url);
    const since = url.searchParams.get("since") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const opts: { since?: string; limit?: number } = {};
    if (since !== undefined) opts.since = since;
    if (limit !== undefined && !Number.isNaN(limit)) opts.limit = limit;

    const entries = await getAuditLog(Object.keys(opts).length > 0 ? opts : undefined);
    return c.json({ entries });
  });

  // ------------------------------------------------------------------
  // Agent manifest endpoint
  // ------------------------------------------------------------------

  app.get("/.well-known/capstan.json", (c) => {
    c.header("Cache-Control", "public, max-age=5");
    const manifest = {
      name: config.app?.name ?? "capstan-app",
      title: config.app?.title ?? config.app?.name ?? "Capstan App",
      description: config.app?.description ?? "",
      routes: routeRegistry,
    };
    return c.json(manifest);
  });

  // --- Load plugins -------------------------------------------------------
  if (config.plugins) {
    for (const plugin of config.plugins) {
      const ctx = {
        addRoute(method: string, path: string, handler: unknown) {
          const entry: (typeof routeRegistry)[number] = { method: method as HttpMethod, path };
          if (
            handler &&
            typeof handler === "object" &&
            "description" in handler
          ) {
            const h = handler as Record<string, unknown>;
            if (h["description"] !== undefined)
              entry.description = h["description"] as string;
            if (h["capability"] !== undefined)
              entry.capability = h["capability"] as "read" | "write" | "external";
          }
          routeRegistry.push(entry);
          // Mount the handler on the Hono app
          const m = method.toLowerCase() as "get" | "post" | "put" | "delete" | "patch";
          if (typeof handler === "function") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (app as any)[m](path, handler);
          }
        },
        addPolicy(_policy: unknown) {
          // Policies are referenced by key in defineAPI, stored externally
        },
        addMiddleware(path: string, middleware: unknown) {
          if (
            middleware &&
            typeof middleware === "object" &&
            "handler" in middleware
          ) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mw = middleware as { handler: (args: any) => Promise<unknown> };
            app.use(path, async (c, next) => {
              await mw.handler({ ctx: c, next });
            });
          }
        },
        config: config as unknown as Record<string, unknown>,
      };
      await plugin.setup(ctx);
    }
  }

  return { app, routeRegistry, registerAPI };
}

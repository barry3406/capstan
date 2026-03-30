import { Hono } from "hono";
import type { Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { toJSONSchema } from "zod";
import { clearAPIRegistry } from "./api.js";
import { createContext } from "./context.js";
import { enforcePolicies } from "./policy.js";
import { createApproval } from "./approval.js";
import { mountApprovalRoutes } from "./approval-routes.js";
import { recordAuditEntry, getAuditLog } from "./compliance.js";
import type { RiskLevel } from "./compliance.js";
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
export function createCapstanApp(config: CapstanConfig): CapstanApp {
  // Reset the global API registry so that previous app instances (e.g. from
  // hot reload or prior test cases) don't leak stale definitions.
  clearAPIRegistry();

  const app = new Hono<CapstanEnv>();
  const routeRegistry: RouteMetadata[] = [];

  /**
   * Handler registry keyed by "METHOD /path" so that approved requests can
   * re-execute the original handler without going through the HTTP stack.
   */
  const handlerRegistry = new Map<
    string,
    (input: unknown, ctx: CapstanContext) => Promise<unknown>
  >();

  // ------------------------------------------------------------------
  // Global middleware
  // ------------------------------------------------------------------

  // CORS -- allow all origins by default (production apps override via config).
  app.use("*", cors());

  // Inject CapstanContext into every request so handlers can retrieve it.
  app.use("*", async (c, next) => {
    const ctx = createContext(c as unknown as HonoContext);
    c.set("capstanCtx", ctx);
    await next();
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
    handlerRegistry.set(routeKey, async (input: unknown, ctx: CapstanContext) => {
      return apiDef.handler({ input, ctx, params: {} });
    });

    // --- mount on Hono --------------------------------------------------
    const honoHandler = async (c: HonoContext<CapstanEnv>) => {
      const ctx = c.get("capstanCtx");

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
            policy: policies.map((p) => p.key).join(", "),
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

      // Determine whether this route requires audit logging.
      const compliance = apiDef.compliance;
      const shouldAudit =
        compliance?.auditLog === true || compliance?.riskLevel === "high";

      // Run handler (which already includes input/output validation)
      const startTime = shouldAudit ? Date.now() : 0;
      try {
        const params = c.req.param() as Record<string, string>;
        const result = await apiDef.handler({ input, ctx, params });

        if (shouldAudit) {
          const authBag: { type: string; userId?: string; agentId?: string } = {
            type: ctx.auth.type,
          };
          if (ctx.auth.userId !== undefined) authBag.userId = ctx.auth.userId;
          if (ctx.auth.agentId !== undefined) authBag.agentId = ctx.auth.agentId;

          const entry: Parameters<typeof recordAuditEntry>[0] = {
            timestamp: new Date().toISOString(),
            requestId: crypto.randomUUID(),
            method,
            path,
            riskLevel: compliance?.riskLevel ?? ("minimal" as RiskLevel),
            auth: authBag,
            input,
            output: result,
            durationMs: Date.now() - startTime,
          };
          if (compliance?.transparency !== undefined) {
            entry.transparency = compliance.transparency;
          }
          recordAuditEntry(entry);
        }

        return c.json(result as object);
      } catch (err: unknown) {
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
  };

  // ------------------------------------------------------------------
  // Approval management endpoints
  // ------------------------------------------------------------------

  mountApprovalRoutes(app, handlerRegistry);

  // ------------------------------------------------------------------
  // Audit log endpoint
  // ------------------------------------------------------------------

  app.get("/capstan/audit", (c: HonoContext) => {
    const auth = c.get("capstanAuth") as CapstanAuthContext | undefined;

    if (!auth || !auth.isAuthenticated) {
      return c.json(
        { error: "Authentication required to read audit log" },
        401,
      );
    }

    const perms: string[] = auth.permissions ?? [];
    const isAdmin = auth.role === "admin";
    const hasPermission = perms.includes("audit:read");

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

    const entries = getAuditLog(Object.keys(opts).length > 0 ? opts : undefined);
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

  return { app, routeRegistry, registerAPI };
}

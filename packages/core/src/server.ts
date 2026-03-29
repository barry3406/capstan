import { Hono } from "hono";
import type { Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { toJSONSchema } from "zod";
import { createContext } from "./context.js";
import { enforcePolicies } from "./policy.js";
import {
  createApproval,
  getApproval,
  listApprovals,
  resolveApproval,
} from "./approval.js";
import type {
  APIDefinition,
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
      return apiDef.handler({ input, ctx });
    });

    // --- mount on Hono --------------------------------------------------
    const honoHandler = async (c: HonoContext<CapstanEnv>) => {
      const ctx = createContext(c as unknown as HonoContext);

      // Policy enforcement
      if (policies && policies.length > 0) {
        let rawInput: unknown;
        try {
          rawInput =
            method === "GET"
              ? Object.fromEntries(new URL(c.req.url).searchParams)
              : await c.req.json();
        } catch {
          rawInput = undefined;
        }

        const policyResult = await enforcePolicies(policies, ctx, rawInput);
        if (policyResult.effect === "deny") {
          return c.json(
            { error: "Forbidden", reason: policyResult.reason ?? "Policy denied" },
            403,
          );
        }
        if (policyResult.effect === "approve") {
          const reason =
            policyResult.reason ?? "This action requires approval";
          const approval = createApproval({
            method,
            path,
            input: rawInput,
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

      // Parse input
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

      // Run handler (which already includes input/output validation)
      try {
        const result = await apiDef.handler({ input, ctx });
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

  /** List all approvals, optionally filtered by ?status=pending|approved|denied */
  app.get("/capstan/approvals", (c) => {
    const statusParam = new URL(c.req.url).searchParams.get("status") as
      | "pending"
      | "approved"
      | "denied"
      | null;
    const items = listApprovals(statusParam ?? undefined);
    return c.json({ approvals: items });
  });

  /** Get a single approval by ID */
  app.get("/capstan/approvals/:id", (c) => {
    const id = c.req.param("id");
    const approval = getApproval(id);
    if (!approval) {
      return c.json({ error: "Approval not found" }, 404);
    }
    return c.json(approval);
  });

  /** Approve a pending approval — re-executes the original handler */
  app.post("/capstan/approvals/:id/approve", async (c) => {
    const id = c.req.param("id");
    const existing = getApproval(id);
    if (!existing) {
      return c.json({ error: "Approval not found" }, 404);
    }
    if (existing.status !== "pending") {
      return c.json(
        { error: "Approval already resolved", status: existing.status },
        409,
      );
    }

    // Parse optional body for resolvedBy
    let resolvedBy: string | undefined;
    try {
      const body = await c.req.json() as Record<string, unknown>;
      if (typeof body.resolvedBy === "string") {
        resolvedBy = body.resolvedBy;
      }
    } catch {
      // No body or invalid JSON — that's fine.
    }

    const approval = resolveApproval(id, "approved", resolvedBy);
    if (!approval) {
      return c.json({ error: "Approval not found" }, 404);
    }

    // Re-execute the original handler with the stored input.
    const routeKey = `${approval.method} ${approval.path}`;
    const handler = handlerRegistry.get(routeKey);
    if (!handler) {
      return c.json(
        { error: "Handler not found for route", route: routeKey },
        500,
      );
    }

    try {
      // Build a synthetic context for the approver.
      const ctx = createContext(c as unknown as HonoContext);
      const result = await handler(approval.input, ctx);
      approval.result = result;
      return c.json({
        status: "approved",
        approvalId: approval.id,
        result,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Handler execution failed";
      return c.json({ error: message, approvalId: approval.id }, 500);
    }
  });

  /** Deny a pending approval */
  app.post("/capstan/approvals/:id/deny", async (c) => {
    const id = c.req.param("id");
    const existing = getApproval(id);
    if (!existing) {
      return c.json({ error: "Approval not found" }, 404);
    }
    if (existing.status !== "pending") {
      return c.json(
        { error: "Approval already resolved", status: existing.status },
        409,
      );
    }

    let resolvedBy: string | undefined;
    let reason: string | undefined;
    try {
      const body = await c.req.json() as Record<string, unknown>;
      if (typeof body.resolvedBy === "string") {
        resolvedBy = body.resolvedBy;
      }
      if (typeof body.reason === "string") {
        reason = body.reason;
      }
    } catch {
      // No body or invalid JSON — that's fine.
    }

    const approval = resolveApproval(id, "denied", resolvedBy);
    if (!approval) {
      return c.json({ error: "Approval not found" }, 404);
    }

    return c.json({
      status: "denied",
      approvalId: approval.id,
      ...(reason !== undefined ? { reason } : {}),
    });
  });

  // ------------------------------------------------------------------
  // Agent manifest endpoint
  // ------------------------------------------------------------------

  app.get("/.well-known/capstan.json", (c) => {
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

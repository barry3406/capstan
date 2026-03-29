import { Hono } from "hono";
import type { Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { toJSONSchema } from "zod";
import { createContext } from "./context.js";
import { enforcePolicies } from "./policy.js";
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
          return c.json(
            {
              error: "Approval required",
              reason: policyResult.reason ?? "This action requires approval",
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

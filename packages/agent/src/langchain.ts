import type { RouteRegistryEntry } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import { routeToToolName } from "./mcp.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * LangChain DynamicTool-compatible definition.
 *
 * This interface mirrors LangChain's tool format so consumers can pass these
 * directly to LangChain agents without importing LangChain as a dependency
 * of this package.
 */
export interface LangChainToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  schema: Record<string, unknown>;
  /** Execute the tool — calls the Capstan API over HTTP. */
  func: (input: string | Record<string, unknown>) => Promise<string>;
}

export interface ToLangChainOptions {
  /** Base URL of the running Capstan server (e.g. "http://localhost:3000"). */
  baseUrl: string;
  /** Value for the Authorization header (e.g. "Bearer <token>"). */
  authorization?: string;
  /** Only include routes whose capability matches one of these values. */
  capabilities?: ("read" | "write")[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** HTTP methods that carry a request body. */
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Build a human-readable tool description from a route entry.
 */
function buildDescription(route: RouteRegistryEntry): string {
  if (route.description) {
    return route.description;
  }
  return `${route.method.toUpperCase()} ${route.path}`;
}

/**
 * Build the JSON Schema that describes the tool's input.
 *
 * If the route already carries an `inputSchema` we return it as-is
 * (it is already JSON Schema).  Otherwise we return a permissive
 * empty-object schema.
 */
function buildInputJsonSchema(
  route: RouteRegistryEntry,
): Record<string, unknown> {
  if (route.inputSchema) {
    return { ...route.inputSchema };
  }
  return { type: "object", properties: {} };
}

/**
 * Construct the URL for a GET request, appending `input` as query parameters.
 */
function buildGetUrl(
  base: string,
  path: string,
  input: Record<string, unknown>,
): string {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Determine whether a route should be included given the capability filter.
 */
function matchesCapabilities(
  route: RouteRegistryEntry,
  capabilities: ("read" | "write")[] | undefined,
): boolean {
  if (!capabilities || capabilities.length === 0) {
    return true;
  }
  // Routes without an explicit capability are included only when no filter
  // is specified (handled above).  When a filter IS specified, the route
  // must declare a matching capability.
  if (!route.capability) {
    return false;
  }
  return (capabilities as readonly string[]).includes(route.capability);
}

/**
 * Normalise the `input` argument that LangChain passes to `func`.
 *
 * LangChain may send either a JSON string or an object depending on the
 * agent implementation, so we handle both.
 */
function normaliseInput(input: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof input === "string") {
    if (input.trim() === "") {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(input);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  return input;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a {@link CapabilityRegistry} into an array of LangChain-compatible
 * tool definitions.
 *
 * Each tool invokes the corresponding Capstan API endpoint over HTTP when
 * called, so the Capstan server must be running at `options.baseUrl`.
 *
 * @param registry - The Capstan capability registry.
 * @param options  - Connection and filtering options.
 * @returns An array of tool definitions ready to hand to a LangChain agent.
 */
export function toLangChainTools(
  registry: CapabilityRegistry,
  options: ToLangChainOptions,
): LangChainToolDefinition[] {
  const { baseUrl, authorization, capabilities } = options;
  const routes = registry.getRoutes();
  const tools: LangChainToolDefinition[] = [];

  for (const route of routes) {
    if (!matchesCapabilities(route, capabilities)) {
      continue;
    }

    const name = routeToToolName(route.method, route.path);
    const description = buildDescription(route);
    const schema = buildInputJsonSchema(route);
    const method = route.method.toUpperCase();

    const func = async (
      rawInput: string | Record<string, unknown>,
    ): Promise<string> => {
      const input = normaliseInput(rawInput);

      const headers: Record<string, string> = {};
      if (authorization) {
        headers["Authorization"] = authorization;
      }

      let response: Response;

      if (BODY_METHODS.has(method)) {
        headers["Content-Type"] = "application/json";
        response = await fetch(new URL(route.path, baseUrl).toString(), {
          method,
          headers,
          body: JSON.stringify(input),
        });
      } else {
        // GET / HEAD — pass input as query parameters.
        response = await fetch(buildGetUrl(baseUrl, route.path, input), {
          method,
          headers,
        });
      }

      const text = await response.text();
      return text;
    };

    tools.push({ name, description, schema, func });
  }

  return tools;
}

/**
 * Generate LangChain-compatible tool specifications (metadata only, no
 * executable function).
 *
 * Useful for sending tool definitions over the wire or for inspection
 * without needing a live server connection.
 *
 * @param registry - The Capstan capability registry.
 * @returns An array of tool spec objects.
 */
export function toLangChainToolSpecs(
  registry: CapabilityRegistry,
): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  const routes = registry.getRoutes();
  const specs: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> = [];

  for (const route of routes) {
    specs.push({
      name: routeToToolName(route.method, route.path),
      description: buildDescription(route),
      parameters: buildInputJsonSchema(route),
    });
  }

  return specs;
}

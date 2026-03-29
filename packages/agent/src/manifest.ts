import type { AgentConfig, AgentManifest, RouteRegistryEntry } from "./types.js";

/**
 * Derive a camelCase capability key from an HTTP method and URL path.
 *
 * Examples:
 *   GET  /tickets        -> "listTickets"
 *   GET  /tickets/:id    -> "getTicket"
 *   POST /tickets        -> "createTicket"
 *   PUT  /tickets/:id    -> "updateTicket"
 *   DELETE /tickets/:id  -> "deleteTicket"
 *   PATCH /tickets/:id   -> "patchTicket"
 */
function deriveCapabilityKey(method: string, path: string): string {
  // Extract the meaningful path segments, stripping parameter placeholders
  const segments = path
    .split("/")
    .filter((s) => s.length > 0 && !s.startsWith(":") && !s.startsWith("{"));

  const hasParam =
    path.includes(":") || path.includes("{");

  // Build the base noun from the path segments
  const noun = segments.map((s) => capitalize(s)).join("");

  const upperMethod = method.toUpperCase();

  if (upperMethod === "GET" && !hasParam) {
    // Collection read: GET /tickets -> listTickets
    return `list${noun}`;
  }
  if (upperMethod === "GET" && hasParam) {
    // Single resource read: GET /tickets/:id -> getTicket
    return `get${singularize(noun)}`;
  }
  if (upperMethod === "POST") {
    return `create${singularize(noun)}`;
  }
  if (upperMethod === "PUT") {
    return `update${singularize(noun)}`;
  }
  if (upperMethod === "DELETE") {
    return `delete${singularize(noun)}`;
  }
  if (upperMethod === "PATCH") {
    return `patch${singularize(noun)}`;
  }

  // Fallback: method + noun
  return `${method.toLowerCase()}${noun}`;
}

/** Simple singularization: strip trailing "s" if present. */
function singularize(word: string): string {
  if (word.endsWith("ies")) {
    return word.slice(0, -3) + "y";
  }
  if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes")) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/** Capitalize the first letter of a string. */
function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

/**
 * Convert a capability key to a human-readable title.
 *
 * "listTickets" -> "List Tickets"
 */
function humanize(key: string): string {
  // Insert spaces before uppercase letters and capitalize each word
  const words = key.replace(/([A-Z])/g, " $1").trim();
  return words[0]!.toUpperCase() + words.slice(1);
}

/**
 * Generate the Capstan agent manifest — a JSON document that describes
 * all API capabilities of the application for AI agent consumption.
 *
 * This is served at `/.well-known/capstan.json`.
 */
export function generateAgentManifest(
  config: AgentConfig,
  routes: RouteRegistryEntry[],
): AgentManifest {
  const capabilities: AgentManifest["capabilities"] = routes.map((route) => {
    const key = deriveCapabilityKey(route.method, route.path);
    return {
      key,
      title: route.description ?? humanize(key),
      ...(route.description !== undefined ? { description: route.description } : {}),
      mode: route.capability ?? "read",
      ...(route.resource !== undefined ? { resource: route.resource } : {}),
      endpoint: {
        method: route.method.toUpperCase(),
        path: route.path,
        ...(route.inputSchema !== undefined ? { inputSchema: route.inputSchema } : {}),
        ...(route.outputSchema !== undefined
          ? { outputSchema: route.outputSchema }
          : {}),
      },
      ...(route.policy !== undefined ? { policy: route.policy } : {}),
    };
  });

  const manifest: AgentManifest = {
    capstan: "1.0",
    name: config.name,
    ...(config.description !== undefined ? { description: config.description } : {}),
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    authentication: {
      schemes: [
        {
          type: "bearer",
          name: "API Key",
          header: "Authorization",
          description:
            "Bearer token for authenticating API requests. Include as: Authorization: Bearer <token>",
        },
      ],
    },
    resources: config.resources ?? [],
    capabilities,
    mcp: {
      endpoint: "/.well-known/mcp",
      transport: "stdio",
    },
  };

  return manifest;
}

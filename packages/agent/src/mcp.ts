import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { AgentConfig, RouteRegistryEntry } from "./types.js";

/**
 * Convert an HTTP method + URL path into a snake_case MCP tool name.
 *
 * Examples:
 *   GET  /tickets        -> "get_tickets"
 *   POST /tickets        -> "post_tickets"
 *   GET  /tickets/:id    -> "get_tickets_by_id"
 *   PUT  /tickets/:id    -> "put_tickets_by_id"
 *   DELETE /orgs/:orgId/members/:memberId -> "delete_orgs_by_orgId_members_by_memberId"
 */
export function routeToToolName(method: string, path: string): string {
  const prefix = method.toLowerCase();
  const segments = path.split("/").filter((s) => s.length > 0);

  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith(":")) {
      // Dynamic parameter: :id -> "by_id"
      parts.push("by_" + segment.slice(1));
    } else if (segment.startsWith("{") && segment.endsWith("}")) {
      // OpenAPI-style parameter: {id} -> "by_id"
      parts.push("by_" + segment.slice(1, -1));
    } else {
      parts.push(segment);
    }
  }

  return `${prefix}_${parts.join("_")}`;
}

/**
 * Build a tool description from a route.
 */
function buildToolDescription(route: RouteRegistryEntry): string {
  if (route.description) {
    return route.description;
  }
  return `${route.method.toUpperCase()} ${route.path}`;
}

/**
 * Create an MCP server that exposes all Capstan API routes as MCP tools.
 *
 * Each API route is registered as an MCP tool. Tool arguments sent by the
 * client are forwarded to the `executeRoute` callback so the actual Capstan
 * handler can process them.
 *
 * @param config - Application configuration.
 * @param routes - Registered API routes.
 * @param executeRoute - Callback that invokes the actual route handler.
 * @returns The McpServer instance and a helper to inspect tool definitions.
 */
export function createMcpServer(
  config: AgentConfig,
  routes: RouteRegistryEntry[],
  executeRoute: (
    method: string,
    path: string,
    input: unknown,
  ) => Promise<unknown>,
): {
  server: McpServer;
  getToolDefinitions: () => Array<{
    name: string;
    description: string;
    inputSchema: unknown;
  }>;
} {
  const server = new McpServer({
    name: config.name,
    version: "1.0.0",
  });

  const toolDefinitions: Array<{
    name: string;
    description: string;
    inputSchema: unknown;
  }> = [];

  // A permissive Zod schema that accepts any object and passes all
  // properties through. This lets the MCP SDK forward client-supplied
  // arguments to our handler while avoiding the need to convert each
  // route's JSON Schema into a Zod type at registration time.
  const passthroughShape = { _input: z.unknown().optional() } as const;

  for (const route of routes) {
    const toolName = routeToToolName(route.method, route.path);
    const description = buildToolDescription(route);

    // Record the definition for introspection
    toolDefinitions.push({
      name: toolName,
      description,
      inputSchema: route.inputSchema ?? { type: "object", properties: {} },
    });

    // Register the tool with the MCP server.
    //
    // We use the `tool(name, description, paramsSchema, callback)` overload
    // with a minimal Zod shape so the SDK invokes `callback(args, extra)`.
    // The `passthroughShape` ensures the SDK parses the incoming arguments
    // as an object and hands them to us — we then forward them to the
    // actual route handler via `executeRoute`.
    server.tool(
      toolName,
      description,
      passthroughShape,
      async (args: Record<string, unknown>) => {
        // Forward all arguments (minus our synthetic _input marker) to the
        // route handler.  Agents will send the actual input properties
        // directly in the tool arguments object.
        const input = Object.keys(args).length > 0 ? args : undefined;
        const result = await executeRoute(route.method, route.path, input);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      },
    );
  }

  return {
    server,
    getToolDefinitions: () => [...toolDefinitions],
  };
}

/**
 * Connect an MCP server to stdio transport and start serving.
 *
 * This is the standard way to run a Capstan MCP server as a subprocess
 * that communicates over stdin/stdout.
 */
export async function serveMcpStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

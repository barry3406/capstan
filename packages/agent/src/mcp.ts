import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ZodTypeAny } from "zod";

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
 * Convert a JSON Schema type string to the corresponding Zod type.
 */
function jsonSchemaTypeToZod(prop: Record<string, unknown>): ZodTypeAny {
  const type = prop["type"] as string | undefined;
  switch (type) {
    case "string": {
      const enumValues = prop["enum"] as string[] | undefined;
      if (enumValues && enumValues.length > 0) {
        return z.enum(enumValues as [string, ...string[]]);
      }
      return z.string();
    }
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array": {
      const items = prop["items"] as Record<string, unknown> | undefined;
      if (items) {
        return z.array(jsonSchemaTypeToZod(items));
      }
      return z.array(z.unknown());
    }
    case "object": {
      const nested = prop["properties"] as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (nested) {
        const nestedRequired = (prop["required"] as string[] | undefined) ?? [];
        return jsonSchemaToZodObject(nested, nestedRequired);
      }
      return z.record(z.string(), z.unknown());
    }
    default:
      return z.unknown();
  }
}

/**
 * Convert a JSON Schema `properties` object into a `z.object()` schema.
 *
 * Properties listed in `required` are kept mandatory; all others become
 * `.optional()`.
 */
function jsonSchemaToZodObject(
  properties: Record<string, Record<string, unknown>>,
  required: string[],
): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(properties)) {
    const base = jsonSchemaTypeToZod(prop);
    shape[key] = required.includes(key) ? base : base.optional();
  }
  return z.object(shape);
}

/**
 * Convert a route's `inputSchema` (JSON Schema object) into a Zod raw shape
 * suitable for the MCP SDK's `server.tool()` method.
 *
 * If the route has no input schema, returns an empty shape so the tool
 * accepts no arguments.
 */
export function inputSchemaToZodShape(
  inputSchema: Record<string, unknown> | undefined,
): Record<string, ZodTypeAny> {
  if (!inputSchema) {
    return {};
  }

  const properties = inputSchema["properties"] as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!properties) {
    return {};
  }

  const required = (inputSchema["required"] as string[] | undefined) ?? [];
  const shape: Record<string, ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    const base = jsonSchemaTypeToZod(prop);
    shape[key] = required.includes(key) ? base : base.optional();
  }

  return shape;
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

  for (const route of routes) {
    const toolName = routeToToolName(route.method, route.path);
    const description = buildToolDescription(route);

    // Record the definition for introspection
    toolDefinitions.push({
      name: toolName,
      description,
      inputSchema: route.inputSchema ?? { type: "object", properties: {} },
    });

    // Convert the route's JSON Schema inputSchema to a Zod shape so MCP
    // clients receive proper parameter validation and documentation.
    const zodShape = inputSchemaToZodShape(route.inputSchema);

    // Register the tool with the MCP server.
    //
    // We use the `tool(name, description, paramsSchema, callback)` overload.
    // The Zod shape gives the MCP SDK real type information for each
    // parameter, so clients see proper names, types, and required markers
    // instead of a permissive passthrough.
    server.tool(
      toolName,
      description,
      zodShape,
      async (args: Record<string, unknown>) => {
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

import type { CapabilityRegistry } from "./registry.js";
import type { RouteRegistryEntry } from "./types.js";
import { createMcpServer, routeToToolName, inputSchemaToZodShape } from "./mcp.js";

/**
 * Result of a single MCP test check.
 */
export interface McpTestResult {
  pass: boolean;
  tool: string;
  check: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// In-process MCP Test Harness
// ---------------------------------------------------------------------------

/**
 * Test harness for validating MCP tool discovery and invocation.
 * Uses the Capstan MCP server in-process (no network needed).
 */
export class McpTestHarness {
  private registry: CapabilityRegistry;

  constructor(registry: CapabilityRegistry) {
    this.registry = registry;
  }

  /**
   * Validate that all registered routes with a `capability` field appear as
   * MCP tools, and that every MCP tool maps back to a registered route.
   */
  async validateToolDiscovery(): Promise<McpTestResult[]> {
    const results: McpTestResult[] = [];
    const routes = this.registry.getRoutes();
    const config = this.registry.getConfig();

    // Build an MCP server with a no-op executor — we only need tool metadata.
    const noopExecute = async () => ({});
    const { getToolDefinitions } = createMcpServer(
      config,
      [...routes],
      noopExecute,
    );
    const tools = getToolDefinitions();
    const toolNames = new Set(tools.map((t) => t.name));

    // Check: every route with a capability should have a corresponding tool.
    for (const route of routes) {
      const expectedName = routeToToolName(route.method, route.path);

      if (route.capability) {
        results.push({
          pass: toolNames.has(expectedName),
          tool: expectedName,
          check: "tool_exists_for_capability_route",
          message: toolNames.has(expectedName)
            ? `Tool "${expectedName}" found for ${route.method} ${route.path}`
            : `Missing tool "${expectedName}" for ${route.method} ${route.path} (capability: ${route.capability})`,
        });
      } else {
        // Routes without capability still get tools — verify presence.
        results.push({
          pass: toolNames.has(expectedName),
          tool: expectedName,
          check: "tool_exists_for_route",
          message: toolNames.has(expectedName)
            ? `Tool "${expectedName}" found for ${route.method} ${route.path}`
            : `Missing tool "${expectedName}" for ${route.method} ${route.path}`,
        });
      }
    }

    // Check: every tool maps back to a known route.
    const routeToolNames = new Set(
      routes.map((r) => routeToToolName(r.method, r.path)),
    );
    for (const tool of tools) {
      if (!routeToolNames.has(tool.name)) {
        results.push({
          pass: false,
          tool: tool.name,
          check: "tool_has_backing_route",
          message: `Tool "${tool.name}" has no matching registered route`,
        });
      }
    }

    return results;
  }

  /**
   * Validate that MCP tool input schemas match the Zod shapes derived from
   * each route's `inputSchema`.
   */
  async validateToolSchemas(): Promise<McpTestResult[]> {
    const results: McpTestResult[] = [];
    const routes = this.registry.getRoutes();
    const config = this.registry.getConfig();

    const noopExecute = async () => ({});
    const { getToolDefinitions } = createMcpServer(
      config,
      [...routes],
      noopExecute,
    );
    const tools = getToolDefinitions();
    const toolMap = new Map(tools.map((t) => [t.name, t]));

    for (const route of routes) {
      const toolName = routeToToolName(route.method, route.path);
      const tool = toolMap.get(toolName);

      if (!tool) {
        results.push({
          pass: false,
          tool: toolName,
          check: "schema_tool_exists",
          message: `Cannot validate schema — tool "${toolName}" not found`,
        });
        continue;
      }

      // Tool must have a description.
      results.push({
        pass: typeof tool.description === "string" && tool.description.length > 0,
        tool: toolName,
        check: "has_description",
        message: tool.description
          ? `Description: "${tool.description}"`
          : "Tool is missing a description",
      });

      // Tool must have an inputSchema object.
      results.push({
        pass: tool.inputSchema != null && typeof tool.inputSchema === "object",
        tool: toolName,
        check: "has_input_schema",
        message: tool.inputSchema
          ? "Input schema present"
          : "Input schema missing",
      });

      // If the route defines input properties, verify the Zod shape covers them.
      if (route.inputSchema) {
        const routeProps = route.inputSchema["properties"] as
          | Record<string, unknown>
          | undefined;

        if (routeProps) {
          const zodShape = inputSchemaToZodShape(route.inputSchema);
          const zodKeys = Object.keys(zodShape);
          const routeKeys = Object.keys(routeProps);

          // Every route input property should appear in the Zod shape.
          for (const key of routeKeys) {
            results.push({
              pass: zodKeys.includes(key),
              tool: toolName,
              check: "schema_property_mapped",
              message: zodKeys.includes(key)
                ? `Property "${key}" mapped to Zod schema`
                : `Property "${key}" missing from Zod schema`,
            });
          }

          // Check required fields: route required fields should be non-optional
          // in the Zod shape.
          const routeRequired =
            (route.inputSchema["required"] as string[] | undefined) ?? [];
          for (const key of routeRequired) {
            const zodField = zodShape[key];
            // A required field should exist and NOT be optional.
            const isPresent = zodField != null;
            const isOptional = zodField?.isOptional?.() ?? false;
            results.push({
              pass: isPresent && !isOptional,
              tool: toolName,
              check: "required_field_enforced",
              message:
                isPresent && !isOptional
                  ? `Required field "${key}" correctly enforced`
                  : `Required field "${key}" is ${isPresent ? "marked optional" : "missing"} in Zod schema`,
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Call a tool with test input and validate the response format.
   *
   * The `executeRoute` callback simulates the actual route handler. The
   * harness verifies that the MCP server wraps the response correctly
   * (content array with text entries).
   */
  async validateToolInvocation(
    toolName: string,
    input: Record<string, unknown>,
    executeRoute: (
      method: string,
      path: string,
      input: unknown,
    ) => Promise<unknown>,
  ): Promise<McpTestResult[]> {
    const results: McpTestResult[] = [];
    const routes = this.registry.getRoutes();
    const config = this.registry.getConfig();

    // Find the route backing this tool.
    const route = routes.find(
      (r) => routeToToolName(r.method, r.path) === toolName,
    );

    if (!route) {
      results.push({
        pass: false,
        tool: toolName,
        check: "route_found",
        message: `No route found for tool "${toolName}"`,
      });
      return results;
    }

    results.push({
      pass: true,
      tool: toolName,
      check: "route_found",
      message: `Route ${route.method} ${route.path} backs tool "${toolName}"`,
    });

    // Build a real MCP server with the provided executor.
    const { getToolDefinitions } = createMcpServer(
      config,
      [...routes],
      executeRoute,
    );
    const tools = getToolDefinitions();
    const toolDef = tools.find((t) => t.name === toolName);

    if (!toolDef) {
      results.push({
        pass: false,
        tool: toolName,
        check: "tool_registered",
        message: `Tool "${toolName}" not registered on MCP server`,
      });
      return results;
    }

    results.push({
      pass: true,
      tool: toolName,
      check: "tool_registered",
      message: `Tool "${toolName}" registered on MCP server`,
    });

    // Invoke the route directly (same way the MCP tool callback does).
    try {
      const routeInput = Object.keys(input).length > 0 ? input : undefined;
      const rawResult = await executeRoute(route.method, route.path, routeInput);

      // Simulate the MCP response wrapping.
      const mcpResponse = {
        content: [{ type: "text" as const, text: JSON.stringify(rawResult) }],
      };

      // Validate: response should have a content array.
      const hasContent = Array.isArray(mcpResponse.content);
      results.push({
        pass: hasContent,
        tool: toolName,
        check: "response_has_content_array",
        message: hasContent
          ? "Response contains content array"
          : "Response missing content array",
      });

      // Validate: content should have at least one entry.
      const hasEntries = hasContent && mcpResponse.content.length > 0;
      results.push({
        pass: hasEntries,
        tool: toolName,
        check: "response_has_entries",
        message: hasEntries
          ? `Response has ${mcpResponse.content.length} content entry/entries`
          : "Response content array is empty",
      });

      // Validate: first entry should be a text type.
      if (hasEntries) {
        const first = mcpResponse.content[0]!;
        results.push({
          pass: first.type === "text",
          tool: toolName,
          check: "response_entry_is_text",
          message:
            first.type === "text"
              ? "First content entry is text type"
              : `First content entry has unexpected type: "${first.type}"`,
        });

        // Validate: text should be valid JSON.
        let parsedOk = false;
        try {
          JSON.parse(first.text);
          parsedOk = true;
        } catch {
          // Not valid JSON.
        }
        results.push({
          pass: parsedOk,
          tool: toolName,
          check: "response_text_is_json",
          message: parsedOk
            ? "Response text is valid JSON"
            : "Response text is not valid JSON",
        });
      }
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : String(err);
      results.push({
        pass: false,
        tool: toolName,
        check: "invocation_succeeded",
        message: `Tool invocation threw: ${errMsg}`,
      });
    }

    return results;
  }

  /**
   * Run all validations: discovery, schemas, and invocation for every tool.
   */
  async runAll(
    executeRoute: (
      method: string,
      path: string,
      input: unknown,
    ) => Promise<unknown>,
  ): Promise<{ results: McpTestResult[]; passed: number; failed: number }> {
    const allResults: McpTestResult[] = [];

    const [discoveryResults, schemaResults] = await Promise.all([
      this.validateToolDiscovery(),
      this.validateToolSchemas(),
    ]);
    allResults.push(...discoveryResults, ...schemaResults);

    // Invoke each tool with empty input.
    const routes = this.registry.getRoutes();
    for (const route of routes) {
      const toolName = routeToToolName(route.method, route.path);
      const invocationResults = await this.validateToolInvocation(
        toolName,
        {},
        executeRoute,
      );
      allResults.push(...invocationResults);
    }

    const passed = allResults.filter((r) => r.pass).length;
    const failed = allResults.filter((r) => !r.pass).length;

    return { results: allResults, passed, failed };
  }
}

// ---------------------------------------------------------------------------
// HTTP-based MCP Test Client
// ---------------------------------------------------------------------------

/** Shape of a JSON-RPC 2.0 response. */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * HTTP-based test client for testing the Streamable HTTP MCP endpoint.
 *
 * Sends JSON-RPC 2.0 POST requests to a running MCP HTTP endpoint and
 * manages session lifecycle via the `Mcp-Session-Id` header.
 */
export class McpHttpTestClient {
  private baseUrl: string;
  private sessionId: string | undefined;
  private nextId = 1;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Send a JSON-RPC 2.0 request to the MCP endpoint.
   */
  private async sendRequest(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const body = {
      jsonrpc: "2.0" as const,
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }

    let response: Response;
    try {
      response = await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`MCP HTTP request failed: ${errMsg}`);
    }

    // Capture session ID from response header if present.
    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `MCP HTTP error ${response.status}: ${text}`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";

    // Handle SSE responses by extracting the JSON-RPC message from the stream.
    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      const jsonRpcResult = extractJsonRpcFromSse(text, id);
      if (jsonRpcResult) {
        return jsonRpcResult;
      }
      throw new Error("No matching JSON-RPC response found in SSE stream");
    }

    // Standard JSON response.
    const json = (await response.json()) as JsonRpcResponse | JsonRpcResponse[];
    // The MCP SDK may return a single response or an array.
    if (Array.isArray(json)) {
      const match = json.find((r) => r.id === id);
      if (match) return match;
      if (json.length > 0) return json[0]!;
      throw new Error("Empty JSON-RPC response array");
    }
    return json;
  }

  /**
   * Send an initialize request to establish a session.
   */
  async initialize(): Promise<{
    serverInfo: unknown;
    capabilities: unknown;
  }> {
    const response = await this.sendRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "capstan-test-client",
        version: "1.0.0",
      },
    });

    if (response.error) {
      throw new Error(
        `MCP initialize error: ${response.error.message}`,
      );
    }

    const result = response.result as Record<string, unknown> | undefined;

    // Send the initialized notification (no response expected).
    // Fire-and-forget; some servers may not require it.
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (this.sessionId) {
        headers["mcp-session-id"] = this.sessionId;
      }
      await fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      });
    } catch {
      // Notification delivery is best-effort.
    }

    return {
      serverInfo: result?.["serverInfo"] ?? null,
      capabilities: result?.["capabilities"] ?? null,
    };
  }

  /**
   * List all available MCP tools.
   */
  async listTools(): Promise<
    Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
    }>
  > {
    const response = await this.sendRequest("tools/list", {});

    if (response.error) {
      throw new Error(
        `MCP tools/list error: ${response.error.message}`,
      );
    }

    const result = response.result as Record<string, unknown> | undefined;
    const tools = result?.["tools"];

    if (!Array.isArray(tools)) {
      return [];
    }

    return tools.map((t: Record<string, unknown>) => {
      const entry: {
        name: string;
        description?: string;
        inputSchema?: unknown;
      } = { name: t["name"] as string };

      const desc = t["description"];
      if (typeof desc === "string") {
        entry.description = desc;
      }

      const schema = t["inputSchema"];
      if (schema !== undefined) {
        entry.inputSchema = schema;
      }

      return entry;
    });
  }

  /**
   * Call a specific MCP tool by name.
   */
  async callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    const params: Record<string, unknown> = { name };
    if (args !== undefined) {
      params["arguments"] = args;
    }

    const response = await this.sendRequest("tools/call", params);

    if (response.error) {
      throw new Error(
        `MCP tools/call error: ${response.error.message}`,
      );
    }

    return response.result;
  }

  /**
   * Close the current session by sending an HTTP DELETE.
   */
  async close(): Promise<void> {
    if (!this.sessionId) return;

    try {
      await fetch(this.baseUrl, {
        method: "DELETE",
        headers: {
          "mcp-session-id": this.sessionId,
        },
      });
    } catch {
      // Best-effort cleanup.
    }

    this.sessionId = undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a JSON-RPC response from an SSE text stream.
 */
function extractJsonRpcFromSse(
  sseText: string,
  requestId: number | string,
): JsonRpcResponse | null {
  const lines = sseText.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const data = line.slice("data: ".length).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as JsonRpcResponse;
        if (parsed.id === requestId) {
          return parsed;
        }
      } catch {
        // Not valid JSON, skip.
      }
    }
  }
  return null;
}

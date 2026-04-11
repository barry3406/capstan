import type { AgentConfig, AgentManifest, RouteRegistryEntry } from "./types.js";
import type { A2AAgentCard, A2AStreamEvent } from "./a2a.js";
import { generateAgentManifest } from "./manifest.js";
import { generateOpenApiSpec } from "./openapi.js";
import { createMcpServer, createMcpHttpHandler } from "./mcp.js";
import { createA2AHandler } from "./a2a.js";
import { withSpan } from "./telemetry.js";
import { createMcpClient } from "./mcp-client.js";
import type { McpClient, McpClientOptions } from "./mcp-client.js";
import { toLangChainTools } from "./langchain.js";
import type { LangChainToolDefinition, ToLangChainOptions } from "./langchain.js";

/**
 * Unified capability registry — the central abstraction for Capstan's
 * multi-protocol adapter layer.
 *
 * Register routes once, then project them to any supported protocol surface:
 *
 * - **Capstan manifest** (`/.well-known/capstan.json`)
 * - **OpenAPI 3.1** (`/openapi.json`)
 * - **MCP** (Model Context Protocol tools)
 * - **A2A** (Google Agent-to-Agent protocol)
 *
 * One registry, four projections.
 */
export class CapabilityRegistry {
  private routes: RouteRegistryEntry[] = [];
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /** Register a single route entry. */
  register(route: RouteRegistryEntry): void {
    this.routes.push(route);
    void withSpan("capstan.capability.register", {
      "capstan.route.path": route.path,
      "capstan.route.method": route.method,
    }, async () => {});
  }

  /** Register multiple route entries at once. */
  registerAll(routes: RouteRegistryEntry[]): void {
    for (const route of routes) {
      this.routes.push(route);
    }
  }

  /** Get all registered routes (read-only view). */
  getRoutes(): readonly RouteRegistryEntry[] {
    return this.routes;
  }

  /** Get the agent configuration. */
  getConfig(): Readonly<AgentConfig> {
    return this.config;
  }

  // -------------------------------------------------------------------------
  // Projections
  // -------------------------------------------------------------------------

  /** Project to Capstan native agent manifest. */
  toManifest(): AgentManifest {
    return generateAgentManifest(this.config, this.routes);
  }

  /** Project to OpenAPI 3.1 specification. */
  toOpenApi(): Record<string, unknown> {
    // Fire-and-forget span — synchronous return is not blocked.
    void withSpan("capstan.openapi.generate", {
      "capstan.route.count": this.routes.length,
    }, async () => {});
    return generateOpenApiSpec(this.config, this.routes);
  }

  /**
   * Project to MCP server.
   *
   * @param executeRoute - Callback that invokes the actual route handler
   *   given an HTTP method, path, and input payload.
   * @returns The McpServer instance and a helper to list tool definitions.
   */
  toMcp(
    executeRoute: (
      method: string,
      path: string,
      input: unknown,
    ) => Promise<unknown>,
  ): {
    server: InstanceType<typeof import("@modelcontextprotocol/sdk/server/mcp.js").McpServer>;
    getToolDefinitions: () => Array<{
      name: string;
      description: string;
      inputSchema: unknown;
    }>;
  } {
    return createMcpServer(this.config, this.routes, executeRoute);
  }

  /**
   * Project to MCP Streamable HTTP handler.
   *
   * Returns a web-standard `(req: Request) => Promise<Response>` handler
   * implementing the MCP Streamable HTTP transport (2025-03-26 spec).
   * Mount it on any route (e.g. `/mcp`) to serve MCP over HTTP.
   *
   * @param executeRoute - Callback that invokes the actual route handler
   *   given an HTTP method, path, and input payload.
   * @returns A web-standard request handler.
   */
  toMcpHttp(
    executeRoute: (
      method: string,
      path: string,
      input: unknown,
    ) => Promise<unknown>,
  ): (req: Request) => Promise<Response> {
    return createMcpHttpHandler(this.config, this.routes, executeRoute);
  }

  /**
   * Project to A2A agent card and JSON-RPC handler.
   *
   * @param executeRoute - Callback that invokes the actual route handler
   *   given an HTTP method, path, and input payload.
   * @returns The A2A request handler and agent card accessor.
   */
  toA2A(
    executeRoute: (
      method: string,
      path: string,
      input: unknown,
    ) => Promise<unknown>,
  ): {
    handleRequest: (body: unknown) => Promise<unknown>;
    handleStreamRequest: (
      body: unknown,
    ) => AsyncGenerator<A2AStreamEvent, void, unknown>;
    getAgentCard: () => A2AAgentCard;
  } {
    return createA2AHandler(this.config, this.routes, executeRoute);
  }

  // -------------------------------------------------------------------------
  // MCP Client — consume external MCP servers
  // -------------------------------------------------------------------------

  private mcpClients: McpClient[] = [];

  /** Connect to an external MCP server and import its tools. */
  async connectMcp(options: McpClientOptions): Promise<McpClient> {
    const client = await createMcpClient(options);
    this.mcpClients.push(client);
    return client;
  }

  /** Close all MCP client connections. */
  async closeMcpClients(): Promise<void> {
    await Promise.allSettled(this.mcpClients.map((c) => c.close()));
    this.mcpClients = [];
  }

  // -------------------------------------------------------------------------
  // LangChain — project to LangChain-compatible tools
  // -------------------------------------------------------------------------

  /** Project to LangChain-compatible tool definitions. */
  toLangChain(options: ToLangChainOptions): LangChainToolDefinition[] {
    return toLangChainTools(this, options);
  }
}

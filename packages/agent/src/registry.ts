import type { AgentConfig, AgentManifest, RouteRegistryEntry } from "./types.js";
import type { A2AAgentCard } from "./a2a.js";
import { generateAgentManifest } from "./manifest.js";
import { generateOpenApiSpec } from "./openapi.js";
import { createMcpServer } from "./mcp.js";
import { createA2AHandler } from "./a2a.js";

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
    getAgentCard: () => A2AAgentCard;
  } {
    return createA2AHandler(this.config, this.routes, executeRoute);
  }
}

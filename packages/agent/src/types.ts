/** Agent manifest describing all capabilities of a Capstan application for AI consumption. */
export interface AgentManifest {
  /** Manifest format version, e.g. "1.0". */
  capstan: string;
  /** Application name. */
  name: string;
  /** Optional human-readable description of the application. */
  description?: string;
  /** Base URL where the application is served. */
  baseUrl?: string;
  /** Authentication schemes the application accepts. */
  authentication: {
    schemes: Array<{
      type: "bearer";
      name: string;
      header: string;
      description: string;
    }>;
  };
  /** Domain resources the application manages. */
  resources: Array<{
    key: string;
    title: string;
    description?: string;
    fields: Record<
      string,
      { type: string; required?: boolean; enum?: string[] }
    >;
  }>;
  /** API capabilities (tools) exposed by the application. */
  capabilities: Array<{
    key: string;
    title: string;
    description?: string;
    mode: "read" | "write" | "external";
    resource?: string;
    endpoint: {
      method: string;
      path: string;
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
    };
    policy?: string;
  }>;
  /** MCP server configuration, if enabled. */
  mcp?: {
    endpoint: string;
    transport: string;
  };
}

/** An entry in the route registry used to generate agent surfaces. */
export interface RouteRegistryEntry {
  method: string;
  path: string;
  description?: string;
  capability?: "read" | "write" | "external";
  resource?: string;
  policy?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

/** Configuration for the agent surface layer. */
export interface AgentConfig {
  name: string;
  description?: string;
  baseUrl?: string;
  resources?: Array<{
    key: string;
    title: string;
    description?: string;
    fields: Record<
      string,
      { type: string; required?: boolean; enum?: string[] }
    >;
  }>;
}

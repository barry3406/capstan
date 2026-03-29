import { describe, it, expect } from "bun:test";
import {
  generateAgentManifest,
  generateOpenApiSpec,
  createMcpServer,
  routeToToolName,
} from "@capstan/agent";
import type { RouteRegistryEntry, AgentConfig } from "@capstan/agent";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const testConfig: AgentConfig = {
  name: "test-app",
  description: "A test Capstan application",
  baseUrl: "http://localhost:3000",
  resources: [
    {
      key: "ticket",
      title: "Ticket",
      description: "Support ticket",
      fields: {
        id: { type: "string", required: true },
        title: { type: "string", required: true },
        status: { type: "string", enum: ["open", "closed"] },
      },
    },
  ],
};

const testRoutes: RouteRegistryEntry[] = [
  {
    method: "GET",
    path: "/tickets",
    description: "List all tickets",
    capability: "read",
    resource: "ticket",
  },
  {
    method: "POST",
    path: "/tickets",
    description: "Create a new ticket",
    capability: "write",
    resource: "ticket",
    policy: "requireAuth",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    method: "GET",
    path: "/tickets/:id",
    description: "Get a ticket by ID",
    capability: "read",
    resource: "ticket",
  },
  {
    method: "PUT",
    path: "/tickets/:id",
    description: "Update a ticket",
    capability: "write",
    resource: "ticket",
    policy: "requireAuth",
  },
  {
    method: "DELETE",
    path: "/tickets/:id",
    description: "Delete a ticket",
    capability: "write",
    resource: "ticket",
    policy: "requireAuth",
  },
];

// ---------------------------------------------------------------------------
// generateAgentManifest
// ---------------------------------------------------------------------------

describe("generateAgentManifest", () => {
  it("produces a valid manifest structure", () => {
    const manifest = generateAgentManifest(testConfig, testRoutes);

    expect(manifest.capstan).toBe("1.0");
    expect(manifest.name).toBe("test-app");
    expect(manifest.description).toBe("A test Capstan application");
    expect(manifest.baseUrl).toBe("http://localhost:3000");
  });

  it("includes all provided routes as capabilities", () => {
    const manifest = generateAgentManifest(testConfig, testRoutes);

    expect(manifest.capabilities.length).toBe(testRoutes.length);
    for (const cap of manifest.capabilities) {
      expect(cap.key).toBeTruthy();
      expect(cap.title).toBeTruthy();
      expect(cap.mode).toBeTruthy();
      expect(cap.endpoint.method).toBeTruthy();
      expect(cap.endpoint.path).toBeTruthy();
    }
  });

  it("includes authentication section", () => {
    const manifest = generateAgentManifest(testConfig, testRoutes);

    expect(manifest.authentication).toBeDefined();
    expect(manifest.authentication.schemes.length).toBeGreaterThan(0);
    expect(manifest.authentication.schemes[0]!.type).toBe("bearer");
    expect(manifest.authentication.schemes[0]!.header).toBe("Authorization");
  });

  it("includes MCP server configuration", () => {
    const manifest = generateAgentManifest(testConfig, testRoutes);

    expect(manifest.mcp).toBeDefined();
    expect(manifest.mcp!.endpoint).toBe("/.well-known/mcp");
    expect(manifest.mcp!.transport).toBe("stdio");
  });

  it("includes resources from config", () => {
    const manifest = generateAgentManifest(testConfig, testRoutes);

    expect(manifest.resources.length).toBe(1);
    expect(manifest.resources[0]!.key).toBe("ticket");
    expect(manifest.resources[0]!.title).toBe("Ticket");
  });

  it("derives capability keys correctly from method + path", () => {
    const manifest = generateAgentManifest(testConfig, testRoutes);

    const keys = manifest.capabilities.map((c) => c.key);
    // GET /tickets -> listTickets
    expect(keys).toContain("listTickets");
    // POST /tickets -> createTicket
    expect(keys).toContain("createTicket");
    // GET /tickets/:id -> getTicket
    expect(keys).toContain("getTicket");
    // PUT /tickets/:id -> updateTicket
    expect(keys).toContain("updateTicket");
    // DELETE /tickets/:id -> deleteTicket
    expect(keys).toContain("deleteTicket");
  });

  it("preserves descriptions on capabilities", () => {
    const manifest = generateAgentManifest(testConfig, testRoutes);
    const listCap = manifest.capabilities.find(
      (c) => c.key === "listTickets",
    );
    expect(listCap!.description).toBe("List all tickets");
  });

  it("preserves policy references on capabilities", () => {
    const manifest = generateAgentManifest(testConfig, testRoutes);
    const createCap = manifest.capabilities.find(
      (c) => c.key === "createTicket",
    );
    expect(createCap!.policy).toBe("requireAuth");
  });

  it("includes inputSchema on capabilities that have one", () => {
    const manifest = generateAgentManifest(testConfig, testRoutes);
    const createCap = manifest.capabilities.find(
      (c) => c.key === "createTicket",
    );
    expect(createCap!.endpoint.inputSchema).toBeDefined();
    expect(
      (createCap!.endpoint.inputSchema as Record<string, unknown>)["type"],
    ).toBe("object");
  });

  it("works with no routes", () => {
    const manifest = generateAgentManifest(testConfig, []);
    expect(manifest.capabilities.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateOpenApiSpec
// ---------------------------------------------------------------------------

describe("generateOpenApiSpec", () => {
  it("produces a valid OpenAPI 3.1.0 structure", () => {
    const spec = generateOpenApiSpec(testConfig, testRoutes);

    expect(spec["openapi"]).toBe("3.1.0");
    expect(spec["info"]).toBeDefined();
    const info = spec["info"] as Record<string, unknown>;
    expect(info["title"]).toBe("test-app");
    expect(info["version"]).toBe("0.1.0");
  });

  it("converts :param paths to {param} format", () => {
    const spec = generateOpenApiSpec(testConfig, testRoutes);
    const paths = spec["paths"] as Record<string, unknown>;

    // /tickets/:id should become /tickets/{id}
    expect(paths["/tickets/{id}"]).toBeDefined();
    expect(paths["/tickets/:id"]).toBeUndefined();
  });

  it("includes all routes as paths", () => {
    const spec = generateOpenApiSpec(testConfig, testRoutes);
    const paths = spec["paths"] as Record<string, Record<string, unknown>>;

    expect(paths["/tickets"]).toBeDefined();
    expect(paths["/tickets"]["get"]).toBeDefined();
    expect(paths["/tickets"]["post"]).toBeDefined();
    expect(paths["/tickets/{id}"]).toBeDefined();
    expect(paths["/tickets/{id}"]["get"]).toBeDefined();
    expect(paths["/tickets/{id}"]["put"]).toBeDefined();
    expect(paths["/tickets/{id}"]["delete"]).toBeDefined();
  });

  it("includes server URL from config", () => {
    const spec = generateOpenApiSpec(testConfig, testRoutes);
    const servers = spec["servers"] as Array<{ url: string }>;
    expect(servers).toBeDefined();
    expect(servers[0]!.url).toBe("http://localhost:3000");
  });

  it("includes security schemes in components", () => {
    const spec = generateOpenApiSpec(testConfig, testRoutes);
    const components = spec["components"] as Record<string, unknown>;
    const schemes = components["securitySchemes"] as Record<string, unknown>;
    expect(schemes["bearerAuth"]).toBeDefined();
    const bearer = schemes["bearerAuth"] as Record<string, unknown>;
    expect(bearer["type"]).toBe("http");
    expect(bearer["scheme"]).toBe("bearer");
  });

  it("includes path parameters for dynamic routes", () => {
    const spec = generateOpenApiSpec(testConfig, testRoutes);
    const paths = spec["paths"] as Record<string, Record<string, unknown>>;
    const getTicket = paths["/tickets/{id}"]!["get"] as Record<
      string,
      unknown
    >;
    const params = getTicket["parameters"] as Array<Record<string, unknown>>;

    expect(params).toBeDefined();
    expect(params.length).toBeGreaterThan(0);
    const idParam = params.find((p) => p["name"] === "id");
    expect(idParam).toBeDefined();
    expect(idParam!["in"]).toBe("path");
    expect(idParam!["required"]).toBe(true);
  });

  it("includes request body for POST routes", () => {
    const spec = generateOpenApiSpec(testConfig, testRoutes);
    const paths = spec["paths"] as Record<string, Record<string, unknown>>;
    const postTickets = paths["/tickets"]!["post"] as Record<string, unknown>;
    const body = postTickets["requestBody"] as Record<string, unknown>;

    expect(body).toBeDefined();
    expect(body["required"]).toBe(true);
  });

  it("includes resource schemas in components", () => {
    const spec = generateOpenApiSpec(testConfig, testRoutes);
    const components = spec["components"] as Record<string, unknown>;
    const schemas = components["schemas"] as Record<string, unknown>;

    expect(schemas["ticket"]).toBeDefined();
    const ticketSchema = schemas["ticket"] as Record<string, unknown>;
    expect(ticketSchema["type"]).toBe("object");
    const props = ticketSchema["properties"] as Record<string, unknown>;
    expect(props["id"]).toBeDefined();
    expect(props["title"]).toBeDefined();
    expect(props["status"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// routeToToolName
// ---------------------------------------------------------------------------

describe("routeToToolName", () => {
  it("converts GET /tickets to get_tickets", () => {
    expect(routeToToolName("GET", "/tickets")).toBe("get_tickets");
  });

  it("converts POST /tickets to post_tickets", () => {
    expect(routeToToolName("POST", "/tickets")).toBe("post_tickets");
  });

  it("converts GET /tickets/:id to get_tickets_by_id", () => {
    expect(routeToToolName("GET", "/tickets/:id")).toBe(
      "get_tickets_by_id",
    );
  });

  it("converts PUT /tickets/:id to put_tickets_by_id", () => {
    expect(routeToToolName("PUT", "/tickets/:id")).toBe(
      "put_tickets_by_id",
    );
  });

  it("handles nested dynamic segments", () => {
    expect(
      routeToToolName("DELETE", "/orgs/:orgId/members/:memberId"),
    ).toBe("delete_orgs_by_orgId_members_by_memberId");
  });
});

// ---------------------------------------------------------------------------
// createMcpServer
// ---------------------------------------------------------------------------

describe("createMcpServer", () => {
  it("creates a server with tools for each route", () => {
    const executeRoute = async () => ({ ok: true });
    const { server, getToolDefinitions } = createMcpServer(
      testConfig,
      testRoutes,
      executeRoute,
    );

    expect(server).toBeDefined();

    const tools = getToolDefinitions();
    expect(tools.length).toBe(testRoutes.length);
  });

  it("tool names match routeToToolName convention", () => {
    const executeRoute = async () => ({ ok: true });
    const { getToolDefinitions } = createMcpServer(
      testConfig,
      testRoutes,
      executeRoute,
    );

    const toolNames = getToolDefinitions().map((t) => t.name);
    expect(toolNames).toContain("get_tickets");
    expect(toolNames).toContain("post_tickets");
    expect(toolNames).toContain("get_tickets_by_id");
    expect(toolNames).toContain("put_tickets_by_id");
    expect(toolNames).toContain("delete_tickets_by_id");
  });

  it("tool definitions include descriptions", () => {
    const executeRoute = async () => ({ ok: true });
    const { getToolDefinitions } = createMcpServer(
      testConfig,
      testRoutes,
      executeRoute,
    );

    const listTool = getToolDefinitions().find(
      (t) => t.name === "get_tickets",
    );
    expect(listTool!.description).toBe("List all tickets");
  });

  it("tool definitions include input schema", () => {
    const executeRoute = async () => ({ ok: true });
    const { getToolDefinitions } = createMcpServer(
      testConfig,
      testRoutes,
      executeRoute,
    );

    const createTool = getToolDefinitions().find(
      (t) => t.name === "post_tickets",
    );
    expect(createTool!.inputSchema).toBeDefined();
    expect(
      (createTool!.inputSchema as Record<string, unknown>)["type"],
    ).toBe("object");
  });

  it("works with empty routes", () => {
    const executeRoute = async () => ({});
    const { getToolDefinitions } = createMcpServer(
      testConfig,
      [],
      executeRoute,
    );
    expect(getToolDefinitions().length).toBe(0);
  });
});

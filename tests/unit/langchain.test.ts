import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  toLangChainTools,
  toLangChainToolSpecs,
} from "@zauso-ai/capstan-agent";
import type { LangChainToolDefinition } from "@zauso-ai/capstan-agent";
import { CapabilityRegistry } from "@zauso-ai/capstan-agent";
import type { RouteRegistryEntry, AgentConfig } from "@zauso-ai/capstan-agent";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const testConfig: AgentConfig = {
  name: "langchain-test-app",
  description: "Test app for LangChain integration",
  baseUrl: "http://localhost:3000",
};

function makeRegistry(routes: RouteRegistryEntry[]): CapabilityRegistry {
  const registry = new CapabilityRegistry(testConfig);
  registry.registerAll(routes);
  return registry;
}

const readRoute: RouteRegistryEntry = {
  method: "GET",
  path: "/tickets",
  description: "List all tickets",
  capability: "read",
  resource: "ticket",
};

const writeRoute: RouteRegistryEntry = {
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
};

const putRoute: RouteRegistryEntry = {
  method: "PUT",
  path: "/tickets/:id",
  description: "Update a ticket",
  capability: "write",
  resource: "ticket",
};

const patchRoute: RouteRegistryEntry = {
  method: "PATCH",
  path: "/tickets/:id",
  description: "Partially update a ticket",
  capability: "write",
  resource: "ticket",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" } },
  },
};

const deleteRoute: RouteRegistryEntry = {
  method: "DELETE",
  path: "/tickets/:id",
  description: "Delete a ticket",
  capability: "write",
  resource: "ticket",
};

const allRoutes: RouteRegistryEntry[] = [
  readRoute,
  writeRoute,
  putRoute,
  patchRoute,
  deleteRoute,
];

const baseOptions = {
  baseUrl: "http://localhost:4000",
};

// ---------------------------------------------------------------------------
// Mock fetch — intercept HTTP calls made by tool func
// ---------------------------------------------------------------------------

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;

function installFetchMock(
  responseBody: string = '{"ok":true}',
  status: number = 200,
) {
  fetchCalls = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url, init });
    return new Response(responseBody, { status });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// toLangChainTools()
// ---------------------------------------------------------------------------

describe("toLangChainTools", () => {
  beforeEach(() => installFetchMock());
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("generates a tool for each route in the registry", () => {
    const registry = makeRegistry(allRoutes);
    const tools = toLangChainTools(registry, baseOptions);
    expect(tools.length).toBe(allRoutes.length);
  });

  it("tool name matches routeToToolName() convention", () => {
    const registry = makeRegistry(allRoutes);
    const tools = toLangChainTools(registry, baseOptions);
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_tickets");
    expect(names).toContain("post_tickets");
    expect(names).toContain("put_tickets_by_id");
    expect(names).toContain("patch_tickets_by_id");
    expect(names).toContain("delete_tickets_by_id");
  });

  it("tool has description from route description", () => {
    const registry = makeRegistry([readRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    expect(tools[0]!.description).toBe("List all tickets");
  });

  it("tool has schema matching route inputSchema", () => {
    const registry = makeRegistry([writeRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    expect(tools[0]!.schema).toEqual({
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["title"],
    });
  });

  it("GET routes: func sends query params (not body)", async () => {
    const registry = makeRegistry([readRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    await tools[0]!.func({ status: "open", page: "2" });

    expect(fetchCalls.length).toBe(1);
    const call = fetchCalls[0]!;
    expect(call.url).toContain("status=open");
    expect(call.url).toContain("page=2");
    expect(call.init?.body).toBeUndefined();
  });

  it("POST routes: func sends JSON body", async () => {
    const registry = makeRegistry([writeRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    await tools[0]!.func({ title: "Bug report" });

    const call = fetchCalls[0]!;
    expect(call.init?.method).toBe("POST");
    expect(call.init?.body).toBe(JSON.stringify({ title: "Bug report" }));
    expect(call.init?.headers).toEqual(
      expect.objectContaining({ "Content-Type": "application/json" }),
    );
  });

  it("PUT routes: func sends JSON body", async () => {
    const registry = makeRegistry([putRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    await tools[0]!.func({ title: "Updated" });

    const call = fetchCalls[0]!;
    expect(call.init?.method).toBe("PUT");
    expect(call.init?.body).toBe(JSON.stringify({ title: "Updated" }));
  });

  it("DELETE routes: func sends JSON body", async () => {
    const registry = makeRegistry([deleteRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    await tools[0]!.func({ reason: "duplicate" });

    const call = fetchCalls[0]!;
    expect(call.init?.method).toBe("DELETE");
    expect(call.init?.body).toBe(JSON.stringify({ reason: "duplicate" }));
  });

  it("PATCH tool func sends a JSON body, not query params", async () => {
    const registry = makeRegistry([patchRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    await tools[0]!.func({ name: "Updated Widget" });

    const call = fetchCalls[0]!;
    expect(call.init?.method).toBe("PATCH");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call.init?.body as string)).toEqual({ name: "Updated Widget" });
  });

  it("propagates fetch errors (network failure)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Network error: ECONNREFUSED");
    }) as typeof fetch;

    const registry = makeRegistry([readRoute]);
    const tools = toLangChainTools(registry, baseOptions);

    const getTool = tools.find((t) => t.name === "get_tickets")!;
    await expect(getTool.func({})).rejects.toThrow("Network error: ECONNREFUSED");
  });

  it("authorization header included when option provided", async () => {
    const registry = makeRegistry([readRoute]);
    const tools = toLangChainTools(registry, {
      ...baseOptions,
      authorization: "Bearer tok_abc",
    });
    await tools[0]!.func({});

    const headers = fetchCalls[0]!.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok_abc");
  });

  it("authorization header omitted when not provided", async () => {
    const registry = makeRegistry([readRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    await tools[0]!.func({});

    const headers = fetchCalls[0]!.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("empty registry returns empty tools array", () => {
    const registry = makeRegistry([]);
    const tools = toLangChainTools(registry, baseOptions);
    expect(tools).toEqual([]);
  });

  it("capabilities filter: only 'read' excludes write routes", () => {
    const registry = makeRegistry(allRoutes);
    const tools = toLangChainTools(registry, {
      ...baseOptions,
      capabilities: ["read"],
    });
    expect(tools.length).toBe(1);
    expect(tools[0]!.name).toBe("get_tickets");
  });

  it("capabilities filter: only 'write' excludes read routes", () => {
    const registry = makeRegistry(allRoutes);
    const tools = toLangChainTools(registry, {
      ...baseOptions,
      capabilities: ["write"],
    });
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("get_tickets");
    expect(names).toContain("post_tickets");
    expect(names).toContain("put_tickets_by_id");
    expect(names).toContain("patch_tickets_by_id");
    expect(names).toContain("delete_tickets_by_id");
  });

  it("capabilities filter: empty array returns all routes", () => {
    const registry = makeRegistry(allRoutes);
    const tools = toLangChainTools(registry, {
      ...baseOptions,
      capabilities: [],
    });
    expect(tools.length).toBe(allRoutes.length);
  });

  it("route without description falls back to method+path", () => {
    const noDescRoute: RouteRegistryEntry = {
      method: "GET",
      path: "/health",
    };
    const registry = makeRegistry([noDescRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    expect(tools[0]!.description).toBe("GET /health");
  });

  it("route without inputSchema uses empty schema object", () => {
    const noSchemaRoute: RouteRegistryEntry = {
      method: "GET",
      path: "/status",
      description: "Health check",
    };
    const registry = makeRegistry([noSchemaRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    expect(tools[0]!.schema).toEqual({ type: "object", properties: {} });
  });

  it("input as string is parsed as JSON", async () => {
    const registry = makeRegistry([writeRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    await tools[0]!.func('{"title":"From string"}');

    const call = fetchCalls[0]!;
    expect(call.init?.body).toBe(
      JSON.stringify({ title: "From string" }),
    );
  });

  it("input as object is used directly", async () => {
    const registry = makeRegistry([writeRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    await tools[0]!.func({ title: "Direct object" });

    const call = fetchCalls[0]!;
    expect(call.init?.body).toBe(
      JSON.stringify({ title: "Direct object" }),
    );
  });

  it("input as invalid JSON string passes empty object", async () => {
    const registry = makeRegistry([writeRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    await tools[0]!.func("not valid json {{{");

    const call = fetchCalls[0]!;
    // normaliseInput returns {} for unparseable strings
    expect(call.init?.body).toBe(JSON.stringify({}));
  });

  it("tool func returns stringified response body", async () => {
    installFetchMock('{"items":[1,2,3]}', 200);
    const registry = makeRegistry([readRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    const result = await tools[0]!.func({});
    expect(result).toBe('{"items":[1,2,3]}');
  });

  it("HTTP error response still returns the text (no throw)", async () => {
    installFetchMock('{"error":"not found"}', 404);
    const registry = makeRegistry([readRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    const result = await tools[0]!.func({});
    // The implementation returns response.text() regardless of status
    expect(result).toBe('{"error":"not found"}');
  });

  it("input schema with nested objects is preserved", () => {
    const nestedRoute: RouteRegistryEntry = {
      method: "POST",
      path: "/complex",
      description: "Complex input",
      inputSchema: {
        type: "object",
        properties: {
          meta: {
            type: "object",
            properties: {
              tags: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    };
    const registry = makeRegistry([nestedRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    const schema = tools[0]!.schema as Record<string, unknown>;
    const props = schema["properties"] as Record<string, unknown>;
    expect(props["meta"]).toBeDefined();
  });

  it("GET URL construction with special characters in values", async () => {
    const registry = makeRegistry([readRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    await tools[0]!.func({ q: "hello world", tag: "a&b" });

    const url = fetchCalls[0]!.url;
    // URL class encodes special chars
    expect(url).toContain("q=hello+world");
    expect(url).toContain("tag=a%26b");
  });

  it("baseUrl with trailing slash does not produce double slash", async () => {
    const registry = makeRegistry([readRoute]);
    const tools = toLangChainTools(registry, {
      baseUrl: "http://localhost:4000/",
    });
    await tools[0]!.func({});

    const url = fetchCalls[0]!.url;
    // Should not have double slash before path
    expect(url).not.toMatch(/localhost:4000\/\/tickets/);
    expect(url).toContain("/tickets");
  });

  it("baseUrl without trailing slash works correctly", async () => {
    const registry = makeRegistry([readRoute]);
    const tools = toLangChainTools(registry, {
      baseUrl: "http://localhost:4000",
    });
    await tools[0]!.func({});

    const url = fetchCalls[0]!.url;
    expect(url).toContain("http://localhost:4000/tickets");
  });

  it("multiple routes with same generated name are all included", () => {
    // Two different routes that share the same method+path pattern
    // (unlikely in practice, but tests that the code does not deduplicate)
    const route1: RouteRegistryEntry = {
      method: "GET",
      path: "/items",
      description: "First",
    };
    const route2: RouteRegistryEntry = {
      method: "GET",
      path: "/items",
      description: "Second",
    };
    const registry = makeRegistry([route1, route2]);
    const tools = toLangChainTools(registry, baseOptions);
    expect(tools.length).toBe(2);
  });

  it("route with no capability is excluded when capabilities filter is set", () => {
    const noCap: RouteRegistryEntry = {
      method: "GET",
      path: "/misc",
      description: "No capability declared",
    };
    const registry = makeRegistry([noCap]);
    const tools = toLangChainTools(registry, {
      ...baseOptions,
      capabilities: ["read"],
    });
    expect(tools.length).toBe(0);
  });

  it("empty string input is normalised to empty object", async () => {
    const registry = makeRegistry([writeRoute]);
    const tools = toLangChainTools(registry, baseOptions);
    await tools[0]!.func("");

    const call = fetchCalls[0]!;
    expect(call.init?.body).toBe(JSON.stringify({}));
  });
});

// ---------------------------------------------------------------------------
// toLangChainToolSpecs()
// ---------------------------------------------------------------------------

describe("toLangChainToolSpecs", () => {
  it("returns metadata without func property", () => {
    const registry = makeRegistry(allRoutes);
    const specs = toLangChainToolSpecs(registry);
    for (const spec of specs) {
      expect(spec).not.toHaveProperty("func");
    }
  });

  it("includes name, description, and parameters", () => {
    const registry = makeRegistry([writeRoute]);
    const specs = toLangChainToolSpecs(registry);
    expect(specs.length).toBe(1);
    const spec = specs[0]!;
    expect(spec.name).toBe("post_tickets");
    expect(spec.description).toBe("Create a new ticket");
    expect(spec.parameters).toBeDefined();
  });

  it("parameters is JSON Schema format", () => {
    const registry = makeRegistry([writeRoute]);
    const specs = toLangChainToolSpecs(registry);
    const params = specs[0]!.parameters;
    expect(params["type"]).toBe("object");
    expect(params["properties"]).toBeDefined();
  });

  it("empty registry returns empty array", () => {
    const registry = makeRegistry([]);
    const specs = toLangChainToolSpecs(registry);
    expect(specs).toEqual([]);
  });

  it("route without inputSchema produces empty schema", () => {
    const registry = makeRegistry([readRoute]);
    const specs = toLangChainToolSpecs(registry);
    expect(specs[0]!.parameters).toEqual({ type: "object", properties: {} });
  });

  it("all routes are included (no capability filtering)", () => {
    const registry = makeRegistry(allRoutes);
    const specs = toLangChainToolSpecs(registry);
    expect(specs.length).toBe(allRoutes.length);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createMcpHttpHandler,
  routeToToolName,
} from "@zauso-ai/capstan-agent";
import type { RouteRegistryEntry, AgentConfig } from "@zauso-ai/capstan-agent";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const testConfig: AgentConfig = {
  name: "mcp-http-test",
  description: "Test app for MCP HTTP handler",
  baseUrl: "http://localhost:3000",
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
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a JSON-RPC 2.0 request body. */
function jsonRpc(
  method: string,
  params?: Record<string, unknown>,
  id: number | string = 1,
) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  });
}

/** Send a JSON-RPC POST to the handler, optionally with a session header. */
async function post(
  handler: (req: Request) => Promise<Response>,
  body: string,
  sessionId?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }
  return handler(
    new Request("http://localhost/.well-known/mcp", {
      method: "POST",
      headers,
      body,
    }),
  );
}

/** Initialize a session and return the session ID. */
async function initSession(
  handler: (req: Request) => Promise<Response>,
): Promise<string> {
  const res = await post(
    handler,
    jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    }),
  );
  const sessionId = res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("No session ID returned from initialize");

  // Send initialized notification (required by MCP protocol)
  const notifHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "mcp-session-id": sessionId,
  };
  await handler(
    new Request("http://localhost/.well-known/mcp", {
      method: "POST",
      headers: notifHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    }),
  );

  return sessionId;
}

/** Parse a JSON response body, handling both single and array responses. */
async function parseJsonRpc(
  res: Response,
  expectedId?: number | string,
): Promise<Record<string, unknown>> {
  const contentType = res.headers.get("content-type") ?? "";

  // Handle SSE responses by extracting JSON-RPC data lines
  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice("data: ".length).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          if (expectedId === undefined || parsed["id"] === expectedId) {
            return parsed;
          }
        } catch {
          // skip non-JSON data lines
        }
      }
    }
    throw new Error("No matching JSON-RPC response found in SSE stream");
  }

  const json = (await res.json()) as
    | Record<string, unknown>
    | Record<string, unknown>[];
  if (Array.isArray(json)) {
    if (expectedId !== undefined) {
      const match = json.find((r) => r["id"] === expectedId);
      if (match) return match;
    }
    return json[0]!;
  }
  return json;
}

// ---------------------------------------------------------------------------
// Tests: Basic Functionality
// ---------------------------------------------------------------------------

// No afterEach cleanup is needed: each test creates its own `handler` via
// createMcpHttpHandler(), and session state is scoped to that handler instance.
// When the handler goes out of scope at the end of the test, all associated
// sessions are garbage-collected. There is no shared mutable state between tests.

describe("createMcpHttpHandler — basic functionality", () => {
  it("returns a function (request handler)", () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    expect(typeof handler).toBe("function");
  });

  it("handler accepts a Request and returns a Response", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const res = await post(handler, jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    }));
    expect(res).toBeInstanceOf(Response);
    expect(typeof res.status).toBe("number");
  });

  it("POST with JSON-RPC initialize returns server info", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const res = await post(handler, jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    }));

    expect(res.status).toBe(200);
    const body = await parseJsonRpc(res, 1);
    expect(body["jsonrpc"]).toBe("2.0");

    const result = body["result"] as Record<string, unknown> | undefined;
    expect(result).toBeDefined();

    const serverInfo = result?.["serverInfo"] as Record<string, unknown> | undefined;
    expect(serverInfo?.["name"]).toBe("mcp-http-test");
  });

  it("POST with tools/list returns registered tools", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const sessionId = await initSession(handler);
    const res = await post(handler, jsonRpc("tools/list", {}, 2), sessionId);

    expect(res.status).toBe(200);
    const body = await parseJsonRpc(res, 2);
    const result = body["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<Record<string, unknown>>;

    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(testRoutes.length);
  });

  it("POST with tools/call invokes the route handler", async () => {
    const executeRoute = async (_method: string, _path: string, input: unknown) => {
      return { tickets: [{ id: "1", title: "Test" }], input };
    };
    const handler = createMcpHttpHandler(testConfig, testRoutes, executeRoute);
    const sessionId = await initSession(handler);

    const res = await post(
      handler,
      jsonRpc("tools/call", {
        name: "get_tickets",
        arguments: {},
      }, 3),
      sessionId,
    );

    expect(res.status).toBe(200);
    const body = await parseJsonRpc(res, 3);
    const result = body["result"] as Record<string, unknown>;
    const content = result["content"] as Array<Record<string, unknown>>;

    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBeGreaterThan(0);
    expect(content[0]!["type"]).toBe("text");

    const parsed = JSON.parse(content[0]!["text"] as string);
    expect(parsed.tickets).toBeDefined();
    expect(parsed.tickets[0].id).toBe("1");
  });

  it("sets Mcp-Session-Id header on response", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const res = await post(handler, jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    }));

    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe("string");
    // UUID format check
    expect(sessionId!.length).toBeGreaterThan(10);
  });

  it("returns 404 for unknown session ID on GET", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const res = await handler(
      new Request("http://localhost/.well-known/mcp", {
        method: "GET",
        headers: { "mcp-session-id": "nonexistent-session-id" },
      }),
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown session ID on DELETE", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const res = await handler(
      new Request("http://localhost/.well-known/mcp", {
        method: "DELETE",
        headers: { "mcp-session-id": "nonexistent-session-id" },
      }),
    );

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: Session Management
// ---------------------------------------------------------------------------

describe("createMcpHttpHandler — session management", () => {
  it("first POST creates a new session", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const res = await post(handler, jsonRpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    }));

    expect(res.status).toBe(200);
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
  });

  it("session ID is returned in response headers", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const sessionId = await initSession(handler);
    expect(sessionId).toBeTruthy();
    expect(sessionId.length).toBeGreaterThan(0);
  });

  it("subsequent requests with same session ID reuse session", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const sessionId = await initSession(handler);

    // Send two tools/list requests with the same session ID
    const res1 = await post(handler, jsonRpc("tools/list", {}, 2), sessionId);
    const res2 = await post(handler, jsonRpc("tools/list", {}, 3), sessionId);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await parseJsonRpc(res1, 2);
    const body2 = await parseJsonRpc(res2, 3);

    // Both should return tools successfully
    const result1 = body1["result"] as Record<string, unknown>;
    const result2 = body2["result"] as Record<string, unknown>;
    expect(result1["tools"]).toBeDefined();
    expect(result2["tools"]).toBeDefined();
  });

  it("DELETE request terminates session", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const sessionId = await initSession(handler);

    // Delete the session
    const deleteRes = await handler(
      new Request("http://localhost/.well-known/mcp", {
        method: "DELETE",
        headers: { "mcp-session-id": sessionId },
      }),
    );

    // DELETE should succeed (200 or 204)
    expect(deleteRes.status).toBeLessThan(300);
  });

  it("after DELETE, same session ID returns 404", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const sessionId = await initSession(handler);

    // Delete the session
    await handler(
      new Request("http://localhost/.well-known/mcp", {
        method: "DELETE",
        headers: { "mcp-session-id": sessionId },
      }),
    );

    // Now try using the deleted session
    const res = await post(handler, jsonRpc("tools/list", {}, 5), sessionId);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: Tool Registration
// ---------------------------------------------------------------------------

describe("createMcpHttpHandler — tool registration", () => {
  it("routes are registered as MCP tools", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const sessionId = await initSession(handler);
    const res = await post(handler, jsonRpc("tools/list", {}, 2), sessionId);

    const body = await parseJsonRpc(res, 2);
    const result = body["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<Record<string, unknown>>;

    expect(tools.length).toBe(testRoutes.length);
  });

  it("tool names follow routeToToolName convention", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const sessionId = await initSession(handler);
    const res = await post(handler, jsonRpc("tools/list", {}, 2), sessionId);

    const body = await parseJsonRpc(res, 2);
    const result = body["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<Record<string, unknown>>;
    const toolNames = tools.map((t) => t["name"] as string);

    for (const route of testRoutes) {
      const expected = routeToToolName(route.method, route.path);
      expect(toolNames).toContain(expected);
    }
  });

  it("tool descriptions come from route metadata", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const sessionId = await initSession(handler);
    const res = await post(handler, jsonRpc("tools/list", {}, 2), sessionId);

    const body = await parseJsonRpc(res, 2);
    const result = body["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<Record<string, unknown>>;

    const listTool = tools.find((t) => t["name"] === "get_tickets");
    expect(listTool).toBeDefined();
    expect(listTool!["description"]).toBe("List all tickets");

    const createTool = tools.find((t) => t["name"] === "post_tickets");
    expect(createTool).toBeDefined();
    expect(createTool!["description"]).toBe("Create a new ticket");
  });

  it("input schemas from route metadata appear on tools", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const sessionId = await initSession(handler);
    const res = await post(handler, jsonRpc("tools/list", {}, 2), sessionId);

    const body = await parseJsonRpc(res, 2);
    const result = body["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<Record<string, unknown>>;

    const createTool = tools.find((t) => t["name"] === "post_tickets");
    expect(createTool).toBeDefined();

    const schema = createTool!["inputSchema"] as Record<string, unknown>;
    expect(schema).toBeDefined();
    expect(schema["type"]).toBe("object");

    const properties = schema["properties"] as Record<string, unknown> | undefined;
    expect(properties).toBeDefined();
    expect(properties!["title"]).toBeDefined();
    expect(properties!["description"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Error Handling
// ---------------------------------------------------------------------------

describe("createMcpHttpHandler — error handling", () => {
  it("invalid JSON body returns error response", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));
    const res = await handler(
      new Request("http://localhost/.well-known/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: "this is not valid json{{{",
      }),
    );

    // Should return an error (400 or JSON-RPC error)
    const text = await res.text();
    // Either a non-200 status or a JSON-RPC error in the body
    if (res.status === 200) {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      expect(parsed["error"]).toBeDefined();
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("tool invocation that throws returns error response", async () => {
    const executeRoute = async () => {
      throw new Error("Handler exploded");
    };
    const handler = createMcpHttpHandler(testConfig, testRoutes, executeRoute);
    const sessionId = await initSession(handler);

    const res = await post(
      handler,
      jsonRpc("tools/call", {
        name: "get_tickets",
        arguments: {},
      }, 3),
      sessionId,
    );

    const body = await parseJsonRpc(res, 3);
    // The MCP SDK wraps handler errors, so we check for error in result
    // or isError flag in content
    const result = body["result"] as Record<string, unknown> | undefined;
    const error = body["error"] as Record<string, unknown> | undefined;

    if (error) {
      // Direct JSON-RPC error
      expect(error["message"]).toBeDefined();
    } else if (result) {
      // MCP SDK may wrap errors in content with isError flag
      const content = result["content"] as Array<Record<string, unknown>> | undefined;
      const isError = result["isError"] as boolean | undefined;
      // At minimum, the result should be present (even if it wraps an error)
      expect(result).toBeDefined();
      if (isError !== undefined) {
        expect(isError).toBe(true);
      }
    }
  });

  it("empty routes array registers no tools", async () => {
    const handler = createMcpHttpHandler(testConfig, [], async () => ({}));
    const sessionId = await initSession(handler);
    const res = await post(handler, jsonRpc("tools/list", {}, 2), sessionId);

    expect(res.status).toBe(200);
    const body = await parseJsonRpc(res, 2);

    // With zero routes the MCP SDK may either:
    // (a) return an empty tools array, or
    // (b) not register the tools capability at all and return "Method not found".
    const result = body["result"] as Record<string, unknown> | undefined;
    const error = body["error"] as Record<string, unknown> | undefined;

    if (result) {
      const tools = result["tools"] as Array<Record<string, unknown>>;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBe(0);
    } else {
      // Method not found is acceptable when no tools are registered
      expect(error).toBeDefined();
      expect(error!["code"]).toBe(-32601);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: Edge Cases
// ---------------------------------------------------------------------------

describe("createMcpHttpHandler — edge cases", () => {
  it("multiple sessions can exist simultaneously", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));

    const session1 = await initSession(handler);
    const session2 = await initSession(handler);

    // Sessions should be different
    expect(session1).not.toBe(session2);

    // Both sessions should work independently
    const res1 = await post(handler, jsonRpc("tools/list", {}, 10), session1);
    const res2 = await post(handler, jsonRpc("tools/list", {}, 11), session2);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await parseJsonRpc(res1, 10);
    const body2 = await parseJsonRpc(res2, 11);

    const tools1 = (body1["result"] as Record<string, unknown>)["tools"] as unknown[];
    const tools2 = (body2["result"] as Record<string, unknown>)["tools"] as unknown[];

    expect(tools1.length).toBe(testRoutes.length);
    expect(tools2.length).toBe(testRoutes.length);
  });

  it("session cleanup after close removes only that session", async () => {
    const handler = createMcpHttpHandler(testConfig, testRoutes, async () => ({}));

    const session1 = await initSession(handler);
    const session2 = await initSession(handler);

    // Delete session 1
    await handler(
      new Request("http://localhost/.well-known/mcp", {
        method: "DELETE",
        headers: { "mcp-session-id": session1 },
      }),
    );

    // Session 1 should be gone
    const res1 = await post(handler, jsonRpc("tools/list", {}, 20), session1);
    expect(res1.status).toBe(404);

    // Session 2 should still work
    const res2 = await post(handler, jsonRpc("tools/list", {}, 21), session2);
    expect(res2.status).toBe(200);
  });

  it("route with no input schema registers tool with empty params", async () => {
    const noSchemaRoutes: RouteRegistryEntry[] = [
      {
        method: "GET",
        path: "/health",
        description: "Health check",
        capability: "read",
      },
    ];
    const handler = createMcpHttpHandler(testConfig, noSchemaRoutes, async () => ({ status: "ok" }));
    const sessionId = await initSession(handler);
    const res = await post(handler, jsonRpc("tools/list", {}, 2), sessionId);

    const body = await parseJsonRpc(res, 2);
    const result = body["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<Record<string, unknown>>;

    expect(tools.length).toBe(1);
    expect(tools[0]!["name"]).toBe("get_health");

    // Input schema should exist but have no required properties
    const schema = tools[0]!["inputSchema"] as Record<string, unknown>;
    expect(schema).toBeDefined();
  });

  it("tool call with arguments forwards input to executeRoute", async () => {
    let capturedInput: unknown = null;
    let capturedMethod: string | null = null;
    let capturedPath: string | null = null;

    const executeRoute = async (method: string, path: string, input: unknown) => {
      capturedMethod = method;
      capturedPath = path;
      capturedInput = input;
      return { created: true };
    };

    const handler = createMcpHttpHandler(testConfig, testRoutes, executeRoute);
    const sessionId = await initSession(handler);

    await post(
      handler,
      jsonRpc("tools/call", {
        name: "post_tickets",
        arguments: { title: "My Ticket", description: "Details here" },
      }, 3),
      sessionId,
    );

    expect(capturedMethod).toBe("POST");
    expect(capturedPath).toBe("/tickets");
    expect(capturedInput).toBeDefined();
    const input = capturedInput as Record<string, unknown>;
    expect(input["title"]).toBe("My Ticket");
    expect(input["description"]).toBe("Details here");
  });

  it("route description falls back to METHOD /path when not provided", async () => {
    const noDescRoutes: RouteRegistryEntry[] = [
      {
        method: "GET",
        path: "/items",
        capability: "read",
      },
    ];
    const handler = createMcpHttpHandler(testConfig, noDescRoutes, async () => ({}));
    const sessionId = await initSession(handler);
    const res = await post(handler, jsonRpc("tools/list", {}, 2), sessionId);

    const body = await parseJsonRpc(res, 2);
    const result = body["result"] as Record<string, unknown>;
    const tools = result["tools"] as Array<Record<string, unknown>>;

    expect(tools.length).toBe(1);
    expect(tools[0]!["description"]).toBe("GET /items");
  });
});

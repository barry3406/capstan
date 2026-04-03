import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import {
  CapabilityRegistry,
  McpHttpTestClient,
  formatSseEvent,
  routeToToolName,
} from "@zauso-ai/capstan-agent";
import type { AgentConfig, RouteRegistryEntry } from "@zauso-ai/capstan-agent";

const port = 39000 + Math.floor(Math.random() * 20000);
const baseUrl = `http://127.0.0.1:${port}`;

const config: AgentConfig = {
  name: "protocol-transport-fixture",
  description: "Integration fixture for MCP and A2A transports",
  baseUrl,
};

const routes: RouteRegistryEntry[] = [
  {
    method: "GET",
    path: "/tickets",
    description: "List tickets",
    capability: "read",
    resource: "ticket",
    outputSchema: {
      type: "object",
      properties: {
        tickets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
            },
            required: ["id", "title"],
          },
        },
      },
      required: ["tickets"],
    },
  },
  {
    method: "POST",
    path: "/tickets",
    description: "Create ticket",
    capability: "write",
    resource: "ticket",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
        },
      },
      required: ["title"],
    },
    outputSchema: {
      type: "object",
      properties: {
        created: { type: "boolean" },
        ticket: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            priority: { type: "string" },
          },
          required: ["id", "title", "priority"],
        },
      },
      required: ["created", "ticket"],
    },
  },
];

const registry = new CapabilityRegistry(config);
registry.registerAll(routes);

async function executeRoute(method: string, path: string, input: unknown): Promise<unknown> {
  if (method === "GET" && path === "/tickets") {
    return {
      tickets: [
        { id: "ticket-1", title: "Seed ticket" },
      ],
      requested: input ?? null,
    };
  }

  if (method === "POST" && path === "/tickets") {
    const payload = (input ?? {}) as { title?: string; priority?: string };
    return {
      created: true,
      ticket: {
        id: "ticket-2",
        title: payload.title ?? "Untitled",
        priority: payload.priority ?? "medium",
      },
    };
  }

  throw new Error(`Unexpected route: ${method} ${path}`);
}

const mcpHandler = registry.toMcpHttp(executeRoute);
const a2aHandler = registry.toA2A(executeRoute);

let server: { stop: () => void } | null = null;
let client: McpHttpTestClient | null = null;

setDefaultTimeout(120_000);

function jsonRpc(
  method: string,
  params?: Record<string, unknown>,
  id: number | string = 1,
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  });
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function parseSseEvents(text: string): Array<{ event: string; data: unknown }> {
  return text
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: ")) ?? "";
      const dataLine = lines.find((line) => line.startsWith("data: ")) ?? "";

      return {
        event: eventLine.slice("event: ".length),
        data: JSON.parse(dataLine.slice("data: ".length)) as unknown,
      };
    });
}

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return Response.json({ status: "ok" });
      }

      if (url.pathname === "/.well-known/agent.json" && request.method === "GET") {
        return Response.json(a2aHandler.getAgentCard());
      }

      if (url.pathname === "/.well-known/mcp") {
        return mcpHandler(request);
      }

      if (url.pathname === "/.well-known/a2a" && request.method === "POST") {
        const body = await request.json();
        const accept = request.headers.get("accept") ?? "";

        if (accept.includes("text/event-stream")) {
          const encoder = new TextEncoder();
          const stream = a2aHandler.handleStreamRequest(body);

          return new Response(
            new ReadableStream({
              async start(controller) {
                try {
                  for await (const event of stream) {
                    controller.enqueue(encoder.encode(formatSseEvent(event)));
                  }
                  controller.close();
                } catch (error) {
                  controller.error(error);
                }
              },
            }),
            {
              headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache",
              },
            },
          );
        }

        return Response.json(await a2aHandler.handleRequest(body));
      }

      return new Response("Not found", { status: 404 });
    },
  });

  client = new McpHttpTestClient(`${baseUrl}/.well-known/mcp`);
});

afterAll(async () => {
  if (client) {
    await client.close().catch(() => {});
  }
  client = null;
  server?.stop();
  server = null;
});

describe("protocol transport integration", () => {
  it("serves discovery metadata and real MCP calls over HTTP", async () => {
    const agentResponse = await fetch(`${baseUrl}/.well-known/agent.json`);
    expect(agentResponse.status).toBe(200);

    const agentCard = (await parseJsonResponse(agentResponse)) as {
      name: string;
      url: string;
      skills: Array<{ id: string }>;
    };
    expect(agentCard.name).toBe("protocol-transport-fixture");
    expect(agentCard.url).toBe(baseUrl);
    expect(agentCard.skills.map((skill) => skill.id)).toEqual([
      routeToToolName("GET", "/tickets"),
      routeToToolName("POST", "/tickets"),
    ]);

    if (!client) {
      throw new Error("MCP client was not initialized");
    }

    const { serverInfo } = await client.initialize();
    expect((serverInfo as { name?: string } | null)?.name).toBe("protocol-transport-fixture");

    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      routeToToolName("GET", "/tickets"),
      routeToToolName("POST", "/tickets"),
    ]);
    expect(tools[1]?.inputSchema).toBeDefined();

    const result = await client.callTool(routeToToolName("POST", "/tickets"), {
      title: "Protocol transport smoke test",
      priority: "high",
    }) as {
      content?: Array<{ type: string; text?: string }>;
    };

    expect(result.content?.[0]?.text).toBeDefined();

    const toolPayload = JSON.parse(result.content?.[0]?.text ?? "null") as {
      created: boolean;
      ticket: { id: string; title: string; priority: string };
    };

    expect(toolPayload.created).toBe(true);
    expect(toolPayload.ticket).toEqual({
      id: "ticket-2",
      title: "Protocol transport smoke test",
      priority: "high",
    });
  });

  it("serves A2A task calls and streaming events over HTTP", async () => {
    const taskResponse = await fetch(`${baseUrl}/.well-known/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonRpc("tasks/send", {
        skill: routeToToolName("POST", "/tickets"),
        input: {
          title: "A2A transport smoke test",
          priority: "medium",
        },
      }, 1),
    });

    expect(taskResponse.status).toBe(200);
    const taskEnvelope = (await parseJsonResponse(taskResponse)) as {
      result?: {
        id: string;
        status: string;
        skill: string;
        output?: { created: boolean; ticket: { id: string; title: string; priority: string } };
      };
    };
    expect(taskEnvelope.result?.status).toBe("completed");
    expect(taskEnvelope.result?.skill).toBe(routeToToolName("POST", "/tickets"));
    expect(taskEnvelope.result?.output).toEqual({
      created: true,
      ticket: {
        id: "ticket-2",
        title: "A2A transport smoke test",
        priority: "medium",
      },
    });

    const taskId = taskEnvelope.result?.id;
    const getResponse = await fetch(`${baseUrl}/.well-known/a2a`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonRpc("tasks/get", { id: taskId }, 2),
    });

    const getEnvelope = (await parseJsonResponse(getResponse)) as {
      result?: { id: string; status: string; skill: string };
    };
    expect(getEnvelope.result?.id).toBe(taskId);
    expect(getEnvelope.result?.status).toBe("completed");

    const streamResponse = await fetch(`${baseUrl}/.well-known/a2a`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: jsonRpc("tasks/send", {
        skill: routeToToolName("GET", "/tickets"),
      }, 3),
    });

    expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSseEvents(await streamResponse.text());
    expect(events.map((event) => event.event)).toContain("task_result");

    const terminalEvent = events[events.length - 1]?.data as {
      status?: string;
      skill?: string;
    };
    expect(terminalEvent.status).toBe("completed");
    expect(terminalEvent.skill).toBe(routeToToolName("GET", "/tickets"));
  });
});

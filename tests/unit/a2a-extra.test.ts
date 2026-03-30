import { describe, it, expect, beforeEach } from "bun:test";
import {
  generateA2AAgentCard,
  createA2AHandler,
  formatSseEvent,
} from "@zauso-ai/capstan-agent";
import type {
  A2AAgentCard,
  A2ATask,
  A2AStreamEvent,
  RouteRegistryEntry,
  AgentConfig,
} from "@zauso-ai/capstan-agent";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const testConfig: AgentConfig = {
  name: "a2a-test-app",
  description: "A2A test application",
  baseUrl: "http://localhost:4000",
};

const testRoutes: RouteRegistryEntry[] = [
  {
    method: "GET",
    path: "/items",
    description: "List all items",
    capability: "read",
    resource: "item",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    outputSchema: { type: "array", items: { type: "object" } },
  },
  {
    method: "POST",
    path: "/items",
    description: "Create an item",
    capability: "write",
    resource: "item",
    policy: "requireAuth",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    method: "GET",
    path: "/items/:id",
    description: "Get item by ID",
    capability: "read",
    resource: "item",
  },
];

// ---------------------------------------------------------------------------
// generateA2AAgentCard
// ---------------------------------------------------------------------------

describe("generateA2AAgentCard", () => {
  it("returns agent card with name, url, version", () => {
    const card = generateA2AAgentCard(testConfig, testRoutes);
    expect(card.name).toBe("a2a-test-app");
    expect(card.url).toBe("http://localhost:4000");
    expect(card.version).toBe("1.0.0");
  });

  it("includes description from config", () => {
    const card = generateA2AAgentCard(testConfig, testRoutes);
    expect(card.description).toBe("A2A test application");
  });

  it("card includes skills array from routes", () => {
    const card = generateA2AAgentCard(testConfig, testRoutes);
    expect(card.skills.length).toBe(testRoutes.length);
    const skillIds = card.skills.map((s) => s.id);
    expect(skillIds).toContain("get_items");
    expect(skillIds).toContain("post_items");
    expect(skillIds).toContain("get_items_by_id");
  });

  it("card includes authentication schemes", () => {
    const card = generateA2AAgentCard(testConfig, testRoutes);
    expect(card.authentication).toBeDefined();
    expect(card.authentication!.schemes).toContain("bearer");
  });

  it("skills include inputSchema and outputSchema when present", () => {
    const card = generateA2AAgentCard(testConfig, testRoutes);
    const getItems = card.skills.find((s) => s.id === "get_items");
    expect(getItems!.inputSchema).toBeDefined();
    expect(getItems!.outputSchema).toBeDefined();
  });

  it("skills use description as name when available", () => {
    const card = generateA2AAgentCard(testConfig, testRoutes);
    const getItems = card.skills.find((s) => s.id === "get_items");
    expect(getItems!.name).toBe("List all items");
    expect(getItems!.description).toBe("List all items");
  });

  it("defaults url to localhost:3000 when baseUrl not provided", () => {
    const config: AgentConfig = { name: "no-url-app" };
    const card = generateA2AAgentCard(config, []);
    expect(card.url).toBe("http://localhost:3000");
  });

  it("includes streaming capability", () => {
    const card = generateA2AAgentCard(testConfig, testRoutes);
    expect(card.capabilities.streaming).toBe(true);
    expect(card.capabilities.pushNotifications).toBe(false);
  });

  it("handles empty routes array", () => {
    const card = generateA2AAgentCard(testConfig, []);
    expect(card.skills.length).toBe(0);
    expect(card.name).toBe("a2a-test-app");
  });

  it("handles route without description — uses humanized tool name", () => {
    const routes: RouteRegistryEntry[] = [
      { method: "GET", path: "/orders" },
    ];
    const card = generateA2AAgentCard(testConfig, routes);
    const skill = card.skills[0]!;
    expect(skill.id).toBe("get_orders");
    expect(skill.name).toBe("Get Orders");
    expect(skill.description).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createA2AHandler
// ---------------------------------------------------------------------------

describe("createA2AHandler", () => {
  let executeRoute: (method: string, path: string, input: unknown) => Promise<unknown>;

  beforeEach(() => {
    executeRoute = async (_method: string, _path: string, input: unknown) => {
      return { success: true, received: input };
    };
  });

  it("returns handleRequest and getAgentCard functions", () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    expect(typeof handler.handleRequest).toBe("function");
    expect(typeof handler.getAgentCard).toBe("function");
    expect(typeof handler.handleStreamRequest).toBe("function");
  });

  it("getAgentCard returns the generated agent card", () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    const card = handler.getAgentCard();
    expect(card.name).toBe("a2a-test-app");
    expect(card.skills.length).toBe(testRoutes.length);
  });

  it("handleRequest with tasks/send creates and completes a task", async () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tasks/send",
      params: { skill: "get_items", input: { limit: 10 } },
    });

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();
    const task = response.result as A2ATask;
    expect(task.status).toBe("completed");
    expect(task.skill).toBe("get_items");
    expect(task.output).toEqual({ success: true, received: { limit: 10 } });
  });

  it("handleRequest with tasks/get retrieves a completed task", async () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);

    // First send a task
    const sendResponse = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tasks/send",
      params: { skill: "get_items" },
    });
    const sentTask = sendResponse.result as A2ATask;

    // Then retrieve it
    const getResponse = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/get",
      params: { id: sentTask.id },
    });

    expect(getResponse.error).toBeUndefined();
    const retrievedTask = getResponse.result as A2ATask;
    expect(retrievedTask.id).toBe(sentTask.id);
    expect(retrievedTask.status).toBe("completed");
  });

  it("handleRequest with unknown method returns error", async () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tasks/unknown",
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32601);
    expect(response.error!.message).toContain("Method not found");
  });

  it("handleRequest validates JSON-RPC structure — null body", async () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    const response = await handler.handleRequest(null);

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32600);
    expect(response.error!.message).toContain("Invalid JSON-RPC request");
  });

  it("handleRequest validates JSON-RPC version", async () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    const response = await handler.handleRequest({
      jsonrpc: "1.0",
      method: "tasks/send",
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32600);
    expect(response.error!.message).toContain("Invalid JSON-RPC version");
  });

  it("task with handler error transitions to failed", async () => {
    const failingExecute = async () => {
      throw new Error("Route execution failed");
    };
    const handler = createA2AHandler(testConfig, testRoutes, failingExecute);
    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tasks/send",
      params: { skill: "get_items" },
    });

    const task = response.result as A2ATask;
    expect(task.status).toBe("failed");
    expect(task.error).toBe("Route execution failed");
  });

  it("tasks/send with unknown skill returns error", async () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tasks/send",
      params: { skill: "nonexistent_skill" },
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32602);
    expect(response.error!.message).toContain("Unknown skill");
  });

  it("tasks/send without skill param returns error", async () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tasks/send",
      params: {},
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32602);
    expect(response.error!.message).toContain("Missing required parameter: skill");
  });

  it("tasks/get with missing id returns error", async () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tasks/get",
      params: {},
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32602);
    expect(response.error!.message).toContain("Missing required parameter: id");
  });

  it("tasks/get with nonexistent task id returns error", async () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "tasks/get",
      params: { id: "task_nonexistent" },
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32602);
    expect(response.error!.message).toContain("Task not found");
  });

  it("agent/card method returns the agent card", async () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 9,
      method: "agent/card",
    });

    expect(response.error).toBeUndefined();
    const card = response.result as A2AAgentCard;
    expect(card.name).toBe("a2a-test-app");
  });

  it("handleRequest with body missing method field returns error", async () => {
    const handler = createA2AHandler(testConfig, testRoutes, executeRoute);
    const response = await handler.handleRequest({ jsonrpc: "2.0", id: 10 });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32600);
  });

  it("task with non-Error thrown transitions to failed with generic message", async () => {
    const failingExecute = async () => {
      throw "string error"; // eslint-disable-line no-throw-literal
    };
    const handler = createA2AHandler(testConfig, testRoutes, failingExecute);
    const response = await handler.handleRequest({
      jsonrpc: "2.0",
      id: 11,
      method: "tasks/send",
      params: { skill: "get_items" },
    });

    const task = response.result as A2ATask;
    expect(task.status).toBe("failed");
    expect(task.error).toBe("Unknown error during execution");
  });
});

// ---------------------------------------------------------------------------
// formatSseEvent
// ---------------------------------------------------------------------------

describe("formatSseEvent", () => {
  it("produces correct SSE format for task_status", () => {
    const task: A2ATask = {
      id: "task_123",
      status: "working",
      skill: "get_items",
    };
    const event: A2AStreamEvent = { type: "task_status", task };
    const output = formatSseEvent(event);

    expect(output).toBe(
      `event: task_status\ndata: ${JSON.stringify(task)}\n\n`,
    );
  });

  it("produces correct SSE format for task_result", () => {
    const task: A2ATask = {
      id: "task_456",
      status: "completed",
      skill: "post_items",
      output: { created: true },
    };
    const event: A2AStreamEvent = { type: "task_result", task };
    const output = formatSseEvent(event);

    expect(output).toContain("event: task_result\n");
    expect(output).toContain(`data: ${JSON.stringify(task)}\n\n`);
  });

  it("ends with double newline", () => {
    const event: A2AStreamEvent = {
      type: "task_status",
      task: { id: "t1", status: "submitted", skill: "x" },
    };
    expect(formatSseEvent(event).endsWith("\n\n")).toBe(true);
  });
});

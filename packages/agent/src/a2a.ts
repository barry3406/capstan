import type { AgentConfig, RouteRegistryEntry } from "./types.js";
import { routeToToolName } from "./mcp.js";

// ---------------------------------------------------------------------------
// A2A Types — Google's Agent-to-Agent protocol
// ---------------------------------------------------------------------------

/** Agent Card served at `/.well-known/agent.json`. */
export interface A2AAgentCard {
  name: string;
  description?: string;
  url: string;
  version: string;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
  };
  skills: Array<{
    id: string;
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }>;
  authentication?: {
    schemes: string[];
  };
}

/** A2A task representing a unit of work submitted to an agent. */
export interface A2ATask {
  id: string;
  status:
    | "submitted"
    | "working"
    | "input-required"
    | "completed"
    | "failed"
    | "canceled";
  skill: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

/** SSE event for A2A streaming responses. */
export interface A2AStreamEvent {
  type: "task_status" | "task_result";
  task: A2ATask;
}

/** JSON-RPC request envelope used by the A2A protocol. */
interface A2AJsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC response envelope. */
interface A2AJsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ---------------------------------------------------------------------------
// Agent Card generation
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable skill name from a tool ID.
 *
 *   "get_tickets" -> "Get Tickets"
 */
function humanizeToolName(toolName: string): string {
  return toolName
    .split("_")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Generate an A2A Agent Card from the agent configuration and registered
 * routes. Each route is mapped to an A2A "skill".
 */
export function generateA2AAgentCard(
  config: AgentConfig,
  routes: RouteRegistryEntry[],
): A2AAgentCard {
  const skills: A2AAgentCard["skills"] = routes.map((route) => {
    const id = routeToToolName(route.method, route.path);
    return {
      id,
      name: route.description ?? humanizeToolName(id),
      ...(route.description !== undefined
        ? { description: route.description }
        : {}),
      ...(route.inputSchema !== undefined
        ? { inputSchema: route.inputSchema }
        : {}),
      ...(route.outputSchema !== undefined
        ? { outputSchema: route.outputSchema }
        : {}),
    };
  });

  return {
    name: config.name,
    ...(config.description !== undefined
      ? { description: config.description }
      : {}),
    url: config.baseUrl ?? "http://localhost:3000",
    version: "1.0.0",
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    skills,
    authentication: {
      schemes: ["bearer"],
    },
  };
}

// ---------------------------------------------------------------------------
// A2A Handler
// ---------------------------------------------------------------------------

/** Generate a unique task ID. */
function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `task_${timestamp}_${random}`;
}

/**
 * Resolve a skill ID to the corresponding route's method and path.
 */
function resolveSkill(
  skillId: string,
  routes: RouteRegistryEntry[],
): { method: string; path: string } | null {
  for (const route of routes) {
    if (routeToToolName(route.method, route.path) === skillId) {
      return { method: route.method, path: route.path };
    }
  }
  return null;
}

/**
 * Format an A2AStreamEvent as an SSE data line.
 *
 * Each event is serialised as:
 *   event: <type>\n
 *   data: <json>\n\n
 */
export function formatSseEvent(event: A2AStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.task)}\n\n`;
}

/**
 * Create an A2A handler that processes JSON-RPC requests according to
 * Google's Agent-to-Agent protocol.
 *
 * Supported methods:
 * - `tasks/send`  — create a task, execute the matching skill, return result
 * - `tasks/get`   — retrieve the current status of a task
 * - `agent/card`  — return the agent card
 *
 * Tasks are tracked in an in-memory Map so callers can query status after
 * submission.
 *
 * When `handleStreamRequest` is used (for `Accept: text/event-stream`
 * requests), the handler returns an `AsyncGenerator` of `A2AStreamEvent`
 * objects that the caller can pipe to an SSE response. Progress events
 * (`task_status`) are emitted as the task transitions through its
 * lifecycle, followed by a final `task_result` event on completion or
 * failure.
 */
export function createA2AHandler(
  config: AgentConfig,
  routes: RouteRegistryEntry[],
  executeRoute: (
    method: string,
    path: string,
    input: unknown,
  ) => Promise<unknown>,
): {
  handleRequest: (body: unknown) => Promise<A2AJsonRpcResponse>;
  handleStreamRequest: (
    body: unknown,
  ) => AsyncGenerator<A2AStreamEvent, void, unknown>;
  getAgentCard: () => A2AAgentCard;
} {
  const tasks = new Map<string, A2ATask>();
  const agentCard = generateA2AAgentCard(config, routes);

  function errorResponse(
    id: string | number | null | undefined,
    code: number,
    message: string,
    data?: unknown,
  ): A2AJsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    };
  }

  function successResponse(
    id: string | number | null | undefined,
    result: unknown,
  ): A2AJsonRpcResponse {
    return {
      jsonrpc: "2.0",
      id: id ?? null,
      result,
    };
  }

  async function handleTasksSend(
    reqId: string | number | undefined,
    params: Record<string, unknown>,
  ): Promise<A2AJsonRpcResponse> {
    const skillId = params["skill"] as string | undefined;
    if (!skillId) {
      return errorResponse(reqId, -32602, "Missing required parameter: skill");
    }

    const resolved = resolveSkill(skillId, routes);
    if (!resolved) {
      return errorResponse(reqId, -32602, `Unknown skill: ${skillId}`);
    }

    const taskId = generateTaskId();
    const task: A2ATask = {
      id: taskId,
      status: "submitted",
      skill: skillId,
      input: params["input"],
    };
    tasks.set(taskId, task);

    // Transition to working.
    task.status = "working";

    try {
      const result = await executeRoute(
        resolved.method,
        resolved.path,
        params["input"],
      );
      task.status = "completed";
      task.output = result;
    } catch (err: unknown) {
      task.status = "failed";
      task.error =
        err instanceof Error ? err.message : "Unknown error during execution";
    }

    return successResponse(reqId, task);
  }

  /**
   * Streaming variant of `handleTasksSend`. Yields SSE events as the task
   * transitions through submitted -> working -> completed/failed.
   */
  async function* handleTasksSendStream(
    params: Record<string, unknown>,
  ): AsyncGenerator<A2AStreamEvent, void, unknown> {
    const skillId = params["skill"] as string | undefined;
    if (!skillId) {
      const errTask: A2ATask = {
        id: generateTaskId(),
        status: "failed",
        skill: "unknown",
        error: "Missing required parameter: skill",
      };
      yield { type: "task_result", task: errTask };
      return;
    }

    const resolved = resolveSkill(skillId, routes);
    if (!resolved) {
      const errTask: A2ATask = {
        id: generateTaskId(),
        status: "failed",
        skill: skillId,
        error: `Unknown skill: ${skillId}`,
      };
      yield { type: "task_result", task: errTask };
      return;
    }

    const taskId = generateTaskId();
    const task: A2ATask = {
      id: taskId,
      status: "submitted",
      skill: skillId,
      input: params["input"],
    };
    tasks.set(taskId, task);

    // Emit submitted status
    yield { type: "task_status", task: { ...task } };

    // Transition to working
    task.status = "working";
    yield { type: "task_status", task: { ...task } };

    try {
      const result = await executeRoute(
        resolved.method,
        resolved.path,
        params["input"],
      );
      task.status = "completed";
      task.output = result;
    } catch (err: unknown) {
      task.status = "failed";
      task.error =
        err instanceof Error ? err.message : "Unknown error during execution";
    }

    // Emit final result event
    yield { type: "task_result", task: { ...task } };
  }

  function handleTasksGet(
    reqId: string | number | undefined,
    params: Record<string, unknown>,
  ): A2AJsonRpcResponse {
    const taskId = params["id"] as string | undefined;
    if (!taskId) {
      return errorResponse(reqId, -32602, "Missing required parameter: id");
    }

    const task = tasks.get(taskId);
    if (!task) {
      return errorResponse(reqId, -32602, `Task not found: ${taskId}`);
    }

    return successResponse(reqId, task);
  }

  async function handleRequest(body: unknown): Promise<A2AJsonRpcResponse> {
    // Validate JSON-RPC envelope.
    if (
      body === null ||
      typeof body !== "object" ||
      !("method" in (body as object))
    ) {
      return errorResponse(null, -32600, "Invalid JSON-RPC request");
    }

    const rpc = body as A2AJsonRpcRequest;

    if (rpc.jsonrpc !== "2.0") {
      return errorResponse(rpc.id, -32600, "Invalid JSON-RPC version");
    }

    const params = rpc.params ?? {};

    switch (rpc.method) {
      case "tasks/send":
        return handleTasksSend(rpc.id, params);
      case "tasks/get":
        return handleTasksGet(rpc.id, params);
      case "agent/card":
        return successResponse(rpc.id, agentCard);
      default:
        return errorResponse(
          rpc.id,
          -32601,
          `Method not found: ${rpc.method}`,
        );
    }
  }

  /**
   * SSE streaming request handler.
   *
   * Validates the JSON-RPC envelope and, for `tasks/send`, returns an async
   * generator of `A2AStreamEvent` values. For non-streamable methods the
   * generator yields a single `task_result` event wrapping the synchronous
   * response.
   */
  async function* handleStreamRequest(
    body: unknown,
  ): AsyncGenerator<A2AStreamEvent, void, unknown> {
    if (
      body === null ||
      typeof body !== "object" ||
      !("method" in (body as object))
    ) {
      const errTask: A2ATask = {
        id: generateTaskId(),
        status: "failed",
        skill: "unknown",
        error: "Invalid JSON-RPC request",
      };
      yield { type: "task_result", task: errTask };
      return;
    }

    const rpc = body as A2AJsonRpcRequest;

    if (rpc.jsonrpc !== "2.0") {
      const errTask: A2ATask = {
        id: generateTaskId(),
        status: "failed",
        skill: "unknown",
        error: "Invalid JSON-RPC version",
      };
      yield { type: "task_result", task: errTask };
      return;
    }

    const params = rpc.params ?? {};

    if (rpc.method === "tasks/send") {
      yield* handleTasksSendStream(params);
      return;
    }

    // Non-streamable methods: fall back to synchronous handling and wrap
    // the result in a single event.
    const response = await handleRequest(body);
    const fallbackTask: A2ATask = {
      id: generateTaskId(),
      status: response.error ? "failed" : "completed",
      skill: "unknown",
      ...(response.result !== undefined ? { output: response.result } : {}),
      ...(response.error ? { error: response.error.message } : {}),
    };
    yield { type: "task_result", task: fallbackTask };
  }

  return {
    handleRequest,
    handleStreamRequest,
    getAgentCard: () => agentCard,
  };
}

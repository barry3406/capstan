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
      streaming: false,
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

  return {
    handleRequest,
    getAgentCard: () => agentCard,
  };
}

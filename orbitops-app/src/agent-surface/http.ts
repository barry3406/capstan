import {
  defaultAgentSurfaceTransport,
  type AgentSurfaceRequest,
  type AgentSurfaceResponse,
  type AgentSurfaceTransport
} from "./transport.js";

export interface AgentSurfaceHttpRequest {
  method: string;
  path: string;
  query?: Record<string, string | readonly string[] | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

export interface AgentSurfaceHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface AgentSurfaceHttpTransport {
  handle(request: AgentSurfaceHttpRequest): Promise<AgentSurfaceHttpResponse>;
}

class HttpRouteError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function readQueryValue(
  query: AgentSurfaceHttpRequest["query"],
  key: string
): string | undefined {
  const value = query?.[key];

  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function isWorkflowStatusValue(
  value: unknown
): value is Extract<Extract<AgentSurfaceRequest, { operation: "listWorkflowRuns" }>["status"], string> {
  return (
    value === "running" ||
    value === "paused" ||
    value === "approval_required" ||
    value === "input_required" ||
    value === "failed" ||
    value === "blocked" ||
    value === "completed" ||
    value === "cancelled"
  );
}

function isWorkflowAttentionStatusValue(
  value: unknown
): value is Extract<Extract<AgentSurfaceRequest, { operation: "listAttentionItems" }>["status"], string> {
  return (
    value === "paused" ||
    value === "approval_required" ||
    value === "input_required" ||
    value === "failed" ||
    value === "blocked" ||
    value === "cancelled"
  );
}

function readBooleanQueryValue(
  query: AgentSurfaceHttpRequest["query"],
  key: string
): boolean | undefined {
  const value = readQueryValue(query, key);

  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new HttpRouteError(
    400,
    "invalid_query_boolean",
    `Query parameter "${key}" must be "true" or "false".`
  );
}

function normalizePath(path: string): string {
  const normalized = path.trim() || "/";
  return normalized.endsWith("/") && normalized !== "/" ? normalized.slice(0, -1) : normalized;
}

function ensureObjectBody(body: unknown, message: string): Record<string, unknown> {
  if (!body) {
    return {};
  }

  if (typeof body !== "object" || Array.isArray(body)) {
    throw new HttpRouteError(400, "invalid_body", message);
  }

  return body as Record<string, unknown>;
}

function decodePathSegment(value: string, message: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpRouteError(400, "invalid_path", message);
  }
}

function parseRpcRequest(body: unknown): AgentSurfaceRequest {
  const payload = ensureObjectBody(body, "RPC requests must carry a JSON object body.");
  const operation = payload.operation;

  if (typeof operation !== "string") {
    throw new HttpRouteError(400, "invalid_rpc_operation", "RPC requests must include an operation.");
  }

  switch (operation) {
    case "manifest":
      return { operation };
    case "resource":
      if (typeof payload.key !== "string" || !payload.key.trim()) {
        throw new HttpRouteError(400, "invalid_rpc_key", "RPC resource requests must include a key.");
      }

      return {
        operation,
        key: payload.key
      };
    case "search":
      return {
        operation,
        ...(typeof payload.query === "string" ? { query: payload.query } : {})
      };
    case "listAttentionItems": {
      if (typeof payload.status !== "undefined" && !isWorkflowAttentionStatusValue(payload.status)) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_status",
          "RPC listAttentionItems status must be a supported attention status."
        );
      }

      return {
        operation,
        ...(typeof payload.taskKey === "string" ? { taskKey: payload.taskKey } : {}),
        ...(typeof payload.resourceKey === "string" ? { resourceKey: payload.resourceKey } : {}),
        ...(typeof payload.routeKey === "string" ? { routeKey: payload.routeKey } : {}),
        ...(typeof payload.actionKey === "string" ? { actionKey: payload.actionKey } : {}),
        ...(isWorkflowAttentionStatusValue(payload.status) ? { status: payload.status } : {})
      };
    }
    case "listAttentionQueues":
      return {
        operation,
        ...(typeof payload.taskKey === "string" ? { taskKey: payload.taskKey } : {}),
        ...(typeof payload.resourceKey === "string" ? { resourceKey: payload.resourceKey } : {}),
        ...(typeof payload.routeKey === "string" ? { routeKey: payload.routeKey } : {}),
        ...(typeof payload.actionKey === "string" ? { actionKey: payload.actionKey } : {})
      };
    case "executeAction":
      if (typeof payload.routeKey !== "string" || !payload.routeKey.trim()) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_route_key",
          "RPC executeAction requests must include a routeKey."
        );
      }

      if (typeof payload.actionKey !== "string" || !payload.actionKey.trim()) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_action_key",
          "RPC executeAction requests must include an actionKey."
        );
      }

      return {
        operation,
        routeKey: payload.routeKey,
        actionKey: payload.actionKey,
        input: ensureObjectBody(payload.input, "RPC executeAction input must be a JSON object."),
        context: ensureObjectBody(
          payload.context,
          "RPC executeAction context must be a JSON object."
        )
      };
    case "startTaskAction":
      if (typeof payload.routeKey !== "string" || !payload.routeKey.trim()) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_route_key",
          "RPC startTaskAction requests must include a routeKey."
        );
      }

      if (typeof payload.actionKey !== "string" || !payload.actionKey.trim()) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_action_key",
          "RPC startTaskAction requests must include an actionKey."
        );
      }

      return {
        operation,
        routeKey: payload.routeKey,
        actionKey: payload.actionKey,
        input: ensureObjectBody(payload.input, "RPC startTaskAction input must be a JSON object."),
        context: ensureObjectBody(
          payload.context,
          "RPC startTaskAction context must be a JSON object."
        )
      };
    case "execute":
      if (typeof payload.key !== "string" || !payload.key.trim()) {
        throw new HttpRouteError(400, "invalid_rpc_key", "RPC execute requests must include a key.");
      }

      return {
        operation,
        key: payload.key,
        input: ensureObjectBody(payload.input, "RPC execute input must be a JSON object.")
      };
    case "task":
    case "artifact":
    case "startTask":
      if (typeof payload.key !== "string" || !payload.key.trim()) {
        throw new HttpRouteError(400, "invalid_rpc_key", `RPC ${operation} requests must include a key.`);
      }

      return operation === "startTask"
        ? {
            operation,
            key: payload.key,
            input: ensureObjectBody(payload.input, "RPC task input must be a JSON object.")
          }
        : {
            operation,
            key: payload.key
          };
    case "getTaskRun":
    case "getArtifactRecord":
    case "getWorkflowRun":
      if (typeof payload.id !== "string" || !payload.id.trim()) {
        throw new HttpRouteError(400, "invalid_rpc_id", `RPC ${operation} requests must include an id.`);
      }

      return {
        operation,
        id: payload.id
      };
    case "advanceWorkflowRun":
      if (typeof payload.id !== "string" || !payload.id.trim()) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_id",
          "RPC advanceWorkflowRun requests must include an id."
        );
      }

      if (
        payload.action !== "approve" &&
        payload.action !== "provideInput" &&
        payload.action !== "retry" &&
        payload.action !== "cancel"
      ) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_action",
          "RPC advanceWorkflowRun requests must include a supported action."
        );
      }

      return {
        operation,
        id: payload.id,
        action: payload.action,
        input: ensureObjectBody(
          payload.input,
          "RPC advanceWorkflowRun input must be a JSON object."
        ),
        ...(typeof payload.note === "string" ? { note: payload.note } : {})
      };
    case "listTaskRuns":
      return {
        operation,
        ...(typeof payload.taskKey === "string" ? { taskKey: payload.taskKey } : {})
      };
    case "listWorkflowRuns": {
      if (typeof payload.status !== "undefined" && !isWorkflowStatusValue(payload.status)) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_status",
          "RPC listWorkflowRuns status must be a supported workflow status."
        );
      }

      if (typeof payload.attentionOnly !== "undefined" && typeof payload.attentionOnly !== "boolean") {
        throw new HttpRouteError(
          400,
          "invalid_rpc_attention",
          "RPC listWorkflowRuns attentionOnly must be a boolean."
        );
      }

      return {
        operation,
        ...(typeof payload.taskKey === "string" ? { taskKey: payload.taskKey } : {}),
        ...(typeof payload.routeKey === "string" ? { routeKey: payload.routeKey } : {}),
        ...(typeof payload.actionKey === "string" ? { actionKey: payload.actionKey } : {}),
        ...(isWorkflowStatusValue(payload.status) ? { status: payload.status } : {}),
        ...(typeof payload.attentionOnly === "boolean"
          ? { attentionOnly: payload.attentionOnly }
          : {})
      };
    }
    case "listArtifactRecords":
      return {
        operation,
        ...(typeof payload.artifactKey === "string" ? { artifactKey: payload.artifactKey } : {})
      };
    default:
      throw new HttpRouteError(400, "unsupported_rpc_operation", `Unsupported RPC operation "${operation}".`);
  }
}

function mapHttpRequestToAgentRequest(request: AgentSurfaceHttpRequest): AgentSurfaceRequest {
  const method = request.method.toUpperCase();
  const path = normalizePath(request.path);
  const segments = path.split("/").filter(Boolean);

  if (method === "GET" && path === "/manifest") {
    return { operation: "manifest" };
  }

  if (method === "GET" && path === "/search") {
    const query = readQueryValue(request.query, "q") ?? readQueryValue(request.query, "query");
    return {
      operation: "search",
      ...(query ? { query } : {})
    };
  }

  if (method === "GET" && path === "/attention-items") {
    const taskKey = readQueryValue(request.query, "taskKey");
    const resourceKey = readQueryValue(request.query, "resourceKey");
    const routeKey = readQueryValue(request.query, "routeKey");
    const actionKey = readQueryValue(request.query, "actionKey");
    const status = readQueryValue(request.query, "status");

    if (typeof status !== "undefined" && !isWorkflowAttentionStatusValue(status)) {
      throw new HttpRouteError(
        400,
        "invalid_attention_status",
        "Attention item status filters must use a supported attention status."
      );
    }

    return {
      operation: "listAttentionItems",
      ...(taskKey ? { taskKey } : {}),
      ...(resourceKey ? { resourceKey } : {}),
      ...(routeKey ? { routeKey } : {}),
      ...(actionKey ? { actionKey } : {}),
      ...(status ? { status } : {})
    };
  }

  if (method === "GET" && path === "/attention-queues") {
    const taskKey = readQueryValue(request.query, "taskKey");
    const resourceKey = readQueryValue(request.query, "resourceKey");
    const routeKey = readQueryValue(request.query, "routeKey");
    const actionKey = readQueryValue(request.query, "actionKey");

    return {
      operation: "listAttentionQueues",
      ...(taskKey ? { taskKey } : {}),
      ...(resourceKey ? { resourceKey } : {}),
      ...(routeKey ? { routeKey } : {}),
      ...(actionKey ? { actionKey } : {})
    };
  }

  if (method === "POST" && path === "/rpc") {
    return parseRpcRequest(request.body);
  }

  if (method === "GET" && path === "/task-runs") {
    const taskKey = readQueryValue(request.query, "taskKey");
    return {
      operation: "listTaskRuns",
      ...(taskKey ? { taskKey } : {})
    };
  }

  if (method === "GET" && path === "/workflow-runs") {
    const taskKey = readQueryValue(request.query, "taskKey");
    const routeKey = readQueryValue(request.query, "routeKey");
    const actionKey = readQueryValue(request.query, "actionKey");
    const status = readQueryValue(request.query, "status");
    const attentionOnly = readBooleanQueryValue(request.query, "attentionOnly");

    if (typeof status !== "undefined" && !isWorkflowStatusValue(status)) {
      throw new HttpRouteError(
        400,
        "invalid_workflow_status",
        "Workflow run status filters must use a supported workflow status."
      );
    }

    return {
      operation: "listWorkflowRuns",
      ...(taskKey ? { taskKey } : {}),
      ...(routeKey ? { routeKey } : {}),
      ...(actionKey ? { actionKey } : {}),
      ...(status ? { status } : {}),
      ...(typeof attentionOnly === "boolean" ? { attentionOnly } : {})
    };
  }

  if (method === "GET" && segments[0] === "workflow-runs" && segments[1]) {
    return {
      operation: "getWorkflowRun",
      id: decodePathSegment(segments[1], "Workflow run ids must be URL-encoded strings.")
    };
  }

  if (
    method === "POST" &&
    segments[0] === "workflow-runs" &&
    segments[1] &&
    segments[2] === "actions" &&
    segments[3]
  ) {
    const action = decodePathSegment(
      segments[3],
      "Workflow action path segments must be URL-encoded strings."
    );

    if (
      action !== "approve" &&
      action !== "provideInput" &&
      action !== "retry" &&
      action !== "cancel"
    ) {
      throw new HttpRouteError(
        400,
        "invalid_workflow_action",
        `Unsupported workflow action "${action}".`
      );
    }

    const body = ensureObjectBody(
      request.body,
      "Workflow advance requests must carry a JSON object body."
    );

    return {
      operation: "advanceWorkflowRun",
      id: decodePathSegment(segments[1], "Workflow run ids must be URL-encoded strings."),
      action,
      input: ensureObjectBody(body.input, "Workflow advance input must be a JSON object."),
      ...(typeof body.note === "string" ? { note: body.note } : {})
    };
  }

  if (method === "GET" && path === "/artifact-records") {
    const artifactKey = readQueryValue(request.query, "artifactKey");
    return {
      operation: "listArtifactRecords",
      ...(artifactKey ? { artifactKey } : {})
    };
  }

  if (method === "POST" && segments[0] === "execute" && segments[1]) {
    return {
      operation: "execute",
      key: decodePathSegment(segments[1], "Execute path segments must be URL-encoded strings."),
      input: ensureObjectBody(request.body, "Execute requests must carry a JSON object body.")
    };
  }

  if (
    method === "POST" &&
    segments[0] === "routes" &&
    segments[1] &&
    segments[2] === "actions" &&
    segments[3] &&
    segments[4] === "execute"
  ) {
    const body = ensureObjectBody(
      request.body,
      "Route action execute requests must carry a JSON object body."
    );

    return {
      operation: "executeAction",
      routeKey: decodePathSegment(segments[1], "Route path segments must be URL-encoded strings."),
      actionKey: decodePathSegment(segments[3], "Action path segments must be URL-encoded strings."),
      input: ensureObjectBody(body.input, "Route action input must be a JSON object."),
      context: ensureObjectBody(body.context, "Route action context must be a JSON object.")
    };
  }

  if (
    method === "POST" &&
    segments[0] === "routes" &&
    segments[1] &&
    segments[2] === "actions" &&
    segments[3] &&
    segments[4] === "start"
  ) {
    const body = ensureObjectBody(
      request.body,
      "Route action task start requests must carry a JSON object body."
    );

    return {
      operation: "startTaskAction",
      routeKey: decodePathSegment(segments[1], "Route path segments must be URL-encoded strings."),
      actionKey: decodePathSegment(segments[3], "Action path segments must be URL-encoded strings."),
      input: ensureObjectBody(body.input, "Route action task input must be a JSON object."),
      context: ensureObjectBody(body.context, "Route action task context must be a JSON object.")
    };
  }

  if (method === "GET" && segments[0] === "resources" && segments[1]) {
    return {
      operation: "resource",
      key: decodePathSegment(segments[1], "Resource path segments must be URL-encoded strings.")
    };
  }

  if (segments[0] === "tasks" && segments[1]) {
    const key = decodePathSegment(segments[1], "Task path segments must be URL-encoded strings.");

    if (method === "GET" && segments.length === 2) {
      return {
        operation: "task",
        key
      };
    }

    if (method === "POST" && segments[2] === "start") {
      return {
        operation: "startTask",
        key,
        input: ensureObjectBody(request.body, "Task start requests must carry a JSON object body.")
      };
    }
  }

  if (method === "GET" && segments[0] === "task-runs" && segments[1]) {
    return {
      operation: "getTaskRun",
      id: decodePathSegment(segments[1], "Task run ids must be URL-encoded strings.")
    };
  }

  if (method === "GET" && segments[0] === "artifacts" && segments[1]) {
    return {
      operation: "artifact",
      key: decodePathSegment(segments[1], "Artifact path segments must be URL-encoded strings.")
    };
  }

  if (method === "GET" && segments[0] === "artifact-records" && segments[1]) {
    return {
      operation: "getArtifactRecord",
      id: decodePathSegment(segments[1], "Artifact record ids must be URL-encoded strings.")
    };
  }

  throw new HttpRouteError(404, "http_route_not_found", `No HTTP route matches ${method} ${path}.`);
}

function createHttpResponse(
  operation: AgentSurfaceRequest["operation"],
  response: AgentSurfaceResponse
): AgentSurfaceHttpResponse {
  const body = response.ok
    ? response.body
    : {
        error: response.error,
        ...(response.code ? { code: response.code } : {}),
        ...(typeof response.details !== "undefined" ? { details: response.details } : {})
      };

  return {
    status: response.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-capstan-operation": operation,
      "x-capstan-ok": response.ok ? "true" : "false"
    },
    body: `${JSON.stringify(body, null, 2)}\n`
  };
}

export function createAgentSurfaceHttpTransport(
  transport: AgentSurfaceTransport = defaultAgentSurfaceTransport
): AgentSurfaceHttpTransport {
  return {
    async handle(request: AgentSurfaceHttpRequest): Promise<AgentSurfaceHttpResponse> {
      try {
        const mapped = mapHttpRequestToAgentRequest(request);
        const response = await transport.handle(mapped);
        return createHttpResponse(mapped.operation, response);
      } catch (error) {
        if (error instanceof HttpRouteError) {
          return {
            status: error.status,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "x-capstan-ok": "false"
            },
            body: `${JSON.stringify({ error: error.message, code: error.code }, null, 2)}\n`
          };
        }

        return {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-capstan-ok": "false"
          },
          body: `${JSON.stringify(
            {
              error: error instanceof Error ? error.message : String(error),
              code: "http_transport_runtime_error"
            },
            null,
            2
          )}\n`
        };
      }
    }
  };
}

export const defaultAgentSurfaceHttpTransport = createAgentSurfaceHttpTransport();

export async function handleAgentSurfaceHttpRequest(
  request: AgentSurfaceHttpRequest
): Promise<AgentSurfaceHttpResponse> {
  return defaultAgentSurfaceHttpTransport.handle(request);
}

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
    case "search":
      return {
        operation,
        ...(typeof payload.query === "string" ? { query: payload.query } : {})
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
      if (typeof payload.id !== "string" || !payload.id.trim()) {
        throw new HttpRouteError(400, "invalid_rpc_id", `RPC ${operation} requests must include an id.`);
      }

      return {
        operation,
        id: payload.id
      };
    case "listTaskRuns":
      return {
        operation,
        ...(typeof payload.taskKey === "string" ? { taskKey: payload.taskKey } : {})
      };
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

  if (method === "GET" && path === "/artifact-records") {
    const artifactKey = readQueryValue(request.query, "artifactKey");
    return {
      operation: "listArtifactRecords",
      ...(artifactKey ? { artifactKey } : {})
    };
  }

  const segments = path.split("/").filter(Boolean);

  if (method === "POST" && segments[0] === "execute" && segments[1]) {
    return {
      operation: "execute",
      key: decodePathSegment(segments[1], "Execute path segments must be URL-encoded strings."),
      input: ensureObjectBody(request.body, "Execute requests must carry a JSON object body.")
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

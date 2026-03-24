import { agentSurface } from "./index.js";
import {
  type AgentSurfaceRequest,
  type AgentSurfaceResponse,
  type AgentSurfaceTransport,
  defaultAgentSurfaceTransport
} from "./transport.js";

export interface AgentSurfaceA2aSkill {
  id: string;
  name: string;
  description?: string;
  tags: string[];
}

export interface AgentSurfaceA2aCard {
  protocol: "a2a";
  version: "preview";
  name: string;
  description?: string;
  capabilities: {
    stateTransitionHistory: boolean;
    interruptible: boolean;
    memory: boolean;
  };
  defaultInputModes: readonly ["text", "data"];
  defaultOutputModes: readonly ["text", "data"];
  skills: AgentSurfaceA2aSkill[];
}

export interface AgentSurfaceA2aMessage {
  id?: string;
  operation: AgentSurfaceRequest["operation"];
  params?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AgentSurfaceA2aTask {
  id: string;
  state: "working" | "input-required" | "completed" | "failed" | "blocked" | "cancelled";
  operation: AgentSurfaceRequest["operation"];
  message: {
    role: "agent";
    parts: Array<
      | { type: "text"; text: string }
      | { type: "data"; data: unknown }
    >;
  };
  structuredContent?: unknown;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

export interface AgentSurfaceA2aAdapter {
  getCard(): AgentSurfaceA2aCard;
  sendMessage(message: AgentSurfaceA2aMessage): Promise<AgentSurfaceA2aTask>;
}

type AgentSurfaceA2aCapabilityEntry = {
  key: string;
  title: string;
  description?: string;
  mode: string;
  resources: readonly string[];
  task?: string;
  policy?: string;
};

type AgentSurfaceA2aTaskEntry = {
  key: string;
  title: string;
  description?: string;
  kind: string;
  artifactKeys: readonly string[];
};

type AgentSurfaceA2aArtifactEntry = {
  key: string;
  title: string;
  description?: string;
  kind: string;
  taskKeys: readonly string[];
};

let a2aTaskSequence = 0;

function createA2aTaskId(operation: AgentSurfaceRequest["operation"]): string {
  a2aTaskSequence += 1;
  return `a2a-${operation}-${String(a2aTaskSequence).padStart(4, "0")}`;
}

function ensureObjectParams(params: unknown): Record<string, unknown> {
  if (!params) {
    return {};
  }

  if (typeof params !== "object" || Array.isArray(params)) {
    throw new Error("A2A message params must be a JSON object.");
  }

  return params as Record<string, unknown>;
}

function readRequiredString(
  params: Record<string, unknown>,
  key: string,
  message: string
): string {
  const value = params[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }

  return value;
}

function readOptionalString(
  params: Record<string, unknown>,
  key: string
): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readObjectParam(
  params: Record<string, unknown>,
  key: string,
  message: string
): Record<string, unknown> {
  const value = params[key];

  if (typeof value === "undefined") {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function mapA2aMessageToRequest(message: AgentSurfaceA2aMessage): AgentSurfaceRequest {
  const params = ensureObjectParams(message.params);

  switch (message.operation) {
    case "manifest":
      return { operation: "manifest" };
    case "search": {
      const query = readOptionalString(params, "query");
      return {
        operation: "search",
        ...(query ? { query } : {})
      };
    }
    case "execute":
      return {
        operation: "execute",
        key: readRequiredString(params, "key", "A2A execute requires a capability key."),
        input: readObjectParam(params, "input", "A2A execute input must be a JSON object.")
      };
    case "task":
      return {
        operation: "task",
        key: readRequiredString(params, "key", "A2A task lookup requires a task key.")
      };
    case "artifact":
      return {
        operation: "artifact",
        key: readRequiredString(params, "key", "A2A artifact lookup requires an artifact key.")
      };
    case "startTask":
      return {
        operation: "startTask",
        key: readRequiredString(params, "key", "A2A task start requires a task key."),
        input: readObjectParam(params, "input", "A2A task input must be a JSON object.")
      };
    case "getTaskRun":
      return {
        operation: "getTaskRun",
        id: readRequiredString(params, "id", "A2A getTaskRun requires a task run id.")
      };
    case "listTaskRuns": {
      const taskKey = readOptionalString(params, "taskKey");
      return {
        operation: "listTaskRuns",
        ...(taskKey ? { taskKey } : {})
      };
    }
    case "getArtifactRecord":
      return {
        operation: "getArtifactRecord",
        id: readRequiredString(params, "id", "A2A getArtifactRecord requires a record id.")
      };
    case "listArtifactRecords": {
      const artifactKey = readOptionalString(params, "artifactKey");
      return {
        operation: "listArtifactRecords",
        ...(artifactKey ? { artifactKey } : {})
      };
    }
  }

  const unsupportedOperation: never = message.operation;
  return unsupportedOperation;
}

function mapAgentResponseToA2aState(response: AgentSurfaceResponse): AgentSurfaceA2aTask["state"] {
  if (!response.ok) {
    if (response.code === "agent_transport_approval_required") {
      return "input-required";
    }

    if (response.code === "agent_transport_blocked") {
      return "blocked";
    }

    if (response.code === "agent_transport_cancelled") {
      return "cancelled";
    }

    return "failed";
  }

  const body = response.body;

  if (!body || typeof body !== "object" || Array.isArray(body) || !("status" in body)) {
    return "completed";
  }

  const status = body.status;

  if (typeof status !== "string") {
    return "completed";
  }

  switch (status) {
    case "pending":
    case "running":
    case "ready":
    case "awaiting_execution":
      return "working";
    case "input_required":
    case "approval_required":
      return "input-required";
    case "blocked":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "completed";
  }
}

function createA2aCard(): AgentSurfaceA2aCard {
  const capabilitySkills = (agentSurface.capabilities as readonly unknown[]).map((entry) => {
    const capability = entry as AgentSurfaceA2aCapabilityEntry;

    return {
      id: `capability:${capability.key}`,
      name: capability.title,
      ...(typeof capability.description === "string"
        ? { description: capability.description }
        : {}),
      tags: [
        "capability",
        capability.mode,
        ...capability.resources,
        ...(typeof capability.task === "string" ? [capability.task] : []),
        ...(typeof capability.policy === "string" ? [capability.policy] : [])
      ]
    };
  });
  const taskSkills = (agentSurface.tasks as readonly unknown[]).map((entry) => {
    const task = entry as AgentSurfaceA2aTaskEntry;

    return {
      id: `task:${task.key}`,
      name: task.title,
      ...(typeof task.description === "string" ? { description: task.description } : {}),
      tags: ["task", task.kind, ...task.artifactKeys]
    };
  });
  const artifactSkills = (agentSurface.artifacts as readonly unknown[]).map((entry) => {
    const artifact = entry as AgentSurfaceA2aArtifactEntry;

    return {
      id: `artifact:${artifact.key}`,
      name: artifact.title,
      ...(typeof artifact.description === "string"
        ? { description: artifact.description }
        : {}),
      tags: ["artifact", artifact.kind, ...artifact.taskKeys]
    };
  });

  return {
    protocol: "a2a",
    version: "preview",
    name: agentSurface.domain.title,
    ...("description" in agentSurface.domain &&
    typeof agentSurface.domain.description === "string"
      ? { description: agentSurface.domain.description }
      : {}),
    capabilities: {
      stateTransitionHistory: true,
      interruptible: true,
      memory: true
    },
    defaultInputModes: ["text", "data"],
    defaultOutputModes: ["text", "data"],
    skills: [...capabilitySkills, ...taskSkills, ...artifactSkills]
  };
}

function createA2aTask(
  taskId: string,
  operation: AgentSurfaceRequest["operation"],
  response: AgentSurfaceResponse
): AgentSurfaceA2aTask {
  const state = mapAgentResponseToA2aState(response);

  if (response.ok) {
    return {
      id: taskId,
      state,
      operation,
      message: {
        role: "agent",
        parts: [
          {
            type: "text",
            text: `Capstan completed ${operation} via the shared control plane.`
          },
          {
            type: "data",
            data: response.body
          }
        ]
      },
      structuredContent: response.body
    };
  }

  return {
    id: taskId,
    state,
    operation,
    message: {
      role: "agent",
      parts: [
        {
          type: "text",
          text: response.error
        }
      ]
    },
    error: {
      message: response.error,
      ...(response.code ? { code: response.code } : {}),
      ...(typeof response.details !== "undefined" ? { details: response.details } : {})
    }
  };
}

export function getAgentSurfaceA2aCard(): AgentSurfaceA2aCard {
  return createA2aCard();
}

export function createAgentSurfaceA2aAdapter(
  transport: AgentSurfaceTransport = defaultAgentSurfaceTransport
): AgentSurfaceA2aAdapter {
  return {
    getCard(): AgentSurfaceA2aCard {
      return getAgentSurfaceA2aCard();
    },
    async sendMessage(message: AgentSurfaceA2aMessage): Promise<AgentSurfaceA2aTask> {
      const request = mapA2aMessageToRequest(message);
      const response = await transport.handle(request);
      return createA2aTask(message.id ?? createA2aTaskId(request.operation), request.operation, response);
    }
  };
}

export const defaultAgentSurfaceA2aAdapter = createAgentSurfaceA2aAdapter();

export async function sendAgentSurfaceA2aMessage(
  message: AgentSurfaceA2aMessage
): Promise<AgentSurfaceA2aTask> {
  return defaultAgentSurfaceA2aAdapter.sendMessage(message);
}

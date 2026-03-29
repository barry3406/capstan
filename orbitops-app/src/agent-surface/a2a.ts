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

type AgentSurfaceA2aResourceEntry = {
  key: string;
  title: string;
  description?: string;
  fieldKeys: readonly string[];
  capabilityKeys: readonly string[];
  relations: readonly {
    key: string;
    resourceKey: string;
    kind: string;
  }[];
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

function readOptionalBooleanParam(
  params: Record<string, unknown>,
  key: string,
  message: string
): boolean | undefined {
  const value = params[key];

  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(message);
  }

  return value;
}

function readOptionalWorkflowStatusParam(
  params: Record<string, unknown>,
  key: string,
  message: string
): Extract<Extract<AgentSurfaceRequest, { operation: "listWorkflowRuns" }>["status"], string> | undefined {
  const value = params[key];

  if (typeof value === "undefined") {
    return undefined;
  }

  if (
    value === "running" ||
    value === "paused" ||
    value === "approval_required" ||
    value === "input_required" ||
    value === "failed" ||
    value === "blocked" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(message);
}

function readOptionalWorkflowAttentionStatusParam(
  params: Record<string, unknown>,
  key: string,
  message: string
): Extract<Extract<AgentSurfaceRequest, { operation: "listAttentionItems" }>["status"], string> | undefined {
  const value = params[key];

  if (typeof value === "undefined") {
    return undefined;
  }

  if (
    value === "paused" ||
    value === "approval_required" ||
    value === "input_required" ||
    value === "failed" ||
    value === "blocked" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(message);
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
    case "resource":
      return {
        operation: "resource",
        key: readRequiredString(params, "key", "A2A resource lookup requires a resource key.")
      };
    case "search": {
      const query = readOptionalString(params, "query");
      return {
        operation: "search",
        ...(query ? { query } : {})
      };
    }
    case "listAttentionItems": {
      const taskKey = readOptionalString(params, "taskKey");
      const resourceKey = readOptionalString(params, "resourceKey");
      const routeKey = readOptionalString(params, "routeKey");
      const actionKey = readOptionalString(params, "actionKey");
      const status = readOptionalWorkflowAttentionStatusParam(
        params,
        "status",
        "A2A listAttentionItems status must be a supported attention status."
      );

      return {
        operation: "listAttentionItems",
        ...(taskKey ? { taskKey } : {}),
        ...(resourceKey ? { resourceKey } : {}),
        ...(routeKey ? { routeKey } : {}),
        ...(actionKey ? { actionKey } : {}),
        ...(status ? { status } : {})
      };
    }
    case "listAttentionQueues": {
      const taskKey = readOptionalString(params, "taskKey");
      const resourceKey = readOptionalString(params, "resourceKey");
      const routeKey = readOptionalString(params, "routeKey");
      const actionKey = readOptionalString(params, "actionKey");

      return {
        operation: "listAttentionQueues",
        ...(taskKey ? { taskKey } : {}),
        ...(resourceKey ? { resourceKey } : {}),
        ...(routeKey ? { routeKey } : {}),
        ...(actionKey ? { actionKey } : {})
      };
    }
    case "executeAction":
      return {
        operation: "executeAction",
        routeKey: readRequiredString(
          params,
          "routeKey",
          "A2A executeAction requires a routeKey."
        ),
        actionKey: readRequiredString(
          params,
          "actionKey",
          "A2A executeAction requires an actionKey."
        ),
        input: readObjectParam(
          params,
          "input",
          "A2A executeAction input must be a JSON object."
        ),
        context: readObjectParam(
          params,
          "context",
          "A2A executeAction context must be a JSON object."
        )
      };
    case "startTaskAction":
      return {
        operation: "startTaskAction",
        routeKey: readRequiredString(
          params,
          "routeKey",
          "A2A startTaskAction requires a routeKey."
        ),
        actionKey: readRequiredString(
          params,
          "actionKey",
          "A2A startTaskAction requires an actionKey."
        ),
        input: readObjectParam(
          params,
          "input",
          "A2A startTaskAction input must be a JSON object."
        ),
        context: readObjectParam(
          params,
          "context",
          "A2A startTaskAction context must be a JSON object."
        )
      };
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
    case "getWorkflowRun":
      return {
        operation: "getWorkflowRun",
        id: readRequiredString(params, "id", "A2A getWorkflowRun requires a workflow run id.")
      };
    case "advanceWorkflowRun": {
      const action = readRequiredString(
        params,
        "action",
        "A2A advanceWorkflowRun requires an action."
      );
      const note = readOptionalString(params, "note");

      if (
        action !== "approve" &&
        action !== "provideInput" &&
        action !== "retry" &&
        action !== "cancel"
      ) {
        throw new Error(
          "A2A advanceWorkflowRun action must be approve, provideInput, retry, or cancel."
        );
      }

      return {
        operation: "advanceWorkflowRun",
        id: readRequiredString(params, "id", "A2A advanceWorkflowRun requires a workflow run id."),
        action,
        input: readObjectParam(
          params,
          "input",
          "A2A advanceWorkflowRun input must be a JSON object."
        ),
        ...(note ? { note } : {})
      };
    }
    case "listTaskRuns": {
      const taskKey = readOptionalString(params, "taskKey");
      return {
        operation: "listTaskRuns",
        ...(taskKey ? { taskKey } : {})
      };
    }
    case "listWorkflowRuns": {
      const taskKey = readOptionalString(params, "taskKey");
      const routeKey = readOptionalString(params, "routeKey");
      const actionKey = readOptionalString(params, "actionKey");
      const status = readOptionalWorkflowStatusParam(
        params,
        "status",
        "A2A listWorkflowRuns status must be a supported workflow status."
      );
      const attentionOnly = readOptionalBooleanParam(
        params,
        "attentionOnly",
        "A2A listWorkflowRuns attentionOnly must be a boolean."
      );

      return {
        operation: "listWorkflowRuns",
        ...(taskKey ? { taskKey } : {}),
        ...(routeKey ? { routeKey } : {}),
        ...(actionKey ? { actionKey } : {}),
        ...(status ? { status } : {}),
        ...(typeof attentionOnly === "boolean" ? { attentionOnly } : {})
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
  const resourceSkills = (agentSurface.resources as readonly unknown[]).map((entry) => {
    const resource = entry as AgentSurfaceA2aResourceEntry;

    return {
      id: `resource:${resource.key}`,
      name: resource.title,
      ...(typeof resource.description === "string"
        ? { description: resource.description }
        : {}),
      tags: [
        "resource",
        resource.key,
        ...resource.fieldKeys,
        ...resource.capabilityKeys,
        ...resource.relations.flatMap((relation) => [
          relation.key,
          relation.resourceKey,
          relation.kind
        ])
      ]
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
    skills: [...resourceSkills, ...capabilitySkills, ...taskSkills, ...artifactSkills]
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

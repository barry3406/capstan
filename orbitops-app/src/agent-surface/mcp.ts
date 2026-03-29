import {
  type AgentSurfaceRequest,
  type AgentSurfaceResponse,
  type AgentSurfaceTransport,
  defaultAgentSurfaceTransport
} from "./transport.js";

export interface AgentSurfaceMcpTool {
  name: string;
  title: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
}

export interface AgentSurfaceMcpToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface AgentSurfaceMcpAdapter {
  listTools(): AgentSurfaceMcpTool[];
  callTool(name: string, args?: Record<string, unknown>): Promise<AgentSurfaceMcpToolCallResult>;
}

const agentSurfaceMcpTools = [
  {
    name: "capstan_manifest",
    title: "Capstan Manifest",
    description: "Return the full Capstan agent manifest and summary.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "capstan_resource",
    title: "Capstan Resource",
    description: "Read resource metadata, default route skeletons, and related-resource projections.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Resource key."
        }
      },
      required: ["key"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_search",
    title: "Capstan Search",
    description: "Search resources, capabilities, tasks, and artifacts exposed by this Capstan app.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-form search query."
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_list_attention_items",
    title: "Capstan Attention Inbox",
    description:
      "List workflow attention items across durable tasks, optionally scoped by task, resource, or attention status.",
    inputSchema: {
      type: "object",
      properties: {
        taskKey: {
          type: "string",
          description: "Optional task key."
        },
        resourceKey: {
          type: "string",
          description: "Optional resource key."
        },
        routeKey: {
          type: "string",
          description: "Optional route key."
        },
        actionKey: {
          type: "string",
          description: "Optional action key."
        },
        status: {
          type: "string",
          description: "Optional attention status filter."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "capstan_list_attention_queues",
    title: "Capstan Attention Queues",
    description:
      "List grouped workflow attention queues, optionally scoped by task, resource, route, or action.",
    inputSchema: {
      type: "object",
      properties: {
        taskKey: {
          type: "string",
          description: "Optional task key."
        },
        resourceKey: {
          type: "string",
          description: "Optional resource key."
        },
        routeKey: {
          type: "string",
          description: "Optional route key."
        },
        actionKey: {
          type: "string",
          description: "Optional action key."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "capstan_execute_action",
    title: "Capstan Execute Action",
    description: "Execute a route action through the Capstan control plane with optional relation context.",
    inputSchema: {
      type: "object",
      properties: {
        routeKey: {
          type: "string",
          description: "Projected route key."
        },
        actionKey: {
          type: "string",
          description: "Projected route action key."
        },
        input: {
          type: "object",
          description: "Structured route action input."
        },
        context: {
          type: "object",
          description: "Optional relation context, such as sourceRecordId."
        }
      },
      required: ["routeKey", "actionKey"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_start_task_action",
    title: "Capstan Start Task Action",
    description: "Start the durable task linked to a route action with optional relation context.",
    inputSchema: {
      type: "object",
      properties: {
        routeKey: {
          type: "string",
          description: "Projected route key."
        },
        actionKey: {
          type: "string",
          description: "Projected route action key."
        },
        input: {
          type: "object",
          description: "Structured route action task input."
        },
        context: {
          type: "object",
          description: "Optional relation context, such as sourceRecordId."
        }
      },
      required: ["routeKey", "actionKey"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_execute",
    title: "Capstan Execute",
    description: "Execute a capability directly through the Capstan control plane.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Capability key."
        },
        input: {
          type: "object",
          description: "Structured capability input."
        }
      },
      required: ["key"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_task",
    title: "Capstan Task",
    description: "Read task metadata and latest task state.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Task key."
        }
      },
      required: ["key"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_start_task",
    title: "Capstan Start Task",
    description: "Start a durable task through the Capstan control plane.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Task key."
        },
        input: {
          type: "object",
          description: "Structured task input."
        }
      },
      required: ["key"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_get_task_run",
    title: "Capstan Get Task Run",
    description: "Read one persisted task run.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Task run id."
        }
      },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_get_workflow_run",
    title: "Capstan Get Workflow Run",
    description: "Read one workflow supervision snapshot derived from a task run.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Workflow run id."
        }
      },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_advance_workflow_run",
    title: "Capstan Advance Workflow Run",
    description: "Advance a workflow run through approval, input, retry, or cancellation.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Workflow run id."
        },
        action: {
          type: "string",
          description: "One of approve, provideInput, retry, or cancel."
        },
        input: {
          type: "object",
          description: "Optional structured input override for the transition."
        },
        note: {
          type: "string",
          description: "Optional operator note."
        }
      },
      required: ["id", "action"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_list_task_runs",
    title: "Capstan List Task Runs",
    description: "List persisted task runs, optionally scoped to one task.",
    inputSchema: {
      type: "object",
      properties: {
        taskKey: {
          type: "string",
          description: "Optional task key."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "capstan_list_workflow_runs",
    title: "Capstan List Workflow Runs",
    description: "List workflow supervision snapshots, optionally filtered to runs that need attention.",
    inputSchema: {
      type: "object",
      properties: {
        taskKey: {
          type: "string",
          description: "Optional task key."
        },
        routeKey: {
          type: "string",
          description: "Optional route key."
        },
        actionKey: {
          type: "string",
          description: "Optional action key."
        },
        status: {
          type: "string",
          description: "Optional workflow status filter."
        },
        attentionOnly: {
          type: "boolean",
          description: "When true, only return runs that need supervision or recovery."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "capstan_artifact",
    title: "Capstan Artifact",
    description: "Read artifact metadata and latest produced record.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Artifact key."
        }
      },
      required: ["key"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_get_artifact_record",
    title: "Capstan Get Artifact Record",
    description: "Read one artifact record by id.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Artifact record id."
        }
      },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_list_artifact_records",
    title: "Capstan List Artifact Records",
    description: "List artifact records, optionally scoped to one artifact.",
    inputSchema: {
      type: "object",
      properties: {
        artifactKey: {
          type: "string",
          description: "Optional artifact key."
        }
      },
      additionalProperties: false
    }
  }
] satisfies AgentSurfaceMcpTool[];

function ensureObjectArgs(args: unknown): Record<string, unknown> {
  if (!args) {
    return {};
  }

  if (typeof args !== "object" || Array.isArray(args)) {
    throw new Error("MCP tool arguments must be a JSON object.");
  }

  return args as Record<string, unknown>;
}

function readStringArg(args: Record<string, unknown>, key: string, message: string): string {
  const value = args[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }

  return value;
}

function readObjectArg(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key];

  if (typeof value === "undefined") {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`MCP tool "${key}" input must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function readOptionalWorkflowStatusArg(
  args: Record<string, unknown>,
  key: string
): Extract<Extract<AgentSurfaceRequest, { operation: "listWorkflowRuns" }>["status"], string> | undefined {
  const value = args[key];

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

  throw new Error(
    `MCP tool "${key}" status must be running, paused, approval_required, input_required, failed, blocked, completed, or cancelled.`
  );
}

function readOptionalWorkflowAttentionStatusArg(
  args: Record<string, unknown>,
  key: string
): Extract<Extract<AgentSurfaceRequest, { operation: "listAttentionItems" }>["status"], string> | undefined {
  const value = args[key];

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

  throw new Error(
    `MCP tool "${key}" status must be paused, approval_required, input_required, failed, blocked, or cancelled.`
  );
}

function readOptionalBooleanArg(
  args: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = args[key];

  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`MCP tool "${key}" must be a boolean.`);
  }

  return value;
}

function mapMcpToolCallToRequest(
  name: string,
  rawArgs: unknown
): AgentSurfaceRequest {
  const args = ensureObjectArgs(rawArgs);

  switch (name) {
    case "capstan_manifest":
      return { operation: "manifest" };
    case "capstan_resource":
      return {
        operation: "resource",
        key: readStringArg(args, "key", "capstan_resource requires a resource key.")
      };
    case "capstan_search":
      return {
        operation: "search",
        query: readStringArg(args, "query", "capstan_search requires a query string.")
      };
    case "capstan_list_attention_items": {
      const status = readOptionalWorkflowAttentionStatusArg(args, "status");

      return {
        operation: "listAttentionItems",
        ...(typeof args.taskKey === "string" ? { taskKey: args.taskKey } : {}),
        ...(typeof args.resourceKey === "string" ? { resourceKey: args.resourceKey } : {}),
        ...(typeof args.routeKey === "string" ? { routeKey: args.routeKey } : {}),
        ...(typeof args.actionKey === "string" ? { actionKey: args.actionKey } : {}),
        ...(status ? { status } : {})
      };
    }
    case "capstan_list_attention_queues":
      return {
        operation: "listAttentionQueues",
        ...(typeof args.taskKey === "string" ? { taskKey: args.taskKey } : {}),
        ...(typeof args.resourceKey === "string" ? { resourceKey: args.resourceKey } : {}),
        ...(typeof args.routeKey === "string" ? { routeKey: args.routeKey } : {}),
        ...(typeof args.actionKey === "string" ? { actionKey: args.actionKey } : {})
      };
    case "capstan_execute_action":
      return {
        operation: "executeAction",
        routeKey: readStringArg(
          args,
          "routeKey",
          "capstan_execute_action requires a routeKey."
        ),
        actionKey: readStringArg(
          args,
          "actionKey",
          "capstan_execute_action requires an actionKey."
        ),
        input: readObjectArg(args, "input"),
        context: readObjectArg(args, "context")
      };
    case "capstan_start_task_action":
      return {
        operation: "startTaskAction",
        routeKey: readStringArg(
          args,
          "routeKey",
          "capstan_start_task_action requires a routeKey."
        ),
        actionKey: readStringArg(
          args,
          "actionKey",
          "capstan_start_task_action requires an actionKey."
        ),
        input: readObjectArg(args, "input"),
        context: readObjectArg(args, "context")
      };
    case "capstan_execute":
      return {
        operation: "execute",
        key: readStringArg(args, "key", "capstan_execute requires a capability key."),
        input: readObjectArg(args, "input")
      };
    case "capstan_task":
      return {
        operation: "task",
        key: readStringArg(args, "key", "capstan_task requires a task key.")
      };
    case "capstan_start_task":
      return {
        operation: "startTask",
        key: readStringArg(args, "key", "capstan_start_task requires a task key."),
        input: readObjectArg(args, "input")
      };
    case "capstan_get_task_run":
      return {
        operation: "getTaskRun",
        id: readStringArg(args, "id", "capstan_get_task_run requires a run id.")
      };
    case "capstan_get_workflow_run":
      return {
        operation: "getWorkflowRun",
        id: readStringArg(args, "id", "capstan_get_workflow_run requires a run id.")
      };
    case "capstan_advance_workflow_run": {
      const action = readStringArg(
        args,
        "action",
        "capstan_advance_workflow_run requires an action."
      );

      if (
        action !== "approve" &&
        action !== "provideInput" &&
        action !== "retry" &&
        action !== "cancel"
      ) {
        throw new Error(
          "capstan_advance_workflow_run action must be approve, provideInput, retry, or cancel."
        );
      }

      return {
        operation: "advanceWorkflowRun",
        id: readStringArg(args, "id", "capstan_advance_workflow_run requires a run id."),
        action,
        input: readObjectArg(args, "input"),
        ...(typeof args.note === "string" ? { note: args.note } : {})
      };
    }
    case "capstan_list_task_runs":
      return {
        operation: "listTaskRuns",
        ...(typeof args.taskKey === "string" ? { taskKey: args.taskKey } : {})
      };
    case "capstan_list_workflow_runs": {
      const status = readOptionalWorkflowStatusArg(args, "status");
      const attentionOnly = readOptionalBooleanArg(args, "attentionOnly");

      return {
        operation: "listWorkflowRuns",
        ...(typeof args.taskKey === "string" ? { taskKey: args.taskKey } : {}),
        ...(typeof args.routeKey === "string" ? { routeKey: args.routeKey } : {}),
        ...(typeof args.actionKey === "string" ? { actionKey: args.actionKey } : {}),
        ...(status ? { status } : {}),
        ...(typeof attentionOnly === "boolean" ? { attentionOnly } : {})
      };
    }
    case "capstan_artifact":
      return {
        operation: "artifact",
        key: readStringArg(args, "key", "capstan_artifact requires an artifact key.")
      };
    case "capstan_get_artifact_record":
      return {
        operation: "getArtifactRecord",
        id: readStringArg(args, "id", "capstan_get_artifact_record requires a record id.")
      };
    case "capstan_list_artifact_records":
      return {
        operation: "listArtifactRecords",
        ...(typeof args.artifactKey === "string" ? { artifactKey: args.artifactKey } : {})
      };
    default:
      throw new Error(`Unknown MCP tool "${name}".`);
  }
}

function createMcpToolResult(response: AgentSurfaceResponse): AgentSurfaceMcpToolCallResult {
  if (response.ok) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.body, null, 2)
        }
      ],
      structuredContent: response.body
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: response.error,
            ...(response.code ? { code: response.code } : {}),
            ...(typeof response.details !== "undefined" ? { details: response.details } : {})
          },
          null,
          2
        )
      }
    ],
    structuredContent: {
      error: response.error,
      ...(response.code ? { code: response.code } : {}),
      ...(typeof response.details !== "undefined" ? { details: response.details } : {})
    },
    isError: true
  };
}

export function listAgentSurfaceMcpTools(): AgentSurfaceMcpTool[] {
  return [...agentSurfaceMcpTools];
}

export function createAgentSurfaceMcpAdapter(
  transport: AgentSurfaceTransport = defaultAgentSurfaceTransport
): AgentSurfaceMcpAdapter {
  return {
    listTools(): AgentSurfaceMcpTool[] {
      return listAgentSurfaceMcpTools();
    },
    async callTool(name: string, args?: Record<string, unknown>): Promise<AgentSurfaceMcpToolCallResult> {
      const request = mapMcpToolCallToRequest(name, args);
      const response = await transport.handle(request);
      return createMcpToolResult(response);
    }
  };
}

export const defaultAgentSurfaceMcpAdapter = createAgentSurfaceMcpAdapter();

export async function callAgentSurfaceMcpTool(
  name: string,
  args?: Record<string, unknown>
): Promise<AgentSurfaceMcpToolCallResult> {
  return defaultAgentSurfaceMcpAdapter.callTool(name, args);
}

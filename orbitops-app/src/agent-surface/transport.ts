import {
  agentSurface,
  renderAgentSurfaceManifest
} from "./index.js";
import {
  advanceWorkflowRun,
  artifact,
  executeAction,
  execute,
  getArtifactRecord,
  resource,
  getTaskRun,
  getWorkflowRun,
  listAttentionItems,
  listAttentionQueues,
  listArtifactRecords,
  listTaskRuns,
  listWorkflowRuns,
  search,
  startTaskAction,
  startTask,
  task
} from "../control-plane/index.js";

export type AgentSurfaceRequest =
  | { operation: "manifest" }
  | { operation: "resource"; key: string }
  | { operation: "search"; query?: string }
  | {
      operation: "listAttentionItems";
      taskKey?: string;
      resourceKey?: string;
      routeKey?: string;
      actionKey?: string;
      status?:
        | "paused"
        | "approval_required"
        | "input_required"
        | "failed"
        | "blocked"
        | "cancelled";
    }
  | {
      operation: "listAttentionQueues";
      taskKey?: string;
      resourceKey?: string;
      routeKey?: string;
      actionKey?: string;
    }
  | {
      operation: "executeAction";
      routeKey: string;
      actionKey: string;
      input?: Record<string, unknown>;
      context?: Record<string, unknown>;
    }
  | {
      operation: "startTaskAction";
      routeKey: string;
      actionKey: string;
      input?: Record<string, unknown>;
      context?: Record<string, unknown>;
    }
  | { operation: "execute"; key: string; input?: Record<string, unknown> }
  | { operation: "task"; key: string }
  | { operation: "artifact"; key: string }
  | { operation: "startTask"; key: string; input?: Record<string, unknown> }
  | { operation: "getTaskRun"; id: string }
  | { operation: "listTaskRuns"; taskKey?: string }
  | {
      operation: "listWorkflowRuns";
      taskKey?: string;
      routeKey?: string;
      actionKey?: string;
      status?:
        | "running"
        | "paused"
        | "approval_required"
        | "input_required"
        | "failed"
        | "blocked"
        | "completed"
        | "cancelled";
      attentionOnly?: boolean;
    }
  | { operation: "getWorkflowRun"; id: string }
  | {
      operation: "advanceWorkflowRun";
      id: string;
      action: "approve" | "provideInput" | "retry" | "cancel";
      input?: Record<string, unknown>;
      note?: string;
    }
  | { operation: "getArtifactRecord"; id: string }
  | { operation: "listArtifactRecords"; artifactKey?: string };

export interface AgentSurfaceSuccessResponse {
  ok: true;
  status: number;
  body: unknown;
}

export interface AgentSurfaceErrorResponse {
  ok: false;
  status: number;
  error: string;
  code?: string;
  details?: unknown;
}

export type AgentSurfaceResponse = AgentSurfaceSuccessResponse | AgentSurfaceErrorResponse;

export interface AgentSurfaceAuthDecision {
  effect: "allow" | "approve" | "deny" | "redact";
  reason?: string;
  status?: number;
  body?: unknown;
}

export interface AgentSurfaceCapabilityEntry {
  key: string;
  title: string;
  task?: string;
  policy?: string;
}

export interface AgentSurfaceTaskEntry {
  key: string;
  title: string;
  artifactKeys?: readonly string[];
  capabilityKeys?: readonly string[];
}

export interface AgentSurfaceArtifactEntry {
  key: string;
  title: string;
  taskKeys: readonly string[];
  capabilityKeys: readonly string[];
}

export interface AgentSurfaceResourceEntry {
  key: string;
  title: string;
  routes?: readonly AgentSurfaceRouteEntry[];
  relations?: readonly AgentSurfaceResourceRelationEntry[];
}

export interface AgentSurfaceRouteActionEntry {
  key: string;
  task?: string;
  policy?: string;
}

export interface AgentSurfaceRouteEntry {
  key: string;
  resourceKey: string;
  sourceResourceKey?: string;
  sourceRelationKey?: string;
  actions: readonly AgentSurfaceRouteActionEntry[];
}

export interface AgentSurfaceResourceRelationEntry {
  route: AgentSurfaceRouteEntry;
}

export interface AgentSurfaceAuthorizationContext {
  request: AgentSurfaceRequest;
  operation: AgentSurfaceRequest["operation"];
  resource?: AgentSurfaceResourceEntry;
  capability?: AgentSurfaceCapabilityEntry;
  task?: AgentSurfaceTaskEntry;
  artifact?: AgentSurfaceArtifactEntry;
  policyKey?: string;
}

export interface AgentSurfaceTransportHooks {
  authorize?:
    | ((context: AgentSurfaceAuthorizationContext) =>
        | AgentSurfaceAuthDecision
        | void
        | Promise<AgentSurfaceAuthDecision | void>);
}

export interface AgentSurfaceTransport {
  handle(request: AgentSurfaceRequest): Promise<AgentSurfaceResponse>;
}

function inferErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);

  if (message.startsWith("Unknown ")) {
    return 404;
  }

  if (message.includes("cannot be")) {
    return 409;
  }

  return 500;
}

const capabilityEntries = agentSurface.capabilities as readonly AgentSurfaceCapabilityEntry[];
const resourceEntries = agentSurface.resources as readonly AgentSurfaceResourceEntry[];
const taskEntries = agentSurface.tasks as readonly AgentSurfaceTaskEntry[];
const artifactEntries = agentSurface.artifacts as readonly AgentSurfaceArtifactEntry[];

function findCapability(key: string) {
  return capabilityEntries.find((capability) => capability.key === key);
}

function findResource(key: string) {
  return resourceEntries.find((resourceEntry) => resourceEntry.key === key);
}

function findRouteAction(routeKey: string, actionKey: string) {
  for (const resourceEntry of resourceEntries) {
    const routes = resourceEntry.routes ?? [];
    const relationRoutes = (resourceEntry.relations ?? []).map((relation) => relation.route);

    for (const route of [...routes, ...relationRoutes]) {
      if (route.key !== routeKey) {
        continue;
      }

      const action = route.actions.find((entry) => entry.key === actionKey);

      if (!action) {
        return undefined;
      }

      return {
        resource: resourceEntry,
        route,
        action
      };
    }
  }

  return undefined;
}

function findTask(key: string) {
  return taskEntries.find((taskEntry) => taskEntry.key === key);
}

function findArtifact(key: string) {
  return artifactEntries.find((artifactEntry) => artifactEntry.key === key);
}

function capabilityTaskKey(
  capability: AgentSurfaceAuthorizationContext["capability"]
): string | undefined {
  return capability?.task;
}

function capabilityPolicyKey(
  capability: AgentSurfaceAuthorizationContext["capability"]
): string | undefined {
  return capability?.policy;
}

function findCapabilityByTask(taskKey?: string) {
  if (!taskKey) {
    return undefined;
  }

  return capabilityEntries.find((entry) => capabilityTaskKey(entry) === taskKey);
}

function findPrimaryTaskForArtifact(artifactKey?: string) {
  if (!artifactKey) {
    return undefined;
  }

  const artifactEntry = findArtifact(artifactKey);

  if (!artifactEntry) {
    return undefined;
  }

  return taskEntries.find((entry) => artifactEntry.taskKeys.includes(entry.key));
}

function deriveAuthorizationContext(
  request: AgentSurfaceRequest
): AgentSurfaceAuthorizationContext {
  let resourceEntry = undefined as AgentSurfaceAuthorizationContext["resource"];
  let capability = undefined as AgentSurfaceAuthorizationContext["capability"];
  let taskEntry = undefined as AgentSurfaceAuthorizationContext["task"];
  let artifactEntry = undefined as AgentSurfaceAuthorizationContext["artifact"];

  switch (request.operation) {
    case "resource":
      resourceEntry = findResource(request.key);
      break;
    case "listAttentionItems":
    case "listAttentionQueues":
      resourceEntry = request.resourceKey ? findResource(request.resourceKey) : undefined;
      taskEntry = request.taskKey ? findTask(request.taskKey) : undefined;
      capability = findCapabilityByTask(taskEntry?.key);

      if ((!taskEntry || !capability || !resourceEntry) && request.routeKey && request.actionKey) {
        const routeAction = findRouteAction(request.routeKey, request.actionKey);
        resourceEntry =
          resourceEntry ??
          (routeAction
            ? findResource(routeAction.route.sourceResourceKey ?? routeAction.route.resourceKey)
            : undefined);
        capability = routeAction ? findCapability(routeAction.action.key) : capability;
        taskEntry = routeAction?.action.task ? findTask(routeAction.action.task) : taskEntry;
      }
      break;
    case "executeAction":
    case "startTaskAction": {
      const routeAction = findRouteAction(request.routeKey, request.actionKey);
      resourceEntry = routeAction
        ? findResource(routeAction.route.sourceResourceKey ?? routeAction.route.resourceKey)
        : undefined;
      capability = routeAction ? findCapability(routeAction.action.key) : undefined;
      taskEntry = routeAction?.action.task ? findTask(routeAction.action.task) : undefined;
      break;
    }
    case "execute":
      capability = findCapability(request.key);
      break;
    case "task":
    case "startTask":
      taskEntry = findTask(request.key);
      capability = findCapabilityByTask(taskEntry?.key);
      break;
    case "artifact":
      artifactEntry = findArtifact(request.key);
      if (artifactEntry) {
        taskEntry = findPrimaryTaskForArtifact(artifactEntry.key);
        capability = findCapabilityByTask(taskEntry?.key);
      }
      break;
    case "listTaskRuns":
      taskEntry = request.taskKey ? findTask(request.taskKey) : undefined;
      capability = findCapabilityByTask(taskEntry?.key);
      break;
    case "listWorkflowRuns": {
      taskEntry = request.taskKey ? findTask(request.taskKey) : undefined;
      capability = findCapabilityByTask(taskEntry?.key);

      if ((!taskEntry || !capability) && request.routeKey && request.actionKey) {
        const routeAction = findRouteAction(request.routeKey, request.actionKey);
        resourceEntry = routeAction
          ? findResource(routeAction.route.sourceResourceKey ?? routeAction.route.resourceKey)
          : undefined;
        capability = routeAction ? findCapability(routeAction.action.key) : capability;
        taskEntry = routeAction?.action.task ? findTask(routeAction.action.task) : taskEntry;
      }
      break;
    }
    case "getTaskRun": {
      const run = getTaskRun(request.id);
      taskEntry = run ? findTask(run.taskKey) : undefined;
      capability = run ? findCapability(run.capabilityKey) : undefined;
      break;
    }
    case "getWorkflowRun":
    case "advanceWorkflowRun": {
      const run = getTaskRun(request.id);
      taskEntry = run ? findTask(run.taskKey) : undefined;
      capability = run ? findCapability(run.capabilityKey) : undefined;
      break;
    }
    case "listArtifactRecords":
      artifactEntry = request.artifactKey ? findArtifact(request.artifactKey) : undefined;
      if (artifactEntry) {
        taskEntry = findPrimaryTaskForArtifact(artifactEntry.key);
        capability = findCapabilityByTask(taskEntry?.key);
      }
      break;
    case "getArtifactRecord": {
      const record = getArtifactRecord(request.id);
      artifactEntry = record ? findArtifact(record.artifactKey) : undefined;
      taskEntry = record ? findTask(record.taskKey) : undefined;
      capability = record ? findCapability(record.capabilityKey) : undefined;
      break;
    }
    case "manifest":
    case "search":
    default:
      break;
  }

  const context: AgentSurfaceAuthorizationContext = {
    request,
    operation: request.operation
  };

  if (resourceEntry) {
    context.resource = resourceEntry;
  }

  if (capability) {
    context.capability = capability;
  }

  if (taskEntry) {
    context.task = taskEntry;
  }

  if (artifactEntry) {
    context.artifact = artifactEntry;
  }

  const policyKey = capabilityPolicyKey(capability);

  if (policyKey) {
    context.policyKey = policyKey;
  }

  return context;
}

async function applyAuthorization(
  request: AgentSurfaceRequest,
  hooks: AgentSurfaceTransportHooks
): Promise<AgentSurfaceResponse | undefined> {
  if (!hooks.authorize) {
    return undefined;
  }

  const context = deriveAuthorizationContext(request);
  const decision = await hooks.authorize(context);

  if (!decision || decision.effect === "allow") {
    return undefined;
  }

  switch (decision.effect) {
    case "deny":
      return {
        ok: false,
        status: decision.status ?? 403,
        error: decision.reason ?? "Access denied.",
        code: "access_denied",
        details: {
          operation: request.operation,
          ...(context.policyKey ? { policyKey: context.policyKey } : {})
        }
      };
    case "approve":
      return {
        ok: false,
        status: decision.status ?? 202,
        error: decision.reason ?? "Approval required.",
        code: "approval_required",
        details: {
          operation: request.operation,
          ...(context.policyKey ? { policyKey: context.policyKey } : {})
        }
      };
    case "redact":
      return {
        ok: true,
        status: decision.status ?? 200,
        body:
          decision.body ?? {
            redacted: true,
            operation: request.operation,
            ...(context.artifact ? { artifactKey: context.artifact.key } : {}),
            ...(context.capability ? { capabilityKey: context.capability.key } : {})
          }
      };
    default:
      return undefined;
  }
}

export function createAgentSurfaceTransport(
  hooks: AgentSurfaceTransportHooks = {}
): AgentSurfaceTransport {
  return {
    async handle(request: AgentSurfaceRequest): Promise<AgentSurfaceResponse> {
      const authorized = await applyAuthorization(request, hooks);

      if (authorized) {
        return authorized;
      }

      try {
        switch (request.operation) {
          case "manifest":
            return {
              ok: true,
              status: 200,
              body: {
                manifest: JSON.parse(renderAgentSurfaceManifest()),
                summary: agentSurface.summary
              }
            };
          case "resource":
            return {
              ok: true,
              status: 200,
              body: resource(request.key)
            };
          case "search":
            return {
              ok: true,
              status: 200,
              body: search(request.query ?? "")
            };
          case "listAttentionItems":
            return {
              ok: true,
              status: 200,
              body: listAttentionItems({
                ...(request.taskKey ? { taskKey: request.taskKey } : {}),
                ...(request.resourceKey ? { resourceKey: request.resourceKey } : {}),
                ...(request.routeKey ? { routeKey: request.routeKey } : {}),
                ...(request.actionKey ? { actionKey: request.actionKey } : {}),
                ...(request.status ? { status: request.status } : {})
              })
            };
          case "listAttentionQueues":
            return {
              ok: true,
              status: 200,
              body: listAttentionQueues({
                ...(request.taskKey ? { taskKey: request.taskKey } : {}),
                ...(request.resourceKey ? { resourceKey: request.resourceKey } : {}),
                ...(request.routeKey ? { routeKey: request.routeKey } : {}),
                ...(request.actionKey ? { actionKey: request.actionKey } : {})
              })
            };
          case "executeAction":
            return {
              ok: true,
              status: 200,
              body: await executeAction(
                request.routeKey,
                request.actionKey,
                request.input ?? {},
                request.context ?? {}
              )
            };
          case "startTaskAction":
            return {
              ok: true,
              status: 202,
              body: await startTaskAction(
                request.routeKey,
                request.actionKey,
                request.input ?? {},
                request.context ?? {}
              )
            };
          case "execute":
            return {
              ok: true,
              status: 200,
              body: await execute(request.key, request.input ?? {})
            };
          case "task":
            return {
              ok: true,
              status: 200,
              body: task(request.key)
            };
          case "artifact":
            return {
              ok: true,
              status: 200,
              body: artifact(request.key)
            };
          case "startTask":
            return {
              ok: true,
              status: 202,
              body: await startTask(request.key, request.input ?? {})
            };
          case "getTaskRun": {
            const run = getTaskRun(request.id);

            if (!run) {
              return {
                ok: false,
                status: 404,
                error: `Unknown task run "${request.id}".`,
                code: "task_run_not_found"
              };
            }

            return {
              ok: true,
              status: 200,
              body: run
            };
          }
          case "listTaskRuns":
            return {
              ok: true,
              status: 200,
              body: listTaskRuns(request.taskKey)
            };
          case "listWorkflowRuns":
            return {
              ok: true,
              status: 200,
              body: listWorkflowRuns({
                ...(request.taskKey ? { taskKey: request.taskKey } : {}),
                ...(request.routeKey ? { routeKey: request.routeKey } : {}),
                ...(request.actionKey ? { actionKey: request.actionKey } : {}),
                ...(request.status ? { status: request.status } : {}),
                ...(typeof request.attentionOnly === "boolean"
                  ? { attentionOnly: request.attentionOnly }
                  : {})
              })
            };
          case "getWorkflowRun": {
            const run = getTaskRun(request.id);

            if (!run) {
              return {
                ok: false,
                status: 404,
                error: `Unknown workflow run "${request.id}".`,
                code: "workflow_run_not_found"
              };
            }

            return {
              ok: true,
              status: 200,
              body: getWorkflowRun(request.id)
            };
          }
          case "advanceWorkflowRun": {
            const run = getTaskRun(request.id);

            if (!run) {
              return {
                ok: false,
                status: 404,
                error: `Unknown workflow run "${request.id}".`,
                code: "workflow_run_not_found"
              };
            }

            return {
              ok: true,
              status: 200,
              body: await advanceWorkflowRun(
                request.id,
                request.action,
                request.input ?? {},
                request.note
              )
            };
          }
          case "getArtifactRecord": {
            const record = getArtifactRecord(request.id);

            if (!record) {
              return {
                ok: false,
                status: 404,
                error: `Unknown artifact record "${request.id}".`,
                code: "artifact_record_not_found"
              };
            }

            return {
              ok: true,
              status: 200,
              body: record
            };
          }
          case "listArtifactRecords":
            return {
              ok: true,
              status: 200,
              body: listArtifactRecords(request.artifactKey)
            };
          default: {
            const exhaustive: never = request;

            return {
              ok: false,
              status: 400,
              error: `Unsupported operation ${String(exhaustive)}.`,
              code: "unsupported_operation"
            };
          }
        }
      } catch (error) {
        return {
          ok: false,
          status: inferErrorStatus(error),
          error: error instanceof Error ? error.message : String(error),
          code: "runtime_error"
        };
      }
    }
  };
}

export const defaultAgentSurfaceTransport = createAgentSurfaceTransport();

export async function handleAgentSurfaceRequest(
  request: AgentSurfaceRequest
): Promise<AgentSurfaceResponse> {
  return defaultAgentSurfaceTransport.handle(request);
}

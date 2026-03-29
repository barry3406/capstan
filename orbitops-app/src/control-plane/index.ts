import { artifacts } from "../artifacts/index.js";
import { capabilities, capabilityHandlers } from "../capabilities/index.js";
import { resources } from "../resources/index.js";
import { tasks } from "../tasks/index.js";
import { views } from "../views/index.js";
import type {
  ArtifactDefinition,
  CapabilityDefinition,
  CapabilityExecutionResult,
  FieldDefinition,
  ResourceDefinition,
  TaskDefinition
} from "../types.js";

export interface SearchResult {
  resources: readonly ResourceDefinition[];
  capabilities: readonly CapabilityDefinition[];
  tasks: readonly TaskResult[];
  artifacts: readonly ArtifactDefinition[];
}

export interface ResourceRouteAction {
  key: string;
  title: string;
  mode: "read" | "write" | "external";
  resourceKeys: readonly string[];
  task?: string;
  policy?: string;
  inputFieldKeys: readonly string[];
  outputFieldKeys: readonly string[];
  entry: boolean;
  execution: ResourceRouteActionExecution;
  taskStart?: ResourceRouteActionTaskStart;
  workflow?: ResourceRouteActionWorkflow;
}

export interface ResourceRouteActionExecution {
  operation: "executeAction";
  routeKey: string;
  actionKey: string;
  inputSchema: Record<string, FieldDefinition>;
  scope: ResourceRouteActionScope;
}

export interface ResourceRouteActionScope {
  kind: "resource" | "relation";
  resourceKey: string;
  sourceResourceKey?: string;
  sourceRelationKey?: string;
  contextSchema?: Record<string, FieldDefinition>;
}

export interface ResourceRouteActionTaskStart {
  operation: "startTaskAction";
  routeKey: string;
  actionKey: string;
  task: {
    key: string;
    title: string;
    kind: "sync" | "durable";
    artifactKeys: readonly string[];
  };
  inputSchema: Record<string, FieldDefinition>;
  scope: ResourceRouteActionScope;
}

export type WorkflowStatus =
  | "running"
  | "paused"
  | "approval_required"
  | "input_required"
  | "failed"
  | "blocked"
  | "completed"
  | "cancelled";

export type WorkflowNextAction =
  | "continue"
  | "resume"
  | "await_approval"
  | "await_input"
  | "retry"
  | "resolve_block"
  | "inspect_output"
  | "review_cancellation";

export type WorkflowTransitionAction = "approve" | "provideInput" | "retry" | "cancel";

export interface WorkflowTransition {
  key: WorkflowTransitionAction;
  inputSchema?: Record<string, FieldDefinition>;
}

export interface WorkflowRunFilter {
  taskKey?: string;
  routeKey?: string;
  actionKey?: string;
  status?: WorkflowStatus;
  attentionOnly?: boolean;
}

export interface ResourceRouteActionWorkflowCommand {
  key:
    | "start"
    | "get"
    | "summary"
    | "memory"
    | "pause"
    | "resume"
    | "approve"
    | "provideInput"
    | "retry";
  command: "capstan";
  args: readonly string[];
  placeholders: readonly ("appDir" | "runId" | "inputPath")[];
}

export interface ResourceRouteActionWorkflowControlPlane {
  getRun: {
    operation: "getWorkflowRun";
  };
  listRuns: {
    operation: "listWorkflowRuns";
    defaultFilter: WorkflowRunFilter;
  };
  attention: {
    operation: "listAttentionItems";
    defaultFilter: AttentionItemFilter;
    queues: {
      operation: "listAttentionQueues";
      defaultFilter: AttentionItemFilter;
      statuses: readonly AttentionItemStatus[];
    };
  };
  advance: {
    operation: "advanceWorkflowRun";
    transitions: readonly WorkflowTransition[];
  };
}

export interface ResourceRouteActionWorkflow {
  kind: "starter_run_recipe";
  runtime: "harness";
  interface: "cli";
  routeKey: string;
  actionKey: string;
  task: {
    key: string;
    title: string;
    kind: "sync" | "durable";
    artifactKeys: readonly string[];
  };
  inputSchema: Record<string, FieldDefinition>;
  scope: ResourceRouteActionScope;
  inputEnvelope: {
    injectedRoute: {
      routeKey: string;
      actionKey: string;
      path: string;
      kind: "list" | "detail" | "form";
      resourceKey: string;
      sourceResourceKey?: string;
      sourceRelationKey?: string;
    };
    relationContext?: {
      sourceResourceKey: string;
      sourceRelationKey: string;
      contextSchema: Record<string, FieldDefinition>;
    };
  };
  start: ResourceRouteActionWorkflowCommand;
  observe: readonly ResourceRouteActionWorkflowCommand[];
  controlPlane: ResourceRouteActionWorkflowControlPlane;
  recover: {
    nextActions: Record<WorkflowStatus, WorkflowNextAction>;
    commands: readonly ResourceRouteActionWorkflowCommand[];
  };
}

export interface WorkflowRun {
  id: string;
  status: WorkflowStatus;
  nextAction: WorkflowNextAction;
  attempt: number;
  task: {
    key: string;
    title: string;
    kind: "sync" | "durable";
    artifactKeys: readonly string[];
  };
  capability: {
    key: string;
    title: string;
  };
  route?: ResourceRouteActionWorkflow["inputEnvelope"]["injectedRoute"];
  relation?: Record<string, unknown>;
  activeCheckpoint?: {
    type: "approval" | "input";
    note?: string;
  };
  availableTransitions: readonly WorkflowTransition[];
  input: Record<string, unknown>;
  artifacts: readonly ArtifactRecord[];
  result?: CapabilityExecutionResult;
  error?: string;
  updatedAt: string;
}

export interface ResourceRouteReference {
  key: string;
  title: string;
  kind: "list" | "detail" | "form";
  path: string;
  resourceKey: string;
  capabilityKey?: string;
  generated: boolean;
  sourceResourceKey?: string;
  sourceRelationKey?: string;
  actions: readonly ResourceRouteAction[];
}

export interface ResourceRelationResult {
  relation: {
    key: string;
    label: string;
    kind: "one" | "many";
    description?: string;
  };
  resource: ResourceDefinition;
  route: ResourceRouteReference;
  capabilities: readonly CapabilityDefinition[];
}

export interface ResourceResult {
  resource: ResourceDefinition;
  capabilities: readonly CapabilityDefinition[];
  routes: readonly ResourceRouteReference[];
  relations: readonly ResourceRelationResult[];
  workflowAttention?: WorkflowAttentionSummary;
}

export type WorkflowAttentionStatus =
  | "paused"
  | "approval_required"
  | "input_required"
  | "failed"
  | "blocked"
  | "cancelled";

export interface WorkflowAttentionRunSummary {
  id: string;
  status: WorkflowAttentionStatus;
  nextAction: WorkflowNextAction;
  attempt: number;
  updatedAt: string;
  route?: WorkflowRun["route"];
}

export interface WorkflowAttentionSummary {
  openCount: number;
  statusCounts: Partial<Record<WorkflowAttentionStatus, number>>;
  latestRun?: WorkflowAttentionRunSummary;
  runs?: readonly WorkflowAttentionRunSummary[];
  queues?: readonly AttentionQueue[];
}

export type AttentionItemStatus = WorkflowAttentionStatus;

export interface AttentionItemFilter {
  taskKey?: string;
  resourceKey?: string;
  routeKey?: string;
  actionKey?: string;
  status?: AttentionItemStatus;
}

export interface AttentionItem {
  kind: "workflow_run";
  id: string;
  status: AttentionItemStatus;
  nextAction: WorkflowNextAction;
  attempt: number;
  updatedAt: string;
  task: WorkflowRun["task"];
  capability: WorkflowRun["capability"];
  route?: WorkflowRun["route"];
  relation?: WorkflowRun["relation"];
  activeCheckpoint?: WorkflowRun["activeCheckpoint"];
  availableTransitions: readonly WorkflowTransition[];
}

export interface AttentionQueue {
  status: AttentionItemStatus;
  openCount: number;
  filter: AttentionItemFilter;
  latestItem?: AttentionItem;
}

export interface TaskResult {
  task: TaskDefinition;
  status:
    | "ready"
    | "awaiting_execution"
    | "running"
    | "input_required"
    | "approval_required"
    | "completed"
    | "failed"
    | "cancelled"
    | "blocked";
  capabilities: readonly CapabilityDefinition[];
  artifacts: readonly ArtifactDefinition[];
  runCount: number;
  workflowAttention?: WorkflowAttentionSummary;
  latestRun?: TaskRun;
}

export interface ArtifactResult {
  artifact: ArtifactDefinition;
  tasks: readonly TaskDefinition[];
  capabilities: readonly CapabilityDefinition[];
  records: readonly ArtifactRecord[];
  latestRecord?: ArtifactRecord;
}

export type TaskRunStatus =
  | "pending"
  | "running"
  | "input_required"
  | "approval_required"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export interface ArtifactRecord {
  id: string;
  artifactKey: string;
  taskRunId: string;
  taskKey: string;
  capabilityKey: string;
  payload: unknown;
  createdAt: string;
}

export interface TaskRun {
  id: string;
  taskKey: string;
  capabilityKey: string;
  status: TaskRunStatus;
  attempt: number;
  input: Record<string, unknown>;
  artifacts: readonly ArtifactRecord[];
  result?: CapabilityExecutionResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface ControlPlaneRuntimeState {
  taskRuns: Map<string, TaskRun>;
  artifactRecords: Map<string, ArtifactRecord>;
  taskRunSequence: number;
  artifactRecordSequence: number;
}

const runtimeStateKey = `__capstanControlPlaneRuntime:${new URL(import.meta.url).pathname}`;
const runtimeStateRegistry = globalThis as typeof globalThis & Record<
  string,
  ControlPlaneRuntimeState | undefined
>;
const runtimeState =
  runtimeStateRegistry[runtimeStateKey] ??
  (runtimeStateRegistry[runtimeStateKey] = {
    taskRuns: new Map<string, TaskRun>(),
    artifactRecords: new Map<string, ArtifactRecord>(),
    taskRunSequence: 0,
    artifactRecordSequence: 0
  });
const taskRuns = runtimeState.taskRuns;
const artifactRecords = runtimeState.artifactRecords;

function nextTaskRunId(): string {
  runtimeState.taskRunSequence += 1;
  return `task-run-${runtimeState.taskRunSequence}`;
}

function nextArtifactRecordId(): string {
  runtimeState.artifactRecordSequence += 1;
  return `artifact-record-${runtimeState.artifactRecordSequence}`;
}

function taskRunSequenceValue(run: Pick<TaskRun, "id">): number {
  return Number(run.id.replace("task-run-", "")) || 0;
}

function artifactRecordSequenceValue(record: Pick<ArtifactRecord, "id">): number {
  return Number(record.id.replace("artifact-record-", "")) || 0;
}

function persistTaskRun(run: TaskRun): TaskRun {
  taskRuns.set(run.id, run);
  return run;
}

function persistArtifactRecord(record: ArtifactRecord): ArtifactRecord {
  artifactRecords.set(record.id, record);
  return record;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveTaskStatus(taskDefinition: TaskDefinition, latestRun?: TaskRun): TaskResult["status"] {
  if (!latestRun) {
    return taskDefinition.kind === "durable" ? "awaiting_execution" : "ready";
  }

  switch (latestRun.status) {
    case "pending":
    case "running":
      return "running";
    case "input_required":
      return "input_required";
    case "approval_required":
      return "approval_required";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "blocked":
      return "blocked";
    default:
      return taskDefinition.kind === "durable" ? "awaiting_execution" : "ready";
  }
}

function resolveTaskRunStatus(result: CapabilityExecutionResult): TaskRunStatus {
  switch (result.status) {
    case "completed":
      return "completed";
    case "input_required":
      return "input_required";
    case "approval_required":
      return "approval_required";
    case "cancelled":
      return "cancelled";
    case "blocked":
      return "blocked";
    case "failed":
    case "not_implemented":
    default:
      return "failed";
  }
}

function extractArtifactPayload(output: unknown, artifactKey: string): unknown {
  if (isRecordValue(output)) {
    const artifactMap = output.artifacts;

    if (isRecordValue(artifactMap) && artifactMap[artifactKey] !== undefined) {
      return artifactMap[artifactKey];
    }

    if (output[artifactKey] !== undefined) {
      return output[artifactKey];
    }
  }

  return output;
}

function createArtifactRecords(
  taskDefinition: TaskDefinition,
  capabilityKey: string,
  taskRunId: string,
  result: CapabilityExecutionResult
): ArtifactRecord[] {
  const timestamp = new Date().toISOString();

  return (taskDefinition.artifacts ?? []).map((artifactKey) =>
    persistArtifactRecord({
      id: nextArtifactRecordId(),
      artifactKey,
      taskRunId,
      taskKey: taskDefinition.key,
      capabilityKey,
      payload: extractArtifactPayload(result.output, artifactKey),
      createdAt: timestamp
    })
  );
}

export function search(query = ""): SearchResult {
  const normalized = query.trim().toLowerCase();
  const taskMatches = (normalized
    ? tasks.filter((taskDefinition) =>
        [taskDefinition.key, taskDefinition.title, taskDefinition.description ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalized)
      )
    : tasks
  ).map((taskDefinition) => task(taskDefinition.key));

  if (!normalized) {
    return {
      resources,
      capabilities,
      tasks: taskMatches,
      artifacts
    };
  }

  return {
    resources: resources.filter((resource) =>
      [
        resource.key,
        resource.title,
        resource.description ?? "",
        ...Object.keys(resource.fields ?? {}),
        ...Object.entries(resource.relations ?? {}).flatMap(([relationKey, relation]) => [
          relationKey,
          relation.resource,
          relation.description ?? ""
        ])
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    ),
    capabilities: capabilities.filter((capability) =>
      [capability.key, capability.title, capability.description ?? "", ...(capability.resources ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    ),
    tasks: taskMatches,
    artifacts: artifacts.filter((artifact) =>
      [artifact.key, artifact.title, artifact.description ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    )
  };
}

export function getCapability(key: string): CapabilityDefinition | undefined {
  return capabilities.find((capability) => capability.key === key);
}

export function getResource(key: string): ResourceDefinition | undefined {
  return resources.find((resource) => resource.key === key);
}

export function getTask(key: string): TaskDefinition | undefined {
  return tasks.find((task) => task.key === key);
}

export function getArtifact(key: string): ArtifactDefinition | undefined {
  return artifacts.find((artifact) => artifact.key === key);
}

function getResourceViews(key: string) {
  return views.filter((view) => view.resource === key);
}

function getResourceCapabilities(key: string) {
  return capabilities.filter((capability) => (capability.resources ?? []).includes(key));
}

function startCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function optionalProperty<Key extends string, Value>(
  key: Key,
  value: Value | undefined
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}

function selectRouteCapability(
  kind: ResourceRouteReference["kind"],
  explicitCapabilityKey: string | undefined,
  resourceCapabilities: readonly CapabilityDefinition[]
) {
  if (explicitCapabilityKey) {
    return resourceCapabilities.find((capability) => capability.key === explicitCapabilityKey);
  }

  switch (kind) {
    case "list":
      return resourceCapabilities.find((capability) => capability.mode === "read");
    case "form":
      return resourceCapabilities.find((capability) => capability.mode === "write");
    case "detail":
      return (
        resourceCapabilities.find((capability) => capability.mode === "external") ??
        resourceCapabilities.find((capability) => capability.mode === "read")
      );
  }
}

function projectRouteActions(
  resourceCapabilities: readonly CapabilityDefinition[],
  entryCapabilityKey: string | undefined,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): ResourceRouteAction[] {
  return resourceCapabilities.map((capability) => ({
    key: capability.key,
    title: capability.title,
    mode: capability.mode,
    resourceKeys: capability.resources ?? [],
    ...optionalProperty("task", capability.task),
    ...optionalProperty("policy", capability.policy),
    inputFieldKeys: Object.keys(capability.input ?? {}),
    outputFieldKeys: Object.keys(capability.output ?? {}),
    entry: capability.key === entryCapabilityKey,
    execution: createRouteActionExecution(capability, routeContext),
    ...optionalProperty("taskStart", createRouteActionTaskStart(capability, routeContext)),
    ...optionalProperty("workflow", createRouteActionWorkflow(capability, routeContext))
  }));
}

function createRouteActionExecution(
  capability: CapabilityDefinition,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): ResourceRouteActionExecution {
  return {
    operation: "executeAction",
    routeKey: routeContext.routeKey,
    actionKey: capability.key,
    inputSchema: capability.input ?? {},
    scope: createRouteActionScope(routeContext)
  };
}

function createRouteActionTaskStart(
  capability: CapabilityDefinition,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): ResourceRouteActionTaskStart | undefined {
  if (!capability.task) {
    return undefined;
  }

  const taskDefinition = getTask(capability.task);

  if (!taskDefinition) {
    return undefined;
  }

  return {
    operation: "startTaskAction",
    routeKey: routeContext.routeKey,
    actionKey: capability.key,
    task: {
      key: taskDefinition.key,
      title: taskDefinition.title,
      kind: taskDefinition.kind,
      artifactKeys: taskDefinition.artifacts ?? []
    },
    inputSchema: capability.input ?? {},
    scope: createRouteActionScope(routeContext)
  };
}

function createRouteActionWorkflow(
  capability: CapabilityDefinition,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): ResourceRouteActionWorkflow | undefined {
  if (!capability.task) {
    return undefined;
  }

  const taskDefinition = getTask(capability.task);

  if (!taskDefinition || taskDefinition.kind !== "durable") {
    return undefined;
  }

  const scope = createRouteActionScope(routeContext);

  return {
    kind: "starter_run_recipe",
    runtime: "harness",
    interface: "cli",
    routeKey: routeContext.routeKey,
    actionKey: capability.key,
    task: {
      key: taskDefinition.key,
      title: taskDefinition.title,
      kind: taskDefinition.kind,
      artifactKeys: taskDefinition.artifacts ?? []
    },
    inputSchema: capability.input ?? {},
    scope,
    inputEnvelope: {
      injectedRoute: createRouteActionEnvelope(capability.key, routeContext),
      ...optionalProperty(
        "relationContext",
        scope.kind === "relation"
          ? {
              sourceResourceKey: routeContext.sourceResourceKey ?? "",
              sourceRelationKey: routeContext.sourceRelationKey ?? "",
              contextSchema: scope.contextSchema ?? {}
            }
          : undefined
      )
    },
    start: createWorkflowCommand("start", [
      "harness:start",
      "<app-dir>",
      taskDefinition.key,
      "--json",
      "--input",
      "<input-path>"
    ]),
    observe: [
      createWorkflowCommand("get", ["harness:get", "<app-dir>", "<run-id>", "--json"]),
      createWorkflowCommand("summary", [
        "harness:summary",
        "<app-dir>",
        "<run-id>",
        "--json"
      ]),
      createWorkflowCommand("memory", [
        "harness:memory",
        "<app-dir>",
        "<run-id>",
        "--json"
      ])
    ],
    controlPlane: {
      getRun: {
        operation: "getWorkflowRun"
      },
      listRuns: {
        operation: "listWorkflowRuns",
        defaultFilter: {
          taskKey: taskDefinition.key,
          routeKey: routeContext.routeKey,
          actionKey: capability.key,
          attentionOnly: true
        }
      },
      attention: {
        operation: "listAttentionItems",
        defaultFilter: {
          taskKey: taskDefinition.key,
          routeKey: routeContext.routeKey,
          actionKey: capability.key
        },
        queues: {
          operation: "listAttentionQueues",
          defaultFilter: {
            taskKey: taskDefinition.key,
            routeKey: routeContext.routeKey,
            actionKey: capability.key
          },
          statuses: [
            "approval_required",
            "input_required",
            "blocked",
            "failed",
            "paused",
            "cancelled"
          ]
        }
      },
      advance: {
        operation: "advanceWorkflowRun",
        transitions: createWorkflowTransitions(capability.input ?? {})
      }
    },
    recover: {
      nextActions: createWorkflowNextActions(),
      commands: [
        createWorkflowCommand("pause", [
          "harness:pause",
          "<app-dir>",
          "<run-id>",
          "--json"
        ]),
        createWorkflowCommand("resume", [
          "harness:resume",
          "<app-dir>",
          "<run-id>",
          "--json"
        ]),
        createWorkflowCommand("approve", [
          "harness:approve",
          "<app-dir>",
          "<run-id>",
          "--json"
        ]),
        createWorkflowCommand("provideInput", [
          "harness:provide-input",
          "<app-dir>",
          "<run-id>",
          "--input",
          "<input-path>",
          "--json"
        ]),
        createWorkflowCommand("retry", [
          "harness:retry",
          "<app-dir>",
          "<run-id>",
          "--json"
        ])
      ]
    }
  };
}

function createRouteActionScope(routeContext: {
  routeKey: string;
  resourceKey: string;
  sourceResourceKey?: string;
  sourceResourceTitle?: string;
  sourceRelationKey?: string;
  path?: string;
  kind?: "list" | "detail" | "form";
}): ResourceRouteActionScope {
  return routeContext.sourceResourceKey && routeContext.sourceRelationKey
    ? {
        kind: "relation",
        resourceKey: routeContext.resourceKey,
        sourceResourceKey: routeContext.sourceResourceKey,
        sourceRelationKey: routeContext.sourceRelationKey,
        contextSchema: {
          sourceRecordId: {
            type: "string",
            required: true,
            description: `Identifier for the ${routeContext.sourceResourceTitle ?? startCase(routeContext.sourceResourceKey)} record whose ${startCase(routeContext.sourceRelationKey)} relation scopes this action.`
          }
        }
      }
    : {
        kind: "resource",
        resourceKey: routeContext.resourceKey
      };
}

function createRouteActionEnvelope(
  actionKey: string,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): ResourceRouteActionWorkflow["inputEnvelope"]["injectedRoute"] {
  return {
    routeKey: routeContext.routeKey,
    actionKey,
    path: routeContext.path ?? "",
    kind: routeContext.kind ?? "detail",
    resourceKey: routeContext.resourceKey,
    ...optionalProperty("sourceResourceKey", routeContext.sourceResourceKey),
    ...optionalProperty("sourceRelationKey", routeContext.sourceRelationKey)
  };
}

function createWorkflowCommand(
  key: ResourceRouteActionWorkflowCommand["key"],
  args: string[]
): ResourceRouteActionWorkflowCommand {
  return {
    key,
    command: "capstan",
    args,
    placeholders: Array.from(
      new Set(
        args.flatMap((value) =>
          value === "<app-dir>"
            ? ["appDir" as const]
            : value === "<run-id>"
              ? ["runId" as const]
              : value === "<input-path>"
                ? ["inputPath" as const]
                : []
        )
      )
    )
  };
}

function createWorkflowNextActions(): Record<WorkflowStatus, WorkflowNextAction> {
  return {
    running: "continue",
    paused: "resume",
    approval_required: "await_approval",
    input_required: "await_input",
    failed: "retry",
    blocked: "resolve_block",
    completed: "inspect_output",
    cancelled: "review_cancellation"
  };
}

function createWorkflowTransitions(
  inputSchema: Record<string, FieldDefinition>
): WorkflowTransition[] {
  return [
    {
      key: "approve",
      ...optionalProperty("inputSchema", inputSchema)
    },
    {
      key: "provideInput",
      inputSchema
    },
    {
      key: "retry",
      ...optionalProperty("inputSchema", inputSchema)
    },
    {
      key: "cancel"
    }
  ];
}

function createResourceRouteReference(
  resource: ResourceDefinition,
  kind: ResourceRouteReference["kind"]
): ResourceRouteReference {
  const explicitView = getResourceViews(resource.key).find((view) => view.kind === kind);
  const matchedCapability = selectRouteCapability(
    kind,
    explicitView?.capability,
    getResourceCapabilities(resource.key)
  );
  const capabilityKey = explicitView?.capability ?? matchedCapability?.key;
  const resourceCapabilities = getResourceCapabilities(resource.key);

  return {
    key: explicitView?.key ?? `${resource.key}${startCase(kind).replace(/\s+/g, "")}`,
    title: explicitView?.title ?? `${resource.title} ${startCase(kind)}`,
    kind,
    path: `/resources/${toKebabCase(resource.key)}/${kind}`,
    resourceKey: resource.key,
    ...optionalProperty("capabilityKey", capabilityKey),
    generated: !explicitView,
    actions: projectRouteActions(resourceCapabilities, capabilityKey, {
      routeKey: explicitView?.key ?? `${resource.key}${startCase(kind).replace(/\s+/g, "")}`,
      resourceKey: resource.key,
      path: `/resources/${toKebabCase(resource.key)}/${kind}`,
      kind
    })
  };
}

function createRelationRouteReference(
  resource: ResourceDefinition,
  relationKey: string,
  relation: NonNullable<ResourceDefinition["relations"]>[string]
): {
  key: string;
  path: string;
  title: string;
} {
  const routeKind = relation.kind === "many" ? "list" : "detail";
  const relationStem = startCase(relationKey).replace(/\s+/g, "");
  const routeKindStem = startCase(routeKind).replace(/\s+/g, "");

  return {
    key: `${resource.key}${relationStem}Relation${routeKindStem}`,
    path: `/resources/${toKebabCase(resource.key)}/relations/${toKebabCase(relationKey)}/${routeKind}`,
    title: `${resource.title} ${startCase(relationKey)} ${startCase(routeKind)}`
  };
}

export function resource(key: string): ResourceResult {
  const resourceDefinition = getResource(key);

  if (!resourceDefinition) {
    throw new Error(`Unknown resource "${key}".`);
  }

  const linkedCapabilities = getResourceCapabilities(resourceDefinition.key);
  const routeReferences = (["list", "detail", "form"] as const).map((kind) =>
    createResourceRouteReference(resourceDefinition, kind)
  );
  const relations = Object.entries(resourceDefinition.relations ?? {}).flatMap(
    ([relationKey, relation]) => {
      const targetResource = getResource(relation.resource);

      if (!targetResource) {
        return [];
      }

      const routeKind: ResourceRouteReference["kind"] =
        relation.kind === "many" ? "list" : "detail";
      const targetExplicitView = getResourceViews(targetResource.key).find(
        (view) => view.kind === routeKind
      );
      const targetCapabilities = getResourceCapabilities(targetResource.key);
      const matchedCapability = selectRouteCapability(
        routeKind,
        targetExplicitView?.capability,
        targetCapabilities
      );
      const routeReference = createRelationRouteReference(resourceDefinition, relationKey, relation);
      const capabilityKey = targetExplicitView?.capability ?? matchedCapability?.key;

      return [
        {
          relation: {
            key: relationKey,
            label: startCase(relationKey),
            kind: relation.kind,
            ...(relation.description ? { description: relation.description } : {})
          },
          resource: targetResource,
          route: {
            key: routeReference.key,
            title: routeReference.title,
            kind: routeKind,
            path: routeReference.path,
            resourceKey: targetResource.key,
            ...optionalProperty(
              "capabilityKey",
              capabilityKey
            ),
            generated: true,
            sourceResourceKey: resourceDefinition.key,
            sourceRelationKey: relationKey,
            actions: projectRouteActions(targetCapabilities, capabilityKey, {
              routeKey: routeReference.key,
              resourceKey: targetResource.key,
              sourceResourceKey: resourceDefinition.key,
              sourceResourceTitle: resourceDefinition.title,
              sourceRelationKey: relationKey,
              path: routeReference.path,
              kind: routeKind
            })
          },
          capabilities: targetCapabilities
        }
      ];
    }
  );
  const hasWorkflowActions =
    routeReferences.some((route) => route.actions.some((action) => action.workflow)) ||
    relations.some((relationResult) =>
      relationResult.route.actions.some((action) => action.workflow)
    );

  return {
    resource: resourceDefinition,
    capabilities: linkedCapabilities,
    routes: routeReferences,
    relations,
    ...optionalProperty(
      "workflowAttention",
      hasWorkflowActions ? createResourceWorkflowAttentionSummary(resourceDefinition.key) : undefined
    )
  };
}

function getRouteReference(routeKey: string): ResourceRouteReference | undefined {
  for (const resourceDefinition of resources) {
    const result = resource(resourceDefinition.key);
    const directRoute = result.routes.find((route) => route.key === routeKey);

    if (directRoute) {
      return directRoute;
    }

    const relationRoute = result.relations.find((relation) => relation.route.key === routeKey)?.route;

    if (relationRoute) {
      return relationRoute;
    }
  }

  return undefined;
}

function getRouteAction(
  routeKey: string,
  actionKey: string
): { route: ResourceRouteReference; action: ResourceRouteAction } | undefined {
  const route = getRouteReference(routeKey);
  const action = route?.actions.find((entry) => entry.key === actionKey);

  if (!route || !action) {
    return undefined;
  }

  return {
    route,
    action
  };
}

function createRouteActionInvocation(
  routeKey: string,
  actionKey: string,
  input: Record<string, unknown>,
  context: Record<string, unknown>
): {
  route: ResourceRouteReference;
  action: ResourceRouteAction;
  input: Record<string, unknown>;
  relationContext?: Record<string, unknown> & {
    sourceResourceKey: string;
    sourceRelationKey: string;
  };
} {
  const route = getRouteReference(routeKey);

  if (!route) {
    throw new Error(`Unknown route "${routeKey}".`);
  }

  const routeAction = getRouteAction(routeKey, actionKey);

  if (!routeAction) {
    throw new Error(`Unknown action "${actionKey}" on route "${routeKey}".`);
  }

  const relationContext:
    | (Record<string, unknown> & {
        sourceResourceKey: string;
        sourceRelationKey: string;
      })
    | undefined =
    route.sourceResourceKey && route.sourceRelationKey
      ? {
          sourceResourceKey: route.sourceResourceKey,
          sourceRelationKey: route.sourceRelationKey,
          ...context
        }
      : undefined;
  const sourceRecordId = relationContext?.["sourceRecordId"];

  if (relationContext && (typeof sourceRecordId !== "string" || !sourceRecordId.trim())) {
    throw new Error(
      `Route action "${routeKey}" requires context.sourceRecordId for the "${route.sourceResourceKey}.${route.sourceRelationKey}" relation.`
    );
  }

  return {
    route,
    action: routeAction.action,
    input: {
      ...input,
      _capstanRoute: {
        routeKey: route.key,
        actionKey: routeAction.action.key,
        path: route.path,
        kind: route.kind,
        resourceKey: route.resourceKey,
        ...(route.sourceResourceKey ? { sourceResourceKey: route.sourceResourceKey } : {}),
        ...(route.sourceRelationKey ? { sourceRelationKey: route.sourceRelationKey } : {})
      },
      ...(relationContext ? { _capstanRelation: relationContext } : {})
    },
    ...(relationContext ? { relationContext } : {})
  };
}

export async function executeAction(
  routeKey: string,
  actionKey: string,
  input: Record<string, unknown> = {},
  context: Record<string, unknown> = {}
): Promise<CapabilityExecutionResult> {
  const invocation = createRouteActionInvocation(routeKey, actionKey, input, context);
  return execute(invocation.action.key, invocation.input);
}

export async function startTaskAction(
  routeKey: string,
  actionKey: string,
  input: Record<string, unknown> = {},
  context: Record<string, unknown> = {}
): Promise<TaskRun> {
  const invocation = createRouteActionInvocation(routeKey, actionKey, input, context);
  const taskKey = invocation.action.taskStart?.task.key ?? invocation.action.task;

  if (!taskKey) {
    throw new Error(`Route action "${actionKey}" on route "${routeKey}" is not linked to a task.`);
  }

  return startTask(taskKey, invocation.input);
}

export function task(key: string): TaskResult {
  const taskDefinition = getTask(key);

  if (!taskDefinition) {
    throw new Error(`Unknown task "${key}".`);
  }

  const matchingCapabilities = capabilities.filter((capability) => capability.task === key);
  const linkedArtifacts = (taskDefinition.artifacts ?? [])
    .map((artifactKey) => getArtifact(artifactKey))
    .filter((artifact): artifact is ArtifactDefinition => Boolean(artifact));
  const runs = listTaskRuns(key);

  return {
    task: taskDefinition,
    status: resolveTaskStatus(taskDefinition, runs[0]),
    capabilities: matchingCapabilities,
    artifacts: linkedArtifacts,
    runCount: runs.length,
    ...optionalProperty("workflowAttention", createWorkflowAttentionSummary(key)),
    ...(runs[0] ? { latestRun: runs[0] } : {})
  };
}

export function artifact(key: string): ArtifactResult {
  const artifactDefinition = getArtifact(key);

  if (!artifactDefinition) {
    throw new Error(`Unknown artifact "${key}".`);
  }

  const producingTasks = tasks.filter((task) => (task.artifacts ?? []).includes(key));
  const producingTaskKeys = new Set(producingTasks.map((task) => task.key));
  const producingCapabilities = capabilities.filter((capability) =>
    capability.task ? producingTaskKeys.has(capability.task) : false
  );
  const records = listArtifactRecords(key);

  return {
    artifact: artifactDefinition,
    tasks: producingTasks,
    capabilities: producingCapabilities,
    records,
    ...(records[0] ? { latestRecord: records[0] } : {})
  };
}

export function getTaskRun(id: string): TaskRun | undefined {
  return taskRuns.get(id);
}

export function listTaskRuns(taskKey?: string): TaskRun[] {
  const runs = Array.from(taskRuns.values());

  return runs
    .filter((run) => (taskKey ? run.taskKey === taskKey : true))
    .sort((left, right) => taskRunSequenceValue(right) - taskRunSequenceValue(left));
}

export function getArtifactRecord(id: string): ArtifactRecord | undefined {
  return artifactRecords.get(id);
}

export function listArtifactRecords(artifactKey?: string): ArtifactRecord[] {
  return Array.from(artifactRecords.values())
    .filter((record) => (artifactKey ? record.artifactKey === artifactKey : true))
    .sort((left, right) => artifactRecordSequenceValue(right) - artifactRecordSequenceValue(left));
}

function taskCapability(key: string): CapabilityDefinition | undefined {
  return capabilities.find((entry) => entry.task === key);
}

function workflowRunStatus(run: TaskRun): WorkflowRun["status"] {
  return run.status === "pending" ? "running" : run.status;
}

function workflowRunNextAction(status: WorkflowRun["status"]): WorkflowNextAction {
  switch (status) {
    case "running":
      return "continue";
    case "paused":
      return "resume";
    case "approval_required":
      return "await_approval";
    case "input_required":
      return "await_input";
    case "failed":
      return "retry";
    case "blocked":
      return "resolve_block";
    case "completed":
      return "inspect_output";
    case "cancelled":
      return "review_cancellation";
  }
}

function workflowRunTransitions(run: TaskRun): WorkflowTransition[] {
  const capability = getCapability(run.capabilityKey);
  const transitions = createWorkflowTransitions(capability?.input ?? {});

  switch (workflowRunStatus(run)) {
    case "approval_required":
      return transitions.filter((transition) =>
        transition.key === "approve" || transition.key === "cancel"
      );
    case "input_required":
      return transitions.filter((transition) =>
        transition.key === "provideInput" || transition.key === "cancel"
      );
    case "failed":
    case "blocked":
      return transitions.filter((transition) =>
        transition.key === "retry" || transition.key === "cancel"
      );
    case "cancelled":
      return transitions.filter((transition) => transition.key === "retry");
    case "running":
    case "paused":
    case "completed":
      return [];
  }
}

function workflowCheckpoint(
  run: TaskRun
): WorkflowRun["activeCheckpoint"] | undefined {
  if (run.status === "approval_required") {
    return {
      type: "approval",
      ...optionalProperty("note", run.result?.note)
    };
  }

  if (run.status === "input_required") {
    return {
      type: "input",
      ...optionalProperty("note", run.result?.note)
    };
  }

  return undefined;
}

function workflowRoute(
  run: TaskRun
): WorkflowRun["route"] | undefined {
  return isRecordValue(run.input._capstanRoute)
    ? (run.input._capstanRoute as WorkflowRun["route"])
    : undefined;
}

function workflowRelation(
  run: TaskRun
): WorkflowRun["relation"] | undefined {
  return isRecordValue(run.input._capstanRelation)
    ? (run.input._capstanRelation as Record<string, unknown>)
    : undefined;
}

function createWorkflowRunSnapshot(run: TaskRun): WorkflowRun {
  const taskDefinition = getTask(run.taskKey);
  const capability = getCapability(run.capabilityKey);

  if (!taskDefinition) {
    throw new Error(`Unknown task "${run.taskKey}" for workflow run "${run.id}".`);
  }

  if (!capability) {
    throw new Error(
      `Unknown capability "${run.capabilityKey}" for workflow run "${run.id}".`
    );
  }

  const status = workflowRunStatus(run);

  return {
    id: run.id,
    status,
    nextAction: workflowRunNextAction(status),
    attempt: run.attempt,
    task: {
      key: taskDefinition.key,
      title: taskDefinition.title,
      kind: taskDefinition.kind,
      artifactKeys: taskDefinition.artifacts ?? []
    },
    capability: {
      key: capability.key,
      title: capability.title
    },
    ...optionalProperty("route", workflowRoute(run)),
    ...optionalProperty("relation", workflowRelation(run)),
    ...optionalProperty("activeCheckpoint", workflowCheckpoint(run)),
    availableTransitions: workflowRunTransitions(run),
    input: run.input,
    artifacts: run.artifacts,
    ...optionalProperty("result", run.result),
    ...optionalProperty("error", run.error),
    updatedAt: run.updatedAt
  };
}

function mergeWorkflowInput(
  currentInput: Record<string, unknown>,
  nextInput: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...currentInput,
    ...nextInput,
    ...(currentInput._capstanRoute !== undefined
      ? { _capstanRoute: currentInput._capstanRoute }
      : {}),
    ...(currentInput._capstanRelation !== undefined
      ? { _capstanRelation: currentInput._capstanRelation }
      : {})
  };
}

async function executeTaskRunAttempt(
  run: TaskRun,
  input: Record<string, unknown>,
  options: { incrementAttempt?: boolean } = {}
): Promise<TaskRun> {
  const taskDefinition = getTask(run.taskKey);
  const capability = getCapability(run.capabilityKey);

  if (!taskDefinition) {
    throw new Error(`Unknown task "${run.taskKey}".`);
  }

  if (!capability) {
    throw new Error(`Unknown capability "${run.capabilityKey}".`);
  }

  const { result: _previousResult, error: _previousError, ...runWithoutOutcome } = run;
  const running = persistTaskRun({
    ...runWithoutOutcome,
    status: "running",
    attempt: options.incrementAttempt ? run.attempt + 1 : run.attempt,
    input,
    artifacts: [],
    updatedAt: new Date().toISOString()
  });

  try {
    const result = await execute(capability.key, input);
    const runStatus = resolveTaskRunStatus(result);
    const linkedArtifactRecords =
      runStatus === "completed"
        ? createArtifactRecords(taskDefinition, capability.key, running.id, result)
        : [];

    return persistTaskRun({
      ...running,
      status: runStatus,
      artifacts: linkedArtifactRecords,
      result,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return persistTaskRun({
      ...running,
      status: "failed",
      artifacts: [],
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString()
    });
  }
}

export function getWorkflowRun(id: string): WorkflowRun {
  const run = getTaskRun(id);

  if (!run) {
    throw new Error(`Unknown workflow run "${id}".`);
  }

  return createWorkflowRunSnapshot(run);
}

function workflowNeedsAttention(status: WorkflowStatus): boolean {
  return (
    status === "paused" ||
    status === "approval_required" ||
    status === "input_required" ||
    status === "failed" ||
    status === "blocked" ||
    status === "cancelled"
  );
}

function toWorkflowAttentionRunSummary(run: WorkflowRun): WorkflowAttentionRunSummary {
  return {
    id: run.id,
    status: run.status as WorkflowAttentionStatus,
    nextAction: run.nextAction,
    attempt: run.attempt,
    updatedAt: run.updatedAt,
    ...optionalProperty("route", run.route)
  };
}

function createWorkflowAttentionSummaryFromRuns(
  attentionRuns: WorkflowRun[],
  options: { includeRuns?: boolean; queueFilter?: AttentionItemFilter } = {}
): WorkflowAttentionSummary {
  const statusCounts = attentionRuns.reduce<WorkflowAttentionSummary["statusCounts"]>((counts, run) => {
    const status = run.status as WorkflowAttentionStatus;
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const latestRun = attentionRuns[0];

  return {
    openCount: attentionRuns.length,
    statusCounts,
    ...optionalProperty(
      "latestRun",
      latestRun ? toWorkflowAttentionRunSummary(latestRun) : undefined
    ),
    ...optionalProperty(
      "runs",
      options.includeRuns ? attentionRuns.map((run) => toWorkflowAttentionRunSummary(run)) : undefined
    ),
    ...optionalProperty(
      "queues",
      options.queueFilter ? listAttentionQueues(options.queueFilter) : undefined
    )
  };
}

function createWorkflowAttentionSummary(taskKey: string): WorkflowAttentionSummary | undefined {
  const taskDefinition = getTask(taskKey);

  if (!taskDefinition || taskDefinition.kind !== "durable") {
    return undefined;
  }

  return createWorkflowAttentionSummaryFromRuns(
    listWorkflowRuns({
      taskKey,
      attentionOnly: true
    }),
    {
      queueFilter: {
        taskKey
      }
    }
  );
}

function workflowRunMatchesResourceKey(run: WorkflowRun, resourceKey: string): boolean {
  const route = run.route;

  if (!route) {
    return false;
  }

  return route.resourceKey === resourceKey || route.sourceResourceKey === resourceKey;
}

function createResourceWorkflowAttentionSummary(resourceKey: string): WorkflowAttentionSummary {
  return createWorkflowAttentionSummaryFromRuns(
    listWorkflowRuns({
      attentionOnly: true
    }).filter((run) => workflowRunMatchesResourceKey(run, resourceKey)),
    {
      includeRuns: true,
      queueFilter: {
        resourceKey
      }
    }
  );
}

const attentionQueueStatusOrder: readonly AttentionItemStatus[] = [
  "approval_required",
  "input_required",
  "blocked",
  "failed",
  "paused",
  "cancelled"
];

function toAttentionItem(run: WorkflowRun): AttentionItem {
  return {
    kind: "workflow_run",
    id: run.id,
    status: run.status as AttentionItemStatus,
    nextAction: run.nextAction,
    attempt: run.attempt,
    updatedAt: run.updatedAt,
    task: run.task,
    capability: run.capability,
    availableTransitions: run.availableTransitions,
    ...optionalProperty("route", run.route),
    ...optionalProperty("relation", run.relation),
    ...optionalProperty("activeCheckpoint", run.activeCheckpoint)
  };
}

export function listWorkflowRuns(filter: WorkflowRunFilter = {}): WorkflowRun[] {
  return listTaskRuns(filter.taskKey)
    .map((run) => createWorkflowRunSnapshot(run))
    .filter((run) => {
      if (filter.routeKey && run.route?.routeKey !== filter.routeKey) {
        return false;
      }

      if (filter.actionKey && run.route?.actionKey !== filter.actionKey) {
        return false;
      }

      if (filter.status && run.status !== filter.status) {
        return false;
      }

      if (filter.attentionOnly && !workflowNeedsAttention(run.status)) {
        return false;
      }

      return true;
    });
}

export function listAttentionItems(filter: AttentionItemFilter = {}): AttentionItem[] {
  return listWorkflowRuns({
    ...(filter.taskKey ? { taskKey: filter.taskKey } : {}),
    ...(filter.routeKey ? { routeKey: filter.routeKey } : {}),
    ...(filter.actionKey ? { actionKey: filter.actionKey } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    attentionOnly: true
  })
    .filter((run) =>
      filter.resourceKey ? workflowRunMatchesResourceKey(run, filter.resourceKey) : true
    )
    .map((run) => toAttentionItem(run));
}

export function listAttentionQueues(filter: AttentionItemFilter = {}): AttentionQueue[] {
  const { status: _status, ...baseFilter } = filter;
  const items = listAttentionItems(filter);

  return attentionQueueStatusOrder.flatMap((status) => {
    const matchingItems = items.filter((item) => item.status === status);

    if (!matchingItems.length) {
      return [];
    }

    return [
      {
        status,
        openCount: matchingItems.length,
        filter: {
          ...baseFilter,
          status
        },
        ...optionalProperty("latestItem", matchingItems[0])
      }
    ];
  });
}

export async function advanceWorkflowRun(
  id: string,
  action: WorkflowTransitionAction,
  input: Record<string, unknown> = {},
  _note?: string
): Promise<WorkflowRun> {
  const run = getTaskRun(id);

  if (!run) {
    throw new Error(`Unknown workflow run "${id}".`);
  }

  let updated: TaskRun;

  switch (action) {
    case "approve":
      if (run.status !== "approval_required") {
        throw new Error(
          `Workflow run "${id}" cannot be approved from status "${run.status}".`
        );
      }

      updated = await executeTaskRunAttempt(run, mergeWorkflowInput(run.input, input));
      break;
    case "provideInput":
      if (run.status !== "input_required") {
        throw new Error(
          `Workflow run "${id}" cannot accept input from status "${run.status}".`
        );
      }

      updated = await executeTaskRunAttempt(run, mergeWorkflowInput(run.input, input));
      break;
    case "retry":
      if (!["failed", "cancelled", "blocked"].includes(run.status)) {
        throw new Error(
          `Workflow run "${id}" cannot be retried from status "${run.status}".`
        );
      }

      updated = await executeTaskRunAttempt(run, mergeWorkflowInput(run.input, input), {
        incrementAttempt: true
      });
      break;
    case "cancel":
      if (run.status === "completed" || run.status === "cancelled") {
        throw new Error(
          `Workflow run "${id}" cannot be cancelled from status "${run.status}".`
        );
      }

      updated = persistTaskRun({
        ...run,
        status: "cancelled",
        updatedAt: new Date().toISOString()
      });
      break;
    default: {
      const exhaustive: never = action;
      throw new Error(`Unsupported workflow action "${String(exhaustive)}".`);
    }
  }

  return createWorkflowRunSnapshot(updated);
}

export async function startTask(
  key: string,
  input: Record<string, unknown> = {}
): Promise<TaskRun> {
  const taskDefinition = getTask(key);

  if (!taskDefinition) {
    throw new Error(`Unknown task "${key}".`);
  }

  const capability = taskCapability(key);

  if (!capability) {
    throw new Error(`Task "${key}" is not linked to an executable capability.`);
  }

  const timestamp = new Date().toISOString();
  let run = persistTaskRun({
    id: nextTaskRunId(),
    taskKey: key,
    capabilityKey: capability.key,
    status: "pending",
    attempt: 1,
    input,
    artifacts: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return executeTaskRunAttempt(run, input);
}

export async function execute(
  key: string,
  input: Record<string, unknown> = {}
): Promise<CapabilityExecutionResult> {
  const handler = capabilityHandlers[key as keyof typeof capabilityHandlers];

  if (!handler) {
    throw new Error(`Unknown capability "${key}".`);
  }

  return handler(input);
}

export const controlPlane = {
  domain: "orbitops",
  resource,
  search,
  listAttentionItems,
  listAttentionQueues,
  executeAction,
  startTaskAction,
  task,
  artifact,
  startTask,
  getTaskRun,
  listTaskRuns,
  listWorkflowRuns,
  getWorkflowRun,
  advanceWorkflowRun,
  getArtifactRecord,
  listArtifactRecords,
  execute,
  getResource,
  getCapability,
  getTask,
  getArtifact
} as const;

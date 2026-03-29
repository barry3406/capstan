import type {
  CapabilitySpec,
  FieldSpec,
  InputFieldSpec,
  NormalizedAppGraph,
  RelationSpec,
  ResourceSpec,
  ViewSpec
} from "@zauso-ai/capstan-app-graph";

export interface AgentSurfaceFieldProjection {
  type: "string" | "integer" | "number" | "boolean" | "date" | "datetime" | "json";
  required?: boolean;
  description?: string;
  constraints?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minimum?: number;
    maximum?: number;
    enum?: string[];
  };
}

export interface AgentSurfaceCapabilityProjection {
  key: string;
  title: string;
  description?: string;
  mode: "read" | "write" | "external";
  resources: string[];
  task?: string;
  policy?: string;
  inputSchema?: Record<string, AgentSurfaceFieldProjection>;
  outputSchema?: Record<string, AgentSurfaceFieldProjection>;
  searchTerms: string[];
}

export interface AgentSurfaceRouteActionExecutionProjection {
  operation: "executeAction";
  routeKey: string;
  actionKey: string;
  inputSchema: Record<string, AgentSurfaceFieldProjection>;
  scope: AgentSurfaceRouteActionScopeProjection;
}

export interface AgentSurfaceRouteActionScopeProjection {
  kind: "resource" | "relation";
  resourceKey: string;
  sourceResourceKey?: string;
  sourceRelationKey?: string;
  contextSchema?: Record<string, AgentSurfaceFieldProjection>;
}

export interface AgentSurfaceRouteActionTaskStartProjection {
  operation: "startTaskAction";
  routeKey: string;
  actionKey: string;
  task: {
    key: string;
    title: string;
    kind: "sync" | "durable";
    artifactKeys: string[];
  };
  inputSchema: Record<string, AgentSurfaceFieldProjection>;
  scope: AgentSurfaceRouteActionScopeProjection;
}

export type AgentSurfaceWorkflowStatusProjection =
  | "running"
  | "paused"
  | "approval_required"
  | "input_required"
  | "failed"
  | "blocked"
  | "completed"
  | "cancelled";

export type AgentSurfaceWorkflowNextActionProjection =
  | "continue"
  | "resume"
  | "await_approval"
  | "await_input"
  | "retry"
  | "resolve_block"
  | "inspect_output"
  | "review_cancellation";

export type AgentSurfaceWorkflowTransitionActionProjection =
  | "approve"
  | "provideInput"
  | "retry"
  | "cancel";

export interface AgentSurfaceWorkflowTransitionProjection {
  key: AgentSurfaceWorkflowTransitionActionProjection;
  inputSchema?: Record<string, AgentSurfaceFieldProjection>;
}

export interface AgentSurfaceWorkflowRunFilterProjection {
  taskKey?: string;
  routeKey?: string;
  actionKey?: string;
  status?: AgentSurfaceWorkflowStatusProjection;
  attentionOnly?: boolean;
}

export type AgentSurfaceAttentionItemStatusProjection =
  | "paused"
  | "approval_required"
  | "input_required"
  | "failed"
  | "blocked"
  | "cancelled";

export interface AgentSurfaceAttentionItemFilterProjection {
  taskKey?: string;
  resourceKey?: string;
  routeKey?: string;
  actionKey?: string;
  status?: AgentSurfaceAttentionItemStatusProjection;
}

export interface AgentSurfaceAttentionQueueProjection {
  operation: "listAttentionQueues";
  defaultFilter: AgentSurfaceAttentionItemFilterProjection;
  statuses: AgentSurfaceAttentionItemStatusProjection[];
}

export interface AgentSurfaceRouteActionWorkflowCommandProjection {
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
  args: string[];
  placeholders: Array<"appDir" | "runId" | "inputPath">;
}

export interface AgentSurfaceRouteActionWorkflowControlPlaneProjection {
  getRun: {
    operation: "getWorkflowRun";
  };
  listRuns: {
    operation: "listWorkflowRuns";
    defaultFilter: AgentSurfaceWorkflowRunFilterProjection;
  };
  attention: {
    operation: "listAttentionItems";
    defaultFilter: AgentSurfaceAttentionItemFilterProjection;
    queues: AgentSurfaceAttentionQueueProjection;
  };
  advance: {
    operation: "advanceWorkflowRun";
    transitions: AgentSurfaceWorkflowTransitionProjection[];
  };
}

export interface AgentSurfaceRouteActionWorkflowProjection {
  kind: "starter_run_recipe";
  runtime: "harness";
  interface: "cli";
  routeKey: string;
  actionKey: string;
  task: {
    key: string;
    title: string;
    kind: "sync" | "durable";
    artifactKeys: string[];
  };
  inputSchema: Record<string, AgentSurfaceFieldProjection>;
  scope: AgentSurfaceRouteActionScopeProjection;
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
      contextSchema: Record<string, AgentSurfaceFieldProjection>;
    };
  };
  start: AgentSurfaceRouteActionWorkflowCommandProjection;
  observe: AgentSurfaceRouteActionWorkflowCommandProjection[];
  controlPlane: AgentSurfaceRouteActionWorkflowControlPlaneProjection;
  recover: {
    nextActions: Record<
      AgentSurfaceWorkflowStatusProjection,
      AgentSurfaceWorkflowNextActionProjection
    >;
    commands: AgentSurfaceRouteActionWorkflowCommandProjection[];
  };
}

export interface AgentSurfaceRouteActionProjection {
  key: string;
  title: string;
  mode: "read" | "write" | "external";
  resourceKeys: string[];
  task?: string;
  policy?: string;
  inputFieldKeys: string[];
  outputFieldKeys: string[];
  entry: boolean;
  execution: AgentSurfaceRouteActionExecutionProjection;
  taskStart?: AgentSurfaceRouteActionTaskStartProjection;
  workflow?: AgentSurfaceRouteActionWorkflowProjection;
}

export interface AgentSurfaceRouteProjection {
  key: string;
  title: string;
  kind: "list" | "detail" | "form";
  path: string;
  resourceKey: string;
  capabilityKey?: string;
  generated: boolean;
  sourceResourceKey?: string;
  sourceRelationKey?: string;
  actions: AgentSurfaceRouteActionProjection[];
}

export interface AgentSurfaceResourceRelationProjection {
  key: string;
  label: string;
  resourceKey: string;
  kind: "one" | "many";
  description?: string;
  route: AgentSurfaceRouteProjection;
  capabilityKeys: string[];
}

export interface AgentSurfaceResourceProjection {
  key: string;
  title: string;
  description?: string;
  fieldKeys: string[];
  capabilityKeys: string[];
  routes: AgentSurfaceRouteProjection[];
  relations: AgentSurfaceResourceRelationProjection[];
  searchTerms: string[];
}

export interface AgentSurfaceTaskProjection {
  key: string;
  title: string;
  description?: string;
  kind: "sync" | "durable";
  artifactKeys: string[];
  capabilityKeys: string[];
}

export interface AgentSurfaceArtifactProjection {
  key: string;
  title: string;
  description?: string;
  kind: "record" | "file" | "report" | "dataset" | "message";
  taskKeys: string[];
  capabilityKeys: string[];
}

export interface AgentSurfaceOperationProjection {
  key:
    | "manifest"
    | "resource"
    | "search"
    | "listAttentionItems"
    | "listAttentionQueues"
    | "executeAction"
    | "startTaskAction"
    | "execute"
    | "task"
    | "artifact"
    | "startTask"
    | "getTaskRun"
    | "listTaskRuns"
    | "listWorkflowRuns"
    | "getWorkflowRun"
    | "advanceWorkflowRun"
    | "getArtifactRecord"
    | "listArtifactRecords";
  kind: "query" | "mutation";
  params: string[];
}

export interface AgentSurfaceTransportProjection {
  key: "local" | "http_rpc" | "mcp" | "a2a";
  protocol: "in_process" | "http" | "mcp" | "a2a";
  status: "active" | "preview";
  entrypoint: string;
  methods: readonly string[];
}

export type AgentCapabilityStatusProjection =
  | "not_implemented"
  | "completed"
  | "failed"
  | "blocked"
  | "approval_required"
  | "input_required"
  | "cancelled";

export type AgentTaskRunStatusProjection =
  | "pending"
  | "running"
  | "input_required"
  | "approval_required"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export type AgentTaskStatusProjection =
  | "ready"
  | "awaiting_execution"
  | "running"
  | "input_required"
  | "approval_required"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export interface AgentSurfaceProjection {
  domain: {
    key: string;
    title: string;
    description?: string;
  };
  summary: {
    capabilityCount: number;
    taskCount: number;
    artifactCount: number;
  };
  entrypoints: readonly string[];
  transport: {
    adapter: "local";
    projections: AgentSurfaceTransportProjection[];
    auth: {
      mode: "hook_optional";
      effects: Array<"allow" | "approve" | "deny" | "redact">;
    };
    operations: AgentSurfaceOperationProjection[];
  };
  semantics: {
    capabilityStatuses: AgentCapabilityStatusProjection[];
    taskRunStatuses: AgentTaskRunStatusProjection[];
    taskStatuses: AgentTaskStatusProjection[];
  };
  resources: AgentSurfaceResourceProjection[];
  capabilities: AgentSurfaceCapabilityProjection[];
  tasks: AgentSurfaceTaskProjection[];
  artifacts: AgentSurfaceArtifactProjection[];
}

export function projectAgentSurface(graph: NormalizedAppGraph): AgentSurfaceProjection {
  const taskCapabilityMap = new Map<string, string[]>();
  const artifactTaskMap = new Map<string, string[]>();
  const tasksByKey = new Map(graph.tasks.map((task) => [task.key, task]));
  const resourcesByKey = new Map(graph.resources.map((resource) => [resource.key, resource]));
  const capabilitiesByResource = groupCapabilitiesByResource(graph.capabilities);

  for (const capability of graph.capabilities) {
    if (!capability.task) {
      continue;
    }

    const current = taskCapabilityMap.get(capability.task) ?? [];
    current.push(capability.key);
    taskCapabilityMap.set(capability.task, current);
  }

  for (const task of graph.tasks) {
    for (const artifactKey of task.artifacts ?? []) {
      const current = artifactTaskMap.get(artifactKey) ?? [];
      current.push(task.key);
      artifactTaskMap.set(artifactKey, current);
    }
  }

  const capabilities = graph.capabilities.map((capability) => ({
    key: capability.key,
    title: capability.title,
    ...(capability.description ? { description: capability.description } : {}),
    mode: capability.mode,
    resources: capability.resources ?? [],
    ...(capability.task ? { task: capability.task } : {}),
    ...(capability.policy ? { policy: capability.policy } : {}),
    ...(capability.input
      ? { inputSchema: projectFieldRecord(capability.input) }
      : {}),
    ...(capability.output
      ? { outputSchema: projectFieldRecord(capability.output) }
      : {}),
    searchTerms: [
      capability.key,
      capability.title,
      capability.description ?? "",
      ...(capability.resources ?? []),
      capability.task ?? "",
      capability.policy ?? "",
      ...Object.keys(capability.input ?? {}),
      ...Object.keys(capability.output ?? {})
    ].filter(Boolean)
  }));

  const resources = graph.resources.map((resource) =>
    projectResource(
      resource,
      tasksByKey,
      resourcesByKey,
      graph.views,
      capabilitiesByResource
    )
  );

  const tasks = graph.tasks.map((task) => ({
    key: task.key,
    title: task.title,
    ...(task.description ? { description: task.description } : {}),
    kind: task.kind,
    artifactKeys: task.artifacts ?? [],
    capabilityKeys: taskCapabilityMap.get(task.key) ?? []
  }));

  const artifacts = graph.artifacts.map((artifact) => {
    const taskKeys = artifactTaskMap.get(artifact.key) ?? [];
    const capabilityKeys = graph.capabilities
      .filter((capability) => (capability.task ? taskKeys.includes(capability.task) : false))
      .map((capability) => capability.key);

    return {
      key: artifact.key,
      title: artifact.title,
      ...(artifact.description ? { description: artifact.description } : {}),
      kind: artifact.kind,
      taskKeys,
      capabilityKeys
    };
  });

  return {
    domain: graph.domain,
    summary: {
      capabilityCount: capabilities.length,
      taskCount: tasks.length,
      artifactCount: artifacts.length
    },
    entrypoints: [
      "resource",
      "search",
      "listAttentionItems",
      "listAttentionQueues",
      "executeAction",
      "startTaskAction",
      "execute",
      "task",
      "artifact",
      "startTask",
      "getTaskRun",
      "listTaskRuns",
      "listWorkflowRuns",
      "getWorkflowRun",
      "advanceWorkflowRun",
      "getArtifactRecord",
      "listArtifactRecords"
    ],
    transport: {
      adapter: "local",
      projections: [
        {
          key: "local",
          protocol: "in_process",
          status: "active",
          entrypoint: "handleAgentSurfaceRequest",
          methods: ["call"]
        },
        {
          key: "http_rpc",
          protocol: "http",
          status: "preview",
          entrypoint: "/rpc",
          methods: ["GET", "POST"]
        },
        {
          key: "mcp",
          protocol: "mcp",
          status: "preview",
          entrypoint: "createAgentSurfaceMcpAdapter",
          methods: ["tools/list", "tools/call"]
        },
        {
          key: "a2a",
          protocol: "a2a",
          status: "preview",
          entrypoint: "createAgentSurfaceA2aAdapter",
          methods: ["agent/card", "message/send"]
        }
      ],
      auth: {
        mode: "hook_optional",
        effects: ["allow", "approve", "deny", "redact"]
      },
      operations: [
        {
          key: "manifest",
          kind: "query",
          params: []
        },
        {
          key: "resource",
          kind: "query",
          params: ["key"]
        },
        {
          key: "search",
          kind: "query",
          params: ["query"]
        },
        {
          key: "listAttentionItems",
          kind: "query",
          params: ["taskKey", "resourceKey", "routeKey", "actionKey", "status"]
        },
        {
          key: "listAttentionQueues",
          kind: "query",
          params: ["taskKey", "resourceKey", "routeKey", "actionKey"]
        },
        {
          key: "executeAction",
          kind: "mutation",
          params: ["routeKey", "actionKey", "input", "context"]
        },
        {
          key: "startTaskAction",
          kind: "mutation",
          params: ["routeKey", "actionKey", "input", "context"]
        },
        {
          key: "execute",
          kind: "mutation",
          params: ["key", "input"]
        },
        {
          key: "task",
          kind: "query",
          params: ["key"]
        },
        {
          key: "artifact",
          kind: "query",
          params: ["key"]
        },
        {
          key: "startTask",
          kind: "mutation",
          params: ["key", "input"]
        },
        {
          key: "getTaskRun",
          kind: "query",
          params: ["id"]
        },
        {
          key: "listTaskRuns",
          kind: "query",
          params: ["taskKey"]
        },
        {
          key: "listWorkflowRuns",
          kind: "query",
          params: ["taskKey", "routeKey", "actionKey", "status", "attentionOnly"]
        },
        {
          key: "getWorkflowRun",
          kind: "query",
          params: ["id"]
        },
        {
          key: "advanceWorkflowRun",
          kind: "mutation",
          params: ["id", "action", "input", "note"]
        },
        {
          key: "getArtifactRecord",
          kind: "query",
          params: ["id"]
        },
        {
          key: "listArtifactRecords",
          kind: "query",
          params: ["artifactKey"]
        }
      ]
    },
    semantics: {
      capabilityStatuses: [
        "not_implemented",
        "completed",
        "failed",
        "blocked",
        "approval_required",
        "input_required",
        "cancelled"
      ],
      taskRunStatuses: [
        "pending",
        "running",
        "input_required",
        "approval_required",
        "completed",
        "failed",
        "cancelled",
        "blocked"
      ],
      taskStatuses: [
        "ready",
        "awaiting_execution",
        "running",
        "input_required",
        "approval_required",
        "completed",
        "failed",
        "cancelled",
        "blocked"
      ]
    },
    resources,
    capabilities,
    tasks,
    artifacts
  };
}

export function renderAgentManifestJson(projection: AgentSurfaceProjection): string {
  return `${JSON.stringify(projection, null, 2)}\n`;
}

function projectFieldRecord(
  fields: Record<string, InputFieldSpec | FieldSpec>
): Record<string, AgentSurfaceFieldProjection> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, { ...value }])
  );
}

function projectResource(
  resource: ResourceSpec,
  tasksByKey: Map<string, NormalizedAppGraph["tasks"][number]>,
  resourcesByKey: Map<string, ResourceSpec>,
  views: ViewSpec[],
  capabilitiesByResource: Map<string, CapabilitySpec[]>
): AgentSurfaceResourceProjection {
  const resourceCapabilities = capabilitiesByResource.get(resource.key) ?? [];
  const resourceViews = views.filter((view) => view.resource === resource.key);
  const routes = (["list", "detail", "form"] as const).map((kind) =>
    createResourceRouteProjection(resource, resourceViews, resourceCapabilities, tasksByKey, kind)
  );
  const relations = Object.entries(resource.relations ?? {}).flatMap(([relationKey, relation]) => {
    const targetResource = resourcesByKey.get(relation.resource);

    if (!targetResource) {
      return [];
    }

    const targetCapabilities = capabilitiesByResource.get(targetResource.key) ?? [];
    const targetViews = views.filter((view) => view.resource === targetResource.key);

    return [
      {
        key: relationKey,
        label: startCase(relationKey),
        resourceKey: relation.resource,
        kind: relation.kind,
        ...(relation.description ? { description: relation.description } : {}),
        route: createRelationRouteProjection(
          resource,
          relationKey,
          relation,
          targetResource,
          targetViews,
          targetCapabilities,
          tasksByKey
        ),
        capabilityKeys: targetCapabilities.map((capability) => capability.key)
      }
    ];
  });

  return {
    key: resource.key,
    title: resource.title,
    ...(resource.description ? { description: resource.description } : {}),
    fieldKeys: Object.keys(resource.fields),
    capabilityKeys: resourceCapabilities.map((capability) => capability.key),
    routes,
    relations,
    searchTerms: [
      resource.key,
      resource.title,
      resource.description ?? "",
      ...Object.keys(resource.fields),
      ...resourceCapabilities.map((capability) => capability.key),
      ...resourceCapabilities.map((capability) => capability.title),
      ...relations.flatMap((relation) => [
        relation.key,
        relation.label,
        relation.resourceKey,
        relation.description ?? "",
        relation.route.key,
        relation.route.title
      ])
    ].filter(Boolean)
  };
}

function createResourceRouteProjection(
  resource: ResourceSpec,
  views: ViewSpec[],
  capabilities: CapabilitySpec[],
  tasksByKey: Map<string, NormalizedAppGraph["tasks"][number]>,
  kind: "list" | "detail" | "form"
): AgentSurfaceRouteProjection {
  const explicitView = views.find((view) => view.kind === kind);
  const matchedCapability = selectRouteCapability(kind, explicitView, capabilities);
  const capabilityKey = explicitView?.capability ?? matchedCapability?.key;

  return {
    key: explicitView?.key ?? `${resource.key}${startCase(kind).replace(/\s+/g, "")}`,
    title: explicitView?.title ?? `${resource.title} ${startCase(kind)}`,
    kind,
    path: `/resources/${toKebabCase(resource.key)}/${kind}`,
    resourceKey: resource.key,
    ...optionalProperty("capabilityKey", capabilityKey),
    generated: !explicitView,
    actions: projectRouteActions(capabilities, capabilityKey, tasksByKey, {
      routeKey: explicitView?.key ?? `${resource.key}${startCase(kind).replace(/\s+/g, "")}`,
      resourceKey: resource.key,
      path: `/resources/${toKebabCase(resource.key)}/${kind}`,
      kind
    })
  };
}

function createRelationRouteProjection(
  sourceResource: ResourceSpec,
  relationKey: string,
  relation: RelationSpec,
  targetResource: ResourceSpec,
  targetViews: ViewSpec[],
  targetCapabilities: CapabilitySpec[],
  tasksByKey: Map<string, NormalizedAppGraph["tasks"][number]>
): AgentSurfaceRouteProjection {
  const routeReference = createRelationRouteReference(sourceResource, relationKey, relation);
  const kind = relation.kind === "many" ? "list" : "detail";
  const explicitView = targetViews.find((view) => view.kind === kind);
  const matchedCapability = selectRouteCapability(kind, explicitView, targetCapabilities);
  const capabilityKey = explicitView?.capability ?? matchedCapability?.key;

  return {
    key: routeReference.key,
    title: routeReference.title,
    kind,
    path: routeReference.path,
    resourceKey: targetResource.key,
    ...optionalProperty("capabilityKey", capabilityKey),
    generated: true,
    sourceResourceKey: sourceResource.key,
    sourceRelationKey: relationKey,
    actions: projectRouteActions(targetCapabilities, capabilityKey, tasksByKey, {
      routeKey: routeReference.key,
      resourceKey: targetResource.key,
      sourceResourceKey: sourceResource.key,
      sourceResourceTitle: sourceResource.title,
      sourceRelationKey: relationKey,
      path: routeReference.path,
      kind
    })
  };
}

function groupCapabilitiesByResource(capabilities: CapabilitySpec[]): Map<string, CapabilitySpec[]> {
  const grouped = new Map<string, CapabilitySpec[]>();

  for (const capability of capabilities) {
    for (const resourceKey of capability.resources ?? []) {
      const current = grouped.get(resourceKey) ?? [];
      current.push(capability);
      grouped.set(resourceKey, current);
    }
  }

  return grouped;
}

function selectRouteCapability(
  kind: "list" | "detail" | "form",
  explicitView: ViewSpec | undefined,
  capabilities: CapabilitySpec[]
): CapabilitySpec | undefined {
  if (explicitView?.capability) {
    return capabilities.find((capability) => capability.key === explicitView.capability);
  }

  switch (kind) {
    case "list":
      return capabilities.find((capability) => capability.mode === "read");
    case "form":
      return capabilities.find((capability) => capability.mode === "write");
    case "detail":
      return (
        capabilities.find((capability) => capability.mode === "external") ??
        capabilities.find((capability) => capability.mode === "read")
      );
  }
}

function createRelationRouteReference(
  resource: ResourceSpec,
  relationKey: string,
  relation: RelationSpec
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

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
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

function projectRouteActions(
  capabilities: CapabilitySpec[],
  entryCapabilityKey: string | undefined,
  tasksByKey: Map<string, NormalizedAppGraph["tasks"][number]>,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): AgentSurfaceRouteActionProjection[] {
  return capabilities.map((capability) => ({
    key: capability.key,
    title: capability.title,
    mode: capability.mode,
    resourceKeys: capability.resources ?? [],
    ...optionalProperty("task", capability.task),
    ...optionalProperty("policy", capability.policy),
    inputFieldKeys: Object.keys(capability.input ?? {}),
    outputFieldKeys: Object.keys(capability.output ?? {}),
    entry: capability.key === entryCapabilityKey,
    execution: createRouteActionExecutionProjection(capability, routeContext),
    ...optionalProperty(
      "taskStart",
      createRouteActionTaskStartProjection(capability, tasksByKey, routeContext)
    ),
    ...optionalProperty(
      "workflow",
      createRouteActionWorkflowProjection(capability, tasksByKey, routeContext)
    )
  }));
}

function createRouteActionExecutionProjection(
  capability: CapabilitySpec,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): AgentSurfaceRouteActionExecutionProjection {
  return {
    operation: "executeAction",
    routeKey: routeContext.routeKey,
    actionKey: capability.key,
    inputSchema: projectFieldRecord(capability.input ?? {}),
    scope: createRouteActionScopeProjection(routeContext)
  };
}

function createRouteActionTaskStartProjection(
  capability: CapabilitySpec,
  tasksByKey: Map<string, NormalizedAppGraph["tasks"][number]>,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): AgentSurfaceRouteActionTaskStartProjection | undefined {
  if (!capability.task) {
    return undefined;
  }

  const task = tasksByKey.get(capability.task);

  if (!task) {
    return undefined;
  }

  return {
    operation: "startTaskAction",
    routeKey: routeContext.routeKey,
    actionKey: capability.key,
    task: {
      key: task.key,
      title: task.title,
      kind: task.kind,
      artifactKeys: task.artifacts ?? []
    },
    inputSchema: projectFieldRecord(capability.input ?? {}),
    scope: createRouteActionScopeProjection(routeContext)
  };
}

function createRouteActionWorkflowProjection(
  capability: CapabilitySpec,
  tasksByKey: Map<string, NormalizedAppGraph["tasks"][number]>,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): AgentSurfaceRouteActionWorkflowProjection | undefined {
  if (!capability.task) {
    return undefined;
  }

  const task = tasksByKey.get(capability.task);

  if (!task || task.kind !== "durable") {
    return undefined;
  }

  const scope = createRouteActionScopeProjection(routeContext);

  return {
    kind: "starter_run_recipe",
    runtime: "harness",
    interface: "cli",
    routeKey: routeContext.routeKey,
    actionKey: capability.key,
    task: {
      key: task.key,
      title: task.title,
      kind: task.kind,
      artifactKeys: task.artifacts ?? []
    },
    inputSchema: projectFieldRecord(capability.input ?? {}),
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
    start: createWorkflowCommandProjection("start", [
      "harness:start",
      "<app-dir>",
      task.key,
      "--json",
      "--input",
      "<input-path>"
    ]),
    observe: [
      createWorkflowCommandProjection("get", ["harness:get", "<app-dir>", "<run-id>", "--json"]),
      createWorkflowCommandProjection("summary", [
        "harness:summary",
        "<app-dir>",
        "<run-id>",
        "--json"
      ]),
      createWorkflowCommandProjection("memory", [
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
          taskKey: task.key,
          routeKey: routeContext.routeKey,
          actionKey: capability.key,
          attentionOnly: true
        }
      },
      attention: {
        operation: "listAttentionItems",
        defaultFilter: {
          taskKey: task.key,
          routeKey: routeContext.routeKey,
          actionKey: capability.key
        },
        queues: {
          operation: "listAttentionQueues",
          defaultFilter: {
            taskKey: task.key,
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
        transitions: createWorkflowTransitionsProjection(projectFieldRecord(capability.input ?? {}))
      }
    },
    recover: {
      nextActions: createWorkflowNextActionsProjection(),
      commands: [
        createWorkflowCommandProjection("pause", [
          "harness:pause",
          "<app-dir>",
          "<run-id>",
          "--json"
        ]),
        createWorkflowCommandProjection("resume", [
          "harness:resume",
          "<app-dir>",
          "<run-id>",
          "--json"
        ]),
        createWorkflowCommandProjection("approve", [
          "harness:approve",
          "<app-dir>",
          "<run-id>",
          "--json"
        ]),
        createWorkflowCommandProjection("provideInput", [
          "harness:provide-input",
          "<app-dir>",
          "<run-id>",
          "--input",
          "<input-path>",
          "--json"
        ]),
        createWorkflowCommandProjection("retry", [
          "harness:retry",
          "<app-dir>",
          "<run-id>",
          "--json"
        ])
      ]
    }
  };
}

function createRouteActionScopeProjection(routeContext: {
  routeKey: string;
  resourceKey: string;
  sourceResourceKey?: string;
  sourceResourceTitle?: string;
  sourceRelationKey?: string;
  path?: string;
  kind?: "list" | "detail" | "form";
}): AgentSurfaceRouteActionScopeProjection {
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
): AgentSurfaceRouteActionWorkflowProjection["inputEnvelope"]["injectedRoute"] {
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

function createWorkflowCommandProjection(
  key: AgentSurfaceRouteActionWorkflowCommandProjection["key"],
  args: string[]
): AgentSurfaceRouteActionWorkflowCommandProjection {
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

function createWorkflowNextActionsProjection(): Record<
  AgentSurfaceWorkflowStatusProjection,
  AgentSurfaceWorkflowNextActionProjection
> {
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

function createWorkflowTransitionsProjection(
  inputSchema: Record<string, AgentSurfaceFieldProjection>
): AgentSurfaceWorkflowTransitionProjection[] {
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

function optionalProperty<Key extends string, Value>(
  key: Key,
  value: Value | undefined
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}

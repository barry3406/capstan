import type { AgentLoopCheckpoint } from "../../types.js";
import type {
  HarnessApprovalRecord,
  HarnessArtifactRecord,
  HarnessMemoryRecord,
  HarnessRunRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
  HarnessTaskRecord,
} from "../types.js";
import type {
  HarnessGraphApprovalBindingInput,
  HarnessGraphArtifactBindingInput,
  HarnessGraphBindingOptions,
  HarnessGraphBindingResult,
  HarnessGraphCheckpointBindingInput,
  HarnessGraphEdgeRecord,
  HarnessGraphMemoryBindingInput,
  HarnessGraphNodeRecord,
  HarnessGraphRunBindingInput,
  HarnessGraphScope,
  HarnessGraphScopeRecord,
  HarnessGraphTaskBindingInput,
} from "./types.js";
import {
  encodeGraphPathSegment,
  formatHarnessGraphScopeKey,
  formatHarnessGraphScopeTitle,
  memoryScopeToGraphScope,
  stripUndefinedGraphValue,
} from "./utils.js";
import { assertValidGraphBindingResult } from "./validation.js";

type GraphRuntimePathLike = { rootDir: string };

export function bindHarnessRunRecord(input: HarnessGraphRunBindingInput): HarnessGraphBindingResult {
  const scope = runScope(input.run.id);
  const node = buildRunGraphNode({ rootDir: input.run.sandbox.artifactDir }, input.run);
  const edges: HarnessGraphEdgeRecord[] = [];

  for (const taskId of input.run.taskIds) {
    edges.push(buildRunTaskEdge(input.run, taskNodeId(input.run.id, taskId)));
  }
  for (const artifactId of input.run.artifactIds) {
    edges.push(buildRunArtifactEdge(input.run, artifactNodeId(input.run.id, artifactId)));
  }
  if (input.run.pendingApprovalId) {
    edges.push(buildRunApprovalEdge(input.run, approvalNodeId(input.run.id, input.run.pendingApprovalId)));
  }
  if (input.run.latestSummaryId) {
    edges.push(createGraphEdge(
      scope,
      "references",
      runNodeId(input.run.id),
      summaryNodeId(input.run.id, input.run.latestSummaryId),
      input.run.updatedAt,
      input.run.id,
      { relation: "latest_summary" },
    ));
  }

  const result = {
    scope: scopeRecord(scope, input.run.createdAt, input.run.updatedAt),
    nodes: [node],
    edges,
  } satisfies HarnessGraphBindingResult;
  assertValidGraphBindingResult(result, "bindHarnessRunRecord");
  return result;
}

export function bindHarnessCheckpointRecord(
  input: HarnessGraphCheckpointBindingInput,
  options: HarnessGraphBindingOptions = {},
): HarnessGraphBindingResult {
  const scope = runScope(input.runId);
  const syntheticRun = {
    id: input.runId,
    goal: input.checkpoint.config.goal,
    status: "running",
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
    iterations: input.checkpoint.iterations,
    toolCalls: input.checkpoint.toolCalls.length,
    taskCalls: input.checkpoint.taskCalls?.length ?? 0,
    maxIterations: input.checkpoint.config.maxIterations ?? input.checkpoint.iterations,
    toolNames: [],
    taskNames: [],
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: "graph",
      mode: "graph",
      browser: false,
      fs: false,
      artifactDir: "",
    },
    lastEventSequence: 0,
  } as HarnessRunRecord;
  const turnNode = buildTurnGraphNode(
    { rootDir: input.runId },
    syntheticRun,
    input.checkpoint,
    input.updatedAt,
  );
  const checkpointNode: HarnessGraphNodeRecord = {
    id: checkpointNodeId(input.runId, input.checkpoint, input.updatedAt),
    kind: "checkpoint",
    scope,
    runId: input.runId,
    title: `Checkpoint: ${input.checkpoint.stage}`,
    status: input.checkpoint.orchestration?.phase ?? input.checkpoint.stage,
    summary: summarizeCheckpoint(input.checkpoint),
    content: renderCheckpointContent(input.checkpoint),
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
    metadata: stripUndefinedGraphValue({
      stage: input.checkpoint.stage,
      iterations: input.checkpoint.iterations,
      toolCalls: input.checkpoint.toolCalls.length,
      taskCalls: input.checkpoint.taskCalls?.length ?? 0,
      pendingToolCall: input.checkpoint.pendingToolCall,
      pendingTaskRequests: input.checkpoint.pendingTaskRequests,
      lastAssistantResponse: input.checkpoint.lastAssistantResponse,
      orchestration: input.checkpoint.orchestration,
    }),
  };

  const edges: HarnessGraphEdgeRecord[] = [
    createGraphEdge(scope, "contains", runNodeId(input.runId), checkpointNode.id, input.updatedAt, input.runId),
    createGraphEdge(scope, "contains", runNodeId(input.runId), turnNode.id, input.updatedAt, input.runId),
    createGraphEdge(scope, "summarizes", checkpointNode.id, turnNode.id, input.updatedAt, input.runId),
  ];
  const previousNodeId = input.previousTurnId ?? options.previousNodeId;
  if (previousNodeId) {
    edges.push(createGraphEdge(scope, "follows", previousNodeId, turnNode.id, input.updatedAt, input.runId));
  }
  for (const relatedId of options.relatedNodeIds ?? []) {
    edges.push(createGraphEdge(scope, "references", turnNode.id, relatedId, input.updatedAt, input.runId));
  }
  const result = {
    scope: scopeRecord(scope, input.updatedAt, input.updatedAt),
    nodes: [checkpointNode, turnNode],
    edges,
  } satisfies HarnessGraphBindingResult;
  assertValidGraphBindingResult(result, "bindHarnessCheckpointRecord");
  return result;
}

export function bindHarnessTaskRecord(
  input: HarnessGraphTaskBindingInput,
  options: HarnessGraphBindingOptions = {},
): HarnessGraphBindingResult {
  const scope = runScope(input.task.runId);
  const node = buildTaskGraphNode({ rootDir: input.task.runId }, input.task);
  const edges: HarnessGraphEdgeRecord[] = [
    createGraphEdge(scope, "contains", runNodeId(input.task.runId), node.id, input.task.updatedAt, input.task.runId),
  ];
  const previousNodeId = input.previousTurnId ?? options.previousNodeId;
  if (previousNodeId) {
    edges.push(createGraphEdge(scope, "follows", previousNodeId, node.id, input.task.updatedAt, input.task.runId));
  }
  for (const relatedId of options.relatedNodeIds ?? []) {
    edges.push(createGraphEdge(scope, "references", node.id, relatedId, input.task.updatedAt, input.task.runId));
  }
  const result = {
    scope: scopeRecord(scope, input.task.createdAt, input.task.updatedAt),
    nodes: [node],
    edges,
  } satisfies HarnessGraphBindingResult;
  assertValidGraphBindingResult(result, "bindHarnessTaskRecord");
  return result;
}

export function bindHarnessArtifactRecord(
  input: HarnessGraphArtifactBindingInput,
  options: HarnessGraphBindingOptions = {},
): HarnessGraphBindingResult {
  const scope = runScope(input.artifact.runId);
  const node = buildArtifactGraphNode({ rootDir: input.artifact.runId }, input.artifact);
  const edges: HarnessGraphEdgeRecord[] = [
    createGraphEdge(scope, "contains", runNodeId(input.artifact.runId), node.id, input.artifact.createdAt, input.artifact.runId),
  ];
  if (input.sourceNodeId) {
    edges.push(createGraphEdge(scope, "generates", input.sourceNodeId, node.id, input.artifact.createdAt, input.artifact.runId));
  }
  for (const relatedId of options.relatedNodeIds ?? []) {
    edges.push(createGraphEdge(scope, "references", node.id, relatedId, input.artifact.createdAt, input.artifact.runId));
  }
  const result = {
    scope: scopeRecord(scope, input.artifact.createdAt, input.artifact.createdAt),
    nodes: [node],
    edges,
  } satisfies HarnessGraphBindingResult;
  assertValidGraphBindingResult(result, "bindHarnessArtifactRecord");
  return result;
}

export function bindHarnessMemoryRecord(
  input: HarnessGraphMemoryBindingInput,
  options: HarnessGraphBindingOptions = {},
): HarnessGraphBindingResult {
  const scope = memoryScopeOrRunScope(input.memory);
  const runId = "runId" in input.memory ? input.memory.runId : undefined;
  const syntheticRun = runId ? ({ id: runId } as HarnessRunRecord) : undefined;
  const memoryKind = "scope" in input.memory
    ? "memory"
    : "currentPhase" in input.memory || "recentSteps" in input.memory
      ? "session_memory"
      : "summary";
  const node = buildMemoryGraphNode(
    { rootDir: "memory" },
    syntheticRun,
    input.memory,
    memoryKind,
  );
  const edges: HarnessGraphEdgeRecord[] = [];
  if (input.sourceNodeId) {
    edges.push(createGraphEdge(scope, "references", input.sourceNodeId, node.id, input.memory.updatedAt, runId));
  }
  for (const relatedId of options.relatedNodeIds ?? []) {
    edges.push(createGraphEdge(scope, "references", node.id, relatedId, input.memory.updatedAt, runId));
  }
  const createdAt = "createdAt" in input.memory ? input.memory.createdAt : input.memory.updatedAt;
  const result = {
    scope: scopeRecord(scope, createdAt, input.memory.updatedAt),
    nodes: [node],
    edges,
  } satisfies HarnessGraphBindingResult;
  assertValidGraphBindingResult(result, "bindHarnessMemoryRecord");
  return result;
}

export function bindHarnessApprovalRecord(
  input: HarnessGraphApprovalBindingInput,
  options: HarnessGraphBindingOptions = {},
): HarnessGraphBindingResult {
  const scope = runScope(input.approval.runId);
  const node = buildApprovalGraphNode({ rootDir: input.approval.runId }, input.approval);
  const edges: HarnessGraphEdgeRecord[] = [
    createGraphEdge(scope, "contains", runNodeId(input.approval.runId), node.id, input.approval.updatedAt, input.approval.runId),
  ];
  if (input.sourceNodeId) {
    edges.push(createGraphEdge(scope, "references", input.sourceNodeId, node.id, input.approval.updatedAt, input.approval.runId));
  }
  for (const relatedId of options.relatedNodeIds ?? []) {
    edges.push(createGraphEdge(scope, "references", node.id, relatedId, input.approval.updatedAt, input.approval.runId));
  }
  const result = {
    scope: scopeRecord(scope, input.approval.requestedAt, input.approval.updatedAt),
    nodes: [node],
    edges,
  } satisfies HarnessGraphBindingResult;
  assertValidGraphBindingResult(result, "bindHarnessApprovalRecord");
  return result;
}

export function buildRunGraphNode(_paths: GraphRuntimePathLike, run: HarnessRunRecord): HarnessGraphNodeRecord {
  return {
    id: runNodeId(run.id),
    kind: "run",
    scope: runScope(run.id),
    runId: run.id,
    title: `Run: ${run.goal}`,
    status: run.status,
    summary: `Run ${run.id} · ${run.status} · ${run.iterations} iterations`,
    content: [
      `Goal: ${run.goal}`,
      `Status: ${run.status}`,
      `Iterations: ${run.iterations}`,
      `Tool calls: ${run.toolCalls}`,
      `Task calls: ${run.taskCalls}`,
      `Trigger: ${run.trigger?.type ?? "manual"}`,
    ].join("\n"),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    metadata: stripUndefinedGraphValue({
      maxIterations: run.maxIterations,
      toolNames: run.toolNames,
      taskNames: run.taskNames,
      artifactIds: run.artifactIds,
      taskIds: run.taskIds,
      sandbox: run.sandbox,
      trigger: run.trigger,
      result: run.result,
      error: run.error,
      pendingApprovalId: run.pendingApprovalId,
      latestSummaryId: run.latestSummaryId,
      graphScopes: run.graphScopes,
      control: run.control,
      lastEventSequence: run.lastEventSequence,
      metadata: run.metadata,
    }),
  };
}

export function buildTurnGraphNode(
  _paths: GraphRuntimePathLike,
  run: HarnessRunRecord,
  checkpoint: AgentLoopCheckpoint,
  updatedAt: string,
): HarnessGraphNodeRecord {
  const turnCount = checkpoint.orchestration?.turnCount ?? checkpoint.iterations;
  const phase = checkpoint.orchestration?.phase ?? checkpoint.stage;
  return {
    id: turnNodeId(run.id, checkpoint),
    kind: "turn",
    scope: runScope(run.id),
    runId: run.id,
    title: `Turn ${turnCount}: ${phase}`,
    status: phase,
    summary: summarizeCheckpoint(checkpoint),
    content: renderCheckpointContent(checkpoint),
    createdAt: updatedAt,
    updatedAt,
    metadata: stripUndefinedGraphValue({
      stage: checkpoint.stage,
      iterations: checkpoint.iterations,
      toolCalls: checkpoint.toolCalls.length,
      taskCalls: checkpoint.taskCalls?.length ?? 0,
      pendingToolCall: checkpoint.pendingToolCall,
      pendingTaskRequests: checkpoint.pendingTaskRequests,
      waitingTaskIds: checkpoint.orchestration?.waitingTaskIds,
      transitionReason: checkpoint.orchestration?.transitionReason,
      lastModelFinishReason: checkpoint.orchestration?.lastModelFinishReason,
      recovery: checkpoint.orchestration?.recovery,
      assistantMessagePersisted: checkpoint.orchestration?.assistantMessagePersisted,
      continuationPrompt: checkpoint.orchestration?.continuationPrompt,
    }),
  };
}

export function buildTaskGraphNode(
  _paths: GraphRuntimePathLike,
  runOrTask: HarnessRunRecord | HarnessTaskRecord,
  maybeTask?: HarnessTaskRecord,
): HarnessGraphNodeRecord {
  const run = maybeTask ? (runOrTask as HarnessRunRecord) : undefined;
  const task = maybeTask ?? (runOrTask as HarnessTaskRecord);
  return stripUndefinedGraphValue({
    id: taskNodeId(task.runId, task.id),
    kind: "task",
    scope: runScope(task.runId),
    runId: task.runId,
    title: `Task: ${task.name}`,
    status: task.status,
    ...(task.result !== undefined ? { summary: `Task ${task.name} ${task.status}` } : {}),
    content: renderTaskContent(task),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    order: task.order,
    sourceId: task.requestId,
    metadata: stripUndefinedGraphValue({
      kind: task.kind,
      hardFailure: task.hardFailure,
      args: task.args,
      result: task.result,
      error: task.error,
      graphScopes: run?.graphScopes,
    }),
  }) as HarnessGraphNodeRecord;
}

export function buildArtifactGraphNode(
  _paths: GraphRuntimePathLike,
  runOrArtifact: HarnessRunRecord | HarnessArtifactRecord,
  maybeArtifact?: HarnessArtifactRecord,
): HarnessGraphNodeRecord {
  const run = maybeArtifact ? (runOrArtifact as HarnessRunRecord) : undefined;
  const artifact = maybeArtifact ?? (runOrArtifact as HarnessArtifactRecord);
  return {
    id: artifactNodeId(artifact.runId, artifact.id),
    kind: "artifact",
    scope: runScope(artifact.runId),
    runId: artifact.runId,
    title: `Artifact: ${artifact.kind}`,
    status: "available",
    summary: artifact.path,
    content: artifact.path,
    createdAt: artifact.createdAt,
    updatedAt: artifact.createdAt,
    metadata: stripUndefinedGraphValue({
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      size: artifact.size,
      path: artifact.path,
      graphScopes: run?.graphScopes,
      ...(artifact.metadata ?? {}),
    }),
  };
}

export function buildApprovalGraphNode(
  _paths: GraphRuntimePathLike,
  runOrApproval: HarnessRunRecord | HarnessApprovalRecord,
  maybeApproval?: HarnessApprovalRecord,
): HarnessGraphNodeRecord {
  const run = maybeApproval ? (runOrApproval as HarnessRunRecord) : undefined;
  const approval = maybeApproval ?? (runOrApproval as HarnessApprovalRecord);
  return stripUndefinedGraphValue({
    id: approvalNodeId(approval.runId, approval.id),
    kind: "approval",
    scope: runScope(approval.runId),
    runId: approval.runId,
    title: `Approval: ${approval.tool}`,
    ...(approval.status ? { status: approval.status } : {}),
    summary: approval.reason,
    content: renderApprovalContent(approval),
    createdAt: approval.requestedAt,
    updatedAt: approval.updatedAt,
    metadata: stripUndefinedGraphValue({
      kind: approval.kind,
      reason: approval.reason,
      resolutionNote: approval.resolutionNote,
      resolvedBy: approval.resolvedBy,
      graphScopes: run?.graphScopes,
    }),
  }) as HarnessGraphNodeRecord;
}

export function buildMemoryGraphNode(
  _paths: GraphRuntimePathLike,
  run: HarnessRunRecord | undefined,
  record: HarnessMemoryRecord | HarnessSessionMemoryRecord | HarnessSummaryRecord,
  memoryKind: "memory" | "session_memory" | "summary",
): HarnessGraphNodeRecord {
  const scope: HarnessGraphScope =
    memoryKind === "memory"
      ? memoryScopeToGraphScope((record as HarnessMemoryRecord).scope)
      : run
        ? runScope(run.id)
        : runScope((record as HarnessSessionMemoryRecord | HarnessSummaryRecord).runId);
  const createdAt = "createdAt" in record ? record.createdAt : record.updatedAt;
  const updatedAt = "updatedAt" in record ? record.updatedAt : createdAt;
  const content =
    memoryKind === "memory"
      ? (record as HarnessMemoryRecord).content
      : renderStructuredMemoryContent(record as HarnessSessionMemoryRecord | HarnessSummaryRecord);
  return stripUndefinedGraphValue({
    id: memoryNodeId(scope, record, memoryKind),
    kind: "memory",
    scope,
    ...(("runId" in record && record.runId) || run?.id
      ? { runId: ("runId" in record && record.runId) ? record.runId : run?.id }
      : {}),
    title: `Memory: ${memoryKind}`,
    status:
      memoryKind === "memory"
        ? (record as HarnessMemoryRecord).kind
        : memoryKind,
    summary: content.slice(0, 160),
    content,
    createdAt,
    updatedAt,
    metadata: stripUndefinedGraphValue({
      memoryKind,
      importance: "importance" in record ? record.importance : undefined,
      accessCount: "accessCount" in record ? record.accessCount : undefined,
      sourceSummaryId: "sourceSummaryId" in record ? record.sourceSummaryId : undefined,
      graphScope: scope,
      graphScopes: run?.graphScopes,
      metadata: "metadata" in record ? record.metadata : undefined,
      goal: "goal" in record ? record.goal : undefined,
      headline: "headline" in record ? record.headline : undefined,
      currentPhase: "currentPhase" in record ? record.currentPhase : undefined,
      recentSteps: "recentSteps" in record ? record.recentSteps : undefined,
      blockers: "blockers" in record ? record.blockers : undefined,
      openQuestions: "openQuestions" in record ? record.openQuestions : undefined,
      artifactRefs: "artifactRefs" in record ? record.artifactRefs : undefined,
      compactedMessages: "compactedMessages" in record ? record.compactedMessages : undefined,
      tokenEstimate: "tokenEstimate" in record ? record.tokenEstimate : undefined,
      kind: "kind" in record ? record.kind : undefined,
      status: "status" in record ? record.status : undefined,
    }),
  }) as HarnessGraphNodeRecord;
}

export function buildRunTurnEdge(
  run: HarnessRunRecord,
  turnNodeIdValue: string,
  timestamp: string,
): HarnessGraphEdgeRecord {
  return createGraphEdge(runScope(run.id), "contains", runNodeId(run.id), turnNodeIdValue, timestamp, run.id, {
    relation: "run_turn",
  });
}

export function buildRunTaskEdge(
  run: HarnessRunRecord,
  task: HarnessTaskRecord | string,
): HarnessGraphEdgeRecord {
  const taskId = typeof task === "string" ? task : taskNodeId(task.runId, task.id);
  const timestamp = typeof task === "string" ? run.updatedAt : task.updatedAt;
  return createGraphEdge(runScope(run.id), "contains", runNodeId(run.id), taskId, timestamp, run.id, {
    relation: "run_task",
  });
}

export function buildRunArtifactEdge(
  run: HarnessRunRecord,
  artifact: HarnessArtifactRecord | string,
): HarnessGraphEdgeRecord {
  const artifactId = typeof artifact === "string" ? artifact : artifactNodeId(artifact.runId, artifact.id);
  const timestamp = typeof artifact === "string" ? run.updatedAt : artifact.createdAt;
  return createGraphEdge(runScope(run.id), "contains", runNodeId(run.id), artifactId, timestamp, run.id, {
    relation: "run_artifact",
  });
}

export function buildRunApprovalEdge(
  run: HarnessRunRecord,
  approval: HarnessApprovalRecord | string,
): HarnessGraphEdgeRecord {
  const approvalId = typeof approval === "string" ? approval : approvalNodeId(approval.runId, approval.id);
  const timestamp = typeof approval === "string" ? run.updatedAt : approval.updatedAt;
  return createGraphEdge(runScope(run.id), "contains", runNodeId(run.id), approvalId, timestamp, run.id, {
    relation: "run_approval",
  });
}

export function buildRunMemoryEdge(
  run: HarnessRunRecord,
  memoryNodeIdValue: string,
  timestamp: string,
  memoryKind: "memory" | "session_memory" | "summary",
): HarnessGraphEdgeRecord {
  return createGraphEdge(runScope(run.id), "contains", runNodeId(run.id), memoryNodeIdValue, timestamp, run.id, {
    relation: "run_memory",
    memoryKind,
  });
}

export function scopeRecord(
  scope: HarnessGraphScope,
  createdAt: string,
  updatedAt: string,
): HarnessGraphScopeRecord {
  return {
    id: formatHarnessGraphScopeKey(scope),
    scope,
    title: formatHarnessGraphScopeTitle(scope),
    createdAt,
    updatedAt,
  };
}

function runScope(runId: string): HarnessGraphScope {
  return { kind: "run", runId };
}

function memoryScopeOrRunScope(
  record: HarnessMemoryRecord | HarnessSessionMemoryRecord | HarnessSummaryRecord,
): HarnessGraphScope {
  if ("scope" in record) {
    return memoryScopeToGraphScope(record.scope);
  }
  return { kind: "run", runId: record.runId } satisfies HarnessGraphScope;
}

function runNodeId(runId: string): string {
  return `run:${runId}`;
}

function turnNodeId(runId: string, checkpoint: AgentLoopCheckpoint): string {
  return `turn:${runId}:${checkpoint.orchestration?.turnCount ?? checkpoint.iterations}:${checkpoint.stage}`;
}

function checkpointNodeId(runId: string, checkpoint: AgentLoopCheckpoint, updatedAt: string): string {
  return `checkpoint:${runId}:${checkpoint.stage}:${checkpoint.iterations}:${updatedAt}`;
}

function taskNodeId(runId: string, taskId: string): string {
  return `task:${runId}:${taskId}`;
}

function artifactNodeId(runId: string, artifactId: string): string {
  return `artifact:${runId}:${artifactId}`;
}

function memoryNodeId(
  scope: HarnessGraphScope,
  record: HarnessMemoryRecord | HarnessSessionMemoryRecord | HarnessSummaryRecord,
  memoryKind: "memory" | "session_memory" | "summary",
): string {
  const suffix = "id" in record ? record.id : memoryKind;
  return `memory:${formatHarnessGraphScopeKey(scope)}:${encodeGraphPathSegment(suffix)}`;
}

function approvalNodeId(runId: string, approvalId: string): string {
  return `approval:${runId}:${approvalId}`;
}

function summaryNodeId(runId: string, summaryId: string): string {
  return `summary:${runId}:${summaryId}`;
}

function createGraphEdge(
  scope: HarnessGraphScope,
  kind: HarnessGraphEdgeRecord["kind"],
  from: string,
  to: string,
  timestamp: string,
  runId?: string,
  metadata?: Record<string, unknown>,
): HarnessGraphEdgeRecord {
  return stripUndefinedGraphValue({
    id: `edge:${kind}:${from}->${to}:${timestamp}`,
    kind,
    scope,
    from,
    to,
    ...(runId ? { runId } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: stripUndefinedGraphValue(metadata ?? {}),
  }) as HarnessGraphEdgeRecord;
}

function summarizeCheckpoint(checkpoint: AgentLoopCheckpoint): string {
  const parts = [
    `stage=${checkpoint.stage}`,
    `iterations=${checkpoint.iterations}`,
    `toolCalls=${checkpoint.toolCalls.length}`,
  ];
  if (checkpoint.lastAssistantResponse) {
    parts.push(`assistant=${checkpoint.lastAssistantResponse.slice(0, 120)}`);
  }
  return parts.join(" | ");
}

function renderCheckpointContent(checkpoint: AgentLoopCheckpoint): string {
  const lines = [
    `Stage: ${checkpoint.stage}`,
    `Iterations: ${checkpoint.iterations}`,
    `Tool calls: ${checkpoint.toolCalls.length}`,
    `Task calls: ${(checkpoint.taskCalls ?? []).length}`,
  ];
  if (checkpoint.pendingToolCall) {
    lines.push(`Pending tool: ${checkpoint.pendingToolCall.tool}`);
  }
  if (checkpoint.pendingTaskRequests?.length) {
    lines.push(
      `Pending tasks: ${checkpoint.pendingTaskRequests.map((request) => request.name).join(", ")}`,
    );
  }
  if (checkpoint.lastAssistantResponse) {
    lines.push("", checkpoint.lastAssistantResponse);
  }
  return lines.join("\n");
}

function renderTaskContent(task: HarnessTaskRecord): string {
  const lines = [
    `Task: ${task.name}`,
    `Status: ${task.status}`,
    `Kind: ${task.kind}`,
    `Order: ${task.order}`,
  ];
  if ("error" in task && task.error) {
    lines.push(`Error: ${task.error}`);
  }
  if ("result" in task && task.result !== undefined) {
    lines.push("", JSON.stringify(task.result, null, 2));
  }
  return lines.join("\n");
}

function renderApprovalContent(approval: HarnessApprovalRecord): string {
  return [
    `Approval: ${approval.tool}`,
    `Kind: ${approval.kind}`,
    `Status: ${approval.status ?? "pending"}`,
    `Reason: ${approval.reason}`,
    approval.resolutionNote ? `Resolution note: ${approval.resolutionNote}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderStructuredMemoryContent(
  record: HarnessSessionMemoryRecord | HarnessSummaryRecord,
): string {
  const entries = [
    "headline" in record ? `Headline: ${record.headline}` : undefined,
    "currentPhase" in record ? `Phase: ${record.currentPhase}` : undefined,
    "status" in record ? `Status: ${record.status}` : undefined,
    "completedSteps" in record ? `Completed steps: ${record.completedSteps.join(", ")}` : undefined,
    "recentSteps" in record ? `Recent steps: ${record.recentSteps.join(", ")}` : undefined,
    `Blockers: ${("blockers" in record ? record.blockers : []).join(", ") || "none"}`,
    `Open questions: ${("openQuestions" in record ? record.openQuestions : []).join(", ") || "none"}`,
  ].filter(Boolean);
  return entries.join("\n");
}

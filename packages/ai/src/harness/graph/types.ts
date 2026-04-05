import type { AgentLoopCheckpoint, MemoryScope } from "../../types.js";
import type {
  HarnessApprovalRecord,
  HarnessArtifactRecord,
  HarnessMemoryRecord,
  HarnessRunRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
  HarnessTaskRecord,
} from "../types.js";

export type HarnessGraphScope =
  | { kind: "project"; projectId: string }
  | { kind: "app"; appId: string }
  | { kind: "run"; runId: string }
  | { kind: "resource"; resourceType: string; resourceId: string }
  | { kind: "capability"; capabilityId: string }
  | { kind: "policy"; policyId: string }
  | { kind: "entity"; entityType: string; entityId: string };

export type HarnessGraphNodeKind =
  | "run"
  | "turn"
  | "checkpoint"
  | "task"
  | "artifact"
  | "memory"
  | "approval";

export type HarnessGraphEdgeKind =
  | "contains"
  | "follows"
  | "references"
  | "generates"
  | "summarizes"
  | "promotes"
  | "approves"
  | "blocks";

export interface HarnessGraphScopeRecord {
  id: string;
  scope: HarnessGraphScope;
  title: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface HarnessGraphScopeSummary extends HarnessGraphScopeRecord {
  nodeCount: number;
  edgeCount: number;
  recentNodeIds: string[];
  recentEdgeIds: string[];
}

export interface HarnessGraphNodeRecord {
  id: string;
  kind: HarnessGraphNodeKind;
  scope: HarnessGraphScope;
  title: string;
  createdAt: string;
  updatedAt: string;
  runId?: string | undefined;
  status?: string | undefined;
  summary?: string | undefined;
  content?: string | undefined;
  order?: number | undefined;
  sourceId?: string | undefined;
  relatedIds?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface HarnessGraphEdgeRecord {
  id: string;
  kind: HarnessGraphEdgeKind;
  scope: HarnessGraphScope;
  from: string;
  to: string;
  createdAt: string;
  updatedAt: string;
  runId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface HarnessGraphNodeFilter {
  scopes?: HarnessGraphScope[];
  kinds?: HarnessGraphNodeKind[];
  ids?: string[];
  runId?: string;
  limit?: number;
}

export interface HarnessGraphNodeQuery extends HarnessGraphNodeFilter {
  text?: string;
  relatedTo?: string;
  limit?: number;
  minScore?: number;
}

export interface HarnessGraphEdgeFilter {
  scopes?: HarnessGraphScope[];
  kinds?: HarnessGraphEdgeKind[];
  ids?: string[];
  fromIds?: string[];
  toIds?: string[];
  runId?: string;
  limit?: number;
}

export interface HarnessGraphEdgeQuery extends HarnessGraphEdgeFilter {
  limit?: number;
}

export interface HarnessGraphSearchQuery {
  text?: string;
  scopes?: HarnessGraphScope[];
  kinds?: HarnessGraphNodeKind[];
  relatedTo?: string;
  limit?: number;
  minScore?: number;
}

export interface HarnessGraphSearchResult extends HarnessGraphNodeRecord {
  score: number;
  matchedFields: string[];
  reasons: string[];
}

export interface HarnessGraphTimelineItem {
  id: string;
  nodeId: string;
  kind: HarnessGraphNodeKind;
  title: string;
  scope: HarnessGraphScope;
  createdAt: string;
  updatedAt: string;
  status?: string | undefined;
  summary?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface HarnessGraphTimelineProjection {
  scope: HarnessGraphScope;
  generatedAt: string;
  items: HarnessGraphTimelineItem[];
}

export interface HarnessTaskBoardItem {
  taskId: string;
  nodeId: string;
  name: string;
  status: string;
  scope: HarnessGraphScope;
  createdAt: string;
  updatedAt: string;
  order: number;
  summary?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface HarnessTaskBoardProjection {
  scope: HarnessGraphScope;
  generatedAt: string;
  running: HarnessTaskBoardItem[];
  completed: HarnessTaskBoardItem[];
  failed: HarnessTaskBoardItem[];
  canceled: HarnessTaskBoardItem[];
}

export interface HarnessApprovalInboxItem {
  approvalId: string;
  nodeId: string;
  tool: string;
  status: "pending" | "approved" | "denied" | "canceled";
  scope: HarnessGraphScope;
  requestedAt: string;
  updatedAt: string;
  reason: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface HarnessApprovalInboxProjection {
  scope: HarnessGraphScope;
  generatedAt: string;
  pending: HarnessApprovalInboxItem[];
  resolved: HarnessApprovalInboxItem[];
}

export interface HarnessArtifactFeedItem {
  artifactId: string;
  nodeId: string;
  kind: string;
  scope: HarnessGraphScope;
  createdAt: string;
  updatedAt: string;
  mimeType: string;
  size: number;
  path: string;
  preview?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface HarnessArtifactFeedProjection {
  scope: HarnessGraphScope;
  generatedAt: string;
  items: HarnessArtifactFeedItem[];
}

export interface HarnessMemoryFeedItem {
  memoryId: string;
  nodeId: string;
  kind: string;
  scope: HarnessGraphScope;
  createdAt: string;
  updatedAt: string;
  content: string;
  importance?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface HarnessMemoryFeedProjection {
  scope: HarnessGraphScope;
  generatedAt: string;
  items: HarnessMemoryFeedItem[];
}

export interface HarnessGraphBindingResult {
  scope: HarnessGraphScopeRecord;
  nodes: HarnessGraphNodeRecord[];
  edges: HarnessGraphEdgeRecord[];
}

export interface HarnessGraphBindingOptions {
  relatedNodeIds?: string[];
  previousNodeId?: string;
  sourceNodeId?: string;
}

export interface HarnessGraphRunBindingInput {
  run: HarnessRunRecord;
}

export interface HarnessGraphCheckpointBindingInput {
  runId: string;
  checkpoint: AgentLoopCheckpoint;
  updatedAt: string;
  previousTurnId?: string;
}

export interface HarnessGraphTaskBindingInput {
  task: HarnessTaskRecord;
  previousTurnId?: string;
}

export interface HarnessGraphArtifactBindingInput {
  artifact: HarnessArtifactRecord;
  sourceNodeId?: string;
}

export interface HarnessGraphMemoryBindingInput {
  memory: HarnessMemoryRecord | HarnessSessionMemoryRecord | HarnessSummaryRecord;
  sourceNodeId?: string;
}

export interface HarnessGraphApprovalBindingInput {
  approval: HarnessApprovalRecord;
  sourceNodeId?: string;
}

export interface HarnessGraphPathSet {
  graphRootDir: string;
  scopesDir: string;
  nodesDir: string;
  edgesDir: string;
  projectionsDir: string;
}

export interface HarnessGraphStore {
  readonly paths?: HarnessGraphPathSet;
  getGraphNode(nodeId: string): Promise<HarnessGraphNodeRecord | undefined>;
  listGraphNodes(query?: HarnessGraphNodeQuery): Promise<HarnessGraphNodeRecord[]>;
  listGraphEdges(query?: HarnessGraphEdgeQuery): Promise<HarnessGraphEdgeRecord[]>;
}

export interface HarnessGraphBindings {
  run(input: HarnessGraphRunBindingInput): HarnessGraphBindingResult;
  checkpoint(
    input: HarnessGraphCheckpointBindingInput,
    options?: HarnessGraphBindingOptions,
  ): HarnessGraphBindingResult;
  task(input: HarnessGraphTaskBindingInput, options?: HarnessGraphBindingOptions): HarnessGraphBindingResult;
  artifact(
    input: HarnessGraphArtifactBindingInput,
    options?: HarnessGraphBindingOptions,
  ): HarnessGraphBindingResult;
  memory(input: HarnessGraphMemoryBindingInput, options?: HarnessGraphBindingOptions): HarnessGraphBindingResult;
  approval(
    input: HarnessGraphApprovalBindingInput,
    options?: HarnessGraphBindingOptions,
  ): HarnessGraphBindingResult;
}

export interface HarnessLegacyGraphNodeRecord {
  id: string;
  kind:
    | "run"
    | "turn"
    | "task_execution"
    | "artifact"
    | "memory_record"
    | "approval_request";
  runId?: string;
  createdAt: string;
  updatedAt: string;
  scopes: HarnessGraphScope[];
  data: Record<string, unknown>;
}

export interface HarnessLegacyGraphEdgeRecord {
  id: string;
  kind: "run_turn" | "run_task" | "run_artifact" | "run_memory" | "run_approval";
  from: string;
  to: string;
  runId?: string;
  createdAt: string;
  updatedAt: string;
  scopes: HarnessGraphScope[];
  metadata?: Record<string, unknown>;
}

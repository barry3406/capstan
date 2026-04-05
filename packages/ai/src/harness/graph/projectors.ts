import type {
  HarnessApprovalInboxEntry,
  HarnessApprovalStatus,
  HarnessArtifactFeedItem,
  HarnessGraphNodeQuery,
  HarnessRunTimelineItem,
  HarnessTaskBoardEntry,
} from "../types.js";
import type {
  HarnessApprovalInboxProjection,
  HarnessArtifactFeedProjection,
  HarnessGraphNodeRecord,
  HarnessGraphScope,
  HarnessGraphTimelineProjection,
  HarnessMemoryFeedProjection,
  HarnessTaskBoardProjection,
} from "./types.js";
import { collectGraphContextNodes } from "./retrieval.js";
import { sortGraphNodes } from "./utils.js";

interface GraphProjectionStore {
  listGraphNodes(query?: HarnessGraphNodeQuery): Promise<any[]>;
  listNodes?(query?: HarnessGraphNodeQuery): Promise<any[]>;
}

export async function projectHarnessRunTimeline(
  store: GraphProjectionStore,
  input?: HarnessGraphNodeQuery | HarnessGraphScope,
): Promise<HarnessGraphTimelineProjection> {
  const query = normalizeProjectionQuery(input);
  const scope = resolveProjectionScope(query);
  const nodes =
    scope.kind === "run"
      ? await collectGraphContextNodes({
          runtimeStore: store,
          runId: scope.runId,
          query: query.text ?? "",
          ...(query.scopes?.length ? { scopes: query.scopes } : {}),
          ...(query.kinds?.length ? { kinds: query.kinds } : {}),
          limit: query.limit ?? 100,
        })
      : await readGraphNodes(store, query);
  const items = nodes
    .sort(compareTimelineNodes)
    .map((node) => ({
      id: node.id,
      nodeId: node.id,
      kind: node.kind,
      title: node.title,
      scope: node.scope,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      ...(node.status ? { status: node.status } : {}),
      ...(node.summary ? { summary: node.summary } : {}),
      ...(node.metadata ? { metadata: { ...node.metadata } } : {}),
    }));
  return {
    scope,
    generatedAt: new Date().toISOString(),
    items,
  };
}

export async function projectHarnessTaskBoard(
  store: GraphProjectionStore,
  input?: HarnessGraphNodeQuery | HarnessGraphScope,
): Promise<HarnessTaskBoardProjection> {
  const query = normalizeProjectionQuery(input);
  const scope = resolveProjectionScope(query);
  const entries = (await readGraphNodes(store, { ...query, kinds: ["task"] }))
    .map(mapTaskNode)
    .sort((left, right) =>
      left.order === right.order
        ? left.updatedAt.localeCompare(right.updatedAt)
        : left.order - right.order,
    );
  return {
    scope,
    generatedAt: new Date().toISOString(),
    running: entries.filter((entry) => entry.status === "running"),
    completed: entries.filter((entry) => entry.status === "completed"),
    failed: entries.filter((entry) => entry.status === "failed"),
    canceled: entries.filter((entry) => entry.status === "canceled"),
  };
}

export async function projectHarnessApprovalInbox(
  store: GraphProjectionStore,
  input?: HarnessGraphNodeQuery | HarnessGraphScope,
): Promise<HarnessApprovalInboxProjection> {
  const query = normalizeProjectionQuery(input);
  const scope = resolveProjectionScope(query);
  const items = (await readGraphNodes(store, { ...query, kinds: ["approval"] }))
    .map(mapApprovalNode)
    .sort((left, right) =>
      left.updatedAt === right.updatedAt
        ? left.approvalId.localeCompare(right.approvalId)
        : left.updatedAt.localeCompare(right.updatedAt),
    );
  return {
    scope,
    generatedAt: new Date().toISOString(),
    pending: items.filter((item) => item.status === "pending"),
    resolved: items.filter((item) => item.status !== "pending"),
  };
}

export async function projectHarnessArtifactFeed(
  store: GraphProjectionStore,
  input?: HarnessGraphNodeQuery | HarnessGraphScope,
): Promise<HarnessArtifactFeedProjection> {
  const query = normalizeProjectionQuery(input);
  const scope = resolveProjectionScope(query);
  const items = sortGraphNodes(
    await readGraphNodes(store, { ...query, kinds: ["artifact"] }),
  ).map(mapArtifactNode);
  return {
    scope,
    generatedAt: new Date().toISOString(),
    items,
  };
}

export async function projectHarnessMemoryFeed(
  store: GraphProjectionStore,
  input?: HarnessGraphNodeQuery | HarnessGraphScope,
): Promise<HarnessMemoryFeedProjection> {
  const query = normalizeProjectionQuery(input);
  const scope = resolveProjectionScope(query);
  const items = sortGraphNodes(
    await readGraphNodes(store, {
      ...(query.scopes?.length ? { scopes: expandMemoryScopes(query.scopes) } : {}),
      ...(query.runId ? { runId: query.runId } : {}),
      ...(query.kinds?.length ? { kinds: query.kinds } : {}),
      ...(query.ids?.length ? { ids: query.ids } : {}),
      ...(query.text ? { text: query.text } : {}),
      ...(query.relatedTo ? { relatedTo: query.relatedTo } : {}),
      ...(query.minScore != null ? { minScore: query.minScore } : {}),
      kinds: ["memory"],
    }),
  ).map((node) => ({
    memoryId: node.id,
    nodeId: node.id,
    kind: node.status ?? "memory",
    scope: node.scope,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    content: node.content ?? "",
    ...(readString(node.metadata?.importance) ? { importance: readString(node.metadata?.importance) } : {}),
    ...(node.metadata ? { metadata: { ...node.metadata } } : {}),
  }));
  return {
    scope,
    generatedAt: new Date().toISOString(),
    items,
  };
}

export async function projectRunTimeline(
  store: GraphProjectionStore,
  runId: string,
): Promise<HarnessRunTimelineItem[]> {
  const projection = await projectHarnessRunTimeline(store, { kind: "run", runId });
  return projection.items;
}

export async function projectTaskBoard(
  store: GraphProjectionStore,
  query?: HarnessGraphNodeQuery,
): Promise<HarnessTaskBoardEntry[]> {
  const scope = resolveProjectionScope(query);
  const projection = await projectHarnessTaskBoard(store, scope);
  return [
    ...projection.running,
    ...projection.completed,
    ...projection.failed,
    ...projection.canceled,
  ];
}

export async function projectApprovalInbox(
  store: GraphProjectionStore,
  query?: HarnessGraphNodeQuery,
): Promise<HarnessApprovalInboxEntry[]> {
  const scope = resolveProjectionScope(query);
  const projection = await projectHarnessApprovalInbox(store, scope);
  return [...projection.pending, ...projection.resolved];
}

export async function projectArtifactFeed(
  store: GraphProjectionStore,
  query?: HarnessGraphNodeQuery,
): Promise<HarnessArtifactFeedItem[]> {
  const scope = resolveProjectionScope(query);
  const projection = await projectHarnessArtifactFeed(store, scope);
  return projection.items;
}

export function buildArtifactNodeData(artifact: {
  id: string;
  runId: string;
  kind: string;
  path: string;
  createdAt: string;
  mimeType: string;
  size: number;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    artifactId: artifact.id,
    runId: artifact.runId,
    kind: artifact.kind,
    path: artifact.path,
    createdAt: artifact.createdAt,
    mimeType: artifact.mimeType,
    size: artifact.size,
    ...(artifact.metadata ? { metadata: artifact.metadata } : {}),
  };
}

function compareTimelineNodes(left: HarnessGraphNodeRecord, right: HarnessGraphNodeRecord): number {
  const leftPriority = timelinePriority(left);
  const rightPriority = timelinePriority(right);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  if (left.kind === "task" && right.kind === "task") {
    const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt);
  }
  return left.id.localeCompare(right.id);
}

function timelinePriority(node: HarnessGraphNodeRecord): number {
  switch (node.kind) {
    case "run":
      return 0;
    case "checkpoint":
      return 1;
    case "turn":
      return 2;
    case "task":
      return 3;
    case "approval":
      return 4;
    case "artifact":
      return 5;
    case "memory":
      return 6;
    default: {
      const exhaustive: never = node.kind;
      return exhaustive;
    }
  }
}

function mapTaskNode(node: HarnessGraphNodeRecord): HarnessTaskBoardEntry {
  return {
    taskId: node.id,
    nodeId: node.id,
    name: node.title.replace(/^Task:\s*/, ""),
    status: node.status ?? "unknown",
    scope: node.scope,
    createdAt: node.createdAt,
    order: node.order ?? 0,
    updatedAt: node.updatedAt,
    ...(node.summary ? { summary: node.summary } : {}),
    ...(node.metadata ? { metadata: { ...node.metadata } } : {}),
  };
}

function mapApprovalNode(node: HarnessGraphNodeRecord): HarnessApprovalInboxEntry {
  return {
    approvalId: node.id,
    nodeId: node.id,
    tool: node.title.replace(/^Approval:\s*/, ""),
    status: normalizeApprovalStatus(node.status),
    scope: node.scope,
    requestedAt: node.createdAt,
    updatedAt: node.updatedAt,
    reason: node.summary ?? node.content ?? "approval required",
    ...(node.metadata ? { metadata: { ...node.metadata } } : {}),
  };
}

function mapArtifactNode(node: HarnessGraphNodeRecord): HarnessArtifactFeedItem {
  return {
    artifactId: node.id,
    nodeId: node.id,
    kind: readString(node.metadata?.kind) ?? "artifact",
    scope: node.scope,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    mimeType: readString(node.metadata?.mimeType) ?? "application/octet-stream",
    size: readNumber(node.metadata?.size) ?? 0,
    path: readString(node.metadata?.path) ?? node.content ?? "",
    ...(readString(node.metadata?.preview) ? { preview: readString(node.metadata?.preview) } : {}),
    ...(node.metadata ? { metadata: { ...node.metadata } } : {}),
  };
}

function resolveProjectionScope(
  query?: HarnessGraphScope | HarnessGraphNodeQuery,
): HarnessGraphScope {
  if (query && "kind" in query) {
    return query as HarnessGraphScope;
  }
  const scoped = query?.scopes?.[0];
  if (scoped) {
    return scoped;
  }
  if (query?.runId) {
    return { kind: "run", runId: query.runId };
  }
  throw new Error("Graph projection requires a runId or an explicit graph scope");
}

function normalizeProjectionQuery(
  input?: HarnessGraphNodeQuery | HarnessGraphScope,
): HarnessGraphNodeQuery {
  if (!input) {
    return {};
  }
  if ("kind" in input) {
    return {
      scopes: [input],
      ...readProjectionQueryFields(input as HarnessGraphScope & Partial<HarnessGraphNodeQuery>),
    };
  }
  return readProjectionQueryFields(input);
}

function readProjectionQueryFields(
  input: Partial<HarnessGraphNodeQuery>,
): HarnessGraphNodeQuery {
  return {
    ...(input.scopes?.length ? { scopes: input.scopes } : {}),
    ...(input.kinds?.length ? { kinds: input.kinds } : {}),
    ...(input.ids?.length ? { ids: input.ids } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.text ? { text: input.text } : {}),
    ...(input.relatedTo ? { relatedTo: input.relatedTo } : {}),
    ...(input.minScore != null ? { minScore: input.minScore } : {}),
    ...(input.limit != null ? { limit: input.limit } : {}),
  };
}

function expandMemoryScopes(scopes: readonly HarnessGraphScope[]): HarnessGraphScope[] {
  const expanded: HarnessGraphScope[] = [];
  for (const scope of scopes) {
    expanded.push(scope);
    if (scope.kind === "project") {
      expanded.push({ kind: "entity", entityType: "project", entityId: scope.projectId });
    }
  }
  return expanded;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function readGraphNodes(
  store: GraphProjectionStore,
  query: HarnessGraphNodeQuery,
): Promise<HarnessGraphNodeRecord[]> {
  if (typeof store.listNodes === "function") {
    return store.listNodes(query);
  }
  return store.listGraphNodes({
    ...(query.scopes?.length ? { scopes: query.scopes } : {}),
    ...(query.kinds?.length ? { kinds: query.kinds } : {}),
    ...(query.ids?.length ? { ids: query.ids } : {}),
    ...(query.runId ? { runId: query.runId } : {}),
    ...(query.text ? { text: query.text } : {}),
    ...(query.relatedTo ? { relatedTo: query.relatedTo } : {}),
    ...(query.minScore != null ? { minScore: query.minScore } : {}),
    ...(query.limit != null ? { limit: query.limit } : {}),
  });
}

function normalizeApprovalStatus(value: unknown): HarnessApprovalStatus {
  switch (value) {
    case "pending":
    case "approved":
    case "denied":
    case "canceled":
      return value;
    default:
      return "pending";
  }
}

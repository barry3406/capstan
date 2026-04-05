import type {
  HarnessGraphBindingResult,
  HarnessGraphEdgeRecord,
  HarnessGraphNodeRecord,
  HarnessGraphScope,
  HarnessGraphScopeRecord,
  HarnessGraphScopeSummary,
  HarnessGraphSearchResult,
} from "./types.js";

const NODE_KINDS = new Set<string>([
  "run",
  "turn",
  "checkpoint",
  "task",
  "artifact",
  "memory",
  "approval",
]);

const EDGE_KINDS = new Set<string>([
  "contains",
  "follows",
  "references",
  "generates",
  "summarizes",
  "promotes",
  "approves",
  "blocks",
]);

export function assertValidGraphScope(
  scope: unknown,
  context = "Graph scope",
): asserts scope is HarnessGraphScope {
  if (!isPlainObject(scope)) {
    throw new Error(`${context} is invalid: expected object`);
  }
  requireNonEmptyString(scope.kind, `${context}.kind`);
  switch (scope.kind) {
    case "project":
      requireNonEmptyString(scope.projectId, `${context}.projectId`);
      return;
    case "app":
      requireNonEmptyString(scope.appId, `${context}.appId`);
      return;
    case "run":
      requireNonEmptyString(scope.runId, `${context}.runId`);
      return;
    case "resource":
      requireNonEmptyString(scope.resourceType, `${context}.resourceType`);
      requireNonEmptyString(scope.resourceId, `${context}.resourceId`);
      return;
    case "capability":
      requireNonEmptyString(scope.capabilityId, `${context}.capabilityId`);
      return;
    case "policy":
      requireNonEmptyString(scope.policyId, `${context}.policyId`);
      return;
    case "entity":
      requireNonEmptyString(scope.entityType, `${context}.entityType`);
      requireNonEmptyString(scope.entityId, `${context}.entityId`);
      return;
    default:
      throw new Error(`${context} is invalid: unsupported kind "${scope.kind}"`);
  }
}

export function assertValidGraphScopeRecord(
  record: unknown,
  context = "Graph scope record",
): asserts record is HarnessGraphScopeRecord {
  if (!isPlainObject(record)) {
    throw new Error(`${context} is invalid: expected object`);
  }
  const value = record as unknown as Record<string, unknown>;
  requireNonEmptyString(value.id, `${context}.id`);
  assertValidGraphScope(value.scope, `${context}.scope`);
  requireNonEmptyString(value.title, `${context}.title`);
  requireNonEmptyString(value.createdAt, `${context}.createdAt`);
  requireNonEmptyString(value.updatedAt, `${context}.updatedAt`);
  if (value.metadata !== undefined && !isPlainObject(value.metadata)) {
    throw new Error(`${context}.metadata must be an object`);
  }
}

export function assertValidGraphScopeSummary(
  record: unknown,
  context = "Graph scope summary",
): asserts record is HarnessGraphScopeSummary {
  assertValidGraphScopeRecord(record, context);
  const value = record as unknown as Record<string, unknown>;
  if (!Number.isInteger(value.nodeCount as number) || (value.nodeCount as number) < 0) {
    throw new Error(`${context}.nodeCount must be a non-negative integer`);
  }
  if (!Number.isInteger(value.edgeCount) || (value.edgeCount as number) < 0) {
    throw new Error(`${context}.edgeCount must be a non-negative integer`);
  }
  requireStringArray(value.recentNodeIds, `${context}.recentNodeIds`);
  requireStringArray(value.recentEdgeIds, `${context}.recentEdgeIds`);
}

export function assertValidGraphNodeRecord(
  record: unknown,
  context = "Graph node record",
): asserts record is HarnessGraphNodeRecord {
  if (!isPlainObject(record)) {
    throw new Error(`${context} is invalid: expected object`);
  }
  const value = record as unknown as Record<string, unknown>;
  requireNonEmptyString(value.id, `${context}.id`);
  requireNonEmptyString(value.kind, `${context}.kind`);
  const kind = value.kind as string;
  if (!NODE_KINDS.has(kind)) {
    throw new Error(`${context} is invalid: unsupported kind "${String(kind)}"`);
  }
  assertValidGraphScope(value.scope, `${context}.scope`);
  requireNonEmptyString(value.title, `${context}.title`);
  requireNonEmptyString(value.createdAt, `${context}.createdAt`);
  requireNonEmptyString(value.updatedAt, `${context}.updatedAt`);
  if (value.runId !== undefined) {
    requireNonEmptyString(value.runId, `${context}.runId`);
  }
  if (value.status !== undefined) {
    requireNonEmptyString(value.status, `${context}.status`);
  }
  if (value.summary !== undefined && typeof value.summary !== "string") {
    throw new Error(`${context}.summary must be a string`);
  }
  if (value.content !== undefined && typeof value.content !== "string") {
    throw new Error(`${context}.content must be a string`);
  }
  if (
    value.order !== undefined &&
    (!Number.isInteger(value.order) || (value.order as number) < 0)
  ) {
    throw new Error(`${context}.order must be a non-negative integer`);
  }
  if (value.sourceId !== undefined) {
    requireNonEmptyString(value.sourceId, `${context}.sourceId`);
  }
  if (value.relatedIds !== undefined) {
    requireStringArray(value.relatedIds, `${context}.relatedIds`);
  }
  if (value.metadata !== undefined && !isPlainObject(value.metadata)) {
    throw new Error(`${context}.metadata must be an object`);
  }
}

export function assertValidGraphEdgeRecord(
  record: unknown,
  context = "Graph edge record",
): asserts record is HarnessGraphEdgeRecord {
  if (!isPlainObject(record)) {
    throw new Error(`${context} is invalid: expected object`);
  }
  const value = record as unknown as Record<string, unknown>;
  requireNonEmptyString(value.id, `${context}.id`);
  requireNonEmptyString(value.kind, `${context}.kind`);
  const kind = value.kind as string;
  if (!EDGE_KINDS.has(kind)) {
    throw new Error(`${context} is invalid: unsupported kind "${String(kind)}"`);
  }
  assertValidGraphScope(value.scope, `${context}.scope`);
  requireNonEmptyString(value.from, `${context}.from`);
  requireNonEmptyString(value.to, `${context}.to`);
  requireNonEmptyString(value.createdAt, `${context}.createdAt`);
  requireNonEmptyString(value.updatedAt, `${context}.updatedAt`);
  if (value.runId !== undefined) {
    requireNonEmptyString(value.runId, `${context}.runId`);
  }
  if (value.metadata !== undefined && !isPlainObject(value.metadata)) {
    throw new Error(`${context}.metadata must be an object`);
  }
}

export function assertValidGraphSearchResult(
  record: unknown,
  context = "Graph search result",
): asserts record is HarnessGraphSearchResult {
  assertValidGraphNodeRecord(record, context);
  const value = record as unknown as Record<string, unknown>;
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) {
    throw new Error(`${context}.score must be a finite number`);
  }
  requireStringArray(value.matchedFields, `${context}.matchedFields`);
  requireStringArray(value.reasons, `${context}.reasons`);
}

export function assertValidGraphBindingResult(
  record: unknown,
  context = "Graph binding result",
): asserts record is HarnessGraphBindingResult {
  if (!isPlainObject(record)) {
    throw new Error(`${context} is invalid: expected object`);
  }
  const value = record as unknown as Record<string, unknown>;
  assertValidGraphScopeRecord(value.scope, `${context}.scope`);
  if (!Array.isArray(value.nodes)) {
    throw new Error(`${context}.nodes must be an array`);
  }
  if (!Array.isArray(value.edges)) {
    throw new Error(`${context}.edges must be an array`);
  }
  for (const [index, node] of (value.nodes as unknown[]).entries()) {
    assertValidGraphNodeRecord(node, `${context}.nodes[${index}]`);
  }
  for (const [index, edge] of (value.edges as unknown[]).entries()) {
    assertValidGraphEdgeRecord(edge, `${context}.edges[${index}]`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, context: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${context} must be a non-empty string`);
  }
}

function requireStringArray(value: unknown, context: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${context} must be a string array`);
  }
}

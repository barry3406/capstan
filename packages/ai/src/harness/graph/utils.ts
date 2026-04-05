import { createHash } from "node:crypto";

import type { MemoryScope } from "../../types.js";
import type {
  HarnessGraphEdgeFilter,
  HarnessGraphEdgeRecord,
  HarnessGraphNodeFilter,
  HarnessGraphNodeRecord,
  HarnessGraphScope,
} from "./types.js";

export function createProjectGraphScope(projectId: string): HarnessGraphScope {
  return { kind: "project", projectId: normalizeNonEmptyString(projectId, "projectId") };
}

export function createRuntimeProjectGraphScope(runtimeRootDir: string): HarnessGraphScope {
  return createProjectGraphScope(createStableRuntimeProjectId(runtimeRootDir));
}

export function createRunGraphScope(runId: string): HarnessGraphScope {
  return { kind: "run", runId: normalizeNonEmptyString(runId, "runId") };
}

export function createRuntimeProjectMemoryScope(runtimeRootDir: string): MemoryScope {
  return {
    type: "project",
    id: createStableRuntimeProjectId(runtimeRootDir),
  };
}

export function normalizeGraphScope(scope: HarnessGraphScope): HarnessGraphScope {
  switch (scope.kind) {
    case "project":
      return { kind: "project", projectId: normalizeNonEmptyString(scope.projectId, "projectId") };
    case "app":
      return { kind: "app", appId: normalizeNonEmptyString(scope.appId, "appId") };
    case "run":
      return { kind: "run", runId: normalizeNonEmptyString(scope.runId, "runId") };
    case "resource":
      return {
        kind: "resource",
        resourceType: normalizeNonEmptyString(scope.resourceType, "resourceType"),
        resourceId: normalizeNonEmptyString(scope.resourceId, "resourceId"),
      };
    case "capability":
      return {
        kind: "capability",
        capabilityId: normalizeNonEmptyString(scope.capabilityId, "capabilityId"),
      };
    case "policy":
      return {
        kind: "policy",
        policyId: normalizeNonEmptyString(scope.policyId, "policyId"),
      };
    case "entity":
      return {
        kind: "entity",
        entityType: normalizeNonEmptyString(scope.entityType, "entityType"),
        entityId: normalizeNonEmptyString(scope.entityId, "entityId"),
      };
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
}

export function normalizeGraphScopes(scopes: readonly HarnessGraphScope[]): HarnessGraphScope[] {
  const seen = new Set<string>();
  const result: HarnessGraphScope[] = [];
  for (const scope of scopes) {
    const normalized = normalizeGraphScope(scope);
    const key = formatHarnessGraphScopeKey(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function mergeGraphScopes(
  ...groups: Array<readonly HarnessGraphScope[] | undefined>
): HarnessGraphScope[] {
  return normalizeGraphScopes(
    groups.flatMap((group) => (group ? [...group] : [])),
  );
}

export function graphScopeKey(scope: HarnessGraphScope): string {
  return formatHarnessGraphScopeKey(normalizeGraphScope(scope));
}

export function createStableRuntimeProjectId(runtimeRootDir: string): string {
  const normalized = normalizeNonEmptyString(runtimeRootDir, "runtimeRootDir");
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `runtime-${hash}`;
}

export function formatHarnessGraphScopeKey(scope: HarnessGraphScope): string {
  switch (scope.kind) {
    case "project":
      return `project__${sanitizeGraphKeySegment(scope.projectId)}`;
    case "app":
      return `app__${sanitizeGraphKeySegment(scope.appId)}`;
    case "run":
      return `run__${sanitizeGraphKeySegment(scope.runId)}`;
    case "resource":
      return `resource__${sanitizeGraphKeySegment(scope.resourceType)}__${sanitizeGraphKeySegment(scope.resourceId)}`;
    case "capability":
      return `capability__${sanitizeGraphKeySegment(scope.capabilityId)}`;
    case "policy":
      return `policy__${sanitizeGraphKeySegment(scope.policyId)}`;
    case "entity":
      return `entity__${sanitizeGraphKeySegment(scope.entityType)}__${sanitizeGraphKeySegment(scope.entityId)}`;
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
}

export function formatHarnessGraphScopeTitle(scope: HarnessGraphScope): string {
  switch (scope.kind) {
    case "project":
      return `Project: ${scope.projectId}`;
    case "app":
      return `App: ${scope.appId}`;
    case "run":
      return `Run: ${scope.runId}`;
    case "resource":
      return `Resource: ${scope.resourceType}/${scope.resourceId}`;
    case "capability":
      return `Capability: ${scope.capabilityId}`;
    case "policy":
      return `Policy: ${scope.policyId}`;
    case "entity":
      return `Entity: ${scope.entityType}/${scope.entityId}`;
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
}

export function scopesEqual(left: HarnessGraphScope, right: HarnessGraphScope): boolean {
  return formatHarnessGraphScopeKey(left) === formatHarnessGraphScopeKey(right);
}

export function graphScopesIntersect(
  left: readonly HarnessGraphScope[],
  right: readonly HarnessGraphScope[] | undefined,
): boolean {
  if (!right || right.length === 0) {
    return true;
  }
  const rightKeys = new Set(right.map((scope) => formatHarnessGraphScopeKey(scope)));
  return left.some((scope) => rightKeys.has(formatHarnessGraphScopeKey(scope)));
}

export function graphNodeMatchesQuery(
  node: HarnessGraphNodeRecord,
  query?: HarnessGraphNodeFilter,
): boolean {
  if (!query) {
    return true;
  }
  if (query.kinds?.length && !query.kinds.includes(node.kind)) {
    return false;
  }
  if (query.runId && node.runId !== query.runId) {
    return false;
  }
  if (query.ids?.length && !query.ids.includes(node.id)) {
    return false;
  }
  return graphScopesIntersect(readNodeScopes(node), query.scopes);
}

export function graphEdgeMatchesQuery(
  edge: HarnessGraphEdgeRecord,
  query?: HarnessGraphEdgeFilter,
): boolean {
  if (!query) {
    return true;
  }
  if (query.kinds?.length && !query.kinds.includes(edge.kind)) {
    return false;
  }
  if (query.runId && edge.runId !== query.runId) {
    return false;
  }
  if (query.ids?.length && !query.ids.includes(edge.id)) {
    return false;
  }
  if (query.fromIds?.length && !query.fromIds.includes(edge.from)) {
    return false;
  }
  if (query.toIds?.length && !query.toIds.includes(edge.to)) {
    return false;
  }
  return graphScopesIntersect([edge.scope], query.scopes);
}

export function sortGraphNodes(
  nodes: readonly HarnessGraphNodeRecord[],
): HarnessGraphNodeRecord[] {
  return nodes.slice().sort(compareTimestampDescendingThenId);
}

export function sortGraphEdges(
  edges: readonly HarnessGraphEdgeRecord[],
): HarnessGraphEdgeRecord[] {
  return edges.slice().sort(compareTimestampDescendingThenId);
}

export function compareTimestampDescendingThenId(
  left: { updatedAt: string; id: string },
  right: { updatedAt: string; id: string },
): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt);
  }
  return left.id.localeCompare(right.id);
}

export function memoryScopeToGraphScope(scope: MemoryScope): HarnessGraphScope {
  const type = normalizeNonEmptyString(scope.type, "memoryScope.type");
  const id = normalizeNonEmptyString(scope.id, "memoryScope.id");
  switch (type) {
    case "project":
      return { kind: "project", projectId: id };
    case "run":
      return { kind: "run", runId: id };
    case "app":
      return { kind: "app", appId: id };
    case "capability":
      return { kind: "capability", capabilityId: id };
    case "policy":
      return { kind: "policy", policyId: id };
    default:
      return { kind: "entity", entityType: type, entityId: id };
  }
}

export function graphNodeSearchText(node: HarnessGraphNodeRecord): string {
  return normalizeSearchText(
    [
      node.id,
      node.kind,
      node.runId ?? "",
      node.title,
      node.status ?? "",
      node.summary ?? "",
      node.content ?? "",
      formatHarnessGraphScopeTitle(node.scope),
      node.metadata ? extractGraphSearchText(node.metadata) : "",
    ].join(" "),
  );
}

export function scoreGraphNode(node: HarnessGraphNodeRecord, query: string): number {
  const tokens = tokenizeGraphQuery(query);
  if (tokens.length === 0) {
    return recencyScore(node.updatedAt) + kindBoost(node.kind);
  }
  return (
    scoreTokenOverlap(tokens, graphNodeSearchText(node)) * 0.8 +
    recencyScore(node.updatedAt) * 0.15 +
    kindBoost(node.kind) * 0.05
  );
}

export function tokenizeGraphQuery(value: string): string[] {
  return normalizeSearchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

export function scoreTokenOverlap(tokens: readonly string[], haystack: string): number {
  if (tokens.length === 0) {
    return 0;
  }
  const normalizedHaystack = normalizeSearchText(haystack);
  const matched = tokens.filter((token) => normalizedHaystack.includes(token)).length;
  return matched / tokens.length;
}

export function recencyScore(updatedAt: string): number {
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  const ageHours = Math.max((Date.now() - timestamp) / (1000 * 60 * 60), 0);
  return 1 / (1 + ageHours / 24);
}

export function extractGraphSearchText(value: unknown): string {
  return normalizeSearchText(stableSearchText(value));
}

export function stripUndefinedGraphValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== undefined)
      .map((entry) => stripUndefinedGraphValue(entry)) as T;
  }
  if (value != null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (acc, [key, entry]) => {
        if (entry !== undefined) {
          acc[key] = stripUndefinedGraphValue(entry);
        }
        return acc;
      },
      {},
    ) as T;
  }
  return value;
}

export function encodeGraphPathSegment(value: string): string {
  return sanitizeGraphKeySegment(normalizeNonEmptyString(value, "path segment"));
}

function readNodeScopes(node: HarnessGraphNodeRecord): HarnessGraphScope[] {
  const additional = Array.isArray(node.metadata?.graphScopes)
    ? node.metadata.graphScopes.filter(isGraphScopeLike).map((scope) => normalizeGraphScope(scope))
    : [];
  return mergeGraphScopes([node.scope], additional);
}

function isGraphScopeLike(value: unknown): value is HarnessGraphScope {
  return value != null && typeof value === "object" && "kind" in value;
}

function stableSearchText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stableSearchText(entry)).join(" ");
  }
  if (typeof value === "object") {
    return JSON.stringify(sortValue(value));
  }
  return String(value);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value != null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNonEmptyString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Harness graph ${field} must be a non-empty string`);
  }
  return normalized;
}

function sanitizeGraphKeySegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "")
    .replace(/_+/g, "_") || "unknown";
}

function kindBoost(kind: HarnessGraphNodeRecord["kind"]): number {
  switch (kind) {
    case "run":
      return 1;
    case "turn":
      return 0.92;
    case "checkpoint":
      return 0.88;
    case "approval":
      return 0.86;
    case "task":
      return 0.82;
    case "memory":
      return 0.78;
    case "artifact":
      return 0.74;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

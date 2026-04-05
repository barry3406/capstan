import { randomUUID } from "node:crypto";
import {
  mkdir as fsMkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { HarnessRuntimePaths } from "../types.js";
import type {
  HarnessGraphEdgeFilter,
  HarnessGraphEdgeRecord,
  HarnessGraphNodeFilter,
  HarnessGraphNodeRecord,
  HarnessGraphPathSet,
  HarnessGraphScope,
  HarnessGraphScopeRecord,
  HarnessGraphScopeSummary,
  HarnessGraphStore,
  HarnessLegacyGraphEdgeRecord,
  HarnessLegacyGraphNodeRecord,
} from "./types.js";
import {
  buildHarnessGraphPaths,
  encodeGraphPathSegmentForFilePath,
  resolveHarnessGraphEdgeFilePath,
  resolveHarnessGraphNodeFilePath,
  resolveHarnessGraphScopeFilePath,
} from "./paths.js";
import {
  compareTimestampDescendingThenId,
  formatHarnessGraphScopeKey,
  formatHarnessGraphScopeTitle,
  encodeGraphPathSegment,
  graphEdgeMatchesQuery,
  graphNodeMatchesQuery,
  memoryScopeToGraphScope,
  normalizeGraphScope,
  sortGraphEdges,
  sortGraphNodes,
  stripUndefinedGraphValue,
} from "./utils.js";
import {
  assertValidGraphEdgeRecord,
  assertValidGraphNodeRecord,
  assertValidGraphScopeRecord,
} from "./validation.js";

interface GraphStoreIO {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(path: string, encoding: BufferEncoding | { encoding: BufferEncoding }): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  stat?(path: string): Promise<{ isDirectory(): boolean }>;
  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: string | { encoding?: BufferEncoding; flag?: string },
  ): Promise<void>;
}

const defaultIO: GraphStoreIO = {
  mkdir: async (path, options) => {
    await fsMkdir(path, options);
  },
  async readFile(path, encoding) {
    return (await readFile(path, encoding as BufferEncoding)) as string;
  },
  readdir,
  rename,
  stat,
  async writeFile(path, data, options) {
    await writeFile(path, data as string | Uint8Array, options as any);
  },
};

export function createHarnessGraphStore(rootDir: string): FileHarnessGraphStore {
  return new FileHarnessGraphStore(rootDir);
}

export class FileHarnessGraphStore implements HarnessGraphStore {
  readonly paths: HarnessGraphPathSet;
  private readonly io: GraphStoreIO;
  private readonly nodeIndexDir: string;
  private readonly edgeIndexDir: string;

  constructor(rootDirOrPaths: string | Pick<HarnessRuntimePaths, "graphDir">, io: GraphStoreIO = defaultIO) {
    this.paths =
      typeof rootDirOrPaths === "string"
        ? buildHarnessGraphPaths(rootDirOrPaths)
        : {
            graphRootDir: rootDirOrPaths.graphDir,
            scopesDir: resolve(rootDirOrPaths.graphDir, "scopes"),
            nodesDir: resolve(rootDirOrPaths.graphDir, "nodes"),
            edgesDir: resolve(rootDirOrPaths.graphDir, "edges"),
            projectionsDir: resolve(rootDirOrPaths.graphDir, "projections"),
          };
    this.io = io;
    this.nodeIndexDir = resolve(this.paths.nodesDir, "_index");
    this.edgeIndexDir = resolve(this.paths.edgesDir, "_index");
  }

  async initialize(): Promise<void> {
    await this.io.mkdir(this.paths.graphRootDir, { recursive: true });
    await this.io.mkdir(this.paths.scopesDir, { recursive: true });
    await this.io.mkdir(this.paths.nodesDir, { recursive: true });
    await this.io.mkdir(this.paths.edgesDir, { recursive: true });
    await this.io.mkdir(this.paths.projectionsDir, { recursive: true });
    await this.io.mkdir(this.nodeIndexDir, { recursive: true });
    await this.io.mkdir(this.edgeIndexDir, { recursive: true });
  }

  async persistScope(record: HarnessGraphScopeRecord): Promise<void> {
    await this.initialize();
    assertValidGraphScopeRecord(record, "Harness graph scope record");
    await writeJsonAtomic(
      resolveHarnessGraphScopeFilePath(this.paths, record.scope),
      record,
      this.io,
    );
  }

  async getScope(scope: HarnessGraphScope): Promise<HarnessGraphScopeRecord | undefined> {
    await this.initialize();
    return readGraphRecord(
      resolveHarnessGraphScopeFilePath(this.paths, normalizeGraphScope(scope)),
      this.io,
      assertValidGraphScopeRecord,
      "Harness graph scope record",
    );
  }

  async listScopes(): Promise<HarnessGraphScopeRecord[]> {
    await this.initialize();
    const entries = await this.io.readdir(this.paths.scopesDir).catch(handleMissingDirectory);
    const records = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) =>
          readGraphRecord(
            resolve(this.paths.scopesDir, entry),
            this.io,
            assertValidGraphScopeRecord,
            "Harness graph scope record",
          ),
        ),
    );
    return records
      .filter((record): record is HarnessGraphScopeRecord => Boolean(record))
      .sort(compareTimestampDescendingThenId);
  }

  async describeScope(scope: HarnessGraphScope): Promise<HarnessGraphScopeSummary> {
    const normalized = normalizeGraphScope(scope);
    const record =
      (await this.getScope(normalized)) ??
      {
        id: formatHarnessGraphScopeKey(normalized),
        scope: normalized,
        title: formatHarnessGraphScopeTitle(normalized),
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
    const nodes = await this.listNodes({ scopes: [normalized] });
    const edges = await this.listEdges({ scopes: [normalized] });
    return {
      ...record,
      ...(nodes[0] || edges[0]
        ? {
            updatedAt: [record.updatedAt, nodes[0]?.updatedAt, edges[0]?.updatedAt]
              .filter((value): value is string => Boolean(value))
              .sort()
              .at(-1)!,
          }
        : {}),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      recentNodeIds: nodes.slice(0, 10).map((node) => node.id),
      recentEdgeIds: edges.slice(0, 10).map((edge) => edge.id),
    };
  }

  async listScopeSummaries(): Promise<HarnessGraphScopeSummary[]> {
    const scopes = await this.listScopes();
    return Promise.all(scopes.map((record) => this.describeScope(record.scope)));
  }

  async persistNode(record: HarnessGraphNodeRecord | HarnessLegacyGraphNodeRecord): Promise<void> {
    await this.upsertNode(record);
  }

  async upsertNode(record: HarnessGraphNodeRecord | HarnessLegacyGraphNodeRecord): Promise<void> {
    await this.initialize();
    const normalized = normalizeNodeRecord(record);
    await this.ensureScopeRecord(normalized.scope, normalized.createdAt, normalized.updatedAt);
    await writeJsonAtomic(resolveHarnessGraphNodeFilePath(this.paths, normalized), normalized, this.io);
    await writeJsonAtomic(nodeIndexPath(this.nodeIndexDir, normalized.id), normalized, this.io);
  }

  async getNode(nodeId: string): Promise<HarnessGraphNodeRecord | undefined> {
    await this.initialize();
    const indexedRecord = await readGraphRecord(
      nodeIndexPath(this.nodeIndexDir, nodeId),
      this.io,
      assertValidGraphNodeRecord,
      "Harness graph record",
    );
    if (!indexedRecord) {
      return undefined;
    }
    return this.readCanonicalNodeRecord(indexedRecord);
  }

  async getGraphNode(nodeId: string): Promise<HarnessGraphNodeRecord | undefined> {
    return this.getNode(nodeId);
  }

  async listNodes(filter?: HarnessGraphNodeFilter): Promise<HarnessGraphNodeRecord[]> {
    await this.initialize();
    const entries = await this.io.readdir(this.nodeIndexDir).catch(handleMissingDirectory);
    const records = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) =>
          readGraphRecord(
            resolve(this.nodeIndexDir, entry),
            this.io,
            assertValidGraphNodeRecord,
            "Harness graph record",
          ),
        ),
    );
    const canonicalRecords = await Promise.all(
      records
        .filter((record): record is HarnessGraphNodeRecord => Boolean(record))
        .map((record) => this.readCanonicalNodeRecord(record)),
    );
    const nodes = sortGraphNodes(
      canonicalRecords.filter((record): record is HarnessGraphNodeRecord => Boolean(record)),
    ).filter((node) => graphNodeMatchesQuery(node, filter));
    return typeof filter?.limit === "number" ? nodes.slice(0, filter.limit) : nodes;
  }

  async listGraphNodes(filter?: HarnessGraphNodeFilter): Promise<HarnessGraphNodeRecord[]> {
    return this.listNodes(filter);
  }

  async persistEdge(record: HarnessGraphEdgeRecord | HarnessLegacyGraphEdgeRecord): Promise<void> {
    await this.upsertEdge(record);
  }

  async upsertEdge(record: HarnessGraphEdgeRecord | HarnessLegacyGraphEdgeRecord): Promise<void> {
    await this.initialize();
    const normalized = normalizeEdgeRecord(record);
    await this.ensureScopeRecord(normalized.scope, normalized.createdAt, normalized.updatedAt);
    await writeJsonAtomic(resolveHarnessGraphEdgeFilePath(this.paths, normalized), normalized, this.io);
    await writeJsonAtomic(edgeIndexPath(this.edgeIndexDir, normalized.id), normalized, this.io);
  }

  async getEdge(edgeId: string): Promise<HarnessGraphEdgeRecord | undefined> {
    await this.initialize();
    const indexedRecord = await readGraphRecord(
      edgeIndexPath(this.edgeIndexDir, edgeId),
      this.io,
      assertValidGraphEdgeRecord,
      "Harness graph record",
    );
    if (!indexedRecord) {
      return undefined;
    }
    return this.readCanonicalEdgeRecord(indexedRecord);
  }

  async listEdges(filter?: HarnessGraphEdgeFilter): Promise<HarnessGraphEdgeRecord[]> {
    await this.initialize();
    const entries = await this.io.readdir(this.edgeIndexDir).catch(handleMissingDirectory);
    const records = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) =>
          readGraphRecord(
            resolve(this.edgeIndexDir, entry),
            this.io,
            assertValidGraphEdgeRecord,
            "Harness graph record",
          ),
        ),
    );
    const canonicalRecords = await Promise.all(
      records
        .filter((record): record is HarnessGraphEdgeRecord => Boolean(record))
        .map((record) => this.readCanonicalEdgeRecord(record)),
    );
    const edges = sortGraphEdges(
      canonicalRecords.filter((record): record is HarnessGraphEdgeRecord => Boolean(record)),
    ).filter((edge) => graphEdgeMatchesQuery(edge, filter));
    return typeof filter?.limit === "number" ? edges.slice(0, filter.limit) : edges;
  }

  async listGraphEdges(filter?: HarnessGraphEdgeFilter): Promise<HarnessGraphEdgeRecord[]> {
    return this.listEdges(filter);
  }

  private async readCanonicalNodeRecord(
    indexedRecord: HarnessGraphNodeRecord,
  ): Promise<HarnessGraphNodeRecord | undefined> {
    const canonicalPath = resolveHarnessGraphNodeFilePath(this.paths, indexedRecord);
    const canonicalRecord = await readGraphRecord(
      canonicalPath,
      this.io,
      assertValidGraphNodeRecord,
      "Harness graph record",
    );
    if (!canonicalRecord) {
      throw new Error(
        `Harness graph record is inconsistent: missing primary node file for ${indexedRecord.id}`,
      );
    }
    return canonicalRecord;
  }

  private async readCanonicalEdgeRecord(
    indexedRecord: HarnessGraphEdgeRecord,
  ): Promise<HarnessGraphEdgeRecord | undefined> {
    const canonicalPath = resolveHarnessGraphEdgeFilePath(this.paths, indexedRecord);
    const canonicalRecord = await readGraphRecord(
      canonicalPath,
      this.io,
      assertValidGraphEdgeRecord,
      "Harness graph record",
    );
    if (!canonicalRecord) {
      throw new Error(
        `Harness graph record is inconsistent: missing primary edge file for ${indexedRecord.id}`,
      );
    }
    return canonicalRecord;
  }

  private async ensureScopeRecord(
    scope: HarnessGraphScope,
    createdAt: string,
    updatedAt: string,
  ): Promise<void> {
    const existing = await this.getScope(scope);
    if (existing) {
      if (existing.updatedAt >= updatedAt) {
        return;
      }
      await this.persistScope({
        ...existing,
        updatedAt,
      });
      return;
    }
    await this.persistScope({
      id: formatHarnessGraphScopeKey(scope),
      scope,
      title: formatHarnessGraphScopeTitle(scope),
      createdAt,
      updatedAt,
    });
  }
}

async function readGraphRecord<T>(
  path: string,
  io: Pick<GraphStoreIO, "readFile">,
  assertValid: (value: unknown, context?: string) => asserts value is T,
  context: string,
): Promise<T | undefined> {
  try {
    const source = await io.readFile(path, "utf8");
    const parsed = JSON.parse(source) as unknown;
    assertValid(parsed, context);
    return parsed;
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw new Error(`${context} Failed to read graph record: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeJsonAtomic(
  path: string,
  value: unknown,
  io: Pick<GraphStoreIO, "mkdir" | "rename" | "writeFile">,
): Promise<void> {
  await io.mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  await io.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await io.rename(tempPath, path);
}

function nodeIndexPath(nodeIndexDir: string, nodeId: string): string {
  return resolve(
    nodeIndexDir,
    `${encodeGraphPathSegmentForFilePath(encodeGraphPathSegment(nodeId))}.json`,
  );
}

function edgeIndexPath(edgeIndexDir: string, edgeId: string): string {
  return resolve(
    edgeIndexDir,
    `${encodeGraphPathSegmentForFilePath(encodeGraphPathSegment(edgeId))}.json`,
  );
}

function normalizeNodeRecord(
  record: HarnessGraphNodeRecord | HarnessLegacyGraphNodeRecord,
): HarnessGraphNodeRecord {
  if ("scope" in record) {
    assertValidGraphNodeRecord(record, "Harness graph record");
    return {
      ...record,
      scope: normalizeGraphScope(record.scope),
      ...(record.metadata ? { metadata: stripUndefinedGraphValue(record.metadata) } : {}),
    };
  }
  const scope = normalizeLegacyScope(record.scopes, record.runId);
  const metadata = stripUndefinedGraphValue({
    legacyKind: record.kind,
    ...record.data,
  });
  const node: HarnessGraphNodeRecord = {
    id: record.id,
    kind: mapLegacyNodeKind(record.kind),
    scope,
    title: deriveLegacyNodeTitle(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.runId ? { runId: record.runId } : {}),
    ...(deriveLegacyNodeStatus(record) ? { status: deriveLegacyNodeStatus(record) } : {}),
    ...(deriveLegacyNodeSummary(record) ? { summary: deriveLegacyNodeSummary(record) } : {}),
    ...(deriveLegacyNodeContent(record) ? { content: deriveLegacyNodeContent(record) } : {}),
    ...(typeof record.data.order === "number" ? { order: record.data.order } : {}),
    metadata,
  };
  assertValidGraphNodeRecord(node, "Harness graph record");
  return node;
}

function normalizeEdgeRecord(
  record: HarnessGraphEdgeRecord | HarnessLegacyGraphEdgeRecord,
): HarnessGraphEdgeRecord {
  if ("scope" in record) {
    assertValidGraphEdgeRecord(record, "Harness graph record");
    return {
      ...record,
      scope: normalizeGraphScope(record.scope),
      ...(record.metadata ? { metadata: stripUndefinedGraphValue(record.metadata) } : {}),
    };
  }
  const edge: HarnessGraphEdgeRecord = {
    id: record.id,
    kind: mapLegacyEdgeKind(record.kind),
    scope: normalizeLegacyScope(record.scopes, record.runId),
    from: record.from,
    to: record.to,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.runId ? { runId: record.runId } : {}),
    ...(record.metadata ? { metadata: stripUndefinedGraphValue(record.metadata) } : {}),
  };
  assertValidGraphEdgeRecord(edge, "Harness graph record");
  return edge;
}

function normalizeLegacyScope(
  scopes: readonly HarnessGraphScope[] | undefined,
  runId?: string,
): HarnessGraphScope {
  if (scopes && scopes.length > 0) {
    return normalizeGraphScope(scopes[0]!);
  }
  if (runId) {
    return { kind: "run", runId };
  }
  return { kind: "entity", entityType: "legacy", entityId: "unknown" };
}

function mapLegacyNodeKind(kind: HarnessLegacyGraphNodeRecord["kind"]): HarnessGraphNodeRecord["kind"] {
  switch (kind) {
    case "run":
      return "run";
    case "turn":
      return "turn";
    case "task_execution":
      return "task";
    case "artifact":
      return "artifact";
    case "memory_record":
      return "memory";
    case "approval_request":
      return "approval";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function mapLegacyEdgeKind(kind: HarnessLegacyGraphEdgeRecord["kind"]): HarnessGraphEdgeRecord["kind"] {
  switch (kind) {
    case "run_turn":
    case "run_task":
    case "run_artifact":
    case "run_memory":
    case "run_approval":
      return "contains";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function deriveLegacyNodeTitle(record: HarnessLegacyGraphNodeRecord): string {
  const data = record.data;
  switch (record.kind) {
    case "run":
      return `Run: ${readString(data.goal) ?? record.id}`;
    case "turn":
      return `Turn ${readNumber(data.iteration) ?? "?"}: ${readString(data.phase) ?? readString(data.stage) ?? "unknown"}`;
    case "task_execution":
      return `Task: ${readString(data.name) ?? record.id}`;
    case "artifact":
      return `Artifact: ${readString(data.kind) ?? record.id}`;
    case "memory_record":
      return `Memory: ${readString(data.memoryKind) ?? readString(data.kind) ?? "memory"}`;
    case "approval_request":
      return `Approval: ${readString(data.tool) ?? record.id}`;
    default: {
      const exhaustive: never = record.kind;
      return exhaustive;
    }
  }
}

function deriveLegacyNodeStatus(record: HarnessLegacyGraphNodeRecord): string | undefined {
  return readString(record.data.status) ?? readString(record.data.phase) ?? readString(record.data.stage);
}

function deriveLegacyNodeSummary(record: HarnessLegacyGraphNodeRecord): string | undefined {
  return (
    readString(record.data.summary) ??
    readString(record.data.contentPreview) ??
    readString(record.data.goal) ??
    readString(record.data.reason) ??
    readString(record.data.path)
  );
}

function deriveLegacyNodeContent(record: HarnessLegacyGraphNodeRecord): string | undefined {
  return (
    readString(record.data.content) ??
    readString(record.data.path) ??
    readString(record.data.error)
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function handleMissingDirectory(error: unknown): string[] {
  if (isFileNotFound(error)) {
    return [];
  }
  throw error;
}

function isFileNotFound(error: unknown): boolean {
  return (
    error != null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

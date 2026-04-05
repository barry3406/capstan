import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  buildHarnessGraphPaths,
  createHarnessGraphStore,
  resolveHarnessGraphEdgeFilePath,
  resolveHarnessGraphNodeFilePath,
  resolveHarnessGraphScopeFilePath,
} from "../../packages/ai/src/harness/graph/index.ts";
import type {
  HarnessGraphEdgeRecord,
  HarnessGraphNodeRecord,
  HarnessGraphScope,
  HarnessGraphScopeRecord,
} from "../../packages/ai/src/harness/graph/index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-graph-store-"));
  tempDirs.push(dir);
  return dir;
}

function buildScope(): HarnessGraphScope {
  return { kind: "run", runId: "run/alpha" };
}

function buildNode(
  id: string,
  patch: Partial<HarnessGraphNodeRecord> = {},
): HarnessGraphNodeRecord {
  const scope = buildScope();
  return {
    id,
    kind: "turn",
    scope,
    title: "Turn one",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    status: "sampling_model",
    summary: "first turn",
    content: "first turn content",
    ...patch,
  };
}

function buildEdge(
  id: string,
  patch: Partial<HarnessGraphEdgeRecord> = {},
): HarnessGraphEdgeRecord {
  const scope = buildScope();
  return {
    id,
    kind: "contains",
    scope,
    from: "run:alpha",
    to: "turn:alpha:1",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    ...patch,
  };
}

describe("FileHarnessGraphStore", () => {
  it("persists records under the harness runtime root and keeps ids path-safe", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    const scope = buildScope();
    const scopeRecord: HarnessGraphScopeRecord = {
      id: "run__run_alpha",
      scope,
      title: "Run: alpha",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
    };
    const node = buildNode("turn/1:weird");
    const edge = buildEdge("edge/1:weird", {
      from: node.id,
      to: "task:alpha/beta",
      kind: "references",
    });

    await store.persistScope(scopeRecord);
    await store.persistNode(node);
    await store.persistEdge(edge);

    const paths = buildHarnessGraphPaths(rootDir);
    expect(paths.graphRootDir).toBe(resolve(rootDir, ".capstan/harness/graph"));
    expect(await stat(resolveHarnessGraphScopeFilePath(paths, scope))).toBeDefined();
    expect(await stat(resolveHarnessGraphNodeFilePath(paths, node))).toBeDefined();
    expect(await stat(resolveHarnessGraphEdgeFilePath(paths, edge))).toBeDefined();

    const persistedScope = await store.getScope(scope);
    expect(persistedScope?.id).toBe(scopeRecord.id);
    expect(persistedScope?.scope).toEqual(scopeRecord.scope);
    expect(persistedScope?.title).toBe(scopeRecord.title);
    expect(await store.getNode(node.id)).toMatchObject(node);
    expect(await store.getEdge(edge.id)).toMatchObject(edge);
    expect(await store.listNodes({ scopes: [scope] })).toHaveLength(1);
    expect(await store.listEdges({ scopes: [scope] })).toHaveLength(1);

    const summary = await store.describeScope(scope);
    expect(summary.nodeCount).toBe(1);
    expect(summary.edgeCount).toBe(1);
    expect(summary.recentNodeIds).toEqual([node.id]);
    expect(summary.recentEdgeIds).toEqual([edge.id]);
  });

  it("normalizes legacy runtime graph shapes through the compatibility upsert path", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    const scope = buildScope();

    await store.upsertNode({
      id: "task:legacy",
      kind: "task_execution",
      runId: "run-1",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:10.000Z",
      scopes: [scope],
      data: {
        name: "deploy",
        status: "running",
        order: 3,
        kind: "workflow",
        hardFailure: false,
      },
    });
    await store.upsertEdge({
      id: "edge:legacy",
      kind: "run_task",
      from: "run:run-1",
      to: "task:legacy",
      runId: "run-1",
      createdAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:10.000Z",
      scopes: [scope],
      metadata: {
        source: "legacy-runtime",
      },
    });

    expect(await store.getNode("task:legacy")).toMatchObject({
      id: "task:legacy",
      kind: "task",
      scope,
      title: "Task: deploy",
      status: "running",
      order: 3,
    });
    expect(await store.getEdge("edge:legacy")).toMatchObject({
      id: "edge:legacy",
      kind: "contains",
      from: "run:run-1",
      to: "task:legacy",
      runId: "run-1",
    });
    expect(await store.listNodes({ runId: "run-1" })).toHaveLength(1);
    expect(await store.listEdges({ runId: "run-1" })).toHaveLength(1);
  });

  it("fails closed on corrupted JSON rather than silently skipping it", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    const node = buildNode("turn:broken");
    const indexPath = resolve(
      store.paths.nodesDir,
      "_index",
      "turn_broken.json",
    );

    await store.persistNode(node);
    await writeFile(indexPath, "{not-json", "utf8");

    await expect(store.getNode(node.id)).rejects.toThrow(/Failed to read graph record/);
  });

  it("fails closed when the primary node file is missing even if the index still exists", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    const node = buildNode("turn:missing");
    const path = resolveHarnessGraphNodeFilePath(store.paths, node);

    await store.persistNode(node);
    await rm(path, { recursive: true, force: true });

    await expect(store.getNode(node.id)).rejects.toThrow(/missing primary node file/i);
  });

  it("fails closed when listing records and a primary node or edge file is missing", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    const node = buildNode("turn:list-missing");
    const edge = buildEdge("edge:list-missing", {
      from: node.id,
      to: "task:list-missing",
      kind: "references",
    });
    const nodePath = resolveHarnessGraphNodeFilePath(store.paths, node);
    const edgePath = resolveHarnessGraphEdgeFilePath(store.paths, edge);

    await store.persistNode(node);
    await store.persistEdge(edge);
    await rm(nodePath, { recursive: true, force: true });
    await rm(edgePath, { recursive: true, force: true });

    await expect(store.listNodes({ scopes: [buildScope()] })).rejects.toThrow(
      /missing primary node file/i,
    );
    await expect(store.getEdge(edge.id)).rejects.toThrow(/missing primary edge file/i);
    await expect(store.listEdges({ scopes: [buildScope()] })).rejects.toThrow(
      /missing primary edge file/i,
    );
  });
});

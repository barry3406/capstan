import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildGraphContextBlocks,
  createHarnessGraphStore,
  listGraphNeighbors,
  queryHarnessGraph,
} from "../../packages/ai/src/harness/graph/index.ts";
import type {
  HarnessGraphEdgeRecord,
  HarnessGraphNodeRecord,
  HarnessGraphScope,
} from "../../packages/ai/src/harness/graph/index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-graph-retrieval-"));
  tempDirs.push(dir);
  return dir;
}

function scope(): HarnessGraphScope {
  return { kind: "run", runId: "run-1" };
}

function node(
  id: string,
  title: string,
  updatedAt: string,
  patch: Partial<HarnessGraphNodeRecord> = {},
): HarnessGraphNodeRecord {
  return {
    id,
    kind: patch.kind ?? "turn",
    scope: patch.scope ?? scope(),
    title,
    createdAt: patch.createdAt ?? updatedAt,
    updatedAt,
    runId: patch.runId,
    status: patch.status,
    summary: patch.summary,
    content: patch.content,
    order: patch.order,
    metadata: patch.metadata,
  };
}

function edge(from: string, to: string, kind: HarnessGraphEdgeRecord["kind"] = "references"): HarnessGraphEdgeRecord {
  return {
    id: `${kind}:${from}->${to}`,
    kind,
    scope: scope(),
    from,
    to,
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
  };
}

describe("graph retrieval", () => {
  it("ranks exact text matches above stale or unrelated nodes and exposes graph context blocks", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);

    await store.persistNode(
      node("node-old", "Deploy release", "2026-04-03T00:00:00.000Z", {
        summary: "ship the release",
        content: "release release deploy",
      }),
    );
    await store.persistNode(
      node("node-new", "Deploy release", "2026-04-03T00:10:00.000Z", {
        summary: "ship the release",
        content: "release deploy",
      }),
    );
    await store.persistNode(
      node("node-unrelated", "Housekeeping", "2026-04-03T00:20:00.000Z", {
        summary: "misc note",
        content: "internal cleanup",
      }),
    );

    const ranked = await queryHarnessGraph(store, {
      text: "deploy release",
      scopes: [scope()],
      limit: 3,
    });

    expect(ranked.map((item) => item.id)).toEqual([
      "node-new",
      "node-old",
      "node-unrelated",
    ]);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    expect(ranked[0]!.matchedFields).toContain("title");

    const blocks = buildGraphContextBlocks(ranked.slice(0, 2));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("graph");
    expect(blocks[0]!.content).toContain("Deploy release");
    expect(blocks[0]!.tokens).toBeGreaterThan(0);
  });

  it("uses graph adjacency for related-node boosts and neighbor lookup", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);

    await store.persistNode(node("run:1", "Run", "2026-04-03T00:00:00.000Z", { kind: "run" }));
    await store.persistNode(node("task:1", "Task", "2026-04-03T00:00:01.000Z", { kind: "task", status: "running" }));
    await store.persistNode(node("artifact:1", "Artifact", "2026-04-03T00:00:02.000Z", { kind: "artifact", status: "available" }));
    await store.persistNode(node("isolated:1", "Isolated", "2026-04-03T00:00:03.000Z", { kind: "memory" }));
    await store.persistEdge(edge("run:1", "task:1", "contains"));
    await store.persistEdge(edge("task:1", "artifact:1", "generates"));

    const ranked = await queryHarnessGraph(store, {
      text: "",
      relatedTo: "run:1",
      scopes: [scope()],
      limit: 3,
    });

    expect(ranked[0]!.id).toBe("run:1");
    expect(ranked[1]!.id).toBe("task:1");
    expect(ranked.map((item) => item.id)).not.toContain("isolated:1");

    const neighbors = await listGraphNeighbors(store, "task:1", { scopes: [scope()] });
    expect(neighbors.map((item) => item.id)).toEqual(["artifact:1", "run:1"]);
  });

  it("honors minScore cutoffs and scope filtering", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);

    await store.persistNode(node("run:1", "Run", "2026-04-03T00:00:00.000Z", { kind: "run" }));
    await store.persistNode(node("run:2", "Run", "2026-04-03T00:00:00.000Z", {
      kind: "run",
      scope: { kind: "run", runId: "run-2" },
    }));

    const cutoff = await queryHarnessGraph(store, {
      text: "completely unrelated query",
      scopes: [scope()],
      minScore: 0.5,
    });

    expect(cutoff).toEqual([]);
  });
});

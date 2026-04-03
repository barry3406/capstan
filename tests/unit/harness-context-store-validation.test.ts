import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type {
  HarnessMemoryRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
} from "../../packages/ai/src/harness/types.ts";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-context-store-validation-"));
  tempDirs.push(dir);
  return dir;
}

function buildSessionMemoryRecord(
  runId: string,
  overrides: Partial<HarnessSessionMemoryRecord> = {},
): HarnessSessionMemoryRecord {
  const now = "2026-04-03T12:00:00.000Z";
  return {
    runId,
    goal: `goal:${runId}`,
    status: "running",
    updatedAt: now,
    sourceRunUpdatedAt: now,
    headline: "session headline",
    currentPhase: "reasoning",
    recentSteps: ["step-a", "step-b"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    compactedMessages: 0,
    tokenEstimate: 12,
    ...overrides,
  };
}

function buildSummaryRecord(
  runId: string,
  overrides: Partial<HarnessSummaryRecord> = {},
): HarnessSummaryRecord {
  const now = "2026-04-03T12:00:00.000Z";
  return {
    id: `summary_${runId}`,
    runId,
    createdAt: now,
    updatedAt: now,
    sourceRunUpdatedAt: now,
    kind: "run_compact",
    status: "completed",
    headline: "summary headline",
    completedSteps: ["step-a"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    iterations: 2,
    toolCalls: 1,
    messageCount: 5,
    compactedMessages: 1,
    ...overrides,
  };
}

describe("FileHarnessRuntimeStore context validation", () => {
  it("rejects invalid session memory records loaded from disk", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await writeFile(
      join(store.paths.sessionMemoryDir, "run-a.json"),
      JSON.stringify({
        runId: "run-a",
        goal: "goal",
        status: "running",
        updatedAt: "2026-04-03T12:00:00.000Z",
        sourceRunUpdatedAt: "2026-04-03T12:00:00.000Z",
        headline: "bad record",
        currentPhase: "reasoning",
        recentSteps: "not-an-array",
        blockers: [],
        openQuestions: [],
        artifactRefs: [],
        compactedMessages: 0,
        tokenEstimate: 12,
      }),
      "utf8",
    );

    await expect(store.getSessionMemory("run-a")).rejects.toThrow(
      "Harness run run-a session memory is invalid: recentSteps must be a string array",
    );
  });

  it("rejects invalid summary records loaded from disk", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await writeFile(
      join(store.paths.summariesDir, "run-a.json"),
      JSON.stringify({
        id: "summary_run-a",
        runId: "run-a",
        createdAt: "2026-04-03T12:00:00.000Z",
        updatedAt: "2026-04-03T12:00:00.000Z",
        sourceRunUpdatedAt: "2026-04-03T12:00:00.000Z",
        kind: "run_compact",
        status: "completed",
        headline: "bad summary",
        completedSteps: "not-an-array",
        blockers: [],
        openQuestions: [],
        artifactRefs: [],
        iterations: 2,
        toolCalls: 1,
        messageCount: 5,
        compactedMessages: 1,
      }),
      "utf8",
    );

    await expect(store.getLatestSummary("run-a")).rejects.toThrow(
      "Harness run run-a summary is invalid: completedSteps must be a string array",
    );
  });

  it("lists summaries in descending updatedAt order", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await store.persistSummary(
      buildSummaryRecord("run-old", {
        updatedAt: "2026-04-03T10:00:00.000Z",
      }),
    );
    await store.persistSummary(
      buildSummaryRecord("run-new", {
        updatedAt: "2026-04-03T11:00:00.000Z",
      }),
    );

    const listed = await store.listSummaries();
    expect(listed.map((record) => record.runId)).toEqual(["run-new", "run-old"]);
  });

  it("preserves previous memory metadata when deduplicating without replacement metadata", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const original = await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      runId: "run-a",
      kind: "fact",
      importance: "high",
      metadata: {
        source: "initial",
        tags: ["a", "b"],
      },
      content: "Context kernel stays deterministic",
    });

    const deduped = await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      kind: "fact",
      content: "context   kernel stays deterministic",
    });

    expect(deduped.id).toBe(original.id);
    expect(deduped.metadata).toEqual({
      source: "initial",
      tags: ["a", "b"],
    });
    expect(deduped.importance).toBe("high");
    expect(deduped.runId).toBe("run-a");
  });

  it("replaces memory metadata and source fields when deduplicating with new values", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const original = await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      runId: "run-a",
      kind: "summary",
      sourceSummaryId: "summary-run-a",
      metadata: {
        source: "initial",
      },
      content: "Graph-native runtime summary",
    });

    const updated = await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      runId: "run-b",
      kind: "summary",
      sourceSummaryId: "summary-run-b",
      metadata: {
        source: "replacement",
      },
      content: "graph-native   runtime summary",
    });

    expect(updated.id).toBe(original.id);
    expect(updated.runId).toBe("run-b");
    expect(updated.sourceSummaryId).toBe("summary-run-b");
    expect(updated.metadata).toEqual({
      source: "replacement",
    });
  });

  it("recalls across all scopes when no scope filter is provided", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      kind: "fact",
      content: "Project memory about deterministic context assembly",
    });
    await store.rememberMemory({
      scope: { type: "run", id: "run-2" },
      kind: "observation",
      content: "Run memory about deterministic replay",
    });

    const recalled = await store.recallMemory({
      query: "deterministic",
      limit: 10,
    });

    expect(recalled).toHaveLength(2);
    expect(recalled.map((record) => record.scope.type).sort()).toEqual([
      "project",
      "run",
    ]);
  });

  it("returns full text previews when the artifact is within the preview budget", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const artifact = await store.writeArtifact("run-preview", {
      kind: "note",
      content: "short preview",
      extension: ".txt",
      mimeType: "text/plain",
    });

    await expect(store.readArtifactPreview(artifact, 40)).resolves.toBe(
      "short preview",
    );
  });

  it("round-trips persisted session memory bytes exactly", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const record = buildSessionMemoryRecord("run-bytes", {
      blockers: ["approval required"],
      openQuestions: ["should we continue?"],
    });
    await store.persistSessionMemory(record);

    const source = await readFile(
      join(store.paths.sessionMemoryDir, "run-bytes.json"),
      "utf8",
    );
    expect(JSON.parse(source)).toEqual(record);
  });

  it("touches recalled memory records in place on disk", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const memory = await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      content: "Context assembly prefers session memory first",
    });

    const recalled = await store.recallMemory({
      query: "session memory",
      scopes: [{ type: "project", id: "capstan" }],
      limit: 1,
    });
    expect(recalled[0]?.accessCount).toBe(1);

    const scopeDir = join(store.paths.memoryDir, "project__capstan");
    const source = await readFile(join(scopeDir, `${memory.id}.json`), "utf8");
    const persisted = JSON.parse(source) as HarnessMemoryRecord;
    expect(persisted.accessCount).toBe(1);
    expect(persisted.lastAccessedAt).toBeString();
  });
});

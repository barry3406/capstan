import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FileHarnessRuntimeStore } from "@zauso-ai/capstan-ai";
import type {
  HarnessRunRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
} from "@zauso-ai/capstan-ai";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-context-store-"));
  tempDirs.push(dir);
  return dir;
}

function buildRunRecord(
  runId: string,
  overrides: Partial<HarnessRunRecord> = {},
): HarnessRunRecord {
  const now = new Date().toISOString();
  return {
    id: runId,
    goal: "test context kernel",
    status: "running",
    createdAt: now,
    updatedAt: now,
    iterations: 0,
    toolCalls: 0,
    taskCalls: 0,
    maxIterations: 10,
    toolNames: [],
    taskNames: [],
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: "local",
      mode: "test",
      browser: false,
      fs: false,
      artifactDir: "/tmp/artifacts",
    },
    lastEventSequence: 0,
    ...overrides,
  };
}

function buildSessionMemoryRecord(
  runId: string,
  overrides: Partial<HarnessSessionMemoryRecord> = {},
): HarnessSessionMemoryRecord {
  const now = new Date().toISOString();
  return {
    runId,
    goal: "test context kernel",
    status: "running",
    updatedAt: now,
    sourceRunUpdatedAt: now,
    headline: "Runtime is reasoning",
    currentPhase: "reasoning",
    recentSteps: ["step-one"],
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
  const now = new Date().toISOString();
  return {
    id: `summary_${runId}`,
    runId,
    createdAt: now,
    updatedAt: now,
    sourceRunUpdatedAt: now,
    kind: "run_compact",
    status: "completed",
    headline: "run complete",
    completedSteps: ["did the thing"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    iterations: 2,
    toolCalls: 1,
    messageCount: 4,
    compactedMessages: 2,
    ...overrides,
  };
}

describe("FileHarnessRuntimeStore context persistence", () => {
  it("persists and reloads session memory round-trip", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const record = buildSessionMemoryRecord("run-1", {
      blockers: ["need approval"],
      openQuestions: ["should we continue?"],
      compactedMessages: 3,
    });

    await store.persistSessionMemory(record);

    const loaded = await store.getSessionMemory("run-1");
    expect(loaded).toEqual(record);
  });

  it("returns undefined when session memory is missing", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    expect(await store.getSessionMemory("missing-run")).toBeUndefined();
  });

  it("persists summaries and lists them globally and by run", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const summaryA = buildSummaryRecord("run-a", { headline: "A headline" });
    const summaryB = buildSummaryRecord("run-b", { headline: "B headline" });

    await store.persistSummary(summaryA);
    await store.persistSummary(summaryB);

    const latestA = await store.getLatestSummary("run-a");
    expect(latestA).toEqual(summaryA);

    const scoped = await store.listSummaries("run-b");
    expect(scoped).toEqual([summaryB]);

    const listed = await store.listSummaries();
    expect(listed).toHaveLength(2);
    expect(listed.map((entry) => entry.runId).sort()).toEqual(["run-a", "run-b"]);
  });

  it("updates an existing summary for the same run", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const original = buildSummaryRecord("run-1", {
      updatedAt: "2026-04-03T10:00:00.000Z",
      headline: "first summary",
    });
    const updated = buildSummaryRecord("run-1", {
      updatedAt: "2026-04-03T11:00:00.000Z",
      headline: "second summary",
    });

    await store.persistSummary(original);
    await store.persistSummary(updated);

    const listed = await store.listSummaries("run-1");
    expect(listed).toEqual([updated]);
  });

  it("deduplicates identical memories within the same scope and kind", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const first = await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      kind: "fact",
      content: "  Build uses Bun  ",
    });
    const second = await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      kind: "fact",
      content: "build   uses bun",
    });

    expect(second.id).toBe(first.id);

    const recalled = await store.recallMemory({
      query: "build bun",
      scopes: [{ type: "project", id: "capstan" }],
      limit: 10,
    });
    expect(recalled).toHaveLength(1);
    expect(recalled[0]!.content).toBe("build   uses bun");
    expect(recalled[0]!.accessCount).toBe(1);
  });

  it("does not deduplicate across different scopes or kinds", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const fact = await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      kind: "fact",
      content: "shared content",
    });
    const observation = await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      kind: "observation",
      content: "shared content",
    });
    const otherScope = await store.rememberMemory({
      scope: { type: "run", id: "run-42" },
      kind: "fact",
      content: "shared content",
    });

    expect(observation.id).not.toBe(fact.id);
    expect(otherScope.id).not.toBe(fact.id);
    expect(otherScope.id).not.toBe(observation.id);
  });

  it("rejects empty memory content", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await expect(
      store.rememberMemory({
        scope: { type: "project", id: "capstan" },
        content: "   ",
      }),
    ).rejects.toThrow("Harness memory content must be a non-empty string");
  });

  it("recallMemory filters by scope, runId, kind, and minScore", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      runId: "run-a",
      kind: "fact",
      content: "Bun build uses a workspace graph",
      importance: "high",
    });
    await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      runId: "run-b",
      kind: "observation",
      content: "Playwright screenshot path updated",
    });
    await store.rememberMemory({
      scope: { type: "run", id: "run-a" },
      runId: "run-a",
      kind: "summary",
      content: "Run a summary with bun build details",
    });

    const filtered = await store.recallMemory({
      query: "bun build",
      scopes: [{ type: "project", id: "capstan" }],
      runId: "run-a",
      kinds: ["fact"],
      limit: 5,
      minScore: 0.5,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.kind).toBe("fact");
    expect(filtered[0]!.runId).toBe("run-a");
  });

  it("increments access counts on repeated recall", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      content: "Context kernels should stay deterministic",
    });

    await store.recallMemory({
      query: "context kernels",
      scopes: [{ type: "project", id: "capstan" }],
      limit: 5,
    });
    const second = await store.recallMemory({
      query: "context kernels",
      scopes: [{ type: "project", id: "capstan" }],
      limit: 5,
    });

    expect(second).toHaveLength(1);
    expect(second[0]!.accessCount).toBe(2);
  });

  it("returns an empty recall result for unmatched queries", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await store.rememberMemory({
      scope: { type: "project", id: "capstan" },
      content: "hello world",
    });

    const results = await store.recallMemory({
      query: "nonexistent token",
      scopes: [{ type: "project", id: "capstan" }],
      limit: 5,
      minScore: 0.9,
    });

    expect(results).toEqual([]);
  });

  it("reads text artifact previews and truncates long payloads", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await store.persistRun(buildRunRecord("run-1"));

    const artifact = await store.writeArtifact("run-1", {
      kind: "note",
      content: "A".repeat(260),
      extension: ".txt",
      mimeType: "text/plain",
    });

    const preview = await store.readArtifactPreview(artifact, 80);
    expect(preview).toBeDefined();
    expect(preview).toContain("... (truncated)");
    expect(preview!.length).toBeGreaterThan(80);
  });

  it("returns undefined preview for binary artifacts and missing payloads", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    await store.persistRun(buildRunRecord("run-1"));

    const screenshot = await store.writeArtifact("run-1", {
      kind: "screenshot",
      content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      extension: ".png",
      mimeType: "image/png",
    });
    const textArtifact = await store.writeArtifact("run-1", {
      kind: "note",
      content: "preview me",
      extension: ".txt",
      mimeType: "text/plain",
    });

    expect(await store.readArtifactPreview(screenshot, 50)).toBeUndefined();

    await rm(textArtifact.path, { force: true });
    expect(await store.readArtifactPreview(textArtifact, 50)).toBeUndefined();
  });

  it("stores memory records under sanitized scope directories", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const record = await store.rememberMemory({
      scope: { type: "Project Scope", id: "Capstan Repo" },
      kind: "fact",
      content: "store me on disk",
    });

    const recalled = await store.recallMemory({
      query: "store me",
      scopes: [{ type: "Project Scope", id: "Capstan Repo" }],
      limit: 5,
    });

    expect(recalled.map((entry) => entry.id)).toContain(record.id);
  });
});

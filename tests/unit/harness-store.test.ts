import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

import type { AgentLoopCheckpoint } from "../../packages/ai/src/types.ts";
import type {
  HarnessRunEventRecord,
  HarnessRunRecord,
} from "../../packages/ai/src/harness/types.ts";
import {
  FileHarnessRuntimeStore,
  buildHarnessRuntimePaths,
} from "../../packages/ai/src/harness/runtime/store.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-store-"));
  tempDirs.push(dir);
  return dir;
}

function createRun(
  id: string,
  patch: Partial<HarnessRunRecord> = {},
): HarnessRunRecord {
  return {
    id,
    goal: `goal:${id}`,
    status: "running",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    iterations: 0,
    toolCalls: 0,
    maxIterations: 5,
    toolNames: [],
    artifactIds: [],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: false,
      artifactDir: `/artifacts/${id}`,
    },
    lastEventSequence: 0,
    ...patch,
  };
}

function createCheckpoint(
  patch: Partial<AgentLoopCheckpoint> = {},
): AgentLoopCheckpoint {
  return {
    stage: "initialized",
    config: {
      goal: "checkpoint goal",
      maxIterations: 3,
    },
    messages: [{ role: "user", content: "hello" }],
    iterations: 0,
    toolCalls: [],
    ...patch,
  };
}

describe("FileHarnessRuntimeStore", () => {
  it("buildHarnessRuntimePaths resolves every runtime directory under .capstan/harness", () => {
    const paths = buildHarnessRuntimePaths("/tmp/capstan-root");

    expect(paths.rootDir).toBe("/tmp/capstan-root/.capstan/harness");
    expect(paths.runsDir).toBe("/tmp/capstan-root/.capstan/harness/runs");
    expect(paths.eventsDir).toBe("/tmp/capstan-root/.capstan/harness/events");
    expect(paths.globalEventsPath).toBe(
      "/tmp/capstan-root/.capstan/harness/events.ndjson",
    );
    expect(paths.artifactsDir).toBe("/tmp/capstan-root/.capstan/harness/artifacts");
    expect(paths.checkpointsDir).toBe(
      "/tmp/capstan-root/.capstan/harness/checkpoints",
    );
    expect(paths.sandboxesDir).toBe("/tmp/capstan-root/.capstan/harness/sandboxes");
  });

  it("initialize creates all runtime directories eagerly", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);

    await store.initialize();

    const paths = store.paths;
    expect((await stat(paths.runsDir)).isDirectory()).toBe(true);
    expect((await stat(paths.eventsDir)).isDirectory()).toBe(true);
    expect((await stat(paths.artifactsDir)).isDirectory()).toBe(true);
    expect((await stat(paths.checkpointsDir)).isDirectory()).toBe(true);
    expect((await stat(paths.sandboxesDir)).isDirectory()).toBe(true);
  });

  it("persists runs and lists them newest-first by updatedAt", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);

    await store.persistRun(
      createRun("older-run", { updatedAt: "2026-04-03T00:00:00.000Z" }),
    );
    await store.persistRun(
      createRun("newer-run", { updatedAt: "2026-04-03T00:00:10.000Z" }),
    );

    const listed = await store.listRuns();

    expect(listed.map((run) => run.id)).toEqual(["newer-run", "older-run"]);
    expect((await store.getRun("older-run"))?.goal).toBe("goal:older-run");
    expect(await store.getRun("missing-run")).toBeUndefined();
  });

  it("persists and loads checkpoints losslessly", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(createRun("run-a"));

    const checkpoint = createCheckpoint({
      stage: "approval_required",
      iterations: 2,
      pendingToolCall: {
        assistantMessage: "{\"tool\":\"delete\"}",
        tool: "delete",
        args: { id: "123" },
      },
      lastAssistantResponse: "{\"tool\":\"delete\"}",
    });

    const record = await store.persistCheckpoint("run-a", checkpoint);

    expect(record.runId).toBe("run-a");
    expect(record.checkpoint).toEqual(checkpoint);
    expect((await store.getCheckpoint("run-a"))?.checkpoint).toEqual(checkpoint);
    expect(await store.getCheckpoint("missing-run")).toBeUndefined();
  });

  it("appends per-run and global events and sorts global reads consistently", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(createRun("run-a"));
    await store.persistRun(createRun("run-b"));

    const events: HarnessRunEventRecord[] = [
      {
        id: "evt-2",
        runId: "run-b",
        sequence: 1,
        type: "run_started",
        timestamp: 200,
        data: {},
      },
      {
        id: "evt-1",
        runId: "run-a",
        sequence: 1,
        type: "run_started",
        timestamp: 100,
        data: {},
      },
      {
        id: "evt-3",
        runId: "run-b",
        sequence: 2,
        type: "run_completed",
        timestamp: 250,
        data: { iterations: 1 },
      },
    ];

    for (const event of events) {
      await store.appendEvent(event);
    }

    expect((await store.getEvents("run-b")).map((event) => event.id)).toEqual([
      "evt-2",
      "evt-3",
    ]);
    expect((await store.getEvents()).map((event) => event.id)).toEqual([
      "evt-1",
      "evt-2",
      "evt-3",
    ]);
    expect(await store.getEvents("missing-run")).toEqual([]);
  });

  it("requestPause moves running runs into pause_requested and is idempotent", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(createRun("run-a"));

    const first = await store.requestPause("run-a");
    const second = await store.requestPause("run-a");

    expect(first.status).toBe("pause_requested");
    expect(first.control?.pauseRequestedAt).toBeString();
    expect(second).toEqual(first);

    const events = await store.getEvents("run-a");
    expect(events.map((event) => event.type)).toEqual(["pause_requested"]);
  });

  it("requestPause rejects terminal or non-running statuses", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(createRun("done-run", { status: "completed" }));

    await expect(store.requestPause("done-run")).rejects.toThrow(
      "Cannot pause run done-run from status completed",
    );
  });

  it("requestCancel turns paused or approval-blocked runs into terminal canceled runs", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(
      createRun("paused-run", {
        status: "paused",
        pendingApproval: {
          tool: "delete",
          args: { id: "123" },
          reason: "needs approval",
          requestedAt: "2026-04-03T00:00:00.000Z",
        },
      }),
    );

    const canceled = await store.requestCancel("paused-run");

    expect(canceled.status).toBe("canceled");
    expect(canceled.pendingApproval).toBeUndefined();
    expect(canceled.control?.cancelRequestedAt).toBeString();

    const events = await store.getEvents("paused-run");
    expect(events.map((event) => event.type)).toEqual(["run_canceled"]);
  });

  it("requestCancel moves active runs into cancel_requested and stays idempotent", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(createRun("run-a"));

    const first = await store.requestCancel("run-a");
    const second = await store.requestCancel("run-a");

    expect(first.status).toBe("cancel_requested");
    expect(first.control?.cancelRequestedAt).toBeString();
    expect(second).toEqual(first);

    const events = await store.getEvents("run-a");
    expect(events.map((event) => event.type)).toEqual(["cancel_requested"]);
  });

  it("requestCancel rejects terminal states that cannot transition", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(createRun("failed-run", { status: "failed" }));

    await expect(store.requestCancel("failed-run")).rejects.toThrow(
      "Cannot cancel run failed-run from status failed",
    );
  });

  it("writeArtifact persists string content with sanitized filenames and metadata", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);

    const artifact = await store.writeArtifact("run-a", {
      kind: "report",
      filename: "Sprint Report!!!",
      content: "hello world",
      metadata: { section: "summary" },
    });

    expect(artifact.kind).toBe("report");
    expect(artifact.mimeType).toBe("text/plain");
    expect(artifact.size).toBe(11);
    expect(artifact.path).toContain("sprint-report");
    expect(artifact.metadata).toEqual({ section: "summary" });
    expect(await readFile(artifact.path, "utf8")).toBe("hello world");
  });

  it("writeArtifact normalizes Uint8Array and object payloads with correct default mime types", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);

    const binary = await store.writeArtifact("run-a", {
      kind: "screenshot",
      content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const json = await store.writeArtifact("run-a", {
      kind: "json",
      content: { ok: true, count: 2 },
    });

    expect(binary.mimeType).toBe("image/png");
    expect(binary.path.endsWith(".png")).toBe(true);
    expect(await readFile(binary.path)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    expect(json.mimeType).toBe("application/json");
    expect(json.path.endsWith(".json")).toBe(true);
    expect(JSON.parse(await readFile(json.path, "utf8"))).toEqual({
      ok: true,
      count: 2,
    });
  });

  it("getArtifacts returns all persisted artifact index entries for a run", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);

    await store.writeArtifact("run-a", { kind: "text", content: "one" });
    await store.writeArtifact("run-a", { kind: "text", content: "two" });

    const artifacts = await store.getArtifacts("run-a");
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((artifact) => artifact.kind)).toEqual(["text", "text"]);
  });

  it("clearRunArtifacts removes artifact payload files and tolerates repeated cleanup", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);

    const artifact = await store.writeArtifact("run-a", {
      kind: "report",
      content: "temporary",
    });

    await store.clearRunArtifacts("run-a");
    await store.clearRunArtifacts("run-a");

    await expect(stat(artifact.path)).rejects.toThrow();
  });

  it("replayRun reports mismatches when stored state diverges from the event log", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);

    await store.persistRun(
      createRun("run-a", {
        status: "completed",
        iterations: 99,
        toolCalls: 8,
        artifactIds: ["artifact-a"],
      }),
    );
    await store.appendEvent({
      id: "evt-1",
      runId: "run-a",
      sequence: 1,
      type: "run_started",
      timestamp: 100,
      data: {},
    });
    await store.appendEvent({
      id: "evt-2",
      runId: "run-a",
      sequence: 2,
      type: "tool_call",
      timestamp: 101,
      data: {},
    });
    await store.appendEvent({
      id: "evt-3",
      runId: "run-a",
      sequence: 3,
      type: "run_canceled",
      timestamp: 102,
      data: { iterations: 1 },
    });

    const replay = await store.replayRun("run-a");

    expect(replay.consistent).toBe(false);
    expect(replay.storedStatus).toBe("completed");
    expect(replay.derivedStatus).toBe("canceled");
    expect(replay.storedIterations).toBe(99);
    expect(replay.derivedIterations).toBe(1);
    expect(replay.storedToolCalls).toBe(8);
    expect(replay.derivedToolCalls).toBe(0);
    expect(replay.storedArtifactCount).toBe(1);
    expect(replay.derivedArtifactCount).toBe(0);
  });

  it("throws on unsafe run identifiers across run-scoped operations", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);

    await expect(store.getRun("../escape")).rejects.toThrow("Invalid harness run id");
    await expect(store.getEvents("../escape")).rejects.toThrow("Invalid harness run id");
    await expect(store.getArtifacts("../escape")).rejects.toThrow(
      "Invalid harness run id",
    );
    await expect(store.getCheckpoint("../escape")).rejects.toThrow(
      "Invalid harness run id",
    );
    await expect(store.replayRun("../escape")).rejects.toThrow(
      "Invalid harness run id",
    );
  });

  it("surfaces corrupted persisted JSON instead of silently swallowing it", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();
    await writeFile(join(store.paths.runsDir, "run-a.json"), "{bad json\n", "utf8");

    await expect(store.getRun("run-a")).rejects.toThrow();
  });

  it("surfaces corrupted NDJSON event logs instead of silently swallowing them", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();
    await mkdir(store.paths.eventsDir, { recursive: true });
    await writeFile(join(store.paths.eventsDir, "run-a.ndjson"), "not-json\n", "utf8");

    await expect(store.getEvents("run-a")).rejects.toThrow();
  });
});

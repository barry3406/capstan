import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  FileHarnessRuntimeStore,
  openHarnessRuntime,
} from "@zauso-ai/capstan-ai";
import type { HarnessRunRecord } from "@zauso-ai/capstan-ai";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-graph-faults-"));
  tempDirs.push(dir);
  return dir;
}

function createRun(id: string, patch: Partial<HarnessRunRecord> = {}): HarnessRunRecord {
  return {
    id,
    goal: `goal:${id}`,
    status: "running",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    iterations: 0,
    toolCalls: 0,
    taskCalls: 0,
    maxIterations: 5,
    toolNames: [],
    taskNames: [],
    artifactIds: [],
    taskIds: [],
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

describe("harness graph faults", () => {
  it("fails closed on corrupted graph node files for checkpoints, tasks, approvals, and events", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();
    await store.persistRun(createRun("run-a"));

    await writeFile(
      join(store.paths.checkpointsDir, "run-a.json"),
      "{broken checkpoint\n",
      "utf8",
    );
    await mkdir(join(store.paths.tasksDir, "run-a"), { recursive: true });
    await writeFile(
      join(store.paths.tasksDir, "run-a", "task-a.json"),
      "{broken task\n",
      "utf8",
    );
    await writeFile(
      join(store.paths.approvalsDir, "approval-a.json"),
      "{broken approval\n",
      "utf8",
    );
    await writeFile(
      join(store.paths.eventsDir, "run-a.ndjson"),
      "{broken event\n",
      "utf8",
    );

    const runtime = await openHarnessRuntime(rootDir);
    await expect(runtime.getCheckpoint("run-a")).rejects.toThrow();
    await expect(runtime.getTasks("run-a")).rejects.toThrow();
    await expect(runtime.getApproval("approval-a")).rejects.toThrow();
    await expect(runtime.getEvents("run-a")).rejects.toThrow();
    await expect(runtime.replayRun("run-a")).rejects.toThrow();
  });

  it("reports graph replay inconsistency when stored counts drift from the event log", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();
    await store.persistRun(
      createRun("run-drift", {
        status: "completed",
        iterations: 0,
        toolCalls: 0,
        taskCalls: 0,
        artifactIds: [],
      }),
    );
    await store.appendEvent({
      id: "evt-1",
      runId: "run-drift",
      sequence: 1,
      type: "run_started",
      timestamp: 1,
      data: { runId: "run-drift" },
    });
    await store.appendEvent({
      id: "evt-2",
      runId: "run-drift",
      sequence: 2,
      type: "tool_result",
      timestamp: 2,
      data: { tool: "lookup", result: { ok: true } },
    });
    await store.appendEvent({
      id: "evt-3",
      runId: "run-drift",
      sequence: 3,
      type: "task_result",
      timestamp: 3,
      data: { task: "build-report", result: { ok: true } },
    });
    await store.appendEvent({
      id: "evt-4",
      runId: "run-drift",
      sequence: 4,
      type: "artifact_created",
      timestamp: 4,
      data: { artifactId: "artifact-1" },
    });
    await store.appendEvent({
      id: "evt-5",
      runId: "run-drift",
      sequence: 5,
      type: "run_completed",
      timestamp: 5,
      data: { iterations: 1 },
    });

    const report = await store.replayRun("run-drift");
    expect(report.consistent).toBe(false);
    expect(report.derivedStatus).toBe("completed");
    expect(report.derivedToolCalls).toBe(1);
    expect(report.derivedTaskCalls).toBe(1);
    expect(report.derivedArtifactCount).toBe(1);
    expect(report.storedToolCalls).toBe(0);
    expect(report.storedTaskCalls).toBe(0);
    expect(report.storedArtifactCount).toBe(0);
  });

  it("rejects malformed memory graph nodes instead of silently skipping them", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();
    await mkdir(join(store.paths.memoryDir, "run__run-a"), { recursive: true });
    await writeFile(
      join(store.paths.memoryDir, "run__run-a", "mem-a.json"),
      JSON.stringify({
        id: "mem-a",
        scope: { type: "run", id: "run-a" },
        kind: "observation",
        content: "graph node",
        createdAt: "2026-04-03T00:00:00.000Z",
        updatedAt: "2026-04-03T00:00:00.000Z",
        accessCount: -1,
        lastAccessedAt: "2026-04-03T00:00:00.000Z",
      }),
      "utf8",
    );

    await expect(
      store.recallMemory({
        query: "graph node",
        scopes: [{ type: "run", id: "run-a" }],
        limit: 5,
      }),
    ).rejects.toThrow("Harness memory record mem-a is invalid: accessCount");
  });
});

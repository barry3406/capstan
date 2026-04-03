import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AgentLoopCheckpoint } from "../../packages/ai/src/types.ts";
import { openHarnessRuntime } from "../../packages/ai/src/harness/runtime/control-plane.ts";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-control-"));
  tempDirs.push(dir);
  return dir;
}

function baseRun(id: string) {
  return {
    id,
    goal: `goal:${id}`,
    status: "running" as const,
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
  };
}

describe("openHarnessRuntime", () => {
  it("returns empty collections and resolved paths for a new runtime root", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);

    expect(await runtime.listRuns()).toEqual([]);
    expect(await runtime.getEvents()).toEqual([]);
    expect(runtime.getPaths().rootDir).toContain(".capstan/harness");
  });

  it("reads persisted runs, events, artifacts, and checkpoints through the control plane", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(baseRun("run-a"));

    const checkpoint: AgentLoopCheckpoint = {
      stage: "tool_result",
      config: { goal: "goal:run-a", maxIterations: 5 },
      messages: [{ role: "user", content: "goal" }],
      iterations: 1,
      toolCalls: [{ tool: "noop", args: {}, result: { ok: true } }],
    };

    await store.persistCheckpoint("run-a", checkpoint);
    const artifact = await store.writeArtifact("run-a", {
      kind: "report",
      content: "hello",
    });
    await store.appendEvent({
      id: "evt-1",
      runId: "run-a",
      sequence: 1,
      type: "artifact_created",
      timestamp: 123,
      data: { artifactId: artifact.id },
    });

    const runtime = await openHarnessRuntime(rootDir);

    expect((await runtime.getRun("run-a"))?.goal).toBe("goal:run-a");
    expect(await runtime.getCheckpoint("run-a")).toEqual(checkpoint);
    expect((await runtime.getArtifacts("run-a"))[0]?.id).toBe(artifact.id);
    expect((await runtime.getEvents("run-a")).map((event) => event.type)).toEqual([
      "artifact_created",
    ]);
  });

  it("forwards pause and cancel transitions to the underlying store", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(baseRun("run-a"));
    await store.persistRun({
      ...baseRun("paused-run"),
      status: "paused",
    });

    const runtime = await openHarnessRuntime(rootDir);

    const pauseRequested = await runtime.pauseRun("run-a");
    expect(pauseRequested.status).toBe("pause_requested");

    const canceled = await runtime.cancelRun("paused-run");
    expect(canceled.status).toBe("canceled");
  });
});

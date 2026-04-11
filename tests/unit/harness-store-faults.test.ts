import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { HarnessRunRecord } from "../../packages/ai/src/harness/types.ts";
import { assertValidAgentCheckpoint } from "../../packages/ai/src/harness/runtime/checkpoint.ts";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-store-faults-"));
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

describe("FileHarnessRuntimeStore fault injection", () => {
  it("surfaces partial appendEvent failures when the per-run log write fails after the global log write", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir, {
      mkdir,
      readFile,
      readdir,
      rename,
      unlink,
      async writeFile(path, data, options) {
        if (path.endsWith("/events/run-a.ndjson")) {
          throw new Error("per-run event append failed");
        }
        await writeFile(path, data as string | Uint8Array, options as any);
      },
    });
    await store.persistRun(createRun("run-a"));

    await expect(
      store.appendEvent({
        id: "evt-1",
        runId: "run-a",
        sequence: 1,
        type: "run_started",
        timestamp: 100,
        data: { ok: true },
      }),
    ).rejects.toThrow("per-run event append failed");

    expect(await readFile(store.paths.globalEventsPath, "utf8")).toContain("\"id\":\"evt-1\"");
    await expect(
      readFile(join(store.paths.eventsDir, "run-a.ndjson"), "utf8"),
    ).rejects.toThrow();
  });

  it("surfaces transitionRun persistence failures after appending the event", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(createRun("run-a"));

    let persistAttempts = 0;
    const originalPersistRun = store.persistRun.bind(store);
    store.persistRun = async (run) => {
      persistAttempts++;
      if (persistAttempts > 0) {
        throw new Error("run persistence failed");
      }
      await originalPersistRun(run);
    };

    await expect(
      store.transitionRun(
        "run-a",
        "run_completed",
        { status: "completed", iterations: 1 },
        { iterations: 1 },
      ),
    ).rejects.toThrow("run persistence failed");

    const stillStored = await store.getRun("run-a");
    expect(stillStored?.status).toBe("running");
    expect(stillStored?.lastEventSequence).toBe(0);

    const events = await store.getEvents("run-a");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("run_completed");
    expect(events[0]?.sequence).toBe(1);
  });

  it("surfaces artifact index write failures after the artifact payload is already persisted", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir, {
      mkdir,
      readFile,
      readdir,
      rename,
      unlink,
      async writeFile(path, data, options) {
        if (path.endsWith("/index.ndjson")) {
          throw new Error("artifact index append failed");
        }
        await writeFile(path, data as string | Uint8Array, options as any);
      },
    });

    await expect(
      store.writeArtifact("run-a", {
        kind: "report",
        content: "hello",
      }),
    ).rejects.toThrow("artifact index append failed");

    const artifactDir = join(store.paths.artifactsDir, "run-a");
    const entries = await readdir(artifactDir);
    expect(entries).not.toContain("index.ndjson");
    expect(entries.some((entry) => entry !== "index.ndjson")).toBe(true);
    expect(await readFile(join(artifactDir, entries[0]!), "utf8")).toBe("hello");
  });

  it("rejects corrupted checkpoint JSON instead of returning undefined", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();
    await writeFile(
      join(store.paths.checkpointsDir, "run-a.json"),
      "{bad checkpoint\n",
      "utf8",
    );

    await expect(store.getCheckpoint("run-a")).rejects.toThrow();
  });

  it("rejects structurally invalid checkpoint records loaded from disk", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();
    await writeFile(
      join(store.paths.checkpointsDir, "run-a.json"),
      JSON.stringify({
        runId: "run-a",
        updatedAt: "2026-04-03T00:00:00.000Z",
        checkpoint: {
          stage: "tool_result",
          goal: "bad checkpoint",
          messages: "not-an-array",
          iterations: 1,
          toolCalls: [],
          taskCalls: [],
          maxOutputTokens: 8192,
          compaction: {
            autocompactFailures: 0,
            reactiveCompactRetries: 0,
            tokenEscalations: 0,
          },
        },
      }),
      "utf8",
    );

    await expect(store.getCheckpoint("run-a")).rejects.toThrow(
      "Harness run run-a checkpoint is invalid: messages must be an array",
    );
  });

  it("rejects invalid checkpoint payloads before persisting them", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);

    await expect(
      store.persistCheckpoint("run-a", {
        stage: "tool_result",
        goal: "oops",
        messages: [],
        iterations: -1,
        toolCalls: [],
        taskCalls: [],
        maxOutputTokens: 8192,
        compaction: {
          autocompactFailures: 0,
          reactiveCompactRetries: 0,
          tokenEscalations: 0,
        },
      } as any),
    ).rejects.toThrow(
      "Harness run run-a checkpoint is invalid: iterations must be a non-negative integer",
    );
  });

  it("accepts paused checkpoints with richer message roles for forward-compatible harness resume", () => {
    expect(() =>
      assertValidAgentCheckpoint({
        stage: "paused",
        goal: "resume richer turn engine state",
        messages: [
          { role: "system", content: "system prompt" },
          { role: "tool", content: 'Tool "lookup" returned:\n{"ok":true}' },
        ],
        iterations: 1,
        toolCalls: [{ tool: "lookup", args: { id: "a" }, result: { ok: true } }],
        taskCalls: [],
        maxOutputTokens: 8192,
        compaction: {
          autocompactFailures: 0,
          reactiveCompactRetries: 0,
          tokenEscalations: 0,
        },
      }),
    ).not.toThrow();
  });

  it("still rejects blank message roles in persisted checkpoints", () => {
    expect(() =>
      assertValidAgentCheckpoint({
        stage: "tool_result",
        goal: "invalid role",
        messages: [
          { role: "", content: "bad" },
        ],
        iterations: 0,
        toolCalls: [],
        taskCalls: [],
        maxOutputTokens: 8192,
        compaction: {
          autocompactFailures: 0,
          reactiveCompactRetries: 0,
          tokenEscalations: 0,
        },
      }),
    ).toThrow(
      "Agent loop checkpoint is invalid: messages[0].role must be a non-empty string",
    );
  });
});

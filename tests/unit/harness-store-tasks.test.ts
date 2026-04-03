import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { HarnessTaskRecord } from "../../packages/ai/src/harness/types.ts";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-task-store-"));
  tempDirs.push(dir);
  return dir;
}

function createTask(
  runId: string,
  id: string,
  patch: Partial<HarnessTaskRecord> = {},
): HarnessTaskRecord {
  return {
    id,
    runId,
    requestId: `req-${id}`,
    name: `task-${id}`,
    kind: "workflow",
    order: 0,
    status: "running",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    args: { id },
    hardFailure: false,
    ...patch,
  };
}

describe("FileHarnessRuntimeStore task persistence", () => {
  it("persists, patches, and lists task records in request order", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);

    await store.persistTask(createTask("run-a", "task-2", { order: 2, name: "second" }));
    await store.persistTask(createTask("run-a", "task-1", { order: 1, name: "first" }));
    await store.patchTask("run-a", "task-1", {
      status: "completed",
      result: { ok: true },
    });

    expect(await store.getTasks("run-a")).toEqual([
      expect.objectContaining({
        id: "task-1",
        name: "first",
        order: 1,
        status: "completed",
        result: { ok: true },
      }),
      expect.objectContaining({
        id: "task-2",
        name: "second",
        order: 2,
        status: "running",
      }),
    ]);
  });

  it("rejects invalid task identifiers to prevent path traversal", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);

    await expect(
      store.persistTask(createTask("run-a", "../escape")),
    ).rejects.toThrow("Invalid harness task id");
    await expect(
      store.patchTask("run-a", "../escape", { status: "failed" }),
    ).rejects.toThrow("Invalid harness task id");
  });

  it("rejects corrupted task records loaded from disk", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();
    await mkdir(join(store.paths.tasksDir, "run-a"), { recursive: true });
    await writeFile(
      join(store.paths.tasksDir, "run-a", "bad.json"),
      JSON.stringify({
        id: "bad",
        runId: "run-a",
        requestId: "",
        name: "oops",
        kind: "workflow",
        order: 0,
        status: "running",
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z",
        args: {},
        hardFailure: false,
      }),
      "utf8",
    );

    await expect(store.getTasks("run-a")).rejects.toThrow(
      'Harness run run-a task record is invalid: requestId must be a non-empty string',
    );
  });
});

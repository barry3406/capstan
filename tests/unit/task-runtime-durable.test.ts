import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  DurableAgentTaskRuntime,
} from "../../packages/ai/src/task/runtime.ts";
import type {
  AgentTask,
  AgentTaskWorker,
} from "../../packages/ai/src/index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-task-runtime-durable-"));
  tempDirs.push(dir);
  return dir;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

describe("DurableAgentTaskRuntime", () => {
  it("persists task records and mailbox notifications to disk", async () => {
    const rootDir = await createTempDir();
    const runtime = new DurableAgentTaskRuntime({ rootDir });

    try {
      const task: AgentTask = {
        name: "deploy",
        description: "deploys code",
        kind: "workflow",
        async execute(args) {
          return { ok: true, version: args.version };
        },
      };

      const submitted = await runtime.submitBatch({
        runId: "run-a",
        requests: [{ id: "req-1", name: "deploy", args: { version: "v1" }, order: 0 }],
        tasks: [task],
      });

      const notification = await runtime.nextNotification("run-a", { timeoutMs: 200 });
      expect(notification).toEqual(
        expect.objectContaining({
          status: "completed",
          result: { ok: true, version: "v1" },
        }),
      );

      const recordPath = resolve(rootDir, "run-a", "records", `${submitted.records[0]!.id}.json`);
      const persistedRecord = await readJson<{
        status: string;
        result?: unknown;
      }>(recordPath);
      expect(persistedRecord).toMatchObject({
        status: "completed",
        result: { ok: true, version: "v1" },
      });

      const notificationDir = resolve(rootDir, "run-a", "notifications");
      const entries = (await readdir(notificationDir)).filter((entry) => entry.endsWith(".json"));
      expect(entries).toHaveLength(1);
      const persistedNotification = await readJson<{ status: string; result?: unknown }>(
        resolve(notificationDir, entries[0]!),
      );
      expect(persistedNotification).toMatchObject({
        status: "completed",
        result: { ok: true, version: "v1" },
      });
    } finally {
      await runtime.destroy();
    }
  });

  it("routes execution through an external worker and forwards aborts", async () => {
    const rootDir = await createTempDir();
    const starts: string[] = [];
    const abortReasons: string[] = [];
    let rejectResult: ((error: Error) => void) | undefined;
    const worker: AgentTaskWorker = {
      mode: "external",
      async start(task, args, context) {
        starts.push(`${task.name}:${String(args.version)}`);
        const result = new Promise<unknown>((_resolve, reject) => {
          rejectResult = reject;
          context.signal.addEventListener(
            "abort",
            () => reject(new Error(String(context.signal.reason ?? "aborted by signal"))),
            { once: true },
          );
        });
        return {
          result,
          abort(reason) {
            abortReasons.push(String(reason ?? "aborted"));
            rejectResult?.(new Error(String(reason ?? "aborted by worker")));
          },
        };
      },
    };

    const runtime = new DurableAgentTaskRuntime({ rootDir, worker });
    try {
      const task: AgentTask = {
        name: "deploy",
        description: "deploys externally",
        kind: "remote",
        async execute() {
          throw new Error("runtime worker should execute this task");
        },
      };

      const submitted = await runtime.submitBatch({
        runId: "run-worker",
        requests: [{ id: "req-1", name: "deploy", args: { version: "v9" }, order: 0 }],
        tasks: [task],
      });

      await runtime.cancelTasks("run-worker", [submitted.records[0]!.id], "cancel from test");
      const notification = await runtime.nextNotification("run-worker", { timeoutMs: 200 });

      expect(starts).toEqual(["deploy:v9"]);
      expect(abortReasons).toEqual(["cancel from test"]);
      expect(notification).toMatchObject({
        status: "canceled",
        error: "cancel from test",
      });
    } finally {
      await runtime.destroy();
    }
  });

  it("fails stale running records while preserving unread durable mailbox entries on restart", async () => {
    const rootDir = await createTempDir();
    const runDir = resolve(rootDir, "run-recover");
    await mkdir(resolve(runDir, "records"), { recursive: true });
    await mkdir(resolve(runDir, "notifications"), { recursive: true });
    await writeFile(
      resolve(runDir, "records", "task_stale.json"),
      JSON.stringify({
        id: "task_stale",
        runId: "run-recover",
        requestId: "req-stale",
        name: "deploy",
        kind: "workflow",
        order: 0,
        status: "running",
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        args: {},
        hardFailure: false,
      }),
    );
    await writeFile(
      resolve(runDir, "notifications", "00000001.json"),
      JSON.stringify({
        runId: "run-recover",
        taskId: "task_old",
        requestId: "req-old",
        name: "stale",
        kind: "workflow",
        order: 0,
        status: "completed",
        args: {},
        hardFailure: false,
        result: { stale: true },
      }),
    );
    await writeFile(
      resolve(runDir, "mailbox-state.json"),
      JSON.stringify({
        nextWriteSequence: 2,
        nextReadSequence: 1,
      }),
    );

    const runtime = new DurableAgentTaskRuntime({ rootDir });
    try {
      const preserved = await runtime.nextNotification("run-recover", { timeoutMs: 20 });
      const recovered = await runtime.nextNotification("run-recover", { timeoutMs: 20 });
      expect(await runtime.nextNotification("run-recover", { timeoutMs: 20 })).toBeUndefined();

      expect(preserved).toMatchObject({
        taskId: "task_old",
        requestId: "req-old",
        status: "completed",
        result: { stale: true },
      });
      expect(recovered).toMatchObject({
        taskId: "task_stale",
        requestId: "req-stale",
        status: "failed",
        error: "Task runtime restarted before task completion",
      });

      const recoveredRecord = await readJson<{
        status: string;
        error?: string;
      }>(resolve(runDir, "records", "task_stale.json"));
      expect(recoveredRecord).toMatchObject({
        status: "failed",
        error: "Task runtime restarted before task completion",
      });

      const notifications = (await readdir(resolve(runDir, "notifications"))).filter((entry) =>
        entry.endsWith(".json"),
      );
      expect(notifications.sort()).toEqual(["00000001.json", "00000002.json"]);

      const mailboxState = await readJson<{
        nextWriteSequence: number;
        nextReadSequence: number;
      }>(resolve(runDir, "mailbox-state.json"));
      expect(mailboxState).toEqual({
        nextWriteSequence: 3,
        nextReadSequence: 3,
      });
    } finally {
      await runtime.destroy();
    }
  });

  it("marks the current durable record failed when submission bookkeeping throws before execution starts", async () => {
    const rootDir = await createTempDir();
    const runtime = new DurableAgentTaskRuntime({ rootDir });

    try {
      await expect(
        runtime.submitBatch({
          runId: "run-submit-failure",
          requests: [{ id: "req-1", name: "deploy", args: { version: "v2" }, order: 0 }],
          tasks: [
            {
              name: "deploy",
              description: "never starts",
              kind: "workflow",
              async execute() {
                return { ok: true };
              },
            },
          ],
          hooks: {
            async onSubmitted() {
              throw new Error("persist task metadata failed");
            },
          },
        }),
      ).rejects.toThrow("persist task metadata failed");

      const records = await readdir(resolve(rootDir, "run-submit-failure", "records"));
      expect(records).toHaveLength(1);
      const record = await readJson<{ status: string; error?: string }>(
        resolve(rootDir, "run-submit-failure", "records", records[0]!),
      );
      expect(record.status).toBe("failed");
      expect(record.error).toContain("Task batch submission failed: persist task metadata failed");
    } finally {
      await runtime.destroy();
    }
  });

  it("keeps the durable record even when settlement bookkeeping fails and surfaces the runtime error", async () => {
    const rootDir = await createTempDir();
    const runtime = new DurableAgentTaskRuntime({ rootDir });

    try {
      const submitted = await runtime.submitBatch({
        runId: "run-settlement-failure",
        requests: [{ id: "req-1", name: "deploy", args: { version: "v3" }, order: 0 }],
        tasks: [
          {
            name: "deploy",
            description: "completes",
            kind: "workflow",
            async execute(args) {
              return { ok: true, version: args.version };
            },
          },
        ],
        hooks: {
          async onSettled() {
            throw new Error("persist settled task failed");
          },
        },
      });

      await expect(
        runtime.nextNotification("run-settlement-failure", { timeoutMs: 200 }),
      ).rejects.toThrow('Task "deploy" settlement bookkeeping failed: persist settled task failed');

      expect(
        await runtime.nextNotification("run-settlement-failure", { timeoutMs: 50 }),
      ).toMatchObject({
        status: "completed",
        result: { ok: true, version: "v3" },
      });

      const record = await readJson<{ status: string; result?: unknown }>(
        resolve(
          rootDir,
          "run-settlement-failure",
          "records",
          `${submitted.records[0]!.id}.json`,
        ),
      );
      expect(record).toMatchObject({
        status: "completed",
        result: { ok: true, version: "v3" },
      });

      const notifications = (await readdir(
        resolve(rootDir, "run-settlement-failure", "notifications"),
      )).filter((entry) => entry.endsWith(".json"));
      expect(notifications).toHaveLength(1);
      expect(
        await readJson<{ status: string; result?: unknown }>(
          resolve(rootDir, "run-settlement-failure", "notifications", notifications[0]!),
        ),
      ).toMatchObject({
        status: "completed",
        result: { ok: true, version: "v3" },
      });
    } finally {
      await runtime.destroy();
    }
  });
});

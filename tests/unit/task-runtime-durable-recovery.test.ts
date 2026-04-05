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
import { setTimeout as sleep } from "node:timers/promises";

import { DurableAgentTaskRuntime } from "../../packages/ai/src/task/runtime.ts";
import type {
  AgentTask,
  AgentTaskWorker,
} from "../../packages/ai/src/index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-task-runtime-durable-recovery-"));
  tempDirs.push(dir);
  return dir;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

describe("DurableAgentTaskRuntime recovery and worker lifecycle", () => {
  it("replays unread persisted notifications after reopen and advances the durable mailbox cursor exactly once", async () => {
    const rootDir = await createTempDir();
    const runtime = new DurableAgentTaskRuntime({ rootDir });

    try {
      const task: AgentTask = {
        name: "deploy",
        description: "deploys a release",
        kind: "workflow",
        async execute(args) {
          return { deployed: args.version };
        },
      };

      await runtime.submitBatch({
        runId: "run-reopen",
        requests: [
          { id: "req-1", name: "deploy", args: { version: "v1" }, order: 0 },
          { id: "req-2", name: "deploy", args: { version: "v2" }, order: 1 },
        ],
        tasks: [task],
      });

      await sleep(25);
    } finally {
      await runtime.destroy();
    }

    const reopened = new DurableAgentTaskRuntime({ rootDir });
    try {
      const first = await reopened.nextNotification("run-reopen", { timeoutMs: 100 });
      const second = await reopened.nextNotification("run-reopen", { timeoutMs: 100 });
      const exhausted = await reopened.nextNotification("run-reopen", { timeoutMs: 30 });

      expect(first).toMatchObject({
        requestId: "req-1",
        status: "completed",
        result: { deployed: "v1" },
      });
      expect(second).toMatchObject({
        requestId: "req-2",
        status: "completed",
        result: { deployed: "v2" },
      });
      expect(exhausted).toBeUndefined();

      const mailboxState = await readJson<{
        nextWriteSequence: number;
        nextReadSequence: number;
      }>(resolve(rootDir, "run-reopen", "mailbox-state.json"));
      expect(mailboxState).toEqual({
        nextWriteSequence: 3,
        nextReadSequence: 3,
      });

      const notificationFiles = (await readdir(resolve(rootDir, "run-reopen", "notifications")))
        .filter((entry) => entry.endsWith(".json"))
        .sort();
      expect(notificationFiles).toEqual(["00000001.json", "00000002.json"]);
    } finally {
      await reopened.destroy();
    }
  });

  it("persists failed records and notifications when the external worker cannot start", async () => {
    const rootDir = await createTempDir();
    let executeCalls = 0;
    const worker: AgentTaskWorker = {
      mode: "external",
      async start() {
        throw new Error("worker bootstrap failed");
      },
    };
    const runtime = new DurableAgentTaskRuntime({ rootDir, worker });

    try {
      const submitted = await runtime.submitBatch({
        runId: "run-worker-start-failure",
        requests: [{ id: "req-1", name: "deploy", args: { version: "v3" }, order: 0 }],
        tasks: [
          {
            name: "deploy",
            description: "deploys externally",
            kind: "remote",
            async execute() {
              executeCalls += 1;
              return { unreachable: true };
            },
          },
        ],
      });

      const notification = await runtime.nextNotification("run-worker-start-failure", {
        timeoutMs: 100,
      });
      expect(executeCalls).toBe(0);
      expect(notification).toMatchObject({
        taskId: submitted.records[0]!.id,
        status: "failed",
        error: "worker bootstrap failed",
      });
      expect(runtime.getActiveTaskIds("run-worker-start-failure")).toEqual([]);

      const persistedRecord = await readJson<{
        status: string;
        error?: string;
      }>(
        resolve(
          rootDir,
          "run-worker-start-failure",
          "records",
          `${submitted.records[0]!.id}.json`,
        ),
      );
      expect(persistedRecord).toMatchObject({
        status: "failed",
        error: "worker bootstrap failed",
      });
    } finally {
      await runtime.destroy();
    }
  });

  it("forwards destroy through the external worker exactly once after canceling active durable tasks", async () => {
    const rootDir = await createTempDir();
    const abortReasons: string[] = [];
    let destroyCalls = 0;
    const worker: AgentTaskWorker = {
      mode: "external",
      async start(_task, _args, context) {
        return {
          result: new Promise((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(new Error(String(context.signal.reason ?? "aborted"))),
              { once: true },
            );
          }),
          abort(reason) {
            abortReasons.push(String(reason ?? "aborted"));
          },
        };
      },
      destroy() {
        destroyCalls += 1;
      },
    };
    const runtime = new DurableAgentTaskRuntime({ rootDir, worker });

    await runtime.submitBatch({
      runId: "run-destroy-worker",
      requests: [{ id: "req-1", name: "deploy", args: { version: "v4" }, order: 0 }],
      tasks: [
        {
          name: "deploy",
          description: "deploys externally",
          kind: "remote",
          async execute() {
            throw new Error("worker adapter should own execution");
          },
        },
      ],
    });

    await runtime.destroy();

    expect(abortReasons).toEqual(["Task runtime destroyed"]);
    expect(destroyCalls).toBe(1);

    const recordFiles = await readdir(resolve(rootDir, "run-destroy-worker", "records"));
    const persistedRecord = await readJson<{
      status: string;
      error?: string;
    }>(resolve(rootDir, "run-destroy-worker", "records", recordFiles[0]!));
    expect(persistedRecord).toMatchObject({
      status: "canceled",
      error: "Task runtime destroyed",
    });
  });

  it("persists exactly one canceled notification when destroy force-settles a worker whose abort never resolves", async () => {
    const rootDir = await createTempDir();
    let destroyCalls = 0;
    let abortCalls = 0;
    const worker: AgentTaskWorker = {
      mode: "external",
      async start() {
        return {
          result: new Promise(() => undefined),
          abort() {
            abortCalls += 1;
            return new Promise(() => undefined);
          },
        };
      },
      destroy() {
        destroyCalls += 1;
      },
    };
    const runtime = new DurableAgentTaskRuntime({ rootDir, worker });

    await runtime.submitBatch({
      runId: "run-force-settle",
      requests: [{ id: "req-1", name: "deploy", args: { version: "v5" }, order: 0 }],
      tasks: [
        {
          name: "deploy",
          description: "never settles on its own",
          kind: "remote",
          async execute() {
            throw new Error("worker adapter should own execution");
          },
        },
      ],
    });

    const waiter = runtime.nextNotification("run-force-settle", { timeoutMs: 1_000 });
    await runtime.destroy();

    await expect(waiter).resolves.toMatchObject({
      taskId: expect.any(String),
      requestId: "req-1",
      status: "canceled",
      error: "Task runtime destroyed",
    });

    expect(abortCalls).toBe(1);
    expect(destroyCalls).toBe(1);

    const notificationFiles = (await readdir(resolve(rootDir, "run-force-settle", "notifications")))
      .filter((entry) => entry.endsWith(".json"))
      .sort();
    expect(notificationFiles).toEqual(["00000001.json"]);

    const persistedNotification = await readJson<{
      status: string;
      error?: string;
      requestId: string;
    }>(resolve(rootDir, "run-force-settle", "notifications", "00000001.json"));
    expect(persistedNotification).toMatchObject({
      requestId: "req-1",
      status: "canceled",
      error: "Task runtime destroyed",
    });

    const reopened = new DurableAgentTaskRuntime({ rootDir });
    try {
      const replayed = await reopened.nextNotification("run-force-settle", { timeoutMs: 50 });
      expect(replayed).toBeUndefined();
    } finally {
      await reopened.destroy();
    }
  });

  it("keeps cancellation isolated to the targeted durable run when multiple external runs are active", async () => {
    const rootDir = await createTempDir();
    const abortReasonsByRun = new Map<string, string[]>();
    const worker: AgentTaskWorker = {
      mode: "external",
      async start(_task, _args, context) {
        return {
          result: new Promise((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(new Error(String(context.signal.reason ?? "aborted"))),
              { once: true },
            );
          }),
          abort(reason) {
            const current = abortReasonsByRun.get(String(context.runId)) ?? [];
            current.push(String(reason ?? "aborted"));
            abortReasonsByRun.set(String(context.runId), current);
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
          throw new Error("worker adapter should own execution");
        },
      };

      const runA = await runtime.submitBatch({
        runId: "run-a",
        requests: [{ id: "req-a", name: "deploy", args: { version: "a" }, order: 0 }],
        tasks: [task],
      });
      const runB = await runtime.submitBatch({
        runId: "run-b",
        requests: [{ id: "req-b", name: "deploy", args: { version: "b" }, order: 0 }],
        tasks: [task],
      });

      await runtime.cancelTasks("run-a", [runA.records[0]!.id], "cancel run a");
      const canceled = await runtime.nextNotification("run-a", { timeoutMs: 100 });

      expect(canceled).toMatchObject({
        taskId: runA.records[0]!.id,
        status: "canceled",
        error: "cancel run a",
      });
      expect(runtime.getActiveTaskIds("run-b")).toEqual([runB.records[0]!.id]);
      expect(abortReasonsByRun.get("run-a")).toEqual(["cancel run a"]);
      expect(abortReasonsByRun.get("run-b")).toBeUndefined();
    } finally {
      await runtime.destroy();
    }
  });

  it("stores durable run state under a sanitized single directory for traversal-like or overlong run ids", async () => {
    const rootDir = await createTempDir();
    const longRunId = ` ../${"unsafe-segment/".repeat(12)}final `;
    const runtime = new DurableAgentTaskRuntime({ rootDir });

    try {
      await runtime.submitBatch({
        runId: longRunId,
        requests: [{ id: "req-1", name: "deploy", args: { version: "v6" }, order: 0 }],
        tasks: [
          {
            name: "deploy",
            description: "completes",
            kind: "workflow",
            async execute(args) {
              return { deployed: args.version };
            },
          },
        ],
      });

      await expect(runtime.nextNotification(longRunId, { timeoutMs: 100 })).resolves.toEqual(
        expect.objectContaining({
          status: "completed",
          result: { deployed: "v6" },
        }),
      );

      const entries = await readdir(rootDir);
      expect(entries).toHaveLength(1);
      expect(entries[0]).not.toContain("/");
      expect(entries[0]).not.toContain("..");
      expect(entries[0]!.length).toBeLessThanOrEqual(96);
      expect(await readdir(resolve(rootDir, entries[0]!, "records"))).toHaveLength(1);
    } finally {
      await runtime.destroy();
    }
  });

  it("fails closed when mailbox state advertises an unread notification that is missing on disk", async () => {
    const rootDir = await createTempDir();
    const runDir = resolve(rootDir, "run-missing-notification");
    await mkdir(resolve(runDir, "records"), { recursive: true });
    await mkdir(resolve(runDir, "notifications"), { recursive: true });
    await writeFile(
      resolve(runDir, "mailbox-state.json"),
      JSON.stringify({
        nextWriteSequence: 2,
        nextReadSequence: 1,
      }),
    );

    const runtime = new DurableAgentTaskRuntime({ rootDir });
    try {
      await expect(runtime.nextNotification("run-missing-notification", { timeoutMs: 50 })).rejects.toThrow(
        "Task runtime notification missing for run run-missing-notification sequence 1",
      );
    } finally {
      await runtime.destroy();
    }
  });

  it("rejects blank durable run ids before creating any filesystem state", async () => {
    const rootDir = await createTempDir();
    const runtime = new DurableAgentTaskRuntime({ rootDir });

    try {
      await expect(
        runtime.submitBatch({
          runId: "   ",
          requests: [{ id: "req-1", name: "deploy", args: {}, order: 0 }],
          tasks: [
            {
              name: "deploy",
              description: "should never start",
              kind: "workflow",
              async execute() {
                return { ok: true };
              },
            },
          ],
        }),
      ).rejects.toThrow("Task runtime path segment must be a non-empty string");

      expect(await readdir(rootDir)).toEqual([]);
    } finally {
      await runtime.destroy();
    }
  });

  it("treats timeoutMs: 0 as a non-blocking durable mailbox poll", async () => {
    const rootDir = await createTempDir();
    const runtime = new DurableAgentTaskRuntime({ rootDir });

    try {
      expect(await runtime.nextNotification("run-zero-timeout", { timeoutMs: 0 })).toBeUndefined();

      await runtime.submitBatch({
        runId: "run-zero-timeout",
        requests: [{ id: "req-1", name: "deploy", args: { version: "v7" }, order: 0 }],
        tasks: [
          {
            name: "deploy",
            description: "completes",
            kind: "workflow",
            async execute(args) {
              return { deployed: args.version };
            },
          },
        ],
      });

      await sleep(20);
      expect(await runtime.nextNotification("run-zero-timeout", { timeoutMs: 0 })).toMatchObject({
        requestId: "req-1",
        status: "completed",
        result: { deployed: "v7" },
      });
      expect(await runtime.nextNotification("run-zero-timeout", { timeoutMs: 0 })).toBeUndefined();
    } finally {
      await runtime.destroy();
    }
  });

  it("persists the real durable completion outcome even when settlement bookkeeping throws before reopen", async () => {
    const rootDir = await createTempDir();
    const runtime = new DurableAgentTaskRuntime({ rootDir });

    try {
      await runtime.submitBatch({
        runId: "run-bookkeeping-failure",
        requests: [{ id: "req-1", name: "deploy", args: { version: "v8" }, order: 0 }],
        tasks: [
          {
            name: "deploy",
            description: "completes before hook failure",
            kind: "workflow",
            async execute(args) {
              return { deployed: args.version };
            },
          },
        ],
        hooks: {
          async onSettled() {
            throw new Error("post-settlement projection failed");
          },
        },
      });
      await sleep(20);
    } finally {
      await runtime.destroy();
    }

    const reopened = new DurableAgentTaskRuntime({ rootDir });
    try {
      const notification = await reopened.nextNotification("run-bookkeeping-failure", {
        timeoutMs: 100,
      });
      expect(notification).toMatchObject({
        requestId: "req-1",
        status: "completed",
        result: { deployed: "v8" },
      });

      const recordFiles = await readdir(resolve(rootDir, "run-bookkeeping-failure", "records"));
      const record = await readJson<{ status: string; result?: unknown }>(
        resolve(rootDir, "run-bookkeeping-failure", "records", recordFiles[0]!),
      );
      expect(record).toMatchObject({
        status: "completed",
        result: { deployed: "v8" },
      });
    } finally {
      await reopened.destroy();
    }
  });
});

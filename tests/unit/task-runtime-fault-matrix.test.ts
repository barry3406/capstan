import { afterEach, describe, expect, it } from "bun:test";

import { createRemoteTask } from "../../packages/ai/src/task/remote-task.ts";
import { InMemoryAgentTaskRuntime } from "../../packages/ai/src/task/runtime.ts";
import { createWorkflowTask } from "../../packages/ai/src/task/workflow-task.ts";
import type { AgentTask } from "../../packages/ai/src/types.ts";

describe("task runtime fault matrix", () => {
  let runtime = new InMemoryAgentTaskRuntime();

  afterEach(async () => {
    await runtime.destroy();
    runtime = new InMemoryAgentTaskRuntime();
  });

  it("emits exactly one canceled notification when abort races with task rejection", async () => {
    const task: AgentTask = {
      name: "racey",
      description: "fails through both the abort hook and the task promise path",
      async execute(_args, context) {
        if (context.signal.aborted) {
          throw new Error(String(context.signal.reason ?? "already aborted"));
        }
        await new Promise<void>((resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new Error(String(context.signal.reason ?? "aborted"))),
            { once: true },
          );
        });
        throw new Error("unreachable");
      },
    };

    const submitted = await runtime.submitBatch({
      runId: "run-racey",
      requests: [{ id: "req-1", name: "racey", args: {}, order: 0 }],
      tasks: [task],
    });

    await runtime.cancelTasks("run-racey", [submitted.records[0]!.id], "cancel the race");

    const first = await runtime.nextNotification("run-racey", { timeoutMs: 200 });
    const second = await runtime.nextNotification("run-racey", { timeoutMs: 20 });

    expect(first).toMatchObject({
      requestId: "req-1",
      status: "canceled",
      error: "cancel the race",
    });
    expect(second).toBeUndefined();
  });

  it("keeps cancelRun isolated to the targeted run", async () => {
    const gate = deferred<void>();
    const seen: string[] = [];

    await runtime.submitBatch({
      runId: "run-a",
      requests: [{ id: "req-a", name: "slow", args: { run: "a" }, order: 0 }],
      tasks: [
        {
          name: "slow",
          description: "waits until canceled",
          async execute(args, context) {
            seen.push(`start:${String(args.run)}`);
            await new Promise<void>((resolve, reject) => {
              context.signal.addEventListener(
                "abort",
                () => reject(new Error(String(context.signal.reason ?? "aborted"))),
                { once: true },
              );
            });
            gate.resolve();
            throw new Error("unreachable");
          },
        },
      ],
    });

    await runtime.submitBatch({
      runId: "run-b",
      requests: [{ id: "req-b", name: "fast", args: { run: "b" }, order: 0 }],
      tasks: [
        {
          name: "fast",
          description: "completes immediately",
          async execute(args) {
            seen.push(`complete:${String(args.run)}`);
            return { ok: args.run };
          },
        },
      ],
    });

    await runtime.cancelRun("run-a", "cancel run a only");

    await expect(runtime.nextNotification("run-a", { timeoutMs: 200 })).resolves.toEqual(
      expect.objectContaining({
        status: "canceled",
        error: "cancel run a only",
      }),
    );
    await expect(runtime.nextNotification("run-b", { timeoutMs: 200 })).resolves.toEqual(
      expect.objectContaining({
        status: "completed",
        result: { ok: "b" },
      }),
    );
    expect(seen).toEqual(["start:a", "complete:b"]);
    gate.resolve();
  });

  it("workflow helpers stop before the next step once the signal is aborted", async () => {
    const controller = new AbortController();
    const steps: string[] = [];

    const workflow = createWorkflowTask({
      name: "workflow",
      steps: [
        {
          name: "one",
          async run(_args, context) {
            steps.push("one");
            controller.abort(new Error("stop after first step"));
            expect(context.signal.aborted).toBe(true);
            return { ok: 1 };
          },
        },
        {
          name: "two",
          async run() {
            steps.push("two");
            return { ok: 2 };
          },
        },
      ],
    });

    await expect(
      workflow.execute(
        {},
        {
          signal: controller.signal,
          taskId: "task-workflow-stop",
          requestId: "req-workflow-stop",
          order: 0,
        },
      ),
    ).rejects.toThrow("stop after first step");
    expect(steps).toEqual(["one"]);
  });

  it("remote helpers forward the full execution context through invoke", async () => {
    const remote = createRemoteTask({
      name: "remote",
      async invoke(_args, context) {
        return {
          runId: context.runId,
          requestId: context.requestId,
          taskId: context.taskId,
          order: context.order,
          callStack: Array.from(context.callStack ?? []),
        };
      },
    });

    await expect(
      remote.execute(
        {},
        {
          signal: new AbortController().signal,
          runId: "run-remote",
          requestId: "req-remote",
          taskId: "task-remote",
          order: 7,
          callStack: new Set(["planner", "delegate"]),
        },
      ),
    ).resolves.toEqual({
      runId: "run-remote",
      requestId: "req-remote",
      taskId: "task-remote",
      order: 7,
      callStack: ["planner", "delegate"],
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

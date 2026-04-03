import { afterEach, describe, expect, it } from "bun:test";

import { runAgentLoop } from "../../packages/ai/src/agent-loop.ts";
import { createRemoteTask } from "../../packages/ai/src/task/remote-task.ts";
import { createShellTask } from "../../packages/ai/src/task/shell-task.ts";
import { createSubagentTask } from "../../packages/ai/src/task/subagent-task.ts";
import { InMemoryAgentTaskRuntime } from "../../packages/ai/src/task/runtime.ts";
import { createWorkflowTask } from "../../packages/ai/src/task/workflow-task.ts";
import type {
  AgentTask,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "../../packages/ai/src/types.ts";

function mockLLM(
  responses: Array<string | (() => Promise<string> | string)>,
): LLMProvider {
  let index = 0;
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const next = responses[index++];
      return {
        content: typeof next === "function" ? await next() : next,
        model: "mock-1",
      };
    },
  };
}

describe("InMemoryAgentTaskRuntime", () => {
  let runtime = new InMemoryAgentTaskRuntime();

  afterEach(async () => {
    await runtime.destroy();
    runtime = new InMemoryAgentTaskRuntime();
  });

  it("submits tasks and emits completion notifications", async () => {
    const records: string[] = [];
    const task: AgentTask = {
      name: "deploy",
      description: "deploys code",
      kind: "workflow",
      async execute(args) {
        records.push(`deploy:${args.version as string}`);
        return { ok: true, version: args.version };
      },
    };

    const submitted = await runtime.submitBatch({
      runId: "run-a",
      requests: [
        { id: "req-1", name: "deploy", args: { version: "v1" }, order: 0 },
      ],
      tasks: [task],
    });

    expect(submitted.records).toHaveLength(1);
    expect(submitted.records[0]?.status).toBe("running");

    const notification = await runtime.nextNotification("run-a", { timeoutMs: 200 });
    expect(notification).toBeDefined();
    expect(notification?.status).toBe("completed");
    expect(notification?.result).toEqual({ ok: true, version: "v1" });
    expect(records).toEqual(["deploy:v1"]);
    expect(runtime.getActiveTaskIds("run-a")).toEqual([]);
  });

  it("cancels in-flight tasks cooperatively", async () => {
    const submitted = await runtime.submitBatch({
      runId: "run-cancel",
      requests: [{ id: "req-1", name: "sleep", args: {}, order: 0 }],
      tasks: [
        {
          name: "sleep",
          description: "waits forever unless canceled",
          async execute(_args, context) {
            await new Promise<void>((resolve, reject) => {
              context.signal.addEventListener(
                "abort",
                () => reject(new Error("aborted by signal")),
                { once: true },
              );
            });
            resolveUnreachable();
          },
        },
      ],
    });

    await runtime.cancelTasks("run-cancel", [submitted.records[0]!.id], "cancel now");
    const notification = await runtime.nextNotification("run-cancel", { timeoutMs: 200 });
    expect(notification?.status).toBe("canceled");
    expect(notification?.error).toContain("cancel");
  });

  it("fails unknown tasks without poisoning later notifications", async () => {
    await runtime.submitBatch({
      runId: "run-missing",
      requests: [{ id: "req-1", name: "missing", args: {}, order: 0 }],
      tasks: [],
    });

    const notification = await runtime.nextNotification("run-missing", { timeoutMs: 200 });
    expect(notification?.status).toBe("failed");
    expect(notification?.error).toContain('Task "missing" not found');
    expect(await runtime.nextNotification("run-missing", { timeoutMs: 10 })).toBeUndefined();
  });

  it("times out mailbox reads when no notification arrives", async () => {
    const notification = await runtime.nextNotification("run-empty", { timeoutMs: 20 });
    expect(notification).toBeUndefined();
  });

  it("removes timed-out mailbox waiters so later notifications are still delivered", async () => {
    const firstWait = await runtime.nextNotification("run-waiter", { timeoutMs: 10 });
    expect(firstWait).toBeUndefined();

    await runtime.submitBatch({
      runId: "run-waiter",
      requests: [{ id: "req-1", name: "deploy", args: { version: "v2" }, order: 0 }],
      tasks: [
        {
          name: "deploy",
          description: "deploys code",
          async execute(args) {
            return { ok: true, version: args.version };
          },
        },
      ],
    });

    await expect(runtime.nextNotification("run-waiter", { timeoutMs: 200 })).resolves.toEqual(
      expect.objectContaining({
        status: "completed",
        result: { ok: true, version: "v2" },
      }),
    );
  });

  it("rejects mailbox readers when settlement bookkeeping fails", async () => {
    await runtime.submitBatch({
      runId: "run-bookkeeping",
      requests: [{ id: "req-1", name: "deploy", args: {}, order: 0 }],
      tasks: [
        {
          name: "deploy",
          description: "deploys one change",
          async execute() {
            return { ok: true };
          },
        },
      ],
      hooks: {
        async onSettled() {
          throw new Error("persist task result failed");
        },
      },
    });

    await expect(
      runtime.nextNotification("run-bookkeeping", { timeoutMs: 200 }),
    ).rejects.toThrow('Task "deploy" settlement bookkeeping failed: persist task result failed');
  });

  it("cancels already-started tasks when a later submission hook fails in the same batch", async () => {
    let firstTaskStarted = false;

    await expect(
      runtime.submitBatch({
        runId: "run-partial-submit",
        requests: [
          { id: "req-1", name: "deploy", args: { id: "first" }, order: 0 },
          { id: "req-2", name: "deploy", args: { id: "second" }, order: 1 },
        ],
        tasks: [
          {
            name: "deploy",
            description: "deploys one change",
            async execute(_args, context) {
              firstTaskStarted = true;
              if (context.signal.aborted) {
                throw new Error(String(context.signal.reason ?? "aborted before start"));
              }
              await new Promise<void>((resolve, reject) => {
                context.signal.addEventListener(
                  "abort",
                  () => reject(new Error(String(context.signal.reason ?? "aborted by runtime"))),
                  { once: true },
                );
              });
              resolveUnreachable();
            },
          },
        ],
        hooks: {
          async onSubmitted(record) {
            if (record.requestId === "req-2") {
              throw new Error("persist second task failed");
            }
          },
        },
      }),
    ).rejects.toThrow("persist second task failed");

    const notification = await runtime.nextNotification("run-partial-submit", {
      timeoutMs: 200,
    });
    expect(notification).toMatchObject({
      requestId: "req-1",
      status: "canceled",
    });
    expect(notification?.error).toContain("Task batch submission failed: persist second task failed");
    expect(firstTaskStarted).toBe(true);
    expect(runtime.getActiveTaskIds("run-partial-submit")).toEqual([]);
    expect(await runtime.nextNotification("run-partial-submit", { timeoutMs: 10 })).toBeUndefined();
  });

  it("isolates settlement bookkeeping errors to the affected run", async () => {
    await runtime.submitBatch({
      runId: "run-error-a",
      requests: [{ id: "req-a", name: "deploy", args: {}, order: 0 }],
      tasks: [
        {
          name: "deploy",
          description: "completes quickly",
          async execute() {
            return { ok: true };
          },
        },
      ],
      hooks: {
        async onSettled() {
          throw new Error("persist run-a task failed");
        },
      },
    });

    await runtime.submitBatch({
      runId: "run-error-b",
      requests: [{ id: "req-b", name: "deploy", args: { id: "safe" }, order: 0 }],
      tasks: [
        {
          name: "deploy",
          description: "completes quickly",
          async execute(args) {
            return { ok: true, id: args.id };
          },
        },
      ],
    });

    await expect(runtime.nextNotification("run-error-a", { timeoutMs: 200 })).rejects.toThrow(
      'Task "deploy" settlement bookkeeping failed: persist run-a task failed',
    );
    await expect(runtime.nextNotification("run-error-b", { timeoutMs: 200 })).resolves.toEqual(
      expect.objectContaining({
        status: "completed",
        result: { ok: true, id: "safe" },
      }),
    );
  });

  it("passes the parent call stack through the execution context", async () => {
    const seenCallStacks: string[][] = [];

    await runtime.submitBatch({
      runId: "run-call-stack",
      requests: [{ id: "req-1", name: "deploy", args: {}, order: 0 }],
      tasks: [
        {
          name: "deploy",
          description: "records the call stack",
          async execute(_args, context) {
            seenCallStacks.push(Array.from(context.callStack ?? []));
            return { ok: true };
          },
        },
      ],
      callStack: new Set(["planner", "leader"]),
    });

    const notification = await runtime.nextNotification("run-call-stack", { timeoutMs: 200 });
    expect(notification?.status).toBe("completed");
    expect(seenCallStacks).toEqual([["planner", "leader"]]);
  });

  it("destroy cancels active tasks and unblocks mailbox waiters", async () => {
    await runtime.submitBatch({
      runId: "run-destroy",
      requests: [{ id: "req-1", name: "long", args: {}, order: 0 }],
      tasks: [
        {
          name: "long",
          description: "long running",
          async execute(_args, context) {
            await new Promise<void>((resolve, reject) => {
              context.signal.addEventListener(
                "abort",
                () => reject(new Error("stopped")),
                { once: true },
              );
            });
            resolveUnreachable();
          },
        },
      ],
    });

    const waiter = runtime.nextNotification("run-destroy", { timeoutMs: 500 });
    await runtime.destroy();
    const notification = await waiter;
    expect(notification?.status).toBe("canceled");
  });

  it("still emits one canceled notification during destroy even when a task ignores the abort signal", async () => {
    await runtime.submitBatch({
      runId: "run-stubborn",
      requests: [{ id: "req-1", name: "stubborn", args: {}, order: 0 }],
      tasks: [
        {
          name: "stubborn",
          description: "ignores abort forever",
          async execute() {
            await new Promise(() => undefined);
            resolveUnreachable();
          },
        },
      ],
    });

    const waiter = runtime.nextNotification("run-stubborn", { timeoutMs: 500 });
    await runtime.destroy();
    await expect(waiter).resolves.toEqual(
      expect.objectContaining({
        status: "canceled",
        error: "Task runtime destroyed",
      }),
    );
    expect(runtime.getActiveTaskIds("run-stubborn")).toEqual([]);
  });

  it("rejects new submissions after destroy", async () => {
    await runtime.destroy();

    await expect(
      runtime.submitBatch({
        runId: "run-after-destroy",
        requests: [{ id: "req-1", name: "deploy", args: {}, order: 0 }],
        tasks: [
          {
            name: "deploy",
            description: "should never start",
            async execute() {
              return { ok: true };
            },
          },
        ],
      }),
    ).rejects.toThrow("Task runtime destroyed");
    await expect(
      runtime.nextNotification("run-after-destroy", { timeoutMs: 20 }),
    ).resolves.toBeUndefined();
  });
});

describe("task helpers", () => {
  it("runs workflow and remote task helpers", async () => {
    const workflow = createWorkflowTask({
      name: "workflow",
      steps: [
        {
          name: "one",
          async run(args) {
            return { seen: args.value };
          },
        },
        {
          name: "two",
          async run() {
            return { ok: true };
          },
        },
      ],
    });
    const remote = createRemoteTask({
      name: "remote",
      async invoke(args) {
        return { remote: args.value };
      },
    });

    await expect(
      workflow.execute(
        { value: 7 },
        {
          signal: new AbortController().signal,
          taskId: "task-1",
          requestId: "req-1",
          order: 0,
        },
      ),
    ).resolves.toEqual({
      steps: [
        { step: "one", result: { seen: 7 } },
        { step: "two", result: { ok: true } },
      ],
    });
    await expect(
      remote.execute(
        { value: "x" },
        {
          signal: new AbortController().signal,
          taskId: "task-2",
          requestId: "req-2",
          order: 1,
        },
      ),
    ).resolves.toEqual({ remote: "x" });
  });

  it("rejects remote tasks immediately when the parent signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("remote canceled"));

    const remote = createRemoteTask({
      name: "remote",
      async invoke() {
        return { unreachable: true };
      },
    });

    await expect(
      remote.execute(
        {},
        {
          signal: controller.signal,
          taskId: "task-remote-canceled",
          requestId: "req-remote-canceled",
          order: 0,
        },
      ),
    ).rejects.toThrow("remote canceled");
  });

  it("rejects workflow tasks immediately when the parent signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("workflow canceled"));

    const workflow = createWorkflowTask({
      name: "workflow",
      handler: async () => ({ unreachable: true }),
    });

    await expect(
      workflow.execute(
        {},
        {
          signal: controller.signal,
          taskId: "task-workflow-canceled",
          requestId: "req-workflow-canceled",
          order: 0,
        },
      ),
    ).rejects.toThrow("workflow canceled");
  });

  it("runs shell tasks with captured stdout", async () => {
    const task = createShellTask({
      name: "echo",
      command: [process.execPath, "-e", "process.stdout.write('hello from shell')"],
    });

    const result = await task.execute(
      {},
      {
        signal: new AbortController().signal,
        taskId: "task-shell",
        requestId: "req-shell",
        order: 0,
      },
    );

    expect(result).toMatchObject({
      stdout: "hello from shell",
      exitCode: 0,
    });
  });

  it("fails fast when shell tasks are configured with an empty command", async () => {
    const task = createShellTask({
      name: "bad-shell",
      command: [],
    });

    await expect(
      task.execute(
        {},
        {
          signal: new AbortController().signal,
          taskId: "task-shell-empty",
          requestId: "req-shell-empty",
          order: 0,
        },
      ),
    ).rejects.toThrow("Shell task bad-shell requires a non-empty command");
  });

  it("times out shell tasks deterministically", async () => {
    const task = createShellTask({
      name: "slow-shell",
      command: [process.execPath, "-e", "setTimeout(() => {}, 1000)"],
      timeoutMs: 25,
    });

    await expect(
      task.execute(
        {},
        {
          signal: new AbortController().signal,
          taskId: "task-shell-timeout",
          requestId: "req-shell-timeout",
          order: 0,
        },
      ),
    ).rejects.toThrow("Shell task slow-shell timed out after 25ms");
  });

  it("runs subagent tasks through the main loop façade", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "echo", arguments: { value: "nested" } }),
      "nested done",
    ]);
    const subagent = createSubagentTask({
      name: "delegate",
      llm,
      tools: [
        {
          name: "echo",
          description: "echoes a value",
          async execute(args) {
            return { echoed: args.value };
          },
        },
      ],
      buildConfig() {
        return { goal: "delegate one step" };
      },
    });

    const result = await subagent.execute(
      {},
      {
        signal: new AbortController().signal,
        taskId: "task-sub",
        requestId: "req-sub",
        order: 0,
      },
    );

    expect(result).toMatchObject({
      status: "completed",
      iterations: 2,
      toolCalls: [
        {
          tool: "echo",
          result: { echoed: "nested" },
        },
      ],
    });
  });

  it("rejects subagent tasks immediately when the parent signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("parent canceled");

    const subagent = createSubagentTask({
      name: "delegate",
      llm: mockLLM(["done"]),
      buildConfig() {
        return { goal: "should never run" };
      },
    });

    await expect(
      subagent.execute(
        {},
        {
          signal: controller.signal,
          taskId: "task-sub-canceled",
          requestId: "req-sub-canceled",
          order: 0,
        },
      ),
    ).rejects.toThrow("parent canceled");
  });

  it("supports task helpers inside the agent loop itself", async () => {
    const llm = mockLLM([
      JSON.stringify({ tool: "remote", arguments: { value: "ship-it" } }),
      "done",
    ]);

    const result = await runAgentLoop(
      llm,
      {
        goal: "run remote task",
        tasks: [
          createRemoteTask({
            name: "remote",
            async invoke(args) {
              return { ok: true, value: args.value };
            },
          }),
        ],
      },
      [],
    );

    expect(result.status).toBe("completed");
    expect(result.taskCalls).toEqual([
      expect.objectContaining({
        task: "remote",
        result: { ok: true, value: "ship-it" },
      }),
    ]);
  });
});

function resolveUnreachable(): never {
  throw new Error("Expected the task to be interrupted before reaching this point");
}

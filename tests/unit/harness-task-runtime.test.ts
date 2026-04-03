import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createHarness, openHarnessRuntime } from "@zauso-ai/capstan-ai";
import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "@zauso-ai/capstan-ai";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function mockLLM(responses: Array<string | (() => Promise<string> | string)>): LLMProvider {
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

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-task-"));
  tempDirs.push(dir);
  return dir;
}

describe("createHarness task fabric persistence", () => {
  it("persists task records and exposes them through the harness and control plane", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "deploy", arguments: { version: "v1" } }),
        "deployment finished",
      ]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "deploy a release",
      tasks: [
        {
          name: "deploy",
          description: "deploys a release",
          kind: "workflow",
          async execute(args) {
            return { deployed: args.version };
          },
        },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.taskCalls).toEqual([
      expect.objectContaining({
        task: "deploy",
        result: { deployed: "v1" },
      }),
    ]);

    const run = await harness.getRun(result.runId);
    expect(run?.taskCalls).toBe(1);
    expect(run?.taskNames).toEqual(["deploy"]);
    expect(run?.taskIds).toHaveLength(1);

    const tasks = await harness.getTasks(result.runId);
    expect(tasks).toEqual([
      expect.objectContaining({
        runId: result.runId,
        name: "deploy",
        status: "completed",
        result: { deployed: "v1" },
      }),
    ]);

    const runtime = await openHarnessRuntime(rootDir);
    expect(await runtime.getTasks(result.runId)).toEqual(tasks);

    const events = await harness.getEvents(result.runId);
    expect(events.map((event) => event.type)).toContain("task_call");
    expect(events.map((event) => event.type)).toContain("task_result");
  });

  it("stores approval-blocked task runs without creating task records", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "deploy", arguments: { version: "v2" } }),
      ]),
      runtime: {
        rootDir,
        beforeTaskCall: async () => ({
          allowed: false,
          reason: "manual deploy approval required",
        }),
      },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "deploy after approval",
      tasks: [
        {
          name: "deploy",
          description: "deploys a release",
          kind: "workflow",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });

    expect(result.runtimeStatus).toBe("approval_required");
    expect(result.taskCalls).toEqual([]);
    expect(await harness.getTasks(result.runId)).toEqual([]);
    const approvals = await harness.listApprovals(result.runId);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!).toMatchObject({
      runId: result.runId,
      kind: "task",
      status: "pending",
    });
    expect(await harness.getApproval(approvals[0]!.id)).toMatchObject({
      id: approvals[0]!.id,
      kind: "task",
      runId: result.runId,
    });
    const events = await harness.getEvents(result.runId);
    expect(events.map((event) => event.type)).toContain("task_call");
    expect(events.map((event) => event.type)).toContain("approval_required");
  });

  it("resumes approval-blocked task runs after approving the pending task approval", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "deploy", arguments: { version: "v2" } }),
        "deployment resumed",
      ]),
      runtime: {
        rootDir,
        beforeTaskCall: async () => ({
          allowed: false,
          reason: "manual deploy approval required",
        }),
      },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "deploy after approval",
      tasks: [
        {
          name: "deploy",
          description: "deploys a release",
          kind: "workflow",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });

    expect(result.runtimeStatus).toBe("approval_required");
    const approvals = await harness.listApprovals(result.runId);
    expect(approvals[0]!).toMatchObject({
      kind: "task",
      status: "pending",
    });

    const resumed = await harness.resumeRun(result.runId, {
      approvePendingTool: true,
    });

    expect(resumed.runtimeStatus).toBe("completed");
    expect((await harness.getApproval(approvals[0]!.id))).toMatchObject({
      kind: "task",
      status: "approved",
    });
    expect((await harness.getEvents(result.runId)).map((event) => event.type)).toContain(
      "approval_approved",
    );
  });

  it("persists task approvals as task-kind approval records and can deny them through the control plane", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "deploy", arguments: { version: "v4" } }),
      ]),
      runtime: {
        rootDir,
        beforeTaskCall: async () => ({
          allowed: false,
          reason: "manual deploy approval required",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "persist a task approval",
      tasks: [
        {
          name: "deploy",
          description: "deploys a release",
          kind: "workflow",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });

    const run = await harness.getRun(blocked.runId);
    const approvalId = run?.pendingApprovalId;
    expect(approvalId).toBeString();
    expect(run?.pendingApproval).toMatchObject({
      id: approvalId,
      kind: "task",
      tool: "deploy",
      status: "pending",
    });

    const runtime = await openHarnessRuntime(rootDir);
    expect(await runtime.getApproval(approvalId!)).toMatchObject({
      id: approvalId,
      runId: blocked.runId,
      kind: "task",
      tool: "deploy",
      status: "pending",
    });

    const denied = await runtime.denyRun(blocked.runId, {
      note: "deployment window closed",
    });
    expect(denied).toMatchObject({
      id: approvalId,
      kind: "task",
      status: "denied",
      resolutionNote: "deployment window closed",
    });
    expect((await harness.getRun(blocked.runId))?.status).toBe("canceled");
  });

  it("persists canceled task records when a run is canceled during task_wait", async () => {
    const rootDir = await createTempDir();
    let cancelOnce = true;
    let harness: Awaited<ReturnType<typeof createHarness>>;
    harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "deploy", arguments: { version: "v3" } }),
      ]),
      runtime: {
        rootDir,
        beforeTaskCall: async ({ runId }) => {
          if (cancelOnce) {
            cancelOnce = false;
            await harness.cancelRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "cancel a task run",
      tasks: [
        {
          name: "deploy",
          description: "deploys a release",
          kind: "workflow",
          async execute(_args, context) {
            await new Promise<void>((resolve, reject) => {
              context.signal.addEventListener(
                "abort",
                () => reject(new Error("canceled by harness")),
                { once: true },
              );
            });
            throw new Error("unreachable");
          },
        },
      ],
    });

    expect(result.runtimeStatus).toBe("canceled");
    const tasks = await harness.getTasks(result.runId);
    expect(tasks).toEqual([
      expect.objectContaining({
        name: "deploy",
        status: "canceled",
      }),
    ]);
  });
});

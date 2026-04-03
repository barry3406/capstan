import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "../../packages/ai/src/index.ts";
import { createHarness } from "../../packages/ai/src/harness/index.ts";
import { openHarnessRuntime } from "../../packages/ai/src/harness/runtime/control-plane.ts";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function mockLLM(
  responses: Array<string | Error | (() => Promise<string> | string)>,
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const next = responses[callIndex++];
      if (next instanceof Error) {
        throw next;
      }
      const content =
        typeof next === "function" ? await next() : (next ?? "done");
      return { content, model: "mock-1" };
    },
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-recovery-"));
  tempDirs.push(dir);
  return dir;
}

function lifecycleEventTypes(events: Array<{ type: string }>): string[] {
  return events
    .map((event) => event.type)
    .filter(
      (type) =>
        type !== "memory_stored" &&
        type !== "summary_created" &&
        type !== "context_compacted",
    );
}

class GatedRequireRunStore extends FileHarnessRuntimeStore {
  private gatedRunId?: string;
  private gatePromise?: Promise<void>;
  private releaseGate?: () => void;
  private gateHit?: Promise<void>;
  private signalGateHit?: () => void;

  armRunningRequireRunGate(runId: string): void {
    this.gatedRunId = runId;
    this.gatePromise = new Promise<void>((resolvePromise) => {
      this.releaseGate = resolvePromise;
    });
    this.gateHit = new Promise<void>((resolvePromise) => {
      this.signalGateHit = resolvePromise;
    });
  }

  async waitForRunningRequireRunGate(): Promise<void> {
    await this.gateHit;
  }

  releaseRunningRequireRunGate(): void {
    this.releaseGate?.();
  }

  override async requireRun(runId: string) {
    const run = await super.requireRun(runId);
    if (
      this.gatedRunId === runId &&
      this.gatePromise &&
      run.status === "running"
    ) {
      this.signalGateHit?.();
      const gate = this.gatePromise;
      this.gatedRunId = undefined;
      await gate;
      this.gatePromise = undefined;
      this.gateHit = undefined;
      this.signalGateHit = undefined;
      this.releaseGate = undefined;
    }
    return run;
  }
}

describe("createHarness recovery matrix", () => {
  it("rejects pause requests after cancellation has already been requested and still lands in canceled", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            await runtime.cancelRun(runId);
            await expect(runtime.pauseRun(runId)).rejects.toThrow(
              `Cannot pause run ${runId} from status cancel_requested`,
            );
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
    });

    const canceled = await harness.run({
      goal: "cancel beats later pause",
      tools: [
        {
          name: "step",
          description: "records a step",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });

    expect(canceled.runtimeStatus).toBe("canceled");
    const events = await harness.getEvents(canceled.runId);
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "tool_call",
      "tool_result",
      "memory_stored",
      "tool_call",
      "cancel_requested",
      "tool_result",
      "memory_stored",
      "run_canceled",
      "summary_created",
      "memory_stored",
    ]);
  });

  it("lets cancellation win if it arrives after pause_requested but before the cooperative pause lands", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            await runtime.pauseRun(runId);
            await runtime.cancelRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
    });

    const canceled = await harness.run({
      goal: "cancel after pause request",
      tools: [
        {
          name: "step",
          description: "records a step",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });

    expect(canceled.runtimeStatus).toBe("canceled");
    const events = await harness.getEvents(canceled.runId);
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "tool_call",
      "tool_result",
      "memory_stored",
      "tool_call",
      "pause_requested",
      "cancel_requested",
      "tool_result",
      "memory_stored",
      "run_canceled",
      "summary_created",
      "memory_stored",
    ]);
  });

  it("makes approval-blocked runs permanently non-resumable once canceled", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "delete", arguments: { id: "123" } }),
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "delete requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "delete one record",
      tools: [
        {
          name: "delete",
          description: "deletes a record",
          async execute() {
            return { deleted: true };
          },
        },
      ],
    });
    expect(blocked.runtimeStatus).toBe("approval_required");

    const canceled = await harness.cancelRun(blocked.runId);
    expect(canceled.status).toBe("canceled");
    await expect(harness.resumeRun(blocked.runId)).rejects.toThrow(
      `Harness run ${blocked.runId} is not resumable from status canceled`,
    );

    const events = await harness.getEvents(blocked.runId);
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "tool_call",
      "approval_required",
      "summary_created",
      "memory_stored",
      "approval_canceled",
      "run_canceled",
      "summary_created",
      "memory_stored",
    ]);
  });

  it("makes paused runs permanently non-resumable once canceled", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            await runtime.pauseRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
    });

    const paused = await harness.run({
      goal: "pause before cancel",
      tools: [
        {
          name: "step",
          description: "records a step",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });
    expect(paused.runtimeStatus).toBe("paused");

    const canceled = await harness.cancelRun(paused.runId);
    expect(canceled.status).toBe("canceled");
    await expect(harness.resumeRun(paused.runId)).rejects.toThrow(
      `Harness run ${paused.runId} is not resumable from status canceled`,
    );
  });

  it("rejects approval resumes that omit approvePendingTool and leaves the run untouched", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "delete", arguments: { id: "123" } }),
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "delete requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "delete one record",
      tools: [
        {
          name: "delete",
          description: "deletes a record",
          async execute() {
            return { deleted: true };
          },
        },
      ],
    });

    const eventsBefore = await harness.getEvents(blocked.runId);
    await expect(harness.resumeRun(blocked.runId)).rejects.toThrow(
      `Harness run ${blocked.runId} requires an approved pending approval or approvePendingTool=true before it can resume`,
    );
    expect((await harness.getRun(blocked.runId))?.status).toBe("approval_required");
    expect(await harness.getEvents(blocked.runId)).toEqual(eventsBefore);
  });

  it("does not mutate run state or append resume events when checkpoint JSON is corrupted", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            await runtime.pauseRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
    });

    const paused = await harness.run({
      goal: "pause before corrupt resume",
      tools: [
        {
          name: "step",
          description: "records a step",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });
    expect(paused.runtimeStatus).toBe("paused");

    const checkpointPath = join(
      harness.getPaths().checkpointsDir,
      `${paused.runId}.json`,
    );
    await writeFile(checkpointPath, "{bad checkpoint\n", "utf8");

    const eventsBefore = await harness.getEvents(paused.runId);
    await expect(harness.resumeRun(paused.runId)).rejects.toThrow();
    expect((await harness.getRun(paused.runId))?.status).toBe("paused");
    expect(await harness.getEvents(paused.runId)).toEqual(eventsBefore);
  });

  it("rejects resumes when the persisted checkpoint shape is structurally invalid", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            await runtime.pauseRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
    });

    const paused = await harness.run({
      goal: "pause before invalid resume",
      tools: [
        {
          name: "step",
          description: "records a step",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });
    expect(paused.runtimeStatus).toBe("paused");

    const checkpointPath = join(
      harness.getPaths().checkpointsDir,
      `${paused.runId}.json`,
    );
    await writeFile(
      checkpointPath,
      JSON.stringify({
        runId: paused.runId,
        updatedAt: "2026-04-03T00:00:00.000Z",
        checkpoint: {
          stage: "tool_result",
          config: { goal: "bad checkpoint" },
          messages: "not-an-array",
          iterations: 2,
          toolCalls: [],
        },
      }),
      "utf8",
    );

    const eventsBefore = await harness.getEvents(paused.runId);
    await expect(harness.resumeRun(paused.runId)).rejects.toThrow(
      `Harness run ${paused.runId} checkpoint is invalid: messages must be an array`,
    );
    expect((await harness.getRun(paused.runId))?.status).toBe("paused");
    expect(await harness.getEvents(paused.runId)).toEqual(eventsBefore);
  });

  it("allows cancellation to win before an approved pending tool is replayed", async () => {
    const rootDir = await createTempDir();
    let store!: GatedRequireRunStore;
    const writes: string[] = [];

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "approved" } }),
      ]),
      runtime: {
        rootDir,
        storeFactory: (dir) => {
          store = new GatedRequireRunStore(dir);
          return store;
        },
        beforeToolCall: async () => ({
          allowed: false,
          reason: "write requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "write once",
      tools: [
        {
          name: "write",
          description: "persists a value",
          async execute(args) {
            writes.push(String(args.value));
            return { saved: true };
          },
        },
      ],
    });
    expect(blocked.runtimeStatus).toBe("approval_required");

    store.armRunningRequireRunGate(blocked.runId);
    const resumePromise = harness.resumeRun(blocked.runId, {
      approvePendingTool: true,
    });
    await store.waitForRunningRequireRunGate();
    await harness.cancelRun(blocked.runId);
    store.releaseRunningRequireRunGate();

    const canceled = await resumePromise;
    expect(canceled.runtimeStatus).toBe("canceled");
    expect(writes).toEqual([]);

    const events = await harness.getEvents(blocked.runId);
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "tool_call",
      "approval_required",
      "summary_created",
      "memory_stored",
      "approval_approved",
      "run_resumed",
      "cancel_requested",
      "run_canceled",
      "summary_created",
      "memory_stored",
    ]);
  });
});

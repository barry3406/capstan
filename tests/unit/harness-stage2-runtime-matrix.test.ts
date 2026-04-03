import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createHarness,
  openHarnessRuntime,
} from "@zauso-ai/capstan-ai";
import type {
  AgentTool,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "@zauso-ai/capstan-ai";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-stage2-runtime-"));
  tempDirs.push(dir);
  return dir;
}

function createMockLLM(
  responses: Array<string>,
  sink?: LLMMessage[][],
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      sink?.push(messages.map((message) => ({ ...message })));
      const content = responses[callIndex++] ?? "done";
      return { content, model: "mock-1" };
    },
  };
}

function createLongRunningTool(
  release: Promise<void>,
  execute: (args: unknown) => Promise<unknown> | unknown,
  onStart?: () => void,
): AgentTool {
  return {
    name: "lookup",
    description: "waits for the harness to ask for pause/cancel",
    async execute(args) {
      onStart?.();
      await release;
      return execute(args);
    },
  };
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for runtime condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function createHarnessForRuntime(
  rootDir: string,
  llm: LLMProvider,
  overrides?: Partial<Parameters<typeof createHarness>[0]>,
) {
  return createHarness({
    llm,
    runtime: {
      rootDir,
      ...overrides?.runtime,
    },
    sandbox: {
      fs: true,
      browser: false,
      ...overrides?.sandbox,
    },
    verify: {
      enabled: false,
      ...overrides?.verify,
    },
    context: {
      enabled: true,
      maxPromptTokens: 2_000,
      reserveOutputTokens: 0,
      maxRecentMessages: 6,
      autoPromoteObservations: true,
      autoPromoteSummaries: true,
      ...overrides?.context,
    },
  });
}

describe("Stage 2 harness runtime matrix", () => {
  it("pauses a live run, preserves the checkpoint, and resumes it to completion", async () => {
    const rootDir = await createTempDir();
    const messages: LLMMessage[][] = [];
    let releaseTool!: () => void;
    let toolStarted = false;
    const firstToolRelease = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });

    const llm = createMockLLM(
      [
        JSON.stringify({ tool: "lookup", arguments: { id: "alpha" } }),
        "resumed-final-answer",
      ],
      messages,
    );

    const longRunningTool = createLongRunningTool(
      firstToolRelease,
      async () => ({ lookedUp: true }),
      () => {
        toolStarted = true;
      },
    );
    const harness = await createHarnessForRuntime(
      rootDir,
      llm,
    );

    const started = await harness.startRun({
      goal: "pause and resume the live run",
      tools: [
        longRunningTool,
      ],
    });

    await waitForCondition(() => toolStarted);

    const pauseRequested = await harness.pauseRun(started.runId);
    expect(pauseRequested.status).toBe("pause_requested");

    releaseTool();
    const pausedResult = await started.result;
    expect(pausedResult.status).toBe("paused");
    expect(pausedResult.runtimeStatus).toBe("paused");
    expect(pausedResult.checkpoint?.stage).toBe("tool_result");
    expect(pausedResult.toolCalls).toHaveLength(1);

    const resumed = await harness.resumeRun(started.runId, {
      runConfig: {
        goal: "pause and resume the live run",
        tools: [
          {
            name: "lookup",
            description: "lookup tool",
            async execute() {
              return { lookedUp: true };
            },
          },
        ],
      },
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.runtimeStatus).toBe("completed");
    expect(resumed.toolCalls).toHaveLength(1);
    expect(resumed.checkpoint?.stage).toBe("completed");
    expect(messages.length).toBeGreaterThanOrEqual(2);
    await harness.destroy();
  });

  it("cancels a live run, aborts the sandbox, and keeps the terminal context coherent", async () => {
    const rootDir = await createTempDir();
    let releaseTool!: () => void;
    let toolStarted = false;
    const blocked = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const messages: LLMMessage[][] = [];
    const llm = createMockLLM([JSON.stringify({ tool: "lookup", arguments: { id: "beta" } })], messages);

    const longRunningTool = createLongRunningTool(
      blocked,
      async () => ({ canceled: false }),
      () => {
        toolStarted = true;
      },
    );
    const harness = await createHarnessForRuntime(
      rootDir,
      llm,
    );

    const started = await harness.startRun({
      goal: "cancel the live run",
      tools: [
        longRunningTool,
      ],
    });

    await waitForCondition(() => toolStarted);
    const cancelRequested = await harness.cancelRun(started.runId);
    expect(cancelRequested.status).toBe("cancel_requested");

    releaseTool();
    const canceledResult = await started.result;
    expect(canceledResult.status).toBe("canceled");
    expect(canceledResult.runtimeStatus).toBe("canceled");
    expect(canceledResult.checkpoint?.stage).toBe("canceled");

    const run = await harness.getRun(started.runId);
    expect(run?.status).toBe("canceled");
    expect((await harness.getLatestSummary(started.runId))?.status).toBe("canceled");

    const context = await harness.assembleContext(started.runId, {
      query: "cancel the live run",
      maxTokens: 1_000,
    });
    expect(context.summary?.status).toBe("canceled");
    expect(context.blocks.map((block) => block.title)).toContain("Run Summary");

    const replay = await harness.replayRun(started.runId);
    expect(replay.consistent).toBe(true);
    expect(replay.storedStatus).toBe("canceled");
    await harness.destroy();
  });

  it("rejects approval-required resumes that omit approvePendingTool and keeps the blocked run untouched", async () => {
    const rootDir = await createTempDir();
    const llm = createMockLLM([JSON.stringify({ tool: "delete", arguments: { id: 123 } })]);

    const harness = await createHarnessForRuntime(rootDir, llm, {
      runtime: {
        beforeToolCall: async () => ({
          allowed: false,
          reason: "manual approval required",
        }),
      },
    });

    const blocked = await harness.run({
      goal: "delete the record",
      tools: [
        {
          name: "delete",
          description: "delete tool",
          async execute() {
            return { deleted: true };
          },
        },
      ],
    });

    expect(blocked.status).toBe("approval_required");
    expect(blocked.runtimeStatus).toBe("approval_required");

    await expect(harness.resumeRun(blocked.runId)).rejects.toThrow(
      `Harness run ${blocked.runId} requires an approved pending approval or approvePendingTool=true before it can resume`,
    );
    expect((await harness.getRun(blocked.runId))?.status).toBe("approval_required");
    await harness.destroy();
  });

  it("resumes an approval-required run with approvePendingTool and does not re-run the policy gate", async () => {
    const rootDir = await createTempDir();
    let policyChecks = 0;
    const llm = createMockLLM([
      JSON.stringify({ tool: "write", arguments: { value: "alpha" } }),
      "approval-resume-final",
    ]);

    const harness = await createHarnessForRuntime(rootDir, llm, {
      runtime: {
        beforeToolCall: async () => ({
          allowed: false,
          reason: "manual approval required",
        }),
      },
    });

    const blocked = await harness.run({
      goal: "write the approved value",
      tools: [
        {
          name: "write",
          description: "write tool",
          async execute() {
            return { saved: true };
          },
        },
      ],
      maxIterations: 3,
    });

    expect(blocked.status).toBe("approval_required");

    const resumed = await harness.resumeRun(blocked.runId, {
      approvePendingTool: true,
      runConfig: {
        goal: "write the approved value",
        tools: [
          {
            name: "write",
            description: "write tool",
            async execute() {
              policyChecks++;
              return { saved: true };
            },
          },
        ],
      },
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.runtimeStatus).toBe("completed");
    expect(resumed.pendingApproval).toBeUndefined();
    expect(policyChecks).toBe(1);
    expect((await harness.getLatestSummary(blocked.runId))?.status).toBe("completed");
    await harness.destroy();
  });

  it("replays a persisted run after the original harness is destroyed and reopened", async () => {
    const rootDir = await createTempDir();
    const llm = createMockLLM(["All done."]);
    const harness = await createHarnessForRuntime(rootDir, llm);

    const result = await harness.run({
      goal: "persist and reopen",
      tools: [],
    });

    const runId = result.runId;
    await harness.destroy();

    const runtime = await openHarnessRuntime(rootDir);
    const replay = await runtime.replayRun(runId);

    expect(replay.consistent).toBe(true);
    expect(replay.storedStatus).toBe("completed");
    expect(replay.derivedStatus).toBe("completed");
    expect((await runtime.getRun(runId))?.status).toBe("completed");
  });

  it("detects replay drift when the stored run no longer matches the derived tool-call history", async () => {
    const rootDir = await createTempDir();
    const llm = createMockLLM(["Done."]);
    const harness = await createHarnessForRuntime(rootDir, llm);

    const result = await harness.run({
      goal: "tamper replay",
      tools: [],
    });

    const runPath = join(harness.getPaths().runsDir, `${result.runId}.json`);
    const storedRun = JSON.parse(await readFile(runPath, "utf8")) as {
      toolCalls: number;
    };
    storedRun.toolCalls = storedRun.toolCalls + 1;
    await writeFile(runPath, `${JSON.stringify(storedRun, null, 2)}\n`, "utf8");

    const runtime = await openHarnessRuntime(rootDir);
    const replay = await runtime.replayRun(result.runId);

    expect(replay.consistent).toBe(false);
    expect(replay.storedToolCalls).toBeGreaterThan(replay.derivedToolCalls);
  });

  it("surfaces pause and cancel transitions through the runtime control plane after a blocked tool call", async () => {
    const rootDir = await createTempDir();
    const llm = createMockLLM([JSON.stringify({ tool: "danger", arguments: { id: "a" } })]);
    const harness = await createHarnessForRuntime(rootDir, llm, {
      runtime: {
        beforeToolCall: async () => ({
          allowed: false,
          reason: "manual approval needed",
        }),
      },
    });

    const result = await harness.run({
      goal: "check pause and cancel transitions",
      tools: [
        {
          name: "danger",
          description: "danger tool",
          async execute() {
            return { dangerous: true };
          },
        },
      ],
    });

    expect(result.status).toBe("approval_required");
    await expect(harness.pauseRun(result.runId)).rejects.toThrow(
      `Cannot pause run ${result.runId} from status approval_required`,
    );

    const canceled = await harness.cancelRun(result.runId);
    expect(canceled.status).toBe("canceled");
    expect((await harness.getRun(result.runId))?.status).toBe("canceled");
    expect((await harness.getCheckpoint(result.runId))?.stage).toBe("approval_required");
    await harness.destroy();
  });

  it("preserves the latest summary when an approval-required run is canceled through the runtime control plane", async () => {
    const rootDir = await createTempDir();
    const llm = createMockLLM([JSON.stringify({ tool: "delete", arguments: { id: 7 } })]);
    const harness = await createHarnessForRuntime(rootDir, llm, {
      runtime: {
        beforeToolCall: async () => ({
          allowed: false,
          reason: "manual approval required",
        }),
      },
    });

    const blocked = await harness.run({
      goal: "delete the record and summarize the terminal state",
      tools: [
        {
          name: "delete",
          description: "delete tool",
          async execute() {
            return { deleted: true };
          },
        },
      ],
    });

    expect(blocked.status).toBe("approval_required");
    await harness.cancelRun(blocked.runId);

    const summary = await harness.getLatestSummary(blocked.runId);
    expect(summary?.status).toBe("canceled");
    expect(summary?.headline).toContain("delete");

    const context = await harness.assembleContext(blocked.runId, {
      query: "terminal state",
      maxTokens: 2_000,
    });
    expect(context.summary?.status).toBe("canceled");
    expect(context.blocks.some((block) => block.kind === "summary")).toBe(true);
    await harness.destroy();
  });
});

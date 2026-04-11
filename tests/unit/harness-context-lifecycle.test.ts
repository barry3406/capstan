import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createHarness,
  openHarnessRuntime,
} from "../../packages/ai/src/index.ts";
import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "../../packages/ai/src/index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-context-lifecycle-"));
  tempDirs.push(dir);
  return dir;
}

function createMockLLM(responses: Array<string | Error>): LLMProvider {
  let index = 0;
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const next = responses[index] ?? responses[responses.length - 1] ?? "done";
      index++;
      if (next instanceof Error) {
        throw next;
      }
      const content = next;
      return { content, model: "mock-1" };
    },
  };
}

describe("createHarness context lifecycle", () => {
  it("persists paused session state and a resumable summary", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let beforeToolCallCount = 0;

    const harness = await createHarness({
      llm: createMockLLM([
        JSON.stringify({ tool: "step", arguments: { id: 1 } }),
        JSON.stringify({ tool: "step", arguments: { id: 2 } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async ({ runId }) => {
          beforeToolCallCount++;
          if (beforeToolCallCount === 2) {
            await runtime.pauseRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
      context: {
        maxPromptTokens: 400,
        reserveOutputTokens: 0,
      },
    });

    const paused = await harness.run({
      goal: "pause after the first tool call",
      tools: [
        {
          name: "step",
          description: "returns a step id",
          async execute(args) {
            return { ok: true, id: args.id };
          },
        },
      ],
    });

    expect(paused.runtimeStatus).toBe("paused");

    const sessionMemory = await harness.getSessionMemory(paused.runId);
    expect(sessionMemory?.status).toBe("paused");
    expect(sessionMemory?.currentPhase).toBe("paused");
    expect(sessionMemory?.recentSteps.some((step) => step.includes("\"id\":1"))).toBe(true);

    const summary = await harness.getLatestSummary(paused.runId);
    expect(summary?.status).toBe("paused");
    expect(summary?.kind).toBe("run_compact");
    expect(summary?.completedSteps.some((step) => step.includes("\"id\":1"))).toBe(true);

    const events = await harness.getEvents(paused.runId);
    expect(events.some((event) => event.type === "run_paused")).toBe(true);
    expect(events.some((event) => event.type === "summary_created")).toBe(true);

    await harness.destroy();
  });

  it("persists canceled session state and keeps the cancellation reason visible to the control plane", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let beforeToolCallCount = 0;

    const harness = await createHarness({
      llm: createMockLLM([
        JSON.stringify({ tool: "step", arguments: { id: 1 } }),
        JSON.stringify({ tool: "step", arguments: { id: 2 } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async ({ runId }) => {
          beforeToolCallCount++;
          if (beforeToolCallCount === 2) {
            await runtime.cancelRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
      context: {
        maxPromptTokens: 400,
        reserveOutputTokens: 0,
      },
    });

    const canceled = await harness.run({
      goal: "cancel after the first tool call",
      tools: [
        {
          name: "step",
          description: "returns a step id",
          async execute(args) {
            return { ok: true, id: args.id };
          },
        },
      ],
    });

    expect(canceled.runtimeStatus).toBe("canceled");

    const sessionMemory = await harness.getSessionMemory(canceled.runId);
    expect(sessionMemory?.status).toBe("canceled");
    expect(sessionMemory?.currentPhase).toBe("canceled");

    const summary = await harness.getLatestSummary(canceled.runId);
    expect(summary?.status).toBe("canceled");

    const runtimeView = await runtime.getRun(canceled.runId);
    expect(runtimeView?.status).toBe("canceled");

    await harness.destroy();
  });

  it("persists failure summaries with blocker text from run errors", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: createMockLLM([
        new Error("llm transport failed"),
      ]),
      runtime: { rootDir },
      verify: { enabled: false },
      context: {
        maxPromptTokens: 400,
        reserveOutputTokens: 0,
      },
    });

    await expect(
      harness.run({
        goal: "trigger a failure",
      }),
    ).rejects.toThrow("llm transport failed");

    const [failedRun] = await harness.listRuns();
    expect(failedRun?.status).toBe("failed");

    const sessionMemory = await harness.getSessionMemory(failedRun!.id);
    expect(sessionMemory?.status).toBe("failed");
    expect(sessionMemory?.blockers).toContain("llm transport failed");

    const summary = await harness.getLatestSummary(failedRun!.id);
    expect(summary?.status).toBe("failed");
    expect(summary?.blockers).toContain("llm transport failed");

    const contextPackage = await harness.assembleContext(failedRun!.id, {
      query: "boom blocker",
      maxTokens: 400,
    });
    expect(
      contextPackage.blocks.some((block) =>
        block.content.includes("llm transport failed"),
      ),
    ).toBe(true);

    await harness.destroy();
  });

  it("persists max-iteration summaries and makes them recallable after the run ends", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: createMockLLM([
        JSON.stringify({ tool: "step", arguments: { id: 1 } }),
        JSON.stringify({ tool: "step", arguments: { id: 2 } }),
        JSON.stringify({ tool: "step", arguments: { id: 3 } }),
      ]),
      runtime: { rootDir },
      verify: { enabled: false },
      context: {
        maxPromptTokens: 400,
        reserveOutputTokens: 0,
        autoPromoteSummaries: true,
      },
    });

    const capped = await harness.run({
      goal: "hit the iteration limit",
      maxIterations: 2,
      tools: [
        {
          name: "step",
          description: "returns a step id",
          async execute(args) {
            return { ok: true, id: args.id };
          },
        },
      ],
    });

    expect(capped.runtimeStatus).toBe("max_iterations");

    const sessionMemory = await harness.getSessionMemory(capped.runId);
    expect(sessionMemory?.status).toBe("max_iterations");
    expect(sessionMemory?.currentPhase).toBe("iteration_limit_reached");

    const summary = await harness.getLatestSummary(capped.runId);
    expect(summary?.status).toBe("max_iterations");
    expect(summary?.iterations).toBe(2);

    const recalled = await harness.recallMemory({
      query: "iteration limit summary",
      scopes: [{ type: "run", id: capped.runId }],
      kinds: ["summary"],
      limit: 5,
    });
    expect(recalled.some((record) => record.kind === "summary")).toBe(true);

    await harness.destroy();
  });
});

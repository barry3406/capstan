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
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-context-control-"));
  tempDirs.push(dir);
  return dir;
}

describe("openHarnessRuntime context control plane", () => {
  it("reads session memory, summaries, and assembled context for completed runs", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "report", arguments: {} }),
        "done",
      ]),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteObservations: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "create a report",
      tools: [
        {
          name: "report",
          description: "creates a report artifact",
          async execute() {
            return { status: "ok", body: "report body" };
          },
        },
      ],
    });

    const controlPlane = await openHarnessRuntime(rootDir);
    const sessionMemory = await controlPlane.getSessionMemory(result.runId);
    const summary = await controlPlane.getLatestSummary(result.runId);
    const assembled = await controlPlane.assembleContext(result.runId, {
      query: "report",
      maxTokens: 1_500,
    });

    expect(sessionMemory?.runId).toBe(result.runId);
    expect(summary?.runId).toBe(result.runId);
    expect(summary?.status).toBe("completed");
    expect(assembled.summary?.status).toBe("completed");
    expect(assembled.blocks.map((block) => block.kind)).toContain("session_memory");
  });

  it("recalls run-scoped memories through the control plane after the live harness is gone", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "large", arguments: { label: "x" } }),
        "done",
      ]),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteObservations: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "generate observations",
      tools: [
        {
          name: "large",
          description: "returns a large payload",
          async execute(args) {
            return {
              label: args.label,
              body: "x".repeat(800),
            };
          },
        },
      ],
    });
    await harness.destroy();

    const controlPlane = await openHarnessRuntime(rootDir);
    const memories = await controlPlane.recallMemory({
      query: "generate observations",
      scopes: [{ type: "run", id: result.runId }],
      limit: 10,
      minScore: 0,
    });

    expect(memories.some((memory) => memory.kind === "observation")).toBe(true);
    expect(memories.some((memory) => memory.kind === "summary")).toBe(true);
  });

  it("lists summaries by run and across runs", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        "first done",
        "second done",
      ]),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    const first = await harness.run({ goal: "first run" });
    const second = await harness.run({ goal: "second run" });

    const controlPlane = await openHarnessRuntime(rootDir);
    const all = await controlPlane.listSummaries();
    const justFirst = await controlPlane.listSummaries(first.runId);
    const justSecond = await controlPlane.listSummaries(second.runId);

    expect(all.map((summary) => summary.runId)).toEqual([second.runId, first.runId]);
    expect(justFirst).toHaveLength(1);
    expect(justFirst[0]?.runId).toBe(first.runId);
    expect(justSecond).toHaveLength(1);
    expect(justSecond[0]?.runId).toBe(second.runId);
  });

  it("surfaces assembleContext errors when a run has no checkpoint", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["done"]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const started = await harness.startRun({
      goal: "start but do not await yet",
    });
    await started.result;

    const controlPlane = await openHarnessRuntime(rootDir);

    await expect(
      controlPlane.assembleContext("missing-run", {
        query: "anything",
      }),
    ).rejects.toThrow("Harness run not found: missing-run");
  });

  it("reflects paused-state context through an independent control plane before resume", async () => {
    const rootDir = await createTempDir();
    const controlPlane = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "finished after pause",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            await controlPlane.pauseRun(runId);
          }
          return { allowed: true };
        },
      },
      context: {
        enabled: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    const paused = await harness.run({
      goal: "pause for control-plane inspection",
      tools: [
        {
          name: "step",
          description: "records a step",
          async execute(args) {
            return { value: args.value };
          },
        },
      ],
    });

    expect(paused.runtimeStatus).toBe("paused");

    const pausedSummary = await controlPlane.getLatestSummary(paused.runId);
    const pausedContext = await controlPlane.assembleContext(paused.runId, {
      query: "paused state",
      maxTokens: 1_500,
    });

    expect(pausedSummary?.status).toBe("paused");
    expect(pausedContext.sessionMemory?.status).toBe("paused");
    expect(pausedContext.summary?.status).toBe("paused");
  });
});

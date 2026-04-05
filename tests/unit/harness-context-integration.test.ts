import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createHarness, openHarnessRuntime } from "@zauso-ai/capstan-ai";
import type {
  HarnessMemoryMatch,
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
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-context-integration-"));
  tempDirs.push(dir);
  return dir;
}

async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs = 1_000,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await fn();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

function memoryKinds(memories: HarnessMemoryMatch[]): string[] {
  return memories.map((memory) => memory.kind).sort();
}

describe("createHarness context kernel integration", () => {
  it("persists compaction, summaries, observations, and recallable memory for a completed run", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "large", arguments: { label: "alpha" } }),
        JSON.stringify({ tool: "large", arguments: { label: "beta" } }),
        "done",
      ]),
      runtime: { rootDir },
      context: {
        enabled: true,
        maxPromptTokens: 800,
        reserveOutputTokens: 120,
        maxRecentMessages: 4,
        maxRecentToolResults: 1,
        sessionCompactThreshold: 0.4,
        microcompactToolResultChars: 80,
        autoPromoteObservations: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    try {
      const result = await harness.run({
        goal: "process a lot of output",
        tools: [
          {
            name: "large",
            description: "returns a large payload",
            async execute(args) {
              return {
                label: args.label,
                body: String(args.label).repeat(800),
              };
            },
          },
        ],
      });

      expect(result.runtimeStatus).toBe("completed");

      const sessionMemory = await harness.getSessionMemory(result.runId);
      expect(sessionMemory).toBeDefined();
      expect(sessionMemory?.recentSteps).toHaveLength(2);

      const summary = await harness.getLatestSummary(result.runId);
      expect(summary).toBeDefined();
      expect(summary?.status).toBe("completed");
      expect(summary?.kind).toBe("run_compact");

      const memories = await harness.recallMemory({
        query: "large output process",
        scopes: [{ type: "run", id: result.runId }],
        limit: 10,
        minScore: 0,
      });
      expect(memoryKinds(memories)).toContain("observation");
      expect(memoryKinds(memories)).toContain("summary");

      const context = await harness.assembleContext(result.runId, {
        query: "large output process",
        maxTokens: 2_000,
      });
      expect(context.blocks.map((block) => block.kind)).toContain("session_memory");
      expect(context.summary?.status).toBe("completed");
      expect(context.memories.length).toBeGreaterThan(0);

      const events = await harness.getEvents(result.runId);
      expect(events.map((event) => event.type)).toContain("context_compacted");
      expect(events.map((event) => event.type)).toContain("summary_created");
      expect(events.map((event) => event.type)).toContain("memory_stored");

      const controlPlane = await openHarnessRuntime(rootDir);
      expect((await controlPlane.getSessionMemory(result.runId))?.runId).toBe(result.runId);
      expect((await controlPlane.getLatestSummary(result.runId))?.status).toBe("completed");
      expect((await controlPlane.assembleContext(result.runId)).blocks.length).toBeGreaterThan(0);
    } finally {
      await harness.destroy();
    }
  });

  it("captures approval-blocked state in session memory and refreshes summaries after resume", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "delete", arguments: { id: "123" } }),
        "approval received and work completed",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "delete requires human approval",
        }),
      },
      context: {
        enabled: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    try {
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

      const blockedSession = await harness.getSessionMemory(blocked.runId);
      expect(blockedSession?.pendingApproval).toEqual({
        tool: "delete",
        reason: "delete requires human approval",
      });

      const blockedContext = await harness.assembleContext(blocked.runId, {
        query: "pending approval",
        maxTokens: 1_500,
      });
      expect(blockedContext.sessionMemory?.openQuestions).toContain(
        "Should delete be approved?",
      );

      const resumed = await harness.resumeRun(blocked.runId, {
        approvePendingTool: true,
        runConfig: {
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
        },
      });

      expect(resumed.runtimeStatus).toBe("completed");
      const summary = await harness.getLatestSummary(blocked.runId);
      expect(summary?.status).toBe("completed");
      expect(summary?.kind).toBe("run_compact");
    } finally {
      await harness.destroy();
    }
  });

  it("persists paused state context and refreshes it after resume", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done after resume",
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
      context: {
        enabled: true,
        autoPromoteObservations: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    try {
      const paused = await harness.run({
        goal: "pause midway",
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
      expect((await harness.getLatestSummary(paused.runId))?.status).toBe("paused");

      const resumed = await harness.resumeRun(paused.runId, {
        runConfig: {
          goal: "pause midway",
          tools: [
            {
              name: "step",
              description: "records a step",
              async execute(args) {
                return { value: args.value };
              },
            },
          ],
        },
      });

      expect(resumed.runtimeStatus).toBe("completed");
      expect((await harness.getLatestSummary(paused.runId))?.status).toBe("completed");
      expect((await harness.getSessionMemory(paused.runId))?.status).toBe("completed");
    } finally {
      await harness.destroy();
    }
  });

  it("captures failed runs into context state and exposes them through the control plane", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        new Error("model crashed"),
      ]),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    try {
      await expect(
        harness.run({
          goal: "trigger a failure",
          tools: [
            {
              name: "step",
              description: "records a step",
              async execute(args) {
                return { value: args.value };
              },
            },
          ],
        }),
      ).rejects.toThrow("model crashed");

      const failedRun = await waitFor(async () => {
        const runs = await harness.listRuns();
        return runs.find((entry) => entry.goal === "trigger a failure");
      });
      expect(failedRun.status).toBe("failed");

      const summary = await harness.getLatestSummary(failedRun.id);
      expect(summary?.status).toBe("failed");

      const controlPlane = await openHarnessRuntime(rootDir);
      const assembled = await controlPlane.assembleContext(failedRun.id, {
        query: "failure context",
        maxTokens: 1_500,
      });
      expect(assembled.summary?.status).toBe("failed");
      expect(assembled.blocks.map((block) => block.kind)).toContain("summary");
    } finally {
      await harness.destroy();
    }
  });

  it("treats disabled context as a no-op and emits no stage-two lifecycle events", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["final answer"]),
      runtime: { rootDir },
      context: {
        enabled: false,
      },
      verify: { enabled: false },
    });

    try {
      const result = await harness.run({ goal: "no context please" });
      expect(result.runtimeStatus).toBe("completed");
      expect(await harness.getSessionMemory(result.runId)).toBeUndefined();
      expect(await harness.getLatestSummary(result.runId)).toBeUndefined();
      expect(
        await harness.recallMemory({
          query: "anything",
          scopes: [{ type: "run", id: result.runId }],
          limit: 10,
          minScore: 0,
        }),
      ).toEqual([]);

      const events = await harness.getEvents(result.runId);
      expect(events.map((event) => event.type)).not.toContain("summary_created");
      expect(events.map((event) => event.type)).not.toContain("memory_stored");
      expect(events.map((event) => event.type)).not.toContain("context_compacted");
    } finally {
      await harness.destroy();
    }
  });
});

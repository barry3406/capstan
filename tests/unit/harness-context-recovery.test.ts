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
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-context-recovery-"));
  tempDirs.push(dir);
  return dir;
}

describe("Harness context recovery semantics", () => {
  it("keeps one run-summary memory across pause then resume", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done after pause",
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
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    const paused = await harness.run({
      goal: "pause once",
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

    const pausedSummary = await harness.getLatestSummary(paused.runId);
    const pausedMemories = await harness.recallMemory({
      query: "pause once",
      scopes: [{ type: "run", id: paused.runId }],
      kinds: ["summary"],
      limit: 10,
      minScore: 0,
    });
    expect(pausedMemories).toHaveLength(1);

    const resumed = await harness.resumeRun(paused.runId, {
      runConfig: {
        goal: "pause once",
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

    const completedSummary = await harness.getLatestSummary(paused.runId);
    const completedMemories = await harness.recallMemory({
      query: "pause once",
      scopes: [{ type: "run", id: paused.runId }],
      kinds: ["summary"],
      limit: 10,
      minScore: 0,
    });

    expect(completedSummary?.id).toBe(pausedSummary?.id);
    expect(completedSummary?.status).toBe("completed");
    expect(completedMemories).toHaveLength(1);
    expect(completedMemories[0]?.id).toBe(pausedMemories[0]?.id);
  });

  it("persists canceled approval-required runs as stable run summaries without duplicate memories", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "danger", arguments: { id: "123" } }),
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "human approval required",
        }),
      },
      context: {
        enabled: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "dangerous task",
      tools: [
        {
          name: "danger",
          description: "dangerous tool",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });
    expect(blocked.runtimeStatus).toBe("approval_required");

    await harness.cancelRun(blocked.runId);
    await harness.cancelRun(blocked.runId);

    const summary = await harness.getLatestSummary(blocked.runId);
    const memories = await harness.recallMemory({
      query: "dangerous task",
      scopes: [{ type: "run", id: blocked.runId }],
      kinds: ["summary"],
      limit: 10,
      minScore: 0,
    });

    expect(summary?.status).toBe("canceled");
    expect(memories).toHaveLength(1);
  });

  it("assembleContext after resume never leaves stale transcript summary markers behind", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "large", arguments: { label: "alpha" } }),
        JSON.stringify({ tool: "large", arguments: { label: "beta" } }),
        "done after compaction",
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
        maxPromptTokens: 260,
        reserveOutputTokens: 40,
        maxRecentMessages: 4,
        maxRecentToolResults: 1,
        sessionCompactThreshold: 0.4,
        microcompactToolResultChars: 80,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    const paused = await harness.run({
      goal: "compact and resume",
      tools: [
        {
          name: "large",
          description: "returns large payloads",
          async execute(args) {
            return { body: String(args.label).repeat(900) };
          },
        },
      ],
    });
    expect(paused.runtimeStatus).toBe("paused");

    const resumed = await harness.resumeRun(paused.runId, {
      runConfig: {
        goal: "compact and resume",
        tools: [
          {
            name: "large",
            description: "returns large payloads",
            async execute(args) {
              return { body: String(args.label).repeat(900) };
            },
          },
        ],
      },
    });
    expect(resumed.runtimeStatus).toBe("completed");

    const assembled = await harness.assembleContext(paused.runId, {
      query: "compact and resume",
      maxTokens: 1_500,
    });
    expect(
      assembled.transcriptTail.some((message) =>
        message.content.startsWith("[HARNESS_SUMMARY]"),
      ),
    ).toBe(false);
  });

  it("refreshes context state in a new control-plane instance after run completion", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["done"]),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    const result = await harness.run({ goal: "fresh control-plane state" });
    const firstControlPlane = await openHarnessRuntime(rootDir);
    const secondControlPlane = await openHarnessRuntime(rootDir);

    const firstSummary = await firstControlPlane.getLatestSummary(result.runId);
    const secondSummary = await secondControlPlane.getLatestSummary(result.runId);
    const firstContext = await firstControlPlane.assembleContext(result.runId, {
      query: "fresh control-plane state",
      maxTokens: 1_500,
    });
    const secondContext = await secondControlPlane.assembleContext(result.runId, {
      query: "fresh control-plane state",
      maxTokens: 1_500,
    });

    expect(firstSummary?.status).toBe("completed");
    expect(secondSummary?.status).toBe("completed");
    expect(firstContext.summary?.id).toBe(secondContext.summary?.id);
    expect(firstContext.sessionMemory?.runId).toBe(result.runId);
    expect(secondContext.sessionMemory?.runId).toBe(result.runId);
  });
});

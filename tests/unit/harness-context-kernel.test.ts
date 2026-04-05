import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  FileHarnessRuntimeStore,
} from "../../packages/ai/src/index.ts";
import { HarnessContextKernel } from "../../packages/ai/src/harness/context/kernel.ts";
import type {
  AgentLoopCheckpoint,
  HarnessRunRecord,
  HarnessSessionMemoryRecord,
} from "../../packages/ai/src/index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-context-kernel-"));
  tempDirs.push(dir);
  return dir;
}

function buildRunRecord(
  runId: string,
  overrides: Partial<HarnessRunRecord> = {},
): HarnessRunRecord {
  const now = new Date().toISOString();
  return {
    id: runId,
    goal: "investigate the runtime",
    status: "running",
    createdAt: now,
    updatedAt: now,
    iterations: 0,
    toolCalls: 0,
    taskCalls: 0,
    maxIterations: 10,
    toolNames: ["lookup"],
    taskNames: [],
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: "local",
      mode: "test",
      browser: false,
      fs: false,
      artifactDir: "/tmp/artifacts",
    },
    lastEventSequence: 0,
    ...overrides,
  };
}

function toolResultMessage(tool: string, result: unknown): string {
  return `Tool "${tool}" returned:\n${JSON.stringify(result, null, 2)}`;
}

function buildCheckpoint(
  overrides: Partial<AgentLoopCheckpoint> = {},
): AgentLoopCheckpoint {
  return {
    stage: "tool_result",
    config: {
      goal: "investigate the runtime",
      maxIterations: 10,
    },
    messages: [
      {
        role: "system",
        content: "You are a rigorous agent. Use tools and summarize clearly.",
      },
      {
        role: "user",
        content: "Investigate the runtime and summarize what happened.",
      },
    ],
    iterations: 0,
    toolCalls: [],
    ...overrides,
  };
}

function buildSessionMemoryRecord(
  runId: string,
  overrides: Partial<HarnessSessionMemoryRecord> = {},
): HarnessSessionMemoryRecord {
  const now = new Date().toISOString();
  return {
    runId,
    goal: "investigate the runtime",
    status: "running",
    updatedAt: now,
    sourceRunUpdatedAt: now,
    headline: "session headline",
    currentPhase: "reasoning",
    recentSteps: ["step-one"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    compactedMessages: 0,
    tokenEstimate: 16,
    ...overrides,
  };
}

async function createStoreAndKernel(
  context?: Parameters<typeof HarnessContextKernel>[1],
) {
  const rootDir = await createTempDir();
  const store = new FileHarnessRuntimeStore(rootDir);
  await store.initialize();
  const kernel = new HarnessContextKernel(store, context);
  await kernel.initialize();
  return { rootDir, store, kernel };
}

async function persistRunAndCheckpoint(params?: {
  context?: Parameters<typeof HarnessContextKernel>[1];
  run?: Partial<HarnessRunRecord>;
  checkpoint?: Partial<AgentLoopCheckpoint>;
}) {
  const { store, kernel } = await createStoreAndKernel(params?.context);
  const runId = params?.run?.id ?? "run-1";
  const run = buildRunRecord(runId, params?.run);
  const checkpoint = buildCheckpoint(params?.checkpoint);
  await store.persistRun(run);
  await store.persistCheckpoint(runId, checkpoint);
  return { store, kernel, runId, run, checkpoint };
}

describe("HarnessContextKernel", () => {
  it("delegates memory persistence with deduplication and recall", async () => {
    const { kernel } = await createStoreAndKernel();

    const first = await kernel.rememberMemory({
      scope: { type: "project", id: "capstan" },
      kind: "fact",
      content: "  Context budgets should stay deterministic  ",
      metadata: { source: "test" },
    });
    const second = await kernel.rememberMemory({
      scope: { type: "project", id: "capstan" },
      kind: "fact",
      content: "context   budgets should stay deterministic",
      metadata: { source: "override" },
    });

    expect(second.id).toBe(first.id);

    const recalled = await kernel.recallMemory({
      query: "context budgets deterministic",
      scopes: [{ type: "project", id: "capstan" }],
      limit: 5,
    });

    expect(recalled).toHaveLength(1);
    expect(recalled[0]!.content).toBe("context   budgets should stay deterministic");
    expect(recalled[0]!.metadata).toEqual({ source: "override" });
    expect(recalled[0]!.accessCount).toBe(1);
  });

  it("microcompacts stale tool result messages while preserving recent results", async () => {
    const hugeA = "A".repeat(500);
    const hugeB = "B".repeat(500);
    const hugeC = "C".repeat(120);

    const { kernel, runId } = await persistRunAndCheckpoint({
      context: {
        maxPromptTokens: 5000,
        reserveOutputTokens: 0,
        maxRecentToolResults: 1,
        microcompactToolResultChars: 40,
        sessionCompactThreshold: 0.99,
      },
      checkpoint: {
        iterations: 3,
        toolCalls: [
          { tool: "lookup", args: { id: 1 }, result: { body: hugeA } },
          { tool: "lookup", args: { id: 2 }, result: { body: hugeB } },
          { tool: "lookup", args: { id: 3 }, result: { body: hugeC } },
        ],
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":1}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeA }) },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":2}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeB }) },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":3}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeC }) },
        ],
      },
    });

    const update = await kernel.handleCheckpoint({
      runId,
      checkpoint: buildCheckpoint({
        iterations: 3,
        toolCalls: [
          { tool: "lookup", args: { id: 1 }, result: { body: hugeA } },
          { tool: "lookup", args: { id: 2 }, result: { body: hugeB } },
          { tool: "lookup", args: { id: 3 }, result: { body: hugeC } },
        ],
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":1}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeA }) },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":2}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeB }) },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":3}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeC }) },
        ],
      }),
    });

    expect(update.summary).toBeUndefined();
    expect(update.compaction).toEqual({
      kind: "microcompact",
      previousTokens: expect.any(Number),
      nextTokens: expect.any(Number),
      compactedMessages: 2,
    });
    expect(update.checkpoint.messages[3]!.content).toContain("[microcompacted tool result]");
    expect(update.checkpoint.messages[5]!.content).toContain("[microcompacted tool result]");
    expect(update.checkpoint.messages[7]!.content).not.toContain("[microcompacted tool result]");

    const sessionMemory = await kernel.getSessionMemory(runId);
    expect(sessionMemory).toBeDefined();
    expect(sessionMemory!.compactedMessages).toBe(2);
    expect(sessionMemory!.recentSteps).toHaveLength(3);
  });

  it("microcompacts every stale tool result when maxRecentToolResults is zero", async () => {
    const hugeA = "A".repeat(500);
    const hugeB = "B".repeat(500);
    const hugeC = "C".repeat(500);

    const { kernel, runId } = await persistRunAndCheckpoint({
      context: {
        maxPromptTokens: 5000,
        reserveOutputTokens: 0,
        maxRecentToolResults: 0,
        microcompactToolResultChars: 40,
        sessionCompactThreshold: 0.99,
      },
      checkpoint: {
        iterations: 3,
        toolCalls: [
          { tool: "lookup", args: { id: 1 }, result: { body: hugeA } },
          { tool: "lookup", args: { id: 2 }, result: { body: hugeB } },
          { tool: "lookup", args: { id: 3 }, result: { body: hugeC } },
        ],
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":1}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeA }) },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":2}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeB }) },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":3}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeC }) },
        ],
      },
    });

    const update = await kernel.handleCheckpoint({
      runId,
      checkpoint: buildCheckpoint({
        iterations: 3,
        toolCalls: [
          { tool: "lookup", args: { id: 1 }, result: { body: hugeA } },
          { tool: "lookup", args: { id: 2 }, result: { body: hugeB } },
          { tool: "lookup", args: { id: 3 }, result: { body: hugeC } },
        ],
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":1}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeA }) },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":2}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeB }) },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":3}}" },
          { role: "user", content: toolResultMessage("lookup", { body: hugeC }) },
        ],
      }),
    });

    expect(update.summary).toBeUndefined();
    expect(update.compaction).toEqual({
      kind: "microcompact",
      previousTokens: expect.any(Number),
      nextTokens: expect.any(Number),
      compactedMessages: 3,
    });
    expect(update.checkpoint.messages[3]!.content).toContain("[microcompacted tool result]");
    expect(update.checkpoint.messages[5]!.content).toContain("[microcompacted tool result]");
    expect(update.checkpoint.messages[7]!.content).toContain("[microcompacted tool result]");
  });

  it("microcompacts tool-result transcript messages even when the richer engine uses a non-user role", async () => {
    const hugePayload = "X".repeat(400);

    const { kernel, runId } = await persistRunAndCheckpoint({
      context: {
        maxPromptTokens: 5000,
        reserveOutputTokens: 0,
        maxRecentToolResults: 0,
        microcompactToolResultChars: 32,
        sessionCompactThreshold: 0.99,
      },
      checkpoint: {
        iterations: 1,
        toolCalls: [
          { tool: "lookup", args: { id: 1 }, result: { body: hugePayload } },
        ],
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":1}}" },
          { role: "tool" as any, content: toolResultMessage("lookup", { body: hugePayload }) },
        ],
      },
    });

    const update = await kernel.handleCheckpoint({
      runId,
      checkpoint: buildCheckpoint({
        iterations: 1,
        toolCalls: [
          { tool: "lookup", args: { id: 1 }, result: { body: hugePayload } },
        ],
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":1}}" },
          { role: "tool" as any, content: toolResultMessage("lookup", { body: hugePayload }) },
        ],
      }),
    });

    expect(update.compaction?.kind).toBe("microcompact");
    expect(update.checkpoint.messages[3]!.content).toContain("[microcompacted tool result]");
  });

  it("session compacts oversized checkpoints and promotes a summary memory", async () => {
    const bigResult = "result ".repeat(120).trim();
    const messages = [
      { role: "system" as const, content: "You are a careful agent." },
      { role: "user" as const, content: "Investigate the runtime." },
      { role: "assistant" as const, content: "{\"tool\":\"lookup\",\"arguments\":{\"page\":1}}" },
      { role: "user" as const, content: toolResultMessage("lookup", { body: bigResult }) },
      { role: "assistant" as const, content: "{\"tool\":\"lookup\",\"arguments\":{\"page\":2}}" },
      { role: "user" as const, content: toolResultMessage("lookup", { body: bigResult }) },
      { role: "assistant" as const, content: "{\"tool\":\"lookup\",\"arguments\":{\"page\":3}}" },
      { role: "user" as const, content: toolResultMessage("lookup", { body: bigResult }) },
      { role: "assistant" as const, content: "Working through the findings" },
    ];

    const { kernel, runId } = await persistRunAndCheckpoint({
      context: {
        maxPromptTokens: 220,
        reserveOutputTokens: 0,
        maxRecentMessages: 2,
        maxRecentToolResults: 1,
        microcompactToolResultChars: 50,
        sessionCompactThreshold: 0.25,
        autoPromoteSummaries: true,
      },
      checkpoint: {
        iterations: 3,
        lastAssistantResponse: "Working through the findings",
        toolCalls: [
          { tool: "lookup", args: { page: 1 }, result: { body: bigResult } },
          { tool: "lookup", args: { page: 2 }, result: { body: bigResult } },
          { tool: "lookup", args: { page: 3 }, result: { body: bigResult } },
        ],
        messages,
      },
    });

    const update = await kernel.handleCheckpoint({
      runId,
      checkpoint: buildCheckpoint({
        iterations: 3,
        lastAssistantResponse: "Working through the findings",
        toolCalls: [
          { tool: "lookup", args: { page: 1 }, result: { body: bigResult } },
          { tool: "lookup", args: { page: 2 }, result: { body: bigResult } },
          { tool: "lookup", args: { page: 3 }, result: { body: bigResult } },
        ],
        messages,
      }),
    });

    expect(update.summary).toBeDefined();
    expect(update.summary!.kind).toBe("session_compact");
    expect(update.promotedMemories).toHaveLength(1);
    expect(update.promotedMemories[0]!.kind).toBe("summary");
    expect(update.compaction?.kind).toBe("session_compact");
    expect(update.checkpoint.messages.some((msg) => msg.content.startsWith("[HARNESS_SUMMARY]"))).toBe(true);
    expect(update.checkpoint.messages.length).toBeLessThan(messages.length);

    const storedSummary = await kernel.getLatestSummary(runId);
    expect(storedSummary).toEqual(update.summary);
  });

  it("preserves every leading system prompt and the goal message when session compaction rewrites the transcript", async () => {
    const messages = [
      { role: "system" as const, content: "system prompt one" },
      { role: "system" as const, content: "system prompt two" },
      { role: "user" as const, content: "goal" },
      { role: "assistant" as const, content: "middle assistant" },
      { role: "user" as const, content: "middle user" },
      { role: "assistant" as const, content: "tail assistant" },
      { role: "user" as const, content: "tail user" },
    ];

    const { kernel, runId } = await persistRunAndCheckpoint({
      context: {
        maxPromptTokens: 120,
        reserveOutputTokens: 0,
        maxRecentMessages: 2,
        sessionCompactThreshold: 0.15,
      },
      checkpoint: {
        iterations: 3,
        messages,
      },
    });

    const update = await kernel.handleCheckpoint({
      runId,
      checkpoint: buildCheckpoint({
        iterations: 3,
        messages,
      }),
    });

    expect(update.summary).toBeDefined();
    expect(update.checkpoint.messages[0]!.content).toBe("system prompt one");
    expect(update.checkpoint.messages[1]!.content).toBe("system prompt two");
    expect(update.checkpoint.messages[2]!.role).toBe("user");
    expect(update.checkpoint.messages[2]!.content).toBe("goal");
    expect(update.checkpoint.messages[3]!.content).toContain("[HARNESS_SUMMARY]");
  });

  it("captureRunState persists a terminal summary and promoted memory", async () => {
    const { kernel, runId, store } = await persistRunAndCheckpoint({
      run: {
        status: "completed",
        updatedAt: "2026-04-03T12:00:00.000Z",
      },
      checkpoint: {
        iterations: 2,
        stage: "completed",
        lastAssistantResponse: "done",
        toolCalls: [
          { tool: "lookup", args: { id: 1 }, result: { ok: true } },
        ],
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":1}}" },
          { role: "user", content: toolResultMessage("lookup", { ok: true }) },
          { role: "assistant", content: "done" },
        ],
      },
    });

    await store.writeArtifact(runId, {
      kind: "note",
      content: "artifact preview text",
      extension: ".txt",
      mimeType: "text/plain",
    });

    const captured = await kernel.captureRunState(runId);

    expect(captured.summary).toBeDefined();
    expect(captured.summary!.kind).toBe("run_compact");
    expect(captured.promotedMemories).toHaveLength(1);
    expect(captured.promotedMemories[0]!.kind).toBe("summary");
    expect(captured.sessionMemory.status).toBe("completed");

    const storedSummary = await kernel.getLatestSummary(runId);
    expect(storedSummary?.status).toBe("completed");

    const recalled = await kernel.recallMemory({
      query: "run summary done",
      scopes: [{ type: "run", id: runId }],
      limit: 5,
    });
    expect(recalled.some((entry) => entry.kind === "summary")).toBe(true);
  });

  it("captures running state without creating a summary", async () => {
    const { kernel, runId } = await persistRunAndCheckpoint({
      run: {
        status: "running",
      },
      checkpoint: {
        iterations: 1,
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "still working" },
        ],
      },
    });

    const captured = await kernel.captureRunState(runId);

    expect(captured.sessionMemory.status).toBe("running");
    expect(captured.summary).toBeUndefined();
    expect(captured.promotedMemories).toEqual([]);
    expect(await kernel.getLatestSummary(runId)).toBeUndefined();
  });

  it("falls back to the latest assistant transcript content when lastAssistantResponse is absent", async () => {
    const { kernel, runId } = await persistRunAndCheckpoint({
      checkpoint: {
        stage: "tool_result",
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "latest assistant reasoning" },
          { role: "tool" as any, content: toolResultMessage("lookup", { ok: true }) },
        ],
      },
    });

    const update = await kernel.handleCheckpoint({
      runId,
      checkpoint: buildCheckpoint({
        stage: "tool_result",
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "latest assistant reasoning" },
          { role: "tool" as any, content: toolResultMessage("lookup", { ok: true }) },
        ],
      }),
    });

    expect(update.sessionMemory.headline).toBe("latest assistant reasoning");
    expect(update.sessionMemory.lastAssistantResponse).toBe("latest assistant reasoning");
  });

  it("records high severity observations when tool results contain errors", async () => {
    const { kernel } = await createStoreAndKernel({
      autoPromoteObservations: true,
    });

    const memory = await kernel.recordObservation({
      runId: "run-error",
      tool: "lookup",
      args: { page: 1 },
      result: { error: "boom" },
    });

    expect(memory).toBeDefined();
    expect(memory!.kind).toBe("observation");
    expect(memory!.importance).toBe("high");
    expect(memory!.metadata).toEqual({
      tool: "lookup",
      error: true,
    });

    const recalled = await kernel.recallMemory({
      query: "lookup boom",
      scopes: [{ type: "run", id: "run-error" }],
      runId: "run-error",
      kinds: ["observation"],
      limit: 5,
    });
    expect(recalled).toHaveLength(1);
    expect(recalled[0]!.metadata).toEqual({
      tool: "lookup",
      error: true,
    });
  });

  it("skips observation persistence when auto-promotions are disabled", async () => {
    const { kernel } = await createStoreAndKernel({
      autoPromoteObservations: false,
    });

    await expect(
      kernel.recordObservation({
        runId: "run-disabled",
        tool: "lookup",
        args: { page: 1 },
        result: { error: "boom" },
      }),
    ).resolves.toBeUndefined();

    const recalled = await kernel.recallMemory({
      query: "lookup boom",
      scopes: [{ type: "run", id: "run-disabled" }],
      runId: "run-disabled",
      kinds: ["observation"],
      limit: 5,
    });
    expect(recalled).toEqual([]);
  });

  it("assembleContext includes session memory, summary, memories, and artifact previews", async () => {
    const { kernel, runId, store } = await persistRunAndCheckpoint({
      checkpoint: {
        iterations: 2,
        lastAssistantResponse: "final answer",
        toolCalls: [
          { tool: "lookup", args: { id: 1 }, result: { detail: "alpha" } },
        ],
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":1}}" },
          { role: "user", content: toolResultMessage("lookup", { detail: "alpha" }) },
          { role: "assistant", content: "final answer" },
        ],
      },
    });

    await kernel.handleCheckpoint({
      runId,
      checkpoint: buildCheckpoint({
        iterations: 2,
        lastAssistantResponse: "final answer",
        toolCalls: [
          { tool: "lookup", args: { id: 1 }, result: { detail: "alpha" } },
        ],
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":1}}" },
          { role: "user", content: toolResultMessage("lookup", { detail: "alpha" }) },
          { role: "assistant", content: "final answer" },
        ],
      }),
    });
    await store.persistSummary({
      id: `summary_${runId}`,
      runId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceRunUpdatedAt: new Date().toISOString(),
      kind: "run_compact",
      status: "completed",
      headline: "final answer",
      completedSteps: ["lookup finished"],
      blockers: [],
      openQuestions: [],
      artifactRefs: [],
      iterations: 2,
      toolCalls: 1,
      messageCount: 5,
      compactedMessages: 0,
    });
    await kernel.rememberMemory({
      scope: { type: "project", id: store.paths.rootDir },
      kind: "fact",
      content: "Project memory says the runtime favors deterministic state.",
    });
    await store.writeArtifact(runId, {
      kind: "note",
      content: "Artifact body for preview",
      extension: ".txt",
      mimeType: "text/plain",
    });
    await store.writeArtifact(runId, {
      kind: "screenshot",
      content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      extension: ".png",
      mimeType: "image/png",
    });

    const contextPackage = await kernel.assembleContext(runId, {
      query: "deterministic runtime preview",
      maxTokens: 400,
      maxArtifacts: 4,
      maxGraphNodes: 0,
    });

    expect(contextPackage.blocks.map((block) => block.title)).toEqual([
      "Session Memory",
      "Run Summary",
      "Artifacts",
      "Relevant Memory",
    ]);
    expect(contextPackage.blocks[2]!.content).toContain("Artifact body for preview");
    expect(contextPackage.blocks[3]!.content).toContain("deterministic state");
    expect(contextPackage.blocks[2]!.content).toContain("image/png");
    expect(contextPackage.omitted).toEqual([]);
  });

  it("assembleContext records omitted blocks when the token budget is exhausted", async () => {
    const { kernel, runId, store } = await persistRunAndCheckpoint();

    await store.persistSessionMemory(
      buildSessionMemoryRecord(runId, {
        headline: "Session memory should dominate the budget",
        recentSteps: ["one", "two", "three"],
      }),
    );
    await store.persistSummary({
      id: `summary_${runId}`,
      runId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceRunUpdatedAt: new Date().toISOString(),
      kind: "run_compact",
      status: "completed",
      headline: "A long summary block",
      completedSteps: ["alpha", "beta", "gamma", "delta"],
      blockers: [],
      openQuestions: [],
      artifactRefs: [],
      iterations: 3,
      toolCalls: 2,
      messageCount: 5,
      compactedMessages: 1,
    });
    await kernel.rememberMemory({
      scope: { type: "run", id: runId },
      content: "Memory entry that likely will not fit in a tiny budget",
    });

    const contextPackage = await kernel.assembleContext(runId, {
      query: "memory",
      maxTokens: 20,
    });

    expect(contextPackage.blocks.length).toBeLessThanOrEqual(1);
    expect(contextPackage.omitted.length).toBeGreaterThan(0);
    expect(contextPackage.omitted.every((entry) => entry.reason === "token_budget_exceeded")).toBe(true);
  });

  it("assembleContext includes graph-scoped runtime nodes in the graph context block", async () => {
    const { kernel, runId, store } = await persistRunAndCheckpoint({
      run: {
        goal: "inspect graph-aware runtime context",
      },
    });

    await store.upsertGraphNode({
      id: "turn:run-1:graph-note",
      kind: "turn",
      scope: { kind: "run", runId },
      title: "Graph note: runtime context",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runId,
      status: "sampling_model",
      summary: "graph-aware runtime context",
      content: "This node should be selected by graph-aware retrieval.",
      metadata: { source: "test" },
    });

    const contextPackage = await kernel.assembleContext(runId, {
      query: "runtime context",
      maxTokens: 400,
    });

    expect(contextPackage.graphNodes.map((node) => node.id)).toContain("turn:run-1:graph-note");
    expect(contextPackage.blocks.map((block) => block.kind)).toContain("graph");
    expect(contextPackage.blocks.map((block) => block.title)).toContain("Graph State");
  });

  it("prepareMessages injects runtime context and trims stale transcript middle sections", async () => {
    const { kernel, runId, store } = await persistRunAndCheckpoint({
      context: {
        maxPromptTokens: 400,
        reserveOutputTokens: 0,
        maxRecentMessages: 3,
      },
      checkpoint: {
        iterations: 4,
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "middle assistant one" },
          { role: "user", content: "middle user one" },
          { role: "system", content: "[HARNESS_SUMMARY]\nStatus: completed" },
          { role: "assistant", content: "middle assistant two" },
          { role: "user", content: "middle user two" },
          { role: "assistant", content: "tail assistant" },
          { role: "user", content: "tail user" },
        ],
      },
    });

    await store.persistSessionMemory(
      buildSessionMemoryRecord(runId, {
        headline: "session headline",
        recentSteps: ["tail assistant", "tail user"],
      }),
    );

    const prepared = await kernel.prepareMessages({
      runId,
      checkpoint: buildCheckpoint({
        iterations: 4,
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "middle assistant one" },
          { role: "user", content: "middle user one" },
          { role: "system", content: "[HARNESS_SUMMARY]\nStatus: completed" },
          { role: "assistant", content: "middle assistant two" },
          { role: "user", content: "middle user two" },
          { role: "assistant", content: "tail assistant" },
          { role: "user", content: "tail user" },
        ],
      }),
      query: "session headline",
    });

    expect(prepared[0]!.content).toBe("system prompt");
    expect(prepared[1]!.role).toBe("system");
    expect(prepared[1]!.content).toContain("Runtime context below is authoritative");
    expect(prepared.some((message) => message.content === "middle assistant one")).toBe(false);
    expect(prepared.some((message) => message.content === "middle user one")).toBe(false);
    expect(prepared.some((message) => message.content === "tail assistant")).toBe(true);
    expect(prepared.some((message) => message.content === "tail user")).toBe(true);
    expect(
      prepared.some((message) => message.content.includes("session headline")) ||
        prepared.some((message) => message.content.includes("[HARNESS_SUMMARY]")),
    ).toBe(true);
  });

  it("prepends runtime context when the transcript has no leading system prompt", async () => {
    const { kernel, runId, store } = await persistRunAndCheckpoint({
      checkpoint: {
        iterations: 2,
        messages: [
          { role: "user", content: "goal" },
          { role: "assistant", content: "middle assistant" },
          {
            role: "system",
            content:
              "Runtime context below is authoritative and may contain fresher state than older transcript messages.\n\n## Session Memory\nfresh memory",
          },
          { role: "user", content: "tail user" },
        ],
      },
    });

    await store.persistSessionMemory({
      runId,
      goal: "investigate the runtime",
      status: "running",
      updatedAt: new Date().toISOString(),
      sourceRunUpdatedAt: new Date().toISOString(),
      headline: "fresh memory",
      currentPhase: "reasoning",
      recentSteps: ["step"],
      blockers: [],
      openQuestions: [],
      artifactRefs: [],
      compactedMessages: 0,
      tokenEstimate: 12,
    });

    const prepared = await kernel.prepareMessages({
      runId,
      checkpoint: buildCheckpoint({
        iterations: 2,
        messages: [
          { role: "user", content: "goal" },
          { role: "assistant", content: "middle assistant" },
          {
            role: "system",
            content:
              "Runtime context below is authoritative and may contain fresher state than older transcript messages.\n\n## Session Memory\nfresh memory",
          },
          { role: "user", content: "tail user" },
        ],
      }),
      query: "fresh memory",
    });

    expect(prepared[0]!.role).toBe("system");
    expect(prepared[0]!.content).toContain("Runtime context below is authoritative");
    expect(prepared[1]!.role).toBe("user");
    expect(
      prepared.filter((message) =>
        message.content.startsWith("Runtime context below is authoritative"),
      ),
    ).toHaveLength(1);
    expect(prepared.some((message) => message.content.includes("middle assistant"))).toBe(true);
    expect(prepared.some((message) => message.content.includes("fresh memory"))).toBe(true);
    expect(prepared.some((message) => message.content === "tail user")).toBe(true);
  });

  it("returns original checkpoints and skips persistence when context is disabled", async () => {
    const { kernel, runId } = await persistRunAndCheckpoint({
      context: {
        enabled: false,
      },
      checkpoint: {
        messages: [
          { role: "system", content: "system" },
          { role: "user", content: "goal" },
          { role: "assistant", content: "a" },
          { role: "user", content: toolResultMessage("lookup", { body: "A".repeat(500) }) },
        ],
        toolCalls: [{ tool: "lookup", args: { id: 1 }, result: { body: "A".repeat(500) } }],
      },
    });

    const original = buildCheckpoint({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "goal" },
        { role: "assistant", content: "a" },
        { role: "user", content: toolResultMessage("lookup", { body: "A".repeat(500) }) },
      ],
      toolCalls: [{ tool: "lookup", args: { id: 1 }, result: { body: "A".repeat(500) } }],
    });

    const update = await kernel.handleCheckpoint({
      runId,
      checkpoint: original,
    });

    expect(update.checkpoint).toEqual(original);
    expect(update.compaction).toBeUndefined();
    expect(update.promotedMemories).toEqual([]);
    expect(await kernel.getSessionMemory(runId)).toBeUndefined();
    expect(await kernel.getLatestSummary(runId)).toBeUndefined();
    expect(
      await kernel.recordObservation({
        runId,
        tool: "lookup",
        args: { id: 1 },
        result: { ok: true },
      }),
    ).toBeUndefined();
    expect(await kernel.prepareMessages({ runId, checkpoint: original })).toEqual(original.messages);
  });
});

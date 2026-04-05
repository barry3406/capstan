import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  FileHarnessRuntimeStore,
  HarnessContextKernel,
} from "@zauso-ai/capstan-ai";
import type {
  AgentLoopCheckpoint,
  HarnessContextPackage,
  HarnessRunRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
} from "@zauso-ai/capstan-ai";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-graph-projections-"));
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
    goal: "inspect graph projections",
    status: "running",
    createdAt: now,
    updatedAt: now,
    iterations: 0,
    toolCalls: 0,
    taskCalls: 0,
    maxIterations: 10,
    toolNames: [],
    taskNames: [],
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: false,
      artifactDir: `/artifacts/${runId}`,
    },
    lastEventSequence: 0,
    ...overrides,
  };
}

function buildCheckpoint(
  runId: string,
  overrides: Partial<AgentLoopCheckpoint> = {},
): AgentLoopCheckpoint {
  return {
    stage: "tool_result",
    config: {
      goal: `goal:${runId}`,
      maxIterations: 10,
    },
    messages: [
      { role: "system", content: "System guidance" },
      { role: "user", content: `goal:${runId}` },
      { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"page\":1}}" },
      {
        role: "user",
        content: `Tool "lookup" returned:\n${JSON.stringify({ page: 1, body: "alpha result" }, null, 2)}`,
      },
    ],
    iterations: 1,
    toolCalls: [{ tool: "lookup", args: { page: 1 }, result: { page: 1, body: "alpha result" } }],
    lastAssistantResponse: "Working through the graph",
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
    goal: "inspect graph projections",
    status: "running",
    updatedAt: now,
    sourceRunUpdatedAt: now,
    headline: "graph projection headline",
    currentPhase: "reasoning",
    recentSteps: ["step-one", "step-two"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    compactedMessages: 1,
    tokenEstimate: 32,
    ...overrides,
  };
}

function buildSummaryRecord(
  runId: string,
  overrides: Partial<HarnessSummaryRecord> = {},
): HarnessSummaryRecord {
  const now = new Date().toISOString();
  return {
    id: `summary_${runId}`,
    runId,
    createdAt: now,
    updatedAt: now,
    sourceRunUpdatedAt: now,
    kind: "run_compact",
    status: "completed",
    headline: "graph projection summary",
    completedSteps: ["lookup finished"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    iterations: 1,
    toolCalls: 1,
    messageCount: 4,
    compactedMessages: 1,
    ...overrides,
  };
}

async function createKernelFixture(context?: Parameters<typeof HarnessContextKernel>[1]) {
  const rootDir = await createTempDir();
  const store = new FileHarnessRuntimeStore(rootDir);
  await store.initialize();
  const kernel = new HarnessContextKernel(store, context);
  await kernel.initialize();
  return { rootDir, store, kernel };
}

describe("harness graph projections", () => {
  it("returns stable context projections for the same runtime graph state", async () => {
    const { store, kernel, rootDir } = await createKernelFixture({
      maxPromptTokens: 1_200,
      reserveOutputTokens: 0,
      maxRecentMessages: 4,
      maxRecentToolResults: 2,
      microcompactToolResultChars: 80,
      sessionCompactThreshold: 0.2,
      autoPromoteSummaries: true,
    });

    const runId = "run-stable";
    await store.persistRun(buildRunRecord(runId));
    await store.persistCheckpoint(runId, buildCheckpoint(runId));
    await store.persistSessionMemory(buildSessionMemoryRecord(runId));
    await store.persistSummary(buildSummaryRecord(runId));
    await kernel.rememberMemory({
      scope: { type: "run", id: runId },
      runId,
      kind: "fact",
      content: "The graph projection should stay stable across repeated reads.",
    });
    const artifact = await store.writeArtifact(runId, {
      kind: "note",
      content: "stable preview content",
      extension: ".txt",
      mimeType: "text/plain",
    });
    await store.patchRun(runId, {
      artifactIds: [artifact.id],
    });

    const first = await kernel.assembleContext(runId, {
      query: "stable graph projection",
      maxTokens: 600,
      scopes: [{ type: "run", id: runId }],
      maxArtifacts: 4,
    });
    const second = await kernel.assembleContext(runId, {
      query: "stable graph projection",
      maxTokens: 600,
      scopes: [{ type: "run", id: runId }],
      maxArtifacts: 4,
    });

    expect(stripGeneratedFields(first)).toEqual(stripGeneratedFields(second));

    const preparedFirst = await kernel.prepareMessages({
      runId,
      checkpoint: buildCheckpoint(runId),
      query: "stable graph projection",
      scopes: [{ type: "run", id: runId }],
    });
    const preparedSecond = await kernel.prepareMessages({
      runId,
      checkpoint: buildCheckpoint(runId),
      query: "stable graph projection",
      scopes: [{ type: "run", id: runId }],
    });

    expect(preparedFirst).toEqual(preparedSecond);
    expect(first.artifactRefs).toEqual([
      expect.objectContaining({
        artifactId: artifact.id,
        kind: "note",
      }),
    ]);
    expect(first.blocks.map((block) => block.kind)).toEqual([
      "session_memory",
      "summary",
      "artifact",
      "memory",
      "graph",
    ]);
    expect(first.blocks.some((block) => block.kind === "artifact")).toBe(true);
    expect(first.blocks.some((block) => block.kind === "summary")).toBe(true);
    expect(first.totalTokens).toBeGreaterThan(0);
    expect(first.generatedAt).toBeString();

  });

  it("keeps scope projections isolated when different graph scopes contain similar text", async () => {
    const { kernel, store } = await createKernelFixture({
      maxPromptTokens: 1_200,
      reserveOutputTokens: 0,
      maxRecentMessages: 4,
      maxRecentToolResults: 2,
      sessionCompactThreshold: 0.2,
    });

    const runId = "run-scope";
    await store.persistRun(buildRunRecord(runId));
    await store.persistCheckpoint(runId, buildCheckpoint(runId));
    await store.persistSessionMemory(buildSessionMemoryRecord(runId));
    await store.persistSummary(buildSummaryRecord(runId));

    await kernel.rememberMemory({
      scope: { type: "run", id: runId },
      runId,
      kind: "fact",
      content: "same text but run scoped",
    });
    await kernel.rememberMemory({
      scope: { type: "project", id: "project-alpha" },
      kind: "fact",
      content: "same text but project scoped",
    });
    await kernel.rememberMemory({
      scope: { type: "entity", id: "entity-beta" },
      kind: "fact",
      content: "same text but entity scoped",
    });

    const runOnly = await kernel.assembleContext(runId, {
      query: "same text",
      scopes: [{ type: "run", id: runId }],
      maxTokens: 600,
    });
    expect(runOnly.memories).toHaveLength(1);
    expect(runOnly.memories[0]!.scope).toEqual({ type: "run", id: runId });
    expect(runOnly.blocks.some((block) => block.content.includes("project scoped"))).toBe(false);
    expect(runOnly.blocks.some((block) => block.content.includes("entity scoped"))).toBe(false);

    const mixed = await kernel.assembleContext(runId, {
      query: "same text",
      scopes: [{ type: "run", id: runId }, { type: "project", id: "project-alpha" }],
      maxTokens: 600,
    });
    expect(mixed.memories.some((entry) => entry.scope.type === "project")).toBe(true);
    expect(mixed.memories.some((entry) => entry.scope.type === "entity")).toBe(false);
  });

  it("captures running state without manufacturing a terminal summary", async () => {
    const { kernel, store } = await createKernelFixture();
    const runId = "run-capture";

    await store.persistRun(
      buildRunRecord(runId, {
        status: "running",
        iterations: 2,
      }),
    );
    await store.persistCheckpoint(runId, buildCheckpoint(runId));

    const captured = await kernel.captureRunState(runId);
    expect(captured.sessionMemory.runId).toBe(runId);
    expect(captured.sessionMemory.status).toBe("running");
    expect(captured.summary).toBeUndefined();
    expect(captured.promotedMemories).toEqual([]);

    const capturedAgain = await kernel.captureRunState(runId);
    expect(stripCapturedState(capturedAgain)).toEqual(stripCapturedState(captured));
  });
});

function stripGeneratedFields(context: HarnessContextPackage) {
  const { generatedAt: _generatedAt, ...rest } = context;
  return {
    ...rest,
    blocks: context.blocks.map((block) => ({
      ...block,
      metadata: block.metadata ? { ...block.metadata } : undefined,
    })),
    transcriptTail: context.transcriptTail.map((message) => ({ ...message })),
    artifactRefs: context.artifactRefs.map((artifact) => ({ ...artifact })),
    memories: context.memories.map((memory) => ({
      ...memory,
      accessCount: 0,
      lastAccessedAt: "__stable__",
      score: 0,
      scope: { ...memory.scope },
      metadata: memory.metadata ? { ...memory.metadata } : undefined,
    })),
    omitted: context.omitted.map((entry) => ({ ...entry })),
    ...(context.sessionMemory
      ? {
          sessionMemory: {
            ...context.sessionMemory,
            updatedAt: "__stable__",
            artifactRefs: context.sessionMemory.artifactRefs.map((artifact) => ({ ...artifact })),
          },
        }
      : {}),
    ...(context.summary
      ? {
          summary: {
            ...context.summary,
            updatedAt: "__stable__",
            artifactRefs: context.summary.artifactRefs.map((artifact) => ({ ...artifact })),
          },
        }
      : {}),
  };
}

function stripCapturedState(state: Awaited<ReturnType<HarnessContextKernel["captureRunState"]>>) {
  return {
    sessionMemory: {
      ...state.sessionMemory,
      updatedAt: "__stable__",
      artifactRefs: state.sessionMemory.artifactRefs.map((artifact) => ({ ...artifact })),
    },
    ...(state.summary
      ? {
          summary: {
            ...state.summary,
            updatedAt: "__stable__",
            artifactRefs: state.summary.artifactRefs.map((artifact) => ({ ...artifact })),
          },
        }
      : {}),
    promotedMemories: state.promotedMemories.map((memory) => ({
      ...memory,
      scope: { ...memory.scope },
      accessCount: 0,
      lastAccessedAt: "__stable__",
    })),
  };
}

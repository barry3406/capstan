import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  FileHarnessRuntimeStore,
  HarnessContextKernel,
} from "@zauso-ai/capstan-ai";
import type {
  AgentCheckpoint,
  HarnessArtifactRecord,
  HarnessRunRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
  MemoryScope,
} from "@zauso-ai/capstan-ai";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-stage2-context-"));
  tempDirs.push(dir);
  return dir;
}

function now(): string {
  return new Date().toISOString();
}

function createRun(
  runId: string,
  status: HarnessRunRecord["status"] = "running",
): HarnessRunRecord {
  const stamp = now();
  return {
    id: runId,
    goal: "investigate a long-running workflow",
    status,
    createdAt: stamp,
    updatedAt: stamp,
    iterations: 2,
    toolCalls: 1,
    taskCalls: 0,
    maxIterations: 10,
    toolNames: ["lookup"],
    taskNames: [],
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: false,
      artifactDir: "",
    },
    lastEventSequence: 0,
  };
}

function createCheckpoint(messages: AgentCheckpoint["messages"]): AgentCheckpoint {
  return {
    stage: "tool_result",
    goal: "investigate a long-running workflow",
    messages,
    iterations: 3,
    toolCalls: [
      {
        tool: "lookup",
        args: { id: 1 },
        result: { body: "the expensive payload" },
      },
    ],
    taskCalls: [],
    maxOutputTokens: 8192,
    compaction: {
      autocompactFailures: 0,
      reactiveCompactRetries: 0,
      tokenEscalations: 0,
    },
  };
}

function createSessionMemory(
  runId: string,
  overrides: Partial<HarnessSessionMemoryRecord> = {},
): HarnessSessionMemoryRecord {
  const stamp = now();
  return {
    runId,
    goal: "investigate a long-running workflow",
    status: "running",
    updatedAt: stamp,
    sourceRunUpdatedAt: stamp,
    headline: "session memory headline",
    currentPhase: "reasoning",
    recentSteps: ["lookup({\"id\":1}) => {\"body\":\"the expensive payload\"}"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    compactedMessages: 0,
    tokenEstimate: 42,
    ...overrides,
  };
}

function createSummary(
  runId: string,
  kind: HarnessSummaryRecord["kind"],
  overrides: Partial<HarnessSummaryRecord> = {},
): HarnessSummaryRecord {
  const stamp = now();
  return {
    id: `summary_${runId}_${kind}`,
    runId,
    createdAt: stamp,
    updatedAt: stamp,
    sourceRunUpdatedAt: stamp,
    kind,
    status: overrides.status ?? "completed",
    headline: overrides.headline ?? "summary headline",
    completedSteps: overrides.completedSteps ?? [
      "lookup({\"id\":1}) => {\"body\":\"the expensive payload\"}",
    ],
    blockers: overrides.blockers ?? [],
    openQuestions: overrides.openQuestions ?? [],
    artifactRefs: overrides.artifactRefs ?? [],
    iterations: overrides.iterations ?? 3,
    toolCalls: overrides.toolCalls ?? 1,
    messageCount: overrides.messageCount ?? 6,
    compactedMessages: overrides.compactedMessages ?? 0,
  };
}

function createArtifact(
  runId: string,
  overrides: Partial<HarnessArtifactRecord> = {},
): HarnessArtifactRecord {
  const stamp = now();
  return {
    id: overrides.id ?? `artifact_${runId}`,
    runId,
    kind: overrides.kind ?? "screenshot",
    path: overrides.path ?? `/tmp/${runId}.png`,
    createdAt: overrides.createdAt ?? stamp,
    mimeType: overrides.mimeType ?? "image/png",
    size: overrides.size ?? 128,
    ...overrides,
  };
}

async function seedKernel(options?: {
  context?: ConstructorParameters<typeof HarnessContextKernel>[1];
  runStatus?: HarnessRunRecord["status"];
  checkpoint?: AgentCheckpoint;
  sessionMemory?: HarnessSessionMemoryRecord;
  summary?: HarnessSummaryRecord;
  artifacts?: HarnessArtifactRecord[];
  memories?: Array<{
    scope: MemoryScope;
    content: string;
    metadata?: Record<string, unknown>;
  }>;
}) {
  const rootDir = await createTempDir();
  const store = new FileHarnessRuntimeStore(rootDir);
  const kernel = new HarnessContextKernel(store, options?.context);
  await store.initialize();

  const runId = "run-a";
  await store.persistRun(createRun(runId, options?.runStatus));
  await store.persistCheckpoint(
    runId,
    options?.checkpoint ?? createCheckpoint([
      { role: "system", content: "system prompt" },
      { role: "user", content: "goal" },
      { role: "assistant", content: "assistant note" },
      { role: "user", content: 'Tool "lookup" returned:\n{"body":"the expensive payload"}' },
    ]),
  );

  for (const artifact of options?.artifacts ?? [createArtifact(runId)]) {
    await store.writeArtifact(runId, {
      kind: artifact.kind,
      content: Buffer.from("artifact preview for context", "utf8"),
      extension: ".txt",
      mimeType: artifact.mimeType,
      metadata: { label: artifact.kind, ...(artifact.metadata ?? {}) },
    });
  }

  if (options?.sessionMemory) {
    await store.persistSessionMemory(options.sessionMemory);
  } else {
    await store.persistSessionMemory(createSessionMemory(runId));
  }

  if (options?.summary) {
    await store.persistSummary(options.summary);
  } else {
    await store.persistSummary(createSummary(runId, "session_compact"));
  }

  for (const memory of options?.memories ?? [
    {
      scope: { type: "run", id: runId },
      content: "deterministic runtime memory",
      metadata: { source: "seed" },
    },
  ]) {
    await kernel.rememberMemory(memory);
  }

  return { rootDir, store, kernel, runId };
}

describe("Stage 2 context matrix", () => {
  it("assembles session memory, summary, memories, and artifacts in a stable order", async () => {
    const { kernel, runId } = await seedKernel({
      context: {
        maxPromptTokens: 10_000,
        reserveOutputTokens: 0,
        maxMemories: 4,
        maxArtifacts: 2,
        defaultScopes: [{ type: "project", id: "capstan" }],
      },
      memories: [
        { scope: { type: "project", id: "capstan" }, content: "project note one" },
        { scope: { type: "run", id: "run-a" }, content: "run note two" },
      ],
    });

    const context = await kernel.assembleContext(runId, {
      query: "note",
      maxTokens: 9_000,
    });

    expect(context.blocks.map((block) => block.title)).toEqual([
      "Session Memory",
      "Run Summary",
      "Relevant Memory",
      "Artifacts",
    ]);
    expect(context.sessionMemory?.headline).toBe("session memory headline");
    expect(context.summary?.kind).toBe("session_compact");
    expect(context.memories.map((memory) => memory.content)).toContain("project note one");
    expect(context.memories.map((memory) => memory.content)).toContain("run note two");
    expect(context.artifactRefs.length).toBeGreaterThan(0);
    expect(context.omitted).toEqual([]);
  });

  it("dedupes scopes and uses the provided query rather than the session headline", async () => {
    const { kernel, runId } = await seedKernel({
      memories: [
        { scope: { type: "project", id: "capstan" }, content: "project recall needle" },
        { scope: { type: "project", id: "capstan" }, content: "project recall needle" },
        { scope: { type: "run", id: "run-a" }, content: "run-only recall needle" },
      ],
    });

    const context = await kernel.assembleContext(runId, {
      query: "run-only recall needle",
      scopes: [
        { type: "project", id: "capstan" },
        { type: "project", id: "capstan" },
        { type: "run", id: runId },
      ],
      maxMemories: 8,
    });

    expect(context.query).toBe("run-only recall needle");
    expect(context.memories.map((memory) => `${memory.scope.type}:${memory.scope.id}`)).toEqual(
      expect.arrayContaining(["run:run-a", "project:capstan"]),
    );
    expect(context.memories).toHaveLength(2);
    expect(
      context.blocks.find((block) => block.kind === "memory")?.content,
    ).toContain("run-only recall needle");
  });

  it("omits lower-priority blocks when the prompt budget is exhausted and trims the session block instead of dropping it", async () => {
    const { kernel, runId } = await seedKernel({
      context: {
        maxPromptTokens: 120,
        reserveOutputTokens: 0,
        maxMemories: 4,
        maxArtifacts: 4,
        maxRecentMessages: 4,
      },
      sessionMemory: createSessionMemory("run-a", {
        headline: "A very long headline ".repeat(12),
        recentSteps: [
          "first step".repeat(10),
          "second step".repeat(10),
          "third step".repeat(10),
        ],
      }),
      summary: createSummary("run-a", "run_compact", {
        headline: "A long compacted summary ".repeat(10),
        completedSteps: [
          "one".repeat(30),
          "two".repeat(30),
          "three".repeat(30),
        ],
      }),
      memories: [
        {
          scope: { type: "run", id: "run-a" },
          content: "memory entry that should not fit in a tiny budget ".repeat(8),
        },
      ],
      artifacts: [
        createArtifact("run-a", { kind: "log" }),
        createArtifact("run-a", { kind: "screenshot" }),
      ],
    });

    const context = await kernel.assembleContext(runId, {
      query: "tiny budget",
      maxTokens: 60,
    });

    expect(context.blocks.length).toBeLessThanOrEqual(1);
    expect(context.blocks[0]?.kind).toBe("session_memory");
    expect(context.blocks[0]?.content.length).toBeGreaterThan(0);
    expect(context.omitted.every((entry) => entry.reason === "token_budget_exceeded")).toBe(true);
    expect(context.totalTokens).toBeLessThanOrEqual(60);
  });

  it("injects runtime context after a system prompt and strips stale runtime markers from the transcript", async () => {
    const { kernel, runId } = await seedKernel({
      context: {
        maxPromptTokens: 4_000,
        reserveOutputTokens: 0,
        maxRecentMessages: 2,
      },
      checkpoint: createCheckpoint([
        { role: "system", content: "system prompt" },
        { role: "user", content: "goal" },
        {
          role: "system",
          content:
            "Runtime context below is authoritative and may contain fresher state than older transcript messages.\n\n## Session Memory\nold session note",
        },
        { role: "assistant", content: "tail assistant" },
        { role: "user", content: "tail user" },
      ]),
      sessionMemory: createSessionMemory("run-a", {
        headline: "fresh session note",
        recentSteps: ["tail assistant", "tail user"],
      }),
    });

    const prepared = await kernel.prepareMessages({
      runId,
      checkpoint: createCheckpoint([
        { role: "system", content: "system prompt" },
        { role: "user", content: "goal" },
        {
          role: "system",
          content:
            "Runtime context below is authoritative and may contain fresher state than older transcript messages.\n\n## Session Memory\nold session note",
        },
        { role: "assistant", content: "tail assistant" },
        { role: "user", content: "tail user" },
      ]),
      query: "fresh session note",
    });

    expect(prepared[0]!.content).toBe("system prompt");
    expect(prepared[1]!.role).toBe("system");
    expect(prepared[1]!.content).toContain("Runtime context below is authoritative");
    expect(prepared.filter((message) => message.content.startsWith("Runtime context below is authoritative"))).toHaveLength(1);
    expect(prepared.some((message) => message.content.includes("old session note"))).toBe(false);
    expect(prepared.some((message) => message.content.includes("fresh session note"))).toBe(true);
  });

  it("returns a cloned transcript unchanged when context assembly is disabled", async () => {
    const { kernel, runId } = await seedKernel({
      context: { enabled: false },
    });

    const checkpoint = createCheckpoint([
      { role: "system", content: "system prompt" },
      { role: "user", content: "goal" },
      { role: "assistant", content: "response" },
    ]);

    const prepared = await kernel.prepareMessages({
      runId,
      checkpoint,
    });

    expect(prepared).toEqual(checkpoint.messages);
    expect(prepared).not.toBe(checkpoint.messages);
    expect(prepared[0]).not.toBe(checkpoint.messages[0]);
  });

  it("microcompacts oversized tool results before deciding whether session compaction is necessary", async () => {
    const { kernel, runId } = await seedKernel({
      context: {
        maxPromptTokens: 10_000,
        reserveOutputTokens: 0,
        maxRecentMessages: 8,
        maxRecentToolResults: 1,
        microcompactToolResultChars: 40,
        sessionCompactThreshold: 0.95,
      },
      checkpoint: createCheckpoint([
        { role: "system", content: "system prompt" },
        { role: "user", content: "goal" },
        { role: "assistant", content: "assistant note" },
        {
          role: "user",
          content: 'Tool "lookup" returned:\n' + JSON.stringify({ payload: "x".repeat(200) }),
        },
        {
          role: "user",
          content: 'Tool "lookup" returned:\n' + JSON.stringify({ payload: "y".repeat(220) }),
        },
      ]),
    });

    const update = await kernel.handleCheckpoint({
      runId,
      checkpoint: createCheckpoint([
        { role: "system", content: "system prompt" },
        { role: "user", content: "goal" },
        { role: "assistant", content: "assistant note" },
        {
          role: "user",
          content: 'Tool "lookup" returned:\n' + JSON.stringify({ payload: "x".repeat(200) }),
        },
        {
          role: "user",
          content: 'Tool "lookup" returned:\n' + JSON.stringify({ payload: "y".repeat(220) }),
        },
      ]),
    });

    expect(update.compaction?.kind).toBe("microcompact");
    expect(update.compaction?.compactedMessages).toBeGreaterThan(0);
    expect(update.summary).toBeUndefined();
    expect(update.checkpoint.messages.some((message) => message.content.includes("[microcompacted tool result]"))).toBe(true);
  });

  it("session compacts a crowded checkpoint and auto-promotes the summary into durable memory", async () => {
    const { kernel, runId } = await seedKernel({
      context: {
        maxPromptTokens: 180,
        reserveOutputTokens: 0,
        maxRecentMessages: 2,
        sessionCompactThreshold: 0.2,
        autoPromoteSummaries: true,
      },
      checkpoint: createCheckpoint([
        { role: "system", content: "system prompt" },
        { role: "user", content: "goal" },
        { role: "assistant", content: "assistant note 1" },
        { role: "user", content: 'Tool "lookup" returned:\n' + JSON.stringify({ payload: "a".repeat(120) }) },
        { role: "assistant", content: "assistant note 2" },
        { role: "user", content: 'Tool "lookup" returned:\n' + JSON.stringify({ payload: "b".repeat(120) }) },
        { role: "assistant", content: "assistant note 3" },
        { role: "user", content: 'Tool "lookup" returned:\n' + JSON.stringify({ payload: "c".repeat(120) }) },
      ]),
    });

    const update = await kernel.handleCheckpoint({
      runId,
      checkpoint: createCheckpoint([
        { role: "system", content: "system prompt" },
        { role: "user", content: "goal" },
        { role: "assistant", content: "assistant note 1" },
        { role: "user", content: 'Tool "lookup" returned:\n' + JSON.stringify({ payload: "a".repeat(120) }) },
        { role: "assistant", content: "assistant note 2" },
        { role: "user", content: 'Tool "lookup" returned:\n' + JSON.stringify({ payload: "b".repeat(120) }) },
        { role: "assistant", content: "assistant note 3" },
        { role: "user", content: 'Tool "lookup" returned:\n' + JSON.stringify({ payload: "c".repeat(120) }) },
      ]),
    });

    expect(update.compaction?.kind).toBe("session_compact");
    expect(update.summary?.kind).toBe("session_compact");
    expect(update.summary?.headline).toBeDefined();
    expect(update.promotedMemories).toHaveLength(1);
    expect(update.promotedMemories[0]!.kind).toBe("summary");
    expect(update.checkpoint.messages.some((message) => message.content.startsWith("[HARNESS_SUMMARY]"))).toBe(true);
  });

  it("captures paused runs without inventing a run summary but still refreshes session memory", async () => {
    const { kernel, runId, store } = await seedKernel({
      runStatus: "paused",
      checkpoint: createCheckpoint([
        { role: "system", content: "system prompt" },
        { role: "user", content: "goal" },
        { role: "assistant", content: "assistant note" },
      ]),
    });

    await store.persistRun({
      ...createRun(runId, "paused"),
      pendingApproval: {
        tool: "delete",
        args: { id: 1 },
        reason: "operator confirmation required",
        requestedAt: now(),
      },
    });

    const state = await kernel.captureRunState(runId);

    expect(state.sessionMemory.status).toBe("paused");
    expect(state.sessionMemory.pendingApproval?.tool).toBe("delete");
    expect(state.summary?.kind).toBe("run_compact");
    expect(state.summary?.status).toBe("paused");
    expect(state.promotedMemories).toHaveLength(1);
    expect(state.promotedMemories[0]!.kind).toBe("summary");
    expect((await kernel.getLatestSummary(runId))?.status).toBe("paused");
  });

  it("records failing tool results as high-importance observations and skips them when disabled", async () => {
    const { kernel, runId } = await seedKernel();

    const memory = await kernel.recordObservation({
      runId,
      tool: "lookup",
      args: { id: 1 },
      result: { error: "boom" },
    });

    expect(memory?.kind).toBe("observation");
    expect(memory?.importance).toBe("high");
    expect(memory?.metadata).toMatchObject({ tool: "lookup", error: true });

    const disabledRoot = await createTempDir();
    const disabledStore = new FileHarnessRuntimeStore(disabledRoot);
    const disabledKernel = new HarnessContextKernel(disabledStore, {
      enabled: true,
      autoPromoteObservations: false,
    });
    await disabledStore.initialize();
    await disabledStore.persistRun(createRun("run-disabled"));
    await disabledStore.persistCheckpoint(
      "run-disabled",
      createCheckpoint([
        { role: "system", content: "system prompt" },
        { role: "user", content: "goal" },
      ]),
    );

    expect(
      await disabledKernel.recordObservation({
        runId: "run-disabled",
        tool: "lookup",
        args: { id: 1 },
        result: { error: "boom" },
      }),
    ).toBeUndefined();
  });

  it("trims and rejects blank memory content while preserving the normalized record shape", async () => {
    const { kernel, runId } = await seedKernel();

    const stored = await kernel.rememberMemory({
      scope: { type: "run", id: runId },
      content: "   remember this exact fact   ",
      metadata: {
        nested: { value: 1 },
      },
    });

    expect(stored.content).toBe("remember this exact fact");
    expect(stored.scope).toEqual({ type: "run", id: runId });
    expect(stored.metadata).toEqual({ nested: { value: 1 } });

    await expect(
      kernel.rememberMemory({
        scope: { type: "run", id: runId },
        content: "   ",
      }),
    ).rejects.toThrow("Harness memory content must be a non-empty string");
  });
});

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
  HarnessRunRecord,
} from "@zauso-ai/capstan-ai";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-context-scenarios-"));
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
    goal: "scenario goal",
    status: "running",
    createdAt: now,
    updatedAt: now,
    iterations: 0,
    toolCalls: 0,
    taskCalls: 0,
    maxIterations: 10,
    toolNames: ["lookup", "write", "report"],
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

function buildCheckpoint(
  overrides: Partial<AgentLoopCheckpoint> = {},
): AgentLoopCheckpoint {
  return {
    stage: "tool_result",
    config: {
      goal: "scenario goal",
      maxIterations: 10,
      systemPrompt: "You are a disciplined runtime.",
    },
    messages: [
      { role: "system", content: "You are a disciplined runtime." },
      { role: "user", content: "scenario goal" },
      { role: "assistant", content: "{\"tool\":\"lookup\",\"arguments\":{\"id\":1}}" },
      {
        role: "user",
        content: "Tool \"lookup\" returned:\n{\"value\":\"one\"}",
      },
    ],
    iterations: 1,
    toolCalls: [
      { tool: "lookup", args: { id: 1 }, result: { value: "one" } },
    ],
    lastAssistantResponse: "Lookup succeeded.",
    ...overrides,
  };
}

async function createKernel(context?: Parameters<typeof HarnessContextKernel>[1]) {
  const rootDir = await createTempDir();
  const store = new FileHarnessRuntimeStore(rootDir);
  await store.initialize();
  const kernel = new HarnessContextKernel(store, context);
  await kernel.initialize();
  return { rootDir, store, kernel };
}

describe("Harness context scenario coverage", () => {
  it("remembers project-scoped facts and surfaces them through assembleContext defaultScopes", async () => {
    const { store, kernel } = await createKernel({
      enabled: true,
      defaultScopes: [{ type: "project", id: "capstan" }],
      autoPromoteSummaries: false,
    });
    await store.persistRun(buildRunRecord("run-a"));
    await store.persistCheckpoint("run-a", buildCheckpoint());
    await kernel.rememberMemory({
      scope: { type: "project", id: "capstan" },
      kind: "fact",
      content: "Project builds should be verified with Bun",
      importance: "high",
    });

    const context = await kernel.assembleContext("run-a", {
      query: "build verification",
      maxTokens: 2_000,
    });

    expect(context.memories.map((memory) => memory.content)).toContain(
      "Project builds should be verified with Bun",
    );
    expect(context.blocks.map((block) => block.kind)).toContain("memory");
  });

  it("returns only session memory when no long-term memories or summaries fit the query", async () => {
    const { store, kernel } = await createKernel({
      enabled: true,
      autoPromoteSummaries: false,
      maxPromptTokens: 1_200,
      reserveOutputTokens: 100,
    });
    await store.persistRun(buildRunRecord("run-a"));
    await store.persistCheckpoint("run-a", buildCheckpoint());

    const context = await kernel.assembleContext("run-a", {
      query: "totally unrelated search",
      maxTokens: 1_000,
    });

    expect(context.blocks.length).toBeGreaterThanOrEqual(1);
    expect(context.blocks[0]?.kind).toBe("session_memory");
    expect(context.memories).toEqual([]);
  });

  it("keeps summary memory stable when summary content changes for the same run", async () => {
    const { store, kernel } = await createKernel({
      enabled: true,
      autoPromoteSummaries: true,
    });
    await store.persistRun(
      buildRunRecord("run-a", {
        status: "paused",
        updatedAt: "2026-04-03T00:00:01.000Z",
      }),
    );
    await store.persistCheckpoint("run-a", buildCheckpoint());

    const pausedState = await kernel.captureRunState("run-a");
    expect(pausedState.promotedMemories).toHaveLength(1);

    await store.patchRun("run-a", {
      status: "completed",
      updatedAt: "2026-04-03T00:00:02.000Z",
    });
    const completedState = await kernel.captureRunState("run-a");

    expect(completedState.promotedMemories).toHaveLength(1);
    expect(completedState.promotedMemories[0]?.id).toBe(pausedState.promotedMemories[0]?.id);
    expect(completedState.promotedMemories[0]?.sourceSummaryId).toBe(
      completedState.summary?.id,
    );
  });

  it("includes run errors as blockers inside captured session memory", async () => {
    const { store, kernel } = await createKernel({
      enabled: true,
      autoPromoteSummaries: false,
    });
    await store.persistRun(
      buildRunRecord("run-a", {
        status: "failed",
        error: "tool execution exploded",
        updatedAt: "2026-04-03T00:00:03.000Z",
      }),
    );
    await store.persistCheckpoint("run-a", buildCheckpoint({
      stage: "tool_result",
      toolCalls: [
        { tool: "write", args: { path: "README.md" }, result: { error: "permission denied" } },
      ],
    }));

    const captured = await kernel.captureRunState("run-a");
    expect(captured.sessionMemory.blockers).toContain("tool execution exploded");
    expect(captured.sessionMemory.blockers.some((entry) => entry.includes("permission denied"))).toBe(true);
  });

  it("stores non-error observations at medium importance", async () => {
    const { kernel } = await createKernel({
      enabled: true,
      autoPromoteObservations: true,
    });

    const memory = await kernel.recordObservation({
      runId: "run-a",
      tool: "report",
      args: { section: "summary" },
      result: { written: true },
    });

    expect(memory).toBeDefined();
    expect(memory?.importance).toBe("medium");
    expect(memory?.content).toContain("written");
  });

  it("returns a preview for JSON artifacts and surfaces it in assembled context", async () => {
    const { store, kernel } = await createKernel({
      enabled: true,
      maxArtifacts: 2,
    });
    await store.persistRun(
      buildRunRecord("run-a", {
        status: "completed",
        updatedAt: "2026-04-03T00:00:03.000Z",
      }),
    );
    await store.persistCheckpoint("run-a", buildCheckpoint({
      stage: "completed",
    }));

    const artifact = await store.writeArtifact("run-a", {
      kind: "json",
      content: { ok: true, message: "hello world" },
      extension: ".json",
      mimeType: "application/json",
    });
    await store.patchRun("run-a", {
      artifactIds: [artifact.id],
    });

    const context = await kernel.assembleContext("run-a", {
      query: "hello world",
      maxTokens: 1_500,
    });

    expect(context.artifactRefs).toHaveLength(1);
    expect(context.artifactRefs[0]?.preview).toContain("\"ok\": true");
    expect(context.blocks.map((block) => block.kind)).toContain("artifact");
  });

  it("lists no summaries for unknown runs and no memories for unknown scopes", async () => {
    const { kernel } = await createKernel({
      enabled: true,
    });

    expect(await kernel.listSummaries("missing-run")).toEqual([]);
    expect(
      await kernel.recallMemory({
        query: "nothing",
        scopes: [{ type: "run", id: "missing-run" }],
        limit: 5,
      }),
    ).toEqual([]);
  });

  it("builds a run snapshot when handleCheckpoint is called before the run record exists", async () => {
    const { kernel } = await createKernel({
      enabled: true,
      autoPromoteSummaries: false,
    });

    const update = await kernel.handleCheckpoint({
      runId: "run-a",
      checkpoint: buildCheckpoint({
        stage: "approval_required",
        pendingToolCall: {
          assistantMessage: "{\"tool\":\"write\",\"arguments\":{\"path\":\"README.md\"}}",
          tool: "write",
          args: { path: "README.md" },
        },
      }),
    });

    expect(update.sessionMemory.runId).toBe("run-a");
    expect(update.sessionMemory.status).toBe("approval_required");
    expect(update.sessionMemory.openQuestions).toContain("What should happen after write?");
  });

  it("prepareMessages lets explicit scopes override default recall scopes", async () => {
    const { store, kernel } = await createKernel({
      enabled: true,
      defaultScopes: [{ type: "project", id: "capstan" }],
      autoPromoteSummaries: false,
    });
    await store.persistRun(buildRunRecord("run-a"));
    const checkpoint = buildCheckpoint();
    await store.persistCheckpoint("run-a", checkpoint);

    await kernel.rememberMemory({
      scope: { type: "project", id: "capstan" },
      kind: "fact",
      content: "project fact",
    });
    await kernel.rememberMemory({
      scope: { type: "entity", id: "ticket-42" },
      kind: "fact",
      content: "entity fact",
    });

    const prepared = await kernel.prepareMessages({
      runId: "run-a",
      checkpoint,
      query: "entity fact",
      scopes: [{ type: "entity", id: "ticket-42" }],
    });

    const injected = prepared.find(
      (message, index) => index > 0 && message.role === "system",
    );
    expect(injected?.content).toContain("entity fact");
    expect(injected?.content).not.toContain("project fact");
  });

  it("trims transcript tail aggressively when context budgets are tiny", async () => {
    const { store, kernel } = await createKernel({
      enabled: true,
      maxPromptTokens: 180,
      reserveOutputTokens: 20,
      maxRecentMessages: 3,
      maxRecentToolResults: 1,
      sessionCompactThreshold: 0.4,
      autoPromoteSummaries: false,
    });
    await store.persistRun(buildRunRecord("run-a"));
    const checkpoint = buildCheckpoint({
      messages: [
        { role: "system", content: "You are a disciplined runtime." },
        { role: "user", content: "scenario goal" },
        ...Array.from({ length: 12 }, (_, index) => ({
          role: (index % 2 === 0 ? "assistant" : "user") as const,
          content: `message-${index} ${"x".repeat(120)}`,
        })),
      ],
    });
    await store.persistCheckpoint("run-a", checkpoint);

    const prepared = await kernel.prepareMessages({
      runId: "run-a",
      checkpoint,
    });

    expect(prepared.length).toBeLessThan(checkpoint.messages.length);
    expect(prepared[0]?.role).toBe("system");
    expect(prepared.some((message) => message.content.startsWith("[HARNESS_SUMMARY]"))).toBe(false);
  });
});

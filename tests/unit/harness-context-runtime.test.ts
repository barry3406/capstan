import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createHarness,
  openHarnessRuntime,
} from "@zauso-ai/capstan-ai";
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

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-context-runtime-"));
  tempDirs.push(dir);
  return dir;
}

function createMockLLM(
  responses: string[],
  capturedMessages: LLMMessage[][],
): LLMProvider {
  let index = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      capturedMessages.push(messages.map((message) => ({ ...message })));
      const content = responses[index] ?? "done";
      index++;
      return { content, model: "mock-1" };
    },
  };
}

function longPayload(label: string): string {
  return `${label}: ${"content ".repeat(80).trim()}`;
}

describe("createHarness context kernel integration", () => {
  it("persists context lifecycle events, summaries, and recallable memories across a compacted run", async () => {
    const rootDir = await createTempDir();
    const llmMessages: LLMMessage[][] = [];
    const harness = await createHarness({
      llm: createMockLLM(
        [
          JSON.stringify({ tool: "lookup", arguments: { page: 1 } }),
          JSON.stringify({ tool: "lookup", arguments: { page: 2 } }),
          JSON.stringify({ tool: "lookup", arguments: { page: 3 } }),
          "Investigation complete.",
        ],
        llmMessages,
      ),
      runtime: { rootDir },
      verify: { enabled: false },
      context: {
        maxPromptTokens: 320,
        reserveOutputTokens: 0,
        maxRecentMessages: 2,
        maxRecentToolResults: 1,
        microcompactToolResultChars: 60,
        sessionCompactThreshold: 0.2,
        autoPromoteObservations: true,
        autoPromoteSummaries: true,
      },
    });

    const result = await harness.run({
      goal: "Inspect the runtime and summarize the findings",
      tools: [
        {
          name: "lookup",
          description: "returns a large payload",
          async execute(args) {
            return {
              page: args.page,
              body: longPayload(`page-${String(args.page)}`),
            };
          },
        },
      ],
    });

    expect(result.status).toBe("completed");

    const events = await harness.getEvents(result.runId);
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain("memory_stored");
    expect(eventTypes).toContain("context_compacted");
    expect(eventTypes).toContain("summary_created");

    const sessionMemory = await harness.getSessionMemory(result.runId);
    expect(sessionMemory).toBeDefined();
    expect(sessionMemory!.compactedMessages).toBeGreaterThan(0);

    const summary = await harness.getLatestSummary(result.runId);
    expect(summary).toBeDefined();
    expect(summary!.status).toBe("completed");
    expect(summary!.kind).toBe("run_compact");

    const memories = await harness.recallMemory({
      query: "page investigation runtime",
      scopes: [{ type: "run", id: result.runId }],
      limit: 10,
    });
    expect(memories.length).toBeGreaterThanOrEqual(1);
    expect(memories.some((entry) => entry.kind === "summary")).toBe(true);
    const observations = await harness.recallMemory({
      query: "lookup returned page-1",
      scopes: [{ type: "run", id: result.runId }],
      kinds: ["observation"],
      limit: 10,
    });
    expect(observations.some((entry) => entry.kind === "observation")).toBe(true);

    const contextPackage = await harness.assembleContext(result.runId, {
      query: "runtime findings",
      maxTokens: 400,
    });
    expect(contextPackage.summary).toBeDefined();
    expect(contextPackage.memories.length).toBeGreaterThan(0);
    expect(contextPackage.totalTokens).toBeGreaterThan(0);

    const lastModelCall = llmMessages[llmMessages.length - 1]!;
    expect(
      lastModelCall.some((message) => message.content.includes(longPayload("page-1"))),
    ).toBe(false);

    await harness.destroy();
  });

  it("captures an approval-blocked summary and refreshes it after approved resume", async () => {
    const rootDir = await createTempDir();
    const llmMessages: LLMMessage[][] = [];
    let allowDangerous = false;

    const harness = await createHarness({
      llm: createMockLLM(
        [
          JSON.stringify({ tool: "dangerous", arguments: { id: "123" } }),
          "Approval path completed.",
        ],
        llmMessages,
      ),
      runtime: {
        rootDir,
        beforeToolCall: async ({ tool }) => ({
          allowed: tool !== "dangerous" || allowDangerous,
          ...(tool === "dangerous" && !allowDangerous
            ? { reason: "manual approval required" }
            : {}),
        }),
      },
      verify: { enabled: false },
      context: {
        maxPromptTokens: 400,
        reserveOutputTokens: 0,
        maxRecentMessages: 2,
      },
    });

    const blocked = await harness.run({
      goal: "Try the dangerous action",
      tools: [
        {
          name: "dangerous",
          description: "requires approval",
          async execute(args) {
            return { ok: true, id: args.id };
          },
        },
      ],
    });

    expect(blocked.status).toBe("approval_required");

    const blockedSummary = await harness.getLatestSummary(blocked.runId);
    expect(blockedSummary).toBeDefined();
    expect(blockedSummary!.status).toBe("approval_required");

    allowDangerous = true;
    const resumed = await harness.resumeRun(blocked.runId, {
      approvePendingTool: true,
    });

    expect(resumed.status).toBe("completed");

    const refreshedSummary = await harness.getLatestSummary(blocked.runId);
    expect(refreshedSummary).toBeDefined();
    expect(refreshedSummary!.status).toBe("completed");

    const events = await harness.getEvents(blocked.runId);
    expect(events.filter((event) => event.type === "summary_created").length).toBeGreaterThanOrEqual(2);
    expect(events.some((event) => event.type === "approval_required")).toBe(true);
    expect(events.some((event) => event.type === "run_resumed")).toBe(true);

    await harness.destroy();
  });

  it("does not persist context lifecycle state when the context kernel is disabled", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: createMockLLM(
        [
          JSON.stringify({ tool: "lookup", arguments: { id: 1 } }),
          "done",
        ],
        [],
      ),
      runtime: { rootDir },
      verify: { enabled: false },
      context: {
        enabled: false,
      },
    });

    const result = await harness.run({
      goal: "Inspect a record",
      tools: [
        {
          name: "lookup",
          description: "returns a payload",
          async execute() {
            return { body: longPayload("single") };
          },
        },
      ],
    });

    expect(result.status).toBe("completed");

    const events = await harness.getEvents(result.runId);
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).not.toContain("memory_stored");
    expect(eventTypes).not.toContain("summary_created");
    expect(eventTypes).not.toContain("context_compacted");

    expect(await harness.getSessionMemory(result.runId)).toBeUndefined();
    expect(await harness.getLatestSummary(result.runId)).toBeUndefined();
    expect(
      await harness.recallMemory({
        query: "single",
        scopes: [{ type: "run", id: result.runId }],
        limit: 5,
      }),
    ).toEqual([]);

    await harness.destroy();
  });

  it("lets an independent control plane inspect persisted context after the harness is gone", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: createMockLLM(
        [
          JSON.stringify({ tool: "lookup", arguments: { id: 7 } }),
          "Finished runtime inspection.",
        ],
        [],
      ),
      runtime: { rootDir },
      verify: { enabled: false },
      context: {
        maxPromptTokens: 400,
        reserveOutputTokens: 0,
      },
    });

    const result = await harness.run({
      goal: "Inspect record seven",
      tools: [
        {
          name: "lookup",
          description: "returns a stable payload",
          async execute(args) {
            return { id: args.id, body: "stable payload for inspection" };
          },
        },
      ],
    });

    await harness.destroy();

    const runtime = await openHarnessRuntime(rootDir);
    const run = await runtime.getRun(result.runId);
    const sessionMemory = await runtime.getSessionMemory(result.runId);
    const summary = await runtime.getLatestSummary(result.runId);
    const memories = await runtime.recallMemory({
      query: "stable payload inspection",
      scopes: [{ type: "run", id: result.runId }],
      limit: 10,
    });
    const contextPackage = await runtime.assembleContext(result.runId, {
      query: "stable payload inspection",
      maxTokens: 400,
    });

    expect(run?.status).toBe("completed");
    expect(sessionMemory).toBeDefined();
    expect(summary).toBeDefined();
    expect(memories.length).toBeGreaterThan(0);
    expect(contextPackage.blocks.length).toBeGreaterThan(0);
  });
});

import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { createHarness } from "../../packages/ai/src/index.ts";
import { createRuntimeProjectMemoryScope } from "../../packages/ai/src/harness/graph/utils.ts";
import type {
  HarnessRunEventRecord,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
  MemoryScope,
} from "../../packages/ai/src/index.ts";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function mockLLM(
  responses: Array<string | Error | ((messages: LLMMessage[]) => Promise<string> | string)>,
): LLMProvider {
  let index = 0;
  return {
    name: "mock",
    async chat(messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const next = responses[index++];
      if (next instanceof Error) {
        throw next;
      }
      const content =
        typeof next === "function" ? await next(messages) : (next ?? "done");
      return { content, model: "mock-1" };
    },
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-sidecars-"));
  tempDirs.push(dir);
  return dir;
}

async function createLongRootDir(): Promise<string> {
  const base = await createTempDir();
  const longRootDir = resolve(
    base,
    Array.from(
      { length: 4 },
      (_, index) =>
        `very-long-segment-${index.toString().padStart(2, "0")}-${"nested".repeat(8)}-${"x".repeat(48)}`,
    ).join("/"),
  );
  await mkdir(longRootDir, { recursive: true });
  return longRootDir;
}

function findEventIndex(
  events: HarnessRunEventRecord[],
  predicate: (event: HarnessRunEventRecord) => boolean,
): number {
  return events.findIndex(predicate);
}

function findEventIndices(
  events: HarnessRunEventRecord[],
  predicate: (event: HarnessRunEventRecord) => boolean,
): number[] {
  return events.reduce<number[]>((indices, event, index) => {
    if (predicate(event)) {
      indices.push(index);
    }
    return indices;
  }, []);
}

function requireEvent(
  events: HarnessRunEventRecord[],
  predicate: (event: HarnessRunEventRecord) => boolean,
): HarnessRunEventRecord {
  const event = events.find(predicate);
  expect(event).toBeDefined();
  return event!;
}

describe("Harness sidecar scheduler", () => {
  it("flushes tool observations inline and verification in the background with ordered lifecycle events", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        "done",
      ]),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteObservations: true,
      },
      verify: {
        enabled: true,
        verifier: async () => ({
          passed: true,
          reason: "looks good",
        }),
      },
    });

    const result = await harness.run({
      goal: "exercise tool sidecars",
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

    const events = await harness.getEvents(result.runId);
    const toolResultIndex = findEventIndex(events, (event) => event.type === "tool_result");
    const observationStartedIndex = findEventIndex(
      events,
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "tool_observation:step",
    );
    const observationStoredIndex = findEventIndex(
      events,
      (event) =>
        event.type === "memory_stored" &&
        event.data.kind === "observation",
    );
    const observationCompletedIndex = findEventIndex(
      events,
      (event) =>
        event.type === "sidecar_completed" &&
        event.data.sidecar === "tool_observation:step",
    );
    const verificationStartedIndex = findEventIndex(
      events,
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "tool_verification:step",
    );
    const verifyPassIndex = findEventIndex(
      events,
      (event) => event.type === "verify_pass" && event.data.tool === "step",
    );
    const verificationCompletedIndex = findEventIndex(
      events,
      (event) =>
        event.type === "sidecar_completed" &&
        event.data.sidecar === "tool_verification:step",
    );

    expect(toolResultIndex).toBeGreaterThanOrEqual(0);
    expect(observationStartedIndex).toBeGreaterThan(toolResultIndex);
    expect(observationStoredIndex).toBeGreaterThan(observationStartedIndex);
    expect(observationCompletedIndex).toBeGreaterThan(observationStoredIndex);
    expect(verificationStartedIndex).toBeGreaterThan(observationCompletedIndex);
    expect(verifyPassIndex).toBeGreaterThan(toolResultIndex);
    expect(verificationCompletedIndex).toBeGreaterThan(
      Math.max(verificationStartedIndex, verifyPassIndex),
    );

    const verificationStarted = events[verificationStartedIndex]!;
    const verificationCompleted = events[verificationCompletedIndex]!;
    expect(verificationStarted.data.mode).toBe("background");
    expect(verificationStarted.data.detail).toMatchObject({
      mode: "background",
      taskId: expect.any(String),
    });
    expect(verificationCompleted.data.detail).toMatchObject({
      mode: "background",
      taskId: verificationStarted.data.detail.taskId,
    });
  }, 15_000);

  it("stores task observations through sidecars and makes them recallable from run memory", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "background", arguments: { label: "sync" } }),
        "done",
      ]),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteObservations: true,
      },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "run a task",
      tasks: [
        {
          name: "background",
          description: "background work",
          kind: "workflow",
          async execute(args) {
            return { task: args.label, ok: true };
          },
        },
      ],
    });

    const memories = await harness.recallMemory({
      query: "background sync",
      scopes: [{ type: "run", id: result.runId }],
      kinds: ["observation"],
      limit: 10,
      minScore: 0,
    });

    expect(memories).toHaveLength(1);
    expect(memories[0]?.content).toContain("Task background called with");
    expect(memories[0]?.metadata).toMatchObject({ task: "background" });
  });

  it("captures run-boundary context through a dedicated sidecar after completion", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["done immediately"]),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteSummaries: true,
      },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "finish cleanly",
    });

    const summary = await harness.getLatestSummary(result.runId);
    const sessionMemory = await harness.getSessionMemory(result.runId);
    const events = await harness.getEvents(result.runId);

    const completedIndex = findEventIndex(events, (event) => event.type === "run_completed");
    const boundaryStartedIndex = findEventIndex(
      events,
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "run_boundary_capture",
    );
    const summaryIndex = findEventIndex(
      events,
      (event) => event.type === "summary_created",
    );
    const boundaryCompletedIndex = findEventIndex(
      events,
      (event) =>
        event.type === "sidecar_completed" &&
        event.data.sidecar === "run_boundary_capture",
    );

    expect(summary?.status).toBe("completed");
    expect(sessionMemory?.status).toBe("completed");
    expect(completedIndex).toBeGreaterThanOrEqual(0);
    expect(boundaryStartedIndex).toBeGreaterThan(completedIndex);
    expect(summaryIndex).toBeGreaterThan(boundaryStartedIndex);
    expect(boundaryCompletedIndex).toBeGreaterThan(summaryIndex);
  });

  it("retries long-term memory extraction and persists the extracted memory exactly once on success", async () => {
    const rootDir = await createTempDir();
    let attempts = 0;
    const harness = await createHarness({
      llm: mockLLM(["done immediately"]),
      runtime: { rootDir },
      context: { enabled: true },
      sidecars: {
        longTermMemory: {
          retry: { maxAttempts: 2, backoffMs: 0, backoffMultiplier: 1, maxBackoffMs: 0 },
          extract: async (input) => {
            attempts += 1;
            if (attempts === 1) {
              throw new Error("extract flaked");
            }
            return [
              {
                scope: createRuntimeProjectMemoryScope(input.runtimeRootDir),
                kind: "fact",
                content: `Long-term memory for ${input.runId}`,
              },
            ];
          },
        },
      },
      verify: { enabled: false },
    });

    const result = await harness.run({ goal: "exercise extraction retry" });
    const runtimeRootDir = harness.getPaths().rootDir;
    const events = await harness.getEvents(result.runId);
    const started = findEventIndices(
      events,
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "long_term_memory_extract",
    );
    const completed = findEventIndices(
      events,
      (event) =>
        event.type === "sidecar_completed" &&
        event.data.sidecar === "long_term_memory_extract",
    );
    const failed = findEventIndices(
      events,
      (event) =>
        event.type === "sidecar_failed" &&
        event.data.sidecar === "long_term_memory_extract",
    );
    const factMemoryEvents = events.filter(
      (event) =>
        event.type === "memory_stored" &&
        event.data.kind === "fact" &&
        event.data.scope &&
        typeof event.data.scope === "object" &&
        (event.data.scope as MemoryScope).type === "project",
    );
    const storedScope = factMemoryEvents[0]?.data.scope as MemoryScope | undefined;

    expect(attempts).toBe(2);
    expect(started).toHaveLength(2);
    expect(completed).toHaveLength(1);
    expect(failed).toHaveLength(0);
    expect(factMemoryEvents).toHaveLength(1);
    expect(storedScope).toMatchObject(createRuntimeProjectMemoryScope(runtimeRootDir));
  });

  it("dedupes trailing long-term extraction across many checkpoint updates and only runs the latest sidecar once", async () => {
    const rootDir = await createTempDir();
    let extractions = 0;
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done",
      ]),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteObservations: true,
      },
      sidecars: {
        longTermMemory: {
          extract: async () => {
            extractions += 1;
            return [];
          },
        },
      },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "trigger multiple checkpoints",
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

    const events = await harness.getEvents(result.runId);
    const sessionRefreshes = findEventIndices(
      events,
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "session_memory_refresh",
    );
    const extractStarts = findEventIndices(
      events,
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "long_term_memory_extract",
    );

    expect(sessionRefreshes.length).toBeGreaterThan(1);
    expect(extractions).toBe(1);
    expect(extractStarts).toHaveLength(1);
    expect(requireEvent(events, (event) => event.type === "run_completed")).toBeDefined();
  });

  it("treats best-effort background verification failures as non-fatal and still completes the run", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        "done",
      ]),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteObservations: true,
      },
      sidecars: {
        verification: {
          bestEffort: true,
          retry: { maxAttempts: 1 },
        },
      },
      verify: {
        enabled: true,
        verifier: async () => {
          throw new Error("verification exploded");
        },
      },
    });

    const result = await harness.run({
      goal: "best effort verification should not fail the run",
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

    const run = await harness.getRun(result.runId);
    const events = await harness.getEvents(result.runId);
    const sidecarFailure = requireEvent(
      events,
      (event) =>
        event.type === "sidecar_failed" &&
        event.data.sidecar === "tool_verification:step",
    );

    expect(run?.status).toBe("completed");
    expect(events.some((event) => event.type === "run_failed")).toBe(false);
    expect(sidecarFailure.data.error).toContain("verification exploded");
    expect(sidecarFailure.data.mode).toBe("background");
    expect(sidecarFailure.data.detail).toMatchObject({ mode: "background", taskId: expect.any(String) });
  });

  it("fails closed when a non-best-effort verification sidecar throws and records sidecar_failed before run_failed", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        "done",
      ]),
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteObservations: true,
      },
      verify: {
        enabled: true,
        verifier: async () => {
          throw new Error("verification exploded");
        },
      },
    });

    const started = await harness.startRun({
      goal: "sidecar failure should fail the run",
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

    await expect(started.result).rejects.toThrow("verification exploded");

    const run = await harness.getRun(started.runId);
    const events = await harness.getEvents(started.runId);
    const sidecarFailedIndex = findEventIndex(
      events,
      (event) =>
        event.type === "sidecar_failed" &&
        event.data.sidecar === "tool_verification:step",
    );
    const runFailedIndex = findEventIndex(events, (event) => event.type === "run_failed");

    expect(run?.status).toBe("failed");
    expect(sidecarFailedIndex).toBeGreaterThanOrEqual(0);
    expect(runFailedIndex).toBeGreaterThan(sidecarFailedIndex);
  });

  it("recalls project-scoped long-term memories into later runs through the default context assembly path", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["done immediately", "done immediately"]),
      runtime: { rootDir },
      context: { enabled: true },
      sidecars: {
        longTermMemory: {
          enabled: true,
          extract: async (input) => [
            {
              scope: createRuntimeProjectMemoryScope(input.runtimeRootDir),
              kind: "fact",
              content: `Project memory for ${input.sessionMemory.goal}`,
            },
          ],
        },
      },
      verify: { enabled: false },
    });

    const first = await harness.run({ goal: "same goal for project recall" });
    const second = await harness.run({ goal: "same goal for project recall" });
    const secondContext = await harness.assembleContext(second.runId, {
      query: "same goal for project recall",
    });

    const memoryBlock = secondContext.blocks.find(
      (block) =>
        block.title === "Relevant Memory" &&
        block.content.includes("Project memory for same goal for project recall"),
    );
    const firstEvents = await harness.getEvents(first.runId);

    expect(
      firstEvents.some(
        (event) =>
          event.type === "sidecar_completed" &&
          event.data.sidecar === "long_term_memory_extract",
      ),
    ).toBe(true);
    expect(memoryBlock).toBeDefined();
    expect(secondContext.blocks.some((block) => block.title === "Graph State")).toBe(true);
  });

  it("uses deterministic long-term extraction by default so completed runs do not consume subsequent main-model responses", async () => {
    const rootDir = await createTempDir();
    let calls = 0;
    const harness = await createHarness({
      llm: {
        name: "main-only",
        async chat(): Promise<LLMResponse> {
          calls += 1;
          return {
            model: "mock-1",
            content: `main-run-${calls}`,
          };
        },
      },
      runtime: { rootDir },
      context: {
        enabled: true,
        autoPromoteSummaries: true,
      },
      sidecars: {
        longTermMemory: {
          enabled: true,
        },
      },
      verify: { enabled: false },
    });

    const first = await harness.run({ goal: "first deterministic extraction run" });
    const second = await harness.run({ goal: "second deterministic extraction run" });

    expect(first.result).toBe("main-run-1");
    expect(second.result).toBe("main-run-2");
    expect(calls).toBe(2);

    const firstEvents = await harness.getEvents(first.runId);
    const extractionStarted = requireEvent(
      firstEvents,
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "long_term_memory_extract",
    );
    const extractionCompleted = requireEvent(
      firstEvents,
      (event) =>
        event.type === "sidecar_completed" &&
        event.data.sidecar === "long_term_memory_extract",
    );
    expect(extractionStarted.data.mode).toBe("inline");
    expect(extractionCompleted.data.mode).toBe("inline");
  });

  it("stores project-scoped long-term memories under very long runtime roots without sidecar failure", async () => {
    const rootDir = await createLongRootDir();
    const harness = await createHarness({
      llm: mockLLM(["done immediately"]),
      runtime: { rootDir },
      context: { enabled: true },
      sidecars: {
        longTermMemory: {
          enabled: true,
          extract: async (input) => [
            {
              scope: createRuntimeProjectMemoryScope(input.runtimeRootDir),
              kind: "fact",
              content: "very long runtime roots still persist extracted memory",
            },
          ],
        },
      },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "exercise long runtime root extraction",
    });
    const runtimeRootDir = harness.getPaths().rootDir;

    const events = await harness.getEvents(result.runId);
    const memoryEvent = requireEvent(
      events,
      (event) =>
        event.type === "memory_stored" &&
        event.data.kind === "fact" &&
        (event.data.scope as MemoryScope | undefined)?.type === "project",
    );
    const memoryScope = memoryEvent.data.scope as MemoryScope;
    const recalled = await harness.recallMemory({
      query: "Run insight",
      scopes: [memoryScope],
      kinds: ["fact"],
      limit: 10,
      minScore: 0,
    });

    expect(
      events.some(
        (event) =>
          event.type === "sidecar_failed" &&
          event.data.sidecar === "long_term_memory_extract",
      ),
    ).toBe(false);
    expect(memoryScope).toMatchObject(createRuntimeProjectMemoryScope(runtimeRootDir));
    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.content).toContain("very long runtime roots");
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createHarness,
  FileHarnessRuntimeStore,
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
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-graph-runtime-"));
  tempDirs.push(dir);
  return dir;
}

function mockLLM(responses: string[]): LLMProvider {
  let index = 0;
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const content = responses[index] ?? responses[responses.length - 1] ?? "done";
      index += 1;
      return {
        content,
        model: "mock-1",
      };
    },
  };
}

describe("harness graph runtime", () => {
  it("keeps run, tool, task, approval, artifact, memory, summary, and replay projections consistent", async () => {
    const rootDir = await createTempDir();
    let allowTaskExecution = false;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({
          tools: [
            { tool: "lookup", arguments: { page: 1 } },
            { tool: "assemble-report", arguments: { section: "alpha" } },
          ],
        }),
        "Graph run complete.",
      ]),
      runtime: {
        rootDir,
        beforeTaskCall: async ({ task }) => ({
          allowed: allowTaskExecution || task !== "assemble-report",
          ...(allowTaskExecution || task !== "assemble-report"
            ? {}
            : { reason: "manual approval required for the task edge" }),
        }),
      },
      verify: { enabled: false },
      context: {
        maxPromptTokens: 2400,
        reserveOutputTokens: 0,
        maxRecentMessages: 4,
        maxRecentToolResults: 2,
        microcompactToolResultChars: 96,
        sessionCompactThreshold: 0.2,
        autoPromoteObservations: true,
        autoPromoteSummaries: true,
      },
    });

    const runResult = await harness.run({
      goal: "Build a graph projection summary",
      tools: [
        {
          name: "lookup",
          description: "returns a deterministic payload",
          async execute(args) {
            return {
              page: args.page,
              body: `graph body for page ${args.page}`,
            };
          },
        },
      ],
      tasks: [
        {
          name: "assemble-report",
          description: "turns a task request into a report",
          kind: "workflow",
          async execute(args, context) {
            return {
              section: args.section,
              runId: context.runId,
              requestId: context.requestId,
              taskId: context.taskId,
              callStackSize: context.callStack?.size ?? 0,
            };
          },
        },
      ],
    });

    expect(runResult.status).toBe("approval_required");
    expect(runResult.pendingApproval).toMatchObject({
      kind: "task",
      tool: "assemble-report",
    });

    const blockedRun = await harness.getRun(runResult.runId);
    expect(blockedRun?.status).toBe("approval_required");
    expect(blockedRun?.pendingApprovalId).toBeString();
    expect(blockedRun?.taskNames).toEqual(["assemble-report"]);
    expect(blockedRun?.toolNames).toContain("lookup");

    const approval = await harness.getApproval(blockedRun!.pendingApprovalId!);
    expect(approval).toMatchObject({
      runId: runResult.runId,
      kind: "task",
      status: "pending",
      tool: "assemble-report",
    });

    const eventsBeforeResume = await harness.getEvents(runResult.runId);
    expect(eventsBeforeResume.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "run_started",
        "tool_call",
        "tool_result",
        "memory_stored",
        "task_call",
        "approval_required",
      ]),
    );
    expect(
      eventsBeforeResume.findIndex((event) => event.type === "tool_result"),
    ).toBeLessThan(eventsBeforeResume.findIndex((event) => event.type === "approval_required"));

    allowTaskExecution = true;
    const resumed = await harness.resumeRun(runResult.runId, {
      approvePendingTool: true,
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.taskCalls).toEqual([
      expect.objectContaining({
        task: "assemble-report",
        result: expect.objectContaining({
          section: "alpha",
          runId: runResult.runId,
        }),
      }),
    ]);

    const finalRun = await harness.getRun(runResult.runId);
    expect(finalRun?.status).toBe("completed");
    expect(finalRun?.toolCalls).toBe(1);
    expect(finalRun?.taskCalls).toBe(1);
    expect(finalRun?.pendingApprovalId).toBeUndefined();
    expect(finalRun?.pendingApproval).toBeUndefined();

    const taskRecords = await harness.getTasks(runResult.runId);
    expect(taskRecords).toHaveLength(1);
    expect(taskRecords[0]).toMatchObject({
      runId: runResult.runId,
      name: "assemble-report",
      kind: "workflow",
      status: "completed",
    });

    const sessionMemory = await harness.getSessionMemory(runResult.runId);
    expect(sessionMemory).toMatchObject({
      runId: runResult.runId,
      status: "completed",
    });

    const summary = await harness.getLatestSummary(runResult.runId);
    expect(summary).toMatchObject({
      runId: runResult.runId,
      status: "completed",
      kind: "run_compact",
    });

    const observation = await harness.recallMemory({
      query: "graph body page 1",
      scopes: [{ type: "run", id: runResult.runId }],
      kinds: ["observation"],
      runId: runResult.runId,
      limit: 5,
    });
    expect(observation.length).toBeGreaterThanOrEqual(2);
    expect(observation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: runResult.runId,
          kind: "observation",
          scope: { type: "run", id: runResult.runId },
          metadata: expect.objectContaining({ tool: "lookup" }),
        }),
        expect.objectContaining({
          runId: runResult.runId,
          kind: "observation",
          scope: { type: "run", id: runResult.runId },
          metadata: expect.objectContaining({ task: "assemble-report" }),
        }),
      ]),
    );
    expect(observation[0]).toMatchObject({
      runId: runResult.runId,
      kind: "observation",
      scope: { type: "run", id: runResult.runId },
    });

    const runtimeStore = new FileHarnessRuntimeStore(rootDir);
    const artifact = await runtimeStore.writeArtifact(runResult.runId, {
      kind: "report",
      content: "graph artifact preview",
      extension: ".md",
      mimeType: "text/markdown",
      metadata: {
        node: "artifact",
      },
    });
    const currentRun = await runtimeStore.requireRun(runResult.runId);
    await runtimeStore.transitionRun(
      runResult.runId,
      "artifact_created",
      {
        artifactIds: [...currentRun.artifactIds, artifact.id],
      },
      {
        artifactId: artifact.id,
        kind: artifact.kind,
        path: artifact.path,
        mimeType: artifact.mimeType,
        size: artifact.size,
      },
    );

    const runtime = await openHarnessRuntime(rootDir);
    const graphRun = await runtime.getRun(runResult.runId);
    expect(graphRun?.artifactIds).toEqual([artifact.id]);

    const artifacts = await runtime.getArtifacts(runResult.runId);
    expect(artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        runId: runResult.runId,
        kind: "report",
      }),
    ]);

    const projection = await harness.assembleContext(runResult.runId, {
      query: "graph artifact preview",
      maxTokens: 600,
      maxArtifacts: 4,
    });
    expect(projection.artifactRefs.map((entry) => entry.artifactId)).toEqual([artifact.id]);
    expect(projection.blocks.some((block) => block.kind === "artifact")).toBe(true);
    expect(projection.blocks.some((block) => block.kind === "summary")).toBe(true);

    const replay = await runtime.replayRun(runResult.runId);
    expect(replay.consistent).toBe(true);
    expect(replay.derivedStatus).toBe("completed");
    expect(replay.derivedToolCalls).toBe(1);
    expect(replay.derivedTaskCalls).toBe(1);
    expect(replay.derivedArtifactCount).toBe(1);

    const eventsAfterArtifact = await runtime.getEvents(runResult.runId);
    expect(eventsAfterArtifact.map((event) => event.type)).toContain("artifact_created");
    expect(
      eventsAfterArtifact.findIndex((event) => event.type === "approval_approved"),
    ).toBeLessThan(eventsAfterArtifact.findIndex((event) => event.type === "task_result"));
    expect(
      eventsAfterArtifact.findIndex((event) => event.type === "task_result"),
    ).toBeLessThan(eventsAfterArtifact.findIndex((event) => event.type === "run_completed"));

    await harness.destroy();
  });
});

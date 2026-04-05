import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  bindHarnessApprovalRecord,
  bindHarnessArtifactRecord,
  bindHarnessCheckpointRecord,
  bindHarnessMemoryRecord,
  bindHarnessRunRecord,
  bindHarnessTaskRecord,
  createHarnessGraphStore,
  projectHarnessApprovalInbox,
  projectHarnessArtifactFeed,
  projectHarnessMemoryFeed,
  projectHarnessRunTimeline,
  projectHarnessTaskBoard,
} from "../../packages/ai/src/harness/graph/index.ts";
import type {
  HarnessApprovalRecord,
  HarnessArtifactRecord,
  HarnessMemoryRecord,
  HarnessRunRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
  HarnessTaskRecord,
} from "../../packages/ai/src/harness/types.ts";
import type { AgentLoopCheckpoint } from "../../packages/ai/src/types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-graph-projectors-"));
  tempDirs.push(dir);
  return dir;
}

function buildRun(): HarnessRunRecord {
  return {
    id: "run-1",
    goal: "ship the release",
    status: "running",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:10.000Z",
    iterations: 3,
    toolCalls: 2,
    taskCalls: 1,
    maxIterations: 8,
    toolNames: ["search"],
    taskNames: ["deploy"],
    artifactIds: ["artifact-1"],
    taskIds: ["task-1", "task-2"],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: true,
      artifactDir: "/tmp/artifacts/run-1",
    },
    pendingApprovalId: "approval-1",
    latestSummaryId: "summary-1",
    lastEventSequence: 5,
  };
}

function buildCheckpoint(): AgentLoopCheckpoint {
  return {
    stage: "assistant_response",
    config: {
      goal: "ship the release",
      maxIterations: 8,
    },
    messages: [{ role: "user", content: "goal" }],
    iterations: 3,
    toolCalls: [{ tool: "search", args: { q: "release" }, result: { hits: 1 } }],
    pendingToolCall: {
      assistantMessage: "answer",
      tool: "search",
      args: { q: "release" },
    },
    orchestration: {
      phase: "executing_tools",
      transitionReason: "next_turn",
      turnCount: 4,
      recovery: {
        reactiveCompactRetries: 0,
        tokenContinuations: 0,
        toolRecoveryCount: 0,
      },
      pendingToolRequests: [],
      pendingTaskRequests: [],
      waitingTaskIds: [],
      lastModelFinishReason: "tool_use",
      continuationPrompt: "continue",
      assistantMessagePersisted: true,
    },
    lastAssistantResponse: "answer",
  };
}

function buildTask(id: string, status: HarnessTaskRecord["status"], order: number): HarnessTaskRecord {
  return {
    id,
    runId: "run-1",
    requestId: `request-${id}`,
    name: id,
    kind: "workflow",
    order,
    status,
    createdAt: `2026-04-03T00:00:0${order}.000Z`,
    updatedAt: `2026-04-03T00:00:1${order}.000Z`,
    args: { name: id },
    hardFailure: false,
    result: status === "completed" ? { ok: true } : undefined,
    error: status === "failed" ? "boom" : undefined,
  };
}

function buildApproval(id: string, status: HarnessApprovalRecord["status"], requestedAt: string): HarnessApprovalRecord {
  return {
    id,
    runId: "run-1",
    kind: "tool",
    tool: id,
    args: { file: `${id}.md` },
    reason: `${id} reason`,
    requestedAt,
    updatedAt: `${requestedAt.slice(0, -1)}1Z`,
    status,
  } as HarnessApprovalRecord;
}

function buildArtifact(): HarnessArtifactRecord {
  return {
    id: "artifact-1",
    runId: "run-1",
    kind: "screenshot",
    path: "/tmp/artifacts/run-1/screen.png",
    createdAt: "2026-04-03T00:00:05.000Z",
    mimeType: "image/png",
    size: 2048,
    metadata: { kind: "screenshot", source: "browser", preview: "base64:..." },
  };
}

function buildMemory(): HarnessMemoryRecord {
  return {
    id: "memory-1",
    scope: { type: "project", id: "capstan" },
    kind: "summary",
    content: "Ship releases after validation.",
    createdAt: "2026-04-03T00:00:06.000Z",
    updatedAt: "2026-04-03T00:00:08.000Z",
    accessCount: 0,
    lastAccessedAt: "2026-04-03T00:00:06.000Z",
    runId: "run-1",
    importance: "high",
    metadata: { source: "session" },
  };
}

function buildSessionMemory(): HarnessSessionMemoryRecord {
  return {
    runId: "run-1",
    goal: "ship the release",
    status: "running",
    updatedAt: "2026-04-03T00:00:09.000Z",
    sourceRunUpdatedAt: "2026-04-03T00:00:08.000Z",
    headline: "Release is blocked on approval",
    currentPhase: "approval_blocked",
    lastAssistantResponse: "need approval",
    recentSteps: ["draft release", "request approval"],
    blockers: ["pending approval"],
    openQuestions: ["is rollout allowed?"],
    pendingApproval: {
      tool: "write",
      reason: "Needs approval",
    },
    artifactRefs: [],
    compactedMessages: 2,
    tokenEstimate: 111,
  };
}

function buildSummary(): HarnessSummaryRecord {
  return {
    id: "summary-1",
    runId: "run-1",
    createdAt: "2026-04-03T00:00:09.000Z",
    updatedAt: "2026-04-03T00:00:10.000Z",
    sourceRunUpdatedAt: "2026-04-03T00:00:10.000Z",
    kind: "run_compact",
    status: "running",
    headline: "Release summary",
    completedSteps: ["draft release"],
    blockers: ["pending approval"],
    openQuestions: ["is rollout allowed?"],
    artifactRefs: [],
    iterations: 3,
    toolCalls: 4,
    messageCount: 6,
    compactedMessages: 2,
  };
}

describe("graph projectors", () => {
  it("builds a stable run timeline and task board from graph nodes", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    const run = buildRun();
    const checkpoint = buildCheckpoint();

    const runBinding = bindHarnessRunRecord({ run });
    const checkpointBinding = bindHarnessCheckpointRecord({
      runId: run.id,
      checkpoint,
      updatedAt: "2026-04-03T00:00:11.000Z",
    });
    const taskBindings = [
      bindHarnessTaskRecord({ task: buildTask("task-1", "running", 0) }),
      bindHarnessTaskRecord({ task: buildTask("task-2", "completed", 1) }),
      bindHarnessTaskRecord({ task: buildTask("task-3", "failed", 2) }),
      bindHarnessTaskRecord({ task: buildTask("task-4", "canceled", 3) }),
    ];
    const approvalBindings = [
      bindHarnessApprovalRecord({
        approval: buildApproval("approval-1", "pending", "2026-04-03T00:00:03.000Z"),
      }),
      bindHarnessApprovalRecord({
        approval: buildApproval("approval-2", "approved", "2026-04-03T00:00:04.000Z"),
      }),
    ];
    const artifactBinding = bindHarnessArtifactRecord({
      artifact: buildArtifact(),
      sourceNodeId: "turn:run-1:4:assistant_response",
    });
    const memoryBinding = bindHarnessMemoryRecord({
      memory: buildMemory(),
      sourceNodeId: "turn:run-1:4:assistant_response",
    });
    const sessionMemoryBinding = bindHarnessMemoryRecord({
      memory: buildSessionMemory(),
      sourceNodeId: "turn:run-1:4:assistant_response",
    });
    const summaryBinding = bindHarnessMemoryRecord({
      memory: buildSummary(),
      sourceNodeId: "turn:run-1:4:assistant_response",
    });

    for (const binding of [
      runBinding,
      checkpointBinding,
      ...taskBindings,
      ...approvalBindings,
      artifactBinding,
      memoryBinding,
      sessionMemoryBinding,
      summaryBinding,
    ]) {
      await store.persistScope(binding.scope);
      for (const node of binding.nodes) {
        await store.persistNode(node);
      }
      for (const edge of binding.edges) {
        await store.persistEdge(edge);
      }
    }

    const timeline = await projectHarnessRunTimeline(store, { runId: run.id });
    expect(timeline.items.map((item) => item.kind)).toEqual([
      "run",
      "checkpoint",
      "turn",
      "task",
      "task",
      "task",
      "task",
      "approval",
      "approval",
      "artifact",
      "memory",
      "memory",
      "memory",
    ]);
    expect(timeline.items[0]).toMatchObject({
      title: "Run: ship the release",
      status: "running",
    });

    const board = await projectHarnessTaskBoard(store, { runId: run.id });
    expect(board.running.map((item) => item.taskId)).toEqual(["task:run-1:task-1"]);
    expect(board.completed.map((item) => item.taskId)).toEqual(["task:run-1:task-2"]);
    expect(board.failed.map((item) => item.taskId)).toEqual(["task:run-1:task-3"]);
    expect(board.canceled.map((item) => item.taskId)).toEqual(["task:run-1:task-4"]);

    const inbox = await projectHarnessApprovalInbox(store, { runId: run.id });
    expect(inbox.pending.map((item) => item.approvalId)).toEqual(["approval:run-1:approval-1"]);
    expect(inbox.resolved.map((item) => item.approvalId)).toEqual(["approval:run-1:approval-2"]);

    const artifactFeed = await projectHarnessArtifactFeed(store, { runId: run.id });
    expect(artifactFeed.items[0]).toMatchObject({
      artifactId: "artifact:run-1:artifact-1",
      kind: "screenshot",
      mimeType: "image/png",
      size: 2048,
      preview: "base64:...",
    });

    const memoryFeed = await projectHarnessMemoryFeed(store, {
      scopes: [{ kind: "project", projectId: "capstan" }],
    });
    expect(memoryFeed.items).toHaveLength(1);
    expect(memoryFeed.items[0]).toMatchObject({
      memoryId: "memory:project__capstan:memory-1",
      kind: "summary",
      importance: "high",
    });
  });
});

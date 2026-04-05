import { describe, expect, it } from "bun:test";

import {
  bindHarnessApprovalRecord,
  bindHarnessArtifactRecord,
  bindHarnessCheckpointRecord,
  bindHarnessMemoryRecord,
  bindHarnessRunRecord,
  bindHarnessTaskRecord,
  buildApprovalGraphNode,
  buildArtifactGraphNode,
  buildMemoryGraphNode,
  buildRunApprovalEdge,
  buildRunArtifactEdge,
  buildRunGraphNode,
  buildRunMemoryEdge,
  buildRunTaskEdge,
  buildRunTurnEdge,
  buildTaskGraphNode,
  buildTurnGraphNode,
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

function buildRun(): HarnessRunRecord {
  return {
    id: "run-1",
    goal: "ship the release",
    status: "running",
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:10.000Z",
    iterations: 3,
    toolCalls: 4,
    taskCalls: 2,
    maxIterations: 8,
    toolNames: ["search", "write"],
    taskNames: ["deploy"],
    artifactIds: ["artifact-1"],
    taskIds: ["task-1"],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: true,
      artifactDir: "/tmp/artifacts/run-1",
    },
    pendingApprovalId: "approval-1",
    latestSummaryId: "summary-1",
    trigger: {
      type: "cron",
      source: "scheduler",
      firedAt: "2026-04-03T00:00:00.000Z",
      schedule: {
        name: "daily-release",
        pattern: "FREQ=WEEKLY;BYDAY=MO",
      },
    },
    lastEventSequence: 7,
  };
}

function buildCheckpoint(): AgentLoopCheckpoint {
  return {
    stage: "assistant_response",
    config: {
      goal: "ship the release",
      maxIterations: 8,
    },
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "goal" },
      { role: "assistant", content: "answer" },
    ],
    iterations: 3,
    toolCalls: [{ tool: "search", args: { q: "release" }, result: { hits: 1 } }],
    lastAssistantResponse: "answer",
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
        reactiveCompactRetries: 1,
        tokenContinuations: 0,
        toolRecoveryCount: 0,
      },
      pendingToolRequests: [{ id: "tool-1", name: "write", args: { file: "x" }, order: 0 }],
      pendingTaskRequests: [{ id: "task-request-1", name: "deploy", args: { version: "1.0.0" }, order: 0 }],
      waitingTaskIds: ["task-1"],
      lastModelFinishReason: "tool_use",
      continuationPrompt: "continue",
      assistantMessagePersisted: true,
    },
  };
}

function buildTask(): HarnessTaskRecord {
  return {
    id: "task-1",
    runId: "run-1",
    requestId: "request-1",
    name: "deploy",
    kind: "workflow",
    order: 0,
    status: "completed",
    createdAt: "2026-04-03T00:00:01.000Z",
    updatedAt: "2026-04-03T00:00:08.000Z",
    args: { version: "1.0.0" },
    hardFailure: false,
    result: { deployed: true },
  };
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
    metadata: { source: "browser" },
  };
}

function buildMemory(): HarnessMemoryRecord {
  return {
    id: "memory-1",
    scope: { type: "project", id: "capstan" },
    kind: "summary",
    content: "Ship releases after validation.",
    createdAt: "2026-04-03T00:00:06.000Z",
    updatedAt: "2026-04-03T00:00:07.000Z",
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
    updatedAt: "2026-04-03T00:00:06.000Z",
    sourceRunUpdatedAt: "2026-04-03T00:00:06.000Z",
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

function buildApproval(): HarnessApprovalRecord {
  return {
    id: "approval-1",
    runId: "run-1",
    kind: "tool",
    tool: "write",
    args: { file: "release.md" },
    reason: "Needs approval",
    requestedAt: "2026-04-03T00:00:02.000Z",
    updatedAt: "2026-04-03T00:00:03.000Z",
    status: "pending",
    metadata: { source: "policy" },
  } as HarnessApprovalRecord;
}

describe("graph bindings", () => {
  it("builds deterministic runtime graph nodes and edges for the run lifecycle", () => {
    const run = buildRun();
    const checkpoint = buildCheckpoint();

    const runNode = buildRunGraphNode({ rootDir: "/tmp" }, run);
    expect(runNode).toMatchObject({
      id: "run:run-1",
      kind: "run",
      scope: { kind: "run", runId: "run-1" },
      title: "Run: ship the release",
      status: "running",
    });

    const turnNode = buildTurnGraphNode({ rootDir: "/tmp" }, run, checkpoint, "2026-04-03T00:00:10.000Z");
    expect(turnNode).toMatchObject({
      id: "turn:run-1:4:assistant_response",
      kind: "turn",
      status: "executing_tools",
      title: "Turn 4: executing_tools",
    });
    expect(turnNode.metadata).toMatchObject({
      transitionReason: "next_turn",
      lastModelFinishReason: "tool_use",
    });

    expect(buildRunTurnEdge(run, turnNode.id, "2026-04-03T00:00:10.000Z")).toMatchObject({
      kind: "contains",
      from: "run:run-1",
      to: turnNode.id,
      runId: "run-1",
    });
    expect(buildRunTaskEdge(run, buildTask())).toMatchObject({
      kind: "contains",
      from: "run:run-1",
      to: "task:run-1:task-1",
      runId: "run-1",
    });
    expect(buildRunArtifactEdge(run, buildArtifact())).toMatchObject({
      kind: "contains",
      from: "run:run-1",
      to: "artifact:run-1:artifact-1",
      runId: "run-1",
    });
    expect(buildRunApprovalEdge(run, buildApproval())).toMatchObject({
      kind: "contains",
      from: "run:run-1",
      to: "approval:run-1:approval-1",
      runId: "run-1",
    });
    expect(buildRunMemoryEdge(run, "memory:project__capstan:memory-1", "2026-04-03T00:00:10.000Z", "summary")).toMatchObject({
      kind: "contains",
      from: "run:run-1",
      to: "memory:project__capstan:memory-1",
      runId: "run-1",
    });
  });

  it("binds checkpoints, tasks, artifacts, memory, and approvals into a single coherent scope", () => {
    const run = buildRun();
    const checkpoint = buildCheckpoint();

    const runBinding = bindHarnessRunRecord({ run });
    expect(runBinding.scope.scope).toEqual({ kind: "run", runId: "run-1" });
    expect(runBinding.nodes).toHaveLength(1);
    expect(runBinding.nodes[0]).toMatchObject({
      id: "run:run-1",
      kind: "run",
      title: "Run: ship the release",
      status: "running",
    });
    expect(runBinding.edges.map((edge) => edge.kind)).toEqual([
      "contains",
      "contains",
      "contains",
      "references",
    ]);

    const checkpointBinding = bindHarnessCheckpointRecord({
      runId: run.id,
      checkpoint,
      updatedAt: "2026-04-03T00:00:10.000Z",
      previousTurnId: "turn:run-1:3:initializing",
    });
    expect(checkpointBinding.nodes.map((node) => node.kind)).toEqual([
      "checkpoint",
      "turn",
    ]);
    expect(checkpointBinding.nodes[1]).toMatchObject({
      id: "turn:run-1:4:assistant_response",
      title: "Turn 4: executing_tools",
      status: "executing_tools",
    });
    expect(checkpointBinding.edges.map((edge) => edge.kind)).toEqual([
      "contains",
      "contains",
      "summarizes",
      "follows",
    ]);

    const taskBinding = bindHarnessTaskRecord({ task: buildTask() });
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
    const approvalBinding = bindHarnessApprovalRecord({
      approval: buildApproval(),
      sourceNodeId: "turn:run-1:4:assistant_response",
    });

    expect(taskBinding.nodes[0]).toMatchObject({
      id: "task:run-1:task-1",
      kind: "task",
      status: "completed",
      order: 0,
    });
    expect(artifactBinding.nodes[0]).toMatchObject({
      id: "artifact:run-1:artifact-1",
      kind: "artifact",
      status: "available",
    });
    expect(artifactBinding.nodes[0].metadata).toMatchObject({
      kind: "screenshot",
      mimeType: "image/png",
      size: 2048,
    });
    expect(memoryBinding.nodes[0]).toMatchObject({
      kind: "memory",
      status: "summary",
      scope: { kind: "project", projectId: "capstan" },
    });
    expect(sessionMemoryBinding.nodes[0]).toMatchObject({
      kind: "memory",
      status: "session_memory",
      scope: { kind: "run", runId: "run-1" },
    });
    expect(summaryBinding.nodes[0]).toMatchObject({
      kind: "memory",
      status: "summary",
      scope: { kind: "run", runId: "run-1" },
    });
    expect(approvalBinding.nodes[0]).toMatchObject({
      id: "approval:run-1:approval-1",
      kind: "approval",
      status: "pending",
    });
  });
});

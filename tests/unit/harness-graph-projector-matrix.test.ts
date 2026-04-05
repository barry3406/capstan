import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildGraphContextBlocks,
  compareTimestampDescendingThenId,
  createProjectGraphScope,
  createRunGraphScope,
  formatHarnessGraphScopeKey,
  formatHarnessGraphScopeTitle,
  graphNodeMatchesQuery,
  graphScopeKey,
  graphScopesIntersect,
  mergeGraphScopes,
  memoryScopeToGraphScope,
  normalizeGraphScopes,
  projectApprovalInbox,
  projectArtifactFeed,
  projectHarnessApprovalInbox,
  projectHarnessArtifactFeed,
  projectHarnessRunTimeline,
  projectHarnessTaskBoard,
  projectRunTimeline,
  projectTaskBoard,
  selectGraphNodesForContext,
  sortGraphEdges,
  sortGraphNodes,
  scopesEqual,
  collectGraphContextNodes,
} from "../../packages/ai/src/harness/graph/index.ts";
import { openHarnessRuntime } from "../../packages/ai/src/harness/runtime/control-plane.ts";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";
import type {
  HarnessApprovalInboxItem,
  HarnessArtifactFeedItem,
  HarnessGraphEdgeQuery,
  HarnessGraphEdgeRecord,
  HarnessGraphNodeKind,
  HarnessGraphNodeQuery,
  HarnessGraphNodeRecord,
  HarnessGraphScope,
  HarnessTaskBoardItem,
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
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const runScope = createRunGraphScope("run-1");
const projectScope = createProjectGraphScope("capstan");
const entityProjectScope: HarnessGraphScope = {
  kind: "entity",
  entityType: "project",
  entityId: "capstan",
};
const resourceScope: HarnessGraphScope = {
  kind: "resource",
  resourceType: "database",
  resourceId: "primary",
};
const capabilityScope: HarnessGraphScope = {
  kind: "capability",
  capabilityId: "release.deploy",
};
const policyScope: HarnessGraphScope = {
  kind: "policy",
  policyId: "release-guardrails",
};

function buildRun(id = "run-1", patch: Partial<HarnessRunRecord> = {}): HarnessRunRecord {
  return {
    id,
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
      artifactDir: `/tmp/artifacts/${id}`,
    },
    pendingApprovalId: "approval-1",
    latestSummaryId: "summary-1",
    lastEventSequence: 5,
    ...patch,
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

function buildTask(
  id: string,
  status: HarnessTaskRecord["status"],
  order: number,
  updatedAt: string,
  patch: Partial<HarnessTaskRecord> = {},
): HarnessTaskRecord {
  return {
    id,
    runId: "run-1",
    requestId: `request-${id}`,
    name: id,
    kind: "workflow",
    order,
    status,
    createdAt: updatedAt,
    updatedAt,
    args: { name: id },
    hardFailure: false,
    ...(status === "completed" ? { result: { ok: true } } : {}),
    ...(status === "failed" ? { error: "boom" } : {}),
    ...patch,
  };
}

function buildApproval(
  id: string,
  status: HarnessApprovalRecord["status"],
  requestedAt: string,
  patch: Partial<HarnessApprovalRecord> = {},
): HarnessApprovalRecord {
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
    ...patch,
  } as HarnessApprovalRecord;
}

function buildArtifact(
  id: string,
  updatedAt: string,
  patch: Partial<HarnessArtifactRecord> = {},
): HarnessArtifactRecord {
  return {
    id,
    runId: "run-1",
    kind: "screenshot",
    path: `/tmp/artifacts/run-1/${id}.png`,
    createdAt: updatedAt,
    mimeType: "image/png",
    size: 2048,
    metadata: { kind: "screenshot", source: "browser", preview: "base64:..." },
    ...patch,
  };
}

function buildMemory(id: string, patch: Partial<HarnessMemoryRecord> = {}): HarnessMemoryRecord {
  return {
    id,
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
    ...patch,
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

function buildGraphNode(
  id: string,
  kind: HarnessGraphNodeKind,
  updatedAt: string,
  patch: Partial<HarnessGraphNodeRecord> = {},
): HarnessGraphNodeRecord {
  return {
    id,
    kind,
    scope: patch.scope ?? runScope,
    title: patch.title ?? `${kind}:${id}`,
    createdAt: patch.createdAt ?? updatedAt,
    updatedAt,
    ...(patch.runId ? { runId: patch.runId } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.summary ? { summary: patch.summary } : {}),
    ...(patch.content ? { content: patch.content } : {}),
    ...(patch.order != null ? { order: patch.order } : {}),
    ...(patch.sourceId ? { sourceId: patch.sourceId } : {}),
    ...(patch.relatedIds ? { relatedIds: patch.relatedIds } : {}),
    ...(patch.metadata ? { metadata: patch.metadata } : {}),
  };
}

function buildGraphEdge(
  id: string,
  from: string,
  to: string,
  updatedAt: string,
  patch: Partial<HarnessGraphEdgeRecord> = {},
): HarnessGraphEdgeRecord {
  return {
    id,
    kind: patch.kind ?? "references",
    scope: patch.scope ?? runScope,
    from,
    to,
    createdAt: patch.createdAt ?? updatedAt,
    updatedAt,
    ...(patch.runId ? { runId: patch.runId } : {}),
    ...(patch.metadata ? { metadata: patch.metadata } : {}),
  };
}

type MatrixSeed = {
  nodes: HarnessGraphNodeRecord[];
  edges: HarnessGraphEdgeRecord[];
};

class MatrixGraphStore {
  readonly nodeQueries: HarnessGraphNodeQuery[] = [];
  readonly edgeQueries: HarnessGraphEdgeQuery[] = [];

  constructor(
    private readonly nodes: HarnessGraphNodeRecord[],
    private readonly edges: HarnessGraphEdgeRecord[],
  ) {}

  async listGraphNodes(query?: HarnessGraphNodeQuery): Promise<HarnessGraphNodeRecord[]> {
    this.nodeQueries.push(query ?? {});
    return sortGraphNodes(this.nodes.filter((node) => graphNodeMatchesQuery(node, query)));
  }

  async listGraphEdges(query?: HarnessGraphEdgeQuery): Promise<HarnessGraphEdgeRecord[]> {
    this.edgeQueries.push(query ?? {});
    return sortGraphEdges(this.edges.filter((edge) => graphEdgeMatchesQuery(edge, query)));
  }

  async getGraphNode(nodeId: string): Promise<HarnessGraphNodeRecord | undefined> {
    return this.nodes.find((node) => node.id === nodeId);
  }
}

function graphEdgeMatchesQuery(edge: HarnessGraphEdgeRecord, query?: HarnessGraphEdgeQuery): boolean {
  if (!query) {
    return true;
  }
  if (query.kinds?.length && !query.kinds.includes(edge.kind)) {
    return false;
  }
  if (query.runId && edge.runId !== query.runId) {
    return false;
  }
  if (query.ids?.length && !query.ids.includes(edge.id)) {
    return false;
  }
  if (query.fromIds?.length && !query.fromIds.includes(edge.from)) {
    return false;
  }
  if (query.toIds?.length && !query.toIds.includes(edge.to)) {
    return false;
  }
  if (query.scopes?.length && !query.scopes.some((scope) => scopesEqual(scope, edge.scope))) {
    return false;
  }
  return true;
}

function createMatrixStore(seed: MatrixSeed): MatrixGraphStore {
  return new MatrixGraphStore(seed.nodes, seed.edges);
}

function projectRunNodeIds(items: readonly { nodeId: string }[]): string[] {
  return items.map((item) => item.nodeId);
}

function projectTaskIds(items: readonly HarnessTaskBoardItem[]): string[] {
  return items.map((item) => item.taskId);
}

function projectApprovalIds(items: readonly HarnessApprovalInboxItem[]): string[] {
  return items.map((item) => item.approvalId);
}

function projectArtifactIds(items: readonly HarnessArtifactFeedItem[]): string[] {
  return items.map((item) => item.artifactId);
}

function seedRunGraph(): MatrixSeed {
  return {
    nodes: [
      buildGraphNode("run:run-1", "run", "2026-04-03T00:00:01.000Z", {
        runId: "run-1",
        title: "Run: ship the release",
        summary: "Primary run summary",
        metadata: { kind: "run", source: "harness" },
      }),
      buildGraphNode("checkpoint:run-1:2", "checkpoint", "2026-04-03T00:00:02.000Z", {
        runId: "run-1",
        title: "Checkpoint: assistant response",
        status: "assistant_response",
        summary: "checkpoint summary",
      }),
      buildGraphNode("turn:run-1:1", "turn", "2026-04-03T00:00:03.000Z", {
        runId: "run-1",
        title: "Turn: initial analysis",
        status: "sampling_model",
        summary: "turn summary",
        metadata: { kind: "turn", step: 1 },
      }),
      buildGraphNode("turn:run-1:2", "turn", "2026-04-03T00:00:04.000Z", {
        runId: "run-1",
        title: "Turn: tool follow-up",
        status: "executing_tools",
        summary: "follow-up",
      }),
      buildGraphNode("task:run-1:2", "task", "2026-04-03T00:00:06.000Z", {
        runId: "run-1",
        title: "Task: deploy",
        status: "running",
        order: 1,
        summary: "deploying",
        metadata: { owner: "ops" },
      }),
      buildGraphNode("task:run-1:1", "task", "2026-04-03T00:00:05.000Z", {
        runId: "run-1",
        title: "Task: build-report",
        status: "completed",
        order: 1,
        summary: "report built",
      }),
      buildGraphNode("task:run-1:3", "task", "2026-04-03T00:00:07.000Z", {
        runId: "run-1",
        title: "Task: collect-metrics",
        status: "failed",
        order: 2,
        summary: "metrics failed",
        content: "failed after retry",
      }),
      buildGraphNode("approval:run-1:1", "approval", "2026-04-03T00:00:08.000Z", {
        runId: "run-1",
        title: "Approval: ticket.delete",
        status: "pending",
        summary: "approve deletion",
      }),
      buildGraphNode("artifact:run-1:1", "artifact", "2026-04-03T00:00:09.000Z", {
        runId: "run-1",
        title: "Artifact: screenshot",
        status: "available",
        content: "/tmp/artifacts/run-1/screenshot.png",
        metadata: {
          kind: "screenshot",
          mimeType: "image/png",
          size: 2048,
          path: "/tmp/artifacts/run-1/screenshot.png",
          preview: "base64:preview",
        },
      }),
      buildGraphNode("memory:run-1:1", "memory", "2026-04-03T00:00:10.000Z", {
        runId: "run-1",
        title: "Memory: summary",
        status: "summary",
        summary: "session memory",
        content: "Release is blocked on approval",
        metadata: { importance: "high", source: "session" },
      }),
      buildGraphNode("memory:run-1:2", "memory", "2026-04-03T00:00:11.000Z", {
        runId: "run-1",
        title: "Memory: observation",
        status: "observation",
        content: "Need to wait for approval",
      }),
    ],
    edges: [
      buildGraphEdge("edge-run-turn", "run:run-1", "turn:run-1:1", "2026-04-03T00:00:02.000Z", {
        runId: "run-1",
        kind: "contains",
      }),
      buildGraphEdge("edge-turn-task", "turn:run-1:2", "task:run-1:2", "2026-04-03T00:00:06.500Z", {
        runId: "run-1",
        kind: "generates",
      }),
      buildGraphEdge("edge-task-artifact", "task:run-1:2", "artifact:run-1:1", "2026-04-03T00:00:09.500Z", {
        runId: "run-1",
        kind: "generates",
      }),
      buildGraphEdge("edge-task-approval", "task:run-1:2", "approval:run-1:1", "2026-04-03T00:00:08.500Z", {
        runId: "run-1",
        kind: "blocks",
      }),
      buildGraphEdge("edge-run-memory", "run:run-1", "memory:run-1:1", "2026-04-03T00:00:10.500Z", {
        runId: "run-1",
        kind: "summarizes",
      }),
    ],
  };
}

function seedProjectGraph(): MatrixSeed {
  return {
    nodes: [
      buildGraphNode("project:run-1", "run", "2026-04-03T00:00:01.000Z", {
        scope: projectScope,
        title: "Run: project release",
        summary: "Project run summary",
      }),
      buildGraphNode("project:turn-1", "turn", "2026-04-03T00:00:02.000Z", {
        scope: projectScope,
        title: "Turn: project planning",
        summary: "planning",
      }),
      buildGraphNode("project:task-1", "task", "2026-04-03T00:00:05.000Z", {
        scope: projectScope,
        title: "Task: write-docs",
        status: "running",
        order: 2,
        summary: "docs",
      }),
      buildGraphNode("project:task-2", "task", "2026-04-03T00:00:04.000Z", {
        scope: projectScope,
        title: "Task: draft-tests",
        status: "completed",
        order: 1,
        summary: "tests",
      }),
      buildGraphNode("project:approval-1", "approval", "2026-04-03T00:00:07.000Z", {
        scope: projectScope,
        title: "Approval: repo.write",
        status: "approved",
        summary: "approved",
      }),
      buildGraphNode("project:artifact-1", "artifact", "2026-04-03T00:00:08.000Z", {
        scope: projectScope,
        title: "Artifact: plan",
        content: "/tmp/plan.md",
        metadata: {
          path: "/tmp/plan.md",
          mimeType: "text/markdown",
          size: 99,
          preview: "# Plan",
        },
      }),
      buildGraphNode("project:memory-1", "memory", "2026-04-03T00:00:09.000Z", {
        scope: projectScope,
        title: "Memory: project note",
        status: "summary",
        content: "Remember to run tests",
      }),
    ],
    edges: [],
  };
}

function seedMixedGraph(): MatrixSeed {
  const nodes = [
    buildGraphNode("run:seed", "run", "2026-04-03T00:00:01.000Z", {
      runId: "run-1",
      title: "Run: seed",
      summary: "seed run",
      scope: runScope,
    }),
    buildGraphNode("task:seed", "task", "2026-04-03T00:00:02.000Z", {
      runId: "run-1",
      title: "Task: release deploy",
      status: "running",
      order: 1,
      summary: "release deploy",
      scope: runScope,
    }),
    buildGraphNode("artifact:seed", "artifact", "2026-04-03T00:00:03.000Z", {
      runId: "run-1",
      title: "Artifact: log",
      scope: runScope,
      content: "deploy logs",
      metadata: {
        kind: "log",
        mimeType: "text/plain",
        size: 12,
        path: "/tmp/log.txt",
      },
    }),
    buildGraphNode("memory:project", "memory", "2026-04-03T00:00:00.400Z", {
      scope: projectScope,
      runId: "run-1",
      title: "Memory: project release",
      status: "summary",
      content: "project release knowledge",
    }),
    buildGraphNode("memory:entity", "memory", "2026-04-03T00:00:00.500Z", {
      scope: entityProjectScope,
      runId: "run-1",
      title: "Memory: entity release",
      status: "summary",
      content: "entity scoped project memory",
    }),
    buildGraphNode("memory:resource", "memory", "2026-04-03T00:00:00.600Z", {
      scope: resourceScope,
      runId: "run-1",
      title: "Memory: resource cache",
      status: "summary",
      content: "resource scoped memory",
    }),
    buildGraphNode("memory:capability", "memory", "2026-04-03T00:00:00.700Z", {
      scope: capabilityScope,
      runId: "run-1",
      title: "Memory: capability release",
      status: "summary",
      content: "capability scoped memory",
    }),
    buildGraphNode("memory:policy", "memory", "2026-04-03T00:00:00.800Z", {
      scope: policyScope,
      runId: "run-1",
      title: "Memory: policy guardrails",
      status: "summary",
      content: "policy scoped memory",
    }),
  ];

  const edges = [
    buildGraphEdge("edge-seed-task", "run:seed", "task:seed", "2026-04-03T00:00:02.000Z", {
      runId: "run-1",
      kind: "contains",
      scope: runScope,
    }),
    buildGraphEdge("edge-seed-artifact", "task:seed", "artifact:seed", "2026-04-03T00:00:03.000Z", {
      runId: "run-1",
      kind: "generates",
      scope: runScope,
    }),
  ];

  return { nodes, edges };
}

function expectNoSearchFields(node: HarnessGraphNodeRecord): void {
  expect((node as HarnessGraphNodeRecord & { score?: number }).score).toBeUndefined();
  expect((node as HarnessGraphNodeRecord & { matchedFields?: string[] }).matchedFields).toBeUndefined();
  expect((node as HarnessGraphNodeRecord & { reasons?: string[] }).reasons).toBeUndefined();
}

describe("graph projector matrix", () => {
  it("uses related run context for run timelines and falls back to plain node reads for non-run scopes", async () => {
    const runStore = createMatrixStore({
      nodes: [
        buildGraphNode("run:run-1", "run", "2026-04-03T00:00:01.000Z", {
          runId: "run-1",
          title: "Run: ship the release",
          summary: "Primary run summary",
        }),
        buildGraphNode("task:run-1:1", "task", "2026-04-03T00:00:05.000Z", {
          runId: "run-1",
          title: "Task: build-report",
          status: "completed",
          order: 1,
          summary: "report built",
        }),
        buildGraphNode("approval:run-1:1", "approval", "2026-04-03T00:00:08.000Z", {
          runId: "run-1",
          title: "Approval: ticket.delete",
          status: "pending",
          summary: "approve deletion",
        }),
        buildGraphNode("artifact:run-1:1", "artifact", "2026-04-03T00:00:09.000Z", {
          runId: "run-1",
          title: "Artifact: screenshot",
          status: "available",
          content: "/tmp/artifacts/run-1/screenshot.png",
          metadata: {
            kind: "screenshot",
            mimeType: "image/png",
            size: 2048,
            path: "/tmp/artifacts/run-1/screenshot.png",
            preview: "base64:preview",
          },
        }),
      ],
      edges: [
        buildGraphEdge("edge-run-task", "run:run-1", "task:run-1:1", "2026-04-03T00:00:02.000Z", {
          runId: "run-1",
          kind: "contains",
        }),
        buildGraphEdge("edge-task-artifact", "task:run-1:1", "artifact:run-1:1", "2026-04-03T00:00:03.000Z", {
          runId: "run-1",
          kind: "generates",
        }),
        buildGraphEdge("edge-task-approval", "task:run-1:1", "approval:run-1:1", "2026-04-03T00:00:04.000Z", {
          runId: "run-1",
          kind: "blocks",
        }),
      ],
    });

    const runTimeline = await projectHarnessRunTimeline(runStore, { kind: "run", runId: "run-1" });
    expect(runStore.nodeQueries).toHaveLength(1);
    expect(runStore.edgeQueries).toHaveLength(1);
    expect(runStore.nodeQueries[0]).toMatchObject({
      scopes: [runScope],
    });
    expect(runStore.edgeQueries[0]).toMatchObject({
      scopes: [runScope],
    });
    expect(projectRunNodeIds(runTimeline.items)).toEqual([
      "run:run-1",
      "task:run-1:1",
      "approval:run-1:1",
      "artifact:run-1:1",
    ]);
    expect(runTimeline.items[0]).toMatchObject({
      nodeId: "run:run-1",
      kind: "run",
      title: "Run: ship the release",
      summary: "Primary run summary",
    });
    expect(runTimeline.items[0]!.metadata).toBeUndefined();
    expect(runTimeline.items[1]).toMatchObject({
      nodeId: "task:run-1:1",
      kind: "task",
      status: "completed",
    });
    expect(runTimeline.items[1]!.metadata).toBeUndefined();
    expect(runTimeline.items[3]).toMatchObject({
      nodeId: "artifact:run-1:1",
      kind: "artifact",
      title: "Artifact: screenshot",
      status: "available",
      metadata: {
        kind: "screenshot",
        mimeType: "image/png",
        size: 2048,
        path: "/tmp/artifacts/run-1/screenshot.png",
        preview: "base64:preview",
      },
    });

    const projectStore = createMatrixStore(seedProjectGraph());
    const projectTimeline = await projectHarnessRunTimeline(projectStore, {
      kind: "project",
      projectId: "capstan",
      text: "project",
      limit: 4,
    });
    expect(projectStore.nodeQueries).toHaveLength(1);
    expect(projectStore.edgeQueries).toHaveLength(0);
    expect(projectStore.nodeQueries[0]?.scopes).toHaveLength(1);
    expect(projectStore.nodeQueries[0]?.scopes?.[0]).toMatchObject({
      kind: "project",
      projectId: "capstan",
      text: "project",
      limit: 4,
    });
    expect(projectRunNodeIds(projectTimeline.items).slice(0, 4)).toEqual([
      "project:run-1",
      "project:turn-1",
      "project:task-2",
      "project:task-1",
    ]);
    expect(projectTimeline.items[2]!.kind).toBe("task");
    expect(projectTimeline.items[2]!.summary).toBe("tests");
  });

  it("groups task board entries by status and preserves deterministic ordering for ties", async () => {
    const store = createMatrixStore(seedRunGraph());
    const board = await projectHarnessTaskBoard(store, { kind: "run", runId: "run-1" });
    expect(store.nodeQueries).toHaveLength(1);
    expect(store.nodeQueries[0]).toMatchObject({
      kinds: ["task"],
      scopes: [runScope],
    });
    expect(board.running.map((item) => item.taskId)).toEqual(["task:run-1:2"]);
    expect(board.completed.map((item) => item.taskId)).toEqual(["task:run-1:1"]);
    expect(board.failed.map((item) => item.taskId)).toEqual(["task:run-1:3"]);
    expect(board.canceled).toEqual([]);

    const flattened = await projectTaskBoard(store, { kind: "run", runId: "run-1" });
    expect(projectTaskIds(flattened)).toEqual([
      "task:run-1:2",
      "task:run-1:1",
      "task:run-1:3",
    ]);
    expect(flattened[0]).toMatchObject({
      taskId: "task:run-1:2",
      name: "deploy",
      status: "running",
      order: 1,
    });
    expect(flattened[1]).toMatchObject({
      taskId: "task:run-1:1",
      name: "build-report",
      status: "completed",
      order: 1,
    });
    expect(flattened[2]).toMatchObject({
      taskId: "task:run-1:3",
      name: "collect-metrics",
      status: "failed",
      order: 2,
    });
    expect(flattened[0]!.metadata).toMatchObject({ owner: "ops" });
  });

  it("normalizes approval states and sorts pending approvals ahead of resolved ones", async () => {
    const store = createMatrixStore({
      nodes: [
        buildGraphNode("approval:1", "approval", "2026-04-03T00:00:01.000Z", {
          runId: "run-1",
          title: "Approval: delete",
          status: "pending",
          summary: "manual approval required",
        }),
        buildGraphNode("approval:2", "approval", "2026-04-03T00:00:02.000Z", {
          runId: "run-1",
          title: "Approval: deploy",
          status: "approved",
          summary: "deploy approved",
          metadata: { approver: "ops" },
        }),
        buildGraphNode("approval:3", "approval", "2026-04-03T00:00:02.000Z", {
          runId: "run-1",
          title: "Approval: rollback",
          status: "denied",
          content: "rollback denied",
        }),
        buildGraphNode("approval:4", "approval", "2026-04-03T00:00:03.000Z", {
          runId: "run-1",
          title: "Approval: archive",
          status: "canceled",
        }),
        buildGraphNode("approval:5", "approval", "2026-04-03T00:00:03.000Z", {
          runId: "run-1",
          title: "Approval: missing-status",
          status: "unexpected-status",
          summary: "fallback to pending",
        }),
      ],
      edges: [],
    });

    const projection = await projectHarnessApprovalInbox(store, {
      kind: "run",
      runId: "run-1",
    });
    expect(store.nodeQueries).toHaveLength(1);
    expect(store.nodeQueries[0]).toMatchObject({
      kinds: ["approval"],
      scopes: [runScope],
    });
    expect(projectApprovalIds(projection.pending)).toEqual([
      "approval:1",
      "approval:5",
    ]);
    expect(projectApprovalIds(projection.resolved)).toEqual([
      "approval:2",
      "approval:3",
      "approval:4",
    ]);
    expect(projection.pending[0]).toMatchObject({
      approvalId: "approval:1",
      tool: "delete",
      status: "pending",
      reason: "manual approval required",
    });
    expect(projection.pending[1]).toMatchObject({
      approvalId: "approval:5",
      status: "pending",
      reason: "fallback to pending",
    });
    expect(projection.resolved[0]).toMatchObject({
      approvalId: "approval:2",
      status: "approved",
      metadata: { approver: "ops" },
    });
    expect(projection.resolved[1]).toMatchObject({
      approvalId: "approval:3",
      status: "denied",
      reason: "rollback denied",
    });
    expect(projection.resolved[2]).toMatchObject({
      approvalId: "approval:4",
      status: "canceled",
      reason: "approval required",
    });

    const flattened = await projectApprovalInbox(store, {
      kind: "run",
      runId: "run-1",
    });
    expect(projectApprovalIds(flattened)).toEqual([
      "approval:1",
      "approval:5",
      "approval:2",
      "approval:3",
      "approval:4",
    ]);
  });

  it("projects artifact feeds with metadata fallbacks and recency ordering", async () => {
    const store = createMatrixStore({
      nodes: [
        buildGraphNode("artifact:old", "artifact", "2026-04-03T00:00:01.000Z", {
          runId: "run-1",
          title: "Artifact: old",
          content: "/tmp/artifacts/old.txt",
        }),
        buildGraphNode("artifact:mid", "artifact", "2026-04-03T00:00:02.000Z", {
          runId: "run-1",
          title: "Artifact: mid",
          metadata: {
            kind: "trace",
            mimeType: "text/plain",
            size: 15,
            path: "/tmp/artifacts/mid.trace",
            preview: "trace-preview",
          },
        }),
        buildGraphNode("artifact:new", "artifact", "2026-04-03T00:00:03.000Z", {
          runId: "run-1",
          title: "Artifact: new",
          metadata: {
            kind: "report",
            mimeType: "application/json",
            size: 3,
            path: "/tmp/artifacts/new.json",
          },
        }),
      ],
      edges: [],
    });

    const projection = await projectHarnessArtifactFeed(store, {
      kind: "run",
      runId: "run-1",
    });
    expect(store.nodeQueries).toHaveLength(1);
    expect(store.nodeQueries[0]).toMatchObject({
      kinds: ["artifact"],
      scopes: [runScope],
    });
    expect(projectArtifactIds(projection.items)).toEqual([
      "artifact:new",
      "artifact:mid",
      "artifact:old",
    ]);
    expect(projection.items[0]).toMatchObject({
      artifactId: "artifact:new",
      kind: "report",
      mimeType: "application/json",
      size: 3,
      path: "/tmp/artifacts/new.json",
    });
    expect(projection.items[0]!.preview).toBeUndefined();
    expect(projection.items[1]).toMatchObject({
      artifactId: "artifact:mid",
      kind: "trace",
      mimeType: "text/plain",
      preview: "trace-preview",
    });
    expect(projection.items[2]).toMatchObject({
      artifactId: "artifact:old",
      kind: "artifact",
      mimeType: "application/octet-stream",
      size: 0,
      path: "/tmp/artifacts/old.txt",
    });

    const flattened = await projectArtifactFeed(store, {
      kind: "run",
      runId: "run-1",
    });
    expect(projectArtifactIds(flattened)).toEqual([
      "artifact:new",
      "artifact:mid",
      "artifact:old",
    ]);
  });

  it("rejects projection entry points without a resolvable graph scope", async () => {
    const store = createMatrixStore({ nodes: [], edges: [] });
    await expect(projectHarnessRunTimeline(store, {})).rejects.toThrow(
      /Graph projection requires a runId or an explicit graph scope/,
    );
    await expect(projectHarnessTaskBoard(store)).rejects.toThrow(
      /Graph projection requires a runId or an explicit graph scope/,
    );
    await expect(projectHarnessApprovalInbox(store)).rejects.toThrow(
      /Graph projection requires a runId or an explicit graph scope/,
    );
    await expect(projectHarnessArtifactFeed(store)).rejects.toThrow(
      /Graph projection requires a runId or an explicit graph scope/,
    );
  });
});

describe("graph retrieval matrix", () => {
  it("collects run-adjacent context nodes and strips search metadata from returned records", async () => {
    const store = createMatrixStore({
      nodes: [
        buildGraphNode("run:run-1", "run", "2026-04-03T00:00:01.000Z", {
          runId: "run-1",
          title: "Run: ship the release",
          summary: "Primary run summary",
        }),
        buildGraphNode("task:run-1:1", "task", "2026-04-03T00:00:02.000Z", {
          runId: "run-1",
          title: "Task: build-report",
          status: "completed",
          order: 1,
          summary: "report built",
        }),
        buildGraphNode("artifact:run-1:1", "artifact", "2026-04-03T00:00:03.000Z", {
          runId: "run-1",
          title: "Artifact: screenshot",
          status: "available",
          content: "/tmp/artifacts/run-1/screenshot.png",
          metadata: {
            kind: "screenshot",
            mimeType: "image/png",
            size: 2048,
            path: "/tmp/artifacts/run-1/screenshot.png",
            preview: "base64:preview",
          },
        }),
        buildGraphNode("approval:run-1:1", "approval", "2026-04-03T00:00:04.000Z", {
          runId: "run-1",
          title: "Approval: ticket.delete",
          status: "pending",
          summary: "approve deletion",
        }),
      ],
      edges: [
        buildGraphEdge("edge-run-task", "run:run-1", "task:run-1:1", "2026-04-03T00:00:02.000Z", {
          runId: "run-1",
          kind: "contains",
        }),
        buildGraphEdge("edge-task-artifact", "task:run-1:1", "artifact:run-1:1", "2026-04-03T00:00:03.000Z", {
          runId: "run-1",
          kind: "generates",
        }),
        buildGraphEdge("edge-task-approval", "task:run-1:1", "approval:run-1:1", "2026-04-03T00:00:04.000Z", {
          runId: "run-1",
          kind: "blocks",
        }),
      ],
    });
    const nodes = await collectGraphContextNodes({
      runtimeStore: store,
      runId: "run-1",
      query: "",
      limit: 4,
    });

    expect(store.nodeQueries).toHaveLength(1);
    expect(store.edgeQueries).toHaveLength(1);
    expect(store.nodeQueries[0]).toEqual({});
    expect(store.edgeQueries[0]).toEqual({});
    expect(nodes[0]!.id).toBe("run:run-1");
    expect(nodes[1]!.id).toBe("task:run-1:1");
    expect(nodes.slice(0, 4).map((node) => node.id)).toEqual([
      "run:run-1",
      "task:run-1:1",
      "approval:run-1:1",
      "artifact:run-1:1",
    ]);
    for (const node of nodes) {
      expectNoSearchFields(node);
    }
  });

  it("handles direct query mode with score ranking, minScore cutoffs, and limit truncation", async () => {
    const store = createMatrixStore({
      nodes: [
        buildGraphNode("match-title", "task", "2026-04-03T00:00:01.000Z", {
          runId: "run-1",
          title: "Release deploy now",
          summary: "release step",
          content: "deploy the release",
        }),
        buildGraphNode("match-summary", "task", "2026-04-03T00:00:02.000Z", {
          runId: "run-1",
          title: "Something else",
          summary: "release checklist",
          content: "misc",
        }),
        buildGraphNode("match-content", "artifact", "2026-04-03T00:00:03.000Z", {
          runId: "run-1",
          title: "Artifact notes",
          summary: "trace",
          content: "release deploy release",
        }),
        buildGraphNode("match-status", "approval", "2026-04-03T00:00:04.000Z", {
          runId: "run-1",
          title: "Approval",
          status: "pending",
          summary: "release approval",
        }),
        buildGraphNode("stale-noise", "memory", "2026-04-03T00:00:05.000Z", {
          runId: "run-1",
          title: "Noise",
          summary: "unrelated",
          content: "nothing here",
        }),
      ],
      edges: [
        buildGraphEdge("edge-1", "match-title", "match-content", "2026-04-03T00:00:04.000Z", {
          runId: "run-1",
          kind: "references",
        }),
        buildGraphEdge("edge-2", "match-content", "match-status", "2026-04-03T00:00:05.000Z", {
          runId: "run-1",
          kind: "references",
        }),
      ],
    });

    const ranked = await collectGraphContextNodes(store, {
      text: "release deploy",
      scopes: [runScope],
      kinds: ["task", "artifact", "approval"],
      limit: 2,
      minScore: 0.1,
    });

    expect(store.nodeQueries).toHaveLength(1);
    expect(store.edgeQueries).toHaveLength(1);
    expect(store.nodeQueries[0]).toMatchObject({
      scopes: [runScope],
      kinds: ["task", "artifact", "approval"],
    });
    expect(store.edgeQueries[0]).toMatchObject({
      scopes: [runScope],
    });
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.id).toBe("match-title");
    expect(ranked[1]!.id).toBe("match-content");
    for (const node of ranked) {
      expectNoSearchFields(node);
    }

    const broader = await collectGraphContextNodes(store, {
      text: "release deploy",
      scopes: [runScope],
      kinds: ["task", "artifact", "approval"],
      limit: 10,
      minScore: 0,
    });
    expect(broader.slice(0, 2).map((node) => node.id)).toEqual([
      "match-title",
      "match-content",
    ]);
    expect(broader.map((node) => node.id)).toEqual(
      expect.arrayContaining(["match-summary", "match-status"]),
    );
  });

  it("honors mixed scopes and deduplicated scope helpers when building retrieval inputs", async () => {
    const mixedStore = createMatrixStore(seedMixedGraph());
    const queryScopes = normalizeGraphScopes([
      projectScope,
      entityProjectScope,
      resourceScope,
      projectScope,
      capabilityScope,
      policyScope,
      resourceScope,
    ]);

    expect(queryScopes).toEqual([
      projectScope,
      entityProjectScope,
      resourceScope,
      capabilityScope,
      policyScope,
    ]);
    expect(graphScopeKey(projectScope)).toBe("project__capstan");
    expect(formatHarnessGraphScopeKey(resourceScope)).toBe("resource__database__primary");
    expect(formatHarnessGraphScopeTitle(resourceScope)).toBe("Resource: database/primary");
    expect(scopesEqual(projectScope, createProjectGraphScope("capstan"))).toBe(true);
    expect(graphScopesIntersect([projectScope], [entityProjectScope])).toBe(false);
    expect(graphScopesIntersect([projectScope, entityProjectScope], [entityProjectScope])).toBe(
      true,
    );
    expect(mergeGraphScopes([projectScope, resourceScope], [entityProjectScope, projectScope])).toEqual([
      projectScope,
      resourceScope,
      entityProjectScope,
    ]);
    expect(memoryScopeToGraphScope({ type: "project", id: "capstan" })).toEqual(projectScope);
    expect(memoryScopeToGraphScope({ type: "run", id: "run-1" })).toEqual(runScope);
    expect(memoryScopeToGraphScope({ type: "resource", id: "primary" })).toEqual({
      kind: "entity",
      entityType: "resource",
      entityId: "primary",
    });

    const nodes = await collectGraphContextNodes({
      runtimeStore: mixedStore,
      query: "",
      scopes: queryScopes,
      kinds: ["memory", "task", "artifact"],
      limit: 5,
    });

    expect(mixedStore.nodeQueries).toHaveLength(1);
    expect(mixedStore.edgeQueries).toHaveLength(1);
    expect(mixedStore.nodeQueries[0]).toMatchObject({
      scopes: queryScopes,
      kinds: ["memory", "task", "artifact"],
    });
    expect(mixedStore.edgeQueries[0]).toMatchObject({
      scopes: queryScopes,
    });
    expect(nodes.map((node) => node.id)).toEqual([
      "memory:policy",
      "memory:capability",
      "memory:resource",
      "memory:entity",
      "memory:project",
    ]);
    expect(nodes[0]!.title).toBe("Memory: policy guardrails");
  });

  it("sorts and selects graph nodes for context using empty-query recency and query-aware scoring", () => {
    const nodes: HarnessGraphNodeRecord[] = [
      buildGraphNode("old-task", "task", "2026-04-03T00:00:01.000Z", {
        title: "Task: old",
        scope: projectScope,
      }),
      buildGraphNode("new-task", "task", "2026-04-03T00:00:04.000Z", {
        title: "Task: new",
        scope: projectScope,
      }),
      buildGraphNode("mid-memory", "memory", "2026-04-03T00:00:03.000Z", {
        title: "Memory: mid",
        scope: projectScope,
      }),
      buildGraphNode("newer-approval", "approval", "2026-04-03T00:00:05.000Z", {
        title: "Approval: release",
        scope: projectScope,
        status: "pending",
      }),
    ];

    const empty = selectGraphNodesForContext(nodes, {
      query: "",
      limit: 3,
      kinds: ["task", "memory", "approval"],
    });
    expect(empty.map((node) => node.id)).toEqual([
      "newer-approval",
      "new-task",
      "mid-memory",
    ]);

    const query = selectGraphNodesForContext(nodes, {
      query: "release task",
      limit: 2,
      kinds: ["task", "approval"],
    });
    expect(query.map((node) => node.id)).toEqual([
      "newer-approval",
      "new-task",
    ]);

    const filtered = selectGraphNodesForContext(nodes, {
      query: "release",
      limit: 10,
      kinds: ["approval"],
    });
    expect(filtered.map((node) => node.id)).toEqual(["newer-approval"]);
  });
});

describe("graph utility matrix", () => {
  it("sorts nodes and edges deterministically when timestamps collide", () => {
    const nodes: HarnessGraphNodeRecord[] = [
      buildGraphNode("node-b", "memory", "2026-04-03T00:00:02.000Z"),
      buildGraphNode("node-a", "memory", "2026-04-03T00:00:02.000Z"),
      buildGraphNode("node-c", "memory", "2026-04-03T00:00:03.000Z"),
    ];
    const edges: HarnessGraphEdgeRecord[] = [
      buildGraphEdge("edge-b", "node-a", "node-b", "2026-04-03T00:00:02.000Z"),
      buildGraphEdge("edge-a", "node-b", "node-c", "2026-04-03T00:00:02.000Z"),
      buildGraphEdge("edge-c", "node-c", "node-a", "2026-04-03T00:00:03.000Z"),
    ];

    expect(sortGraphNodes(nodes).map((node) => node.id)).toEqual([
      "node-c",
      "node-a",
      "node-b",
    ]);
    expect(sortGraphEdges(edges).map((edge) => edge.id)).toEqual([
      "edge-c",
      "edge-a",
      "edge-b",
    ]);
    expect(compareTimestampDescendingThenId({ id: "a", updatedAt: "1" }, { id: "b", updatedAt: "1" })).toBe(
      -1,
    );
    expect(compareTimestampDescendingThenId({ id: "b", updatedAt: "2" }, { id: "a", updatedAt: "1" })).toBe(
      -1,
    );
  });

  it("normalizes, deduplicates, and keys scope collections consistently", () => {
    const normalized = normalizeGraphScopes([
      projectScope,
      createProjectGraphScope("capstan"),
      runScope,
      createRunGraphScope("run-1"),
      resourceScope,
      resourceScope,
      capabilityScope,
      policyScope,
    ]);
    expect(normalized).toEqual([
      projectScope,
      runScope,
      resourceScope,
      capabilityScope,
      policyScope,
    ]);
    expect(formatHarnessGraphScopeKey(projectScope)).toBe("project__capstan");
    expect(formatHarnessGraphScopeKey(runScope)).toBe("run__run-1");
    expect(formatHarnessGraphScopeKey(resourceScope)).toBe("resource__database__primary");
    expect(formatHarnessGraphScopeTitle(capabilityScope)).toBe("Capability: release.deploy");
    expect(formatHarnessGraphScopeTitle(policyScope)).toBe("Policy: release-guardrails");
  });

  it("matches node queries only when scopes, ids, run ids, and kinds all line up", () => {
    const node = buildGraphNode("memory-1", "memory", "2026-04-03T00:00:01.000Z", {
      scope: projectScope,
      runId: "run-1",
    });
    expect(graphNodeMatchesQuery(node, { scopes: [projectScope] })).toBe(true);
    expect(graphNodeMatchesQuery(node, { scopes: [resourceScope] })).toBe(false);
    expect(graphNodeMatchesQuery(node, { ids: ["memory-1"] })).toBe(true);
    expect(graphNodeMatchesQuery(node, { ids: ["memory-2"] })).toBe(false);
    expect(graphNodeMatchesQuery(node, { runId: "run-1" })).toBe(true);
    expect(graphNodeMatchesQuery(node, { runId: "run-2" })).toBe(false);
    expect(graphNodeMatchesQuery(node, { kinds: ["memory"] })).toBe(true);
    expect(graphNodeMatchesQuery(node, { kinds: ["task"] })).toBe(false);
  });

  it("builds graph context blocks only when nodes exist", () => {
    const blocks = buildGraphContextBlocks([
      buildGraphNode("turn-1", "turn", "2026-04-03T00:00:01.000Z", {
        scope: runScope,
        title: "Turn: first",
        status: "sampling_model",
        summary: "first turn",
      }),
      buildGraphNode("task-1", "task", "2026-04-03T00:00:02.000Z", {
        scope: runScope,
        title: "Task: deploy",
        status: "running",
        order: 1,
      }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("graph");
    expect(blocks[0]!.content).toContain("Turn: first");
    expect(blocks[0]!.content).toContain("Task: deploy");
    expect(blocks[0]!.tokens).toBeGreaterThan(0);
    expect(buildGraphContextBlocks([])).toEqual([]);
  });
});

describe("graph control-plane matrix", () => {
  async function seedRuntime(rootDir: string): Promise<void> {
    const runtimeStore = new FileHarnessRuntimeStore(rootDir);
    await runtimeStore.initialize();
    await runtimeStore.persistRun(buildRun("run-1"));
    const nodes = [
      buildGraphNode("run:run-1", "run", "2026-04-03T00:00:01.000Z", {
        runId: "run-1",
        title: "Run: ship the release",
        summary: "Primary run summary",
        metadata: { kind: "run" },
      }),
      buildGraphNode("checkpoint:run-1:1", "checkpoint", "2026-04-03T00:00:02.000Z", {
        runId: "run-1",
        title: "Checkpoint: assistant response",
        status: "assistant_response",
        summary: "checkpoint summary",
      }),
      buildGraphNode("turn:run-1:1", "turn", "2026-04-03T00:00:03.000Z", {
        runId: "run-1",
        title: "Turn: initial analysis",
        status: "sampling_model",
        summary: "turn summary",
      }),
      buildGraphNode("task:run-1:1", "task", "2026-04-03T00:00:04.000Z", {
        runId: "run-1",
        title: "Task: build-report",
        status: "completed",
        order: 1,
        summary: "report built",
      }),
      buildGraphNode("task:run-1:2", "task", "2026-04-03T00:00:05.000Z", {
        runId: "run-1",
        title: "Task: deploy",
        status: "running",
        order: 2,
        summary: "deploying",
        metadata: { owner: "ops" },
      }),
      buildGraphNode("approval:run-1:1", "approval", "2026-04-03T00:00:06.000Z", {
        runId: "run-1",
        title: "Approval: ticket.delete",
        status: "pending",
        summary: "manual approval required",
      }),
      buildGraphNode("artifact:run-1:1", "artifact", "2026-04-03T00:00:07.000Z", {
        runId: "run-1",
        title: "Artifact: report",
        content: "/tmp/report.md",
        metadata: {
          kind: "report",
          path: "/tmp/report.md",
          mimeType: "text/markdown",
          size: 10,
          preview: "# report",
        },
      }),
      buildGraphNode("memory:run-1:1", "memory", "2026-04-03T00:00:08.000Z", {
        runId: "run-1",
        title: "Memory: summary",
        status: "summary",
        summary: "summary memory",
        content: "Graph memory",
      }),
    ];
    const edges = [
      buildGraphEdge("edge-run-checkpoint", "run:run-1", "checkpoint:run-1:1", "2026-04-03T00:00:02.000Z", {
        runId: "run-1",
        kind: "contains",
      }),
      buildGraphEdge("edge-run-turn", "run:run-1", "turn:run-1:1", "2026-04-03T00:00:03.000Z", {
        runId: "run-1",
        kind: "contains",
      }),
      buildGraphEdge("edge-run-task-1", "run:run-1", "task:run-1:1", "2026-04-03T00:00:04.000Z", {
        runId: "run-1",
        kind: "contains",
      }),
      buildGraphEdge("edge-run-task-2", "run:run-1", "task:run-1:2", "2026-04-03T00:00:05.000Z", {
        runId: "run-1",
        kind: "contains",
      }),
      buildGraphEdge("edge-run-approval", "run:run-1", "approval:run-1:1", "2026-04-03T00:00:06.000Z", {
        runId: "run-1",
        kind: "contains",
      }),
      buildGraphEdge("edge-run-artifact", "run:run-1", "artifact:run-1:1", "2026-04-03T00:00:07.000Z", {
        runId: "run-1",
        kind: "contains",
      }),
      buildGraphEdge("edge-run-memory", "run:run-1", "memory:run-1:1", "2026-04-03T00:00:08.000Z", {
        runId: "run-1",
        kind: "summarizes",
      }),
    ];
    for (const node of nodes) {
      await runtimeStore.upsertGraphNode(node);
    }
    for (const edge of edges) {
      await runtimeStore.upsertGraphEdge(edge);
    }
  }

  it("reads graph projections from an opened runtime and applies access filtering to node lookups", async () => {
    const rootDir = await createTempDir("capstan-graph-control-");
    await seedRuntime(rootDir);
    const runtime = await openHarnessRuntime(rootDir, {
      authorize(request) {
        if (request.action === "graph:read" && request.detail?.kind === "artifact") {
          return { allowed: false, reason: "artifact nodes are masked" };
        }
        return true;
      },
    });

    const graphNode = await runtime.getGraphNode("task:run-1:1");
    expect(graphNode?.id).toBe("task:run-1:1");
    await expect(runtime.getGraphNode("artifact:run-1:1")).rejects.toThrow(
      /Harness access denied for graph:read/,
    );

    const nodes = await runtime.listGraphNodes({ runId: "run-1" });
    expect(nodes.map((node) => node.kind)).not.toContain("artifact");
    expect(nodes.map((node) => node.id)).toContain("task:run-1:1");

    const edges = await runtime.listGraphEdges({ runId: "run-1" });
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.map((edge) => edge.runId)).toEqual(edges.map(() => "run-1"));
  });

  it("exposes graph timelines, task boards, approvals, and artifact feeds through the control plane", async () => {
    const rootDir = await createTempDir("capstan-graph-control-plane-");
    await seedRuntime(rootDir);
    const runtime = await openHarnessRuntime(rootDir);

    const timeline = await runtime.getRunTimeline("run-1");
    expect(projectRunNodeIds(timeline)).toEqual([
      "run:run-1",
      "checkpoint:run-1:1",
      "turn:run-1:1",
      "task:run-1:1",
      "task:run-1:2",
      "approval:run-1:1",
      "artifact:run-1:1",
      "memory:run-1:1",
    ]);
    const board = await runtime.getTaskBoard({ runId: "run-1" });
    expect(projectTaskIds(board)).toEqual(["task:run-1:2", "task:run-1:1"]);
    const approvals = await runtime.getApprovalInbox({ runId: "run-1" });
    expect(projectApprovalIds(approvals)).toEqual(["approval:run-1:1"]);
    const artifacts = await runtime.getArtifactFeed({ runId: "run-1" });
    expect(projectArtifactIds(artifacts)).toEqual(["artifact:run-1:1"]);
  });
});

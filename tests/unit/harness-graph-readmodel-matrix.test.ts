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
  collectGraphContextNodes,
  createHarnessGraphStore,
  listGraphNeighbors,
  projectHarnessApprovalInbox,
  projectHarnessArtifactFeed,
  projectHarnessRunTimeline,
  projectHarnessTaskBoard,
  queryHarnessGraph,
  type HarnessGraphScope,
  type HarnessApprovalRecord,
  type HarnessArtifactRecord,
  type HarnessMemoryRecord,
  type HarnessRunRecord,
  type HarnessSessionMemoryRecord,
  type HarnessSummaryRecord,
  type HarnessTaskRecord,
} from "../../packages/ai/src/harness/graph/index.ts";
import type { AgentLoopCheckpoint } from "../../packages/ai/src/types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-graph-readmodel-"));
  tempDirs.push(dir);
  return dir;
}

function scope(kind: HarnessGraphScope["kind"], id: string): HarnessGraphScope {
  switch (kind) {
    case "project":
      return { kind: "project", projectId: id };
    case "app":
      return { kind: "app", appId: id };
    case "run":
      return { kind: "run", runId: id };
    case "resource":
      return { kind: "resource", resourceType: "workspace", resourceId: id };
    case "capability":
      return { kind: "capability", capabilityId: id };
    case "policy":
      return { kind: "policy", policyId: id };
    case "entity":
      return { kind: "entity", entityType: "deployment", entityId: id };
  }
}

function buildRun(id: string, status: HarnessRunRecord["status"] = "running"): HarnessRunRecord {
  return {
    id,
    goal: `Goal for ${id}`,
    status,
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:10.000Z",
    iterations: 3,
    toolCalls: 2,
    taskCalls: 1,
    maxIterations: 8,
    toolNames: ["search"],
    taskNames: ["deploy"],
    artifactIds: [`artifact:${id}:1`],
    taskIds: [`task:${id}:1`],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: true,
      artifactDir: `/tmp/artifacts/${id}`,
    },
    pendingApprovalId: `approval:${id}:1`,
    latestSummaryId: `summary:${id}:1`,
    lastEventSequence: 5,
  };
}

function buildCheckpoint(runId: string): AgentLoopCheckpoint {
  return {
    stage: "assistant_response",
    config: {
      goal: `Goal for ${runId}`,
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

function buildTask(runId: string, id: string, status: HarnessTaskRecord["status"], order: number): HarnessTaskRecord {
  return {
    id,
    runId,
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

function buildApproval(runId: string, id: string, status: HarnessApprovalRecord["status"], requestedAt: string): HarnessApprovalRecord {
  return {
    id,
    runId,
    kind: "tool",
    tool: id,
    args: { file: `${id}.md` },
    reason: `${id} reason`,
    requestedAt,
    updatedAt: `${requestedAt.slice(0, -1)}1Z`,
    status,
  } as HarnessApprovalRecord;
}

function buildArtifact(runId: string, id: string, kind: string, createdAt: string): HarnessArtifactRecord {
  return {
    id,
    runId,
    kind,
    path: `/tmp/artifacts/${runId}/${id}.bin`,
    createdAt,
    mimeType: "application/octet-stream",
    size: 2048,
    metadata: { kind, source: "browser", preview: "base64:..." },
  };
}

function buildMemory(runId: string, id: string, kind: string, content: string, createdAt: string): HarnessMemoryRecord {
  return {
    id,
    scope: { type: "project", id: "capstan" },
    kind,
    content,
    createdAt,
    updatedAt: createdAt,
    accessCount: 0,
    lastAccessedAt: createdAt,
    runId,
    importance: "high",
    metadata: { source: "session" },
  };
}

function buildSessionMemory(runId: string): HarnessSessionMemoryRecord {
  return {
    runId,
    goal: `Goal for ${runId}`,
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

function buildSummary(runId: string): HarnessSummaryRecord {
  return {
    id: `summary:${runId}:1`,
    runId,
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

async function seedRunGraph(store: ReturnType<typeof createHarnessGraphStore>, runId: string) {
  const run = buildRun(runId);
  const checkpoint = buildCheckpoint(runId);
  const taskRunning = buildTask(runId, `task:${runId}:1`, "running", 0);
  const taskCompleted = buildTask(runId, `task:${runId}:2`, "completed", 1);
  const taskFailed = buildTask(runId, `task:${runId}:3`, "failed", 2);
  const taskCanceled = buildTask(runId, `task:${runId}:4`, "canceled", 3);
  const approvalPending = buildApproval(runId, `approval:${runId}:1`, "pending", "2026-04-03T00:00:03.000Z");
  const approvalApproved = buildApproval(runId, `approval:${runId}:2`, "approved", "2026-04-03T00:00:04.000Z");
  const approvalDenied = buildApproval(runId, `approval:${runId}:3`, "denied", "2026-04-03T00:00:05.000Z");
  const approvalCanceled = buildApproval(runId, `approval:${runId}:4`, "canceled", "2026-04-03T00:00:06.000Z");
  const artifactScreenshot = buildArtifact(runId, `artifact:${runId}:1`, "screenshot", "2026-04-03T00:00:07.000Z");
  const artifactLog = buildArtifact(runId, `artifact:${runId}:2`, "log", "2026-04-03T00:00:08.000Z");
  const artifactTrace = buildArtifact(runId, `artifact:${runId}:3`, "trace", "2026-04-03T00:00:09.000Z");
  const memoryProject = buildMemory(runId, `memory:${runId}:1`, "summary", "Project memory", "2026-04-03T00:00:07.000Z");
  const memorySession = buildSessionMemory(runId);
  const summary = buildSummary(runId);

  const bindings = [
    bindHarnessRunRecord({ run }),
    bindHarnessCheckpointRecord({
      runId,
      checkpoint,
      updatedAt: "2026-04-03T00:00:11.000Z",
      previousTurnId: `turn:${runId}:1`,
    }),
    bindHarnessTaskRecord({ task: taskRunning, previousTurnId: `turn:${runId}:2` }),
    bindHarnessTaskRecord({ task: taskCompleted, previousTurnId: `task:${runId}:1` }),
    bindHarnessTaskRecord({ task: taskFailed, previousTurnId: `task:${runId}:2` }),
    bindHarnessTaskRecord({ task: taskCanceled, previousTurnId: `task:${runId}:3` }),
    bindHarnessApprovalRecord({
      approval: approvalPending,
      sourceNodeId: `turn:${runId}:4`,
    }),
    bindHarnessApprovalRecord({
      approval: approvalApproved,
      sourceNodeId: `turn:${runId}:4`,
    }),
    bindHarnessApprovalRecord({
      approval: approvalDenied,
      sourceNodeId: `turn:${runId}:4`,
    }),
    bindHarnessApprovalRecord({
      approval: approvalCanceled,
      sourceNodeId: `turn:${runId}:4`,
    }),
    bindHarnessArtifactRecord({
      artifact: artifactScreenshot,
      sourceNodeId: `turn:${runId}:4`,
    }),
    bindHarnessArtifactRecord({
      artifact: artifactLog,
      sourceNodeId: `turn:${runId}:4`,
    }),
    bindHarnessArtifactRecord({
      artifact: artifactTrace,
      sourceNodeId: `turn:${runId}:4`,
    }),
    bindHarnessMemoryRecord({
      memory: memoryProject,
      sourceNodeId: `turn:${runId}:4`,
    }),
    bindHarnessMemoryRecord({
      memory: memorySession,
      sourceNodeId: `turn:${runId}:4`,
    }),
    bindHarnessMemoryRecord({
      memory: summary,
      sourceNodeId: `turn:${runId}:4`,
    }),
  ];

  for (const binding of bindings) {
    for (const node of binding.nodes) {
      await store.upsertNode(node);
    }
    for (const edge of binding.edges) {
      await store.upsertEdge(edge);
    }
  }
}

describe("graph read model matrix", () => {
  it("keeps run timeline items ordered by graph node recency", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    await seedRunGraph(store, "run-a");

    const timeline = await projectHarnessRunTimeline(store, scope("run", "run-a"));
    expect(timeline.scope).toEqual(scope("run", "run-a"));
    expect(timeline.items.length).toBeGreaterThanOrEqual(2);
    expect(timeline.items.some((item) => item.kind === "run")).toBe(true);
    expect(timeline.items.some((item) => item.kind === "checkpoint")).toBe(true);
    expect(timeline.items.some((item) => item.kind === "turn")).toBe(true);
    expect(timeline.items.some((item) => item.kind === "task")).toBe(true);
    expect(timeline.items.length).toBeGreaterThan(1);
  });

  it("produces a task board that separates running, completed, failed, and canceled tasks", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    await seedRunGraph(store, "run-b");

    const board = await projectHarnessTaskBoard(store, { runId: "run-b" });
    expect(board.scope).toEqual(scope("run", "run-b"));
    expect(board.running.map((entry) => entry.status)).toEqual(["running"]);
    expect(board.completed.map((entry) => entry.status)).toEqual(["completed"]);
    expect(board.failed.map((entry) => entry.status)).toEqual(["failed"]);
    expect(board.canceled.map((entry) => entry.status)).toEqual(["canceled"]);
    expect(board.running[0]!.order).toBe(0);
    expect(board.completed[0]!.order).toBe(1);
  });

  it("keeps approval inbox entries split into pending and resolved buckets", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    await seedRunGraph(store, "run-c");

    const inbox = await projectHarnessApprovalInbox(store, { runId: "run-c" });
    expect(inbox.scope).toEqual(scope("run", "run-c"));
    expect(inbox.pending).toHaveLength(1);
    expect(inbox.resolved.map((entry) => entry.status).sort()).toEqual([
      "approved",
      "canceled",
      "denied",
    ]);
    expect(inbox.pending[0]!.tool).toBe("approval:run-c:1");
    expect(inbox.pending[0]!.reason).toContain("approval");
  });

  it("projects artifact feeds in recency order with stable path metadata", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    await seedRunGraph(store, "run-d");

    const feed = await projectHarnessArtifactFeed(store, { runId: "run-d" });
    expect(feed.scope).toEqual(scope("run", "run-d"));
    expect(feed.items).toHaveLength(3);
    expect(feed.items[0]!.createdAt >= feed.items[1]!.createdAt).toBe(true);
    expect(feed.items[0]!.path).toContain("/tmp/artifacts/run-d/");
    expect(feed.items.map((item) => item.mimeType)).toEqual([
      "application/octet-stream",
      "application/octet-stream",
      "application/octet-stream",
    ]);
  });

  it("collects graph context nodes using run-relative relatedTo lookups", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    await seedRunGraph(store, "run-e");

    const nodes = await collectGraphContextNodes({
      runtimeStore: store,
      runId: "run-e",
      query: "release summary",
      scopes: [scope("run", "run-e"), scope("project", "capstan")],
      kinds: ["turn", "memory", "artifact"],
      limit: 5,
    });

    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.some((node) => node.kind === "memory")).toBe(true);
    expect(nodes.some((node) => node.kind === "artifact")).toBe(true);
    expect(nodes.every((node) => node.scope.kind === "run")).toBe(true);
  });

  it("queries graph neighbors symmetrically across inbound and outbound edges", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    await seedRunGraph(store, "run-f");

    const neighbors = await listGraphNeighbors(store, "turn:run-f:2", {
      scopes: [scope("run", "run-f")],
      limit: 10,
    });

    expect(neighbors.length).toBeGreaterThan(0);
    expect(neighbors.some((node) => node.kind === "task")).toBe(true);
  });

  it("returns graph search results consistent with query text and scope filters", async () => {
    const rootDir = await createTempDir();
    const store = createHarnessGraphStore(rootDir);
    await seedRunGraph(store, "run-g");

    const results = await queryHarnessGraph(store, {
      text: "release",
      scopes: [scope("run", "run-g")],
      kinds: ["turn", "task", "memory", "artifact"],
      relatedTo: "run:run-g",
      limit: 10,
      minScore: 0,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((result) => result.kind === "memory")).toBe(true);
    expect(results.some((result) => result.kind === "artifact")).toBe(true);
    expect(results.every((result) => result.scope.kind === "run")).toBe(true);
  });

  describe("scope-aware projection matrix", () => {
    it("keeps run timeline projections stable when queried by explicit run scope", async () => {
      const rootDir = await createTempDir();
      const store = createHarnessGraphStore(rootDir);
      await seedRunGraph(store, "run-h");

      const timeline = await projectHarnessRunTimeline(store, scope("run", "run-h"));
      expect(timeline.scope).toEqual(scope("run", "run-h"));
      expect(timeline.items[0]!.kind).toBe("run");
      expect(timeline.items.some((item) => item.kind === "checkpoint")).toBe(true);
      expect(timeline.items.every((item) => item.scope.kind === "run")).toBe(true);
    });

    it("keeps task board projections partitioned by task status buckets", async () => {
      const rootDir = await createTempDir();
      const store = createHarnessGraphStore(rootDir);
      await seedRunGraph(store, "run-i");

      const board = await projectHarnessTaskBoard(store, scope("run", "run-i"));
      expect(board.scope).toEqual(scope("run", "run-i"));
      expect(board.running.map((entry) => entry.status)).toEqual(["running"]);
      expect(board.completed.map((entry) => entry.status)).toEqual(["completed"]);
      expect(board.failed.map((entry) => entry.status)).toEqual(["failed"]);
      expect(board.canceled.map((entry) => entry.status)).toEqual(["canceled"]);
    });

    it("keeps approval inbox projections stable across pending and resolved statuses", async () => {
      const rootDir = await createTempDir();
      const store = createHarnessGraphStore(rootDir);
      await seedRunGraph(store, "run-j");

      const inbox = await projectHarnessApprovalInbox(store, scope("run", "run-j"));
      expect(inbox.scope).toEqual(scope("run", "run-j"));
      expect(inbox.pending).toHaveLength(1);
      expect(inbox.resolved.map((entry) => entry.status).sort()).toEqual([
        "approved",
        "canceled",
        "denied",
      ]);
    });

    it("keeps artifact feeds sorted by updatedAt even when the run emits multiple artifact kinds", async () => {
      const rootDir = await createTempDir();
      const store = createHarnessGraphStore(rootDir);
      await seedRunGraph(store, "run-k");

      const feed = await projectHarnessArtifactFeed(store, scope("run", "run-k"));
      expect(feed.scope).toEqual(scope("run", "run-k"));
      expect(feed.items.length).toBe(3);
      expect(feed.items[0]!.updatedAt >= feed.items[1]!.updatedAt).toBe(true);
      expect(feed.items.map((item) => item.kind).sort()).toEqual(["log", "screenshot", "trace"]);
    });

    it("collects context nodes by run scope and explicit kind filters", async () => {
      const rootDir = await createTempDir();
      const store = createHarnessGraphStore(rootDir);
      await seedRunGraph(store, "run-l");

      const nodes = await collectGraphContextNodes(store, {
        scopes: [scope("run", "run-l")],
        kinds: ["turn", "memory", "artifact"],
        limit: 5,
      });

      expect(nodes.length).toBeGreaterThan(0);
      expect(nodes.every((node) => ["turn", "memory", "artifact"].includes(node.kind))).toBe(true);
      expect(nodes.every((node) => node.scope.kind === "run")).toBe(true);
    });

    it("returns search results and neighbors for the same run-scoped graph", async () => {
      const rootDir = await createTempDir();
      const store = createHarnessGraphStore(rootDir);
      await seedRunGraph(store, "run-m");

      const search = await queryHarnessGraph(store, {
        text: "release",
        scopes: [scope("run", "run-m")],
        kinds: ["turn", "task", "memory", "artifact"],
        relatedTo: "run:run-m",
        limit: 10,
      });
      const neighbors = await listGraphNeighbors(
        store,
        "checkpoint:run-m:assistant_response:3:2026-04-03T00:00:11.000Z",
        {
          scopes: [scope("run", "run-m")],
          limit: 10,
        },
      );

      expect(search.length).toBeGreaterThan(0);
      expect(search.some((result) => result.kind === "memory")).toBe(true);
      expect(neighbors.length).toBeGreaterThan(0);
      expect(neighbors.some((node) => node.kind === "run")).toBe(true);
      expect(neighbors.some((node) => node.kind === "turn")).toBe(true);
      expect(neighbors.every((node) => node.scope.kind === "run")).toBe(true);
    });

    it("keeps neighbor expansion scope-local when the query starts from the checkpoint turn", async () => {
      const rootDir = await createTempDir();
      const store = createHarnessGraphStore(rootDir);
      await seedRunGraph(store, "run-n");

      const neighbors = await listGraphNeighbors(
        store,
        "checkpoint:run-n:assistant_response:3:2026-04-03T00:00:11.000Z",
        {
          scopes: [scope("run", "run-n")],
          limit: 10,
        },
      );

      expect(neighbors.length).toBeGreaterThan(0);
      expect(neighbors.some((node) => node.kind === "run")).toBe(true);
      expect(neighbors.some((node) => node.kind === "turn")).toBe(true);
      expect(neighbors.every((node) => node.scope.kind === "run")).toBe(true);
    });
  });
});

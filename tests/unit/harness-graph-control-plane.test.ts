import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  FileHarnessRuntimeStore,
  createHarness,
  openHarnessRuntime,
} from "../../packages/ai/src/index.ts";
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
  createHarnessGraphStore,
  createProjectGraphScope,
  createRunGraphScope,
  encodeGraphPathSegment,
  assertValidGraphBindingResult,
  assertValidGraphEdgeRecord,
  assertValidGraphNodeRecord,
  assertValidGraphScope,
  assertValidGraphScopeRecord,
  assertValidGraphScopeSummary,
  assertValidGraphSearchResult,
  compareTimestampDescendingThenId,
  extractGraphSearchText,
  formatHarnessGraphScopeKey,
  formatHarnessGraphScopeTitle,
  graphEdgeMatchesQuery,
  graphNodeMatchesQuery,
  graphNodeSearchText,
  graphScopeKey,
  graphScopesIntersect,
  memoryScopeToGraphScope,
  mergeGraphScopes,
  normalizeGraphScope,
  normalizeGraphScopes,
  scoreGraphNode,
  sortGraphEdges,
  sortGraphNodes,
  scopesEqual,
  stripUndefinedGraphValue,
  projectApprovalInbox,
  projectArtifactFeed,
  projectRunTimeline,
  projectTaskBoard,
} from "../../packages/ai/src/harness/graph/index.ts";
import type {
  HarnessAccessContext,
  HarnessAuthorizationDecision,
  HarnessAuthorizationRequest,
  HarnessArtifactFeedItem,
  HarnessApprovalRecord,
  HarnessApprovalInboxItem,
  HarnessApprovalInboxProjection,
  HarnessArtifactRecord,
  HarnessGraphEdgeRecord,
  HarnessGraphNodeRecord,
  HarnessGraphScope,
  HarnessGraphScopeRecord,
  HarnessGraphScopeSummary,
  HarnessGraphSearchResult,
  HarnessRunRecord,
  HarnessTaskBoardItem,
  HarnessTaskRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
} from "../../packages/ai/src/harness/types.ts";
import type { AgentLoopCheckpoint, LLMMessage, LLMOptions, LLMProvider, LLMResponse, MemoryScope } from "../../packages/ai/src/types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-graph-control-plane-"));
  tempDirs.push(dir);
  return dir;
}

function mockLLM(content = "{}", model = "mock-graph-1"): LLMProvider {
  return {
    name: "mock-graph",
    async chat(_messages: LLMMessage[], _options?: LLMOptions): Promise<LLMResponse> {
      return { content, model };
    },
  };
}

function now(offsetMinutes = 0): string {
  return new Date(Date.UTC(2026, 3, 4, 0, offsetMinutes, 0)).toISOString();
}

function buildRun(
  id: string,
  patch: Partial<HarnessRunRecord> = {},
): HarnessRunRecord {
  return {
    id,
    goal: `goal:${id}`,
    status: "completed",
    createdAt: now(0),
    updatedAt: now(1),
    iterations: 2,
    toolCalls: 1,
    taskCalls: 1,
    maxIterations: 6,
    toolNames: ["lookup", "write"],
    taskNames: ["deploy"],
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: false,
      artifactDir: `/artifacts/${id}`,
    },
    lastEventSequence: 0,
    ...patch,
  };
}

function buildCheckpoint(goal: string): AgentLoopCheckpoint {
  return {
    stage: "assistant_response",
    config: { goal, maxIterations: 6 },
    messages: [{ role: "user", content: goal }],
    iterations: 2,
    toolCalls: [{ tool: "lookup", args: { query: goal }, result: { ok: true } }],
    pendingToolCall: {
      assistantMessage: "continue",
      tool: "lookup",
      args: { query: goal },
    },
    orchestration: {
      phase: "executing_tools",
      transitionReason: "next_turn",
      turnCount: 3,
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
    lastAssistantResponse: "continue",
  };
}

function buildTask(
  runId: string,
  id: string,
  patch: Partial<HarnessTaskRecord> = {},
): HarnessTaskRecord {
  return {
    id,
    runId,
    requestId: `request:${id}`,
    name: id,
    kind: "workflow",
    order: 0,
    status: "completed",
    createdAt: now(2),
    updatedAt: now(3),
    args: { id },
    hardFailure: false,
    result: { ok: true },
    ...patch,
  };
}

function buildApproval(
  runId: string,
  id: string,
  patch: Partial<HarnessApprovalRecord> = {},
): HarnessApprovalRecord {
  return {
    id,
    runId,
    kind: "tool",
    tool: "ticket.delete",
    args: { id },
    reason: "manual approval required",
    requestedAt: now(4),
    updatedAt: now(5),
    status: "pending",
    ...patch,
  };
}

function buildArtifact(
  runId: string,
  id: string,
  patch: Partial<HarnessArtifactRecord> = {},
): HarnessArtifactRecord {
  return {
    id,
    runId,
    kind: "report",
    path: `/artifacts/${runId}/${id}.md`,
    createdAt: now(6),
    mimeType: "text/markdown",
    size: 128,
    metadata: { kind: "report", source: "test", preview: `preview:${id}` },
    ...patch,
  };
}

function buildMemory(
  runId: string,
  id: string,
  patch: Partial<HarnessGraphNodeRecord> = {},
): HarnessGraphNodeRecord {
  return {
    id,
    kind: "memory",
    scope: { kind: "project", projectId: "capstan" },
    title: `Memory: ${id}`,
    createdAt: now(7),
    updatedAt: now(8),
    runId,
    status: "summary",
    summary: `summary:${id}`,
    content: `content:${id}`,
    metadata: { source: "test" },
    ...patch,
  };
}

async function seedGraphRoot(rootDir: string) {
  const store = new FileHarnessRuntimeStore(rootDir);
  await store.initialize();

  const runA = buildRun("run-a", {
    status: "running",
    updatedAt: now(11),
  });
  const runB = buildRun("run-b", {
    status: "completed",
    updatedAt: now(12),
  });
  const blockedRun = buildRun("run-blocked", {
    status: "approval_required",
    updatedAt: now(13),
    pendingApprovalId: "approval-blocked",
    pendingApproval: {
      id: "approval-blocked",
      kind: "tool",
      tool: "ticket.delete",
      args: { ticketId: "blocked" },
      reason: "manual approval required",
      requestedAt: now(4),
      status: "pending",
    },
  });

  await store.persistRun(runA);
  await store.persistRun(runB);
  await store.persistRun(blockedRun);

  const checkpointA = buildCheckpoint("goal:run-a");
  const checkpointB = buildCheckpoint("goal:run-b");
  await store.persistCheckpoint("run-a", checkpointA);
  await store.persistCheckpoint("run-b", checkpointB);

  const taskA = buildTask("run-a", "task-a", {
    status: "running",
    order: 1,
    updatedAt: now(20),
  });
  const taskB = buildTask("run-a", "task-b", {
    status: "completed",
    order: 0,
    updatedAt: now(21),
  });
  const taskC = buildTask("run-b", "task-c", {
    status: "failed",
    order: 2,
    updatedAt: now(22),
  });
  await store.persistTask(taskA);
  await store.persistTask(taskB);
  await store.persistTask(taskC);
  const taskNodeA = buildTaskGraphNode({ rootDir }, taskA);
  const taskNodeB = buildTaskGraphNode({ rootDir }, taskB);
  const taskNodeC = buildTaskGraphNode({ rootDir }, taskC);

  const approvalA = buildApproval("run-a", "approval-a", {
    requestedAt: now(30),
    updatedAt: now(31),
  });
  const approvalB = buildApproval("run-a", "approval-b", {
    requestedAt: now(32),
    updatedAt: now(33),
    status: "approved",
    resolvedAt: now(34),
  });
  const approvalBlocked = buildApproval("run-blocked", "approval-blocked", {
    requestedAt: now(34),
    updatedAt: now(35),
  });
  await store.persistApproval(approvalA);
  await store.persistApproval(approvalB);
  await store.persistApproval(approvalBlocked);
  const approvalNodeA = buildApprovalGraphNode({ rootDir }, approvalA);
  const approvalNodeB = buildApprovalGraphNode({ rootDir }, approvalB);
  const approvalNodeBlocked = buildApprovalGraphNode({ rootDir }, approvalBlocked);

  const artifactA = buildArtifact("run-a", "artifact-a", {
    createdAt: now(40),
    updatedAt: now(41),
    metadata: {
      kind: "screenshot",
      mimeType: "image/png",
      size: 2048,
      preview: "alpha-preview",
      path: "/artifacts/run-a/artifact-a.png",
    },
  });
  const artifactB = buildArtifact("run-a", "artifact-b", {
    createdAt: now(42),
    updatedAt: now(43),
    metadata: {
      kind: "report",
      mimeType: "text/markdown",
      size: 512,
      preview: "beta-preview",
      path: "/artifacts/run-a/artifact-b.md",
    },
  });
  const artifactC = buildArtifact("run-b", "artifact-c", {
    createdAt: now(44),
    updatedAt: now(45),
    metadata: {
      kind: "log",
      mimeType: "text/plain",
      size: 1024,
      path: "/artifacts/run-b/artifact-c.log",
    },
  });
  const artifactNodeA = buildArtifactGraphNode({ rootDir }, artifactA);
  const artifactNodeB = buildArtifactGraphNode({ rootDir }, artifactB);
  const artifactNodeC = buildArtifactGraphNode({ rootDir }, artifactC);

  await store.persistSessionMemory({
    runId: "run-a",
    goal: "goal:run-a",
    status: "running",
    updatedAt: now(50),
    sourceRunUpdatedAt: now(11),
    headline: "run-a session",
    currentPhase: "turning",
    recentSteps: ["step-1", "step-2"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    compactedMessages: 0,
    tokenEstimate: 33,
  });

  await store.persistSummary({
    id: "summary-a",
    runId: "run-a",
    kind: "run_compact",
    status: "running",
    headline: "summary-a",
    createdAt: now(51),
    updatedAt: now(52),
    sourceRunUpdatedAt: now(11),
    completedSteps: ["step-1"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    iterations: 2,
    toolCalls: 1,
    messageCount: 4,
    compactedMessages: 1,
  });

  await store.rememberMemory({
    scope: { type: "run", id: "run-a" },
    runId: "run-a",
    kind: "observation",
    content: "alpha observation",
    metadata: { lane: "a" },
  });
  await store.rememberMemory({
    scope: { type: "run", id: "run-b" },
    runId: "run-b",
    kind: "observation",
    content: "beta observation",
    metadata: { lane: "b" },
  });

  const runNode = buildRunGraphNode({ rootDir }, runA);
  const turnNode = buildTurnGraphNode({ rootDir }, runA, checkpointA, now(15));
  const projectScope: HarnessGraphScope = { kind: "project", projectId: "capstan" };
  const projectMemory = buildMemory("run-a", "memory-project", {
    scope: projectScope,
    createdAt: now(16),
    updatedAt: now(17),
    content: "project memory content",
    summary: "project memory",
  });
  const entityMemory = buildMemory("run-b", "memory-entity", {
    scope: { kind: "entity", entityType: "project", entityId: "capstan" },
    createdAt: now(18),
    updatedAt: now(19),
    content: "entity memory content",
    summary: "entity memory",
  });

  await store.upsertGraphNode(runNode);
  await store.upsertGraphNode(turnNode);
  await store.upsertGraphNode(taskNodeA);
  await store.upsertGraphNode(taskNodeB);
  await store.upsertGraphNode(taskNodeC);
  await store.upsertGraphNode(approvalNodeA);
  await store.upsertGraphNode(approvalNodeB);
  await store.upsertGraphNode(approvalNodeBlocked);
  await store.upsertGraphNode(artifactNodeA);
  await store.upsertGraphNode(artifactNodeB);
  await store.upsertGraphNode(artifactNodeC);
  await store.upsertGraphNode(projectMemory);
  await store.upsertGraphNode(entityMemory);
  await store.upsertGraphEdge(
    buildRunTurnEdge(runA, turnNode.id, turnNode.updatedAt),
  );
  await store.upsertGraphEdge(buildRunTaskEdge(runA, taskA));
  await store.upsertGraphEdge(buildRunTaskEdge(runA, taskB));
  await store.upsertGraphEdge(buildRunTaskEdge(runB, taskC));
  await store.upsertGraphEdge(buildRunApprovalEdge(runA, approvalA));
  await store.upsertGraphEdge(buildRunApprovalEdge(runA, approvalB));
  await store.upsertGraphEdge(buildRunApprovalEdge(blockedRun, approvalBlocked));
  await store.upsertGraphEdge(buildRunArtifactEdge(runA, artifactA));
  await store.upsertGraphEdge(buildRunArtifactEdge(runA, artifactB));
  await store.upsertGraphEdge(buildRunArtifactEdge(runB, artifactC));
  await store.upsertGraphEdge(buildRunMemoryEdge(runA, projectMemory.id, projectMemory.updatedAt, "memory"));
  await store.upsertGraphEdge(buildRunMemoryEdge(runB, entityMemory.id, entityMemory.updatedAt, "memory"));

  const projectRun = buildRun("run-project", {
    status: "running",
    updatedAt: now(61),
    graphScopes: [projectScope],
  });
  const projectCheckpoint = buildCheckpoint("goal:run-project");
  const projectTask = buildTask(projectRun.id, "task-project", {
    status: "running",
    order: 3,
    createdAt: now(62),
    updatedAt: now(63),
  });
  const projectApproval = buildApproval(projectRun.id, "approval-project", {
    requestedAt: now(64),
    updatedAt: now(65),
    status: "pending",
  });
  const projectArtifact = buildArtifact(projectRun.id, "artifact-project", {
    createdAt: now(66),
    updatedAt: now(67),
    metadata: {
      kind: "report",
      mimeType: "text/markdown",
      size: 256,
      preview: "project-preview",
      path: `/artifacts/${projectRun.id}/artifact-project.md`,
    },
  });
  const projectTurn = buildTurnGraphNode({ rootDir }, projectRun, projectCheckpoint, now(68));
  const projectTaskNode = buildTaskGraphNode({ rootDir }, projectRun, projectTask);
  const projectApprovalNode = buildApprovalGraphNode({ rootDir }, projectRun, projectApproval);
  const projectArtifactNode = buildArtifactGraphNode({ rootDir }, projectRun, projectArtifact);

  await store.persistRun(projectRun);
  await store.upsertGraphNode(buildRunGraphNode({ rootDir }, projectRun));
  await store.upsertGraphNode(projectTurn);
  await store.upsertGraphNode(projectTaskNode);
  await store.upsertGraphNode(projectApprovalNode);
  await store.upsertGraphNode(projectArtifactNode);
  await store.upsertGraphEdge(buildRunTurnEdge(projectRun, projectTurn.id, projectTurn.updatedAt));
  await store.upsertGraphEdge(
    buildRunTaskEdge(projectRun, {
      ...projectTask,
      runId: projectRun.id,
    }),
  );
  await store.upsertGraphEdge(
    buildRunApprovalEdge(projectRun, {
      ...projectApproval,
      runId: projectRun.id,
    }),
  );
  await store.upsertGraphEdge(
    buildRunArtifactEdge(projectRun, {
      ...projectArtifact,
      runId: projectRun.id,
    }),
  );
  await store.upsertGraphEdge({
    id: "contains:project:capstan->memory-project",
    kind: "contains",
    scope: projectScope,
    from: "project:capstan",
    to: projectMemory.id,
    createdAt: now(69),
    updatedAt: now(69),
  });
  await store.upsertGraphEdge({
    id: "contains:project:capstan->task-project",
    kind: "contains",
    scope: projectScope,
    from: "project:capstan",
    to: projectTaskNode.id,
    createdAt: now(70),
    updatedAt: now(70),
  });
  await store.upsertGraphEdge({
    id: "contains:project:capstan->approval-project",
    kind: "contains",
    scope: projectScope,
    from: "project:capstan",
    to: projectApprovalNode.id,
    createdAt: now(71),
    updatedAt: now(71),
  });
  await store.upsertGraphEdge({
    id: "contains:project:capstan->artifact-project",
    kind: "contains",
    scope: projectScope,
    from: "project:capstan",
    to: projectArtifactNode.id,
    createdAt: now(72),
    updatedAt: now(72),
  });

  return {
    store,
    runA,
    runB,
    blockedRun,
    taskA,
    taskB,
    taskC,
    taskNodeA,
    taskNodeB,
    taskNodeC,
    approvalA,
    approvalB,
    approvalBlocked,
    approvalNodeA,
    approvalNodeB,
    approvalNodeBlocked,
    artifactA,
    artifactB,
    artifactC,
    artifactNodeA,
    artifactNodeB,
    artifactNodeC,
    projectScope,
    projectMemory,
    projectRun,
    turnNode,
    projectTurn,
    projectTaskNode,
    projectApprovalNode,
    projectArtifactNode,
    entityMemory,
  };
}

function mockAuthorize(
  decide?: (request: HarnessAuthorizationRequest) => HarnessAuthorizationDecision | boolean | void,
) {
  const requests: HarnessAuthorizationRequest[] = [];
  return {
    requests,
    authorize(request: HarnessAuthorizationRequest) {
      requests.push(request);
      return decide?.(request) ?? true;
    },
  };
}

async function openHarnessPair(
  rootDir: string,
  decide?: (request: HarnessAuthorizationRequest) => HarnessAuthorizationDecision | boolean | void,
) {
  const recorder = mockAuthorize(decide);
  const access: HarnessAccessContext = {
    subject: { id: "operator-1" },
    metadata: { source: "graph-control-plane-test" },
  };
  const harness = await createHarness({
    llm: mockLLM(),
    runtime: {
      rootDir,
      authorize: recorder.authorize,
    },
    verify: { enabled: false },
    context: {
      maxPromptTokens: 4096,
      reserveOutputTokens: 0,
      maxGraphNodes: 32,
      maxMemories: 32,
      maxArtifacts: 32,
      autoPromoteObservations: true,
      autoPromoteSummaries: true,
    },
  });
  const runtime = await openHarnessRuntime({
    rootDir,
    authorize: recorder.authorize,
  });
  return { harness, runtime, requests: recorder.requests, access };
}

function expectDeniedMessage(action: string, runId?: string): RegExp {
  return new RegExp(
    `Harness access denied for ${action}${runId ? ` for run ${runId}` : ""}`,
  );
}

describe("harness graph control plane", () => {
  it("serves the same graph node and edge records through live harness and control-plane reads", async () => {
    const rootDir = await createTempDir();
    const seed = await seedGraphRoot(rootDir);
    const { harness, runtime, access } = await openHarnessPair(rootDir);

    const liveNode = await harness.getGraphNode(seed.taskNodeA.id, access);
    const runtimeNode = await runtime.getGraphNode(seed.taskNodeA.id, access);
    expect(runtimeNode).toBeDefined();
    expect(liveNode).toMatchObject(runtimeNode!);
    expect(liveNode).toMatchObject({
      id: seed.taskNodeA.id,
      kind: "task",
      runId: "run-a",
    });

    const liveNodes = await harness.listGraphNodes(
      { scopes: [createRunGraphScope("run-a")] },
      access,
    );
    const runtimeNodes = await runtime.listGraphNodes(
      { scopes: [createRunGraphScope("run-a")] },
      access,
    );
    expect(liveNodes).toEqual(runtimeNodes);
    expect(liveNodes.map((node) => node.id)).toContain(seed.taskNodeA.id);

    const liveEdges = await harness.listGraphEdges(
      { scopes: [createRunGraphScope("run-a")] },
      access,
    );
    const runtimeEdges = await runtime.listGraphEdges(
      { scopes: [createRunGraphScope("run-a")] },
      access,
    );
    expect(liveEdges).toEqual(runtimeEdges);
    expect(liveEdges.map((edge) => edge.id)).toContain(
      buildRunTaskEdge(seed.runA, seed.taskA).id,
    );

    const liveTimeline = await harness.getRunTimeline("run-a", access);
    const runtimeTimeline = await runtime.getRunTimeline("run-a", access);
    expect(liveTimeline).toEqual(runtimeTimeline);
    expect(liveTimeline.map((item) => item.kind)).toContain("task");
    expect(liveTimeline[0]?.kind).toBe("run");

    const liveBoard = await harness.getTaskBoard({ runId: "run-a" }, access);
    const runtimeBoard = await runtime.getTaskBoard({ runId: "run-a" }, access);
    expect(liveBoard).toEqual(runtimeBoard);
    expect(liveBoard.map((item) => item.taskId)).toEqual([
      seed.taskNodeA.id,
      seed.taskNodeB.id,
    ]);

    const liveInbox = await harness.getApprovalInbox({ runId: "run-a" }, access);
    const runtimeInbox = await runtime.getApprovalInbox({ runId: "run-a" }, access);
    expect(liveInbox).toEqual(runtimeInbox);
    expect(liveInbox[0]?.approvalId).toBe(seed.approvalNodeA.id);

    const liveFeed = await harness.getArtifactFeed({ runId: "run-a" }, access);
    const runtimeFeed = await runtime.getArtifactFeed({ runId: "run-a" }, access);
    expect(liveFeed).toEqual(runtimeFeed);
    expect(liveFeed.map((item) => item.artifactId)).toEqual([
      seed.artifactNodeB.id,
      seed.artifactNodeA.id,
    ]);
  });

  it("returns undefined for missing graph nodes and keeps the authorization hook quiet", async () => {
    const rootDir = await createTempDir();
    await seedGraphRoot(rootDir);
    const { harness, runtime, requests, access } = await openHarnessPair(rootDir);

    expect(await harness.getGraphNode("missing-node", access)).toBeUndefined();
    expect(await runtime.getGraphNode("missing-node", access)).toBeUndefined();
    expect(requests).toEqual([]);
  });

  it("enforces access policy on graph reads and projections before filtering item-level results", async () => {
    const rootDir = await createTempDir();
    const seed = await seedGraphRoot(rootDir);
    const { harness, runtime } = await openHarnessPair(rootDir, (request) => {
      if (request.action === "graph:read" || request.action === "graph:list") {
        return request.runId !== "run-b";
      }
      return true;
    });

    await expect(harness.getGraphNode(seed.taskNodeC.id)).rejects.toThrow(
      expectDeniedMessage("graph:read", "run-b"),
    );
    await expect(runtime.getGraphNode(seed.taskNodeC.id)).rejects.toThrow(
      expectDeniedMessage("graph:read", "run-b"),
    );

    const liveNodes = await harness.listGraphNodes({ kinds: ["task"] });
    const runtimeNodes = await runtime.listGraphNodes({ kinds: ["task"] });
    expect(liveNodes.map((node) => node.runId).sort()).toEqual([
      "run-a",
      "run-a",
      "run-project",
    ]);
    expect(runtimeNodes.map((node) => node.runId).sort()).toEqual([
      "run-a",
      "run-a",
      "run-project",
    ]);

    const liveEdges = await harness.listGraphEdges({ runId: "run-a" });
    const runtimeEdges = await runtime.listGraphEdges({ runId: "run-a" });
    expect(new Set(liveEdges.map((edge) => edge.runId))).toEqual(new Set(["run-a"]));
    expect(new Set(runtimeEdges.map((edge) => edge.runId))).toEqual(new Set(["run-a"]));

    const liveTimeline = await harness.getRunTimeline("run-a");
    const runtimeTimeline = await runtime.getRunTimeline("run-a");
    expect(liveTimeline.map((item) => item.kind)).toContain("task");
    expect(runtimeTimeline.map((item) => item.kind)).toContain("task");
    await expect(harness.getRunTimeline("run-b")).rejects.toThrow(
      expectDeniedMessage("graph:read", "run-b"),
    );
    await expect(runtime.getRunTimeline("run-b")).rejects.toThrow(
      expectDeniedMessage("graph:read", "run-b"),
    );
  });

  it("honors run-scoped, project-scoped, and entity-scoped graph queries consistently", async () => {
    const rootDir = await createTempDir();
    const seed = await seedGraphRoot(rootDir);
    const { harness, runtime, access } = await openHarnessPair(rootDir);

    const runNodes = await harness.listGraphNodes(
      { runId: "run-a" },
      access,
    );
    const projectNodes = await harness.listGraphNodes(
      { scopes: [seed.projectScope] },
      access,
    );
    const entityNodes = await runtime.listGraphNodes(
      { scopes: [{ kind: "entity", entityType: "project", entityId: "capstan" }] },
      access,
    );

    expect(runNodes.map((node) => node.runId)).toContain("run-a");
    expect(projectNodes.map((node) => node.scope.kind)).toContain("project");
    expect(entityNodes.map((node) => node.scope.kind)).toContain("entity");

    const projectTimeline = await harness.getTaskBoard({ scopes: [seed.projectScope] }, access);
    expect(projectTimeline.map((item) => item.taskId)).toEqual([
      seed.projectTaskNode.id,
    ]);
    const entityInbox = await runtime.getApprovalInbox(
      { scopes: [{ kind: "entity", entityType: "project", entityId: "capstan" }] },
      access,
    );
    expect(entityInbox).toEqual([]);
  });

  it("orders timeline items by graph kind priority, then task order, then timestamps", async () => {
    const rootDir = await createTempDir();
    const seed = await seedGraphRoot(rootDir);
    const { harness, runtime, access } = await openHarnessPair(rootDir);

    const timeline = await harness.getRunTimeline("run-a", access);
    const runtimeTimeline = await runtime.getRunTimeline("run-a", access);
    expect(timeline).toEqual(runtimeTimeline);
    expect(timeline.map((item) => item.kind)).toEqual([
      "run",
      "turn",
      "task",
      "task",
      "approval",
      "approval",
      "artifact",
      "artifact",
      "memory",
      "memory",
      "memory",
    ]);
    expect(timeline.find((item) => item.nodeId === seed.taskNodeB.id)?.title).toBe("Task: task-b");
    expect(timeline.find((item) => item.nodeId === seed.taskNodeA.id)?.title).toBe("Task: task-a");
  });

  it("orders task boards, approval inboxes, and artifact feeds deterministically", async () => {
    const rootDir = await createTempDir();
    const seed = await seedGraphRoot(rootDir);
    const { harness, runtime, access } = await openHarnessPair(rootDir);

    const taskBoard = await harness.getTaskBoard({ runId: "run-a" }, access);
    const runtimeTaskBoard = await runtime.getTaskBoard({ runId: "run-a" }, access);
    expect(taskBoard).toEqual(runtimeTaskBoard);
    expect(taskBoard.map((entry) => entry.taskId)).toEqual([
      seed.taskNodeA.id,
      seed.taskNodeB.id,
    ]);
    expect(taskBoard.map((entry) => entry.status)).toEqual(["running", "completed"]);

    const approvalInbox = await harness.getApprovalInbox({ runId: "run-a" }, access);
    const runtimeApprovalInbox = await runtime.getApprovalInbox({ runId: "run-a" }, access);
    expect(approvalInbox).toEqual(runtimeApprovalInbox);
    expect(approvalInbox.map((entry) => entry.approvalId)).toEqual([
      seed.approvalNodeA.id,
      seed.approvalNodeB.id,
    ]);
    expect(approvalInbox.map((entry) => entry.status)).toEqual(["pending", "approved"]);

    const artifactFeed = await harness.getArtifactFeed({ runId: "run-a" }, access);
    const runtimeArtifactFeed = await runtime.getArtifactFeed({ runId: "run-a" }, access);
    expect(artifactFeed).toEqual(runtimeArtifactFeed);
    expect(artifactFeed.map((entry) => entry.artifactId)).toEqual([
      seed.artifactNodeB.id,
      seed.artifactNodeA.id,
    ]);
    expect(artifactFeed.map((entry) => entry.kind)).toEqual(["report", "screenshot"]);
  });

  it("projects empty collections for runs without matching graph scopes", async () => {
    const rootDir = await createTempDir();
    await seedGraphRoot(rootDir);
    const { harness, runtime, access } = await openHarnessPair(rootDir);

    expect(await harness.getTaskBoard({ scopes: [createProjectGraphScope("isolated")] }, access)).toEqual([]);
    expect(await runtime.getTaskBoard({ scopes: [createProjectGraphScope("isolated")] }, access)).toEqual([]);
    expect(await harness.getApprovalInbox({ scopes: [createProjectGraphScope("isolated")] }, access)).toEqual([]);
    expect(await runtime.getApprovalInbox({ scopes: [createProjectGraphScope("isolated")] }, access)).toEqual([]);
    expect(await harness.getArtifactFeed({ scopes: [createProjectGraphScope("isolated")] }, access)).toEqual([]);
    expect(await runtime.getArtifactFeed({ scopes: [createProjectGraphScope("isolated")] }, access)).toEqual([]);
  });

  it("filters listGraphNodes and listGraphEdges by explicit scope and kind combinations", async () => {
    const rootDir = await createTempDir();
    const seed = await seedGraphRoot(rootDir);
    const { harness, runtime, access } = await openHarnessPair(rootDir);

    const taskNodes = await harness.listGraphNodes(
      {
        kinds: ["task"],
        scopes: [createRunGraphScope("run-a")],
      },
      access,
    );
    const approvalEdges = await runtime.listGraphEdges(
      {
        kinds: ["contains"],
        toIds: [seed.approvalNodeA.id, seed.approvalNodeB.id],
        scopes: [createRunGraphScope("run-a")],
      },
      access,
    );

    expect(taskNodes.map((node) => node.id)).toEqual([
      seed.taskNodeB.id,
      seed.taskNodeA.id,
    ]);
    expect(approvalEdges.map((edge) => edge.kind)).toEqual(["contains", "contains"]);
    expect(approvalEdges.map((edge) => edge.to)).toEqual([
      seed.approvalNodeB.id,
      seed.approvalNodeA.id,
    ]);
  });

  it("keeps graph list queries stable when access filtering removes some but not all matches", async () => {
    const rootDir = await createTempDir();
    const seed = await seedGraphRoot(rootDir);
    const { harness, runtime } = await openHarnessPair(rootDir, (request) => {
      if (request.action === "graph:list" || request.action === "graph:read") {
        return request.runId !== "run-b";
      }
      return true;
    });

    const harnessNodes = await harness.listGraphNodes({ kinds: ["artifact"] });
    const runtimeNodes = await runtime.listGraphNodes({ kinds: ["artifact"] });
    expect(harnessNodes).toHaveLength(3);
    expect(runtimeNodes).toHaveLength(3);
    expect(harnessNodes.map((node) => node.id)).toContain(seed.artifactNodeA.id);
    expect(runtimeNodes.map((node) => node.id)).toContain(seed.artifactNodeA.id);

    const harnessFeed = await harness.getArtifactFeed({ runId: "run-a" });
    const runtimeFeed = await runtime.getArtifactFeed({ runId: "run-a" });
    expect(harnessFeed.map((entry) => entry.artifactId)).toEqual([
      seed.artifactNodeB.id,
      seed.artifactNodeA.id,
    ]);
    expect(runtimeFeed.map((entry) => entry.artifactId)).toEqual([
      seed.artifactNodeB.id,
      seed.artifactNodeA.id,
    ]);
  });

  it("shares control-plane graph projections with direct projector helpers for the same seed graph", async () => {
    const rootDir = await createTempDir();
    const seed = await seedGraphRoot(rootDir);
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.initialize();

    const runTimeline = await projectRunTimeline(store, "run-a");
    const taskBoard = await projectTaskBoard(store, { runId: "run-a" });
    const approvalInbox = await projectApprovalInbox(store, { runId: "run-a" });
    const artifactFeed = await projectArtifactFeed(store, { runId: "run-a" });

    expect(runTimeline.map((item) => item.nodeId)).toContain(seed.turnNode.id);
    expect(taskBoard.map((item) => item.taskId)).toEqual([
      seed.taskNodeA.id,
      seed.taskNodeB.id,
    ]);
    expect(approvalInbox.map((item) => item.approvalId)).toEqual([
      seed.approvalNodeA.id,
      seed.approvalNodeB.id,
    ]);
    expect(artifactFeed.map((item) => item.artifactId)).toEqual([
      seed.artifactNodeB.id,
      seed.artifactNodeA.id,
    ]);
  });

  it("validates graph scopes, nodes, edges, and projections fail closed on malformed records", () => {
    const scope: HarnessGraphScope = { kind: "project", projectId: "capstan" };
    const scopeRecord: HarnessGraphScopeRecord = {
      id: "scope-1",
      scope,
      title: "Project: capstan",
      createdAt: now(0),
      updatedAt: now(1),
    };
    const scopeSummary: HarnessGraphScopeSummary = {
      ...scopeRecord,
      nodeCount: 1,
      edgeCount: 1,
      recentNodeIds: ["node-1"],
      recentEdgeIds: ["edge-1"],
    };
    const node: HarnessGraphNodeRecord = {
      id: "node-1",
      kind: "task",
      scope,
      title: "Task: deploy",
      createdAt: now(0),
      updatedAt: now(1),
    };
    const edge: HarnessGraphEdgeRecord = {
      id: "edge-1",
      kind: "contains",
      scope,
      from: "run-1",
      to: "node-1",
      createdAt: now(0),
      updatedAt: now(1),
    };
    const searchResult: HarnessGraphSearchResult = {
      ...node,
      score: 0.5,
      matchedFields: ["title"],
      reasons: ["contains query token"],
    };
    const bindingResult = {
      scope: scopeRecord,
      nodes: [node],
      edges: [edge],
    };

    expect(() => assertValidGraphScope(scope)).not.toThrow();
    expect(() => assertValidGraphScopeRecord(scopeRecord)).not.toThrow();
    expect(() => assertValidGraphScopeSummary(scopeSummary)).not.toThrow();
    expect(() => assertValidGraphNodeRecord(node)).not.toThrow();
    expect(() => assertValidGraphEdgeRecord(edge)).not.toThrow();
    expect(() => assertValidGraphSearchResult(searchResult)).not.toThrow();
    expect(() => assertValidGraphBindingResult(bindingResult)).not.toThrow();

    expect(() =>
      assertValidGraphScope({ kind: "project", projectId: "" }),
    ).toThrow(/projectId/);
    expect(() =>
      assertValidGraphNodeRecord({ ...node, kind: "unknown" }),
    ).toThrow(/unsupported kind/);
    expect(() =>
      assertValidGraphEdgeRecord({ ...edge, kind: "unknown" }),
    ).toThrow(/unsupported kind/);
    expect(() =>
      assertValidGraphScopeSummary({ ...scopeSummary, nodeCount: -1 }),
    ).toThrow(/nodeCount/);
    expect(() =>
      assertValidGraphSearchResult({ ...searchResult, score: Number.NaN }),
    ).toThrow(/score/);
  });

  it("covers graph utility normalization, matching, scoring, and path encoding behavior", () => {
    const scopeA = createProjectGraphScope("capstan");
    const scopeB = createRunGraphScope("run-a");
    const normalized = normalizeGraphScope({ kind: "project", projectId: "  capstan  " });
    const merged = mergeGraphScopes([scopeA, scopeB], [scopeB]);
    const graphKey = graphScopeKey(scopeA);
    const graphTitle = formatHarnessGraphScopeTitle(scopeB);
    const graphFormattedKey = formatHarnessGraphScopeKey(scopeA);
    const graphScopesMatch = graphScopesIntersect([scopeA, scopeB], [scopeB]);
    const scopeEquality = scopesEqual(scopeA, normalized);
    const encoded = encodeGraphPathSegment("turn/1:weird");

    expect(normalized).toEqual(scopeA);
    expect(merged).toEqual([scopeA, scopeB]);
    expect(graphKey).toBe(graphFormattedKey);
    expect(graphTitle).toBe("Run: run-a");
    expect(graphScopesMatch).toBe(true);
    expect(scopeEquality).toBe(true);
    expect(encoded).toBe("turn_1_weird");

    const node: HarnessGraphNodeRecord = {
      id: "node-1",
      kind: "task",
      scope: scopeB,
      runId: "run-a",
      title: "Task: deploy the app",
      createdAt: now(0),
      updatedAt: now(1),
      status: "running",
      summary: "deploy the app",
      content: "deploy the app now",
      metadata: {
        kind: "task",
        description: "deploy the app",
      },
    };
    const edge: HarnessGraphEdgeRecord = {
      id: "edge-1",
      kind: "contains",
      scope: scopeB,
      from: "run-a",
      to: "node-1",
      runId: "run-a",
      createdAt: now(0),
      updatedAt: now(1),
    };

    expect(graphNodeSearchText(node)).toContain("deploy");
    expect(scoreGraphNode(node, "deploy app")).toBeGreaterThan(0.3);
    expect(graphNodeMatchesQuery(node, { kinds: ["task"], runId: "run-a" })).toBe(true);
    expect(graphEdgeMatchesQuery(edge, { kinds: ["contains"], runId: "run-a" })).toBe(true);
    expect(sortGraphNodes([node]).map((entry) => entry.id)).toEqual(["node-1"]);
    expect(sortGraphEdges([edge]).map((entry) => entry.id)).toEqual(["edge-1"]);
    expect(compareTimestampDescendingThenId({ id: "a", updatedAt: now(1) }, { id: "b", updatedAt: now(2) })).toBeGreaterThan(0);
    expect(extractGraphSearchText({ nested: { a: 1, b: true } })).toContain("nested");
    expect(stripUndefinedGraphValue({ a: 1, b: undefined, c: [1, undefined, 2] })).toEqual({ a: 1, c: [1, 2] });
    expect(memoryScopeToGraphScope({ type: "project", id: "capstan" })).toEqual(scopeA);
    expect(memoryScopeToGraphScope({ type: "run", id: "run-a" })).toEqual(scopeB);
  });
});

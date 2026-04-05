import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  FileHarnessRuntimeStore,
  createHarness,
  openHarnessRuntime,
} from "@zauso-ai/capstan-ai";
import type {
  AgentLoopCheckpoint,
  HarnessAccessContext,
  HarnessApprovalRecord,
  HarnessArtifactInput,
  HarnessGraphEdgeRecord,
  HarnessGraphNodeRecord,
  HarnessGraphScope,
  HarnessMemoryInput,
  HarnessRunRecord,
  HarnessRunStartOptions,
  HarnessRuntimeConfig,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
  HarnessTaskRecord,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "@zauso-ai/capstan-ai";
import {
  assertValidGraphBindingResult,
  assertValidGraphEdgeRecord,
  assertValidGraphNodeRecord,
  assertValidGraphScope,
  assertValidGraphScopeRecord,
  assertValidGraphScopeSummary,
  collectGraphContextNodes,
  createProjectGraphScope,
  createRunGraphScope,
  encodeGraphPathSegment,
  formatHarnessGraphScopeKey,
  formatHarnessGraphScopeTitle,
  graphEdgeMatchesQuery,
  graphNodeMatchesQuery,
  graphNodeSearchText,
  graphScopeKey,
  graphScopesIntersect,
  listGraphNeighbors,
  memoryScopeToGraphScope,
  mergeGraphScopes,
  normalizeGraphScope,
  normalizeGraphScopes,
  projectHarnessMemoryFeed,
  projectRunTimeline,
  projectTaskBoard,
  projectApprovalInbox,
  projectArtifactFeed,
  queryHarnessGraph,
  scoreGraphNode,
  selectGraphNodesForContext,
  sortGraphEdges,
  sortGraphNodes,
  scopesEqual,
  stripUndefinedGraphValue,
} from "../../packages/ai/src/harness/graph/index.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function mockLLM(responses: string[]): LLMProvider {
  let index = 0;
  return {
    name: "mock-graph-runtime-sync",
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

function iso(offsetMinutes = 0): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

function buildRunRecord(
  runId: string,
  overrides: Partial<HarnessRunRecord> = {},
): HarnessRunRecord {
  const now = iso();
  return {
    id: runId,
    goal: `sync graph lifecycle for ${runId}`,
    status: "running",
    createdAt: now,
    updatedAt: now,
    iterations: 0,
    toolCalls: 0,
    taskCalls: 0,
    maxIterations: 12,
    toolNames: ["lookup", "annotate"],
    taskNames: ["assemble-report"],
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: true,
      artifactDir: `/artifacts/${runId}`,
    },
    lastEventSequence: 0,
    ...overrides,
  };
}

function buildCheckpoint(
  runId: string,
  overrides: Partial<AgentLoopCheckpoint> = {},
): AgentLoopCheckpoint {
  return {
    stage: "assistant_response",
    config: {
      goal: `sync graph lifecycle for ${runId}`,
      maxIterations: 12,
    },
    messages: [
      { role: "system", content: "You are a meticulous runtime inspector." },
      { role: "user", content: `Inspect ${runId} and summarize graph writes.` },
    ],
    iterations: 1,
    toolCalls: [],
    ...overrides,
  };
}

function buildTask(
  runId: string,
  taskId: string,
  overrides: Partial<HarnessTaskRecord> = {},
): HarnessTaskRecord {
  return {
    id: taskId,
    runId,
    requestId: `${taskId}-request`,
    name: taskId,
    kind: "workflow",
    order: 0,
    status: "running",
    createdAt: iso(1),
    updatedAt: iso(2),
    args: { step: taskId, runId },
    hardFailure: false,
    ...overrides,
  };
}

function buildApproval(
  runId: string,
  approvalId: string,
  overrides: Partial<HarnessApprovalRecord> = {},
): HarnessApprovalRecord {
  return {
    id: approvalId,
    runId,
    kind: "task",
    tool: "assemble-report",
    args: { runId, approvalId },
    reason: `approval required for ${approvalId}`,
    requestedAt: iso(3),
    updatedAt: iso(4),
    status: "pending",
    ...overrides,
  } as HarnessApprovalRecord;
}

function buildSessionMemory(
  runId: string,
  overrides: Partial<HarnessSessionMemoryRecord> = {},
): HarnessSessionMemoryRecord {
  return {
    runId,
    goal: `sync graph lifecycle for ${runId}`,
    status: "running",
    updatedAt: iso(5),
    sourceRunUpdatedAt: iso(4),
    headline: `Session headline for ${runId}`,
    currentPhase: "reasoning",
    lastAssistantResponse: "working through graph synchronization",
    recentSteps: [
      "write run node",
      "write turn node",
      "write task node",
      "write approval node",
    ],
    blockers: ["approval"],
    openQuestions: ["did every node get persisted?"],
    pendingApproval: {
      tool: "assemble-report",
      reason: "approval required for assemble-report",
    },
    artifactRefs: [],
    compactedMessages: 2,
    tokenEstimate: 48,
    ...overrides,
  };
}

function buildSummary(
  runId: string,
  overrides: Partial<HarnessSummaryRecord> = {},
): HarnessSummaryRecord {
  return {
    id: `summary-${runId}`,
    runId,
    createdAt: iso(6),
    updatedAt: iso(7),
    sourceRunUpdatedAt: iso(7),
    kind: "run_compact",
    status: "completed",
    headline: `Summary for ${runId}`,
    completedSteps: ["persisted graph records", "reopened runtime"],
    blockers: ["approval"],
    openQuestions: ["was graphScopes propagated?"],
    artifactRefs: [],
    iterations: 1,
    toolCalls: 1,
    messageCount: 5,
    compactedMessages: 1,
    ...overrides,
  };
}

function buildMemoryInput(
  runId: string,
  overrides: Partial<HarnessMemoryInput> = {},
): HarnessMemoryInput {
  return {
    scope: { type: "run", id: runId },
    kind: "fact",
    content: `Graph memory for ${runId}`,
    runId,
    graphScopes: [
      { kind: "run", runId },
      { kind: "project", projectId: "capstan" },
    ],
    ...overrides,
  };
}

function buildArtifactInput(
  kind: string,
  content: string,
  overrides: Partial<HarnessArtifactInput> = {},
): HarnessArtifactInput {
  return {
    kind,
    content,
    extension: ".md",
    mimeType: "text/markdown",
    ...overrides,
  };
}

function buildGraphScopeBundle(runId: string): HarnessGraphScope[] {
  return normalizeGraphScopes([
    { kind: "run", runId },
    { kind: "project", projectId: "capstan" },
    { kind: "app", appId: "capstan-ai" },
    { kind: "resource", resourceType: "repo", resourceId: "capstan" },
    { kind: "capability", capabilityId: "harness" },
    { kind: "policy", policyId: "agent-runtime" },
    { kind: "entity", entityType: "run", entityId: runId },
    { kind: "run", runId },
  ]);
}

async function createHarnessFixture(options?: {
  graphScopes?: HarnessGraphScope[];
  authorize?: HarnessRuntimeConfig["authorize"];
  beforeTaskCall?: HarnessRuntimeConfig["beforeTaskCall"];
}) {
  const rootDir = await createTempDir("capstan-harness-graph-runtime-sync-");
  const store = new FileHarnessRuntimeStore(rootDir);
  await store.initialize();

  const harness = await createHarness({
    llm: mockLLM([
      JSON.stringify({
        tools: [
          { tool: "lookup", arguments: { page: 1 } },
          { tool: "annotate", arguments: { note: "graph" } },
        ],
      }),
      "graph run completed",
    ]),
    verify: { enabled: false },
    sandbox: {
      browser: false,
      fs: true,
    },
    context: {
      maxPromptTokens: 3200,
      reserveOutputTokens: 0,
      maxRecentMessages: 4,
      maxRecentToolResults: 2,
      microcompactToolResultChars: 64,
      sessionCompactThreshold: 0.2,
      autoPromoteObservations: true,
      autoPromoteSummaries: true,
    },
    runtime: {
      rootDir,
      authorize: options?.authorize,
      beforeTaskCall: options?.beforeTaskCall,
    },
  });

  return { rootDir, store, harness, runtime: await openHarnessRuntime(rootDir, { authorize: options?.authorize }) };
}

async function seedRuntimeGraphStore(params: {
  store: FileHarnessRuntimeStore;
  runId: string;
  graphScopes?: HarnessGraphScope[];
}) {
  const run = buildRunRecord(params.runId, {
    graphScopes: params.graphScopes ?? buildGraphScopeBundle(params.runId),
  });
  await params.store.persistRun(run);

  const firstTurn = buildCheckpoint(params.runId, {
    stage: "assistant_response",
    iterations: 1,
    orchestration: {
      phase: "sampling_model",
      transitionReason: "next_turn",
      turnCount: 1,
      recovery: {
        reactiveCompactRetries: 0,
        tokenContinuations: 0,
        toolRecoveryCount: 0,
      },
      pendingToolRequests: [{ id: "tool-1", name: "lookup", args: { page: 1 }, order: 0 }],
      pendingTaskRequests: [{ id: "task-request-1", name: "assemble-report", args: { page: 1 }, order: 0 }],
      waitingTaskIds: [],
      lastModelFinishReason: "tool_use",
      continuationPrompt: "continue",
      assistantMessagePersisted: true,
    },
    pendingToolCall: {
      assistantMessage: "{\"tools\":[{\"tool\":\"lookup\",\"arguments\":{\"page\":1}}]}",
      tool: "lookup",
      args: { page: 1 },
    },
    toolCalls: [{ tool: "lookup", args: { page: 1 }, result: { ok: true, page: 1 } }],
    taskCalls: [{ task: "assemble-report", args: { page: 1 }, result: { status: "queued" } }],
    lastAssistantResponse: "continue",
  });
  const secondTurn = buildCheckpoint(params.runId, {
    stage: "tool_result",
    iterations: 2,
    orchestration: {
      phase: "deciding_continuation",
      transitionReason: "next_turn",
      turnCount: 2,
      recovery: {
        reactiveCompactRetries: 1,
        tokenContinuations: 0,
        toolRecoveryCount: 0,
      },
      pendingToolRequests: [],
      pendingTaskRequests: [],
      waitingTaskIds: ["task-1"],
      lastModelFinishReason: "stop",
      continuationPrompt: "wrap up",
      assistantMessagePersisted: true,
    },
    toolCalls: [
      { tool: "lookup", args: { page: 1 }, result: { ok: true, page: 1 } },
      { tool: "annotate", args: { note: "graph" }, result: { ok: true, note: "graph" } },
    ],
    taskCalls: [
      { task: "assemble-report", args: { page: 1 }, result: { status: "running" } },
    ],
    pendingToolCall: {
      assistantMessage: "wrap up",
      tool: "annotate",
      args: { note: "graph" },
    },
    lastAssistantResponse: "wrap up",
  });

  await params.store.persistCheckpoint(params.runId, firstTurn);
  await params.store.persistCheckpoint(params.runId, secondTurn);

  const task = buildTask(params.runId, "task-1", {
    status: "completed",
    updatedAt: iso(8),
    result: { ok: true, notes: ["graph", "sync"] },
  });
  await params.store.persistTask(task);

  const approval = buildApproval(params.runId, "approval-1", {
    status: "approved",
    resolutionNote: "approved for runtime graph sync",
    resolvedAt: iso(8),
    resolvedBy: { actor: "tester" },
    updatedAt: iso(8),
  });
  await params.store.persistApproval(approval);

  const sessionMemory = buildSessionMemory(params.runId, {
    status: "completed",
    updatedAt: iso(9),
    sourceRunUpdatedAt: iso(8),
  });
  await params.store.persistSessionMemory(sessionMemory);

  const summary = buildSummary(params.runId, {
    status: "completed",
    updatedAt: iso(10),
    sourceRunUpdatedAt: iso(10),
  });
  await params.store.persistSummary(summary);

  const memory = await params.store.rememberMemory(
    buildMemoryInput(params.runId, {
      content: `Graph memory for ${params.runId} and runtime sync`,
    }),
  );

  const artifact = await params.store.writeArtifact(params.runId, buildArtifactInput(
    "report",
    `artifact for ${params.runId}`,
    {
      extension: ".md",
      filename: `report-${params.runId}.md`,
      metadata: {
        phase: "final",
      },
    },
  ));
  const currentRun = await params.store.requireRun(params.runId);
  await params.store.transitionRun(
    params.runId,
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

  await params.store.transitionRun(
    params.runId,
    "run_completed",
    {
      status: "completed",
      result: {
        ok: true,
        artifactId: artifact.id,
      },
    },
    {
      status: "completed",
      artifactId: artifact.id,
    },
  );

  return {
    run,
    firstTurn,
    secondTurn,
    task,
    approval,
    sessionMemory,
    summary,
    memory,
    artifact,
  };
}

describe("harness graph runtime sync", () => {
  it("syncs a live harness run into run, turn, task, approval, artifact, memory, session-memory, and summary graph records", async () => {
    const { harness, store, runtime, rootDir } = await createHarnessFixture({
      graphScopes: buildGraphScopeBundle("run-live"),
      beforeTaskCall: async ({ task }) => ({
        allowed: task !== "assemble-report",
        ...(task !== "assemble-report"
          ? {}
          : { reason: "assemble-report requires explicit approval" }),
      }),
    });

    const result = await harness.run(
      {
        goal: "synchronize the runtime graph",
        tools: [
          {
            name: "lookup",
            description: "lookup graph state",
            async execute(args) {
              return {
                page: args.page,
                body: `lookup:${args.page}`,
              };
            },
          },
          {
            name: "annotate",
            description: "annotate the graph",
            async execute(args) {
              return {
                note: args.note,
                accepted: true,
              };
            },
          },
        ],
        tasks: [
          {
            name: "assemble-report",
            description: "assemble a final report",
            kind: "workflow",
            async execute(args, context) {
              return {
                runId: context.runId,
                requestId: context.requestId,
                taskId: context.taskId,
                arg: args.page,
                stackDepth: context.callStack?.size ?? 0,
              };
            },
          },
        ],
      },
      {
        graphScopes: buildGraphScopeBundle("run-live"),
      } satisfies HarnessRunStartOptions,
    );

    expect(result.status).toBe("completed");

    const controlRuntime = await openHarnessRuntime(rootDir);
    const run = await controlRuntime.getRun(result.runId);
    expect(run).toBeDefined();
    expect(run?.graphScopes).toEqual(buildGraphScopeBundle("run-live"));
    expect(run?.toolNames).toEqual(
      expect.arrayContaining(["lookup", "annotate"]),
    );
    expect(run?.taskNames).toEqual(["assemble-report"]);
    expect(run?.pendingApprovalId).toBeUndefined();

    const checkpoint = await controlRuntime.getCheckpoint(result.runId);
    expect(checkpoint).toBeDefined();
    expect(
      [
        "approval_blocked",
        "executing_tools",
        "deciding_continuation",
        "completed",
        "sampling_model",
        "running_sidecars",
      ].includes(checkpoint?.orchestration?.phase ?? ""),
    ).toBe(true);

    const completeRun = await harness.getRun(result.runId);
    expect(completeRun?.status).toBe("completed");
    expect(completeRun?.artifactIds.length).toBe(0);
    expect(completeRun?.toolCalls).toBeGreaterThanOrEqual(1);
    expect(completeRun?.taskCalls).toBe(0);

    const taskRecord = await store.persistTask(
      buildTask(result.runId, "task-graph", {
        status: "completed",
        updatedAt: iso(8),
        result: { ok: true, notes: ["graph", "sync"] },
      }),
    );
    expect(taskRecord).toBeUndefined();

    const approvalRecord = buildApproval(result.runId, "approval-graph", {
      status: "approved",
      resolutionNote: "approved for runtime graph sync",
      resolvedAt: iso(8),
      resolvedBy: { actor: "tester" },
      updatedAt: iso(8),
      tool: "assemble-report",
    });
    await store.persistApproval(approvalRecord);

    await store.persistSessionMemory(
      buildSessionMemory(result.runId, {
        status: "completed",
        updatedAt: iso(9),
        sourceRunUpdatedAt: iso(8),
      }),
    );

    await store.persistSummary(
      buildSummary(result.runId, {
        status: "completed",
        updatedAt: iso(10),
        sourceRunUpdatedAt: iso(10),
      }),
    );

    await store.rememberMemory(
      buildMemoryInput(result.runId, {
        content: `Graph memory for ${result.runId} and runtime sync`,
      }),
    );

    const artifact = await store.writeArtifact(
      result.runId,
      buildArtifactInput("report", `artifact for ${result.runId}`, {
        extension: ".md",
        filename: `report-${result.runId}.md`,
        metadata: {
          phase: "final",
        },
      }),
    );
    const currentRun = await store.requireRun(result.runId);
    await store.transitionRun(
      result.runId,
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

    await harness.rememberMemory({
      scope: { type: "run", id: result.runId },
      kind: "summary",
      content: `Graph memory for ${result.runId}`,
      runId: result.runId,
      graphScopes: buildGraphScopeBundle("run-live"),
    });

    const liveGraphMemory = await harness.recallMemory({
      query: result.runId,
      runId: result.runId,
      scopes: [{ type: "run", id: result.runId }],
      kinds: ["summary"],
      limit: 10,
    });
    expect(liveGraphMemory).toHaveLength(1);
    expect(liveGraphMemory[0]).toMatchObject({
      runId: result.runId,
      kind: "summary",
    });

    const sessionMemory = await harness.getSessionMemory(result.runId);
    expect(sessionMemory).toMatchObject({
      runId: result.runId,
      status: "completed",
      currentPhase: expect.any(String),
    });

    const summary = await harness.getLatestSummary(result.runId);
    expect(summary).toMatchObject({
      runId: result.runId,
      kind: "run_compact",
      status: "completed",
    });

    const taskRecords = await harness.getTasks(result.runId);
    expect(taskRecords).toHaveLength(1);
    expect(taskRecords[0]).toMatchObject({
      runId: result.runId,
      kind: "workflow",
      status: "completed",
    });

    const events = await harness.getEvents(result.runId);
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes.includes("run_started")).toBe(true);
    expect(eventTypes.includes("tool_call")).toBe(true);
    expect(eventTypes.includes("tool_result")).toBe(true);
    expect(eventTypes.includes("memory_stored")).toBe(true);
    expect(eventTypes.includes("run_completed")).toBe(true);
    expect(eventTypes.includes("artifact_created")).toBe(true);

    const runNode = await harness.getGraphNode(`run:${result.runId}`);
    expect(runNode).toMatchObject({
      id: `run:${result.runId}`,
      kind: "run",
      runId: result.runId,
      scope: { kind: "run", runId: result.runId },
    });
    expect(runNode?.metadata?.graphScopes).toEqual(buildGraphScopeBundle("run-live"));

    const turnNodes = await harness.listGraphNodes({
      runId: result.runId,
      kinds: ["turn"],
    });
    expect(turnNodes.length).toBeGreaterThanOrEqual(1);
    expect(turnNodes.every((node) => node.runId === result.runId)).toBe(true);
    expect(turnNodes.some((node) => node.metadata?.assistantMessagePersisted === true)).toBe(true);

    const taskNodes = await harness.listGraphNodes({
      runId: result.runId,
      kinds: ["task"],
    });
    expect(taskNodes).toHaveLength(1);
    expect(taskNodes[0]).toMatchObject({
      kind: "task",
      runId: result.runId,
      status: "completed",
    });

    const approvalNodes = await harness.listGraphNodes({
      runId: result.runId,
      kinds: ["approval"],
    });
    expect(approvalNodes).toHaveLength(1);
    expect(approvalNodes[0]).toMatchObject({
      kind: "approval",
      runId: result.runId,
      status: "approved",
    });

    const memoryNodes = await harness.listGraphNodes({
      runId: result.runId,
      kinds: ["memory"],
    });
    expect(memoryNodes.length).toBeGreaterThanOrEqual(3);
    expect(memoryNodes.map((node) => node.metadata?.memoryKind)).toEqual(
      expect.arrayContaining(["session_memory", "summary", "memory"]),
    );

    const artifactNodes = await harness.listGraphNodes({
      runId: result.runId,
      kinds: ["artifact"],
    });
    expect(artifactNodes.length).toBeGreaterThanOrEqual(1);
    expect(artifactNodes[0]).toMatchObject({
      kind: "artifact",
      runId: result.runId,
    });

    const edges = await harness.listGraphEdges({
      runId: result.runId,
    });
    expect(edges.some((edge) => edge.kind === "contains" && edge.from === `run:${result.runId}`)).toBe(true);
    expect(edges.some((edge) => edge.to.startsWith(`turn:${result.runId}`))).toBe(true);
    expect(edges.some((edge) => edge.to.startsWith(`task:${result.runId}`))).toBe(true);
    expect(edges.some((edge) => edge.to.startsWith(`approval:${result.runId}`))).toBe(true);
    expect(edges.some((edge) => edge.to.startsWith(`artifact:${result.runId}`))).toBe(true);
    expect(edges.some((edge) => edge.to.startsWith(`memory:`))).toBe(true);

    const timeline = await harness.getRunTimeline(result.runId);
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline[0]?.kind).toBe("run");
    expect(timeline.some((entry) => entry.kind === "turn")).toBe(true);
    expect(timeline.some((entry) => entry.kind === "task")).toBe(true);

    const taskBoard = await harness.getTaskBoard({ kind: "run", runId: result.runId });
    expect(taskBoard.some((entry) => entry.status === "completed")).toBe(true);
    expect(taskBoard.every((entry) => entry.scope.kind === "run")).toBe(true);

    const approvalInbox = await harness.getApprovalInbox({ kind: "run", runId: result.runId });
    expect(approvalInbox.length).toBeGreaterThanOrEqual(1);
    expect(approvalInbox.some((entry) => entry.status === "approved")).toBe(true);

    const artifactFeed = await harness.getArtifactFeed({ kind: "run", runId: result.runId });
    expect(artifactFeed.length).toBeGreaterThanOrEqual(1);
    expect(artifactFeed.every((entry) => entry.scope.kind === "run")).toBe(true);

    const context = await harness.assembleContext(result.runId, {
      query: "graph sync approval summary",
      maxTokens: 900,
      maxArtifacts: 4,
      graphScopes: buildGraphScopeBundle("run-live"),
      graphKinds: ["run", "turn", "task", "approval", "artifact", "memory"],
    });
    expect(context.graphNodes.length).toBeGreaterThan(0);
    expect(context.graphNodes.some((node) => node.kind === "artifact")).toBe(true);
    expect(context.graphNodes.some((node) => node.kind === "memory")).toBe(true);
    expect(context.artifactRefs.length).toBeGreaterThanOrEqual(1);

    const replay = await harness.replayRun(result.runId);
    expect(replay.consistent).toBe(true);
    expect(replay.derivedStatus).toBe("completed");
    expect(replay.storedStatus).toBe("completed");
    expect(replay.storedIterations).toBeGreaterThanOrEqual(1);

    expect(runtime).toBeDefined();
    const reopened = await openHarnessRuntime(rootDir);
    expect(await reopened.getRun(result.runId)).toMatchObject({
      id: result.runId,
      status: "completed",
    });
    expect(await reopened.getGraphNode(`run:${result.runId}`)).toMatchObject({
      id: `run:${result.runId}`,
      kind: "run",
    });
    expect(await reopened.getRunTimeline(result.runId)).toEqual(timeline);
  });

  it("syncs graph state through raw runtime store writes and preserves read-after-reopen consistency", async () => {
    const { store, rootDir } = await createHarnessFixture();
    const runId = "run-reopen";
    const bundle = await seedRuntimeGraphStore({
      store,
      runId,
      graphScopes: buildGraphScopeBundle(runId),
    });

    const reopened = await openHarnessRuntime(rootDir);
    const run = await reopened.getRun(runId);
    expect(run).toMatchObject({
      id: runId,
      status: "completed",
      artifactIds: [bundle.artifact.id],
    });

    const checkpoint = await reopened.getCheckpoint(runId);
    expect(checkpoint).toMatchObject({
      stage: "tool_result",
      iterations: 2,
      orchestration: expect.objectContaining({
        turnCount: 2,
        transitionReason: "next_turn",
      }),
    });

    const sessionMemory = await reopened.getSessionMemory(runId);
    expect(sessionMemory).toMatchObject({
      runId,
      status: "completed",
      currentPhase: "reasoning",
    });

    const summary = await reopened.getLatestSummary(runId);
    expect(summary).toMatchObject({
      runId,
      kind: "run_compact",
      status: "completed",
    });

    const tasks = await reopened.getTasks(runId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "task-1",
      status: "completed",
      result: { ok: true, notes: ["graph", "sync"] },
    });

    const approvals = await reopened.listApprovals(runId);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      id: "approval-1",
      status: "approved",
      resolvedBy: { actor: "tester" },
    });

    const graphRun = await reopened.getGraphNode(`run:${runId}`);
    expect(graphRun).toMatchObject({
      kind: "run",
      runId,
      metadata: expect.objectContaining({
        graphScopes: buildGraphScopeBundle(runId),
      }),
    });

    const turnNodes = await reopened.listGraphNodes({
      runId,
      kinds: ["turn"],
    });
    expect(turnNodes).toHaveLength(2);
    expect(turnNodes[0]!.updatedAt >= turnNodes[1]!.updatedAt).toBe(true);
    expect(turnNodes.map((node) => node.metadata?.transitionReason)).toEqual([
      "next_turn",
      "next_turn",
    ]);

    const taskNodes = await reopened.listGraphNodes({
      runId,
      kinds: ["task"],
    });
    expect(taskNodes).toHaveLength(1);
    expect(taskNodes[0]?.sourceId).toBe("task-1-request");

    const approvalNodes = await reopened.listGraphNodes({
      runId,
      kinds: ["approval"],
    });
    expect(approvalNodes).toHaveLength(1);
    expect(approvalNodes[0]?.content).toContain("approved");

    const memoryNodes = await reopened.listGraphNodes({
      runId,
      kinds: ["memory"],
    });
    expect(memoryNodes.length).toBeGreaterThanOrEqual(3);
    expect(memoryNodes.some((node) => node.metadata?.memoryKind === "session_memory")).toBe(true);
    expect(memoryNodes.some((node) => node.metadata?.memoryKind === "summary")).toBe(true);
    expect(memoryNodes.some((node) => node.metadata?.memoryKind === "memory")).toBe(true);

    const edges = await reopened.listGraphEdges({
      runId,
    });
    expect(edges.filter((edge) => edge.kind === "contains")).toHaveLength(edges.length);
    expect(edges.map((edge) => edge.to)).toEqual(
      expect.arrayContaining([
        `turn:${runId}:1:assistant_response`,
        `turn:${runId}:2:tool_result`,
        `task:${runId}:task-1`,
        `approval:${runId}:approval-1`,
        `artifact:${runId}:${bundle.artifact.id}`,
      ]),
    );

    const replay = await reopened.replayRun(runId);
    expect(replay).toMatchObject({
      runId,
      consistent: true,
      derivedStatus: "completed",
      storedStatus: "completed",
      derivedArtifactCount: 1,
      storedArtifactCount: 1,
      derivedIterations: 0,
      storedIterations: 0,
      derivedTaskCalls: 0,
      storedTaskCalls: 0,
    });
  });

  it("keeps multiple turns for the same run isolated and ordered by their orchestration metadata", async () => {
    const { store } = await createHarnessFixture();
    const runId = "run-multi-turn";
    const run = buildRunRecord(runId, {
      graphScopes: buildGraphScopeBundle(runId),
    });
    await store.persistRun(run);

    const turns: AgentLoopCheckpoint[] = [
      buildCheckpoint(runId, {
        stage: "assistant_response",
        iterations: 1,
        orchestration: {
          phase: "sampling_model",
          transitionReason: "next_turn",
          turnCount: 1,
          recovery: {
            reactiveCompactRetries: 0,
            tokenContinuations: 0,
            toolRecoveryCount: 0,
          },
          pendingToolRequests: [{ id: "tool-a", name: "lookup", args: { page: 1 }, order: 0 }],
          pendingTaskRequests: [],
          waitingTaskIds: [],
          lastModelFinishReason: "tool_use",
          continuationPrompt: "continue",
          assistantMessagePersisted: true,
        },
        pendingToolCall: {
          assistantMessage: "tool use",
          tool: "lookup",
          args: { page: 1 },
        },
        toolCalls: [{ tool: "lookup", args: { page: 1 }, result: { ok: true } }],
      }),
      buildCheckpoint(runId, {
        stage: "tool_result",
        iterations: 2,
        orchestration: {
          phase: "deciding_continuation",
          transitionReason: "next_turn",
          turnCount: 2,
          recovery: {
            reactiveCompactRetries: 1,
            tokenContinuations: 0,
            toolRecoveryCount: 0,
          },
          pendingToolRequests: [],
          pendingTaskRequests: [],
          waitingTaskIds: [],
          lastModelFinishReason: "stop",
          continuationPrompt: "wrap",
          assistantMessagePersisted: true,
        },
        pendingToolCall: {
          assistantMessage: "wrap",
          tool: "annotate",
          args: { note: "done" },
        },
        toolCalls: [
          { tool: "lookup", args: { page: 1 }, result: { ok: true } },
          { tool: "annotate", args: { note: "done" }, result: { ok: true } },
        ],
      }),
      buildCheckpoint(runId, {
        stage: "completed",
        iterations: 3,
        orchestration: {
          phase: "completed",
          transitionReason: "final_response",
          turnCount: 3,
          recovery: {
            reactiveCompactRetries: 1,
            tokenContinuations: 0,
            toolRecoveryCount: 0,
          },
          pendingToolRequests: [],
          pendingTaskRequests: [],
          waitingTaskIds: [],
          lastModelFinishReason: "stop",
          continuationPrompt: "finish",
          assistantMessagePersisted: true,
        },
        toolCalls: [
          { tool: "lookup", args: { page: 1 }, result: { ok: true } },
          { tool: "annotate", args: { note: "done" }, result: { ok: true } },
          { tool: "annotate", args: { note: "final" }, result: { ok: true } },
        ],
      }),
    ];

    for (const checkpoint of turns) {
      await store.persistCheckpoint(runId, checkpoint);
    }

    const timeline = await projectRunTimeline(store, runId);
    expect(timeline.map((item) => item.nodeId)).toEqual([
      `run:${runId}`,
      `turn:${runId}:1:assistant_response`,
      `turn:${runId}:2:tool_result`,
      `turn:${runId}:3:completed`,
    ]);

    const turnsFromStore = await store.listGraphNodes({
      runId,
      kinds: ["turn"],
    });
    expect(turnsFromStore).toHaveLength(3);
    expect(turnsFromStore.map((node) => node.id)).toEqual([
      `turn:${runId}:3:completed`,
      `turn:${runId}:2:tool_result`,
      `turn:${runId}:1:assistant_response`,
    ]);
    expect(turnsFromStore[0]?.title).toBe(`Turn 3: completed`);
    expect(turnsFromStore[1]?.title).toBe(`Turn 2: deciding_continuation`);
    expect(turnsFromStore[2]?.title).toBe(`Turn 1: sampling_model`);
    expect(turnsFromStore[0]?.metadata?.transitionReason).toBe("final_response");
    expect(turnsFromStore[1]?.metadata?.transitionReason).toBe("next_turn");
    expect(turnsFromStore[2]?.metadata?.transitionReason).toBe("next_turn");

    const runEdges = await store.listGraphEdges({
      runId,
      kinds: ["contains"],
    });
    expect(runEdges.filter((edge) => edge.to.startsWith(`turn:${runId}`))).toHaveLength(3);
    expect(runEdges.map((edge) => edge.to)).toEqual(
      expect.arrayContaining([
        `turn:${runId}:1:assistant_response`,
        `turn:${runId}:2:tool_result`,
        `turn:${runId}:3:completed`,
      ]),
    );

    const contextNodes = await collectGraphContextNodes(store, {
      runId,
      text: "wrap final",
      kinds: ["turn"],
      limit: 3,
    });
    expect(contextNodes).toHaveLength(3);
    expect(contextNodes[0]?.id).toBe(`turn:${runId}:3:completed`);
  });

  it("propagates graphScopes through run, memory, and context assembly paths", async () => {
    const { harness, store } = await createHarnessFixture();
    const runId = "run-scopes";
    const scopes = buildGraphScopeBundle(runId);
    const run = buildRunRecord(runId, {
      graphScopes: scopes,
    });
    await store.persistRun(run);
    await store.persistCheckpoint(runId, buildCheckpoint(runId));
    await store.persistSessionMemory(buildSessionMemory(runId));
    await store.persistSummary(buildSummary(runId));
    await store.rememberMemory({
      ...buildMemoryInput(runId, {
        content: `Graph-scoped memory for ${runId}`,
        graphScopes: scopes,
      }),
    });

    const runNode = await harness.getGraphNode(`run:${runId}`);
    expect(runNode?.metadata?.graphScopes).toEqual(scopes);

    const sessionMemory = await harness.getSessionMemory(runId);
    expect(sessionMemory?.runId).toBe(runId);

    const memoryRecords = await harness.recallMemory({
      query: runId,
      scopes: [{ type: "run", id: runId }],
      kinds: ["fact"],
      runId,
      limit: 5,
    });
    expect(memoryRecords).toHaveLength(1);
    expect(memoryRecords[0]?.graphScopes).toEqual(scopes);
    expect(memoryRecords[0]?.metadata?.graphScopes).toBeUndefined();

    const projection = await harness.assembleContext(runId, {
      query: "graph scoped memory",
      graphScopes: scopes,
      graphKinds: ["run", "turn", "memory"],
      maxTokens: 700,
      maxArtifacts: 2,
    });
    expect(projection.graphNodes.some((node) => node.scope.kind === "run")).toBe(true);
    expect(projection.graphNodes.some((node) => node.metadata?.graphScopes)).toBe(true);
    expect(projection.blocks.some((block) => block.kind === "graph")).toBe(true);
    expect(projection.artifactRefs.length).toBe(0);
  });

  it("filters graph reads and projections through the authorization hook without mutating stored state", async () => {
    const allowSubject = { role: "observer", runId: "run-authorized" };
    const denySubject = { role: "guest", runId: "run-authorized" };
    const authorizationCalls: Array<{ action: string; nodeId?: string; edgeId?: string; runId?: string }> = [];
    const { harness, rootDir } = await createHarnessFixture({
      authorize: async (request) => {
        authorizationCalls.push({
          action: request.action,
          runId: request.runId,
          nodeId: request.detail?.nodeId as string | undefined,
          edgeId: request.detail?.edgeId as string | undefined,
        });
        const subject = request.access?.subject as { role?: string } | undefined;
        if (!subject || subject.role !== "observer") {
          return { allowed: false, reason: "observer access required" };
        }
        return { allowed: true };
      },
    });
    const reopened = await openHarnessRuntime(rootDir, {
      authorize: async (request) => {
        const subject = request.access?.subject as { role?: string } | undefined;
        if (!subject || subject.role !== "observer") {
          return { allowed: false, reason: "observer access required" };
        }
        return { allowed: true };
      },
    });
    const store = new FileHarnessRuntimeStore(rootDir);
    const runId = "run-authorized";
    await seedRuntimeGraphStore({
      store,
      runId,
      graphScopes: buildGraphScopeBundle(runId),
    });

    const allowedAccess: HarnessAccessContext = { subject: allowSubject };
    const deniedAccess: HarnessAccessContext = { subject: denySubject };

    await expect(harness.getRun(runId, deniedAccess)).rejects.toThrow(/observer access required/);
    await expect(harness.getGraphNode(`run:${runId}`, deniedAccess)).rejects.toThrow(
      /observer access required/,
    );
    await expect(harness.listGraphNodes({ runId }, deniedAccess)).rejects.toThrow(
      /observer access required/,
    );
    await expect(harness.listGraphEdges({ runId }, deniedAccess)).rejects.toThrow(
      /observer access required/,
    );
    await expect(harness.getRunTimeline(runId, deniedAccess)).rejects.toThrow(
      /observer access required/,
    );
    await expect(harness.getTaskBoard({ kind: "run", runId }, deniedAccess)).rejects.toThrow(
      /observer access required/,
    );
    await expect(harness.getApprovalInbox({ kind: "run", runId }, deniedAccess)).rejects.toThrow(
      /observer access required/,
    );
    await expect(harness.getArtifactFeed({ kind: "run", runId }, deniedAccess)).rejects.toThrow(
      /observer access required/,
    );

    const filteredRun = await reopened.getRun(runId, allowedAccess);
    expect(filteredRun).toBeDefined();

    const filteredNodes = await reopened.listGraphNodes({ runId }, allowedAccess);
    expect(filteredNodes.every((node) => node.runId === runId)).toBe(true);

    const filteredEdges = await reopened.listGraphEdges({ runId }, allowedAccess);
    expect(filteredEdges.every((edge) => edge.runId === runId)).toBe(true);

    const timeline = await reopened.getRunTimeline(runId, allowedAccess);
    expect(timeline[0]?.kind).toBe("run");

    const tasks = await reopened.getTaskBoard({ kind: "run", runId }, allowedAccess);
    expect(tasks.some((entry) => entry.status === "completed")).toBe(true);

    const approvals = await reopened.getApprovalInbox({ kind: "run", runId }, allowedAccess);
    expect(approvals.some((entry) => entry.status === "approved")).toBe(true);

    const artifacts = await reopened.getArtifactFeed({ kind: "run", runId }, allowedAccess);
    expect(artifacts.length).toBeGreaterThanOrEqual(1);

    expect(
      authorizationCalls.some((call) => call.action === "graph:read" || call.action === "graph:list"),
    ).toBe(true);
  });

  it("keeps control-plane graph reads aligned with the harness runtime after read-after-reopen", async () => {
    const { harness, store, rootDir } = await createHarnessFixture();
    const runId = "run-control-plane";
    await seedRuntimeGraphStore({
      store,
      runId,
      graphScopes: buildGraphScopeBundle(runId),
    });

    const reopened = await openHarnessRuntime(rootDir);
    const harnessRun = await harness.getRun(runId);
    const controlRun = await reopened.getRun(runId);
    expect(controlRun).toEqual(harnessRun);

    const harnessNodes = await harness.listGraphNodes({ runId });
    const controlNodes = await reopened.listGraphNodes({ runId });
    expect(controlNodes).toEqual(harnessNodes);

    const harnessEdges = await harness.listGraphEdges({ runId });
    const controlEdges = await reopened.listGraphEdges({ runId });
    expect(controlEdges).toEqual(harnessEdges);

    const harnessTimeline = await harness.getRunTimeline(runId);
    const controlTimeline = await reopened.getRunTimeline(runId);
    expect(controlTimeline).toEqual(harnessTimeline);

    const harnessBoard = await harness.getTaskBoard({ kind: "run", runId });
    const controlBoard = await reopened.getTaskBoard({ kind: "run", runId });
    expect(controlBoard).toEqual(harnessBoard);

    const harnessApprovals = await harness.getApprovalInbox({ kind: "run", runId });
    const controlApprovals = await reopened.getApprovalInbox({ kind: "run", runId });
    expect(controlApprovals).toEqual(harnessApprovals);

    const harnessArtifacts = await harness.getArtifactFeed({ kind: "run", runId });
    const controlArtifacts = await reopened.getArtifactFeed({ kind: "run", runId });
    expect(controlArtifacts).toEqual(harnessArtifacts);
  });

  it("synchronizes partial updates without dropping earlier graph nodes or edges", async () => {
    const { store } = await createHarnessFixture();
    const runId = "run-partial";
    const run = buildRunRecord(runId, {
      graphScopes: buildGraphScopeBundle(runId),
    });
    await store.persistRun(run);

    const firstArtifact = await store.writeArtifact(runId, buildArtifactInput("report", "first report", {
      filename: "first-report.md",
      metadata: { stage: "initial" },
    }));
    await store.patchRun(runId, {
      artifactIds: [firstArtifact.id],
      status: "running",
    });

    await store.persistCheckpoint(runId, buildCheckpoint(runId, {
      stage: "assistant_response",
      iterations: 1,
      orchestration: {
        phase: "sampling_model",
        transitionReason: "next_turn",
        turnCount: 1,
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
    }));

    await store.persistTask(buildTask(runId, "task-1", { status: "running" }));
    await store.persistApproval(buildApproval(runId, "approval-1", { status: "pending" }));
    await store.persistSessionMemory(buildSessionMemory(runId));
    await store.persistSummary(buildSummary(runId));
    await store.rememberMemory(buildMemoryInput(runId, { content: `partial ${runId}` }));

    const updated = await store.patchRun(runId, {
      status: "completed",
      result: { ok: true },
      artifactIds: [firstArtifact.id],
    });

    expect(updated.status).toBe("completed");
    expect(updated.artifactIds).toEqual([firstArtifact.id]);

    const runNode = await store.getGraphNode(`run:${runId}`);
    expect(runNode?.status).toBe("completed");
    expect(runNode?.metadata?.result).toEqual({ ok: true });

    const edges = await store.listGraphEdges({ runId });
    expect(edges.some((edge) => edge.to === `artifact:${runId}:${firstArtifact.id}`)).toBe(true);
    expect(edges.some((edge) => edge.to.startsWith(`turn:${runId}`))).toBe(true);
    expect(edges.some((edge) => edge.to.startsWith(`memory:`))).toBe(true);
    expect(edges.some((edge) => edge.to.startsWith(`approval:${runId}`))).toBe(true);

    const timeline = await projectRunTimeline(store, runId);
    expect(timeline.some((item) => item.kind === "artifact")).toBe(true);
    expect(timeline.some((item) => item.kind === "memory")).toBe(true);
    expect(timeline.some((item) => item.kind === "approval")).toBe(true);

    const feed = await projectArtifactFeed(store, { kind: "run", runId });
    expect(feed.some((item) => item.nodeId.endsWith(firstArtifact.id))).toBe(true);

    const board = await projectTaskBoard(store, { kind: "run", runId });
    expect(board.some((item) => item.taskId.endsWith("task-1"))).toBe(true);

    const approvals = await projectApprovalInbox(store, { kind: "run", runId });
    expect(approvals.some((item) => item.approvalId.endsWith("approval-1"))).toBe(true);

    const memoryFeed = await projectHarnessMemoryFeed(store, { kind: "run", runId });
    expect(memoryFeed.items.some((item) => item.kind === "summary")).toBe(true);
    expect(memoryFeed.items.some((item) => item.kind === "fact")).toBe(true);
  });

  it("selects graph context nodes deterministically across relatedTo, limit, scope, and kind filters", async () => {
    const { store } = await createHarnessFixture();
    const runId = "run-context";
    const bundle = await seedRuntimeGraphStore({
      store,
      runId,
      graphScopes: buildGraphScopeBundle(runId),
    });

    const allNodes = await store.listGraphNodes({ runId });
    const related = await collectGraphContextNodes(store, {
      runId,
      text: "graph sync approval summary",
      kinds: ["run", "turn", "task", "approval", "artifact", "memory"],
      limit: 5,
    });
    expect(related.length).toBeLessThanOrEqual(5);
    expect(related.some((node) => node.id === `run:${runId}`)).toBe(true);
    expect(related.some((node) => node.kind === "memory")).toBe(true);

    const directQuery = await collectGraphContextNodes(store, {
      text: "runtime sync graph",
      scopes: [{ kind: "run", runId }],
      kinds: ["memory", "artifact"],
      limit: 3,
      minScore: 0,
    });
    expect(directQuery.length).toBeLessThanOrEqual(3);
    expect(directQuery.every((node) => ["memory", "artifact"].includes(node.kind))).toBe(true);

    const narrowed = selectGraphNodesForContext(allNodes, {
      query: "approval approved runtime",
      limit: 2,
      kinds: ["approval", "memory", "task"],
    });
    expect(narrowed.length).toBeLessThanOrEqual(2);
    expect(narrowed.every((node) => ["approval", "memory", "task"].includes(node.kind))).toBe(true);

    const blankQuery = selectGraphNodesForContext(allNodes, {
      query: "   ",
      limit: 4,
      kinds: ["run", "turn", "task"],
    });
    expect(blankQuery.length).toBeLessThanOrEqual(4);
    expect(blankQuery.some((node) => node.kind === "run")).toBe(true);

    const relatedNodes = await queryHarnessGraph(store, {
      text: "graph sync",
      scopes: [{ kind: "run", runId }],
      relatedTo: `run:${runId}`,
      kinds: ["run", "turn", "task", "approval", "artifact", "memory"],
      limit: 10,
      minScore: 0,
    });
    expect(relatedNodes.length).toBeGreaterThan(0);
    expect(relatedNodes.some((node) => node.id === `run:${runId}`)).toBe(true);
    expect(relatedNodes.some((node) => node.kind === "memory")).toBe(true);
  });

  it("projects harness views consistently from raw graph state and the runtime facade", async () => {
    const { harness, store } = await createHarnessFixture();
    const runId = "run-projections";
    await seedRuntimeGraphStore({
      store,
      runId,
      graphScopes: buildGraphScopeBundle(runId),
    });

    const runTimeline = await projectRunTimeline(store, runId);
    const taskBoard = await projectTaskBoard(store, { kind: "run", runId });
    const approvalInbox = await projectApprovalInbox(store, { kind: "run", runId });
    const artifactFeed = await projectArtifactFeed(store, { kind: "run", runId });
    const memoryFeed = await projectHarnessMemoryFeed(store, { kind: "run", runId });

    expect(runTimeline[0]?.kind).toBe("run");
    expect(taskBoard.some((item) => item.status === "completed")).toBe(true);
    expect(approvalInbox.some((item) => item.status === "approved")).toBe(true);
    expect(artifactFeed.some((item) => item.kind === "report")).toBe(true);
    expect(memoryFeed.items.some((item) => item.kind === "summary")).toBe(true);

    expect(await harness.getRunTimeline(runId)).toEqual(runTimeline);
    expect(await harness.getTaskBoard({ kind: "run", runId })).toEqual(taskBoard);
    expect(await harness.getApprovalInbox({ kind: "run", runId })).toEqual(approvalInbox);
    expect(await harness.getArtifactFeed({ kind: "run", runId })).toEqual(artifactFeed);
  });

  it("validates graph scopes, records, and binding results across negative and positive matrices", () => {
    const validScope: HarnessGraphScope = { kind: "project", projectId: "capstan" };
    const validScopeRecord = {
      id: "project__capstan",
      scope: validScope,
      title: "Project: capstan",
      createdAt: iso(),
      updatedAt: iso(),
      metadata: { source: "test" },
    };
    const validNode: HarnessGraphNodeRecord = {
      id: "run:run-validation",
      kind: "run",
      scope: { kind: "run", runId: "run-validation" },
      title: "Run: validation",
      createdAt: iso(),
      updatedAt: iso(),
      status: "running",
      summary: "validation run",
      content: "validation content",
      metadata: { graphScopes: [{ kind: "project", projectId: "capstan" }] },
    };
    const validEdge: HarnessGraphEdgeRecord = {
      id: "edge:contains:run:run-validation->turn:run-validation:1:assistant_response:2026-04-04T00:00:00.000Z",
      kind: "contains",
      scope: { kind: "run", runId: "run-validation" },
      from: "run:run-validation",
      to: "turn:run-validation:1:assistant_response",
      createdAt: iso(),
      updatedAt: iso(),
      runId: "run-validation",
      metadata: { relation: "run_turn" },
    };

    expect(() => assertValidGraphScope(validScope)).not.toThrow();
    expect(() => assertValidGraphScopeRecord(validScopeRecord)).not.toThrow();
    expect(() => assertValidGraphNodeRecord(validNode)).not.toThrow();
    expect(() => assertValidGraphEdgeRecord(validEdge)).not.toThrow();
    expect(() => assertValidGraphBindingResult({
      scope: validScopeRecord,
      nodes: [validNode],
      edges: [validEdge],
    })).not.toThrow();

    const invalidScopes: unknown[] = [
      undefined,
      null,
      "run",
      {},
      { kind: "" },
      { kind: "run" },
      { kind: "project", projectId: "" },
      { kind: "resource", resourceType: "", resourceId: "x" },
      { kind: "entity", entityType: "run", entityId: "" },
      { kind: "capability", capabilityId: " " },
    ];
    for (const scope of invalidScopes) {
      expect(() => assertValidGraphScope(scope)).toThrow();
    }

    const invalidNodes: unknown[] = [
      undefined,
      null,
      {},
      { id: "", kind: "run", scope: validScope, title: "x", createdAt: iso(), updatedAt: iso() },
      { id: "x", kind: "bogus", scope: validScope, title: "x", createdAt: iso(), updatedAt: iso() },
      { id: "x", kind: "run", scope: {}, title: "x", createdAt: iso(), updatedAt: iso() },
      { id: "x", kind: "task", scope: validScope, title: "", createdAt: iso(), updatedAt: iso() },
      { id: "x", kind: "task", scope: validScope, title: "x", createdAt: iso(), updatedAt: iso(), order: -1 },
      { id: "x", kind: "memory", scope: validScope, title: "x", createdAt: iso(), updatedAt: iso(), relatedIds: [1] },
      { id: "x", kind: "approval", scope: validScope, title: "x", createdAt: iso(), updatedAt: iso(), metadata: [] },
    ];
    for (const node of invalidNodes) {
      expect(() => assertValidGraphNodeRecord(node)).toThrow();
    }

    const invalidEdges: unknown[] = [
      undefined,
      null,
      {},
      { id: "", kind: "contains", scope: validScope, from: "a", to: "b", createdAt: iso(), updatedAt: iso() },
      { id: "x", kind: "bogus", scope: validScope, from: "a", to: "b", createdAt: iso(), updatedAt: iso() },
      { id: "x", kind: "contains", scope: {}, from: "a", to: "b", createdAt: iso(), updatedAt: iso() },
      { id: "x", kind: "contains", scope: validScope, from: "", to: "b", createdAt: iso(), updatedAt: iso() },
      { id: "x", kind: "contains", scope: validScope, from: "a", to: "", createdAt: iso(), updatedAt: iso() },
      { id: "x", kind: "contains", scope: validScope, from: "a", to: "b", createdAt: iso(), updatedAt: iso(), metadata: [] },
    ];
    for (const edge of invalidEdges) {
      expect(() => assertValidGraphEdgeRecord(edge)).toThrow();
    }

    const invalidBindingResults: unknown[] = [
      undefined,
      null,
      {},
      { scope: validScopeRecord, nodes: {}, edges: [] },
      { scope: validScopeRecord, nodes: [], edges: {} },
      { scope: { ...validScopeRecord, title: "" }, nodes: [], edges: [] },
      { scope: validScopeRecord, nodes: [invalidNodes[2]], edges: [] },
      { scope: validScopeRecord, nodes: [], edges: [invalidEdges[2]] },
    ];
    for (const bindingResult of invalidBindingResults) {
      expect(() => assertValidGraphBindingResult(bindingResult)).toThrow();
    }
  });

  it("keeps graph utility helpers stable for scope encoding, normalization, matching, sorting, and search text", async () => {
    const projectScope = createProjectGraphScope("capstan");
    const runScope = createRunGraphScope("run-utils");
    const graphScopes = buildGraphScopeBundle("run-utils");

    expect(formatHarnessGraphScopeKey(projectScope)).toBe("project__capstan");
    expect(formatHarnessGraphScopeTitle(projectScope)).toBe("Project: capstan");
    expect(formatHarnessGraphScopeKey(runScope)).toBe("run__run-utils");
    expect(formatHarnessGraphScopeTitle(runScope)).toBe("Run: run-utils");
    expect(graphScopeKey(runScope)).toBe("run__run-utils");
    expect(scopesEqual(runScope, { kind: "run", runId: "run-utils" })).toBe(true);
    expect(graphScopesIntersect(graphScopes, [runScope])).toBe(true);
    expect(graphScopesIntersect(graphScopes, [{ kind: "app", appId: "different" }])).toBe(false);
    expect(normalizeGraphScopes([...graphScopes, runScope]).length).toBe(graphScopes.length);
    expect(mergeGraphScopes([projectScope], [runScope]).length).toBe(2);
    expect(normalizeGraphScope({ kind: "project", projectId: " capstan " })).toEqual(projectScope);
    expect(memoryScopeToGraphScope({ type: "project", id: "capstan" })).toEqual(projectScope);
    expect(memoryScopeToGraphScope({ type: "run", id: "run-utils" })).toEqual(runScope);
    expect(encodeGraphPathSegment("  turn:1/2?  ")).toBe("turn_1_2");
    expect(stripUndefinedGraphValue({
      id: "x",
      keep: "yes",
      nested: {
        keep: true,
        drop: undefined,
      },
      items: [1, undefined, { foo: undefined, bar: "ok" }],
    })).toEqual({
      id: "x",
      keep: "yes",
      nested: {
        keep: true,
      },
      items: [1, { bar: "ok" }],
    });

    const nodeA: HarnessGraphNodeRecord = {
      id: "node-a",
      kind: "turn",
      scope: runScope,
      title: "Turn A",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:01.000Z",
      summary: "alpha",
      content: "graph alpha",
      metadata: { a: 1 },
    };
    const nodeB: HarnessGraphNodeRecord = {
      id: "node-b",
      kind: "task",
      scope: runScope,
      title: "Task B",
      createdAt: "2026-04-04T00:00:01.000Z",
      updatedAt: "2026-04-04T00:00:02.000Z",
      summary: "beta",
      content: "graph beta",
      metadata: { b: 2 },
    };
    const nodeC: HarnessGraphNodeRecord = {
      id: "node-c",
      kind: "memory",
      scope: runScope,
      title: "Memory C",
      createdAt: "2026-04-04T00:00:02.000Z",
      updatedAt: "2026-04-04T00:00:03.000Z",
      summary: "gamma",
      content: "graph gamma",
      metadata: { c: 3 },
    };

    expect(graphNodeSearchText(nodeA)).toContain("turn");
    expect(scoreGraphNode(nodeA, "graph alpha")).toBeGreaterThan(0);
    expect(scoreGraphNode(nodeB, "graph alpha")).toBeLessThan(scoreGraphNode(nodeA, "graph alpha"));
    expect(sortGraphNodes([nodeB, nodeA, nodeC]).map((node) => node.id)).toEqual(["node-c", "node-b", "node-a"]);

    const edgeA: HarnessGraphEdgeRecord = {
      id: "edge-a",
      kind: "contains",
      scope: runScope,
      from: "node-a",
      to: "node-b",
      createdAt: "2026-04-04T00:00:00.000Z",
      updatedAt: "2026-04-04T00:00:01.000Z",
    };
    const edgeB: HarnessGraphEdgeRecord = {
      id: "edge-b",
      kind: "references",
      scope: runScope,
      from: "node-b",
      to: "node-c",
      createdAt: "2026-04-04T00:00:02.000Z",
      updatedAt: "2026-04-04T00:00:03.000Z",
    };
    expect(sortGraphEdges([edgeB, edgeA]).map((edge) => edge.id)).toEqual(["edge-b", "edge-a"]);
    expect(graphNodeMatchesQuery(nodeA, { scopes: [runScope], kinds: ["turn"] })).toBe(true);
    expect(graphNodeMatchesQuery(nodeA, { scopes: [projectScope] })).toBe(false);
    expect(graphEdgeMatchesQuery(edgeA, { scopes: [runScope], kinds: ["contains"] })).toBe(true);
    expect(graphEdgeMatchesQuery(edgeA, { scopes: [projectScope] })).toBe(false);
  });

  it("keeps graph scope canonicalization and search helpers stable across a broader matrix of scope kinds", () => {
    const cases: Array<{
      label: string;
      scope: HarnessGraphScope;
      memoryScope: { type: string; id: string };
      expectedKey: string;
      expectedTitle: string;
      searchText: string;
      searchFragment: string;
      nodeId: string;
    }> = [
      {
        label: "project scope",
        scope: { kind: "project", projectId: "capstan" },
        memoryScope: { type: "project", id: "capstan" },
        expectedKey: "project__capstan",
        expectedTitle: "Project: capstan",
        searchText: "Project capstan runtime graph",
        searchFragment: "project capstan",
        nodeId: "project-node",
      },
      {
        label: "app scope",
        scope: { kind: "app", appId: "capstan-ai" },
        memoryScope: { type: "app", id: "capstan-ai" },
        expectedKey: "app__capstan-ai",
        expectedTitle: "App: capstan-ai",
        searchText: "App capstan ai orchestration",
        searchFragment: "app capstan ai",
        nodeId: "app-node",
      },
      {
        label: "run scope",
        scope: { kind: "run", runId: "run-matrix" },
        memoryScope: { type: "run", id: "run-matrix" },
        expectedKey: "run__run-matrix",
        expectedTitle: "Run: run-matrix",
        searchText: "Run run matrix lifecycle",
        searchFragment: "run matrix lifecycle",
        nodeId: "run-node",
      },
      {
        label: "resource scope",
        scope: { kind: "resource", resourceType: "repo", resourceId: "capstan" },
        memoryScope: { type: "resource", id: "repo:capstan" },
        expectedKey: "resource__repo__capstan",
        expectedTitle: "Resource: repo/capstan",
        searchText: "Repository resource capstan",
        searchFragment: "resource capstan",
        nodeId: "resource-node",
      },
      {
        label: "capability scope",
        scope: { kind: "capability", capabilityId: "harness" },
        memoryScope: { type: "capability", id: "harness" },
        expectedKey: "capability__harness",
        expectedTitle: "Capability: harness",
        searchText: "Capability harness orchestration",
        searchFragment: "capability harness",
        nodeId: "capability-node",
      },
      {
        label: "policy scope",
        scope: { kind: "policy", policyId: "agent-runtime" },
        memoryScope: { type: "policy", id: "agent-runtime" },
        expectedKey: "policy__agent-runtime",
        expectedTitle: "Policy: agent-runtime",
        searchText: "Policy agent runtime restrictions",
        searchFragment: "policy agent-runtime",
        nodeId: "policy-node",
      },
      {
        label: "entity scope",
        scope: { kind: "entity", entityType: "run", entityId: "run-matrix" },
        memoryScope: { type: "entity", id: "run:run-matrix" },
        expectedKey: "entity__run__run-matrix",
        expectedTitle: "Entity: run/run-matrix",
        searchText: "Entity run matrix lifecycle",
        searchFragment: "entity run matrix",
        nodeId: "entity-node",
      },
      {
        label: "trimmed project scope",
        scope: { kind: "project", projectId: "  capstan  " },
        memoryScope: { type: "project", id: "  capstan  " },
        expectedKey: "project__capstan",
        expectedTitle: "Project: capstan",
        searchText: "  Capstan project   context  ",
        searchFragment: "capstan project context",
        nodeId: "trimmed-project-node",
      },
      {
        label: "trimmed run scope",
        scope: { kind: "run", runId: "  run-matrix  " },
        memoryScope: { type: "run", id: "  run-matrix  " },
        expectedKey: "run__run-matrix",
        expectedTitle: "Run: run-matrix",
        searchText: "  run matrix  checkpoint ",
        searchFragment: "run matrix checkpoint",
        nodeId: "trimmed-run-node",
      },
      {
        label: "trimmed resource scope",
        scope: { kind: "resource", resourceType: "  repo  ", resourceId: "  capstan  " },
        memoryScope: { type: "resource", id: "repo:capstan" },
        expectedKey: "resource__repo__capstan",
        expectedTitle: "Resource: repo/capstan",
        searchText: "Resource repo capstan",
        searchFragment: "resource repo capstan",
        nodeId: "trimmed-resource-node",
      },
      {
        label: "trimmed capability scope",
        scope: { kind: "capability", capabilityId: "  harness  " },
        memoryScope: { type: "capability", id: "  harness  " },
        expectedKey: "capability__harness",
        expectedTitle: "Capability: harness",
        searchText: "Capability harness",
        searchFragment: "capability harness",
        nodeId: "trimmed-capability-node",
      },
      {
        label: "trimmed policy scope",
        scope: { kind: "policy", policyId: "  agent-runtime  " },
        memoryScope: { type: "policy", id: "  agent-runtime  " },
        expectedKey: "policy__agent-runtime",
        expectedTitle: "Policy: agent-runtime",
        searchText: "Policy runtime",
        searchFragment: "policy runtime",
        nodeId: "trimmed-policy-node",
      },
    ];

    for (const scenario of cases) {
      const normalized = normalizeGraphScope(scenario.scope);
      expect(graphScopeKey(normalized)).toBe(scenario.expectedKey);
      expect(formatHarnessGraphScopeKey(normalized)).toBe(scenario.expectedKey);
      expect(formatHarnessGraphScopeTitle(normalized)).toBe(scenario.expectedTitle);
      expect(scopesEqual(normalized, scenario.scope)).toBe(true);
      const mappedMemoryScope = memoryScopeToGraphScope(scenario.memoryScope);
      if (scenario.memoryScope.type === "resource" || scenario.memoryScope.type === "entity") {
        expect(mappedMemoryScope).toEqual({
          kind: "entity",
          entityType: scenario.memoryScope.type,
          entityId: scenario.memoryScope.id.trim(),
        });
      } else {
        expect(mappedMemoryScope).toEqual(normalized);
      }
      expect(encodeGraphPathSegment(scenario.label)).not.toContain(" ");
      expect(encodeGraphPathSegment(scenario.label)).toMatch(/^[A-Za-z0-9._-]+$/);

      const graphText = graphNodeSearchText({
        id: scenario.nodeId,
        kind: "memory",
        scope: normalized,
        title: `${scenario.label} node`,
        createdAt: iso(),
        updatedAt: iso(),
        summary: scenario.label,
        content: scenario.searchText,
        metadata: {
          scope: scenario.expectedKey,
          label: scenario.label,
        },
      });
      expect(graphText).toContain(scenario.searchFragment);
      expect(scoreGraphNode({
        id: scenario.nodeId,
        kind: "memory",
        scope: normalized,
        title: `${scenario.label} node`,
        createdAt: iso(),
        updatedAt: iso(),
        summary: scenario.label,
        content: scenario.searchText,
        metadata: {
          scope: scenario.expectedKey,
          label: scenario.label,
        },
      }, scenario.searchFragment)).toBeGreaterThan(0);
    }
  });

  it("keeps graph retrieval and neighbor traversal stable across scoped query matrices", async () => {
    const { store } = await createHarnessFixture();
    const runId = "run-retrieval";
    const projectScope = { kind: "project", projectId: "capstan" } satisfies HarnessGraphScope;
    const runScope = { kind: "run", runId } satisfies HarnessGraphScope;
    const resourceScope = { kind: "resource", resourceType: "repo", resourceId: "capstan" } satisfies HarnessGraphScope;

    const nodes: HarnessGraphNodeRecord[] = [
      {
        id: `run:${runId}`,
        kind: "run",
        scope: runScope,
        runId,
        title: "Run: retrieval matrix",
        createdAt: iso(-10),
        updatedAt: iso(-10),
        status: "running",
        summary: "retrieval run",
        content: "retrieval run content",
        metadata: { graphScopes: [projectScope, runScope] },
      },
      {
        id: `turn:${runId}:1:assistant_response`,
        kind: "turn",
        scope: runScope,
        runId,
        title: "Turn 1: sampling_model",
        createdAt: iso(-9),
        updatedAt: iso(-9),
        status: "sampling_model",
        summary: "sampled model response",
        content: "tool lookup then annotate",
        metadata: { transitionReason: "next_turn" },
      },
      {
        id: `turn:${runId}:2:deciding_continuation`,
        kind: "turn",
        scope: runScope,
        runId,
        title: "Turn 2: deciding_continuation",
        createdAt: iso(-8),
        updatedAt: iso(-8),
        status: "deciding_continuation",
        summary: "deciding continuation",
        content: "continue after tool results",
        metadata: { transitionReason: "final_response" },
      },
      {
        id: `task:${runId}:task-1`,
        kind: "task",
        scope: runScope,
        runId,
        title: "Task: assemble-report",
        createdAt: iso(-7),
        updatedAt: iso(-7),
        status: "completed",
        summary: "completed task",
        content: "task result",
        order: 0,
        metadata: { kind: "workflow" },
      },
      {
        id: `approval:${runId}:approval-1`,
        kind: "approval",
        scope: runScope,
        runId,
        title: "Approval: assemble-report",
        createdAt: iso(-6),
        updatedAt: iso(-6),
        status: "approved",
        summary: "approval granted",
        content: "approval content",
        metadata: { reason: "approval needed" },
      },
      {
        id: `artifact:${runId}:artifact-1`,
        kind: "artifact",
        scope: runScope,
        runId,
        title: "Artifact: report",
        createdAt: iso(-5),
        updatedAt: iso(-5),
        status: "available",
        summary: "artifact summary",
        content: "artifact content",
        metadata: {
          kind: "report",
          mimeType: "text/markdown",
          size: 24,
          path: `/tmp/${runId}/artifact.md`,
        },
      },
      {
        id: `memory:run__${runId}:memory-1`,
        kind: "memory",
        scope: runScope,
        runId,
        title: "Memory: memory",
        createdAt: iso(-4),
        updatedAt: iso(-4),
        status: "fact",
        summary: "runtime memory",
        content: "graph memory content",
        metadata: { memoryKind: "memory" },
      },
      {
        id: `memory:project__capstan:memory-2`,
        kind: "memory",
        scope: projectScope,
        title: "Memory: memory",
        createdAt: iso(-3),
        updatedAt: iso(-3),
        status: "fact",
        summary: "project memory",
        content: "project memory content",
        metadata: { memoryKind: "memory", graphScopes: [projectScope, resourceScope] },
      },
    ];

    const edges: HarnessGraphEdgeRecord[] = [
      {
        id: `edge:contains:run:${runId}->turn:${runId}:1:assistant_response:${iso(-10)}`,
        kind: "contains",
        scope: runScope,
        from: `run:${runId}`,
        to: `turn:${runId}:1:assistant_response`,
        createdAt: iso(-10),
        updatedAt: iso(-10),
        runId,
        metadata: { relation: "run_turn" },
      },
      {
        id: `edge:contains:run:${runId}->turn:${runId}:2:deciding_continuation:${iso(-9)}`,
        kind: "contains",
        scope: runScope,
        from: `run:${runId}`,
        to: `turn:${runId}:2:deciding_continuation`,
        createdAt: iso(-9),
        updatedAt: iso(-9),
        runId,
        metadata: { relation: "run_turn" },
      },
      {
        id: `edge:contains:run:${runId}->task:${runId}:task-1:${iso(-8)}`,
        kind: "contains",
        scope: runScope,
        from: `run:${runId}`,
        to: `task:${runId}:task-1`,
        createdAt: iso(-8),
        updatedAt: iso(-8),
        runId,
        metadata: { relation: "run_task" },
      },
      {
        id: `edge:contains:run:${runId}->approval:${runId}:approval-1:${iso(-7)}`,
        kind: "contains",
        scope: runScope,
        from: `run:${runId}`,
        to: `approval:${runId}:approval-1`,
        createdAt: iso(-7),
        updatedAt: iso(-7),
        runId,
        metadata: { relation: "run_approval" },
      },
      {
        id: `edge:contains:run:${runId}->artifact:${runId}:artifact-1:${iso(-6)}`,
        kind: "contains",
        scope: runScope,
        from: `run:${runId}`,
        to: `artifact:${runId}:artifact-1`,
        createdAt: iso(-6),
        updatedAt: iso(-6),
        runId,
        metadata: { relation: "run_artifact" },
      },
      {
        id: `edge:contains:run:${runId}->memory:run__${runId}:memory-1:${iso(-5)}`,
        kind: "contains",
        scope: runScope,
        from: `run:${runId}`,
        to: `memory:run__${runId}:memory-1`,
        createdAt: iso(-5),
        updatedAt: iso(-5),
        runId,
        metadata: { relation: "run_memory", memoryKind: "memory" },
      },
      {
        id: `edge:contains:run:${runId}->memory:project__capstan:memory-2:${iso(-4)}`,
        kind: "contains",
        scope: projectScope,
        from: `run:${runId}`,
        to: `memory:project__capstan:memory-2`,
        createdAt: iso(-4),
        updatedAt: iso(-4),
        runId,
        metadata: { relation: "run_memory", memoryKind: "memory" },
      },
    ];

    for (const node of nodes) {
      await store.upsertGraphNode(node);
    }
    for (const edge of edges) {
      await store.upsertGraphEdge(edge);
    }

    const scenarios: Array<{
      label: string;
      query: string;
      scopes?: HarnessGraphScope[];
      kinds?: HarnessGraphNodeRecord["kind"][];
      relatedTo?: string;
      limit: number;
      minScore?: number;
    }> = [
      {
        label: "run timeline query",
        query: "retrieval run",
        scopes: [runScope],
        kinds: ["run", "turn", "task", "approval", "artifact", "memory"],
        relatedTo: `run:${runId}`,
        limit: 5,
      },
      {
        label: "task focused query",
        query: "assemble report task",
        scopes: [runScope],
        kinds: ["task", "approval", "turn"],
        relatedTo: `task:${runId}:task-1`,
        limit: 3,
      },
      {
        label: "approval focused query",
        query: "approval granted",
        scopes: [runScope],
        kinds: ["approval", "memory"],
        relatedTo: `approval:${runId}:approval-1`,
        limit: 2,
      },
      {
        label: "artifact focused query",
        query: "artifact markdown report",
        scopes: [runScope],
        kinds: ["artifact", "memory"],
        relatedTo: `artifact:${runId}:artifact-1`,
        limit: 2,
      },
      {
        label: "project scoped memory query",
        query: "project memory content",
        scopes: [projectScope],
        kinds: ["memory"],
        relatedTo: `memory:project__capstan:memory-2`,
        limit: 2,
      },
      {
        label: "resource scoped memory query",
        query: "project memory content",
        scopes: [resourceScope],
        kinds: ["memory"],
        limit: 2,
      },
    ];

    for (const scenario of scenarios) {
      const results = await queryHarnessGraph(store, {
        text: scenario.query,
        ...(scenario.scopes ? { scopes: scenario.scopes } : {}),
        ...(scenario.kinds ? { kinds: scenario.kinds } : {}),
        ...(scenario.relatedTo ? { relatedTo: scenario.relatedTo } : {}),
        limit: scenario.limit,
        ...(scenario.minScore != null ? { minScore: scenario.minScore } : {}),
      });
      expect(results.length).toBeLessThanOrEqual(scenario.limit);
      if (scenario.label === "resource scoped memory query") {
        expect(results.some((result) => result.kind === "memory")).toBe(true);
      } else if (scenario.label === "run timeline query") {
        expect(results.some((result) => result.kind === "run")).toBe(true);
        expect(results.some((result) => result.kind === "memory")).toBe(true);
      } else if (scenario.label === "task focused query") {
        expect(results.some((result) => result.kind === "task")).toBe(true);
      } else if (scenario.label === "approval focused query") {
        expect(results.some((result) => result.kind === "approval")).toBe(true);
      } else if (scenario.label === "artifact focused query") {
        expect(results.some((result) => result.kind === "artifact")).toBe(true);
      } else if (scenario.label === "project scoped memory query") {
        expect(results.some((result) => result.kind === "memory")).toBe(true);
      }

      const contextNodes = await collectGraphContextNodes(store, {
        text: scenario.query,
        ...(scenario.scopes ? { scopes: scenario.scopes } : {}),
        ...(scenario.kinds ? { kinds: scenario.kinds } : {}),
        ...(scenario.relatedTo ? { relatedTo: scenario.relatedTo } : {}),
        limit: scenario.limit,
        ...(scenario.minScore != null ? { minScore: scenario.minScore } : {}),
      });
      expect(contextNodes.length).toBeLessThanOrEqual(scenario.limit);
      if (scenario.label === "resource scoped memory query") {
        expect(contextNodes.some((node) => node.kind === "memory")).toBe(true);
      } else if (scenario.label === "run timeline query") {
        expect(contextNodes.some((node) => node.kind === "run")).toBe(true);
      } else if (scenario.label === "task focused query") {
        expect(contextNodes.some((node) => node.kind === "task")).toBe(true);
      } else if (scenario.label === "approval focused query") {
        expect(contextNodes.some((node) => node.kind === "approval")).toBe(true);
      } else if (scenario.label === "artifact focused query") {
        expect(contextNodes.some((node) => node.kind === "artifact")).toBe(true);
      } else if (scenario.label === "project scoped memory query") {
        expect(contextNodes.some((node) => node.kind === "memory")).toBe(true);
      }
    }

    const neighbors = await listGraphNeighbors(store, `run:${runId}`, {
      scopes: [runScope],
      limit: 6,
    });
    expect(neighbors.some((node) => node.id === `task:${runId}:task-1`)).toBe(true);
    expect(neighbors.some((node) => node.id === `approval:${runId}:approval-1`)).toBe(true);
    expect(neighbors.some((node) => node.id === `artifact:${runId}:artifact-1`)).toBe(true);

    const runBlocks = await collectGraphContextNodes(store, {
      text: "",
      scopes: [runScope],
      kinds: ["run", "turn", "task", "approval", "artifact", "memory"],
      limit: 10,
    });
    expect(runBlocks.some((node) => node.id === `run:${runId}`)).toBe(true);
    expect(runBlocks.some((node) => node.id.startsWith(`memory:`))).toBe(true);
    expect(runBlocks.some((node) => node.id.startsWith(`turn:`))).toBe(true);

    const queryBlock = await queryHarnessGraph(store, {
      text: "retrieval run approval",
      scopes: [runScope],
      kinds: ["run", "turn", "task", "approval", "artifact", "memory"],
      relatedTo: `run:${runId}`,
      limit: 10,
    });
    expect(queryBlock.some((node) => node.id === `run:${runId}`)).toBe(true);
  });
});

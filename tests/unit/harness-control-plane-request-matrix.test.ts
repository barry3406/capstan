import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AgentLoopCheckpoint, MemoryScope } from "../../packages/ai/src/types.ts";
import { openHarnessRuntime } from "../../packages/ai/src/harness/runtime/control-plane.ts";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";
import type {
  HarnessAccessContext,
  HarnessApprovalRecord,
  HarnessAuthorizationDecision,
  HarnessAuthorizationRequest,
  HarnessRunRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
  HarnessTaskRecord,
} from "../../packages/ai/src/harness/types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-request-matrix-"));
  tempDirs.push(dir);
  return dir;
}

function buildRun(
  id: string,
  overrides: Partial<HarnessRunRecord> = {},
): HarnessRunRecord {
  return {
    id,
    goal: `goal:${id}`,
    status: "completed",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    iterations: 2,
    toolCalls: 1,
    taskCalls: 1,
    maxIterations: 6,
    toolNames: ["report"],
    taskNames: ["sync"],
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
    ...overrides,
  };
}

function buildTask(runId: string, taskId: string): HarnessTaskRecord {
  return {
    id: taskId,
    runId,
    requestId: `request:${taskId}`,
    name: `task:${taskId}`,
    kind: "workflow",
    status: "completed",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    order: 0,
    args: { taskId },
    result: { ok: true },
    hardFailure: false,
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
    kind: "tool",
    tool: "ticket.delete",
    args: { ticketId: approvalId },
    reason: "manual approval required",
    requestedAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    status: "pending",
    ...overrides,
  };
}

function buildSessionMemory(runId: string): HarnessSessionMemoryRecord {
  return {
    runId,
    goal: `goal:${runId}`,
    status: "completed",
    updatedAt: "2026-04-04T00:05:00.000Z",
    sourceRunUpdatedAt: "2026-04-04T00:04:00.000Z",
    headline: `headline:${runId}`,
    currentPhase: "done",
    recentSteps: ["did the work"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    compactedMessages: 0,
    tokenEstimate: 120,
  };
}

function buildSummary(runId: string): HarnessSummaryRecord {
  return {
    id: `summary:${runId}`,
    runId,
    createdAt: "2026-04-04T00:04:00.000Z",
    updatedAt: "2026-04-04T00:05:00.000Z",
    sourceRunUpdatedAt: "2026-04-04T00:04:00.000Z",
    kind: "run_compact",
    status: "completed",
    headline: `summary:${runId}`,
    completedSteps: ["generated summary"],
    blockers: [],
    openQuestions: [],
    artifactRefs: [],
    iterations: 2,
    toolCalls: 1,
    messageCount: 3,
    compactedMessages: 1,
  };
}

const checkpoint: AgentLoopCheckpoint = {
  stage: "completed",
  config: { goal: "seeded", maxIterations: 6 },
  messages: [{ role: "user", content: "seeded" }],
  iterations: 2,
  toolCalls: [{ tool: "report", args: {}, result: { ok: true } }],
  lastAssistantResponse: "done",
};

async function seedRuntimeRoot(rootDir: string) {
  const store = new FileHarnessRuntimeStore(rootDir);
  await store.initialize();

  const runA = buildRun("run-a", {
    status: "running",
  });
  const runB = buildRun("run-b", {
    updatedAt: "2026-04-04T00:06:00.000Z",
  });
  const blockedRun = buildRun("run-blocked", {
    status: "approval_required",
    updatedAt: "2026-04-04T00:07:00.000Z",
    pendingApprovalId: "approval-blocked",
    pendingApproval: {
      id: "approval-blocked",
      kind: "tool",
      tool: "ticket.delete",
      args: { ticketId: "approval-blocked" },
      reason: "manual approval required",
      requestedAt: "2026-04-04T00:02:00.000Z",
      status: "pending",
    },
  });

  await store.persistRun(runA);
  await store.persistRun(runB);
  await store.persistRun(blockedRun);

  await store.appendEvent({
    id: "evt-a1",
    runId: "run-a",
    sequence: 1,
    type: "run_completed",
    timestamp: 10,
    data: { ok: true },
  });
  await store.appendEvent({
    id: "evt-b1",
    runId: "run-b",
    sequence: 1,
    type: "run_completed",
    timestamp: 20,
    data: { ok: true },
  });

  const artifactA = await store.writeArtifact("run-a", {
    kind: "report",
    content: "artifact A",
  });
  const artifactB = await store.writeArtifact("run-b", {
    kind: "report",
    content: "artifact B",
  });

  await store.persistRun({
    ...runA,
    artifactIds: [artifactA.id],
    taskIds: ["task-a"],
  });
  await store.persistRun({
    ...runB,
    updatedAt: "2026-04-04T00:06:00.000Z",
    artifactIds: [artifactB.id],
    taskIds: ["task-b"],
  });

  await store.persistTask(buildTask("run-a", "task-a"));
  await store.persistTask(buildTask("run-b", "task-b"));
  await store.persistCheckpoint("run-a", checkpoint);
  await store.persistCheckpoint("run-b", checkpoint);

  await store.persistApproval(buildApproval("run-a", "approval-a"));
  await store.persistApproval(buildApproval("run-b", "approval-b"));
  await store.persistApproval(buildApproval("run-blocked", "approval-blocked"));

  await store.persistSessionMemory(buildSessionMemory("run-a"));
  await store.persistSessionMemory(buildSessionMemory("run-b"));
  await store.persistSummary(buildSummary("run-a"));
  await store.persistSummary(buildSummary("run-b"));

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

  return {
    store,
    artifactA,
    artifactB,
  };
}

function createRecorder(
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

async function openRecordedRuntime(
  rootDir: string,
  decide?: (request: HarnessAuthorizationRequest) => HarnessAuthorizationDecision | boolean | void,
) {
  const recorder = createRecorder(decide);
  const runtime = await openHarnessRuntime({
    rootDir,
    authorize: recorder.authorize,
  });
  return {
    runtime,
    requests: recorder.requests,
  };
}

describe("harness control-plane authorization request matrix", () => {
  it("maps direct control-plane calls to the expected authorization actions", async () => {
    const access: HarnessAccessContext = {
      subject: { id: "operator-1" },
      metadata: { source: "console" },
    };

    const cases: Array<{
      label: string;
      invoke: (runtime: Awaited<ReturnType<typeof openHarnessRuntime>>) => Promise<unknown>;
      expected: Partial<HarnessAuthorizationRequest>;
      assertRequest?: (request: HarnessAuthorizationRequest) => void;
    }> = [
      {
        label: "getRun",
        invoke: (runtime) => runtime.getRun("run-a", access),
        expected: { action: "run:read", runId: "run-a", access },
      },
      {
        label: "pauseRun",
        invoke: (runtime) => runtime.pauseRun("run-a", access),
        expected: { action: "run:pause", runId: "run-a", access },
      },
      {
        label: "cancelRun",
        invoke: (runtime) => runtime.cancelRun("run-a", access),
        expected: { action: "run:cancel", runId: "run-a", access },
      },
      {
        label: "replayRun",
        invoke: (runtime) => runtime.replayRun("run-a", access),
        expected: { action: "run:replay", runId: "run-a", access },
      },
      {
        label: "getCheckpoint",
        invoke: (runtime) => runtime.getCheckpoint("run-a", access),
        expected: { action: "checkpoint:read", runId: "run-a", access },
      },
      {
        label: "getArtifacts",
        invoke: (runtime) => runtime.getArtifacts("run-a", access),
        expected: { action: "artifact:read", runId: "run-a", access },
      },
      {
        label: "getTasks",
        invoke: (runtime) => runtime.getTasks("run-a", access),
        expected: { action: "task:read", runId: "run-a", access },
      },
      {
        label: "getEvents(run)",
        invoke: (runtime) => runtime.getEvents("run-a", access),
        expected: { action: "event:read", runId: "run-a", access },
      },
      {
        label: "getApproval",
        invoke: (runtime) => runtime.getApproval("approval-a", access),
        expected: { action: "approval:read", runId: "run-a", access },
        assertRequest: (request) => {
          expect(request.detail).toMatchObject({
            approvalId: "approval-a",
            runId: "run-a",
            tool: "ticket.delete",
            kind: "tool",
            status: "pending",
          });
          expect(request.detail?.pendingApproval).toMatchObject({
            id: "approval-a",
            tool: "ticket.delete",
            status: "pending",
          });
        },
      },
      {
        label: "approveRun",
        invoke: (runtime) => runtime.approveRun("run-blocked", { access }),
        expected: { action: "approval:approve", runId: "run-blocked", access },
        assertRequest: (request) => {
          expect(request.detail).toMatchObject({
            approvalId: "approval-blocked",
            tool: "ticket.delete",
            kind: "tool",
            status: "pending",
          });
        },
      },
      {
        label: "denyRun",
        invoke: (runtime) => runtime.denyRun("run-blocked", { access }),
        expected: { action: "approval:deny", runId: "run-blocked", access },
      },
      {
        label: "getSessionMemory",
        invoke: (runtime) => runtime.getSessionMemory("run-a", access),
        expected: { action: "memory:read", runId: "run-a", access },
        assertRequest: (request) => {
          expect(request.detail).toEqual({ kind: "session_memory" });
        },
      },
      {
        label: "getLatestSummary",
        invoke: (runtime) => runtime.getLatestSummary("run-a", access),
        expected: { action: "summary:read", runId: "run-a", access },
      },
      {
        label: "assembleContext",
        invoke: (runtime) =>
          runtime.assembleContext(
            "run-a",
            {
              query: "recent work",
              maxTokens: 400,
            },
            access,
          ),
        expected: { action: "context:read", runId: "run-a", access },
        assertRequest: (request) => {
          expect(request.detail).toEqual({ query: "recent work" });
        },
      },
      {
        label: "recallMemory(run-scoped)",
        invoke: (runtime) =>
          runtime.recallMemory(
            {
              query: "alpha",
              runId: "run-a",
              scopes: [{ type: "run", id: "run-a" }],
              kinds: ["observation"],
              minScore: 0,
              limit: 10,
            },
            access,
          ),
        expected: { action: "memory:read", runId: "run-a", access },
        assertRequest: (request) => {
          expect(request.detail).toEqual({
            query: "alpha",
            scopes: [{ type: "run", id: "run-a" }],
            kinds: ["observation"],
          });
        },
      },
    ];

    for (const testCase of cases) {
      const rootDir = await createTempDir();
      await seedRuntimeRoot(rootDir);
      const { runtime, requests } = await openRecordedRuntime(rootDir);
      await testCase.invoke(runtime);
      const first = requests[0];
      expect(first).toMatchObject(testCase.expected);
      expect(first?.run?.id).toBe(testCase.expected.runId);
      testCase.assertRequest?.(first);
    }
  });

  it("authorizes collection reads first, then filters list results by item-level access", async () => {
    const rootDir = await createTempDir();
    await seedRuntimeRoot(rootDir);

    const { runtime, requests } = await openRecordedRuntime(rootDir, (request) => {
      if (request.action === "run:list") {
        return true;
      }
      if (request.action === "run:read") {
        return request.runId === "run-a";
      }
      if (request.action === "event:list") {
        return true;
      }
      if (request.action === "event:read") {
        return request.runId === "run-a";
      }
      if (request.action === "summary:list") {
        return true;
      }
      if (request.action === "summary:read") {
        return request.runId === "run-a";
      }
      if (request.action === "approval:list") {
        return true;
      }
      if (request.action === "approval:read") {
        return request.runId === "run-a";
      }
      return true;
    });

    const runs = await runtime.listRuns();
    const events = await runtime.getEvents();
    const summaries = await runtime.listSummaries();
    const approvals = await runtime.listApprovals();

    expect(runs.map((run) => run.id)).toEqual(["run-a"]);
    expect(events.map((event) => event.runId)).toEqual(["run-a"]);
    expect(summaries.map((summary) => summary.runId)).toEqual(["run-a"]);
    expect(approvals.map((approval) => approval.runId)).toEqual(["run-a"]);

    expect(requests.filter((request) => request.action === "run:list")).toHaveLength(1);
    expect(requests.filter((request) => request.action === "run:read")).toHaveLength(3);
    expect(requests.filter((request) => request.action === "event:list")).toHaveLength(1);
    expect(requests.filter((request) => request.action === "event:read")).toHaveLength(2);
    expect(requests.filter((request) => request.action === "summary:list")).toHaveLength(1);
    expect(requests.filter((request) => request.action === "summary:read")).toHaveLength(2);
    expect(requests.filter((request) => request.action === "approval:list")).toHaveLength(1);
    expect(requests.filter((request) => request.action === "approval:read")).toHaveLength(3);
  });

  it("filters memory recalls by per-memory authorization after the top-level query is authorized", async () => {
    const rootDir = await createTempDir();
    await seedRuntimeRoot(rootDir);

    const { runtime, requests } = await openRecordedRuntime(rootDir, (request) => {
      if (request.action !== "memory:read") {
        return true;
      }
      if (request.detail?.query) {
        return true;
      }
      return request.runId === "run-b";
    });

    const memories = await runtime.recallMemory({
      query: "observation",
      scopes: [
        { type: "run", id: "run-a" },
        { type: "run", id: "run-b" },
      ] satisfies MemoryScope[],
      minScore: 0,
      limit: 10,
    });

    expect(memories).toHaveLength(1);
    expect(memories[0]?.runId).toBe("run-b");
    expect(requests[0]).toMatchObject({
      action: "memory:read",
      detail: {
        query: "observation",
        scopes: [
          { type: "run", id: "run-a" },
          { type: "run", id: "run-b" },
        ],
      },
    });
    expect(
      requests
        .filter((request) => request.action === "memory:read" && !request.detail?.query)
        .map((request) => request.runId)
        .sort(),
    ).toEqual(["run-a", "run-b"]);
  });

  it("uses run-scoped list semantics for approvals and read semantics for run-scoped summaries", async () => {
    const rootDir = await createTempDir();
    await seedRuntimeRoot(rootDir);

    const { runtime, requests } = await openRecordedRuntime(rootDir);
    const approvals = await runtime.listApprovals("run-a");
    const summaries = await runtime.listSummaries("run-a");

    expect(approvals.map((approval) => approval.id)).toEqual(["approval-a"]);
    expect(summaries.map((summary) => summary.runId)).toEqual(["run-a"]);
    expect(requests).toEqual([
      {
        action: "approval:list",
        runId: "run-a",
        run: expect.objectContaining({ id: "run-a" }),
      },
      {
        action: "approval:read",
        runId: "run-a",
        detail: expect.objectContaining({ approvalId: "approval-a" }),
        run: expect.objectContaining({ id: "run-a" }),
      },
      {
        action: "summary:read",
        runId: "run-a",
        run: expect.objectContaining({ id: "run-a" }),
      },
    ]);
  });

  it("does not consult authorization for runtime paths", async () => {
    const rootDir = await createTempDir();
    await seedRuntimeRoot(rootDir);

    const { runtime, requests } = await openRecordedRuntime(rootDir);
    const paths = runtime.getPaths({
      subject: { id: "operator-1" },
    });

    expect(paths.rootDir).toContain(".capstan/harness");
    expect(requests).toEqual([]);
  });

  it("includes access context in every recorded authorization request", async () => {
    const rootDir = await createTempDir();
    await seedRuntimeRoot(rootDir);

    const access: HarnessAccessContext = {
      subject: { id: "operator-77", role: "admin" },
      metadata: { source: "api" },
    };

    const { runtime, requests } = await openRecordedRuntime(rootDir);
    await runtime.getRun("run-a", access);
    await runtime.getArtifacts("run-a", access);
    await runtime.getApproval("approval-a", access);
    await runtime.getSessionMemory("run-a", access);
    await runtime.assembleContext("run-a", { query: "audit" }, access);

    expect(requests.map((request) => request.access)).toEqual([
      access,
      access,
      access,
      access,
      access,
    ]);
  });
});

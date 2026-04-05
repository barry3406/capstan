import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { HarnessContextKernel } from "../../packages/ai/src/harness/context/kernel.ts";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";
import type {
  HarnessGraphEdgeRecord,
  HarnessGraphNodeRecord,
  HarnessRunRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
} from "../../packages/ai/src/harness/types.ts";
import type { AgentLoopCheckpoint } from "../../packages/ai/src/types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-graph-context-"));
  tempDirs.push(dir);
  return dir;
}

function buildRun(
  runId: string,
  overrides: Partial<HarnessRunRecord> = {},
): HarnessRunRecord {
  return {
    id: runId,
    goal: "Investigate graph-aware context assembly",
    status: "running",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:10.000Z",
    iterations: 3,
    toolCalls: 2,
    taskCalls: 1,
    maxIterations: 8,
    toolNames: ["lookup", "search"],
    taskNames: ["workflow"],
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: true,
      artifactDir: `/tmp/${runId}/artifacts`,
    },
    lastEventSequence: 0,
    graphScopes: [
      { kind: "capability", capabilityId: "deploy.release" },
      { kind: "resource", resourceType: "page", resourceId: "/ops/releases" },
    ],
    ...overrides,
  };
}

function buildCheckpoint(
  overrides: Partial<AgentLoopCheckpoint> = {},
): AgentLoopCheckpoint {
  return {
    stage: "assistant_response",
    config: {
      goal: "Investigate graph-aware context assembly",
      maxIterations: 8,
    },
    messages: [
      { role: "system", content: "You are a rigorous runtime agent." },
      { role: "user", content: "Trace the graph-backed runtime state." },
    ],
    iterations: 3,
    toolCalls: [
      {
        tool: "lookup",
        args: { page: 1 },
        result: { body: "release overview" },
      },
    ],
    lastAssistantResponse: "Investigating runtime state.",
    orchestration: {
      phase: "sampling_model",
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
      lastModelFinishReason: "stop",
      assistantMessagePersisted: true,
    },
    ...overrides,
  };
}

function buildSessionMemory(runId: string): HarnessSessionMemoryRecord {
  return {
    runId,
    goal: "Investigate graph-aware context assembly",
    status: "running",
    updatedAt: "2026-04-04T00:00:11.000Z",
    sourceRunUpdatedAt: "2026-04-04T00:00:10.000Z",
    headline: "Graph-backed release state is still evolving.",
    currentPhase: "sampling_model",
    recentSteps: ["inspected runtime store", "collected graph nodes"],
    blockers: ["approval still pending"],
    openQuestions: ["which policy controls rollout"],
    artifactRefs: [],
    compactedMessages: 1,
    tokenEstimate: 120,
  };
}

function buildSummary(runId: string): HarnessSummaryRecord {
  return {
    id: `summary:${runId}`,
    runId,
    createdAt: "2026-04-04T00:00:11.000Z",
    updatedAt: "2026-04-04T00:00:12.000Z",
    sourceRunUpdatedAt: "2026-04-04T00:00:10.000Z",
    kind: "run_compact",
    status: "running",
    headline: "Graph summary",
    completedSteps: ["collected runtime artifacts"],
    blockers: ["approval still pending"],
    openQuestions: ["which capability owns release rollout"],
    artifactRefs: [],
    iterations: 3,
    toolCalls: 2,
    messageCount: 5,
    compactedMessages: 2,
  };
}

function buildNode(
  id: string,
  patch: Partial<HarnessGraphNodeRecord> = {},
): HarnessGraphNodeRecord {
  return {
    id,
    kind: "memory",
    scope: { kind: "project", projectId: "/virtual/project" },
    title: `Memory: ${id}`,
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:10.000Z",
    summary: `${id} summary`,
    content: `${id} content`,
    metadata: { source: "matrix" },
    ...patch,
  };
}

function buildEdge(
  id: string,
  patch: Partial<HarnessGraphEdgeRecord> = {},
): HarnessGraphEdgeRecord {
  return {
    id,
    kind: "references",
    scope: { kind: "run", runId: "run-1" },
    from: "run:run-1",
    to: "memory:default",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:10.000Z",
    runId: "run-1",
    metadata: { source: "matrix" },
    ...patch,
  };
}

async function createKernel(config?: ConstructorParameters<typeof HarnessContextKernel>[1]) {
  const rootDir = await createTempDir();
  const store = new FileHarnessRuntimeStore(rootDir);
  await store.initialize();
  const kernel = new HarnessContextKernel(store, config);
  await kernel.initialize();
  return { rootDir, store, kernel };
}

async function seedRunFixture(options?: {
  run?: Partial<HarnessRunRecord>;
  checkpoint?: Partial<AgentLoopCheckpoint>;
  kernelConfig?: ConstructorParameters<typeof HarnessContextKernel>[1];
}) {
  const { rootDir, store, kernel } = await createKernel(options?.kernelConfig);
  const runId = options?.run?.id ?? "run-1";
  await store.persistRun(
    buildRun(runId, {
      ...options?.run,
      graphScopes:
        options?.run?.graphScopes ??
        [
          { kind: "capability", capabilityId: "deploy.release" },
          { kind: "resource", resourceType: "page", resourceId: "/ops/releases" },
        ],
    }),
  );
  await store.persistCheckpoint(runId, buildCheckpoint(options?.checkpoint));
  await store.persistSessionMemory(buildSessionMemory(runId));
  await store.persistSummary(buildSummary(runId));
  await store.rememberMemory({
    scope: { type: "project", id: store.paths.rootDir },
    kind: "fact",
    content: "Project memory prefers graph-aware context assembly.",
  });
  return { rootDir, runId, store, kernel };
}

describe("graph-aware context matrix", () => {
  it("assembles graph context from default project/run scopes plus run graph scopes", async () => {
    const { rootDir, runId, store, kernel } = await seedRunFixture();

    await store.upsertGraphNode(
      buildNode("memory:project-match", {
        scope: { kind: "project", projectId: store.paths.rootDir },
        runId,
        title: "Memory: project release policy",
        summary: "project-scoped release approval rollout policy",
        content:
          "Project policy says release rollout requires approval and rollout coordination.",
        updatedAt: "2026-04-04T00:00:25.000Z",
      }),
    );
    await store.upsertGraphNode(
      buildNode("memory:run-match", {
        scope: { kind: "run", runId },
        runId,
        title: "Memory: run incident",
        summary: "run scoped approval state",
        content: "This run is waiting for approval to continue rollout.",
      }),
    );
    await store.upsertGraphNode(
      buildNode("memory:capability-match", {
        scope: { kind: "capability", capabilityId: "deploy.release" },
        title: "Memory: capability owner",
        summary: "capability deploy release",
        content: "The deploy.release capability owns rollout execution.",
      }),
    );
    await store.upsertGraphNode(
      buildNode("memory:resource-match", {
        scope: { kind: "resource", resourceType: "page", resourceId: "/ops/releases" },
        title: "Memory: release page",
        summary: "resource release page health",
        content: "The /ops/releases page shows rollout health and approval status.",
      }),
    );
    await store.upsertGraphNode(
      buildNode("memory:foreign", {
        scope: { kind: "project", projectId: "/foreign/project" },
        title: "Memory: unrelated",
        summary: "foreign project",
        content: "Unrelated memory should not be included without explicit scope.",
      }),
    );
    await store.upsertGraphEdge(
      buildEdge("edge:run-project", {
        kind: "references",
        from: `run:${runId}`,
        to: "memory:project-match",
      }),
    );

    const context = await kernel.assembleContext(runId, {
      query: "release approval rollout",
      maxTokens: 900,
      maxGraphNodes: 10,
    });

    const nodeIds = context.graphNodes.map((node) => node.id);
    expect(nodeIds).toContain("memory:run-match");
    expect(nodeIds).toContain("memory:capability-match");
    expect(nodeIds).toContain("memory:resource-match");
    expect(nodeIds).not.toContain("memory:foreign");
    expect(context.blocks.some((block) => block.kind === "graph")).toBe(true);
    expect(
      context.blocks.find((block) => block.kind === "graph")?.content,
    ).toContain("Memory: project release policy");
    expect(
      context.blocks.find((block) => block.kind === "graph")?.content,
    ).toContain("capability deploy release");
  });

  it("uses the default project graph scope when a project-scoped node is the best semantic match", async () => {
    const { rootDir, runId, store, kernel } = await seedRunFixture();

    await store.upsertGraphNode(
      buildNode("memory:project-best-match", {
        scope: { kind: "project", projectId: store.paths.rootDir },
        runId,
        title: "Memory: project coordination policy",
        summary: "project coordination policy",
        content:
          "project coordination policy requires a release council approval window and project-only coordination.",
        updatedAt: "2026-04-04T00:00:30.000Z",
      }),
    );
    await store.upsertGraphNode(
      buildNode("memory:resource-decoy", {
        scope: { kind: "resource", resourceType: "page", resourceId: "/ops/releases" },
        runId,
        title: "Memory: release page metrics",
        summary: "resource metrics only",
        content: "dashboard metrics and health checks",
      }),
    );

    const context = await kernel.assembleContext(runId, {
      query: "project coordination council",
      graphKinds: ["memory"],
      maxTokens: 900,
      maxGraphNodes: 6,
    });

    expect(context.graphNodes.map((node) => node.id)).toContain("memory:project-best-match");
    expect(
      context.blocks.find((block) => block.kind === "graph")?.content,
    ).toContain("project coordination policy");
  });

  it("honors explicit graphKinds and maxGraphNodes limits instead of dumping every match", async () => {
    const { runId, store, kernel } = await seedRunFixture({
      kernelConfig: {
        maxPromptTokens: 2000,
        reserveOutputTokens: 0,
        maxGraphNodes: 8,
      },
    });

    await store.upsertGraphNode(
      buildNode("artifact:release-report", {
        kind: "artifact",
        scope: { kind: "run", runId },
        runId,
        title: "Artifact: release report",
        summary: "artifact report",
        content: "artifact payload",
        metadata: {
          kind: "report",
          mimeType: "text/markdown",
          path: "/reports/release.md",
          size: 128,
        },
      }),
    );
    await store.upsertGraphNode(
      buildNode("approval:release", {
        kind: "approval",
        scope: { kind: "run", runId },
        runId,
        title: "Approval: deploy.release",
        status: "pending",
        summary: "pending approval",
        content: "Waiting for operator approval",
      }),
    );
    await store.upsertGraphNode(
      buildNode("memory:release-1", {
        kind: "memory",
        scope: { kind: "run", runId },
        runId,
        title: "Memory: release notes",
        summary: "release notes",
        content: "release note payload",
        updatedAt: "2026-04-04T00:00:15.000Z",
      }),
    );
    await store.upsertGraphNode(
      buildNode("memory:release-2", {
        kind: "memory",
        scope: { kind: "run", runId },
        runId,
        title: "Memory: second note",
        summary: "secondary note",
        content: "secondary payload",
        updatedAt: "2026-04-04T00:00:14.000Z",
      }),
    );

    const filtered = await kernel.assembleContext(runId, {
      query: "release pending payload",
      graphKinds: ["approval", "memory"],
      maxGraphNodes: 2,
      maxTokens: 900,
    });

    expect(filtered.graphNodes).toHaveLength(2);
    expect(filtered.graphNodes.every((node) => ["approval", "memory"].includes(node.kind))).toBe(true);
    expect(filtered.graphNodes.some((node) => node.kind === "artifact")).toBe(false);
  });

  it("uses explicit graphScopes to pull entity and policy nodes that are outside the run defaults", async () => {
    const { runId, store, kernel } = await seedRunFixture({
      run: {
        graphScopes: [{ kind: "capability", capabilityId: "deploy.release" }],
      },
    });

    await store.upsertGraphNode(
      buildNode("memory:policy", {
        scope: { kind: "policy", policyId: "release-guard" },
        title: "Memory: rollout policy",
        summary: "policy gate",
        content: "The release-guard policy blocks rollout after hours.",
      }),
    );
    await store.upsertGraphNode(
      buildNode("memory:entity", {
        scope: { kind: "entity", entityType: "ticket", entityId: "INC-42" },
        title: "Memory: incident ticket",
        summary: "incident INC-42",
        content: "INC-42 tracks the risky rollout window.",
      }),
    );
    await store.upsertGraphNode(
      buildNode("memory:resource-ignored", {
        scope: { kind: "resource", resourceType: "page", resourceId: "/ops/releases" },
        title: "Memory: release page",
        summary: "resource only",
        content: "This node is not in the explicit scope set for this test.",
      }),
    );

    const context = await kernel.assembleContext(runId, {
      query: "rollout incident guard",
      graphScopes: [
        { kind: "policy", policyId: "release-guard" },
        { kind: "entity", entityType: "ticket", entityId: "INC-42" },
      ],
      maxGraphNodes: 6,
      maxTokens: 900,
    });

    expect(context.graphNodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["memory:policy", "memory:entity"]),
    );
    expect(context.graphNodes.map((node) => node.id)).not.toContain("memory:resource-ignored");
  });

  it("injects neighboring graph nodes through run-centered graph traversal", async () => {
    const { runId, store, kernel } = await seedRunFixture();

    await store.upsertGraphNode(
      buildNode(`run:${runId}`, {
        id: `run:${runId}`,
        kind: "run",
        scope: { kind: "run", runId },
        runId,
        title: `Run: ${runId}`,
        summary: "runtime root",
        content: "run root node",
      }),
    );
    await store.upsertGraphNode(
      buildNode("task:release", {
        kind: "task",
        scope: { kind: "run", runId },
        runId,
        title: "Task: release rollout",
        status: "running",
        summary: "task release rollout",
        content: "task node content",
        order: 1,
      }),
    );
    await store.upsertGraphNode(
      buildNode("artifact:release", {
        kind: "artifact",
        scope: { kind: "run", runId },
        runId,
        title: "Artifact: release evidence",
        summary: "artifact evidence",
        content: "/artifacts/release.txt",
        metadata: {
          kind: "report",
          mimeType: "text/plain",
          size: 32,
          path: "/artifacts/release.txt",
        },
      }),
    );

    await store.upsertGraphEdge(
      buildEdge("edge:run-task", {
        kind: "contains",
        from: `run:${runId}`,
        to: "task:release",
        toIds: undefined as never,
      }),
    );
    await store.upsertGraphEdge(
      buildEdge("edge:task-artifact", {
        kind: "generates",
        from: "task:release",
        to: "artifact:release",
      }),
    );

    const context = await kernel.assembleContext(runId, {
      query: "release evidence",
      graphKinds: ["artifact", "task"],
      maxGraphNodes: 5,
      maxTokens: 900,
    });

    expect(context.graphNodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["task:release", "artifact:release"]),
    );
    expect(
      context.blocks.find((block) => block.kind === "graph")?.content,
    ).toContain("Artifact: release evidence");
  });

  it("records graph omissions when the context budget cannot fit the graph block", async () => {
    const { runId, store, kernel } = await seedRunFixture({
      kernelConfig: {
        maxPromptTokens: 320,
        reserveOutputTokens: 0,
        maxGraphNodes: 6,
        maxRecentMessages: 2,
      },
    });

    await store.upsertGraphNode(
      buildNode("memory:huge-1", {
        scope: { kind: "run", runId },
        runId,
        title: "Memory: huge graph 1",
        summary: "huge graph summary",
        content: "X".repeat(600),
      }),
    );
    await store.upsertGraphNode(
      buildNode("memory:huge-2", {
        scope: { kind: "run", runId },
        runId,
        title: "Memory: huge graph 2",
        summary: "huge graph summary",
        content: "Y".repeat(600),
      }),
    );

    const context = await kernel.assembleContext(runId, {
      query: "huge graph",
      maxTokens: 120,
      maxGraphNodes: 6,
    });

    expect(context.graphNodes.length).toBeGreaterThan(0);
    expect(context.blocks.some((block) => block.kind === "graph")).toBe(false);
    expect(
      context.omitted.some(
        (entry) => entry.kind === "graph" && entry.reason === "token_budget_exceeded",
      ),
    ).toBe(true);
  });

  it("allows callers to disable graph retrieval explicitly with maxGraphNodes zero", async () => {
    const { runId, store, kernel } = await seedRunFixture();

    await store.upsertGraphNode(
      buildNode("memory:should-not-appear", {
        scope: { kind: "run", runId },
        runId,
        title: "Memory: hidden graph node",
        summary: "should be absent",
        content: "This node should not be returned when graph retrieval is disabled.",
      }),
    );

    const context = await kernel.assembleContext(runId, {
      query: "hidden graph node",
      maxGraphNodes: 0,
      maxTokens: 600,
    });

    expect(context.graphNodes).toEqual([]);
    expect(context.blocks.some((block) => block.kind === "graph")).toBe(false);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createHarnessGrantAuthorizer,
  grantApprovalActions,
  grantApprovalCollectionActions,
  grantArtifactActions,
  grantCheckpointActions,
  grantEventActions,
  grantRunActions,
  grantRunCollectionActions,
} from "@zauso-ai/capstan-auth";
import type { AgentCheckpoint } from "../../packages/ai/src/types.ts";
import { openHarnessRuntime } from "../../packages/ai/src/harness/runtime/control-plane.ts";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-control-"));
  tempDirs.push(dir);
  return dir;
}

function baseRun(id: string) {
  return {
    id,
    goal: `goal:${id}`,
    status: "running" as const,
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    iterations: 0,
    toolCalls: 0,
    maxIterations: 5,
    toolNames: [],
    artifactIds: [],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: false,
      artifactDir: `/artifacts/${id}`,
    },
    lastEventSequence: 0,
  };
}

function createGrantAuthorizer(grants: ReadonlyArray<string | Record<string, unknown>>) {
  return createHarnessGrantAuthorizer(grants);
}

function approvalRecord(id: string, runId: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    runId,
    kind: "tool",
    tool: "ticket.delete",
    args: { id },
    reason: "needs approval",
    requestedAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    status: "pending" as const,
    ...patch,
  };
}

describe("openHarnessRuntime", () => {
  it("returns empty collections and resolved paths for a new runtime root", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);

    expect(await runtime.listRuns()).toEqual([]);
    expect(await runtime.getEvents()).toEqual([]);
    expect(runtime.getPaths().rootDir).toContain(".capstan/harness");
  });

  it("reads persisted runs, events, artifacts, and checkpoints through the control plane", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(baseRun("run-a"));

    const checkpoint: AgentCheckpoint = {
      stage: "tool_result",
      goal: "goal:run-a",
      messages: [{ role: "user", content: "goal" }],
      iterations: 1,
      toolCalls: [{ tool: "noop", args: {}, result: { ok: true } }],
      taskCalls: [],
      maxOutputTokens: 8192,
      compaction: {
        autocompactFailures: 0,
        reactiveCompactRetries: 0,
        tokenEscalations: 0,
      },
    };

    await store.persistCheckpoint("run-a", checkpoint);
    const artifact = await store.writeArtifact("run-a", {
      kind: "report",
      content: "hello",
    });
    await store.appendEvent({
      id: "evt-1",
      runId: "run-a",
      sequence: 1,
      type: "artifact_created",
      timestamp: 123,
      data: { artifactId: artifact.id },
    });

    const runtime = await openHarnessRuntime(rootDir);

    expect((await runtime.getRun("run-a"))?.goal).toBe("goal:run-a");
    expect(await runtime.getCheckpoint("run-a")).toEqual(checkpoint);
    expect((await runtime.getArtifacts("run-a"))[0]?.id).toBe(artifact.id);
    expect((await runtime.getEvents("run-a")).map((event) => event.type)).toEqual([
      "artifact_created",
    ]);
  });

  it("forwards pause and cancel transitions to the underlying store", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(baseRun("run-a"));
    await store.persistRun({
      ...baseRun("paused-run"),
      status: "paused",
    });

    const runtime = await openHarnessRuntime(rootDir);

    const pauseRequested = await runtime.pauseRun("run-a");
    expect(pauseRequested.status).toBe("pause_requested");

    const canceled = await runtime.cancelRun("paused-run");
    expect(canceled.status).toBe("canceled");
  });

  it("filters run listings and denies run reads outside scoped grants", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(baseRun("run-a"));
    await store.persistRun(baseRun("run-b"));

    const runtime = await openHarnessRuntime({
      rootDir,
      authorize: createGrantAuthorizer([
        ...grantRunCollectionActions(["list"]),
        ...grantRunActions("run-a", ["read"]),
      ]),
    });

    const runs = await runtime.listRuns();
    expect(runs.map((run) => run.id)).toEqual(["run-b", "run-a"].filter((id) => id === "run-a"));
    await expect(runtime.getRun("run-b")).rejects.toThrow(
      "Harness access denied for run:read for run run-b",
    );
    expect((await runtime.getRun("run-a"))?.goal).toBe("goal:run-a");
  });

  it("requires matching scoped grants for checkpoints, artifacts, pause, and cancel", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun(baseRun("run-a"));
    await store.persistRun({
      ...baseRun("paused-run"),
      status: "paused",
    });
    const checkpoint: AgentCheckpoint = {
      stage: "tool_result",
      goal: "goal:run-a",
      messages: [{ role: "user", content: "goal" }],
      iterations: 1,
      toolCalls: [{ tool: "noop", args: {}, result: { ok: true } }],
      taskCalls: [],
      maxOutputTokens: 8192,
      compaction: {
        autocompactFailures: 0,
        reactiveCompactRetries: 0,
        tokenEscalations: 0,
      },
    };
    await store.persistCheckpoint("run-a", checkpoint);
    await store.writeArtifact("run-a", {
      kind: "report",
      content: "hello",
    });

    const deniedRuntime = await openHarnessRuntime({
      rootDir,
      authorize: createGrantAuthorizer([
        ...grantCheckpointActions("other-run"),
        ...grantArtifactActions("other-run"),
        ...grantRunActions("other-run", ["pause", "cancel"]),
      ]),
    });

    await expect(deniedRuntime.getCheckpoint("run-a")).rejects.toThrow(
      "Harness access denied for checkpoint:read for run run-a",
    );
    await expect(deniedRuntime.getArtifacts("run-a")).rejects.toThrow(
      "Harness access denied for artifact:read for run run-a",
    );
    await expect(deniedRuntime.pauseRun("run-a")).rejects.toThrow(
      "Harness access denied for run:pause for run run-a",
    );
    await expect(deniedRuntime.cancelRun("paused-run")).rejects.toThrow(
      "Harness access denied for run:cancel for run paused-run",
    );

    const authorizedRuntime = await openHarnessRuntime({
      rootDir,
      authorize: createGrantAuthorizer([
        ...grantCheckpointActions("run-a"),
        ...grantArtifactActions("run-a"),
        ...grantRunActions("run-a", ["pause"]),
        ...grantRunActions("paused-run", ["cancel"]),
      ]),
    });

    expect(await authorizedRuntime.getCheckpoint("run-a")).toEqual(checkpoint);
    expect((await authorizedRuntime.getArtifacts("run-a"))[0]?.kind).toBe("report");
    expect((await authorizedRuntime.pauseRun("run-a")).status).toBe("pause_requested");
    expect((await authorizedRuntime.cancelRun("paused-run")).status).toBe("canceled");
  });

  it("reads and resolves approval records through the control plane", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun({
      ...baseRun("run-a"),
      status: "approval_required",
      taskCalls: 0,
      taskNames: [],
      taskIds: [],
      pendingApprovalId: "approval-1",
      pendingApproval: {
        id: "approval-1",
        kind: "tool",
        tool: "delete",
        args: { id: "123" },
        reason: "manual approval required",
        requestedAt: "2026-04-03T00:00:00.000Z",
        status: "pending",
      },
    });
    await store.persistApproval({
      id: "approval-1",
      runId: "run-a",
      kind: "tool",
      tool: "delete",
      args: { id: "123" },
      reason: "manual approval required",
      requestedAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      status: "pending",
    });

    const runtime = await openHarnessRuntime(rootDir);

    expect(await runtime.getApproval("approval-1")).toMatchObject({
      id: "approval-1",
      runId: "run-a",
      status: "pending",
    });
    expect(await runtime.listApprovals("run-a")).toEqual([
      expect.objectContaining({
        id: "approval-1",
        runId: "run-a",
      }),
    ]);

    const approved = await runtime.approveRun("run-a", {
      note: "approved from control plane",
      access: {
        subject: {
          id: "operator-1",
        },
      },
    });

    expect(approved).toMatchObject({
      id: "approval-1",
      status: "approved",
      resolutionNote: "approved from control plane",
      resolvedBy: {
        id: "operator-1",
      },
    });
    expect((await runtime.getRun("run-a"))?.pendingApproval).toMatchObject({
      id: "approval-1",
      status: "approved",
      resolutionNote: "approved from control plane",
    });
    expect((await runtime.getEvents("run-a")).map((event) => event.type)).toEqual([
      "approval_approved",
    ]);
  });

  it("requires approval-scoped grants for approval reads and resolution actions", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun({
      ...baseRun("run-a"),
      status: "approval_required",
      taskCalls: 0,
      taskNames: [],
      taskIds: [],
      pendingApprovalId: "approval-1",
      pendingApproval: {
        id: "approval-1",
        kind: "tool",
        tool: "delete",
        args: { id: "123" },
        reason: "manual approval required",
        requestedAt: "2026-04-03T00:00:00.000Z",
        status: "pending",
      },
    });
    await store.persistApproval({
      id: "approval-1",
      runId: "run-a",
      kind: "tool",
      tool: "delete",
      args: { id: "123" },
      reason: "manual approval required",
      requestedAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      status: "pending",
    });
    await store.persistRun({
      ...baseRun("run-b"),
      status: "approval_required",
      taskCalls: 0,
      taskNames: [],
      taskIds: [],
      pendingApprovalId: "approval-2",
      pendingApproval: {
        id: "approval-2",
        kind: "tool",
        tool: "delete",
        args: { id: "999" },
        reason: "manual approval required",
        requestedAt: "2026-04-03T00:01:00.000Z",
        status: "pending",
      },
    });
    await store.persistApproval({
      id: "approval-2",
      runId: "run-b",
      kind: "tool",
      tool: "delete",
      args: { id: "999" },
      reason: "manual approval required",
      requestedAt: "2026-04-03T00:01:00.000Z",
      updatedAt: "2026-04-03T00:01:00.000Z",
      status: "pending",
    });

    const runtime = await openHarnessRuntime({
      rootDir,
      authorize: createGrantAuthorizer([
        ...grantApprovalActions(["list"], { runId: "run-a" }),
        ...grantApprovalActions(["read", "approve"], {
          approvalId: "approval-1",
          runId: "run-a",
          tool: "delete",
        }),
        ...grantEventActions("run-a"),
      ]),
    });

    expect((await runtime.listApprovals("run-a")).map((approval) => approval.id)).toEqual([
      "approval-1",
    ]);
    await expect(runtime.getApproval("approval-2")).rejects.toThrow(
      "Harness access denied for approval:read for run run-b",
    );
    await expect(runtime.approveRun("run-b")).rejects.toThrow(
      "Harness access denied for approval:approve for run run-b",
    );

    const approved = await runtime.approveRun("run-a");
    expect(approved.status).toBe("approved");
  });

  it("filters approval listings by approval-read grants even when the collection grant allows the run", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun({
      ...baseRun("run-a"),
      status: "approval_required",
      taskCalls: 0,
      taskNames: [],
      taskIds: [],
      pendingApprovalId: "approval-1",
      pendingApproval: {
        id: "approval-1",
        kind: "tool",
        tool: "delete",
        args: { id: "123" },
        reason: "manual approval required",
        requestedAt: "2026-04-03T00:00:00.000Z",
        status: "pending",
      },
    });
    await store.persistApproval({
      id: "approval-1",
      runId: "run-a",
      kind: "tool",
      tool: "delete",
      args: { id: "123" },
      reason: "manual approval required",
      requestedAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      status: "pending",
    });
    await store.persistApproval({
      id: "approval-2",
      runId: "run-a",
      kind: "task",
      tool: "deploy",
      args: { version: "v1" },
      reason: "task approval required",
      requestedAt: "2026-04-03T00:01:00.000Z",
      updatedAt: "2026-04-03T00:01:00.000Z",
      status: "pending",
    });

    const runtime = await openHarnessRuntime({
      rootDir,
      authorize: createGrantAuthorizer([
        ...grantApprovalCollectionActions(["list"], { runId: "run-a" }),
        ...grantApprovalActions(["read"], {
          approvalId: "approval-1",
          runId: "run-a",
          tool: "delete",
        }),
      ]),
    });

    expect((await runtime.listApprovals("run-a")).map((approval) => approval.id)).toEqual([
      "approval-1",
    ]);
    await expect(runtime.getApproval("approval-2")).rejects.toThrow(
      "Harness access denied for approval:read for run run-a",
    );
  });

  it("keeps approval approval idempotent once a record has already been approved", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun({
      ...baseRun("run-approve"),
      status: "approval_required",
      taskCalls: 0,
      taskNames: [],
      taskIds: [],
      pendingApprovalId: "approval-approve",
      pendingApproval: {
        id: "approval-approve",
        kind: "tool",
        tool: "delete",
        args: { id: "777" },
        reason: "manual approval required",
        requestedAt: "2026-04-03T00:00:00.000Z",
        status: "pending",
      },
    });
    await store.persistApproval({
      id: "approval-approve",
      runId: "run-approve",
      kind: "tool",
      tool: "delete",
      args: { id: "777" },
      reason: "manual approval required",
      requestedAt: "2026-04-03T00:00:00.000Z",
      updatedAt: "2026-04-03T00:00:00.000Z",
      status: "pending",
    });

    const runtime = await openHarnessRuntime(rootDir);
    const first = await runtime.approveRun("run-approve", {
      note: "approved from control plane",
      access: {
        subject: {
          id: "operator-7",
        },
      },
    });
    const second = await runtime.approveRun("run-approve", {
      note: "ignored",
      access: {
        subject: {
          id: "operator-8",
        },
      },
    });

    expect(first).toMatchObject({
      id: "approval-approve",
      status: "approved",
      resolutionNote: "approved from control plane",
    });
    expect(second).toMatchObject({
      id: "approval-approve",
      status: "approved",
      resolutionNote: "approved from control plane",
    });

    const events = await runtime.getEvents("run-approve");
    expect(events.map((event) => event.type).filter((type) => type === "approval_approved")).toHaveLength(1);
    expect((await runtime.getRun("run-approve"))?.pendingApproval).toMatchObject({
      status: "approved",
      resolutionNote: "approved from control plane",
    });
  });

  it("cancels blocked runs by recording approval_canceled before run_canceled", async () => {
    const rootDir = await createTempDir();
    const store = new FileHarnessRuntimeStore(rootDir);
    await store.persistRun({
      ...baseRun("run-cancel"),
      status: "approval_required",
      taskCalls: 0,
      taskNames: [],
      taskIds: [],
      pendingApprovalId: "approval-cancel",
      pendingApproval: {
        id: "approval-cancel",
        kind: "tool",
        tool: "delete",
        args: { id: "555" },
        reason: "manual approval required",
        requestedAt: "2026-04-03T00:02:00.000Z",
        status: "pending",
      },
    });
    await store.persistApproval({
      id: "approval-cancel",
      runId: "run-cancel",
      kind: "tool",
      tool: "delete",
      args: { id: "555" },
      reason: "manual approval required",
      requestedAt: "2026-04-03T00:02:00.000Z",
      updatedAt: "2026-04-03T00:02:00.000Z",
      status: "pending",
    });

    const runtime = await openHarnessRuntime({
      rootDir,
      authorize: createHarnessGrantAuthorizer([
        ...grantApprovalCollectionActions(["list"]),
        ...grantApprovalActions(["read"], {
          approvalId: "approval-cancel",
          runId: "run-cancel",
          tool: "delete",
        }),
        ...grantEventActions("run-cancel"),
        ...grantRunActions("run-cancel", ["read", "cancel"]),
      ]),
    });

    const canceled = await runtime.cancelRun("run-cancel");
    expect(canceled.status).toBe("canceled");
    expect(canceled.pendingApprovalId).toBeUndefined();
    expect(await runtime.getApproval("approval-cancel")).toMatchObject({
      status: "canceled",
    });
    expect((await runtime.getEvents("run-cancel")).map((event) => event.type)).toEqual([
      "approval_canceled",
      "run_canceled",
    ]);
  });
});

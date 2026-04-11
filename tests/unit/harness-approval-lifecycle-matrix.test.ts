import { describe, expect, it } from "bun:test";

import {
  approvalToPendingApproval,
  buildApprovalDetail,
  ensureRunApprovalRecord,
  resolveRunApproval,
} from "../../packages/ai/src/harness/runtime/approvals.ts";
import type {
  HarnessApprovalRecord,
  HarnessApprovalStatus,
  HarnessRunEventRecord,
  HarnessRunRecord,
  HarnessRuntimeStore,
} from "../../packages/ai/src/harness/types.ts";

const FIXED_TIMESTAMP = "2026-04-04T12:00:00.000Z";

type ApprovalPatch = Partial<Omit<HarnessApprovalRecord, "id" | "runId" | "requestedAt">>;
type RunPatch = Partial<Omit<HarnessRunRecord, "id" | "createdAt">>;

type CallLog = {
  persistedApprovals: HarnessApprovalRecord[];
  patchApprovalCalls: Array<{ approvalId: string; patch: ApprovalPatch }>;
  patchRunCalls: Array<{ runId: string; patch: RunPatch }>;
  transitionRunCalls: Array<{
    runId: string;
    type: HarnessRunEventRecord["type"];
    patch: RunPatch;
    data: Record<string, unknown>;
  }>;
};

function createApproval(
  patch: Partial<HarnessApprovalRecord> = {},
): HarnessApprovalRecord {
  return {
    id: "approval-1",
    runId: "run-1",
    kind: "tool",
    tool: "ticket.delete",
    args: {
      ticketId: "ticket-1",
    },
    reason: "manual approval required",
    requestedAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    status: "pending",
    ...patch,
  };
}

function createRun(
  patch: Partial<HarnessRunRecord> = {},
): HarnessRunRecord {
  return {
    id: "run-1",
    goal: "ship the change",
    status: "approval_required",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    iterations: 3,
    toolCalls: 1,
    taskCalls: 0,
    maxIterations: 8,
    toolNames: ["ticket.delete"],
    taskNames: [],
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: false,
      artifactDir: "/tmp/artifacts/run-1",
    },
    pendingApprovalId: "approval-1",
    pendingApproval: {
      id: "approval-1",
      kind: "tool",
      tool: "ticket.delete",
      args: { ticketId: "ticket-1" },
      reason: "manual approval required",
      requestedAt: "2026-04-04T00:00:00.000Z",
      status: "pending",
    },
    lastEventSequence: 12,
    ...patch,
  };
}

function createStore(initial: {
  run?: HarnessRunRecord;
  approval?: HarnessApprovalRecord;
}): { store: HarnessRuntimeStore; calls: CallLog } {
  const runs = new Map<string, HarnessRunRecord>();
  const approvals = new Map<string, HarnessApprovalRecord>();
  const calls: CallLog = {
    persistedApprovals: [],
    patchApprovalCalls: [],
    patchRunCalls: [],
    transitionRunCalls: [],
  };

  if (initial.run) {
    runs.set(initial.run.id, initial.run);
  }
  if (initial.approval) {
    approvals.set(initial.approval.id, initial.approval);
  }

  const store: HarnessRuntimeStore = {
    paths: {
      rootDir: "/tmp/capstan",
      runsDir: "/tmp/capstan/runs",
      eventsDir: "/tmp/capstan/events",
      globalEventsPath: "/tmp/capstan/events.ndjson",
      artifactsDir: "/tmp/capstan/artifacts",
      tasksDir: "/tmp/capstan/tasks",
      approvalsDir: "/tmp/capstan/approvals",
      checkpointsDir: "/tmp/capstan/checkpoints",
      summariesDir: "/tmp/capstan/summaries",
      sessionMemoryDir: "/tmp/capstan/session-memory",
      memoryDir: "/tmp/capstan/memory",
      sandboxesDir: "/tmp/capstan/sandboxes",
    },
    async initialize() {},
    async persistRun(run) {
      runs.set(run.id, { ...run });
    },
    async getRun(runId) {
      return runs.get(runId);
    },
    async listRuns() {
      return [...runs.values()];
    },
    async appendEvent(_event) {},
    async getEvents(_runId?) {
      return [];
    },
    async writeArtifact() {
      throw new Error("not implemented");
    },
    async getArtifacts() {
      return [];
    },
    async persistTask() {
      throw new Error("not implemented");
    },
    async patchTask() {
      throw new Error("not implemented");
    },
    async getTasks() {
      return [];
    },
    async persistApproval(record) {
      calls.persistedApprovals.push({ ...record });
      approvals.set(record.id, { ...record });
    },
    async getApproval(approvalId) {
      return approvals.get(approvalId);
    },
    async listApprovals(runId?) {
      return [...approvals.values()].filter((approval) =>
        runId ? approval.runId === runId : true,
      );
    },
    async patchApproval(approvalId, patch) {
      const current = approvals.get(approvalId);
      if (!current) {
        throw new Error(`Harness approval not found: ${approvalId}`);
      }
      const next: HarnessApprovalRecord = {
        ...current,
        ...patch,
        updatedAt: FIXED_TIMESTAMP,
      };
      approvals.set(approvalId, next);
      calls.patchApprovalCalls.push({
        approvalId,
        patch: { ...patch },
      });
      return next;
    },
    async persistCheckpoint() {
      throw new Error("not implemented");
    },
    async getCheckpoint() {
      return undefined;
    },
    async persistSessionMemory() {
      throw new Error("not implemented");
    },
    async getSessionMemory() {
      return undefined;
    },
    async persistSummary() {
      throw new Error("not implemented");
    },
    async getLatestSummary() {
      return undefined;
    },
    async listSummaries() {
      return [];
    },
    async rememberMemory() {
      throw new Error("not implemented");
    },
    async recallMemory() {
      return [];
    },
    async readArtifactPreview() {
      return undefined;
    },
    async patchRun(runId, patch) {
      const current = runs.get(runId);
      if (!current) {
        throw new Error(`Harness run not found: ${runId}`);
      }
      const next: HarnessRunRecord = {
        ...current,
        ...patch,
        updatedAt: FIXED_TIMESTAMP,
        lastEventSequence: patch.lastEventSequence ?? current.lastEventSequence,
      };
      runs.set(runId, next);
      calls.patchRunCalls.push({
        runId,
        patch: { ...patch },
      });
      return next;
    },
    async transitionRun(runId, type, patch, data) {
      const current = runs.get(runId);
      if (!current) {
        throw new Error(`Harness run not found: ${runId}`);
      }
      const next: HarnessRunRecord = {
        ...current,
        ...patch,
        updatedAt: FIXED_TIMESTAMP,
        lastEventSequence: current.lastEventSequence + 1,
      };
      runs.set(runId, next);
      calls.transitionRunCalls.push({
        runId,
        type,
        patch: { ...patch },
        data: { ...data },
      });
      return next;
    },
    async requestPause() {
      throw new Error("not implemented");
    },
    async requestCancel() {
      throw new Error("not implemented");
    },
    async replayRun() {
      throw new Error("not implemented");
    },
    async clearRunArtifacts() {},
    async requireRun(runId) {
      const current = runs.get(runId);
      if (!current) {
        throw new Error(`Harness run not found: ${runId}`);
      }
      return current;
    },
  };

  return { store, calls };
}

function summarizeApproval(approval: HarnessApprovalRecord) {
  return {
    id: approval.id,
    runId: approval.runId,
    kind: approval.kind,
    tool: approval.tool,
    status: approval.status,
    requestedAt: approval.requestedAt,
    ...(approval.resolvedAt ? { resolvedAt: approval.resolvedAt } : {}),
    ...(approval.resolutionNote ? { resolutionNote: approval.resolutionNote } : {}),
    ...(approval.resolvedBy ? { resolvedBy: approval.resolvedBy } : {}),
  };
}

describe("harness approval lifecycle matrix", () => {
  describe("buildApprovalDetail", () => {
    it("projects the approval and its pending view without losing the original record", () => {
      const approval = createApproval({
        status: "approved",
        resolvedAt: "2026-04-04T00:05:00.000Z",
        resolutionNote: "ship it",
        resolvedBy: {
          id: "operator-1",
          kind: "user",
          role: "ops",
        },
      });

      const detail = buildApprovalDetail(approval);

      expect(detail.approval).toBe(approval);
      expect(detail).toMatchObject({
        approvalId: approval.id,
        runId: approval.runId,
        tool: approval.tool,
        kind: approval.kind,
        status: approval.status,
      });
      expect(detail.pendingApproval).toEqual({
        id: approval.id,
        kind: approval.kind,
        tool: approval.tool,
        args: approval.args,
        reason: approval.reason,
        requestedAt: approval.requestedAt,
        status: approval.status,
        resolvedAt: approval.resolvedAt,
        resolutionNote: approval.resolutionNote,
      });
      expect(detail.pendingApproval).not.toHaveProperty("runId");
      expect(detail.pendingApproval).not.toHaveProperty("updatedAt");
      expect(detail.pendingApproval).not.toHaveProperty("resolvedBy");
    });

    it("handles terminal approvals for both tool and task records", () => {
      const cases: Array<{
        approval: HarnessApprovalRecord;
        expected: ReturnType<typeof summarizeApproval>;
      }> = [
        {
          approval: createApproval({
            id: "approval-tool",
            status: "approved",
            resolvedAt: "2026-04-04T00:10:00.000Z",
            resolutionNote: "tool approved",
          }),
          expected: {
            id: "approval-tool",
            runId: "run-1",
            kind: "tool",
            tool: "ticket.delete",
            status: "approved",
            requestedAt: "2026-04-04T00:00:00.000Z",
            resolvedAt: "2026-04-04T00:10:00.000Z",
            resolutionNote: "tool approved",
          },
        },
        {
          approval: createApproval({
            id: "approval-task",
            kind: "task",
            tool: "deploy.release",
            status: "canceled",
            resolvedAt: "2026-04-04T00:11:00.000Z",
            resolutionNote: "cancelled by operator",
          }),
          expected: {
            id: "approval-task",
            runId: "run-1",
            kind: "task",
            tool: "deploy.release",
            status: "canceled",
            requestedAt: "2026-04-04T00:00:00.000Z",
            resolvedAt: "2026-04-04T00:11:00.000Z",
            resolutionNote: "cancelled by operator",
          },
        },
      ];

      for (const { approval, expected } of cases) {
        const detail = buildApprovalDetail(approval);
        expect(detail.approval).toBe(approval);
        expect(detail.pendingApproval).toMatchObject({
          id: expected.id,
          kind: expected.kind,
          tool: expected.tool,
          status: expected.status,
          requestedAt: expected.requestedAt,
        });
        expect(detail.pendingApproval).toMatchObject(
          expected.resolvedAt ? { resolvedAt: expected.resolvedAt } : {},
        );
        expect(detail.pendingApproval).toMatchObject(
          expected.resolutionNote ? { resolutionNote: expected.resolutionNote } : {},
        );
      }
    });
  });

  describe("approvalToPendingApproval", () => {
    it("preserves the fields that keep a run resumable", () => {
      const approval = createApproval({
        status: "approved",
        resolvedAt: "2026-04-04T00:05:00.000Z",
        resolutionNote: "ship it",
        resolvedBy: { id: "operator-1" },
      });

      expect(approvalToPendingApproval(approval)).toEqual({
        id: approval.id,
        kind: approval.kind,
        tool: approval.tool,
        args: approval.args,
        reason: approval.reason,
        requestedAt: approval.requestedAt,
        status: approval.status,
        resolvedAt: approval.resolvedAt,
        resolutionNote: approval.resolutionNote,
      });
    });

    it("preserves canceled approvals as pending snapshots without the terminal actor", () => {
      const approval = createApproval({
        kind: "task",
        tool: "deploy.release",
        status: "canceled",
        resolvedAt: "2026-04-04T00:05:00.000Z",
        resolutionNote: "canceled by operator",
        resolvedBy: { id: "operator-2", role: "ops" },
      });

      const pending = approvalToPendingApproval(approval);
      expect(pending).toEqual({
        id: approval.id,
        kind: "task",
        tool: "deploy.release",
        args: approval.args,
        reason: approval.reason,
        requestedAt: approval.requestedAt,
        status: "canceled",
        resolvedAt: "2026-04-04T00:05:00.000Z",
        resolutionNote: "canceled by operator",
      });
      expect(pending).not.toHaveProperty("resolvedBy");
    });

    it("keeps nested args payloads untouched", () => {
      const approval = createApproval({
        args: {
          nested: {
            steps: ["review", "approve"],
            dryRun: false,
          },
          ticketIds: ["ticket-1", "ticket-2"],
        },
      });

      expect(approvalToPendingApproval(approval)).toEqual({
        id: approval.id,
        kind: approval.kind,
        tool: approval.tool,
        args: approval.args,
        reason: approval.reason,
        requestedAt: approval.requestedAt,
        status: approval.status,
      });
    });
  });

  describe("ensureRunApprovalRecord", () => {
    it("creates and syncs a missing approval record from the pending run payload", async () => {
      const run = createRun({
        pendingApprovalId: undefined,
        pendingApproval: {
          id: "   ",
          kind: undefined,
          tool: "ticket.delete",
          args: {
            ticketId: "ticket-1",
          },
          reason: "manual approval required",
          requestedAt: "   ",
          status: undefined,
        } as unknown as HarnessRunRecord["pendingApproval"],
      });
      const { store, calls } = createStore({ run });

      const ensured = await ensureRunApprovalRecord(store, run);

      expect(ensured.run.pendingApprovalId).toBeString();
      expect(ensured.run.pendingApproval?.id).toBe(ensured.run.pendingApprovalId);
      expect(ensured.run.pendingApproval).toMatchObject({
        kind: "tool",
        tool: "ticket.delete",
        reason: "manual approval required",
        status: "pending",
      });
      expect(calls.persistedApprovals).toHaveLength(1);
      expect(calls.patchRunCalls).toHaveLength(1);
      expect(calls.patchRunCalls[0]?.patch).toMatchObject({
        pendingApprovalId: ensured.run.pendingApprovalId,
      });
      expect(calls.patchRunCalls[0]?.patch.pendingApproval).toMatchObject({
        id: ensured.run.pendingApprovalId,
        kind: "tool",
        tool: "ticket.delete",
        reason: "manual approval required",
        status: "pending",
      });
    });

    it("repairs a mismatched run snapshot without changing the persisted approval", async () => {
      const approval = createApproval({
        id: "approval-2",
        runId: "run-2",
        kind: "task",
        tool: "deploy.release",
        reason: "release requires approval",
      });
      const run = createRun({
        id: "run-2",
        pendingApprovalId: "approval-2",
        pendingApproval: {
          id: "approval-2",
          kind: "task",
          tool: "deploy.release",
          args: { version: "1.0.0" },
          reason: "stale reason",
          requestedAt: "2026-04-04T00:00:00.000Z",
          status: "pending",
        },
      });
      const { store, calls } = createStore({ run, approval });

      const ensured = await ensureRunApprovalRecord(store, run);

      expect(ensured.approval.id).toBe("approval-2");
      expect(ensured.run.pendingApproval).toEqual({
        id: "approval-2",
        kind: "task",
        tool: "deploy.release",
        args: approval.args,
        reason: approval.reason,
        requestedAt: approval.requestedAt,
        status: "pending",
      });
      expect(calls.persistedApprovals).toHaveLength(0);
      expect(calls.patchRunCalls).toHaveLength(1);
      expect(calls.patchRunCalls[0]?.patch.pendingApproval).toMatchObject({
        id: "approval-2",
        reason: "release requires approval",
      });
    });

    it("returns the current run untouched when the persisted approval already matches", async () => {
      const approval = createApproval({
        id: "approval-3",
        runId: "run-3",
        tool: "deploy.release",
      });
      const run = createRun({
        id: "run-3",
        pendingApprovalId: "approval-3",
        pendingApproval: approvalToPendingApproval(approval),
      });
      const { store, calls } = createStore({ run, approval });

      const ensured = await ensureRunApprovalRecord(store, run);

      expect(ensured.run).toBe(run);
      expect(ensured.approval).toBe(approval);
      expect(calls.persistedApprovals).toHaveLength(0);
      expect(calls.patchRunCalls).toHaveLength(0);
    });

    it("rejects runs that are not waiting for approval", async () => {
      const run = createRun({
        status: "running",
        pendingApprovalId: undefined,
        pendingApproval: undefined,
      });
      const { store } = createStore({ run });

      await expect(ensureRunApprovalRecord(store, run)).rejects.toThrow(
        "Harness run run-1 has no pending approval",
      );
    });

    it("rejects approval-required runs that lost their pending approval payload", async () => {
      const run = createRun({
        pendingApprovalId: undefined,
        pendingApproval: undefined,
      });
      const { store } = createStore({ run });

      await expect(ensureRunApprovalRecord(store, run)).rejects.toThrow(
        "Harness run run-1 has no pending approval",
      );
    });
  });

  describe("resolveRunApproval", () => {
    it("approves a pending approval and records the resolvedBy subject and note", async () => {
      const approval = createApproval({
        id: "approval-10",
        runId: "run-10",
        tool: "ticket.delete",
      });
      const run = createRun({
        id: "run-10",
        pendingApprovalId: "approval-10",
        pendingApproval: approvalToPendingApproval(approval),
      });
      const { store, calls } = createStore({ run, approval });

      const result = await resolveRunApproval(store, run, "approved", {
        access: {
          subject: {
            id: "operator-1",
            kind: "user",
            role: "ops",
          },
        },
        note: "  ship it  ",
      });

      expect(result.changed).toBe(true);
      expect(result.approval).toMatchObject({
        id: "approval-10",
        status: "approved",
        resolutionNote: "ship it",
        resolvedBy: {
          id: "operator-1",
          kind: "user",
          role: "ops",
        },
      });
      expect(result.approval.resolvedAt).toBeString();
      expect(calls.patchApprovalCalls).toHaveLength(1);
      expect(calls.patchApprovalCalls[0]).toMatchObject({
        approvalId: "approval-10",
        patch: {
          status: "approved",
          resolutionNote: "ship it",
          resolvedBy: {
            id: "operator-1",
            kind: "user",
            role: "ops",
          },
        },
      });
      expect(calls.patchApprovalCalls[0]?.patch.resolvedAt).toBeString();
      expect(calls.transitionRunCalls).toHaveLength(1);
      expect(calls.transitionRunCalls[0]).toMatchObject({
        runId: "run-10",
        type: "approval_approved",
        patch: {
          pendingApprovalId: "approval-10",
          pendingApproval: {
            id: "approval-10",
            kind: "tool",
            tool: "ticket.delete",
            reason: "manual approval required",
            status: "approved",
            resolutionNote: "ship it",
          },
        },
      });
      expect(calls.transitionRunCalls[0]?.patch.pendingApproval).toMatchObject({
        id: "approval-10",
        status: "approved",
        resolutionNote: "ship it",
      });
      expect(
        (calls.transitionRunCalls[0]?.patch.pendingApproval as Record<string, unknown> | undefined)
          ?.resolvedAt,
      ).toBeString();
      expect(calls.transitionRunCalls[0]?.data).toMatchObject({
        approvalId: "approval-10",
        kind: "tool",
        tool: "ticket.delete",
        status: "approved",
        resolutionNote: "ship it",
        resolvedBy: {
          id: "operator-1",
          kind: "user",
          role: "ops",
        },
      });
      expect(calls.transitionRunCalls[0]?.data.resolvedAt).toBeString();
    });

    it("denies a pending approval and normalizes primitive subjects into resolvedBy", async () => {
      const approval = createApproval({
        id: "approval-11",
        runId: "run-11",
        kind: "task",
        tool: "deploy.release",
      });
      const run = createRun({
        id: "run-11",
        pendingApprovalId: "approval-11",
        pendingApproval: approvalToPendingApproval(approval),
      });
      const { store, calls } = createStore({ run, approval });

      const result = await resolveRunApproval(store, run, "denied", {
        access: {
          subject: "operator-7",
        },
        note: "   ",
      });

      expect(result.changed).toBe(true);
      expect(result.approval).toMatchObject({
        id: "approval-11",
        status: "denied",
      });
      expect(result.approval.resolvedAt).toBeString();
      expect(result.approval.resolutionNote).toBeUndefined();
      expect(result.approval.resolvedBy).toEqual({
        value: "operator-7",
      });
      expect(calls.patchApprovalCalls[0]).toMatchObject({
        approvalId: "approval-11",
        patch: {
          status: "denied",
          resolvedBy: {
            value: "operator-7",
          },
        },
      });
      expect(calls.patchApprovalCalls[0]?.patch).toMatchObject({
        status: "denied",
      });
      expect(calls.patchApprovalCalls[0]?.patch.resolvedAt).toBeString();
      expect(calls.transitionRunCalls[0]?.type).toBe("approval_denied");
      expect(calls.transitionRunCalls[0]?.patch.pendingApproval).toMatchObject({
        status: "denied",
      });
      expect(
        (calls.transitionRunCalls[0]?.patch.pendingApproval as Record<string, unknown> | undefined)
          ?.resolvedAt,
      ).toBeString();
    });

    it("cancels a pending approval and writes the cancellation through the run transition", async () => {
      const approval = createApproval({
        id: "approval-12",
        runId: "run-12",
        tool: "ticket.delete",
      });
      const run = createRun({
        id: "run-12",
        pendingApprovalId: "approval-12",
        pendingApproval: approvalToPendingApproval(approval),
      });
      const { store, calls } = createStore({ run, approval });

      const result = await resolveRunApproval(store, run, "canceled", {
        access: {
          subject: {
            id: "operator-9",
          },
        },
        note: " canceled from queue ",
      });

      expect(result.changed).toBe(true);
      expect(result.approval).toMatchObject({
        id: "approval-12",
        status: "canceled",
        resolutionNote: "canceled from queue",
        resolvedBy: {
          id: "operator-9",
        },
      });
      expect(result.approval.resolvedAt).toBeString();
      expect(calls.transitionRunCalls[0]).toMatchObject({
        runId: "run-12",
        type: "approval_canceled",
        patch: {
          pendingApprovalId: "approval-12",
          pendingApproval: {
            id: "approval-12",
            kind: "tool",
            tool: "ticket.delete",
            reason: "manual approval required",
            status: "canceled",
            resolutionNote: "canceled from queue",
          },
        },
      });
      expect(calls.transitionRunCalls[0]?.patch.pendingApproval).toMatchObject({
        id: "approval-12",
        status: "canceled",
        resolutionNote: "canceled from queue",
      });
      expect(
        (calls.transitionRunCalls[0]?.patch.pendingApproval as Record<string, unknown> | undefined)
          ?.resolvedAt,
      ).toBeString();
      expect(calls.transitionRunCalls[0]?.data).toMatchObject({
        status: "canceled",
        resolutionNote: "canceled from queue",
      });
      expect(calls.transitionRunCalls[0]?.data.resolvedAt).toBeString();
    });

    it("does not patch or transition when the approval is already in the requested terminal state", async () => {
      const approval = createApproval({
        id: "approval-13",
        runId: "run-13",
        status: "approved",
        resolvedAt: "2026-04-04T01:00:00.000Z",
        resolutionNote: "already approved",
        resolvedBy: {
          id: "operator-1",
        },
      });
      const run = createRun({
        id: "run-13",
        pendingApprovalId: "approval-13",
        pendingApproval: approvalToPendingApproval(approval),
      });
      const { store, calls } = createStore({ run, approval });

      const result = await resolveRunApproval(store, run, "approved");

      expect(result.changed).toBe(false);
      expect(result.approval).toBe(approval);
      expect(result.run).toBe(run);
      expect(calls.patchApprovalCalls).toHaveLength(0);
      expect(calls.transitionRunCalls).toHaveLength(0);
    });

    it("rejects a second resolution attempt that tries to change a terminal approval", async () => {
      const approval = createApproval({
        id: "approval-14",
        runId: "run-14",
        status: "approved",
        resolvedAt: "2026-04-04T01:00:00.000Z",
        resolutionNote: "approved already",
      });
      const run = createRun({
        id: "run-14",
        pendingApprovalId: "approval-14",
        pendingApproval: approvalToPendingApproval(approval),
      });
      const { store } = createStore({ run, approval });

      await expect(resolveRunApproval(store, run, "denied")).rejects.toThrow(
        "Harness approval approval-14 is already approved and cannot become denied",
      );
    });

    it("keeps the approval metadata stable across all terminal transitions", async () => {
      const cases: Array<{
        status: HarnessApprovalStatus;
        eventType: "approval_approved" | "approval_denied" | "approval_canceled";
        note: string;
      }> = [
        {
          status: "approved",
          eventType: "approval_approved",
          note: "ship it",
        },
        {
          status: "denied",
          eventType: "approval_denied",
          note: "not ready",
        },
        {
          status: "canceled",
          eventType: "approval_canceled",
          note: "operator canceled it",
        },
      ];

      for (const testCase of cases) {
        const approval = createApproval({
          id: `approval-${testCase.status}`,
          runId: `run-${testCase.status}`,
        });
        const run = createRun({
          id: `run-${testCase.status}`,
          pendingApprovalId: approval.id,
          pendingApproval: approvalToPendingApproval(approval),
        });
        const { store, calls } = createStore({ run, approval });

        const result = await resolveRunApproval(store, run, testCase.status, {
          access: { subject: { id: "operator-1" } },
          note: `  ${testCase.note}  `,
        });

        expect(result.changed).toBe(true);
        expect(result.approval).toMatchObject({
          id: approval.id,
          runId: run.id,
          status: testCase.status,
          resolutionNote: testCase.note,
        });
        expect(result.approval.resolvedAt).toBeString();
        expect(calls.transitionRunCalls[0]?.type).toBe(testCase.eventType);
        expect(calls.transitionRunCalls[0]?.patch).toMatchObject({
          pendingApprovalId: approval.id,
          pendingApproval: {
            id: approval.id,
            status: testCase.status,
            resolutionNote: testCase.note,
          },
        });
        expect(
          (calls.transitionRunCalls[0]?.patch.pendingApproval as Record<string, unknown> | undefined)
            ?.resolvedAt,
        ).toBeString();
      }
    });
  });
});

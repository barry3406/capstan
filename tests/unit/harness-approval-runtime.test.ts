import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createHarness, openHarnessRuntime } from "@zauso-ai/capstan-ai";
import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "@zauso-ai/capstan-ai";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function mockLLM(
  responses: Array<string | (() => Promise<string> | string)>,
): LLMProvider {
  let index = 0;
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const next = responses[index++];
      return {
        content: typeof next === "function" ? await next() : next,
        model: "mock-1",
      };
    },
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-approval-"));
  tempDirs.push(dir);
  return dir;
}

function approvalLifecycle(events: Array<{ type: string }>): string[] {
  return events
    .map((event) => event.type)
    .filter(
      (type) =>
        type !== "memory_stored" &&
        type !== "summary_created" &&
        type !== "context_compacted" &&
        type !== "governance_decision" &&
        type !== "sidecar_started" &&
        type !== "sidecar_completed" &&
        type !== "sidecar_failed",
    );
}

describe("createHarness approval lifecycle", () => {
  it("persists approval records and exposes them through both harness and control-plane readers", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "pending" } }),
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "write requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "block one write",
      tools: [
        {
          name: "write",
          description: "writes a value",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });

    expect(blocked.runtimeStatus).toBe("approval_required");

    const run = await harness.getRun(blocked.runId);
    expect(run?.pendingApprovalId).toBeString();
    expect(run?.pendingApproval).toMatchObject({
      id: run?.pendingApprovalId,
      kind: "tool",
      tool: "write",
      status: "pending",
      reason: "write requires approval",
    });

    const approval = await harness.getApproval(run!.pendingApprovalId!);
    expect(approval).toMatchObject({
      id: run!.pendingApprovalId,
      runId: blocked.runId,
      kind: "tool",
      tool: "write",
      status: "pending",
      reason: "write requires approval",
    });
    expect(approval?.requestedAt).toBeString();
    expect(approval?.updatedAt).toBeString();

    const scopedApprovals = await harness.listApprovals(blocked.runId);
    expect(scopedApprovals).toHaveLength(1);
    expect(scopedApprovals[0]?.id).toBe(run?.pendingApprovalId);

    const runtime = await openHarnessRuntime(rootDir);
    expect(await runtime.getApproval(run!.pendingApprovalId!)).toEqual(approval);
    expect((await runtime.listApprovals()).map((entry) => entry.id)).toEqual([
      run!.pendingApprovalId,
    ]);

    const events = await harness.getEvents(blocked.runId);
    expect(approvalLifecycle(events)).toEqual([
      "run_started",
      "tool_call",
      "approval_required",
    ]);
    expect(events.find((event) => event.type === "approval_required")?.data).toMatchObject({
      tool: "write",
      reason: "write requires approval",
      args: {
        value: "pending",
      },
      iterations: 1,
    });
  });

  it("records approval audit metadata and resumes approved runs without re-supplying approvePendingTool", async () => {
    const rootDir = await createTempDir();
    const writes: string[] = [];
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "approved" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "write requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "approve then resume",
      tools: [
        {
          name: "write",
          description: "writes a value",
          async execute(args) {
            writes.push(String(args.value));
            return { ok: true };
          },
        },
      ],
    });

    const blockedRun = await harness.getRun(blocked.runId);
    const approvalId = blockedRun?.pendingApprovalId;
    expect(approvalId).toBeString();

    const approval = await harness.approveRun(blocked.runId, {
      note: "ship it",
      access: {
        subject: {
          id: "operator-1",
          kind: "user",
        },
      },
    });

    expect(approval).toMatchObject({
      id: approvalId,
      status: "approved",
      resolutionNote: "ship it",
      resolvedBy: {
        id: "operator-1",
        kind: "user",
      },
    });
    expect(approval.resolvedAt).toBeString();

    const approvedRun = await harness.getRun(blocked.runId);
    expect(approvedRun?.status).toBe("approval_required");
    expect(approvedRun?.pendingApproval).toMatchObject({
      id: approvalId,
      status: "approved",
      resolutionNote: "ship it",
    });

    const resumed = await harness.resumeRun(blocked.runId);
    expect(resumed.runtimeStatus).toBe("completed");
    expect(writes).toEqual(["approved"]);

    const finalRun = await harness.getRun(blocked.runId);
    expect(finalRun?.status).toBe("completed");
    expect(finalRun?.pendingApprovalId).toBeUndefined();
    expect(finalRun?.pendingApproval).toBeUndefined();

    const events = await harness.getEvents(blocked.runId);
    const lifecycle = approvalLifecycle(events);
    expect(lifecycle).toContain("approval_approved");
    expect(lifecycle).toContain("run_resumed");
    expect(events.find((event) => event.type === "approval_approved")?.data).toMatchObject({
      approvalId,
      kind: "tool",
      tool: "write",
      status: "approved",
      resolutionNote: "ship it",
      resolvedBy: {
        id: "operator-1",
        kind: "user",
      },
    });
  });

  it("denies blocked runs, records the denial, and cancels the run immediately", async () => {
    const rootDir = await createTempDir();
    const writes: string[] = [];
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "denied" } }),
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "write requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "deny a write",
      tools: [
        {
          name: "write",
          description: "writes a value",
          async execute(args) {
            writes.push(String(args.value));
            return { ok: true };
          },
        },
      ],
    });

    const blockedRun = await harness.getRun(blocked.runId);
    const approvalId = blockedRun?.pendingApprovalId;
    expect(approvalId).toBeString();

    const approval = await harness.denyRun(blocked.runId, {
      note: "unsafe change",
      access: {
        subject: {
          id: "operator-2",
        },
      },
    });

    expect(approval).toMatchObject({
      id: approvalId,
      status: "denied",
      resolutionNote: "unsafe change",
      resolvedBy: {
        id: "operator-2",
      },
    });
    expect(writes).toEqual([]);

    const finalRun = await harness.getRun(blocked.runId);
    expect(finalRun?.status).toBe("canceled");
    expect(finalRun?.pendingApprovalId).toBeUndefined();
    expect(finalRun?.pendingApproval).toBeUndefined();

    const runtime = await openHarnessRuntime(rootDir);
    expect(await runtime.getApproval(approvalId!)).toMatchObject({
      id: approvalId,
      status: "denied",
      resolutionNote: "unsafe change",
    });

    const events = await harness.getEvents(blocked.runId);
    expect(approvalLifecycle(events)).toEqual([
      "run_started",
      "tool_call",
      "approval_required",
      "approval_denied",
      "run_canceled",
    ]);
  });

  it("reconstructs missing pendingApproval snapshots from persisted approval records before resolving them", async () => {
    const rootDir = await createTempDir();
    const writes: string[] = [];
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "recovered" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "write requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "recover a blocked approval",
      tools: [
        {
          name: "write",
          description: "writes a value",
          async execute(args) {
            writes.push(String(args.value));
            return { ok: true };
          },
        },
      ],
    });

    const blockedRun = await harness.getRun(blocked.runId);
    const approvalId = blockedRun?.pendingApprovalId;
    expect(approvalId).toBeString();

    const store = new FileHarnessRuntimeStore(rootDir);
    await store.patchRun(blocked.runId, {
      pendingApproval: undefined,
    });

    const patchedRun = await harness.getRun(blocked.runId);
    expect(patchedRun?.pendingApproval).toBeUndefined();
    expect(patchedRun?.pendingApprovalId).toBe(approvalId);

    const approval = await harness.approveRun(blocked.runId, {
      note: "recovered from persisted record",
    });
    expect(approval).toMatchObject({
      id: approvalId,
      status: "approved",
      resolutionNote: "recovered from persisted record",
    });

    const recoveredRun = await harness.getRun(blocked.runId);
    expect(recoveredRun?.pendingApproval).toMatchObject({
      id: approvalId,
      status: "approved",
      resolutionNote: "recovered from persisted record",
    });

    const resumed = await harness.resumeRun(blocked.runId);
    expect(resumed.runtimeStatus).toBe("completed");
    expect(writes).toEqual(["recovered"]);
  });

  it("refuses to resume runs whose persisted approvals have already been denied", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "blocked" } }),
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "write requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "cannot resume after denial",
      tools: [
        {
          name: "write",
          description: "writes a value",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });

    const blockedRun = await harness.getRun(blocked.runId);
    const approvalId = blockedRun?.pendingApprovalId;
    expect(approvalId).toBeString();

    const store = new FileHarnessRuntimeStore(rootDir);
    await store.patchApproval(approvalId!, {
      status: "denied",
      resolvedAt: "2026-04-04T00:00:00.000Z",
      resolutionNote: "manual denial",
    });
    await store.patchRun(blocked.runId, {
      pendingApproval: {
        ...blockedRun!.pendingApproval!,
        status: "denied",
        resolvedAt: "2026-04-04T00:00:00.000Z",
        resolutionNote: "manual denial",
      },
    });

    await expect(harness.resumeRun(blocked.runId)).rejects.toThrow(
      `Harness run ${blocked.runId} cannot resume because approval ${approvalId} was denied`,
    );
  });

  it("keeps approval resolution idempotent once a tool approval has been approved", async () => {
    const rootDir = await createTempDir();
    const writes: string[] = [];
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "approved" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "write requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "approve twice",
      tools: [
        {
          name: "write",
          description: "writes a value",
          async execute(args) {
            writes.push(String(args.value));
            return { ok: true };
          },
        },
      ],
    });

    const firstRun = await harness.getRun(blocked.runId);
    const approvalId = firstRun?.pendingApprovalId;
    expect(approvalId).toBeString();

    const first = await harness.approveRun(blocked.runId, {
      note: "ship it",
      access: {
        subject: {
          id: "operator-1",
        },
      },
    });
    const second = await harness.approveRun(blocked.runId, {
      note: "ignored",
      access: {
        subject: {
          id: "operator-2",
        },
      },
    });

    expect(first).toMatchObject({
      id: approvalId,
      status: "approved",
      resolutionNote: "ship it",
    });
    expect(second).toMatchObject({
      id: approvalId,
      status: "approved",
      resolutionNote: "ship it",
    });

    const approvedEvents = approvalLifecycle(
      await harness.getEvents(blocked.runId),
    ).filter((type) => type === "approval_approved");
    expect(approvedEvents).toHaveLength(1);

    const resumed = await harness.resumeRun(blocked.runId);
    expect(resumed.runtimeStatus).toBe("completed");
    expect(writes).toEqual(["approved"]);
  });

  it("keeps task approvals distinct from tool approvals when approving and resuming", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "deploy", arguments: { version: "v1" } }),
        "deployment finished",
      ]),
      runtime: {
        rootDir,
        beforeTaskCall: async () => ({
          allowed: false,
          reason: "manual task approval required",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "deploy after task approval",
      tasks: [
        {
          name: "deploy",
          description: "deploys a release",
          kind: "workflow",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });

    expect(blocked.runtimeStatus).toBe("approval_required");

    const run = await harness.getRun(blocked.runId);
    const approvalId = run?.pendingApprovalId;
    expect(approvalId).toBeString();
    expect(run?.pendingApproval).toMatchObject({
      id: approvalId,
      kind: "task",
      tool: "deploy",
      status: "pending",
    });

    const approval = await harness.approveRun(blocked.runId, {
      note: "task approved",
    });
    expect(approval).toMatchObject({
      id: approvalId,
      kind: "task",
      status: "approved",
      resolutionNote: "task approved",
    });

    const resumed = await harness.resumeRun(blocked.runId);
    expect(resumed.runtimeStatus).toBe("completed");
    expect((await harness.getApproval(approvalId!))).toMatchObject({
      id: approvalId,
      kind: "task",
      status: "approved",
      resolutionNote: "task approved",
    });

    const events = await harness.getEvents(blocked.runId);
    const approvalEvent = events.find((event) => event.type === "approval_approved");
    expect(approvalEvent?.data).toMatchObject({
      approvalId,
      kind: "task",
      tool: "deploy",
      resolutionNote: "task approved",
    });
  });
});

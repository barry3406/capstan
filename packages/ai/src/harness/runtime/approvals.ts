import { randomUUID } from "node:crypto";

import type {
  HarnessAccessContext,
  HarnessApprovalRecord,
  HarnessApprovalResolutionOptions,
  HarnessApprovalStatus,
  HarnessPendingApproval,
  HarnessRunRecord,
  HarnessRuntimeStore,
} from "../types.js";

export function buildApprovalDetail(approval: HarnessApprovalRecord): Record<string, unknown> {
  const pendingApproval = approvalToPendingApproval(approval);
  return {
    approvalId: approval.id,
    runId: approval.runId,
    tool: approval.tool,
    kind: approval.kind,
    status: approval.status,
    approval,
    pendingApproval,
  };
}

export async function ensureRunApprovalRecord(
  store: HarnessRuntimeStore,
  run: HarnessRunRecord,
): Promise<{ run: HarnessRunRecord; approval: HarnessApprovalRecord }> {
  if (run.status !== "approval_required") {
    throw new Error(`Harness run ${run.id} has no pending approval`);
  }

  const normalizedPending = run.pendingApproval
    ? normalizePendingApproval(run.pendingApproval)
    : undefined;
  const approvalId = run.pendingApprovalId ?? normalizedPending?.id;
  let approval = approvalId ? await store.getApproval(approvalId) : undefined;

  if (!approval) {
    if (!normalizedPending) {
      throw new Error(`Harness run ${run.id} has no pending approval`);
    }
    const now = new Date().toISOString();
    const safeApprovalId = approvalId ?? normalizedPending.id;
    approval = {
      ...normalizedPending,
      id: safeApprovalId,
      runId: run.id,
      updatedAt: now,
    };
    await store.persistApproval(approval);
  }

  const resolvedApproval = approval;
  const normalizedApproval = approvalToPendingApproval(resolvedApproval);
  const needsRunUpdate =
    run.pendingApprovalId !== resolvedApproval.id ||
    !pendingApprovalsMatch(run.pendingApproval, normalizedApproval);

  if (!needsRunUpdate) {
    return { run, approval: resolvedApproval };
  }

  const nextRun = await store.patchRun(run.id, {
    pendingApprovalId: resolvedApproval.id,
    pendingApproval: normalizedApproval,
  });

  return {
    run: nextRun,
    approval: resolvedApproval,
  };
}

export async function resolveRunApproval(
  store: HarnessRuntimeStore,
  runOrId: HarnessRunRecord | string,
  status: Extract<HarnessApprovalStatus, "approved" | "denied" | "canceled">,
  options?: HarnessApprovalResolutionOptions,
): Promise<{
  run: HarnessRunRecord;
  approval: HarnessApprovalRecord;
  changed: boolean;
}> {
  const run = typeof runOrId === "string" ? await store.requireRun(runOrId) : runOrId;
  const ensured = await ensureRunApprovalRecord(store, run);
  const approval = ensured.approval;

  if (approval.status === status) {
    return {
      run: ensured.run,
      approval,
      changed: false,
    };
  }

  if (approval.status !== "pending") {
    throw new Error(
      `Harness approval ${approval.id} is already ${approval.status} and cannot become ${status}`,
    );
  }

  const resolvedAt = new Date().toISOString();
  const resolvedBy = resolveApprovalSubject(options?.access);
  const resolutionNote = normalizeResolutionNote(options?.note);
  const nextApproval = await store.patchApproval(approval.id, {
    status,
    resolvedAt,
    ...(resolutionNote ? { resolutionNote } : {}),
    ...(resolvedBy ? { resolvedBy } : {}),
  });
  const nextRun = await store.transitionRun(
    ensured.run.id,
    status === "approved"
      ? "approval_approved"
      : status === "denied"
        ? "approval_denied"
        : "approval_canceled",
    {
      pendingApprovalId: nextApproval.id,
      pendingApproval: approvalToPendingApproval(nextApproval),
    },
    {
      approvalId: nextApproval.id,
      kind: nextApproval.kind,
      tool: nextApproval.tool,
      status: nextApproval.status,
      resolvedAt,
      ...(resolutionNote ? { resolutionNote } : {}),
      ...(resolvedBy ? { resolvedBy } : {}),
    },
  );

  return {
    run: nextRun,
    approval: nextApproval,
    changed: true,
  };
}

export function approvalToPendingApproval(approval: HarnessApprovalRecord): HarnessPendingApproval {
  return {
    id: approval.id,
    kind: approval.kind,
    tool: approval.tool,
    args: approval.args,
    reason: approval.reason,
    requestedAt: approval.requestedAt,
    status: approval.status,
    ...(approval.resolvedAt ? { resolvedAt: approval.resolvedAt } : {}),
    ...(approval.resolutionNote ? { resolutionNote: approval.resolutionNote } : {}),
  };
}

function normalizePendingApproval(pending: HarnessPendingApproval): HarnessPendingApproval {
  const requestedAt =
    typeof pending.requestedAt === "string" && pending.requestedAt.trim()
      ? pending.requestedAt
      : new Date().toISOString();
  return {
    id: pending.id?.trim() || `approval_${randomUUID()}`,
    kind: pending.kind ?? "tool",
    tool: pending.tool,
    args: pending.args,
    reason: pending.reason,
    requestedAt,
    status: pending.status ?? "pending",
    ...(pending.resolvedAt ? { resolvedAt: pending.resolvedAt } : {}),
    ...(pending.resolutionNote ? { resolutionNote: pending.resolutionNote } : {}),
  };
}

function pendingApprovalsMatch(
  left: HarnessPendingApproval | undefined,
  right: HarnessPendingApproval,
): boolean {
  if (!left) {
    return false;
  }
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.tool === right.tool &&
    left.reason === right.reason &&
    left.requestedAt === right.requestedAt &&
    (left.status ?? "pending") === (right.status ?? "pending") &&
    left.resolvedAt === right.resolvedAt &&
    left.resolutionNote === right.resolutionNote &&
    JSON.stringify(left.args) === JSON.stringify(right.args)
  );
}

function resolveApprovalSubject(
  access: HarnessAccessContext | undefined,
): Record<string, unknown> | undefined {
  if (access?.subject == null) {
    return undefined;
  }
  if (typeof access.subject === "object" && access.subject !== null && !Array.isArray(access.subject)) {
    return access.subject as Record<string, unknown>;
  }
  return { value: access.subject };
}

function normalizeResolutionNote(note: string | undefined): string | undefined {
  const normalized = note?.trim();
  return normalized ? normalized : undefined;
}

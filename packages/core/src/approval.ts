import { randomUUID } from "node:crypto";

export interface PendingApproval {
  id: string;
  method: string;
  path: string;
  input: unknown;
  policy: string;
  reason: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  result?: unknown;
}

/** In-memory store for pending approvals (dev mode). */
const approvals = new Map<string, PendingApproval>();

/**
 * Create a new pending approval and store it. Returns the created approval.
 */
export function createApproval(opts: {
  method: string;
  path: string;
  input: unknown;
  policy: string;
  reason: string;
}): PendingApproval {
  const id = randomUUID();
  const approval: PendingApproval = {
    id,
    method: opts.method,
    path: opts.path,
    input: opts.input,
    policy: opts.policy,
    reason: opts.reason,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  approvals.set(id, approval);
  return approval;
}

/**
 * Retrieve a single approval by ID, or undefined if not found.
 */
export function getApproval(id: string): PendingApproval | undefined {
  return approvals.get(id);
}

/**
 * List all approvals, optionally filtered by status.
 */
export function listApprovals(
  status?: "pending" | "approved" | "denied",
): PendingApproval[] {
  const all = Array.from(approvals.values());
  if (status === undefined) return all;
  return all.filter((a) => a.status === status);
}

/**
 * Resolve a pending approval as approved or denied.
 * Returns the updated approval, or undefined if not found.
 */
export function resolveApproval(
  id: string,
  decision: "approved" | "denied",
  resolvedBy?: string,
): PendingApproval | undefined {
  const approval = approvals.get(id);
  if (!approval) return undefined;
  approval.status = decision;
  approval.resolvedAt = new Date().toISOString();
  if (resolvedBy !== undefined) {
    approval.resolvedBy = resolvedBy;
  }
  return approval;
}

/**
 * Remove all approvals from the in-memory store.
 */
export function clearApprovals(): void {
  approvals.clear();
}

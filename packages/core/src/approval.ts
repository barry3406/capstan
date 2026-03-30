import { randomUUID } from "node:crypto";
import type { KeyValueStore } from "./store.js";
import { MemoryStore } from "./store.js";

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

/** Pluggable store for pending approvals. Defaults to in-memory. */
let approvalStore: KeyValueStore<PendingApproval> = new MemoryStore();

/**
 * Index of known approval IDs so that `listApprovals` can enumerate
 * entries without requiring the `KeyValueStore` interface to support
 * iteration.  The index is kept in sync with the store by the public
 * API functions.
 */
let approvalIds = new Set<string>();

/**
 * Replace the default in-memory approval store with a custom implementation.
 *
 * Call this at application startup before any approvals are created.
 * The ID index is cleared when the store is swapped — the new store is
 * assumed to be empty or self-managing.
 */
export function setApprovalStore(store: KeyValueStore<PendingApproval>): void {
  approvalStore = store;
  approvalIds = new Set();
}

/**
 * Create a new pending approval and store it. Returns the created approval.
 */
export async function createApproval(opts: {
  method: string;
  path: string;
  input: unknown;
  policy: string;
  reason: string;
}): Promise<PendingApproval> {
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
  await approvalStore.set(id, approval);
  approvalIds.add(id);
  return approval;
}

/**
 * Retrieve a single approval by ID, or undefined if not found.
 */
export async function getApproval(id: string): Promise<PendingApproval | undefined> {
  return approvalStore.get(id);
}

/**
 * List all approvals, optionally filtered by status.
 */
export async function listApprovals(
  status?: "pending" | "approved" | "denied",
): Promise<PendingApproval[]> {
  const results: PendingApproval[] = [];
  for (const id of approvalIds) {
    const approval = await approvalStore.get(id);
    if (approval) {
      if (status === undefined || approval.status === status) {
        results.push(approval);
      }
    } else {
      // Entry expired or was removed from the store — clean up the index.
      approvalIds.delete(id);
    }
  }
  return results;
}

/**
 * Resolve a pending approval as approved or denied.
 * Returns the updated approval, or undefined if not found.
 */
export async function resolveApproval(
  id: string,
  decision: "approved" | "denied",
  resolvedBy?: string,
): Promise<PendingApproval | undefined> {
  const approval = await approvalStore.get(id);
  if (!approval) return undefined;
  approval.status = decision;
  approval.resolvedAt = new Date().toISOString();
  if (resolvedBy !== undefined) {
    approval.resolvedBy = resolvedBy;
  }
  await approvalStore.set(id, approval);
  return approval;
}

/**
 * Remove all approvals from the store.
 */
export async function clearApprovals(): Promise<void> {
  await approvalStore.clear();
  approvalIds.clear();
}

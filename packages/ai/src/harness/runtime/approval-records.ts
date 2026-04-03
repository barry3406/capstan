import type { HarnessApprovalRecord } from "../types.js";

const VALID_APPROVAL_STATUSES = new Set([
  "pending",
  "approved",
  "denied",
  "canceled",
]);

const VALID_APPROVAL_KINDS = new Set([
  "tool",
  "task",
]);

export function assertValidApprovalRecord(
  approvalId: string,
  record: unknown,
): asserts record is HarnessApprovalRecord {
  const context = `Harness approval ${approvalId}`;
  if (!isPlainObject(record)) {
    throw new Error(`${context} is invalid: expected object`);
  }
  if (record.id !== approvalId) {
    throw new Error(`${context} is invalid: expected id "${approvalId}"`);
  }
  if (typeof record.runId !== "string" || !record.runId.trim()) {
    throw new Error(`${context} is invalid: runId must be a non-empty string`);
  }
  if (!VALID_APPROVAL_KINDS.has(String(record.kind))) {
    throw new Error(`${context} is invalid: kind is unsupported`);
  }
  if (typeof record.tool !== "string" || !record.tool.trim()) {
    throw new Error(`${context} is invalid: tool must be a non-empty string`);
  }
  if (typeof record.reason !== "string" || !record.reason.trim()) {
    throw new Error(`${context} is invalid: reason must be a non-empty string`);
  }
  if (typeof record.requestedAt !== "string" || !record.requestedAt.trim()) {
    throw new Error(`${context} is invalid: requestedAt must be a string`);
  }
  if (!isIsoTimestamp(record.requestedAt)) {
    throw new Error(`${context} is invalid: requestedAt must be an ISO timestamp`);
  }
  if (typeof record.updatedAt !== "string" || !record.updatedAt.trim()) {
    throw new Error(`${context} is invalid: updatedAt must be a string`);
  }
  if (!isIsoTimestamp(record.updatedAt)) {
    throw new Error(`${context} is invalid: updatedAt must be an ISO timestamp`);
  }
  if (!VALID_APPROVAL_STATUSES.has(String(record.status))) {
    throw new Error(`${context} is invalid: status is unsupported`);
  }
  if (record.resolvedAt !== undefined && (typeof record.resolvedAt !== "string" || !record.resolvedAt.trim())) {
    throw new Error(`${context} is invalid: resolvedAt must be a string when present`);
  }
  if (record.resolvedAt !== undefined && !isIsoTimestamp(record.resolvedAt)) {
    throw new Error(`${context} is invalid: resolvedAt must be an ISO timestamp when present`);
  }
  if (
    record.resolutionNote !== undefined &&
    typeof record.resolutionNote !== "string"
  ) {
    throw new Error(`${context} is invalid: resolutionNote must be a string when present`);
  }
  if (record.resolvedBy !== undefined && !isPlainObject(record.resolvedBy)) {
    throw new Error(`${context} is invalid: resolvedBy must be an object when present`);
  }
  if (record.status === "pending") {
    if (record.resolvedAt !== undefined) {
      throw new Error(`${context} is invalid: pending approvals cannot have resolvedAt`);
    }
    if (record.resolutionNote !== undefined) {
      throw new Error(`${context} is invalid: pending approvals cannot have resolutionNote`);
    }
  } else if (record.resolvedAt === undefined) {
    throw new Error(`${context} is invalid: terminal approvals require resolvedAt`);
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

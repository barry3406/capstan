import type { HarnessTaskRecord } from "../types.js";

export function assertValidTaskRecord(
  runId: string,
  record: unknown,
): asserts record is HarnessTaskRecord {
  const context = `Harness run ${runId} task record`;
  if (!isPlainObject(record)) {
    throw new Error(`${context} is invalid: expected object`);
  }
  if (typeof record.id !== "string" || !record.id.trim()) {
    throw new Error(`${context} is invalid: id must be a non-empty string`);
  }
  if (record.runId !== runId) {
    throw new Error(`${context} is invalid: expected runId "${runId}"`);
  }
  if (typeof record.requestId !== "string" || !record.requestId.trim()) {
    throw new Error(`${context} is invalid: requestId must be a non-empty string`);
  }
  if (typeof record.name !== "string" || !record.name.trim()) {
    throw new Error(`${context} is invalid: name must be a non-empty string`);
  }
  if (
    record.kind !== "shell" &&
    record.kind !== "workflow" &&
    record.kind !== "remote" &&
    record.kind !== "subagent" &&
    record.kind !== "custom"
  ) {
    throw new Error(`${context} is invalid: kind is unsupported`);
  }
  if (
    record.status !== "running" &&
    record.status !== "completed" &&
    record.status !== "failed" &&
    record.status !== "canceled"
  ) {
    throw new Error(`${context} is invalid: status is unsupported`);
  }
  if (!Number.isInteger(record.order) || record.order < 0) {
    throw new Error(`${context} is invalid: order must be a non-negative integer`);
  }
  if (typeof record.createdAt !== "string" || !record.createdAt.trim()) {
    throw new Error(`${context} is invalid: createdAt must be a string`);
  }
  if (typeof record.updatedAt !== "string" || !record.updatedAt.trim()) {
    throw new Error(`${context} is invalid: updatedAt must be a string`);
  }
  if (!isPlainObject(record.args)) {
    throw new Error(`${context} is invalid: args must be an object`);
  }
  if (typeof record.hardFailure !== "boolean") {
    throw new Error(`${context} is invalid: hardFailure must be a boolean`);
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

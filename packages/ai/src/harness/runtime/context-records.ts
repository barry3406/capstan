import type {
  HarnessMemoryRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
} from "../types.js";

export function assertValidSessionMemoryRecord(
  runId: string,
  record: unknown,
): asserts record is HarnessSessionMemoryRecord {
  if (!isPlainObject(record)) {
    throw new Error(`Harness run ${runId} session memory is invalid: expected object`);
  }

  if (record.runId !== runId) {
    throw new Error(`Harness run ${runId} session memory is invalid: runId mismatch`);
  }
  requireNonEmptyString(record.goal, `Harness run ${runId} session memory is invalid: goal`);
  requireNonEmptyString(record.status, `Harness run ${runId} session memory is invalid: status`);
  requireNonEmptyString(record.updatedAt, `Harness run ${runId} session memory is invalid: updatedAt`);
  requireNonEmptyString(
    record.sourceRunUpdatedAt,
    `Harness run ${runId} session memory is invalid: sourceRunUpdatedAt`,
  );
  requireNonEmptyString(record.headline, `Harness run ${runId} session memory is invalid: headline`);
  requireNonEmptyString(
    record.currentPhase,
    `Harness run ${runId} session memory is invalid: currentPhase`,
  );
  requireStringArray(record.recentSteps, `Harness run ${runId} session memory is invalid: recentSteps`);
  requireStringArray(record.blockers, `Harness run ${runId} session memory is invalid: blockers`);
  requireStringArray(record.openQuestions, `Harness run ${runId} session memory is invalid: openQuestions`);
  if (!Number.isInteger(record.compactedMessages) || record.compactedMessages < 0) {
    throw new Error(
      `Harness run ${runId} session memory is invalid: compactedMessages must be a non-negative integer`,
    );
  }
  if (!Number.isInteger(record.tokenEstimate) || record.tokenEstimate < 0) {
    throw new Error(
      `Harness run ${runId} session memory is invalid: tokenEstimate must be a non-negative integer`,
    );
  }
  requireArtifactRefs(record.artifactRefs, `Harness run ${runId} session memory is invalid: artifactRefs`);
}

export function assertValidSummaryRecord(
  runId: string,
  record: unknown,
): asserts record is HarnessSummaryRecord {
  if (!isPlainObject(record)) {
    throw new Error(`Harness run ${runId} summary is invalid: expected object`);
  }

  if (record.runId !== runId) {
    throw new Error(`Harness run ${runId} summary is invalid: runId mismatch`);
  }
  requireNonEmptyString(record.id, `Harness run ${runId} summary is invalid: id`);
  requireNonEmptyString(record.kind, `Harness run ${runId} summary is invalid: kind`);
  requireNonEmptyString(record.status, `Harness run ${runId} summary is invalid: status`);
  requireNonEmptyString(record.createdAt, `Harness run ${runId} summary is invalid: createdAt`);
  requireNonEmptyString(record.updatedAt, `Harness run ${runId} summary is invalid: updatedAt`);
  requireNonEmptyString(
    record.sourceRunUpdatedAt,
    `Harness run ${runId} summary is invalid: sourceRunUpdatedAt`,
  );
  requireNonEmptyString(record.headline, `Harness run ${runId} summary is invalid: headline`);
  requireStringArray(record.completedSteps, `Harness run ${runId} summary is invalid: completedSteps`);
  requireStringArray(record.blockers, `Harness run ${runId} summary is invalid: blockers`);
  requireStringArray(record.openQuestions, `Harness run ${runId} summary is invalid: openQuestions`);
  requireArtifactRefs(record.artifactRefs, `Harness run ${runId} summary is invalid: artifactRefs`);
  requireNonNegativeInteger(record.iterations, `Harness run ${runId} summary is invalid: iterations`);
  requireNonNegativeInteger(record.toolCalls, `Harness run ${runId} summary is invalid: toolCalls`);
  requireNonNegativeInteger(record.messageCount, `Harness run ${runId} summary is invalid: messageCount`);
  requireNonNegativeInteger(
    record.compactedMessages,
    `Harness run ${runId} summary is invalid: compactedMessages`,
  );
}

export function assertValidMemoryRecord(
  record: unknown,
  context = "Harness memory record",
): asserts record is HarnessMemoryRecord {
  if (!isPlainObject(record)) {
    throw new Error(`${context} is invalid: expected object`);
  }

  requireNonEmptyString(record.id, `${context} is invalid: id`);
  if (!isPlainObject(record.scope)) {
    throw new Error(`${context} is invalid: scope`);
  }
  requireNonEmptyString(record.scope.type, `${context} is invalid: scope.type`);
  requireNonEmptyString(record.scope.id, `${context} is invalid: scope.id`);
  requireNonEmptyString(record.kind, `${context} is invalid: kind`);
  requireNonEmptyString(record.content, `${context} is invalid: content`);
  requireNonEmptyString(record.createdAt, `${context} is invalid: createdAt`);
  requireNonEmptyString(record.updatedAt, `${context} is invalid: updatedAt`);
  requireNonNegativeInteger(record.accessCount, `${context} is invalid: accessCount`);
  requireNonEmptyString(record.lastAccessedAt, `${context} is invalid: lastAccessedAt`);
  if (record.graphScopes != null) {
    requireGraphScopes(record.graphScopes, `${context} is invalid: graphScopes`);
  }
}

function requireArtifactRefs(value: unknown, context: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry)) {
      throw new Error(`${context}[${index}] must be an object`);
    }
    requireNonEmptyString(entry.artifactId, `${context}[${index}].artifactId`);
    requireNonEmptyString(entry.kind, `${context}[${index}].kind`);
    requireNonEmptyString(entry.path, `${context}[${index}].path`);
    requireNonEmptyString(entry.mimeType, `${context}[${index}].mimeType`);
    requireNonNegativeInteger(entry.size, `${context}[${index}].size`);
  }
}

function requireGraphScopes(value: unknown, context: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry)) {
      throw new Error(`${context}[${index}] must be an object`);
    }
    requireNonEmptyString(entry.kind, `${context}[${index}].kind`);
  }
}

function requireStringArray(value: unknown, context: string): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${context} must be a string array`);
  }
}

function requireNonNegativeInteger(value: unknown, context: string): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${context} must be a non-negative integer`);
  }
}

function requireNonEmptyString(value: unknown, context: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${context} must be a non-empty string`);
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

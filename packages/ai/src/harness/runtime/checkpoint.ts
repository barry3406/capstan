import type {
  AgentLoopCheckpoint,
  AgentLoopCheckpointStage,
  LLMMessage,
} from "../../types.js";
import type { HarnessRunCheckpointRecord } from "../types.js";

const CHECKPOINT_STAGES = new Set<AgentLoopCheckpointStage>([
  "initialized",
  "assistant_response",
  "tool_result",
  "approval_required",
  "completed",
  "max_iterations",
  "canceled",
]);

const MESSAGE_ROLES = new Set<LLMMessage["role"]>(["system", "user", "assistant"]);

export function assertValidCheckpointRecord(
  runId: string,
  record: unknown,
): asserts record is HarnessRunCheckpointRecord {
  if (!isPlainObject(record)) {
    throw new Error(`Harness run ${runId} checkpoint record is invalid: expected object`);
  }

  if (record.runId !== runId) {
    throw new Error(
      `Harness run ${runId} checkpoint record is invalid: expected runId "${runId}"`,
    );
  }

  if (typeof record.updatedAt !== "string" || !record.updatedAt.trim()) {
    throw new Error(
      `Harness run ${runId} checkpoint record is invalid: missing updatedAt`,
    );
  }

  assertValidAgentLoopCheckpoint(
    record.checkpoint,
    `Harness run ${runId} checkpoint`,
  );
}

export function assertValidAgentLoopCheckpoint(
  checkpoint: unknown,
  context = "Agent loop checkpoint",
): asserts checkpoint is AgentLoopCheckpoint {
  if (!isPlainObject(checkpoint)) {
    throw new Error(`${context} is invalid: expected object`);
  }

  if (
    typeof checkpoint.stage !== "string" ||
    !CHECKPOINT_STAGES.has(checkpoint.stage as AgentLoopCheckpointStage)
  ) {
    throw new Error(`${context} is invalid: unsupported stage`);
  }

  if (!isPlainObject(checkpoint.config)) {
    throw new Error(`${context} is invalid: missing config`);
  }
  if (typeof checkpoint.config.goal !== "string" || !checkpoint.config.goal.trim()) {
    throw new Error(`${context} is invalid: config.goal must be a non-empty string`);
  }
  if (
    checkpoint.config.maxIterations != null &&
    (!Number.isInteger(checkpoint.config.maxIterations) ||
      checkpoint.config.maxIterations < 0)
  ) {
    throw new Error(`${context} is invalid: config.maxIterations must be a non-negative integer`);
  }
  if (
    checkpoint.config.systemPrompt != null &&
    typeof checkpoint.config.systemPrompt !== "string"
  ) {
    throw new Error(`${context} is invalid: config.systemPrompt must be a string`);
  }

  if (!Array.isArray(checkpoint.messages)) {
    throw new Error(`${context} is invalid: messages must be an array`);
  }
  for (const [index, message] of checkpoint.messages.entries()) {
    if (!isPlainObject(message)) {
      throw new Error(`${context} is invalid: messages[${index}] must be an object`);
    }
    if (
      typeof message.role !== "string" ||
      !MESSAGE_ROLES.has(message.role as LLMMessage["role"])
    ) {
      throw new Error(`${context} is invalid: messages[${index}].role is unsupported`);
    }
    if (typeof message.content !== "string") {
      throw new Error(`${context} is invalid: messages[${index}].content must be a string`);
    }
  }

  if (!Number.isInteger(checkpoint.iterations) || checkpoint.iterations < 0) {
    throw new Error(`${context} is invalid: iterations must be a non-negative integer`);
  }

  if (!Array.isArray(checkpoint.toolCalls)) {
    throw new Error(`${context} is invalid: toolCalls must be an array`);
  }
  for (const [index, call] of checkpoint.toolCalls.entries()) {
    if (!isPlainObject(call)) {
      throw new Error(`${context} is invalid: toolCalls[${index}] must be an object`);
    }
    if (typeof call.tool !== "string" || !call.tool.trim()) {
      throw new Error(`${context} is invalid: toolCalls[${index}].tool must be a string`);
    }
  }

  if (checkpoint.pendingToolCall != null) {
    if (!isPlainObject(checkpoint.pendingToolCall)) {
      throw new Error(`${context} is invalid: pendingToolCall must be an object`);
    }
    if (
      typeof checkpoint.pendingToolCall.assistantMessage !== "string" ||
      !checkpoint.pendingToolCall.assistantMessage.trim()
    ) {
      throw new Error(
        `${context} is invalid: pendingToolCall.assistantMessage must be a string`,
      );
    }
    if (
      typeof checkpoint.pendingToolCall.tool !== "string" ||
      !checkpoint.pendingToolCall.tool.trim()
    ) {
      throw new Error(`${context} is invalid: pendingToolCall.tool must be a string`);
    }
    if (!isPlainObject(checkpoint.pendingToolCall.args)) {
      throw new Error(`${context} is invalid: pendingToolCall.args must be an object`);
    }
  }

  if (
    checkpoint.lastAssistantResponse != null &&
    typeof checkpoint.lastAssistantResponse !== "string"
  ) {
    throw new Error(`${context} is invalid: lastAssistantResponse must be a string`);
  }
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

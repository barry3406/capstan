import type {
  AgentLoopCheckpoint,
  AgentLoopModelFinishReason,
  AgentLoopPhase,
  AgentLoopToolRequest,
  AgentLoopTransitionReason,
  AgentToolCallRecord,
  LLMMessage,
} from "../../types.js";
import type { HarnessRunCheckpointRecord } from "../types.js";

const CHECKPOINT_STAGES = new Set<string>([
  "initialized",
  "assistant_response",
  "tool_result",
  "task_wait",
  "approval_required",
  "completed",
  "max_iterations",
  "canceled",
  // Forward-compatible pause boundary for richer turn engines.
  "paused",
]);
const LOOP_PHASES = new Set<AgentLoopPhase>([
  "initializing",
  "preparing_context",
  "sampling_model",
  "executing_tools",
  "executing_tasks",
  "waiting_on_tasks",
  "approval_blocked",
  "applying_tool_results",
  "running_sidecars",
  "deciding_continuation",
  "completed",
  "paused",
  "canceled",
  "max_iterations",
  "failed",
]);
const TRANSITION_REASONS = new Set<AgentLoopTransitionReason>([
  "initial_turn",
  "next_turn",
  "token_budget_continuation",
  "reactive_compact_retry",
  "manual_resume",
  "approval_required",
  "task_wait",
  "pause_requested",
  "cancel_requested",
  "final_response",
  "iteration_limit",
  "fatal_error",
]);
const MODEL_FINISH_REASONS = new Set<AgentLoopModelFinishReason>([
  "stop",
  "tool_use",
  "max_output_tokens",
  "context_limit",
  "error",
]);

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
    !CHECKPOINT_STAGES.has(checkpoint.stage)
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
    if (typeof message.role !== "string" || !message.role.trim()) {
      throw new Error(`${context} is invalid: messages[${index}].role must be a non-empty string`);
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

  if (checkpoint.taskCalls != null && !Array.isArray(checkpoint.taskCalls)) {
    throw new Error(`${context} is invalid: taskCalls must be an array`);
  }
  for (const [index, call] of (checkpoint.taskCalls ?? []).entries()) {
    if (!isPlainObject(call)) {
      throw new Error(`${context} is invalid: taskCalls[${index}] must be an object`);
    }
    if (typeof call.task !== "string" || !call.task.trim()) {
      throw new Error(`${context} is invalid: taskCalls[${index}].task must be a string`);
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

  if (checkpoint.pendingTaskRequests != null) {
    if (!Array.isArray(checkpoint.pendingTaskRequests)) {
      throw new Error(`${context} is invalid: pendingTaskRequests must be an array`);
    }
    for (const [index, request] of checkpoint.pendingTaskRequests.entries()) {
      assertValidToolRequest(
        request,
        `${context} pendingTaskRequests[${index}]`,
      );
    }
  }

  if (
    checkpoint.lastAssistantResponse != null &&
    typeof checkpoint.lastAssistantResponse !== "string"
  ) {
    throw new Error(`${context} is invalid: lastAssistantResponse must be a string`);
  }

  if (checkpoint.orchestration != null) {
    if (!isPlainObject(checkpoint.orchestration)) {
      throw new Error(`${context} is invalid: orchestration must be an object`);
    }
    if (
      typeof checkpoint.orchestration.phase !== "string" ||
      !LOOP_PHASES.has(checkpoint.orchestration.phase as AgentLoopPhase)
    ) {
      throw new Error(`${context} is invalid: orchestration.phase is unsupported`);
    }
    if (
      typeof checkpoint.orchestration.transitionReason !== "string" ||
      !TRANSITION_REASONS.has(
        checkpoint.orchestration.transitionReason as AgentLoopTransitionReason,
      )
    ) {
      throw new Error(
        `${context} is invalid: orchestration.transitionReason is unsupported`,
      );
    }
    if (
      !Number.isInteger(checkpoint.orchestration.turnCount) ||
      checkpoint.orchestration.turnCount < 0
    ) {
      throw new Error(
        `${context} is invalid: orchestration.turnCount must be a non-negative integer`,
      );
    }
    if (!isPlainObject(checkpoint.orchestration.recovery)) {
      throw new Error(`${context} is invalid: orchestration.recovery must be an object`);
    }
    for (const field of [
      "reactiveCompactRetries",
      "tokenContinuations",
      "toolRecoveryCount",
    ] as const) {
      const value = checkpoint.orchestration.recovery[field];
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(
          `${context} is invalid: orchestration.recovery.${field} must be a non-negative integer`,
        );
      }
    }
    if (checkpoint.orchestration.pendingToolRequests != null) {
      if (!Array.isArray(checkpoint.orchestration.pendingToolRequests)) {
        throw new Error(
          `${context} is invalid: orchestration.pendingToolRequests must be an array`,
        );
      }
      for (const [index, request] of checkpoint.orchestration.pendingToolRequests.entries()) {
        assertValidToolRequest(
          request,
          `${context} orchestration.pendingToolRequests[${index}]`,
        );
      }
    }
    if (checkpoint.orchestration.pendingTaskRequests != null) {
      if (!Array.isArray(checkpoint.orchestration.pendingTaskRequests)) {
        throw new Error(
          `${context} is invalid: orchestration.pendingTaskRequests must be an array`,
        );
      }
      for (const [index, request] of checkpoint.orchestration.pendingTaskRequests.entries()) {
        assertValidToolRequest(
          request,
          `${context} orchestration.pendingTaskRequests[${index}]`,
        );
      }
    }
    if (checkpoint.orchestration.waitingTaskIds != null) {
      if (!Array.isArray(checkpoint.orchestration.waitingTaskIds)) {
        throw new Error(
          `${context} is invalid: orchestration.waitingTaskIds must be an array`,
        );
      }
      for (const [index, taskId] of checkpoint.orchestration.waitingTaskIds.entries()) {
        if (typeof taskId !== "string" || !taskId.trim()) {
          throw new Error(
            `${context} is invalid: orchestration.waitingTaskIds[${index}] must be a non-empty string`,
          );
        }
      }
    }
    if (
      checkpoint.orchestration.lastModelFinishReason != null &&
      (typeof checkpoint.orchestration.lastModelFinishReason !== "string" ||
        !MODEL_FINISH_REASONS.has(
          checkpoint.orchestration.lastModelFinishReason as AgentLoopModelFinishReason,
        ))
    ) {
      throw new Error(
        `${context} is invalid: orchestration.lastModelFinishReason is unsupported`,
      );
    }
    if (
      checkpoint.orchestration.continuationPrompt != null &&
      typeof checkpoint.orchestration.continuationPrompt !== "string"
    ) {
      throw new Error(
        `${context} is invalid: orchestration.continuationPrompt must be a string`,
      );
    }
    if (
      checkpoint.orchestration.compactHint != null &&
      checkpoint.orchestration.compactHint !== "normal" &&
      checkpoint.orchestration.compactHint !== "aggressive"
    ) {
      throw new Error(`${context} is invalid: orchestration.compactHint is unsupported`);
    }
    if (
      checkpoint.orchestration.assistantMessagePersisted != null &&
      typeof checkpoint.orchestration.assistantMessagePersisted !== "boolean"
    ) {
      throw new Error(
        `${context} is invalid: orchestration.assistantMessagePersisted must be a boolean`,
      );
    }
  }
}

export function getCheckpointStage(checkpoint: AgentLoopCheckpoint): string {
  return checkpoint.stage;
}

export function getCheckpointMessages(checkpoint: AgentLoopCheckpoint): LLMMessage[] {
  return checkpoint.messages;
}

export function getCheckpointToolCalls(
  checkpoint: AgentLoopCheckpoint,
): AgentToolCallRecord[] {
  return checkpoint.toolCalls;
}

export function getCheckpointPendingToolCall(
  checkpoint: AgentLoopCheckpoint,
): AgentLoopCheckpoint["pendingToolCall"] {
  return checkpoint.pendingToolCall;
}

export function getCheckpointLastAssistantResponse(
  checkpoint: AgentLoopCheckpoint,
): string | undefined {
  if (
    checkpoint.lastAssistantResponse != null &&
    checkpoint.lastAssistantResponse.trim()
  ) {
    return checkpoint.lastAssistantResponse;
  }

  if (
    checkpoint.pendingToolCall?.assistantMessage != null &&
    checkpoint.pendingToolCall.assistantMessage.trim()
  ) {
    return checkpoint.pendingToolCall.assistantMessage;
  }

  for (let index = checkpoint.messages.length - 1; index >= 0; index--) {
    const message = checkpoint.messages[index];
    if (message?.role === "assistant" && message.content.trim()) {
      return message.content;
    }
  }

  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function assertValidToolRequest(
  request: unknown,
  context: string,
): asserts request is AgentLoopToolRequest {
  if (!isPlainObject(request)) {
    throw new Error(`${context} is invalid: expected object`);
  }
  if (typeof request.id !== "string" || !request.id.trim()) {
    throw new Error(`${context} is invalid: id must be a non-empty string`);
  }
  if (typeof request.name !== "string" || !request.name.trim()) {
    throw new Error(`${context} is invalid: name must be a non-empty string`);
  }
  if (!isPlainObject(request.args)) {
    throw new Error(`${context} is invalid: args must be an object`);
  }
  if (!Number.isInteger(request.order) || request.order < 0) {
    throw new Error(`${context} is invalid: order must be a non-negative integer`);
  }
}

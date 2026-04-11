import type { LLMMessage } from "../types.js";
import type { ModelOutcome } from "./streaming-executor.js";
import type { StopHooksResult } from "./stop-hooks.js";

const DEFAULT_ESCALATION_STAGES = [8192, 16384, 65536];
const MAX_REACTIVE_COMPACT_RETRIES = 2;

export type ContinuationReason =
  | "tool_results_pending"
  | "token_budget_continuation"
  | "reactive_compact_retry"
  | "autocompact_recovery"
  | "stop_hook_rejected"
  | "tool_error_recovery";

export type ContinuationAction =
  | { action: "continue"; reason: ContinuationReason }
  | { action: "complete" }
  | { action: "fatal"; error: string };

export interface CompactionState {
  autocompactFailures: number;
  reactiveCompactRetries: number;
  tokenEscalations: number;
}

export type { ModelOutcome } from "./streaming-executor.js";
export type { StopHooksResult } from "./stop-hooks.js";

/**
 * Decide the next action after a model sample. First-match wins:
 *
 * 1. Tool requests present           → continue "tool_results_pending"
 * 2a. max_output_tokens, budget left  → continue "token_budget_continuation"
 * 2b. max_output_tokens, exhausted    → complete
 * 3a. context_limit, autocompact=0    → continue "autocompact_recovery"
 * 3b. context_limit, retries < MAX    → continue "reactive_compact_retry"
 * 3c. context_limit, exhausted        → fatal
 * 4a. stop hook fails                 → continue "stop_hook_rejected"
 * 4b. stop hook passes                → complete
 * 5. tool errors present              → continue "tool_error_recovery"
 * 6. otherwise                        → complete
 */
export function decideContinuation(
  outcome: ModelOutcome,
  compaction: CompactionState,
  stopHookResult?: StopHooksResult,
  escalationStages?: number[],
): ContinuationAction {
  const stages = escalationStages ?? DEFAULT_ESCALATION_STAGES;

  // Branch 1: pending tool results
  if (outcome.toolRequests.length > 0) {
    return { action: "continue", reason: "tool_results_pending" };
  }

  // Branch 2: max_output_tokens
  if (outcome.finishReason === "max_output_tokens") {
    if (compaction.tokenEscalations < stages.length) {
      return { action: "continue", reason: "token_budget_continuation" };
    }
    return { action: "complete" };
  }

  // Branch: finishReason "error" → fatal
  if (outcome.finishReason === "error") {
    return { action: "fatal", error: "LLM call failed" };
  }

  // Branch 3: context_limit
  if (outcome.finishReason === "context_limit") {
    if (compaction.autocompactFailures === 0) {
      return { action: "continue", reason: "autocompact_recovery" };
    }
    if (compaction.reactiveCompactRetries < MAX_REACTIVE_COMPACT_RETRIES) {
      return { action: "continue", reason: "reactive_compact_retry" };
    }
    return { action: "fatal", error: "Context overflow unrecoverable" };
  }

  // Branch 4: stop hooks
  if (stopHookResult && !stopHookResult.pass) {
    return { action: "continue", reason: "stop_hook_rejected" };
  }

  // Branch 5: tool errors
  if (outcome.hasToolErrors) {
    return { action: "continue", reason: "tool_error_recovery" };
  }

  // Branch 6: clean final response
  return { action: "complete" };
}

/**
 * Return the max tokens value for the current escalation stage.
 * Clamps to the last stage if escalations exceed the array length.
 */
export function getEscalatedMaxTokens(
  compaction: CompactionState,
  stages?: number[],
): number {
  const s = stages ?? DEFAULT_ESCALATION_STAGES;
  const idx = Math.min(compaction.tokenEscalations, s.length - 1);
  return s[idx]!;
}

/**
 * Return a continuation system prompt for the given reason,
 * or undefined if no prompt is needed (e.g. tool_results_pending).
 */
export function applyContinuationPrompt(
  reason: ContinuationReason,
): string | undefined {
  switch (reason) {
    case "tool_results_pending":
      return undefined;
    case "token_budget_continuation":
      return "Continue where you left off. Do not repeat prior text unless needed for coherence.";
    case "reactive_compact_retry":
      return "Previous attempt exceeded budget. Continue using only the compacted context.";
    case "autocompact_recovery":
      return "Context window limit reached. The conversation has been compacted — continue with the available context.";
    case "stop_hook_rejected":
      return "Your previous response did not pass a quality check. Please revise and address the feedback.";
    case "tool_error_recovery":
      return "One or more tool calls returned errors. Review the errors and retry or adjust your approach.";
  }
}

/**
 * Compact a message history for retry after a context overflow.
 *
 * - Preserves a leading system prompt (if present)
 * - Keeps the last 4 non-system messages
 * - Inserts a compaction marker summarising how many messages were dropped
 * - Returns messages unchanged if there are 6 or fewer
 * - Does not mutate the input array
 */
export function reactiveCompact(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length <= 6) {
    return messages.map((m) => ({ ...m }));
  }

  const hasLeadingSystem = messages[0]?.role === "system";
  const leadingSystem: LLMMessage[] = hasLeadingSystem
    ? [{ ...messages[0]! }]
    : [];

  const workingMessages = hasLeadingSystem
    ? messages.slice(1)
    : messages.slice();

  const recentTail = workingMessages.slice(-4).map((m) => ({ ...m }));
  const omittedCount = workingMessages.length - recentTail.length;

  return [
    ...leadingSystem,
    {
      role: "system" as const,
      content: `[COMPACT_RETRY] Compacted ${omittedCount} earlier messages to recover from context overflow.`,
    },
    ...recentTail,
  ];
}

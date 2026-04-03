import type {
  AgentLoopTransitionReason,
  LLMMessage,
} from "../types.js";
import type { ModelSampleOutcome } from "./sampler.js";
import type { TurnEngineState } from "./state.js";

const MAX_TOKEN_CONTINUATIONS = 3;
const MAX_REACTIVE_COMPACT_RETRIES = 2;

export interface ContinuationDecision {
  action: "continue" | "complete";
  reason: AgentLoopTransitionReason | "final_response";
}

export function decideContinuation(
  state: TurnEngineState,
  outcome: ModelSampleOutcome,
): ContinuationDecision {
  if (outcome.toolRequests.length > 0) {
    return { action: "continue", reason: "next_turn" };
  }

  if (
    outcome.finishReason === "max_output_tokens" &&
    state.orchestration.recovery.tokenContinuations < MAX_TOKEN_CONTINUATIONS
  ) {
    return { action: "continue", reason: "token_budget_continuation" };
  }

  return { action: "complete", reason: "final_response" };
}

export function shouldRetryAfterModelError(
  state: TurnEngineState,
  error: unknown,
): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (!/prompt too long|context limit|context window|token limit|input too large/i.test(message)) {
    return false;
  }
  return state.orchestration.recovery.reactiveCompactRetries < MAX_REACTIVE_COMPACT_RETRIES;
}

export function applyContinuation(state: TurnEngineState, reason: AgentLoopTransitionReason): void {
  if (reason === "token_budget_continuation") {
    state.orchestration.recovery.tokenContinuations += 1;
    state.orchestration.continuationPrompt =
      "Continue from exactly where you left off. Do not repeat prior text unless needed for coherence.";
    state.orchestration.compactHint = "normal";
    return;
  }

  if (reason === "reactive_compact_retry") {
    state.orchestration.recovery.reactiveCompactRetries += 1;
    state.orchestration.continuationPrompt =
      "The previous attempt exceeded the prompt budget. Continue using only the compacted context.";
    state.orchestration.compactHint = "aggressive";
    state.messages = compactMessagesForRetry(state.messages);
    return;
  }

  state.orchestration.continuationPrompt = undefined;
  state.orchestration.compactHint = "normal";
}

export function clearContinuation(state: TurnEngineState): void {
  state.orchestration.continuationPrompt = undefined;
  state.orchestration.compactHint = "normal";
}

function compactMessagesForRetry(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length <= 6) {
    return messages.map((message) => ({ ...message }));
  }

  const leadingSystem = messages[0]?.role === "system" ? [messages[0]] : [];
  const workingMessages = leadingSystem.length > 0 ? messages.slice(1) : messages.slice();
  const recentTail = workingMessages.slice(-4).map((message) => ({ ...message }));
  const omittedCount = Math.max(workingMessages.length - recentTail.length, 0);

  return [
    ...leadingSystem.map((message) => ({ ...message })),
    {
      role: "system",
      content:
        `[HOST_COMPACT_RETRY]\nCompacted ${omittedCount} earlier messages to recover from a prompt budget error.`,
    },
    ...recentTail,
  ];
}

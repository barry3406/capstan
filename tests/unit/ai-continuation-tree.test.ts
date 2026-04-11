import { describe, expect, it } from "bun:test";

import type { LLMMessage, ToolRequest, ModelFinishReason } from "../../packages/ai/src/types.js";
import {
  decideContinuation,
  getEscalatedMaxTokens,
  applyContinuationPrompt,
  reactiveCompact,
} from "../../packages/ai/src/loop/continuation.js";
import type {
  CompactionState,
  ModelOutcome,
  StopHooksResult,
  ContinuationAction,
} from "../../packages/ai/src/loop/continuation.js";

function makeOutcome(overrides: Partial<ModelOutcome> = {}): ModelOutcome {
  return {
    content: "response text",
    toolRequests: [],
    finishReason: "stop",
    hasToolErrors: false,
    ...overrides,
  };
}

function makeCompaction(overrides: Partial<CompactionState> = {}): CompactionState {
  return {
    autocompactFailures: 0,
    reactiveCompactRetries: 0,
    tokenEscalations: 0,
    ...overrides,
  };
}

describe("decideContinuation — 6-branch decision tree", () => {
  // Branch 1: tool requests present → continue "tool_results_pending"
  it("Branch 1: continues with tool_results_pending when tool requests are present", () => {
    const outcome = makeOutcome({
      toolRequests: [{ id: "t1", name: "lookup", args: {}, order: 0 }],
    });
    const result = decideContinuation(outcome, makeCompaction());
    expect(result).toEqual({ action: "continue", reason: "tool_results_pending" });
  });

  it("Branch 1: tool requests take priority over max_output_tokens", () => {
    const outcome = makeOutcome({
      toolRequests: [{ id: "t1", name: "lookup", args: {}, order: 0 }],
      finishReason: "max_output_tokens",
    });
    const result = decideContinuation(outcome, makeCompaction());
    expect(result).toEqual({ action: "continue", reason: "tool_results_pending" });
  });

  // Branch 2a: max_output_tokens + escalations < 3 → continue "token_budget_continuation"
  it("Branch 2a: continues with token_budget_continuation when max_output_tokens and escalations < stages.length", () => {
    const outcome = makeOutcome({ finishReason: "max_output_tokens" });
    const compaction = makeCompaction({ tokenEscalations: 0 });
    const result = decideContinuation(outcome, compaction);
    expect(result).toEqual({ action: "continue", reason: "token_budget_continuation" });
  });

  it("Branch 2a: continues with token_budget_continuation at escalation 2 (< 3 default stages)", () => {
    const outcome = makeOutcome({ finishReason: "max_output_tokens" });
    const compaction = makeCompaction({ tokenEscalations: 2 });
    const result = decideContinuation(outcome, compaction);
    expect(result).toEqual({ action: "continue", reason: "token_budget_continuation" });
  });

  // Branch 2b: max_output_tokens + escalations >= 3 → complete
  it("Branch 2b: completes when max_output_tokens and all escalation stages exhausted", () => {
    const outcome = makeOutcome({ finishReason: "max_output_tokens" });
    const compaction = makeCompaction({ tokenEscalations: 3 });
    const result = decideContinuation(outcome, compaction);
    expect(result).toEqual({ action: "complete" });
  });

  it("Branch 2b: completes when escalations exceed stages length", () => {
    const outcome = makeOutcome({ finishReason: "max_output_tokens" });
    const compaction = makeCompaction({ tokenEscalations: 5 });
    const result = decideContinuation(outcome, compaction);
    expect(result).toEqual({ action: "complete" });
  });

  // Branch 3a: context_limit + autocompact not tried → continue "autocompact_recovery"
  it("Branch 3a: continues with autocompact_recovery on first context_limit", () => {
    const outcome = makeOutcome({ finishReason: "context_limit" });
    const compaction = makeCompaction({ autocompactFailures: 0 });
    const result = decideContinuation(outcome, compaction);
    expect(result).toEqual({ action: "continue", reason: "autocompact_recovery" });
  });

  // Branch 3b: context_limit + reactiveCompactRetries < 2 → continue "reactive_compact_retry"
  it("Branch 3b: continues with reactive_compact_retry after autocompact has failed", () => {
    const outcome = makeOutcome({ finishReason: "context_limit" });
    const compaction = makeCompaction({ autocompactFailures: 1, reactiveCompactRetries: 0 });
    const result = decideContinuation(outcome, compaction);
    expect(result).toEqual({ action: "continue", reason: "reactive_compact_retry" });
  });

  it("Branch 3b: continues with reactive_compact_retry at retry 1 (< 2 max)", () => {
    const outcome = makeOutcome({ finishReason: "context_limit" });
    const compaction = makeCompaction({ autocompactFailures: 1, reactiveCompactRetries: 1 });
    const result = decideContinuation(outcome, compaction);
    expect(result).toEqual({ action: "continue", reason: "reactive_compact_retry" });
  });

  // Branch 3c: context_limit + all retries exhausted → fatal
  it("Branch 3c: fatal when context_limit and all retries exhausted", () => {
    const outcome = makeOutcome({ finishReason: "context_limit" });
    const compaction = makeCompaction({ autocompactFailures: 1, reactiveCompactRetries: 2 });
    const result = decideContinuation(outcome, compaction);
    expect(result).toEqual({ action: "fatal", error: "Context overflow unrecoverable" });
  });

  it("Branch 3c: fatal when context_limit with high retry counts", () => {
    const outcome = makeOutcome({ finishReason: "context_limit" });
    const compaction = makeCompaction({ autocompactFailures: 3, reactiveCompactRetries: 5 });
    const result = decideContinuation(outcome, compaction);
    expect(result).toEqual({ action: "fatal", error: "Context overflow unrecoverable" });
  });

  // Branch 4a: stop hook fails → continue "stop_hook_rejected"
  it("Branch 4a: continues with stop_hook_rejected when stop hook fails", () => {
    const outcome = makeOutcome({ finishReason: "stop" });
    const stopResult: StopHooksResult = { pass: false, feedback: "Bad output", hookName: "quality" };
    const result = decideContinuation(outcome, makeCompaction(), stopResult);
    expect(result).toEqual({ action: "continue", reason: "stop_hook_rejected" });
  });

  it("Branch 4a: stop_hook_rejected includes no feedback if absent", () => {
    const outcome = makeOutcome({ finishReason: "stop" });
    const stopResult: StopHooksResult = { pass: false };
    const result = decideContinuation(outcome, makeCompaction(), stopResult);
    expect(result).toEqual({ action: "continue", reason: "stop_hook_rejected" });
  });

  // Branch 4b: stop hook passes → complete
  it("Branch 4b: completes when stop hook passes", () => {
    const outcome = makeOutcome({ finishReason: "stop" });
    const stopResult: StopHooksResult = { pass: true };
    const result = decideContinuation(outcome, makeCompaction(), stopResult);
    expect(result).toEqual({ action: "complete" });
  });

  // Branch 5: tool errors present → continue "tool_error_recovery"
  it("Branch 5: continues with tool_error_recovery when hasToolErrors is true", () => {
    const outcome = makeOutcome({ finishReason: "stop", hasToolErrors: true });
    const result = decideContinuation(outcome, makeCompaction());
    expect(result).toEqual({ action: "continue", reason: "tool_error_recovery" });
  });

  it("Branch 5: tool errors checked after stop hooks", () => {
    const outcome = makeOutcome({ finishReason: "stop", hasToolErrors: true });
    const stopResult: StopHooksResult = { pass: true };
    const result = decideContinuation(outcome, makeCompaction(), stopResult);
    expect(result).toEqual({ action: "continue", reason: "tool_error_recovery" });
  });

  // Branch 6: clean final response → complete
  it("Branch 6: completes on clean final response with stop finish reason", () => {
    const outcome = makeOutcome({ finishReason: "stop" });
    const result = decideContinuation(outcome, makeCompaction());
    expect(result).toEqual({ action: "complete" });
  });

  it("Branch 6: completes on clean final response with no stop hook result", () => {
    const outcome = makeOutcome({ finishReason: "stop", hasToolErrors: false });
    const result = decideContinuation(outcome, makeCompaction(), undefined);
    expect(result).toEqual({ action: "complete" });
  });

  // Branch: finishReason "error" → fatal
  it("returns fatal for finishReason 'error'", () => {
    const result = decideContinuation(
      { content: "", toolRequests: [], finishReason: "error" },
      { autocompactFailures: 0, reactiveCompactRetries: 0, tokenEscalations: 0 },
    );
    expect(result).toEqual({ action: "fatal", error: "LLM call failed" });
  });

  // Custom escalation stages
  it("uses custom escalation stages for max_output_tokens branch", () => {
    const outcome = makeOutcome({ finishReason: "max_output_tokens" });
    const compaction = makeCompaction({ tokenEscalations: 1 });
    const customStages = [4096, 8192];
    const result = decideContinuation(outcome, compaction, undefined, customStages);
    expect(result).toEqual({ action: "continue", reason: "token_budget_continuation" });
  });

  it("completes when escalations exhaust custom stages", () => {
    const outcome = makeOutcome({ finishReason: "max_output_tokens" });
    const compaction = makeCompaction({ tokenEscalations: 2 });
    const customStages = [4096, 8192];
    const result = decideContinuation(outcome, compaction, undefined, customStages);
    expect(result).toEqual({ action: "complete" });
  });
});

describe("getEscalatedMaxTokens", () => {
  it("returns correct default stage values [8192, 16384, 65536]", () => {
    expect(getEscalatedMaxTokens(makeCompaction({ tokenEscalations: 0 }))).toBe(8192);
    expect(getEscalatedMaxTokens(makeCompaction({ tokenEscalations: 1 }))).toBe(16384);
    expect(getEscalatedMaxTokens(makeCompaction({ tokenEscalations: 2 }))).toBe(65536);
  });

  it("clamps to last stage when escalations exceed array length", () => {
    expect(getEscalatedMaxTokens(makeCompaction({ tokenEscalations: 5 }))).toBe(65536);
    expect(getEscalatedMaxTokens(makeCompaction({ tokenEscalations: 100 }))).toBe(65536);
  });

  it("uses custom escalation stages", () => {
    const custom = [2048, 4096, 8192, 32768];
    expect(getEscalatedMaxTokens(makeCompaction({ tokenEscalations: 0 }), custom)).toBe(2048);
    expect(getEscalatedMaxTokens(makeCompaction({ tokenEscalations: 3 }), custom)).toBe(32768);
    expect(getEscalatedMaxTokens(makeCompaction({ tokenEscalations: 10 }), custom)).toBe(32768);
  });
});

describe("applyContinuationPrompt", () => {
  it("returns continuation text for token_budget_continuation", () => {
    const prompt = applyContinuationPrompt("token_budget_continuation");
    expect(prompt).toContain("Continue where you left off");
  });

  it("returns budget exceeded text for reactive_compact_retry", () => {
    const prompt = applyContinuationPrompt("reactive_compact_retry");
    expect(prompt).toContain("Previous attempt exceeded budget");
  });

  it("returns undefined for tool_results_pending", () => {
    const prompt = applyContinuationPrompt("tool_results_pending");
    expect(prompt).toBeUndefined();
  });

  it("returns text for autocompact_recovery", () => {
    const prompt = applyContinuationPrompt("autocompact_recovery");
    expect(prompt).toBeDefined();
    expect(typeof prompt).toBe("string");
  });

  it("returns text for stop_hook_rejected", () => {
    const prompt = applyContinuationPrompt("stop_hook_rejected");
    expect(prompt).toBeDefined();
    expect(typeof prompt).toBe("string");
  });

  it("returns text for tool_error_recovery", () => {
    const prompt = applyContinuationPrompt("tool_error_recovery");
    expect(prompt).toBeDefined();
    expect(typeof prompt).toBe("string");
  });
});

describe("reactiveCompact", () => {
  it("keeps system prompt and last 4 messages", () => {
    const messages: LLMMessage[] = [
      { role: "system", content: "system instructions" },
      { role: "user", content: "msg1" },
      { role: "assistant", content: "msg2" },
      { role: "user", content: "msg3" },
      { role: "assistant", content: "msg4" },
      { role: "user", content: "msg5" },
      { role: "assistant", content: "msg6" },
      { role: "user", content: "msg7" },
    ];
    const result = reactiveCompact(messages);
    // system prompt + compaction marker + last 4
    expect(result).toHaveLength(6);
    expect(result[0]!.role).toBe("system");
    expect(result[0]!.content).toBe("system instructions");
    expect(result[1]!.role).toBe("system");
    expect(result[1]!.content).toContain("[COMPACT_RETRY]");
    expect(result[1]!.content).toContain("Compacted");
    // last 4 messages from original
    expect(result[2]!.content).toBe("msg4");
    expect(result[3]!.content).toBe("msg5");
    expect(result[4]!.content).toBe("msg6");
    expect(result[5]!.content).toBe("msg7");
  });

  it("inserts compaction marker with correct omitted count", () => {
    const messages: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
      { role: "user", content: "e" },
      { role: "assistant", content: "f" },
      { role: "user", content: "g" },
      { role: "assistant", content: "h" },
      { role: "user", content: "i" },
    ];
    const result = reactiveCompact(messages);
    const marker = result.find((m) => m.content.includes("[COMPACT_RETRY]"));
    expect(marker).toBeDefined();
    // 9 non-system messages, last 4 kept, so 5 omitted
    expect(marker!.content).toContain("5");
  });

  it("handles messages shorter than 6 by returning them unchanged", () => {
    const messages: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];
    const result = reactiveCompact(messages);
    expect(result).toHaveLength(3);
    expect(result[0]!.content).toBe("sys");
    expect(result[1]!.content).toBe("a");
    expect(result[2]!.content).toBe("b");
  });

  it("handles messages without a leading system prompt", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
      { role: "user", content: "e" },
      { role: "assistant", content: "f" },
      { role: "user", content: "g" },
    ];
    const result = reactiveCompact(messages);
    // no system prompt, compaction marker + last 4
    expect(result).toHaveLength(5);
    expect(result[0]!.role).toBe("system");
    expect(result[0]!.content).toContain("[COMPACT_RETRY]");
    // 7 messages, last 4 kept, 3 omitted
    expect(result[0]!.content).toContain("3");
    expect(result[1]!.content).toBe("d");
    expect(result[2]!.content).toBe("e");
    expect(result[3]!.content).toBe("f");
    expect(result[4]!.content).toBe("g");
  });

  it("does not mutate original messages", () => {
    const messages: LLMMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
      { role: "user", content: "e" },
      { role: "assistant", content: "f" },
    ];
    const originalLength = messages.length;
    reactiveCompact(messages);
    expect(messages).toHaveLength(originalLength);
    expect(messages[0]!.content).toBe("sys");
  });
});

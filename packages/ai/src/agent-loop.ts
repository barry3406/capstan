import type {
  AgentRunConfig,
  AgentRunResult,
  AgentTool,
  LLMProvider,
} from "./types.js";
import type { RunAgentLoopOptions } from "./loop/state.js";
import { runTurnEngine } from "./loop/engine.js";

/**
 * Run an agent loop: LLM -> tool calls -> results -> repeat until done.
 *
 * Stage 3A upgrades this into a host-driven turn engine while preserving the
 * existing public API surface for callers and harness integration.
 */
export async function runAgentLoop(
  llm: LLMProvider,
  config: AgentRunConfig,
  tools: AgentTool[],
  opts?: RunAgentLoopOptions,
): Promise<AgentRunResult> {
  return runTurnEngine(llm, config, tools, opts);
}

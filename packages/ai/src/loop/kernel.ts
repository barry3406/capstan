import type {
  AgentRunConfig,
  AgentRunResult,
  AgentTool,
  LLMProvider,
} from "../types.js";
import type { RunAgentLoopOptions } from "./state.js";
import { runTurnEngine } from "./engine.js";

export async function runAgentLoopKernel(
  llm: LLMProvider,
  config: AgentRunConfig,
  tools: AgentTool[],
  opts?: RunAgentLoopOptions,
): Promise<AgentRunResult> {
  return runTurnEngine(llm, config, tools, opts);
}

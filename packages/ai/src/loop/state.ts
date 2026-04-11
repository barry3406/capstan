import type {
  LLMMessage,
  AgentTool,
  AgentTask,
  AgentToolCallRecord,
  AgentTaskCallRecord,
  AgentCheckpoint,
  SmartAgentConfig,
} from "../types.js";
import type { CompactionState } from "./continuation.js";

export interface EngineState {
  goal: string;
  maxIterations: number;
  contextWindowSize: number;
  messages: LLMMessage[];
  tools: AgentTool[];
  tasks: AgentTask[];
  toolCalls: AgentToolCallRecord[];
  taskCalls: AgentTaskCallRecord[];
  iterations: number;
  maxOutputTokens: number;
  compaction: CompactionState;
  continuationPrompt?: string | undefined;
  lastAssistantContent?: string | undefined;
  /** Accumulated output tokens across iterations for token budget tracking */
  outputTokensUsed: number;
  /** Whether the budget nudge warning has been sent this run */
  budgetNudgeSent: boolean;
  /** Epoch timestamp when the run started */
  runStartTime: number;
  /** Set of memory content hashes already injected (dedup for dynamic enrichment) */
  seenMemoryHashes: Set<string>;
  /** Cache for microcompact — avoids re-truncating already-processed messages */
  microcompactCache: Map<string, string>;
  /** Retry counts for tool error withholding — toolRequestId → retry count */
  toolRetries: Map<string, number>;
}

export function createEngineState(
  config: SmartAgentConfig,
  goal: string,
  checkpoint?: AgentCheckpoint,
  resumeMessage?: string,
): EngineState {
  if (checkpoint) {
    const state: EngineState = {
      goal: checkpoint.goal,
      maxIterations: config.maxIterations ?? 200,
      contextWindowSize: config.contextWindowSize ?? 200_000,
      messages: checkpoint.messages.map((m) => ({ ...m })),
      tools: config.tools,
      tasks: config.tasks ?? [],
      toolCalls: checkpoint.toolCalls.map((c) => ({ ...c })),
      taskCalls: checkpoint.taskCalls.map((c) => ({ ...c })),
      iterations: checkpoint.iterations,
      maxOutputTokens: checkpoint.maxOutputTokens,
      compaction: { ...checkpoint.compaction },
      outputTokensUsed: 0,
      budgetNudgeSent: false,
      runStartTime: Date.now(),
      seenMemoryHashes: new Set(),
      microcompactCache: new Map(),
      toolRetries: new Map(),
    };
    // If resuming with a new message, append it
    if (resumeMessage) {
      state.messages.push({ role: "user", content: resumeMessage });
    }
    return state;
  }

  return {
    goal,
    maxIterations: config.maxIterations ?? 200,
    contextWindowSize: config.contextWindowSize ?? 200_000,
    messages: [], // Engine will set system prompt + user goal
    tools: config.tools,
    tasks: config.tasks ?? [],
    toolCalls: [],
    taskCalls: [],
    iterations: 0,
    maxOutputTokens: 8192,
    compaction: {
      autocompactFailures: 0,
      reactiveCompactRetries: 0,
      tokenEscalations: 0,
    },
    outputTokensUsed: 0,
    budgetNudgeSent: false,
    runStartTime: Date.now(),
    seenMemoryHashes: new Set(),
    microcompactCache: new Map(),
    toolRetries: new Map(),
  };
}

export function buildCheckpoint(state: EngineState, stage: AgentCheckpoint["stage"] = "initialized"): AgentCheckpoint {
  return {
    stage,
    goal: state.goal,
    messages: state.messages.map((m) => ({ ...m })),
    iterations: state.iterations,
    toolCalls: state.toolCalls.map((c) => ({ ...c })),
    taskCalls: state.taskCalls.map((c) => ({ ...c })),
    maxOutputTokens: state.maxOutputTokens,
    compaction: { ...state.compaction },
  };
}

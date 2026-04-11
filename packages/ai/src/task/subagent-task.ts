import { createSmartAgent } from "../smart-agent.js";
import type {
  AgentTask,
  AgentTaskExecutionContext,
  AgentTool,
  LLMProvider,
  SmartAgentConfig,
} from "../types.js";

export interface SubagentTaskOptions {
  name: string;
  description?: string;
  llm: LLMProvider;
  buildConfig(args: Record<string, unknown>): Partial<SmartAgentConfig> & { goal: string };
  tools?: AgentTool[];
  tasks?: AgentTask[];
  isConcurrencySafe?: boolean;
  failureMode?: "soft" | "hard";
}

export function createSubagentTask(options: SubagentTaskOptions): AgentTask {
  return {
    name: options.name,
    description: options.description ?? `Runs subagent task ${options.name}`,
    kind: "subagent",
    isConcurrencySafe: options.isConcurrencySafe,
    failureMode: options.failureMode,
    async execute(args, context: AgentTaskExecutionContext) {
      throwIfTaskAborted(context);
      const runConfig = options.buildConfig(args);
      const agent = createSmartAgent({
        llm: options.llm,
        tools: runConfig.tools ?? options.tools ?? [],
        tasks: runConfig.tasks ?? options.tasks,
        maxIterations: runConfig.maxIterations,
        hooks: {
          ...runConfig.hooks,
          getControlState: async () => {
            if (context.signal.aborted) {
              return { action: "cancel" as const };
            }
            return { action: "continue" as const };
          },
        },
      });
      const result = await agent.run(runConfig.goal);
      throwIfTaskAborted(context);
      if (result.status === "canceled") {
        throw new Error(taskAbortReason(context.signal));
      }
      return result;
    },
  };
}

function throwIfTaskAborted(context: AgentTaskExecutionContext): void {
  if (typeof context.signal.throwIfAborted === "function") {
    context.signal.throwIfAborted();
    return;
  }
  if (context.signal.aborted) {
    throw new Error(taskAbortReason(context.signal));
  }
}

function taskAbortReason(signal: AbortSignal): string {
  const reason = "reason" in signal ? (signal as AbortSignal & { reason?: unknown }).reason : undefined;
  if (typeof reason === "string" && reason.trim()) {
    return reason;
  }
  return "Task canceled";
}

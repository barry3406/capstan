import { runAgentLoop } from "../agent-loop.js";
import type {
  AgentRunConfig,
  AgentTask,
  AgentTaskExecutionContext,
  AgentTool,
  LLMProvider,
} from "../types.js";

export interface SubagentTaskOptions {
  name: string;
  description?: string;
  llm: LLMProvider;
  buildConfig(args: Record<string, unknown>): AgentRunConfig;
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
      const config = options.buildConfig(args);
      const tools = config.tools ?? options.tools ?? [];
      const result = await runAgentLoop(
        options.llm,
        {
          ...config,
          ...(config.tasks ?? options.tasks
            ? { tasks: config.tasks ?? options.tasks }
            : {}),
        },
        tools,
        {
          control: {
            async check() {
              return context.signal.aborted ? "cancel" : "continue";
            },
          },
          callStack: new Set([...(context.callStack ?? []), options.name]),
        },
      );
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

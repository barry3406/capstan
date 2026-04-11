import type { AgentTask, AgentTaskExecutionContext } from "../types.js";

export interface RemoteTaskOptions {
  name: string;
  description?: string;
  invoke(
    args: Record<string, unknown>,
    context: AgentTaskExecutionContext,
  ): Promise<unknown>;
  isConcurrencySafe?: boolean;
  failureMode?: "soft" | "hard";
}

export function createRemoteTask(options: RemoteTaskOptions): AgentTask {
  return {
    name: options.name,
    description: options.description ?? `Runs remote task ${options.name}`,
    kind: "remote",
    isConcurrencySafe: options.isConcurrencySafe,
    failureMode: options.failureMode,
    async execute(args, context) {
      throwIfTaskAborted(context);
      return options.invoke(args, context);
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

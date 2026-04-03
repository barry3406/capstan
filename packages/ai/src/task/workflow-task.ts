import type { AgentTask, AgentTaskExecutionContext } from "../types.js";

export interface WorkflowTaskStep {
  name: string;
  run(
    args: Record<string, unknown>,
    context: AgentTaskExecutionContext,
  ): Promise<unknown>;
}

export interface WorkflowTaskOptions {
  name: string;
  description?: string;
  steps?: WorkflowTaskStep[];
  handler?: (
    args: Record<string, unknown>,
    context: AgentTaskExecutionContext,
  ) => Promise<unknown>;
  isConcurrencySafe?: boolean;
  failureMode?: "soft" | "hard";
}

export function createWorkflowTask(options: WorkflowTaskOptions): AgentTask {
  if ((!options.steps || options.steps.length === 0) && !options.handler) {
    throw new Error(`Workflow task ${options.name} requires steps or a handler`);
  }

  return {
    name: options.name,
    description: options.description ?? `Runs workflow ${options.name}`,
    kind: "workflow",
    isConcurrencySafe: options.isConcurrencySafe,
    failureMode: options.failureMode,
    async execute(args, context) {
      throwIfTaskAborted(context.signal);
      if (options.handler) {
        return options.handler(args, context);
      }

      const results: Array<{ step: string; result: unknown }> = [];
      for (const step of options.steps ?? []) {
        throwIfTaskAborted(context.signal);
        const result = await step.run(args, context);
        results.push({ step: step.name, result });
      }
      return { steps: results };
    },
  };
}

function throwIfTaskAborted(signal: AbortSignal): void {
  if (typeof signal.throwIfAborted === "function") {
    signal.throwIfAborted();
    return;
  }
  if (signal.aborted) {
    throw new Error(taskAbortReason(signal));
  }
}

function taskAbortReason(signal: AbortSignal): string {
  const reason = "reason" in signal ? (signal as AbortSignal & { reason?: unknown }).reason : undefined;
  if (typeof reason === "string" && reason.trim()) {
    return reason;
  }
  return "Workflow task canceled";
}

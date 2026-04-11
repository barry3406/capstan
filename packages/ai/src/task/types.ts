import type {
  AgentTask,
  AgentTaskKind,
  ToolRequest,
} from "../types.js";

export type AgentTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export interface AgentTaskRecord {
  id: string;
  runId: string;
  requestId: string;
  name: string;
  kind: AgentTaskKind;
  order: number;
  status: AgentTaskStatus;
  createdAt: string;
  updatedAt: string;
  args: Record<string, unknown>;
  result?: unknown | undefined;
  error?: string | undefined;
  hardFailure: boolean;
}

export interface AgentTaskNotification {
  runId: string;
  taskId: string;
  requestId: string;
  name: string;
  kind: AgentTaskKind;
  order: number;
  status: AgentTaskStatus;
  args: Record<string, unknown>;
  result?: unknown | undefined;
  error?: string | undefined;
  hardFailure: boolean;
}

export interface AgentTaskSubmitHooks {
  onSubmitted?(record: AgentTaskRecord): Promise<void> | void;
  onSettled?(
    record: AgentTaskRecord,
    notification: AgentTaskNotification,
  ): Promise<void> | void;
}

export interface AgentTaskSubmitResult {
  records: AgentTaskRecord[];
}

export interface AgentTaskBatchInput {
  runId: string;
  requests: ToolRequest[];
  tasks: AgentTask[];
  hooks?: AgentTaskSubmitHooks;
  callStack?: ReadonlySet<string> | undefined;
}

export interface AgentTaskRuntime {
  submitBatch(input: AgentTaskBatchInput): Promise<AgentTaskSubmitResult>;
  nextNotification(
    runId: string,
    options?: {
      timeoutMs?: number;
    },
  ): Promise<AgentTaskNotification | undefined>;
  cancelTasks(
    runId: string,
    taskIds: string[],
    reason?: string,
  ): Promise<void>;
  cancelRun(runId: string, reason?: string): Promise<void>;
  getActiveTaskIds(runId: string): string[];
  destroy(): Promise<void>;
}

import type { AgentTaskCallRecord } from "../types.js";
import type { AgentTaskNotification, AgentTaskRuntime, AgentTaskSubmitResult } from "../task/types.js";
import type { PendingTaskExecution, RunAgentLoopOptions, TurnEngineState } from "./state.js";

export interface TaskExecutionOutcome {
  records: AgentTaskCallRecord[];
  blockedApproval?: { kind: "task"; tool: string; args: unknown; reason: string } | undefined;
  haltedByHardFailure: boolean;
  remaining: PendingTaskExecution[];
  waitingTaskIds: string[];
}

export async function submitTaskRequests(
  state: TurnEngineState,
  requests: PendingTaskExecution[],
  runtime: AgentTaskRuntime,
  opts: RunAgentLoopOptions | undefined,
  skipPolicyForFirstPendingTask: boolean,
): Promise<{
  submitted: AgentTaskSubmitResult;
  blockedApproval?: { kind: "task"; tool: string; args: unknown; reason: string } | undefined;
}> {
  const approved: PendingTaskExecution[] = [];
  let policySkipConsumed = false;

  for (const request of requests) {
    const shouldSkipPolicy = skipPolicyForFirstPendingTask && !policySkipConsumed;
    if (!shouldSkipPolicy && opts?.beforeTaskCall) {
      const policy = await opts.beforeTaskCall(request.name, request.args);
      if (!policy.allowed) {
        return {
          submitted: { records: [] },
          blockedApproval: {
            kind: "task",
            tool: request.name,
            args: cloneArgs(request.args),
            reason: policy.reason ?? "Task call blocked by policy",
          },
        };
      }
    }
    if (shouldSkipPolicy) {
      policySkipConsumed = true;
    }
    approved.push({
      ...request,
      args: cloneArgs(request.args),
    });
  }

  const submitted = await runtime.submitBatch({
    runId: opts?.runId ?? "standalone-run",
    requests: approved.map((request) => ({
      id: request.id,
      name: request.name,
      args: cloneArgs(request.args),
      order: request.order,
    })),
    tasks: state.availableTasks,
    ...(opts?.callStack ? { callStack: opts.callStack } : {}),
    hooks: {
      onSubmitted: async (record) => {
        await opts?.onTaskSubmitted?.({
          id: record.id,
          runId: record.runId,
          requestId: record.requestId,
          name: record.name,
          kind: record.kind,
          order: record.order,
          status: record.status,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          args: cloneArgs(record.args),
          hardFailure: record.hardFailure,
        });
      },
      onSettled: async (record) => {
        const payload = {
          id: record.id,
          runId: record.runId,
          requestId: record.requestId,
          name: record.name,
          kind: record.kind,
          order: record.order,
          status: record.status,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          args: cloneArgs(record.args),
          hardFailure: record.hardFailure,
          ...(record.result !== undefined ? { result: cloneUnknown(record.result) } : {}),
          ...(record.error ? { error: record.error } : {}),
        };
        await opts?.onTaskSettled?.(payload);
      },
    },
  });

  return { submitted };
}

export function applyTaskNotification(
  state: TurnEngineState,
  notification: AgentTaskNotification,
): AgentTaskCallRecord {
  const record: AgentTaskCallRecord = {
    task: notification.name,
    args: cloneArgs(notification.args),
    result:
      notification.status === "completed"
        ? cloneUnknown(notification.result)
        : { error: notification.error ?? notification.status },
    requestId: notification.requestId,
    taskId: notification.taskId,
    order: notification.order,
    status:
      notification.status === "completed"
        ? "success"
        : notification.status === "canceled"
          ? "canceled"
          : "error",
    kind: notification.kind,
  };

  state.taskCalls.push({ ...record });
  state.messages.push({
    role: "user",
    content: formatTaskResultMessage(notification),
  });
  state.pendingTaskRequests = state.pendingTaskRequests.filter(
    (request) => request.id !== notification.requestId,
  );
  state.orchestration.pendingTaskRequests = state.pendingTaskRequests.map((request) => ({
    id: request.id,
    name: request.name,
    args: cloneArgs(request.args),
    order: request.order,
  }));
  state.orchestration.waitingTaskIds = state.orchestration.waitingTaskIds?.filter(
    (taskId) => taskId !== notification.taskId,
  );
  return record;
}

export function formatTaskResultMessage(
  notification: AgentTaskNotification,
): string {
  if (notification.status === "completed") {
    return `Task "${notification.name}" completed:\n${JSON.stringify(notification.result, null, 2)}`;
  }
  if (notification.status === "canceled") {
    return `Task "${notification.name}" canceled:\n${notification.error ?? "Task canceled"}`;
  }
  return `Task "${notification.name}" failed:\n${notification.error ?? "Task failed"}`;
}

function cloneArgs(args: Record<string, unknown>): Record<string, unknown> {
  return cloneUnknown(args) as Record<string, unknown>;
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneUnknown);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        cloneUnknown(nested),
      ]),
    );
  }
  return value;
}

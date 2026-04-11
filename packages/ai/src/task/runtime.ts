import { randomUUID } from "node:crypto";

import type {
  AgentTask,
  AgentTaskExecutionContext,
  AgentTaskKind,
  ToolRequest,
} from "../types.js";
import type {
  AgentTaskBatchInput,
  AgentTaskNotification,
  AgentTaskRecord,
  AgentTaskRuntime,
  AgentTaskStatus,
  AgentTaskSubmitHooks,
  AgentTaskSubmitResult,
} from "./types.js";

interface ActiveTaskState {
  controller: AbortController;
  record: AgentTaskRecord;
  request: ToolRequest;
  settled: boolean;
}

interface NotificationWaiter {
  resolve(notification: AgentTaskNotification | undefined): void;
  reject(error: Error): void;
  clearTimer(): void;
}

export class InMemoryAgentTaskRuntime implements AgentTaskRuntime {
  private readonly activeTasks = new Map<string, Map<string, ActiveTaskState>>();
  private readonly notifications = new Map<string, AgentTaskNotification[]>();
  private readonly waiters = new Map<string, NotificationWaiter[]>();
  private readonly runtimeErrors = new Map<string, Error[]>();
  private readonly settledTaskIds = new Set<string>();
  private destroyed = false;

  async submitBatch(input: AgentTaskBatchInput): Promise<AgentTaskSubmitResult> {
    if (this.destroyed) {
      throw new Error("Task runtime destroyed");
    }
    const tasksByName = new Map<string, AgentTask>();
    for (const task of input.tasks) {
      if (!tasksByName.has(task.name)) {
        tasksByName.set(task.name, task);
      }
    }

    const submitted: AgentTaskRecord[] = [];
    const startedTaskIds: string[] = [];
    try {
      for (const request of input.requests) {
        const task = tasksByName.get(request.name);
        const taskId = `task_${randomUUID()}`;
        const now = new Date().toISOString();
        const kind = normalizeTaskKind(task?.kind);
        const record: AgentTaskRecord = {
          id: taskId,
          runId: input.runId,
          requestId: request.id,
          name: request.name,
          kind,
          order: request.order,
          status: "running",
          createdAt: now,
          updatedAt: now,
          args: cloneArgs(request.args),
          hardFailure: task?.failureMode === "hard",
        };
        submitted.push(record);
        await input.hooks?.onSubmitted?.(cloneTaskRecord(record));

        if (!task) {
          await this.settleTask(
            record,
            request,
            "failed",
            undefined,
            `Task "${request.name}" not found`,
            input.hooks,
          );
          continue;
        }

        const controller = new AbortController();
        const active = this.getOrCreateRunState(input.runId);
        const state: ActiveTaskState = {
          controller,
          record,
          request,
          settled: false,
        };
        active.set(taskId, state);
        startedTaskIds.push(taskId);

        const onAbort = () => {
          void this.settleTask(
            state.record,
            state.request,
            "canceled",
            undefined,
            abortReason(controller.signal),
            input.hooks,
          );
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });

        void Promise.resolve()
          .then(async () => {
            const context: AgentTaskExecutionContext = {
              signal: controller.signal,
              runId: input.runId,
              requestId: request.id,
              taskId,
              order: request.order,
              ...(input.callStack ? { callStack: new Set(input.callStack) } : {}),
            };
            return task.execute(cloneArgs(request.args), context);
          })
          .then(async (result) => {
            await this.settleTask(
              state.record,
              state.request,
              "completed",
              result,
              undefined,
              input.hooks,
            );
          })
          .catch(async (error) => {
            const aborted = controller.signal.aborted;
            await this.settleTask(
              state.record,
              state.request,
              aborted ? "canceled" : "failed",
              undefined,
              aborted
                ? abortReason(controller.signal)
                : error instanceof Error
                  ? error.message
                  : String(error),
              input.hooks,
            );
          })
          .finally(() => {
            controller.signal.removeEventListener("abort", onAbort);
          });
      }
    } catch (error) {
      await this.cancelTasks(
        input.runId,
        startedTaskIds,
        `Task batch submission failed: ${formatErrorMessage(error)}`,
      ).catch(() => undefined);
      await this.waitForRunToDrain(input.runId, 100).catch(() => undefined);
      throw error;
    }

    return { records: submitted.map(cloneTaskRecord) };
  }

  async nextNotification(
    runId: string,
    options?: {
      timeoutMs?: number;
    },
  ): Promise<AgentTaskNotification | undefined> {
    if (this.destroyed) {
      return undefined;
    }
    const runtimeError = this.shiftRuntimeError(runId);
    if (runtimeError) {
      throw runtimeError;
    }

    const queue = this.notifications.get(runId);
    if (queue && queue.length > 0) {
      return cloneTaskNotification(queue.shift()!);
    }

    return new Promise<AgentTaskNotification | undefined>((resolve, reject) => {
      const waiters = this.waiters.get(runId) ?? [];
      this.waiters.set(runId, waiters);
      const waiter = createNotificationWaiter({
        resolve: (notification) =>
          resolve(notification ? cloneTaskNotification(notification) : undefined),
        reject,
        timeoutMs: options?.timeoutMs,
        onTimeout: () => {
          this.removeWaiter(runId, waiter);
          resolve(undefined);
        },
      });
      waiters.push(waiter);

      const errorAfterWait = this.shiftRuntimeError(runId);
      if (errorAfterWait) {
        this.removeWaiter(runId, waiter);
        waiter.reject(errorAfterWait);
      }
    });
  }

  async cancelTasks(
    runId: string,
    taskIds: string[],
    reason?: string,
  ): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const active = this.activeTasks.get(runId);
    if (!active) {
      return;
    }
    for (const taskId of taskIds) {
      active.get(taskId)?.controller.abort(reason ?? "Task canceled");
    }
  }

  async cancelRun(runId: string, reason?: string): Promise<void> {
    await this.cancelTasks(runId, this.getActiveTaskIds(runId), reason);
  }

  getActiveTaskIds(runId: string): string[] {
    return Array.from(this.activeTasks.get(runId)?.keys() ?? []);
  }

  async destroy(): Promise<void> {
    const runIds = Array.from(this.activeTasks.keys());
    await Promise.all(runIds.map((runId) => this.cancelRun(runId, "Task runtime destroyed")));
    await Promise.all(runIds.map((runId) => this.waitForRunToDrain(runId, 100).catch(() => undefined)));
    this.destroyed = true;
    for (const [runId, waiters] of this.waiters.entries()) {
      this.waiters.delete(runId);
      for (const waiter of waiters) {
        waiter.resolve(undefined);
      }
    }
    this.activeTasks.clear();
    this.notifications.clear();
    this.runtimeErrors.clear();
    this.settledTaskIds.clear();
  }

  private getOrCreateRunState(runId: string): Map<string, ActiveTaskState> {
    let active = this.activeTasks.get(runId);
    if (!active) {
      active = new Map<string, ActiveTaskState>();
      this.activeTasks.set(runId, active);
    }
    return active;
  }

  private async settleTask(
    record: AgentTaskRecord,
    request: ToolRequest,
    status: AgentTaskStatus,
    result: unknown,
    error: string | undefined,
    hooks: AgentTaskSubmitHooks | undefined,
  ): Promise<void> {
    if (this.destroyed) {
      return;
    }
    if (this.settledTaskIds.has(record.id)) {
      return;
    }
    this.settledTaskIds.add(record.id);
    const active = this.activeTasks.get(record.runId);
    const state = active?.get(record.id);
    if (state?.settled) {
      return;
    }
    if (state) {
      state.settled = true;
      active?.delete(record.id);
      if (active && active.size === 0) {
        this.activeTasks.delete(record.runId);
      }
    }

    const settledRecord: AgentTaskRecord = {
      ...record,
      status,
      updatedAt: new Date().toISOString(),
      ...(result !== undefined ? { result: cloneUnknown(result) } : {}),
      ...(error ? { error } : {}),
    };
    const notification: AgentTaskNotification = {
      runId: record.runId,
      taskId: record.id,
      requestId: request.id,
      name: record.name,
      kind: record.kind,
      order: record.order,
      status,
      args: cloneArgs(request.args),
      hardFailure: record.hardFailure,
      ...(result !== undefined ? { result: cloneUnknown(result) } : {}),
      ...(error ? { error } : {}),
    };

    try {
      await hooks?.onSettled?.(cloneTaskRecord(settledRecord), cloneTaskNotification(notification));
    } catch (hookError) {
      this.enqueueRuntimeError(
        record.runId,
        new Error(
          `Task "${record.name}" settlement bookkeeping failed: ${formatErrorMessage(hookError)}`,
        ),
      );
      return;
    }
    this.enqueueNotification(record.runId, notification);
  }

  private async waitForRunToDrain(runId: string, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if ((this.activeTasks.get(runId)?.size ?? 0) === 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private enqueueNotification(runId: string, notification: AgentTaskNotification): void {
    const waiters = this.waiters.get(runId);
    if (waiters && waiters.length > 0) {
      const waiter = waiters.shift()!;
      waiter.resolve(notification);
      return;
    }
    const queue = this.notifications.get(runId) ?? [];
    queue.push(notification);
    this.notifications.set(runId, queue);
  }

  private enqueueRuntimeError(runId: string, error: Error): void {
    const waiters = this.waiters.get(runId);
    if (waiters && waiters.length > 0) {
      this.waiters.delete(runId);
      for (const waiter of waiters) {
        waiter.reject(error);
      }
      return;
    }
    const queue = this.runtimeErrors.get(runId) ?? [];
    queue.push(error);
    this.runtimeErrors.set(runId, queue);
  }

  private shiftRuntimeError(runId: string): Error | undefined {
    const queue = this.runtimeErrors.get(runId);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const error = queue.shift();
    if (queue.length === 0) {
      this.runtimeErrors.delete(runId);
    }
    return error;
  }

  private removeWaiter(runId: string, target: NotificationWaiter): void {
    const current = this.waiters.get(runId);
    if (!current) {
      return;
    }
    const next = current.filter((entry) => entry !== target);
    if (next.length === 0) {
      this.waiters.delete(runId);
      return;
    }
    this.waiters.set(runId, next);
  }
}

function normalizeTaskKind(kind: AgentTask["kind"]): AgentTaskKind {
  return kind ?? "custom";
}

function abortReason(signal: AbortSignal): string {
  const reason = "reason" in signal ? (signal as AbortSignal & { reason?: unknown }).reason : undefined;
  if (typeof reason === "string" && reason.trim()) {
    return reason;
  }
  return "Task canceled";
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createNotificationWaiter(input: {
  resolve(notification: AgentTaskNotification | undefined): void;
  reject(error: Error): void;
  timeoutMs?: number | undefined;
  onTimeout(): void;
}): NotificationWaiter {
  const timer =
    input.timeoutMs != null && input.timeoutMs > 0
      ? setTimeout(() => {
          input.onTimeout();
        }, input.timeoutMs)
      : undefined;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
    }
  };

  return {
    resolve(notification) {
      clearTimer();
      input.resolve(notification);
    },
    reject(error) {
      clearTimer();
      input.reject(error);
    },
    clearTimer,
  };
}

function cloneArgs(args: Record<string, unknown>): Record<string, unknown> {
  return cloneUnknown(args) as Record<string, unknown>;
}

function cloneTaskRecord(record: AgentTaskRecord): AgentTaskRecord {
  return {
    ...record,
    args: cloneArgs(record.args),
    ...(record.result !== undefined ? { result: cloneUnknown(record.result) } : {}),
  };
}

function cloneTaskNotification(
  notification: AgentTaskNotification,
): AgentTaskNotification {
  return {
    ...notification,
    args: cloneArgs(notification.args),
    ...(notification.result !== undefined
      ? { result: cloneUnknown(notification.result) }
      : {}),
  };
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

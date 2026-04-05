import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type {
  AgentTask,
  AgentTaskExecutionContext,
  AgentTaskKind,
  AgentLoopTaskRequest,
  AgentTaskWorker,
  AgentTaskWorkerHandle,
} from "../types.js";
import type {
  AgentTaskBatchInput,
  AgentTaskNotification,
  AgentTaskRecord,
  AgentTaskRuntime,
  AgentTaskStatus,
  AgentTaskSubmitHooks,
  AgentTaskSubmitResult,
  DurableAgentTaskRuntimeOptions,
} from "./types.js";

interface ActiveTaskState {
  controller: AbortController;
  record: AgentTaskRecord;
  request: AgentLoopTaskRequest;
  settled: boolean;
  handle?: AgentTaskWorkerHandle | undefined;
}

interface NotificationWaiter {
  resolve(notification: AgentTaskNotification | undefined): void;
  reject(error: Error): void;
  clearTimer(): void;
}

interface DurableRunMailboxState {
  nextWriteSequence: number;
  nextReadSequence: number;
}

interface DurableRunPaths {
  runDir: string;
  recordsDir: string;
  notificationsDir: string;
  statePath: string;
}

export function createInProcessAgentTaskWorker(): AgentTaskWorker {
  return {
    mode: "in_process",
    start(task, args, context) {
      return {
        result: Promise.resolve().then(() => task.execute(cloneArgs(args), context)),
      };
    },
  };
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
                : formatErrorMessage(error),
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
    if (options?.timeoutMs === 0) {
      return undefined;
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
    request: AgentLoopTaskRequest,
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
      if (state) {
        state.settled = true;
        active?.delete(record.id);
        if (active && active.size === 0) {
          this.activeTasks.delete(record.runId);
        }
      }
      this.enqueueRuntimeError(
        record.runId,
        new Error(
          `Task "${record.name}" settlement bookkeeping failed: ${formatErrorMessage(hookError)}`,
        ),
      );
      return;
    }
    this.enqueueNotification(record.runId, notification);
    if (state) {
      state.settled = true;
      active?.delete(record.id);
      if (active && active.size === 0) {
        this.activeTasks.delete(record.runId);
      }
    }
  }

  private async waitForRunToDrain(runId: string, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if ((this.activeTasks.get(runId)?.size ?? 0) === 0) {
        return;
      }
      await sleep(5);
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

export class DurableAgentTaskRuntime implements AgentTaskRuntime {
  private readonly activeTasks = new Map<string, Map<string, ActiveTaskState>>();
  private readonly waiters = new Map<string, NotificationWaiter[]>();
  private readonly runtimeErrors = new Map<string, Error[]>();
  private readonly settledTaskIds = new Set<string>();
  private readonly initializedRuns = new Set<string>();
  private readonly mailboxStates = new Map<string, DurableRunMailboxState>();
  private readonly worker: AgentTaskWorker;
  private destroyed = false;

  constructor(private readonly options: DurableAgentTaskRuntimeOptions) {
    this.worker = options.worker ?? createInProcessAgentTaskWorker();
  }

  async submitBatch(input: AgentTaskBatchInput): Promise<AgentTaskSubmitResult> {
    if (this.destroyed) {
      throw new Error("Task runtime destroyed");
    }
    await this.ensureRunReady(input.runId);
    const tasksByName = new Map<string, AgentTask>();
    for (const task of input.tasks) {
      if (!tasksByName.has(task.name)) {
        tasksByName.set(task.name, task);
      }
    }

    const submitted: AgentTaskRecord[] = [];
    const startedTaskIds: string[] = [];
    let pendingRecordForRollback: AgentTaskRecord | undefined;
    try {
      for (const request of input.requests) {
        const task = tasksByName.get(request.name);
        const taskId = `task_${randomUUID()}`;
        const now = new Date().toISOString();
        const record: AgentTaskRecord = {
          id: taskId,
          runId: input.runId,
          requestId: request.id,
          name: request.name,
          kind: normalizeTaskKind(task?.kind),
          order: request.order,
          status: "running",
          createdAt: now,
          updatedAt: now,
          args: cloneArgs(request.args),
          hardFailure: task?.failureMode === "hard",
        };

        await this.persistTaskRecord(record);
        pendingRecordForRollback = record;
        submitted.push(record);
        await input.hooks?.onSubmitted?.(cloneTaskRecord(record));
        pendingRecordForRollback = undefined;

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
        const state: ActiveTaskState = {
          controller,
          record,
          request,
          settled: false,
        };
        this.getOrCreateRunState(input.runId).set(taskId, state);
        startedTaskIds.push(taskId);

        const onAbort = () => {
          void Promise.resolve(state.handle?.abort?.(abortReason(controller.signal)))
            .catch(() => undefined)
            .finally(() =>
              this.settleTask(
                state.record,
                state.request,
                "canceled",
                undefined,
                abortReason(controller.signal),
                input.hooks,
              ),
            );
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });

        try {
          const context: AgentTaskExecutionContext = {
            signal: controller.signal,
            runId: input.runId,
            requestId: request.id,
            taskId,
            order: request.order,
            ...(input.callStack ? { callStack: new Set(input.callStack) } : {}),
          };
          state.handle = await this.worker.start(task, cloneArgs(request.args), context);
          if (controller.signal.aborted) {
            void Promise.resolve(state.handle.abort?.(abortReason(controller.signal))).catch(() => undefined);
          }
        } catch (error) {
          controller.signal.removeEventListener("abort", onAbort);
          await this.settleTask(
            state.record,
            state.request,
            "failed",
            undefined,
            formatErrorMessage(error),
            input.hooks,
          );
          continue;
        }

        void Promise.resolve(state.handle.result)
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
              aborted ? abortReason(controller.signal) : formatErrorMessage(error),
              input.hooks,
            );
          })
          .finally(() => {
            controller.signal.removeEventListener("abort", onAbort);
          });
      }
    } catch (error) {
      if (pendingRecordForRollback) {
        await this.persistTaskRecord({
          ...pendingRecordForRollback,
          status: "failed",
          updatedAt: new Date().toISOString(),
          error: `Task batch submission failed: ${formatErrorMessage(error)}`,
        }).catch(() => undefined);
      }
      await this.cancelTasks(
        input.runId,
        startedTaskIds,
        `Task batch submission failed: ${formatErrorMessage(error)}`,
      ).catch(() => undefined);
      await this.waitForRunToDrain(input.runId, 200).catch(() => undefined);
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
    await this.ensureRunReady(runId);

    const runtimeError = this.shiftRuntimeError(runId);
    if (runtimeError) {
      throw runtimeError;
    }

    const persisted = await this.readNextPersistedNotification(runId);
    if (persisted) {
      return persisted;
    }
    if (options?.timeoutMs === 0) {
      return undefined;
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

  async cancelTasks(runId: string, taskIds: string[], reason?: string): Promise<void> {
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
    const runIds = Array.from(new Set([
      ...this.initializedRuns,
      ...this.activeTasks.keys(),
    ]));
    await Promise.all(runIds.map((runId) => this.cancelRun(runId, "Task runtime destroyed")));
    await Promise.all(runIds.map((runId) => this.waitForRunToDrain(runId, 250).catch(() => undefined)));
    await Promise.all(
      runIds.map(async (runId) => {
        const active = this.activeTasks.get(runId);
        if (!active || active.size === 0) {
          return;
        }
        await Promise.all(
          Array.from(active.values()).map((state) =>
            this.forceSettleCanceledTask(state, "Task runtime destroyed"),
          ),
        );
      }),
    );
    this.destroyed = true;
    for (const [runId, waiters] of this.waiters.entries()) {
      this.waiters.delete(runId);
      for (const waiter of waiters) {
        waiter.resolve(undefined);
      }
    }
    this.activeTasks.clear();
    this.runtimeErrors.clear();
    this.settledTaskIds.clear();
    await Promise.resolve(this.worker.destroy?.()).catch(() => undefined);
  }

  private async ensureRunReady(runId: string): Promise<void> {
    if (this.initializedRuns.has(runId)) {
      return;
    }
    const paths = this.pathsForRun(runId);
    await mkdir(paths.recordsDir, { recursive: true });
    await mkdir(paths.notificationsDir, { recursive: true });
    await this.recoverRun(paths, runId);
    this.initializedRuns.add(runId);
  }

  private async recoverRun(paths: DurableRunPaths, runId: string): Promise<void> {
    await mkdir(paths.notificationsDir, { recursive: true });
    const notificationEntries = await readdir(paths.notificationsDir).catch((error) => {
      if (isFileNotFound(error)) {
        return [] as string[];
      }
      throw error;
    });
    const state = deriveMailboxState(
      await readJsonFile<DurableRunMailboxState>(paths.statePath),
      notificationEntries,
    );
    this.mailboxStates.set(runId, state);

    const recordEntries = await readdir(paths.recordsDir).catch((error) => {
      if (isFileNotFound(error)) {
        return [] as string[];
      }
      throw error;
    });
    for (const entry of recordEntries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const record = await this.readTaskRecordFile(resolve(paths.recordsDir, entry));
      if (!record || record.status !== "running") {
        continue;
      }
      const failedRecord: AgentTaskRecord = {
        ...record,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: "Task runtime restarted before task completion",
      };
      await this.persistTaskRecord(failedRecord);
      await this.appendRecoveredNotification(paths, state, {
        runId,
        taskId: failedRecord.id,
        requestId: failedRecord.requestId,
        name: failedRecord.name,
        kind: failedRecord.kind,
        order: failedRecord.order,
        status: "failed",
        args: cloneArgs(failedRecord.args),
        error: "Task runtime restarted before task completion",
        hardFailure: failedRecord.hardFailure,
      });
    }
    await this.persistMailboxState(paths, state);
  }

  private async settleTask(
    record: AgentTaskRecord,
    request: AgentLoopTaskRequest,
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

    const settledRecord: AgentTaskRecord = {
      ...record,
      status,
      updatedAt: new Date().toISOString(),
      ...(result !== undefined ? { result: cloneUnknown(result) } : {}),
      ...(error ? { error } : {}),
    };
    await this.persistTaskRecord(settledRecord);

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
      const bookkeepingError = new Error(
        `Task "${record.name}" settlement bookkeeping failed: ${formatErrorMessage(hookError)}`,
      );
      await this.enqueueNotification(record.runId, notification, {
        deliverToWaiters: false,
      }).catch(() => undefined);
      if (state) {
        state.settled = true;
        active?.delete(record.id);
        if (active && active.size === 0) {
          this.activeTasks.delete(record.runId);
        }
      }
      this.enqueueRuntimeError(record.runId, bookkeepingError);
      return;
    }

    await this.enqueueNotification(record.runId, notification);
    if (state) {
      state.settled = true;
      active?.delete(record.id);
      if (active && active.size === 0) {
        this.activeTasks.delete(record.runId);
      }
    }
  }

  private async enqueueNotification(
    runId: string,
    notification: AgentTaskNotification,
    options?: {
      deliverToWaiters?: boolean;
    },
  ): Promise<void> {
    await this.ensureRunReady(runId);
    const paths = this.pathsForRun(runId);
    const state = this.requireMailboxState(runId);
    const sequence = state.nextWriteSequence;
    state.nextWriteSequence += 1;
    await writeJsonAtomic(
      resolve(paths.notificationsDir, `${String(sequence).padStart(8, "0")}.json`),
      notification,
    );

    const waiters = this.waiters.get(runId);
    if (
      options?.deliverToWaiters !== false &&
      waiters &&
      waiters.length > 0 &&
      state.nextReadSequence === sequence
    ) {
      state.nextReadSequence += 1;
      await this.persistMailboxState(paths, state);
      const waiter = waiters.shift()!;
      waiter.resolve(notification);
      return;
    }

    await this.persistMailboxState(paths, state);
  }

  private async readNextPersistedNotification(
    runId: string,
  ): Promise<AgentTaskNotification | undefined> {
    const state = this.requireMailboxState(runId);
    if (state.nextReadSequence >= state.nextWriteSequence) {
      return undefined;
    }
    const paths = this.pathsForRun(runId);
    const notificationPath = resolve(
      paths.notificationsDir,
      `${String(state.nextReadSequence).padStart(8, "0")}.json`,
    );
    const notification = await readJsonFile<AgentTaskNotification>(notificationPath);
    if (!notification) {
      throw new Error(
        `Task runtime notification missing for run ${runId} sequence ${state.nextReadSequence}`,
      );
    }
    state.nextReadSequence += 1;
    await this.persistMailboxState(paths, state);
    return cloneTaskNotification(notification);
  }

  private async waitForRunToDrain(runId: string, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if ((this.activeTasks.get(runId)?.size ?? 0) === 0) {
        return;
      }
      await sleep(10);
    }
  }

  private async forceSettleCanceledTask(
    state: ActiveTaskState,
    reason: string,
  ): Promise<void> {
    state.controller.abort(reason);
    const active = this.activeTasks.get(state.record.runId);
    active?.delete(state.record.id);
    if (active && active.size === 0) {
      this.activeTasks.delete(state.record.runId);
    }
    state.settled = true;
    this.settledTaskIds.add(state.record.id);
    const settledRecord: AgentTaskRecord = {
      ...state.record,
      status: "canceled",
      updatedAt: new Date().toISOString(),
      error: reason,
    };
    await this.persistTaskRecord(settledRecord).catch(() => undefined);
    await this.enqueueNotification(state.record.runId, {
      runId: state.record.runId,
      taskId: state.record.id,
      requestId: state.request.id,
      name: state.record.name,
      kind: state.record.kind,
      order: state.record.order,
      status: "canceled",
      args: cloneArgs(state.request.args),
      error: reason,
      hardFailure: state.record.hardFailure,
    }).catch(() => undefined);
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

  private requireMailboxState(runId: string): DurableRunMailboxState {
    const state = this.mailboxStates.get(runId);
    if (!state) {
      throw new Error(`Task runtime mailbox state missing for run ${runId}`);
    }
    return state;
  }

  private getOrCreateRunState(runId: string): Map<string, ActiveTaskState> {
    let active = this.activeTasks.get(runId);
    if (!active) {
      active = new Map<string, ActiveTaskState>();
      this.activeTasks.set(runId, active);
    }
    return active;
  }

  private async persistTaskRecord(record: AgentTaskRecord): Promise<void> {
    const paths = this.pathsForRun(record.runId);
    await mkdir(paths.recordsDir, { recursive: true });
    await writeJsonAtomic(
      resolve(paths.recordsDir, `${encodeTaskRuntimeSegment(record.id)}.json`),
      record,
    );
  }

  private async readTaskRecordFile(path: string): Promise<AgentTaskRecord | undefined> {
    return readJsonFile<AgentTaskRecord>(path);
  }

  private async persistMailboxState(
    paths: DurableRunPaths,
    state: DurableRunMailboxState,
  ): Promise<void> {
    await writeJsonAtomic(paths.statePath, state);
  }

  private async appendRecoveredNotification(
    paths: DurableRunPaths,
    state: DurableRunMailboxState,
    notification: AgentTaskNotification,
  ): Promise<void> {
    const sequence = state.nextWriteSequence;
    state.nextWriteSequence += 1;
    await writeJsonAtomic(
      resolve(paths.notificationsDir, `${String(sequence).padStart(8, "0")}.json`),
      notification,
    );
  }

  private pathsForRun(runId: string): DurableRunPaths {
    const safeRunId = encodeTaskRuntimeSegment(runId);
    const runDir = resolve(this.options.rootDir, safeRunId);
    return {
      runDir,
      recordsDir: resolve(runDir, "records"),
      notificationsDir: resolve(runDir, "notifications"),
      statePath: resolve(runDir, "mailbox-state.json"),
    };
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

function encodeTaskRuntimeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Task runtime path segment must be a non-empty string");
  }
  const normalized = trimmed
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/^\.+/, "_")
    .replace(/^_+/, "_")
    .replace(/_+/g, "_");
  if (normalized.length <= 96) {
    return normalized;
  }
  const hash = createHash("sha1").update(trimmed).digest("hex").slice(0, 12);
  return `${normalized.slice(0, 64)}-${hash}`;
}

function deriveMailboxState(
  persisted: DurableRunMailboxState | undefined,
  notificationEntries: string[],
): DurableRunMailboxState {
  const maxSequence = notificationEntries.reduce((current, entry) => {
    const match = /^(\d+)\.json$/.exec(entry);
    if (!match) {
      return current;
    }
    const sequence = Number(match[1]);
    return Number.isFinite(sequence) ? Math.max(current, sequence) : current;
  }, 0);

  const fallback: DurableRunMailboxState = {
    nextWriteSequence: maxSequence + 1,
    nextReadSequence: 1,
  };
  if (!persisted) {
    return fallback;
  }

  const nextWriteSequence =
    Number.isInteger(persisted.nextWriteSequence) && persisted.nextWriteSequence > 0
      ? Math.max(persisted.nextWriteSequence, maxSequence + 1)
      : fallback.nextWriteSequence;
  const nextReadSequence =
    Number.isInteger(persisted.nextReadSequence) && persisted.nextReadSequence > 0
      ? Math.min(persisted.nextReadSequence, nextWriteSequence)
      : fallback.nextReadSequence;

  return {
    nextWriteSequence,
    nextReadSequence,
  };
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmpPath = `${path}.${randomUUID()}.tmp`;
  await mkdir(resolve(path, ".."), { recursive: true }).catch(() => undefined);
  await writeFile(tmpPath, JSON.stringify(value, null, 2));
  await rename(tmpPath, path);
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}

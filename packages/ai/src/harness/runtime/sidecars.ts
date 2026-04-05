import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type {
  AgentLoopCheckpointStage,
  AgentLoopPhase,
  AgentLoopSidecarRequest,
  AgentLoopSidecarResult,
  AgentLoopTransitionReason,
  AgentTool,
  AgentTask,
  LLMProvider,
  MemoryScope,
} from "../../types.js";
import type { AgentTaskRuntime, AgentTaskNotification } from "../../task/types.js";
import { runAgentLoop } from "../../agent-loop.js";
import type {
  HarnessAction,
  HarnessConfig,
  HarnessEvent,
  HarnessGraphScope,
  HarnessLongTermMemoryExtractionInput,
  HarnessMemoryInput,
  HarnessMemoryRecord,
  HarnessRunEventType,
  HarnessRunRecord,
  HarnessSidecarSchedule,
  HarnessSessionMemoryRecord,
  HarnessSidecarMode,
  HarnessSidecarPolicyConfig,
  HarnessSummaryRecord,
} from "../types.js";
import type {
  HarnessCheckpointUpdate,
  HarnessContextKernel,
  HarnessRunContextState,
} from "../context/kernel.js";
import type { HarnessVerifier } from "../verify/index.js";
import { createRuntimeProjectMemoryScope } from "../graph/utils.js";

type HarnessSidecarTrigger =
  | "tool_result"
  | "task_result"
  | "checkpoint_context"
  | "run_boundary";

type HarnessSidecarTriggerPayloadMap = {
  tool_result: {
    tool: string;
    args: unknown;
    result: unknown;
  };
  task_result: {
    task: string;
    args: unknown;
    result: unknown;
  };
  checkpoint_context: {
    contextUpdate: HarnessCheckpointUpdate;
  };
  run_boundary: {
    status: HarnessRunRecord["status"];
  };
};

interface HarnessSidecarRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

interface NormalizedHarnessSidecarPolicy {
  executionMode: Exclude<HarnessSidecarMode, "trailing"> | "inline";
  schedule: HarnessSidecarSchedule;
  priority: number;
  bestEffort: boolean;
  dedupeKey?: string;
  retry: HarnessSidecarRetryPolicy;
}

type HarnessSidecarLifecycleContext = {
  stage: AgentLoopCheckpointStage;
  phaseBeforeSidecars: AgentLoopPhase;
  transitionReason: AgentLoopTransitionReason;
};

type AnyHarnessSidecarPayload =
  HarnessSidecarTriggerPayloadMap[HarnessSidecarTrigger];

interface HarnessScheduledSidecar {
  runId: string;
  id: string;
  name: string;
  trigger: HarnessSidecarTrigger;
  payload: AnyHarnessSidecarPayload;
  policy: NormalizedHarnessSidecarPolicy;
  createdAt: number;
  attempt: number;
  availableAt: number;
  lifecycle?: AgentLoopSidecarRequest | HarnessSidecarLifecycleContext;
  backgroundTask?: AgentTask | undefined;
  onBackgroundCompleted?(runId: string, result: unknown): Promise<void>;
  execute(
    runId: string,
    lifecycle: AgentLoopSidecarRequest | HarnessSidecarLifecycleContext,
    attempt: number,
  ): Promise<void>;
}

type SidecarRegistrationFactory<TTrigger extends HarnessSidecarTrigger> = (
  input: {
    runId: string;
    payload: HarnessSidecarTriggerPayloadMap[TTrigger];
  },
) => HarnessScheduledSidecar | HarnessScheduledSidecar[] | undefined;

interface HarnessSidecarSchedulerDeps {
  emit(event: HarnessEvent): void;
  patchRun(
    runId: string,
    patch: Partial<Omit<HarnessRunRecord, "id" | "createdAt">>,
  ): Promise<HarnessRunRecord>;
  transitionRun(
    type: HarnessRunEventType,
    patch: Partial<Omit<HarnessRunRecord, "id" | "createdAt">>,
    data: Record<string, unknown>,
  ): Promise<void>;
  persistGlobalMemoryLifecycleEvent(
    runId: string,
    memory: HarnessMemoryRecord,
  ): Promise<void>;
  persistGlobalCapturedContext(
    runId: string,
    context: HarnessRunContextState,
  ): Promise<void>;
  persistCheckpointContext(
    runId: string,
    contextUpdate: HarnessCheckpointUpdate,
  ): Promise<void>;
  contextKernel: HarnessContextKernel;
  verifier: HarnessVerifier | null;
  taskRuntime: AgentTaskRuntime;
  llm: LLMProvider;
  runtimeRootDir: string;
  getRun(runId: string): Promise<HarnessRunRecord>;
  contextEnabled: boolean;
  sidecars?: HarnessConfig["sidecars"];
}

export class HarnessSidecarScheduler {
  private readonly pendingTurnSidecars = new Map<string, HarnessScheduledSidecar[]>();
  private readonly pendingBoundarySidecars = new Map<string, HarnessScheduledSidecar[]>();
  private readonly activeBackgroundSidecars = new Map<
    string,
    { runId: string; invocation: HarnessScheduledSidecar }
  >();
  private readonly triggerRegistrations: {
    [K in HarnessSidecarTrigger]: Array<SidecarRegistrationFactory<K>>;
  };

  constructor(private readonly deps: HarnessSidecarSchedulerDeps) {
    this.triggerRegistrations = {
      tool_result: [
        (input) => this.createToolObservationSidecar(input.runId, input.payload),
        (input) => this.createVerificationSidecar(input.runId, input.payload),
      ],
      task_result: [
        (input) => this.createTaskObservationSidecar(input.runId, input.payload),
      ],
      checkpoint_context: [
        (input) => this.createSessionMemoryRefreshSidecar(input.runId, input.payload),
        (input) => this.createCheckpointSummarySidecar(input.runId, input.payload),
        (input) => this.createLongTermMemoryExtractionSidecar(input.runId, input.payload),
      ],
      run_boundary: [
        (input) => this.createRunBoundaryCaptureSidecar(input.runId, input.payload),
      ],
    };
  }

  hasPendingTurnSidecars(runId?: string): boolean {
    if (runId) {
      return (
        this.getQueue(this.pendingTurnSidecars, runId).length > 0 ||
        this.getQueue(this.pendingBoundarySidecars, runId).length > 0 ||
        this.countActiveBackgroundSidecars(runId) > 0
      );
    }
    return (
      totalQueuedSidecars(this.pendingTurnSidecars) > 0 ||
      totalQueuedSidecars(this.pendingBoundarySidecars) > 0 ||
      this.activeBackgroundSidecars.size > 0
    );
  }

  enqueueToolResult(input: {
    runId: string;
    tool: string;
    args: unknown;
    result: unknown;
  }): void {
    const invocations = this.createTriggerInvocations(input.runId, "tool_result", {
      tool: input.tool,
      args: input.args,
      result: input.result,
    });
    this.enqueueScheduledSidecars(input.runId, this.pendingTurnSidecars, invocations);
  }

  enqueueTaskResult(input: {
    runId: string;
    task: string;
    args: unknown;
    result: unknown;
  }): void {
    const invocations = this.createTriggerInvocations(input.runId, "task_result", {
      task: input.task,
      args: input.args,
      result: input.result,
    });
    this.enqueueScheduledSidecars(input.runId, this.pendingTurnSidecars, invocations);
  }

  async flushTurnSidecars(runId: string, request: AgentLoopSidecarRequest): Promise<AgentLoopSidecarResult> {
    await this.dispatchQueue(this.pendingTurnSidecars, runId, {
      defaultLifecycle: request,
      allowBoundaryExecution: false,
    });
    await this.drainBackgroundSidecars(runId);
    return {};
  }

  async captureRunBoundary(runId: string, status: HarnessRunRecord["status"]): Promise<void> {
    const lifecycle = boundaryLifecycleContext(status);
    await this.dispatchImmediateInvocations(
      runId,
      this.createTriggerInvocations(runId, "run_boundary", { status }),
      lifecycle,
      { allowBoundaryExecution: false },
    );
    await this.dispatchQueue(this.pendingTurnSidecars, runId, {
      defaultLifecycle: lifecycle,
      allowBoundaryExecution: true,
    });
    await this.dispatchQueue(this.pendingBoundarySidecars, runId, {
      defaultLifecycle: lifecycle,
      allowBoundaryExecution: true,
    });
    await this.waitForBackgroundQuiescence(runId, lifecycle);
  }

  async persistCheckpointContext(runId: string, contextUpdate: HarnessCheckpointUpdate): Promise<void> {
    const lifecycle = checkpointLifecycleContext(contextUpdate);
    await this.dispatchImmediateInvocations(
      runId,
      this.createTriggerInvocations(runId, "checkpoint_context", { contextUpdate }),
      lifecycle,
      { allowBoundaryExecution: false },
    );
    await this.drainBackgroundSidecars(runId);
  }

  private createTriggerInvocations<TTrigger extends HarnessSidecarTrigger>(
    runId: string,
    trigger: TTrigger,
    payload: HarnessSidecarTriggerPayloadMap[TTrigger],
  ): HarnessScheduledSidecar[] {
    const registrations = this.triggerRegistrations[trigger] as Array<SidecarRegistrationFactory<TTrigger>>;
    const invocations: HarnessScheduledSidecar[] = [];
    for (const registration of registrations) {
      const scheduled = registration({ runId, payload });
      if (!scheduled) {
        continue;
      }
      if (Array.isArray(scheduled)) {
        invocations.push(...scheduled);
        continue;
      }
      invocations.push(scheduled);
    }
    return invocations;
  }

  private enqueueScheduledSidecars(
    runId: string,
    queues: Map<string, HarnessScheduledSidecar[]>,
    invocations: HarnessScheduledSidecar[],
  ): void {
    for (const invocation of invocations) {
      this.enqueueScheduledSidecar(runId, queues, invocation);
    }
  }

  private enqueueScheduledSidecar(
    runId: string,
    queues: Map<string, HarnessScheduledSidecar[]>,
    invocation: HarnessScheduledSidecar,
  ): void {
    const queue = this.getQueue(queues, runId);
    if (invocation.policy.dedupeKey) {
      if (replaceSidecarByDedupeKey(this.getQueue(this.pendingTurnSidecars, runId), invocation)) {
        return;
      }
      if (
        replaceSidecarByDedupeKey(
          this.getQueue(this.pendingBoundarySidecars, runId),
          invocation,
        )
      ) {
        return;
      }
      if (
        hasActiveBackgroundDedupe(
          this.activeBackgroundSidecars,
          runId,
          invocation.policy.dedupeKey,
        )
      ) {
        return;
      }
    }
    queue.push(invocation);
  }

  private async dispatchImmediateInvocations(
    runId: string,
    invocations: HarnessScheduledSidecar[],
    lifecycle: AgentLoopSidecarRequest | HarnessSidecarLifecycleContext,
    options: {
      allowBoundaryExecution: boolean;
    },
  ): Promise<void> {
    const ordered = orderSidecars(
      invocations.map((invocation) => ({
        ...invocation,
        lifecycle,
      })),
    );
    for (const invocation of ordered) {
      await this.dispatchInvocation(runId, invocation, {
        defaultLifecycle: lifecycle,
        allowBoundaryExecution: options.allowBoundaryExecution,
      });
    }
  }

  private async dispatchQueue(
    queues: Map<string, HarnessScheduledSidecar[]>,
    runId: string,
    options: {
      defaultLifecycle?: AgentLoopSidecarRequest | HarnessSidecarLifecycleContext;
      allowBoundaryExecution: boolean;
    },
  ): Promise<void> {
    const queue = this.getQueue(queues, runId);
    if (queue.length === 0) {
      return;
    }

    const next = queue.splice(0);
    const now = Date.now();
    const ready = orderSidecars(next.filter((invocation) => invocation.availableAt <= now));
    const future = next.filter((invocation) => invocation.availableAt > now);

    for (const invocation of ready) {
      await this.dispatchInvocation(runId, invocation, options);
    }

    queue.push(...future);
  }

  private async dispatchInvocation(
    runId: string,
    invocation: HarnessScheduledSidecar,
    options: {
      defaultLifecycle?: AgentLoopSidecarRequest | HarnessSidecarLifecycleContext;
      allowBoundaryExecution: boolean;
    },
  ): Promise<void> {
    const lifecycle = invocation.lifecycle ?? options.defaultLifecycle;
    if (!lifecycle) {
      throw new Error(`Harness sidecar ${invocation.name} requires a lifecycle context`);
    }

    const scheduled = invocation.lifecycle
      ? invocation
      : { ...invocation, lifecycle };

    if (scheduled.policy.schedule === "boundary" && !options.allowBoundaryExecution) {
      this.enqueueScheduledSidecar(runId, this.pendingBoundarySidecars, scheduled);
      return;
    }

    if (scheduled.policy.executionMode === "background") {
      await this.submitBackgroundSidecar(runId, scheduled);
      return;
    }

    await this.executeInlineSidecar(runId, scheduled);
  }

  private async executeInlineSidecar(
    runId: string,
    invocation: HarnessScheduledSidecar,
  ): Promise<void> {
    const lifecycle = invocation.lifecycle;
    if (!lifecycle) {
      throw new Error(`Harness sidecar ${invocation.name} requires a lifecycle context`);
    }

    let current = invocation;
    while (true) {
      await this.emitSidecarLifecycle("sidecar_started", runId, current, lifecycle);
      try {
        await current.execute(runId, lifecycle, current.attempt);
        await this.emitSidecarLifecycle("sidecar_completed", runId, current, lifecycle);
        return;
      } catch (error) {
        const nextRetry = buildRetryAttempt(current);
        if (nextRetry) {
          current = nextRetry;
          await sleep(backoffDelayFor(current));
          continue;
        }

        await this.emitSidecarFailure(runId, current, lifecycle, error);
        if (current.policy.bestEffort) {
          return;
        }
        throw error;
      }
    }
  }

  private async submitBackgroundSidecar(
    runId: string,
    invocation: HarnessScheduledSidecar,
  ): Promise<void> {
    const lifecycle = invocation.lifecycle;
    if (!lifecycle) {
      throw new Error(`Harness sidecar ${invocation.name} requires a lifecycle context`);
    }

    const taskName = `__harness_sidecar__${invocation.name}__${invocation.id}`;
    const task: AgentTask =
      invocation.backgroundTask ??
      {
        name: taskName,
        description: `Harness sidecar task for ${invocation.name}`,
        kind: "workflow",
        isConcurrencySafe: true,
        failureMode: "soft",
        execute: async () => {
          await invocation.execute(runId, lifecycle, invocation.attempt);
          return {
            sidecar: invocation.name,
            attempt: invocation.attempt,
          };
        },
      };

    try {
      const submitted = await this.deps.taskRuntime.submitBatch({
        runId: backgroundTaskRunId(runId),
        requests: [
          {
            id: invocation.id,
            name: task.name,
            args: {},
            order: invocation.policy.priority,
          },
        ],
        tasks: [task],
      });
      const taskId = submitted.records[0]?.id;
      if (!taskId) {
        throw new Error(`Harness sidecar ${invocation.name} did not receive a task id`);
      }
      this.activeBackgroundSidecars.set(taskId, { runId, invocation });
      await this.emitSidecarLifecycle("sidecar_started", runId, invocation, lifecycle, {
        taskId,
        mode: "background",
      });
    } catch (error) {
      const nextRetry = buildRetryAttempt(invocation);
      if (nextRetry) {
        this.enqueueScheduledSidecar(runId, this.pendingTurnSidecars, nextRetry);
        return;
      }
      await this.emitSidecarFailure(runId, invocation, lifecycle, error);
      if (invocation.policy.bestEffort) {
        return;
      }
      throw error;
    }
  }

  private async drainBackgroundSidecars(runId: string): Promise<void> {
    while (true) {
      const notification = await this.deps.taskRuntime.nextNotification(
        backgroundTaskRunId(runId),
        { timeoutMs: 1 },
      );
      if (!notification) {
        return;
      }
      await this.handleBackgroundNotification(runId, notification);
    }
  }

  private async waitForBackgroundQuiescence(
    runId: string,
    fallbackLifecycle: AgentLoopSidecarRequest | HarnessSidecarLifecycleContext,
  ): Promise<void> {
    while (true) {
      await this.dispatchQueue(this.pendingTurnSidecars, runId, {
        defaultLifecycle: fallbackLifecycle,
        allowBoundaryExecution: true,
      });
      await this.dispatchQueue(this.pendingBoundarySidecars, runId, {
        defaultLifecycle: fallbackLifecycle,
        allowBoundaryExecution: true,
      });

      if (this.countActiveBackgroundSidecars(runId) === 0) {
        const nextDueAt = nextDueTimestamp(
          this.getQueue(this.pendingTurnSidecars, runId),
          this.getQueue(this.pendingBoundarySidecars, runId),
        );
        if (nextDueAt == null) {
          return;
        }
        const delay = Math.max(0, nextDueAt - Date.now());
        if (delay > 0) {
          await sleep(delay);
        }
        continue;
      }

      const nextDueAt = nextDueTimestamp(
        this.getQueue(this.pendingTurnSidecars, runId),
        this.getQueue(this.pendingBoundarySidecars, runId),
      );
      const timeoutMs =
        nextDueAt == null
          ? 25
          : Math.max(1, nextDueAt - Date.now());
      const notification = await this.deps.taskRuntime.nextNotification(
        backgroundTaskRunId(runId),
        { timeoutMs },
      );
      if (!notification) {
        continue;
      }
      await this.handleBackgroundNotification(runId, notification);
    }
  }

  private async handleBackgroundNotification(
    runId: string,
    notification: AgentTaskNotification,
  ): Promise<void> {
    const active = this.activeBackgroundSidecars.get(notification.taskId);
    if (!active || active.runId !== runId) {
      return;
    }
    this.activeBackgroundSidecars.delete(notification.taskId);

    const invocation = active.invocation;
    const lifecycle = invocation.lifecycle;
    if (!lifecycle) {
      throw new Error(`Harness sidecar ${invocation.name} lost its lifecycle context`);
    }

    if (notification.status === "completed") {
      try {
        await invocation.onBackgroundCompleted?.(runId, notification.result);
        await this.emitSidecarLifecycle("sidecar_completed", runId, invocation, lifecycle, {
          taskId: notification.taskId,
          mode: "background",
        });
      } catch (error) {
        const nextRetry = buildRetryAttempt(invocation);
        if (nextRetry) {
          this.enqueueScheduledSidecar(runId, this.pendingTurnSidecars, nextRetry);
          return;
        }

        await this.emitSidecarFailure(runId, invocation, lifecycle, error, {
          taskId: notification.taskId,
          mode: "background",
        });
        if (invocation.policy.bestEffort) {
          return;
        }
        throw error;
      }
      return;
    }

    const error = new Error(
      notification.error ??
        `Background sidecar ${invocation.name} ${notification.status}`,
    );
    const nextRetry = buildRetryAttempt(invocation);
    if (nextRetry) {
      this.enqueueScheduledSidecar(runId, this.pendingTurnSidecars, nextRetry);
      return;
    }

    await this.emitSidecarFailure(runId, invocation, lifecycle, error, {
      taskId: notification.taskId,
      mode: "background",
    });
    if (invocation.policy.bestEffort) {
      return;
    }
    throw error;
  }

  private async emitSidecarLifecycle(
    type: "sidecar_started" | "sidecar_completed",
    runId: string,
    invocation: HarnessScheduledSidecar,
    lifecycle: AgentLoopSidecarRequest | HarnessSidecarLifecycleContext,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    const data = buildSidecarEventData(runId, invocation, lifecycle, detail);
    this.deps.emit({
      type,
      timestamp: Date.now(),
      data,
    });
    await this.deps.transitionRun(type, {}, data);
  }

  private async emitSidecarFailure(
    runId: string,
    invocation: HarnessScheduledSidecar,
    lifecycle: AgentLoopSidecarRequest | HarnessSidecarLifecycleContext,
    error: unknown,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const data = {
      ...buildSidecarEventData(runId, invocation, lifecycle, detail),
      error: message,
    };
    this.deps.emit({
      type: "sidecar_failed",
      timestamp: Date.now(),
      data,
    });
    await this.deps.transitionRun("sidecar_failed", {}, data);
  }

  private getQueue(
    queues: Map<string, HarnessScheduledSidecar[]>,
    runId: string,
  ): HarnessScheduledSidecar[] {
    let queue = queues.get(runId);
    if (!queue) {
      queue = [];
      queues.set(runId, queue);
    }
    return queue;
  }

  private countActiveBackgroundSidecars(runId: string): number {
    let count = 0;
    for (const active of this.activeBackgroundSidecars.values()) {
      if (active.runId === runId) {
        count += 1;
      }
    }
    return count;
  }

  private createToolObservationSidecar(
    runId: string,
    payload: HarnessSidecarTriggerPayloadMap["tool_result"],
  ): HarnessScheduledSidecar | undefined {
    if (!this.deps.contextEnabled || this.deps.sidecars?.observations?.enabled === false) {
      return undefined;
    }
    return this.createScheduledSidecar(
      runId,
      "tool_result",
      payload,
      `tool_observation:${payload.tool}`,
      {
        mode: "inline",
        priority: 200,
        bestEffort: false,
        retry: { maxAttempts: 1 },
        ...this.deps.sidecars?.observations,
      },
      async () => {
        const storedObservation = await this.deps.contextKernel.recordObservation({
          runId,
          kind: "tool",
          tool: payload.tool,
          args: payload.args,
          result: payload.result,
        });
        if (storedObservation) {
          await this.deps.persistGlobalMemoryLifecycleEvent(runId, storedObservation);
        }
      },
    );
  }

  private createTaskObservationSidecar(
    runId: string,
    payload: HarnessSidecarTriggerPayloadMap["task_result"],
  ): HarnessScheduledSidecar | undefined {
    if (!this.deps.contextEnabled || this.deps.sidecars?.observations?.enabled === false) {
      return undefined;
    }
    return this.createScheduledSidecar(
      runId,
      "task_result",
      payload,
      `task_observation:${payload.task}`,
      {
        mode: "inline",
        priority: 200,
        bestEffort: false,
        retry: { maxAttempts: 1 },
        ...this.deps.sidecars?.observations,
      },
      async () => {
        const storedObservation = await this.deps.contextKernel.recordObservation({
          runId,
          kind: "task",
          task: payload.task,
          args: payload.args,
          result: payload.result,
        });
        if (storedObservation) {
          await this.deps.persistGlobalMemoryLifecycleEvent(runId, storedObservation);
        }
      },
    );
  }

  private createVerificationSidecar(
    runId: string,
    payload: HarnessSidecarTriggerPayloadMap["tool_result"],
  ): HarnessScheduledSidecar | undefined {
    if (!this.deps.verifier || this.deps.sidecars?.verification?.enabled === false) {
      return undefined;
    }
    return this.createScheduledSidecar(
      runId,
      "tool_result",
      payload,
      `tool_verification:${payload.tool}`,
      {
        mode: "background",
        priority: 150,
        bestEffort: false,
        retry: {
          maxAttempts: 2,
          backoffMs: 25,
          backoffMultiplier: 2,
          maxBackoffMs: 250,
        },
        ...this.deps.sidecars?.verification,
      },
      async () => {
        const action: HarnessAction = {
          tool: payload.tool,
          args: payload.args,
          timestamp: Date.now(),
        };
        const verification = await this.deps.verifier!.verify(action, payload.result);
        const data = {
          tool: payload.tool,
          reason: verification.reason,
          ...(verification.retry != null ? { retry: verification.retry === true } : {}),
        };
        this.deps.emit({
          type: verification.passed ? "verify_pass" : "verify_fail",
          timestamp: Date.now(),
          data: {
            runId,
            ...data,
          },
        });
        await this.deps.transitionRun(
          verification.passed ? "verify_pass" : "verify_fail",
          {},
          data,
        );
      },
    );
  }

  private createSessionMemoryRefreshSidecar(
    runId: string,
    payload: HarnessSidecarTriggerPayloadMap["checkpoint_context"],
  ): HarnessScheduledSidecar | undefined {
    if (!this.deps.contextEnabled || this.deps.sidecars?.sessionMemory?.enabled === false) {
      return undefined;
    }
    return this.createScheduledSidecar(
      runId,
      "checkpoint_context",
      payload,
      "session_memory_refresh",
      {
        mode: "inline",
        priority: 300,
        bestEffort: false,
        retry: { maxAttempts: 1 },
        ...this.deps.sidecars?.sessionMemory,
      },
      async () => {
        const { contextUpdate } = payload;
        if (contextUpdate.compaction) {
          this.deps.emit({
            type: "context_compacted",
            timestamp: Date.now(),
            data: {
              runId,
              kind: contextUpdate.compaction.kind,
              previousTokens: contextUpdate.compaction.previousTokens,
              nextTokens: contextUpdate.compaction.nextTokens,
              compactedMessages: contextUpdate.compaction.compactedMessages,
            },
          });
          await this.deps.transitionRun(
            "context_compacted",
            {
              contextUpdatedAt: contextUpdate.sessionMemory.updatedAt,
            },
            {
              kind: contextUpdate.compaction.kind,
              previousTokens: contextUpdate.compaction.previousTokens,
              nextTokens: contextUpdate.compaction.nextTokens,
              compactedMessages: contextUpdate.compaction.compactedMessages,
            },
          );
          return;
        }
        await this.deps.patchRun(
          runId,
          {
            contextUpdatedAt: contextUpdate.sessionMemory.updatedAt,
          },
        );
      },
    );
  }

  private createCheckpointSummarySidecar(
    runId: string,
    payload: HarnessSidecarTriggerPayloadMap["checkpoint_context"],
  ): HarnessScheduledSidecar | undefined {
    if (!this.deps.contextEnabled) {
      return undefined;
    }
    if (
      !payload.contextUpdate.summary &&
      payload.contextUpdate.promotedMemories.length === 0
    ) {
      return undefined;
    }
    return this.createScheduledSidecar(
      runId,
      "checkpoint_context",
      payload,
      "checkpoint_summary_capture",
      {
        mode: "inline",
        priority: 250,
        bestEffort: false,
        retry: { maxAttempts: 1 },
        ...this.deps.sidecars?.sessionMemory,
      },
      async () => {
        const { contextUpdate } = payload;
        if (contextUpdate.summary) {
          this.deps.emit({
            type: "summary_created",
            timestamp: Date.now(),
            data: {
              runId,
              summaryId: contextUpdate.summary.id,
              kind: contextUpdate.summary.kind,
              status: contextUpdate.summary.status,
            },
          });
          await this.deps.transitionRun(
            "summary_created",
            {
              latestSummaryId: contextUpdate.summary.id,
            },
            {
              summaryId: contextUpdate.summary.id,
              kind: contextUpdate.summary.kind,
              status: contextUpdate.summary.status,
            },
          );
        }
        for (const promotedMemory of contextUpdate.promotedMemories) {
          await this.deps.persistGlobalMemoryLifecycleEvent(runId, promotedMemory);
        }
      },
    );
  }

  private createLongTermMemoryExtractionSidecar(
    runId: string,
    payload: HarnessSidecarTriggerPayloadMap["checkpoint_context"],
  ): HarnessScheduledSidecar | undefined {
    const longTermConfig = this.deps.sidecars?.longTermMemory;
    if (!this.deps.contextEnabled || longTermConfig?.enabled === false) {
      return undefined;
    }
    const usesAgenticExtraction =
      longTermConfig?.agentic === true && !longTermConfig.extract;
    const policy: HarnessSidecarPolicyConfig & {
      mode?: HarnessSidecarMode;
      priority?: number;
      bestEffort?: boolean;
      retry?: {
        maxAttempts?: number;
        backoffMs?: number;
        backoffMultiplier?: number;
        maxBackoffMs?: number;
      };
      dedupeKey?: string;
    } = {
      mode: usesAgenticExtraction ? "background" : "inline",
      schedule: "boundary" as const,
      priority: 100,
      bestEffort: true,
      dedupeKey: `long_term_memory:${runId}`,
      retry: {
        maxAttempts: 2,
        backoffMs: 25,
        backoffMultiplier: 2,
        maxBackoffMs: 250,
      },
      ...longTermConfig,
    };
    return this.createScheduledSidecar(
      runId,
      "checkpoint_context",
      payload,
      "long_term_memory_extract",
      policy,
      async () => {
        const run = await this.deps.getRun(runId);
        const extractionInput = buildLongTermMemoryExtractionInput(
          runId,
          this.deps.runtimeRootDir,
          run.graphScopes ?? [],
          payload.contextUpdate.sessionMemory,
          payload.contextUpdate.summary,
        );
        const extracted = await longTermConfig?.extract?.(extractionInput);
        const normalized = normalizeExtractedMemories(
          extracted ??
            defaultLongTermMemoryExtraction(
              extractionInput,
              longTermConfig?.scopes,
            ),
          payload.contextUpdate.summary,
        );
        for (const input of normalized) {
          const stored = await this.deps.contextKernel.rememberMemory(input);
          await this.deps.persistGlobalMemoryLifecycleEvent(runId, stored);
        }
      },
      usesAgenticExtraction
        ? {
            backgroundTask: createLongTermMemoryExtractionSubagentTask(
              longTermConfig?.llm ?? this.deps.llm,
              buildLongTermMemoryExtractionInput(
                runId,
                this.deps.runtimeRootDir,
                [],
                payload.contextUpdate.sessionMemory,
                payload.contextUpdate.summary,
              ),
              async () => (await this.deps.getRun(runId)).graphScopes ?? [],
              longTermConfig?.scopes,
            ),
            onBackgroundCompleted: async (_scheduledRunId, result) => {
              const graphScopes = (await this.deps.getRun(runId)).graphScopes ?? [];
              for (const input of normalizeExtractedMemories(
                (result as { memories?: HarnessMemoryInput[] } | undefined)?.memories ?? [],
                payload.contextUpdate.summary,
              ).map((memory) => withDefaultGraphScopes(memory, graphScopes))) {
                const stored = await this.deps.contextKernel.rememberMemory(input);
                await this.deps.persistGlobalMemoryLifecycleEvent(runId, stored);
              }
            },
          }
        : undefined,
    );
  }

  private createRunBoundaryCaptureSidecar(
    runId: string,
    payload: HarnessSidecarTriggerPayloadMap["run_boundary"],
  ): HarnessScheduledSidecar | undefined {
    if (!this.deps.contextEnabled) {
      return undefined;
    }
    return this.createScheduledSidecar(
      runId,
      "run_boundary",
      payload,
      "run_boundary_capture",
      {
        mode: "inline",
        priority: 400,
        bestEffort: false,
        retry: { maxAttempts: 1 },
      },
      async () => {
        const context = await this.deps.contextKernel.captureRunState(runId);
        await this.deps.persistGlobalCapturedContext(runId, context);
      },
    );
  }

  private createScheduledSidecar<TTrigger extends HarnessSidecarTrigger>(
    runId: string,
    trigger: TTrigger,
    payload: HarnessSidecarTriggerPayloadMap[TTrigger],
    name: string,
    policy: HarnessSidecarPolicyConfig & {
      mode?: HarnessSidecarMode;
      priority?: number;
      bestEffort?: boolean;
      retry?: {
        maxAttempts?: number;
        backoffMs?: number;
        backoffMultiplier?: number;
        maxBackoffMs?: number;
      };
      dedupeKey?: string;
    },
    execute: (
      runId: string,
      payload: HarnessSidecarTriggerPayloadMap[TTrigger],
      attempt: number,
    ) => Promise<void>,
    options?: {
      backgroundTask?: AgentTask;
      onBackgroundCompleted?(runId: string, result: unknown): Promise<void>;
    },
  ): HarnessScheduledSidecar {
    const normalized = normalizeSidecarPolicy(policy);
    return {
      runId,
      id: `sidecar_${randomUUID()}`,
      name,
      trigger,
      payload,
      policy: normalized,
      createdAt: Date.now(),
      attempt: 1,
      availableAt: Date.now(),
      ...(options?.backgroundTask ? { backgroundTask: options.backgroundTask } : {}),
      ...(options?.onBackgroundCompleted
        ? { onBackgroundCompleted: options.onBackgroundCompleted }
        : {}),
      execute: (scheduledRunId, _lifecycle, attempt) =>
        execute(scheduledRunId, payload, attempt),
    };
  }
}

function checkpointLifecycleContext(
  contextUpdate: HarnessCheckpointUpdate,
): HarnessSidecarLifecycleContext {
  return {
    stage: contextUpdate.checkpoint.stage,
    phaseBeforeSidecars:
      contextUpdate.checkpoint.orchestration?.phase ?? "preparing_context",
    transitionReason:
      contextUpdate.checkpoint.orchestration?.transitionReason ?? "next_turn",
  };
}

function boundaryLifecycleContext(
  status: HarnessRunRecord["status"],
): HarnessSidecarLifecycleContext {
  switch (status) {
    case "approval_required":
      return {
        stage: "approval_required",
        phaseBeforeSidecars: "approval_blocked",
        transitionReason: "approval_required",
      };
    case "paused":
      return {
        stage: "paused",
        phaseBeforeSidecars: "paused",
        transitionReason: "pause_requested",
      };
    case "canceled":
      return {
        stage: "canceled",
        phaseBeforeSidecars: "canceled",
        transitionReason: "cancel_requested",
      };
    case "max_iterations":
      return {
        stage: "max_iterations",
        phaseBeforeSidecars: "max_iterations",
        transitionReason: "iteration_limit",
      };
    case "failed":
      return {
        stage: "canceled",
        phaseBeforeSidecars: "failed",
        transitionReason: "fatal_error",
      };
    case "completed":
    default:
      return {
        stage: "completed",
        phaseBeforeSidecars: "completed",
        transitionReason: "final_response",
      };
  }
}

function normalizeSidecarPolicy(
  config: HarnessSidecarPolicyConfig & {
    dedupeKey?: string;
  },
): NormalizedHarnessSidecarPolicy {
  const retry = config.retry ?? {};
  const backoffMs = Math.max(0, retry.backoffMs ?? 0);
  const maxBackoffMs = Math.max(backoffMs, retry.maxBackoffMs ?? backoffMs);
  return {
    executionMode: config.mode === "background" ? "background" : "inline",
    schedule: config.schedule ?? (config.mode === "trailing" ? "boundary" : "turn"),
    priority: config.priority ?? 100,
    bestEffort: config.bestEffort === true,
    ...(config.dedupeKey ? { dedupeKey: config.dedupeKey } : {}),
    retry: {
      maxAttempts: Math.max(1, retry.maxAttempts ?? 1),
      backoffMs,
      backoffMultiplier: Math.max(1, retry.backoffMultiplier ?? 2),
      maxBackoffMs,
    },
  };
}

function buildRetryAttempt(
  invocation: HarnessScheduledSidecar,
): HarnessScheduledSidecar | undefined {
  if (invocation.attempt >= invocation.policy.retry.maxAttempts) {
    return undefined;
  }
  const nextAttempt = invocation.attempt + 1;
  const baseBackoff = invocation.policy.retry.backoffMs;
  const nextBackoff = Math.min(
    invocation.policy.retry.maxBackoffMs,
    baseBackoff * invocation.policy.retry.backoffMultiplier ** Math.max(0, invocation.attempt - 1),
  );
  return {
    ...invocation,
    attempt: nextAttempt,
    availableAt: Date.now() + nextBackoff,
  };
}

function backoffDelayFor(invocation: HarnessScheduledSidecar): number {
  return Math.max(0, invocation.availableAt - Date.now());
}

function orderSidecars(
  invocations: HarnessScheduledSidecar[],
): HarnessScheduledSidecar[] {
  return invocations
    .slice()
    .sort((left, right) => {
      if (right.policy.priority !== left.policy.priority) {
        return right.policy.priority - left.policy.priority;
      }
      return left.createdAt - right.createdAt;
    });
}

function replaceSidecarByDedupeKey(
  queue: HarnessScheduledSidecar[],
  incoming: HarnessScheduledSidecar,
): boolean {
  const dedupeKey = incoming.policy.dedupeKey;
  if (!dedupeKey) {
    return false;
  }
  const index = queue.findIndex((entry) => entry.policy.dedupeKey === dedupeKey);
  if (index === -1) {
    return false;
  }
  queue[index] = incoming;
  return true;
}

function hasActiveBackgroundDedupe(
  active: Map<string, { runId: string; invocation: HarnessScheduledSidecar }>,
  runId: string,
  dedupeKey: string,
): boolean {
  for (const activeInvocation of active.values()) {
    if (
      activeInvocation.runId === runId &&
      activeInvocation.invocation.policy.dedupeKey === dedupeKey
    ) {
      return true;
    }
  }
  return false;
}

function totalQueuedSidecars(
  queues: Map<string, HarnessScheduledSidecar[]>,
): number {
  let total = 0;
  for (const queue of queues.values()) {
    total += queue.length;
  }
  return total;
}

function nextDueTimestamp(
  ...queues: HarnessScheduledSidecar[][]
): number | undefined {
  const dueTimes = queues
    .flat()
    .map((entry) => entry.availableAt)
    .sort((left, right) => left - right);
  return dueTimes[0];
}

function buildSidecarEventData(
  runId: string,
  invocation: HarnessScheduledSidecar,
  lifecycle: AgentLoopSidecarRequest | HarnessSidecarLifecycleContext,
  detail?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    runId,
    sidecar: invocation.name,
    trigger: invocation.trigger,
    stage: lifecycle.stage,
    phaseBeforeSidecars: lifecycle.phaseBeforeSidecars,
    transitionReason: lifecycle.transitionReason,
    mode: invocation.policy.executionMode,
    schedule: invocation.policy.schedule,
    priority: invocation.policy.priority,
    attempt: invocation.attempt,
    ...(invocation.policy.dedupeKey
      ? { dedupeKey: invocation.policy.dedupeKey }
      : {}),
    ...(detail ? { detail } : {}),
  };
}

function backgroundTaskRunId(runId: string): string {
  return `${runId}::sidecars`;
}

function buildLongTermMemoryExtractionInput(
  runId: string,
  runtimeRootDir: string,
  graphScopes: HarnessGraphScope[],
  sessionMemory: HarnessSessionMemoryRecord,
  summary: HarnessSummaryRecord | undefined,
): HarnessLongTermMemoryExtractionInput {
  return {
    runId,
    runtimeRootDir,
    sessionMemory,
    ...(summary ? { summary } : {}),
    graphScopes,
  };
}

function createLongTermMemoryExtractionSubagentTask(
  llm: LLMProvider,
  input: HarnessLongTermMemoryExtractionInput,
  loadGraphScopes: (() => Promise<HarnessGraphScope[]>) | undefined,
  scopes: MemoryScope[] | undefined,
): AgentTask {
  return {
    name: `__sidecar_long_term_memory__${input.runId}`,
    description: `Extract durable long-term memories for ${input.runId}`,
    kind: "subagent",
    isConcurrencySafe: true,
    failureMode: "soft",
    async execute(_args, context) {
      const resolvedGraphScopes = loadGraphScopes
        ? await loadGraphScopes()
        : input.graphScopes;
      const actualInput: HarnessLongTermMemoryExtractionInput = {
        ...input,
        graphScopes: resolvedGraphScopes.map(cloneGraphScope),
      };
      const collected: HarnessMemoryInput[] = [];
      const storeTool: AgentTool = {
        name: "store_memory_candidate",
        description:
          "Store one durable memory candidate. Use only for stable, reusable knowledge.",
        async execute(args) {
          const content =
            typeof args.content === "string" ? args.content.trim() : "";
          if (!content) {
            throw new Error("store_memory_candidate requires non-empty content");
          }
          const kind =
            typeof args.kind === "string" &&
            ["instruction", "fact", "summary", "observation", "artifact"].includes(args.kind)
              ? (args.kind as HarnessMemoryInput["kind"])
              : "fact";
          const importance =
            typeof args.importance === "string" &&
            ["low", "medium", "high", "critical"].includes(args.importance)
              ? (args.importance as HarnessMemoryInput["importance"])
              : undefined;
          const graphScopes = Array.isArray(args.graphScopes)
            ? args.graphScopes.filter(
                (scope): scope is HarnessGraphScope =>
                  scope != null &&
                  typeof scope === "object" &&
                  "kind" in scope &&
                  typeof (scope as { kind?: unknown }).kind === "string",
              )
            : undefined;
          const selectedScope =
            typeof args.scopeType === "string" && typeof args.scopeId === "string"
              ? { type: args.scopeType, id: args.scopeId }
              : undefined;
          collected.push({
            scope:
              selectedScope ??
              scopes?.[0] ??
              createRuntimeProjectMemoryScope(input.runtimeRootDir),
            content,
            runId: input.runId,
            ...(kind ? { kind } : {}),
            ...(importance ? { importance } : {}),
            ...(graphScopes?.length ? { graphScopes } : {}),
            metadata: {
              source: "sidecar.long_term_memory.subagent",
            },
          });
          return {
            stored: true,
            count: collected.length,
          };
        },
      };

      const result = await runAgentLoop(
        llm,
        {
          goal: buildLongTermMemorySubagentGoal(actualInput, scopes),
          maxIterations: 4,
          systemPrompt:
            "You are a background memory extraction agent. Extract only stable, reusable knowledge. " +
            "Never restate transient chat. Use store_memory_candidate for each durable memory. " +
            "If nothing is worth storing, respond with a short explanation and do not call tools.",
        },
        [storeTool],
        {
          control: {
            async check() {
              return context.signal.aborted ? "cancel" : "continue";
            },
          },
          callStack: new Set([...(context.callStack ?? []), "__sidecar_long_term_memory__"]),
        },
      );
      if (result.status === "canceled") {
        throw new Error("Long-term memory extraction sidecar canceled");
      }
      return { memories: collected };
    },
  };
}

function defaultLongTermMemoryExtraction(
  input: HarnessLongTermMemoryExtractionInput,
  scopes: MemoryScope[] | undefined,
): HarnessMemoryInput[] {
  const extractionScopes = scopes?.length
    ? scopes.map((scope) => ({ ...scope }))
    : [createRuntimeProjectMemoryScope(input.runtimeRootDir)];
  const steps = uniqueStrings([
    ...(input.summary?.completedSteps ?? []),
    ...input.sessionMemory.recentSteps,
  ]).slice(0, 4);
  const blockers = uniqueStrings([
    ...(input.summary?.blockers ?? []),
    ...input.sessionMemory.blockers,
  ]).slice(0, 3);
  const questions = uniqueStrings([
    ...(input.summary?.openQuestions ?? []),
    ...input.sessionMemory.openQuestions,
  ]).slice(0, 3);

  const memories: HarnessMemoryInput[] = [];
  const headline = input.summary?.headline ?? input.sessionMemory.headline;
  if (headline.trim()) {
    for (const scope of extractionScopes) {
      memories.push({
        scope,
        kind: "fact",
        runId: input.runId,
        importance: input.summary ? "high" : "medium",
        content: [
          `Run insight: ${headline.trim()}`,
          steps.length > 0 ? `Key steps: ${steps.join("; ")}` : undefined,
          blockers.length > 0 ? `Blockers: ${blockers.join("; ")}` : undefined,
        ].filter(Boolean).join(". "),
        ...(input.summary ? { sourceSummaryId: input.summary.id } : {}),
        metadata: {
          source: "sidecar.long_term_memory",
          status: input.sessionMemory.status,
        },
        ...(input.graphScopes.length > 0
          ? { graphScopes: input.graphScopes }
          : {}),
      });
    }
  }

  if (blockers.length > 0 || questions.length > 0) {
    for (const scope of extractionScopes) {
      memories.push({
        scope,
        kind: "instruction",
        runId: input.runId,
        importance: "medium",
        content: [
          `Resume guidance for goal "${input.sessionMemory.goal}":`,
          blockers.length > 0 ? `review blockers ${blockers.join("; ")}` : undefined,
          questions.length > 0 ? `resolve open questions ${questions.join("; ")}` : undefined,
        ].filter(Boolean).join(" "),
        ...(input.summary ? { sourceSummaryId: input.summary.id } : {}),
        metadata: {
          source: "sidecar.long_term_memory",
          status: input.sessionMemory.status,
        },
        ...(input.graphScopes.length > 0
          ? { graphScopes: input.graphScopes }
          : {}),
      });
    }
  }

  return memories;
}

function buildLongTermMemorySubagentGoal(
  input: HarnessLongTermMemoryExtractionInput,
  scopes: MemoryScope[] | undefined,
): string {
  return [
    `Review the following run context and store durable memories.`,
    `Goal: ${input.sessionMemory.goal}`,
    `Current status: ${input.sessionMemory.status}`,
    `Headline: ${input.summary?.headline ?? input.sessionMemory.headline}`,
    input.sessionMemory.recentSteps.length > 0
      ? `Recent steps: ${input.sessionMemory.recentSteps.join("; ")}`
      : undefined,
    input.sessionMemory.blockers.length > 0
      ? `Blockers: ${input.sessionMemory.blockers.join("; ")}`
      : undefined,
    input.sessionMemory.openQuestions.length > 0
      ? `Open questions: ${input.sessionMemory.openQuestions.join("; ")}`
      : undefined,
    input.summary
      ? `Summary completed steps: ${input.summary.completedSteps.join("; ")}`
      : undefined,
    scopes?.length
      ? `Preferred memory scopes: ${scopes.map((scope) => `${scope.type}:${scope.id}`).join(", ")}`
      : undefined,
    input.graphScopes.length > 0
      ? `Relevant graph scopes: ${input.graphScopes.map((scope) => scope.kind).join(", ")}`
      : undefined,
    `Store only stable, reusable facts or instructions.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeExtractedMemories(
  memories: HarnessMemoryInput[] | void,
  summary: HarnessSummaryRecord | undefined,
): HarnessMemoryInput[] {
  if (!memories || memories.length === 0) {
    return [];
  }
  return memories
    .filter((memory) => typeof memory.content === "string" && memory.content.trim().length > 0)
    .map((memory) => ({
      ...memory,
      content: memory.content.trim(),
      scope: { ...memory.scope },
      ...(memory.metadata
        ? { metadata: sanitizeMemoryMetadata(memory.metadata) }
        : {}),
      ...(memory.graphScopes
        ? { graphScopes: memory.graphScopes.map(cloneGraphScope) }
        : {}),
      ...(memory.sourceSummaryId || !summary ? {} : { sourceSummaryId: summary.id }),
    }));
}

function withDefaultGraphScopes(
  memory: HarnessMemoryInput,
  graphScopes: HarnessGraphScope[],
): HarnessMemoryInput {
  if (memory.graphScopes?.length || graphScopes.length === 0) {
    return memory;
  }
  return {
    ...memory,
    graphScopes: graphScopes.map(cloneGraphScope),
  };
}

function sanitizeMemoryMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
}

function cloneGraphScope<T>(scope: T): T {
  return JSON.parse(JSON.stringify(scope)) as T;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

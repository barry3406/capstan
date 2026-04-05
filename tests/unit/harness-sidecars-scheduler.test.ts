import { describe, expect, it } from "bun:test";

import type {
  AgentLoopSidecarRequest,
  AgentTaskNotification,
  AgentTaskRuntime,
  HarnessEvent,
  HarnessGraphScope,
  HarnessMemoryInput,
  HarnessMemoryRecord,
  HarnessRunRecord,
  HarnessSessionMemoryRecord,
  HarnessSummaryRecord,
} from "../../packages/ai/src/index.ts";
import type {
  HarnessCheckpointUpdate,
  HarnessRunContextState as SchedulerRunContextState,
} from "../../packages/ai/src/harness/context/kernel.ts";
import { createRuntimeProjectMemoryScope } from "../../packages/ai/src/harness/graph/utils.ts";
import { HarnessSidecarScheduler } from "../../packages/ai/src/harness/runtime/sidecars.ts";

type SidecarTestState = {
  events: HarnessEvent[];
  transitions: Array<{
    type: string;
    patch: Partial<Omit<HarnessRunRecord, "id" | "createdAt">>;
    data: Record<string, unknown>;
  }>;
  patchedRuns: Array<{
    runId: string;
    patch: Partial<Omit<HarnessRunRecord, "id" | "createdAt">>;
  }>;
  observedInputs: Array<{
    runId: string;
    tool?: string;
    task?: string;
    kind?: "tool" | "task";
    args: unknown;
    result: unknown;
  }>;
  memoryInputs: HarnessMemoryInput[];
  memoryRecords: HarnessMemoryRecord[];
  capturedContexts: SchedulerRunContextState[];
  taskSubmissions: Array<{
    runId: string;
    requestIds: string[];
    taskNames: string[];
  }>;
  taskNotifications: AgentTaskNotification[];
  pendingTasks: PendingTask[];
  currentRun: HarnessRunRecord;
};

type PendingTask = {
  runId: string;
  request: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    order: number;
  };
  task: {
    name: string;
    kind?: string | undefined;
    failureMode?: "soft" | "hard" | undefined;
    execute(
      args: Record<string, unknown>,
      context: {
        signal: AbortSignal;
        runId?: string | undefined;
        requestId: string;
        taskId: string;
        order: number;
        callStack?: ReadonlySet<string> | undefined;
      },
    ): Promise<unknown>;
  };
};

function createRunRecord(runId = "run-1"): HarnessRunRecord {
  const now = new Date("2026-04-05T00:00:00.000Z").toISOString();
  return {
    id: runId,
    goal: "sidecar test goal",
    status: "running",
    createdAt: now,
    updatedAt: now,
    iterations: 0,
    toolCalls: 0,
    taskCalls: 0,
    maxIterations: 10,
    toolNames: [],
    taskNames: [],
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: "local",
      mode: "local",
      browser: false,
      fs: false,
      artifactDir: "/tmp/capstan-sidecar-test",
    },
    lastEventSequence: 0,
    graphScopes: [{ kind: "project", projectId: "capstan-test" }],
  };
}

function createSessionMemory(runId = "run-1"): HarnessSessionMemoryRecord {
  return {
    runId,
    goal: "sidecar test goal",
    status: "running",
    updatedAt: "2026-04-05T00:00:00.000Z",
    sourceRunUpdatedAt: "2026-04-05T00:00:00.000Z",
    headline: "sidecar test headline",
    currentPhase: "executing_tools",
    recentSteps: ["step one", "step two"],
    blockers: ["blocked by inbox"],
    openQuestions: ["who owns the rollout?"],
    artifactRefs: [],
    compactedMessages: 0,
    tokenEstimate: 120,
  };
}

function createSummary(runId = "run-1"): HarnessSummaryRecord {
  return {
    id: `summary-${runId}`,
    runId,
    createdAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z",
    sourceRunUpdatedAt: "2026-04-05T00:00:00.000Z",
    kind: "session_compact",
    status: "running",
    headline: "summarized sidecar run",
    completedSteps: ["captured tool result"],
    blockers: ["follow up blocker"],
    openQuestions: ["open follow-up question"],
    artifactRefs: [],
    iterations: 1,
    toolCalls: 1,
    messageCount: 2,
    compactedMessages: 1,
  };
}

function createSidecarRequest(runId: string): AgentLoopSidecarRequest {
  return {
    runId,
    stage: "assistant_response",
    phaseBeforeSidecars: "executing_tools",
    transitionReason: "next_turn",
    checkpoint: {
      stage: "assistant_response",
      config: {
        goal: "sidecar test goal",
        maxIterations: 10,
        systemPrompt: "system",
      },
      messages: [],
      iterations: 1,
      toolCalls: [],
      taskCalls: [],
      orchestration: {
        phase: "executing_tools",
        transitionReason: "next_turn",
      },
    },
  };
}

function createCheckpointUpdate(
  runId: string,
  overrides?: Partial<HarnessCheckpointUpdate>,
): HarnessCheckpointUpdate {
  return {
    checkpoint: createSidecarRequest(runId).checkpoint,
    sessionMemory: createSessionMemory(runId),
    promotedMemories: [],
    ...overrides,
  };
}

function createMemoryRecord(
  input: HarnessMemoryInput,
  index: number,
): HarnessMemoryRecord {
  return {
    id: `memory-${index}`,
    scope: { ...input.scope },
    kind: input.kind ?? "fact",
    content: input.content,
    createdAt: "2026-04-05T00:00:00.000Z",
    updatedAt: "2026-04-05T00:00:00.000Z",
    accessCount: 0,
    lastAccessedAt: "2026-04-05T00:00:00.000Z",
    runId: input.runId,
    sourceSummaryId: input.sourceSummaryId,
    importance: input.importance,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

function createScheduler(
  overrides?: Partial<{
    run: Partial<HarnessRunRecord>;
    checkpointUpdate: Partial<HarnessCheckpointUpdate>;
    sidecars: Record<string, unknown>;
    contextEnabled: boolean;
    taskRuntime: AgentTaskRuntime;
    llm: {
      name: string;
      chat(messages: Array<{ role: string; content: string }>): Promise<{ model: string; content: string }>;
    };
    observationBehavior: (input: {
      runId: string;
      tool?: string;
      task?: string;
      kind?: "tool" | "task";
      args: unknown;
      result: unknown;
    }) => HarnessMemoryRecord | undefined | Promise<HarnessMemoryRecord | undefined>;
    rememberBehavior: (
      input: HarnessMemoryInput,
      state: SidecarTestState,
    ) => HarnessMemoryRecord | Promise<HarnessMemoryRecord>;
    captureRunStateBehavior: (
      runId: string,
      state: SidecarTestState,
    ) => SchedulerRunContextState | Promise<SchedulerRunContextState>;
    verifierBehavior: (action: {
      tool: string;
      args: unknown;
      timestamp: number;
    }, result: unknown) => Promise<{
      passed: boolean;
      reason?: string;
      retry?: boolean;
    }>;
  }>,
) {
  const state: SidecarTestState = {
    events: [],
    transitions: [],
    patchedRuns: [],
    observedInputs: [],
    memoryInputs: [],
    memoryRecords: [],
    capturedContexts: [],
    taskSubmissions: [],
    taskNotifications: [],
    pendingTasks: [],
    currentRun: createRunRecord(overrides?.run?.id ?? "run-1"),
  };
  if (overrides?.run) {
    state.currentRun = {
      ...state.currentRun,
      ...overrides.run,
      sandbox: {
        ...state.currentRun.sandbox,
        ...(overrides.run.sandbox ?? {}),
      },
    };
  }

  const taskRuntime: AgentTaskRuntime = overrides?.taskRuntime ?? {
    async submitBatch(input) {
      state.taskSubmissions.push({
        runId: input.runId,
        requestIds: input.requests.map((request) => request.id),
        taskNames: input.tasks.map((task) => task.name),
      });

      const records = input.requests.map((request, index) => ({
        id: `${input.runId}::${request.id}::${index + 1}`,
        runId: input.runId,
        requestId: request.id,
        name: request.name,
        kind: input.tasks[index]?.kind ?? "workflow",
        order: request.order,
        status: "running" as const,
        createdAt: "2026-04-05T00:00:00.000Z",
        updatedAt: "2026-04-05T00:00:00.000Z",
        args: request.args as Record<string, unknown>,
        hardFailure: input.tasks[index]?.failureMode === "hard",
      }));

      for (const [index, task] of input.tasks.entries()) {
        const request = input.requests[index]!;
        const record = records[index]!;
        state.pendingTasks.push({
          runId: input.runId,
          request: {
            id: request.id,
            name: request.name,
            args: request.args as Record<string, unknown>,
            order: request.order,
          },
          task: task as PendingTask["task"],
        });
        await Promise.resolve(input.hooks?.onSubmitted?.(record));
      }
      return { records };
    },
    async nextNotification(runId, _options) {
      const index = state.taskNotifications.findIndex(
        (notification) => notification.runId === runId,
      );
      if (index === -1) {
        const pendingIndex = state.pendingTasks.findIndex(
          (entry) => entry.runId === runId,
        );
        if (pendingIndex === -1) {
          return undefined;
        }
        const pending = state.pendingTasks.splice(pendingIndex, 1)[0]!;
        const taskRecord = {
          signal: new AbortController().signal,
          runId: pending.runId,
          requestId: pending.request.id,
          taskId: `${pending.runId}::${pending.request.id}::1`,
          order: pending.request.order,
          callStack: undefined,
        };
        try {
          const result = await pending.task.execute(
            pending.request.args,
            taskRecord,
          );
          state.taskNotifications.push({
            runId: pending.runId,
            taskId: taskRecord.taskId,
            requestId: pending.request.id,
            name: pending.request.name,
            kind: pending.task.kind ?? "workflow",
            order: pending.request.order,
            status: "completed",
            args: pending.request.args,
            result,
            hardFailure: pending.task.failureMode === "hard",
          });
        } catch (error) {
          state.taskNotifications.push({
            runId: pending.runId,
            taskId: taskRecord.taskId,
            requestId: pending.request.id,
            name: pending.request.name,
            kind: pending.task.kind ?? "workflow",
            order: pending.request.order,
            status: "failed",
            args: pending.request.args,
            error: error instanceof Error ? error.message : String(error),
            hardFailure: pending.task.failureMode === "hard",
          });
        }
        return this.nextNotification(runId, _options);
      }
      const [notification] = state.taskNotifications.splice(index, 1);
      return notification;
    },
    async cancelTasks() {},
    async cancelRun() {},
    getActiveTaskIds(runId) {
      return [
        ...state.taskNotifications
          .filter((notification) => notification.runId === runId)
          .map((notification) => notification.taskId),
        ...state.pendingTasks
          .filter((entry) => entry.runId === runId)
          .map((entry) => `${entry.runId}::${entry.request.id}::1`),
      ];
    },
    async destroy() {},
  };

  const scheduler = new HarnessSidecarScheduler({
    emit(event) {
      state.events.push(event);
    },
    async patchRun(runId, patch) {
      state.patchedRuns.push({ runId, patch });
      state.currentRun = {
        ...state.currentRun,
        ...patch,
      };
      return state.currentRun;
    },
    async transitionRun(type, patch, data) {
      state.transitions.push({ type, patch, data });
      state.currentRun = {
        ...state.currentRun,
        ...patch,
      };
    },
    async persistGlobalMemoryLifecycleEvent(_runId, memory) {
      state.memoryRecords.push(memory);
      state.events.push({
        type: "memory_stored",
        timestamp: Date.now(),
        data: {
          runId: memory.runId,
          memoryId: memory.id,
          kind: memory.kind,
          scope: memory.scope,
        },
      });
    },
    async persistGlobalCapturedContext(_runId, context) {
      state.capturedContexts.push(context);
    },
    async persistCheckpointContext(_runId, contextUpdate) {
      state.patchedRuns.push({
        runId: state.currentRun.id,
        patch: { checkpointUpdatedAt: contextUpdate.sessionMemory.updatedAt },
      });
    },
    contextKernel: {
      async recordObservation(input: {
        runId: string;
        tool?: string;
        task?: string;
        kind?: "tool" | "task";
        args: unknown;
        result: unknown;
      }) {
        state.observedInputs.push(input);
        if (overrides?.observationBehavior) {
          return overrides.observationBehavior(input);
        }
        const stored = createMemoryRecord(
          {
            scope: { type: "run", id: input.runId },
            kind: "observation",
            runId: input.runId,
            content: `observation for ${input.tool ?? input.task ?? "unknown"}`,
            metadata: {
              [input.kind ?? (input.task ? "task" : "tool")]: input.tool ?? input.task,
            },
          },
          state.memoryRecords.length + 1,
        );
        return stored;
      },
      async rememberMemory(input: HarnessMemoryInput) {
        state.memoryInputs.push(input);
        if (overrides?.rememberBehavior) {
          return overrides.rememberBehavior(input, state);
        }
        const stored = createMemoryRecord(input, state.memoryRecords.length + 1);
        state.memoryRecords.push(stored);
        return stored;
      },
      async captureRunState(runId: string) {
        if (overrides?.captureRunStateBehavior) {
          return overrides.captureRunStateBehavior(runId, state);
        }
        return {
          sessionMemory: createSessionMemory(runId),
          promotedMemories: [],
        };
      },
    } as any,
    verifier: overrides?.verifierBehavior
      ? ({
          async verify(action, result) {
            return overrides.verifierBehavior!(action, result);
          },
        } as any)
      : null,
    taskRuntime,
    llm: overrides?.llm ?? {
      name: "sidecar-test-llm",
      async chat(messages) {
        const hasStoredMemory = messages.some((message) =>
          message.content.includes("store_memory_candidate") &&
          message.content.includes("returned"),
        );
        return {
          model: "mock-1",
          content: hasStoredMemory
            ? "No more durable memories."
            : JSON.stringify({
                tool: "store_memory_candidate",
                arguments: {
                  kind: "fact",
                  importance: "high",
                  content: "Durable memory from scheduler sidecar",
                },
              }),
        };
      },
    },
    runtimeRootDir: "/tmp/capstan-sidecar-test-runtime",
    async getRun() {
      return state.currentRun;
    },
    contextEnabled: overrides?.contextEnabled ?? true,
    sidecars: overrides?.sidecars as any,
  });

  return { scheduler, state };
}

function sidecarRequest(runId = "run-1"): AgentLoopSidecarRequest {
  return createSidecarRequest(runId);
}

describe("HarnessSidecarScheduler", () => {
  it("dispatches checkpoint sidecars in order and persists summary promotions", async () => {
    const { scheduler, state } = createScheduler();
    const checkpointUpdate = createCheckpointUpdate("run-1", {
      summary: createSummary("run-1"),
      promotedMemories: [
        createMemoryRecord(
          {
            scope: { type: "run", id: "run-1" },
            kind: "summary",
            runId: "run-1",
            content: "run summary promoted",
          },
          99,
        ),
      ],
    });

    await scheduler.persistCheckpointContext("run-1", checkpointUpdate);

    const events = state.events;
    const sessionStartedIndex = events.findIndex(
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "session_memory_refresh",
    );
    const sessionCompletedIndex = events.findIndex(
      (event) =>
        event.type === "sidecar_completed" &&
        event.data.sidecar === "session_memory_refresh",
    );
    const summaryStartedIndex = events.findIndex(
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "checkpoint_summary_capture",
    );
    const summaryCreatedIndex = events.findIndex(
      (event) => event.type === "summary_created",
    );
    const summaryCompletedIndex = events.findIndex(
      (event) =>
        event.type === "sidecar_completed" &&
        event.data.sidecar === "checkpoint_summary_capture",
    );
    const memoryStoredCount = events.filter(
      (event) => event.type === "memory_stored",
    ).length;

    expect(sessionStartedIndex).toBeGreaterThanOrEqual(0);
    expect(sessionCompletedIndex).toBeGreaterThan(sessionStartedIndex);
    expect(summaryStartedIndex).toBeGreaterThan(sessionCompletedIndex);
    expect(summaryCreatedIndex).toBeGreaterThan(summaryStartedIndex);
    expect(summaryCompletedIndex).toBeGreaterThan(summaryCreatedIndex);
    expect(memoryStoredCount).toBe(1);
  });

  it("deduplicates trailing long-term extraction and keeps the default scope short", async () => {
    const extractCalls: Array<{
      runtimeRootDir: string;
      graphScopes: HarnessGraphScope[];
    }> = [];
    const { scheduler, state } = createScheduler({
      sidecars: {
        longTermMemory: {
          enabled: true,
          extract: async (input) => {
            extractCalls.push({
              runtimeRootDir: input.runtimeRootDir,
              graphScopes: input.graphScopes,
            });
            return undefined;
          },
        },
      },
    });

    await scheduler.persistCheckpointContext(
      "run-1",
      createCheckpointUpdate("run-1"),
    );
    await scheduler.persistCheckpointContext(
      "run-1",
      createCheckpointUpdate("run-1"),
    );

    await scheduler.captureRunBoundary("run-1", "completed");

    const longTermStarted = state.events.filter(
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "long_term_memory_extract",
    );
    const longTermCompleted = state.events.filter(
      (event) =>
        event.type === "sidecar_completed" &&
        event.data.sidecar === "long_term_memory_extract",
    );

    expect(extractCalls).toHaveLength(1);
    expect(extractCalls[0]?.runtimeRootDir).toBe("/tmp/capstan-sidecar-test-runtime");
    expect(longTermStarted).toHaveLength(1);
    expect(longTermCompleted).toHaveLength(1);
    expect(state.memoryInputs).toHaveLength(2);
    for (const memory of state.memoryInputs) {
      expect(memory.scope).toEqual(
        createRuntimeProjectMemoryScope("/tmp/capstan-sidecar-test-runtime"),
      );
    }
  });

  it("keeps boundary-scheduled sidecars isolated per run instead of draining another run's queue", async () => {
    const seen: Array<{ runId: string; headline: string }> = [];
    const { scheduler, state } = createScheduler({
      sidecars: {
        longTermMemory: {
          enabled: true,
          extract: async (input) => {
            seen.push({
              runId: input.runId,
              headline: input.sessionMemory.headline,
            });
            return [];
          },
        },
      },
    });

    await scheduler.persistCheckpointContext(
      "run-1",
      createCheckpointUpdate("run-1", {
        sessionMemory: {
          ...createSessionMemory("run-1"),
          headline: "run one headline",
        },
      }),
    );
    await scheduler.persistCheckpointContext(
      "run-2",
      createCheckpointUpdate("run-2", {
        sessionMemory: {
          ...createSessionMemory("run-2"),
          headline: "run two headline",
        },
      }),
    );

    await scheduler.captureRunBoundary("run-1", "completed");

    expect(seen).toEqual([{ runId: "run-1", headline: "run one headline" }]);
    expect(scheduler.hasPendingTurnSidecars("run-1")).toBe(false);
    expect(scheduler.hasPendingTurnSidecars("run-2")).toBe(true);
    expect(
      state.events.filter(
        (event) =>
          event.type === "sidecar_started" &&
          event.data.sidecar === "long_term_memory_extract",
      ),
    ).toHaveLength(1);

    await scheduler.captureRunBoundary("run-2", "completed");

    expect(seen).toEqual([
      { runId: "run-1", headline: "run one headline" },
      { runId: "run-2", headline: "run two headline" },
    ]);
    expect(scheduler.hasPendingTurnSidecars("run-2")).toBe(false);
  });

  it("does not let another run's active background sidecars block boundary quiescence", async () => {
    const taskNotifications = new Map<string, AgentTaskNotification[]>();
    const submissions: Array<{
      runId: string;
      requestIds: string[];
      taskNames: string[];
    }> = [];
    const taskRuntime: AgentTaskRuntime = {
      async submitBatch(input) {
        submissions.push({
          runId: input.runId,
          requestIds: input.requests.map((request) => request.id),
          taskNames: input.tasks.map((task) => task.name),
        });
        const records = input.requests.map((request, index) => ({
          id: `${input.runId}::${request.id}::${index + 1}`,
          runId: input.runId,
          requestId: request.id,
          name: request.name,
          kind: input.tasks[index]?.kind ?? "workflow",
          order: request.order,
          status: "running" as const,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
          args: request.args as Record<string, unknown>,
          hardFailure: input.tasks[index]?.failureMode === "hard",
        }));
        for (const record of records) {
          await Promise.resolve(input.hooks?.onSubmitted?.(record));
        }
        return { records };
      },
      async nextNotification(runId) {
        const queue = taskNotifications.get(runId) ?? [];
        const next = queue.shift();
        return next;
      },
      async cancelTasks() {},
      async cancelRun() {},
      getActiveTaskIds() {
        return [];
      },
      async destroy() {},
    };
    const { scheduler, state } = createScheduler({
      taskRuntime,
      sidecars: {
        verification: {
          enabled: true,
        },
      },
      verifierBehavior: async () => ({
        passed: true,
        reason: "verified",
      }),
    });

    await scheduler.enqueueToolResult({
      runId: "run-2",
      tool: "step",
      args: { value: "queued" },
      result: { value: "queued" },
    });
    await scheduler.flushTurnSidecars("run-2", sidecarRequest("run-2"));

    const resolved = await Promise.race([
      scheduler.captureRunBoundary("run-1", "completed").then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);

    expect(resolved).toBe(true);
    expect(scheduler.hasPendingTurnSidecars("run-1")).toBe(false);
    expect(scheduler.hasPendingTurnSidecars("run-2")).toBe(true);
    expect(
      state.events.some(
        (event) =>
          event.type === "sidecar_completed" &&
          event.data.sidecar === "tool_verification:step" &&
          event.data.runId === "run-2",
      ),
    ).toBe(false);

    const [submitted] = submissions;
    const [requestId] = submitted?.requestIds ?? [];
    const taskId = `${submitted?.runId}::${requestId}::1`;
    taskNotifications.set(submitted!.runId, [
      {
        runId: submitted!.runId,
        taskId,
        requestId,
        name: submitted!.taskNames[0]!,
        kind: "workflow",
        order: 100,
        status: "completed",
        args: {},
        result: { ok: true },
        hardFailure: false,
      },
    ]);

    await scheduler.captureRunBoundary("run-2", "completed");

    expect(
      state.events.some(
        (event) =>
          event.type === "sidecar_completed" &&
          event.data.sidecar === "tool_verification:step" &&
          event.data.runId === "run-2",
      ),
    ).toBe(true);
  });

  it("runs verification sidecars through the task runtime in background mode", async () => {
    const { scheduler, state } = createScheduler({
      sidecars: {
        verification: {
          enabled: true,
        },
      },
      verifierBehavior: async () => ({
        passed: true,
        reason: "verified",
      }),
    });

    await scheduler.enqueueToolResult({
      runId: "run-1",
      tool: "step",
      args: { value: "one" },
      result: { value: "one" },
    });
    await scheduler.flushTurnSidecars("run-1", sidecarRequest("run-1"));

    const started = state.events.find(
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "tool_verification:step",
    );
    const verifyPass = state.events.find(
      (event) => event.type === "verify_pass" && event.data.tool === "step",
    );
    const completed = state.events.find(
      (event) =>
        event.type === "sidecar_completed" &&
        event.data.sidecar === "tool_verification:step",
    );

    expect(state.taskSubmissions).toHaveLength(1);
    expect(state.taskSubmissions[0]?.runId).toBe("run-1::sidecars");
    expect(started?.data).toMatchObject({
      mode: "background",
      sidecar: "tool_verification:step",
    });
    expect(verifyPass).toBeDefined();
    expect(completed).toBeDefined();
    expect(state.taskNotifications).toHaveLength(0);
  });

  it("retries inline observation sidecars before succeeding", async () => {
    let attempts = 0;
    const { scheduler, state } = createScheduler({
      sidecars: {
        observations: {
          enabled: true,
          retry: {
            maxAttempts: 2,
            backoffMs: 0,
            backoffMultiplier: 1,
            maxBackoffMs: 0,
          },
        },
      },
      observationBehavior: async (input) => {
        attempts++;
        if (attempts === 1) {
          throw new Error(`transient observation failure for ${input.tool ?? input.task}`);
        }
        return createMemoryRecord(
          {
            scope: { type: "run", id: input.runId },
            runId: input.runId,
            kind: "observation",
            content: "recovered observation",
            metadata: {
              tool: input.tool,
            },
          },
          1,
        );
      },
    });

    await scheduler.enqueueToolResult({
      runId: "run-1",
      tool: "step",
      args: { value: "one" },
      result: { value: "one" },
    });
    await scheduler.flushTurnSidecars("run-1", sidecarRequest("run-1"));

    const started = state.events.filter(
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "tool_observation:step",
    );
    const failed = state.events.filter(
      (event) =>
        event.type === "sidecar_failed" &&
        event.data.sidecar === "tool_observation:step",
    );
    const completed = state.events.filter(
      (event) =>
        event.type === "sidecar_completed" &&
        event.data.sidecar === "tool_observation:step",
    );

    expect(attempts).toBe(2);
    expect(started).toHaveLength(2);
    expect(failed).toHaveLength(0);
    expect(completed).toHaveLength(1);
    expect(state.memoryRecords).toHaveLength(1);
  });

  it("fails closed for non-bestEffort background sidecars", async () => {
    const { scheduler, state } = createScheduler({
      sidecars: {
        verification: {
          enabled: true,
          retry: { maxAttempts: 1 },
          bestEffort: false,
        },
      },
      verifierBehavior: async () => {
        throw new Error("verification exploded");
      },
    });

    await scheduler.enqueueToolResult({
      runId: "run-1",
      tool: "step",
      args: { value: "one" },
      result: { value: "one" },
    });

    await expect(
      scheduler.flushTurnSidecars("run-1", sidecarRequest("run-1")),
    ).rejects.toThrow("verification exploded");

    const failed = state.events.find(
      (event) =>
        event.type === "sidecar_failed" &&
        event.data.sidecar === "tool_verification:step",
    );
    expect(failed).toBeDefined();
  });

  it("treats bestEffort trailing sidecar failures as non-fatal", async () => {
    const { scheduler, state } = createScheduler({
      sidecars: {
        longTermMemory: {
          enabled: true,
          retry: { maxAttempts: 1 },
          bestEffort: true,
          extract: async () => {
            throw new Error("long-term extraction failed");
          },
        },
      },
    });

    await scheduler.persistCheckpointContext(
      "run-1",
      createCheckpointUpdate("run-1"),
    );
    await expect(
      scheduler.captureRunBoundary("run-1", "completed"),
    ).resolves.toBeUndefined();

    const failed = state.events.find(
      (event) =>
        event.type === "sidecar_failed" &&
        event.data.sidecar === "long_term_memory_extract",
    );
    expect(failed).toBeDefined();
  });

  it("does not execute trailing extraction during checkpoint flush and keeps only the latest payload for boundary execution", async () => {
    const seenHeadlines: string[] = [];
    const { scheduler, state } = createScheduler({
      sidecars: {
        longTermMemory: {
          enabled: true,
          extract: async (input) => {
            seenHeadlines.push(input.sessionMemory.headline);
            return [];
          },
        },
      },
    });

    await scheduler.persistCheckpointContext(
      "run-1",
      createCheckpointUpdate("run-1", {
        sessionMemory: {
          ...createSessionMemory("run-1"),
          headline: "first headline",
        },
      }),
    );
    await scheduler.persistCheckpointContext(
      "run-1",
      createCheckpointUpdate("run-1", {
        sessionMemory: {
          ...createSessionMemory("run-1"),
          headline: "latest headline",
        },
      }),
    );

    expect(
      state.events.some(
        (event) =>
          event.type === "sidecar_started" &&
          event.data.sidecar === "long_term_memory_extract",
      ),
    ).toBe(false);

    await scheduler.captureRunBoundary("run-1", "completed");

    expect(seenHeadlines).toEqual(["latest headline"]);
    const started = state.events.filter(
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "long_term_memory_extract",
    );
    expect(started).toHaveLength(1);
  });

  it("requeues background verification retries and completes them during boundary quiescence", async () => {
    let attempts = 0;
    const { scheduler, state } = createScheduler({
      sidecars: {
        verification: {
          enabled: true,
          retry: { maxAttempts: 2, backoffMs: 0, backoffMultiplier: 1, maxBackoffMs: 0 },
        },
      },
      verifierBehavior: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("background verification flaked");
        }
        return {
          passed: true,
          reason: "retry succeeded",
        };
      },
    });

    scheduler.enqueueToolResult({
      runId: "run-1",
      tool: "step",
      args: { value: "one" },
      result: { value: "one" },
    });

    await scheduler.flushTurnSidecars("run-1", sidecarRequest("run-1"));

    expect(attempts).toBe(1);
    expect(
      state.events.filter(
        (event) =>
          event.type === "sidecar_started" &&
          event.data.sidecar === "tool_verification:step",
      ),
    ).toHaveLength(1);
    expect(
      state.events.some(
        (event) =>
          event.type === "sidecar_completed" &&
          event.data.sidecar === "tool_verification:step",
      ),
    ).toBe(false);

    await scheduler.captureRunBoundary("run-1", "completed");

    expect(attempts).toBe(2);
    expect(
      state.events.filter(
        (event) =>
          event.type === "sidecar_started" &&
          event.data.sidecar === "tool_verification:step",
      ),
    ).toHaveLength(2);
    expect(
      state.events.filter(
        (event) =>
          event.type === "sidecar_completed" &&
          event.data.sidecar === "tool_verification:step",
      ),
    ).toHaveLength(1);
    expect(
      state.events.some(
        (event) =>
          event.type === "sidecar_failed" &&
          event.data.sidecar === "tool_verification:step",
      ),
    ).toBe(false);
    expect(
      state.events.filter(
        (event) => event.type === "verify_pass" && event.data.tool === "step",
      ),
    ).toHaveLength(1);
  });

  it("records context_compacted through session memory refresh sidecars when checkpoint compaction is present", async () => {
    const { scheduler, state } = createScheduler();

    await scheduler.persistCheckpointContext(
      "run-1",
      createCheckpointUpdate("run-1", {
        compaction: {
          kind: "session_compact",
          previousTokens: 1200,
          nextTokens: 480,
          compactedMessages: 7,
        },
        summary: createSummary("run-1"),
      }),
    );

    const compacted = state.events.find((event) => event.type === "context_compacted");
    expect(compacted?.data).toMatchObject({
      runId: "run-1",
      kind: "session_compact",
      previousTokens: 1200,
      nextTokens: 480,
      compactedMessages: 7,
    });
    expect(
      state.transitions.find((transition) => transition.type === "context_compacted"),
    ).toMatchObject({
      patch: {
        contextUpdatedAt: "2026-04-05T00:00:00.000Z",
      },
      data: {
        kind: "session_compact",
        previousTokens: 1200,
        nextTokens: 480,
        compactedMessages: 7,
      },
    });
  });

  it("persists promoted memories even when no summary is present", async () => {
    const promotedMemory = createMemoryRecord(
      {
        scope: { type: "run", id: "run-1" },
        kind: "fact",
        runId: "run-1",
        content: "promoted fact",
      },
      7,
    );
    const { scheduler, state } = createScheduler();

    await scheduler.persistCheckpointContext(
      "run-1",
      createCheckpointUpdate("run-1", {
        summary: undefined,
        promotedMemories: [promotedMemory],
      }),
    );

    const summarySidecarStarted = state.events.find(
      (event) =>
        event.type === "sidecar_started" &&
        event.data.sidecar === "checkpoint_summary_capture",
    );
    const summaryCreated = state.events.find((event) => event.type === "summary_created");

    expect(summarySidecarStarted).toBeDefined();
    expect(summaryCreated).toBeUndefined();
    expect(state.memoryRecords).toContainEqual(promotedMemory);
  });

  it("treats bestEffort inline observation failures as non-fatal", async () => {
    const { scheduler, state } = createScheduler({
      sidecars: {
        observations: {
          enabled: true,
          bestEffort: true,
          retry: { maxAttempts: 1 },
        },
      },
      observationBehavior: async () => {
        throw new Error("observation exploded");
      },
    });

    scheduler.enqueueToolResult({
      runId: "run-1",
      tool: "step",
      args: { value: "one" },
      result: { value: "one" },
    });

    await expect(
      scheduler.flushTurnSidecars("run-1", sidecarRequest("run-1")),
    ).resolves.toEqual({});

    expect(
      state.events.find(
        (event) =>
          event.type === "sidecar_failed" &&
          event.data.sidecar === "tool_observation:step",
      )?.data.error,
    ).toContain("observation exploded");
    expect(state.memoryRecords).toHaveLength(0);
  });

  it("maps run-boundary lifecycle metadata for terminal states", async () => {
    const scenarios = [
      {
        status: "completed" as const,
        expected: {
          stage: "completed",
          phaseBeforeSidecars: "completed",
          transitionReason: "final_response",
        },
      },
      {
        status: "approval_required" as const,
        expected: {
          stage: "approval_required",
          phaseBeforeSidecars: "approval_blocked",
          transitionReason: "approval_required",
        },
      },
      {
        status: "paused" as const,
        expected: {
          stage: "paused",
          phaseBeforeSidecars: "paused",
          transitionReason: "pause_requested",
        },
      },
      {
        status: "canceled" as const,
        expected: {
          stage: "canceled",
          phaseBeforeSidecars: "canceled",
          transitionReason: "cancel_requested",
        },
      },
      {
        status: "max_iterations" as const,
        expected: {
          stage: "max_iterations",
          phaseBeforeSidecars: "max_iterations",
          transitionReason: "iteration_limit",
        },
      },
      {
        status: "failed" as const,
        expected: {
          stage: "canceled",
          phaseBeforeSidecars: "failed",
          transitionReason: "fatal_error",
        },
      },
    ];

    for (const scenario of scenarios) {
      const { scheduler, state } = createScheduler({
        run: { id: `run-${scenario.status}` },
      });
      await scheduler.captureRunBoundary(`run-${scenario.status}`, scenario.status);

      const boundaryStarted = state.events.find(
        (event) =>
          event.type === "sidecar_started" &&
          event.data.sidecar === "run_boundary_capture",
      );
      expect(boundaryStarted?.data).toMatchObject({
        runId: `run-${scenario.status}`,
        ...scenario.expected,
      });
    }
  });

  it("runs verification while context-bound sidecars stay disabled when context is off", async () => {
    const { scheduler, state } = createScheduler({
      contextEnabled: false,
      sidecars: {
        verification: {
          enabled: true,
        },
      },
      verifierBehavior: async () => ({
        passed: true,
        reason: "verification still runs",
      }),
    });

    scheduler.enqueueToolResult({
      runId: "run-1",
      tool: "step",
      args: { value: "one" },
      result: { value: "one" },
    });

    await scheduler.flushTurnSidecars("run-1", sidecarRequest("run-1"));
    await scheduler.captureRunBoundary("run-1", "completed");

    expect(
      state.events.some(
        (event) =>
          event.type === "sidecar_started" &&
          event.data.sidecar === "tool_observation:step",
      ),
    ).toBe(false);
    expect(
      state.events.some(
        (event) =>
          event.type === "sidecar_started" &&
          event.data.sidecar === "run_boundary_capture",
      ),
    ).toBe(false);
    expect(
      state.events.filter(
        (event) =>
          event.type === "sidecar_started" &&
          event.data.sidecar === "tool_verification:step",
      ),
    ).toHaveLength(1);
    expect(
      state.events.filter(
        (event) => event.type === "verify_pass" && event.data.tool === "step",
      ),
    ).toHaveLength(1);
    expect(state.memoryRecords).toHaveLength(0);
  });

  it("records task observations through the task-result trigger", async () => {
    const { scheduler, state } = createScheduler();

    scheduler.enqueueTaskResult({
      runId: "run-1",
      task: "background",
      args: { label: "sync" },
      result: { ok: true },
    });
    await scheduler.flushTurnSidecars("run-1", sidecarRequest("run-1"));

    expect(state.observedInputs).toHaveLength(1);
    expect(state.observedInputs[0]).toMatchObject({
      runId: "run-1",
      task: "background",
      kind: "task",
      args: { label: "sync" },
      result: { ok: true },
    });
    expect(
      state.events.filter(
        (event) =>
          event.type === "sidecar_started" &&
          event.data.sidecar === "task_observation:background",
      ),
    ).toHaveLength(1);
    expect(
      state.events.filter(
        (event) =>
          event.type === "sidecar_completed" &&
          event.data.sidecar === "task_observation:background",
      ),
    ).toHaveLength(1);
    expect(state.memoryRecords).toHaveLength(1);
    expect(state.memoryRecords[0]).toMatchObject({
      kind: "observation",
      metadata: {
        task: "background",
      },
    });
  });

  it("fails closed when background task submission itself fails", async () => {
    const taskRuntime: AgentTaskRuntime = {
      async submitBatch() {
        throw new Error("submitBatch exploded");
      },
      async nextNotification() {
        return undefined;
      },
      async cancelTasks() {},
      async cancelRun() {},
      getActiveTaskIds() {
        return [];
      },
      async destroy() {},
    };
    const { scheduler, state } = createScheduler({
      taskRuntime,
      sidecars: {
        verification: {
          enabled: true,
          retry: { maxAttempts: 1 },
          bestEffort: false,
        },
      },
      verifierBehavior: async () => ({
        passed: true,
        reason: "unreachable",
      }),
    });

    scheduler.enqueueToolResult({
      runId: "run-1",
      tool: "step",
      args: { value: "one" },
      result: { value: "one" },
    });

    await expect(
      scheduler.flushTurnSidecars("run-1", sidecarRequest("run-1")),
    ).rejects.toThrow("submitBatch exploded");
    expect(
      state.events.find(
        (event) =>
          event.type === "sidecar_failed" &&
          event.data.sidecar === "tool_verification:step",
      )?.data.error,
    ).toContain("submitBatch exploded");
  });

  it("drops empty extracted memories instead of persisting blank records", async () => {
    const { scheduler, state } = createScheduler({
      sidecars: {
        longTermMemory: {
          enabled: true,
          extract: async () => [
            {
              scope: createRuntimeProjectMemoryScope("/tmp/capstan-sidecar-test-runtime"),
              kind: "fact",
              content: "   ",
            },
            {
              scope: createRuntimeProjectMemoryScope("/tmp/capstan-sidecar-test-runtime"),
              kind: "fact",
              content: "",
            },
          ],
        },
      },
    });

    await scheduler.persistCheckpointContext(
      "run-1",
      createCheckpointUpdate("run-1"),
    );
    await scheduler.captureRunBoundary("run-1", "completed");

    expect(state.memoryInputs).toHaveLength(0);
    expect(state.memoryRecords).toHaveLength(0);
    expect(
      state.events.filter((event) => event.type === "memory_stored"),
    ).toHaveLength(0);
    expect(
      state.events.filter(
        (event) =>
          event.type === "sidecar_completed" &&
          event.data.sidecar === "long_term_memory_extract",
      ),
    ).toHaveLength(1);
  });

  it("retries background completion bookkeeping before marking the sidecar completed", async () => {
    let rememberAttempts = 0;
    const { scheduler, state } = createScheduler({
      sidecars: {
        longTermMemory: {
          enabled: true,
          agentic: true,
          bestEffort: false,
          retry: { maxAttempts: 2, backoffMs: 0, backoffMultiplier: 1, maxBackoffMs: 0 },
        },
      },
      rememberBehavior: async (input, currentState) => {
        rememberAttempts += 1;
        if (rememberAttempts === 1) {
          throw new Error("remember memory flaked");
        }
        const stored = createMemoryRecord(input, currentState.memoryRecords.length + 1);
        currentState.memoryRecords.push(stored);
        return stored;
      },
    });

    await scheduler.persistCheckpointContext(
      "run-1",
      createCheckpointUpdate("run-1", {
        summary: createSummary("run-1"),
      }),
    );
    await scheduler.captureRunBoundary("run-1", "completed");

    expect(rememberAttempts).toBe(2);
    expect(
      state.events.filter(
        (event) =>
          event.type === "sidecar_started" &&
          event.data.sidecar === "long_term_memory_extract",
      ),
    ).toHaveLength(2);
    expect(
      state.events.some(
        (event) =>
          event.type === "sidecar_failed" &&
          event.data.sidecar === "long_term_memory_extract",
      ),
    ).toBe(false);
    expect(
      state.events.filter(
        (event) =>
          event.type === "sidecar_completed" &&
          event.data.sidecar === "long_term_memory_extract",
      ),
    ).toHaveLength(1);
    expect(state.memoryRecords).toContainEqual(
      expect.objectContaining({
        content: "Durable memory from scheduler sidecar",
      }),
    );
  });

  it("applies run graph scopes to agentic long-term memories that omit them", async () => {
    const { scheduler, state } = createScheduler({
      sidecars: {
        longTermMemory: {
          enabled: true,
          agentic: true,
        },
      },
      run: {
        graphScopes: [
          { kind: "project", projectId: "capstan-runtime" },
          { kind: "capability", capabilityId: "ops.review" },
        ],
      },
    });

    await scheduler.persistCheckpointContext(
      "run-1",
      createCheckpointUpdate("run-1", {
        summary: createSummary("run-1"),
      }),
    );
    await scheduler.captureRunBoundary("run-1", "completed");

    expect(state.memoryInputs).toContainEqual(
      expect.objectContaining({
        content: "Durable memory from scheduler sidecar",
        graphScopes: [
          { kind: "project", projectId: "capstan-runtime" },
          { kind: "capability", capabilityId: "ops.review" },
        ],
      }),
    );
  });
});

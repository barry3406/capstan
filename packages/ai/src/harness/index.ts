/**
 * Agent Harness Mode — isolated runtime substrate for browser/filesystem tools.
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type { AgentCheckpoint } from "../types.js";
import type {
  AgentRunConfig,
  Harness,
  HarnessAccessContext,
  HarnessAuthorizedAction,
  HarnessAction,
  HarnessApprovalRecord,
  HarnessApprovalResolutionOptions,
  HarnessAuthorizationRequest,
  HarnessContextAssembleOptions,
  HarnessConfig,
  HarnessEvent,
  HarnessMemoryRecord,
  HarnessMemoryInput,
  HarnessMemoryQuery,
  HarnessRunRecord,
  HarnessRunEventType,
  HarnessRunResult,
  HarnessRunStartOptions,
  HarnessResumeOptions,
  HarnessSandboxContext,
  HarnessRuntimeStore,
  HarnessVerifierFn,
} from "./types.js";
import { runSmartLoop } from "../loop/engine.js";
import { InMemoryAgentTaskRuntime } from "../task/runtime.js";
import { HarnessObserver } from "./observe/index.js";
import { FileHarnessRuntimeStore } from "./runtime/store.js";
import { LocalHarnessSandboxDriver } from "./runtime/local-driver.js";
import {
  buildApprovalDetail,
  ensureRunApprovalRecord,
  resolveRunApproval,
} from "./runtime/approvals.js";
import { assertValidAgentCheckpoint } from "./runtime/checkpoint.js";
import { buildHarnessTools } from "./runtime/tools.js";
import {
  HarnessContextKernel,
  type HarnessCheckpointUpdate,
  type HarnessRunContextState,
} from "./context/kernel.js";
import {
  isHarnessRunResumable,
  mapAgentRunStatusToHarnessStatus,
  sanitizeHarnessEventData,
  summarizeHarnessResult,
} from "./runtime/utils.js";
import { assertHarnessAuthorized, filterHarnessAuthorizedItems } from "./runtime/authz.js";
import { HarnessVerifier } from "./verify/index.js";

export async function createHarness(config: HarnessConfig): Promise<Harness> {
  const observer = new HarnessObserver();

  if (config.observe?.onEvent) {
    observer.subscribe(config.observe.onEvent);
  }
  if (config.observe?.logger) {
    observer.subscribe((event) => config.observe!.logger!.log(event));
  }

  const runtimeRootDir = config.runtime?.rootDir ?? process.cwd();
  const runtimeStore: HarnessRuntimeStore =
    config.runtime?.storeFactory?.(runtimeRootDir) ??
    new FileHarnessRuntimeStore(runtimeRootDir);
  await runtimeStore.initialize();
  const contextKernel = new HarnessContextKernel(runtimeStore, config.context);
  await contextKernel.initialize();

  const driver = config.runtime?.driver ?? new LocalHarnessSandboxDriver();
  const maxConcurrentRuns = config.runtime?.maxConcurrentRuns ?? 1;
  const authorize = config.runtime?.authorize;

  const verifierOpts: { maxRetries?: number; verifier?: HarnessVerifierFn } = {};
  if (config.verify?.maxRetries != null) verifierOpts.maxRetries = config.verify.maxRetries;
  if (config.verify?.verifier != null) verifierOpts.verifier = config.verify.verifier;
  const verifier =
    config.verify?.enabled !== false
      ? new HarnessVerifier(config.llm, verifierOpts)
      : null;

  let destroyed = false;
  const activeRunIds = new Set<string>();
  const activeRunWaiters = new Map<string, Promise<void>>();
  const activeSandboxContexts = new Map<string, HarnessSandboxContext>();
  const suspendedSandboxContexts = new Map<string, HarnessSandboxContext>();
  const requestedControls = new Map<string, "pause" | "cancel">();
  const resumableConfigs = new Map<string, AgentRunConfig>();
  const activeTaskAbortControllers = new Map<string, Set<AbortController>>();

  const emit = (event: HarnessEvent): void => {
    observer.log(event);
  };

  const buildAuthorizationRequest = (input: {
    action: HarnessAuthorizedAction;
    runId?: string | undefined;
    run?: HarnessRunRecord | undefined;
    access?: HarnessAccessContext | undefined;
    detail?: Record<string, unknown> | undefined;
  }): HarnessAuthorizationRequest => ({
    action: input.action,
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.run !== undefined ? { run: input.run } : {}),
    ...(input.access !== undefined ? { access: input.access } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  });

  const requirePendingApproval = async (
    runId: string,
  ): Promise<{ run: HarnessRunRecord; approval: HarnessApprovalRecord }> => {
    const run = await runtimeStore.requireRun(runId);
    return ensureRunApprovalRecord(runtimeStore, run);
  };

  const emitApprovalResolution = (
    status: "approved" | "denied" | "canceled",
    runId: string,
    approval: HarnessApprovalRecord,
    options?: HarnessApprovalResolutionOptions,
  ): void => {
    const resolvedBy =
      options?.access?.subject &&
      typeof options.access.subject === "object" &&
      options.access.subject !== null
        ? (options.access.subject as Record<string, unknown>)
        : undefined;
    emit({
      type:
        status === "approved"
          ? "approval_approved"
          : status === "denied"
            ? "approval_denied"
            : "approval_canceled",
      timestamp: Date.now(),
      data: {
        runId,
        approvalId: approval.id,
        kind: approval.kind,
        tool: approval.tool,
        status,
        ...(approval.resolvedAt ? { resolvedAt: approval.resolvedAt } : {}),
        ...(approval.resolutionNote ? { resolutionNote: approval.resolutionNote } : {}),
        ...(resolvedBy ? { resolvedBy } : {}),
      },
    });
  };

  const ensureCanExecute = (runId?: string): void => {
    if (destroyed) {
      throw new Error("Harness has been destroyed");
    }
    const reservedSuspendedSlot =
      runId && suspendedSandboxContexts.has(runId) ? 1 : 0;
    const liveRunCount =
      activeRunIds.size +
      suspendedSandboxContexts.size -
      reservedSuspendedSlot;
    if (liveRunCount >= maxConcurrentRuns) {
      throw new Error(
        `Harness concurrency limit exceeded: ${liveRunCount} live run(s), max ${maxConcurrentRuns}`,
      );
    }
    if (runId && activeRunIds.has(runId)) {
      throw new Error(`Harness run is already active: ${runId}`);
    }
  };

  const trackExecution = async <T>(runId: string, execution: Promise<T>): Promise<T> => {
    activeRunIds.add(runId);
    const waiter = execution.then(
      () => undefined,
      () => undefined,
    );
    activeRunWaiters.set(runId, waiter);

    try {
      return await execution;
    } finally {
      activeRunIds.delete(runId);
      activeRunWaiters.delete(runId);
    }
  };

  const persistGlobalMemoryLifecycleEvent = async (
    runId: string,
    memory: HarnessMemoryRecord,
  ): Promise<void> => {
    emit({
      type: "memory_stored",
      timestamp: Date.now(),
      data: {
        runId,
        memoryId: memory.id,
        kind: memory.kind,
        scope: memory.scope,
      },
    });
    await runtimeStore.transitionRun(
      runId,
      "memory_stored",
      {
        contextUpdatedAt: memory.updatedAt,
      },
      {
        memoryId: memory.id,
        kind: memory.kind,
        scope: memory.scope,
      },
    );
  };

  const persistGlobalCapturedContext = async (
    runId: string,
    context: HarnessRunContextState,
  ): Promise<void> => {
    if (context.summary) {
      emit({
        type: "summary_created",
        timestamp: Date.now(),
        data: {
          runId,
          summaryId: context.summary.id,
          kind: context.summary.kind,
          status: context.summary.status,
        },
      });
      await runtimeStore.transitionRun(
        runId,
        "summary_created",
        {
          contextUpdatedAt: context.sessionMemory.updatedAt,
          latestSummaryId: context.summary.id,
        },
        {
          summaryId: context.summary.id,
          kind: context.summary.kind,
          status: context.summary.status,
        },
      );
    } else {
      await runtimeStore.patchRun(runId, {
        contextUpdatedAt: context.sessionMemory.updatedAt,
      });
    }

    for (const promotedMemory of context.promotedMemories) {
      await persistGlobalMemoryLifecycleEvent(runId, promotedMemory);
    }
  };

  const executeRun = async (params: {
    mode: "start" | "resume";
    runId: string;
    runConfig: AgentRunConfig;
    startOptions?: HarnessRunStartOptions;
    checkpoint?: AgentCheckpoint;
    resumePendingTool?: boolean;
  }): Promise<HarnessRunResult> => {
    const { mode, runId, runConfig, startOptions, checkpoint, resumePendingTool } = params;
    const sandboxDir = resolve(runtimeStore.paths.sandboxesDir, runId);
    const artifactDir = resolve(runtimeStore.paths.artifactsDir, runId);
    const startedAt = new Date().toISOString();

    let runRecord =
      mode === "resume"
        ? await runtimeStore.requireRun(runId)
        : undefined;
    let sandboxContext: HarnessSandboxContext | undefined;
    let retainSandbox = false;
    const taskRuntime = new InMemoryAgentTaskRuntime();

    const patchRun = async (
      patch: Partial<Omit<HarnessRunRecord, "id" | "createdAt">>,
    ): Promise<void> => {
      runRecord = await runtimeStore.patchRun(runId, patch);
    };

    const transitionRun = async (
      type: HarnessRunEventType,
      patch: Partial<Omit<HarnessRunRecord, "id" | "createdAt">>,
      data: Record<string, unknown>,
    ): Promise<void> => {
      runRecord = await runtimeStore.transitionRun(
        runId,
        type,
        patch,
        sanitizeHarnessEventData(data),
      );
    };

    const persistCheckpointContext = async (
      contextUpdate: HarnessCheckpointUpdate,
    ): Promise<void> => {
      if (contextUpdate.compaction) {
        emit({
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
        await transitionRun(
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
      } else {
        await patchRun({
          contextUpdatedAt: contextUpdate.sessionMemory.updatedAt,
        });
      }

      if (contextUpdate.summary) {
        emit({
          type: "summary_created",
          timestamp: Date.now(),
          data: {
            runId,
            summaryId: contextUpdate.summary.id,
            kind: contextUpdate.summary.kind,
            status: contextUpdate.summary.status,
          },
        });
        await transitionRun(
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
        await persistGlobalMemoryLifecycleEvent(runId, promotedMemory);
      }
    };

    try {
      if (mode === "start") {
        runRecord = await runtimeStore.requireRun(runId);
      }

      const suspendedContext = mode === "resume"
        ? suspendedSandboxContexts.get(runId)
        : undefined;
      if (suspendedContext) {
        suspendedSandboxContexts.delete(runId);
        sandboxContext = suspendedContext;
      } else {
        sandboxContext = await driver.createContext(config, {
          runId,
          paths: runtimeStore.paths,
          sandboxDir,
          artifactDir,
        });
      }
      activeSandboxContexts.set(runId, sandboxContext);

      const builtInTools = buildHarnessTools(
        sandboxContext.browser,
        sandboxContext.fs,
        async (input) => {
          const artifact = await runtimeStore.writeArtifact(runId, input);
          await patchRun({
            artifactIds: [...(runRecord?.artifactIds ?? []), artifact.id],
          });
          await transitionRun("artifact_created", {}, {
            artifactId: artifact.id,
            kind: artifact.kind,
            path: artifact.path,
            mimeType: artifact.mimeType,
            size: artifact.size,
            ...(artifact.metadata ? { metadata: artifact.metadata } : {}),
          });
          emit({
            type: input.kind === "screenshot" ? "screenshot" : "artifact_created",
            timestamp: Date.now(),
            data: {
              runId,
              artifactId: artifact.id,
              kind: artifact.kind,
              path: artifact.path,
              size: artifact.size,
            },
          });
          return artifact;
        },
      );

      const allTasks = [...(runConfig.tasks ?? [])];
      // Wrap tasks as tools so the engine can discover and execute them
      const taskAbortControllers = new Set<AbortController>();
      activeTaskAbortControllers.set(runId, taskAbortControllers);
      // FIFO queues keyed by task name — serial beforeToolCall pushes, ordered execute shifts
      const pendingTaskQueue = new Map<string, Array<{ taskId: string; requestId: string }>>();
      const taskAbortQueue = new Map<string, AbortController[]>();
      const taskTools = allTasks.map((task) => ({
        name: task.name,
        description: task.description,
        parameters: task.parameters,
        isConcurrencySafe: task.isConcurrencySafe,
        failureMode: task.failureMode,
        async execute(args: Record<string, unknown>): Promise<unknown> {
          // Shift AC from queue (ownership transfers here); peek pending (afterToolCall consumes it)
          const ac = taskAbortQueue.get(task.name)?.shift() ?? new AbortController();
          taskAbortControllers.add(ac);
          const pending = pendingTaskQueue.get(task.name)?.[0];
          const shouldAbort = requestedControls.get(runId) === "cancel";
          const ctx = {
            signal: ac.signal,
            runId,
            requestId: pending?.requestId ?? `taskreq_${randomUUID()}`,
            taskId: pending?.taskId ?? `task_${randomUUID()}`,
            order: 0,
          };
          try {
            if (shouldAbort) {
              const executePromise = task.execute(args, ctx);
              queueMicrotask(() => ac.abort());
              return await executePromise;
            }
            return await task.execute(args, ctx);
          } finally {
            taskAbortControllers.delete(ac);
          }
        },
      }));
      const allTools = [...builtInTools, ...(runConfig.tools ?? []), ...taskTools];
      const taskNameSet = new Set(allTasks.map((t) => t.name));

      if (mode === "start" || mode === "resume") {
        await patchRun({
          toolNames: allTools.map((tool) => tool.name),
          taskNames: allTasks.map((task) => task.name),
          sandbox: {
            driver: driver.name,
            mode: sandboxContext.mode,
            browser: Boolean(sandboxContext.browser),
            fs: Boolean(sandboxContext.fs),
            artifactDir: sandboxContext.artifactDir,
            ...(sandboxContext.workspaceDir
              ? { workspaceDir: sandboxContext.workspaceDir }
              : {}),
          },
        });
      }

      observer.markStart();
      emit({
        type: "loop_start",
        timestamp: Date.now(),
        data: {
          runId,
          goal: runConfig.goal,
          mode,
          ...(startOptions?.trigger ? { trigger: startOptions.trigger } : {}),
          ...(startOptions?.metadata ? { metadata: startOptions.metadata } : {}),
        },
      });

      if (mode === "start") {
        await transitionRun("run_started", {}, {
          goal: runConfig.goal,
          maxIterations: runRecord?.maxIterations,
          toolNames: allTools.map((tool) => tool.name),
          taskNames: allTasks.map((task) => task.name),
          sandbox: runRecord?.sandbox,
          ...(startOptions?.trigger ? { trigger: startOptions.trigger } : {}),
          ...(startOptions?.metadata ? { metadata: startOptions.metadata } : {}),
        });
        emit({
          type: "run_started",
          timestamp: Date.now(),
          data: {
            runId,
            sandbox: runRecord?.sandbox ?? null,
            ...(startOptions?.trigger ? { trigger: startOptions.trigger } : {}),
            ...(startOptions?.metadata ? { metadata: startOptions.metadata } : {}),
          },
        });
      } else {
        await transitionRun(
          "run_resumed",
          {
            status: "running",
            pendingApproval: undefined,
            error: undefined,
            result: undefined,
            control: undefined,
          },
          {
            resumedAt: new Date().toISOString(),
            previousStatus: runRecord?.status,
          },
        );
        emit({
          type: "run_resumed",
          timestamp: Date.now(),
          data: { runId },
        });
      }

      // Replay the pending tool when resuming from an approval_required checkpoint
      let effectiveCheckpoint = checkpoint;
      if (
        resumePendingTool &&
        effectiveCheckpoint?.pendingApproval &&
        effectiveCheckpoint.pendingApproval.kind === "tool"
      ) {
        const pendingTool = allTools.find(
          (t) => t.name === effectiveCheckpoint!.pendingApproval!.tool,
        );
        if (pendingTool) {
          // Re-read run to allow gated stores to intercept (e.g. for cancellation)
          await runtimeStore.requireRun(runId);
          // Check if cancel was requested before executing the approved tool
          if (requestedControls.get(runId) === "cancel") {
            effectiveCheckpoint = {
              ...effectiveCheckpoint,
              pendingApproval: undefined,
            };
          } else {
            const toolArgs = (effectiveCheckpoint.pendingApproval.args ?? {}) as Record<string, unknown>;
            let toolResult: unknown;
            let toolStatus: "success" | "error" = "success";
            try {
              toolResult = await pendingTool.execute(toolArgs);
            } catch (toolError) {
              toolStatus = "error";
              toolResult = { error: toolError instanceof Error ? toolError.message : String(toolError) };
            }

            emit({
              type: "tool_call",
              timestamp: Date.now(),
              data: { runId, tool: pendingTool.name, args: toolArgs },
            });
            await transitionRun("tool_call", {}, { tool: pendingTool.name, args: toolArgs });

            emit({
              type: "tool_result",
              timestamp: Date.now(),
              data: { runId, tool: pendingTool.name, result: summarizeHarnessResult(toolResult) },
            });
            await transitionRun("tool_result", {}, {
              tool: pendingTool.name,
              args: toolArgs,
              result: summarizeHarnessResult(toolResult),
            });

            // Inject the tool result into checkpoint messages
            effectiveCheckpoint = {
              ...effectiveCheckpoint,
              messages: [
                ...effectiveCheckpoint.messages,
                {
                  role: "user" as const,
                  content: `Tool "${pendingTool.name}" returned:\n${JSON.stringify(toolResult, null, 2)}`,
                },
              ],
              toolCalls: [
                ...effectiveCheckpoint.toolCalls,
                {
                  tool: pendingTool.name,
                  args: toolArgs,
                  result: toolResult,
                  requestId: `approved_${randomUUID()}`,
                  order: 0,
                  status: toolStatus,
                },
              ],
              pendingApproval: undefined,
            };
          }
        }
      } else if (
        resumePendingTool &&
        effectiveCheckpoint?.pendingApproval &&
        effectiveCheckpoint.pendingApproval.kind === "task"
      ) {
        const pendingTask = allTasks.find(
          (t) => t.name === effectiveCheckpoint!.pendingApproval!.tool,
        );
        if (pendingTask) {
          const taskArgs = (effectiveCheckpoint.pendingApproval.args ?? {}) as Record<string, unknown>;
          let taskResult: unknown;
          let taskStatus: "success" | "error" = "success";
          try {
            taskResult = await pendingTask.execute(taskArgs, {
              signal: AbortSignal.timeout(300_000),
              runId,
              requestId: `taskreq_${randomUUID()}`,
              taskId: `task_${randomUUID()}`,
              order: 0,
            });
          } catch (taskError) {
            taskStatus = "error";
            taskResult = { error: taskError instanceof Error ? taskError.message : String(taskError) };
          }

          emit({
            type: "task_call",
            timestamp: Date.now(),
            data: { runId, task: pendingTask.name, args: taskArgs },
          });
          await transitionRun("task_call", {}, { task: pendingTask.name, args: taskArgs });

          emit({
            type: "task_result",
            timestamp: Date.now(),
            data: { runId, task: pendingTask.name, result: summarizeHarnessResult(taskResult) },
          });
          await transitionRun("task_result", {
            taskCalls: (runRecord?.taskCalls ?? 0) + 1,
          }, {
            task: pendingTask.name,
            args: taskArgs,
            result: summarizeHarnessResult(taskResult),
          });

          effectiveCheckpoint = {
            ...effectiveCheckpoint,
            messages: [
              ...effectiveCheckpoint.messages,
              {
                role: "user" as const,
                content: `Task "${pendingTask.name}" returned:\n${JSON.stringify(taskResult, null, 2)}`,
              },
            ],
            taskCalls: [
              ...effectiveCheckpoint.taskCalls,
              {
                task: pendingTask.name,
                args: taskArgs,
                result: taskResult,
              },
            ],
            pendingApproval: undefined,
          };
        }
      }

      const result = await runSmartLoop(
        {
          llm: config.llm,
          tools: allTools,
          maxIterations: runConfig.maxIterations,
          ...(runConfig.systemPrompt != null
            ? { prompt: { base: runConfig.systemPrompt } }
            : {}),
          hooks: {
            beforeToolCall: async (tool, args) => {
              // Check if this tool is actually a wrapped task
              const isTask = allTasks.some((t) => t.name === tool);
              if (isTask) {
                emit({
                  type: "task_call",
                  timestamp: Date.now(),
                  data: { runId, task: tool, args },
                });
                await transitionRun("task_call", {}, { task: tool, args });

                if (config.runtime?.beforeTaskCall) {
                  const decision = await config.runtime.beforeTaskCall({
                    runId,
                    task: tool,
                    args,
                  });
                  if (!decision.allowed) {
                    return {
                      allowed: false,
                      reason: decision.reason ?? `Task "${tool}" requires approval`,
                    };
                  }
                }

                // Pre-create AbortController so concurrent siblings can abort it
                const ac = new AbortController();
                taskAbortControllers.add(ac);
                if (!taskAbortQueue.has(tool)) taskAbortQueue.set(tool, []);
                taskAbortQueue.get(tool)!.push(ac);

                // Pre-submission bookkeeping: persist task record before execution
                const taskId = `task_${randomUUID()}`;
                const requestId = `taskreq_${randomUUID()}`;
                const now = new Date().toISOString();
                const taskDef = allTasks.find((t) => t.name === tool);
                try {
                  await runtimeStore.persistTask({
                    id: taskId,
                    runId,
                    requestId,
                    name: tool,
                    kind: taskDef?.kind ?? "workflow",
                    order: 0,
                    status: "running",
                    createdAt: now,
                    updatedAt: now,
                    args: args as Record<string, unknown>,
                    hardFailure: false,
                  });
                  await patchRun({
                    taskIds: [...(runRecord?.taskIds ?? []), taskId],
                  });
                  if (!pendingTaskQueue.has(tool)) pendingTaskQueue.set(tool, []);
                  pendingTaskQueue.get(tool)!.push({ taskId, requestId });
                } catch (err) {
                  // Abort all running sibling tasks
                  for (const ctrl of taskAbortControllers) {
                    ctrl.abort(new Error(`Task batch submission failed: ${err instanceof Error ? err.message : String(err)}`));
                  }
                  throw err;
                }

                return { allowed: true };
              }

              emit({
                type: "tool_call",
                timestamp: Date.now(),
                data: { runId, tool, args },
              });
              await transitionRun("tool_call", {}, { tool, args });

              if (config.runtime?.beforeToolCall) {
                const decision = await config.runtime.beforeToolCall({
                  runId,
                  tool,
                  args,
                });
                if (!decision.allowed) {
                  return {
                    allowed: false,
                    reason: decision.reason ?? `Tool "${tool}" requires approval`,
                  };
                }
              }

              return { allowed: true };
            },
            beforeTaskCall: async (task, args) => {
              emit({
                type: "task_call",
                timestamp: Date.now(),
                data: { runId, task, args },
              });
              await transitionRun("task_call", {}, { task, args });

              if (config.runtime?.beforeTaskCall) {
                const decision = await config.runtime.beforeTaskCall({
                  runId,
                  task,
                  args,
                });
                if (!decision.allowed) {
                  return {
                    allowed: false,
                    reason: decision.reason ?? `Task "${task}" requires approval`,
                  };
                }
              }

              return { allowed: true };
            },
            afterTaskCall: async (task, args, taskResult) => {
              emit({
                type: "task_result",
                timestamp: Date.now(),
                data: { runId, task, result: summarizeHarnessResult(taskResult) },
              });
              await transitionRun("task_result", {
                taskCalls: (runRecord?.taskCalls ?? 0) + 1,
              }, {
                task,
                args,
                result: summarizeHarnessResult(taskResult),
              });
            },
            afterToolCall: async (tool, args, toolResult) => {
              // Check if this tool is actually a wrapped task
              const isTaskCall = allTasks.some((t) => t.name === tool);
              if (isTaskCall) {
                const pending = pendingTaskQueue.get(tool)?.shift();
                if (pending) {
                  const isError = toolResult != null && typeof toolResult === "object" && "error" in (toolResult as Record<string, unknown>);
                  const isCanceled = (requestedControls.get(runId) === "cancel" || (isError && String((toolResult as Record<string, unknown>).error).includes("Task batch submission failed")));
                  const taskStatus = isCanceled ? "canceled" : isError ? "failed" : "completed";
                  const taskDef = allTasks.find((t) => t.name === tool);
                  const now = new Date().toISOString();

                  // Primary write — update the running record with final status/result
                  await runtimeStore.persistTask({
                    id: pending.taskId,
                    runId,
                    requestId: pending.requestId,
                    name: tool,
                    kind: taskDef?.kind ?? "workflow",
                    order: 0,
                    status: taskStatus,
                    createdAt: now,
                    updatedAt: now,
                    args: args as Record<string, unknown>,
                    result: toolResult,
                    ...(isError ? { error: String((toolResult as Record<string, unknown>).error) } : {}),
                    hardFailure: false,
                  });

                  // Settlement bookkeeping — independent step that can fail separately
                  try {
                    await runtimeStore.patchTask(runId, pending.taskId, {
                      status: taskStatus,
                      result: toolResult,
                      updatedAt: now,
                      ...(isError ? { error: String((toolResult as Record<string, unknown>).error) } : {}),
                    });
                  } catch (err) {
                    throw new Error(`Task "${tool}" settlement bookkeeping failed: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }

                emit({
                  type: "task_result",
                  timestamp: Date.now(),
                  data: { runId, task: tool, result: summarizeHarnessResult(toolResult) },
                });
                await transitionRun("task_result", {
                  taskCalls: (runRecord?.taskCalls ?? 0) + 1,
                }, {
                  task: tool,
                  args,
                  result: summarizeHarnessResult(toolResult),
                });
                return;
              }

              emit({
                type: "tool_result",
                timestamp: Date.now(),
                data: { runId, tool, result: summarizeHarnessResult(toolResult) },
              });
              await transitionRun("tool_result", {}, {
                tool,
                args,
                result: summarizeHarnessResult(toolResult),
              });

              const storedObservation = await contextKernel.recordObservation({
                runId,
                tool,
                args,
                result: toolResult,
              });
              if (storedObservation) {
                await persistGlobalMemoryLifecycleEvent(runId, storedObservation);
              }

              if (verifier) {
                const action: HarnessAction = {
                  tool,
                  args,
                  timestamp: Date.now(),
                };

                const verification = await verifier.verify(action, toolResult);

                if (verification.passed) {
                  emit({
                    type: "verify_pass",
                    timestamp: Date.now(),
                    data: {
                      runId,
                      tool,
                      reason: verification.reason,
                    },
                  });
                  await transitionRun("verify_pass", {}, {
                    tool,
                    reason: verification.reason,
                  });
                } else {
                  emit({
                    type: "verify_fail",
                    timestamp: Date.now(),
                    data: {
                      runId,
                      tool,
                      reason: verification.reason,
                      retry: verification.retry === true,
                    },
                  });
                  await transitionRun("verify_fail", {}, {
                    tool,
                    reason: verification.reason,
                    retry: verification.retry === true,
                  });
                }
              }
            },
            onCheckpoint: async (nextCheckpoint) => {
              const contextUpdate = await contextKernel.handleCheckpoint({
                runId,
                checkpoint: nextCheckpoint,
              });
              await persistCheckpointContext(contextUpdate);

              const checkpointRecord = await runtimeStore.persistCheckpoint(
                runId,
                contextUpdate.checkpoint,
              );
              // Count tool calls excluding wrapped tasks, and preserve task call count
              const checkpointToolCount = contextUpdate.checkpoint.toolCalls.filter(
                (tc) => !taskNameSet.has(tc.tool),
              ).length;
              const checkpointTaskCount = contextUpdate.checkpoint.toolCalls.filter(
                (tc) => taskNameSet.has(tc.tool),
              ).length + (contextUpdate.checkpoint.taskCalls?.length ?? 0);
              await patchRun({
                iterations: contextUpdate.checkpoint.iterations,
                toolCalls: checkpointToolCount,
                taskCalls: checkpointTaskCount,
                checkpointUpdatedAt: checkpointRecord.updatedAt,
              });
              return contextUpdate.checkpoint;
            },
            getControlState: async () => {
              const inMemoryRequest = requestedControls.get(runId);
              if (inMemoryRequest === "cancel") {
                return { action: "cancel" as const };
              }
              if (inMemoryRequest === "pause") {
                return { action: "pause" as const };
              }

              const latestRun = await runtimeStore.requireRun(runId);
              if (latestRun.control?.cancelRequestedAt) {
                return { action: "cancel" };
              }
              if (latestRun.control?.pauseRequestedAt) {
                return { action: "pause" };
              }
              return { action: "continue" };
            },
          },
        },
        runConfig.goal,
        effectiveCheckpoint,
      );

      if (result.status === "approval_required") {
        const requestedAt = new Date().toISOString();
        // Correct the kind for tasks wrapped as tools
        const approvalKind = result.pendingApproval && taskNameSet.has(result.pendingApproval.tool)
          ? "task" as const
          : result.pendingApproval?.kind;
        const pendingApproval = result.pendingApproval
          ? {
              id: `approval_${randomUUID()}`,
              kind: approvalKind ?? result.pendingApproval.kind,
              tool: result.pendingApproval.tool,
              args: result.pendingApproval.args,
              reason: result.pendingApproval.reason,
              requestedAt,
              status: "pending" as const,
            }
          : undefined;
        if (pendingApproval) {
          await runtimeStore.persistApproval({
            ...pendingApproval,
            runId,
            updatedAt: requestedAt,
          });
        }
        await transitionRun(
          "approval_required",
          {
            status: "approval_required",
            iterations: result.iterations,
            taskCalls: runRecord?.taskCalls ?? result.taskCalls.length,
            pendingApprovalId: pendingApproval?.id,
            pendingApproval,
            control: undefined,
          },
          {
            iterations: result.iterations,
            ...(result.pendingApproval
              ? {
                  tool: result.pendingApproval.tool,
                  args: result.pendingApproval.args,
                  reason: result.pendingApproval.reason,
                }
              : {}),
          },
        );
        emit({
          type: "approval_required",
          timestamp: Date.now(),
          data: {
            runId,
            approvalId: pendingApproval?.id ?? null,
            pendingApproval: result.pendingApproval ?? null,
          },
        });
        await persistGlobalCapturedContext(
          runId,
          await contextKernel.captureRunState(runId),
        );
      } else if (result.status === "paused") {
        if (result.checkpoint) {
          await runtimeStore.persistCheckpoint(runId, result.checkpoint);
        }
        await transitionRun(
          "run_paused",
          {
            status: "paused",
            iterations: result.iterations,
            taskCalls: runRecord?.taskCalls ?? result.taskCalls.length,
            control: undefined,
          },
          { iterations: result.iterations },
        );
        emit({
          type: "run_paused",
          timestamp: Date.now(),
          data: { runId, iterations: result.iterations },
        });
        await persistGlobalCapturedContext(
          runId,
          await contextKernel.captureRunState(runId),
        );
      } else if (result.status === "canceled") {
        await transitionRun(
          "run_canceled",
          {
            status: "canceled",
            iterations: result.iterations,
            taskCalls: runRecord?.taskCalls ?? result.taskCalls.length,
            pendingApprovalId: undefined,
            pendingApproval: undefined,
            control: undefined,
          },
          { iterations: result.iterations },
        );
        emit({
          type: "run_canceled",
          timestamp: Date.now(),
          data: { runId, iterations: result.iterations },
        });
        await persistGlobalCapturedContext(
          runId,
          await contextKernel.captureRunState(runId),
        );
      } else if (result.status === "max_iterations") {
        await transitionRun(
          "run_max_iterations",
          {
            status: "max_iterations",
            iterations: result.iterations,
            taskCalls: runRecord?.taskCalls ?? result.taskCalls.length,
            result: sanitizeHarnessEventData({ result: result.result }).result,
            pendingApprovalId: undefined,
            pendingApproval: undefined,
            control: undefined,
          },
          {
            iterations: result.iterations,
            result: summarizeHarnessResult(result.result),
          },
        );
        emit({
          type: "run_max_iterations",
          timestamp: Date.now(),
          data: {
            runId,
            iterations: result.iterations,
          },
        });
        await persistGlobalCapturedContext(
          runId,
          await contextKernel.captureRunState(runId),
        );
      } else if (result.status === "fatal") {
        const fatalError = result.error ?? "Agent loop encountered a fatal error";
        // Persist the checkpoint from the fatal result so context capture can find it
        if (result.checkpoint) {
          await runtimeStore.persistCheckpoint(runId, result.checkpoint);
        }
        await transitionRun(
          "run_failed",
          {
            status: "failed",
            iterations: result.iterations,
            taskCalls: runRecord?.taskCalls ?? result.taskCalls.length,
            error: fatalError,
            pendingApprovalId: undefined,
            pendingApproval: undefined,
            control: undefined,
          },
          {
            iterations: result.iterations,
            error: fatalError,
          },
        );
        emit({
          type: "run_failed",
          timestamp: Date.now(),
          data: { runId, error: fatalError },
        });
        await persistGlobalCapturedContext(
          runId,
          await contextKernel.captureRunState(runId),
        );
        // Mark this run as already failed so the catch block does not duplicate events
        resumableConfigs.delete(runId);
        requestedControls.delete(runId);
        throw new Error(fatalError);
      } else {
        await transitionRun(
          "run_completed",
          {
            status: "completed",
            iterations: result.iterations,
            taskCalls: runRecord?.taskCalls ?? result.taskCalls.length,
            result: sanitizeHarnessEventData({ result: result.result }).result,
            pendingApprovalId: undefined,
            pendingApproval: undefined,
            control: undefined,
          },
          {
            iterations: result.iterations,
            result: summarizeHarnessResult(result.result),
          },
        );
        emit({
          type: "run_completed",
          timestamp: Date.now(),
          data: {
            runId,
            iterations: result.iterations,
          },
        });
        await persistGlobalCapturedContext(
          runId,
          await contextKernel.captureRunState(runId),
        );
      }

      emit({
        type: "loop_end",
        timestamp: Date.now(),
        data: {
          runId,
          status: result.status,
          iterations: result.iterations,
          metrics: observer.getMetrics(),
        },
      });

      if (!isHarnessRunResumable(runRecord?.status)) {
        resumableConfigs.delete(runId);
      } else if (sandboxContext) {
        retainSandbox = true;
        suspendedSandboxContexts.set(runId, sandboxContext);
      }
      requestedControls.delete(runId);

      // Separate task calls from tool calls: tasks wrapped as tools appear in toolCalls
      const actualToolCalls = result.toolCalls.filter((tc) => !taskNameSet.has(tc.tool));
      const extractedTaskCalls = result.toolCalls
        .filter((tc) => taskNameSet.has(tc.tool))
        .map((tc) => ({ task: tc.tool, args: tc.args, result: tc.result, requestId: tc.requestId }));
      const mergedTaskCalls = [...result.taskCalls, ...extractedTaskCalls];

      return {
        ...result,
        toolCalls: actualToolCalls,
        taskCalls: mergedTaskCalls,
        runId,
        runtimeStatus:
          runRecord?.status ?? mapAgentRunStatusToHarnessStatus(result.status),
        artifactIds: runRecord?.artifactIds ?? [],
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const latestRun = await runtimeStore.getRun(runId);

      emit({
        type: "error",
        timestamp: Date.now(),
        data: { runId, error: err.message },
      });

      if (!runRecord && latestRun) {
        runRecord = latestRun;
      }

      if (!runRecord) {
        runRecord = {
          id: runId,
          goal: runConfig.goal,
          status: "failed",
          createdAt: startedAt,
          updatedAt: new Date().toISOString(),
          iterations: checkpoint?.iterations ?? 0,
          toolCalls: checkpoint?.toolCalls.length ?? 0,
          taskCalls: checkpoint?.taskCalls?.length ?? 0,
          maxIterations: runConfig.maxIterations ?? 10,
          toolNames: (runConfig.tools ?? []).map((tool) => tool.name),
          taskNames: (runConfig.tasks ?? []).map((task) => task.name),
          artifactIds: [],
          taskIds: [],
          sandbox: {
            driver: driver.name,
            mode: "initializing",
            browser: Boolean(config.sandbox?.browser),
            fs: Boolean(config.sandbox?.fs),
            artifactDir,
          },
          error: err.message,
          lastEventSequence: 0,
        };
        await runtimeStore.persistRun(runRecord);
      }

      if (latestRun?.control?.cancelRequestedAt) {
        const canceledCheckpoint = await runtimeStore.getCheckpoint(runId);
        await transitionRun(
          "run_canceled",
          {
            status: "canceled",
            iterations: runRecord.iterations,
            pendingApprovalId: undefined,
            pendingApproval: undefined,
            control: undefined,
          },
          {
            error: err.message,
            interrupted: true,
            iterations: runRecord.iterations,
          },
        );
        emit({
          type: "run_canceled",
          timestamp: Date.now(),
          data: { runId, error: err.message },
        });
        await persistGlobalCapturedContext(
          runId,
          await contextKernel.captureRunState(runId),
        );

        resumableConfigs.delete(runId);
        requestedControls.delete(runId);
        return {
          result: null,
          iterations: runRecord.iterations,
          toolCalls: canceledCheckpoint?.checkpoint.toolCalls ?? checkpoint?.toolCalls ?? [],
          taskCalls: canceledCheckpoint?.checkpoint.taskCalls ?? checkpoint?.taskCalls ?? [],
          status: "canceled",
          checkpoint: canceledCheckpoint?.checkpoint ?? checkpoint,
          runId,
          runtimeStatus: "canceled",
          artifactIds: runRecord.artifactIds,
        };
      }

      // Only emit run_failed if the run hasn't already been marked as failed
      // (e.g. by the "fatal" result handler above)
      const alreadyFailed = runRecord?.status === "failed" || latestRun?.status === "failed";
      if (!alreadyFailed) {
        await transitionRun(
          "run_failed",
          {
            status: "failed",
            error: err.message,
            pendingApprovalId: undefined,
            pendingApproval: undefined,
            control: undefined,
          },
          {
            error: err.message,
            iterations: runRecord.iterations,
          },
        );
        emit({
          type: "run_failed",
          timestamp: Date.now(),
          data: {
            runId,
            error: err.message,
          },
        });
        await persistGlobalCapturedContext(
          runId,
          await contextKernel.captureRunState(runId),
        );
      }

      resumableConfigs.delete(runId);
      requestedControls.delete(runId);
      throw err;
    } finally {
      await taskRuntime.destroy().catch(() => {
        // Best-effort cleanup for in-flight tasks.
      });
      activeTaskAbortControllers.delete(runId);
      activeSandboxContexts.delete(runId);
      if (!retainSandbox) {
        suspendedSandboxContexts.delete(runId);
        await sandboxContext?.destroy().catch(() => {
          // Best-effort cleanup.
        });
      }
    }
  };

  const buildInitialRunRecord = (
    runId: string,
    runConfig: AgentRunConfig,
    startOptions?: HarnessRunStartOptions,
  ): HarnessRunRecord => ({
    id: runId,
    goal: runConfig.goal,
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    iterations: 0,
    toolCalls: 0,
    taskCalls: 0,
    maxIterations: runConfig.maxIterations ?? 10,
    toolNames: (runConfig.tools ?? []).map((tool) => tool.name),
    taskNames: (runConfig.tasks ?? []).map((task) => task.name),
    artifactIds: [],
    taskIds: [],
    sandbox: {
      driver: driver.name,
      mode: "initializing",
      browser: Boolean(config.sandbox?.browser),
      fs: Boolean(config.sandbox?.fs),
      artifactDir: resolve(runtimeStore.paths.artifactsDir, runId),
    },
    ...(startOptions?.trigger ? { trigger: startOptions.trigger } : {}),
    ...(startOptions?.metadata ? { metadata: startOptions.metadata } : {}),
    lastEventSequence: 0,
  });

  const beginRun = async (
    runConfig: AgentRunConfig,
    startOptions?: HarnessRunStartOptions,
  ): Promise<{ runId: string; result: Promise<HarnessRunResult> }> => {
    await assertHarnessAuthorized(
      authorize,
      buildAuthorizationRequest({
        action: "run:start",
        ...(startOptions?.access ? { access: startOptions.access } : {}),
        detail: {
          goal: runConfig.goal,
          toolNames: (runConfig.tools ?? []).map((tool) => tool.name),
          taskNames: (runConfig.tasks ?? []).map((task) => task.name),
          ...(startOptions?.trigger?.type ? { triggerType: startOptions.trigger.type } : {}),
        },
      }),
    );
    ensureCanExecute();
    const runId = `harness-run-${randomUUID()}`;
    activeRunIds.add(runId);
    resumableConfigs.set(runId, runConfig);
    try {
      await runtimeStore.persistRun(
        buildInitialRunRecord(runId, runConfig, startOptions),
      );
      return {
        runId,
        result: trackExecution(
          runId,
          executeRun({
            mode: "start",
            runId,
            runConfig,
            ...(startOptions ? { startOptions } : {}),
          }),
        ),
      };
    } catch (error) {
      activeRunIds.delete(runId);
      resumableConfigs.delete(runId);
      throw error;
    }
  };

  return {
    async startRun(runConfig: AgentRunConfig, options?: HarnessRunStartOptions) {
      return beginRun(runConfig, options);
    },

    async run(
      runConfig: AgentRunConfig,
      options?: HarnessRunStartOptions,
    ): Promise<HarnessRunResult> {
      const started = await beginRun(runConfig, options);
      return started.result;
    },

    async pauseRun(runId: string, access) {
      const run = await runtimeStore.requireRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "run:pause",
          runId,
          run,
          ...(access ? { access } : {}),
        }),
      );
      return runtimeStore.requestPause(runId).then((nextRun) => {
        if (activeRunIds.has(runId) && nextRun.status === "pause_requested") {
          requestedControls.set(runId, "pause");
        }
        return nextRun;
      });
    },

    async cancelRun(runId: string, access): Promise<HarnessRunRecord> {
      const authorizedRun = await runtimeStore.requireRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "run:cancel",
          runId,
          run: authorizedRun,
          ...(access ? { access } : {}),
        }),
      );
      if (authorizedRun.status === "approval_required" && authorizedRun.pendingApproval) {
        const { approval } = await requirePendingApproval(runId);
        if (approval.status === "pending") {
          const resolved = await resolveRunApproval(runtimeStore, authorizedRun, "canceled", {
            ...(access ? { access } : {}),
          });
          if (resolved.changed) {
            emitApprovalResolution("canceled", runId, resolved.approval, {
              ...(access ? { access } : {}),
            });
          }
        }
      }
      const run = await runtimeStore.requestCancel(runId);
      if (activeRunIds.has(runId) && run.status === "cancel_requested") {
        requestedControls.set(runId, "cancel");
      }
      await activeSandboxContexts.get(runId)?.abort?.().catch(() => {
        // Best-effort interruption for active runs.
      });
      // Abort any in-flight task controllers
      const runTaskControllers = activeTaskAbortControllers.get(runId);
      if (runTaskControllers) {
        for (const ac of runTaskControllers) {
          ac.abort();
        }
      }
      if (run.status === "canceled") {
        await persistGlobalCapturedContext(
          runId,
          await contextKernel.captureRunState(runId),
        );
        const suspendedContext = suspendedSandboxContexts.get(runId);
        suspendedSandboxContexts.delete(runId);
        await suspendedContext?.destroy().catch(() => {
          // Best-effort cleanup for paused/blocked sandboxes.
        });
      }
      if (run.status === "canceled") {
        resumableConfigs.delete(runId);
        requestedControls.delete(runId);
      }
      return run;
    },

    async getApproval(approvalId: string, access) {
      const approval = await runtimeStore.getApproval(approvalId);
      if (!approval) {
        return undefined;
      }
      const run = await runtimeStore.getRun(approval.runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "approval:read",
          runId: approval.runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
          detail: buildApprovalDetail(approval),
        }),
      );
      return approval;
    },

    async listApprovals(runId?: string, access?) {
      if (runId) {
        const run = await runtimeStore.getRun(runId);
        await assertHarnessAuthorized(
          authorize,
          buildAuthorizationRequest({
            action: "approval:list",
            runId,
            ...(run ? { run } : {}),
            ...(access ? { access } : {}),
          }),
        );
        const approvals = await runtimeStore.listApprovals(runId);
        return filterHarnessAuthorizedItems(approvals, authorize, access, (approval) =>
          buildAuthorizationRequest({
            action: "approval:read",
            runId: approval.runId,
            ...(run ? { run } : {}),
            detail: buildApprovalDetail(approval),
          }),
        );
      }
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "approval:list",
          ...(access ? { access } : {}),
        }),
      );
      const approvals = await runtimeStore.listApprovals();
      return filterHarnessAuthorizedItems(approvals, authorize, access, async (approval) => {
        const run = await runtimeStore.getRun(approval.runId);
        return buildAuthorizationRequest({
          action: "approval:read",
          runId: approval.runId,
          ...(run ? { run } : {}),
          detail: buildApprovalDetail(approval),
        });
      });
    },

    async approveRun(runId: string, options?: HarnessApprovalResolutionOptions) {
      const { run, approval } = await requirePendingApproval(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "approval:approve",
          runId,
          run,
          ...(options?.access ? { access: options.access } : {}),
          detail: buildApprovalDetail(approval),
        }),
      );
      const resolved = await resolveRunApproval(runtimeStore, run, "approved", options);
      if (resolved.changed) {
        emitApprovalResolution("approved", runId, resolved.approval, options);
      }
      return resolved.approval;
    },

    async denyRun(runId: string, options?: HarnessApprovalResolutionOptions) {
      const { run, approval } = await requirePendingApproval(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "approval:deny",
          runId,
          run,
          ...(options?.access ? { access: options.access } : {}),
          detail: buildApprovalDetail(approval),
        }),
      );
      const resolved = await resolveRunApproval(runtimeStore, run, "denied", options);
      if (resolved.changed) {
        emitApprovalResolution("denied", runId, resolved.approval, options);
      }
      const canceledRun = await runtimeStore.requestCancel(runId);
      if (activeRunIds.has(runId) && canceledRun.status === "cancel_requested") {
        requestedControls.set(runId, "cancel");
      }
      await activeSandboxContexts.get(runId)?.abort?.().catch(() => {
        // Best-effort interruption for active runs.
      });
      if (canceledRun.status === "canceled") {
        await persistGlobalCapturedContext(
          runId,
          await contextKernel.captureRunState(runId),
        );
        const suspendedContext = suspendedSandboxContexts.get(runId);
        suspendedSandboxContexts.delete(runId);
        await suspendedContext?.destroy().catch(() => {
          // Best-effort cleanup for paused/blocked sandboxes.
        });
        resumableConfigs.delete(runId);
        requestedControls.delete(runId);
      }
      return resolved.approval;
    },

    async resumeRun(
      runId: string,
      options?: HarnessResumeOptions,
    ): Promise<HarnessRunResult> {
      ensureCanExecute(runId);

      let runRecord = await runtimeStore.requireRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "run:resume",
          runId,
          run: runRecord,
          ...(options?.access ? { access: options.access } : {}),
        }),
      );
      if (runRecord.status !== "paused" && runRecord.status !== "approval_required") {
        throw new Error(`Harness run ${runId} is not resumable from status ${runRecord.status}`);
      }

      let approval: HarnessApprovalRecord | undefined;
      if (runRecord.status === "approval_required" && runRecord.pendingApproval) {
        const ensured = await ensureRunApprovalRecord(runtimeStore, runRecord);
        runRecord = ensured.run;
        approval = ensured.approval;
      }

      if (
        runRecord.status === "approval_required" &&
        approval?.status === "pending" &&
        options?.approvePendingTool === true
      ) {
        await assertHarnessAuthorized(
          authorize,
          buildAuthorizationRequest({
            action: "approval:approve",
            runId,
            run: runRecord,
            ...(options?.access ? { access: options.access } : {}),
            detail: buildApprovalDetail(approval),
          }),
        );
        const resolved = await resolveRunApproval(runtimeStore, runRecord, "approved", {
          ...(options?.access ? { access: options.access } : {}),
        });
        runRecord = resolved.run;
        approval = resolved.approval;
        if (resolved.changed) {
          emitApprovalResolution("approved", runId, resolved.approval, {
            ...(options?.access ? { access: options.access } : {}),
          });
        }
      }

      if (runRecord.status === "approval_required" && approval?.status === "denied") {
        throw new Error(
          `Harness run ${runId} cannot resume because approval ${approval.id} was denied`,
        );
      }

      if (runRecord.status === "approval_required" && approval?.status === "canceled") {
        throw new Error(
          `Harness run ${runId} cannot resume because approval ${approval.id} was canceled`,
        );
      }

      if (
        runRecord.status === "approval_required" &&
        approval?.status !== "approved" &&
        options?.approvePendingTool !== true
      ) {
        throw new Error(
          `Harness run ${runId} requires an approved pending approval or approvePendingTool=true before it can resume`,
        );
      }

      const checkpointRecord = await runtimeStore.getCheckpoint(runId);
      if (!checkpointRecord) {
        throw new Error(`Harness run ${runId} has no checkpoint to resume from`);
      }
      assertValidAgentCheckpoint(
        checkpointRecord.checkpoint,
        `Harness run ${runId} checkpoint`,
      );

      const runConfig = options?.runConfig ?? resumableConfigs.get(runId);
      if (!runConfig) {
        throw new Error(
          `Harness run ${runId} requires runConfig to resume because no in-memory definition is available`,
        );
      }

      if (runConfig.goal !== runRecord.goal) {
        throw new Error(
          `Harness run ${runId} resume goal mismatch: expected "${runRecord.goal}"`,
        );
      }

      resumableConfigs.set(runId, runConfig);
      return trackExecution(
        runId,
        executeRun({
          mode: "resume",
          runId,
          runConfig,
          checkpoint: checkpointRecord.checkpoint,
          resumePendingTool:
            options?.approvePendingTool === true || approval?.status === "approved",
        }),
      );
    },

    async getRun(runId: string, access) {
      const run = await runtimeStore.getRun(runId);
      if (!run) {
        return undefined;
      }
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "run:read",
          runId,
          run,
          ...(access ? { access } : {}),
        }),
      );
      return run;
    },

    async getCheckpoint(runId: string, access) {
      const checkpoint = await runtimeStore.getCheckpoint(runId);
      if (!checkpoint) {
        return undefined;
      }
      const run = await runtimeStore.getRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "checkpoint:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
        }),
      );
      return checkpoint.checkpoint;
    },

    async getSessionMemory(runId: string, access) {
      const sessionMemory = await contextKernel.getSessionMemory(runId);
      if (!sessionMemory) {
        return undefined;
      }
      const run = await runtimeStore.getRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "memory:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
          detail: {
            kind: "session_memory",
          },
        }),
      );
      return sessionMemory;
    },

    async getLatestSummary(runId: string, access) {
      const summary = await contextKernel.getLatestSummary(runId);
      if (!summary) {
        return undefined;
      }
      const run = await runtimeStore.getRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "summary:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
        }),
      );
      return summary;
    },

    async listSummaries(runId?: string, access?) {
      if (runId) {
        const run = await runtimeStore.getRun(runId);
        await assertHarnessAuthorized(
          authorize,
          buildAuthorizationRequest({
            action: "summary:read",
            runId,
            ...(run ? { run } : {}),
            ...(access ? { access } : {}),
          }),
        );
        return contextKernel.listSummaries(runId);
      }
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "summary:list",
          ...(access ? { access } : {}),
        }),
      );
      const summaries = await contextKernel.listSummaries();
      return filterHarnessAuthorizedItems(summaries, authorize, access, (summary) =>
        buildAuthorizationRequest({
          action: "summary:read",
          runId: summary.runId,
        }),
      );
    },

    async rememberMemory(input: HarnessMemoryInput, access) {
      const run = input.runId ? await runtimeStore.getRun(input.runId) : undefined;
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "memory:write",
          ...(input.runId ? { runId: input.runId } : {}),
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
          detail: {
            scope: input.scope,
            ...(input.kind ? { kind: input.kind } : {}),
          },
        }),
      );
      return contextKernel.rememberMemory(input);
    },

    async recallMemory(query: HarnessMemoryQuery, access) {
      const run = query.runId ? await runtimeStore.getRun(query.runId) : undefined;
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "memory:read",
          ...(query.runId ? { runId: query.runId } : {}),
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
          detail: {
            query: query.query,
            ...(query.scopes ? { scopes: query.scopes } : {}),
            ...(query.kinds ? { kinds: query.kinds } : {}),
          },
        }),
      );
      const matches = await contextKernel.recallMemory(query);
      return filterHarnessAuthorizedItems(matches, authorize, access, (match) =>
        buildAuthorizationRequest({
          action: "memory:read",
          ...(match.runId ? { runId: match.runId } : {}),
        }),
      );
    },

    async assembleContext(
      runId: string,
      options?: HarnessContextAssembleOptions,
      access?: { subject?: unknown; metadata?: Record<string, unknown> },
    ) {
      const run = await runtimeStore.getRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "context:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
          ...(options?.query ? { detail: { query: options.query } } : {}),
        }),
      );
      return contextKernel.assembleContext(runId, options);
    },

    async listRuns(access) {
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "run:list",
          ...(access ? { access } : {}),
        }),
      );
      const runs = await runtimeStore.listRuns();
      return filterHarnessAuthorizedItems(runs, authorize, access, (run) =>
        buildAuthorizationRequest({
          action: "run:read",
          runId: run.id,
          run,
        }),
      );
    },

    async getEvents(runId?: string, access?) {
      if (runId) {
        const run = await runtimeStore.getRun(runId);
        await assertHarnessAuthorized(
          authorize,
          buildAuthorizationRequest({
            action: "event:read",
            runId,
            ...(run ? { run } : {}),
            ...(access ? { access } : {}),
          }),
        );
        return runtimeStore.getEvents(runId);
      }
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "event:list",
          ...(access ? { access } : {}),
        }),
      );
      const events = await runtimeStore.getEvents();
      return filterHarnessAuthorizedItems(events, authorize, access, async (event) => {
        const run = await runtimeStore.getRun(event.runId);
        return buildAuthorizationRequest({
          action: "event:read",
          runId: event.runId,
          ...(run ? { run } : {}),
        });
      });
    },

    async getArtifacts(runId: string, access) {
      const run = await runtimeStore.getRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "artifact:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
        }),
      );
      return runtimeStore.getArtifacts(runId);
    },

    async getTasks(runId: string, access) {
      const run = await runtimeStore.getRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "task:read",
          runId,
          ...(run ? { run } : {}),
          ...(access ? { access } : {}),
        }),
      );
      return runtimeStore.getTasks(runId);
    },

    async replayRun(runId: string, access) {
      const run = await runtimeStore.requireRun(runId);
      await assertHarnessAuthorized(
        authorize,
        buildAuthorizationRequest({
          action: "run:replay",
          runId,
          run,
          ...(access ? { access } : {}),
        }),
      );
      return runtimeStore.replayRun(runId);
    },

    getPaths(_access) {
      return runtimeStore.paths;
    },

    async destroy(): Promise<void> {
      destroyed = true;
      for (const runId of activeRunIds) {
        requestedControls.set(runId, "cancel");
      }
      await Promise.all(
        Array.from(activeRunIds, (runId) =>
          runtimeStore.requestCancel(runId).catch(() => undefined),
        ),
      );
      await Promise.all(
        Array.from(activeSandboxContexts.values(), (context) =>
          context.abort?.().catch(() => undefined),
        ),
      );
      await Promise.all(activeRunWaiters.values());
      await Promise.all(
        Array.from(suspendedSandboxContexts.entries(), async ([runId, context]) => {
          suspendedSandboxContexts.delete(runId);
          resumableConfigs.delete(runId);
          await context.destroy().catch(() => undefined);
        }),
      );
    },
  };
}

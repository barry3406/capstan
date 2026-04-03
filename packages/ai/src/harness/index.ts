/**
 * Agent Harness Mode — isolated runtime substrate for browser/filesystem tools.
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type { AgentLoopCheckpoint, AgentRunConfig } from "../types.js";
import type {
  Harness,
  HarnessAction,
  HarnessContextAssembleOptions,
  HarnessConfig,
  HarnessEvent,
  HarnessMemoryRecord,
  HarnessMemoryInput,
  HarnessMemoryQuery,
  HarnessRunRecord,
  HarnessRunEventType,
  HarnessRunResult,
  HarnessResumeOptions,
  HarnessSandboxContext,
  HarnessRuntimeStore,
  HarnessVerifierFn,
} from "./types.js";
import { runAgentLoop } from "../agent-loop.js";
import { HarnessObserver } from "./observe/index.js";
import { FileHarnessRuntimeStore } from "./runtime/store.js";
import { LocalHarnessSandboxDriver } from "./runtime/local-driver.js";
import { assertValidAgentLoopCheckpoint } from "./runtime/checkpoint.js";
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

  const emit = (event: HarnessEvent): void => {
    observer.log(event);
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
    checkpoint?: AgentLoopCheckpoint;
    resumePendingTool?: boolean;
  }): Promise<HarnessRunResult> => {
    const { mode, runId, runConfig, checkpoint, resumePendingTool } = params;
    const sandboxDir = resolve(runtimeStore.paths.sandboxesDir, runId);
    const artifactDir = resolve(runtimeStore.paths.artifactsDir, runId);
    const startedAt = new Date().toISOString();

    let runRecord =
      mode === "resume"
        ? await runtimeStore.requireRun(runId)
        : undefined;
    let sandboxContext: HarnessSandboxContext | undefined;
    let retainSandbox = false;

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

      const allTools = [...builtInTools, ...(runConfig.tools ?? [])];

      if (mode === "start" || mode === "resume") {
        await patchRun({
          toolNames: allTools.map((tool) => tool.name),
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
        data: { runId, goal: runConfig.goal, mode },
      });

      if (mode === "start") {
        await transitionRun("run_started", {}, {
          goal: runConfig.goal,
          maxIterations: runRecord?.maxIterations,
          toolNames: allTools.map((tool) => tool.name),
          sandbox: runRecord?.sandbox,
        });
        emit({
          type: "run_started",
          timestamp: Date.now(),
          data: { runId, sandbox: runRecord?.sandbox ?? null },
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

      const result = await runAgentLoop(config.llm, runConfig, allTools, {
        ...(checkpoint ? { checkpoint } : {}),
        ...(resumePendingTool ? { resumePendingTool } : {}),
        prepareMessages: async (loopCheckpoint) =>
          contextKernel.prepareMessages({
            runId,
            checkpoint: loopCheckpoint,
            query: runConfig.goal,
            ...(runConfig.about
              ? { scopes: [{ type: runConfig.about[0], id: runConfig.about[1] }] }
              : {}),
          }),
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
          await patchRun({
            iterations: contextUpdate.checkpoint.iterations,
            toolCalls: contextUpdate.checkpoint.toolCalls.length,
            checkpointUpdatedAt: checkpointRecord.updatedAt,
          });
          return contextUpdate.checkpoint;
        },
        beforeToolCall: async (tool, args) => {
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
        afterToolCall: async (tool, args, toolResult) => {
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
      });

      if (result.status === "approval_required") {
        await transitionRun(
          "approval_required",
          {
            status: "approval_required",
            iterations: result.iterations,
            pendingApproval: result.pendingApproval
              ? {
                  tool: result.pendingApproval.tool,
                  args: result.pendingApproval.args,
                  reason: result.pendingApproval.reason,
                  requestedAt: new Date().toISOString(),
                }
              : undefined,
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
            pendingApproval: result.pendingApproval ?? null,
          },
        });
        await persistGlobalCapturedContext(
          runId,
          await contextKernel.captureRunState(runId),
        );
      } else if (result.status === "paused") {
        await transitionRun(
          "run_paused",
          {
            status: "paused",
            iterations: result.iterations,
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
            result: sanitizeHarnessEventData({ result: result.result }).result,
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
      } else {
        await transitionRun(
          "run_completed",
          {
            status: "completed",
            iterations: result.iterations,
            result: sanitizeHarnessEventData({ result: result.result }).result,
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

      return {
        ...result,
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
          maxIterations: runConfig.maxIterations ?? 10,
          toolNames: (runConfig.tools ?? []).map((tool) => tool.name),
          artifactIds: [],
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
          status: "canceled",
          checkpoint: canceledCheckpoint?.checkpoint ?? checkpoint,
          runId,
          runtimeStatus: "canceled",
          artifactIds: runRecord.artifactIds,
        };
      }

      await transitionRun(
        "run_failed",
        {
          status: "failed",
          error: err.message,
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

      resumableConfigs.delete(runId);
      requestedControls.delete(runId);
      throw err;
    } finally {
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
  ): HarnessRunRecord => ({
    id: runId,
    goal: runConfig.goal,
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    iterations: 0,
    toolCalls: 0,
    maxIterations: runConfig.maxIterations ?? 10,
    toolNames: (runConfig.tools ?? []).map((tool) => tool.name),
    artifactIds: [],
    sandbox: {
      driver: driver.name,
      mode: "initializing",
      browser: Boolean(config.sandbox?.browser),
      fs: Boolean(config.sandbox?.fs),
      artifactDir: resolve(runtimeStore.paths.artifactsDir, runId),
    },
    lastEventSequence: 0,
  });

  const beginRun = async (runConfig: AgentRunConfig): Promise<{ runId: string; result: Promise<HarnessRunResult> }> => {
    ensureCanExecute();
    const runId = `harness-run-${randomUUID()}`;
    activeRunIds.add(runId);
    resumableConfigs.set(runId, runConfig);
    try {
      await runtimeStore.persistRun(buildInitialRunRecord(runId, runConfig));
      return {
        runId,
        result: trackExecution(
          runId,
          executeRun({
            mode: "start",
            runId,
            runConfig,
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
    async startRun(runConfig: AgentRunConfig) {
      return beginRun(runConfig);
    },

    async run(runConfig: AgentRunConfig): Promise<HarnessRunResult> {
      const started = await beginRun(runConfig);
      return started.result;
    },

    pauseRun(runId: string) {
      return runtimeStore.requestPause(runId).then((run) => {
        if (activeRunIds.has(runId) && run.status === "pause_requested") {
          requestedControls.set(runId, "pause");
        }
        return run;
      });
    },

    async cancelRun(runId: string): Promise<HarnessRunRecord> {
      const run = await runtimeStore.requestCancel(runId);
      if (activeRunIds.has(runId) && run.status === "cancel_requested") {
        requestedControls.set(runId, "cancel");
      }
      await activeSandboxContexts.get(runId)?.abort?.().catch(() => {
        // Best-effort interruption for active runs.
      });
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

    async resumeRun(
      runId: string,
      options?: HarnessResumeOptions,
    ): Promise<HarnessRunResult> {
      ensureCanExecute(runId);

      const runRecord = await runtimeStore.requireRun(runId);
      if (runRecord.status !== "paused" && runRecord.status !== "approval_required") {
        throw new Error(`Harness run ${runId} is not resumable from status ${runRecord.status}`);
      }

      if (runRecord.status === "approval_required" && options?.approvePendingTool !== true) {
        throw new Error(
          `Harness run ${runId} requires approvePendingTool=true before it can resume`,
        );
      }

      const checkpointRecord = await runtimeStore.getCheckpoint(runId);
      if (!checkpointRecord) {
        throw new Error(`Harness run ${runId} has no checkpoint to resume from`);
      }
      assertValidAgentLoopCheckpoint(
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
          resumePendingTool: options?.approvePendingTool === true,
        }),
      );
    },

    getRun(runId: string) {
      return runtimeStore.getRun(runId);
    },

    async getCheckpoint(runId: string) {
      return (await runtimeStore.getCheckpoint(runId))?.checkpoint;
    },

    getSessionMemory(runId: string) {
      return contextKernel.getSessionMemory(runId);
    },

    getLatestSummary(runId: string) {
      return contextKernel.getLatestSummary(runId);
    },

    listSummaries(runId?: string) {
      return contextKernel.listSummaries(runId);
    },

    rememberMemory(input: HarnessMemoryInput) {
      return contextKernel.rememberMemory(input);
    },

    recallMemory(query: HarnessMemoryQuery) {
      return contextKernel.recallMemory(query);
    },

    assembleContext(
      runId: string,
      options?: HarnessContextAssembleOptions,
    ) {
      return contextKernel.assembleContext(runId, options);
    },

    listRuns() {
      return runtimeStore.listRuns();
    },

    getEvents(runId?: string) {
      return runtimeStore.getEvents(runId);
    },

    getArtifacts(runId: string) {
      return runtimeStore.getArtifacts(runId);
    },

    replayRun(runId: string) {
      return runtimeStore.replayRun(runId);
    },

    getPaths() {
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

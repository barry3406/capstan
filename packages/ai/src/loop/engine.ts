import type {
  AgentLoopCheckpoint,
  AgentRunResult,
  AgentTask,
  AgentTool,
  AgentToolCallRecord,
  LLMProvider,
} from "../types.js";
import { InMemoryAgentTaskRuntime } from "../task/runtime.js";
import type { AgentTaskRuntime } from "../task/types.js";
import {
  applyCheckpoint,
  buildCheckpoint,
  checkpointStageForControl,
  cloneMessages,
  createTurnEngineState,
  formatToolResultMessage,
  type PendingTaskExecution,
  type PendingToolExecution,
  type RunAgentLoopOptions,
  type TurnEngineState,
  updatePhase,
} from "./state.js";
import {
  applyContinuation,
  clearContinuation,
  decideContinuation,
  shouldRetryAfterModelError,
} from "./continuation.js";
import { sampleModel } from "./sampler.js";
import { submitTaskRequests, applyTaskNotification } from "./task-orchestrator.js";
import { executeToolRequests } from "./tool-orchestrator.js";

type PendingActionGroup =
  | {
      kind: "tool";
      parallel: boolean;
      requests: PendingToolExecution[];
    }
  | {
      kind: "task";
      parallel: boolean;
      requests: PendingTaskExecution[];
    };

export async function runTurnEngine(
  llm: LLMProvider,
  config: Parameters<typeof createTurnEngineState>[0],
  tools: Parameters<typeof createTurnEngineState>[1],
  opts?: RunAgentLoopOptions,
): Promise<AgentRunResult> {
  const state = createTurnEngineState(config, tools, opts);
  const ownTaskRuntime = opts?.taskRuntime == null;
  const taskRuntime = opts?.taskRuntime ?? new InMemoryAgentTaskRuntime();
  let skipPolicyForFirstPendingTool =
    opts?.resumePendingTool === true && state.pendingToolRequests.length > 0;
  let skipPolicyForFirstPendingTask =
    opts?.resumePendingTool === true && state.pendingTaskRequests.length > 0;

  try {
    const persistCheckpoint = async (
      stage: AgentLoopCheckpoint["stage"],
    ): Promise<AgentLoopCheckpoint> => {
      const checkpoint = buildCheckpoint(state, stage);
      const nextCheckpoint = opts?.onCheckpoint
        ? (await opts.onCheckpoint(checkpoint)) ?? checkpoint
        : checkpoint;
      applyCheckpoint(state, nextCheckpoint);
      return nextCheckpoint;
    };

    const evaluateControl = async (
      phase: "before_llm" | "before_tool" | "after_tool" | "during_task_wait",
    ): Promise<AgentRunResult | undefined> => {
      if (!opts?.getControlState && !opts?.control) {
        return undefined;
      }

      const checkpoint = await persistCheckpoint(checkpointStageForControl(phase, state));
      const decision = opts.getControlState
        ? await opts.getControlState(phase, checkpoint)
        : opts.control
          ? { action: await opts.control.check() }
          : { action: "continue" as const };

      if (decision.action === "pause") {
        updatePhase(state, "paused", "pause_requested");
        const pausedCheckpoint = buildCheckpoint(
          state,
          checkpointStageForControl(phase, state),
        );
        return {
          result: null,
          iterations: state.iterations,
          toolCalls: state.toolCalls,
          taskCalls: state.taskCalls,
          status: "paused",
          checkpoint: pausedCheckpoint,
        };
      }

      if (decision.action === "cancel") {
        updatePhase(state, "canceled", "cancel_requested");
        const canceledCheckpoint = await persistCheckpoint("canceled");
        return {
          result: decision.reason ?? null,
          iterations: state.iterations,
          toolCalls: state.toolCalls,
          taskCalls: state.taskCalls,
          status: "canceled",
          checkpoint: canceledCheckpoint,
        };
      }

      return undefined;
    };

    updatePhase(
      state,
      state.pendingToolRequests.length > 0 || state.pendingTaskRequests.length > 0
        ? "approval_blocked"
        : "initializing",
      state.pendingToolRequests.length > 0 || state.pendingTaskRequests.length > 0
        ? "manual_resume"
        : "initial_turn",
    );
    await persistCheckpoint(checkpointStageForControl("before_llm", state));

    while (
      state.pendingToolRequests.length > 0 ||
      state.pendingTaskRequests.length > 0 ||
      state.iterations < state.maxIterations
    ) {
      if (state.pendingToolRequests.length === 0 && state.pendingTaskRequests.length === 0) {
        const controlled = await evaluateControl("before_llm");
        if (controlled) {
          return controlled;
        }

        updatePhase(state, "preparing_context");
        const loopCheckpoint = buildCheckpoint(state, "initialized");
        let callMessages =
          (await opts?.prepareMessages?.(loopCheckpoint))?.map((message) => ({ ...message })) ??
          cloneMessages(state.messages);
        if (state.orchestration.continuationPrompt) {
          callMessages = [
            ...callMessages,
            {
              role: "user",
              content: state.orchestration.continuationPrompt,
            },
          ];
        }

        updatePhase(state, "sampling_model");
        state.iterations += 1;

        let modelOutcome;
        try {
          modelOutcome = await sampleModel(llm, callMessages);
        } catch (error) {
          if (shouldRetryAfterModelError(state, error)) {
            updatePhase(state, "deciding_continuation", "reactive_compact_retry");
            applyContinuation(state, "reactive_compact_retry");
            await persistCheckpoint("initialized");
            continue;
          }
          throw error;
        }

        state.lastAssistantResponse = modelOutcome.content;
        state.orchestration.lastModelFinishReason = modelOutcome.finishReason;
        state.orchestration.turnCount = state.iterations;

        if (modelOutcome.toolRequests.length > 0) {
          const classified = classifyPendingRequests(
            modelOutcome.toolRequests.map((request) => ({
              ...request,
              args: cloneArgs(request.args),
              assistantMessage: modelOutcome.content,
            })),
            state.availableTasks,
          );
          state.pendingToolRequests = classified.tools;
          state.pendingTaskRequests = classified.tasks;
          state.orchestration.assistantMessagePersisted = false;
          updatePhase(
            state,
            state.pendingToolRequests.length > 0 ? "executing_tools" : "executing_tasks",
            "next_turn",
          );
          clearContinuation(state);
          await persistCheckpoint("assistant_response");
        } else {
          appendAssistantResponse(state, modelOutcome.content);
          const continuation = decideContinuation(state, modelOutcome);
          if (continuation.action === "continue") {
            updatePhase(state, "deciding_continuation", continuation.reason);
            applyContinuation(state, continuation.reason);
            await persistCheckpoint("initialized");
            continue;
          }

          updatePhase(state, "completed", "final_response");
          clearContinuation(state);
          const checkpoint = await persistCheckpoint("completed");
          return {
            result: modelOutcome.content,
            iterations: state.iterations,
            toolCalls: state.toolCalls,
            taskCalls: state.taskCalls,
            status: "completed",
            checkpoint,
          };
        }
      }

      const groups = buildPendingActionGroups(state);
      let haltedByHardFailure = false;

      for (const group of groups) {
        if (group.kind === "tool") {
          const controlled = await evaluateControl("before_tool");
          if (controlled) {
            return controlled;
          }

          updatePhase(state, "executing_tools");
          const execution = await executeToolRequests(
            state,
            group.requests,
            opts,
            skipPolicyForFirstPendingTool,
          );
          skipPolicyForFirstPendingTool = false;
          removePendingToolRequests(state, group.requests, execution.remaining);

          if (execution.records.length > 0) {
            applyToolResults(state, execution.records);
            const postToolControl = await evaluateControl("after_tool");
            if (postToolControl) {
              return postToolControl;
            }
          }

          if (execution.blockedApproval) {
            updatePhase(state, "approval_blocked", "approval_required");
            const checkpoint = await persistCheckpoint("approval_required");
            return {
              result: null,
              iterations: state.iterations,
              toolCalls: state.toolCalls,
              taskCalls: state.taskCalls,
              status: "approval_required",
              pendingApproval: execution.blockedApproval,
              checkpoint,
            };
          }

          if (execution.haltedByHardFailure) {
            haltedByHardFailure = true;
            break;
          }
          continue;
        }

        updatePhase(state, "executing_tasks");
        const submission = await submitTaskRequests(
          state,
          group.requests,
          taskRuntime,
          opts,
          skipPolicyForFirstPendingTask,
        );
        skipPolicyForFirstPendingTask = false;
        if (submission.blockedApproval) {
          updatePhase(state, "approval_blocked", "approval_required");
          const checkpoint = await persistCheckpoint("approval_required");
          return {
            result: null,
            iterations: state.iterations,
            toolCalls: state.toolCalls,
            taskCalls: state.taskCalls,
            status: "approval_required",
            pendingApproval: submission.blockedApproval,
            checkpoint,
          };
        }

        const waitingTaskIds = submission.submitted.records.map((record) => record.id);
        state.orchestration.waitingTaskIds = waitingTaskIds.slice();
        updatePhase(state, "waiting_on_tasks", "task_wait");
        await persistCheckpoint("task_wait");

        const pendingTaskIds = new Set(waitingTaskIds);
        while (pendingTaskIds.size > 0) {
          const controlled = await evaluateTaskWaitControl(
            state,
            taskRuntime,
            opts?.runId ?? "standalone-run",
            Array.from(pendingTaskIds),
            evaluateControl,
          );
          if (controlled) {
            return controlled;
          }

          const notification = await taskRuntime.nextNotification(opts?.runId ?? "standalone-run", {
            timeoutMs: 25,
          });
          if (!notification || !pendingTaskIds.has(notification.taskId)) {
            continue;
          }

          pendingTaskIds.delete(notification.taskId);
          const record = applyTaskNotification(state, notification);
          if (!state.orchestration.assistantMessagePersisted) {
            appendAssistantResponse(state, group.requests[0]?.assistantMessage ?? state.lastAssistantResponse ?? "");
          }
          if (opts?.afterTaskCall) {
            await opts.afterTaskCall(record.task, record.args, record.result);
          }
          if (opts?.onMemoryEvent) {
            await opts.onMemoryEvent(
              `Task ${record.task} called with ${JSON.stringify(record.args)} => ${JSON.stringify(record.result)}`,
            );
          }
          await persistCheckpoint("task_wait");

          if (notification.status === "failed" && notification.hardFailure) {
            haltedByHardFailure = true;
            const stillPending = Array.from(pendingTaskIds);
            if (stillPending.length > 0) {
              await taskRuntime.cancelTasks(
                opts?.runId ?? "standalone-run",
                stillPending,
                `Task ${notification.name} failed hard`,
              );
            }
          }
        }

        state.orchestration.waitingTaskIds = [];
        if (haltedByHardFailure) {
          break;
        }
      }

      if (haltedByHardFailure) {
        state.pendingToolRequests = [];
        state.pendingTaskRequests = [];
        state.orchestration.pendingToolRequests = [];
        state.orchestration.pendingTaskRequests = [];
      } else {
        state.pendingToolRequests = [];
        state.pendingTaskRequests = [];
        state.orchestration.pendingToolRequests = [];
        state.orchestration.pendingTaskRequests = [];
      }
      updatePhase(state, "applying_tool_results", "next_turn");
      clearContinuation(state);
      await persistCheckpoint("tool_result");
    }

    updatePhase(state, "max_iterations", "iteration_limit");
    const checkpoint = await persistCheckpoint("max_iterations");
    return {
      result: state.messages[state.messages.length - 1]?.content ?? null,
      iterations: state.iterations,
      toolCalls: state.toolCalls,
      taskCalls: state.taskCalls,
      status: "max_iterations",
      checkpoint,
    };
  } finally {
    if (ownTaskRuntime) {
      await taskRuntime.destroy();
    }
  }
}

async function evaluateTaskWaitControl(
  state: TurnEngineState,
  taskRuntime: AgentTaskRuntime,
  runId: string,
  waitingTaskIds: string[],
  evaluateControl: (
    phase: "before_llm" | "before_tool" | "after_tool" | "during_task_wait",
  ) => Promise<AgentRunResult | undefined>,
): Promise<AgentRunResult | undefined> {
  const controlled = await evaluateControl("during_task_wait");
  if (!controlled) {
    return undefined;
  }
  await taskRuntime.cancelTasks(
    runId,
    waitingTaskIds,
    controlled.status === "paused" ? "Task wait paused" : "Task wait canceled",
  ).catch(() => undefined);
  return controlled;
}

function appendAssistantResponse(state: TurnEngineState, content: string): void {
  if (!content.trim()) {
    return;
  }
  state.messages.push({ role: "assistant", content });
  state.orchestration.assistantMessagePersisted = true;
}

function applyToolResults(
  state: TurnEngineState,
  records: AgentToolCallRecord[],
): void {
  const assistantMessage = state.pendingToolRequests[0]?.assistantMessage ?? state.lastAssistantResponse;
  if (assistantMessage && !state.orchestration.assistantMessagePersisted) {
    state.messages.push({ role: "assistant", content: assistantMessage });
    state.orchestration.assistantMessagePersisted = true;
  }

  const orderedRecords = records
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  for (const record of orderedRecords) {
    state.toolCalls.push({ ...record });
    state.messages.push({
      role: "user",
      content: formatToolResultMessage(record.tool, record.result),
    });
  }
}

function classifyPendingRequests(
  requests: PendingToolExecution[],
  availableTasks: AgentTask[],
): {
  tools: PendingToolExecution[];
  tasks: PendingTaskExecution[];
} {
  const taskNames = new Set(availableTasks.map((task) => task.name));
  const tools: PendingToolExecution[] = [];
  const tasks: PendingTaskExecution[] = [];

  for (const request of requests) {
    if (taskNames.has(request.name)) {
      tasks.push({
        id: request.id,
        name: request.name,
        args: cloneArgs(request.args),
        order: request.order,
        assistantMessage: request.assistantMessage,
      });
      continue;
    }
    tools.push({
      id: request.id,
      name: request.name,
      args: cloneArgs(request.args),
      order: request.order,
      assistantMessage: request.assistantMessage,
    });
  }

  return { tools, tasks };
}

function buildPendingActionGroups(state: TurnEngineState): PendingActionGroup[] {
  const toolMap = new Map(state.availableTools.map((tool) => [tool.name, tool]));
  const taskMap = new Map(state.availableTasks.map((task) => [task.name, task]));
  const actions = [
    ...state.pendingToolRequests.map((request) => ({ kind: "tool" as const, request })),
    ...state.pendingTaskRequests.map((request) => ({ kind: "task" as const, request })),
  ].sort((left, right) => left.request.order - right.request.order);

  const groups: PendingActionGroup[] = [];
  for (const action of actions) {
    const parallel =
      action.kind === "tool"
        ? toolMap.get(action.request.name)?.isConcurrencySafe === true
        : taskMap.get(action.request.name)?.isConcurrencySafe === true;
    const previous = groups[groups.length - 1];
    if (parallel && previous && previous.kind === action.kind && previous.parallel) {
      previous.requests.push(action.request as never);
      continue;
    }
    groups.push({
      kind: action.kind,
      parallel,
      requests: [action.request] as never,
    });
  }

  return groups;
}

function removePendingToolRequests(
  state: TurnEngineState,
  executed: PendingToolExecution[],
  remainingFromGroup: PendingToolExecution[],
): void {
  const executedIds = new Set(executed.map((request) => request.id));
  const remainingIds = new Set(remainingFromGroup.map((request) => request.id));
  state.pendingToolRequests = state.pendingToolRequests.filter(
    (request) => !executedIds.has(request.id) || remainingIds.has(request.id),
  );
  state.orchestration.pendingToolRequests = state.pendingToolRequests.map((request) => ({
    id: request.id,
    name: request.name,
    args: cloneArgs(request.args),
    order: request.order,
  }));
}

function cloneArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, cloneUnknown(value)]),
  );
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

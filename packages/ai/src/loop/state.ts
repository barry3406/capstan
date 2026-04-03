import type {
  AgentLoopCheckpoint,
  AgentLoopCheckpointStage,
  AgentLoopOptions,
  AgentLoopModelFinishReason,
  AgentLoopOrchestrationState,
  AgentLoopPhase,
  AgentLoopRecoveryState,
  AgentLoopRuntimeState,
  AgentLoopTaskRequest,
  AgentLoopToolRequest,
  AgentLoopTransitionReason,
  AgentRunConfig,
  AgentRunResult,
  AgentTask,
  AgentTaskCallRecord,
  AgentTool,
  LLMMessage,
} from "../types.js";
import type { AgentTaskRuntime } from "../task/types.js";

export interface RunAgentLoopOptions extends AgentLoopOptions {
  runId?: string;
  taskRuntime?: AgentTaskRuntime;
}

export interface PendingToolExecution extends AgentLoopToolRequest {
  assistantMessage: string;
}

export interface PendingTaskExecution extends AgentLoopTaskRequest {
  assistantMessage: string;
}

export interface TurnEngineState {
  maxIterations: number;
  checkpointConfig: AgentLoopCheckpoint["config"];
  availableTools: AgentTool[];
  availableTasks: AgentTask[];
  messages: LLMMessage[];
  toolCalls: AgentRunResult["toolCalls"];
  taskCalls: AgentRunResult["taskCalls"];
  iterations: number;
  pendingToolRequests: PendingToolExecution[];
  pendingTaskRequests: PendingTaskExecution[];
  lastAssistantResponse?: string | undefined;
  orchestration: AgentLoopOrchestrationState;
}

export function createTurnEngineState(
  config: AgentRunConfig,
  tools: AgentTool[],
  opts?: RunAgentLoopOptions,
): TurnEngineState {
  const maxIterations = config.maxIterations ?? 10;
  const callStack = opts?.callStack ?? new Set<string>();
  const availableTools = tools.filter((tool) => !callStack.has(tool.name));
  const availableTasks = (config.tasks ?? []).filter((task) => !callStack.has(task.name));
  const checkpointConfig: AgentLoopCheckpoint["config"] = {
    goal: config.goal,
    maxIterations,
    ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
  };

  const messages = opts?.checkpoint
    ? cloneMessages(opts.checkpoint.messages)
    : buildInitialMessages(config, availableTools, availableTasks);

  const orchestration = normalizeOrchestration(
    opts?.checkpoint?.orchestration,
    opts?.checkpoint?.iterations ?? 0,
    opts?.checkpoint?.pendingToolCall != null,
  );
  const lastAssistantResponse =
    opts?.checkpoint?.lastAssistantResponse ??
    opts?.checkpoint?.pendingToolCall?.assistantMessage;
  const pendingToolRequests = buildPendingToolRequests(
    opts?.checkpoint,
    lastAssistantResponse,
  );
  const pendingTaskRequests = buildPendingTaskRequests(
    opts?.checkpoint,
    lastAssistantResponse,
  );

  return {
    maxIterations,
    checkpointConfig,
    availableTools,
    availableTasks,
    messages,
    toolCalls: opts?.checkpoint
      ? opts.checkpoint.toolCalls.map((call) => ({ ...call }))
      : [],
    taskCalls: opts?.checkpoint
      ? (opts.checkpoint.taskCalls ?? []).map((call) => ({ ...call }))
      : [],
    iterations: opts?.checkpoint?.iterations ?? 0,
    pendingToolRequests,
    pendingTaskRequests,
    ...(lastAssistantResponse ? { lastAssistantResponse } : {}),
    orchestration: {
      ...orchestration,
      pendingToolRequests: pendingToolRequests.map(clonePendingToolRequest),
      pendingTaskRequests: pendingTaskRequests.map(clonePendingTaskRequest),
      assistantMessagePersisted:
        opts?.checkpoint?.orchestration?.assistantMessagePersisted ??
        inferAssistantMessagePersisted(opts?.checkpoint, lastAssistantResponse),
      ...(opts?.resumePendingTool && pendingToolRequests.length > 0
        ? { transitionReason: "manual_resume" as const }
        : {}),
    },
  };
}

export function buildCheckpoint(
  state: TurnEngineState,
  stage: AgentLoopCheckpointStage,
): AgentLoopCheckpoint {
  const pendingToolCall = state.pendingToolRequests[0];
  return {
    stage,
    config: { ...state.checkpointConfig },
    messages: cloneMessages(state.messages),
    iterations: state.iterations,
    toolCalls: state.toolCalls.map((call) => ({ ...call })),
    taskCalls: state.taskCalls.map((call) => ({ ...call })),
    ...(pendingToolCall
      ? {
          pendingToolCall: {
            assistantMessage: pendingToolCall.assistantMessage,
            tool: pendingToolCall.name,
            args: cloneUnknown(pendingToolCall.args) as Record<string, unknown>,
          },
        }
      : {}),
    ...(state.pendingTaskRequests.length > 0
      ? {
          pendingTaskRequests: state.pendingTaskRequests.map((request) => ({
            id: request.id,
            name: request.name,
            args: cloneUnknown(request.args) as Record<string, unknown>,
            order: request.order,
          })),
        }
      : {}),
    ...(state.lastAssistantResponse
      ? { lastAssistantResponse: state.lastAssistantResponse }
      : {}),
    orchestration: {
      phase: state.orchestration.phase,
      transitionReason: state.orchestration.transitionReason,
      turnCount: state.orchestration.turnCount,
      recovery: {
        reactiveCompactRetries: state.orchestration.recovery.reactiveCompactRetries,
        tokenContinuations: state.orchestration.recovery.tokenContinuations,
        toolRecoveryCount: state.orchestration.recovery.toolRecoveryCount,
      },
      ...(state.pendingToolRequests.length > 0
        ? {
            pendingToolRequests: state.pendingToolRequests.map((request) => ({
              id: request.id,
              name: request.name,
              args: cloneUnknown(request.args) as Record<string, unknown>,
              order: request.order,
            })),
          }
        : {}),
      ...(state.pendingTaskRequests.length > 0
        ? {
            pendingTaskRequests: state.pendingTaskRequests.map((request) => ({
              id: request.id,
              name: request.name,
              args: cloneUnknown(request.args) as Record<string, unknown>,
              order: request.order,
            })),
          }
        : {}),
      ...(state.orchestration.waitingTaskIds?.length
        ? {
            waitingTaskIds: state.orchestration.waitingTaskIds.slice(),
          }
        : {}),
      ...(state.orchestration.lastModelFinishReason
        ? {
            lastModelFinishReason: state.orchestration.lastModelFinishReason,
          }
        : {}),
      ...(state.orchestration.continuationPrompt
        ? {
            continuationPrompt: state.orchestration.continuationPrompt,
          }
        : {}),
      ...(state.orchestration.compactHint
        ? { compactHint: state.orchestration.compactHint }
        : {}),
      ...(state.orchestration.assistantMessagePersisted != null
        ? {
            assistantMessagePersisted: state.orchestration.assistantMessagePersisted,
          }
        : {}),
    },
  };
}

export function applyCheckpoint(
  state: TurnEngineState,
  checkpoint: AgentLoopCheckpoint,
): void {
  state.messages = cloneMessages(checkpoint.messages);
  state.iterations = checkpoint.iterations;
  state.toolCalls = checkpoint.toolCalls.map((call) => ({ ...call }));
  state.taskCalls = (checkpoint.taskCalls ?? []).map((call) => ({ ...call }));
  state.lastAssistantResponse = checkpoint.lastAssistantResponse;
  state.pendingToolRequests = buildPendingToolRequests(
    checkpoint,
    checkpoint.lastAssistantResponse ?? checkpoint.pendingToolCall?.assistantMessage,
  );
  state.pendingTaskRequests = buildPendingTaskRequests(
    checkpoint,
    checkpoint.lastAssistantResponse ?? checkpoint.pendingToolCall?.assistantMessage,
  );
  state.orchestration = normalizeOrchestration(
    checkpoint.orchestration,
    checkpoint.iterations,
    checkpoint.pendingToolCall != null || (checkpoint.pendingTaskRequests?.length ?? 0) > 0,
  );
  state.orchestration.pendingToolRequests = state.pendingToolRequests.map(
    clonePendingToolRequest,
  );
  state.orchestration.pendingTaskRequests = state.pendingTaskRequests.map(
    clonePendingTaskRequest,
  );
  state.orchestration.assistantMessagePersisted =
    checkpoint.orchestration?.assistantMessagePersisted ??
    inferAssistantMessagePersisted(checkpoint, checkpoint.lastAssistantResponse);
}

export function cloneMessages(messages: LLMMessage[]): LLMMessage[] {
  return messages.map((message) => ({ ...message }));
}

export function buildInitialMessages(
  config: AgentRunConfig,
  availableTools: AgentTool[],
  availableTasks: AgentTask[] = [],
): LLMMessage[] {
  const messages: LLMMessage[] = [];

  if (config.systemPrompt) {
    messages.push({ role: "system", content: config.systemPrompt });
  } else {
    messages.push({
      role: "system",
      content:
        "You are a helpful agent. Use the available tools to accomplish the user's goal. " +
        "When you have completed the goal, respond with a final summary.\n\n" +
        "Available tools:\n" +
        (availableTools.length > 0
          ? availableTools
              .map((tool) => `- ${tool.name}: ${tool.description}`)
              .join("\n")
          : "- (none)") +
        "\n\nAvailable tasks:\n" +
        (availableTasks.length > 0
          ? availableTasks
              .map(
                (task) =>
                  `- ${task.name}${task.kind ? ` [${task.kind}]` : ""}: ${task.description}`,
              )
              .join("\n")
          : "- (none)") +
        "\n\nTo call tools, respond with JSON in one of these formats:\n" +
        '- {"tool": "<name>", "arguments": { ... }}\n' +
        '- {"tools": [{"tool": "<name>", "arguments": { ... }}]}\n' +
        '- [{"tool": "<name>", "arguments": { ... }}]\n' +
        "The same JSON format may target either a tool or a task by name.\n" +
        "To finish, respond with plain text (no JSON tool or task call).",
    });
  }

  messages.push({ role: "user", content: config.goal });
  return messages;
}

export function updatePhase(
  state: TurnEngineState,
  phase: AgentLoopPhase,
  transitionReason?: AgentLoopTransitionReason,
): void {
  state.orchestration.phase = phase;
  if (transitionReason) {
    state.orchestration.transitionReason = transitionReason;
  }
  state.orchestration.turnCount = state.iterations;
  state.orchestration.pendingToolRequests = state.pendingToolRequests.map(
    clonePendingToolRequest,
  );
  state.orchestration.pendingTaskRequests = state.pendingTaskRequests.map(
    clonePendingTaskRequest,
  );
}

export function checkpointStageForControl(
  phase: "before_llm" | "before_tool" | "after_tool" | "during_task_wait",
  state: TurnEngineState,
): AgentLoopCheckpointStage {
  if (phase === "before_llm") {
    return "initialized";
  }
  if (phase === "during_task_wait") {
    return "task_wait";
  }
  if (phase === "after_tool") {
    return "tool_result";
  }
  return state.orchestration.assistantMessagePersisted ? "tool_result" : "assistant_response";
}

export function formatToolResultMessage(tool: string, result: unknown): string {
  return `Tool "${tool}" returned:\n${JSON.stringify(result, null, 2)}`;
}

export function createAgentLoopRuntimeState(input: {
  config: AgentRunConfig;
  availableTools: AgentTool[];
  checkpoint?: AgentLoopCheckpoint;
  resumePendingTool?: boolean;
}): AgentLoopRuntimeState {
  const messages = input.checkpoint
    ? cloneMessages(input.checkpoint.messages)
    : buildInitialMessages(input.config, input.availableTools, input.config.tasks ?? []);
  const toolCalls = input.checkpoint
    ? input.checkpoint.toolCalls.map((call) => ({ ...call }))
    : [];
  const taskCalls = input.checkpoint
    ? (input.checkpoint.taskCalls ?? []).map((call) => ({ ...call }))
    : [];
  const pendingToolCall = input.checkpoint?.pendingToolCall
    ? {
        assistantMessage: input.checkpoint.pendingToolCall.assistantMessage,
        tool: input.checkpoint.pendingToolCall.tool,
        args: cloneUnknown(
          input.checkpoint.pendingToolCall.args,
        ) as Record<string, unknown>,
      }
    : undefined;

  return {
    messages,
    toolCalls,
    taskCalls,
    iterations: input.checkpoint?.iterations ?? 0,
    ...(pendingToolCall ? { pendingToolCall } : {}),
    skipNextPolicyCheck:
      input.resumePendingTool === true && pendingToolCall != null,
    orchestration: normalizeOrchestration(
      input.checkpoint?.orchestration,
      input.checkpoint?.iterations ?? 0,
      pendingToolCall != null,
    ),
  };
}

export function createAgentLoopCheckpoint(
  state: AgentLoopRuntimeState,
  config: AgentLoopCheckpoint["config"],
  stage: AgentLoopCheckpointStage,
  lastAssistantResponse?: string,
): AgentLoopCheckpoint {
  return {
    stage,
    config: { ...config },
    messages: cloneMessages(state.messages),
    iterations: state.iterations,
    toolCalls: cloneToolCalls(state.toolCalls),
    taskCalls: cloneTaskCalls(state.taskCalls),
    ...(state.pendingToolCall
      ? {
          pendingToolCall: {
            assistantMessage: state.pendingToolCall.assistantMessage,
            tool: state.pendingToolCall.tool,
            args: cloneUnknown(state.pendingToolCall.args) as Record<string, unknown>,
          },
        }
      : {}),
    ...(state.orchestration.pendingTaskRequests
      ? {
          pendingTaskRequests: state.orchestration.pendingTaskRequests.map((request) => ({
            id: request.id,
            name: request.name,
            args: cloneUnknown(request.args) as Record<string, unknown>,
            order: request.order,
          })),
        }
      : {}),
    ...(lastAssistantResponse ? { lastAssistantResponse } : {}),
    orchestration: {
      phase: state.orchestration.phase,
      transitionReason: state.orchestration.transitionReason,
      turnCount: state.orchestration.turnCount,
      recovery: {
        reactiveCompactRetries: state.orchestration.recovery.reactiveCompactRetries,
        tokenContinuations: state.orchestration.recovery.tokenContinuations,
        toolRecoveryCount: state.orchestration.recovery.toolRecoveryCount,
      },
      ...(state.orchestration.pendingToolRequests
        ? {
            pendingToolRequests: state.orchestration.pendingToolRequests.map((request) => ({
              id: request.id,
              name: request.name,
              args: cloneUnknown(request.args) as Record<string, unknown>,
              order: request.order,
            })),
          }
        : {}),
      ...(state.orchestration.lastModelFinishReason
        ? { lastModelFinishReason: state.orchestration.lastModelFinishReason }
        : {}),
      ...(state.orchestration.continuationPrompt
        ? { continuationPrompt: state.orchestration.continuationPrompt }
        : {}),
      ...(state.orchestration.compactHint
        ? { compactHint: state.orchestration.compactHint }
        : {}),
      ...(state.orchestration.assistantMessagePersisted != null
        ? {
            assistantMessagePersisted: state.orchestration.assistantMessagePersisted,
          }
        : {}),
    },
  };
}

export function applyAgentLoopCheckpoint(
  state: AgentLoopRuntimeState,
  checkpoint: AgentLoopCheckpoint,
): void {
  state.messages = cloneMessages(checkpoint.messages);
  state.toolCalls = cloneToolCalls(checkpoint.toolCalls);
  state.taskCalls = cloneTaskCalls(checkpoint.taskCalls ?? []);
  state.iterations = checkpoint.iterations;
  state.pendingToolCall = checkpoint.pendingToolCall
    ? {
        assistantMessage: checkpoint.pendingToolCall.assistantMessage,
        tool: checkpoint.pendingToolCall.tool,
        args: cloneUnknown(checkpoint.pendingToolCall.args) as Record<string, unknown>,
      }
    : undefined;
  state.skipNextPolicyCheck = false;
  state.orchestration = normalizeOrchestration(
    checkpoint.orchestration,
    checkpoint.iterations,
    checkpoint.pendingToolCall != null,
  );
}

export function cloneToolCalls(
  toolCalls: AgentRunResult["toolCalls"],
): AgentRunResult["toolCalls"] {
  return toolCalls.map((call) => ({ ...call }));
}

export function cloneTaskCalls(
  taskCalls: AgentTaskCallRecord[],
): AgentTaskCallRecord[] {
  return taskCalls.map((call) => ({ ...call }));
}

function buildPendingToolRequests(
  checkpoint: AgentLoopCheckpoint | undefined,
  assistantMessage: string | undefined,
): PendingToolExecution[] {
  if (!checkpoint) {
    return [];
  }

  const normalizedAssistantMessage =
    assistantMessage ?? checkpoint.pendingToolCall?.assistantMessage ?? "";
  const orchestrationRequests = checkpoint.orchestration?.pendingToolRequests ?? [];
  if (orchestrationRequests.length > 0) {
    return orchestrationRequests.map((request, index) => ({
      id: request.id,
      name: request.name,
      args: cloneUnknown(request.args) as Record<string, unknown>,
      order: request.order ?? index,
      assistantMessage: normalizedAssistantMessage,
    }));
  }

  if (!checkpoint.pendingToolCall) {
    return [];
  }

  return [
    {
      id: `pending_${checkpoint.pendingToolCall.tool}_0`,
      name: checkpoint.pendingToolCall.tool,
      args: cloneUnknown(checkpoint.pendingToolCall.args) as Record<string, unknown>,
      order: 0,
      assistantMessage: checkpoint.pendingToolCall.assistantMessage,
    },
  ];
}

function buildPendingTaskRequests(
  checkpoint: AgentLoopCheckpoint | undefined,
  assistantMessage: string | undefined,
): PendingTaskExecution[] {
  if (!checkpoint) {
    return [];
  }

  const normalizedAssistantMessage =
    assistantMessage ?? checkpoint.lastAssistantResponse ?? checkpoint.pendingToolCall?.assistantMessage ?? "";
  return (checkpoint.pendingTaskRequests ?? checkpoint.orchestration?.pendingTaskRequests ?? []).map(
    (request, index) => ({
      id: request.id,
      name: request.name,
      args: cloneUnknown(request.args) as Record<string, unknown>,
      order: request.order ?? index,
      assistantMessage: normalizedAssistantMessage,
    }),
  );
}

function normalizeOrchestration(
  orchestration: AgentLoopOrchestrationState | undefined,
  iterations: number,
  hasPendingWork: boolean,
): AgentLoopOrchestrationState {
  const recovery: AgentLoopRecoveryState = {
    reactiveCompactRetries:
      orchestration?.recovery.reactiveCompactRetries ?? 0,
    tokenContinuations: orchestration?.recovery.tokenContinuations ?? 0,
    toolRecoveryCount: orchestration?.recovery.toolRecoveryCount ?? 0,
  };

  return {
    phase:
      orchestration?.phase ??
      (hasPendingWork ? "approval_blocked" : "initializing"),
    transitionReason: orchestration?.transitionReason ?? "initial_turn",
    turnCount: orchestration?.turnCount ?? iterations,
    recovery,
    ...(orchestration?.pendingToolRequests
      ? {
          pendingToolRequests: orchestration.pendingToolRequests.map((request) => ({
            id: request.id,
            name: request.name,
            args: cloneUnknown(request.args) as Record<string, unknown>,
            order: request.order,
          })),
        }
      : {}),
    ...(orchestration?.pendingTaskRequests
      ? {
          pendingTaskRequests: orchestration.pendingTaskRequests.map((request) => ({
            id: request.id,
            name: request.name,
            args: cloneUnknown(request.args) as Record<string, unknown>,
            order: request.order,
          })),
        }
      : {}),
    ...(orchestration?.waitingTaskIds
      ? { waitingTaskIds: orchestration.waitingTaskIds.slice() }
      : {}),
    ...(orchestration?.lastModelFinishReason
      ? { lastModelFinishReason: orchestration.lastModelFinishReason }
      : {}),
    ...(orchestration?.continuationPrompt
      ? { continuationPrompt: orchestration.continuationPrompt }
      : {}),
    ...(orchestration?.compactHint
      ? { compactHint: orchestration.compactHint }
      : {}),
    ...(orchestration?.assistantMessagePersisted != null
      ? { assistantMessagePersisted: orchestration.assistantMessagePersisted }
      : {}),
  };
}

function inferAssistantMessagePersisted(
  checkpoint: AgentLoopCheckpoint | undefined,
  assistantMessage: string | undefined,
): boolean {
  if (!checkpoint || !assistantMessage?.trim()) {
    return false;
  }
  return checkpoint.messages.some(
    (message) =>
      message.role === "assistant" && message.content.trim() === assistantMessage.trim(),
  );
}

function clonePendingToolRequest(
  request: PendingToolExecution,
): PendingToolExecution {
  return {
    id: request.id,
    name: request.name,
    args: cloneUnknown(request.args) as Record<string, unknown>,
    order: request.order,
    assistantMessage: request.assistantMessage,
  };
}

function clonePendingTaskRequest(
  request: PendingTaskExecution,
): PendingTaskExecution {
  return {
    id: request.id,
    name: request.name,
    args: cloneUnknown(request.args) as Record<string, unknown>,
    order: request.order,
    assistantMessage: request.assistantMessage,
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

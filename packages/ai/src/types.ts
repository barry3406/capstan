// LLM types (moved from agent/llm.ts concept, but independent)
export interface LLMMessage { role: "system" | "user" | "assistant"; content: string; }
export interface LLMResponse { content: string; model: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined; finishReason?: string | undefined; }
export interface LLMStreamChunk { content: string; done: boolean; }
export interface LLMOptions { model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; responseFormat?: Record<string, unknown>; }
export interface LLMProvider { name: string; chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>; stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>; }

// Think/Generate options
export interface ThinkOptions<T = unknown> { schema?: { parse: (data: unknown) => T }; model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; }
export interface GenerateOptions { model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; }

// Shared scope type used by the harness context kernel.
export interface MemoryScope { type: string; id: string; }

export interface AgentToolExecutionContext {
  signal: AbortSignal;
  runId?: string | undefined;
  requestId: string;
  order: number;
}

export interface AgentToolProgressUpdate {
  type: "progress";
  message: string;
  detail?: Record<string, unknown> | undefined;
}

export interface AgentToolResultUpdate {
  type: "result";
  result: unknown;
}

export type AgentToolExecutionUpdate =
  | AgentToolProgressUpdate
  | AgentToolResultUpdate;

export type AgentLoopGovernanceAction =
  | "allow"
  | "require_approval"
  | "deny";

export interface AgentLoopGovernanceDecision {
  action: AgentLoopGovernanceAction;
  reason?: string;
  policyId?: string;
  risk?: "low" | "medium" | "high" | "critical";
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentLoopGovernanceContext {
  runId?: string | undefined;
  requestId: string;
  order: number;
  kind: "tool" | "task";
  name: string;
  args: unknown;
  assistantMessage?: string | undefined;
}

export type AgentLoopMailboxMessage =
  | {
      id: string;
      runId: string;
      createdAt: string;
      kind: "task_notification";
      notification: {
        runId: string;
        taskId: string;
        requestId: string;
        name: string;
        kind: AgentTaskKind;
        order: number;
        status: "running" | "completed" | "failed" | "canceled";
        args: Record<string, unknown>;
        result?: unknown | undefined;
        error?: string | undefined;
        hardFailure: boolean;
      };
    }
  | {
      id: string;
      runId: string;
      createdAt: string;
      kind: "control_signal";
      action: "pause" | "cancel";
      requestedAt?: string | undefined;
      reason?: string | undefined;
    }
  | {
      id: string;
      runId: string;
      createdAt: string;
      kind: "context_message";
      message: LLMMessage;
      source?: string | undefined;
    }
  | {
      id: string;
      runId: string;
      createdAt: string;
      kind: "trigger";
      trigger: {
        type: string;
        source: string;
        metadata?: Record<string, unknown> | undefined;
      };
    }
  | {
      id: string;
      runId: string;
      createdAt: string;
      kind: "tool_progress";
      tool: string;
      requestId: string;
      order: number;
      message: string;
      detail?: Record<string, unknown> | undefined;
    }
  | {
      id: string;
      runId: string;
      createdAt: string;
      kind: "system";
      event: string;
      detail?: Record<string, unknown> | undefined;
    };

export interface AgentLoopMailbox {
  publish(message: AgentLoopMailboxMessage): Promise<void>;
  next(
    runId: string,
    options?: {
      timeoutMs?: number;
    },
  ): Promise<AgentLoopMailboxMessage | undefined>;
  list(runId: string): Promise<AgentLoopMailboxMessage[]>;
}

// Agent loop types
export interface AgentTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  isConcurrencySafe?: boolean | undefined;
  failureMode?: "soft" | "hard" | undefined;
  execute(
    args: Record<string, unknown>,
    context?: AgentToolExecutionContext,
  ): Promise<unknown>;
  executeStreaming?(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext,
  ): AsyncIterable<AgentToolExecutionUpdate>;
}
export type AgentTaskKind =
  | "shell"
  | "workflow"
  | "remote"
  | "subagent"
  | "custom";
export interface AgentTaskExecutionContext {
  signal: AbortSignal;
  runId?: string | undefined;
  requestId: string;
  taskId: string;
  order: number;
  callStack?: ReadonlySet<string> | undefined;
}
export interface AgentTask {
  name: string;
  description: string;
  kind?: AgentTaskKind | undefined;
  parameters?: Record<string, unknown>;
  isConcurrencySafe?: boolean | undefined;
  failureMode?: "soft" | "hard" | undefined;
  execute(
    args: Record<string, unknown>,
    context: AgentTaskExecutionContext,
  ): Promise<unknown>;
}
export interface AgentTaskWorkerHandle {
  result: Promise<unknown>;
  abort?(reason?: string): Promise<void> | void;
}
export interface AgentTaskWorker {
  readonly mode: "in_process" | "external";
  start(
    task: AgentTask,
    args: Record<string, unknown>,
    context: AgentTaskExecutionContext,
  ): AgentTaskWorkerHandle | Promise<AgentTaskWorkerHandle>;
  destroy?(): Promise<void> | void;
}
export interface AgentToolCallRecord {
  tool: string;
  args: unknown;
  result: unknown;
  requestId?: string | undefined;
  order?: number | undefined;
  status?: "success" | "error" | undefined;
}
export interface AgentTaskCallRecord {
  task: string;
  args: unknown;
  result: unknown;
  requestId?: string | undefined;
  taskId?: string | undefined;
  order?: number | undefined;
  status?: "success" | "error" | "canceled" | undefined;
  kind?: AgentTaskKind | undefined;
}
export type AgentRunStatus = "completed" | "max_iterations" | "approval_required" | "paused" | "canceled";
export type AgentLoopControlPhase =
  | "before_llm"
  | "before_tool"
  | "after_tool"
  | "during_task_wait";
export type AgentLoopCheckpointStage =
  | "initialized"
  | "assistant_response"
  | "tool_result"
  | "task_wait"
  | "approval_required"
  | "paused"
  | "completed"
  | "max_iterations"
  | "canceled";
export type AgentLoopPhase =
  | "initializing"
  | "preparing_context"
  | "sampling_model"
  | "executing_tools"
  | "executing_tasks"
  | "waiting_on_tasks"
  | "approval_blocked"
  | "applying_tool_results"
  | "running_sidecars"
  | "deciding_continuation"
  | "completed"
  | "paused"
  | "canceled"
  | "max_iterations"
  | "failed";
export type AgentLoopTransitionReason =
  | "initial_turn"
  | "next_turn"
  | "token_budget_continuation"
  | "reactive_compact_retry"
  | "manual_resume"
  | "approval_required"
  | "task_wait"
  | "pause_requested"
  | "cancel_requested"
  | "final_response"
  | "iteration_limit"
  | "fatal_error";
export type AgentLoopModelFinishReason =
  | "stop"
  | "tool_use"
  | "max_output_tokens"
  | "context_limit"
  | "error";
export interface AgentLoopRecoveryState {
  reactiveCompactRetries: number;
  tokenContinuations: number;
  toolRecoveryCount: number;
}
export interface AgentLoopToolRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
  order: number;
}
export interface AgentLoopTaskRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
  order: number;
}
export interface AgentLoopPendingToolCall { assistantMessage: string; tool: string; args: Record<string, unknown>; }
export interface AgentLoopOrchestrationState {
  phase: AgentLoopPhase;
  transitionReason: AgentLoopTransitionReason;
  turnCount: number;
  recovery: AgentLoopRecoveryState;
  pendingToolRequests?: AgentLoopToolRequest[] | undefined;
  pendingTaskRequests?: AgentLoopTaskRequest[] | undefined;
  waitingTaskIds?: string[] | undefined;
  lastModelFinishReason?: AgentLoopModelFinishReason | undefined;
  continuationPrompt?: string | undefined;
  compactHint?: "normal" | "aggressive" | undefined;
  assistantMessagePersisted?: boolean | undefined;
}
export interface AgentLoopCheckpoint {
  stage: AgentLoopCheckpointStage;
  config: Pick<AgentRunConfig, "goal" | "maxIterations" | "systemPrompt">;
  messages: LLMMessage[];
  iterations: number;
  toolCalls: AgentToolCallRecord[];
  taskCalls?: AgentTaskCallRecord[] | undefined;
  pendingToolCall?: AgentLoopPendingToolCall | undefined;
  pendingTaskRequests?: AgentLoopTaskRequest[] | undefined;
  lastAssistantResponse?: string | undefined;
  orchestration?: AgentLoopOrchestrationState | undefined;
}
export interface AgentLoopSidecarRequest {
  runId?: string | undefined;
  checkpoint: AgentLoopCheckpoint;
  stage: AgentLoopCheckpointStage;
  phaseBeforeSidecars: AgentLoopPhase;
  transitionReason: AgentLoopTransitionReason;
}
export interface AgentLoopSidecarResult {
  checkpoint?: AgentLoopCheckpoint | undefined;
}
export interface AgentLoopControlDecision {
  action: "continue" | "pause" | "cancel";
  reason?: string;
  requestedAt?: string;
}
export interface AgentLoopBeforeToolResult { allowed: boolean; reason?: string; }
export interface AgentLoopControlAdapter {
  check(): Promise<"continue" | "pause" | "cancel">;
}
export interface AgentLoopOptions {
  onToolCall?: (
    tool: string,
    args: unknown,
  ) => Promise<void>;
  beforeToolCall?: (
    tool: string,
    args: unknown,
  ) => Promise<AgentLoopBeforeToolResult>;
  afterToolCall?: (
    tool: string,
    args: unknown,
    result: unknown,
  ) => Promise<void>;
  onToolProgress?: (
    tool: string,
    args: unknown,
    update: AgentToolProgressUpdate,
  ) => Promise<void>;
  onTaskCall?: (
    task: string,
    args: unknown,
  ) => Promise<void>;
  beforeTaskCall?: (
    task: string,
    args: unknown,
  ) => Promise<AgentLoopBeforeToolResult>;
  afterTaskCall?: (
    task: string,
    args: unknown,
    result: unknown,
  ) => Promise<void>;
  governToolCall?: (
    input: AgentLoopGovernanceContext & { kind: "tool" },
  ) => Promise<AgentLoopGovernanceDecision>;
  governTaskCall?: (
    input: AgentLoopGovernanceContext & { kind: "task" },
  ) => Promise<AgentLoopGovernanceDecision>;
  onGovernanceDecision?: (
    input: AgentLoopGovernanceContext & { decision: AgentLoopGovernanceDecision },
  ) => Promise<void>;
  mailbox?: AgentLoopMailbox;
  onMailboxMessage?: (message: AgentLoopMailboxMessage) => Promise<void>;
  isMailboxControlSignalCurrent?: (
    message: Extract<AgentLoopMailboxMessage, { kind: "control_signal" }>,
  ) => Promise<boolean>;
  onTaskSubmitted?: (task: {
    id: string;
    runId: string;
    requestId: string;
    name: string;
    kind: AgentTaskKind;
    order: number;
    status: "running" | "completed" | "failed" | "canceled";
    createdAt: string;
    updatedAt: string;
    args: Record<string, unknown>;
    hardFailure: boolean;
  }) => Promise<void>;
  onTaskSettled?: (task: {
    id: string;
    runId: string;
    requestId: string;
    name: string;
    kind: AgentTaskKind;
    order: number;
    status: "running" | "completed" | "failed" | "canceled";
    createdAt: string;
    updatedAt: string;
    args: Record<string, unknown>;
    result?: unknown;
    error?: string;
    hardFailure: boolean;
  }) => Promise<void>;
  callStack?: Set<string>;
  onMemoryEvent?: (content: string) => Promise<void>;
  hasPendingSidecars?: () => boolean;
  runSidecars?: (
    input: AgentLoopSidecarRequest,
  ) => Promise<AgentLoopSidecarResult | void>;
  checkpoint?: AgentLoopCheckpoint;
  resumePendingTool?: boolean;
  onCheckpoint?: (
    checkpoint: AgentLoopCheckpoint,
  ) => Promise<AgentLoopCheckpoint | void>;
  prepareMessages?: (
    checkpoint: AgentLoopCheckpoint,
  ) => Promise<LLMMessage[] | void>;
  getControlState?: (
    phase: AgentLoopControlPhase,
    checkpoint: AgentLoopCheckpoint,
  ) => Promise<AgentLoopControlDecision>;
  control?: AgentLoopControlAdapter;
}
export interface AgentLoopRuntimeState {
  messages: LLMMessage[];
  toolCalls: AgentToolCallRecord[];
  taskCalls: AgentTaskCallRecord[];
  iterations: number;
  pendingToolCall?: AgentLoopPendingToolCall | undefined;
  skipNextPolicyCheck: boolean;
  orchestration: AgentLoopOrchestrationState;
}
export interface AgentRunConfig {
  goal: string;
  about?: [string, string];
  maxIterations?: number;
  tools?: AgentTool[];
  tasks?: AgentTask[];
  systemPrompt?: string;
  excludeRoutes?: string[];
}
export interface AgentRunResult {
  result: unknown;
  iterations: number;
  toolCalls: AgentToolCallRecord[];
  taskCalls: AgentTaskCallRecord[];
  status: AgentRunStatus;
  pendingApproval?:
    | {
        kind: "tool" | "task";
        tool: string;
        args: unknown;
        reason: string;
      }
    | undefined;
  checkpoint?: AgentLoopCheckpoint | undefined;
}

// AI context (standalone, no Capstan dependency)
export interface AIContext { think<T = string>(prompt: string, opts?: ThinkOptions<T>): Promise<T>; generate(prompt: string, opts?: GenerateOptions): Promise<string>; thinkStream(prompt: string, opts?: Omit<ThinkOptions, "schema">): AsyncIterable<string>; generateStream(prompt: string, opts?: GenerateOptions): AsyncIterable<string>; agent: { run(config: AgentRunConfig): Promise<AgentRunResult>; }; }

// Config for creating an AI context
export interface AIConfig { llm: LLMProvider; }

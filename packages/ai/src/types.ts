// Embedding adapter (for memory vector search)
export interface MemoryEmbedder { embed(texts: string[]): Promise<number[][]>; dimensions: number; }

// LLM types (moved from agent/llm.ts concept, but independent)
export interface LLMMessage { role: "system" | "user" | "assistant"; content: string; }
export interface LLMResponse { content: string; model: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined; finishReason?: string | undefined; }
export interface LLMStreamChunk { content: string; done: boolean; }
export interface LLMOptions { model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; responseFormat?: Record<string, unknown>; }
export interface LLMProvider { name: string; chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>; stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMStreamChunk>; }

// Think/Generate options
export interface ThinkOptions<T = unknown> { schema?: { parse: (data: unknown) => T }; model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; memory?: boolean; about?: [string, string]; }
export interface GenerateOptions { model?: string; temperature?: number; maxTokens?: number; systemPrompt?: string; memory?: boolean; about?: [string, string]; }

// Memory types
export interface MemoryEntry { id: string; content: string; scope: MemoryScope; createdAt: string; updatedAt: string; metadata?: Record<string, unknown> | undefined; embedding?: number[] | undefined; importance?: "low" | "medium" | "high" | "critical" | undefined; type?: "fact" | "event" | "preference" | "instruction" | undefined; accessCount: number; lastAccessedAt: string; }
export interface MemoryScope { type: string; id: string; }
export interface RecallOptions { scope?: MemoryScope; limit?: number; minScore?: number; types?: string[]; }
export interface RememberOptions { scope?: MemoryScope; type?: "fact" | "event" | "preference" | "instruction"; importance?: "low" | "medium" | "high" | "critical"; metadata?: Record<string, unknown>; }
export interface AssembleContextOptions { query: string; maxTokens?: number; scopes?: MemoryScope[]; }

// Memory backend interface
export interface MemoryBackend { store(entry: Omit<MemoryEntry, "id" | "accessCount" | "lastAccessedAt" | "createdAt" | "updatedAt">): Promise<string>; query(scope: MemoryScope, text: string, k: number): Promise<MemoryEntry[]>; remove(id: string): Promise<boolean>; clear(scope: MemoryScope): Promise<void>; }

// Memory accessor (what developers use)
export interface MemoryAccessor { remember(content: string, opts?: RememberOptions): Promise<string>; recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]>; forget(entryId: string): Promise<boolean>; about(type: string, id: string): MemoryAccessor; assembleContext(opts: AssembleContextOptions): Promise<string>; }

// Agent loop types
export interface AgentTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  isConcurrencySafe?: boolean | undefined;
  failureMode?: "soft" | "hard" | undefined;
  execute(args: Record<string, unknown>): Promise<unknown>;
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
export interface AgentLoopControlDecision { action: "continue" | "pause" | "cancel"; reason?: string; }
export interface AgentLoopBeforeToolResult { allowed: boolean; reason?: string; }
export interface AgentLoopControlAdapter {
  check(): Promise<"continue" | "pause" | "cancel">;
}
export interface AgentLoopOptions {
  beforeToolCall?: (
    tool: string,
    args: unknown,
  ) => Promise<AgentLoopBeforeToolResult>;
  afterToolCall?: (
    tool: string,
    args: unknown,
    result: unknown,
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
  memory?: boolean;
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
export interface AIContext { think<T = string>(prompt: string, opts?: ThinkOptions<T>): Promise<T>; generate(prompt: string, opts?: GenerateOptions): Promise<string>; thinkStream(prompt: string, opts?: Omit<ThinkOptions, "schema">): AsyncIterable<string>; generateStream(prompt: string, opts?: GenerateOptions): AsyncIterable<string>; remember(content: string, opts?: RememberOptions): Promise<string>; recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]>; memory: { about(type: string, id: string): MemoryAccessor; forget(entryId: string): Promise<boolean>; assembleContext(opts: AssembleContextOptions): Promise<string>; }; agent: { run(config: AgentRunConfig): Promise<AgentRunResult>; }; }

// Config for creating an AI context
export interface AIConfig { llm: LLMProvider; memory?: { backend?: MemoryBackend; embedding?: { embed(texts: string[]): Promise<number[][]>; dimensions: number; }; autoExtract?: boolean; }; defaultScope?: MemoryScope; }

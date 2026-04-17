import type {
  AgentCheckpoint,
  AgentTool,
  AgentTask,
  LLMMessage,
  LLMProvider,
  SmartAgentMemoryConfig,
  AgentRunResult,
  MemoryScope,
  SmartAgentHooks,
} from "../types.js";
import type { AgentTaskRecord } from "../task/types.js";

// ---------------------------------------------------------------------------
// Agent run configuration (previously in core types)
// ---------------------------------------------------------------------------

export interface AgentRunConfig {
  goal: string;
  tools?: AgentTool[];
  tasks?: AgentTask[];
  maxIterations?: number;
  systemPrompt?: string;
  hooks?: SmartAgentHooks;
}

// ---------------------------------------------------------------------------
// Browser sandbox config
// ---------------------------------------------------------------------------

export interface BrowserSandboxConfig {
  /** Run browser in headless mode (default: true) */
  headless?: boolean;
  /** SOCKS5 or HTTP proxy URL */
  proxy?: string;
  /** Browser viewport dimensions */
  viewport?: { width: number; height: number };
  /** Enable anti-detection stealth scripts (default: true) */
  stealth?: boolean;
  /** Directory to save screenshots (default: system temp) */
  screenshotDir?: string;
  /** Navigation guard functions executed before each goto */
  guards?: GuardFn[];
  /** Max steps for a single browser_act vision loop (default: 15) */
  maxActSteps?: number;
  /** Browser engine: 'playwright' (default) or 'camoufox' (kernel layer with advanced stealth) */
  engine?: "playwright" | "camoufox";
  /** Platform identifier for kernel guard scoping (e.g. 'taobao', 'jd'). Only used with engine: 'camoufox'. */
  platform?: string;
  /** Stable session identity for kernel guards / persistent profiles. Only used with engine: 'camoufox'. */
  accountId?: string;
  /** Guard mode: 'vision' (default) — only safety/rate-limit guards; 'hybrid' — full guards including DOM captcha detection */
  guardMode?: "vision" | "hybrid";
}

// ---------------------------------------------------------------------------
// Filesystem sandbox config
// ---------------------------------------------------------------------------

export interface FsSandboxConfig {
  /** Scoped root directory — agent cannot escape this path */
  rootDir: string;
  /** Allow file writes (default: true) */
  allowWrite?: boolean;
  /** Allow file deletions (default: false) */
  allowDelete?: boolean;
  /** Maximum file size in bytes (default: 10 MB) */
  maxFileSize?: number;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface HarnessAction {
  tool: string;
  args: unknown;
  timestamp: number;
}

export interface VerifyResult {
  passed: boolean;
  reason?: string;
  /** If true and passed=false, the action will be retried */
  retry?: boolean;
}

export type HarnessVerifierFn = (
  action: HarnessAction,
  result: unknown,
) => Promise<VerifyResult>;

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export interface HarnessEvent {
  type:
    | "run_started"
    | "run_resumed"
    | "run_completed"
    | "run_failed"
    | "run_max_iterations"
    | "run_paused"
    | "run_canceled"
    | "pause_requested"
    | "cancel_requested"
    | "approval_required"
    | "approval_approved"
    | "approval_canceled"
    | "approval_denied"
    | "artifact_created"
    | "tool_call"
    | "tool_result"
    | "task_call"
    | "task_result"
    | "verify_pass"
    | "verify_fail"
    | "summary_created"
    | "memory_stored"
    | "context_compacted"
    | "error"
    | "screenshot"
    | "loop_start"
    | "loop_end";
  timestamp: number;
  data: Record<string, unknown>;
}

export interface HarnessLogger {
  log(event: HarnessEvent): void;
}

// ---------------------------------------------------------------------------
// Guard (for browser navigation)
// ---------------------------------------------------------------------------

export type GuardFn = (ctx: GuardContext) => Promise<void>;

export interface GuardContext {
  url: string;
  session: BrowserSession;
}

// ---------------------------------------------------------------------------
// Browser session — the browser-use abstraction
// ---------------------------------------------------------------------------

export interface BrowserSession {
  /** Navigate to a URL */
  goto(url: string): Promise<void>;
  /** Take a full-page screenshot, returns PNG buffer */
  screenshot(): Promise<Buffer>;
  /** Screenshot a specific CSS-selector element */
  screenshotElement(selector: string): Promise<Buffer>;
  /** Run JavaScript in the page context */
  evaluate<T>(fn: string): Promise<T>;
  /** Click at page coordinates */
  click(x: number, y: number): Promise<void>;
  /** Type text into a CSS-selector element */
  type(selector: string, text: string): Promise<void>;
  /** Scroll the page */
  scroll(direction: "up" | "down", amount?: number): Promise<void>;
  /** Wait for a navigation event to settle */
  waitForNavigation(timeout?: number): Promise<void>;
  /** Current page URL */
  url(): string;
  /** Close the browser session */
  close(): Promise<void>;
}

export interface BrowserEngine {
  readonly name: string;
  launch(opts: BrowserSandboxConfig): Promise<BrowserSession>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Vision — screenshot → LLM → action
// ---------------------------------------------------------------------------

export interface VisionAction {
  action: "click" | "type" | "scroll" | "navigate" | "wait" | "done";
  /** Click coordinates */
  x?: number;
  y?: number;
  /** Text to type */
  text?: string;
  /** CSS selector for typing */
  selector?: string;
  /** Scroll direction */
  direction?: "up" | "down";
  /** URL to navigate to */
  url?: string;
  /** LLM reasoning for this action */
  reason: string;
}

// ---------------------------------------------------------------------------
// Sandbox wrappers
// ---------------------------------------------------------------------------

export interface BrowserSandbox {
  readonly session: BrowserSession;
  /** High-level: screenshot → LLM vision → execute action loop */
  act(goal: string, maxSteps?: number): Promise<VisionAction[]>;
  destroy(): Promise<void>;
}

export interface FsSandbox {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  list(dir?: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number; isDir: boolean }>;
}

// ---------------------------------------------------------------------------
// Runtime substrate
// ---------------------------------------------------------------------------

export type HarnessRunStatus =
  | "running"
  | "pause_requested"
  | "paused"
  | "cancel_requested"
  | "canceled"
  | "approval_required"
  | "completed"
  | "max_iterations"
  | "failed";

export type HarnessRunEventType =
  | "run_started"
  | "run_resumed"
  | "tool_call"
  | "tool_result"
  | "task_call"
  | "task_result"
  | "verify_pass"
  | "verify_fail"
  | "artifact_created"
  | "summary_created"
  | "memory_stored"
  | "context_compacted"
  | "pause_requested"
  | "run_paused"
  | "cancel_requested"
  | "run_canceled"
  | "approval_required"
  | "approval_approved"
  | "approval_canceled"
  | "approval_denied"
  | "run_completed"
  | "run_max_iterations"
  | "run_failed";

export interface HarnessRuntimePaths {
  rootDir: string;
  runsDir: string;
  eventsDir: string;
  globalEventsPath: string;
  artifactsDir: string;
  tasksDir: string;
  approvalsDir: string;
  checkpointsDir: string;
  summariesDir: string;
  sessionMemoryDir: string;
  memoryDir: string;
  sandboxesDir: string;
}

export type HarnessMemoryKind =
  | "instruction"
  | "fact"
  | "summary"
  | "observation"
  | "artifact";

export type HarnessApprovalKind = "tool" | "task";

export type HarnessApprovalStatus = "pending" | "approved" | "denied" | "canceled";

export interface HarnessPendingApproval {
  id: string;
  kind: HarnessApprovalKind;
  tool: string;
  args: unknown;
  reason: string;
  requestedAt: string;
  status?: HarnessApprovalStatus | undefined;
  resolvedAt?: string | undefined;
  resolutionNote?: string | undefined;
}

export interface HarnessApprovalRecord extends HarnessPendingApproval {
  runId: string;
  updatedAt: string;
  resolvedBy?: Record<string, unknown> | undefined;
}

export type HarnessContextBlockKind =
  | "instructions"
  | "session_memory"
  | "summary"
  | "memory"
  | "artifact"
  | "transcript";

export type HarnessCompactionKind =
  | "microcompact"
  | "session_compact"
  | "run_compact";

export interface HarnessContextArtifactRef {
  artifactId: string;
  kind: string;
  path: string;
  mimeType: string;
  size: number;
  preview?: string;
  metadata?: Record<string, unknown>;
}

export interface HarnessMemoryRecord {
  id: string;
  scope: MemoryScope;
  kind: HarnessMemoryKind;
  content: string;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
  lastAccessedAt: string;
  runId?: string | undefined;
  sourceSummaryId?: string | undefined;
  importance?: "low" | "medium" | "high" | "critical" | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface HarnessMemoryInput {
  scope: MemoryScope;
  kind?: HarnessMemoryKind;
  content: string;
  runId?: string;
  sourceSummaryId?: string;
  importance?: "low" | "medium" | "high" | "critical";
  metadata?: Record<string, unknown>;
}

export interface HarnessMemoryQuery {
  query: string;
  scopes?: MemoryScope[];
  kinds?: HarnessMemoryKind[];
  runId?: string;
  limit?: number;
  minScore?: number;
}

export interface HarnessMemoryMatch extends HarnessMemoryRecord {
  score: number;
}

export interface HarnessSessionMemoryRecord {
  runId: string;
  goal: string;
  status: HarnessRunStatus;
  updatedAt: string;
  sourceRunUpdatedAt: string;
  headline: string;
  currentPhase: string;
  lastAssistantResponse?: string | undefined;
  recentSteps: string[];
  blockers: string[];
  openQuestions: string[];
  pendingApproval?:
    | {
        tool: string;
        reason: string;
      }
    | undefined;
  artifactRefs: HarnessContextArtifactRef[];
  compactedMessages: number;
  tokenEstimate: number;
}

export interface HarnessSummaryRecord {
  id: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  sourceRunUpdatedAt: string;
  kind: HarnessCompactionKind;
  status: HarnessRunStatus;
  headline: string;
  completedSteps: string[];
  blockers: string[];
  openQuestions: string[];
  artifactRefs: HarnessContextArtifactRef[];
  iterations: number;
  toolCalls: number;
  messageCount: number;
  compactedMessages: number;
}

export interface HarnessContextBlock {
  kind: HarnessContextBlockKind;
  title: string;
  content: string;
  tokens: number;
  metadata?: Record<string, unknown>;
}

export interface HarnessContextPackage {
  runId: string;
  generatedAt: string;
  query: string;
  maxTokens: number;
  totalTokens: number;
  blocks: HarnessContextBlock[];
  transcriptTail: LLMMessage[];
  artifactRefs: HarnessContextArtifactRef[];
  memories: HarnessMemoryMatch[];
  sessionMemory?: HarnessSessionMemoryRecord | undefined;
  summary?: HarnessSummaryRecord | undefined;
  omitted: Array<{
    kind: string;
    reason: string;
  }>;
}

export interface HarnessContextAssembleOptions {
  query?: string;
  maxTokens?: number;
  scopes?: MemoryScope[];
  maxMemories?: number;
  maxArtifacts?: number;
}

export type HarnessAuthorizedAction =
  | "run:start"
  | "run:list"
  | "run:read"
  | "run:pause"
  | "run:cancel"
  | "run:resume"
  | "run:replay"
  | "approval:list"
  | "approval:read"
  | "event:list"
  | "event:read"
  | "artifact:read"
  | "task:read"
  | "checkpoint:read"
  | "summary:list"
  | "summary:read"
  | "memory:read"
  | "memory:write"
  | "context:read"
  | "approval:approve"
  | "approval:deny"
  | "runtime_paths:read";

export interface HarnessAccessContext {
  subject?: unknown;
  metadata?: Record<string, unknown>;
}

export interface HarnessAuthorizationRequest {
  action: HarnessAuthorizedAction;
  runId?: string;
  run?: HarnessRunRecord;
  access?: HarnessAccessContext;
  detail?: Record<string, unknown>;
}

export interface HarnessAuthorizationDecision {
  allowed: boolean;
  reason?: string;
}

export type HarnessAuthorizationHook = (
  request: HarnessAuthorizationRequest,
) =>
  | HarnessAuthorizationDecision
  | boolean
  | void
  | Promise<HarnessAuthorizationDecision | boolean | void>;

export interface HarnessControlPlaneOptions {
  rootDir?: string;
  authorize?: HarnessAuthorizationHook;
}

export interface HarnessRuntimeStore {
  readonly paths: HarnessRuntimePaths;
  initialize(): Promise<void>;
  persistRun(run: HarnessRunRecord): Promise<void>;
  getRun(runId: string): Promise<HarnessRunRecord | undefined>;
  listRuns(): Promise<HarnessRunRecord[]>;
  appendEvent(event: HarnessRunEventRecord): Promise<void>;
  getEvents(runId?: string): Promise<HarnessRunEventRecord[]>;
  writeArtifact(runId: string, input: HarnessArtifactInput): Promise<HarnessArtifactRecord>;
  getArtifacts(runId: string): Promise<HarnessArtifactRecord[]>;
  persistTask(task: HarnessTaskRecord): Promise<void>;
  patchTask(
    runId: string,
    taskId: string,
    patch: Partial<Omit<HarnessTaskRecord, "id" | "runId" | "createdAt">>,
  ): Promise<HarnessTaskRecord>;
  getTasks(runId: string): Promise<HarnessTaskRecord[]>;
  persistApproval(record: HarnessApprovalRecord): Promise<void>;
  getApproval(approvalId: string): Promise<HarnessApprovalRecord | undefined>;
  listApprovals(runId?: string): Promise<HarnessApprovalRecord[]>;
  patchApproval(
    approvalId: string,
    patch: Partial<Omit<HarnessApprovalRecord, "id" | "runId" | "requestedAt">>,
  ): Promise<HarnessApprovalRecord>;
  persistCheckpoint(
    runId: string,
    checkpoint: AgentCheckpoint,
  ): Promise<HarnessRunCheckpointRecord>;
  getCheckpoint(runId: string): Promise<HarnessRunCheckpointRecord | undefined>;
  persistSessionMemory(record: HarnessSessionMemoryRecord): Promise<void>;
  getSessionMemory(runId: string): Promise<HarnessSessionMemoryRecord | undefined>;
  persistSummary(record: HarnessSummaryRecord): Promise<void>;
  getLatestSummary(runId: string): Promise<HarnessSummaryRecord | undefined>;
  listSummaries(runId?: string): Promise<HarnessSummaryRecord[]>;
  rememberMemory(input: HarnessMemoryInput): Promise<HarnessMemoryRecord>;
  recallMemory(query: HarnessMemoryQuery): Promise<HarnessMemoryMatch[]>;
  readArtifactPreview(
    artifact: HarnessArtifactRecord,
    maxChars: number,
  ): Promise<string | undefined>;
  patchRun(
    runId: string,
    patch: Partial<Omit<HarnessRunRecord, "id" | "createdAt">>,
  ): Promise<HarnessRunRecord>;
  transitionRun(
    runId: string,
    type: HarnessRunEventType,
    patch: Partial<Omit<HarnessRunRecord, "id" | "createdAt">>,
    data: Record<string, unknown>,
  ): Promise<HarnessRunRecord>;
  requestPause(runId: string): Promise<HarnessRunRecord>;
  requestCancel(runId: string): Promise<HarnessRunRecord>;
  replayRun(runId: string): Promise<HarnessReplayReport>;
  clearRunArtifacts(runId: string): Promise<void>;
  requireRun(runId: string): Promise<HarnessRunRecord>;
}

export interface HarnessRunRecord {
  id: string;
  goal: string;
  status: HarnessRunStatus;
  createdAt: string;
  updatedAt: string;
  iterations: number;
  toolCalls: number;
  taskCalls: number;
  maxIterations: number;
  toolNames: string[];
  taskNames: string[];
  artifactIds: string[];
  taskIds: string[];
  sandbox: {
    driver: string;
    mode: string;
    browser: boolean;
    fs: boolean;
    artifactDir: string;
    workspaceDir?: string;
  };
  result?: unknown | undefined;
  error?: string | undefined;
  pendingApprovalId?: string | undefined;
  pendingApproval?: HarnessPendingApproval | undefined;
  checkpointUpdatedAt?: string | undefined;
  contextUpdatedAt?: string | undefined;
  latestSummaryId?: string | undefined;
  trigger?: HarnessRunTrigger | undefined;
  metadata?: Record<string, unknown> | undefined;
  control?: {
    pauseRequestedAt?: string;
    cancelRequestedAt?: string;
  } | undefined;
  lastEventSequence: number;
}

export interface HarnessRunEventRecord {
  id: string;
  runId: string;
  sequence: number;
  type: HarnessRunEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface HarnessArtifactRecord {
  id: string;
  runId: string;
  kind: string;
  path: string;
  createdAt: string;
  mimeType: string;
  size: number;
  metadata?: Record<string, unknown>;
}

export type HarnessTaskStatus = AgentTaskRecord["status"];

export interface HarnessTaskRecord extends AgentTaskRecord {}

export interface HarnessReplayReport {
  runId: string;
  consistent: boolean;
  eventCount: number;
  derivedStatus?: HarnessRunStatus;
  storedStatus?: HarnessRunStatus;
  derivedIterations: number;
  storedIterations?: number;
  derivedToolCalls: number;
  storedToolCalls?: number;
  derivedTaskCalls: number;
  storedTaskCalls?: number;
  derivedArtifactCount: number;
  storedArtifactCount?: number;
}

export interface HarnessArtifactInput {
  kind: string;
  content: Buffer | Uint8Array | string | Record<string, unknown>;
  filename?: string;
  extension?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export interface HarnessSandboxContext {
  mode: string;
  artifactDir: string;
  workspaceDir?: string;
  browser: BrowserSandbox | null;
  fs: FsSandbox | null;
  abort?(): Promise<void>;
  destroy(): Promise<void>;
}

export interface HarnessResumeOptions {
  runConfig?: AgentRunConfig;
  approvePendingTool?: boolean;
  resumeMessage?: string;
  access?: HarnessAccessContext;
}

export interface HarnessApprovalResolutionOptions {
  access?: HarnessAccessContext;
  note?: string;
}

export interface HarnessSandboxDriver {
  readonly name: string;
  createContext(
    config: HarnessConfig,
    runtime: {
      runId: string;
      paths: HarnessRuntimePaths;
      sandboxDir: string;
      artifactDir: string;
    },
  ): Promise<HarnessSandboxContext>;
}

export type HarnessToolPolicyFn = (ctx: {
  runId: string;
  tool: string;
  args: unknown;
}) => Promise<{ allowed: boolean; reason?: string }>;

export type HarnessTaskPolicyFn = (ctx: {
  runId: string;
  task: string;
  args: unknown;
}) => Promise<{ allowed: boolean; reason?: string }>;

export interface HarnessRuntimeConfig {
  /** Root directory under which .capstan/harness/ is persisted (default: process.cwd()) */
  rootDir?: string;
  /** Maximum concurrently executing runs per harness instance (default: 1) */
  maxConcurrentRuns?: number;
  /** Override the default local sandbox driver */
  driver?: HarnessSandboxDriver;
  /** Override the default file-backed runtime store */
  storeFactory?: (rootDir: string) => HarnessRuntimeStore;
  /** Optional policy hook that can block tool calls and force approval_required */
  beforeToolCall?: HarnessToolPolicyFn;
  /** Optional policy hook that can block task calls and force approval_required */
  beforeTaskCall?: HarnessTaskPolicyFn;
  /** Optional authorization hook for external run/control-plane actions */
  authorize?: HarnessAuthorizationHook;
}

export interface HarnessRunTrigger {
  type: string;
  source: string;
  firedAt: string;
  schedule?:
    | {
        name: string;
        pattern: string;
        timezone?: string;
      }
    | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface HarnessRunStartOptions {
  trigger?: HarnessRunTrigger;
  metadata?: Record<string, unknown>;
  access?: HarnessAccessContext;
}

export interface HarnessRunResult extends AgentRunResult {
  runId: string;
  runtimeStatus: HarnessRunStatus;
  artifactIds: string[];
}

export interface HarnessRunHandle {
  runId: string;
  result: Promise<HarnessRunResult>;
}

// ---------------------------------------------------------------------------
// Harness config & instance
// ---------------------------------------------------------------------------

export interface HarnessConfig {
  llm: LLMProvider;
  sandbox?: {
    browser?: BrowserSandboxConfig | boolean;
    fs?: FsSandboxConfig | boolean;
  };
  verify?: {
    enabled?: boolean;
    /** Max retries for failed verification (default: 3) */
    maxRetries?: number;
    /** Custom verifier function (overrides default LLM-based verifier) */
    verifier?: HarnessVerifierFn;
  };
  observe?: {
    logger?: HarnessLogger;
    onEvent?: (event: HarnessEvent) => void;
  };
  memory?: SmartAgentMemoryConfig;
  context?: {
    enabled?: boolean;
    maxPromptTokens?: number;
    reserveOutputTokens?: number;
    maxMemories?: number;
    maxArtifacts?: number;
    maxRecentMessages?: number;
    maxRecentToolResults?: number;
    microcompactToolResultChars?: number;
    sessionCompactThreshold?: number;
    defaultScopes?: MemoryScope[];
    autoPromoteObservations?: boolean;
    autoPromoteSummaries?: boolean;
  };
  runtime?: HarnessRuntimeConfig;
}

export interface Harness {
  /** Start a run and return its id immediately for external control */
  startRun(config: AgentRunConfig, options?: HarnessRunStartOptions): Promise<HarnessRunHandle>;
  /** Run an agent loop with harness sandbox tools */
  run(config: AgentRunConfig, options?: HarnessRunStartOptions): Promise<HarnessRunResult>;
  /** Request cooperative pause for a running run */
  pauseRun(runId: string, access?: HarnessAccessContext): Promise<HarnessRunRecord>;
  /** Request cooperative cancellation or synchronously cancel a paused/blocked run */
  cancelRun(runId: string, access?: HarnessAccessContext): Promise<HarnessRunRecord>;
  /** Resume a paused or approval-blocked run */
  resumeRun(runId: string, options?: HarnessResumeOptions): Promise<HarnessRunResult>;
  /** Read one persisted approval record */
  getApproval(
    approvalId: string,
    access?: HarnessAccessContext,
  ): Promise<HarnessApprovalRecord | undefined>;
  /** List persisted approvals, optionally scoped to one run */
  listApprovals(runId?: string, access?: HarnessAccessContext): Promise<HarnessApprovalRecord[]>;
  /** Mark the pending approval for a run as approved */
  approveRun(
    runId: string,
    options?: HarnessApprovalResolutionOptions,
  ): Promise<HarnessApprovalRecord>;
  /** Deny the pending approval for a run and cancel the blocked run */
  denyRun(
    runId: string,
    options?: HarnessApprovalResolutionOptions,
  ): Promise<HarnessApprovalRecord>;
  /** Get a persisted run record */
  getRun(runId: string, access?: HarnessAccessContext): Promise<HarnessRunRecord | undefined>;
  /** List persisted runs */
  listRuns(access?: HarnessAccessContext): Promise<HarnessRunRecord[]>;
  /** Read persisted runtime events */
  getEvents(runId?: string, access?: HarnessAccessContext): Promise<HarnessRunEventRecord[]>;
  /** Read persisted artifacts for a run */
  getArtifacts(runId: string, access?: HarnessAccessContext): Promise<HarnessArtifactRecord[]>;
  /** Read persisted task records for a run */
  getTasks(runId: string, access?: HarnessAccessContext): Promise<HarnessTaskRecord[]>;
  /** Read the persisted loop checkpoint for a run */
  getCheckpoint(runId: string, access?: HarnessAccessContext): Promise<AgentCheckpoint | undefined>;
  /** Read the latest structured session memory for a run */
  getSessionMemory(
    runId: string,
    access?: HarnessAccessContext,
  ): Promise<HarnessSessionMemoryRecord | undefined>;
  /** Read the latest persisted summary for a run */
  getLatestSummary(runId: string, access?: HarnessAccessContext): Promise<HarnessSummaryRecord | undefined>;
  /** List persisted summaries */
  listSummaries(runId?: string, access?: HarnessAccessContext): Promise<HarnessSummaryRecord[]>;
  /** Persist a long-term memory entry */
  rememberMemory(input: HarnessMemoryInput, access?: HarnessAccessContext): Promise<HarnessMemoryRecord>;
  /** Query persisted long-term memory */
  recallMemory(query: HarnessMemoryQuery, access?: HarnessAccessContext): Promise<HarnessMemoryMatch[]>;
  /** Assemble the runtime context package for a run */
  assembleContext(
    runId: string,
    options?: HarnessContextAssembleOptions,
    access?: HarnessAccessContext,
  ): Promise<HarnessContextPackage>;
  /** Replay events and compare against stored run state */
  replayRun(runId: string, access?: HarnessAccessContext): Promise<HarnessReplayReport>;
  /** Resolve runtime filesystem paths */
  getPaths(access?: HarnessAccessContext): HarnessRuntimePaths;
  /** Tear down the harness instance */
  destroy(): Promise<void>;
}

export interface HarnessControlPlane {
  /** Request cooperative pause for a running run */
  pauseRun(runId: string, access?: HarnessAccessContext): Promise<HarnessRunRecord>;
  /** Request cooperative cancellation or synchronously cancel a paused/blocked run */
  cancelRun(runId: string, access?: HarnessAccessContext): Promise<HarnessRunRecord>;
  /** Read one persisted approval record */
  getApproval(
    approvalId: string,
    access?: HarnessAccessContext,
  ): Promise<HarnessApprovalRecord | undefined>;
  /** List persisted approvals, optionally scoped to one run */
  listApprovals(runId?: string, access?: HarnessAccessContext): Promise<HarnessApprovalRecord[]>;
  /** Mark the pending approval for a run as approved */
  approveRun(
    runId: string,
    options?: HarnessApprovalResolutionOptions,
  ): Promise<HarnessApprovalRecord>;
  /** Deny the pending approval for a run and cancel the blocked run */
  denyRun(
    runId: string,
    options?: HarnessApprovalResolutionOptions,
  ): Promise<HarnessApprovalRecord>;
  /** Get a persisted run record */
  getRun(runId: string, access?: HarnessAccessContext): Promise<HarnessRunRecord | undefined>;
  /** List persisted runs */
  listRuns(access?: HarnessAccessContext): Promise<HarnessRunRecord[]>;
  /** Read persisted runtime events */
  getEvents(runId?: string, access?: HarnessAccessContext): Promise<HarnessRunEventRecord[]>;
  /** Read persisted artifacts for a run */
  getArtifacts(runId: string, access?: HarnessAccessContext): Promise<HarnessArtifactRecord[]>;
  /** Read persisted task records for a run */
  getTasks(runId: string, access?: HarnessAccessContext): Promise<HarnessTaskRecord[]>;
  /** Read the persisted loop checkpoint for a run */
  getCheckpoint(runId: string, access?: HarnessAccessContext): Promise<AgentCheckpoint | undefined>;
  /** Read the latest structured session memory for a run */
  getSessionMemory(
    runId: string,
    access?: HarnessAccessContext,
  ): Promise<HarnessSessionMemoryRecord | undefined>;
  /** Read the latest persisted summary for a run */
  getLatestSummary(runId: string, access?: HarnessAccessContext): Promise<HarnessSummaryRecord | undefined>;
  /** List persisted summaries */
  listSummaries(runId?: string, access?: HarnessAccessContext): Promise<HarnessSummaryRecord[]>;
  /** Query persisted long-term memory */
  recallMemory(query: HarnessMemoryQuery, access?: HarnessAccessContext): Promise<HarnessMemoryMatch[]>;
  /** Assemble the runtime context package for a run */
  assembleContext(
    runId: string,
    options?: HarnessContextAssembleOptions,
    access?: HarnessAccessContext,
  ): Promise<HarnessContextPackage>;
  /** Replay events and compare against stored run state */
  replayRun(runId: string, access?: HarnessAccessContext): Promise<HarnessReplayReport>;
  /** Resolve runtime filesystem paths */
  getPaths(access?: HarnessAccessContext): HarnessRuntimePaths;
}

export interface HarnessRunCheckpointRecord {
  runId: string;
  updatedAt: string;
  checkpoint: AgentCheckpoint;
}

// ---------------------------------------------------------------------------
// Cron job configuration
// ---------------------------------------------------------------------------

export interface CronJobConfig {
  /** Human-readable job name */
  name: string;
  /** Standard cron pattern, e.g. "0 0 * * *" (daily) or every-N-hours */
  pattern: string;
  /** Async handler invoked on each tick */
  handler: () => Promise<void>;
  /** IANA timezone hint for native runners; the fallback interval runner ignores it. */
  timezone?: string;
  /** Max concurrent executions of this job (default: 1) */
  maxConcurrent?: number;
  /** Error callback */
  onError?: (err: Error) => void;
  /** Best-effort cleanup hook invoked when a job is stopped or removed. */
  onStop?: () => void | Promise<void>;
  /** Whether the job is active (default: true) */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Cron runner — manages job lifecycle
// ---------------------------------------------------------------------------

export interface CronRunner {
  /** Add a job. Returns a unique job ID. */
  add(config: CronJobConfig): string;
  /** Remove a job by ID. */
  remove(id: string): boolean;
  /** Start all enabled jobs. */
  start(): void;
  /** Stop all jobs. */
  stop(): void;
  /** List all jobs with status. */
  getJobs(): CronJobInfo[];
}

export interface CronJobInfo {
  id: string;
  name: string;
  pattern: string;
  status: "running" | "idle" | "disabled";
  lastRun: Date | null;
  nextRun: Date | null;
  runCount: number;
  errorCount: number;
}

// ---------------------------------------------------------------------------
// AI agent cron integration
// ---------------------------------------------------------------------------

export interface AgentCronTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  isConcurrencySafe?: boolean | undefined;
  failureMode?: "soft" | "hard" | undefined;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export interface AgentCronRunConfig {
  goal: string;
  about?: [string, string];
  maxIterations?: number;
  memory?: boolean;
  tools?: AgentCronTool[];
  systemPrompt?: string;
  excludeRoutes?: string[];
}

export interface AgentCronTrigger {
  type: "cron";
  source: string;
  firedAt: string;
  schedule: {
    name: string;
    pattern: string;
    timezone?: string;
  };
  metadata?: Record<string, unknown> | undefined;
}

export interface AgentCronHarnessStartOptions {
  trigger?: AgentCronTrigger;
  metadata?: Record<string, unknown>;
}

export interface AgentCronHarnessLike {
  startRun(
    config: AgentCronRunConfig,
    options?: AgentCronHarnessStartOptions,
  ): Promise<{ runId: string; result: Promise<unknown> }>;
  destroy?(): Promise<void>;
}

export interface AgentCronConfig {
  /** Cron pattern */
  cron: string;
  /** Job name */
  name: string;
  /** Agent goal — static string or dynamic function */
  goal: string | (() => string);
  /** Optional IANA timezone hint for native runners */
  timezone?: string;
  /** LLM provider for the agent when the cron job creates its own harness */
  llm?: unknown; // HarnessConfig["llm"] — kept as unknown to avoid hard dep
  /** Harness config (sandbox, verify, observe) */
  harnessConfig?: Record<string, unknown>;
  /** Additional agent-loop config merged onto the generated run submission */
  run?: Omit<AgentCronRunConfig, "goal">;
  /** Persisted trigger metadata attached to the submitted run */
  triggerMetadata?: Record<string, unknown>;
  /** Submit into an existing or custom-created harness runtime instead of bootstrapping one per tick */
  runtime?: {
    harness?: AgentCronHarnessLike;
    createHarness?: () => Promise<AgentCronHarnessLike>;
    reuseHarness?: boolean;
  };
  /** Called once a run has been queued into the harness runtime */
  onQueued?: (meta: { runId: string; trigger: AgentCronTrigger }) => void;
  /** Called with each run result */
  onResult?: (
    result: unknown,
    meta: { runId: string; trigger: AgentCronTrigger },
  ) => void;
  /** Called on errors */
  onError?: (err: Error) => void;
}

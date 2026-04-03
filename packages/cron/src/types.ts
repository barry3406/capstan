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

export interface AgentCronConfig {
  /** Cron pattern */
  cron: string;
  /** Job name */
  name: string;
  /** Agent goal — static string or dynamic function */
  goal: string | (() => string);
  /** LLM provider for the agent */
  llm: unknown; // HarnessConfig["llm"] — kept as unknown to avoid hard dep
  /** Harness config (sandbox, verify, observe) */
  harnessConfig?: Record<string, unknown>;
  /** Called with each run result */
  onResult?: (result: unknown) => void;
  /** Called on errors */
  onError?: (err: Error) => void;
}

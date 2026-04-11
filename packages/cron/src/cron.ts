/**
 * Cron scheduler — Bun.cron native with setInterval-based Node.js fallback.
 */

import type { CronJobConfig, CronRunner, CronJobInfo } from "./types.js";

const DEFAULT_SET_TIMEOUT = globalThis.setTimeout;
const DEFAULT_CLEAR_TIMEOUT = globalThis.clearTimeout;

// ---------------------------------------------------------------------------
// defineCron — declarative helper (returns config as-is, for composition)
// ---------------------------------------------------------------------------

export function defineCron(config: CronJobConfig): CronJobConfig {
  return config;
}

// ---------------------------------------------------------------------------
// createCronRunner — the runtime scheduler
// ---------------------------------------------------------------------------

export function createCronRunner(): CronRunner {
  const jobs = new Map<string, JobState>();
  let nextId = 1;
  let started = false;

  return {
    add(config: CronJobConfig): string {
      const id = `cron_${nextId++}`;
      const state: JobState = {
        id,
        config,
        status: config.enabled === false ? "disabled" : "idle",
        lastRun: null,
        nextRun: null,
        runCount: 0,
        errorCount: 0,
        running: 0,
        timer: null,
        abortController: null,
      };
      jobs.set(id, state);

      if (started && state.status !== "disabled") {
        scheduleJob(state);
      }

      return id;
    },

    remove(id: string): boolean {
      const state = jobs.get(id);
      if (!state) return false;
      clearJobTimer(state);
      jobs.delete(id);
      triggerJobStop(state);
      return true;
    },

    start(): void {
      started = true;
      for (const state of jobs.values()) {
        if (state.status !== "disabled") {
          scheduleJob(state);
        }
      }
    },

    stop(): void {
      started = false;
      for (const state of jobs.values()) {
        clearJobTimer(state);
        state.status = state.config.enabled === false ? "disabled" : "idle";
        triggerJobStop(state);
      }
    },

    getJobs(): CronJobInfo[] {
      return [...jobs.values()].map((s) => ({
        id: s.id,
        name: s.config.name,
        pattern: s.config.pattern,
        status: s.status,
        lastRun: s.lastRun,
        nextRun: s.nextRun,
        runCount: s.runCount,
        errorCount: s.errorCount,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface JobState {
  id: string;
  config: CronJobConfig;
  status: "running" | "idle" | "disabled";
  lastRun: Date | null;
  nextRun: Date | null;
  runCount: number;
  errorCount: number;
  running: number;
  timer: ReturnType<typeof setTimeout> | null;
  abortController: AbortController | null;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function scheduleJob(state: JobState): void {
  clearJobTimer(state);

  const intervalMs = cronToMs(state.config.pattern);
  const nextRun = new Date(Date.now() + intervalMs);
  state.nextRun = nextRun;

  state.timer = setTimeout(() => {
    void runJob(state);
    // Re-schedule for next tick
    scheduleJob(state);
  }, intervalMs);
}

async function runJob(state: JobState): Promise<void> {
  const maxConcurrent = state.config.maxConcurrent ?? 1;
  if (state.running >= maxConcurrent) return;

  state.running++;
  state.status = "running";

  try {
    await state.config.handler();
    state.runCount++;
    state.lastRun = new Date();
  } catch (err) {
    state.errorCount++;
    if (state.config.onError) {
      state.config.onError(err instanceof Error ? err : new Error(String(err)));
    }
  } finally {
    state.running--;
    if (state.running === 0) {
      state.status = "idle";
    }
  }
}

function clearJobTimer(state: JobState): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

// ---------------------------------------------------------------------------
// cronToMs — parse cron pattern to approximate interval
//
// This is an interval-based approximation for the setInterval fallback runner.
// It converts cron patterns to a fixed millisecond interval. For calendar-
// accurate scheduling (exact wall-clock times, DST transitions), use
// Bun.cron directly via createBunCronRunner().
//
// Supported patterns:
//   * * * * *          every minute
//   */N * * * *        every N minutes
//   0 */N * * *        every N hours
//   N * * * *          hourly (at minute N)
//   N N * * *          daily (at hour:minute)
//   N N * * 1-5        weekdays only (approximated as daily)
//   N N * * 0,6        weekends only (approximated as daily)
//   N N N * *          monthly (at day hour:minute)
//   N N * */N *        every N months (approximated)
//   @yearly            once per year
//   @monthly           once per month
//   @weekly            once per week
//   @daily / @midnight once per day
//   @hourly            once per hour
//   @every Nm/Nh/Ns    every N minutes/hours/seconds
// ---------------------------------------------------------------------------

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function cronToMs(pattern: string): number {
  const trimmed = pattern.trim();

  // Handle shorthand aliases
  if (trimmed.startsWith("@")) {
    return parseShorthand(trimmed);
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 5) {
    throw new Error(`Invalid cron pattern: "${pattern}" (expected 5 fields: minute hour day month weekday)`);
  }

  const [minute, hour, dayOfMonth, month, _dayOfWeek] = parts as [string, string, string, string, string];

  // --- Step fields (*/N) ---

  // Every N minutes: "*/N * * * *"
  if (minute.startsWith("*/") && hour === "*") {
    const n = parseStep(minute);
    if (n > 0) return n * MINUTE;
  }

  // Every N hours: "0 */N * * *" or "* */N * * *"
  if (hour.startsWith("*/")) {
    const n = parseStep(hour);
    if (n > 0) return n * HOUR;
  }

  // Every N days: "N N */N * *"
  if (dayOfMonth.startsWith("*/")) {
    const n = parseStep(dayOfMonth);
    if (n > 0) return n * DAY;
  }

  // Every N months: "N N N */N *"
  if (month.startsWith("*/")) {
    const n = parseStep(month);
    if (n > 0) return n * MONTH;
  }

  // --- Wildcard combinations ---

  // Every minute: "* * * * *"
  if (minute === "*" && hour === "*") {
    return MINUTE;
  }

  // Hourly: "N * * * *" (specific minute, every hour)
  if (isFixed(minute) && hour === "*") {
    return HOUR;
  }

  // Daily: "N N * * *" or "N N * * <weekday-filter>"
  if (isFixed(minute) && isFixed(hour) && dayOfMonth === "*" && month === "*") {
    return DAY;
  }

  // Monthly: "N N N * *" (specific day, hour, minute)
  if (isFixed(minute) && isFixed(hour) && isFixed(dayOfMonth) && month === "*") {
    return MONTH;
  }

  // Yearly: "N N N N *" (specific month, day, hour, minute)
  if (isFixed(minute) && isFixed(hour) && isFixed(dayOfMonth) && isFixed(month)) {
    return YEAR;
  }

  // Default fallback: treat as hourly
  return HOUR;
}

function parseShorthand(pattern: string): number {
  const lower = pattern.toLowerCase();
  switch (lower) {
    case "@yearly":
    case "@annually":
      return YEAR;
    case "@monthly":
      return MONTH;
    case "@weekly":
      return WEEK;
    case "@daily":
    case "@midnight":
      return DAY;
    case "@hourly":
      return HOUR;
    default:
      break;
  }

  // @every Nm / @every Nh / @every Ns
  const everyMatch = lower.match(/^@every\s+(\d+)\s*(s|m|h|ms)$/);
  if (everyMatch) {
    const n = parseInt(everyMatch[1]!, 10);
    const unit = everyMatch[2]!;
    if (unit === "s") return n * 1000;
    if (unit === "m") return n * MINUTE;
    if (unit === "h") return n * HOUR;
    if (unit === "ms") return n;
  }

  throw new Error(`Unknown cron shorthand: "${pattern}"`);
}

function parseStep(field: string): number {
  const n = parseInt(field.slice(field.indexOf("/") + 1), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isFixed(field: string): boolean {
  return field !== "*" && !field.includes("/");
}

// ---------------------------------------------------------------------------
// Bun-native cron runner (optional — uses Bun.cron when available)
// ---------------------------------------------------------------------------

/**
 * Create a cron runner that uses Bun.cron natively.
 * Falls back to createCronRunner() in Node.js.
 */
export function createBunCronRunner(): CronRunner {
  if (canUseNativeBunCron()) {
    return createBunNativeCronRunner();
  }
  // Fallback to setInterval-based
  return createCronRunner();
}

// Bun global type (minimal, to avoid full bun-types dependency)
declare const Bun: {
  cron: (name: string, pattern: string, handler: () => void | Promise<void>) => { stop: () => void };
} & Record<string, unknown>;

function createBunNativeCronRunner(): CronRunner {
  const jobs = new Map<string, { config: CronJobConfig; handle: { stop: () => void } | null; info: CronJobInfo }>();
  let nextId = 1;
  let started = false;

  function startJob(id: string, config: CronJobConfig): { stop: () => void } {
    const info = jobs.get(id)!.info;
    return Bun.cron(config.name, config.pattern, async () => {
      const maxConcurrent = config.maxConcurrent ?? 1;
      if (info.status === "running") return; // Simple concurrency guard

      info.status = "running";
      try {
        await config.handler();
        info.runCount++;
        info.lastRun = new Date();
      } catch (err) {
        info.errorCount++;
        if (config.onError) {
          config.onError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        info.status = "idle";
      }
    });
  }

  return {
    add(config: CronJobConfig): string {
      const id = `bun_cron_${nextId++}`;
      const info: CronJobInfo = {
        id,
        name: config.name,
        pattern: config.pattern,
        status: config.enabled === false ? "disabled" : "idle",
        lastRun: null,
        nextRun: null,
        runCount: 0,
        errorCount: 0,
      };
      const entry = { config, handle: null as { stop: () => void } | null, info };
      jobs.set(id, entry);

      if (started && config.enabled !== false) {
        entry.handle = startJob(id, config);
      }

      return id;
    },

    remove(id: string): boolean {
      const entry = jobs.get(id);
      if (!entry) return false;
      if (entry.handle) entry.handle.stop();
      jobs.delete(id);
      triggerJobStop({ config: entry.config });
      return true;
    },

    start(): void {
      started = true;
      for (const [id, entry] of jobs) {
        if (entry.config.enabled !== false && !entry.handle) {
          entry.handle = startJob(id, entry.config);
        }
      }
    },

    stop(): void {
      started = false;
      for (const entry of jobs.values()) {
        if (entry.handle) {
          entry.handle.stop();
          entry.handle = null;
        }
        entry.info.status = entry.config.enabled === false ? "disabled" : "idle";
        triggerJobStop({ config: entry.config });
      }
    },

    getJobs(): CronJobInfo[] {
      return [...jobs.values()].map((e) => e.info);
    },
  };
}

function canUseNativeBunCron(): boolean {
  const g = globalThis as Record<string, unknown>;
  const bunObj = g["Bun"] as Record<string, unknown> | undefined;
  if (!bunObj || typeof bunObj["cron"] !== "function") {
    return false;
  }

  // If the host has installed timer mocks or fake timers, prefer the
  // deterministic fallback runner so the cron scheduler stays inside the
  // host-controlled timing model instead of bypassing it with Bun.cron.
  if (
    globalThis.setTimeout !== DEFAULT_SET_TIMEOUT ||
    globalThis.clearTimeout !== DEFAULT_CLEAR_TIMEOUT
  ) {
    return false;
  }

  return true;
}

function triggerJobStop(job: Pick<JobState, "config"> | { config: CronJobConfig }): void {
  const onStop = job.config.onStop;
  if (!onStop) {
    return;
  }

  void Promise.resolve(onStop()).catch((error) => {
    const err = error instanceof Error ? error : new Error(String(error));
    job.config.onError?.(err);
  });
}

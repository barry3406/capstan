/**
 * Cron scheduler — Bun.cron native with setInterval-based Node.js fallback.
 */

import type { CronJobConfig, CronRunner, CronJobInfo } from "./types.js";

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
// Supports: "* * * * *" (every minute), "*/N * * * *" (every N minutes),
// "0 * * * *" (hourly), "0 0 * * *" (daily), "0 N * * *" (at hour N).
// This fallback is interval-based, not calendar-accurate. For weekday filters,
// timezones, or complex patterns, use Bun.cron directly via createBunCronRunner().
// ---------------------------------------------------------------------------

export function cronToMs(pattern: string): number {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length < 5) {
    throw new Error(`Invalid cron pattern: ${pattern}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every N minutes: "*/N * * * *"
  if (minute!.startsWith("*/") && hour === "*") {
    const n = parseInt(minute!.slice(2), 10);
    if (n > 0) return n * 60 * 1000;
  }

  // Every N hours: "0 */N * * *"
  if (minute === "0" && hour!.startsWith("*/")) {
    const n = parseInt(hour!.slice(2), 10);
    if (n > 0) return n * 60 * 60 * 1000;
  }

  // Every minute: "* * * * *"
  if (minute === "*" && hour === "*") {
    return 60 * 1000;
  }

  // Hourly: "N * * * *" (specific minute, every hour)
  if (minute !== "*" && !minute!.includes("/") && hour === "*") {
    return 60 * 60 * 1000;
  }

  // Daily: "N N * * *" (specific minute and hour)
  if (
    minute !== "*" &&
    !minute!.includes("/") &&
    hour !== "*" &&
    !hour!.includes("/") &&
    dayOfMonth === "*" &&
    month === "*"
  ) {
    // Check day-of-week filter
    if (dayOfWeek === "*") {
      return 24 * 60 * 60 * 1000; // Every day
    }
    // Weekday filter — fallback runner approximates as daily.
    return 24 * 60 * 60 * 1000;
  }

  // Default fallback: treat as hourly
  return 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Bun-native cron runner (optional — uses Bun.cron when available)
// ---------------------------------------------------------------------------

/**
 * Create a cron runner that uses Bun.cron natively.
 * Falls back to createCronRunner() in Node.js.
 */
export function createBunCronRunner(): CronRunner {
  // Check if Bun.cron is available
  const g = globalThis as Record<string, unknown>;
  const bunObj = g["Bun"] as Record<string, unknown> | undefined;
  if (bunObj && typeof bunObj["cron"] === "function") {
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
      }
    },

    getJobs(): CronJobInfo[] {
      return [...jobs.values()].map((e) => e.info);
    },
  };
}

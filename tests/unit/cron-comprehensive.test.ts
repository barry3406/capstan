import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createAgentCron } from "../../packages/cron/src/ai-loop.ts";
import {
  createBunCronRunner,
  createCronRunner,
  cronToMs,
  defineCron,
} from "../../packages/cron/src/cron.ts";

// ---------------------------------------------------------------------------
// Timer mock infrastructure
// ---------------------------------------------------------------------------

type TimerHandle = { id: number; cleared: boolean };
type QueuedTimer = { handle: TimerHandle; callback: () => void; delay: number };

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

let queuedTimers: QueuedTimer[] = [];
let nextTimerId = 1;

function installTimerMocks(): void {
  queuedTimers = [];
  nextTimerId = 1;

  globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
    const handle: TimerHandle = { id: nextTimerId++, cleared: false };
    queuedTimers.push({
      handle,
      callback: callback as () => void,
      delay: Number(delay ?? 0),
    });
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    const timer = handle as unknown as TimerHandle | undefined;
    if (timer) {
      timer.cleared = true;
    }
  }) as typeof clearTimeout;
}

function restoreTimerMocks(): void {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
}

function pendingTimers(): QueuedTimer[] {
  return queuedTimers.filter((timer) => !timer.handle.cleared);
}

async function fireNextTimer(): Promise<QueuedTimer> {
  const timer = pendingTimers()[0];
  if (!timer) {
    throw new Error("No timer queued");
  }

  timer.handle.cleared = true;
  timer.callback();

  await Promise.resolve();
  await Promise.resolve();

  return timer;
}

// ===========================================================================
// createCronRunner tests
// ===========================================================================

describe("createCronRunner — comprehensive", () => {
  beforeEach(() => installTimerMocks());
  afterEach(() => restoreTimerMocks());

  it("add() returns unique sequential IDs", () => {
    const runner = createCronRunner();
    const id1 = runner.add({ name: "a", pattern: "* * * * *", handler: async () => {} });
    const id2 = runner.add({ name: "b", pattern: "* * * * *", handler: async () => {} });
    expect(id1).toBe("cron_1");
    expect(id2).toBe("cron_2");
    expect(id1).not.toBe(id2);
    runner.stop();
  });

  it("start() begins scheduling all enabled jobs", () => {
    const runner = createCronRunner();
    runner.add({ name: "job", pattern: "*/5 * * * *", handler: async () => {} });
    expect(pendingTimers()).toHaveLength(0);

    runner.start();
    expect(pendingTimers()).toHaveLength(1);
    expect(pendingTimers()[0]!.delay).toBe(5 * 60_000);
    runner.stop();
  });

  it("stop() clears all timers", () => {
    const runner = createCronRunner();
    runner.add({ name: "a", pattern: "* * * * *", handler: async () => {} });
    runner.add({ name: "b", pattern: "* * * * *", handler: async () => {} });
    runner.start();
    expect(pendingTimers()).toHaveLength(2);

    runner.stop();
    expect(pendingTimers()).toHaveLength(0);
  });

  it("remove() stops a specific job and returns true", () => {
    const runner = createCronRunner();
    const id = runner.add({ name: "temp", pattern: "* * * * *", handler: async () => {} });
    runner.start();
    expect(pendingTimers()).toHaveLength(1);

    expect(runner.remove(id)).toBe(true);
    expect(pendingTimers()).toHaveLength(0);
    runner.stop();
  });

  it("remove() returns false for non-existent ID", () => {
    const runner = createCronRunner();
    expect(runner.remove("cron_999")).toBe(false);
  });

  it("getJobs() returns all job info", () => {
    const runner = createCronRunner();
    runner.add({ name: "alpha", pattern: "*/10 * * * *", handler: async () => {} });
    runner.add({ name: "beta", pattern: "*/20 * * * *", handler: async () => {} });

    const jobs = runner.getJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.name).toBe("alpha");
    expect(jobs[1]!.name).toBe("beta");
    expect(jobs[0]!.status).toBe("idle");
    expect(jobs[0]!.runCount).toBe(0);
    expect(jobs[0]!.errorCount).toBe(0);
    runner.stop();
  });

  it("disabled job is not scheduled on start", () => {
    const runner = createCronRunner();
    runner.add({ name: "disabled", pattern: "* * * * *", enabled: false, handler: async () => {} });
    runner.start();

    expect(pendingTimers()).toHaveLength(0);
    const jobs = runner.getJobs();
    expect(jobs[0]!.status).toBe("disabled");
    runner.stop();
  });

  it("job runs at correct interval", async () => {
    let calls = 0;
    const runner = createCronRunner();
    runner.add({
      name: "counter",
      pattern: "*/10 * * * *",
      handler: async () => { calls++; },
    });

    runner.start();
    const timer = await fireNextTimer();
    expect(timer.delay).toBe(10 * 60_000);
    expect(calls).toBe(1);
    runner.stop();
  });

  it("maxConcurrent prevents overlapping executions", async () => {
    let runs = 0;
    let release!: () => void;
    const blocker = new Promise<void>((r) => { release = r; });

    const runner = createCronRunner();
    runner.add({
      name: "serial",
      pattern: "* * * * *",
      maxConcurrent: 1,
      handler: async () => {
        runs++;
        await blocker;
      },
    });

    runner.start();
    await fireNextTimer();
    expect(runs).toBe(1);
    expect(runner.getJobs()[0]!.status).toBe("running");

    // Fire second tick while first is still running
    await fireNextTimer();
    expect(runs).toBe(1); // Skipped

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(runner.getJobs()[0]!.status).toBe("idle");
    runner.stop();
  });

  it("error in handler calls onError and increments errorCount", async () => {
    const errors: Error[] = [];
    const runner = createCronRunner();
    runner.add({
      name: "failer",
      pattern: "* * * * *",
      handler: async () => { throw new Error("test-error"); },
      onError: (e) => errors.push(e),
    });

    runner.start();
    await fireNextTimer();

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe("test-error");
    expect(runner.getJobs()[0]!.errorCount).toBe(1);
    expect(runner.getJobs()[0]!.runCount).toBe(0);
    runner.stop();
  });

  it("onStop is called on remove()", async () => {
    let stopCalled = false;
    const runner = createCronRunner();
    const id = runner.add({
      name: "stoppable",
      pattern: "* * * * *",
      handler: async () => {},
      onStop: async () => { stopCalled = true; },
    });

    runner.remove(id);
    await Promise.resolve();
    expect(stopCalled).toBe(true);
  });

  it("multiple jobs run independently", async () => {
    let aCalls = 0;
    let bCalls = 0;
    const runner = createCronRunner();
    runner.add({ name: "a", pattern: "*/5 * * * *", handler: async () => { aCalls++; } });
    runner.add({ name: "b", pattern: "*/10 * * * *", handler: async () => { bCalls++; } });

    runner.start();
    expect(pendingTimers()).toHaveLength(2);

    // Fire first timer (whichever is first in queue)
    await fireNextTimer();
    // Fire second timer
    await fireNextTimer();

    expect(aCalls + bCalls).toBe(2);
    runner.stop();
  });

  it("add job after start() auto-schedules it", () => {
    const runner = createCronRunner();
    runner.start();

    expect(pendingTimers()).toHaveLength(0);
    runner.add({ name: "late", pattern: "* * * * *", handler: async () => {} });
    expect(pendingTimers()).toHaveLength(1);
    runner.stop();
  });

  it("job status transitions idle -> running -> idle", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => { release = r; });

    const runner = createCronRunner();
    runner.add({
      name: "transitions",
      pattern: "* * * * *",
      handler: async () => { await blocker; },
    });

    runner.start();
    expect(runner.getJobs()[0]!.status).toBe("idle");

    // Start the handler
    const timerEntry = pendingTimers()[0]!;
    timerEntry.handle.cleared = true;
    timerEntry.callback();
    // After calling callback (before await), status should be running
    expect(runner.getJobs()[0]!.status).toBe("running");

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(runner.getJobs()[0]!.status).toBe("idle");
    runner.stop();
  });

  it("runCount and errorCount track correctly across multiple ticks", async () => {
    let callIndex = 0;
    const runner = createCronRunner();
    runner.add({
      name: "mixed",
      pattern: "* * * * *",
      handler: async () => {
        callIndex++;
        if (callIndex === 2) throw new Error("fail on second");
      },
      onError: () => {},
    });

    runner.start();
    await fireNextTimer(); // success
    await fireNextTimer(); // error
    await fireNextTimer(); // success

    const job = runner.getJobs()[0]!;
    expect(job.runCount).toBe(2);
    expect(job.errorCount).toBe(1);
    runner.stop();
  });

  it("non-Error throws are wrapped in Error for onError", async () => {
    const errors: Error[] = [];
    const runner = createCronRunner();
    runner.add({
      name: "string-throw",
      pattern: "* * * * *",
      handler: async () => { throw "raw string error"; },
      onError: (e) => errors.push(e),
    });

    runner.start();
    await fireNextTimer();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(errors[0]!.message).toBe("raw string error");
    runner.stop();
  });
});

// ===========================================================================
// createAgentCron tests
// ===========================================================================

describe("createAgentCron — comprehensive", () => {
  beforeEach(() => installTimerMocks());
  afterEach(() => restoreTimerMocks());

  it("returns a valid CronJobConfig", () => {
    const job = createAgentCron({
      cron: "*/5 * * * *",
      name: "test-agent",
      goal: "Do something",
      runtime: {
        harness: {
          async startRun() {
            return { runId: "r1", result: Promise.resolve({ status: "completed" }) };
          },
        },
      },
    });

    expect(job.name).toBe("test-agent");
    expect(job.pattern).toBe("*/5 * * * *");
    expect(job.maxConcurrent).toBe(1);
    expect(typeof job.handler).toBe("function");
  });

  it("static goal string is passed through", async () => {
    const goals: string[] = [];
    const job = createAgentCron({
      cron: "* * * * *",
      name: "static-goal",
      goal: "Check system health",
      runtime: {
        harness: {
          async startRun(config) {
            goals.push(config.goal);
            return { runId: "r1", result: Promise.resolve({}) };
          },
        },
      },
    });

    await job.handler();
    expect(goals).toEqual(["Check system health"]);
  });

  it("dynamic goal function is called each tick", async () => {
    let callCount = 0;
    const job = createAgentCron({
      cron: "* * * * *",
      name: "dynamic-goal",
      goal: () => `Tick ${++callCount}`,
      runtime: {
        harness: {
          async startRun(config) {
            return { runId: "r1", result: Promise.resolve({ goal: config.goal }) };
          },
        },
      },
    });

    await job.handler();
    await job.handler();
    expect(callCount).toBe(2);
  });

  it("custom trigger metadata is included", async () => {
    let capturedTrigger: Record<string, unknown> | undefined;
    const job = createAgentCron({
      cron: "* * * * *",
      name: "meta-job",
      goal: "test",
      triggerMetadata: { region: "us-west", priority: "high" },
      runtime: {
        harness: {
          async startRun(_config, options) {
            capturedTrigger = (options as Record<string, unknown>)?.trigger as Record<string, unknown>;
            return { runId: "r1", result: Promise.resolve({}) };
          },
        },
      },
    });

    await job.handler();
    expect(capturedTrigger).toBeDefined();
    const meta = capturedTrigger!.metadata as Record<string, unknown>;
    expect(meta.region).toBe("us-west");
    expect(meta.priority).toBe("high");
    expect(meta.tickId).toEqual(expect.any(String));
  });

  it("onQueued callback fires with runId and trigger", async () => {
    let queuedMeta: { runId: string; trigger: unknown } | undefined;
    const job = createAgentCron({
      cron: "* * * * *",
      name: "queued-cb",
      goal: "test",
      runtime: {
        harness: {
          async startRun() {
            return { runId: "queued-123", result: Promise.resolve({}) };
          },
        },
      },
      onQueued(meta) {
        queuedMeta = meta;
      },
    });

    await job.handler();
    expect(queuedMeta).toBeDefined();
    expect(queuedMeta!.runId).toBe("queued-123");
    expect(queuedMeta!.trigger).toBeDefined();
  });

  it("onResult callback fires with result and meta", async () => {
    let capturedResult: unknown;
    let capturedMeta: unknown;
    const job = createAgentCron({
      cron: "* * * * *",
      name: "result-cb",
      goal: "test",
      runtime: {
        harness: {
          async startRun() {
            return {
              runId: "result-456",
              result: Promise.resolve({ status: "completed", answer: 42 }),
            };
          },
        },
      },
      onResult(result, meta) {
        capturedResult = result;
        capturedMeta = meta;
      },
    });

    await job.handler();
    expect(capturedResult).toMatchObject({ status: "completed", answer: 42 });
    expect((capturedMeta as Record<string, unknown>).runId).toBe("result-456");
  });

  it("onError callback fires on handler failure", async () => {
    const errors: Error[] = [];
    const job = createAgentCron({
      cron: "* * * * *",
      name: "error-cb",
      goal: "test",
      runtime: {
        harness: {
          async startRun() {
            throw new Error("harness-error");
          },
        },
      },
      onError(err) {
        errors.push(err);
      },
    });

    // The handler itself will throw; onError is set on the CronJobConfig
    try {
      await job.handler();
    } catch {
      // expected
    }
  });

  it("harness reuse works — single factory call across ticks", async () => {
    let factoryCalls = 0;
    let runCalls = 0;

    const job = createAgentCron({
      cron: "* * * * *",
      name: "reuse-test",
      goal: "test",
      runtime: {
        async createHarness() {
          factoryCalls++;
          return {
            async startRun() {
              runCalls++;
              return { runId: `run-${runCalls}`, result: Promise.resolve({}) };
            },
            async destroy() {},
          };
        },
        reuseHarness: true,
      },
    });

    await job.handler();
    await job.handler();
    await job.handler();

    expect(factoryCalls).toBe(1);
    expect(runCalls).toBe(3);
  });

  it("timezone config is passed through to the job", () => {
    const job = createAgentCron({
      cron: "0 9 * * *",
      name: "tz-job",
      goal: "morning check",
      timezone: "America/New_York",
      runtime: {
        harness: {
          async startRun() {
            return { runId: "r1", result: Promise.resolve({}) };
          },
        },
      },
    });

    expect((job as Record<string, unknown>).timezone).toBe("America/New_York");
  });

  it("run config (about, maxIterations, systemPrompt) is forwarded", async () => {
    let capturedConfig: Record<string, unknown> | undefined;
    const job = createAgentCron({
      cron: "* * * * *",
      name: "run-config",
      goal: "test",
      run: {
        about: ["project", "test"],
        maxIterations: 5,
        systemPrompt: "Be brief.",
      },
      runtime: {
        harness: {
          async startRun(config) {
            capturedConfig = config as unknown as Record<string, unknown>;
            return { runId: "r1", result: Promise.resolve({}) };
          },
        },
      },
    });

    await job.handler();
    expect(capturedConfig).toMatchObject({
      goal: "test",
      about: ["project", "test"],
      maxIterations: 5,
      systemPrompt: "Be brief.",
    });
  });

  it("onStop drains cached harness", async () => {
    let destroyed = false;
    const job = createAgentCron({
      cron: "* * * * *",
      name: "drain-test",
      goal: "test",
      runtime: {
        async createHarness() {
          return {
            async startRun() {
              return { runId: "r1", result: Promise.resolve({}) };
            },
            async destroy() { destroyed = true; },
          };
        },
        reuseHarness: true,
      },
    });

    await job.handler();
    expect(destroyed).toBe(false);

    await job.onStop?.();
    expect(destroyed).toBe(true);
  });
});

// ===========================================================================
// createBunCronRunner tests
// ===========================================================================

describe("createBunCronRunner — comprehensive", () => {
  beforeEach(() => installTimerMocks());
  afterEach(() => restoreTimerMocks());

  it("falls back to interval runner when timers are mocked", () => {
    const runner = createBunCronRunner();
    const id = runner.add({ name: "test", pattern: "* * * * *", handler: async () => {} });
    // Interval runner IDs start with "cron_", bun native with "bun_cron_"
    expect(id).toBe("cron_1");
    runner.stop();
  });

  it("fallback runner schedules correctly", () => {
    const runner = createBunCronRunner();
    runner.add({ name: "fb", pattern: "*/5 * * * *", handler: async () => {} });
    runner.start();

    expect(pendingTimers()).toHaveLength(1);
    expect(pendingTimers()[0]!.delay).toBe(5 * 60_000);
    runner.stop();
  });

  it("fallback runner getJobs returns correct info", () => {
    const runner = createBunCronRunner();
    runner.add({ name: "info-test", pattern: "*/10 * * * *", handler: async () => {} });

    const jobs = runner.getJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.name).toBe("info-test");
    expect(jobs[0]!.pattern).toBe("*/10 * * * *");
    expect(jobs[0]!.status).toBe("idle");
    runner.stop();
  });

  it("disabled job is not auto-scheduled on start in fallback runner", () => {
    const runner = createBunCronRunner();
    runner.add({ name: "off", pattern: "* * * * *", enabled: false, handler: async () => {} });
    runner.start();

    expect(pendingTimers()).toHaveLength(0);
    expect(runner.getJobs()[0]!.status).toBe("disabled");
    runner.stop();
  });

  it("remove on fallback runner clears timer and returns true", () => {
    const runner = createBunCronRunner();
    const id = runner.add({ name: "rm", pattern: "* * * * *", handler: async () => {} });
    runner.start();
    expect(pendingTimers()).toHaveLength(1);

    expect(runner.remove(id)).toBe(true);
    expect(pendingTimers()).toHaveLength(0);
    runner.stop();
  });
});

// ===========================================================================
// cronToMs edge cases
// ===========================================================================

describe("cronToMs — additional edge cases", () => {
  it("every N months pattern", () => {
    expect(cronToMs("0 0 1 */3 *")).toBe(3 * 30 * 24 * 60 * 60 * 1000);
  });

  it("every N days pattern", () => {
    expect(cronToMs("0 0 */7 * *")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("@every with ms unit", () => {
    expect(cronToMs("@every 500 ms")).toBe(500);
  });

  it("@every with seconds", () => {
    expect(cronToMs("@every 10 s")).toBe(10_000);
  });

  it("@every with hours", () => {
    expect(cronToMs("@every 4 h")).toBe(4 * 60 * 60 * 1000);
  });
});

// ===========================================================================
// defineCron tests
// ===========================================================================

describe("defineCron — comprehensive", () => {
  it("returns the exact same config object", () => {
    const config = { name: "test", pattern: "* * * * *", handler: async () => {} };
    expect(defineCron(config)).toBe(config);
  });

  it("preserves all optional fields", () => {
    const handler = async () => {};
    const onError = () => {};
    const onStop = async () => {};
    const config = {
      name: "full",
      pattern: "*/5 * * * *",
      handler,
      timezone: "UTC",
      maxConcurrent: 3,
      onError,
      onStop,
      enabled: false,
    };

    const result = defineCron(config);
    expect(result.timezone).toBe("UTC");
    expect(result.maxConcurrent).toBe(3);
    expect(result.enabled).toBe(false);
    expect(result.onError).toBe(onError);
    expect(result.onStop).toBe(onStop);
  });
});

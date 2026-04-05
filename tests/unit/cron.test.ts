import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createAgentCron } from "../../packages/cron/src/ai-loop.ts";
import {
  createBunCronRunner,
  createCronRunner,
  cronToMs,
  defineCron,
} from "../../packages/cron/src/cron.ts";

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

describe("capstan-cron", () => {
  beforeEach(() => {
    installTimerMocks();
  });

  afterEach(() => {
    restoreTimerMocks();
  });

  it("defineCron returns the original config", () => {
    const config = {
      name: "heartbeat",
      pattern: "*/5 * * * *",
      handler: async () => {},
    };

    expect(defineCron(config)).toBe(config);
  });

  it("cronToMs handles the supported interval patterns", () => {
    expect(cronToMs("* * * * *")).toBe(60_000);
    expect(cronToMs("*/15 * * * *")).toBe(15 * 60_000);
    expect(cronToMs("0 */2 * * *")).toBe(2 * 60 * 60_000);
    expect(cronToMs("30 9 * * *")).toBe(24 * 60 * 60_000);
    expect(() => cronToMs("* * *")).toThrow("Invalid cron pattern");
  });

  it("createCronRunner schedules jobs when started and records successful runs", async () => {
    let calls = 0;
    const runner = createCronRunner();

    runner.add({
      name: "heartbeat",
      pattern: "*/5 * * * *",
      handler: async () => {
        calls++;
      },
    });

    runner.start();

    expect(pendingTimers()).toHaveLength(1);
    expect(pendingTimers()[0]?.delay).toBe(5 * 60_000);

    await fireNextTimer();

    const job = runner.getJobs()[0]!;
    expect(calls).toBe(1);
    expect(job.runCount).toBe(1);
    expect(job.status).toBe("idle");
    expect(job.lastRun).toBeInstanceOf(Date);
    expect(pendingTimers()).toHaveLength(1);

    runner.stop();
  });

  it("createCronRunner respects maxConcurrent and skips overlapping ticks", async () => {
    let runs = 0;
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    const runner = createCronRunner();
    runner.add({
      name: "serial-job",
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

    await fireNextTimer();
    expect(runs).toBe(1);

    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(runner.getJobs()[0]!.status).toBe("idle");
    runner.stop();
  });

  it("createCronRunner records handler errors and forwards them to onError", async () => {
    const errors: Error[] = [];
    const runner = createCronRunner();

    runner.add({
      name: "failing-job",
      pattern: "* * * * *",
      handler: async () => {
        throw new Error("boom");
      },
      onError: (err) => {
        errors.push(err);
      },
    });

    runner.start();
    await fireNextTimer();

    const job = runner.getJobs()[0]!;
    expect(job.errorCount).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("boom");

    runner.stop();
  });

  it("createBunCronRunner returns a usable runner in the current runtime", () => {
    const runner = createBunCronRunner();
    const id = runner.add({
      name: "native-job",
      pattern: "0 0 1 1 *",
      handler: async () => {},
    });

    expect(["bun_cron_1", "cron_1"]).toContain(id);
    expect(runner.getJobs()[0]).toMatchObject({
      id,
      name: "native-job",
      status: "idle",
    });

    runner.start();
    expect(runner.getJobs()[0]!.status).toBe("idle");

    runner.stop();
    expect(runner.getJobs()[0]!.status).toBe("idle");
  });

  it("createBunCronRunner falls back to the deterministic runner when timers are mocked", () => {
    const runner = createBunCronRunner();
    const id = runner.add({
      name: "mocked-timer-job",
      pattern: "* * * * *",
      handler: async () => {},
    });

    expect(id).toBe("cron_1");
    runner.start();
    expect(pendingTimers()).toHaveLength(1);
    runner.stop();
  });

  it("createCronRunner invokes job cleanup hooks when jobs stop or are removed", async () => {
    let stopCalls = 0;
    const runner = createCronRunner();

    const removedId = runner.add({
      name: "removed-job",
      pattern: "* * * * *",
      handler: async () => {},
      onStop: async () => {
        stopCalls++;
      },
    });

    const stoppedId = runner.add({
      name: "stopped-job",
      pattern: "* * * * *",
      handler: async () => {},
      onStop: async () => {
        stopCalls++;
      },
    });

    expect(runner.remove(removedId)).toBe(true);
    await Promise.resolve();
    expect(stopCalls).toBe(1);

    runner.start();
    runner.stop();
    await Promise.resolve();
    expect(stopCalls).toBe(2);

    expect(runner.remove(stoppedId)).toBe(true);
    await Promise.resolve();
    expect(stopCalls).toBe(3);
  });

  it("createAgentCron runs a harness-backed agent loop and forwards the result", async () => {
    let capturedResult: unknown;

    const harness = {
      async startRun(config: Record<string, unknown>, options?: Record<string, unknown>) {
        expect(config).toMatchObject({
          goal: "Summarize the latest status",
          maxIterations: 20,
        });
        expect(options).toMatchObject({
          trigger: {
            type: "cron",
            source: "agent-job",
            schedule: {
              name: "agent-job",
              pattern: "0 */2 * * *",
            },
          },
        });
        return {
          runId: "harness-run-cron",
          result: Promise.resolve({
            status: "completed",
            result: "done",
            iterations: 1,
          }),
        };
      },
      async destroy() {},
    };

    const job = createAgentCron({
      cron: "0 */2 * * *",
      name: "agent-job",
      goal: () => "Summarize the latest status",
      runtime: { harness },
      onResult: (result) => {
        capturedResult = result;
      },
    });

    expect(job.pattern).toBe("0 */2 * * *");
    expect(job.maxConcurrent).toBe(1);

    await job.handler();

    expect(capturedResult).toMatchObject({
      status: "completed",
      result: "done",
      iterations: 1,
    });
  });

  it("createAgentCron submits runs into a provided harness runtime with cron trigger metadata", async () => {
    const startCalls: Array<{
      config: Record<string, unknown>;
      options: Record<string, unknown> | undefined;
    }> = [];
    let queuedRunId = "";
    let resultMeta: Record<string, unknown> | undefined;

    const harness = {
      async startRun(
        config: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) {
        startCalls.push({ config, options });
        return {
          runId: "harness-run-cron",
          result: Promise.resolve({
            status: "completed",
            result: "from-runtime",
            iterations: 3,
          }),
        };
      },
      async destroy() {
        throw new Error("external harness should not be destroyed by cron");
      },
    };

    const job = createAgentCron({
      cron: "0 */2 * * *",
      name: "runtime-backed-cron",
      timezone: "Asia/Shanghai",
      goal: () => "Summarize the latest status",
      run: {
        about: ["project", "capstan"],
        maxIterations: 7,
        systemPrompt: "Stay concise.",
      },
      runtime: {
        harness,
      },
      triggerMetadata: {
        shard: "cn-east",
      },
      onQueued(meta) {
        queuedRunId = meta.runId;
      },
      onResult(_result, meta) {
        resultMeta = meta as Record<string, unknown>;
      },
    });

    await job.handler();

    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]!.config).toMatchObject({
      goal: "Summarize the latest status",
      about: ["project", "capstan"],
      maxIterations: 7,
      systemPrompt: "Stay concise.",
    });
    expect(startCalls[0]!.options).toMatchObject({
      trigger: {
        type: "cron",
        source: "runtime-backed-cron",
        schedule: {
          name: "runtime-backed-cron",
          pattern: "0 */2 * * *",
          timezone: "Asia/Shanghai",
        },
        metadata: {
          shard: "cn-east",
        },
      },
    });
    expect(
      ((startCalls[0]!.options?.trigger as Record<string, unknown>).metadata as Record<string, unknown>)
        .tickId,
    ).toEqual(expect.any(String));
    expect(queuedRunId).toBe("harness-run-cron");
    expect(resultMeta).toMatchObject({
      runId: "harness-run-cron",
      trigger: {
        type: "cron",
        source: "runtime-backed-cron",
      },
    });
  });

  it("createAgentCron reuses a factory-created harness until the job stops", async () => {
    let factoryCalls = 0;
    let destroyCalls = 0;
    let runCount = 0;

    const sharedHarness = {
      async startRun() {
        runCount++;
        return {
          runId: `shared-run-${runCount}`,
          result: Promise.resolve({
            status: "completed",
            result: runCount,
            iterations: 1,
          }),
        };
      },
      async destroy() {
        destroyCalls++;
      },
    };

    const job = createAgentCron({
      cron: "*/10 * * * *",
      name: "shared-runtime-cron",
      goal: "noop",
      runtime: {
        async createHarness() {
          factoryCalls++;
          return sharedHarness;
        },
        reuseHarness: true,
      },
    });

    await job.handler();
    await job.handler();

    expect(factoryCalls).toBe(1);
    expect(destroyCalls).toBe(0);
    await job.onStop?.();
    expect(destroyCalls).toBe(1);
    await job.onStop?.();
    expect(destroyCalls).toBe(1);
  });

  it("createAgentCron can create and dispose harnesses per tick when reuseHarness is false", async () => {
    let factoryCalls = 0;
    let destroyCalls = 0;

    const job = createAgentCron({
      cron: "*/15 * * * *",
      name: "ephemeral-runtime-cron",
      goal: "noop",
      runtime: {
        async createHarness() {
          factoryCalls++;
          return {
            async startRun() {
              return {
                runId: `ephemeral-run-${factoryCalls}`,
                result: Promise.resolve({
                  status: "completed",
                  result: "ok",
                  iterations: 1,
                }),
              };
            },
            async destroy() {
              destroyCalls++;
            },
          };
        },
        reuseHarness: false,
      },
    });

    await job.handler();
    await job.handler();

    expect(factoryCalls).toBe(2);
    expect(destroyCalls).toBe(2);
    await job.onStop?.();
    expect(destroyCalls).toBe(2);
  });
});

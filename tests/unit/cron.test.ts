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

  it("createAgentCron runs a harness-backed agent loop and forwards the result", async () => {
    let capturedResult: unknown;

    const llm = {
      name: "mock",
      async chat() {
        return {
          content: "done",
          model: "mock-1",
        };
      },
    };

    const job = createAgentCron({
      cron: "0 */2 * * *",
      name: "agent-job",
      goal: () => "Summarize the latest status",
      llm,
      harnessConfig: {
        verify: { enabled: false },
      },
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
});

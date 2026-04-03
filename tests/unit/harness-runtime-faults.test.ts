import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type {
  BrowserSandbox,
  BrowserSession,
  HarnessConfig,
  HarnessSandboxDriver,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "../../packages/ai/src/index.ts";
import { createHarness } from "../../packages/ai/src/harness/index.ts";
import { openHarnessRuntime } from "../../packages/ai/src/harness/runtime/control-plane.ts";
import { FileHarnessRuntimeStore } from "../../packages/ai/src/harness/runtime/store.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function mockLLM(
  responses: Array<string | Error | (() => Promise<string> | string)>,
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const next = responses[callIndex++];
      if (next instanceof Error) {
        throw next;
      }
      const content =
        typeof next === "function" ? await next() : (next ?? "done");
      return { content, model: "mock-1" };
    },
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-runtime-faults-"));
  tempDirs.push(dir);
  return dir;
}

async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs = 1_000,
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await fn();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for condition");
}

function lifecycleEventTypes(events: Array<{ type: string }>): string[] {
  return events
    .map((event) => event.type)
    .filter(
      (type) =>
        type !== "memory_stored" &&
        type !== "summary_created" &&
        type !== "context_compacted",
    );
}

class FaultInjectingStore extends FileHarnessRuntimeStore {
  private persistRunCalls = 0;
  private persistCheckpointCalls = 0;
  private failNextArtifactBookkeepingTransition = false;

  constructor(
    rootDir: string,
    private readonly faults: {
      failPersistRunAt?: number;
      failPersistCheckpointAt?: number;
      failTransitionAfterArtifact?: boolean;
    } = {},
  ) {
    super(rootDir);
  }

  override async persistRun(run: Parameters<FileHarnessRuntimeStore["persistRun"]>[0]) {
    this.persistRunCalls++;
    if (this.persistRunCalls === this.faults.failPersistRunAt) {
      throw new Error("run persistence failed");
    }
    await super.persistRun(run);
  }

  override async persistCheckpoint(
    runId: string,
    checkpoint: Parameters<FileHarnessRuntimeStore["persistCheckpoint"]>[1],
  ) {
    this.persistCheckpointCalls++;
    if (this.persistCheckpointCalls === this.faults.failPersistCheckpointAt) {
      throw new Error("checkpoint persistence failed");
    }
    return super.persistCheckpoint(runId, checkpoint);
  }

  override async writeArtifact(
    runId: string,
    input: Parameters<FileHarnessRuntimeStore["writeArtifact"]>[1],
  ) {
    const artifact = await super.writeArtifact(runId, input);
    if (this.faults.failTransitionAfterArtifact) {
      this.failNextArtifactBookkeepingTransition = true;
    }
    return artifact;
  }

  override async transitionRun(
    runId: string,
    type: Parameters<FileHarnessRuntimeStore["transitionRun"]>[1],
    patch: Parameters<FileHarnessRuntimeStore["transitionRun"]>[2],
    data: Parameters<FileHarnessRuntimeStore["transitionRun"]>[3],
  ) {
    if (this.failNextArtifactBookkeepingTransition && type === "artifact_created") {
      this.failNextArtifactBookkeepingTransition = false;
      throw new Error("artifact bookkeeping failed");
    }
    return super.transitionRun(runId, type, patch, data);
  }
}

class ScreenshotSession implements BrowserSession {
  async goto(_url: string): Promise<void> {}
  async screenshot(): Promise<Buffer> {
    return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  }
  async screenshotElement(_selector: string): Promise<Buffer> {
    return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  }
  async evaluate<T>(_fn: string): Promise<T> {
    return undefined as T;
  }
  async click(_x: number, _y: number): Promise<void> {}
  async type(_selector: string, _text: string): Promise<void> {}
  async scroll(_direction: "up" | "down", _amount?: number): Promise<void> {}
  async waitForNavigation(_timeout?: number): Promise<void> {}
  url(): string {
    return "https://example.com/report";
  }
  async close(): Promise<void> {}
}

class ScreenshotBrowserSandbox implements BrowserSandbox {
  readonly session = new ScreenshotSession();
  async act(_goal: string): Promise<[]> {
    return [];
  }
  async destroy(): Promise<void> {}
}

class BrowserDriver implements HarnessSandboxDriver {
  readonly name = "browser-driver";

  async createContext(
    _config: HarnessConfig,
    runtime: { artifactDir: string },
  ) {
    const browser = new ScreenshotBrowserSandbox();
    return {
      mode: "browser",
      artifactDir: runtime.artifactDir,
      browser,
      fs: null,
      async destroy(): Promise<void> {
        await browser.destroy();
      },
    };
  }
}

class FailingCleanupDriver implements HarnessSandboxDriver {
  readonly name = "failing-cleanup";

  constructor(
    private readonly faults: {
      abortError?: Error;
      destroyError?: Error;
    } = {},
  ) {}

  async createContext(
    _config: HarnessConfig,
    runtime: { artifactDir: string },
  ) {
    const faults = this.faults;
    return {
      mode: "faulty",
      artifactDir: runtime.artifactDir,
      browser: null,
      fs: null,
      async abort(): Promise<void> {
        if (faults.abortError) {
          throw faults.abortError;
        }
      },
      async destroy(): Promise<void> {
        if (faults.destroyError) {
          throw faults.destroyError;
        }
      },
    };
  }
}

describe("createHarness runtime fault handling", () => {
  it("rolls back startRun bookkeeping when initial run persistence fails", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["done"]),
      runtime: {
        rootDir,
        storeFactory: (dir) =>
          new FaultInjectingStore(dir, { failPersistRunAt: 1 }),
      },
      verify: { enabled: false },
    });

    await expect(harness.run({ goal: "fail before start" })).rejects.toThrow(
      "run persistence failed",
    );
    expect(await harness.listRuns()).toEqual([]);
  });

  it("marks the run failed coherently when checkpoint persistence throws during execution", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["done"]),
      runtime: {
        rootDir,
        storeFactory: (dir) =>
          new FaultInjectingStore(dir, { failPersistCheckpointAt: 2 }),
      },
      verify: { enabled: false },
    });

    await expect(harness.run({ goal: "checkpoint failure" })).rejects.toThrow(
      "checkpoint persistence failed",
    );

    const runs = await harness.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.error).toBe("checkpoint persistence failed");
    expect(runs[0]?.checkpointUpdatedAt).toBeString();

    const events = await harness.getEvents(runs[0]!.id);
    expect(lifecycleEventTypes(events)).toEqual([
      "run_started",
      "run_failed",
    ]);
  });

  it("surfaces artifact bookkeeping failures as tool errors after artifact persistence", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "browser_screenshot", arguments: {} }),
      ]),
      runtime: {
        rootDir,
        driver: new BrowserDriver(),
        storeFactory: (dir) =>
          new FaultInjectingStore(dir, { failTransitionAfterArtifact: true }),
      },
      sandbox: { browser: true },
      verify: { enabled: false },
    });

    const result = await harness.run({ goal: "capture one screenshot" });
    expect(result.runtimeStatus).toBe("completed");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.result).toEqual({
      error: "artifact bookkeeping failed",
    });

    const runs = await harness.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("completed");
    expect(runs[0]?.artifactIds).toHaveLength(1);

    const artifacts = await harness.getArtifacts(runs[0]!.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.kind).toBe("screenshot");
    expect(await readFile(artifacts[0]!.path)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    const events = await harness.getEvents(runs[0]!.id);
    expect(lifecycleEventTypes(events)).toEqual([
      "run_started",
      "tool_call",
      "tool_result",
      "run_completed",
    ]);
  });

  it("still returns canceled when the active sandbox abort hook throws", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        driver: new FailingCleanupDriver({
          abortError: new Error("abort hook failed"),
        }),
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            await runtime.cancelRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
    });

    const canceled = await harness.run({
      goal: "cancel despite abort failure",
      tools: [
        {
          name: "step",
          description: "records a step",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });

    expect(canceled.runtimeStatus).toBe("canceled");
    expect((await harness.getRun(canceled.runId))?.status).toBe("canceled");
  });

  it("preserves the original completed outcome when sandbox destroy throws during final cleanup", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["done"]),
      runtime: {
        rootDir,
        driver: new FailingCleanupDriver({
          destroyError: new Error("destroy hook failed"),
        }),
      },
      verify: { enabled: false },
    });

    const result = await harness.run({ goal: "complete despite destroy failure" });

    expect(result.runtimeStatus).toBe("completed");
    expect((await harness.getRun(result.runId))?.status).toBe("completed");
  });

  it("still finalizes paused runs as canceled when suspended sandbox destroy throws", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        driver: new FailingCleanupDriver({
          destroyError: new Error("destroy hook failed"),
        }),
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            await runtime.pauseRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
    });

    const paused = await harness.run({
      goal: "pause before cancel",
      tools: [
        {
          name: "step",
          description: "records a step",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });
    expect(paused.runtimeStatus).toBe("paused");

    const canceled = await harness.cancelRun(paused.runId);
    expect(canceled.status).toBe("canceled");
    expect((await harness.getRun(paused.runId))?.status).toBe("canceled");
  });

  it("resolves destroy() even when active abort hooks throw", async () => {
    const rootDir = await createTempDir();
    let release!: () => void;
    const gate = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "hold", arguments: {} }),
        "done",
      ]),
      runtime: {
        rootDir,
        driver: new FailingCleanupDriver({
          abortError: new Error("abort hook failed"),
        }),
      },
      verify: { enabled: false },
    });

    const handle = await harness.startRun({
      goal: "destroy active run",
      tools: [
        {
          name: "hold",
          description: "holds the run open",
          async execute() {
            await gate;
            return { released: true };
          },
        },
      ],
    });

    await waitFor(async () => {
      const run = await harness.getRun(handle.runId);
      return run?.status === "running" ? run : undefined;
    });

    const destroyPromise = harness.destroy();
    release();
    await expect(destroyPromise).resolves.toBeUndefined();

    const result = await handle.result;
    expect(result.runtimeStatus).toBe("canceled");
  });

  it("resolves destroy() even when suspended sandbox cleanup throws", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        driver: new FailingCleanupDriver({
          destroyError: new Error("destroy hook failed"),
        }),
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            await runtime.pauseRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
    });

    const paused = await harness.run({
      goal: "pause then destroy",
      tools: [
        {
          name: "step",
          description: "records a step",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });
    expect(paused.runtimeStatus).toBe("paused");

    await expect(harness.destroy()).resolves.toBeUndefined();
  });
});

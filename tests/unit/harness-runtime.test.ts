import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createHarnessGrantAuthorizer,
  grantApprovalActions,
  grantRunActions,
  grantRunCollectionActions,
} from "@zauso-ai/capstan-auth";
import { createHarness, openHarnessRuntime } from "@zauso-ai/capstan-ai";
import type {
  BrowserSandbox,
  BrowserSession,
  HarnessConfig,
  HarnessSandboxDriver,
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "@zauso-ai/capstan-ai";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function mockLLM(responses: Array<string | Error | (() => Promise<string> | string)>): LLMProvider {
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
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-"));
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

function createGrantAuthorizer(getGrants: () => ReadonlyArray<string | Record<string, unknown>>) {
  return createHarnessGrantAuthorizer(getGrants);
}

class FakeBrowserSession implements BrowserSession {
  private currentUrl = "about:blank";

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
  }

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
    return this.currentUrl;
  }

  async close(): Promise<void> {}
}

class FakeBrowserSandbox implements BrowserSandbox {
  readonly session = new FakeBrowserSession();

  async act(_goal: string): Promise<[]> {
    return [];
  }

  async destroy(): Promise<void> {}
}

class FakeBrowserDriver implements HarnessSandboxDriver {
  readonly name = "fake-browser";

  async createContext(
    _config: HarnessConfig,
    runtime: { artifactDir: string },
  ) {
    return {
      mode: "fake",
      artifactDir: runtime.artifactDir,
      browser: new FakeBrowserSandbox(),
      fs: null,
      async destroy(): Promise<void> {},
    };
  }
}

type TrackingBrowserState = {
  createCount: number;
  destroyCount: number;
  currentUrl: string;
};

class TrackingBrowserSession implements BrowserSession {
  constructor(private readonly state: TrackingBrowserState) {
    this.state.createCount++;
  }

  async goto(url: string): Promise<void> {
    this.state.currentUrl = url;
  }

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
    return this.state.currentUrl;
  }

  async close(): Promise<void> {}
}

class TrackingBrowserSandbox implements BrowserSandbox {
  readonly session: BrowserSession;

  constructor(private readonly state: TrackingBrowserState) {
    this.session = new TrackingBrowserSession(state);
  }

  async act(_goal: string): Promise<[]> {
    return [];
  }

  async destroy(): Promise<void> {
    this.state.destroyCount++;
  }
}

class TrackingBrowserDriver implements HarnessSandboxDriver {
  readonly name = "tracking-browser";

  constructor(private readonly state: TrackingBrowserState) {}

  async createContext(
    _config: HarnessConfig,
    runtime: { artifactDir: string },
  ) {
    const sandbox = new TrackingBrowserSandbox(this.state);
    return {
      mode: "tracking",
      artifactDir: runtime.artifactDir,
      browser: sandbox,
      fs: null,
      async destroy(): Promise<void> {
        await sandbox.destroy();
      },
    };
  }
}

describe("createHarness runtime substrate", () => {
  it("persists successful runs, runtime events, and replay state", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "add", arguments: { a: 2, b: 3 } }),
        "sum complete",
      ]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "add two numbers",
      tools: [
        {
          name: "add",
          description: "adds two numbers",
          async execute(args) {
            return (args.a as number) + (args.b as number);
          },
        },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.runtimeStatus).toBe("completed");
    expect(result.runId).toStartWith("harness-run-");
    expect(result.artifactIds).toEqual([]);

    const run = await harness.getRun(result.runId);
    expect(run).toBeDefined();
    expect(run!.status).toBe("completed");
    expect(run!.iterations).toBe(2);
    expect(run!.toolCalls).toBe(1);
    expect(run!.toolNames).toContain("add");

    const events = await harness.getEvents(result.runId);
    expect(lifecycleEventTypes(events)).toEqual([
      "run_started",
      "tool_call",
      "tool_result",
      "run_completed",
    ]);
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );

    const replay = await harness.replayRun(result.runId);
    expect(replay.consistent).toBe(true);
    expect(replay.derivedStatus).toBe("completed");
    expect(replay.derivedIterations).toBe(2);
    expect(replay.derivedToolCalls).toBe(1);
  });

  it("marks max-iteration runs as terminal runtime state", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(
        Array.from({ length: 6 }, () =>
          JSON.stringify({ tool: "noop", arguments: {} }),
        ),
      ),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "never stop",
      maxIterations: 3,
      tools: [
        {
          name: "noop",
          description: "does nothing",
          async execute() {
            return "ok";
          },
        },
      ],
    });

    expect(result.status).toBe("max_iterations");
    expect(result.runtimeStatus).toBe("max_iterations");

    const run = await harness.getRun(result.runId);
    expect(run!.status).toBe("max_iterations");
    expect(run!.iterations).toBe(3);
    expect(run!.toolCalls).toBe(3);

    const events = await harness.getEvents(result.runId);
    expect(lifecycleEventTypes(events).at(-1)).toBe("run_max_iterations");
  });

  it("persists approval_required checkpoints when policy blocks a tool call", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "delete", arguments: { id: "123" } }),
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async ({ tool }) => ({
          allowed: false,
          reason: `${tool} requires human approval`,
        }),
      },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "delete a record",
      tools: [
        {
          name: "delete",
          description: "deletes a record",
          async execute() {
            return "deleted";
          },
        },
      ],
    });

    expect(result.status).toBe("approval_required");
    expect(result.runtimeStatus).toBe("approval_required");

    const run = await harness.getRun(result.runId);
    expect(run!.status).toBe("approval_required");
    expect(run!.pendingApproval).toEqual({
      id: run!.pendingApproval!.id,
      kind: "tool",
      tool: "delete",
      args: { id: "123" },
      reason: "delete requires human approval",
      requestedAt: run!.pendingApproval!.requestedAt,
      status: "pending",
    });

    const events = await harness.getEvents(result.runId);
    expect(lifecycleEventTypes(events)).toEqual([
      "run_started",
      "tool_call",
      "approval_required",
    ]);
  });

  it("stores browser screenshots as persisted artifacts instead of inline base64 blobs", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "browser_screenshot", arguments: {} }),
        "captured",
      ]),
      runtime: {
        rootDir,
        driver: new FakeBrowserDriver(),
      },
      sandbox: { browser: true },
      verify: { enabled: false },
    });

    const result = await harness.run({
      goal: "take a screenshot",
    });

    expect(result.artifactIds).toHaveLength(1);

    const artifacts = await harness.getArtifacts(result.runId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.kind).toBe("screenshot");
    expect(artifacts[0]!.mimeType).toBe("image/png");
    expect(artifacts[0]!.size).toBe(4);
    expect(await readFile(artifacts[0]!.path)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const run = await harness.getRun(result.runId);
    expect(run!.artifactIds).toEqual([artifacts[0]!.id]);

    const events = await harness.getEvents(result.runId);
    expect(lifecycleEventTypes(events)).toEqual([
      "run_started",
      "tool_call",
      "artifact_created",
      "tool_result",
      "run_completed",
    ]);
  });

  it("creates an isolated default workspace for boolean fs sandboxes", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({
          tool: "fs_write",
          arguments: { path: "notes/out.txt", content: "hello" },
        }),
        JSON.stringify({
          tool: "fs_exists",
          arguments: { path: "notes/out.txt" },
        }),
        "done",
      ]),
      runtime: { rootDir },
      sandbox: { fs: true },
      verify: { enabled: false },
    });

    const result = await harness.run({ goal: "write a file" });
    const run = await harness.getRun(result.runId);

    expect(run!.sandbox.workspaceDir).toBeDefined();
    expect(run!.sandbox.workspaceDir!).toContain(".capstan/harness/sandboxes");
    expect(
      await readFile(join(run!.sandbox.workspaceDir!, "notes/out.txt"), "utf8"),
    ).toBe("hello");
  });

  it("marks runs as failed when the model call itself throws", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([new Error("model unavailable")]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    await expect(harness.run({ goal: "fail immediately" })).rejects.toThrow(
      "model unavailable",
    );

    const runs = await harness.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("failed");
    expect(runs[0]!.error).toContain("model unavailable");

    const events = await harness.getEvents(runs[0]!.id);
    expect(lifecycleEventTypes(events)).toEqual([
      "run_started",
      "run_failed",
    ]);
  });

  it("enforces per-instance concurrency limits", async () => {
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
      runtime: { rootDir, maxConcurrentRuns: 1 },
      verify: { enabled: false },
    });

    const firstRun = await harness.startRun({
      goal: "hold the slot",
      tools: [
        {
          name: "hold",
          description: "holds the active run slot open",
          async execute() {
            await gate;
            return { released: true };
          },
        },
      ],
    });
    await waitFor(async () => {
      const run = await harness.getRun(firstRun.runId);
      return run?.status === "running" ? run : undefined;
    });

    await expect(harness.startRun({ goal: "second run" })).rejects.toThrow(
      "Harness concurrency limit exceeded",
    );

    release();
    const result = await firstRun.result;
    expect(result.runtimeStatus).toBe("completed");
  });

  it("refuses new runs after destroy() is called", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["done"]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    await harness.destroy();

    await expect(harness.run({ goal: "should not run" })).rejects.toThrow(
      "Harness has been destroyed",
    );
  });

  it("reopens persisted runs through an independent control-plane instance", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["done"]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const result = await harness.run({ goal: "persist and reopen" });
    await harness.destroy();

    const runtime = await openHarnessRuntime(rootDir);
    const run = await runtime.getRun(result.runId);

    expect(run).toBeDefined();
    expect(run!.goal).toBe("persist and reopen");
    expect(run!.status).toBe("completed");
    expect(runtime.getPaths().rootDir).toContain(".capstan/harness");
  });

  it("rejects path-traversal run identifiers in the runtime control plane", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);

    await expect(runtime.getRun("../escape")).rejects.toThrow(
      "Invalid harness run id",
    );
    await expect(runtime.getEvents("../escape")).rejects.toThrow(
      "Invalid harness run id",
    );
    await expect(runtime.getArtifacts("../escape")).rejects.toThrow(
      "Invalid harness run id",
    );
    await expect(runtime.replayRun("../escape")).rejects.toThrow(
      "Invalid harness run id",
    );
  });

  it("startRun returns a run handle immediately for external control", async () => {
    const rootDir = await createTempDir();
    let release!: () => void;
    const gate = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });

    const harness = await createHarness({
      llm: mockLLM([() => gate.then(() => "done")]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const handle = await harness.startRun({ goal: "start in background" });
    expect(handle.runId).toStartWith("harness-run-");

    const run = await harness.getRun(handle.runId);
    expect(run).toBeDefined();
    expect(run!.status).toBe("running");

    release();
    const result = await handle.result;
    expect(result.runtimeStatus).toBe("completed");
  });

  it("pauses a run cooperatively and resumes it from a persisted checkpoint in a new harness instance", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    const steps: string[] = [];
    let policyCalls = 0;
    let pauseRequest:
      | {
          status: string;
          control?: { pauseRequestedAt?: string };
        }
      | undefined;

    const tool = {
      name: "step",
      description: "records a step",
      async execute(args: Record<string, unknown>) {
        steps.push(String(args.value));
        return { ok: true };
      },
    };

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "all done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            pauseRequest = await runtime.pauseRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
    });

    const paused = await harness.run({
      goal: "record steps",
      tools: [tool],
    });

    expect(paused.status).toBe("paused");
    expect(paused.runtimeStatus).toBe("paused");
    expect(steps).toEqual(["one", "two"]);
    expect(pauseRequest?.status).toBe("pause_requested");
    expect(pauseRequest?.control?.pauseRequestedAt).toBeString();

    const checkpoint = await harness.getCheckpoint(paused.runId);
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.stage).toBe("tool_result");
    expect(checkpoint!.iterations).toBe(2);
    expect(checkpoint!.toolCalls).toHaveLength(2);
    expect(checkpoint!.pendingToolCall).toBeUndefined();

    const pausedRun = await runtime.getRun(paused.runId);
    expect(pausedRun!.status).toBe("paused");

    const resumedHarness = await createHarness({
      llm: mockLLM(["all done"]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const resumed = await resumedHarness.resumeRun(paused.runId, {
      runConfig: {
        goal: "record steps",
        tools: [tool],
      },
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.runtimeStatus).toBe("completed");
    expect(steps).toEqual(["one", "two"]);

    const events = await resumedHarness.getEvents(paused.runId);
    expect(lifecycleEventTypes(events)).toEqual([
      "run_started",
      "tool_call",
      "tool_result",
      "tool_call",
      "pause_requested",
      "tool_result",
      "run_paused",
      "run_resumed",
      "run_completed",
    ]);
  });

  it("resumes approval-blocked runs after explicit approval without re-running policy checks", async () => {
    const rootDir = await createTempDir();
    const writes: string[] = [];
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "approved" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => {
          policyCalls++;
          return {
            allowed: false,
            reason: "write requires approval",
          };
        },
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "write one value",
      tools: [
        {
          name: "write",
          description: "persists a value",
          async execute(args) {
            writes.push(String(args.value));
            return { saved: true };
          },
        },
      ],
    });

    expect(blocked.status).toBe("approval_required");
    expect(blocked.runtimeStatus).toBe("approval_required");
    expect(policyCalls).toBe(1);

    const checkpoint = await harness.getCheckpoint(blocked.runId);
    expect(checkpoint?.pendingToolCall?.tool).toBe("write");

    const resumed = await harness.resumeRun(blocked.runId, {
      approvePendingTool: true,
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.runtimeStatus).toBe("completed");
    expect(policyCalls).toBe(1);
    expect(writes).toEqual(["approved"]);
  });

  it("requires both run:resume and matching approval:approve grants to resume blocked runs", async () => {
    const rootDir = await createTempDir();
    const writes: string[] = [];
    let policyCalls = 0;
    let grants: ReadonlyArray<string | Record<string, unknown>> = [
      ...grantRunCollectionActions(["start"]),
    ];

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "approved" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => {
          policyCalls++;
          return {
            allowed: false,
            reason: "write requires approval",
          };
        },
        authorize: createGrantAuthorizer(() => grants),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "write one value with grants",
      tools: [
        {
          name: "write",
          description: "persists a value",
          async execute(args) {
            writes.push(String(args.value));
            return { saved: true };
          },
        },
      ],
    });

    expect(blocked.runtimeStatus).toBe("approval_required");
    expect(policyCalls).toBe(1);
    grants = [...grantRunActions(blocked.runId, ["read"])];
    const approvalId = (await harness.getRun(blocked.runId))!.pendingApproval!.id;

    grants = [
      ...grantRunCollectionActions(["start"]),
      ...grantRunActions(blocked.runId, ["resume"]),
    ];
    await expect(
      harness.resumeRun(blocked.runId, {
        approvePendingTool: true,
      }),
    ).rejects.toThrow("Harness access denied for approval:approve");

    grants = [
      ...grantRunCollectionActions(["start"]),
      ...grantRunActions(blocked.runId, ["resume"]),
      ...grantApprovalActions(["approve"], {
        approvalId,
        runId: blocked.runId,
        tool: "other-tool",
      }),
    ];
    await expect(
      harness.resumeRun(blocked.runId, {
        approvePendingTool: true,
      }),
    ).rejects.toThrow("Harness access denied for approval:approve");

    grants = [
      ...grantRunCollectionActions(["start"]),
      ...grantRunActions(blocked.runId, ["resume"]),
      ...grantApprovalActions(["approve"], {
        approvalId,
        runId: blocked.runId,
        tool: "write",
      }),
    ];
    const resumed = await harness.resumeRun(blocked.runId, {
      approvePendingTool: true,
    });

    expect(resumed.runtimeStatus).toBe("completed");
    expect(policyCalls).toBe(1);
    expect(writes).toEqual(["approved"]);
  });

  it("cancels approval-blocked runs through the harness and records approval_canceled", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "blocked" } }),
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "write requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "write one blocked value",
      tools: [
        {
          name: "write",
          description: "persists a value",
          async execute() {
            return { saved: true };
          },
        },
      ],
    });

    expect(blocked.runtimeStatus).toBe("approval_required");
    const approvals = await harness.listApprovals(blocked.runId);
    expect(approvals[0]!).toMatchObject({
      kind: "tool",
      status: "pending",
    });

    const canceled = await harness.cancelRun(blocked.runId);
    expect(canceled.status).toBe("canceled");
    expect((await harness.getApproval(approvals[0]!.id))).toMatchObject({
      status: "canceled",
    });
    expect(lifecycleEventTypes(await harness.getEvents(blocked.runId))).toEqual([
      "run_started",
      "tool_call",
      "approval_required",
      "approval_canceled",
      "run_canceled",
    ]);
  });

  it("cancels a running run cooperatively through the runtime control plane", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    const steps: string[] = [];
    let policyCalls = 0;
    let cancelRequest:
      | {
          status: string;
          control?: { cancelRequestedAt?: string };
        }
      | undefined;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done",
      ]),
      runtime: {
        rootDir,
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            cancelRequest = await runtime.cancelRun(runId);
          }
          return { allowed: true };
        },
      },
      verify: { enabled: false },
    });

    const canceled = await harness.run({
      goal: "cancel midway",
      tools: [
        {
          name: "step",
          description: "records a step",
          async execute(args) {
            steps.push(String(args.value));
            return { ok: true };
          },
        },
      ],
    });

    expect(canceled.status).toBe("canceled");
    expect(canceled.runtimeStatus).toBe("canceled");
    expect(steps).toEqual(["one", "two"]);
    expect(cancelRequest?.status).toBe("cancel_requested");
    expect(cancelRequest?.control?.cancelRequestedAt).toBeString();

    const run = await runtime.getRun(canceled.runId);
    expect(run!.status).toBe("canceled");

    const events = await runtime.getEvents(canceled.runId);
    expect(lifecycleEventTypes(events)).toEqual([
      "run_started",
      "tool_call",
      "tool_result",
      "tool_call",
      "cancel_requested",
      "tool_result",
      "run_canceled",
    ]);
  });

  it("returns a run handle immediately so callers can control a live run by id", async () => {
    const rootDir = await createTempDir();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = await createHarness({
      llm: mockLLM([() => gate.then(() => "done")]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const started = await harness.startRun({ goal: "return handle" });
    expect(started.runId).toStartWith("harness-run-");

    const run = await waitFor(async () => await harness.getRun(started.runId));
    expect(run.id).toBe(started.runId);
    expect(run.status).toBe("running");

    release();
    const result = await started.result;
    expect(result.runId).toBe(started.runId);
    expect(result.runtimeStatus).toBe("completed");
  });

  it("reuses the same sandbox when a paused browser run resumes in the same harness instance", async () => {
    const rootDir = await createTempDir();
    const runtime = await openHarnessRuntime(rootDir);
    const state: TrackingBrowserState = {
      createCount: 0,
      destroyCount: 0,
      currentUrl: "about:blank",
    };
    let policyCalls = 0;

    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "browser_navigate", arguments: { url: "https://example.com" } }),
        JSON.stringify({ tool: "browser_screenshot", arguments: {} }),
        "done",
      ]),
      runtime: {
        rootDir,
        driver: new TrackingBrowserDriver(state),
        beforeToolCall: async ({ runId }) => {
          policyCalls++;
          if (policyCalls === 2) {
            await runtime.pauseRun(runId);
          }
          return { allowed: true };
        },
      },
      sandbox: { browser: true },
      verify: { enabled: false },
    });

    const paused = await harness.run({ goal: "pause browser state" });
    expect(paused.runtimeStatus).toBe("paused");
    expect(state.createCount).toBe(1);

    const resumed = await harness.resumeRun(paused.runId);
    expect(resumed.runtimeStatus).toBe("completed");
    expect(state.createCount).toBe(1);

    const artifacts = await harness.getArtifacts(paused.runId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.metadata).toEqual({ url: "https://example.com" });
  });

  it("destroy() requests cancellation for active runs and waits for them to settle", async () => {
    const rootDir = await createTempDir();
    let harness!: Awaited<ReturnType<typeof createHarness>>;
    let destroyPromise: Promise<void> | undefined;

    harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "step", arguments: { value: "one" } }),
        JSON.stringify({ tool: "step", arguments: { value: "two" } }),
        "done",
      ]),
      runtime: { rootDir },
      verify: { enabled: false },
      observe: {
        onEvent(event) {
          if (event.type === "tool_result" && !destroyPromise) {
            destroyPromise = harness.destroy();
          }
        },
      },
    });

    const result = await harness.run({
      goal: "destroy while running",
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

    await destroyPromise;

    expect(result.status).toBe("canceled");
    expect(result.runtimeStatus).toBe("canceled");

    await expect(
      harness.run({ goal: "should not start after destroy" }),
    ).rejects.toThrow("Harness has been destroyed");
  });

  it("rejects invalid pause/cancel transitions for terminal runs", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["done"]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const result = await harness.run({ goal: "finish" });
    const runtime = await openHarnessRuntime(rootDir);

    await expect(runtime.pauseRun(result.runId)).rejects.toThrow(
      `Cannot pause run ${result.runId} from status completed`,
    );
    await expect(runtime.cancelRun(result.runId)).rejects.toThrow(
      `Cannot cancel run ${result.runId} from status completed`,
    );
  });

  it("persists explicit trigger and submission metadata on runtime-backed runs", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["trigger-aware result"]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const result = await harness.run(
      {
        goal: "run from cron",
      },
      {
        trigger: {
          type: "cron",
          source: "nightly-sync",
          firedAt: "2026-04-04T00:00:00.000Z",
          schedule: {
            name: "nightly-sync",
            pattern: "0 0 * * *",
            timezone: "Asia/Shanghai",
          },
          metadata: {
            tickId: "cron-tick-001",
            shard: "cn-east",
          },
        },
        metadata: {
          submittedBy: "scheduler",
        },
      },
    );

    expect(result.runtimeStatus).toBe("completed");

    const run = await harness.getRun(result.runId);
    expect(run).toMatchObject({
      id: result.runId,
      goal: "run from cron",
      status: "completed",
      trigger: {
        type: "cron",
        source: "nightly-sync",
        firedAt: "2026-04-04T00:00:00.000Z",
        schedule: {
          name: "nightly-sync",
          pattern: "0 0 * * *",
          timezone: "Asia/Shanghai",
        },
        metadata: {
          tickId: "cron-tick-001",
          shard: "cn-east",
        },
      },
      metadata: {
        submittedBy: "scheduler",
      },
    });

    const events = await harness.getEvents(result.runId);
    expect(events.find((event) => event.type === "run_started")?.data).toMatchObject({
      trigger: {
        type: "cron",
        source: "nightly-sync",
      },
      metadata: {
        submittedBy: "scheduler",
      },
    });

    const controlPlane = await openHarnessRuntime(rootDir);
    expect(await controlPlane.getRun(result.runId)).toMatchObject({
      trigger: {
        type: "cron",
        source: "nightly-sync",
      },
      metadata: {
        submittedBy: "scheduler",
      },
    });
  });
});

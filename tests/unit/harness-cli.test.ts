import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createHarness } from "@zauso-ai/capstan-ai";
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

function mockLLM(
  responses: Array<string | (() => Promise<string> | string)>,
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const next = responses[callIndex++];
      const content =
        typeof next === "function" ? await next() : (next ?? "done");
      return { content, model: "mock-1" };
    },
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-cli-"));
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

async function runCli(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn([process.execPath, "packages/cli/src/index.ts", ...args], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    exitCode: exitCode ?? 0,
    stdout,
    stderr,
  };
}

describe("capstan harness runtime CLI", () => {
  it("reads persisted harness runtime state through harness:* commands", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "browser_screenshot", arguments: {} }),
        "done",
      ]),
      runtime: {
        rootDir,
        driver: new FakeBrowserDriver(),
      },
      sandbox: { browser: true },
      verify: { enabled: false },
    });

    const result = await harness.run({ goal: "capture page state" });

    const list = await runCli(["harness:list", "--root", rootDir, "--json"]);
    expect(list.exitCode).toBe(0);
    const listedRuns = JSON.parse(list.stdout) as Array<{ id: string }>;
    expect(listedRuns).toHaveLength(1);
    expect(listedRuns[0]!.id).toBe(result.runId);

    const get = await runCli(["harness:get", result.runId, "--root", rootDir, "--json"]);
    expect(get.exitCode).toBe(0);
    const runRecord = JSON.parse(get.stdout) as { id: string; artifactIds: string[] };
    expect(runRecord.id).toBe(result.runId);
    expect(runRecord.artifactIds).toHaveLength(1);

    const events = await runCli(["harness:events", result.runId, "--root", rootDir, "--json"]);
    expect(events.exitCode).toBe(0);
    expect(
      lifecycleEventTypes(JSON.parse(events.stdout) as Array<{ type: string }>),
    ).toEqual([
      "run_started",
      "tool_call",
      "artifact_created",
      "tool_result",
      "run_completed",
    ]);

    const artifacts = await runCli(["harness:artifacts", result.runId, "--root", rootDir, "--json"]);
    expect(artifacts.exitCode).toBe(0);
    const artifactRecords = JSON.parse(artifacts.stdout) as Array<{ kind: string; size: number }>;
    expect(artifactRecords).toHaveLength(1);
    expect(artifactRecords[0]!.kind).toBe("screenshot");
    expect(artifactRecords[0]!.size).toBe(4);

    const replay = await runCli(["harness:replay", result.runId, "--root", rootDir, "--json"]);
    expect(replay.exitCode).toBe(0);
    const replayReport = JSON.parse(replay.stdout) as { consistent: boolean };
    expect(replayReport.consistent).toBe(true);

    const paths = await runCli(["harness:paths", "--root", rootDir, "--json"]);
    expect(paths.exitCode).toBe(0);
    const runtimePaths = JSON.parse(paths.stdout) as { rootDir: string };
    expect(runtimePaths.rootDir).toContain(".capstan/harness");
  });

  it("fails fast when harness CLI receives an unsafe run identifier", async () => {
    const rootDir = await createTempDir();

    const result = await runCli([
      "harness:get",
      "../escape",
      "--root",
      rootDir,
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid harness run id");
  });

  it("reads checkpoints and cancels blocked runs through harness lifecycle commands", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "pending" } }),
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

    const result = await harness.run({
      goal: "block and inspect",
      tools: [
        {
          name: "write",
          description: "writes a value",
          async execute() {
            return { ok: true };
          },
        },
      ],
    });

    expect(result.runtimeStatus).toBe("approval_required");

    const checkpoint = await runCli([
      "harness:checkpoint",
      result.runId,
      "--root",
      rootDir,
      "--json",
    ]);
    expect(checkpoint.exitCode).toBe(0);
    const checkpointRecord = JSON.parse(checkpoint.stdout) as {
      stage: string;
      pendingToolCall?: { tool: string };
    };
    expect(checkpointRecord.stage).toBe("approval_required");
    expect(checkpointRecord.pendingToolCall?.tool).toBe("write");

    const canceled = await runCli([
      "harness:cancel",
      result.runId,
      "--root",
      rootDir,
      "--json",
    ]);
    expect(canceled.exitCode).toBe(0);
    const canceledRun = JSON.parse(canceled.stdout) as { status: string };
    expect(canceledRun.status).toBe("canceled");
  });

  it("reports invalid pause transitions through the CLI", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM(["done"]),
      runtime: { rootDir },
      verify: { enabled: false },
    });

    const result = await harness.run({ goal: "finish" });

    const paused = await runCli([
      "harness:pause",
      result.runId,
      "--root",
      rootDir,
      "--json",
    ]);

    expect(paused.exitCode).toBe(1);
    expect(paused.stderr).toContain("Cannot pause run");
  });

  it("requests pause for a live run through the CLI and leaves a resumable checkpoint behind", async () => {
    const rootDir = await createTempDir();
    let releaseSecondStep!: () => void;
    const secondStepGate = new Promise<void>((resolvePromise) => {
      releaseSecondStep = resolvePromise;
    });
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "browser_navigate", arguments: { url: "https://example.com" } }),
        () => secondStepGate.then(
          () => JSON.stringify({ tool: "browser_screenshot", arguments: {} }),
        ),
        "done",
      ]),
      runtime: {
        rootDir,
        driver: new FakeBrowserDriver(),
      },
      sandbox: { browser: true },
      verify: { enabled: false },
    });

    const started = await harness.startRun({ goal: "pause from cli" });

    await waitFor(async () => {
      const run = await harness.getRun(started.runId);
      return run?.toolCalls === 1 ? run : undefined;
    });

    const paused = await runCli([
      "harness:pause",
      started.runId,
      "--root",
      rootDir,
      "--json",
    ]);
    expect(paused.exitCode).toBe(0);
    const pauseRecord = JSON.parse(paused.stdout) as {
      status: string;
      control?: { pauseRequestedAt?: string };
    };
    expect(pauseRecord.status).toBe("pause_requested");
    expect(pauseRecord.control?.pauseRequestedAt).toBeString();

    releaseSecondStep();
    const result = await started.result;
    expect(result.runtimeStatus).toBe("paused");

    const checkpoint = await runCli([
      "harness:checkpoint",
      started.runId,
      "--root",
      rootDir,
      "--json",
    ]);
    expect(checkpoint.exitCode).toBe(0);
    const checkpointRecord = JSON.parse(checkpoint.stdout) as { stage: string };
    expect(checkpointRecord.stage).toBe("assistant_response");
  });
});

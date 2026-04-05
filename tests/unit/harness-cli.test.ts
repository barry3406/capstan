import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  grantApprovalActions,
  grantArtifactActions,
  grantCheckpointActions,
  grantRunActions,
} from "@zauso-ai/capstan-auth";
import type { AuthGrant } from "@zauso-ai/capstan-auth";
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

function approvalCollectionGrants(runId?: string): AuthGrant[] {
  return [
    {
      resource: "approval",
      action: "list",
      ...(runId ? { scope: { runId } } : {}),
    },
  ];
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
        type !== "context_compacted" &&
        type !== "sidecar_started" &&
        type !== "sidecar_completed" &&
        type !== "sidecar_failed",
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
      "governance_decision",
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
        maxConcurrentRuns: 2,
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

    const deniedCheckpoint = await runCli([
      "harness:checkpoint",
      result.runId,
      "--root",
      rootDir,
      "--json",
      "--grants",
      JSON.stringify(grantCheckpointActions("other-run")),
    ]);
    expect(deniedCheckpoint.exitCode).toBe(1);
    expect(deniedCheckpoint.stderr).toContain("checkpoint:read");

    const deniedArtifacts = await runCli([
      "harness:artifacts",
      result.runId,
      "--root",
      rootDir,
      "--json",
      "--grants",
      JSON.stringify(grantArtifactActions("other-run")),
    ]);
    expect(deniedArtifacts.exitCode).toBe(1);
    expect(deniedArtifacts.stderr).toContain("artifact:read");

    const deniedCancel = await runCli([
      "harness:cancel",
      result.runId,
      "--root",
      rootDir,
      "--json",
      "--grants",
      JSON.stringify(grantRunActions("other-run", ["cancel"])),
    ]);
    expect(deniedCancel.exitCode).toBe(1);
    expect(deniedCancel.stderr).toContain("run:cancel");

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

    const deniedPause = await runCli([
      "harness:pause",
      started.runId,
      "--root",
      rootDir,
      "--json",
      "--grants",
      JSON.stringify(grantRunActions("other-run", ["pause"])),
    ]);
    expect(deniedPause.exitCode).toBe(1);
    expect(deniedPause.stderr).toContain("run:pause");

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

  it("lists and reads persisted approvals through dedicated CLI commands", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "pending" } }),
      ]),
      runtime: {
        rootDir,
        maxConcurrentRuns: 2,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "write requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const blocked = await harness.run({
      goal: "inspect approval cli",
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

    const run = await harness.getRun(blocked.runId);
    const approvalId = run?.pendingApprovalId;
    expect(approvalId).toBeString();

    const approvals = await runCli([
      "harness:approvals",
      blocked.runId,
      "--root",
      rootDir,
      "--json",
    ]);
    expect(approvals.exitCode).toBe(0);
    expect(JSON.parse(approvals.stdout)).toEqual([
      expect.objectContaining({
        id: approvalId,
        runId: blocked.runId,
        status: "pending",
      }),
    ]);

    const approval = await runCli([
      "harness:approval",
      approvalId!,
      "--root",
      rootDir,
      "--json",
    ]);
    expect(approval.exitCode).toBe(0);
    expect(JSON.parse(approval.stdout)).toMatchObject({
      id: approvalId,
      runId: blocked.runId,
      status: "pending",
      tool: "write",
    });

    const deniedList = await runCli([
      "harness:approvals",
      blocked.runId,
      "--root",
      rootDir,
      "--json",
      "--grants",
      JSON.stringify(grantApprovalActions(["list"], { runId: "other-run" })),
    ]);
    expect(deniedList.exitCode).toBe(1);
    expect(deniedList.stderr).toContain("approval:list");

    const deniedRead = await runCli([
      "harness:approval",
      approvalId!,
      "--root",
      rootDir,
      "--json",
      "--grants",
      JSON.stringify(
        grantApprovalActions(["read"], {
          approvalId: "approval-other",
          runId: blocked.runId,
          tool: "write",
        }),
      ),
    ]);
    expect(deniedRead.exitCode).toBe(1);
    expect(deniedRead.stderr).toContain("approval:read");

    const scopedList = await runCli([
      "harness:approvals",
      blocked.runId,
      "--root",
      rootDir,
      "--json",
      "--grants",
      JSON.stringify([
        ...approvalCollectionGrants(blocked.runId),
        ...grantApprovalActions(["read"], {
          approvalId: approvalId!,
          runId: blocked.runId,
          tool: "write",
        }),
      ]),
    ]);
    expect(scopedList.exitCode).toBe(0);
    expect(JSON.parse(scopedList.stdout)).toHaveLength(1);
  });

  it("approves and denies blocked runs through the CLI with scoped approval grants", async () => {
    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({ tool: "write", arguments: { value: "approve-me" } }),
        JSON.stringify({ tool: "write", arguments: { value: "deny-me" } }),
      ]),
      runtime: {
        rootDir,
        maxConcurrentRuns: 2,
        beforeToolCall: async () => ({
          allowed: false,
          reason: "write requires approval",
        }),
      },
      verify: { enabled: false },
    });

    const first = await harness.run({
      goal: "approve from cli",
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
    const second = await harness.run({
      goal: "deny from cli",
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

    const firstRun = await harness.getRun(first.runId);
    const secondRun = await harness.getRun(second.runId);
    const firstApprovalId = firstRun?.pendingApprovalId;
    const secondApprovalId = secondRun?.pendingApprovalId;
    expect(firstApprovalId).toBeString();
    expect(secondApprovalId).toBeString();

    const deniedApprove = await runCli([
      "harness:approve",
      first.runId,
      "--root",
      rootDir,
      "--json",
      "--note",
      "ship it",
      "--subject",
      JSON.stringify({ id: "operator-1", role: "ops" }),
      "--grants",
      JSON.stringify(
        grantApprovalActions(["approve"], {
          approvalId: firstApprovalId!,
          runId: first.runId,
          tool: "other-tool",
        }),
      ),
    ]);
    expect(deniedApprove.exitCode).toBe(1);
    expect(deniedApprove.stderr).toContain("approval:approve");

    const approved = await runCli([
      "harness:approve",
      first.runId,
      "--root",
      rootDir,
      "--json",
      "--note",
      "ship it",
      "--subject",
      JSON.stringify({ id: "operator-1", role: "ops" }),
      "--grants",
      JSON.stringify(
        grantApprovalActions(["approve"], {
          approvalId: firstApprovalId!,
          runId: first.runId,
          tool: "write",
        }),
      ),
    ]);
    expect(approved.exitCode).toBe(0);
    expect(JSON.parse(approved.stdout)).toMatchObject({
      id: firstApprovalId,
      status: "approved",
      resolutionNote: "ship it",
      tool: "write",
    });
    const firstEvents = await harness.getEvents(first.runId);
    expect(firstEvents.find((event) => event.type === "approval_approved")?.data).toMatchObject({
      approvalId: firstApprovalId,
      kind: "tool",
      tool: "write",
      status: "approved",
      resolutionNote: "ship it",
      resolvedBy: {
        id: "operator-1",
        role: "ops",
      },
    });

    const denied = await runCli([
      "harness:deny",
      second.runId,
      "--root",
      rootDir,
      "--json",
      "--note",
      "unsafe",
      "--subject",
      JSON.stringify({ id: "operator-2" }),
      "--grants",
      JSON.stringify(
        grantApprovalActions(["deny"], {
          approvalId: secondApprovalId!,
          runId: second.runId,
          tool: "write",
        }),
      ),
    ]);
    expect(denied.exitCode).toBe(0);
    expect(JSON.parse(denied.stdout)).toMatchObject({
      id: secondApprovalId,
      status: "denied",
      resolutionNote: "unsafe",
      resolvedBy: { id: "operator-2" },
    });
    const secondEvents = await harness.getEvents(second.runId);
    expect(secondEvents.find((event) => event.type === "approval_denied")?.data).toMatchObject({
      approvalId: secondApprovalId,
      kind: "tool",
      tool: "write",
      status: "denied",
      resolutionNote: "unsafe",
      resolvedBy: { id: "operator-2" },
    });

    expect((await harness.getRun(first.runId))?.pendingApproval).toMatchObject({
      status: "approved",
    });
    expect((await harness.getRun(second.runId))?.status).toBe("canceled");
    expect(firstEvents.map((event) => event.type)).toContain("approval_approved");
    expect(secondEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining(["approval_denied", "run_canceled"]),
    );
  });
});

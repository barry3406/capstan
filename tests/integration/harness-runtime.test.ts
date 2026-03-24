import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runCapstanCli } from "../helpers/run-cli.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Capstan harness runtime", () => {
  it("persists and replays a paused-resumed-completed task run across CLI invocations", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-harness-runtime-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/agent-surface-app-graph.json",
      outputDir
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    const inputPath = join(outputDir, "task-input.json");
    const outputPath = join(outputDir, "task-output.json");

    await writeFile(
      inputPath,
      `${JSON.stringify({ ticketId: "ticket-1" }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      outputPath,
      `${JSON.stringify({ artifactId: "digest-1" }, null, 2)}\n`,
      "utf8"
    );

    const started = await runCapstanCli([
      "harness:start",
      outputDir,
      "generateDigestTask",
      "--json",
      "--input",
      inputPath
    ]);
    expect(started.exitCode).toBe(0);

    const startedRun = JSON.parse(started.stdout) as { id: string; status: string; attempt: number };
    expect(startedRun.status).toBe("running");
    expect(startedRun.attempt).toBe(1);

    const paused = await runCapstanCli(["harness:pause", outputDir, startedRun.id, "--json"]);
    expect(paused.exitCode).toBe(0);
    expect(JSON.parse(paused.stdout).status).toBe("paused");

    const resumed = await runCapstanCli(["harness:resume", outputDir, startedRun.id, "--json"]);
    expect(resumed.exitCode).toBe(0);
    expect(JSON.parse(resumed.stdout).status).toBe("running");

    const completed = await runCapstanCli([
      "harness:complete",
      outputDir,
      startedRun.id,
      "--json",
      "--output",
      outputPath
    ]);
    expect(completed.exitCode).toBe(0);

    const completedRun = JSON.parse(completed.stdout) as {
      status: string;
      output: { artifactId: string };
    };
    expect(completedRun.status).toBe("completed");
    expect(completedRun.output.artifactId).toBe("digest-1");

    const listed = await runCapstanCli(["harness:list", outputDir, "--json"]);
    const listPayload = JSON.parse(listed.stdout) as Array<{ status: string; id: string }>;
    expect(listPayload).toHaveLength(1);
    expect(listPayload[0]?.status).toBe("completed");

    const replayed = await runCapstanCli(["harness:replay", outputDir, startedRun.id, "--json"]);
    expect(replayed.exitCode).toBe(0);

    const replayReport = JSON.parse(replayed.stdout) as {
      consistent: boolean;
      eventCount: number;
      replayed?: { status: string };
    };
    expect(replayReport.consistent).toBe(true);
    expect(replayReport.eventCount).toBe(4);
    expect(replayReport.replayed?.status).toBe("completed");
  }, 20_000);

  it("supports approval, failure, retry, and event inspection", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-harness-approval-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/agent-surface-app-graph.json",
      outputDir
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    const started = await runCapstanCli([
      "harness:start",
      outputDir,
      "generateDigestTask",
      "--json"
    ]);
    const startedRun = JSON.parse(started.stdout) as { id: string };

    const approvalRequested = await runCapstanCli([
      "harness:request-approval",
      outputDir,
      startedRun.id,
      "--json",
      "--note",
      "Need manager review"
    ]);
    expect(JSON.parse(approvalRequested.stdout).status).toBe("approval_required");

    const approved = await runCapstanCli([
      "harness:approve",
      outputDir,
      startedRun.id,
      "--json"
    ]);
    expect(JSON.parse(approved.stdout).status).toBe("running");

    const failed = await runCapstanCli([
      "harness:fail",
      outputDir,
      startedRun.id,
      "--json",
      "--message",
      "Digest provider timeout"
    ]);
    const failedRun = JSON.parse(failed.stdout) as { status: string; error: string };
    expect(failedRun.status).toBe("failed");
    expect(failedRun.error).toContain("timeout");

    const retried = await runCapstanCli([
      "harness:retry",
      outputDir,
      startedRun.id,
      "--json"
    ]);
    const retriedRun = JSON.parse(retried.stdout) as { status: string; attempt: number };
    expect(retriedRun.status).toBe("running");
    expect(retriedRun.attempt).toBe(2);

    const events = await runCapstanCli([
      "harness:events",
      outputDir,
      "--json",
      "--run",
      startedRun.id
    ]);
    const eventPayload = JSON.parse(events.stdout) as Array<{ type: string; sequence: number }>;
    expect(eventPayload.map((event) => event.type)).toEqual([
      "run_started",
      "approval_requested",
      "approval_granted",
      "run_failed",
      "run_retried"
    ]);
    expect(eventPayload.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);

    const eventLog = await readFile(join(outputDir, ".capstan/harness/events.ndjson"), "utf8");
    expect(eventLog).toContain('"type":"run_retried"');
  }, 20_000);

  it("supports input handoff, cancellation, and retry from durable state", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-harness-input-handoff-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/agent-surface-app-graph.json",
      outputDir
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    const inputPath = join(outputDir, "handoff-input.json");
    await writeFile(
      inputPath,
      `${JSON.stringify({ window: "24h", includeClosed: false }, null, 2)}\n`,
      "utf8"
    );

    const started = await runCapstanCli([
      "harness:start",
      outputDir,
      "generateDigestTask",
      "--json",
      "--input",
      inputPath
    ]);
    expect(started.exitCode).toBe(0);

    const startedRun = JSON.parse(started.stdout) as {
      id: string;
      input: { window: string; includeClosed: boolean };
    };
    expect(startedRun.input.window).toBe("24h");

    const inputRequested = await runCapstanCli([
      "harness:request-input",
      outputDir,
      startedRun.id,
      "--json",
      "--note",
      "Need ticketId before digest generation"
    ]);
    const waitingRun = JSON.parse(inputRequested.stdout) as {
      status: string;
      awaitingInput?: { note?: string };
    };
    expect(waitingRun.status).toBe("input_required");
    expect(waitingRun.awaitingInput?.note).toContain("ticketId");

    const followupInputPath = join(outputDir, "handoff-followup.json");
    await writeFile(
      followupInputPath,
      `${JSON.stringify({ ticketId: "ticket-42" }, null, 2)}\n`,
      "utf8"
    );

    const inputProvided = await runCapstanCli([
      "harness:provide-input",
      outputDir,
      startedRun.id,
      "--json",
      "--input",
      followupInputPath,
      "--note",
      "Operator supplied the missing ticket id"
    ]);
    const resumedRun = JSON.parse(inputProvided.stdout) as {
      status: string;
      input: { window: string; includeClosed: boolean; ticketId: string };
      lastProvidedInput?: { payload?: { ticketId: string } };
    };
    expect(resumedRun.status).toBe("running");
    expect(resumedRun.input).toEqual({
      window: "24h",
      includeClosed: false,
      ticketId: "ticket-42"
    });
    expect(resumedRun.lastProvidedInput?.payload?.ticketId).toBe("ticket-42");

    const cancelled = await runCapstanCli([
      "harness:cancel",
      outputDir,
      startedRun.id,
      "--json",
      "--note",
      "Digest job superseded by a newer run"
    ]);
    const cancelledRun = JSON.parse(cancelled.stdout) as { status: string };
    expect(cancelledRun.status).toBe("cancelled");

    const retried = await runCapstanCli([
      "harness:retry",
      outputDir,
      startedRun.id,
      "--json",
      "--note",
      "Restarting against the updated queue"
    ]);
    const retriedRun = JSON.parse(retried.stdout) as {
      status: string;
      attempt: number;
      input: { ticketId: string };
    };
    expect(retriedRun.status).toBe("running");
    expect(retriedRun.attempt).toBe(2);
    expect(retriedRun.input.ticketId).toBe("ticket-42");

    const events = await runCapstanCli([
      "harness:events",
      outputDir,
      "--json",
      "--run",
      startedRun.id
    ]);
    const eventPayload = JSON.parse(events.stdout) as Array<{ type: string }>;
    expect(eventPayload.map((event) => event.type)).toEqual([
      "run_started",
      "input_requested",
      "input_received",
      "run_cancelled",
      "run_retried"
    ]);

    const compacted = await runCapstanCli([
      "harness:compact",
      outputDir,
      startedRun.id,
      "--json",
      "--tail",
      "2"
    ]);
    expect(compacted.exitCode).toBe(0);

    const summary = JSON.parse(compacted.stdout) as {
      consistent: boolean;
      status: string;
      tailWindow: number;
      inputKeys: string[];
      recentEvents: Array<{ type: string }>;
      checkpointHistory: Array<{ type: string; resolution: string }>;
      boundary?: { type: string };
    };
    expect(summary.consistent).toBe(true);
    expect(summary.status).toBe("running");
    expect(summary.tailWindow).toBe(2);
    expect(summary.inputKeys).toEqual(["includeClosed", "ticketId", "window"]);
    expect(summary.recentEvents.map((event) => event.type)).toEqual([
      "run_cancelled",
      "run_retried"
    ]);
    expect(summary.checkpointHistory).toHaveLength(1);
    expect(summary.checkpointHistory[0]).toMatchObject({
      type: "input",
      resolution: "provided"
    });
    expect(summary.boundary?.type).toBe("run_retried");

    const persistedSummary = await runCapstanCli([
      "harness:summary",
      outputDir,
      startedRun.id,
      "--json"
    ]);
    expect(persistedSummary.exitCode).toBe(0);
    expect(JSON.parse(persistedSummary.stdout)).toMatchObject({
      runId: startedRun.id,
      status: "running",
      tailWindow: 2
    });

    const summaries = await runCapstanCli(["harness:summaries", outputDir, "--json"]);
    expect(summaries.exitCode).toBe(0);
    expect(JSON.parse(summaries.stdout)).toMatchObject([
      {
        runId: startedRun.id,
        status: "running",
        taskKey: "generateDigestTask"
      }
    ]);

    const memory = await runCapstanCli([
      "harness:memory",
      outputDir,
      startedRun.id,
      "--json"
    ]);
    expect(memory.exitCode).toBe(0);
    const artifact = JSON.parse(memory.stdout) as {
      runId: string;
      nextAction: string;
      summaryPath: string;
      suggestedCommands: string[];
      prompt: string;
    };
    expect(artifact.runId).toBe(startedRun.id);
    expect(artifact.nextAction).toBe("continue");
    expect(artifact.summaryPath).toContain(`${startedRun.id}.json`);
    expect(artifact.suggestedCommands[0]).toContain("harness:get");
    expect(artifact.prompt).toContain(`resuming Capstan harness run "${startedRun.id}"`);

    const memories = await runCapstanCli(["harness:memories", outputDir, "--json"]);
    expect(memories.exitCode).toBe(0);
    expect(JSON.parse(memories.stdout)).toMatchObject([
      {
        runId: startedRun.id,
        nextAction: "continue",
        status: "running",
        fresh: true
      }
    ]);

    const pausedAgain = await runCapstanCli([
      "harness:pause",
      outputDir,
      startedRun.id,
      "--json",
      "--note",
      "Holding before dispatch"
    ]);
    expect(pausedAgain.exitCode).toBe(0);
    expect(JSON.parse(pausedAgain.stdout).status).toBe("paused");

    const staleSummaries = await runCapstanCli(["harness:summaries", outputDir, "--json"]);
    expect(staleSummaries.exitCode).toBe(0);
    expect(JSON.parse(staleSummaries.stdout)).toMatchObject([
      {
        runId: startedRun.id,
        fresh: false,
        status: "running"
      }
    ]);

    const staleMemories = await runCapstanCli(["harness:memories", outputDir, "--json"]);
    expect(staleMemories.exitCode).toBe(0);
    expect(JSON.parse(staleMemories.stdout)).toMatchObject([
      {
        runId: startedRun.id,
        fresh: false,
        nextAction: "continue",
        status: "running"
      }
    ]);

    const refreshedSummary = await runCapstanCli([
      "harness:summary",
      outputDir,
      startedRun.id,
      "--json"
    ]);
    expect(refreshedSummary.exitCode).toBe(0);
    expect(JSON.parse(refreshedSummary.stdout)).toMatchObject({
      runId: startedRun.id,
      status: "paused"
    });

    const refreshedMemory = await runCapstanCli([
      "harness:memory",
      outputDir,
      startedRun.id,
      "--json"
    ]);
    expect(refreshedMemory.exitCode).toBe(0);
    expect(JSON.parse(refreshedMemory.stdout)).toMatchObject({
      runId: startedRun.id,
      status: "paused",
      nextAction: "resume"
    });

    await expect(
      access(join(outputDir, ".capstan/harness/summaries", `${startedRun.id}.json`))
    ).resolves.toBeUndefined();
    await expect(
      access(join(outputDir, ".capstan/harness/memory", `${startedRun.id}.json`))
    ).resolves.toBeUndefined();
  }, 60_000);
});

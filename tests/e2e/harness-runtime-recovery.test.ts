import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("Capstan harness runtime e2e", () => {
  it(
    "survives interruption and recovers a long-running workflow from persisted events",
    async () => {
      const outputDir = await mkdtemp(join(tmpdir(), "capstan-harness-recovery-"));
      tempDirs.push(outputDir);

      const scaffoldResult = await runCapstanCli([
        "graph:scaffold",
        "./tests/fixtures/graphs/agent-surface-app-graph.json",
        outputDir
      ]);
      expect(scaffoldResult.exitCode).toBe(0);

      const outputPath = join(outputDir, "digest-output.json");
      await writeFile(
        outputPath,
        `${JSON.stringify({ artifactId: "digest-recovered" }, null, 2)}\n`,
        "utf8"
      );

      const started = await runCapstanCli([
        "harness:start",
        outputDir,
        "generateDigestTask",
        "--json"
      ]);
      const startedRun = JSON.parse(started.stdout) as { id: string };

      const paused = await runCapstanCli(["harness:pause", outputDir, startedRun.id, "--json"]);
      expect(JSON.parse(paused.stdout).status).toBe("paused");

      const replayWhilePaused = await runCapstanCli([
        "harness:replay",
        outputDir,
        startedRun.id,
        "--json"
      ]);
      const pausedReplay = JSON.parse(replayWhilePaused.stdout) as {
        consistent: boolean;
        replayed?: { status: string };
      };
      expect(pausedReplay.consistent).toBe(true);
      expect(pausedReplay.replayed?.status).toBe("paused");

      const resumed = await runCapstanCli(["harness:resume", outputDir, startedRun.id, "--json"]);
      expect(JSON.parse(resumed.stdout).status).toBe("running");

      const completed = await runCapstanCli([
        "harness:complete",
        outputDir,
        startedRun.id,
        "--json",
        "--output",
        outputPath
      ]);
      expect(JSON.parse(completed.stdout).status).toBe("completed");

      const finalReplay = await runCapstanCli([
        "harness:replay",
        outputDir,
        startedRun.id,
        "--json"
      ]);
      expect(finalReplay.exitCode).toBe(0);

      const replayReport = JSON.parse(finalReplay.stdout) as {
        consistent: boolean;
        eventCount: number;
        stored?: { status: string };
        replayed?: { status: string; output?: { artifactId: string } };
      };

      expect(replayReport.consistent).toBe(true);
      expect(replayReport.eventCount).toBe(4);
      expect(replayReport.stored?.status).toBe("completed");
      expect(replayReport.replayed?.status).toBe("completed");
      expect(replayReport.replayed?.output?.artifactId).toBe("digest-recovered");

      const compacted = await runCapstanCli([
        "harness:compact",
        outputDir,
        startedRun.id,
        "--json",
        "--tail",
        "3"
      ]);
      expect(compacted.exitCode).toBe(0);

      const summary = JSON.parse(compacted.stdout) as {
        consistent: boolean;
        status: string;
        recentEvents: Array<{ type: string }>;
      };
      expect(summary.consistent).toBe(true);
      expect(summary.status).toBe("completed");
      expect(summary.recentEvents.map((event) => event.type)).toEqual([
        "run_paused",
        "run_resumed",
        "run_completed"
      ]);

      const memory = await runCapstanCli([
        "harness:memory",
        outputDir,
        startedRun.id,
        "--json"
      ]);
      expect(memory.exitCode).toBe(0);

      const artifact = JSON.parse(memory.stdout) as {
        nextAction: string;
        prompt: string;
      };
      expect(artifact.nextAction).toBe("inspect_output");
      expect(artifact.prompt).toContain("Status: completed");

      await expect(access(join(outputDir, ".capstan/harness/events.ndjson"))).resolves.toBeUndefined();
      await expect(
        access(join(outputDir, ".capstan/harness/runs", `${startedRun.id}.json`))
      ).resolves.toBeUndefined();
      await expect(
        access(join(outputDir, ".capstan/harness/summaries", `${startedRun.id}.json`))
      ).resolves.toBeUndefined();
      await expect(
        access(join(outputDir, ".capstan/harness/memory", `${startedRun.id}.json`))
      ).resolves.toBeUndefined();
    },
    20_000
  );
});

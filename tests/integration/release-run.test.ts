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

describe("Capstan release run", () => {
  it("executes a preview release run and writes a release trace", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-run-preview-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const runResult = await runCapstanCli(["release:run", outputDir, "preview", "--json"]);
    expect(runResult.exitCode).toBe(0);

    const report = JSON.parse(runResult.stdout) as {
      target: string;
      status: string;
      steps: Array<{ key: string; status: string }>;
      artifactInventory: Array<{ key: string; exists: boolean }>;
      trace: { tracePath: string; target: string };
    };

    expect(report.target).toBe("preview");
    expect(report.status).toBe("completed");
    expect(report.steps.map((step) => [step.key, step.status])).toEqual([
      ["verify", "completed"],
      ["build", "completed"],
      ["inspectPreviewArtifacts", "completed"]
    ]);
    expect(report.artifactInventory.every((artifact) => artifact.exists)).toBe(true);
    expect(report.trace.target).toBe("preview");

    await expect(access(report.trace.tracePath)).resolves.toBeUndefined();

    const persistedTrace = JSON.parse(await readFile(report.trace.tracePath, "utf8")) as {
      status: string;
      target: string;
    };
    expect(persistedTrace.status).toBe("completed");
    expect(persistedTrace.target).toBe("preview");
  }, 20_000);

  it("blocks the release run when the release plan is unsafe", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-run-blocked-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "capstan.migrations.json"),
      JSON.stringify(
        {
          version: 1,
          generatedBy: "capstan",
          status: "unsafe",
          steps: [
            {
              key: "graphProjection",
              title: "Graph Projection Schema",
              status: "unsafe",
              description: "Manual review is required before promotion."
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const runResult = await runCapstanCli(["release:run", outputDir, "release", "--json"]);
    expect(runResult.exitCode).toBe(1);

    const report = JSON.parse(runResult.stdout) as {
      status: string;
      plan: { status: string };
      steps: Array<unknown>;
      trace: { tracePath: string };
    };

    expect(report.status).toBe("blocked");
    expect(report.plan.status).toBe("blocked");
    expect(report.steps).toEqual([]);
    await expect(access(report.trace.tracePath)).resolves.toBeUndefined();
  }, 15_000);

  it("supports custom environment and migration input paths during release execution", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-run-custom-inputs-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const customEnvironmentPath = join(outputDir, "release.release-env.json");
    const customMigrationPath = join(outputDir, "release.migrations.json");

    await writeFile(
      customEnvironmentPath,
      JSON.stringify(
        {
          version: 1,
          environments: [
            {
              key: "preview",
              variables: {
                NODE_ENV: "production",
                PORT: "3000"
              },
              secrets: []
            },
            {
              key: "release",
              variables: {
                NODE_ENV: "production"
              },
              secrets: []
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    await writeFile(
      customMigrationPath,
      JSON.stringify(
        {
          version: 1,
          generatedBy: "capstan",
          status: "safe",
          steps: [
            {
              key: "graphProjection",
              title: "Graph Projection Schema",
              status: "applied"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const runResult = await runCapstanCli([
      "release:run",
      outputDir,
      "release",
      "--json",
      "--env",
      customEnvironmentPath,
      "--migrations",
      customMigrationPath
    ]);
    expect(runResult.exitCode).toBe(0);

    const report = JSON.parse(runResult.stdout) as {
      status: string;
      trace: { environmentSnapshotPath: string; migrationPlanPath: string };
      steps: Array<{ key: string; status: string }>;
    };

    expect(report.status).toBe("completed");
    expect(report.trace.environmentSnapshotPath).toBe(customEnvironmentPath);
    expect(report.trace.migrationPlanPath).toBe(customMigrationPath);
    expect(report.steps.map((step) => [step.key, step.status])).toEqual([
      ["verify", "completed"],
      ["build", "completed"],
      ["publishArtifacts", "completed"],
      ["confirmHealth", "completed"]
    ]);
  }, 20_000);

  it("lists persisted release history and executes rollback from the latest completed release run", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-history-rollback-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const previewRun = await runCapstanCli(["release:run", outputDir, "preview", "--json"]);
    expect(previewRun.exitCode).toBe(0);

    const releaseRun = await runCapstanCli(["release:run", outputDir, "release", "--json"]);
    expect(releaseRun.exitCode).toBe(0);

    const historyResult = await runCapstanCli(["release:history", outputDir, "--json"]);
    expect(historyResult.exitCode).toBe(0);

    const history = JSON.parse(historyResult.stdout) as {
      runs: Array<{ target: string; status: string; tracePath: string }>;
    };

    expect(history.runs.map((run) => `${run.target}:${run.status}`)).toEqual([
      "release:completed",
      "preview:completed"
    ]);

    const rollbackResult = await runCapstanCli(["release:rollback", outputDir, "--json"]);
    expect(rollbackResult.exitCode).toBe(0);

    const rollback = JSON.parse(rollbackResult.stdout) as {
      status: string;
      sourceRun?: { target: string; tracePath: string };
      steps: Array<{ status: string }>;
      trace: { tracePath: string; sourceTracePath?: string };
    };

    expect(rollback.status).toBe("completed");
    expect(rollback.sourceRun?.target).toBe("release");
    expect(rollback.steps.every((step) => step.status === "completed")).toBe(true);
    expect(rollback.trace.sourceTracePath).toBe(rollback.sourceRun?.tracePath);
    await expect(access(rollback.trace.tracePath)).resolves.toBeUndefined();
  }, 20_000);

  it("supports rollback from an explicit persisted trace path", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-rollback-trace-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const previewRun = await runCapstanCli(["release:run", outputDir, "preview", "--json"]);
    expect(previewRun.exitCode).toBe(0);

    const previewReport = JSON.parse(previewRun.stdout) as {
      trace: { tracePath: string };
    };

    const rollbackResult = await runCapstanCli([
      "release:rollback",
      outputDir,
      "--json",
      "--trace",
      previewReport.trace.tracePath
    ]);
    expect(rollbackResult.exitCode).toBe(0);

    const rollback = JSON.parse(rollbackResult.stdout) as {
      sourceRun?: { target: string; tracePath: string };
      trace: { sourceTracePath?: string };
    };

    expect(rollback.sourceRun?.target).toBe("preview");
    expect(rollback.trace.sourceTracePath).toBe(previewReport.trace.tracePath);
  }, 20_000);
});

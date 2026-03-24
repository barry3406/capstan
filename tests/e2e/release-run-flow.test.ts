import { access, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("Capstan release run e2e", () => {
  it(
    "moves from completed to blocked and back to completed across preview and release runs",
    async () => {
      const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-run-flow-"));
      tempDirs.push(outputDir);

      const scaffoldResult = await runCapstanCli([
        "graph:scaffold",
        "./tests/fixtures/graphs/basic-app-graph.json",
        outputDir
      ]);

      expect(scaffoldResult.exitCode).toBe(0);

      const previewRun = await runCapstanCli(["release:run", outputDir, "preview"]);
      expect(previewRun.exitCode).toBe(0);
      expect(previewRun.stdout).toContain("Capstan Release Run");
      expect(previewRun.stdout).toContain("Target: preview");
      expect(previewRun.stdout).toContain("Status: completed");
      expect(previewRun.stdout).toContain("Artifact Inventory");

      await writeFile(
        join(outputDir, "capstan.release-env.json"),
        JSON.stringify(
          {
            version: 1,
            environments: [
              {
                key: "preview",
                variables: {
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

      const blockedRun = await runCapstanCli(["release:run", outputDir, "release"]);
      expect(blockedRun.exitCode).toBe(1);
      expect(blockedRun.stdout).toContain("Status: blocked");
      expect(blockedRun.stdout).toContain(
        "No release steps were executed because the release plan was blocked."
      );

      await writeFile(
        join(outputDir, "capstan.release-env.json"),
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

      const releaseRun = await runCapstanCli(["release:run", outputDir, "release", "--json"]);
      expect(releaseRun.exitCode).toBe(0);

      const report = JSON.parse(releaseRun.stdout) as {
        status: string;
        trace: { tracePath: string; target: string };
        steps: Array<{ key: string; status: string }>;
      };

      expect(report.status).toBe("completed");
      expect(report.trace.target).toBe("release");
      expect(report.steps.map((step) => [step.key, step.status])).toEqual([
        ["verify", "completed"],
        ["build", "completed"],
        ["publishArtifacts", "completed"],
        ["confirmHealth", "completed"]
      ]);

      await expect(access(report.trace.tracePath)).resolves.toBeUndefined();

      const persistedTrace = JSON.parse(await readFile(report.trace.tracePath, "utf8")) as {
        status: string;
        trace: { target: string };
      };

      expect(persistedTrace.status).toBe("completed");
      expect(persistedTrace.trace.target).toBe("release");

      const historyResult = await runCapstanCli(["release:history", outputDir]);
      expect(historyResult.exitCode).toBe(0);
      expect(historyResult.stdout).toContain("Capstan Release History");
      expect(historyResult.stdout).toContain("[completed] release");
      expect(historyResult.stdout).toContain("[completed] preview");

      const rollbackRun = await runCapstanCli(["release:rollback", outputDir, "--json"]);
      expect(rollbackRun.exitCode).toBe(0);

      const rollbackReport = JSON.parse(rollbackRun.stdout) as {
        status: string;
        sourceRun?: { target: string; tracePath: string };
        trace: { tracePath: string; sourceTracePath?: string };
      };

      expect(rollbackReport.status).toBe("completed");
      expect(rollbackReport.sourceRun?.target).toBe("release");
      expect(rollbackReport.trace.sourceTracePath).toBe(report.trace.tracePath);
      await expect(access(rollbackReport.trace.tracePath)).resolves.toBeUndefined();
    },
    60_000
  );
});

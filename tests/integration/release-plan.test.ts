import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

describe("Capstan release plan", () => {
  it("creates a ready release plan for a healthy generated app", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-plan-ready-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const planResult = await runCapstanCli(["release:plan", outputDir, "--json"]);
    expect(planResult.exitCode).toBe(0);

    const report = JSON.parse(planResult.stdout) as {
      status: string;
      contract: { preview: { steps: Array<{ key: string }> } };
      gates: Array<{ key: string; status: string }>;
      preview: { steps: Array<{ key: string }> };
      release: { steps: Array<{ key: string }> };
      trace: { environmentSnapshotPath: string; migrationPlanPath: string };
    };

    expect(report.status).toBe("ready");
    expect(report.contract.preview.steps.map((step) => step.key)).toContain("verify");
    expect(report.preview.steps.map((step) => step.key)).toContain("inspectPreviewArtifacts");
    expect(report.release.steps.map((step) => step.key)).toContain("publishArtifacts");
    expect(report.gates.find((gate) => gate.key === "environment:preview")?.status).toBe("passed");
    expect(report.gates.find((gate) => gate.key === "migration:status")?.status).toBe("passed");
    expect(report.trace.environmentSnapshotPath).toContain("capstan.release-env.json");
    expect(report.trace.migrationPlanPath).toContain("capstan.migrations.json");
    expect(report.gates.every((gate) => gate.status === "passed")).toBe(true);
  }, 15_000);

  it("blocks the release plan when verify or health checks fail", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-plan-blocked-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/list-tickets.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { listTicketsCapability } from "./generated/list-tickets.js";',
        "",
        "export async function listTickets(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: listTicketsCapability.key,",
        '    status: "pending",',
        "    input",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const planResult = await runCapstanCli(["release:plan", outputDir, "--json"]);
    expect(planResult.exitCode).toBe(1);

    const report = JSON.parse(planResult.stdout) as {
      status: string;
      gates: Array<{ key: string; status: string; summary: string }>;
    };

    expect(report.status).toBe("blocked");
    expect(report.gates.find((gate) => gate.key === "verify")?.status).toBe("failed");
  }, 15_000);

  it("blocks the release plan when environment snapshot drift is detected", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-plan-env-drift-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "capstan.release-env.json"),
      JSON.stringify(
        {
          version: 1,
          environments: [
            {
              key: "preview",
              variables: {
                PORT: "3000",
                EXTRA_FLAG: "1"
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

    const planResult = await runCapstanCli(["release:plan", outputDir, "--json"]);
    expect(planResult.exitCode).toBe(1);

    const report = JSON.parse(planResult.stdout) as {
      status: string;
      gates: Array<{ key: string; status: string; detail?: string }>;
    };

    expect(report.status).toBe("blocked");
    expect(report.gates.find((gate) => gate.key === "environment:preview")?.status).toBe("failed");
    expect(report.gates.find((gate) => gate.key === "environment:preview")?.detail).toContain(
      "missing variables: NODE_ENV"
    );
    expect(report.gates.find((gate) => gate.key === "environment:preview")?.detail).toContain(
      "unknown variables: EXTRA_FLAG"
    );
  }, 15_000);

  it("blocks the release plan when the migration plan is pending", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-plan-migrations-"));
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
          status: "pending",
          steps: [
            {
              key: "graphProjection",
              title: "Graph Projection Schema",
              status: "pending",
              description: "Schema change still needs to be applied."
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const planResult = await runCapstanCli(["release:plan", outputDir, "--json"]);
    expect(planResult.exitCode).toBe(1);

    const report = JSON.parse(planResult.stdout) as {
      status: string;
      gates: Array<{ key: string; status: string; summary: string }>;
    };

    expect(report.status).toBe("blocked");
    expect(report.gates.find((gate) => gate.key === "migration:status")?.status).toBe("failed");
    expect(report.gates.find((gate) => gate.key === "migration:status")?.summary).toContain(
      "pending"
    );
  }, 30_000);

  it("supports custom environment and migration input paths", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-plan-custom-inputs-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const customEnvironmentPath = join(outputDir, "preview.release-env.json");
    const customMigrationPath = join(outputDir, "preview.migrations.json");

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

    const planResult = await runCapstanCli([
      "release:plan",
      outputDir,
      "--json",
      "--env",
      customEnvironmentPath,
      "--migrations",
      customMigrationPath
    ]);
    expect(planResult.exitCode).toBe(0);

    const report = JSON.parse(planResult.stdout) as {
      status: string;
      trace: { environmentSnapshotPath: string; migrationPlanPath: string };
    };

    expect(report.status).toBe("ready");
    expect(report.trace.environmentSnapshotPath).toBe(customEnvironmentPath);
    expect(report.trace.migrationPlanPath).toBe(customMigrationPath);
  }, 15_000);

  it("reads the generated release contract from scaffolded output", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-contract-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const releaseContract = JSON.parse(
      await readFile(join(outputDir, "capstan.release.json"), "utf8")
    ) as {
      inputs: { environmentSnapshot: { path: string }; migrationPlan: { path: string } };
      preview: { steps: Array<{ key: string }> };
      healthChecks: Array<{ kind: string }>;
    };

    expect(releaseContract.inputs.environmentSnapshot.path).toBe("capstan.release-env.json");
    expect(releaseContract.inputs.migrationPlan.path).toBe("capstan.migrations.json");
    expect(releaseContract.preview.steps.map((step) => step.key)).toContain("verify");
    expect(releaseContract.healthChecks.map((check) => check.kind)).toContain("verify_pass");
  });
});

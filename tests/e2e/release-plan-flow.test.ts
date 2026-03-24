import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("Capstan release plan e2e", () => {
  it(
    "moves from ready to blocked and back to ready across a simulated release flow",
    async () => {
      const outputDir = await mkdtemp(join(tmpdir(), "capstan-release-flow-"));
      tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const readyPlan = await runCapstanCli(["release:plan", outputDir]);
    expect(readyPlan.exitCode).toBe(0);
    expect(readyPlan.stdout).toContain("Capstan Release Plan");
    expect(readyPlan.stdout).toContain("Status: ready");
    expect(readyPlan.stdout).toContain("Safety Gates");

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

    const blockedPlan = await runCapstanCli(["release:plan", outputDir]);
    expect(blockedPlan.exitCode).toBe(1);
    expect(blockedPlan.stdout).toContain("Status: blocked");
    expect(blockedPlan.stdout).toContain("Capstan verify must pass before preview or release can continue.");

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
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      records: [",
        '        { status: "open", title: "Release Flow Ticket" }',
        "      ]",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const repairedPlan = await runCapstanCli(["release:plan", outputDir]);
    expect(repairedPlan.exitCode).toBe(0);
    expect(repairedPlan.stdout).toContain("Status: ready");
    expect(repairedPlan.stdout).toContain("Publish Compiled And Surface Artifacts");

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

    const envBlockedPlan = await runCapstanCli(["release:plan", outputDir]);
    expect(envBlockedPlan.exitCode).toBe(1);
    expect(envBlockedPlan.stdout).toContain("Environment snapshot drift detected");

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
              status: "pending"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const migrationBlockedPlan = await runCapstanCli(["release:plan", outputDir]);
    expect(migrationBlockedPlan.exitCode).toBe(1);
    expect(migrationBlockedPlan.stdout).toContain("Migration plan still has pending steps.");

    await writeFile(
      join(outputDir, "capstan.migrations.json"),
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

    const fullyReadyPlan = await runCapstanCli(["release:plan", outputDir]);
    expect(fullyReadyPlan.exitCode).toBe(0);
    expect(fullyReadyPlan.stdout).toContain("Status: ready");
    expect(fullyReadyPlan.stdout).toContain("environmentSnapshotPath");
    },
    60_000
  );
});

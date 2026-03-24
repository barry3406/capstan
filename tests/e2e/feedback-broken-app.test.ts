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

describe("Capstan broken app e2e", () => {
  it("surfaces actionable repair steps for a broken generated app and passes again after repair", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-broken-app-e2e-"));
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

    const brokenVerify = await runCapstanCli(["verify", outputDir]);
    expect(brokenVerify.exitCode).toBe(1);
    expect(brokenVerify.stdout).toContain("Status: failed");
    expect(brokenVerify.stdout).toContain("[failed] TypeScript Check");
    expect(brokenVerify.stdout).toContain("Repair Checklist");
    expect(brokenVerify.stdout).toContain("1. TypeScript Check");
    expect(brokenVerify.stdout).toContain("src/capabilities/list-tickets.ts");
    expect(brokenVerify.stdout).toContain("next: Align the handler output");

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
        '        { status: "open", title: "Smoke Ticket" }',
        "      ]",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const repairedVerify = await runCapstanCli(["verify", outputDir]);
    expect(repairedVerify.exitCode).toBe(0);
    expect(repairedVerify.stdout).toContain("Status: passed");
    expect(repairedVerify.stdout).not.toContain("Repair Checklist");
  }, 20_000);
});

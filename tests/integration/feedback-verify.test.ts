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

describe("Capstan feedback verify", () => {
  it("verifies a generated app and emits a passing structured report", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-verify-pass-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const verifyResult = await runCapstanCli(["verify", outputDir, "--json"]);
    expect(verifyResult.exitCode).toBe(0);

    const report = JSON.parse(verifyResult.stdout) as {
      status: string;
      summary: { failedSteps: number; errorCount: number };
      steps: Array<{ key: string; status: string }>;
    };

    expect(report.status).toBe("passed");
    expect(report.summary.failedSteps).toBe(0);
    expect(report.summary.errorCount).toBe(0);
    expect(report.steps.map((step) => ({ key: step.key, status: step.status }))).toEqual([
      { key: "structure", status: "passed" },
      { key: "contracts", status: "passed" },
      { key: "typecheck", status: "passed" },
      { key: "build", status: "passed" },
      { key: "assertions", status: "passed" },
      { key: "smoke", status: "passed" }
    ]);
  }, 15_000);

  it("turns TypeScript failures into repair-oriented diagnostics", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-verify-fail-"));
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

    const verifyResult = await runCapstanCli(["verify", outputDir, "--json"]);
    expect(verifyResult.exitCode).toBe(1);

    const report = JSON.parse(verifyResult.stdout) as {
      status: string;
      steps: Array<{
        key: string;
        status: string;
        diagnostics: Array<{ code: string; file?: string; hint?: string }>;
      }>;
    };

    expect(report.status).toBe("failed");
    expect(report.steps.map((step) => [step.key, step.status])).toEqual([
      ["structure", "passed"],
      ["contracts", "passed"],
      ["typecheck", "failed"],
      ["build", "skipped"],
      ["assertions", "skipped"],
      ["smoke", "skipped"]
    ]);

    const typecheckStep = report.steps.find((step) => step.key === "typecheck");
    expect(typecheckStep?.diagnostics[0]?.code).toBe("typescript_error");
    expect(typecheckStep?.diagnostics[0]?.file).toContain("src/capabilities/list-tickets.ts");
    expect(typecheckStep?.diagnostics[0]?.hint).toContain("Align the handler output");
  }, 15_000);

  it("fails the smoke step when the built runtime stops exposing required exports", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-verify-smoke-fail-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/index.ts"),
      [
        'export { domain } from "./domain.js";',
        'export { agentSurface, agentSurfaceManifest, renderAgentSurfaceManifest } from "./agent-surface/index.js";',
        'export { humanSurface, humanSurfaceHtml, renderHumanSurfaceDocument } from "./human-surface/index.js";',
        'export { resources } from "./resources/index.js";',
        'export { capabilities, capabilityHandlers } from "./capabilities/index.js";',
        'export { tasks } from "./tasks/index.js";',
        'export { policies } from "./policies/index.js";',
        'export { artifacts } from "./artifacts/index.js";',
        'export { views } from "./views/index.js";'
      ].join("\n"),
      "utf8"
    );

    const verifyResult = await runCapstanCli(["verify", outputDir, "--json"]);
    expect(verifyResult.exitCode).toBe(1);

    const report = JSON.parse(verifyResult.stdout) as {
      status: string;
      steps: Array<{
        key: string;
        status: string;
        diagnostics: Array<{ code: string; summary?: string; hint?: string }>;
      }>;
    };

    expect(report.status).toBe("failed");
    expect(report.steps.map((step) => [step.key, step.status])).toEqual([
      ["structure", "passed"],
      ["contracts", "passed"],
      ["typecheck", "passed"],
      ["build", "passed"],
      ["assertions", "passed"],
      ["smoke", "failed"]
    ]);

    const smokeStep = report.steps.find((step) => step.key === "smoke");
    expect(smokeStep?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "missing_control_plane_search"
    );
    expect(smokeStep?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "missing_agent_transport_handler"
    );
  }, 30_000);

  it("fails the smoke step when transport and human-surface behavior drift from generated contracts", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-verify-smoke-behavior-fail-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const transportPath = join(outputDir, "src/agent-surface/transport.ts");
    const transportContents = await readFile(transportPath, "utf8");
    await writeFile(
      transportPath,
      transportContents.replace(
        "body: search(request.query ?? \"\")",
        "body: { capabilities: [], tasks: [], artifacts: [] }"
      ),
      "utf8"
    );

    const humanSurfacePath = join(outputDir, "src/human-surface/index.ts");
    const humanSurfaceContents = await readFile(humanSurfacePath, "utf8");
    await writeFile(
      humanSurfacePath,
      humanSurfaceContents.replace(
        "return humanSurfaceHtml;",
        'return "<!doctype html><html><body><main>broken</main></body></html>";'
      ),
      "utf8"
    );

    const verifyResult = await runCapstanCli(["verify", outputDir, "--json"]);
    expect(verifyResult.exitCode).toBe(1);

    const report = JSON.parse(verifyResult.stdout) as {
      status: string;
      steps: Array<{
        key: string;
        status: string;
        diagnostics: Array<{ code: string }>;
      }>;
    };

    expect(report.status).toBe("failed");
    expect(report.steps.map((step) => [step.key, step.status])).toEqual([
      ["structure", "passed"],
      ["contracts", "passed"],
      ["typecheck", "passed"],
      ["build", "passed"],
      ["assertions", "passed"],
      ["smoke", "failed"]
    ]);

    const smokeStep = report.steps.find((step) => step.key === "smoke");
    expect(smokeStep?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "agent_transport_search_count_mismatch"
    );
    expect(smokeStep?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "human_surface_render_mismatch"
    );
  }, 15_000);

  it("fails the contract step when the agent surface manifest drifts from the app graph", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-verify-contract-fail-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/agent-surface-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const manifestPath = join(outputDir, "agent-surface.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      transport?: { auth?: { effects?: string[] } };
      capabilities?: Array<{ key?: string; policy?: string }>;
    };

    if (manifest.transport?.auth?.effects) {
      manifest.transport.auth.effects = manifest.transport.auth.effects.filter(
        (effect) => effect !== "redact"
      );
    }

    if (manifest.capabilities?.[0]) {
      delete manifest.capabilities[0].policy;
    }

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const verifyResult = await runCapstanCli(["verify", outputDir, "--json"]);
    expect(verifyResult.exitCode).toBe(1);

    const report = JSON.parse(verifyResult.stdout) as {
      status: string;
      steps: Array<{
        key: string;
        status: string;
        diagnostics: Array<{ code: string }>;
      }>;
    };

    expect(report.status).toBe("failed");
    expect(report.steps.map((step) => [step.key, step.status])).toEqual([
      ["structure", "passed"],
      ["contracts", "failed"],
      ["typecheck", "skipped"],
      ["build", "skipped"],
      ["assertions", "skipped"],
      ["smoke", "skipped"]
    ]);

    const contractStep = report.steps.find((step) => step.key === "contracts");
    expect(contractStep?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "policy_projection_mismatch"
    );
    expect(contractStep?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "missing_transport_auth_effect"
    );
  });

  it("fails the assertions step when a custom app assertion reports a regression", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-verify-assertion-fail-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/assertions/custom.ts"),
      [
        'import type { AppAssertion } from "../types.js";',
        "",
        "export const customAssertions: readonly AppAssertion[] = [",
        "  {",
        '    key: "customRegression",',
        '    title: "Custom Regression",',
        '    source: "custom",',
        "    run() {",
        "      return {",
        '        status: "failed",',
        '        summary: "Custom assertion detected a regression.",',
        '        hint: "Inspect the custom assertion logic and fix the generated app behavior.",',
        '        file: "src/assertions/custom.ts"',
        "      };",
        "    }",
        "  }",
        "];"
      ].join("\n"),
      "utf8"
    );

    const verifyResult = await runCapstanCli(["verify", outputDir, "--json"]);
    expect(verifyResult.exitCode).toBe(1);

    const report = JSON.parse(verifyResult.stdout) as {
      status: string;
      steps: Array<{
        key: string;
        status: string;
        diagnostics: Array<{ code: string; file?: string; hint?: string; summary?: string }>;
      }>;
    };

    expect(report.status).toBe("failed");
    expect(report.steps.map((step) => [step.key, step.status])).toEqual([
      ["structure", "passed"],
      ["contracts", "passed"],
      ["typecheck", "passed"],
      ["build", "passed"],
      ["assertions", "failed"],
      ["smoke", "skipped"]
    ]);

    const assertionStep = report.steps.find((step) => step.key === "assertions");
    expect(assertionStep?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "app_assertion_failed"
    );
    expect(assertionStep?.diagnostics[0]?.summary).toContain("Custom assertion detected a regression");
    expect(assertionStep?.diagnostics[0]?.file).toContain("src/assertions/custom.ts");
    expect(assertionStep?.diagnostics[0]?.hint).toContain("Inspect the custom assertion logic");
  }, 15_000);
});

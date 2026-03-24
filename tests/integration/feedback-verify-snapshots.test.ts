import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { repoRoot } from "../helpers/paths.ts";
import { runCapstanCli } from "../helpers/run-cli.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Capstan feedback verify snapshots", () => {
  it("keeps typecheck failure JSON diagnostics stable", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-verify-snapshot-json-"));
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

    expect(normalizeVerifyJson(verifyResult.stdout, outputDir)).toMatchSnapshot();
  }, 20000);

  it("keeps human-readable smoke failure output stable", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-verify-snapshot-text-"));
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

    const verifyResult = await runCapstanCli(["verify", outputDir]);
    expect(verifyResult.exitCode).toBe(1);

    expect(normalizeVerifyText(verifyResult.stdout, outputDir)).toMatchSnapshot();
  }, 20000);

  it("keeps behavior-oriented smoke failure output stable", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-verify-snapshot-behavior-"));
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

    const verifyResult = await runCapstanCli(["verify", outputDir]);
    expect(verifyResult.exitCode).toBe(1);

    expect(normalizeVerifyText(verifyResult.stdout, outputDir)).toMatchSnapshot();
  }, 20000);

  it("keeps contract failure JSON diagnostics stable", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-verify-snapshot-contract-"));
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

    expect(normalizeVerifyJson(verifyResult.stdout, outputDir)).toMatchSnapshot();
  }, 20000);
});

function normalizeVerifyJson(stdout: string, appRoot: string): unknown {
  const report = JSON.parse(stdout) as {
    appRoot: string;
    steps: Array<{
      key: string;
      label: string;
      status: string;
      durationMs: number;
      diagnostics: Array<{
        code: string;
        severity: string;
        summary: string;
        detail?: string;
        hint?: string;
        file?: string;
        line?: number;
        column?: number;
        source?: string;
      }>;
      command?: string;
    }>;
    diagnostics: Array<{
      code: string;
      severity: string;
      summary: string;
      detail?: string;
      hint?: string;
      file?: string;
      line?: number;
      column?: number;
      source?: string;
    }>;
  };

  return {
    ...report,
    appRoot: "<APP_ROOT>",
    steps: report.steps.map((step) => ({
      ...step,
      durationMs: 0,
      diagnostics: step.diagnostics.map(normalizeDiagnostic.bind(null, appRoot)),
      ...(step.command ? { command: normalizePath(step.command, appRoot) } : {})
    })),
    diagnostics: report.diagnostics.map(normalizeDiagnostic.bind(null, appRoot))
  };
}

function normalizeVerifyText(stdout: string, appRoot: string): string {
  return normalizePath(stdout, appRoot).replace(/\(\d+ms\)/g, "(<DURATION>ms)");
}

function normalizeDiagnostic(
  appRoot: string,
  diagnostic: {
    code: string;
    severity: string;
    summary: string;
    detail?: string;
    hint?: string;
    file?: string;
    line?: number;
    column?: number;
    source?: string;
  }
): typeof diagnostic {
  return {
    ...diagnostic,
    ...(diagnostic.file ? { file: normalizePath(diagnostic.file, appRoot) } : {}),
    ...(diagnostic.detail ? { detail: normalizePath(diagnostic.detail, appRoot) } : {})
  };
}

function normalizePath(value: string, appRoot: string): string {
  return value
    .replaceAll(repoRoot, "<REPO_ROOT>")
    .replaceAll(appRoot, "<APP_ROOT>");
}

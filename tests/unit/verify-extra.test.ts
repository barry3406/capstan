import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyCapstanApp, renderRuntimeVerifyText } from "@zauso-ai/capstan-core";
import type { VerifyReport, VerifyStep, VerifyDiagnostic } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Temp dir lifecycle
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "verify-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: create a minimal valid app structure
// ---------------------------------------------------------------------------

async function createMinimalApp(root: string): Promise<void> {
  await mkdir(join(root, "app", "routes"), { recursive: true });
  await writeFile(
    join(root, "capstan.config.ts"),
    `export default { app: { name: "test", title: "Test" } };\n`,
  );
  await writeFile(join(root, "package.json"), `{ "name": "test-app" }\n`);
  await writeFile(join(root, "tsconfig.json"), `{ "compilerOptions": {} }\n`);
}

// ---------------------------------------------------------------------------
// verifyCapstanApp — report shape
// ---------------------------------------------------------------------------

describe("verifyCapstanApp", () => {
  it("returns a VerifyReport object", async () => {
    const report = await verifyCapstanApp(tempDir);
    expect(report).toBeDefined();
    expect(typeof report.status).toBe("string");
    expect(typeof report.appRoot).toBe("string");
    expect(typeof report.timestamp).toBe("string");
    expect(Array.isArray(report.steps)).toBe(true);
    expect(Array.isArray(report.repairChecklist)).toBe(true);
    expect(typeof report.summary).toBe("object");
  });

  it("VerifyReport has steps array with expected step names", async () => {
    await createMinimalApp(tempDir);
    const report = await verifyCapstanApp(tempDir);
    expect(report.steps.length).toBeGreaterThanOrEqual(1);
    for (const step of report.steps) {
      expect(typeof step.name).toBe("string");
      expect(["passed", "failed", "skipped"]).toContain(step.status);
      expect(typeof step.durationMs).toBe("number");
      expect(Array.isArray(step.diagnostics)).toBe(true);
    }
  });

  it("report includes summary with correct counts", async () => {
    const report = await verifyCapstanApp(tempDir);
    const { summary } = report;
    expect(typeof summary.totalSteps).toBe("number");
    expect(typeof summary.passedSteps).toBe("number");
    expect(typeof summary.failedSteps).toBe("number");
    expect(typeof summary.skippedSteps).toBe("number");
    expect(typeof summary.errorCount).toBe("number");
    expect(typeof summary.warningCount).toBe("number");
    expect(summary.totalSteps).toBe(report.steps.length);
    expect(summary.passedSteps + summary.failedSteps + summary.skippedSteps).toBe(
      summary.totalSteps,
    );
  });
});

// ---------------------------------------------------------------------------
// Structure step
// ---------------------------------------------------------------------------

describe("structure step", () => {
  it("passes when all required files exist", async () => {
    await createMinimalApp(tempDir);
    const report = await verifyCapstanApp(tempDir);
    const structureStep = report.steps.find((s) => s.name === "structure");
    expect(structureStep).toBeDefined();
    expect(structureStep!.status).toBe("passed");
  });

  it("fails when config file is missing", async () => {
    // Create everything except config
    await mkdir(join(tempDir, "app", "routes"), { recursive: true });
    await writeFile(join(tempDir, "package.json"), `{ "name": "test" }\n`);
    await writeFile(join(tempDir, "tsconfig.json"), `{}\n`);

    const report = await verifyCapstanApp(tempDir);
    const structureStep = report.steps.find((s) => s.name === "structure");
    expect(structureStep).toBeDefined();
    expect(structureStep!.status).toBe("failed");
    const configDiag = structureStep!.diagnostics.find(
      (d) => d.code === "missing_config",
    );
    expect(configDiag).toBeDefined();
    expect(configDiag!.severity).toBe("error");
  });

  it("fails when app/routes directory is missing", async () => {
    await writeFile(join(tempDir, "capstan.config.ts"), "export default {};\n");
    await writeFile(join(tempDir, "package.json"), `{}\n`);
    await writeFile(join(tempDir, "tsconfig.json"), `{}\n`);

    const report = await verifyCapstanApp(tempDir);
    const structureStep = report.steps.find((s) => s.name === "structure");
    expect(structureStep).toBeDefined();
    expect(structureStep!.status).toBe("failed");
    const routesDiag = structureStep!.diagnostics.find(
      (d) => d.code === "missing_routes_dir",
    );
    expect(routesDiag).toBeDefined();
  });

  it("fails on empty directory (no files at all)", async () => {
    const report = await verifyCapstanApp(tempDir);
    expect(report.status).toBe("failed");
    const structureStep = report.steps.find((s) => s.name === "structure");
    expect(structureStep).toBeDefined();
    expect(structureStep!.status).toBe("failed");
    // Should have multiple missing-file diagnostics
    const errorDiags = structureStep!.diagnostics.filter(
      (d) => d.severity === "error",
    );
    expect(errorDiags.length).toBeGreaterThanOrEqual(3); // config, routes, package.json, tsconfig
  });
});

// ---------------------------------------------------------------------------
// Config step
// ---------------------------------------------------------------------------

describe("config step", () => {
  it("passes with a valid capstan.config.ts that has a default export", async () => {
    await createMinimalApp(tempDir);
    const report = await verifyCapstanApp(tempDir);
    const configStep = report.steps.find((s) => s.name === "config");
    expect(configStep).toBeDefined();
    expect(configStep!.status).toBe("passed");
  });

  it("is skipped when structure step fails", async () => {
    // Empty dir => structure fails
    const report = await verifyCapstanApp(tempDir);
    const configStep = report.steps.find((s) => s.name === "config");
    expect(configStep).toBeDefined();
    expect(configStep!.status).toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// Cascade / skip behaviour
// ---------------------------------------------------------------------------

describe("cascade order", () => {
  it("skips later steps when structure fails", async () => {
    const report = await verifyCapstanApp(tempDir);
    const stepNames = report.steps.map((s) => s.name);
    // structure should be first
    expect(stepNames[0]).toBe("structure");
    // All others should be skipped
    const nonStructureSteps = report.steps.filter((s) => s.name !== "structure");
    for (const step of nonStructureSteps) {
      expect(step.status).toBe("skipped");
    }
  });

  it("total steps equals 8 in the cascade", async () => {
    const report = await verifyCapstanApp(tempDir);
    expect(report.steps.length).toBe(8);
  });

  it("multiple steps can fail independently (models runs even if routes has warnings)", async () => {
    // Models and routes are somewhat independent — models runs even if routes passed/warned
    await createMinimalApp(tempDir);
    // Create a models dir with an empty file (no exports => warning)
    await mkdir(join(tempDir, "app", "models"), { recursive: true });
    await writeFile(
      join(tempDir, "app", "models", "ticket.ts"),
      "// empty file with no exports\n",
    );

    const report = await verifyCapstanApp(tempDir);
    const modelsStep = report.steps.find((s) => s.name === "models");
    expect(modelsStep).toBeDefined();
    // Should at least run (not be skipped)
    expect(modelsStep!.status).not.toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// Diagnostics & repairChecklist
// ---------------------------------------------------------------------------

describe("diagnostics and repairChecklist", () => {
  it("diagnostics include fixCategory and autoFixable", async () => {
    const report = await verifyCapstanApp(tempDir);
    // Structure step failure should have diagnostics with fixCategory
    const structureStep = report.steps.find((s) => s.name === "structure");
    expect(structureStep).toBeDefined();
    const diagsWithFix = structureStep!.diagnostics.filter(
      (d) => d.fixCategory !== undefined,
    );
    expect(diagsWithFix.length).toBeGreaterThan(0);
    for (const d of diagsWithFix) {
      expect(typeof d.fixCategory).toBe("string");
    }
  });

  it("repairChecklist items have correct structure", async () => {
    const report = await verifyCapstanApp(tempDir);
    expect(report.repairChecklist.length).toBeGreaterThan(0);
    for (const item of report.repairChecklist) {
      expect(typeof item.index).toBe("number");
      expect(typeof item.step).toBe("string");
      expect(typeof item.message).toBe("string");
      // Optional fields should be correct types when present
      if (item.hint !== undefined) expect(typeof item.hint).toBe("string");
      if (item.file !== undefined) expect(typeof item.file).toBe("string");
      if (item.fixCategory !== undefined) expect(typeof item.fixCategory).toBe("string");
      if (item.autoFixable !== undefined) expect(typeof item.autoFixable).toBe("boolean");
    }
  });

  it("repairChecklist indices are sequential starting from 1", async () => {
    const report = await verifyCapstanApp(tempDir);
    for (let i = 0; i < report.repairChecklist.length; i++) {
      expect(report.repairChecklist[i]!.index).toBe(i + 1);
    }
  });

  it("repairChecklist excludes info-severity diagnostics", async () => {
    await createMinimalApp(tempDir);
    const report = await verifyCapstanApp(tempDir);
    // Info diagnostics should not appear in checklist
    for (const item of report.repairChecklist) {
      // repairChecklist items correspond to error/warning, not info
      const step = report.steps.find((s) => s.name === item.step);
      if (step) {
        const matchingDiag = step.diagnostics.find(
          (d) => d.message === item.message,
        );
        if (matchingDiag) {
          expect(matchingDiag.severity).not.toBe("info");
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// renderRuntimeVerifyText
// ---------------------------------------------------------------------------

describe("renderRuntimeVerifyText", () => {
  it("produces a non-empty string", async () => {
    const report = await verifyCapstanApp(tempDir);
    const text = renderRuntimeVerifyText(report);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("includes 'Capstan Verify' header", async () => {
    const report = await verifyCapstanApp(tempDir);
    const text = renderRuntimeVerifyText(report);
    expect(text).toContain("Capstan Verify");
  });

  it("shows step names in output", async () => {
    const report = await verifyCapstanApp(tempDir);
    const text = renderRuntimeVerifyText(report);
    expect(text).toContain("structure");
  });

  it("shows error count in output", async () => {
    const report = await verifyCapstanApp(tempDir);
    const text = renderRuntimeVerifyText(report);
    // Should contain something like "4 errors, 0 warnings"
    expect(text).toMatch(/\d+ errors?, \d+ warnings?/);
  });

  it("shows Repair Checklist when errors exist", async () => {
    const report = await verifyCapstanApp(tempDir);
    const text = renderRuntimeVerifyText(report);
    expect(text).toContain("Repair Checklist");
  });

  it("renders passed report without Repair Checklist", () => {
    // Construct a synthetic passing report
    const fakeReport: VerifyReport = {
      status: "passed",
      appRoot: "/fake",
      timestamp: new Date().toISOString(),
      steps: [
        {
          name: "structure",
          status: "passed",
          durationMs: 1,
          diagnostics: [],
        },
      ],
      repairChecklist: [],
      summary: {
        totalSteps: 1,
        passedSteps: 1,
        failedSteps: 0,
        skippedSteps: 0,
        errorCount: 0,
        warningCount: 0,
      },
    };
    const text = renderRuntimeVerifyText(fakeReport);
    expect(text).toContain("Capstan Verify");
    expect(text).not.toContain("Repair Checklist");
    expect(text).toContain("0 errors");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import type { VerifyReport, VerifyDiagnostic, VerifyStep } from "@zauso-ai/capstan-core";
import { renderRuntimeVerifyText } from "@zauso-ai/capstan-core";
import { checkBuildArtifacts } from "../../packages/core/src/verify-build.js";
import { checkPackageContracts } from "../../packages/core/src/verify-package.js";
import {
  negotiateFormat,
  computeImageCacheKey,
  normalizeTransformOptions,
  parseImageQuery,
  ImageOptimizerError,
} from "../../packages/core/src/image-optimizer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TMP_ROOT = join(import.meta.dir, "__tmp_verify_test__");

function tmpDir(name: string): string {
  const dir = join(TMP_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function writeText(path: string, content: string): void {
  writeFileSync(path, content);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Build a minimal but valid VerifyReport for renderer tests. */
function makeReport(overrides?: Partial<VerifyReport>): VerifyReport {
  return {
    status: "passed",
    appRoot: "/test",
    timestamp: new Date().toISOString(),
    steps: [],
    repairChecklist: [],
    summary: {
      totalSteps: 0,
      passedSteps: 0,
      failedSteps: 0,
      skippedSteps: 0,
      errorCount: 0,
      warningCount: 0,
    },
    ...overrides,
  };
}

function makeStep(overrides?: Partial<VerifyStep>): VerifyStep {
  return {
    name: "test",
    status: "passed",
    durationMs: 1,
    diagnostics: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  if (existsSync(TMP_ROOT)) {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  }
});

// ===========================================================================
// verify-build.ts — checkBuildArtifacts
// ===========================================================================

describe("checkBuildArtifacts", () => {
  it("returns info diagnostic when dist directory does not exist", async () => {
    const root = tmpDir("no-dist");
    const diagnostics = await checkBuildArtifacts(root);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]!.code).toBe("build_not_found");
    expect(diagnostics[0]!.severity).toBe("info");
  });

  it("reports missing contract files when dist exists but is empty", async () => {
    const root = tmpDir("empty-dist");
    mkdirSync(join(root, "dist"), { recursive: true });
    const diagnostics = await checkBuildArtifacts(root);
    const missingCodes = diagnostics
      .filter((d) => d.code.startsWith("build_missing_"))
      .map((d) => d.code);
    expect(missingCodes.length).toBeGreaterThanOrEqual(4);
  });

  it("validates deploy manifest schema version", async () => {
    const root = tmpDir("bad-schema-ver");
    mkdirSync(join(root, "dist"), { recursive: true });
    // Write all required files so we get past the "missing" checks
    writeJson(join(root, "dist", "_capstan_manifest.json"), { routes: [] });
    writeJson(join(root, "dist", "agent-manifest.json"), { name: "test" });
    writeJson(join(root, "dist", "openapi.json"), { openapi: "3.1.0" });
    writeText(join(root, "dist", "_capstan_server.js"), "export default {};");
    writeJson(join(root, "dist", "deploy-manifest.json"), {
      schemaVersion: 99,
      build: { distDir: "dist" },
      artifacts: {
        routeManifest: "dist/_capstan_manifest.json",
        agentManifest: "dist/agent-manifest.json",
        openApiSpec: "dist/openapi.json",
        serverEntry: "dist/_capstan_server.js",
        deployManifest: "dist/deploy-manifest.json",
      },
    });

    const diagnostics = await checkBuildArtifacts(root);
    const schemaIssue = diagnostics.find(
      (d) => d.code === "build_deploy_manifest_schema",
    );
    expect(schemaIssue).toBeDefined();
    expect(schemaIssue!.severity).toBe("error");
  });

  it("detects missing server entry in contract files", async () => {
    const root = tmpDir("missing-server-entry");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeJson(join(root, "dist", "_capstan_manifest.json"), { routes: [] });
    writeJson(join(root, "dist", "agent-manifest.json"), { name: "test" });
    writeJson(join(root, "dist", "openapi.json"), { openapi: "3.1.0" });
    writeJson(join(root, "dist", "deploy-manifest.json"), { schemaVersion: 1 });
    // _capstan_server.js is intentionally missing

    const diagnostics = await checkBuildArtifacts(root);
    const missing = diagnostics.find(
      (d) => d.code === "build_missing_serverEntry",
    );
    expect(missing).toBeDefined();
  });

  it("validates deploy manifest missing build section", async () => {
    const root = tmpDir("no-build-section");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeJson(join(root, "dist", "_capstan_manifest.json"), { routes: [] });
    writeJson(join(root, "dist", "agent-manifest.json"), { name: "test" });
    writeJson(join(root, "dist", "openapi.json"), { openapi: "3.1.0" });
    writeText(join(root, "dist", "_capstan_server.js"), "");
    writeJson(join(root, "dist", "deploy-manifest.json"), { schemaVersion: 1 });

    const diagnostics = await checkBuildArtifacts(root);
    const missing = diagnostics.find(
      (d) => d.code === "build_deploy_manifest_build_missing",
    );
    expect(missing).toBeDefined();
  });

  it("detects invalid build target", async () => {
    const root = tmpDir("bad-target");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeJson(join(root, "dist", "_capstan_manifest.json"), { routes: [] });
    writeJson(join(root, "dist", "agent-manifest.json"), { name: "test" });
    writeJson(join(root, "dist", "openapi.json"), { openapi: "3.1.0" });
    writeText(join(root, "dist", "_capstan_server.js"), "");
    writeJson(join(root, "dist", "deploy-manifest.json"), {
      schemaVersion: 1,
      build: { distDir: "dist", target: "imaginary-platform" },
      artifacts: {
        routeManifest: "dist/_capstan_manifest.json",
        agentManifest: "dist/agent-manifest.json",
        openApiSpec: "dist/openapi.json",
        serverEntry: "dist/_capstan_server.js",
        deployManifest: "dist/deploy-manifest.json",
      },
    });

    const diagnostics = await checkBuildArtifacts(root);
    const targetIssue = diagnostics.find(
      (d) => d.code === "build_deploy_manifest_target_invalid",
    );
    expect(targetIssue).toBeDefined();
  });

  it("detects invalid JSON in deploy manifest", async () => {
    const root = tmpDir("bad-json-deploy");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeJson(join(root, "dist", "_capstan_manifest.json"), { routes: [] });
    writeJson(join(root, "dist", "agent-manifest.json"), { name: "test" });
    writeJson(join(root, "dist", "openapi.json"), { openapi: "3.1.0" });
    writeText(join(root, "dist", "_capstan_server.js"), "");
    writeText(join(root, "dist", "deploy-manifest.json"), "NOT JSON {{{");

    const diagnostics = await checkBuildArtifacts(root);
    const jsonIssue = diagnostics.find(
      (d) => d.code === "build_deploy_manifest_invalid_json",
    );
    expect(jsonIssue).toBeDefined();
  });

  it("validates generated JSON files have correct shape", async () => {
    const root = tmpDir("bad-shape");
    mkdirSync(join(root, "dist"), { recursive: true });
    // route manifest missing routes array
    writeJson(join(root, "dist", "_capstan_manifest.json"), { bad: true });
    writeJson(join(root, "dist", "agent-manifest.json"), { missing_name: true });
    writeJson(join(root, "dist", "openapi.json"), { missing_openapi: true });
    writeText(join(root, "dist", "_capstan_server.js"), "");
    writeJson(join(root, "dist", "deploy-manifest.json"), { schemaVersion: 1 });

    const diagnostics = await checkBuildArtifacts(root);
    const shapeIssues = diagnostics.filter((d) => d.code.endsWith("_shape"));
    expect(shapeIssues.length).toBe(3);
  });

  it("detects stale build artifacts (source newer than dist)", async () => {
    const root = tmpDir("stale-build");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeJson(join(root, "dist", "_capstan_manifest.json"), { routes: [] });
    writeJson(join(root, "dist", "agent-manifest.json"), { name: "test" });
    writeJson(join(root, "dist", "openapi.json"), { openapi: "3.1.0" });
    writeText(join(root, "dist", "_capstan_server.js"), "");
    writeJson(join(root, "dist", "deploy-manifest.json"), {
      schemaVersion: 1,
      build: { distDir: "dist" },
      artifacts: {
        routeManifest: "dist/_capstan_manifest.json",
        agentManifest: "dist/agent-manifest.json",
        openApiSpec: "dist/openapi.json",
        serverEntry: "dist/_capstan_server.js",
        deployManifest: "dist/deploy-manifest.json",
      },
    });

    // Touch a source file to be newer than the deploy manifest
    // Use a future date so the staleness check triggers
    const { utimesSync } = await import("node:fs");
    const futureTime = new Date(Date.now() + 60_000);
    writeJson(join(root, "package.json"), { name: "stale-test" });
    utimesSync(join(root, "package.json"), futureTime, futureTime);

    const diagnostics = await checkBuildArtifacts(root);
    const stale = diagnostics.find((d) => d.code === "build_artifacts_stale");
    expect(stale).toBeDefined();
    expect(stale!.severity).toBe("warning");
    expect(stale!.autoFixable).toBe(true);
  });

  it("detects integrity hash mismatch", async () => {
    const root = tmpDir("integrity-mismatch");
    mkdirSync(join(root, "dist"), { recursive: true });
    const serverContent = "export default {};";
    writeText(join(root, "dist", "_capstan_server.js"), serverContent);
    writeJson(join(root, "dist", "_capstan_manifest.json"), { routes: [] });
    writeJson(join(root, "dist", "agent-manifest.json"), { name: "test" });
    writeJson(join(root, "dist", "openapi.json"), { openapi: "3.1.0" });
    writeJson(join(root, "dist", "deploy-manifest.json"), {
      schemaVersion: 1,
      build: { distDir: "dist" },
      artifacts: {
        routeManifest: "dist/_capstan_manifest.json",
        agentManifest: "dist/agent-manifest.json",
        openApiSpec: "dist/openapi.json",
        serverEntry: "dist/_capstan_server.js",
        deployManifest: "dist/deploy-manifest.json",
      },
      integrity: {
        algorithm: "sha256",
        artifacts: {
          "dist/_capstan_server.js": "0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
    });

    const diagnostics = await checkBuildArtifacts(root);
    const mismatch = diagnostics.find(
      (d) => d.code === "build_integrity_hash_mismatch",
    );
    expect(mismatch).toBeDefined();
    expect(mismatch!.severity).toBe("error");
  });

  it("passes integrity check when hash matches", async () => {
    const root = tmpDir("integrity-ok");
    mkdirSync(join(root, "dist"), { recursive: true });
    const serverContent = "export default {};";
    const correctHash = sha256(serverContent);
    writeText(join(root, "dist", "_capstan_server.js"), serverContent);
    writeJson(join(root, "dist", "_capstan_manifest.json"), { routes: [] });
    writeJson(join(root, "dist", "agent-manifest.json"), { name: "test" });
    writeJson(join(root, "dist", "openapi.json"), { openapi: "3.1.0" });
    writeJson(join(root, "dist", "deploy-manifest.json"), {
      schemaVersion: 1,
      build: { distDir: "dist" },
      artifacts: {
        routeManifest: "dist/_capstan_manifest.json",
        agentManifest: "dist/agent-manifest.json",
        openApiSpec: "dist/openapi.json",
        serverEntry: "dist/_capstan_server.js",
        deployManifest: "dist/deploy-manifest.json",
      },
      integrity: {
        algorithm: "sha256",
        artifacts: {
          "dist/_capstan_server.js": correctHash,
        },
      },
    });

    const diagnostics = await checkBuildArtifacts(root);
    const mismatch = diagnostics.find(
      (d) => d.code === "build_integrity_hash_mismatch",
    );
    expect(mismatch).toBeUndefined();
  });

  it("warns when integrity algorithm is not sha256", async () => {
    const root = tmpDir("bad-algo");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeJson(join(root, "dist", "_capstan_manifest.json"), { routes: [] });
    writeJson(join(root, "dist", "agent-manifest.json"), { name: "test" });
    writeJson(join(root, "dist", "openapi.json"), { openapi: "3.1.0" });
    writeText(join(root, "dist", "_capstan_server.js"), "");
    writeJson(join(root, "dist", "deploy-manifest.json"), {
      schemaVersion: 1,
      build: { distDir: "dist" },
      artifacts: {
        routeManifest: "dist/_capstan_manifest.json",
        agentManifest: "dist/agent-manifest.json",
        openApiSpec: "dist/openapi.json",
        serverEntry: "dist/_capstan_server.js",
        deployManifest: "dist/deploy-manifest.json",
      },
      integrity: {
        algorithm: "md5",
        artifacts: {},
      },
    });

    const diagnostics = await checkBuildArtifacts(root);
    const algoIssue = diagnostics.find(
      (d) => d.code === "build_integrity_algorithm_invalid",
    );
    expect(algoIssue).toBeDefined();
  });

  it("validates dist output with valid full structure passes clean", async () => {
    const root = tmpDir("valid-build");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeJson(join(root, "dist", "_capstan_manifest.json"), { routes: [] });
    writeJson(join(root, "dist", "agent-manifest.json"), { name: "test" });
    writeJson(join(root, "dist", "openapi.json"), { openapi: "3.1.0" });
    writeText(join(root, "dist", "_capstan_server.js"), "export default {};");
    writeJson(join(root, "dist", "deploy-manifest.json"), {
      schemaVersion: 1,
      build: { distDir: "dist", target: "node-standalone" },
      artifacts: {
        routeManifest: "dist/_capstan_manifest.json",
        agentManifest: "dist/agent-manifest.json",
        openApiSpec: "dist/openapi.json",
        serverEntry: "dist/_capstan_server.js",
        deployManifest: "dist/deploy-manifest.json",
      },
    });

    const diagnostics = await checkBuildArtifacts(root);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBe(0);
  });
});

// ===========================================================================
// verify-package.ts — checkPackageContracts
// ===========================================================================

describe("checkPackageContracts", () => {
  it("detects missing package.json", async () => {
    const root = tmpDir("no-pkg");
    const diagnostics = await checkPackageContracts(root);
    const issue = diagnostics.find((d) => d.code === "package_read_failed");
    expect(issue).toBeDefined();
  });

  it("detects invalid JSON in package.json", async () => {
    const root = tmpDir("invalid-json-pkg");
    writeText(join(root, "package.json"), "NOT JSON {{{");
    const diagnostics = await checkPackageContracts(root);
    const issue = diagnostics.find((d) => d.code === "package_json_invalid");
    expect(issue).toBeDefined();
  });

  it("detects missing package name", async () => {
    const root = tmpDir("no-name");
    writeJson(join(root, "package.json"), { private: true, type: "module" });
    const diagnostics = await checkPackageContracts(root);
    const issue = diagnostics.find((d) => d.code === "package_name_missing");
    expect(issue).toBeDefined();
  });

  it("detects invalid package name", async () => {
    const root = tmpDir("bad-name");
    writeJson(join(root, "package.json"), {
      name: "INVALID CAPS WITH SPACES",
      private: true,
      type: "module",
    });
    const diagnostics = await checkPackageContracts(root);
    const issue = diagnostics.find((d) => d.code === "package_name_invalid");
    expect(issue).toBeDefined();
  });

  it("warns when packageManager is missing", async () => {
    const root = tmpDir("no-pkg-mgr");
    writeJson(join(root, "package.json"), {
      name: "test-app",
      private: true,
      type: "module",
    });
    const diagnostics = await checkPackageContracts(root);
    const issue = diagnostics.find(
      (d) => d.code === "package_manager_missing",
    );
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warning");
  });

  it("warns when package type is not module", async () => {
    const root = tmpDir("cjs-pkg");
    writeJson(join(root, "package.json"), {
      name: "test-app",
      private: true,
      type: "commonjs",
    });
    const diagnostics = await checkPackageContracts(root);
    const issue = diagnostics.find((d) => d.code === "package_type_invalid");
    expect(issue).toBeDefined();
  });

  it("warns when private flag is not true", async () => {
    const root = tmpDir("not-private");
    writeJson(join(root, "package.json"), {
      name: "test-app",
      type: "module",
    });
    const diagnostics = await checkPackageContracts(root);
    const issue = diagnostics.find(
      (d) => d.code === "package_private_missing",
    );
    expect(issue).toBeDefined();
  });

  it("detects missing scripts object", async () => {
    const root = tmpDir("no-scripts");
    writeJson(join(root, "package.json"), {
      name: "test-app",
      private: true,
      type: "module",
    });
    const diagnostics = await checkPackageContracts(root);
    const issue = diagnostics.find(
      (d) => d.code === "package_scripts_missing",
    );
    expect(issue).toBeDefined();
  });

  it("warns when required scripts are missing", async () => {
    const root = tmpDir("empty-scripts");
    writeJson(join(root, "package.json"), {
      name: "test-app",
      private: true,
      type: "module",
      scripts: {},
    });
    const diagnostics = await checkPackageContracts(root);
    const devMissing = diagnostics.find(
      (d) => d.code === "package_script_missing_dev",
    );
    const buildMissing = diagnostics.find(
      (d) => d.code === "package_script_missing_build",
    );
    const verifyMissing = diagnostics.find(
      (d) => d.code === "package_script_missing_verify",
    );
    expect(devMissing).toBeDefined();
    expect(buildMissing).toBeDefined();
    expect(verifyMissing).toBeDefined();
  });

  it("warns when scripts do not invoke capstan", async () => {
    const root = tmpDir("non-capstan-scripts");
    writeJson(join(root, "package.json"), {
      name: "test-app",
      private: true,
      type: "module",
      scripts: { dev: "next dev", build: "next build", verify: "echo ok" },
    });
    const diagnostics = await checkPackageContracts(root);
    const issues = diagnostics.filter((d) =>
      d.code.startsWith("package_script_non_capstan_"),
    );
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  it("detects foreign runtime scripts (next/vite)", async () => {
    const root = tmpDir("foreign-scripts");
    writeJson(join(root, "package.json"), {
      name: "test-app",
      private: true,
      type: "module",
      scripts: { dev: "next dev", build: "capstan build" },
    });
    const diagnostics = await checkPackageContracts(root);
    const foreign = diagnostics.find(
      (d) => d.code === "package_script_foreign_runtime_dev",
    );
    expect(foreign).toBeDefined();
  });

  it("warns when capstan CLI dependency is missing", async () => {
    const root = tmpDir("no-cli-dep");
    writeJson(join(root, "package.json"), {
      name: "test-app",
      private: true,
      type: "module",
      scripts: { dev: "capstan dev", build: "capstan build", verify: "capstan verify --json" },
    });
    const diagnostics = await checkPackageContracts(root);
    const issue = diagnostics.find(
      (d) => d.code === "package_capstan_cli_missing",
    );
    expect(issue).toBeDefined();
  });

  it("warns when next dependency is still present", async () => {
    const root = tmpDir("next-dep");
    writeJson(join(root, "package.json"), {
      name: "test-app",
      private: true,
      type: "module",
      scripts: { dev: "capstan dev", build: "capstan build", verify: "capstan verify --json" },
      dependencies: { next: "14.0.0" },
      devDependencies: { "@zauso-ai/capstan-cli": "1.0.0" },
    });
    const diagnostics = await checkPackageContracts(root);
    const issue = diagnostics.find(
      (d) => d.code === "package_next_dependency_present",
    );
    expect(issue).toBeDefined();
  });

  it("passes clean with a valid package.json", async () => {
    const root = tmpDir("valid-pkg");
    writeJson(join(root, "package.json"), {
      name: "test-app",
      private: true,
      type: "module",
      packageManager: "bun@1.2.0",
      scripts: { dev: "capstan dev", build: "capstan build", verify: "capstan verify --json" },
      devDependencies: { "@zauso-ai/capstan-cli": "1.0.0" },
    });
    const diagnostics = await checkPackageContracts(root);
    const errors = diagnostics.filter((d) => d.severity === "error");
    const warnings = diagnostics.filter((d) => d.severity === "warning");
    expect(errors.length).toBe(0);
    expect(warnings.length).toBe(0);
  });
});

// ===========================================================================
// verify-render.ts — renderRuntimeVerifyText
// ===========================================================================

describe("renderRuntimeVerifyText", () => {
  it("renders 'Capstan Verify' header", () => {
    const text = renderRuntimeVerifyText(makeReport());
    expect(text).toContain("Capstan Verify");
  });

  it("renders passed step with check mark", () => {
    const report = makeReport({
      steps: [makeStep({ name: "structure", status: "passed", durationMs: 5 })],
    });
    const text = renderRuntimeVerifyText(report);
    expect(text).toContain("\u2713");
    expect(text).toContain("structure");
    expect(text).toContain("5ms");
  });

  it("renders failed step with x mark", () => {
    const report = makeReport({
      status: "failed",
      steps: [
        makeStep({
          name: "config",
          status: "failed",
          diagnostics: [
            {
              code: "config_error",
              severity: "error",
              message: "Config is broken",
              hint: "Fix the config",
            },
          ],
        }),
      ],
      summary: { totalSteps: 1, passedSteps: 0, failedSteps: 1, skippedSteps: 0, errorCount: 1, warningCount: 0 },
    });
    const text = renderRuntimeVerifyText(report);
    expect(text).toContain("\u2717");
    expect(text).toContain("Config is broken");
    expect(text).toContain("Fix the config");
  });

  it("renders skipped step with dash", () => {
    const report = makeReport({
      steps: [makeStep({ name: "routes", status: "skipped", durationMs: 0 })],
    });
    const text = renderRuntimeVerifyText(report);
    expect(text).toContain("- routes");
    expect(text).toContain("skipped");
  });

  it("hides info-severity diagnostics from output", () => {
    const report = makeReport({
      steps: [
        makeStep({
          diagnostics: [
            { code: "info_thing", severity: "info", message: "Just info" },
          ],
        }),
      ],
    });
    const text = renderRuntimeVerifyText(report);
    expect(text).not.toContain("Just info");
  });

  it("renders error and warning counts", () => {
    const report = makeReport({
      summary: { totalSteps: 2, passedSteps: 1, failedSteps: 1, skippedSteps: 0, errorCount: 3, warningCount: 2 },
    });
    const text = renderRuntimeVerifyText(report);
    expect(text).toContain("3 errors");
    expect(text).toContain("2 warnings");
  });

  it("renders repair checklist", () => {
    const report = makeReport({
      repairChecklist: [
        { index: 1, step: "structure", message: "Missing config file", hint: "Create it" },
      ],
    });
    const text = renderRuntimeVerifyText(report);
    expect(text).toContain("Repair Checklist:");
    expect(text).toContain("1. [structure] Missing config file");
    expect(text).toContain("Create it");
  });
});

// ===========================================================================
// verify-types.ts — VerifyReport shape
// ===========================================================================

describe("VerifyReport JSON output format", () => {
  it("status is 'passed' when all steps pass", () => {
    const report = makeReport({
      status: "passed",
      steps: [makeStep({ status: "passed" })],
    });
    expect(report.status).toBe("passed");
  });

  it("status is 'failed' when any step fails", () => {
    const report = makeReport({
      status: "failed",
      steps: [makeStep({ status: "passed" }), makeStep({ status: "failed" })],
    });
    expect(report.status).toBe("failed");
  });

  it("each step has name, status, durationMs fields", () => {
    const step = makeStep({ name: "routes", status: "passed", durationMs: 42 });
    expect(step.name).toBe("routes");
    expect(step.status).toBe("passed");
    expect(step.durationMs).toBe(42);
  });

  it("failed step has diagnostics array with expected fields", () => {
    const diagnostic: VerifyDiagnostic = {
      code: "test_error",
      severity: "error",
      message: "Something went wrong",
      hint: "Fix it",
      file: "app/routes/index.api.ts",
      fixCategory: "missing_export",
      autoFixable: false,
    };
    const step = makeStep({
      status: "failed",
      diagnostics: [diagnostic],
    });
    expect(step.diagnostics[0]!.code).toBe("test_error");
    expect(step.diagnostics[0]!.severity).toBe("error");
    expect(step.diagnostics[0]!.fixCategory).toBe("missing_export");
    expect(step.diagnostics[0]!.autoFixable).toBe(false);
  });

  it("repairChecklist at top level includes all non-info diagnostics", () => {
    const report = makeReport({
      repairChecklist: [
        { index: 1, step: "structure", message: "Missing file", fixCategory: "missing_file", autoFixable: true },
        { index: 2, step: "config", message: "Bad config", fixCategory: "type_error", autoFixable: false },
      ],
    });
    expect(report.repairChecklist.length).toBe(2);
    expect(report.repairChecklist[0]!.autoFixable).toBe(true);
    expect(report.repairChecklist[1]!.autoFixable).toBe(false);
  });

  it("JSON output is valid JSON when serialized", () => {
    const report = makeReport({
      steps: [
        makeStep({
          diagnostics: [
            { code: "x", severity: "error", message: "m", hint: "h" },
          ],
        }),
      ],
      repairChecklist: [{ index: 1, step: "test", message: "fix" }],
    });
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json) as VerifyReport;
    expect(parsed.status).toBe("passed");
    expect(parsed.steps.length).toBe(1);
  });
});

// ===========================================================================
// image-optimizer.ts — pure utility functions
// ===========================================================================

describe("negotiateFormat", () => {
  it("returns jpeg when accept is null", () => {
    expect(negotiateFormat(null)).toBe("jpeg");
  });

  it("returns avif when accept includes image/avif", () => {
    expect(negotiateFormat("image/avif,image/webp,*/*")).toBe("avif");
  });

  it("returns webp when accept includes image/webp but not avif", () => {
    expect(negotiateFormat("image/webp,*/*")).toBe("webp");
  });

  it("returns jpeg when accept has neither avif nor webp", () => {
    expect(negotiateFormat("image/png,*/*")).toBe("jpeg");
  });
});

describe("computeImageCacheKey", () => {
  it("returns a hex string", () => {
    const key = computeImageCacheKey("/img/test.jpg", { width: 100 }, "webp");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different options produce different keys", () => {
    const key1 = computeImageCacheKey("/img/test.jpg", { width: 100 }, "webp");
    const key2 = computeImageCacheKey("/img/test.jpg", { width: 200 }, "webp");
    expect(key1).not.toBe(key2);
  });
});

describe("normalizeTransformOptions", () => {
  it("clamps width to max 4096", () => {
    const result = normalizeTransformOptions({ width: 10000 });
    expect(result.width).toBe(4096);
  });

  it("rounds width to integer", () => {
    const result = normalizeTransformOptions({ width: 99.7 });
    expect(result.width).toBe(100);
  });

  it("ignores non-finite width", () => {
    const result = normalizeTransformOptions({ width: NaN });
    expect(result.width).toBeUndefined();
  });

  it("clamps quality to max 100", () => {
    const result = normalizeTransformOptions({ quality: 150 });
    expect(result.quality).toBe(100);
  });

  it("validates fit values", () => {
    const result = normalizeTransformOptions({ fit: "cover" });
    expect(result.fit).toBe("cover");
  });

  it("rejects invalid format", () => {
    const result = normalizeTransformOptions({ format: "bmp" as any });
    expect(result.format).toBeUndefined();
  });
});

describe("parseImageQuery", () => {
  it("parses valid URL with all parameters", () => {
    const result = parseImageQuery("http://localhost/_image?url=/test.jpg&w=100&h=200&q=80&f=webp&fit=contain");
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.src).toBe("/test.jpg");
      expect(result.options.width).toBe(100);
      expect(result.options.height).toBe(200);
      expect(result.options.quality).toBe(80);
      expect(result.options.format).toBe("webp");
      expect(result.options.fit).toBe("contain");
    }
  });

  it("returns error when url parameter is missing", () => {
    const result = parseImageQuery("http://localhost/_image");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("url");
    }
  });

  it("rejects path traversal", () => {
    const result = parseImageQuery("http://localhost/_image?url=../../../etc/passwd");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("traversal");
    }
  });

  it("rejects protocol prefixes", () => {
    const result = parseImageQuery("http://localhost/_image?url=file:///etc/passwd");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("Protocol");
    }
  });

  it("rejects invalid width", () => {
    const result = parseImageQuery("http://localhost/_image?url=/test.jpg&w=-1");
    expect("error" in result).toBe(true);
  });

  it("rejects invalid quality", () => {
    const result = parseImageQuery("http://localhost/_image?url=/test.jpg&q=101");
    expect("error" in result).toBe(true);
  });

  it("rejects invalid format", () => {
    const result = parseImageQuery("http://localhost/_image?url=/test.jpg&f=bmp");
    expect("error" in result).toBe(true);
  });
});

describe("ImageOptimizerError", () => {
  it("has correct name and code", () => {
    const err = new ImageOptimizerError("test", "FORBIDDEN");
    expect(err.name).toBe("ImageOptimizerError");
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("test");
  });
});

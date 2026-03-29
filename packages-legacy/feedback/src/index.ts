import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import type { AppGraph } from "@zauso-ai/capstan-app-graph";

const execFileAsync = promisify(execFile);
const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, "../../..");
const tscBinary = resolve(repoRoot, "node_modules/.bin/tsc");

export type VerifyStatus = "passed" | "failed" | "skipped";
export type VerifySeverity = "error" | "warning" | "info";
export type VerifyStepKey =
  | "structure"
  | "contracts"
  | "typecheck"
  | "build"
  | "assertions"
  | "smoke";

export interface VerifyDiagnostic {
  code: string;
  severity: VerifySeverity;
  summary: string;
  detail?: string;
  hint?: string;
  file?: string;
  line?: number;
  column?: number;
  source?: "capstan" | "typescript";
}

export interface VerifyStepResult {
  key: VerifyStepKey;
  label: string;
  status: VerifyStatus;
  durationMs: number;
  diagnostics: VerifyDiagnostic[];
  command?: string;
}

export interface VerifySummary {
  status: VerifyStatus;
  stepCount: number;
  passedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  diagnosticCount: number;
  errorCount: number;
  warningCount: number;
}

export interface VerifyReport {
  appRoot: string;
  status: VerifyStatus;
  generatedBy: "capstan-feedback";
  steps: VerifyStepResult[];
  diagnostics: VerifyDiagnostic[];
  summary: VerifySummary;
}

export interface VerifyOptions {
  cwd?: string;
}

interface RepairChecklistItem {
  stepLabel: string;
  summary: string;
  hint?: string;
  file?: string;
  line?: number;
  column?: number;
}

interface VerifyContext {
  graph?: AppGraph;
  manifest?: AgentSurfaceManifest;
  metadata?: GraphMetadata;
}

interface AgentSurfaceManifest {
  summary?: {
    capabilityCount?: number;
    taskCount?: number;
    artifactCount?: number;
  };
  transport?: {
    auth?: {
      mode?: string;
      effects?: string[];
    };
    operations?: Array<{ key?: string }>;
  };
  capabilities?: Array<{
    key?: string;
    policy?: string;
    task?: string;
  }>;
  tasks?: Array<{ key?: string }>;
  artifacts?: Array<{ key?: string }>;
}

interface GraphMetadata {
  sourceVersion?: number;
  normalizedVersion?: number;
  upgraded?: boolean;
}

interface SearchResultRecord {
  capabilities: unknown[];
  tasks: unknown[];
  artifacts: unknown[];
}

interface CapabilityExecutionRecord {
  capability?: string;
  status?: string;
}

interface AgentTransportManifestBody {
  manifest?: AgentSurfaceManifest;
  summary?: AgentSurfaceManifest["summary"];
}

interface HumanSurfaceProjection {
  routes?: Array<{ key?: string }>;
}

interface HumanSurfaceRuntimeSnapshotRecord {
  activeRouteKey?: string;
  results?: Record<string, unknown>;
}

interface AppAssertionRunRecord {
  assertion: {
    key: string;
    title: string;
    source?: "generated" | "custom";
  };
  result: {
    status: "passed" | "failed";
    summary: string;
    detail?: string;
    hint?: string;
    file?: string;
  };
}

const requiredGeneratedFiles = [
  "capstan.app.json",
  ".capstan/graph-metadata.json",
  "agent-surface.json",
  "human-surface.html",
  "tsconfig.json",
  "src/index.ts",
  "src/control-plane/index.ts",
  "src/assertions/index.ts",
  "src/human-surface/index.ts",
  "src/agent-surface/index.ts",
  "src/agent-surface/transport.ts"
] as const;

export async function verifyGeneratedApp(
  appRoot: string,
  options: VerifyOptions = {}
): Promise<VerifyReport> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const steps: VerifyStepResult[] = [];
  const context: VerifyContext = {};

  const structureStep = await measureStep("structure", "Generated Structure", async () =>
    runStructureChecks(root, context)
  );
  steps.push(structureStep);

  if (structureStep.status !== "passed") {
    steps.push(skippedStep("contracts", "Surface Contracts", "Verify skipped because structure failed."));
    steps.push(skippedStep("typecheck", "TypeScript Check", "Verify skipped because structure failed."));
    steps.push(skippedStep("build", "Generated Build", "Verify skipped because structure failed."));
    steps.push(skippedStep("assertions", "Generated Assertions", "Verify skipped because structure failed."));
    steps.push(skippedStep("smoke", "Runtime Smoke", "Verify skipped because structure failed."));
    return buildVerifyReport(root, steps);
  }

  const contractsStep = await measureStep("contracts", "Surface Contracts", async () =>
    runContractChecks(root, context)
  );
  steps.push(contractsStep);

  if (contractsStep.status !== "passed") {
    steps.push(skippedStep("typecheck", "TypeScript Check", "Verify skipped because contracts failed."));
    steps.push(skippedStep("build", "Generated Build", "Verify skipped because contracts failed."));
    steps.push(skippedStep("assertions", "Generated Assertions", "Verify skipped because contracts failed."));
    steps.push(skippedStep("smoke", "Runtime Smoke", "Verify skipped because contracts failed."));
    return buildVerifyReport(root, steps);
  }

  const typecheckStep = await measureStep(
    "typecheck",
    "TypeScript Check",
    async () => runTypeScriptCheck(root),
    formatTypeScriptCommand(root, true)
  );
  steps.push(typecheckStep);

  if (typecheckStep.status !== "passed") {
    steps.push(skippedStep("build", "Generated Build", "Verify skipped because typecheck failed."));
    steps.push(skippedStep("assertions", "Generated Assertions", "Verify skipped because typecheck failed."));
    steps.push(skippedStep("smoke", "Runtime Smoke", "Verify skipped because typecheck failed."));
    return buildVerifyReport(root, steps);
  }

  const buildStep = await measureStep(
    "build",
    "Generated Build",
    async () => runTypeScriptBuild(root),
    formatTypeScriptCommand(root, false)
  );
  steps.push(buildStep);

  if (buildStep.status !== "passed") {
    steps.push(skippedStep("assertions", "Generated Assertions", "Verify skipped because build failed."));
    steps.push(skippedStep("smoke", "Runtime Smoke", "Verify skipped because build failed."));
    return buildVerifyReport(root, steps);
  }

  const assertionStep = await measureStep("assertions", "Generated Assertions", async () =>
    runAssertionChecks(root)
  );
  steps.push(assertionStep);

  if (assertionStep.status !== "passed") {
    steps.push(skippedStep("smoke", "Runtime Smoke", "Verify skipped because assertions failed."));
    return buildVerifyReport(root, steps);
  }

  steps.push(await measureStep("smoke", "Runtime Smoke", async () => runSmokeChecks(root)));

  return buildVerifyReport(root, steps);
}

export function renderVerifyReportText(report: VerifyReport): string {
  const lines = [
    "Capstan Verify",
    `App: ${report.appRoot}`,
    `Status: ${report.status}`,
    `Summary: ${report.summary.passedSteps}/${report.summary.stepCount} steps passed, ${report.summary.errorCount} errors, ${report.summary.warningCount} warnings`
  ];

  for (const step of report.steps) {
    lines.push("");
    lines.push(`[${step.status}] ${step.label} (${step.durationMs}ms)`);

    if (step.command) {
      lines.push(`command: ${step.command}`);
    }

    if (!step.diagnostics.length) {
      lines.push("diagnostics: none");
      continue;
    }

    for (const diagnostic of step.diagnostics) {
      const location = diagnostic.file
        ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ""}` : ""}`
        : undefined;
      lines.push(`- [${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.summary}`);
      if (location) {
        lines.push(`  at ${location}`);
      }
      if (diagnostic.detail) {
        lines.push(`  detail: ${diagnostic.detail}`);
      }
      if (diagnostic.hint) {
        lines.push(`  hint: ${diagnostic.hint}`);
      }
    }
  }

  const repairChecklist = buildRepairChecklist(report);
  if (repairChecklist.length) {
    lines.push("");
    lines.push("Repair Checklist");
    for (const [index, item] of repairChecklist.entries()) {
      lines.push(`${index + 1}. ${item.stepLabel}: ${item.summary}`);
      if (item.file) {
        const location = `${item.file}${item.line ? `:${item.line}${item.column ? `:${item.column}` : ""}` : ""}`;
        lines.push(`   at ${location}`);
      }
      if (item.hint) {
        lines.push(`   next: ${item.hint}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export function parseTypeScriptDiagnostics(output: string): VerifyDiagnostic[] {
  const diagnostics: VerifyDiagnostic[] = [];
  const pattern =
    /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\): error (?<tscode>TS\d+): (?<message>.+)$/gm;

  for (const match of output.matchAll(pattern)) {
    const groups = match.groups;

    if (!groups) {
      continue;
    }

    const message = groups.message ?? "Unknown TypeScript error";
    const detail = groups.tscode ?? "TS0000";
    const file = groups.file ?? "";

    diagnostics.push({
      code: "typescript_error",
      severity: "error",
      summary: message,
      detail,
      hint: suggestRepairHint(message),
      file,
      line: Number(groups.line),
      column: Number(groups.column),
      source: "typescript"
    });
  }

  return diagnostics;
}

export function suggestRepairHint(message: string): string {
  if (message.includes("Cannot find module")) {
    return "Check generated import paths or rerun `capstan graph:scaffold --force` to refresh framework-owned files.";
  }

  if (message.includes("is not assignable to type")) {
    return "Align the handler output with the generated type contract before rerunning `capstan verify`.";
  }

  if (message.includes("Property") && message.includes("does not exist")) {
    return "Compare the handler payload with the generated capability, task, or artifact contracts.";
  }

  return "Fix the reported issue and rerun `capstan verify` to confirm the application converges again.";
}

async function runStructureChecks(root: string, context: VerifyContext): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];

  for (const relativePath of requiredGeneratedFiles) {
    const target = resolve(root, relativePath);
    const exists = await pathExists(target);

    if (!exists) {
      diagnostics.push({
        code: "missing_file",
        severity: "error",
        summary: `Expected generated file "${relativePath}" is missing.`,
        hint: "Rerun `capstan graph:scaffold --force` to restore framework-owned files.",
        file: target,
        source: "capstan"
      });
    }
  }

  if (diagnostics.length) {
    return diagnostics;
  }

  const graph = await readJsonFile<AppGraph>(resolve(root, "capstan.app.json"), diagnostics, {
    code: "invalid_app_graph",
    hint: "Regenerate the application so `capstan.app.json` becomes valid again."
  });
  if (graph) {
    context.graph = graph;
  }

  const manifest = await readJsonFile<AgentSurfaceManifest>(
    resolve(root, "agent-surface.json"),
    diagnostics,
    {
      code: "invalid_agent_surface_manifest",
      hint: "Regenerate the application so `agent-surface.json` matches the current compiler output."
    }
  );
  if (manifest) {
    context.manifest = manifest;
  }

  const metadata = await readJsonFile<GraphMetadata>(
    resolve(root, ".capstan/graph-metadata.json"),
    diagnostics,
    {
      code: "invalid_graph_metadata",
      hint: "Regenerate the application so Capstan can rehydrate graph metadata."
    }
  );
  if (metadata) {
    context.metadata = metadata;
  }

  if (!context.metadata?.normalizedVersion) {
    diagnostics.push({
      code: "missing_normalized_version",
      severity: "error",
      summary: "Generated graph metadata is missing `normalizedVersion`.",
      hint: "Regenerate the application with the current compiler.",
      file: resolve(root, ".capstan/graph-metadata.json"),
      source: "capstan"
    });
  }

  return diagnostics;
}

async function runContractChecks(root: string, context: VerifyContext): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];
  const graph = context.graph;
  const manifest = context.manifest;

  if (!graph || !manifest) {
    diagnostics.push({
      code: "contracts_unavailable",
      severity: "error",
      summary: "Contract checks could not run because structure parsing did not complete.",
      hint: "Fix the structure step before retrying contract verification.",
      source: "capstan"
    });
    return diagnostics;
  }

  compareCount(
    diagnostics,
    "capability_count_mismatch",
    "capabilities",
    graph.capabilities.length,
    manifest.summary?.capabilityCount,
    root
  );
  compareCount(
    diagnostics,
    "task_count_mismatch",
    "tasks",
    (graph.tasks ?? []).length,
    manifest.summary?.taskCount,
    root
  );
  compareCount(
    diagnostics,
    "artifact_count_mismatch",
    "artifacts",
    (graph.artifacts ?? []).length,
    manifest.summary?.artifactCount,
    root
  );

  const manifestCapabilityKeys = new Set((manifest.capabilities ?? []).map((entry) => entry.key).filter(Boolean));
  const manifestTaskKeys = new Set((manifest.tasks ?? []).map((entry) => entry.key).filter(Boolean));
  const manifestArtifactKeys = new Set((manifest.artifacts ?? []).map((entry) => entry.key).filter(Boolean));

  for (const capability of graph.capabilities) {
    if (!manifestCapabilityKeys.has(capability.key)) {
      diagnostics.push({
        code: "missing_capability_projection",
        severity: "error",
        summary: `Capability "${capability.key}" is missing from the agent surface manifest.`,
        hint: "Regenerate the app so the manifest projection catches up with the App Graph.",
        file: resolve(root, "agent-surface.json"),
        source: "capstan"
      });
      continue;
    }

    if (capability.policy) {
      const manifestCapability = (manifest.capabilities ?? []).find(
        (entry) => entry.key === capability.key
      );

      if (manifestCapability?.policy !== capability.policy) {
        diagnostics.push({
          code: "policy_projection_mismatch",
          severity: "error",
          summary: `Capability "${capability.key}" lost its policy projection.`,
          detail: `Expected policy "${capability.policy}", received "${manifestCapability?.policy ?? "missing"}".`,
          hint: "Regenerate the agent surface manifest so policy-aware consumers see the right boundary.",
          file: resolve(root, "agent-surface.json"),
          source: "capstan"
        });
      }
    }
  }

  for (const task of graph.tasks ?? []) {
    if (!manifestTaskKeys.has(task.key)) {
      diagnostics.push({
        code: "missing_task_projection",
        severity: "error",
        summary: `Task "${task.key}" is missing from the agent surface manifest.`,
        hint: "Regenerate the app so task lifecycle discovery stays in sync with the App Graph.",
        file: resolve(root, "agent-surface.json"),
        source: "capstan"
      });
    }
  }

  for (const artifact of graph.artifacts ?? []) {
    if (!manifestArtifactKeys.has(artifact.key)) {
      diagnostics.push({
        code: "missing_artifact_projection",
        severity: "error",
        summary: `Artifact "${artifact.key}" is missing from the agent surface manifest.`,
        hint: "Regenerate the app so artifact discovery remains consistent for agent consumers.",
        file: resolve(root, "agent-surface.json"),
        source: "capstan"
      });
    }
  }

  const authMode = manifest.transport?.auth?.mode;
  const authEffects = manifest.transport?.auth?.effects ?? [];
  if (authMode !== "hook_optional") {
    diagnostics.push({
      code: "missing_transport_auth_mode",
      severity: "error",
      summary: "Generated manifest is missing the expected transport auth mode.",
      detail: `Expected "hook_optional", received "${authMode ?? "missing"}".`,
      hint: "Regenerate the app so transport auth hooks remain discoverable.",
      file: resolve(root, "agent-surface.json"),
      source: "capstan"
    });
  }

  for (const effect of ["allow", "approve", "deny", "redact"] as const) {
    if (!authEffects.includes(effect)) {
      diagnostics.push({
        code: "missing_transport_auth_effect",
        severity: "error",
        summary: `Transport auth effect "${effect}" is missing from the agent surface manifest.`,
        hint: "Regenerate the app so agent consumers can reason about the available auth effects.",
        file: resolve(root, "agent-surface.json"),
        source: "capstan"
      });
    }
  }

  return diagnostics;
}

async function runTypeScriptCheck(root: string): Promise<VerifyDiagnostic[]> {
  return runTypeScriptCommand(root, true);
}

async function runTypeScriptBuild(root: string): Promise<VerifyDiagnostic[]> {
  return runTypeScriptCommand(root, false);
}

async function runAssertionChecks(root: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];
  const assertionModulePath = resolve(root, "dist/assertions/index.js");

  if (!(await pathExists(assertionModulePath))) {
    return [
      {
        code: "missing_assertion_output",
        severity: "error",
        summary: 'Expected assertion build output "dist/assertions/index.js" is missing.',
        hint: "Keep the generated assertions module in the build output so Capstan can run app assertions.",
        file: assertionModulePath,
        source: "capstan"
      }
    ];
  }

  try {
    const moduleUrl = `${pathToFileURL(assertionModulePath).href}?t=${Date.now()}-assertions`;
    const loaded = (await import(moduleUrl)) as Record<string, unknown>;
    const runAppAssertions = loaded.runAppAssertions as
      | (() => Promise<unknown>)
      | undefined;

    if (!runAppAssertions || typeof runAppAssertions !== "function") {
      return [
        {
          code: "missing_assertion_runner",
          severity: "error",
          summary: "Built assertions module does not export `runAppAssertions`.",
          hint: "Preserve the generated assertions runtime so Capstan can execute graph-derived checks.",
          file: assertionModulePath,
          source: "capstan"
        }
      ];
    }

    const runs = await runAppAssertions();

    if (!Array.isArray(runs)) {
      return [
        {
          code: "invalid_assertion_runner_result",
          severity: "error",
          summary: "Built assertions module returned an unexpected result shape.",
          hint: "Keep `runAppAssertions` returning an array of assertion run records.",
          file: assertionModulePath,
          source: "capstan"
        }
      ];
    }

    for (const run of runs) {
      if (!isAssertionRunRecord(run)) {
        diagnostics.push({
          code: "invalid_assertion_run_record",
          severity: "error",
          summary: "One generated assertion run returned an invalid result record.",
          hint: "Keep app assertions returning `{ assertion, result }` records with stable fields.",
          file: assertionModulePath,
          source: "capstan"
        });
        continue;
      }

      if (run.result.status !== "failed") {
        continue;
      }

      diagnostics.push({
        code: "app_assertion_failed",
        severity: "error",
        summary: run.result.summary ?? `Assertion "${run.assertion.key ?? "unknown"}" failed.`,
        ...(run.result.detail ? { detail: run.result.detail } : {}),
        ...(run.result.hint ? { hint: run.result.hint } : {}),
        ...(run.result.file
          ? { file: resolve(root, run.result.file) }
          : { file: assertionModulePath }),
        source: "capstan"
      });
    }
  } catch (error: unknown) {
    return [
      {
        code: "assertion_runtime_failed",
        severity: "error",
        summary: "Generated assertions failed while importing or executing.",
        detail: error instanceof Error ? error.stack ?? error.message : String(error),
        hint: "Fix the generated or custom assertion runtime before rerunning `capstan verify`.",
        file: assertionModulePath,
        source: "capstan"
      }
    ];
  }

  return diagnostics;
}

async function runTypeScriptCommand(
  root: string,
  noEmit: boolean
): Promise<VerifyDiagnostic[]> {
  const args = ["-p", resolve(root, "tsconfig.json")];
  if (noEmit) {
    args.push("--noEmit");
  }

  try {
    await execFileAsync(tscBinary, args, {
      cwd: root
    });
    return [];
  } catch (error: unknown) {
    const failed = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    const combined = [failed.stdout ?? "", failed.stderr ?? ""].filter(Boolean).join("\n");
    const diagnostics = parseTypeScriptDiagnostics(combined);

    if (diagnostics.length) {
      return diagnostics;
    }

    return [
      {
        code: "typescript_error",
        severity: "error",
        summary: noEmit ? "TypeScript verification failed." : "Generated build failed.",
        detail: combined.trim() || formatTypeScriptCommand(root, noEmit),
        hint: noEmit
          ? "Fix the generated application type errors and rerun `capstan verify`."
          : "Fix the generated application build errors and rerun `capstan verify`.",
        source: "typescript"
      }
    ];
  }
}

async function runSmokeChecks(root: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];
  const distIndexPath = resolve(root, "dist/index.js");
  const exists = await pathExists(distIndexPath);

  if (!exists) {
    return [
      {
        code: "missing_build_output",
        severity: "error",
        summary: 'Expected build output "dist/index.js" is missing.',
        hint: "Run the generated build again and make sure dist output is emitted before smoke verification.",
        file: distIndexPath,
        source: "capstan"
      }
    ];
  }

  try {
    const moduleUrl = `${pathToFileURL(distIndexPath).href}?t=${Date.now()}`;
    const loaded = (await import(moduleUrl)) as Record<string, unknown>;
    const domain = loaded.domain as { key?: string } | undefined;
    const agentSurfaceManifest = loaded.agentSurfaceManifest;
    const humanSurfaceHtml = loaded.humanSurfaceHtml;
    const renderAgentSurfaceManifest = loaded.renderAgentSurfaceManifest as
      | (() => string)
      | undefined;
    const renderHumanSurfaceDocument = loaded.renderHumanSurfaceDocument as
      | (() => string)
      | undefined;
    const controlPlane = loaded.controlPlane as
      | {
          search?: (query?: string) => unknown;
          execute?: (key: string, input?: Record<string, unknown>) => Promise<unknown>;
        }
      | undefined;
    const handleAgentSurfaceRequest = loaded.handleAgentSurfaceRequest as
      | ((request: {
          operation: "manifest" | "search" | "execute";
          query?: string;
          key?: string;
          input?: Record<string, unknown>;
        }) => Promise<{ ok?: boolean; status?: number; body?: unknown }>)
      | undefined;
    const parsedManifest =
      typeof agentSurfaceManifest === "string"
        ? parseAgentSurfaceManifest(agentSurfaceManifest, diagnostics, distIndexPath)
        : undefined;

    if (!domain || typeof domain.key !== "string" || !domain.key) {
      diagnostics.push({
        code: "missing_domain_export",
        severity: "error",
        summary: "Smoke check could not resolve a valid domain export from the built application.",
        hint: "Ensure the generated root module still exports `domain` after custom edits.",
        file: distIndexPath,
        source: "capstan"
      });
    }

    if (typeof agentSurfaceManifest !== "string") {
      diagnostics.push({
        code: "missing_agent_surface_manifest_export",
        severity: "error",
        summary: "Smoke check could not find `agentSurfaceManifest` in the built application.",
        hint: "Preserve the generated agent surface exports in `src/index.ts` and rerun the build.",
        file: distIndexPath,
        source: "capstan"
      });
    }

    if (!renderAgentSurfaceManifest || typeof renderAgentSurfaceManifest !== "function") {
      diagnostics.push({
        code: "missing_agent_surface_manifest_renderer",
        severity: "error",
        summary: "Smoke check could not find `renderAgentSurfaceManifest` in the built application.",
        hint: "Preserve the generated agent surface renderer so transport consumers can rehydrate the manifest.",
        file: distIndexPath,
        source: "capstan"
      });
    } else if (
      typeof agentSurfaceManifest === "string" &&
      renderAgentSurfaceManifest() !== agentSurfaceManifest
    ) {
      diagnostics.push({
        code: "agent_surface_manifest_render_mismatch",
        severity: "error",
        summary: "Built `renderAgentSurfaceManifest()` no longer matches the exported manifest string.",
        hint: "Keep the generated agent surface render function aligned with the built manifest export.",
        file: distIndexPath,
        source: "capstan"
      });
    }

    if (typeof humanSurfaceHtml !== "string" || !humanSurfaceHtml.includes("Capstan Human Surface")) {
      diagnostics.push({
        code: "missing_human_surface_export",
        severity: "error",
        summary: "Smoke check could not load the built human surface document.",
        hint: "Keep the generated human surface exports intact so Capstan can project runtime HTML.",
        file: distIndexPath,
        source: "capstan"
      });
    }

    if (!renderHumanSurfaceDocument || typeof renderHumanSurfaceDocument !== "function") {
      diagnostics.push({
        code: "missing_human_surface_renderer",
        severity: "error",
        summary: "Smoke check could not find `renderHumanSurfaceDocument` in the built application.",
        hint: "Preserve the generated human surface renderer so Capstan can rebuild runtime HTML deterministically.",
        file: distIndexPath,
        source: "capstan"
      });
    } else if (
      typeof humanSurfaceHtml === "string" &&
      renderHumanSurfaceDocument() !== humanSurfaceHtml
    ) {
      diagnostics.push({
        code: "human_surface_render_mismatch",
        severity: "error",
        summary: "Built `renderHumanSurfaceDocument()` no longer matches the exported human surface HTML.",
        hint: "Keep the generated human surface render function aligned with the built HTML export.",
        file: distIndexPath,
        source: "capstan"
      });
    }

    if (!controlPlane?.search || typeof controlPlane.search !== "function") {
      diagnostics.push({
        code: "missing_control_plane_search",
        severity: "error",
        summary: "Smoke check could not call `controlPlane.search` from the built application.",
        hint: "Preserve the generated control plane export in `src/index.ts` and rerun the build.",
        file: distIndexPath,
        source: "capstan"
      });
    } else {
      const searchResult = controlPlane.search("");
      const searchRecord = searchResult as
        | {
            capabilities?: unknown[];
            tasks?: unknown[];
            artifacts?: unknown[];
          }
        | undefined;

      if (
        !searchRecord ||
        !Array.isArray(searchRecord.capabilities) ||
        !Array.isArray(searchRecord.tasks) ||
        !Array.isArray(searchRecord.artifacts)
      ) {
        diagnostics.push({
          code: "invalid_control_plane_search_result",
          severity: "error",
          summary: "Built `controlPlane.search` returned an unexpected result shape.",
          hint: "Keep the generated control plane result contract stable so agents can rely on it.",
          file: distIndexPath,
          source: "capstan"
        });
      } else if (
        parsedManifest &&
        (searchRecord.capabilities.length !== (parsedManifest.summary?.capabilityCount ?? 0) ||
          searchRecord.tasks.length !== (parsedManifest.summary?.taskCount ?? 0) ||
          searchRecord.artifacts.length !== (parsedManifest.summary?.artifactCount ?? 0))
      ) {
        diagnostics.push({
          code: "control_plane_search_count_mismatch",
          severity: "error",
          summary: "Built `controlPlane.search` no longer returns the manifest-sized discovery result for an empty query.",
          detail: `Expected ${parsedManifest.summary?.capabilityCount ?? 0} capabilities, ${parsedManifest.summary?.taskCount ?? 0} tasks, and ${parsedManifest.summary?.artifactCount ?? 0} artifacts.`,
          hint: "Keep search discovery aligned with the generated agent manifest so coding agents can trust both surfaces.",
          file: distIndexPath,
          source: "capstan"
        });
      }
    }

    if (!controlPlane?.execute || typeof controlPlane.execute !== "function") {
      diagnostics.push({
        code: "missing_control_plane_execute",
        severity: "error",
        summary: "Smoke check could not call `controlPlane.execute` from the built application.",
        hint: "Preserve the generated control plane execute path so agent and human flows stay convergent.",
        file: distIndexPath,
        source: "capstan"
      });
    } else if (parsedManifest?.capabilities?.[0]?.key) {
      const capabilityKey = parsedManifest.capabilities[0].key;
      const executionResult = await controlPlane.execute(capabilityKey, { smoke: true });

      if (!isCapabilityExecutionResult(executionResult, capabilityKey)) {
        diagnostics.push({
          code: "invalid_control_plane_execute_result",
          severity: "error",
          summary: "Built `controlPlane.execute` returned an unexpected capability result.",
          hint: "Keep generated capability handlers returning the standard execution result contract.",
          file: distIndexPath,
          source: "capstan"
        });
      }
    }

    if (!handleAgentSurfaceRequest || typeof handleAgentSurfaceRequest !== "function") {
      diagnostics.push({
        code: "missing_agent_transport_handler",
        severity: "error",
        summary: "Smoke check could not find `handleAgentSurfaceRequest` in the built application.",
        hint: "Preserve the generated agent transport export in `src/index.ts` and rerun the build.",
        file: distIndexPath,
        source: "capstan"
      });
    } else {
      const manifestResponse = await handleAgentSurfaceRequest({ operation: "manifest" });

      if (!manifestResponse || manifestResponse.ok !== true) {
        diagnostics.push({
          code: "invalid_agent_transport_manifest_response",
          severity: "error",
          summary: "Built `handleAgentSurfaceRequest` did not return a successful manifest response.",
          hint: "Keep the generated agent transport contract intact so external agents can discover the app.",
          file: distIndexPath,
          source: "capstan"
        });
      } else if (!isManifestTransportBody(manifestResponse.body)) {
        diagnostics.push({
          code: "invalid_agent_transport_manifest_body",
          severity: "error",
          summary: "Built `handleAgentSurfaceRequest({ operation: \"manifest\" })` returned an unexpected body shape.",
          hint: "Keep the generated transport manifest response aligned with the manifest projection.",
          file: distIndexPath,
          source: "capstan"
        });
      } else if (
        parsedManifest &&
        !manifestsHaveMatchingSummary(parsedManifest, manifestResponse.body.manifest)
      ) {
        diagnostics.push({
          code: "agent_transport_manifest_mismatch",
          severity: "error",
          summary: "Built transport manifest no longer matches the exported manifest summary.",
          hint: "Keep the generated manifest renderer and transport manifest response in sync.",
          file: distIndexPath,
          source: "capstan"
        });
      }

      const searchResponse = await handleAgentSurfaceRequest({
        operation: "search",
        query: ""
      });

      const transportSearchBody = searchResponse.body;

      if (!isSearchTransportResponse(transportSearchBody)) {
        diagnostics.push({
          code: "invalid_agent_transport_search_response",
          severity: "error",
          summary: "Built `handleAgentSurfaceRequest({ operation: \"search\" })` returned an unexpected body shape.",
          hint: "Keep transport search aligned with the generated search result contract.",
          file: distIndexPath,
          source: "capstan"
        });
      } else if (
        parsedManifest &&
        (transportSearchBody.capabilities.length !== (parsedManifest.summary?.capabilityCount ?? 0) ||
          transportSearchBody.tasks.length !== (parsedManifest.summary?.taskCount ?? 0) ||
          transportSearchBody.artifacts.length !== (parsedManifest.summary?.artifactCount ?? 0))
      ) {
        diagnostics.push({
          code: "agent_transport_search_count_mismatch",
          severity: "error",
          summary: "Built transport search no longer returns a manifest-sized discovery result for an empty query.",
          hint: "Keep transport discovery aligned with the exported agent manifest.",
          file: distIndexPath,
          source: "capstan"
        });
      }

      if (parsedManifest?.capabilities?.[0]?.key) {
        const capabilityKey = parsedManifest.capabilities[0].key;
        const executeResponse = await handleAgentSurfaceRequest({
          operation: "execute",
          key: capabilityKey,
          input: { smoke: true }
        });

        if (
          !executeResponse ||
          executeResponse.ok !== true ||
          !isCapabilityExecutionResult(executeResponse.body, capabilityKey)
        ) {
          diagnostics.push({
            code: "invalid_agent_transport_execute_response",
            severity: "error",
            summary: "Built transport execute path returned an unexpected capability result.",
            hint: "Keep transport execute aligned with the generated capability execution contract.",
            file: distIndexPath,
            source: "capstan"
          });
        }
      }
    }

    const humanSurfaceModuleUrl = `${pathToFileURL(resolve(root, "dist/human-surface/index.js")).href}?t=${Date.now()}-human-surface`;
    const humanSurfaceModule = (await import(humanSurfaceModuleUrl)) as Record<string, unknown>;
    const humanSurface = humanSurfaceModule.humanSurface as HumanSurfaceProjection | undefined;
    const mountHumanSurfaceBrowser = humanSurfaceModule.mountHumanSurfaceBrowser as
      | ((rootDocument?: Document) => HumanSurfaceRuntimeSnapshotRecord)
      | undefined;
    const renderedDocument =
      typeof renderHumanSurfaceDocument === "function"
        ? renderHumanSurfaceDocument()
        : typeof humanSurfaceHtml === "string"
          ? humanSurfaceHtml
          : undefined;

    if (!humanSurface || !Array.isArray(humanSurface.routes)) {
      diagnostics.push({
        code: "invalid_human_surface_projection",
        severity: "error",
        summary: "Smoke check could not resolve a valid human surface projection from the built application.",
        hint: "Preserve the generated human surface exports so runtime HTML stays tied to graph-defined routes.",
        file: resolve(root, "dist/human-surface/index.js"),
        source: "capstan"
      });
    } else if (!mountHumanSurfaceBrowser || typeof mountHumanSurfaceBrowser !== "function") {
      diagnostics.push({
        code: "missing_human_surface_browser_mount",
        severity: "error",
        summary: "Smoke check could not find `mountHumanSurfaceBrowser` in the built human surface module.",
        hint: "Keep the generated human surface browser runtime export intact.",
        file: resolve(root, "dist/human-surface/index.js"),
        source: "capstan"
      });
    } else if (renderedDocument) {
      const dom = new JSDOM(renderedDocument, { url: "https://capstan.local/" });
      const snapshot = mountHumanSurfaceBrowser(dom.window.document);

      if (!snapshot || typeof snapshot.activeRouteKey !== "string" || !snapshot.activeRouteKey) {
        diagnostics.push({
          code: "invalid_human_surface_runtime_snapshot",
          severity: "error",
          summary: "Built human surface runtime did not return a valid snapshot.",
          hint: "Keep the generated browser runtime returning a stable snapshot for verification and future harnesses.",
          file: resolve(root, "dist/human-surface/index.js"),
          source: "capstan"
        });
      } else if (
        humanSurface.routes[0]?.key &&
        snapshot.activeRouteKey !== humanSurface.routes[0].key
      ) {
        diagnostics.push({
          code: "unexpected_human_surface_active_route",
          severity: "error",
          summary: "Built human surface runtime did not activate the expected default route.",
          detail: `Expected "${humanSurface.routes[0].key}", received "${snapshot.activeRouteKey}".`,
          hint: "Keep the generated route order and default activation behavior stable.",
          file: resolve(root, "dist/human-surface/index.js"),
          source: "capstan"
        });
      }

      const routeNodes = Array.from(dom.window.document.querySelectorAll("[data-route-key]"));
      if (routeNodes.length !== humanSurface.routes.length) {
        diagnostics.push({
          code: "human_surface_route_projection_mismatch",
          severity: "error",
          summary: "Built human surface document no longer projects every generated route.",
          detail: `Expected ${humanSurface.routes.length} route nodes, received ${routeNodes.length}.`,
          hint: "Keep the generated human surface HTML aligned with the route projection.",
          file: resolve(root, "dist/human-surface/index.js"),
          source: "capstan"
        });
      }

      const resultKeys = snapshot.results ? Object.keys(snapshot.results) : [];
      if (resultKeys.length !== humanSurface.routes.length) {
        diagnostics.push({
          code: "human_surface_result_projection_mismatch",
          severity: "error",
          summary: "Built human surface runtime snapshot no longer tracks every generated route result.",
          detail: `Expected ${humanSurface.routes.length} route results, received ${resultKeys.length}.`,
          hint: "Keep runtime snapshot generation aligned with the graph-defined routes.",
          file: resolve(root, "dist/human-surface/index.js"),
          source: "capstan"
        });
      }

      const activeRouteOutput = snapshot.activeRouteKey
        ? dom.window.document.querySelector(
            `[data-route-result-output="${snapshot.activeRouteKey}"]`
          )?.textContent ?? ""
        : "";
      if (!activeRouteOutput.includes("route.idle")) {
        diagnostics.push({
          code: "invalid_human_surface_route_result_output",
          severity: "error",
          summary: "Built human surface route result output no longer reflects the initial idle route state.",
          hint: "Keep the generated human surface runtime wiring the route result projection to the initial snapshot.",
          file: resolve(root, "dist/human-surface/index.js"),
          source: "capstan"
        });
      }
    }
  } catch (error: unknown) {
    return [
      {
        code: "runtime_smoke_failed",
        severity: "error",
        summary: "Smoke check failed while importing or executing the built application.",
        detail: error instanceof Error ? error.stack ?? error.message : String(error),
        hint: "Inspect the built runtime exports and fix the failing module before rerunning `capstan verify`.",
        file: distIndexPath,
        source: "capstan"
      }
    ];
  }

  return diagnostics;
}

async function measureStep(
  key: VerifyStepKey,
  label: string,
  runner: () => Promise<VerifyDiagnostic[]>,
  command?: string
): Promise<VerifyStepResult> {
  const startedAt = Date.now();
  const diagnostics = await runner();
  const durationMs = Date.now() - startedAt;
  const hasError = diagnostics.some((diagnostic) => diagnostic.severity === "error");

  return {
    key,
    label,
    status: hasError ? "failed" : "passed",
    durationMs,
    diagnostics,
    ...(command ? { command } : {})
  };
}

function skippedStep(key: VerifyStepKey, label: string, summary?: string): VerifyStepResult {
  return {
    key,
    label,
    status: "skipped",
    durationMs: 0,
    diagnostics: summary
      ? [
          {
            code: "skipped",
            severity: "info",
            summary,
            source: "capstan"
          }
        ]
      : []
  };
}

function buildVerifyReport(appRoot: string, steps: VerifyStepResult[]): VerifyReport {
  const diagnostics = steps.flatMap((step) => step.diagnostics);
  const failedSteps = steps.filter((step) => step.status === "failed").length;
  const passedSteps = steps.filter((step) => step.status === "passed").length;
  const skippedSteps = steps.filter((step) => step.status === "skipped").length;
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const status: VerifyStatus = failedSteps ? "failed" : "passed";

  return {
    appRoot,
    status,
    generatedBy: "capstan-feedback",
    steps,
    diagnostics,
    summary: {
      status,
      stepCount: steps.length,
      passedSteps,
      failedSteps,
      skippedSteps,
      diagnosticCount: diagnostics.length,
      errorCount,
      warningCount
    }
  };
}

function formatTypeScriptCommand(root: string, noEmit: boolean): string {
  return `${tscBinary} -p ${resolve(root, "tsconfig.json")}${noEmit ? " --noEmit" : ""}`;
}

function buildRepairChecklist(report: VerifyReport): RepairChecklistItem[] {
  const seen = new Set<string>();
  const items: RepairChecklistItem[] = [];

  for (const step of report.steps) {
    if (step.status !== "failed") {
      continue;
    }

    for (const diagnostic of step.diagnostics) {
      if (diagnostic.severity !== "error") {
        continue;
      }

      const key = [
        step.key,
        diagnostic.code,
        diagnostic.file ?? "",
        diagnostic.summary,
        diagnostic.hint ?? ""
      ].join("::");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      items.push({
        stepLabel: step.label,
        summary: diagnostic.summary,
        ...(diagnostic.hint ? { hint: diagnostic.hint } : {}),
        ...(diagnostic.file ? { file: diagnostic.file } : {}),
        ...(diagnostic.line ? { line: diagnostic.line } : {}),
        ...(diagnostic.column ? { column: diagnostic.column } : {})
      });
    }
  }

  return items;
}

function parseAgentSurfaceManifest(
  manifest: string,
  diagnostics: VerifyDiagnostic[],
  file: string
): AgentSurfaceManifest | undefined {
  try {
    return JSON.parse(manifest) as AgentSurfaceManifest;
  } catch (error: unknown) {
    diagnostics.push({
      code: "invalid_agent_surface_manifest_export",
      severity: "error",
      summary: "Built `agentSurfaceManifest` is not valid JSON.",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Regenerate the agent surface projection so the built manifest becomes parseable again.",
      file,
      source: "capstan"
    });
    return undefined;
  }
}

function manifestsHaveMatchingSummary(
  expected: AgentSurfaceManifest,
  received: AgentSurfaceManifest | undefined
): boolean {
  if (!received?.summary) {
    return false;
  }

  return (
    received.summary.capabilityCount === expected.summary?.capabilityCount &&
    received.summary.taskCount === expected.summary?.taskCount &&
    received.summary.artifactCount === expected.summary?.artifactCount
  );
}

function isManifestTransportBody(value: unknown): value is AgentTransportManifestBody {
  if (!isRecord(value)) {
    return false;
  }

  return isRecord(value.manifest) && isRecord(value.summary);
}

function isSearchTransportResponse(value: unknown): value is SearchResultRecord {
  return isSearchResultRecord(value);
}

function isSearchResultRecord(value: unknown): value is SearchResultRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.capabilities) &&
    Array.isArray(value.tasks) &&
    Array.isArray(value.artifacts)
  );
}

function isCapabilityExecutionResult(
  value: unknown,
  capabilityKey: string
): value is CapabilityExecutionRecord {
  if (!isRecord(value)) {
    return false;
  }

  return value.capability === capabilityKey && typeof value.status === "string";
}

function isAssertionRunRecord(value: unknown): value is AppAssertionRunRecord {
  if (!isRecord(value) || !isRecord(value.assertion) || !isRecord(value.result)) {
    return false;
  }

  return (
    typeof value.assertion.key === "string" &&
    typeof value.assertion.title === "string" &&
    typeof value.result.status === "string" &&
    typeof value.result.summary === "string"
  );
}

async function readJsonFile<T>(
  path: string,
  diagnostics: VerifyDiagnostic[],
  options: { code: string; hint: string }
): Promise<T | undefined> {
  try {
    const contents = await readFile(path, "utf8");
    return JSON.parse(contents) as T;
  } catch (error: unknown) {
    diagnostics.push({
      code: options.code,
      severity: "error",
      summary: `Failed to read JSON file "${path}".`,
      detail: error instanceof Error ? error.message : String(error),
      hint: options.hint,
      file: path,
      source: "capstan"
    });
    return undefined;
  }
}

function compareCount(
  diagnostics: VerifyDiagnostic[],
  code: string,
  label: string,
  expected: number,
  received: number | undefined,
  root: string
): void {
  if (received === undefined || received === expected) {
    return;
  }

  diagnostics.push({
    code,
    severity: "error",
    summary: `Generated manifest ${label} count does not match the App Graph.`,
    detail: `Expected ${expected}, received ${received}.`,
    hint: "Regenerate the application so compiler projections and manifests converge again.",
    file: resolve(root, "agent-surface.json"),
    source: "capstan"
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

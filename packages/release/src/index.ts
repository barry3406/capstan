import { access, constants } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { verifyGeneratedApp, type VerifyReport } from "@capstan/feedback";

const accessAsync = promisify(access);
const execFileAsync = promisify(execFile);
const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, "../../..");
const tscBinary = resolve(repoRoot, "node_modules/.bin/tsc");

export type ReleasePlanStatus = "ready" | "blocked";
export type ReleaseGateStatus = "passed" | "failed";
export type ReleaseRunTarget = "preview" | "release";
export type ReleaseExecutionTarget = ReleaseRunTarget | "rollback";
export type ReleaseRunStatus = "completed" | "blocked" | "failed";
export type ReleaseRunStepStatus = "completed" | "failed" | "skipped";

export interface ReleaseEnvironmentVariable {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
  defaultValue?: string;
}

export interface ReleaseSecret {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
}

export interface ReleaseArtifact {
  key: string;
  title: string;
  kind: "directory" | "json" | "html" | "file";
  path: string;
  required?: boolean;
}

export interface ReleaseHealthCheck {
  key: string;
  title: string;
  kind: "verify_pass" | "path_exists" | "json_parse";
  target?: string;
  description?: string;
  required?: boolean;
}

export interface ReleaseStep {
  key: string;
  title: string;
  description?: string;
  command?: string;
}

export interface ReleaseEnvironment {
  key: string;
  title: string;
  strategy: "ephemeral" | "managed";
  baseUrl?: string;
  variables: readonly ReleaseEnvironmentVariable[];
  secrets: readonly ReleaseSecret[];
}

export interface ReleaseInputReference {
  path: string;
  title: string;
  description?: string;
}

export interface ReleaseEnvironmentSnapshotEntry {
  key: string;
  variables: Record<string, string>;
  secrets: readonly string[];
}

export interface ReleaseEnvironmentSnapshot {
  version: 1;
  environments: readonly ReleaseEnvironmentSnapshotEntry[];
}

export interface ReleaseMigrationStep {
  key: string;
  title: string;
  status: "applied" | "pending" | "unsafe";
  description?: string;
  command?: string;
}

export interface ReleaseMigrationPlan {
  version: 1;
  generatedBy: "capstan";
  status: "safe" | "pending" | "unsafe";
  steps: readonly ReleaseMigrationStep[];
}

export interface ReleaseRollbackPlan {
  strategy: string;
  steps: readonly string[];
}

export interface ReleaseTraceSpec {
  captures: readonly string[];
}

export interface ReleaseContract {
  version: 1;
  domain: {
    key: string;
    title: string;
    description?: string;
  };
  application: {
    key: string;
    title: string;
    generatedBy: "capstan";
  };
  environments: readonly ReleaseEnvironment[];
  inputs: {
    environmentSnapshot: ReleaseInputReference;
    migrationPlan: ReleaseInputReference;
  };
  artifacts: readonly ReleaseArtifact[];
  healthChecks: readonly ReleaseHealthCheck[];
  preview: {
    steps: readonly ReleaseStep[];
  };
  release: {
    steps: readonly ReleaseStep[];
  };
  rollback: ReleaseRollbackPlan;
  trace: ReleaseTraceSpec;
}

export interface ReleaseGate {
  key: string;
  label: string;
  status: ReleaseGateStatus;
  summary: string;
  detail?: string;
  hint?: string;
}

export interface ReleasePlanSection {
  environment?: ReleaseEnvironment;
  steps: readonly ReleaseStep[];
}

export interface ReleasePlanTrace {
  generatedAt: string;
  captures: readonly string[];
  contractPath: string;
  environmentSnapshotPath: string;
  migrationPlanPath: string;
  verifyStatus: VerifyReport["status"];
}

export interface ReleasePlanReport {
  appRoot: string;
  status: ReleasePlanStatus;
  contract: ReleaseContract;
  verify: VerifyReport;
  gates: readonly ReleaseGate[];
  preview: ReleasePlanSection;
  release: ReleasePlanSection;
  rollback: ReleaseRollbackPlan;
  trace: ReleasePlanTrace;
}

export interface ReleasePlanOptions {
  cwd?: string;
  environmentPath?: string;
  migrationPath?: string;
}

export interface ReleaseArtifactInventoryItem {
  key: string;
  title: string;
  kind: ReleaseArtifact["kind"];
  path: string;
  required: boolean;
  exists: boolean;
}

export interface ReleaseRunStepResult {
  key: string;
  label: string;
  status: ReleaseRunStepStatus;
  durationMs: number;
  summary: string;
  detail?: string;
  hint?: string;
  command?: string;
  artifactKeys?: readonly string[];
}

export interface ReleaseRunTrace {
  generatedAt: string;
  tracePath: string;
  target: ReleaseRunTarget;
  captures: readonly string[];
  environmentSnapshotPath: string;
  migrationPlanPath: string;
}

export interface ReleaseRunReport {
  appRoot: string;
  target: ReleaseRunTarget;
  status: ReleaseRunStatus;
  plan: ReleasePlanReport;
  steps: readonly ReleaseRunStepResult[];
  artifactInventory: readonly ReleaseArtifactInventoryItem[];
  trace: ReleaseRunTrace;
}

export interface ReleaseHistoryEntry {
  appRoot: string;
  target: ReleaseExecutionTarget;
  status: ReleaseRunStatus;
  generatedAt: string;
  tracePath: string;
  stepCount: number;
  sourceTracePath?: string;
}

export interface ReleaseHistoryReport {
  appRoot: string;
  runs: readonly ReleaseHistoryEntry[];
}

export interface ReleaseRollbackRunTrace {
  generatedAt: string;
  tracePath: string;
  target: "rollback";
  captures: readonly string[];
  sourceTracePath?: string;
}

export interface ReleaseRollbackRunReport {
  appRoot: string;
  target: "rollback";
  status: ReleaseRunStatus;
  summary: string;
  detail?: string;
  contract: ReleaseContract;
  rollback: ReleaseRollbackPlan;
  sourceRun?: ReleaseHistoryEntry;
  steps: readonly ReleaseRunStepResult[];
  artifactInventory: readonly ReleaseArtifactInventoryItem[];
  trace: ReleaseRollbackRunTrace;
}

export async function createReleasePlan(
  appRoot: string,
  options: ReleasePlanOptions = {}
): Promise<ReleasePlanReport> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const contractPath = resolve(root, "capstan.release.json");
  const contract = await readReleaseContract(root);
  const environmentSnapshotPath = resolve(
    root,
    options.environmentPath ?? contract.inputs.environmentSnapshot.path
  );
  const migrationPlanPath = resolve(root, options.migrationPath ?? contract.inputs.migrationPlan.path);
  const verify = await verifyGeneratedApp(root);
  const gates: ReleaseGate[] = [];
  const previewEnvironment = contract.environments.find(
    (environment) => environment.key === "preview"
  );
  const releaseEnvironment = contract.environments.find(
    (environment) => environment.key === "release"
  );

  gates.push({
    key: "verify",
    label: "Capstan Verify",
    status: verify.status === "passed" ? "passed" : "failed",
    summary:
      verify.status === "passed"
        ? "Capstan verify passed for this generated app."
        : "Capstan verify must pass before preview or release can continue.",
    ...(verify.status === "failed"
      ? {
          hint: "Resolve the reported verify diagnostics before attempting a preview or release plan."
        }
      : {})
  });

  const environmentSnapshotResult = await loadReleaseEnvironmentSnapshot(environmentSnapshotPath);
  if (environmentSnapshotResult.gate) {
    gates.push(environmentSnapshotResult.gate);
  } else {
    gates.push(...evaluateEnvironmentSnapshot(contract, environmentSnapshotResult.snapshot));
  }

  const migrationPlanResult = await loadReleaseMigrationPlan(migrationPlanPath);
  if (migrationPlanResult.gate) {
    gates.push(migrationPlanResult.gate);
  } else {
    gates.push(evaluateMigrationPlan(migrationPlanResult.plan));
  }

  for (const artifact of contract.artifacts) {
    if (!artifact.required) {
      continue;
    }

    const target = resolve(root, artifact.path);
    const exists = await pathExists(target);
    gates.push({
      key: `artifact:${artifact.key}`,
      label: `Artifact · ${artifact.title}`,
      status: exists ? "passed" : "failed",
      summary: exists
        ? `Required artifact "${artifact.path}" is present.`
        : `Required artifact "${artifact.path}" is missing.`,
      ...(exists
        ? {}
        : {
            hint: "Rebuild or regenerate the application so required release artifacts exist again."
          })
    });
  }

  for (const check of contract.healthChecks) {
    const gate = await evaluateHealthCheck(root, check, verify);
    gates.push(gate);
  }

  const status: ReleasePlanStatus = gates.some((gate) => gate.status === "failed")
    ? "blocked"
    : "ready";

  return {
    appRoot: root,
    status,
    contract,
    verify,
    gates,
    preview: {
      ...(previewEnvironment ? { environment: previewEnvironment } : {}),
      steps: contract.preview.steps
    },
    release: {
      ...(releaseEnvironment ? { environment: releaseEnvironment } : {}),
      steps: contract.release.steps
    },
    rollback: contract.rollback,
    trace: {
      generatedAt: new Date().toISOString(),
      captures: contract.trace.captures,
      contractPath,
      environmentSnapshotPath,
      migrationPlanPath,
      verifyStatus: verify.status
    }
  };
}

export async function createReleaseRun(
  appRoot: string,
  target: ReleaseRunTarget,
  options: ReleasePlanOptions = {}
): Promise<ReleaseRunReport> {
  const plan = await createReleasePlan(appRoot, options);
  const section = target === "preview" ? plan.preview : plan.release;
  const artifactInventory = await collectArtifactInventory(plan.appRoot, plan.contract.artifacts);
  const steps: ReleaseRunStepResult[] = [];
  const generatedAt = new Date().toISOString();
  const tracePath = resolve(
    plan.appRoot,
    ".capstan/release-runs",
    `${formatTraceStamp(generatedAt)}-${target}.json`
  );

  if (plan.status === "blocked") {
    const report: ReleaseRunReport = {
      appRoot: plan.appRoot,
      target,
      status: "blocked",
      plan,
      steps,
      artifactInventory,
      trace: {
        generatedAt,
        tracePath,
        target,
        captures: plan.trace.captures,
        environmentSnapshotPath: plan.trace.environmentSnapshotPath,
        migrationPlanPath: plan.trace.migrationPlanPath
      }
    };

    await writeReleaseRunTrace(report);
    return report;
  }

  for (const step of section.steps) {
    const result = await executeReleaseStep(plan, target, step, artifactInventory);
    steps.push(result);

    if (result.status === "failed") {
      for (const pendingStep of section.steps.slice(steps.length)) {
        steps.push(
          skippedReleaseRunStep(
            pendingStep,
            `Release run stopped after "${step.title}" failed.`
          )
        );
      }
      break;
    }
  }

  const status: ReleaseRunStatus = steps.some((step) => step.status === "failed")
    ? "failed"
    : "completed";

  const report: ReleaseRunReport = {
    appRoot: plan.appRoot,
    target,
    status,
    plan,
    steps,
    artifactInventory,
    trace: {
      generatedAt,
      tracePath,
      target,
      captures: plan.trace.captures,
      environmentSnapshotPath: plan.trace.environmentSnapshotPath,
      migrationPlanPath: plan.trace.migrationPlanPath
    }
  };

  await writeReleaseRunTrace(report);
  return report;
}

export async function listReleaseRuns(
  appRoot: string,
  options: { cwd?: string } = {}
): Promise<ReleaseHistoryReport> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const runsDir = resolve(root, ".capstan/release-runs");

  let entries: string[];
  try {
    entries = await readdir(runsDir);
  } catch {
    return {
      appRoot: root,
      runs: []
    };
  }

  const runs = (
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) =>
          normalizeReleaseHistoryEntry(resolve(runsDir, entry), root)
        )
    )
  )
    .filter((entry): entry is ReleaseHistoryEntry => Boolean(entry))
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));

  return {
    appRoot: root,
    runs
  };
}

export async function createRollbackRun(
  appRoot: string,
  options: { cwd?: string; tracePath?: string } = {}
): Promise<ReleaseRollbackRunReport> {
  const root = resolve(options.cwd ?? process.cwd(), appRoot);
  const contract = await readReleaseContract(root);
  const history = await listReleaseRuns(root);
  const generatedAt = new Date().toISOString();
  const tracePath = resolve(
    root,
    ".capstan/release-runs",
    `${formatTraceStamp(generatedAt)}-rollback.json`
  );
  const sourceRun = await resolveRollbackSourceRun(history, options.tracePath);
  const artifactInventory = sourceRun
    ? await loadArtifactInventoryFromTrace(sourceRun.tracePath, contract.artifacts)
    : await collectArtifactInventory(root, contract.artifacts);

  if (!sourceRun) {
    const blockedReport: ReleaseRollbackRunReport = {
      appRoot: root,
      target: "rollback",
      status: "blocked",
      summary: "No completed preview or release run is available for rollback.",
      detail: "Run a successful preview or release before attempting rollback, or pass --trace to target a persisted run explicitly.",
      contract,
      rollback: contract.rollback,
      steps: [],
      artifactInventory,
      trace: {
        generatedAt,
        tracePath,
        target: "rollback",
        captures: contract.trace.captures
      }
    };

    await writeRollbackRunTrace(blockedReport);
    return blockedReport;
  }

  const steps = contract.rollback.steps.map((step, index) =>
    completeRollbackRunStep(step, index, sourceRun, artifactInventory)
  );

  const report: ReleaseRollbackRunReport = {
    appRoot: root,
    target: "rollback",
    status: "completed",
    summary: `Rollback steps completed using source run "${sourceRun.target}" from ${sourceRun.generatedAt}.`,
    contract,
    rollback: contract.rollback,
    sourceRun,
    steps,
    artifactInventory,
    trace: {
      generatedAt,
      tracePath,
      target: "rollback",
      captures: contract.trace.captures,
      sourceTracePath: sourceRun.tracePath
    }
  };

  await writeRollbackRunTrace(report);
  return report;
}

export async function readReleaseContract(appRoot: string): Promise<ReleaseContract> {
  const contractPath = resolve(appRoot, "capstan.release.json");
  const source = await readFile(contractPath, "utf8");
  const parsed = JSON.parse(source) as ReleaseContract;
  const issues = validateReleaseContract(parsed);

  if (issues.length) {
    throw new Error(
      `Invalid Capstan release contract:\n${issues.map((issue) => `- ${issue}`).join("\n")}`
    );
  }

  return parsed;
}

export function validateReleaseContract(contract: ReleaseContract): string[] {
  const issues: string[] = [];

  if (contract.version !== 1) {
    issues.push("`version` must be 1.");
  }

  if (!contract.domain?.key || !contract.domain?.title) {
    issues.push("`domain.key` and `domain.title` are required.");
  }

  if (!contract.application?.key || !contract.application?.title) {
    issues.push("`application.key` and `application.title` are required.");
  }

  if (!Array.isArray(contract.environments) || !contract.environments.length) {
    issues.push("At least one release environment is required.");
  }

  if (!contract.inputs?.environmentSnapshot?.path) {
    issues.push("`inputs.environmentSnapshot.path` is required.");
  }

  if (!contract.inputs?.migrationPlan?.path) {
    issues.push("`inputs.migrationPlan.path` is required.");
  }

  if (!Array.isArray(contract.artifacts) || !contract.artifacts.length) {
    issues.push("At least one release artifact is required.");
  }

  if (!Array.isArray(contract.healthChecks) || !contract.healthChecks.length) {
    issues.push("At least one health check is required.");
  }

  if (!Array.isArray(contract.preview?.steps) || !contract.preview.steps.length) {
    issues.push("Preview steps are required.");
  }

  if (!Array.isArray(contract.release?.steps) || !contract.release.steps.length) {
    issues.push("Release steps are required.");
  }

  if (!contract.rollback?.strategy || !Array.isArray(contract.rollback.steps)) {
    issues.push("Rollback strategy and steps are required.");
  }

  if (!Array.isArray(contract.trace?.captures) || !contract.trace.captures.length) {
    issues.push("Release trace captures are required.");
  }

  return issues;
}

export function validateReleaseEnvironmentSnapshot(
  snapshot: ReleaseEnvironmentSnapshot
): string[] {
  const issues: string[] = [];

  if (snapshot.version !== 1) {
    issues.push("`version` must be 1.");
  }

  if (!Array.isArray(snapshot.environments) || !snapshot.environments.length) {
    issues.push("At least one environment snapshot entry is required.");
    return issues;
  }

  for (const environment of snapshot.environments) {
    if (!environment.key) {
      issues.push("Every environment snapshot entry must have a `key`.");
    }

    if (
      !environment.variables ||
      typeof environment.variables !== "object" ||
      Array.isArray(environment.variables)
    ) {
      issues.push(`Environment "${environment.key || "unknown"}" must define a variables object.`);
    } else {
      for (const [key, value] of Object.entries(environment.variables)) {
        if (typeof value !== "string") {
          issues.push(
            `Environment "${environment.key || "unknown"}" variable "${key}" must be a string.`
          );
        }
      }
    }

    if (!Array.isArray(environment.secrets)) {
      issues.push(`Environment "${environment.key || "unknown"}" must define a secrets array.`);
    }
  }

  return issues;
}

export function validateReleaseMigrationPlan(plan: ReleaseMigrationPlan): string[] {
  const issues: string[] = [];

  if (plan.version !== 1) {
    issues.push("`version` must be 1.");
  }

  if (plan.generatedBy !== "capstan") {
    issues.push("`generatedBy` must be \"capstan\".");
  }

  if (!["safe", "pending", "unsafe"].includes(plan.status)) {
    issues.push("`status` must be one of \"safe\", \"pending\", or \"unsafe\".");
  }

  if (!Array.isArray(plan.steps)) {
    issues.push("`steps` must be an array.");
    return issues;
  }

  for (const step of plan.steps) {
    if (!step.key || !step.title) {
      issues.push("Every migration step must have a `key` and `title`.");
    }

    if (!["applied", "pending", "unsafe"].includes(step.status)) {
      issues.push(
        `Migration step "${step.key || "unknown"}" must use a supported status.`
      );
    }
  }

  return issues;
}

export function renderReleasePlanText(report: ReleasePlanReport): string {
  const lines = [
    "Capstan Release Plan",
    `App: ${report.appRoot}`,
    `Status: ${report.status}`,
    `Domain: ${report.contract.domain.title} (${report.contract.domain.key})`
  ];

  lines.push("");
  lines.push("Safety Gates");
  for (const gate of report.gates) {
    lines.push(`- [${gate.status}] ${gate.label}: ${gate.summary}`);
    if (gate.detail) {
      lines.push(`  detail: ${gate.detail}`);
    }
    if (gate.hint) {
      lines.push(`  next: ${gate.hint}`);
    }
  }

  lines.push("");
  lines.push("Preview");
  for (const step of report.preview.steps) {
    lines.push(`- ${step.title}`);
    if (step.command) {
      lines.push(`  command: ${step.command}`);
    }
    if (step.description) {
      lines.push(`  detail: ${step.description}`);
    }
  }

  lines.push("");
  lines.push("Release");
  for (const step of report.release.steps) {
    lines.push(`- ${step.title}`);
    if (step.command) {
      lines.push(`  command: ${step.command}`);
    }
    if (step.description) {
      lines.push(`  detail: ${step.description}`);
    }
  }

  lines.push("");
  lines.push("Rollback");
  lines.push(`- Strategy: ${report.rollback.strategy}`);
  for (const step of report.rollback.steps) {
    lines.push(`- ${step}`);
  }

  lines.push("");
  lines.push("Trace");
  lines.push(`- generatedAt: ${report.trace.generatedAt}`);
  lines.push(`- verifyStatus: ${report.trace.verifyStatus}`);
  lines.push(`- contractPath: ${report.trace.contractPath}`);
  lines.push(`- environmentSnapshotPath: ${report.trace.environmentSnapshotPath}`);
  lines.push(`- migrationPlanPath: ${report.trace.migrationPlanPath}`);
  lines.push(`- captures: ${report.trace.captures.join(", ")}`);

  return `${lines.join("\n")}\n`;
}

export function renderReleaseRunText(report: ReleaseRunReport): string {
  const lines = [
    "Capstan Release Run",
    `App: ${report.appRoot}`,
    `Target: ${report.target}`,
    `Status: ${report.status}`,
    `Plan Status: ${report.plan.status}`
  ];

  lines.push("");
  lines.push("Steps");

  if (!report.steps.length) {
    lines.push("- No release steps were executed because the release plan was blocked.");
  } else {
    for (const step of report.steps) {
      lines.push(`- [${step.status}] ${step.label}: ${step.summary}`);
      if (step.command) {
        lines.push(`  command: ${step.command}`);
      }
      if (step.detail) {
        lines.push(`  detail: ${step.detail}`);
      }
      if (step.hint) {
        lines.push(`  next: ${step.hint}`);
      }
      if (step.artifactKeys?.length) {
        lines.push(`  artifacts: ${step.artifactKeys.join(", ")}`);
      }
    }
  }

  lines.push("");
  lines.push("Artifact Inventory");
  for (const artifact of report.artifactInventory) {
    lines.push(
      `- [${artifact.exists ? "present" : "missing"}] ${artifact.title}: ${artifact.path}`
    );
  }

  lines.push("");
  lines.push("Trace");
  lines.push(`- generatedAt: ${report.trace.generatedAt}`);
  lines.push(`- tracePath: ${report.trace.tracePath}`);
  lines.push(`- target: ${report.trace.target}`);
  lines.push(`- environmentSnapshotPath: ${report.trace.environmentSnapshotPath}`);
  lines.push(`- migrationPlanPath: ${report.trace.migrationPlanPath}`);

  return `${lines.join("\n")}\n`;
}

export function renderReleaseHistoryText(report: ReleaseHistoryReport): string {
  const lines = ["Capstan Release History", `App: ${report.appRoot}`];

  if (!report.runs.length) {
    lines.push("");
    lines.push("No persisted release runs were found.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  for (const run of report.runs) {
    lines.push(
      `- [${run.status}] ${run.target} @ ${run.generatedAt} (${run.stepCount} steps)`
    );
    lines.push(`  trace: ${run.tracePath}`);
    if (run.sourceTracePath) {
      lines.push(`  source: ${run.sourceTracePath}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderRollbackRunText(report: ReleaseRollbackRunReport): string {
  const lines = [
    "Capstan Rollback Run",
    `App: ${report.appRoot}`,
    `Status: ${report.status}`,
    `Strategy: ${report.rollback.strategy}`,
    `Summary: ${report.summary}`
  ];

  if (report.detail) {
    lines.push(`Detail: ${report.detail}`);
  }

  lines.push("");
  lines.push("Steps");
  if (!report.steps.length) {
    lines.push("- No rollback steps were executed.");
  } else {
    for (const step of report.steps) {
      lines.push(`- [${step.status}] ${step.label}: ${step.summary}`);
      if (step.detail) {
        lines.push(`  detail: ${step.detail}`);
      }
      if (step.artifactKeys?.length) {
        lines.push(`  artifacts: ${step.artifactKeys.join(", ")}`);
      }
    }
  }

  lines.push("");
  lines.push("Trace");
  lines.push(`- generatedAt: ${report.trace.generatedAt}`);
  lines.push(`- tracePath: ${report.trace.tracePath}`);
  if (report.trace.sourceTracePath) {
    lines.push(`- sourceTracePath: ${report.trace.sourceTracePath}`);
  }

  return `${lines.join("\n")}\n`;
}

async function loadReleaseEnvironmentSnapshot(
  snapshotPath: string
): Promise<
  | { snapshot: ReleaseEnvironmentSnapshot; gate?: never }
  | { snapshot?: never; gate: ReleaseGate }
> {
  try {
    const source = await readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(source) as ReleaseEnvironmentSnapshot;
    const issues = validateReleaseEnvironmentSnapshot(parsed);

    if (issues.length) {
      return {
        gate: {
          key: "environment:contract",
          label: "Environment Snapshot",
          status: "failed",
          summary: "The release environment snapshot is invalid.",
          detail: issues.join(" "),
          hint: "Repair the environment snapshot so every expected environment, variable, and secret handle is machine-readable."
        }
      };
    }

    return { snapshot: parsed };
  } catch (error: unknown) {
    return {
      gate: {
        key: "environment:contract",
        label: "Environment Snapshot",
        status: "failed",
        summary: "The release environment snapshot could not be loaded.",
        detail: error instanceof Error ? error.message : String(error),
        hint: "Regenerate or repair the environment snapshot before attempting release."
      }
    };
  }
}

async function executeReleaseStep(
  plan: ReleasePlanReport,
  target: ReleaseRunTarget,
  step: ReleaseStep,
  artifactInventory: ReleaseArtifactInventoryItem[]
): Promise<ReleaseRunStepResult> {
  const startedAt = Date.now();

  switch (step.key) {
    case "verify":
      return completeReleaseRunStep(
        step,
        startedAt,
        plan.verify.status === "passed"
          ? "Capstan verify was already satisfied by the release plan."
          : "Capstan verify failed.",
        {
          detail: `passedSteps=${plan.verify.summary.passedSteps}; failedSteps=${plan.verify.summary.failedSteps}`
        }
      );
    case "build": {
      const build = await runGeneratedBuild(plan.appRoot);
      if (build.ok) {
        return completeReleaseRunStep(
          step,
          startedAt,
          "Generated application build completed for the release run.",
          {
            command: formatTypeScriptBuildCommand(plan.appRoot)
          }
        );
      }

      return failedReleaseRunStep(
        step,
        startedAt,
        "Generated application build failed during the release run.",
        {
          command: formatTypeScriptBuildCommand(plan.appRoot),
          detail: build.detail,
          hint: "Repair the generated TypeScript build before attempting preview or release again."
        }
      );
    }
    case "inspectPreviewArtifacts": {
      const missingArtifacts = artifactInventory.filter(
        (artifact) => artifact.required && !artifact.exists
      );

      if (missingArtifacts.length) {
        return failedReleaseRunStep(
          step,
          startedAt,
          "Preview artifact inspection failed because required artifacts are missing.",
          {
            detail: missingArtifacts.map((artifact) => artifact.path).join(", "),
            hint: "Regenerate or rebuild the application so preview artifacts exist before inspection."
          }
        );
      }

      return completeReleaseRunStep(
        step,
        startedAt,
        "Preview artifacts are present and ready for operator inspection.",
        {
          artifactKeys: artifactInventory.filter((artifact) => artifact.exists).map((artifact) => artifact.key)
        }
      );
    }
    case "publishArtifacts": {
      const publishableArtifacts = artifactInventory.filter(
        (artifact) => artifact.required && artifact.exists
      );
      const missingArtifacts = artifactInventory.filter(
        (artifact) => artifact.required && !artifact.exists
      );

      if (missingArtifacts.length) {
        return failedReleaseRunStep(
          step,
          startedAt,
          "Release promotion cannot continue because required artifacts are missing.",
          {
            detail: missingArtifacts.map((artifact) => artifact.path).join(", "),
            hint: "Restore the missing artifacts or rerun the build before publishing."
          }
        );
      }

      return completeReleaseRunStep(
        step,
        startedAt,
        `Simulated ${target} publication is ready to promote the compiled artifacts.`,
        {
          artifactKeys: publishableArtifacts.map((artifact) => artifact.key),
          detail: publishableArtifacts.map((artifact) => artifact.path).join(", ")
        }
      );
    }
    case "confirmHealth": {
      const healthFailures = plan.gates.filter(
        (gate) => gate.key.startsWith("health:") && gate.status === "failed"
      );

      if (healthFailures.length) {
        return failedReleaseRunStep(
          step,
          startedAt,
          "Health confirmation failed during the release run.",
          {
            detail: healthFailures.map((gate) => gate.label).join(", "),
            hint: "Fix the failing health checks before promoting the release."
          }
        );
      }

      return completeReleaseRunStep(
        step,
        startedAt,
        "Release health gates are satisfied.",
        {
          detail: `${plan.gates.filter((gate) => gate.key.startsWith("health:")).length} health checks passed.`
        }
      );
    }
    default:
      return completeReleaseRunStep(
        step,
        startedAt,
        `Simulated release step "${step.title}" completed without a dedicated framework executor yet.`,
        {
          ...(step.command ? { command: step.command } : {}),
          hint: "Add a dedicated Capstan release step executor as this workflow matures."
        }
      );
  }
}

async function resolveRollbackSourceRun(
  history: ReleaseHistoryReport,
  tracePath?: string
): Promise<ReleaseHistoryEntry | undefined> {
  if (tracePath) {
    const resolvedTracePath = resolve(process.cwd(), tracePath);
    return history.runs.find((run) => run.tracePath === resolvedTracePath);
  }

  return (
    history.runs.find((run) => run.target === "release" && run.status === "completed") ??
    history.runs.find(
      (run) =>
        (run.target === "release" || run.target === "preview") && run.status === "completed"
    )
  );
}

function completeRollbackRunStep(
  step: string,
  index: number,
  sourceRun: ReleaseHistoryEntry,
  artifactInventory: ReleaseArtifactInventoryItem[]
): ReleaseRunStepResult {
  return {
    key: `rollback:${index + 1}`,
    label: `Rollback Step ${index + 1}`,
    status: "completed",
    durationMs: 0,
    summary: step,
    detail: `Simulated against source run "${sourceRun.target}" from ${sourceRun.generatedAt}.`,
    artifactKeys: artifactInventory.filter((artifact) => artifact.exists).map((artifact) => artifact.key)
  };
}

async function loadReleaseMigrationPlan(
  migrationPath: string
): Promise<
  | { plan: ReleaseMigrationPlan; gate?: never }
  | { plan?: never; gate: ReleaseGate }
> {
  try {
    const source = await readFile(migrationPath, "utf8");
    const parsed = JSON.parse(source) as ReleaseMigrationPlan;
    const issues = validateReleaseMigrationPlan(parsed);

    if (issues.length) {
      return {
        gate: {
          key: "migration:contract",
          label: "Migration Plan",
          status: "failed",
          summary: "The migration plan is invalid.",
          detail: issues.join(" "),
          hint: "Repair the migration plan so release safety can reason about pending or unsafe changes."
        }
      };
    }

    return { plan: parsed };
  } catch (error: unknown) {
    return {
      gate: {
        key: "migration:contract",
        label: "Migration Plan",
        status: "failed",
        summary: "The migration plan could not be loaded.",
        detail: error instanceof Error ? error.message : String(error),
        hint: "Regenerate or repair the migration plan before attempting release."
      }
    };
  }
}

function evaluateEnvironmentSnapshot(
  contract: ReleaseContract,
  snapshot: ReleaseEnvironmentSnapshot
): ReleaseGate[] {
  const gates: ReleaseGate[] = [];
  const snapshotByKey = new Map(snapshot.environments.map((environment) => [environment.key, environment]));
  const knownEnvironmentKeys = new Set(contract.environments.map((environment) => environment.key));
  const unknownEnvironmentKeys = snapshot.environments
    .map((environment) => environment.key)
    .filter((key) => !knownEnvironmentKeys.has(key));

  if (unknownEnvironmentKeys.length) {
    gates.push({
      key: "environment:unknown",
      label: "Environment Snapshot Drift",
      status: "failed",
      summary: `Unknown environment snapshot entries were found: ${unknownEnvironmentKeys.join(", ")}.`,
      hint: "Remove unknown environments or add them to the release contract before attempting release."
    });
  }

  for (const environment of contract.environments) {
    const snapshotEntry = snapshotByKey.get(environment.key);

    if (!snapshotEntry) {
      gates.push({
        key: `environment:${environment.key}`,
        label: `Environment · ${environment.title}`,
        status: "failed",
        summary: `No environment snapshot entry exists for "${environment.key}".`,
        hint: "Add the missing environment entry to the release environment snapshot."
      });
      continue;
    }

    const knownVariables = new Set(environment.variables.map((variable) => variable.key));
    const knownSecrets = new Set(environment.secrets.map((secret) => secret.key));
    const missingVariables = environment.variables
      .filter((variable) => variable.required)
      .filter((variable) => !hasSnapshotValue(snapshotEntry.variables[variable.key]))
      .map((variable) => variable.key);
    const missingSecrets = environment.secrets
      .filter((secret) => secret.required)
      .filter((secret) => !snapshotEntry.secrets.includes(secret.key))
      .map((secret) => secret.key);
    const unknownVariables = Object.keys(snapshotEntry.variables).filter(
      (variableKey) => !knownVariables.has(variableKey)
    );
    const unknownSecrets = snapshotEntry.secrets.filter((secretKey) => !knownSecrets.has(secretKey));

    const drift: string[] = [];
    if (missingVariables.length) {
      drift.push(`missing variables: ${missingVariables.join(", ")}`);
    }
    if (missingSecrets.length) {
      drift.push(`missing secrets: ${missingSecrets.join(", ")}`);
    }
    if (unknownVariables.length) {
      drift.push(`unknown variables: ${unknownVariables.join(", ")}`);
    }
    if (unknownSecrets.length) {
      drift.push(`unknown secrets: ${unknownSecrets.join(", ")}`);
    }

    gates.push({
      key: `environment:${environment.key}`,
      label: `Environment · ${environment.title}`,
      status: drift.length ? "failed" : "passed",
      summary: drift.length
        ? `Environment snapshot drift detected for "${environment.key}".`
        : `Environment snapshot matches the "${environment.key}" contract.`,
      ...(drift.length
        ? {
            detail: drift.join("; "),
            hint: "Align the environment snapshot with the release contract before attempting preview or release."
          }
        : {
            detail: `variables=${Object.keys(snapshotEntry.variables).length}; secrets=${snapshotEntry.secrets.length}`
          })
    });
  }

  return gates;
}

function evaluateMigrationPlan(plan: ReleaseMigrationPlan): ReleaseGate {
  const pendingSteps = plan.steps.filter((step) => step.status === "pending");
  const unsafeSteps = plan.steps.filter((step) => step.status === "unsafe");

  if (!unsafeSteps.length && !pendingSteps.length && plan.status === "safe") {
    return {
      key: "migration:status",
      label: "Migration Safety",
      status: "passed",
      summary: "Migration plan is safe for preview and release.",
      detail: `steps=${plan.steps.length}`
    };
  }

  return {
    key: "migration:status",
    label: "Migration Safety",
    status: "failed",
    summary:
      plan.status === "unsafe"
        ? "Migration plan is marked unsafe."
        : pendingSteps.length
          ? "Migration plan still has pending steps."
          : "Migration plan is not safe for release.",
    detail: [...unsafeSteps, ...pendingSteps].map((step) => step.title).join(", "),
    hint:
      unsafeSteps.length > 0
        ? "Resolve or manually review the unsafe migration steps before release."
        : "Apply or clear pending migrations before release."
  };
}

async function evaluateHealthCheck(
  appRoot: string,
  check: ReleaseHealthCheck,
  verify: VerifyReport
): Promise<ReleaseGate> {
  switch (check.kind) {
    case "verify_pass":
      return {
        key: `health:${check.key}`,
        label: `Health Check · ${check.title}`,
        status: verify.status === "passed" ? "passed" : "failed",
        summary:
          verify.status === "passed"
            ? check.description ?? "Capstan verify passed."
            : check.description ?? "Capstan verify failed.",
        ...(verify.status === "passed"
          ? {}
          : {
              hint: "Fix the verify failures before attempting a preview or release."
            })
      };
    case "path_exists": {
      const target = resolve(appRoot, check.target ?? "");
      const exists = Boolean(check.target) && (await pathExists(target));
      return {
        key: `health:${check.key}`,
        label: `Health Check · ${check.title}`,
        status: exists ? "passed" : "failed",
        summary: exists
          ? check.description ?? `Required path "${check.target}" exists.`
          : check.description ?? `Required path "${check.target ?? "unknown"}" is missing.`,
        ...(exists
          ? {}
          : {
              hint: "Restore the missing release artifact or rebuild the application before release."
            })
      };
    }
    case "json_parse": {
      const target = resolve(appRoot, check.target ?? "");
      try {
        const contents = await readFile(target, "utf8");
        JSON.parse(contents);
        return {
          key: `health:${check.key}`,
          label: `Health Check · ${check.title}`,
          status: "passed",
          summary: check.description ?? `JSON file "${check.target}" parsed successfully.`
        };
      } catch (error: unknown) {
        return {
          key: `health:${check.key}`,
          label: `Health Check · ${check.title}`,
          status: "failed",
          summary:
            check.description ?? `JSON file "${check.target ?? "unknown"}" could not be parsed.`,
          detail: error instanceof Error ? error.message : String(error),
          hint: "Regenerate or repair the JSON artifact before attempting release."
        };
      }
    }
    default:
      return {
        key: `health:${check.key}`,
        label: `Health Check · ${check.title}`,
        status: "failed",
        summary: `Unsupported health check kind "${String(check.kind)}".`,
        hint: "Use a supported release health check kind before attempting release."
      };
  }
}

async function collectArtifactInventory(
  appRoot: string,
  artifacts: readonly ReleaseArtifact[]
): Promise<ReleaseArtifactInventoryItem[]> {
  const inventory: ReleaseArtifactInventoryItem[] = [];

  for (const artifact of artifacts) {
    inventory.push({
      key: artifact.key,
      title: artifact.title,
      kind: artifact.kind,
      path: artifact.path,
      required: artifact.required ?? false,
      exists: await pathExists(resolve(appRoot, artifact.path))
    });
  }

  return inventory;
}

async function loadArtifactInventoryFromTrace(
  tracePath: string,
  fallbackArtifacts: readonly ReleaseArtifact[]
): Promise<ReleaseArtifactInventoryItem[]> {
  try {
    const source = await readFile(tracePath, "utf8");
    const parsed = JSON.parse(source) as {
      artifactInventory?: ReleaseArtifactInventoryItem[];
      appRoot?: string;
    };

    if (Array.isArray(parsed.artifactInventory) && parsed.artifactInventory.length) {
      return parsed.artifactInventory.map((artifact) => ({
        key: artifact.key,
        title: artifact.title,
        kind: artifact.kind,
        path: artifact.path,
        required: artifact.required,
        exists: artifact.exists
      }));
    }

    if (typeof parsed.appRoot === "string") {
      return collectArtifactInventory(parsed.appRoot, fallbackArtifacts);
    }
  } catch {
    // Fall back to the current app root inventory below.
  }

  const fallbackRoot = resolve(dirname(dirname(tracePath)), "..");
  return collectArtifactInventory(fallbackRoot, fallbackArtifacts);
}

async function normalizeReleaseHistoryEntry(
  tracePath: string,
  fallbackAppRoot: string
): Promise<ReleaseHistoryEntry | null> {
  try {
    const source = await readFile(tracePath, "utf8");
    const parsed = JSON.parse(source) as {
      appRoot?: string;
      target?: string;
      status?: string;
      steps?: unknown[];
      trace?: {
        generatedAt?: string;
        tracePath?: string;
        sourceTracePath?: string;
      };
    };

    const target = parsed.target;
    const status = parsed.status;
    const generatedAt = parsed.trace?.generatedAt;

    if (
      !isExecutionTarget(target) ||
      !isRunStatus(status) ||
      typeof generatedAt !== "string"
    ) {
      return null;
    }

    return {
      appRoot: typeof parsed.appRoot === "string" ? parsed.appRoot : fallbackAppRoot,
      target,
      status,
      generatedAt,
      tracePath: typeof parsed.trace?.tracePath === "string" ? parsed.trace.tracePath : tracePath,
      stepCount: Array.isArray(parsed.steps) ? parsed.steps.length : 0,
      ...(typeof parsed.trace?.sourceTracePath === "string"
        ? { sourceTracePath: parsed.trace.sourceTracePath }
        : {})
    };
  } catch {
    return null;
  }
}

async function runGeneratedBuild(
  appRoot: string
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    await execFileAsync(tscBinary, ["-p", resolve(appRoot, "tsconfig.json")], {
      cwd: appRoot
    });
    return { ok: true };
  } catch (error: unknown) {
    const failed = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    return {
      ok: false,
      detail:
        [failed.stdout, failed.stderr, failed.message]
          .filter((value): value is string => Boolean(value?.trim()))
          .join("\n") || "Unknown TypeScript build failure."
    };
  }
}

function completeReleaseRunStep(
  step: ReleaseStep,
  startedAt: number,
  summary: string,
  extras: Partial<Omit<ReleaseRunStepResult, "key" | "label" | "status" | "durationMs" | "summary">> = {}
): ReleaseRunStepResult {
  return {
    key: step.key,
    label: step.title,
    status: "completed",
    durationMs: Date.now() - startedAt,
    summary,
    ...extras
  };
}

function failedReleaseRunStep(
  step: ReleaseStep,
  startedAt: number,
  summary: string,
  extras: Partial<Omit<ReleaseRunStepResult, "key" | "label" | "status" | "durationMs" | "summary">> = {}
): ReleaseRunStepResult {
  return {
    key: step.key,
    label: step.title,
    status: "failed",
    durationMs: Date.now() - startedAt,
    summary,
    ...extras
  };
}

function skippedReleaseRunStep(step: ReleaseStep, summary: string): ReleaseRunStepResult {
  return {
    key: step.key,
    label: step.title,
    status: "skipped",
    durationMs: 0,
    summary,
    ...(step.command ? { command: step.command } : {})
  };
}

async function writeReleaseRunTrace(report: ReleaseRunReport): Promise<void> {
  await mkdir(dirname(report.trace.tracePath), { recursive: true });
  await writeFile(
    report.trace.tracePath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
}

async function writeRollbackRunTrace(report: ReleaseRollbackRunReport): Promise<void> {
  await mkdir(dirname(report.trace.tracePath), { recursive: true });
  await writeFile(
    report.trace.tracePath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await accessAsync(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function hasSnapshotValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function formatTypeScriptBuildCommand(appRoot: string): string {
  return `${tscBinary} -p ${resolve(appRoot, "tsconfig.json")}`;
}

function formatTraceStamp(isoString: string): string {
  return isoString.replace(/[:.]/g, "-");
}

function isExecutionTarget(value: string | undefined): value is ReleaseExecutionTarget {
  return value === "preview" || value === "release" || value === "rollback";
}

function isRunStatus(value: string | undefined): value is ReleaseRunStatus {
  return value === "completed" || value === "blocked" || value === "failed";
}

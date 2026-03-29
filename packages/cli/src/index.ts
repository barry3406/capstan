#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Legacy package types — kept as opaque aliases so the CLI compiles without
// the legacy packages installed.  All runtime values are loaded via dynamic
// import() inside the command functions that need them.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppGraph = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CapstanBrief = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GraphPackDefinition = any;

const LEGACY_INSTALL_HINT =
  "Legacy compiler packages are not installed.\n" +
  "Install them with:  npm install @zauso-ai/capstan-app-graph @zauso-ai/capstan-packs-core @zauso-ai/capstan-brief @zauso-ai/capstan-surface-web @zauso-ai/capstan-surface-agent @zauso-ai/capstan-compiler @zauso-ai/capstan-feedback @zauso-ai/capstan-release @zauso-ai/capstan-harness";

/**
 * Dynamically import a legacy package, providing a clear error when it is
 * not installed.
 */
async function requireLegacy<T = Record<string, unknown>>(
  pkg: string,
): Promise<T> {
  try {
    return (await import(pkg)) as T;
  } catch {
    console.error(
      `The legacy package "${pkg}" is required for this command but is not installed.\n\n${LEGACY_INSTALL_HINT}`,
    );
    process.exitCode = 1;
    throw new Error(`Missing legacy package: ${pkg}`);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "brief:check":
      await runBriefCheck(args);
      return;
    case "brief:inspect":
      await runBriefInspect(args);
      return;
    case "brief:graph":
      await runBriefGraph(args);
      return;
    case "brief:scaffold":
      await runBriefScaffold(args);
      return;
    case "graph:check":
      await runGraphCheck(args);
      return;
    case "graph:scaffold":
      await runGraphScaffold(args);
      return;
    case "graph:inspect":
      await runGraphInspect(args);
      return;
    case "graph:diff":
      await runGraphDiff(args);
      return;
    case "verify":
      await runVerify(args, args.includes("--json"));
      return;
    case "release:plan":
      await runReleasePlan(args);
      return;
    case "release:run":
      await runReleaseRun(args);
      return;
    case "release:history":
      await runReleaseHistory(args);
      return;
    case "release:rollback":
      await runReleaseRollback(args);
      return;
    case "harness:start":
      await runHarnessStart(args);
      return;
    case "harness:get":
      await runHarnessGet(args);
      return;
    case "harness:list":
      await runHarnessList(args);
      return;
    case "harness:pause":
      await runHarnessPause(args);
      return;
    case "harness:resume":
      await runHarnessResume(args);
      return;
    case "harness:request-approval":
      await runHarnessRequestApproval(args);
      return;
    case "harness:approve":
      await runHarnessApprove(args);
      return;
    case "harness:request-input":
      await runHarnessRequestInput(args);
      return;
    case "harness:provide-input":
      await runHarnessProvideInput(args);
      return;
    case "harness:complete":
      await runHarnessComplete(args);
      return;
    case "harness:fail":
      await runHarnessFail(args);
      return;
    case "harness:cancel":
      await runHarnessCancel(args);
      return;
    case "harness:retry":
      await runHarnessRetry(args);
      return;
    case "harness:events":
      await runHarnessEvents(args);
      return;
    case "harness:replay":
      await runHarnessReplay(args);
      return;
    case "harness:compact":
      await runHarnessCompact(args);
      return;
    case "harness:summary":
      await runHarnessSummary(args);
      return;
    case "harness:summaries":
      await runHarnessSummaries(args);
      return;
    case "harness:memory":
      await runHarnessMemory(args);
      return;
    case "harness:memories":
      await runHarnessMemories(args);
      return;
    case "dev":
      await runDev(args);
      return;
    case "build":
      await runBuild();
      return;
    case "start":
      await runStart(args);
      return;
    case "db:migrate":
      await runDbMigrate(args);
      return;
    case "db:push":
      await runDbPush();
      return;
    case "db:status":
      await runDbStatus();
      return;
    case "mcp":
      await runMcp();
      return;
    case "agent:manifest":
      await runAgentManifest();
      return;
    case "agent:openapi":
      await runAgentOpenapi();
      return;
    case "add":
      await runAdd(args);
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

async function runBriefCheck(args: string[]): Promise<void> {
  const target = args[0];
  const packRegistryPath = readFlagValue(args, "--pack-registry");

  if (!target) {
    console.error("Usage: capstan brief:check <path-to-brief> [--pack-registry <path>]");
    process.exitCode = 1;
    return;
  }

  const { validateCapstanBrief } = await requireLegacy<typeof import("@zauso-ai/capstan-brief")>("@zauso-ai/capstan-brief");
  const { validateAppGraph } = await requireLegacy<typeof import("@zauso-ai/capstan-app-graph")>("@zauso-ai/capstan-app-graph");

  const loaded = await loadBrief(target);
  const validation = validateCapstanBrief(loaded.brief);

  if (!validation.ok) {
    console.error("Capstan brief validation failed:");
    for (const issue of validation.issues) {
      console.error(`- ${issue.path}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const graph = await compileBriefWithPackDefinitions(loaded.brief, {
    packDefinitions: loaded.packDefinitions,
    ...(packRegistryPath ? { packRegistryPath } : {})
  });
  const result = validateAppGraph(graph);

  if (result.ok) {
    console.log("Capstan brief is valid.");
    return;
  }

  console.error("Compiled App Graph validation failed:");
  for (const issue of result.issues) {
    console.error(`- ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
}

async function runBriefInspect(args: string[]): Promise<void> {
  const target = args[0];
  const packRegistryPath = readFlagValue(args, "--pack-registry");

  if (!target) {
    console.error("Usage: capstan brief:inspect <path-to-brief> [--pack-registry <path>]");
    process.exitCode = 1;
    return;
  }

  const { summarizeCapstanBrief, validateCapstanBrief } = await requireLegacy<typeof import("@zauso-ai/capstan-brief")>("@zauso-ai/capstan-brief");
  const { introspectAppGraph } = await requireLegacy<typeof import("@zauso-ai/capstan-app-graph")>("@zauso-ai/capstan-app-graph");

  const loaded = await loadBrief(target);
  const graph = await compileBriefWithPackDefinitions(loaded.brief, {
    packDefinitions: loaded.packDefinitions,
    ...(packRegistryPath ? { packRegistryPath } : {})
  });

  console.log(
    JSON.stringify(
          {
        brief: {
          summary: summarizeCapstanBrief(loaded.brief, {
            packDefinitions: loaded.packDefinitions
          }),
          validation: validateCapstanBrief(loaded.brief)
        },
        graph: introspectAppGraph(graph)
      },
      null,
      2
    )
  );
}

async function runBriefGraph(args: string[]): Promise<void> {
  const target = args[0];
  const packRegistryPath = readFlagValue(args, "--pack-registry");

  if (!target) {
    console.error("Usage: capstan brief:graph <path-to-brief> [--pack-registry <path>]");
    process.exitCode = 1;
    return;
  }

  const loaded = await loadBrief(target);
  const graph = await compileBriefWithPackDefinitions(loaded.brief, {
    packDefinitions: loaded.packDefinitions,
    ...(packRegistryPath ? { packRegistryPath } : {})
  });

  console.log(JSON.stringify(graph, null, 2));
}

async function runBriefScaffold(args: string[]): Promise<void> {
  const target = args[0];
  const outputDir = args[1];
  const force = args.includes("--force");
  const packRegistryPath = readFlagValue(args, "--pack-registry");

  if (!target || !outputDir) {
    console.error(
      "Usage: capstan brief:scaffold <path-to-brief> <output-dir> [--force] [--pack-registry <path>]"
    );
    process.exitCode = 1;
    return;
  }

  const { scaffoldAppGraph } = await requireLegacy<typeof import("@zauso-ai/capstan-compiler")>("@zauso-ai/capstan-compiler");

  const loaded = await loadBrief(target);
  const graph = await compileBriefWithPackDefinitions(loaded.brief, {
    packDefinitions: loaded.packDefinitions,
    ...(packRegistryPath ? { packRegistryPath } : {})
  });
  const result = await scaffoldAppGraph(graph, resolve(process.cwd(), outputDir), {
    force
  });

  console.log(`Scaffolded ${result.files.length} files into ${result.rootDir}`);
}

async function runGraphCheck(args: string[]): Promise<void> {
  const target = args[0];
  const packRegistryPath = readFlagValue(args, "--pack-registry");

  if (!target) {
    console.error("Usage: capstan graph:check <path-to-graph> [--pack-registry <path>]");
    process.exitCode = 1;
    return;
  }

  const { validateAppGraph } = await requireLegacy<typeof import("@zauso-ai/capstan-app-graph")>("@zauso-ai/capstan-app-graph");

  const graph = await loadGraph(target, {
    ...(packRegistryPath ? { packRegistryPath } : {})
  });
  const result = validateAppGraph(graph);

  if (result.ok) {
    console.log("App Graph is valid.");
    return;
  }

  console.error("App Graph validation failed:");
  for (const issue of result.issues) {
    console.error(`- ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
}

async function runGraphScaffold(args: string[]): Promise<void> {
  const target = args[0];
  const outputDir = args[1];
  const force = args.includes("--force");
  const packRegistryPath = readFlagValue(args, "--pack-registry");

  if (!target || !outputDir) {
    console.error(
      "Usage: capstan graph:scaffold <path-to-graph> <output-dir> [--force] [--pack-registry <path>]"
    );
    process.exitCode = 1;
    return;
  }

  const { scaffoldAppGraph } = await requireLegacy<typeof import("@zauso-ai/capstan-compiler")>("@zauso-ai/capstan-compiler");

  const graph = await loadGraph(target, {
    ...(packRegistryPath ? { packRegistryPath } : {})
  });
  const result = await scaffoldAppGraph(graph, resolve(process.cwd(), outputDir), {
    force
  });

  console.log(`Scaffolded ${result.files.length} files into ${result.rootDir}`);
}

async function runGraphInspect(args: string[]): Promise<void> {
  const target = args[0];
  const packRegistryPath = readFlagValue(args, "--pack-registry");

  if (!target) {
    console.error("Usage: capstan graph:inspect <path-to-graph> [--pack-registry <path>]");
    process.exitCode = 1;
    return;
  }

  const { introspectAppGraph } = await requireLegacy<typeof import("@zauso-ai/capstan-app-graph")>("@zauso-ai/capstan-app-graph");

  const graph = await loadGraph(target, {
    ...(packRegistryPath ? { packRegistryPath } : {})
  });
  console.log(JSON.stringify(introspectAppGraph(graph), null, 2));
}

async function runGraphDiff(args: string[]): Promise<void> {
  const beforePath = args[0];
  const afterPath = args[1];
  const packRegistryPath = readFlagValue(args, "--pack-registry");

  if (!beforePath || !afterPath) {
    console.error(
      "Usage: capstan graph:diff <before-graph> <after-graph> [--pack-registry <path>]"
    );
    process.exitCode = 1;
    return;
  }

  const { diffAppGraphs } = await requireLegacy<typeof import("@zauso-ai/capstan-app-graph")>("@zauso-ai/capstan-app-graph");

  const before = await loadGraph(beforePath, {
    ...(packRegistryPath ? { packRegistryPath } : {})
  });
  const after = await loadGraph(afterPath, {
    ...(packRegistryPath ? { packRegistryPath } : {})
  });
  console.log(JSON.stringify(diffAppGraphs(before, after), null, 2));
}

async function runVerify(args: string[], asJson: boolean): Promise<void> {
  // Detect which verification system to use:
  // - If the target (or cwd) has app/routes/, use the new runtime verifier
  // - If the target has capstan.app.json, use the old compiler-based verifier

  // Strip --json from args to get the positional target
  const positional = args.filter((a) => a !== "--json");
  const target = positional[0];

  // For the new runtime verifier, target is optional (defaults to cwd)
  const appRoot = target ? resolve(process.cwd(), target) : process.cwd();

  const hasAppRoutes = existsSync(join(appRoot, "app", "routes"));
  const hasOldAppJson = existsSync(join(appRoot, "capstan.app.json"));

  if (hasAppRoutes && !hasOldAppJson) {
    // New runtime framework — use @zauso-ai/capstan-core verifier
    const { verifyCapstanApp, renderRuntimeVerifyText } = await import("@zauso-ai/capstan-core");
    const report = await verifyCapstanApp(appRoot);

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(renderRuntimeVerifyText(report));
    }

    if (report.status === "failed") {
      process.exitCode = 1;
    }
    return;
  }

  if (hasOldAppJson) {
    // Old compiler-based framework — use @zauso-ai/capstan-feedback verifier
    if (!target) {
      console.error("Usage: capstan verify <generated-app-dir> [--json]");
      process.exitCode = 1;
      return;
    }

    const { verifyGeneratedApp, renderVerifyReportText } = await requireLegacy<typeof import("@zauso-ai/capstan-feedback")>("@zauso-ai/capstan-feedback");
    const report = await verifyGeneratedApp(resolve(process.cwd(), target));

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(renderVerifyReportText(report));
    }

    if (report.status === "failed") {
      process.exitCode = 1;
    }
    return;
  }

  // Neither detected — try to give helpful guidance
  console.error("Could not detect project type.");
  console.error("  - For runtime apps: ensure app/routes/ directory exists.");
  console.error("  - For generated apps: ensure capstan.app.json exists.");
  if (target) {
    console.error(`  Looked in: ${appRoot}`);
  } else {
    console.error(`  Looked in: ${process.cwd()}`);
    console.error("  Tip: run from your project root, or pass the directory as an argument.");
  }
  process.exitCode = 1;
}

async function runReleasePlan(args: string[]): Promise<void> {
  const target = args[0];
  const asJson = args.includes("--json");
  const environmentPath = readFlagValue(args, "--env");
  const migrationPath = readFlagValue(args, "--migrations");

  if (!target) {
    console.error(
      "Usage: capstan release:plan <generated-app-dir> [--json] [--env <path>] [--migrations <path>]"
    );
    process.exitCode = 1;
    return;
  }

  const { createReleasePlan, renderReleasePlanText } = await requireLegacy<typeof import("@zauso-ai/capstan-release")>("@zauso-ai/capstan-release");

  const report = await createReleasePlan(resolve(process.cwd(), target), {
    ...(environmentPath ? { environmentPath } : {}),
    ...(migrationPath ? { migrationPath } : {})
  });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderReleasePlanText(report));
  }

  if (report.status === "blocked") {
    process.exitCode = 1;
  }
}

async function runReleaseRun(args: string[]): Promise<void> {
  const target = args[0];
  const mode = args[1];
  const asJson = args.includes("--json");
  const environmentPath = readFlagValue(args, "--env");
  const migrationPath = readFlagValue(args, "--migrations");

  if (!target || (mode !== "preview" && mode !== "release")) {
    console.error(
      "Usage: capstan release:run <generated-app-dir> <preview|release> [--json] [--env <path>] [--migrations <path>]"
    );
    process.exitCode = 1;
    return;
  }

  const { createReleaseRun, renderReleaseRunText } = await requireLegacy<typeof import("@zauso-ai/capstan-release")>("@zauso-ai/capstan-release");

  const report = await createReleaseRun(resolve(process.cwd(), target), mode, {
    ...(environmentPath ? { environmentPath } : {}),
    ...(migrationPath ? { migrationPath } : {})
  });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderReleaseRunText(report));
  }

  if (report.status !== "completed") {
    process.exitCode = 1;
  }
}

async function runReleaseHistory(args: string[]): Promise<void> {
  const target = args[0];
  const asJson = args.includes("--json");

  if (!target) {
    console.error("Usage: capstan release:history <generated-app-dir> [--json]");
    process.exitCode = 1;
    return;
  }

  const { listReleaseRuns, renderReleaseHistoryText } = await requireLegacy<typeof import("@zauso-ai/capstan-release")>("@zauso-ai/capstan-release");

  const report = await listReleaseRuns(resolve(process.cwd(), target));

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderReleaseHistoryText(report));
  }
}

async function runReleaseRollback(args: string[]): Promise<void> {
  const target = args[0];
  const asJson = args.includes("--json");
  const tracePath = readFlagValue(args, "--trace");

  if (!target) {
    console.error(
      "Usage: capstan release:rollback <generated-app-dir> [--json] [--trace <path>]"
    );
    process.exitCode = 1;
    return;
  }

  const { createRollbackRun, renderRollbackRunText } = await requireLegacy<typeof import("@zauso-ai/capstan-release")>("@zauso-ai/capstan-release");

  const report = await createRollbackRun(resolve(process.cwd(), target), {
    ...(tracePath ? { tracePath } : {})
  });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderRollbackRunText(report));
  }

  if (report.status !== "completed") {
    process.exitCode = 1;
  }
}

async function runHarnessStart(args: string[]): Promise<void> {
  const appDir = args[0];
  const taskKey = args[1];
  const asJson = args.includes("--json");
  const inputPath = readFlagValue(args, "--input");
  const note = readFlagValue(args, "--note");

  if (!appDir || !taskKey) {
    console.error(
      "Usage: capstan harness:start <generated-app-dir> <task-key> [--json] [--input <path>] [--note <text>]"
    );
    process.exitCode = 1;
    return;
  }

  const { createHarnessRun, renderHarnessRunText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const input = inputPath ? await loadJsonFile(inputPath) : {};
  const run = await createHarnessRun(resolve(process.cwd(), appDir), taskKey, ensureRecord(input), {
    ...(note ? { note } : {})
  });

  if (asJson) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    process.stdout.write(renderHarnessRunText(run));
  }
}

async function runHarnessGet(args: string[]): Promise<void> {
  const appDir = args[0];
  const runId = args[1];
  const asJson = args.includes("--json");

  if (!appDir || !runId) {
    console.error("Usage: capstan harness:get <generated-app-dir> <run-id> [--json]");
    process.exitCode = 1;
    return;
  }

  const { getHarnessRun, renderHarnessRunText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const run = await getHarnessRun(resolve(process.cwd(), appDir), runId);

  if (!run) {
    console.error(`Unknown harness run "${runId}".`);
    process.exitCode = 1;
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    process.stdout.write(renderHarnessRunText(run));
  }
}

async function runHarnessList(args: string[]): Promise<void> {
  const appDir = args[0];
  const asJson = args.includes("--json");
  const taskKey = readFlagValue(args, "--task");

  if (!appDir) {
    console.error("Usage: capstan harness:list <generated-app-dir> [--json] [--task <task-key>]");
    process.exitCode = 1;
    return;
  }

  const { listHarnessRuns, renderHarnessRunsText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const runs = await listHarnessRuns(resolve(process.cwd(), appDir), {
    ...(taskKey ? { taskKey } : {})
  });

  if (asJson) {
    console.log(JSON.stringify(runs, null, 2));
  } else {
    process.stdout.write(renderHarnessRunsText(runs));
  }
}

async function runHarnessPause(args: string[]): Promise<void> {
  await runHarnessMutation(args, "pause");
}

async function runHarnessResume(args: string[]): Promise<void> {
  await runHarnessMutation(args, "resume");
}

async function runHarnessRequestApproval(args: string[]): Promise<void> {
  await runHarnessMutation(args, "request-approval");
}

async function runHarnessApprove(args: string[]): Promise<void> {
  await runHarnessMutation(args, "approve");
}

async function runHarnessRequestInput(args: string[]): Promise<void> {
  await runHarnessMutation(args, "request-input");
}

async function runHarnessProvideInput(args: string[]): Promise<void> {
  const appDir = args[0];
  const runId = args[1];
  const asJson = args.includes("--json");
  const inputPath = readFlagValue(args, "--input");
  const note = readFlagValue(args, "--note");

  if (!appDir || !runId || !inputPath) {
    console.error(
      "Usage: capstan harness:provide-input <generated-app-dir> <run-id> --input <path> [--json] [--note <text>]"
    );
    process.exitCode = 1;
    return;
  }

  const { provideHarnessInput, renderHarnessRunText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const input = ensureRecord(await loadJsonFile(inputPath));
  const run = await provideHarnessInput(resolve(process.cwd(), appDir), runId, input, {
    ...(note ? { note } : {})
  });

  if (asJson) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    process.stdout.write(renderHarnessRunText(run));
  }
}

async function runHarnessComplete(args: string[]): Promise<void> {
  const appDir = args[0];
  const runId = args[1];
  const asJson = args.includes("--json");
  const outputPath = readFlagValue(args, "--output");
  const note = readFlagValue(args, "--note");

  if (!appDir || !runId) {
    console.error(
      "Usage: capstan harness:complete <generated-app-dir> <run-id> [--json] [--output <path>] [--note <text>]"
    );
    process.exitCode = 1;
    return;
  }

  const { completeHarnessRun, renderHarnessRunText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const output = outputPath ? await loadJsonFile(outputPath) : {};
  const run = await completeHarnessRun(
    resolve(process.cwd(), appDir),
    runId,
    output,
    {
      ...(note ? { note } : {})
    }
  );

  if (asJson) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    process.stdout.write(renderHarnessRunText(run));
  }
}

async function runHarnessFail(args: string[]): Promise<void> {
  const appDir = args[0];
  const runId = args[1];
  const asJson = args.includes("--json");
  const message = readFlagValue(args, "--message");

  if (!appDir || !runId || !message) {
    console.error(
      "Usage: capstan harness:fail <generated-app-dir> <run-id> --message <text> [--json]"
    );
    process.exitCode = 1;
    return;
  }

  const { failHarnessRun, renderHarnessRunText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const run = await failHarnessRun(resolve(process.cwd(), appDir), runId, message);

  if (asJson) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    process.stdout.write(renderHarnessRunText(run));
  }
}

async function runHarnessCancel(args: string[]): Promise<void> {
  await runHarnessMutation(args, "cancel");
}

async function runHarnessRetry(args: string[]): Promise<void> {
  await runHarnessMutation(args, "retry");
}

async function runHarnessEvents(args: string[]): Promise<void> {
  const appDir = args[0];
  const asJson = args.includes("--json");
  const runId = readFlagValue(args, "--run");

  if (!appDir) {
    console.error("Usage: capstan harness:events <generated-app-dir> [--json] [--run <run-id>]");
    process.exitCode = 1;
    return;
  }

  const { listHarnessEvents, renderHarnessEventsText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const events = await listHarnessEvents(resolve(process.cwd(), appDir), {
    ...(runId ? { runId } : {})
  });

  if (asJson) {
    console.log(JSON.stringify(events, null, 2));
  } else {
    process.stdout.write(renderHarnessEventsText(events));
  }
}

async function runHarnessReplay(args: string[]): Promise<void> {
  const appDir = args[0];
  const runId = args[1];
  const asJson = args.includes("--json");

  if (!appDir || !runId) {
    console.error("Usage: capstan harness:replay <generated-app-dir> <run-id> [--json]");
    process.exitCode = 1;
    return;
  }

  const { replayHarnessRun, renderHarnessReplayText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const report = await replayHarnessRun(resolve(process.cwd(), appDir), runId);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderHarnessReplayText(report));
  }

  if (!report.consistent) {
    process.exitCode = 1;
  }
}

async function runHarnessCompact(args: string[]): Promise<void> {
  const appDir = args[0];
  const runId = args[1];
  const asJson = args.includes("--json");
  const tailValue = readFlagValue(args, "--tail");

  if (!appDir || !runId) {
    console.error(
      "Usage: capstan harness:compact <generated-app-dir> <run-id> [--json] [--tail <count>]"
    );
    process.exitCode = 1;
    return;
  }

  const { compactHarnessRun, renderHarnessCompactionText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const tail = tailValue ? Number.parseInt(tailValue, 10) : undefined;
  const summary = await compactHarnessRun(resolve(process.cwd(), appDir), runId, {
    ...(typeof tail === "number" && Number.isFinite(tail) ? { tail } : {})
  });

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    process.stdout.write(renderHarnessCompactionText(summary));
  }

  if (!summary.consistent) {
    process.exitCode = 1;
  }
}

async function runHarnessSummary(args: string[]): Promise<void> {
  const appDir = args[0];
  const runId = args[1];
  const asJson = args.includes("--json");
  const refresh = args.includes("--refresh");
  const tailValue = readFlagValue(args, "--tail");

  if (!appDir || !runId) {
    console.error(
      "Usage: capstan harness:summary <generated-app-dir> <run-id> [--json] [--refresh] [--tail <count>]"
    );
    process.exitCode = 1;
    return;
  }

  const { getHarnessSummary, renderHarnessCompactionText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const tail = tailValue ? Number.parseInt(tailValue, 10) : undefined;
  const summary = await getHarnessSummary(resolve(process.cwd(), appDir), runId, {
    refresh,
    ...(typeof tail === "number" && Number.isFinite(tail) ? { tail } : {})
  });

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    process.stdout.write(renderHarnessCompactionText(summary));
  }

  if (!summary.consistent) {
    process.exitCode = 1;
  }
}

async function runHarnessSummaries(args: string[]): Promise<void> {
  const appDir = args[0];
  const asJson = args.includes("--json");

  if (!appDir) {
    console.error("Usage: capstan harness:summaries <generated-app-dir> [--json]");
    process.exitCode = 1;
    return;
  }

  const { listHarnessSummaries, renderHarnessSummariesText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const summaries = await listHarnessSummaries(resolve(process.cwd(), appDir));

  if (asJson) {
    console.log(JSON.stringify(summaries, null, 2));
  } else {
    process.stdout.write(renderHarnessSummariesText(summaries));
  }
}

async function runHarnessMemory(args: string[]): Promise<void> {
  const appDir = args[0];
  const runId = args[1];
  const asJson = args.includes("--json");
  const refresh = args.includes("--refresh");
  const tailValue = readFlagValue(args, "--tail");

  if (!appDir || !runId) {
    console.error(
      "Usage: capstan harness:memory <generated-app-dir> <run-id> [--json] [--refresh] [--tail <count>]"
    );
    process.exitCode = 1;
    return;
  }

  const { createHarnessMemory, getHarnessMemory, renderHarnessMemoryText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const tail = tailValue ? Number.parseInt(tailValue, 10) : undefined;
  const artifact = refresh
    ? await createHarnessMemory(resolve(process.cwd(), appDir), runId, {
        refresh,
        ...(typeof tail === "number" && Number.isFinite(tail) ? { tail } : {})
      })
    : await getHarnessMemory(resolve(process.cwd(), appDir), runId, {
        ...(typeof tail === "number" && Number.isFinite(tail) ? { tail } : {})
      });

  if (asJson) {
    console.log(JSON.stringify(artifact, null, 2));
  } else {
    process.stdout.write(renderHarnessMemoryText(artifact));
  }
}

async function runHarnessMemories(args: string[]): Promise<void> {
  const appDir = args[0];
  const asJson = args.includes("--json");

  if (!appDir) {
    console.error("Usage: capstan harness:memories <generated-app-dir> [--json]");
    process.exitCode = 1;
    return;
  }

  const { listHarnessMemories, renderHarnessMemoriesText } = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");
  const memories = await listHarnessMemories(resolve(process.cwd(), appDir));
  if (asJson) {
    console.log(JSON.stringify(memories, null, 2));
  } else {
    process.stdout.write(renderHarnessMemoriesText(memories));
  }
}

// ---------------------------------------------------------------------------
// Dev / Build / Start
// ---------------------------------------------------------------------------

async function runDev(args: string[]): Promise<void> {
  // Spawn a child process with --import tsx so that dynamic import() of .ts
  // and .tsx route files works. Node.js cannot natively handle .tsx, and
  // register("tsx/esm") was deprecated in Node v20.6+.
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { resolve: resolvePath } = await import("node:path");

  // Locate the tsx package entry for --import
  let tsxImportSpecifier: string;
  try {
    const tsxPkgPath = await import("node:module").then(m =>
      m.createRequire(import.meta.url).resolve("tsx/esm"),
    );
    // --import requires a file:// URL or bare specifier
    tsxImportSpecifier = "tsx";
  } catch {
    tsxImportSpecifier = "tsx";
  }

  // Build an inline script that starts the dev server
  const port = readFlagValue(args, "--port") ?? "3000";
  const host = readFlagValue(args, "--host") ?? "localhost";

  const devScript = `
    import { createDevServer } from "@zauso-ai/capstan-dev";
    import { pathToFileURL } from "node:url";
    import { existsSync } from "node:fs";
    import { resolve } from "node:path";

    const port = ${parseInt(port, 10)};
    const host = "${host}";
    const cwd = process.cwd();

    let appName = "capstan-app";
    let appDescription;
    for (const name of ["capstan.config.ts", "capstan.config.js"]) {
      const p = resolve(cwd, name);
      if (existsSync(p)) {
        try {
          const mod = await import(pathToFileURL(p).href);
          if (mod.default?.app?.name) appName = mod.default.app.name;
          if (mod.default?.app?.description) appDescription = mod.default.app.description;
        } catch {}
        break;
      }
    }

    const server = await createDevServer({ rootDir: cwd, port, host, appName, ...(appDescription ? { appDescription } : {}) });
    await server.start();
  `;

  const child = spawn(
    process.execPath,
    ["--import", tsxImportSpecifier, "--input-type=module", "-e", devScript],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env },
    },
  );

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  // Forward SIGINT / SIGTERM to child
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}

async function runBuild(): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const { mkdir, writeFile, cp, access } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const { generateAgentManifest, generateOpenApiSpec } = await import("@zauso-ai/capstan-agent");

  const cwd = process.cwd();
  const distDir = join(cwd, "dist");

  // Step 1: TypeScript compilation
  console.log("[capstan] Compiling TypeScript...");
  try {
    await exec("npx", ["tsc", "-p", "tsconfig.json"], { cwd });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[capstan] TypeScript compilation failed:\n${message}`);
    process.exitCode = 1;
    return;
  }
  console.log("[capstan] TypeScript compilation complete.");

  // Step 2: Load app config
  let appName = "capstan-app";
  let appDescription: string | undefined;
  try {
    const configPath = await resolveConfig();
    if (configPath) {
      const configUrl = pathToFileURL(configPath).href;
      const mod = (await import(configUrl)) as {
        default?: { name?: string; description?: string; app?: { name?: string; description?: string } };
      };
      if (mod.default?.app?.name) appName = mod.default.app.name;
      else if (mod.default?.name) appName = mod.default.name;
      if (mod.default?.app?.description) appDescription = mod.default.app.description;
      else if (mod.default?.description) appDescription = mod.default.description;
    }
  } catch {
    // Config is optional.
  }

  // Step 3: Scan routes and build manifest with compiled paths
  const routesDir = join(cwd, "app", "routes");
  console.log("[capstan] Scanning routes...");
  const manifest = await scanRoutes(routesDir);

  // Rewrite file paths from source .ts/.tsx to compiled .js/.jsx
  // and make them relative to the dist directory
  const rewrittenManifest = {
    ...manifest,
    rootDir: join(distDir, "app", "routes"),
    routes: manifest.routes.map((route) => ({
      ...route,
      filePath: route.filePath
        .replace(cwd, distDir)
        .replace(/\.tsx$/, ".jsx")
        .replace(/\.ts$/, ".js"),
      layouts: route.layouts.map((l) =>
        l.replace(cwd, distDir).replace(/\.tsx$/, ".jsx").replace(/\.ts$/, ".js"),
      ),
      middlewares: route.middlewares.map((m) =>
        m.replace(cwd, distDir).replace(/\.tsx$/, ".jsx").replace(/\.ts$/, ".js"),
      ),
    })),
  };

  await mkdir(distDir, { recursive: true });
  await writeFile(
    join(distDir, "_capstan_manifest.json"),
    JSON.stringify(rewrittenManifest, null, 2),
  );
  console.log("[capstan] Generated dist/_capstan_manifest.json");

  // Step 4: Generate agent-manifest.json and openapi.json
  const registryEntries = manifest.routes
    .filter((r) => r.type === "api")
    .flatMap((r) => {
      const methods = r.methods && r.methods.length > 0 ? r.methods : ["GET"];
      return methods.map((m) => ({
        method: m,
        path: r.urlPattern,
      }));
    });

  const agentConfig = { name: appName, ...(appDescription ? { description: appDescription } : {}) };
  const agentManifest = generateAgentManifest(agentConfig, registryEntries);
  const openApiSpec = generateOpenApiSpec(agentConfig, registryEntries);

  await writeFile(join(distDir, "agent-manifest.json"), JSON.stringify(agentManifest, null, 2));
  await writeFile(join(distDir, "openapi.json"), JSON.stringify(openApiSpec, null, 2));
  console.log("[capstan] Generated dist/agent-manifest.json");
  console.log("[capstan] Generated dist/openapi.json");

  // Step 5: Copy public/ assets to dist/public/ (if the directory exists)
  const publicDir = join(cwd, "app", "public");
  try {
    await access(publicDir);
    await cp(publicDir, join(distDir, "public"), { recursive: true });
    console.log("[capstan] Copied app/public/ to dist/public/");
  } catch {
    // No public directory — skip.
  }

  // Step 6: Generate the production server entry file
  const serverEntry = `import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";

const cwd = process.cwd();
const distDir = resolve(cwd, "dist");

// Read the pre-built route manifest
const manifestPath = join(distDir, "_capstan_manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

const port = parseInt(process.env.CAPSTAN_PORT ?? process.env.PORT ?? "3000", 10);
const host = process.env.CAPSTAN_HOST ?? "0.0.0.0";
const MAX_BODY_SIZE = parseInt(process.env.CAPSTAN_MAX_BODY_SIZE ?? "1048576", 10);

async function main() {
  const app = new Hono();
  app.use("*", cors());

  // --- Auth middleware -------------------------------------------------------
  // Load config from the compiled capstan.config.js to obtain auth settings.
  // If auth config exists, create a real auth resolver via @zauso-ai/capstan-auth
  // so that session cookies and API keys are verified on every request.

  let resolveAuth = null;
  let appConfig = null;

  const configCandidates = [
    join(distDir, "capstan.config.js"),
    join(cwd, "capstan.config.js"),
  ];

  for (const candidate of configCandidates) {
    if (existsSync(candidate)) {
      try {
        const configUrl = pathToFileURL(candidate).href;
        const configMod = await import(configUrl);
        appConfig = configMod.default ?? configMod;
        break;
      } catch (err) {
        console.warn("[capstan] Failed to load config from " + candidate + ":", err?.message ?? err);
      }
    }
  }

  // Derive auth config: support both CapstanConfig shape (auth.session) and
  // the flat AuthConfig shape ({ session: { secret } }).
  const authCfg = appConfig?.auth ?? null;
  const authSessionConfig = authCfg?.session ?? null;

  if (authSessionConfig && authSessionConfig.secret) {
    try {
      const authPkg = await import("@zauso-ai/capstan-auth");
      resolveAuth = authPkg.createAuthMiddleware(
        {
          session: {
            secret: authSessionConfig.secret,
            maxAge: authSessionConfig.maxAge,
          },
          apiKeys: authCfg.apiKeys ?? undefined,
        },
        {
          findAgentByKeyPrefix: appConfig?.findAgentByKeyPrefix ?? undefined,
        },
      );
      console.log("[capstan] Auth middleware enabled (session + API key verification).");
    } catch (err) {
      console.warn("[capstan] @zauso-ai/capstan-auth not available. Auth middleware disabled.", err?.message ?? "");
    }
  } else {
    console.warn("[capstan] No auth config found. All requests will be treated as anonymous.");
  }

  // Hono middleware: resolve auth for every request and store on context.
  app.use("*", async (c, next) => {
    if (resolveAuth) {
      try {
        const authCtx = await resolveAuth(c.req.raw);
        c.set("capstanAuth", authCtx);
      } catch (err) {
        console.error("[capstan] Auth resolution error:", err?.message ?? err);
        c.set("capstanAuth", { isAuthenticated: false, type: "anonymous", permissions: [] });
      }
    }
    await next();
  });

  // Helper: build a CapstanContext from Hono context, using resolved auth.
  function buildCtx(c) {
    const authFromMiddleware = c.get("capstanAuth");
    return {
      auth: authFromMiddleware ?? { isAuthenticated: false, type: "anonymous", permissions: [] },
      request: c.req.raw,
      env: process.env,
      honoCtx: c,
    };
  }

  // --- Policy loading --------------------------------------------------------
  // Load user-defined policies from dist/app/policies/index.js (if present).
  // This mirrors enforcePolicies from @zauso-ai/capstan-core so that custom
  // policies (beyond "requireAuth") are enforced in production.

  const policyRegistry = new Map();
  let enforcePoliciesFn = null;

  try {
    const corePkg = await import("@zauso-ai/capstan-core");
    if (typeof corePkg.enforcePolicies === "function") {
      enforcePoliciesFn = corePkg.enforcePolicies;
    }
  } catch {
    // @zauso-ai/capstan-core not available.
  }

  const policiesIndexPath = join(distDir, "app", "policies", "index.js");
  if (existsSync(policiesIndexPath)) {
    try {
      const policiesMod = await import(pathToFileURL(policiesIndexPath).href);
      const exports = policiesMod.default ?? policiesMod;
      if (exports && typeof exports === "object") {
        for (const [key, value] of Object.entries(exports)) {
          if (value && typeof value === "object" && "check" in value) {
            policyRegistry.set(value.key ?? key, value);
          }
        }
      }
      if (policyRegistry.size > 0) {
        console.log("[capstan] Loaded " + policyRegistry.size + " custom policies from app/policies/index.js");
      }
    } catch (err) {
      console.warn("[capstan] Failed to load policies from " + policiesIndexPath + ":", err?.message ?? err);
    }
  }

  // Built-in requireAuth policy used when no custom override exists.
  const builtinRequireAuth = {
    key: "requireAuth",
    title: "Require Authentication",
    effect: "deny",
    check: async ({ ctx }) => {
      if (ctx.auth.isAuthenticated) return { effect: "allow" };
      return { effect: "deny", reason: "Authentication required" };
    },
  };

  // Enforce all policies for a handler. Returns null if allowed, or a Response
  // if the request should be blocked/deferred.
  async function enforceHandlerPolicy(c, ctx, handler, input) {
    if (!handler.policy) return null;

    const policyName = handler.policy;
    const policyDef = policyRegistry.get(policyName)
      ?? (policyName === "requireAuth" ? builtinRequireAuth : null);

    if (!policyDef) {
      // Unknown policy in production: deny by default (fail closed).
      console.warn("[capstan] Unknown policy: " + policyName + ". Denying request (fail closed).");
      return c.json({ error: "Forbidden", reason: "Unknown policy: " + policyName }, 403);
    }

    let result;
    if (enforcePoliciesFn) {
      result = await enforcePoliciesFn([policyDef], ctx, input);
    } else {
      result = await policyDef.check({ ctx, input });
    }

    if (result.effect === "deny") {
      return c.json(
        { error: "Forbidden", reason: result.reason ?? "Policy denied", policy: policyName },
        403,
      );
    }

    if (result.effect === "approve") {
      try {
        const corePkg = await import("@zauso-ai/capstan-core");
        if (typeof corePkg.createApproval === "function") {
          const approval = corePkg.createApproval({
            method: c.req.method,
            path: c.req.path,
            input,
            policy: policyName,
            reason: result.reason ?? "This action requires approval",
          });
          return c.json(
            {
              status: "approval_required",
              approvalId: approval.id,
              reason: result.reason ?? "This action requires approval",
              pollUrl: "/capstan/approvals/" + approval.id,
            },
            202,
          );
        }
      } catch {}
      return c.json(
        { error: "Forbidden", reason: "Approval required but approval system unavailable", policy: policyName },
        403,
      );
    }

    return null;
  }

  // Serve static assets from dist/public/ if present
  try {
    app.use("/public/*", serveStatic({ root: distDir }));
  } catch {
    // serveStatic not available or dist/public/ does not exist
  }

  // Route metadata for framework endpoints
  const routeRegistry = [];

  let apiRouteCount = 0;
  let pageRouteCount = 0;

  // Register API routes from the manifest
  for (const route of manifest.routes) {
    if (route.type !== "api") continue;

    let handlers;
    try {
      const moduleUrl = pathToFileURL(route.filePath).href;
      handlers = await import(moduleUrl);
    } catch (err) {
      console.error("[capstan] Failed to load API route " + route.filePath + ":", err?.message ?? err);
      continue;
    }

    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
    for (const method of methods) {
      const handler = handlers[method];
      if (handler === undefined) continue;

      apiRouteCount++;

      const isApiDef = handler !== null && typeof handler === "object" && "handler" in handler && typeof handler.handler === "function";
      const meta = { method, path: route.urlPattern };
      if (isApiDef && handler.description) meta.description = handler.description;
      if (isApiDef && handler.capability) meta.capability = handler.capability;
      routeRegistry.push(meta);

      const honoMethod = method.toLowerCase();
      app[honoMethod](route.urlPattern, async (c) => {
        let input;
        try {
          if (method === "GET") {
            input = Object.fromEntries(new URL(c.req.url).searchParams);
          } else {
            const ct = c.req.header("content-type") ?? "";
            if (ct.includes("application/json")) {
              input = await c.req.json();
            } else {
              input = {};
            }
          }
        } catch {
          input = {};
        }

        const ctx = buildCtx(c);

        try {
          if (isApiDef) {
            // Policy enforcement using auth-resolved ctx and loaded policies.
            const policyResponse = await enforceHandlerPolicy(c, ctx, handler, input);
            if (policyResponse !== null) return policyResponse;

            const result = await handler.handler({ input, ctx });
            return c.json(result);
          }
          if (typeof handler === "function") {
            const result = await handler({ input, ctx });
            return c.json(result);
          }
          return c.json({ error: "Invalid handler export" }, 500);
        } catch (err) {
          if (err && typeof err === "object" && "issues" in err && Array.isArray(err.issues)) {
            return c.json({ error: "Validation Error", issues: err.issues }, 400);
          }
          console.error("[capstan] Request error:", err);
          const message = "Internal Server Error";
          return c.json({ error: message }, 500);
        }
      });
    }
  }

  // Register page routes from the manifest
  for (const route of manifest.routes) {
    if (route.type !== "page") continue;

    let pageModule;
    try {
      const moduleUrl = pathToFileURL(route.filePath).href;
      pageModule = await import(moduleUrl);
    } catch (err) {
      console.error("[capstan] Failed to load page " + route.filePath + ":", err?.message ?? err);
      continue;
    }

    if (!pageModule.default) continue;
    pageRouteCount++;

    app.get(route.urlPattern, async (c) => {
      const params = {};
      for (const name of route.params) {
        const value = c.req.param(name);
        if (value !== undefined) params[name] = value;
      }

      const ctx = buildCtx(c);

      let loaderData = null;
      if (typeof pageModule.loader === "function") {
        try {
          loaderData = await pageModule.loader({
            params,
            request: c.req.raw,
            ctx: { auth: ctx.auth },
            fetch: { get: async () => null, post: async () => null, put: async () => null, delete: async () => null },
          });
        } catch (err) {
          console.error("[capstan] Loader error in " + route.filePath + ":", err?.message ?? err);
        }
      }

      // Attempt SSR via @zauso-ai/capstan-react
      try {
        const reactPkg = await import("@zauso-ai/capstan-react");
        const result = await reactPkg.renderPage({
          pageModule: { default: pageModule.default, loader: pageModule.loader },
          layouts: [],
          params,
          request: c.req.raw,
          loaderArgs: {
            params,
            request: c.req.raw,
            ctx: { auth: ctx.auth },
            fetch: { get: async () => null, post: async () => null, put: async () => null, delete: async () => null },
          },
        });
        return c.html(result.html, result.statusCode);
      } catch {
        // Fallback minimal HTML
        const html = \`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${appName.replace(/"/g, "&quot;")}</title></head>
<body>
  <div id="capstan-root"><p>Page: \${route.urlPattern}</p></div>
  <script>window.__CAPSTAN_DATA__ = \${JSON.stringify({ loaderData, params }).replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e')}</script>
</body>
</html>\`;
        return c.html(html);
      }
    });
  }

  // Read pre-built agent-manifest.json and openapi.json
  let agentManifestJson = null;
  let openApiJson = null;
  try { agentManifestJson = JSON.parse(readFileSync(join(distDir, "agent-manifest.json"), "utf-8")); } catch {}
  try { openApiJson = JSON.parse(readFileSync(join(distDir, "openapi.json"), "utf-8")); } catch {}

  // Framework endpoints
  app.get("/.well-known/capstan.json", (c) => {
    if (agentManifestJson) return c.json(agentManifestJson);
    return c.json({ error: "Agent manifest not found" }, 404);
  });
  app.get("/openapi.json", (c) => {
    if (openApiJson) return c.json(openApiJson);
    return c.json({ error: "OpenAPI spec not found" }, 404);
  });
  app.get("/health", (c) => {
    return c.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // Approval management endpoints (if @zauso-ai/capstan-core is available)
  try {
    const corePkg = await import("@zauso-ai/capstan-core");
    if (typeof corePkg.listApprovals === "function") {
      app.get("/capstan/approvals", (c) => {
        const status = new URL(c.req.url).searchParams.get("status") ?? undefined;
        const approvals = corePkg.listApprovals(status);
        return c.json({ approvals });
      });
      app.get("/capstan/approvals/:id", (c) => {
        const approval = corePkg.getApproval(c.req.param("id"));
        if (!approval) return c.json({ error: "Approval not found" }, 404);
        return c.json(approval);
      });
      app.post("/capstan/approvals/:id/resolve", async (c) => {
        let body;
        try { body = await c.req.json(); } catch { body = {}; }
        const decision = body.decision === "approved" ? "approved" : "denied";
        const approval = corePkg.resolveApproval(c.req.param("id"), decision, body.resolvedBy);
        if (!approval) return c.json({ error: "Approval not found" }, 404);
        return c.json(approval);
      });
    }
  } catch {
    // Approval endpoints not available.
  }

  // Start HTTP server
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://" + (req.headers.host ?? host + ":" + port));
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) { for (const v of value) headers.append(key, v); }
        else headers.set(key, value);
      }

      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      let body;
      if (hasBody) {
        body = await new Promise((resolve, reject) => {
          const chunks = [];
          let received = 0;
          req.on("data", (c) => {
            received += c.length;
            if (received > MAX_BODY_SIZE) {
              req.destroy();
              const err = new Error("Request body exceeds maximum allowed size of " + MAX_BODY_SIZE + " bytes");
              err.statusCode = 413;
              reject(err);
              return;
            }
            chunks.push(c);
          });
          req.on("error", reject);
          req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8");
            resolve(raw.length > 0 ? raw : undefined);
          });
        });
      }

      const init = { method: req.method ?? "GET", headers };
      if (body !== undefined) init.body = body;

      const request = new Request(url.toString(), init);
      const response = await app.fetch(request);

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      const responseBody = await response.text();
      res.end(responseBody);
    } catch (err) {
      if (err && err.statusCode === 413) {
        if (!res.headersSent) res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload Too Large" }));
        return;
      }
      console.error("[capstan] Unhandled request error:", err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  });

  server.listen(port, host, () => {
    console.log("");
    console.log("  Capstan production server running");
    console.log("  Local:  http://" + (host === "0.0.0.0" ? "localhost" : host) + ":" + port);
    console.log("  Routes: " + (apiRouteCount + pageRouteCount) + " total (" + apiRouteCount + " API, " + pageRouteCount + " pages)");
    if (resolveAuth) console.log("  Auth:   enabled");
    else console.log("  Auth:   disabled (no auth config)");
    if (policyRegistry.size > 0) console.log("  Policies: " + policyRegistry.size + " custom policies loaded");
    console.log("");
  });
}

main().catch((err) => {
  console.error("[capstan] Fatal error starting production server:", err);
  process.exit(1);
});
`;

  await writeFile(join(distDir, "_capstan_server.js"), serverEntry);
  console.log("[capstan] Generated dist/_capstan_server.js");
  console.log("[capstan] Build complete.");
}

async function runStart(args: string[]): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { access } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const cwd = process.cwd();
  const serverEntry = join(cwd, "dist", "_capstan_server.js");

  // Verify the production build exists
  try {
    await access(serverEntry);
  } catch {
    console.error("[capstan] dist/_capstan_server.js not found.");
    console.error("[capstan] Run `capstan build` first to compile the project.");
    process.exitCode = 1;
    return;
  }

  const port = readFlagValue(args, "--port") ?? "3000";
  const host = readFlagValue(args, "--host") ?? "0.0.0.0";

  const child = spawn(
    process.execPath,
    [serverEntry],
    {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        CAPSTAN_PORT: port,
        CAPSTAN_HOST: host,
      },
    },
  );

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  // Forward SIGINT / SIGTERM to child
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}

// ---------------------------------------------------------------------------
// Database commands
// ---------------------------------------------------------------------------

async function runDbMigrate(args: string[]): Promise<void> {
  const name = readFlagValue(args, "--name");
  if (!name) {
    console.error("Usage: capstan db:migrate --name <migration-name>");
    process.exitCode = 1;
    return;
  }

  const { mkdir, readdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { generateMigration } = await import("@zauso-ai/capstan-db");

  const migrationsDir = join(process.cwd(), "app", "migrations");
  await mkdir(migrationsDir, { recursive: true });

  // Collect existing model definitions from app/models/ if present
  const modelsDir = join(process.cwd(), "app", "models");
  let toModels: Array<{ name: string; fields: Record<string, unknown>; indexes: unknown[] }> = [];
  try {
    const modelFiles = await readdir(modelsDir);
    for (const file of modelFiles) {
      if (file.endsWith(".ts") || file.endsWith(".js")) {
        const moduleUrl = pathToFileURL(join(modelsDir, file)).href;
        const mod = (await import(moduleUrl)) as Record<string, unknown>;
        // Look for exported model definitions
        for (const value of Object.values(mod)) {
          if (
            value &&
            typeof value === "object" &&
            "name" in value &&
            "fields" in value
          ) {
            toModels.push(value as typeof toModels[number]);
          }
        }
      }
    }
  } catch {
    // No models directory — generate an empty migration.
  }

  const statements = generateMigration([], toModels as never[]);
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const filename = `${timestamp}_${name}.sql`;
  const content = statements.length > 0
    ? statements.join(";\n") + ";\n"
    : "-- empty migration\n";

  await writeFile(join(migrationsDir, filename), content);
  console.log(`Created migration: app/migrations/${filename}`);
}

async function loadDbConfig(): Promise<{ provider: "sqlite" | "postgres" | "mysql"; url: string }> {
  let provider: "sqlite" | "postgres" | "mysql" = "sqlite";
  let url: string = join(process.cwd(), "app", "data", "app.db");

  const configPath = await resolveConfig();
  if (configPath) {
    try {
      const configUrl = pathToFileURL(configPath).href;
      const configMod = (await import(configUrl)) as {
        default?: { database?: { provider?: string; url?: string } };
      };
      if (configMod.default?.database?.provider) {
        provider = configMod.default.database.provider as typeof provider;
      }
      if (configMod.default?.database?.url) {
        url = configMod.default.database.url;
      }
    } catch {
      // Config load failed — use defaults.
    }
  }

  return { provider, url };
}

async function runDbPush(): Promise<void> {
  const { readdir, readFile: readMigrationFile, mkdir: mkdirFs } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const { createDatabase, applyTrackedMigrations } = await import("@zauso-ai/capstan-db");

  const migrationsDir = join(process.cwd(), "app", "migrations");
  let files: string[];
  try {
    files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    console.log("No migrations directory found at app/migrations/.");
    return;
  }

  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  const { provider, url } = await loadDbConfig();

  // Ensure directory exists for SQLite file-based databases
  if (provider === "sqlite" && url !== ":memory:") {
    await mkdirFs(dirname(url), { recursive: true });
  }

  const dbInstance = createDatabase({ provider, url });
  // Access the underlying driver client from the Drizzle instance
  const client = (dbInstance.db as { $client: unknown }).$client as {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      all: (...params: unknown[]) => unknown[];
      run: (...params: unknown[]) => unknown;
      get: (...params: unknown[]) => unknown;
    };
  };

  // Load all migration file contents
  const migrations: Array<{ name: string; sql: string }> = [];
  for (const file of files) {
    const sql = await readMigrationFile(join(migrationsDir, file), "utf8");
    migrations.push({ name: file, sql });
  }

  const executed = applyTrackedMigrations(client, migrations, provider);

  if (executed.length === 0) {
    console.log("No pending migrations. Database is up to date.");
  } else {
    for (const name of executed) {
      console.log(`Applied: ${name}`);
    }
    console.log(`\n${executed.length} migration(s) applied.`);
  }
}

async function runDbStatus(): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const { createDatabase, getMigrationStatus } = await import("@zauso-ai/capstan-db");

  const migrationsDir = join(process.cwd(), "app", "migrations");
  let files: string[];
  try {
    files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    console.log("No migrations directory found at app/migrations/.");
    return;
  }

  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  const { provider, url } = await loadDbConfig();

  let status: { applied: Array<{ name: string; appliedAt: string }>; pending: string[] };
  try {
    const dbInstance = createDatabase({ provider, url });
    const client = (dbInstance.db as { $client: unknown }).$client as {
      exec: (sql: string) => void;
      prepare: (sql: string) => {
        all: (...params: unknown[]) => unknown[];
        run: (...params: unknown[]) => unknown;
        get: (...params: unknown[]) => unknown;
      };
    };

    status = getMigrationStatus(client, files, provider);
  } catch {
    // Database may not exist yet — treat everything as pending
    status = {
      applied: [],
      pending: files,
    };
  }

  console.log(`Migration status (${provider}):\n`);

  if (status.applied.length > 0) {
    console.log(`Applied (${status.applied.length}):`);
    for (const m of status.applied) {
      console.log(`  ✓ ${m.name}  (${m.appliedAt})`);
    }
  }

  if (status.pending.length > 0) {
    if (status.applied.length > 0) console.log("");
    console.log(`Pending (${status.pending.length}):`);
    for (const name of status.pending) {
      console.log(`  • ${name}`);
    }
  }

  if (status.applied.length > 0 && status.pending.length === 0) {
    console.log("\nDatabase is up to date.");
  }
}

// ---------------------------------------------------------------------------
// Agent / MCP commands
// ---------------------------------------------------------------------------

async function runMcp(): Promise<void> {
  const { createMcpServer, serveMcpStdio } = await import("@zauso-ai/capstan-agent");
  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const { join } = await import("node:path");

  let appName = "capstan-app";
  let appDescription: string | undefined;
  try {
    const configPath = await resolveConfig();
    if (configPath) {
      const configUrl = pathToFileURL(configPath).href;
      const mod = (await import(configUrl)) as {
        default?: { name?: string; description?: string };
      };
      if (mod.default?.name) appName = mod.default.name;
      if (mod.default?.description) appDescription = mod.default.description;
    }
  } catch {
    // Config is optional.
  }

  const routesDir = join(process.cwd(), "app", "routes");
  const manifest = await scanRoutes(routesDir);
  const registryEntries = manifest.routes
    .filter((r) => r.type === "api")
    .flatMap((r) => {
      const methods = r.methods && r.methods.length > 0 ? r.methods : ["GET"];
      return methods.map((m) => ({
        method: m,
        path: r.urlPattern,
      }));
    });

  // Build an executeRoute callback that loads handlers from disk and invokes
  // them directly, so MCP tool calls actually run the real route logic.
  const { loadApiHandlers } = await import("@zauso-ai/capstan-dev");

  const executeRoute = async (
    method: string,
    urlPath: string,
    input: unknown,
  ): Promise<unknown> => {
    try {
      // Find the matching route file from the manifest.
      const matchingRoutes = manifest.routes.filter(
        (r) => r.type === "api" && r.urlPattern === urlPath,
      );
      if (matchingRoutes.length === 0) {
        return { error: `No route found for ${method} ${urlPath}` };
      }

      const route = matchingRoutes[0]!;
      const handlers = await loadApiHandlers(route.filePath);
      const handler = handlers[method as keyof typeof handlers];

      if (!handler || typeof handler !== "object" || !("handler" in handler)) {
        return { error: `No ${method} handler found at ${urlPath}` };
      }

      const apiDef = handler as {
        handler: (args: { input: unknown; ctx: unknown }) => Promise<unknown>;
      };
      const result = await apiDef.handler({
        input: input ?? {},
        ctx: {
          auth: {
            isAuthenticated: false,
            type: "anonymous" as const,
            permissions: [],
          },
          request: new Request(`http://localhost${urlPath}`),
          env: process.env,
          honoCtx: {},
        },
      });
      return result;
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Route execution failed",
      };
    }
  };

  const agentConfig = {
    name: appName,
    ...(appDescription ? { description: appDescription } : {}),
  };
  const { server } = createMcpServer(
    agentConfig,
    registryEntries,
    executeRoute,
  );

  await serveMcpStdio(server);
}

async function runAgentManifest(): Promise<void> {
  const { generateAgentManifest } = await import("@zauso-ai/capstan-agent");
  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const { join } = await import("node:path");

  let appName = "capstan-app";
  let appDescription: string | undefined;
  try {
    const configPath = await resolveConfig();
    if (configPath) {
      const configUrl = pathToFileURL(configPath).href;
      const mod = (await import(configUrl)) as {
        default?: { name?: string; description?: string };
      };
      if (mod.default?.name) appName = mod.default.name;
      if (mod.default?.description) appDescription = mod.default.description;
    }
  } catch {
    // Config is optional.
  }

  const routesDir = join(process.cwd(), "app", "routes");
  const manifest = await scanRoutes(routesDir);
  const registryEntries = manifest.routes
    .filter((r) => r.type === "api")
    .flatMap((r) => {
      const methods = r.methods && r.methods.length > 0 ? r.methods : ["GET"];
      return methods.map((m) => ({
        method: m,
        path: r.urlPattern,
      }));
    });

  const agentConfig = { name: appName, ...(appDescription ? { description: appDescription } : {}) };
  const agentManifest = generateAgentManifest(agentConfig, registryEntries);
  console.log(JSON.stringify(agentManifest, null, 2));
}

async function runAgentOpenapi(): Promise<void> {
  const { generateOpenApiSpec } = await import("@zauso-ai/capstan-agent");
  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const { join } = await import("node:path");

  let appName = "capstan-app";
  let appDescription: string | undefined;
  try {
    const configPath = await resolveConfig();
    if (configPath) {
      const configUrl = pathToFileURL(configPath).href;
      const mod = (await import(configUrl)) as {
        default?: { name?: string; description?: string };
      };
      if (mod.default?.name) appName = mod.default.name;
      if (mod.default?.description) appDescription = mod.default.description;
    }
  } catch {
    // Config is optional.
  }

  const routesDir = join(process.cwd(), "app", "routes");
  const manifest = await scanRoutes(routesDir);
  const registryEntries = manifest.routes
    .filter((r) => r.type === "api")
    .flatMap((r) => {
      const methods = r.methods && r.methods.length > 0 ? r.methods : ["GET"];
      return methods.map((m) => ({
        method: m,
        path: r.urlPattern,
      }));
    });

  const agentConfig = { name: appName, ...(appDescription ? { description: appDescription } : {}) };
  const spec = generateOpenApiSpec(agentConfig, registryEntries);
  console.log(JSON.stringify(spec, null, 2));
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

async function resolveConfig(): Promise<string | null> {
  const { access } = await import("node:fs/promises");
  const candidates = [
    resolve(process.cwd(), "capstan.config.ts"),
    resolve(process.cwd(), "capstan.config.js"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Existing helpers
// ---------------------------------------------------------------------------

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

async function runHarnessMutation(
  args: string[],
  mode: "pause" | "resume" | "request-approval" | "approve" | "request-input" | "cancel" | "retry"
): Promise<void> {
  const appDir = args[0];
  const runId = args[1];
  const asJson = args.includes("--json");
  const note = readFlagValue(args, "--note");

  if (!appDir || !runId) {
    console.error(
      `Usage: capstan harness:${mode} <generated-app-dir> <run-id> [--json] [--note <text>]`
    );
    process.exitCode = 1;
    return;
  }

  const harness = await requireLegacy<typeof import("@zauso-ai/capstan-harness")>("@zauso-ai/capstan-harness");

  const root = resolve(process.cwd(), appDir);
  const run =
    mode === "pause"
      ? await harness.pauseHarnessRun(root, runId, { ...(note ? { note } : {}) })
      : mode === "resume"
        ? await harness.resumeHarnessRun(root, runId, { ...(note ? { note } : {}) })
        : mode === "request-approval"
          ? await harness.requestHarnessApproval(root, runId, { ...(note ? { note } : {}) })
        : mode === "approve"
          ? await harness.approveHarnessRun(root, runId, { ...(note ? { note } : {}) })
          : mode === "request-input"
            ? await harness.requestHarnessInput(root, runId, { ...(note ? { note } : {}) })
            : mode === "cancel"
              ? await harness.cancelHarnessRun(root, runId, { ...(note ? { note } : {}) })
            : await harness.retryHarnessRun(root, runId, { ...(note ? { note } : {}) });

  if (asJson) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    process.stdout.write(harness.renderHarnessRunText(run));
  }
}

async function loadJsonFile(target: string): Promise<unknown> {
  const source = await readFile(resolve(process.cwd(), target), "utf8");
  return JSON.parse(source) as unknown;
}

function ensureRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }

  return value as Record<string, unknown>;
}

async function loadGraph(
  target: string,
  options: {
    packRegistryPath?: string;
  } = {}
): Promise<AppGraph> {
  const resolved = resolve(process.cwd(), target);
  const externalPackDefinitions = await loadExternalPackDefinitions(options.packRegistryPath);

  if (resolved.endsWith(".json")) {
    const source = await readFile(resolved, "utf8");
    return applyGraphWithPackDefinitions(JSON.parse(source) as AppGraph, externalPackDefinitions);
  }

  const moduleUrl = pathToFileURL(resolved).href;
  const loaded = (await import(moduleUrl)) as {
    default?: AppGraph;
    appGraph?: AppGraph;
    packRegistry?: GraphPackDefinition[] | { packs?: GraphPackDefinition[] };
    packs?: GraphPackDefinition[];
  };

  const graph = loaded.default ?? loaded.appGraph;
  if (!graph) {
    throw new Error(
      `Graph module "${target}" must export either a default AppGraph or a named "appGraph" export.`
    );
  }

  const modulePackDefinitions = normalizePackRegistryExport(
    loaded.packRegistry ?? loaded.packs
  );

  return applyGraphWithPackDefinitions(
    graph,
    mergeExtraPackDefinitions(modulePackDefinitions, externalPackDefinitions)
  );
}

async function loadBrief(
  target: string
): Promise<{
  brief: CapstanBrief;
  packDefinitions: GraphPackDefinition[];
}> {
  const resolved = resolve(process.cwd(), target);

  if (resolved.endsWith(".json")) {
    const source = await readFile(resolved, "utf8");
    return {
      brief: JSON.parse(source) as CapstanBrief,
      packDefinitions: []
    };
  }

  const moduleUrl = pathToFileURL(resolved).href;
  const loaded = (await import(moduleUrl)) as {
    default?: CapstanBrief;
    brief?: CapstanBrief;
    capstanBrief?: CapstanBrief;
    packRegistry?: GraphPackDefinition[] | { packs?: GraphPackDefinition[] };
    packs?: GraphPackDefinition[];
  };

  const brief = loaded.default ?? loaded.brief ?? loaded.capstanBrief;

  if (!brief) {
    throw new Error(
      `Brief module "${target}" must export either a default CapstanBrief or a named "brief" export.`
    );
  }

  return {
    brief,
    packDefinitions: normalizePackRegistryExport(loaded.packRegistry ?? loaded.packs)
  };
}

async function compileBriefWithPackDefinitions(
  brief: CapstanBrief,
  options: {
    packDefinitions?: readonly GraphPackDefinition[];
    packRegistryPath?: string;
  } = {}
): Promise<AppGraph> {
  const externalPackDefinitions = await loadExternalPackDefinitions(options.packRegistryPath);
  const packDefinitions = mergeExtraPackDefinitions(
    options.packDefinitions ?? [],
    externalPackDefinitions
  );
  const { compileCapstanBrief } = await requireLegacy<typeof import("@zauso-ai/capstan-brief")>("@zauso-ai/capstan-brief");

  const compiled = compileCapstanBrief(brief, {
    packDefinitions
  });

  return applyGraphWithPackDefinitions(compiled, packDefinitions);
}

async function loadExternalPackDefinitions(
  target: string | undefined
): Promise<GraphPackDefinition[]> {
  if (!target) {
    return [];
  }

  const resolved = resolve(process.cwd(), target);
  const moduleUrl = pathToFileURL(resolved).href;
  const loaded = (await import(moduleUrl)) as {
    default?: GraphPackDefinition[] | { packs?: GraphPackDefinition[] };
    packRegistry?: GraphPackDefinition[] | { packs?: GraphPackDefinition[] };
    packs?: GraphPackDefinition[];
  };

  return normalizePackRegistryExport(loaded.packRegistry ?? loaded.packs ?? loaded.default);
}

function normalizePackRegistryExport(
  value: GraphPackDefinition[] | { packs?: GraphPackDefinition[] } | undefined
): GraphPackDefinition[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return [...value];
  }

  if (Array.isArray(value.packs)) {
    return [...value.packs];
  }

  throw new Error("Pack registry modules must export an array of pack definitions.");
}

async function applyGraphWithPackDefinitions(
  graph: AppGraph,
  extraPackDefinitions: readonly GraphPackDefinition[]
): Promise<AppGraph> {
  const {
    applyAppGraphPacks,
    applyBuiltinAppGraphPacks,
    listBuiltinGraphPacks,
  } = await requireLegacy<typeof import("@zauso-ai/capstan-packs-core")>("@zauso-ai/capstan-packs-core");

  if (!extraPackDefinitions.length) {
    return applyBuiltinAppGraphPacks(graph);
  }

  const builtinDefinitions = listBuiltinGraphPacks();
  const definitions = [...builtinDefinitions];
  const keys = new Set(definitions.map((definition) => definition.key));

  for (const definition of extraPackDefinitions) {
    if (keys.has(definition.key)) {
      throw new Error(`Duplicate pack definition "${definition.key}" in external pack registry.`);
    }

    keys.add(definition.key);
    definitions.push(definition);
  }

  return applyAppGraphPacks(graph, definitions);
}

function mergeExtraPackDefinitions(
  ...groups: ReadonlyArray<readonly GraphPackDefinition[]>
): GraphPackDefinition[] {
  const merged: GraphPackDefinition[] = [];
  const keys = new Set<string>();

  for (const group of groups) {
    for (const definition of group) {
      if (keys.has(definition.key)) {
        throw new Error(`Duplicate pack definition "${definition.key}" in brief or graph pack registries.`);
      }

      keys.add(definition.key);
      merged.push(definition);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// capstan add
// ---------------------------------------------------------------------------

async function runAdd(args: string[]): Promise<void> {
  const subcommand = args[0];
  const name = args[1];

  if (!subcommand || !name) {
    console.error("Usage: capstan add <model|api|page|policy> <name>");
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case "model": {
      const filePath = join(process.cwd(), "app/models", `${name}.model.ts`);
      if (existsSync(filePath)) {
        console.error(`File already exists: app/models/${name}.model.ts`);
        process.exitCode = 1;
        return;
      }
      const pascalName = name.charAt(0).toUpperCase() + name.slice(1);
      const content = `import { defineModel, field } from "@zauso-ai/capstan-db";

export const ${pascalName} = defineModel("${name}", {
  fields: {
    id: field.id(),
    title: field.string({ required: true }),
    description: field.text(),
    createdAt: field.datetime({ default: "now" }),
    updatedAt: field.datetime({ updatedAt: true }),
  },
});
`;
      await mkdir(join(process.cwd(), "app/models"), { recursive: true });
      await writeFile(filePath, content, "utf-8");
      console.log(`\u2713 Created app/models/${name}.model.ts`);
      break;
    }
    case "api": {
      const dirPath = join(process.cwd(), "app/routes", name);
      const filePath = join(dirPath, "index.api.ts");
      if (existsSync(filePath)) {
        console.error(`File already exists: app/routes/${name}/index.api.ts`);
        process.exitCode = 1;
        return;
      }
      const content = `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const meta = {
  resource: "${name}",
  description: "Manage ${name}",
};

export const GET = defineAPI({
  output: z.object({
    items: z.array(z.object({ id: z.string(), title: z.string() })),
  }),
  description: "List ${name}",
  capability: "read",
  resource: "${name}",
  async handler({ input, ctx }) {
    // TODO: Replace with real database query
    return { items: [] };
  },
});

export const POST = defineAPI({
  input: z.object({
    title: z.string().min(1),
  }),
  output: z.object({
    id: z.string(),
    title: z.string(),
  }),
  description: "Create a ${name}",
  capability: "write",
  resource: "${name}",
  policy: "requireAuth",
  async handler({ input, ctx }) {
    // TODO: Replace with real database insert
    return {
      id: crypto.randomUUID(),
      title: input.title,
    };
  },
});
`;
      await mkdir(dirPath, { recursive: true });
      await writeFile(filePath, content, "utf-8");
      console.log(`\u2713 Created app/routes/${name}/index.api.ts`);
      break;
    }
    case "page": {
      const dirPath = join(process.cwd(), "app/routes", name);
      const filePath = join(dirPath, "index.page.tsx");
      if (existsSync(filePath)) {
        console.error(`File already exists: app/routes/${name}/index.page.tsx`);
        process.exitCode = 1;
        return;
      }
      const titleName = name.charAt(0).toUpperCase() + name.slice(1);
      const content = `export default function ${titleName}Page() {
  return (
    <main>
      <h1>${titleName}</h1>
      <p>This is the ${name} page.</p>
    </main>
  );
}
`;
      await mkdir(dirPath, { recursive: true });
      await writeFile(filePath, content, "utf-8");
      console.log(`\u2713 Created app/routes/${name}/index.page.tsx`);
      break;
    }
    case "policy": {
      const policiesDir = join(process.cwd(), "app/policies");
      const policiesFile = join(policiesDir, "index.ts");
      const camelName = name.charAt(0).toLowerCase() + name.slice(1);
      const titleName = name.charAt(0).toUpperCase() + name.slice(1);
      const policySnippet = `
export const ${camelName} = definePolicy({
  key: "${camelName}",
  title: "${titleName}",
  effect: "deny",
  async check({ ctx }) {
    // TODO: Implement policy logic
    return { effect: "allow" };
  },
});
`;
      if (existsSync(policiesFile)) {
        // Append to existing policies file
        const existing = await readFile(policiesFile, "utf-8");
        await writeFile(policiesFile, existing + policySnippet, "utf-8");
        console.log(`\u2713 Appended policy "${camelName}" to app/policies/index.ts`);
      } else {
        // Create new policies file with import
        const content = `import { definePolicy } from "@zauso-ai/capstan-core";
${policySnippet}`;
        await mkdir(policiesDir, { recursive: true });
        await writeFile(policiesFile, content, "utf-8");
        console.log(`\u2713 Created app/policies/index.ts with policy "${camelName}"`);
      }
      break;
    }
    default:
      console.error(`Unknown add subcommand: ${subcommand}`);
      console.error("Usage: capstan add <model|api|page|policy> <name>");
      process.exitCode = 1;
  }
}

function printHelp(): void {
  console.log(`Capstan CLI

Commands:
  capstan dev [--port 3000] [--host localhost]
                             Start the development server with HMR
  capstan build              Build the project (tsc + route manifest + server entry)
  capstan start [--port 3000] [--host 0.0.0.0]
                             Start the production server from built output

  capstan add <model|api|page|policy> <name>
                             Scaffold a model, API route, page, or policy

  capstan db:migrate --name <name>
                             Generate a new migration file in app/migrations/
  capstan db:push            Apply pending migrations to the database
  capstan db:status          Show migration status

  capstan mcp                Start an MCP server on stdio transport
  capstan agent:manifest     Print the agent manifest JSON to stdout
  capstan agent:openapi      Print the OpenAPI spec JSON to stdout

  capstan brief:check <path> [--pack-registry <path>]
                             Validate a Capstan brief and its compiled App Graph
  capstan brief:inspect <path> [--pack-registry <path>]
                             Print brief summary plus compiled App Graph introspection
  capstan brief:graph <path> [--pack-registry <path>]
                             Compile a Capstan brief into an App Graph JSON document
  capstan brief:scaffold <brief> <dir> [--force] [--pack-registry <path>]
                             Generate a deterministic app skeleton directly from a Capstan brief
  capstan graph:check <path> [--pack-registry <path>]
                             Validate an App Graph from a JSON or ESM module
  capstan graph:scaffold <graph> <dir> [--force] [--pack-registry <path>]
                             Generate a deterministic app skeleton from an App Graph
  capstan graph:inspect <path> [--pack-registry <path>]
                             Print graph metadata, summary, validation, and normalized output
  capstan graph:diff <before> <after> [--pack-registry <path>]
                             Print a machine-readable diff between two App Graphs
  capstan verify [app-dir] [--json]
                             Verify a Capstan app (auto-detects runtime vs generated)
  capstan release:plan <app-dir> [--json] [--env <path>] [--migrations <path>]
                             Generate a machine-readable preview/release plan
  capstan release:run <app-dir> <preview|release> [--json] [--env <path>] [--migrations <path>]
                             Execute a framework-managed preview/release run and emit a trace
  capstan release:history <app-dir> [--json]
                             List persisted preview/release/rollback traces for an app
  capstan release:rollback <app-dir> [--json] [--trace <path>]
                             Execute a framework-managed rollback from a persisted release run
  capstan harness:start <app-dir> <task-key> [--json] [--input <path>] [--note <text>]
                             Start a durable harness run for a generated task
  capstan harness:get <app-dir> <run-id> [--json]
                             Read a persisted harness run
  capstan harness:list <app-dir> [--json] [--task <task-key>]
                             List persisted harness runs
  capstan harness:pause <app-dir> <run-id> [--json] [--note <text>]
                             Pause a running harness run
  capstan harness:resume <app-dir> <run-id> [--json] [--note <text>]
                             Resume a paused harness run
  capstan harness:request-approval <app-dir> <run-id> [--json] [--note <text>]
                             Move a harness run into approval_required
  capstan harness:approve <app-dir> <run-id> [--json] [--note <text>]
                             Approve a waiting harness run and resume execution
  capstan harness:request-input <app-dir> <run-id> [--json] [--note <text>]
                             Move a harness run into input_required
  capstan harness:provide-input <app-dir> <run-id> --input <path> [--json] [--note <text>]
                             Attach structured human input and resume execution
  capstan harness:complete <app-dir> <run-id> [--json] [--output <path>] [--note <text>]
                             Complete a harness run with structured output
  capstan harness:fail <app-dir> <run-id> --message <text> [--json]
                             Fail a harness run with an error message
  capstan harness:cancel <app-dir> <run-id> [--json] [--note <text>]
                             Cancel a harness run while preserving durable history
  capstan harness:retry <app-dir> <run-id> [--json] [--note <text>]
                             Retry a failed or cancelled harness run
  capstan harness:events <app-dir> [--json] [--run <run-id>]
                             List persisted harness lifecycle events
  capstan harness:replay <app-dir> <run-id> [--json]
                             Rebuild run state from persisted harness events
  capstan harness:compact <app-dir> <run-id> [--json] [--tail <count>]
                             Persist a compact runtime summary for a harness run
  capstan harness:summary <app-dir> <run-id> [--json] [--refresh] [--tail <count>]
                             Read or refresh a persisted compact summary for a harness run
  capstan harness:summaries <app-dir> [--json]
                             List persisted harness summaries
  capstan harness:memory <app-dir> <run-id> [--json] [--refresh] [--tail <count>]
                             Read or refresh a bounded runtime memory artifact for a harness run
  capstan harness:memories <app-dir> [--json]
                             List persisted runtime memory artifacts
  capstan help                Show this help message
`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

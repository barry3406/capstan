#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppGraph } from "@capstan/app-graph";
import { diffAppGraphs, introspectAppGraph, validateAppGraph } from "@capstan/app-graph";
import type { CapstanBrief } from "@capstan/brief";
import {
  compileCapstanBrief,
  summarizeCapstanBrief,
  validateCapstanBrief
} from "@capstan/brief";
import {
  applyAppGraphPacks,
  applyBuiltinAppGraphPacks,
  listBuiltinGraphPacks
} from "@capstan/packs-core";
import type { GraphPackDefinition } from "@capstan/packs-core";
import { scaffoldAppGraph } from "@capstan/compiler";
import { renderVerifyReportText, verifyGeneratedApp } from "@capstan/feedback";
import {
  approveHarnessRun,
  cancelHarnessRun,
  compactHarnessRun,
  completeHarnessRun,
  createHarnessMemory,
  createHarnessRun,
  failHarnessRun,
  getHarnessRun,
  getHarnessMemory,
  getHarnessSummary,
  listHarnessEvents,
  listHarnessMemories,
  listHarnessRuns,
  listHarnessSummaries,
  renderHarnessMemoriesText,
  renderHarnessMemoryText,
  renderHarnessEventsText,
  renderHarnessCompactionText,
  renderHarnessReplayText,
  renderHarnessRunText,
  renderHarnessRunsText,
  renderHarnessSummariesText,
  replayHarnessRun,
  provideHarnessInput,
  requestHarnessApproval,
  requestHarnessInput,
  resumeHarnessRun,
  retryHarnessRun,
  pauseHarnessRun
} from "@capstan/harness";
import {
  createReleasePlan,
  createReleaseRun,
  createRollbackRun,
  listReleaseRuns,
  renderReleaseHistoryText,
  renderReleasePlanText,
  renderRollbackRunText,
  renderReleaseRunText
} from "@capstan/release";

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
      await runVerify(args[0], args.includes("--json"));
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

  const before = await loadGraph(beforePath, {
    ...(packRegistryPath ? { packRegistryPath } : {})
  });
  const after = await loadGraph(afterPath, {
    ...(packRegistryPath ? { packRegistryPath } : {})
  });
  console.log(JSON.stringify(diffAppGraphs(before, after), null, 2));
}

async function runVerify(target: string | undefined, asJson: boolean): Promise<void> {
  if (!target) {
    console.error("Usage: capstan verify <generated-app-dir> [--json]");
    process.exitCode = 1;
    return;
  }

  const report = await verifyGeneratedApp(resolve(process.cwd(), target));

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderVerifyReportText(report));
  }

  if (report.status === "failed") {
    process.exitCode = 1;
  }
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
  const { createDevServer } = await import("@capstan/dev");
  const port = parseInt(readFlagValue(args, "--port") ?? "3000", 10);
  const host = readFlagValue(args, "--host") ?? "localhost";

  // Try to load capstan.config.ts / capstan.config.js for app metadata
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
    // Config file is optional — continue without it.
  }

  const server = await createDevServer({
    rootDir: process.cwd(),
    port,
    host,
    appName,
    ...(appDescription ? { appDescription } : {}),
  });
  await server.start();
}

async function runBuild(): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);

  console.log("Building project...");
  await exec("npx", ["tsc", "-p", "tsconfig.json"], { cwd: process.cwd() });
  console.log("TypeScript compilation complete.");

  // Generate agent-manifest.json and openapi.json into dist/
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { scanRoutes } = await import("@capstan/router");
  const { generateAgentManifest, generateOpenApiSpec } = await import("@capstan/agent");

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
  const openApiSpec = generateOpenApiSpec(agentConfig, registryEntries);

  const distDir = join(process.cwd(), "dist");
  await mkdir(distDir, { recursive: true });
  await writeFile(join(distDir, "agent-manifest.json"), JSON.stringify(agentManifest, null, 2));
  await writeFile(join(distDir, "openapi.json"), JSON.stringify(openApiSpec, null, 2));

  console.log("Generated dist/agent-manifest.json");
  console.log("Generated dist/openapi.json");
  console.log("Build complete.");
}

async function runStart(args: string[]): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const port = readFlagValue(args, "--port") ?? "3000";

  console.log(`Starting production server on port ${port}...`);
  await exec("node", ["dist/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: port },
  });
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
  const { generateMigration } = await import("@capstan/db");

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

async function runDbPush(): Promise<void> {
  const { readdir, readFile: readMigrationFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { createDatabase } = await import("@capstan/db");

  const migrationsDir = join(process.cwd(), "app", "migrations");
  let files: string[];
  try {
    files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    console.log("No migrations directory found at app/migrations/.");
    return;
  }

  if (files.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  const db = createDatabase({ provider: "sqlite", url: join(process.cwd(), "app", "data", "app.db") });

  for (const file of files) {
    const sql = await readMigrationFile(join(migrationsDir, file), "utf8");
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));
    if (statements.length > 0) {
      const client = (db as unknown as { $client: { exec: (sql: string) => void } }).$client;
      for (const stmt of statements) {
        client.exec(stmt);
      }
    }
    console.log(`Applied: ${file}`);
  }

  console.log("All migrations applied.");
}

async function runDbStatus(): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");

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

  console.log(`Found ${files.length} migration(s):`);
  for (const file of files) {
    console.log(`  ${file}`);
  }
}

// ---------------------------------------------------------------------------
// Agent / MCP commands
// ---------------------------------------------------------------------------

async function runMcp(): Promise<void> {
  const { createMcpServer, serveMcpStdio } = await import("@capstan/agent");
  const { scanRoutes } = await import("@capstan/router");
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
  const { server } = createMcpServer(agentConfig, registryEntries, async (_method, _path, _args) => {
    return { status: 501, body: "MCP route execution not wired up in CLI mode." };
  });

  await serveMcpStdio(server);
}

async function runAgentManifest(): Promise<void> {
  const { generateAgentManifest } = await import("@capstan/agent");
  const { scanRoutes } = await import("@capstan/router");
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
  const { generateOpenApiSpec } = await import("@capstan/agent");
  const { scanRoutes } = await import("@capstan/router");
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

  const root = resolve(process.cwd(), appDir);
  const run =
    mode === "pause"
      ? await pauseHarnessRun(root, runId, { ...(note ? { note } : {}) })
      : mode === "resume"
        ? await resumeHarnessRun(root, runId, { ...(note ? { note } : {}) })
        : mode === "request-approval"
          ? await requestHarnessApproval(root, runId, { ...(note ? { note } : {}) })
        : mode === "approve"
          ? await approveHarnessRun(root, runId, { ...(note ? { note } : {}) })
          : mode === "request-input"
            ? await requestHarnessInput(root, runId, { ...(note ? { note } : {}) })
            : mode === "cancel"
              ? await cancelHarnessRun(root, runId, { ...(note ? { note } : {}) })
            : await retryHarnessRun(root, runId, { ...(note ? { note } : {}) });

  if (asJson) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    process.stdout.write(renderHarnessRunText(run));
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

function applyGraphWithPackDefinitions(
  graph: AppGraph,
  extraPackDefinitions: readonly GraphPackDefinition[]
): AppGraph {
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

function printHelp(): void {
  console.log(`Capstan CLI

Commands:
  capstan dev [--port 3000] [--host localhost]
                             Start the development server with HMR
  capstan build              Build the project and generate agent manifests
  capstan start [--port 3000]
                             Start the production server from built output

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
  capstan verify <app-dir> [--json]
                             Verify a generated app and emit repair-oriented diagnostics
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

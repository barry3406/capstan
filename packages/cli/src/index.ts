#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pc from "picocolors";
import type { RouteManifest } from "@zauso-ai/capstan-router";
import {
  createDeployManifest,
  type DeployManifest,
  loadDeployManifest,
  resolveServerEntryPath,
} from "./deploy-manifest.js";
import {
  buildDeployManifestIntegrity,
  compareDeployManifestIntegrity,
  loadDeployManifestContract,
  type DeployContractDiagnostic,
} from "./deploy-integrity.js";
import {
  createDeploymentDoctorActions,
  type DeploymentDoctorAction,
} from "./deploy-doctor.js";
import {
  BUILD_TARGETS,
  DEPLOY_INIT_TARGETS,
  collectPortableRuntimeAssets,
  createPortableRouteManifest,
  createPortableRuntimeAssetsModuleSource,
  createPortableRuntimeManifestModuleSource,
  createPortableRuntimeModulesModuleSource,
  createProjectDeploymentFiles,
  createDeployTargetContract,
  createProjectRootDeployTargetContract,
  createProjectDockerfile,
  createProjectDockerIgnore,
  createProjectEnvExample,
  createStandaloneDeployManifest,
  createStandaloneDockerfile,
  createStandaloneDockerIgnore,
  createStandalonePlatformFiles,
  createStandalonePackageJson,
  getStandaloneOutputDir,
  getPortableRuntimeRootDir,
  readJsonArtifact,
  readProjectPackageJson,
  shouldEmitPortableRuntimeBundle,
  type BuildTarget,
} from "./deploy-targets.js";
import {
  runOpsEvents,
  runOpsHealth,
  runOpsIncidents,
  runOpsTail,
} from "./ops.js";

// ---------------------------------------------------------------------------
// Known commands for fuzzy matching
// ---------------------------------------------------------------------------

const KNOWN_COMMANDS = [
  "dev", "build", "start",
  "deploy:init",
  "add",
  "db:migrate", "db:push", "db:status",
  "verify",
  "ops:events", "ops:incidents", "ops:health", "ops:tail",
  "mcp",
  "agent:manifest", "agent:openapi",
  "harness:list", "harness:get", "harness:events", "harness:artifacts", "harness:checkpoint",
  "harness:approval", "harness:approvals", "harness:approve", "harness:deny",
  "harness:pause", "harness:cancel", "harness:replay", "harness:paths",
] as const;

/**
 * Compute Levenshtein edit distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= an; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= bn; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,       // deletion
        matrix[i]![j - 1]! + 1,       // insertion
        matrix[i - 1]![j - 1]! + cost // substitution
      );
    }
  }

  return matrix[an]![bn]!;
}

/**
 * Find the closest matching command using Levenshtein distance.
 * Returns the match only if it's within a reasonable edit distance.
 */
function findClosestCommand(input: string, commands: readonly string[] = KNOWN_COMMANDS): string | undefined {
  let bestMatch: string | undefined;
  let bestDistance = Infinity;

  for (const cmd of commands) {
    const dist = levenshtein(input, cmd);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = cmd;
    }
  }

  // Only suggest if the edit distance is at most 3 or the input is a prefix
  const maxAllowed = Math.max(2, Math.floor((bestMatch?.length ?? 0) / 2));
  if (bestDistance <= Math.min(3, maxAllowed)) {
    return bestMatch;
  }

  return undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "dev":
      await runDev(args);
      return;
    case "build":
      await runBuild(args);
      return;
    case "start":
      await runStart(args);
      return;
    case "deploy:init":
      await runDeployInit(args);
      return;
    case "verify":
      await runVerify(args, args.includes("--json"));
      return;
    case "ops:events":
      await runOpsEvents(args);
      return;
    case "ops:incidents":
      await runOpsIncidents(args);
      return;
    case "ops:health":
      await runOpsHealth(args);
      return;
    case "ops:tail":
      await runOpsTail(args);
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
    case "harness:list":
      await runHarnessList(args);
      return;
    case "harness:get":
      await runHarnessGet(args);
      return;
    case "harness:events":
      await runHarnessEvents(args);
      return;
    case "harness:artifacts":
      await runHarnessArtifacts(args);
      return;
    case "harness:checkpoint":
      await runHarnessCheckpoint(args);
      return;
    case "harness:approval":
      await runHarnessApproval(args);
      return;
    case "harness:approvals":
      await runHarnessApprovals(args);
      return;
    case "harness:approve":
      await runHarnessApprove(args);
      return;
    case "harness:deny":
      await runHarnessDeny(args);
      return;
    case "harness:pause":
      await runHarnessPause(args);
      return;
    case "harness:cancel":
      await runHarnessCancel(args);
      return;
    case "harness:replay":
      await runHarnessReplay(args);
      return;
    case "harness:paths":
      await runHarnessPaths(args);
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
    default: {
      console.error(pc.red(`Unknown command: "${command}"`));
      const suggestion = findClosestCommand(command);
      if (suggestion) {
        console.error(`\n  Did you mean ${pc.cyan(suggestion)}?\n`);
      } else {
        console.error(`\n  Run ${pc.cyan("capstan help")} to see available commands.\n`);
      }
      process.exitCode = 1;
    }
  }
}

async function runVerify(args: string[], asJson: boolean): Promise<void> {
  const deploymentMode = hasFlag(args, "--deployment");
  let pathArg = readFlagValue(args, "--path");
  if (!pathArg) {
    const positional: string[] = [];
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (arg === "--json" || arg === "--deployment") {
        continue;
      }
      if ((arg === "--target" || arg === "--path") && args[index + 1]) {
        index++;
        continue;
      }
      if (!arg.startsWith("--")) {
        positional.push(arg);
      }
    }
    pathArg = positional[0];
  }
  const appRoot = pathArg ? resolve(process.cwd(), pathArg) : process.cwd();

  if (!existsSync(join(appRoot, "app", "routes"))) {
    console.error(pc.red("Could not detect project type."));
    console.error(pc.dim("  - Ensure app/routes/ directory exists."));
    console.error(pc.dim(`  Looked in: ${appRoot}`));
    process.exitCode = 1;
    return;
  }

  if (deploymentMode) {
    const requestedTarget = readFlagValue(args, "--target");
    const report = await verifyDeployment({
      appRoot,
      ...(requestedTarget ? { requestedTarget } : {}),
    });

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stdout.write(renderDeploymentVerifyText(report));
    }

    if (report.status === "failed") {
      process.exitCode = 1;
    }
    return;
  }

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
}

interface DeploymentVerifyReport {
  status: "passed" | "failed";
  appRoot: string;
  target: BuildTarget;
  timestamp: string;
  diagnostics: DeployContractDiagnostic[];
  doctor: DeploymentDoctorAction[];
  summary: {
    errorCount: number;
    warningCount: number;
  };
}

function getDeployTargetContract(
  deployManifest: DeployManifest,
  target: BuildTarget,
): unknown {
  switch (target) {
    case "node-standalone":
      return deployManifest.targets?.nodeStandalone;
    case "docker":
      return deployManifest.targets?.docker;
    case "vercel-node":
      return deployManifest.targets?.vercelNode;
    case "vercel-edge":
      return deployManifest.targets?.vercelEdge;
    case "cloudflare":
      return deployManifest.targets?.cloudflare;
    case "fly":
      return deployManifest.targets?.fly;
  }
}

function createDeploymentReport(
  appRoot: string,
  target: BuildTarget,
  diagnostics: DeployContractDiagnostic[],
): DeploymentVerifyReport {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;

  return {
    status: errorCount > 0 ? "failed" : "passed",
    appRoot,
    target,
    timestamp: new Date().toISOString(),
    diagnostics,
    doctor: createDeploymentDoctorActions(target, diagnostics),
    summary: {
      errorCount,
      warningCount,
    },
  };
}

function renderDeploymentVerifyText(report: DeploymentVerifyReport): string {
  const lines = [
    "Capstan Deployment Verify",
    "",
    `  Target: ${report.target}`,
    "",
  ];

  if (report.diagnostics.length === 0) {
    lines.push("  ✓ No deployment issues detected.");
  }

  for (const diagnostic of report.diagnostics) {
    const marker =
      diagnostic.severity === "error"
        ? "\u2717"
        : diagnostic.severity === "warning"
          ? "!"
          : "-";
    lines.push(`  ${marker} ${diagnostic.message}`);
    if (diagnostic.hint) {
      lines.push(`    \u2192 ${diagnostic.hint}`);
    }
  }

  lines.push("");
  if (report.doctor.length > 0) {
    lines.push("Doctor");
    lines.push("");
    for (const action of report.doctor) {
      lines.push(`  - ${action.title}`);
      for (const step of action.steps) {
        lines.push(`    -> ${step}`);
      }
    }
    lines.push("");
  }

  lines.push(
    `  ${report.summary.errorCount} error${report.summary.errorCount !== 1 ? "s" : ""}, ${report.summary.warningCount} warning${report.summary.warningCount !== 1 ? "s" : ""}`,
  );
  lines.push("");

  return lines.join("\n");
}

async function resolveConfigAt(rootDir: string): Promise<string | null> {
  const { access } = await import("node:fs/promises");
  const candidates = [
    resolve(rootDir, "capstan.config.ts"),
    resolve(rootDir, "capstan.config.js"),
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

async function collectProjectSourceFiles(rootDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");

  async function walk(dir: string): Promise<string[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walk(fullPath));
        continue;
      }

      if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  const roots = [
    join(rootDir, "app"),
    join(rootDir, "dist", "app"),
  ];
  const files = new Set<string>();

  for (const candidate of roots) {
    for (const file of await walk(candidate)) {
      files.add(file);
    }
  }

  for (const configCandidate of [
    join(rootDir, "capstan.config.ts"),
    join(rootDir, "capstan.config.js"),
    join(rootDir, "dist", "capstan.config.js"),
  ]) {
    if (existsSync(configCandidate)) {
      files.add(configCandidate);
    }
  }

  return [...files];
}

async function detectNodeRuntimeImports(rootDir: string): Promise<string[]> {
  const offenders: string[] = [];
  const sourceFiles = await collectProjectSourceFiles(rootDir);

  for (const filePath of sourceFiles) {
    const raw = await readFile(filePath, "utf-8");
    if (
      /from\s+["']node:/.test(raw) ||
      /import\s*\(\s*["']node:/.test(raw) ||
      /require\(\s*["']node:/.test(raw)
    ) {
      offenders.push(relative(rootDir, filePath));
    }
  }

  return offenders;
}

async function verifyDeployment(options: {
  appRoot: string;
  requestedTarget?: string;
}): Promise<DeploymentVerifyReport> {
  const diagnostics: DeployContractDiagnostic[] = [];
  const manifestResult = await loadDeployManifestContract(options.appRoot);
  const deployManifest = manifestResult.manifest;

  if (!deployManifest) {
    diagnostics.push(...manifestResult.diagnostics);
    return createDeploymentReport(
      options.appRoot,
      options.requestedTarget && isBuildTarget(options.requestedTarget)
        ? options.requestedTarget
        : "node-standalone",
      diagnostics,
    );
  }

  if (options.requestedTarget && !isBuildTarget(options.requestedTarget)) {
    diagnostics.push({
      severity: "error",
      code: "unsupported_target",
      message: `Unsupported deployment target "${options.requestedTarget}".`,
      hint: `Valid targets: ${BUILD_TARGETS.join(", ")}`,
    });
    return createDeploymentReport(
      options.appRoot,
      deployManifest.build.target ?? "node-standalone",
      diagnostics,
    );
  }

  const target = options.requestedTarget && isBuildTarget(options.requestedTarget)
    ? options.requestedTarget
    : deployManifest.build.target ?? "node-standalone";

  if (deployManifest.build.target && deployManifest.build.target !== target) {
    diagnostics.push({
      severity: "error",
      code: "target_mismatch",
      message: `Build manifest target is ${deployManifest.build.target}, but verification is running against ${target}.`,
      hint: `Rebuild with \`capstan build --target ${deployManifest.build.target}\` or verify with the matching target.`,
    });
    return createDeploymentReport(options.appRoot, target, diagnostics);
  }

  if (!getDeployTargetContract(deployManifest, target)) {
    diagnostics.push({
      severity: "error",
      code: "missing_target_contract",
      message: `Build output does not contain a deployment contract for ${target}.`,
      hint: `Run \`capstan build --target ${target}\` to generate the correct deployment bundle.`,
    });
    return createDeploymentReport(options.appRoot, target, diagnostics);
  }

  diagnostics.push(...await compareDeployManifestIntegrity(options.appRoot, deployManifest));

  const configPath = await resolveConfigAt(options.appRoot);
  if (configPath) {
    try {
      const configModule = await import(pathToFileURL(configPath).href);
      const appConfig = configModule.default ?? configModule;
      const provider = appConfig?.database?.provider;
      const authEnabled = Boolean(appConfig?.auth?.session?.secret);

      if (provider === "sqlite") {
        if (target === "vercel-edge" || target === "cloudflare") {
          diagnostics.push({
            severity: "error",
            code: "sqlite_edge_unsupported",
            message: `SQLite is not a safe deployment backend for ${target}.`,
            hint: "Use a network database such as Postgres or switch this target back to node-standalone/docker.",
          });
        } else if (target === "vercel-node" || target === "fly") {
          diagnostics.push({
            severity: "warning",
            code: "sqlite_distribution_risk",
            message: `SQLite may break under ${target} because instances are ephemeral or multi-region.`,
            hint: "Prefer Postgres/MySQL for serverless or multi-region deployment targets.",
          });
        }
      }

      if (authEnabled && target === "vercel-edge") {
        diagnostics.push({
          severity: "error",
          code: "edge_auth_runtime",
          message: "Session auth is currently not supported on vercel-edge builds.",
          hint: "Use `vercel-node` for auth-enabled apps, or remove auth before targeting the edge runtime.",
        });
      } else if (authEnabled && target === "cloudflare") {
        diagnostics.push({
          severity: "warning",
          code: "worker_auth_runtime",
          message: "Cloudflare deployments with auth depend on Node compatibility behavior.",
          hint: "Verify the generated worker under Wrangler before shipping auth-enabled production traffic.",
        });
      }
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "config_load_failed",
        message: "Deployment verification could not fully load capstan.config.",
        hint: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (target === "vercel-edge" || target === "cloudflare") {
    const offenders = await detectNodeRuntimeImports(options.appRoot);
    if (offenders.length > 0) {
      diagnostics.push({
        severity: "error",
        code: "node_runtime_imports",
        message: `Edge and worker deployments cannot include Node-only imports. Offenders: ${offenders.slice(0, 5).join(", ")}${offenders.length > 5 ? "..." : ""}`,
        hint: "Remove `node:` imports from routes/config or switch this deployment target to vercel-node/docker/fly.",
      });
    }
  }

  return createDeploymentReport(options.appRoot, target, diagnostics);
}

// ---------------------------------------------------------------------------
// Dev / Build / Start
// ---------------------------------------------------------------------------

async function runDev(args: string[]): Promise<void> {
  const isBun = typeof (globalThis as any).Bun !== "undefined";

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

  if (isBun) {
    // Bun natively supports TypeScript — no tsx shim needed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const child = (globalThis as any).Bun.spawn(["bun", "--eval", devScript], {
      cwd: process.cwd(),
      stdio: ["inherit", "inherit", "inherit"],
      env: { ...process.env },
    });

    // Wait for the child to exit and forward exit code.
    const exitCode = await child.exited;
    process.exit(exitCode ?? 0);
  } else {
    // Spawn a child process with --import tsx so that dynamic import() of .ts
    // and .tsx route files works. Node.js cannot natively handle .tsx, and
    // register("tsx/esm") was deprecated in Node v20.6+.
    const { spawn } = await import("node:child_process");

    // Locate the tsx package entry for --import
    let tsxImportSpecifier: string;
    try {
      await import("node:module").then(m =>
        m.createRequire(import.meta.url).resolve("tsx/esm"),
      );
      tsxImportSpecifier = "tsx";
    } catch {
      tsxImportSpecifier = "tsx";
    }

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
}

async function runBuild(args: string[]): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);
  const { mkdir, writeFile, cp, access } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const { generateAgentManifest, generateOpenApiSpec } = await import("@zauso-ai/capstan-agent");

  const isStatic = args.includes("--static");
  const buildTargetArg = readFlagValue(args, "--target");
  if (buildTargetArg && !isBuildTarget(buildTargetArg)) {
    console.error(
      pc.red(
        `[capstan] Unsupported build target "${buildTargetArg}". Valid targets: ${BUILD_TARGETS.join(", ")}`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const buildTarget: BuildTarget | undefined =
    buildTargetArg && isBuildTarget(buildTargetArg)
      ? buildTargetArg
      : undefined;
  const cwd = process.cwd();
  const distDir = join(cwd, "dist");

  // Step 1: TypeScript compilation
  console.log(pc.dim("[capstan]") + " Compiling TypeScript...");
  try {
    await exec("npx", ["tsc", "-p", "tsconfig.json"], { cwd });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`[capstan] TypeScript compilation failed:\n${message}`));
    process.exitCode = 1;
    return;
  }
  console.log(pc.dim("[capstan]") + pc.green(" TypeScript compilation complete."));

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
  console.log(pc.dim("[capstan]") + " Scanning routes...");
  const manifest = await scanRoutes(routesDir);

  const compiledManifest = {
    ...manifest,
    rootDir: join(distDir, "app", "routes"),
    routes: manifest.routes.map((route) => ({
      ...route,
      filePath: route.filePath
        .replace(cwd, distDir)
        .replace(/\.tsx$/, ".js")
        .replace(/\.ts$/, ".js"),
      layouts: route.layouts.map((l) =>
        l.replace(cwd, distDir).replace(/\.tsx$/, ".js").replace(/\.ts$/, ".js"),
      ),
      middlewares: route.middlewares.map((m) =>
        m.replace(cwd, distDir).replace(/\.tsx$/, ".js").replace(/\.ts$/, ".js"),
      ),
      ...(route.loading ? {
        loading: route.loading.replace(cwd, distDir).replace(/\.tsx$/, ".js").replace(/\.ts$/, ".js"),
      } : {}),
      ...(route.error ? {
        error: route.error.replace(cwd, distDir).replace(/\.tsx$/, ".js").replace(/\.ts$/, ".js"),
      } : {}),
      ...(route.notFound ? {
        notFound: route.notFound.replace(cwd, distDir).replace(/\.tsx$/, ".js").replace(/\.ts$/, ".js"),
      } : {}),
    })),
  };
  await mkdir(distDir, { recursive: true });
  await writeFile(
    join(distDir, "_capstan_manifest.json"),
    JSON.stringify(compiledManifest, null, 2),
  );
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/_capstan_manifest.json"));

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
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/agent-manifest.json"));
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/openapi.json"));

  // Step 5: Copy public/ assets to dist/public/ (if the directory exists)
  const publicDir = join(cwd, "app", "public");
  let publicAssetsCopied = false;
  try {
    await access(publicDir);
    await cp(publicDir, join(distDir, "public"), { recursive: true });
    publicAssetsCopied = true;
    console.log(pc.dim("[capstan]") + pc.green(" Copied app/public/ to dist/public/"));
  } catch {
    // No public directory — skip.
  }

  // Step 5.5: Pre-render SSG pages (if --static flag is set)
  if (isStatic) {
    console.log(pc.dim("[capstan]") + " Pre-rendering SSG pages...");
    try {
      const { buildStaticPages } = await import("@zauso-ai/capstan-dev");
      const ssgResult = await buildStaticPages({
        rootDir: cwd,
        outputDir: join(distDir, "static"),
        manifest: compiledManifest,
      });
      if (ssgResult.pages > 0) {
        console.log(
          pc.dim("[capstan]") +
          pc.green(` Pre-rendered ${ssgResult.pages} SSG page${ssgResult.pages > 1 ? "s" : ""}`),
        );
      } else {
        console.log(pc.dim("[capstan]") + pc.yellow(" No SSG pages found (no pages export renderMode = \"ssg\")"));
      }
      for (const err of ssgResult.errors) {
        console.log(pc.dim("[capstan]") + pc.red(` SSG error: ${err}`));
      }
    } catch (err) {
      console.log(
        pc.dim("[capstan]") +
        pc.red(` SSG pre-rendering failed: ${err instanceof Error ? err.message : err}`),
      );
    }
  }

  // Step 6: Generate the production server entry file
  const serverEntry = `import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pc from "picocolors";
import { buildRuntimeApp } from "@zauso-ai/capstan-dev";

const cwd = process.cwd();
const distDir = resolve(cwd, "dist");
const manifestPath = join(distDir, "_capstan_manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

const port = parseInt(process.env.CAPSTAN_PORT ?? process.env.PORT ?? "3000", 10);
const host = process.env.CAPSTAN_HOST ?? "0.0.0.0";
const MAX_BODY_SIZE = parseInt(process.env.CAPSTAN_MAX_BODY_SIZE ?? "1048576", 10);

async function loadAppConfig() {
  const configCandidates = [
    join(distDir, "capstan.config.js"),
    join(cwd, "capstan.config.js"),
  ];

  for (const candidate of configCandidates) {
    if (!existsSync(candidate)) continue;

    try {
      const configUrl = pathToFileURL(candidate).href;
      const configMod = await import(configUrl);
      return configMod.default ?? configMod;
    } catch (err) {
      console.warn("[capstan] Failed to load config from " + candidate + ":", err?.message ?? err);
    }
  }

  return null;
}

function normalizeAuthConfig(appConfig) {
  const authConfig = appConfig?.auth ?? null;
  const sessionConfig = authConfig?.session ?? null;

  if (!sessionConfig?.secret) {
    return undefined;
  }

  const normalized = {
    session: {
      secret: sessionConfig.secret,
    },
  };

  if (sessionConfig.maxAge !== undefined) {
    normalized.session.maxAge = sessionConfig.maxAge;
  }

  if (authConfig.apiKeys !== undefined) {
    normalized.apiKeys = authConfig.apiKeys;
  }

  return normalized;
}

async function loadPolicyRegistry() {
  const registry = new Map();
  const policiesIndexPath = join(distDir, "app", "policies", "index.js");

  if (!existsSync(policiesIndexPath)) {
    return registry;
  }

  try {
    const policiesMod = await import(pathToFileURL(policiesIndexPath).href);
    const exportsObject = policiesMod.default ?? policiesMod;
    if (exportsObject && typeof exportsObject === "object") {
      for (const [key, value] of Object.entries(exportsObject)) {
        if (value && typeof value === "object" && "check" in value) {
          registry.set(value.key ?? key, value);
        }
      }
    }
  } catch (err) {
    console.warn("[capstan] Failed to load policies from " + policiesIndexPath + ":", err?.message ?? err);
  }

  return registry;
}

function createCorsOptions() {
  const corsOriginEnv = process.env.CAPSTAN_CORS_ORIGIN;
  if (corsOriginEnv === "*") {
    return undefined;
  }

  return {
    origin: (origin, c) => {
      if (corsOriginEnv) {
        return origin === corsOriginEnv ? origin : null;
      }

      try {
        const reqHost = c.req.header("host") ?? "";
        const originUrl = new URL(origin);
        return originUrl.host === reqHost ? origin : null;
      } catch {
        return null;
      }
    },
  };
}

async function main() {
  const appConfig = await loadAppConfig();
  const authConfig = normalizeAuthConfig(appConfig);
  const policyRegistry = await loadPolicyRegistry();
  const corsOptions = createCorsOptions();

  if (policyRegistry.size > 0) {
    console.log(pc.dim("[capstan]") + " Loaded " + policyRegistry.size + " custom policies from app/policies/index.js");
  }

  const { app, apiRouteCount, pageRouteCount } = await buildRuntimeApp({
    rootDir: distDir,
    manifest,
    mode: "production",
    host,
    port,
    appName: appConfig?.app?.name ?? appConfig?.name ?? "capstan-app",
    appDescription: appConfig?.app?.description ?? appConfig?.description,
    publicDir: join(distDir, "public"),
    staticDir: join(distDir, "static"),
    liveReload: false,
    unknownPolicyMode: "deny",
    policyRegistry,
    corsOptions,
    ...(authConfig ? { auth: authConfig } : {}),
    ...(typeof appConfig?.findAgentByKeyPrefix === "function"
      ? { findAgentByKeyPrefix: appConfig.findAgentByKeyPrefix }
      : {}),
  });

  const isBunRuntime = typeof globalThis.Bun !== "undefined";

  function printStartupBanner() {
    console.log("");
    console.log(pc.bold("  Capstan production server running" + (isBunRuntime ? " (Bun)" : "")));
    console.log("  Local:  " + pc.cyan("http://" + (host === "0.0.0.0" ? "localhost" : host) + ":" + port));
    console.log(pc.dim("  Routes: " + (apiRouteCount + pageRouteCount) + " total (" + apiRouteCount + " API, " + pageRouteCount + " pages)"));
    if (authConfig) console.log(pc.green("  Auth:   enabled"));
    else console.log(pc.dim("  Auth:   disabled (no auth config)"));
    if (policyRegistry.size > 0) console.log(pc.dim("  Policies: " + policyRegistry.size + " custom policies loaded"));
    console.log("");
  }

  if (isBunRuntime) {
    const bunServer = Bun.serve({
      port,
      hostname: host,
      maxRequestBodySize: MAX_BODY_SIZE,
      fetch: app.fetch,
    });

    printStartupBanner();

    process.on("SIGINT", () => { bunServer.stop(); process.exit(0); });
    process.on("SIGTERM", () => { bunServer.stop(); process.exit(0); });
    return;
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url ?? "/",
        "http://" + (req.headers.host ?? host + ":" + port),
      );
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) headers.append(key, item);
        } else {
          headers.set(key, value);
        }
      }

      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      let body;
      if (hasBody) {
        body = await new Promise((resolve, reject) => {
          const chunks = [];
          let received = 0;

          req.on("data", (chunk) => {
            received += chunk.length;
            if (received > MAX_BODY_SIZE) {
              req.destroy();
              const error = new Error(
                "Request body exceeds maximum allowed size of " + MAX_BODY_SIZE + " bytes",
              );
              error.statusCode = 413;
              reject(error);
              return;
            }
            chunks.push(chunk);
          });
          req.on("error", reject);
          req.on("end", () => {
            const raw = Buffer.concat(chunks);
            resolve(raw.length > 0 ? raw : undefined);
          });
        });
      }

      const init = {
        method: req.method ?? "GET",
        headers,
      };
      if (body !== undefined) {
        init.body = body;
      }

      const request = new Request(url.toString(), init);
      const response = await app.fetch(request);
      const responseBody = Buffer.from(await response.arrayBuffer());

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(responseBody);
    } catch (err) {
      if (err?.statusCode === 413) {
        if (!res.headersSent) {
          res.writeHead(413, { "Content-Type": "application/json" });
        }
        res.end(JSON.stringify({ error: "Payload Too Large" }));
        return;
      }

      console.error(pc.red("[capstan] Unhandled request error:"), err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  });

  const activeConnections = new Set();

  server.on("connection", (socket) => {
    activeConnections.add(socket);
    socket.once("close", () => activeConnections.delete(socket));
  });

  server.listen(port, host, () => {
    printStartupBanner();
  });

  let shuttingDown = false;

  function gracefulShutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Shutting down gracefully...");

    server.close(() => {
      process.exit(0);
    });

    const timer = setTimeout(() => {
      for (const socket of activeConnections) {
        try {
          socket.destroy();
        } catch {}
      }
      process.exit(0);
    }, 5000);

    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
  }

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
}

main().catch((err) => {
  console.error(pc.red("[capstan] Fatal error starting production server:"), err);
  process.exit(1);
});
`;

  await writeFile(join(distDir, "_capstan_server.js"), serverEntry);
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/_capstan_server.js"));
  const deployTargets = buildTarget
    ? createDeployTargetContract(buildTarget)
    : createProjectRootDeployTargetContract();
  const deployManifest = createDeployManifest({
    rootDir: cwd,
    distDir,
    appName,
    ...(appDescription ? { appDescription } : {}),
    isStaticBuild: isStatic,
    publicAssetsCopied,
    ...(buildTarget ? { buildTarget } : {}),
    targets: deployTargets,
  });

  if (buildTarget) {
    await emitStandaloneBuildTarget({
      rootDir: cwd,
      distDir,
      buildTarget,
      appName,
      deployManifest,
    });
    if (process.exitCode && process.exitCode !== 0) {
      return;
    }
  }

  const deployIntegrity = await buildDeployManifestIntegrity(cwd, deployManifest);
  if (deployIntegrity.diagnostics.length > 0 || !deployIntegrity.integrity) {
    console.error(pc.red("[capstan] Deployment integrity generation failed."));
    for (const diagnostic of deployIntegrity.diagnostics) {
      const marker = diagnostic.severity === "warning" ? "!" : "\u2717";
      console.error(pc.red(`  ${marker} ${diagnostic.message}`));
      if (diagnostic.hint) {
        console.error(pc.dim(`    → ${diagnostic.hint}`));
      }
    }
    process.exitCode = 1;
    return;
  }

  const deployManifestWithIntegrity = {
    ...deployManifest,
    integrity: deployIntegrity.integrity,
  };
  await writeFile(
    join(distDir, "deploy-manifest.json"),
    JSON.stringify(deployManifestWithIntegrity, null, 2),
  );
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/deploy-manifest.json with integrity metadata"));
  console.log(pc.dim("[capstan]") + pc.green(" Build complete."));
}

async function runStart(args: string[]): Promise<void> {
  const isBun = typeof (globalThis as any).Bun !== "undefined";
  const { access } = await import("node:fs/promises");

  const fromDir = readFlagValue(args, "--from");
  const startRoot = fromDir
    ? resolve(process.cwd(), fromDir)
    : process.cwd();
  const verification = await verifyDeployment({ appRoot: startRoot });
  if (verification.status === "failed") {
    process.stderr.write(renderDeploymentVerifyText(verification));
    process.exitCode = 1;
    return;
  }
  if (verification.summary.warningCount > 0) {
    process.stderr.write(renderDeploymentVerifyText(verification));
  }

  const deployManifest = await loadDeployManifest(startRoot);
  if (!deployManifest) {
    console.error(pc.red(`[capstan] ${relative(process.cwd(), join(startRoot, "dist", "deploy-manifest.json"))} not found.`));
    console.error(pc.yellow("[capstan] Run `capstan build` first to compile the project."));
    process.exitCode = 1;
    return;
  }
  const serverEntry = resolveServerEntryPath(startRoot, deployManifest);

  // Verify the production build exists
  try {
    await access(serverEntry);
  } catch {
    console.error(pc.red(`[capstan] ${relative(process.cwd(), serverEntry)} not found.`));
    console.error(pc.yellow("[capstan] Run `capstan build` first to compile the project."));
    process.exitCode = 1;
    return;
  }

  const port = readFlagValue(args, "--port") ?? "3000";
  const host = readFlagValue(args, "--host") ?? "0.0.0.0";

  const envVars = {
    ...process.env,
    CAPSTAN_PORT: port,
    CAPSTAN_HOST: host,
  };

  if (isBun) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const child = (globalThis as any).Bun.spawn(["bun", serverEntry], {
      cwd: startRoot,
      stdio: ["inherit", "inherit", "inherit"],
      env: envVars,
    });

    const exitCode = await child.exited;
    process.exit(exitCode ?? 0);
  } else {
    const { spawn } = await import("node:child_process");

    const child = spawn(
      process.execPath,
      [serverEntry],
      {
        cwd: startRoot,
        stdio: "inherit",
        env: envVars,
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
}

async function runDeployInit(args: string[]): Promise<void> {
  const { access, writeFile } = await import("node:fs/promises");

  const target = readFlagValue(args, "--target") ?? "docker";
  if (!isDeployInitTarget(target)) {
    console.error(
      pc.red(
        `[capstan] Unsupported deploy:init target "${target}". Valid targets: ${DEPLOY_INIT_TARGETS.join(", ")}`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const force = args.includes("--force");
  const cwd = process.cwd();
  let appName = "capstan-app";
  try {
    const configPath = await resolveConfig();
    if (configPath) {
      const configModule = await import(pathToFileURL(configPath).href);
      const config = configModule.default ?? configModule;
      if (typeof config?.app?.name === "string") {
        appName = config.app.name;
      } else if (typeof config?.name === "string") {
        appName = config.name;
      }
    } else {
      const packageJson = await readProjectPackageJson(cwd);
      if (typeof packageJson?.name === "string") {
        appName = packageJson.name;
      }
    }
  } catch {
    // Fall back to the default deploy app name.
  }

  const files = createProjectDeploymentFiles({
    target,
    appName,
  }).map((file) => ({
    path: join(cwd, file.path),
    content: file.content,
  }));

  const conflicts: string[] = [];

  for (const file of files) {
    try {
      await access(file.path);
      if (!force) {
        conflicts.push(relative(cwd, file.path));
      }
    } catch {
      // File does not exist yet.
    }
  }

  if (conflicts.length > 0) {
    console.error(
      pc.red(
        `[capstan] Refusing to overwrite existing deployment files: ${conflicts.join(", ")}`,
      ),
    );
    console.error(pc.yellow("[capstan] Re-run with `--force` to replace them."));
    process.exitCode = 1;
    return;
  }

  for (const file of files) {
    await writeFile(file.path, file.content, "utf-8");
    console.log(pc.dim("[capstan]") + pc.green(` Generated ${relative(cwd, file.path)}`));
  }
}

async function emitStandaloneBuildTarget(options: {
  rootDir: string;
  distDir: string;
  buildTarget: BuildTarget;
  appName: string;
  deployManifest: DeployManifest;
}): Promise<void> {
  const { access, cp, mkdir, rm, stat, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");

  const { rootDir, distDir, buildTarget, appName, deployManifest } = options;
  const standaloneRoot = getStandaloneOutputDir(rootDir);
  const standaloneDistDir = join(standaloneRoot, "dist");
  const projectPackageJson = await readProjectPackageJson(rootDir);

  await rm(standaloneRoot, { recursive: true, force: true });
  await mkdir(standaloneDistDir, { recursive: true });

  const runtimeArtifacts = [
    "app",
    "public",
    "static",
    "_capstan_manifest.json",
    "_capstan_server.js",
    "agent-manifest.json",
    "openapi.json",
    "capstan.config.js",
  ];

  for (const artifact of runtimeArtifacts) {
    const sourcePath = join(distDir, artifact);
    try {
      await access(sourcePath);
    } catch {
      continue;
    }

    const sourceStat = await stat(sourcePath);
    await cp(sourcePath, join(standaloneDistDir, artifact), {
      recursive: sourceStat.isDirectory(),
    });
  }

  await writeFile(
    join(standaloneRoot, "package.json"),
    await createStandalonePackageJson({
      projectPackageJson,
      appName,
    }),
    "utf-8",
  );
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/standalone/package.json"));
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/standalone/dist/deploy-manifest.json"));

  const hasConfig = existsSync(join(standaloneDistDir, "capstan.config.js"));
  const hasPolicies = existsSync(join(standaloneDistDir, "app", "policies", "index.js"));

  if (shouldEmitPortableRuntimeBundle(buildTarget)) {
    const runtimeDir = join(standaloneRoot, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    const routeManifest = await readJsonArtifact<RouteManifest>(
      join(standaloneDistDir, "_capstan_manifest.json"),
    );
    const portableRouteManifest = createPortableRouteManifest(
      routeManifest,
      standaloneDistDir,
    );
    const agentManifest = await readJsonArtifact<unknown>(
      join(standaloneDistDir, "agent-manifest.json"),
    );
    const openApiSpec = await readJsonArtifact<unknown>(
      join(standaloneDistDir, "openapi.json"),
    );
    const assetMaps = await collectPortableRuntimeAssets(standaloneDistDir);

    await writeFile(
      join(runtimeDir, "manifest.js"),
      createPortableRuntimeManifestModuleSource({
        manifest: portableRouteManifest,
        agentManifest,
        openApiSpec,
      }),
      "utf-8",
    );
    await writeFile(
      join(runtimeDir, "modules.js"),
      createPortableRuntimeModulesModuleSource(portableRouteManifest, {
        runtimeRoot: getPortableRuntimeRootDir(),
      }),
      "utf-8",
    );
    await writeFile(
      join(runtimeDir, "assets.js"),
      createPortableRuntimeAssetsModuleSource(assetMaps),
      "utf-8",
    );
    console.log(pc.dim("[capstan]") + pc.green(" Generated dist/standalone/runtime/manifest.js"));
    console.log(pc.dim("[capstan]") + pc.green(" Generated dist/standalone/runtime/modules.js"));
    console.log(pc.dim("[capstan]") + pc.green(" Generated dist/standalone/runtime/assets.js"));
  }

  const platformFiles = createStandalonePlatformFiles({
    buildTarget,
    appName,
    hasConfig,
    hasPolicies,
    ...(deployManifest.app.description
      ? { appDescription: deployManifest.app.description }
      : {}),
  });

  for (const file of platformFiles) {
    const targetPath = join(standaloneRoot, file.path);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content, "utf-8");
    console.log(pc.dim("[capstan]") + pc.green(` Generated ${relative(rootDir, targetPath)}`));
  }

  const standaloneManifest = createStandaloneDeployManifest(
    deployManifest,
    buildTarget,
  );
  const standaloneIntegrity = await buildDeployManifestIntegrity(standaloneRoot, standaloneManifest);
  if (standaloneIntegrity.diagnostics.length > 0 || !standaloneIntegrity.integrity) {
    console.error(pc.red("[capstan] Standalone deployment integrity generation failed."));
    for (const diagnostic of standaloneIntegrity.diagnostics) {
      const marker = diagnostic.severity === "warning" ? "!" : "\u2717";
      console.error(pc.red(`  ${marker} ${diagnostic.message}`));
      if (diagnostic.hint) {
        console.error(pc.dim(`    → ${diagnostic.hint}`));
      }
    }
    process.exitCode = 1;
    return;
  }

  await writeFile(
    join(standaloneDistDir, "deploy-manifest.json"),
    JSON.stringify(
      {
        ...standaloneManifest,
        integrity: standaloneIntegrity.integrity,
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(pc.dim("[capstan]") + pc.green(" Generated dist/standalone/dist/deploy-manifest.json with integrity metadata"));
}

// ---------------------------------------------------------------------------
// Database commands
// ---------------------------------------------------------------------------

async function runDbMigrate(args: string[]): Promise<void> {
  const name = readFlagValue(args, "--name");
  if (!name) {
    console.error(pc.red("Usage: capstan db:migrate --name <migration-name>"));
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
  console.log(pc.green(`Created migration: app/migrations/${filename}`));
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

  const dbInstance = await createDatabase({ provider, url });
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
    console.log(pc.green("No pending migrations. Database is up to date."));
  } else {
    for (const name of executed) {
      console.log(pc.green(`Applied: ${name}`));
    }
    console.log(pc.dim(`\n${executed.length} migration(s) applied.`));
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
    const dbInstance = await createDatabase({ provider, url });
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

  console.log(`Migration status ${pc.dim(`(${provider})`)}:\n`);

  if (status.applied.length > 0) {
    console.log(`Applied ${pc.dim(`(${status.applied.length})`)}:`);
    for (const m of status.applied) {
      console.log(pc.green(`  \u2713 ${m.name}`) + pc.dim(`  (${m.appliedAt})`));
    }
  }

  if (status.pending.length > 0) {
    if (status.applied.length > 0) console.log("");
    console.log(`Pending ${pc.dim(`(${status.pending.length})`)}:`);
    for (const name of status.pending) {
      console.log(pc.yellow(`  \u2022 ${name}`));
    }
  }

  if (status.applied.length > 0 && status.pending.length === 0) {
    console.log(pc.green("\nDatabase is up to date."));
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

  // Build an executeRoute callback that loads handlers from disk and invokes
  // them directly, so MCP tool calls actually run the real route logic.
  const { loadApiHandlers } = await import("@zauso-ai/capstan-dev");

  // Build registry entries with full schema information so MCP tools,
  // OpenAPI specs, and A2A skills expose real parameter types.
  const { toJSONSchema } = await import("zod");
  const apiRoutes = manifest.routes.filter((r) => r.type === "api");
  const registryEntries: Array<{
    method: string;
    path: string;
    description?: string;
    capability?: "read" | "write" | "external";
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }> = [];

  for (const r of apiRoutes) {
    let handlers: Awaited<ReturnType<typeof loadApiHandlers>>;
    try {
      handlers = await loadApiHandlers(r.filePath);
    } catch {
      // If a route fails to load, fall back to bare method+path entries.
      const methods = r.methods && r.methods.length > 0 ? r.methods : ["GET"];
      for (const m of methods) {
        registryEntries.push({ method: m, path: r.urlPattern });
      }
      continue;
    }

    const methodExports: Array<[string, unknown]> = [
      ["GET", handlers.GET],
      ["POST", handlers.POST],
      ["PUT", handlers.PUT],
      ["DELETE", handlers.DELETE],
      ["PATCH", handlers.PATCH],
    ];

    for (const [m, handler] of methodExports) {
      if (handler === undefined) continue;

      const entry: (typeof registryEntries)[number] = {
        method: m,
        path: r.urlPattern,
      };

      // Extract metadata from APIDefinition objects produced by defineAPI().
      if (
        handler !== null &&
        typeof handler === "object" &&
        "handler" in handler &&
        typeof (handler as { handler: unknown }).handler === "function"
      ) {
        const apiDef = handler as {
          handler: Function;
          description?: string;
          capability?: string;
          input?: unknown;
          output?: unknown;
        };
        if (apiDef.description !== undefined) entry.description = apiDef.description;
        if (apiDef.capability !== undefined) entry.capability = apiDef.capability as "read" | "write" | "external";

        try {
          if (apiDef.input) {
            entry.inputSchema = toJSONSchema(apiDef.input as Parameters<typeof toJSONSchema>[0]) as Record<string, unknown>;
          }
        } catch {
          // Schema conversion is best-effort.
        }

        try {
          if (apiDef.output) {
            entry.outputSchema = toJSONSchema(apiDef.output as Parameters<typeof toJSONSchema>[0]) as Record<string, unknown>;
          }
        } catch {
          // Best-effort.
        }
      }

      // Merge metadata from the route file's `meta` export.
      if (handlers.meta) {
        if (entry.description === undefined && typeof handlers.meta["description"] === "string") {
          entry.description = handlers.meta["description"];
        }
        if (entry.capability === undefined && typeof handlers.meta["capability"] === "string") {
          entry.capability = handlers.meta["capability"] as "read" | "write" | "external";
        }
      }

      registryEntries.push(entry);
    }
  }

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

function isBuildTarget(value: string): value is BuildTarget {
  return (BUILD_TARGETS as readonly string[]).includes(value);
}

function isDeployInitTarget(value: string): value is (typeof DEPLOY_INIT_TARGETS)[number] {
  return (DEPLOY_INIT_TARGETS as readonly string[]).includes(value);
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function readPositionalArgs(args: string[]): string[] {
  const positional: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value) continue;
    if (value === "--root" || value === "--grants" || value === "--subject" || value === "--note") {
      index++;
      continue;
    }
    if (value.startsWith("--")) {
      continue;
    }
    positional.push(value);
  }

  return positional;
}

function parseJsonFlag<T>(label: string, raw: string | undefined): T | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label} JSON: ${message}`);
  }
}

type HarnessCliGrant =
  | string
  | {
      resource: string;
      action: string;
      scope?: Record<string, string>;
      expiresAt?: string;
      constraints?: Record<string, unknown>;
      effect?: "allow" | "deny";
    };

async function resolveHarnessRuntime(args: string[]) {
  const { openHarnessRuntime } = await import("@zauso-ai/capstan-ai");
  const grants = parseJsonFlag<ReadonlyArray<HarnessCliGrant>>(
    "--grants",
    readFlagValue(args, "--grants") ?? process.env.CAPSTAN_HARNESS_GRANTS,
  );
  const subject = parseJsonFlag<Record<string, unknown>>(
    "--subject",
    readFlagValue(args, "--subject") ?? process.env.CAPSTAN_HARNESS_SUBJECT,
  );
  const rootDir = resolve(
    process.cwd(),
    readFlagValue(args, "--root") ?? process.cwd(),
  );
  const authModule = grants?.length ? await import("@zauso-ai/capstan-auth") : undefined;
  const runtimeGrantAuthorizer =
    authModule && grants?.length
      ? authModule.createHarnessGrantAuthorizer(grants)
      : undefined;
  const runtime = await openHarnessRuntime({
    rootDir,
    ...(runtimeGrantAuthorizer
      ? {
          authorize(request) {
            return runtimeGrantAuthorizer(request);
          },
        }
      : {}),
  });

  return {
    runtime,
    access:
      subject || grants?.length
        ? {
            ...(subject ? { subject } : {}),
            ...(grants?.length ? { metadata: { grants } } : {}),
          }
        : undefined,
  };
}

function printHarnessPayload(payload: unknown, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      console.log(pc.dim("No harness records found."));
      return;
    }
    for (const item of payload) {
      console.log(JSON.stringify(item, null, 2));
    }
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

async function runHarnessList(args: string[]): Promise<void> {
  const { runtime, access } = await resolveHarnessRuntime(args);
  const runs = await runtime.listRuns(access);
  printHarnessPayload(runs, hasFlag(args, "--json"));
}

async function runHarnessGet(args: string[]): Promise<void> {
  const [runId] = readPositionalArgs(args);
  if (!runId) {
    throw new Error("Usage: capstan harness:get <runId> [--root <dir>] [--json]");
  }

  const { runtime, access } = await resolveHarnessRuntime(args);
  const run = await runtime.getRun(runId, access);

  if (!run) {
    throw new Error(`Harness run not found: ${runId}`);
  }

  printHarnessPayload(run, hasFlag(args, "--json"));
}

async function runHarnessEvents(args: string[]): Promise<void> {
  const [runId] = readPositionalArgs(args);
  const { runtime, access } = await resolveHarnessRuntime(args);
  const events = await runtime.getEvents(runId, access);
  printHarnessPayload(events, hasFlag(args, "--json"));
}

async function runHarnessArtifacts(args: string[]): Promise<void> {
  const [runId] = readPositionalArgs(args);
  if (!runId) {
    throw new Error("Usage: capstan harness:artifacts <runId> [--root <dir>] [--json]");
  }

  const { runtime, access } = await resolveHarnessRuntime(args);
  const artifacts = await runtime.getArtifacts(runId, access);
  printHarnessPayload(artifacts, hasFlag(args, "--json"));
}

async function runHarnessCheckpoint(args: string[]): Promise<void> {
  const [runId] = readPositionalArgs(args);
  if (!runId) {
    throw new Error("Usage: capstan harness:checkpoint <runId> [--root <dir>] [--json]");
  }

  const { runtime, access } = await resolveHarnessRuntime(args);
  const checkpoint = await runtime.getCheckpoint(runId, access);

  if (!checkpoint) {
    throw new Error(`Harness checkpoint not found: ${runId}`);
  }

  printHarnessPayload(checkpoint, hasFlag(args, "--json"));
}

async function runHarnessApproval(args: string[]): Promise<void> {
  const [approvalId] = readPositionalArgs(args);
  if (!approvalId) {
    throw new Error("Usage: capstan harness:approval <approvalId> [--root <dir>] [--json]");
  }

  const { runtime, access } = await resolveHarnessRuntime(args);
  const approval = await runtime.getApproval(approvalId, access);

  if (!approval) {
    throw new Error(`Harness approval not found: ${approvalId}`);
  }

  printHarnessPayload(approval, hasFlag(args, "--json"));
}

async function runHarnessApprovals(args: string[]): Promise<void> {
  const [runId] = readPositionalArgs(args);
  const { runtime, access } = await resolveHarnessRuntime(args);
  const approvals = await runtime.listApprovals(runId, access);
  printHarnessPayload(approvals, hasFlag(args, "--json"));
}

async function runHarnessApprove(args: string[]): Promise<void> {
  const [runId] = readPositionalArgs(args);
  if (!runId) {
    throw new Error(
      "Usage: capstan harness:approve <runId> [--note <text>] [--root <dir>] [--json]",
    );
  }

  const { runtime, access } = await resolveHarnessRuntime(args);
  const note = readFlagValue(args, "--note");
  const approval = await runtime.approveRun(runId, {
    ...(access ? { access } : {}),
    ...(note ? { note } : {}),
  });
  printHarnessPayload(approval, hasFlag(args, "--json"));
}

async function runHarnessDeny(args: string[]): Promise<void> {
  const [runId] = readPositionalArgs(args);
  if (!runId) {
    throw new Error(
      "Usage: capstan harness:deny <runId> [--note <text>] [--root <dir>] [--json]",
    );
  }

  const { runtime, access } = await resolveHarnessRuntime(args);
  const note = readFlagValue(args, "--note");
  const approval = await runtime.denyRun(runId, {
    ...(access ? { access } : {}),
    ...(note ? { note } : {}),
  });
  printHarnessPayload(approval, hasFlag(args, "--json"));
}

async function runHarnessPause(args: string[]): Promise<void> {
  const [runId] = readPositionalArgs(args);
  if (!runId) {
    throw new Error("Usage: capstan harness:pause <runId> [--root <dir>] [--json]");
  }

  const { runtime, access } = await resolveHarnessRuntime(args);
  const run = await runtime.pauseRun(runId, access);
  printHarnessPayload(run, hasFlag(args, "--json"));
}

async function runHarnessCancel(args: string[]): Promise<void> {
  const [runId] = readPositionalArgs(args);
  if (!runId) {
    throw new Error("Usage: capstan harness:cancel <runId> [--root <dir>] [--json]");
  }

  const { runtime, access } = await resolveHarnessRuntime(args);
  const run = await runtime.cancelRun(runId, access);
  printHarnessPayload(run, hasFlag(args, "--json"));
}

async function runHarnessReplay(args: string[]): Promise<void> {
  const [runId] = readPositionalArgs(args);
  if (!runId) {
    throw new Error("Usage: capstan harness:replay <runId> [--root <dir>] [--json]");
  }

  const { runtime, access } = await resolveHarnessRuntime(args);
  const report = await runtime.replayRun(runId, access);
  printHarnessPayload(report, hasFlag(args, "--json"));
}

async function runHarnessPaths(args: string[]): Promise<void> {
  const { runtime, access } = await resolveHarnessRuntime(args);
  printHarnessPayload(runtime.getPaths(access), hasFlag(args, "--json"));
}

// ---------------------------------------------------------------------------
// capstan add
// ---------------------------------------------------------------------------

async function runAdd(args: string[]): Promise<void> {
  const subcommand = args[0];
  const name = args[1];

  if (!subcommand || !name) {
    console.error(pc.red("Usage: capstan add <model|api|page|policy> <name>"));
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case "model": {
      const filePath = join(process.cwd(), "app/models", `${name}.model.ts`);
      if (existsSync(filePath)) {
        console.error(pc.red(`File already exists: app/models/${name}.model.ts`));
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
      console.log(pc.green(`\u2713 Created app/models/${name}.model.ts`));
      break;
    }
    case "api": {
      const dirPath = join(process.cwd(), "app/routes", name);
      const filePath = join(dirPath, "index.api.ts");
      if (existsSync(filePath)) {
        console.error(pc.red(`File already exists: app/routes/${name}/index.api.ts`));
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
      console.log(pc.green(`\u2713 Created app/routes/${name}/index.api.ts`));
      break;
    }
    case "page": {
      const dirPath = join(process.cwd(), "app/routes", name);
      const filePath = join(dirPath, "index.page.tsx");
      if (existsSync(filePath)) {
        console.error(pc.red(`File already exists: app/routes/${name}/index.page.tsx`));
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
      console.log(pc.green(`\u2713 Created app/routes/${name}/index.page.tsx`));
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
        console.log(pc.green(`\u2713 Appended policy "${camelName}" to app/policies/index.ts`));
      } else {
        // Create new policies file with import
        const content = `import { definePolicy } from "@zauso-ai/capstan-core";
${policySnippet}`;
        await mkdir(policiesDir, { recursive: true });
        await writeFile(policiesFile, content, "utf-8");
        console.log(pc.green(`\u2713 Created app/policies/index.ts with policy "${camelName}"`));
      }
      break;
    }
    default:
      console.error(pc.red(`Unknown add subcommand: ${subcommand}`));
      console.error(pc.red("Usage: capstan add <model|api|page|policy> <name>"));
      process.exitCode = 1;
  }
}

function printHelp(): void {
  console.log(`\n${pc.bold("Capstan")} ${pc.dim("v1.0.0-beta.5")}\n`);

  const group = (title: string, cmds: [string, string][]) => {
    console.log(`  ${pc.bold(title)}`);
    for (const [name, desc] of cmds) {
      console.log(`    ${pc.cyan(name.padEnd(15))}${desc}`);
    }
    console.log();
  };

  group("Development", [
    ["dev",   "Start dev server with live reload"],
    ["build [--static] [--target <node-standalone|docker|vercel-node|vercel-edge|cloudflare|fly>]", "Build for production targets"],
    ["start [--from <dir>]", "Start production server from the current project or a standalone output"],
    ["deploy:init [--target <docker|vercel-node|vercel-edge|cloudflare|fly>]", "Generate root deployment files for a target"],
  ]);

  group("Scaffolding", [
    ["add model",  "Add a data model"],
    ["add api",    "Add API routes"],
    ["add page",   "Add a page component"],
    ["add policy", "Add a permission policy"],
  ]);

  group("Database", [
    ["db:migrate", "Generate migration SQL"],
    ["db:push",    "Apply pending migrations"],
    ["db:status",  "Show migration status"],
  ]);

  group("Verification", [
    ["verify [--deployment] [--target <target>]", "Run runtime or deployment verification"],
  ]);

  group("Operations", [
    ["ops:events [--path <dir>] [--kind <kind>] [--limit <n>] [--json]", "List recent ops events"],
    ["ops:incidents [--path <dir>] [--status <status>] [--limit <n>] [--json]", "List incidents from the ops store"],
    ["ops:health [--path <dir>] [--json]", "Show a derived health snapshot"],
    ["ops:tail [--path <dir>] [--limit <n>] [--follow] [--json]", "Show the latest ops feed"],
  ]);

  group("Agent Protocols", [
    ["mcp",            "Start MCP server (stdio)"],
    ["agent:manifest", "Print agent manifest JSON"],
    ["agent:openapi",  "Print OpenAPI spec JSON"],
  ]);

  group("Harness Runtime", [
    ["harness:list",      "List persisted harness runs"],
    ["harness:get",       "Read one persisted run record"],
    ["harness:events",    "Read runtime events (optionally scoped to one run)"],
    ["harness:artifacts", "List artifacts for one run"],
    ["harness:checkpoint","Read the persisted loop checkpoint for a run"],
    ["harness:approval",  "Read one persisted approval record"],
    ["harness:approvals", "List persisted approvals (optionally scoped to one run)"],
    ["harness:approve",   "Approve a blocked run's pending approval"],
    ["harness:deny",      "Deny a blocked run's pending approval and cancel it"],
    ["harness:pause",     "Request cooperative pause for a running run"],
    ["harness:cancel",    "Request cancellation for a run"],
    ["harness:replay",    "Replay events and verify stored run state"],
    ["harness:paths",     "Print harness runtime filesystem paths"],
  ]);

  console.log(`  Run ${pc.cyan("capstan <command> --help")} for details.\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(pc.red(message));
  process.exitCode = 1;
});

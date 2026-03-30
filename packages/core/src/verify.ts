import { access, readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VerifyDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  hint?: string;
  file?: string;
  line?: number;
  column?: number;
  fixCategory?:
    | "type_error"
    | "schema_mismatch"
    | "missing_file"
    | "policy_violation"
    | "contract_drift"
    | "missing_export"
    | "protocol_drift";
  autoFixable?: boolean;
}

export interface VerifyStep {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  diagnostics: VerifyDiagnostic[];
}

export interface VerifyReport {
  status: "passed" | "failed";
  appRoot: string;
  timestamp: string;
  steps: VerifyStep[];
  repairChecklist: Array<{
    index: number;
    step: string;
    message: string;
    file?: string;
    line?: number;
    hint?: string;
    fixCategory?: string;
    autoFixable?: boolean;
  }>;
  summary: {
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    errorCount: number;
    warningCount: number;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function measureStep(
  name: string,
  fn: () => Promise<VerifyDiagnostic[]>,
): Promise<VerifyStep> {
  const start = performance.now();
  try {
    const diagnostics = await fn();
    const hasErrors = diagnostics.some((d) => d.severity === "error");
    return {
      name,
      status: hasErrors ? "failed" : "passed",
      durationMs: Math.round(performance.now() - start),
      diagnostics,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name,
      status: "failed",
      durationMs: Math.round(performance.now() - start),
      diagnostics: [
        {
          code: "internal_error",
          severity: "error",
          message: `Step "${name}" threw: ${message}`,
          hint: "This is likely a bug in the verifier. Check the stack trace above.",
        },
      ],
    };
  }
}

function skippedStep(name: string, reason: string): VerifyStep {
  return {
    name,
    status: "skipped",
    durationMs: 0,
    diagnostics: [
      {
        code: "step_skipped",
        severity: "info",
        message: reason,
      },
    ],
  };
}

function buildRepairChecklist(steps: VerifyStep[]): VerifyReport["repairChecklist"] {
  const items: VerifyReport["repairChecklist"] = [];
  let index = 1;

  for (const step of steps) {
    for (const d of step.diagnostics) {
      if (d.severity === "info") continue;

      const item: (typeof items)[number] = {
        index,
        step: step.name,
        message: d.message,
      };
      if (d.file !== undefined) item.file = d.file;
      if (d.line !== undefined) item.line = d.line;
      if (d.hint !== undefined) item.hint = d.hint;
      if (d.fixCategory !== undefined) item.fixCategory = d.fixCategory;
      if (d.autoFixable !== undefined) item.autoFixable = d.autoFixable;
      items.push(item);
      index++;
    }
  }

  return items;
}

function buildReport(appRoot: string, steps: VerifyStep[]): VerifyReport {
  const hasFailure = steps.some((s) => s.status === "failed");

  let errorCount = 0;
  let warningCount = 0;
  for (const step of steps) {
    for (const d of step.diagnostics) {
      if (d.severity === "error") errorCount++;
      if (d.severity === "warning") warningCount++;
    }
  }

  return {
    status: hasFailure ? "failed" : "passed",
    appRoot,
    timestamp: new Date().toISOString(),
    steps,
    repairChecklist: buildRepairChecklist(steps),
    summary: {
      totalSteps: steps.length,
      passedSteps: steps.filter((s) => s.status === "passed").length,
      failedSteps: steps.filter((s) => s.status === "failed").length,
      skippedSteps: steps.filter((s) => s.status === "skipped").length,
      errorCount,
      warningCount,
    },
  };
}

/**
 * Walk a directory recursively and return all file paths relative to root.
 */
async function walkFiles(dir: string, root: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkFiles(full, root);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(relative(root, full));
    }
  }

  return results;
}

/**
 * Suggest an actionable repair hint based on a TypeScript error message.
 */
function suggestTypeHint(message: string): string {
  if (message.includes("Cannot find module")) {
    return "Check that the import path is correct and the dependency is installed.";
  }
  if (message.includes("is not assignable to type")) {
    return "Align the value with the expected type contract.";
  }
  if (message.includes("Property") && message.includes("is missing")) {
    return `Add the missing property to satisfy the type contract.`;
  }
  if (message.includes("Property") && message.includes("does not exist")) {
    return "Remove the unknown property or update the type definition.";
  }
  if (message.includes("Cannot find name")) {
    return "Import or declare the referenced identifier.";
  }
  return "Fix the reported TypeScript error and rerun verification.";
}

// ---------------------------------------------------------------------------
// HTTP methods recognized in API route files
// ---------------------------------------------------------------------------

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

// ---------------------------------------------------------------------------
// Step implementations
// ---------------------------------------------------------------------------

async function checkStructure(appRoot: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];

  // Config file — one of the two must exist
  const hasConfigTs = await pathExists(join(appRoot, "capstan.config.ts"));
  const hasConfigJs = await pathExists(join(appRoot, "capstan.config.js"));
  if (!hasConfigTs && !hasConfigJs) {
    diagnostics.push({
      code: "missing_config",
      severity: "error",
      message: "Missing capstan.config.ts or capstan.config.js",
      hint: "Create a capstan.config.ts that exports your app configuration via defineConfig().",
      fixCategory: "missing_file",
      autoFixable: true,
    });
  }

  // Routes directory
  const routesDir = join(appRoot, "app", "routes");
  if (!(await isDirectory(routesDir))) {
    diagnostics.push({
      code: "missing_routes_dir",
      severity: "error",
      message: "Missing app/routes/ directory",
      hint: "Create app/routes/ and add at least one route file (e.g. index.api.ts).",
      fixCategory: "missing_file",
      autoFixable: true,
    });
  }

  // package.json
  if (!(await pathExists(join(appRoot, "package.json")))) {
    diagnostics.push({
      code: "missing_package_json",
      severity: "error",
      message: "Missing package.json",
      hint: "Run npm init or create a package.json manually.",
      fixCategory: "missing_file",
      autoFixable: true,
    });
  }

  // tsconfig.json
  if (!(await pathExists(join(appRoot, "tsconfig.json")))) {
    diagnostics.push({
      code: "missing_tsconfig",
      severity: "error",
      message: "Missing tsconfig.json",
      hint: "Create a tsconfig.json extending @zauso-ai/capstan-core recommended settings.",
      fixCategory: "missing_file",
      autoFixable: true,
    });
  }

  return diagnostics;
}

async function checkConfig(appRoot: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];

  // Find the config file
  let configPath: string | null = null;
  const tsPath = join(appRoot, "capstan.config.ts");
  const jsPath = join(appRoot, "capstan.config.js");

  if (await pathExists(tsPath)) {
    configPath = tsPath;
  } else if (await pathExists(jsPath)) {
    configPath = jsPath;
  }

  if (!configPath) {
    diagnostics.push({
      code: "config_not_found",
      severity: "error",
      message: "Config file not found (should have been caught by structure step).",
      fixCategory: "missing_file",
    });
    return diagnostics;
  }

  try {
    const configUrl = pathToFileURL(configPath).href;
    const mod = (await import(configUrl)) as Record<string, unknown>;

    if (!mod["default"] && !mod["config"]) {
      diagnostics.push({
        code: "config_no_export",
        severity: "error",
        message: `Config file ${relative(appRoot, configPath)} does not export a default or named "config" value.`,
        hint: 'Export a config object via: export default defineConfig({ ... })',
        file: configPath,
        fixCategory: "missing_export",
        autoFixable: false,
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({
      code: "config_load_error",
      severity: "error",
      message: `Failed to load config: ${message}`,
      hint: "Ensure the config file is valid TypeScript/JavaScript and all imports resolve.",
      file: configPath,
      fixCategory: "type_error",
    });
  }

  return diagnostics;
}

async function checkRoutes(appRoot: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];

  const routesDir = join(appRoot, "app", "routes");
  if (!(await isDirectory(routesDir))) {
    return diagnostics; // Already caught by structure step
  }

  // Use the router scanner to discover routes
  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const manifest = await scanRoutes(routesDir);

  const apiRoutes = manifest.routes.filter((r) => r.type === "api");

  if (apiRoutes.length === 0) {
    diagnostics.push({
      code: "no_api_routes",
      severity: "warning",
      message: "No .api.ts route files found in app/routes/",
      hint: "Create at least one API route (e.g. app/routes/index.api.ts) with exported HTTP handlers.",
    });
    return diagnostics;
  }

  for (const route of apiRoutes) {
    const relPath = relative(appRoot, route.filePath);

    // Read and analyze the route source
    let source: string;
    try {
      source = await readFile(route.filePath, "utf-8");
    } catch {
      diagnostics.push({
        code: "route_unreadable",
        severity: "error",
        message: `Cannot read route file: ${relPath}`,
        file: route.filePath,
        fixCategory: "missing_file",
      });
      continue;
    }

    // Check that at least one HTTP method is exported
    const exportedMethods = HTTP_METHODS.filter((m) => {
      // Match: export const GET, export async function GET, export function GET, export { GET }
      const patterns = [
        new RegExp(`export\\s+(const|let|var|async\\s+function|function)\\s+${m}\\b`),
        new RegExp(`export\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`),
      ];
      return patterns.some((p) => p.test(source));
    });

    if (exportedMethods.length === 0) {
      diagnostics.push({
        code: "no_http_exports",
        severity: "error",
        message: `${relPath}: No HTTP method exports found (expected GET, POST, PUT, DELETE, or PATCH)`,
        hint: "Export at least one handler: export const GET = defineAPI({ ... })",
        file: route.filePath,
        fixCategory: "missing_export",
        autoFixable: false,
      });
      continue;
    }

    // For each exported method, check if it's wrapped in defineAPI()
    for (const method of exportedMethods) {
      // Heuristic: look for `export const METHOD = defineAPI({` patterns
      const defineAPIPattern = new RegExp(
        `export\\s+const\\s+${method}\\s*=\\s*defineAPI\\s*\\(`
      );
      if (!defineAPIPattern.test(source)) {
        // Also check for two-step: const METHOD = defineAPI(...); export { METHOD }
        const twoStepPattern = new RegExp(
          `(?:const|let|var)\\s+${method}\\s*=\\s*defineAPI\\s*\\(`
        );
        const exportPattern = new RegExp(
          `export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`
        );
        if (!(twoStepPattern.test(source) && exportPattern.test(source))) {
          diagnostics.push({
            code: "handler_not_defineapi",
            severity: "warning",
            message: `${relPath}: ${method} handler is not wrapped in defineAPI()`,
            hint: `Wrap the ${method} handler with defineAPI() for type-safe input/output validation and agent introspection.`,
            file: route.filePath,
            fixCategory: "schema_mismatch",
            autoFixable: true,
          });
        }
      }
    }

    // Check write capability handlers for policy field
    for (const method of exportedMethods) {
      // Look for defineAPI blocks that include capability: "write"
      const writeCapabilityPattern = new RegExp(
        `(?:export\\s+const\\s+${method}|(?:const|let|var)\\s+${method})\\s*=\\s*defineAPI\\s*\\(\\s*\\{[^}]*capability\\s*:\\s*["']write["']`,
        "s"
      );

      if (writeCapabilityPattern.test(source)) {
        // Check if the same block also has a policy field
        // We grab from the defineAPI call to the closing of its argument
        const blockPattern = new RegExp(
          `(?:export\\s+const\\s+${method}|(?:const|let|var)\\s+${method})\\s*=\\s*defineAPI\\s*\\(\\s*\\{([^]*?)handler\\s*:`,
          "s"
        );
        const blockMatch = source.match(blockPattern);
        const blockContent = blockMatch ? blockMatch[1] ?? "" : "";

        if (!blockContent.includes("policy")) {
          diagnostics.push({
            code: "write_missing_policy",
            severity: "warning",
            message: `${relPath}: ${method} handler has capability: "write" but no "policy" field`,
            hint: `Add policy: "requireAuth" to protect write endpoints from unauthorized access.`,
            file: route.filePath,
            fixCategory: "policy_violation",
            autoFixable: true,
          });
        }
      }
    }
  }

  return diagnostics;
}

async function checkModels(appRoot: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];

  const modelsDir = join(appRoot, "app", "models");
  if (!(await isDirectory(modelsDir))) {
    // Models directory is optional — not an error
    return diagnostics;
  }

  const files = await walkFiles(modelsDir, modelsDir);
  const modelFiles = files.filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.startsWith("_"),
  );

  if (modelFiles.length === 0) {
    diagnostics.push({
      code: "empty_models_dir",
      severity: "info",
      message: "app/models/ exists but contains no model files.",
    });
    return diagnostics;
  }

  for (const relFile of modelFiles) {
    const fullPath = join(modelsDir, relFile);
    const relFromRoot = relative(appRoot, fullPath);

    let source: string;
    try {
      source = await readFile(fullPath, "utf-8");
    } catch {
      diagnostics.push({
        code: "model_unreadable",
        severity: "error",
        message: `Cannot read model file: ${relFromRoot}`,
        file: fullPath,
        fixCategory: "missing_file",
      });
      continue;
    }

    // Check for at least one exported schema or model definition
    const hasExport =
      /export\s+(const|function|class|type|interface)\b/.test(source) ||
      /export\s*\{/.test(source);

    if (!hasExport) {
      diagnostics.push({
        code: "model_no_exports",
        severity: "warning",
        message: `${relFromRoot}: No exports found in model file`,
        hint: "Model files should export at least one schema, type, or class definition.",
        file: fullPath,
        fixCategory: "missing_export",
      });
    }

    // Check for common model patterns (Zod schemas, Drizzle tables, etc.)
    const hasSchema =
      /z\.\s*(object|string|number|boolean|enum|array)\s*\(/.test(source) ||
      /sqliteTable|pgTable|mysqlTable/.test(source) ||
      /defineModel/.test(source);

    if (!hasSchema && hasExport) {
      diagnostics.push({
        code: "model_no_schema",
        severity: "info",
        message: `${relFromRoot}: No recognized schema pattern found (Zod, Drizzle, or defineModel)`,
        hint: "Consider using Zod schemas or Drizzle table definitions for type-safe models.",
        file: fullPath,
      });
    }
  }

  return diagnostics;
}

async function checkTypeScript(appRoot: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];

  // Locate tsc binary — first check local node_modules, then fall back to
  // the monorepo root.
  let tscBinary = join(appRoot, "node_modules", ".bin", "tsc");
  if (!(await pathExists(tscBinary))) {
    // Try the monorepo root from @zauso-ai/capstan-core's location
    const packageDir = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(packageDir, "../../..");
    const repoTsc = join(repoRoot, "node_modules", ".bin", "tsc");
    if (await pathExists(repoTsc)) {
      tscBinary = repoTsc;
    } else {
      diagnostics.push({
        code: "tsc_not_found",
        severity: "error",
        message: "TypeScript compiler (tsc) not found in node_modules",
        hint: "Install TypeScript: npm install -D typescript",
        fixCategory: "missing_file",
      });
      return diagnostics;
    }
  }

  try {
    await execFileAsync(tscBinary, ["--noEmit", "--pretty", "false"], {
      cwd: appRoot,
      timeout: 60_000,
    });
    // Exit code 0 — no errors
  } catch (err: unknown) {
    // tsc exits with code 1+ when there are errors. The stderr/stdout
    // contains the diagnostic output.
    const execError = err as { stdout?: string; stderr?: string; code?: number };
    const output = (execError.stdout ?? "") + (execError.stderr ?? "");

    if (!output.trim()) {
      diagnostics.push({
        code: "tsc_unknown_failure",
        severity: "error",
        message: "TypeScript compiler exited with an error but produced no output.",
        hint: "Run tsc --noEmit manually to see what happened.",
        fixCategory: "type_error",
      });
      return diagnostics;
    }

    // Parse tsc output: file(line,col): error TSxxxx: message
    const pattern =
      /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\): error (?<tscode>TS\d+): (?<message>.+)$/gm;

    for (const match of output.matchAll(pattern)) {
      const groups = match.groups;
      if (!groups) continue;

      const file = groups["file"] ?? "";
      const message = groups["message"] ?? "Unknown TypeScript error";
      const tsCode = groups["tscode"] ?? "TS0000";

      diagnostics.push({
        code: `typescript_${tsCode}`,
        severity: "error",
        message: `${relative(appRoot, file)}:${groups["line"]} — ${message}`,
        hint: suggestTypeHint(message),
        file: resolve(appRoot, file),
        line: Number(groups["line"]),
        column: Number(groups["column"]),
        fixCategory: "type_error",
        autoFixable: false,
      });
    }

    // If the pattern didn't match anything, report the raw output
    if (diagnostics.length === 0) {
      diagnostics.push({
        code: "tsc_parse_failure",
        severity: "error",
        message: `TypeScript errors detected but could not be parsed. Raw output:\n${output.slice(0, 500)}`,
        hint: "Run tsc --noEmit manually to see the full output.",
        fixCategory: "type_error",
      });
    }
  }

  return diagnostics;
}

async function checkContracts(appRoot: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];

  const routesDir = join(appRoot, "app", "routes");
  const modelsDir = join(appRoot, "app", "models");
  const policiesDir = join(appRoot, "app", "policies");

  // Gather route names (directory names under app/routes/)
  const routeNames = new Set<string>();
  if (await isDirectory(routesDir)) {
    try {
      const entries = await readdir(routesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          routeNames.add(entry.name.toLowerCase());
        }
      }
    } catch {
      // Ignore read errors — structure step would have caught missing dir
    }
  }

  // Gather model names (filename stems under app/models/)
  const modelNames = new Set<string>();
  if (await isDirectory(modelsDir)) {
    const modelFiles = await walkFiles(modelsDir, modelsDir);
    for (const f of modelFiles) {
      if (f.endsWith(".ts") && !f.endsWith(".d.ts")) {
        // "ticket.ts" -> "ticket"
        const stem = f.replace(/\.ts$/, "").split("/").pop();
        if (stem) modelNames.add(stem.toLowerCase());
      }
    }
  }

  // Gather defined policy keys
  const policyKeys = new Set<string>();
  if (await isDirectory(policiesDir)) {
    const policyFiles = await walkFiles(policiesDir, policiesDir);
    for (const f of policyFiles) {
      if (!f.endsWith(".ts") || f.endsWith(".d.ts")) continue;
      const fullPath = join(policiesDir, f);
      try {
        const source = await readFile(fullPath, "utf-8");
        // Match: definePolicy({ key: "someKey" ... })
        const keyPattern = /definePolicy\s*\(\s*\{[^}]*key\s*:\s*["']([^"']+)["']/g;
        for (const match of source.matchAll(keyPattern)) {
          if (match[1]) policyKeys.add(match[1]);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  // Cross-reference models and routes: if model "ticket" exists and route "tickets" exists,
  // check they reference each other (informational)
  for (const model of modelNames) {
    // Simple pluralization: "ticket" -> "tickets"
    const plural = model.endsWith("s") ? model : model + "s";
    if (routeNames.has(plural) || routeNames.has(model)) {
      // This is expected — no diagnostic needed, they match.
      continue;
    }
    // Model exists without matching route — informational
    diagnostics.push({
      code: "model_without_route",
      severity: "info",
      message: `Model "${model}" has no matching route directory (expected "${plural}" or "${model}")`,
      hint: `Consider creating app/routes/${plural}/ with API handlers for this model.`,
      fixCategory: "contract_drift",
    });
  }

  // Check API route files for meta.resource references to models
  if (await isDirectory(routesDir)) {
    const { scanRoutes } = await import("@zauso-ai/capstan-router");
    const manifest = await scanRoutes(routesDir);
    const apiRoutes = manifest.routes.filter((r) => r.type === "api");

    for (const route of apiRoutes) {
      const relPath = relative(appRoot, route.filePath);
      let source: string;
      try {
        source = await readFile(route.filePath, "utf-8");
      } catch {
        continue;
      }

      // Check resource references: resource: "ticket"
      const resourcePattern = /resource\s*:\s*["']([^"']+)["']/g;
      for (const match of source.matchAll(resourcePattern)) {
        const resource = match[1]?.toLowerCase();
        if (resource && !modelNames.has(resource)) {
          diagnostics.push({
            code: "resource_no_model",
            severity: "warning",
            message: `${relPath}: references resource "${resource}" but no matching model file found`,
            hint: `Create app/models/${resource}.ts with the schema for this resource.`,
            file: route.filePath,
            fixCategory: "contract_drift",
          });
        }
      }

      // Check policy references: policy: "requireAuth"
      const policyPattern = /policy\s*:\s*["']([^"']+)["']/g;
      for (const match of source.matchAll(policyPattern)) {
        const policyRef = match[1];
        if (policyRef && !policyKeys.has(policyRef)) {
          diagnostics.push({
            code: "policy_not_defined",
            severity: "error",
            message: `${relPath}: references policy "${policyRef}" but it is not defined`,
            hint: `Define the "${policyRef}" policy in app/policies/index.ts using definePolicy().`,
            file: route.filePath,
            fixCategory: "policy_violation",
          });
        }
      }
    }
  }

  return diagnostics;
}

async function checkManifest(appRoot: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];

  const routesDir = join(appRoot, "app", "routes");
  if (!(await isDirectory(routesDir))) {
    return diagnostics;
  }

  // Generate a fresh manifest from the current routes
  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const { generateRouteManifest } = await import("@zauso-ai/capstan-router");

  const routeManifest = await scanRoutes(routesDir);
  const { apiRoutes } = generateRouteManifest(routeManifest);

  if (apiRoutes.length === 0) {
    diagnostics.push({
      code: "manifest_empty",
      severity: "warning",
      message: "Agent manifest has no API routes.",
      hint: "Add at least one .api.ts file under app/routes/ to generate capabilities.",
    });
    return diagnostics;
  }

  // For each API route, verify basic expectations
  for (const apiRoute of apiRoutes) {
    const relPath = relative(appRoot, apiRoute.filePath);

    // Verify the route file actually exists
    if (!(await pathExists(apiRoute.filePath))) {
      diagnostics.push({
        code: "manifest_orphan_route",
        severity: "error",
        message: `Manifest references ${apiRoute.method} ${apiRoute.path} but file is missing: ${relPath}`,
        file: apiRoute.filePath,
        fixCategory: "contract_drift",
      });
    }
  }

  // Check for API route files that exist on disk but are NOT in the manifest
  const manifestFilePaths = new Set(apiRoutes.map((r) => r.filePath));
  const diskApiRoutes = routeManifest.routes.filter((r) => r.type === "api");

  for (const route of diskApiRoutes) {
    if (!manifestFilePaths.has(route.filePath)) {
      diagnostics.push({
        code: "manifest_missing_route",
        severity: "warning",
        message: `API route ${relative(appRoot, route.filePath)} exists on disk but not in manifest`,
        file: route.filePath,
        fixCategory: "contract_drift",
      });
    }
  }

  // Check that each route file exports input/output schemas (informational)
  for (const apiRoute of apiRoutes) {
    let source: string;
    try {
      source = await readFile(apiRoute.filePath, "utf-8");
    } catch {
      continue;
    }

    // Look for defineAPI calls with input and output schemas
    const hasInput = /\binput\s*:/.test(source);
    const hasOutput = /\boutput\s*:/.test(source);

    if (!hasInput || !hasOutput) {
      const missing = [];
      if (!hasInput) missing.push("input");
      if (!hasOutput) missing.push("output");

      diagnostics.push({
        code: "manifest_missing_schema",
        severity: "info",
        message: `${relative(appRoot, apiRoute.filePath)}: ${apiRoute.method} handler missing ${missing.join(" and ")} schema`,
        hint: "Add Zod input/output schemas to defineAPI() for full agent introspection.",
        file: apiRoute.filePath,
        fixCategory: "schema_mismatch",
      });
    }
  }

  return diagnostics;
}

async function checkCrossProtocol(appRoot: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];

  const routesDir = join(appRoot, "app", "routes");
  if (!(await isDirectory(routesDir))) {
    return diagnostics;
  }

  // ---- 1. Build a CapabilityRegistry from the route manifest ----

  const { scanRoutes } = await import("@zauso-ai/capstan-router");
  const routeManifest = await scanRoutes(routesDir);
  const apiRoutes = routeManifest.routes.filter((r) => r.type === "api");

  if (apiRoutes.length === 0) {
    return diagnostics;
  }

  // Build RouteRegistryEntry list by reading source files for defineAPI metadata
  const { CapabilityRegistry } = await import("@zauso-ai/capstan-agent");
  const { routeToToolName } = await import("@zauso-ai/capstan-agent");

  // Minimal config for projection
  const agentConfig = { name: "verify-check", description: "Cross-protocol verification" };
  const registry = new CapabilityRegistry(agentConfig);

  // Parse defineAPI metadata from each route file
  interface ParsedRoute {
    method: string;
    path: string;
    filePath: string;
    description?: string;
    capability?: "read" | "write" | "external";
    resource?: string;
    inputSchemaText?: string;
    outputSchemaText?: string;
    hasDefineAPI: boolean;
  }

  const parsedRoutes: ParsedRoute[] = [];

  for (const route of apiRoutes) {
    let source: string;
    try {
      source = await readFile(route.filePath, "utf-8");
    } catch {
      continue;
    }

    const methods = (route.methods ?? ["GET"]) as string[];

    for (const method of methods) {
      // Check if this method handler uses defineAPI
      const defineAPIPattern = new RegExp(
        `(?:export\\s+const\\s+${method}|(?:const|let|var)\\s+${method})\\s*=\\s*defineAPI\\s*\\(`,
      );
      const hasDefineAPI = defineAPIPattern.test(source);

      // Extract description
      const descPattern = new RegExp(
        `(?:export\\s+const\\s+${method}|(?:const|let|var)\\s+${method})\\s*=\\s*defineAPI\\s*\\(\\s*\\{[^]*?description\\s*:\\s*["']([^"']+)["']`,
        "s",
      );
      const descMatch = source.match(descPattern);
      const description = descMatch?.[1];

      // Extract capability
      const capPattern = new RegExp(
        `(?:export\\s+const\\s+${method}|(?:const|let|var)\\s+${method})\\s*=\\s*defineAPI\\s*\\(\\s*\\{[^]*?capability\\s*:\\s*["'](read|write|external)["']`,
        "s",
      );
      const capMatch = source.match(capPattern);
      const capability = capMatch?.[1] as "read" | "write" | "external" | undefined;

      // Extract resource
      const resPattern = new RegExp(
        `(?:export\\s+const\\s+${method}|(?:const|let|var)\\s+${method})\\s*=\\s*defineAPI\\s*\\(\\s*\\{[^]*?resource\\s*:\\s*["']([^"']+)["']`,
        "s",
      );
      const resMatch = source.match(resPattern);
      const resource = resMatch?.[1];

      // Check for input/output schema presence
      const blockPattern = new RegExp(
        `(?:export\\s+const\\s+${method}|(?:const|let|var)\\s+${method})\\s*=\\s*defineAPI\\s*\\(\\s*\\{([^]*?)handler\\s*:`,
        "s",
      );
      const blockMatch = source.match(blockPattern);
      const blockContent = blockMatch?.[1] ?? "";

      const hasInput = /\binput\s*:/.test(blockContent);
      const hasOutput = /\boutput\s*:/.test(blockContent);

      const parsed: ParsedRoute = {
        method,
        path: route.urlPattern,
        filePath: route.filePath,
        ...(description !== undefined ? { description } : {}),
        ...(capability !== undefined ? { capability } : {}),
        ...(resource !== undefined ? { resource } : {}),
        hasDefineAPI,
      };

      if (hasInput) parsed.inputSchemaText = "present";
      if (hasOutput) parsed.outputSchemaText = "present";

      parsedRoutes.push(parsed);

      // Register with the capability registry if it has defineAPI metadata
      if (hasDefineAPI) {
        registry.register({
          method,
          path: route.urlPattern,
          ...(description !== undefined ? { description } : {}),
          ...(capability !== undefined ? { capability } : {}),
          ...(resource !== undefined ? { resource } : {}),
        });
      }
    }
  }

  const registeredRoutes = registry.getRoutes();

  if (registeredRoutes.length === 0) {
    diagnostics.push({
      code: "cross_protocol_no_capabilities",
      severity: "info",
      message:
        "No defineAPI() routes with capability metadata found. Cross-protocol checks skipped.",
    });
    return diagnostics;
  }

  // ---- 2. Generate OpenAPI spec ----
  const openApiSpec = registry.toOpenApi() as {
    paths?: Record<string, Record<string, Record<string, unknown>>>;
  };
  const openApiPaths = openApiSpec.paths ?? {};

  // ---- 3. Generate MCP tool definitions ----
  // We use a no-op executor since we only need the definitions
  const noopExecutor = async () => ({});
  const { getToolDefinitions } = registry.toMcp(noopExecutor);
  const mcpTools = getToolDefinitions();

  // ---- 4. Generate A2A skill definitions ----
  const { getAgentCard } = registry.toA2A(noopExecutor);
  const a2aCard = getAgentCard();
  const a2aSkills = a2aCard.skills;

  // Build lookup maps
  const mcpToolsByName = new Map(mcpTools.map((t) => [t.name, t]));
  const a2aSkillsById = new Map(a2aSkills.map((s) => [s.id, s]));

  // Build a set of OpenAPI operation keys: "METHOD /path"
  const openApiOperations = new Set<string>();
  for (const [oaPath, methods] of Object.entries(openApiPaths)) {
    for (const method of Object.keys(methods)) {
      // Convert OpenAPI path back to Capstan-style for comparison
      const capstanPath = oaPath.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, ":$1");
      openApiOperations.add(`${method.toUpperCase()} ${capstanPath}`);
    }
  }

  // ---- 5. Validate consistency ----

  for (const route of registeredRoutes) {
    const relPath = parsedRoutes.find(
      (p) => p.method === route.method && p.path === route.path,
    )?.filePath;
    const relFile = relPath ? relative(appRoot, relPath) : `${route.method} ${route.path}`;

    const toolName = routeToToolName(route.method, route.path);
    const routeKey = `${route.method.toUpperCase()} ${route.path}`;

    // 5a. Every registered route should have a corresponding MCP tool
    const mcpTool = mcpToolsByName.get(toolName);
    if (!mcpTool) {
      diagnostics.push({
        code: "cross_protocol_missing_mcp_tool",
        severity: "error",
        message: `${relFile}: ${routeKey} has no corresponding MCP tool (expected "${toolName}")`,
        hint: `Ensure the route is registered with CapabilityRegistry so it is projected as an MCP tool.`,
        ...(relPath !== undefined ? { file: relPath } : {}),
        fixCategory: "protocol_drift",
        autoFixable: false,
      });
    }

    // 5b. Every registered route should have a corresponding OpenAPI path
    if (!openApiOperations.has(routeKey)) {
      diagnostics.push({
        code: "cross_protocol_missing_openapi_path",
        severity: "error",
        message: `${relFile}: ${routeKey} has no corresponding OpenAPI path`,
        hint: `Ensure the route is registered with CapabilityRegistry so it appears in the OpenAPI spec.`,
        ...(relPath !== undefined ? { file: relPath } : {}),
        fixCategory: "protocol_drift",
        autoFixable: false,
      });
    }

    // 5c. Every registered route should have a corresponding A2A skill
    const a2aSkill = a2aSkillsById.get(toolName);
    if (!a2aSkill) {
      diagnostics.push({
        code: "cross_protocol_missing_a2a_skill",
        severity: "error",
        message: `${relFile}: ${routeKey} has no corresponding A2A skill (expected id "${toolName}")`,
        hint: `Ensure the route is registered with CapabilityRegistry so it is projected as an A2A skill.`,
        ...(relPath !== undefined ? { file: relPath } : {}),
        fixCategory: "protocol_drift",
        autoFixable: false,
      });
    }

    // 5d. Description consistency across protocols
    if (route.description && mcpTool && a2aSkill) {
      if (mcpTool.description !== route.description) {
        diagnostics.push({
          code: "cross_protocol_description_mismatch_mcp",
          severity: "warning",
          message: `${relFile}: ${routeKey} description differs between HTTP ("${route.description}") and MCP tool ("${mcpTool.description}")`,
          hint: `Descriptions should be identical across protocols. Update the MCP projection logic or the defineAPI() description.`,
          ...(relPath !== undefined ? { file: relPath } : {}),
          fixCategory: "protocol_drift",
          autoFixable: true,
        });
      }

      // A2A skill uses "name" for the description when description is not set,
      // and "description" when it is set. Check both.
      const a2aDescription = a2aSkill.description ?? a2aSkill.name;
      if (a2aDescription !== route.description) {
        diagnostics.push({
          code: "cross_protocol_description_mismatch_a2a",
          severity: "warning",
          message: `${relFile}: ${routeKey} description differs between HTTP ("${route.description}") and A2A skill ("${a2aDescription}")`,
          hint: `Descriptions should be identical across protocols. Update the A2A projection logic or the defineAPI() description.`,
          ...(relPath !== undefined ? { file: relPath } : {}),
          fixCategory: "protocol_drift",
          autoFixable: true,
        });
      }
    }

    // 5e. Input/output schema consistency across protocols
    if (route.inputSchema) {
      // Check MCP tool input schema matches
      if (mcpTool) {
        const mcpInputSchema = mcpTool.inputSchema as Record<string, unknown> | undefined;
        if (!mcpInputSchema) {
          diagnostics.push({
            code: "cross_protocol_input_schema_missing_mcp",
            severity: "warning",
            message: `${relFile}: ${routeKey} has an input schema but the MCP tool "${toolName}" has none`,
            hint: `The input schema should be projected identically to the MCP tool definition.`,
            ...(relPath !== undefined ? { file: relPath } : {}),
            fixCategory: "protocol_drift",
            autoFixable: true,
          });
        } else {
          // Deep compare the schemas
          const httpInput = JSON.stringify(route.inputSchema);
          const mcpInput = JSON.stringify(mcpInputSchema);
          if (httpInput !== mcpInput) {
            diagnostics.push({
              code: "cross_protocol_input_schema_drift_mcp",
              severity: "error",
              message: `${relFile}: ${routeKey} input schema differs between HTTP and MCP tool "${toolName}"`,
              hint: `Input schemas must be derived from the same Zod schema. Check that the registry projects the inputSchema unchanged.`,
              ...(relPath !== undefined ? { file: relPath } : {}),
              fixCategory: "protocol_drift",
              autoFixable: false,
            });
          }
        }
      }

      // Check A2A skill input schema matches
      if (a2aSkill) {
        if (!a2aSkill.inputSchema) {
          diagnostics.push({
            code: "cross_protocol_input_schema_missing_a2a",
            severity: "warning",
            message: `${relFile}: ${routeKey} has an input schema but the A2A skill "${toolName}" has none`,
            hint: `The input schema should be projected identically to the A2A skill definition.`,
            ...(relPath !== undefined ? { file: relPath } : {}),
            fixCategory: "protocol_drift",
            autoFixable: true,
          });
        } else {
          const httpInput = JSON.stringify(route.inputSchema);
          const a2aInput = JSON.stringify(a2aSkill.inputSchema);
          if (httpInput !== a2aInput) {
            diagnostics.push({
              code: "cross_protocol_input_schema_drift_a2a",
              severity: "error",
              message: `${relFile}: ${routeKey} input schema differs between HTTP and A2A skill "${toolName}"`,
              hint: `Input schemas must be derived from the same Zod schema. Check that the registry projects the inputSchema unchanged.`,
              ...(relPath !== undefined ? { file: relPath } : {}),
              fixCategory: "protocol_drift",
              autoFixable: false,
            });
          }
        }
      }
    }

    if (route.outputSchema) {
      // A2A skills carry outputSchema; OpenAPI uses response schema
      if (a2aSkill) {
        if (!a2aSkill.outputSchema) {
          diagnostics.push({
            code: "cross_protocol_output_schema_missing_a2a",
            severity: "warning",
            message: `${relFile}: ${routeKey} has an output schema but the A2A skill "${toolName}" has none`,
            hint: `The output schema should be projected identically to the A2A skill definition.`,
            ...(relPath !== undefined ? { file: relPath } : {}),
            fixCategory: "protocol_drift",
            autoFixable: true,
          });
        } else {
          const httpOutput = JSON.stringify(route.outputSchema);
          const a2aOutput = JSON.stringify(a2aSkill.outputSchema);
          if (httpOutput !== a2aOutput) {
            diagnostics.push({
              code: "cross_protocol_output_schema_drift_a2a",
              severity: "error",
              message: `${relFile}: ${routeKey} output schema differs between HTTP and A2A skill "${toolName}"`,
              hint: `Output schemas must be derived from the same Zod schema. Check that the registry projects the outputSchema unchanged.`,
              ...(relPath !== undefined ? { file: relPath } : {}),
              fixCategory: "protocol_drift",
              autoFixable: false,
            });
          }
        }
      }
    }
  }

  // 5f. Check for MCP tools that have no corresponding registered route (orphaned tools)
  for (const tool of mcpTools) {
    const matchesRoute = registeredRoutes.some(
      (r) => routeToToolName(r.method, r.path) === tool.name,
    );
    if (!matchesRoute) {
      diagnostics.push({
        code: "cross_protocol_orphan_mcp_tool",
        severity: "warning",
        message: `MCP tool "${tool.name}" has no corresponding registered HTTP route`,
        hint: `Remove the orphaned MCP tool or register the missing route.`,
        fixCategory: "protocol_drift",
        autoFixable: false,
      });
    }
  }

  // 5g. Check for A2A skills that have no corresponding registered route (orphaned skills)
  for (const skill of a2aSkills) {
    const matchesRoute = registeredRoutes.some(
      (r) => routeToToolName(r.method, r.path) === skill.id,
    );
    if (!matchesRoute) {
      diagnostics.push({
        code: "cross_protocol_orphan_a2a_skill",
        severity: "warning",
        message: `A2A skill "${skill.id}" has no corresponding registered HTTP route`,
        hint: `Remove the orphaned A2A skill or register the missing route.`,
        fixCategory: "protocol_drift",
        autoFixable: false,
      });
    }
  }

  // 5h. Check for defineAPI routes missing capability metadata
  for (const parsed of parsedRoutes) {
    if (parsed.hasDefineAPI && !parsed.capability) {
      const relFile = relative(appRoot, parsed.filePath);
      diagnostics.push({
        code: "cross_protocol_missing_capability",
        severity: "warning",
        message: `${relFile}: ${parsed.method} ${parsed.path} uses defineAPI() but has no "capability" field`,
        hint: `Add capability: "read" | "write" | "external" to enable multi-protocol projection.`,
        file: parsed.filePath,
        fixCategory: "protocol_drift",
        autoFixable: true,
      });
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Verify a Capstan runtime application.
 *
 * Runs a cascade of checks: structure -> config -> routes -> models ->
 * typecheck -> contracts -> manifest -> contracts-cross-protocol. If an
 * early step fails, dependent steps are skipped. Returns a structured
 * VerifyReport suitable for both human display and AI agent consumption.
 */
export async function verifyCapstanApp(appRoot: string): Promise<VerifyReport> {
  const root = resolve(appRoot);
  const steps: VerifyStep[] = [];

  // Step 1: structure
  const structureStep = await measureStep("structure", () => checkStructure(root));
  steps.push(structureStep);

  if (structureStep.status === "failed") {
    steps.push(skippedStep("config", "Skipped: structure check failed."));
    steps.push(skippedStep("routes", "Skipped: structure check failed."));
    steps.push(skippedStep("models", "Skipped: structure check failed."));
    steps.push(skippedStep("typecheck", "Skipped: structure check failed."));
    steps.push(skippedStep("contracts", "Skipped: structure check failed."));
    steps.push(skippedStep("manifest", "Skipped: structure check failed."));
    steps.push(skippedStep("contracts-cross-protocol", "Skipped: structure check failed."));
    return buildReport(root, steps);
  }

  // Step 2: config
  const configStep = await measureStep("config", () => checkConfig(root));
  steps.push(configStep);

  if (configStep.status === "failed") {
    steps.push(skippedStep("routes", "Skipped: config check failed."));
    steps.push(skippedStep("models", "Skipped: config check failed."));
    steps.push(skippedStep("typecheck", "Skipped: config check failed."));
    steps.push(skippedStep("contracts", "Skipped: config check failed."));
    steps.push(skippedStep("manifest", "Skipped: config check failed."));
    steps.push(skippedStep("contracts-cross-protocol", "Skipped: config check failed."));
    return buildReport(root, steps);
  }

  // Step 3: routes
  const routesStep = await measureStep("routes", () => checkRoutes(root));
  steps.push(routesStep);

  // Step 4: models — runs even if routes fail (independent check)
  const modelsStep = await measureStep("models", () => checkModels(root));
  steps.push(modelsStep);

  // Step 5: typecheck — runs even if routes/models have warnings, but skip
  // if routes had hard errors (broken files will cause tsc noise)
  if (routesStep.status === "failed") {
    steps.push(skippedStep("typecheck", "Skipped: routes check failed."));
    steps.push(skippedStep("contracts", "Skipped: routes check failed."));
    steps.push(skippedStep("manifest", "Skipped: routes check failed."));
    steps.push(skippedStep("contracts-cross-protocol", "Skipped: routes check failed."));
    return buildReport(root, steps);
  }

  const typecheckStep = await measureStep("typecheck", () => checkTypeScript(root));
  steps.push(typecheckStep);

  if (typecheckStep.status === "failed") {
    steps.push(skippedStep("contracts", "Skipped: typecheck failed."));
    steps.push(skippedStep("manifest", "Skipped: typecheck failed."));
    steps.push(skippedStep("contracts-cross-protocol", "Skipped: typecheck failed."));
    return buildReport(root, steps);
  }

  // Step 6: contracts
  const contractsStep = await measureStep("contracts", () => checkContracts(root));
  steps.push(contractsStep);

  if (contractsStep.status === "failed") {
    steps.push(skippedStep("manifest", "Skipped: contracts check failed."));
    steps.push(skippedStep("contracts-cross-protocol", "Skipped: contracts check failed."));
    return buildReport(root, steps);
  }

  // Step 7: manifest
  const manifestStep = await measureStep("manifest", () => checkManifest(root));
  steps.push(manifestStep);

  if (manifestStep.status === "failed") {
    steps.push(skippedStep("contracts-cross-protocol", "Skipped: manifest check failed."));
    return buildReport(root, steps);
  }

  // Step 8: cross-protocol contract consistency
  const crossProtocolStep = await measureStep("contracts-cross-protocol", () =>
    checkCrossProtocol(root),
  );
  steps.push(crossProtocolStep);

  return buildReport(root, steps);
}

// ---------------------------------------------------------------------------
// Human-readable report renderer
// ---------------------------------------------------------------------------

/**
 * Render a VerifyReport as human-readable text output.
 *
 * Uses simple ASCII indicators: check mark for pass, x for fail, dash for skip.
 */
export function renderRuntimeVerifyText(report: VerifyReport): string {
  const lines: string[] = [];

  lines.push("Capstan Verify");
  lines.push("");

  for (const step of report.steps) {
    const icon =
      step.status === "passed" ? "\u2713" : step.status === "failed" ? "\u2717" : "-";
    const durationLabel =
      step.status === "skipped" ? "skipped" : `${step.durationMs}ms`;

    lines.push(`  ${icon} ${step.name.padEnd(14)} (${durationLabel})`);

    // Show error/warning diagnostics inline
    for (const d of step.diagnostics) {
      if (d.severity === "info") continue;

      const marker = d.severity === "error" ? "\u2717" : "!";
      lines.push(`    ${marker} ${d.message}`);
      if (d.hint) {
        lines.push(`      \u2192 ${d.hint}`);
      }
    }
  }

  lines.push("");
  lines.push(
    `  ${report.summary.errorCount} error${report.summary.errorCount !== 1 ? "s" : ""}, ${report.summary.warningCount} warning${report.summary.warningCount !== 1 ? "s" : ""}`,
  );

  if (report.repairChecklist.length > 0) {
    lines.push("");
    lines.push("  Repair Checklist:");
    for (const item of report.repairChecklist) {
      lines.push(`    ${item.index}. [${item.step}] ${item.message}`);
      if (item.hint) {
        lines.push(`       \u2192 ${item.hint}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

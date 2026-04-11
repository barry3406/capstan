import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { VerifyDiagnostic } from "./verify-types.js";

interface PackageJsonShape {
  name?: unknown;
  private?: unknown;
  type?: unknown;
  packageManager?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
}

type ScriptMap = Record<string, string>;

const REQUIRED_SCRIPTS = [
  {
    name: "dev",
    commandHint: "capstan dev",
    message: "Add a dev script that boots the Capstan development server.",
  },
  {
    name: "build",
    commandHint: "capstan build",
    message: "Add a build script that emits the production Capstan bundle.",
  },
  {
    name: "verify",
    commandHint: "capstan verify --json",
    message: "Add a verify script so agents can run structured verification consistently.",
  },
] as const;

const CAPSTAN_SCRIPT_NAMES = new Set(["dev", "build", "start", "verify"]);
const SUPPORTED_PACKAGE_MANAGER_PREFIXES = ["npm@", "pnpm@", "yarn@", "bun@"];
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function pathFor(appRoot: string): string {
  return join(appRoot, "package.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScriptMap(value: unknown): value is ScriptMap {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isDependencyMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function normalizeScripts(value: unknown): ScriptMap {
  return isScriptMap(value) ? value : {};
}

function hasCapstanCommand(script: string, command: string): boolean {
  const normalized = script.toLowerCase();
  return normalized.includes(command) || normalized.includes(`bunx ${command}`) || normalized.includes(`npx ${command}`);
}

function collectDependencyNames(packageJson: PackageJsonShape): Set<string> {
  const names = new Set<string>();

  if (isDependencyMap(packageJson.dependencies)) {
    for (const name of Object.keys(packageJson.dependencies)) {
      names.add(name);
    }
  }
  if (isDependencyMap(packageJson.devDependencies)) {
    for (const name of Object.keys(packageJson.devDependencies)) {
      names.add(name);
    }
  }

  return names;
}

function validatePackageName(packageJson: PackageJsonShape, diagnostics: VerifyDiagnostic[]): void {
  if (typeof packageJson.name !== "string" || packageJson.name.trim() === "") {
    diagnostics.push({
      code: "package_name_missing",
      severity: "error",
      message: "package.json must declare a non-empty package name.",
      hint: `Add a "name" field such as "my-capstan-app".`,
      file: "package.json",
      fixCategory: "package_contract",
      autoFixable: true,
    });
    return;
  }

  if (!PACKAGE_NAME_RE.test(packageJson.name)) {
    diagnostics.push({
      code: "package_name_invalid",
      severity: "error",
      message: `package.json name "${packageJson.name}" is not npm-compatible.`,
      hint: "Use lowercase letters, numbers, dots, underscores, dashes, and at most one npm scope prefix.",
      file: "package.json",
      fixCategory: "package_contract",
      autoFixable: false,
    });
  }
}

function validatePackageManager(packageJson: PackageJsonShape, diagnostics: VerifyDiagnostic[]): void {
  if (typeof packageJson.packageManager !== "string" || packageJson.packageManager.trim() === "") {
    diagnostics.push({
      code: "package_manager_missing",
      severity: "warning",
      message: "package.json does not declare a packageManager field.",
      hint: 'Pin the toolchain with a field like "packageManager": "npm@11.9.0".',
      file: "package.json",
      fixCategory: "package_contract",
      autoFixable: true,
    });
    return;
  }

  const packageManager = packageJson.packageManager;
  if (
    typeof packageManager !== "string" ||
    !SUPPORTED_PACKAGE_MANAGER_PREFIXES.some((prefix) => packageManager.startsWith(prefix))
  ) {
    diagnostics.push({
      code: "package_manager_unrecognized",
      severity: "warning",
      message: `packageManager "${String(packageManager)}" is not one of the supported Capstan package managers.`,
      hint: `Use one of: ${SUPPORTED_PACKAGE_MANAGER_PREFIXES.join(", ")}.`,
      file: "package.json",
      fixCategory: "package_contract",
      autoFixable: false,
    });
  }
}

function validatePackageModuleType(packageJson: PackageJsonShape, diagnostics: VerifyDiagnostic[]): void {
  if (packageJson.type === undefined) {
    diagnostics.push({
      code: "package_type_missing",
      severity: "warning",
      message: 'package.json should declare "type": "module" to match Capstan-generated ESM output.',
      hint: 'Add `"type": "module"` to avoid Node runtime ambiguity between CJS and ESM.',
      file: "package.json",
      fixCategory: "package_contract",
      autoFixable: true,
    });
    return;
  }

  if (packageJson.type !== "module") {
    diagnostics.push({
      code: "package_type_invalid",
      severity: "error",
      message: `package.json type is "${String(packageJson.type)}", but Capstan projects are expected to run as ESM.`,
      hint: 'Set `"type": "module"` unless you have a very deliberate interoperability reason not to.',
      file: "package.json",
      fixCategory: "package_contract",
      autoFixable: true,
    });
  }
}

function validatePrivacyFlag(packageJson: PackageJsonShape, diagnostics: VerifyDiagnostic[]): void {
  if (packageJson.private === true) {
    return;
  }

  diagnostics.push({
    code: "package_private_missing",
    severity: "warning",
    message: "package.json should usually set private=true for application repos.",
    hint: 'Set `"private": true` unless this app is intentionally meant to be published to npm.',
    file: "package.json",
    fixCategory: "package_contract",
    autoFixable: true,
  });
}

function validateScripts(packageJson: PackageJsonShape, diagnostics: VerifyDiagnostic[]): void {
  const scripts = normalizeScripts(packageJson.scripts);

  if (!isRecord(packageJson.scripts)) {
    diagnostics.push({
      code: "package_scripts_missing",
      severity: "error",
      message: "package.json must declare a scripts object for deterministic app operations.",
      hint: 'Add scripts for "dev", "build", and "verify".',
      file: "package.json",
      fixCategory: "package_contract",
      autoFixable: true,
    });
    return;
  }

  for (const required of REQUIRED_SCRIPTS) {
    const script = scripts[required.name];
    if (!script) {
      diagnostics.push({
        code: `package_script_missing_${required.name}`,
        severity: "warning",
        message: `package.json is missing a "${required.name}" script.`,
        hint: `${required.message} A typical value is "${required.commandHint}".`,
        file: "package.json",
        fixCategory: "package_contract",
        autoFixable: true,
      });
      continue;
    }

    if (!hasCapstanCommand(script, "capstan")) {
      diagnostics.push({
        code: `package_script_non_capstan_${required.name}`,
        severity: "warning",
        message: `The "${required.name}" script does not appear to invoke Capstan.`,
        hint: `Make sure "${required.name}" shells out to ${required.commandHint} rather than a stale framework command.`,
        file: "package.json",
        fixCategory: "package_contract",
        autoFixable: false,
      });
    }
  }

  for (const scriptName of CAPSTAN_SCRIPT_NAMES) {
    const script = scripts[scriptName];
    if (!script) {
      continue;
    }

    if (script.includes("next ") || script.includes("nextjs") || script.includes("vite ")) {
      diagnostics.push({
        code: `package_script_foreign_runtime_${scriptName}`,
        severity: "warning",
        message: `The "${scriptName}" script appears to call a non-Capstan runtime.`,
        hint: "If this is intentional, keep the contract documented; otherwise replace the stale command with the Capstan equivalent.",
        file: "package.json",
        fixCategory: "package_contract",
        autoFixable: false,
      });
    }
  }
}

function validateDependencySurface(packageJson: PackageJsonShape, diagnostics: VerifyDiagnostic[]): void {
  const dependencyNames = collectDependencyNames(packageJson);

  if (!dependencyNames.has("@zauso-ai/capstan-cli")) {
    diagnostics.push({
      code: "package_capstan_cli_missing",
      severity: "warning",
      message: "package.json does not depend on @zauso-ai/capstan-cli.",
      hint: "Add the CLI as a devDependency so build, dev, and verify scripts resolve consistently.",
      file: "package.json",
      fixCategory: "package_contract",
      autoFixable: true,
    });
  }

  if (dependencyNames.has("next")) {
    diagnostics.push({
      code: "package_next_dependency_present",
      severity: "warning",
      message: "package.json still includes next as a dependency.",
      hint: "If this app has migrated fully to Capstan, remove lingering Next.js dependencies to avoid mixed framework drift.",
      file: "package.json",
      fixCategory: "package_contract",
      autoFixable: false,
    });
  }
}

export async function checkPackageContracts(appRoot: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];
  const packageJsonPath = pathFor(appRoot);

  let raw: string;
  try {
    raw = await readFile(packageJsonPath, "utf-8");
  } catch (error) {
    diagnostics.push({
      code: "package_read_failed",
      severity: "error",
      message: "package.json exists but could not be read during verification.",
      hint: error instanceof Error ? error.message : String(error),
      file: "package.json",
      fixCategory: "package_contract",
      autoFixable: false,
    });
    return diagnostics;
  }

  let packageJson: PackageJsonShape;
  try {
    packageJson = JSON.parse(raw) as PackageJsonShape;
  } catch (error) {
    diagnostics.push({
      code: "package_json_invalid",
      severity: "error",
      message: "package.json is not valid JSON.",
      hint: error instanceof Error ? error.message : String(error),
      file: "package.json",
      fixCategory: "package_contract",
      autoFixable: false,
    });
    return diagnostics;
  }

  validatePackageName(packageJson, diagnostics);
  validatePackageManager(packageJson, diagnostics);
  validatePackageModuleType(packageJson, diagnostics);
  validatePrivacyFlag(packageJson, diagnostics);
  validateScripts(packageJson, diagnostics);
  validateDependencySurface(packageJson, diagnostics);

  return diagnostics;
}

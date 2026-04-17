import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

import type { VerifyDiagnostic } from "./verify-types.js";

interface DeployManifestShape {
  schemaVersion?: unknown;
  build?: {
    command?: unknown;
    mode?: unknown;
    distDir?: unknown;
    target?: unknown;
  };
  assets?: {
    copied?: unknown;
    staticHtmlDir?: unknown;
  };
  artifacts?: {
    routeManifest?: unknown;
    agentManifest?: unknown;
    openApiSpec?: unknown;
    serverEntry?: unknown;
    deployManifest?: unknown;
    publicDir?: unknown;
    staticDir?: unknown;
  };
  targets?: Record<string, unknown>;
  integrity?: {
    algorithm?: unknown;
    artifacts?: Record<string, unknown>;
    artifactGraph?: unknown;
  };
}

const BUILD_TARGETS = new Set([
  "node-standalone",
  "docker",
  "vercel-node",
  "vercel-edge",
  "cloudflare",
  "fly",
]);

const CONTRACT_FILES = [
  { key: "routeManifest", path: "dist/_capstan_manifest.json", required: true },
  { key: "agentManifest", path: "dist/agent-manifest.json", required: true },
  { key: "openApiSpec", path: "dist/openapi.json", required: true },
  { key: "serverEntry", path: "dist/_capstan_server.js", required: true },
  { key: "deployManifest", path: "dist/deploy-manifest.json", required: true },
] as const;

const SOURCE_DRIFT_CANDIDATES = [
  "capstan.config.ts",
  "capstan.config.js",
  "package.json",
  "tsconfig.json",
  "app",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function collectFiles(dir: string, files: string[] = []): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    const { readdir } = await import("node:fs/promises");
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf-8")) as unknown;
}

async function computeSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function collectLatestSourceMtime(appRoot: string): Promise<number> {
  let latest = 0;
  for (const candidate of SOURCE_DRIFT_CANDIDATES) {
    const target = join(appRoot, candidate);
    if (!await pathExists(target)) {
      continue;
    }

    if (await isDirectory(target)) {
      const files = await collectFiles(target);
      for (const filePath of files) {
        latest = Math.max(latest, (await stat(filePath)).mtimeMs);
      }
      continue;
    }

    latest = Math.max(latest, (await stat(target)).mtimeMs);
  }
  return latest;
}

function buildArtifactDiagnostic(
  code: string,
  message: string,
  hint: string,
  file?: string,
): VerifyDiagnostic {
  return {
    code,
    severity: "error",
    message,
    hint,
    ...(file ? { file } : {}),
    fixCategory: "build_contract",
    autoFixable: false,
  };
}

async function validateRequiredContractFiles(
  appRoot: string,
  diagnostics: VerifyDiagnostic[],
): Promise<void> {
  for (const contractFile of CONTRACT_FILES) {
    const absolutePath = join(appRoot, contractFile.path);
    if (await pathExists(absolutePath)) {
      continue;
    }
    diagnostics.push(
      buildArtifactDiagnostic(
        `build_missing_${contractFile.key}`,
        `${contractFile.path} is missing from the generated build output.`,
        "Run `capstan build` again and keep the dist directory intact.",
        contractFile.path,
      ),
    );
  }
}

async function validateDeployManifestShape(
  appRoot: string,
  deployManifestPath: string,
  diagnostics: VerifyDiagnostic[],
): Promise<DeployManifestShape | null> {
  let manifest: DeployManifestShape;
  try {
    manifest = await readJson(deployManifestPath) as DeployManifestShape;
  } catch (error) {
    diagnostics.push({
      code: "build_deploy_manifest_invalid_json",
      severity: "error",
      message: "dist/deploy-manifest.json is not valid JSON.",
      hint: error instanceof Error ? error.message : String(error),
      file: "dist/deploy-manifest.json",
      fixCategory: "build_contract",
      autoFixable: false,
    });
    return null;
  }

  if (manifest.schemaVersion !== 1) {
    diagnostics.push({
      code: "build_deploy_manifest_schema",
      severity: "error",
      message: "dist/deploy-manifest.json has an unexpected schemaVersion.",
      hint: "Rebuild the app with the current Capstan CLI to refresh the deployment contract.",
      file: "dist/deploy-manifest.json",
      fixCategory: "build_contract",
      autoFixable: false,
    });
  }

  if (!manifest.build || !isRecord(manifest.build)) {
    diagnostics.push(buildArtifactDiagnostic(
      "build_deploy_manifest_build_missing",
      "dist/deploy-manifest.json is missing the build section.",
      "Rebuild the app so the deployment contract is regenerated.",
      "dist/deploy-manifest.json",
    ));
    return manifest;
  }

  if (typeof manifest.build.distDir !== "string" || manifest.build.distDir.trim() === "") {
    diagnostics.push(buildArtifactDiagnostic(
      "build_deploy_manifest_dist_dir_missing",
      "dist/deploy-manifest.json is missing build.distDir.",
      "Rebuild the app so the deployment contract records the dist directory.",
      "dist/deploy-manifest.json",
    ));
  }

  if (manifest.build.target !== undefined && !BUILD_TARGETS.has(String(manifest.build.target))) {
    diagnostics.push(buildArtifactDiagnostic(
      "build_deploy_manifest_target_invalid",
      `dist/deploy-manifest.json declares an unsupported build target "${String(manifest.build.target)}".`,
      `Use one of: ${[...BUILD_TARGETS].join(", ")}.`,
      "dist/deploy-manifest.json",
    ));
  }

  if (!manifest.artifacts || !isRecord(manifest.artifacts)) {
    diagnostics.push(buildArtifactDiagnostic(
      "build_deploy_manifest_artifacts_missing",
      "dist/deploy-manifest.json is missing the artifacts section.",
      "Rebuild the app so the deployment contract records generated artifacts.",
      "dist/deploy-manifest.json",
    ));
    return manifest;
  }

  for (const contractFile of CONTRACT_FILES) {
    const artifactPath = manifest.artifacts[contractFile.key];
    if (typeof artifactPath !== "string" || artifactPath.trim() === "") {
      diagnostics.push(buildArtifactDiagnostic(
        `build_manifest_artifact_${contractFile.key}_missing`,
        `dist/deploy-manifest.json is missing artifacts.${contractFile.key}.`,
        "Rebuild the app so the deployment manifest can point at generated artifacts.",
        "dist/deploy-manifest.json",
      ));
      continue;
    }

    if (!await pathExists(resolve(appRoot, artifactPath))) {
      diagnostics.push(buildArtifactDiagnostic(
        `build_manifest_artifact_${contractFile.key}_missing_on_disk`,
        `${artifactPath} is referenced by dist/deploy-manifest.json but does not exist on disk.`,
        "Rebuild the app and ensure the dist directory has not been partially deleted.",
        artifactPath,
      ));
    }
  }

  if (manifest.assets?.copied === true) {
    const publicDir = manifest.artifacts.publicDir;
    if (typeof publicDir !== "string" || !await pathExists(resolve(appRoot, publicDir))) {
      diagnostics.push(buildArtifactDiagnostic(
        "build_public_assets_missing",
        "The deploy manifest says public assets were copied, but the generated public directory is missing.",
        "Rebuild the app and confirm app/public is copied into dist/public.",
        typeof publicDir === "string" ? publicDir : "dist/public",
      ));
    }
  }

  const staticDir = manifest.artifacts.staticDir;
  if (staticDir !== undefined && staticDir !== null) {
    if (typeof staticDir !== "string" || !await pathExists(resolve(appRoot, staticDir))) {
      diagnostics.push(buildArtifactDiagnostic(
        "build_static_dir_missing",
        "The deploy manifest references a static HTML directory that is missing on disk.",
        "Rebuild with `capstan build --static` and keep the generated dist/static output intact.",
        typeof staticDir === "string" ? staticDir : "dist/static",
      ));
    }
  }

  return manifest;
}

async function validateGeneratedJsonFiles(
  appRoot: string,
  diagnostics: VerifyDiagnostic[],
): Promise<void> {
  const jsonFiles = [
    {
      path: join(appRoot, "dist", "_capstan_manifest.json"),
      code: "build_route_manifest_invalid",
      description: "route manifest",
      validate(value: unknown): boolean {
        return isRecord(value) && Array.isArray(value.routes);
      },
    },
    {
      path: join(appRoot, "dist", "agent-manifest.json"),
      code: "build_agent_manifest_invalid",
      description: "agent manifest",
      validate(value: unknown): boolean {
        return isRecord(value) && typeof value.name === "string";
      },
    },
    {
      path: join(appRoot, "dist", "openapi.json"),
      code: "build_openapi_invalid",
      description: "OpenAPI document",
      validate(value: unknown): boolean {
        return isRecord(value) && typeof value.openapi === "string";
      },
    },
  ];

  for (const jsonFile of jsonFiles) {
    if (!await pathExists(jsonFile.path)) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = await readJson(jsonFile.path);
    } catch (error) {
      diagnostics.push(buildArtifactDiagnostic(
        jsonFile.code,
        `Generated ${jsonFile.description} is not valid JSON.`,
        error instanceof Error ? error.message : String(error),
        relative(appRoot, jsonFile.path),
      ));
      continue;
    }

    if (!jsonFile.validate(parsed)) {
      diagnostics.push(buildArtifactDiagnostic(
        `${jsonFile.code}_shape`,
        `Generated ${jsonFile.description} is missing the expected top-level contract fields.`,
        `Inspect ${relative(appRoot, jsonFile.path)} and rebuild the app to refresh the generated artifact.`,
        relative(appRoot, jsonFile.path),
      ));
    }
  }
}

async function validateStandaloneArtifacts(
  appRoot: string,
  manifest: DeployManifestShape | null,
  diagnostics: VerifyDiagnostic[],
): Promise<void> {
  const standaloneRoot = join(appRoot, "dist", "standalone");
  if (!await pathExists(standaloneRoot)) {
    return;
  }

  const required = [
    join(standaloneRoot, "package.json"),
    join(standaloneRoot, "dist", "deploy-manifest.json"),
  ];
  for (const path of required) {
    if (!await pathExists(path)) {
      diagnostics.push(buildArtifactDiagnostic(
        "build_standalone_missing_contract",
        `${relative(appRoot, path)} is missing from the standalone deployment bundle.`,
        "Rebuild with an explicit deployment target to regenerate the standalone runtime contract.",
        relative(appRoot, path),
      ));
    }
  }

  if (!manifest?.build || typeof manifest.build.target !== "string") {
    return;
  }

  const target = manifest.build.target;
  const targetFilesByBuild: Record<string, string[]> = {
    docker: ["dist/standalone/Dockerfile", "dist/standalone/.dockerignore"],
    fly: ["dist/standalone/Dockerfile", "dist/standalone/.dockerignore", "dist/standalone/fly.toml"],
    "vercel-node": ["dist/standalone/api/index.js", "dist/standalone/vercel.json"],
    "vercel-edge": ["dist/standalone/api/index.js", "dist/standalone/vercel.json"],
    cloudflare: ["dist/standalone/worker.js", "dist/standalone/wrangler.toml"],
  };

  for (const requiredPath of targetFilesByBuild[target] ?? []) {
    if (!await pathExists(join(appRoot, requiredPath))) {
      diagnostics.push(buildArtifactDiagnostic(
        "build_target_artifact_missing",
        `${requiredPath} is required for ${target} builds but is missing.`,
        `Rebuild with \`capstan build --target ${target}\` and keep the standalone bundle intact.`,
        requiredPath,
      ));
    }
  }
}

async function validateBuildFreshness(appRoot: string, diagnostics: VerifyDiagnostic[]): Promise<void> {
  const deployManifestPath = join(appRoot, "dist", "deploy-manifest.json");
  if (!await pathExists(deployManifestPath)) {
    return;
  }

  const latestSourceMtime = await collectLatestSourceMtime(appRoot);
  if (latestSourceMtime === 0) {
    return;
  }

  const buildMtime = (await stat(deployManifestPath)).mtimeMs;
  if (buildMtime + 1_000 < latestSourceMtime) {
    diagnostics.push({
      code: "build_artifacts_stale",
      severity: "warning",
      message: "Generated build artifacts appear older than the current source tree.",
      hint: "Run `capstan build` again before shipping so deployment artifacts match the current source.",
      file: "dist/deploy-manifest.json",
      fixCategory: "build_contract",
      autoFixable: true,
    });
  }
}

async function validateIntegrityRecords(
  appRoot: string,
  manifest: DeployManifestShape | null,
  diagnostics: VerifyDiagnostic[],
): Promise<void> {
  if (!manifest?.integrity || !isRecord(manifest.integrity)) {
    return;
  }

  if (manifest.integrity.algorithm !== "sha256") {
    diagnostics.push({
      code: "build_integrity_algorithm_invalid",
      severity: "warning",
      message: `The build integrity section declares unsupported algorithm "${String(manifest.integrity.algorithm)}".`,
      hint: 'Use "sha256" for generated artifact integrity records.',
      file: "dist/deploy-manifest.json",
      fixCategory: "build_contract",
      autoFixable: false,
    });
    return;
  }

  const artifacts = manifest.integrity.artifacts;
  const artifactGraph = Array.isArray(manifest.integrity.artifactGraph)
    ? manifest.integrity.artifactGraph
    : null;

  if (!isRecord(artifacts) && !artifactGraph) {
    diagnostics.push({
      code: "build_integrity_artifacts_missing",
      severity: "warning",
      message: "The build integrity section exists but does not include artifact hashes.",
      hint: "Rebuild the app with a CLI that records artifact hashes in dist/deploy-manifest.json.",
      file: "dist/deploy-manifest.json",
      fixCategory: "build_contract",
      autoFixable: false,
    });
    return;
  }

  if (isRecord(artifacts)) {
    for (const [artifactPath, expectedHash] of Object.entries(artifacts)) {
      if (typeof expectedHash !== "string" || expectedHash.trim() === "") {
        diagnostics.push({
          code: "build_integrity_hash_invalid",
          severity: "warning",
          message: `Integrity record for ${artifactPath} is missing a valid hash string.`,
          hint: "Rebuild the app so the artifact hash table can be regenerated.",
          file: "dist/deploy-manifest.json",
          fixCategory: "build_contract",
          autoFixable: false,
        });
        continue;
      }

      const absolutePath = resolve(appRoot, artifactPath);
      if (!await pathExists(absolutePath)) {
        diagnostics.push(buildArtifactDiagnostic(
          "build_integrity_artifact_missing",
          `${artifactPath} is listed in the integrity table but does not exist on disk.`,
          "Rebuild the app so the manifest and artifact graph are regenerated together.",
          artifactPath,
        ));
        continue;
      }

      const actualHash = await computeSha256(absolutePath);
      if (actualHash !== expectedHash) {
        diagnostics.push({
          code: "build_integrity_hash_mismatch",
          severity: "error",
          message: `${artifactPath} does not match the hash recorded in dist/deploy-manifest.json.`,
          hint: "The build output was likely mutated after generation. Rebuild the app and avoid editing generated artifacts manually.",
          file: artifactPath,
          fixCategory: "build_contract",
          autoFixable: false,
        });
      }
    }

    return;
  }

  for (const artifact of artifactGraph ?? []) {
    if (!isRecord(artifact) || typeof artifact.path !== "string" || artifact.path.trim() === "") {
      diagnostics.push({
        code: "build_integrity_hash_invalid",
        severity: "warning",
        message: "Integrity artifactGraph contains an entry without a valid path.",
        hint: "Rebuild the app so the integrity graph can be regenerated.",
        file: "dist/deploy-manifest.json",
        fixCategory: "build_contract",
        autoFixable: false,
      });
      continue;
    }

    const artifactPath = artifact.path;
    const absolutePath = resolve(appRoot, artifactPath);
    if (!await pathExists(absolutePath)) {
      diagnostics.push(buildArtifactDiagnostic(
        "build_integrity_artifact_missing",
        `${artifactPath} is listed in the integrity table but does not exist on disk.`,
        "Rebuild the app so the manifest and artifact graph are regenerated together.",
        artifactPath,
      ));
      continue;
    }

    const expectedHash = artifact.hash;
    if (artifact.kind === "directory") {
      continue;
    }

    if (typeof expectedHash !== "string" || expectedHash.trim() === "") {
      diagnostics.push({
        code: "build_integrity_hash_invalid",
        severity: "warning",
        message: `Integrity record for ${artifactPath} is missing a valid hash string.`,
        hint: "Rebuild the app so the integrity graph can be regenerated.",
        file: "dist/deploy-manifest.json",
        fixCategory: "build_contract",
        autoFixable: false,
      });
      continue;
    }

    const actualHash = await computeSha256(absolutePath);
    if (actualHash !== expectedHash) {
      diagnostics.push({
        code: "build_integrity_hash_mismatch",
        severity: "error",
        message: `${artifactPath} does not match the hash recorded in dist/deploy-manifest.json.`,
        hint: "The build output was likely mutated after generation. Rebuild the app and avoid editing generated artifacts manually.",
        file: artifactPath,
        fixCategory: "build_contract",
        autoFixable: false,
      });
    }
  }
}

export async function checkBuildArtifacts(appRoot: string): Promise<VerifyDiagnostic[]> {
  const diagnostics: VerifyDiagnostic[] = [];
  const distDir = join(appRoot, "dist");

  if (!await isDirectory(distDir)) {
    diagnostics.push({
      code: "build_not_found",
      severity: "info",
      message: "No dist directory exists yet. Build artifact checks were skipped.",
      hint: "Run `capstan build` if you want verification to inspect generated deployment artifacts.",
      fixCategory: "build_contract",
      autoFixable: true,
    });
    return diagnostics;
  }

  await validateRequiredContractFiles(appRoot, diagnostics);
  await validateGeneratedJsonFiles(appRoot, diagnostics);
  const manifest = await validateDeployManifestShape(appRoot, join(appRoot, "dist", "deploy-manifest.json"), diagnostics);
  await validateStandaloneArtifacts(appRoot, manifest, diagnostics);
  await validateBuildFreshness(appRoot, diagnostics);
  await validateIntegrityRecords(appRoot, manifest, diagnostics);

  return diagnostics;
}

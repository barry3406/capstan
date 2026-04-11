import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { DeployManifest } from "./deploy-manifest.js";

export interface DeployContractDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  hint?: string;
}

export interface DeployArtifactIntegrityRecord {
  path: string;
  kind: "file" | "directory";
  hash: string;
  bytes: number;
  required: boolean;
  dependsOn: string[];
}

export interface DeployManifestIntegrity {
  algorithm: "sha256";
  artifactGraph: DeployArtifactIntegrityRecord[];
}

export interface DeployManifestLoadResult {
  manifest: DeployManifest | null;
  diagnostics: DeployContractDiagnostic[];
}

const KNOWN_BUILD_TARGETS = [
  "node-standalone",
  "docker",
  "vercel-node",
  "vercel-edge",
  "cloudflare",
  "fly",
] as const;

interface DeployArtifactDescriptor {
  path: string;
  kind: "file" | "directory";
  required: boolean;
  dependsOn: string[];
  missingCode?: string;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPortableRelativePath(value: unknown): value is string {
  if (!isString(value) || value.trim().length === 0) {
    return false;
  }

  const portable = value.replace(/\\/g, "/");
  if (portable === ".") {
    return true;
  }
  if (portable.startsWith("/") || /^[A-Za-z]:/.test(portable)) {
    return false;
  }

  return portable.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function pushIssue(
  diagnostics: DeployContractDiagnostic[],
  code: string,
  message: string,
  hint?: string,
): void {
  diagnostics.push({
    severity: "error",
    code,
    message,
    ...(hint ? { hint } : {}),
  });
}

function validateStringField(
  diagnostics: DeployContractDiagnostic[],
  value: unknown,
  code: string,
  message: string,
): void {
  if (!isString(value) || value.trim().length === 0) {
    pushIssue(diagnostics, code, message);
  }
}

function validatePathField(
  diagnostics: DeployContractDiagnostic[],
  value: unknown,
  code: string,
  message: string,
): void {
  if (!isPortableRelativePath(value)) {
    pushIssue(
      diagnostics,
      code,
      message,
      "Deployment artifacts must use portable relative paths rooted at the build output directory.",
    );
  }
}

function validateStringArrayField(
  diagnostics: DeployContractDiagnostic[],
  value: unknown,
  code: string,
  message: string,
): void {
  if (!Array.isArray(value) || value.some((entry) => !isString(entry))) {
    pushIssue(diagnostics, code, message);
  }
}

function validateEnvironmentEntries(
  diagnostics: DeployContractDiagnostic[],
  value: unknown,
): void {
  if (!Array.isArray(value)) {
    pushIssue(diagnostics, "invalid_environment", "The deployment environment contract must be an array.");
    return;
  }

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      pushIssue(diagnostics, "invalid_environment_entry", `Environment entry ${index + 1} must be an object.`);
      return;
    }

    validateStringField(
      diagnostics,
      entry.name,
      "invalid_environment_entry_name",
      `Environment entry ${index + 1} is missing a name.`,
    );
    if (!isBoolean(entry.required)) {
      pushIssue(
        diagnostics,
        "invalid_environment_entry_required",
        `Environment entry ${index + 1} must declare required as a boolean.`,
      );
    }
    validateStringField(
      diagnostics,
      entry.description,
      "invalid_environment_entry_description",
      `Environment entry ${index + 1} is missing a description.`,
    );
    if (entry.default !== undefined && !isString(entry.default)) {
      pushIssue(
        diagnostics,
        "invalid_environment_entry_default",
        `Environment entry ${index + 1} has an invalid default value.`,
      );
    }
  });
}

function validateTargetContract(
  diagnostics: DeployContractDiagnostic[],
  contract: unknown,
  targetName: string,
): void {
  if (!isRecord(contract)) {
    pushIssue(diagnostics, `invalid_${targetName}_contract`, `The ${targetName} deployment contract must be an object.`);
    return;
  }

  if ("outputDir" in contract) {
    validatePathField(
      diagnostics,
      contract.outputDir,
      `invalid_${targetName}_output_dir`,
      `The ${targetName} contract outputDir must be a portable relative path.`,
    );
  }
  if ("contextDir" in contract) {
    validatePathField(
      diagnostics,
      contract.contextDir,
      `invalid_${targetName}_context_dir`,
      `The ${targetName} contract contextDir must be a portable relative path.`,
    );
  }
  if ("packageJson" in contract) {
    validatePathField(
      diagnostics,
      contract.packageJson,
      `invalid_${targetName}_package_json`,
      `The ${targetName} contract packageJson must be a portable relative path.`,
    );
  }
  if ("dockerfile" in contract) {
    validatePathField(
      diagnostics,
      contract.dockerfile,
      `invalid_${targetName}_dockerfile`,
      `The ${targetName} contract dockerfile must be a portable relative path.`,
    );
  }
  if ("dockerIgnore" in contract) {
    validatePathField(
      diagnostics,
      contract.dockerIgnore,
      `invalid_${targetName}_docker_ignore`,
      `The ${targetName} contract dockerIgnore must be a portable relative path.`,
    );
  }
  if ("entry" in contract) {
    validatePathField(
      diagnostics,
      contract.entry,
      `invalid_${targetName}_entry`,
      `The ${targetName} contract entry must be a portable relative path.`,
    );
  }
  if ("configFile" in contract) {
    validatePathField(
      diagnostics,
      contract.configFile,
      `invalid_${targetName}_config_file`,
      `The ${targetName} contract configFile must be a portable relative path.`,
    );
  }
  if ("installCommand" in contract && !isString(contract.installCommand)) {
    pushIssue(
      diagnostics,
      `invalid_${targetName}_install_command`,
      `The ${targetName} contract installCommand must be a string.`,
    );
  }
  if ("startCommand" in contract && !isString(contract.startCommand)) {
    pushIssue(
      diagnostics,
      `invalid_${targetName}_start_command`,
      `The ${targetName} contract startCommand must be a string.`,
    );
  }
  if ("buildCommand" in contract && !isString(contract.buildCommand)) {
    pushIssue(
      diagnostics,
      `invalid_${targetName}_build_command`,
      `The ${targetName} contract buildCommand must be a string.`,
    );
  }
  if ("deployCommand" in contract && !isString(contract.deployCommand)) {
    pushIssue(
      diagnostics,
      `invalid_${targetName}_deploy_command`,
      `The ${targetName} contract deployCommand must be a string.`,
    );
  }
  if ("runtime" in contract && contract.runtime !== undefined) {
    if (!isString(contract.runtime) || (contract.runtime !== "node" && contract.runtime !== "edge" && contract.runtime !== "worker")) {
      pushIssue(
        diagnostics,
        `invalid_${targetName}_runtime`,
        `The ${targetName} contract runtime must be node, edge, or worker.`,
      );
    }
  }
  if ("verificationProfile" in contract && contract.verificationProfile !== undefined) {
    if (
      !isString(contract.verificationProfile) ||
      ![
        "node",
        "serverless-node",
        "edge",
        "worker",
        "multi-region-node",
      ].includes(contract.verificationProfile)
    ) {
      pushIssue(
        diagnostics,
        `invalid_${targetName}_verification_profile`,
        `The ${targetName} contract verificationProfile must be one of the supported profiles.`,
      );
    }
  }
  if ("imagePort" in contract && contract.imagePort !== undefined && (typeof contract.imagePort !== "number" || !Number.isFinite(contract.imagePort))) {
    pushIssue(
      diagnostics,
      `invalid_${targetName}_image_port`,
      `The ${targetName} contract imagePort must be a number.`,
    );
  }
}

function validateIntegrityRecord(
  diagnostics: DeployContractDiagnostic[],
  entry: unknown,
  index: number,
): void {
  if (!isRecord(entry)) {
    pushIssue(
      diagnostics,
      "invalid_integrity_record",
      `Integrity entry ${index + 1} must be an object.`,
    );
    return;
  }

  validatePathField(
    diagnostics,
    entry.path,
    "invalid_integrity_path",
    `Integrity entry ${index + 1} must declare a portable relative path.`,
  );
  if (entry.kind !== "file" && entry.kind !== "directory") {
    pushIssue(
      diagnostics,
      "invalid_integrity_kind",
      `Integrity entry ${index + 1} must declare kind as file or directory.`,
    );
  }
  if (!isString(entry.hash) || entry.hash.length === 0) {
    pushIssue(
      diagnostics,
      "invalid_integrity_hash",
      `Integrity entry ${index + 1} must include a hash.`,
    );
  }
  if (typeof entry.bytes !== "number" || !Number.isFinite(entry.bytes) || entry.bytes < 0) {
    pushIssue(
      diagnostics,
      "invalid_integrity_bytes",
      `Integrity entry ${index + 1} must include a non-negative byte count.`,
    );
  }
  if (typeof entry.required !== "boolean") {
    pushIssue(
      diagnostics,
      "invalid_integrity_required",
      `Integrity entry ${index + 1} must declare required as a boolean.`,
    );
  }
  if (!Array.isArray(entry.dependsOn) || entry.dependsOn.some((value) => !isString(value))) {
    pushIssue(
      diagnostics,
      "invalid_integrity_depends_on",
      `Integrity entry ${index + 1} must declare dependsOn as an array of strings.`,
    );
  }
}

function normalizePortablePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function joinPortable(base: string, child: string): string {
  const normalizedBase = normalizePortablePath(base).replace(/\/+$/, "");
  const normalizedChild = normalizePortablePath(child).replace(/^\/+/, "");
  return normalizedBase.length > 0 ? `${normalizedBase}/${normalizedChild}` : normalizedChild;
}

function mergeDescriptor(
  descriptors: Map<string, DeployArtifactDescriptor>,
  descriptor: DeployArtifactDescriptor,
): void {
  const existing = descriptors.get(descriptor.path);
  if (!existing) {
    descriptors.set(descriptor.path, {
      ...descriptor,
      dependsOn: [...new Set(descriptor.dependsOn)].sort(),
    });
    return;
  }

  existing.required = existing.required || descriptor.required;
  existing.dependsOn = [...new Set([...existing.dependsOn, ...descriptor.dependsOn])].sort();
  if (!existing.missingCode && descriptor.missingCode) {
    existing.missingCode = descriptor.missingCode;
  }
}

function collectDeployArtifactDescriptors(manifest: DeployManifest): DeployArtifactDescriptor[] {
  const descriptors = new Map<string, DeployArtifactDescriptor>();
  const routeManifest = manifest.artifacts.routeManifest;
  const agentManifest = manifest.artifacts.agentManifest;
  const openApiSpec = manifest.artifacts.openApiSpec;
  const serverEntry = manifest.artifacts.serverEntry;

  mergeDescriptor(descriptors, {
    path: routeManifest,
    kind: "file",
    required: true,
    dependsOn: [],
    missingCode: "missing_route_manifest",
  });
  mergeDescriptor(descriptors, {
    path: agentManifest,
    kind: "file",
    required: true,
    dependsOn: [routeManifest],
    missingCode: "missing_agent_manifest",
  });
  mergeDescriptor(descriptors, {
    path: openApiSpec,
    kind: "file",
    required: true,
    dependsOn: [routeManifest],
    missingCode: "missing_openapi_spec",
  });
  mergeDescriptor(descriptors, {
    path: serverEntry,
    kind: "file",
    required: true,
    dependsOn: [routeManifest, agentManifest, openApiSpec],
    missingCode: "missing_server_entry",
  });

  if (manifest.assets.copied) {
    mergeDescriptor(descriptors, {
      path: manifest.artifacts.publicDir,
      kind: "directory",
      required: true,
      dependsOn: [],
      missingCode: "missing_public_dir",
    });
  }

  if (manifest.artifacts.staticDir) {
    mergeDescriptor(descriptors, {
      path: manifest.artifacts.staticDir,
      kind: "directory",
      required: true,
      dependsOn: [routeManifest],
      missingCode: "missing_static_dir",
    });
  }

  const nodeStandalone = manifest.targets?.nodeStandalone;
  if (nodeStandalone && nodeStandalone.outputDir !== "dist") {
    mergeDescriptor(descriptors, {
      path: nodeStandalone.packageJson,
      kind: "file",
      required: true,
      dependsOn: [serverEntry],
    });
  }

  if (manifest.targets?.docker) {
    mergeDescriptor(descriptors, {
      path: manifest.targets.docker.dockerfile,
      kind: "file",
      required: true,
      dependsOn: [serverEntry],
    });
    mergeDescriptor(descriptors, {
      path: manifest.targets.docker.dockerIgnore,
      kind: "file",
      required: true,
      dependsOn: [manifest.targets.docker.dockerfile],
    });
  }

  if (manifest.targets?.vercelNode) {
    mergeDescriptor(descriptors, {
      path: manifest.targets.vercelNode.entry,
      kind: "file",
      required: true,
      dependsOn: [routeManifest, agentManifest, openApiSpec],
    });
    mergeDescriptor(descriptors, {
      path: manifest.targets.vercelNode.configFile,
      kind: "file",
      required: true,
      dependsOn: [manifest.targets.vercelNode.entry],
    });
  }

  if (manifest.targets?.vercelEdge) {
    const runtimeBase = manifest.targets.vercelEdge.outputDir;
    const runtimeManifest = joinPortable(runtimeBase, "runtime/manifest.js");
    const runtimeModules = joinPortable(runtimeBase, "runtime/modules.js");
    const runtimeAssets = joinPortable(runtimeBase, "runtime/assets.js");

    mergeDescriptor(descriptors, {
      path: runtimeManifest,
      kind: "file",
      required: true,
      dependsOn: [routeManifest, agentManifest, openApiSpec],
      missingCode: "missing_portable_runtime",
    });
    mergeDescriptor(descriptors, {
      path: runtimeModules,
      kind: "file",
      required: true,
      dependsOn: [runtimeManifest],
      missingCode: "missing_portable_runtime",
    });
    mergeDescriptor(descriptors, {
      path: runtimeAssets,
      kind: "file",
      required: true,
      dependsOn: [runtimeManifest],
      missingCode: "missing_portable_runtime",
    });
    mergeDescriptor(descriptors, {
      path: manifest.targets.vercelEdge.entry,
      kind: "file",
      required: true,
      dependsOn: [runtimeManifest, runtimeModules, runtimeAssets],
    });
    mergeDescriptor(descriptors, {
      path: manifest.targets.vercelEdge.configFile,
      kind: "file",
      required: true,
      dependsOn: [manifest.targets.vercelEdge.entry],
    });
  }

  if (manifest.targets?.cloudflare) {
    const runtimeBase = manifest.targets.cloudflare.outputDir;
    const runtimeManifest = joinPortable(runtimeBase, "runtime/manifest.js");
    const runtimeModules = joinPortable(runtimeBase, "runtime/modules.js");
    const runtimeAssets = joinPortable(runtimeBase, "runtime/assets.js");

    mergeDescriptor(descriptors, {
      path: runtimeManifest,
      kind: "file",
      required: true,
      dependsOn: [routeManifest, agentManifest, openApiSpec],
      missingCode: "missing_portable_runtime",
    });
    mergeDescriptor(descriptors, {
      path: runtimeModules,
      kind: "file",
      required: true,
      dependsOn: [runtimeManifest],
      missingCode: "missing_portable_runtime",
    });
    mergeDescriptor(descriptors, {
      path: runtimeAssets,
      kind: "file",
      required: true,
      dependsOn: [runtimeManifest],
      missingCode: "missing_portable_runtime",
    });
    mergeDescriptor(descriptors, {
      path: manifest.targets.cloudflare.entry,
      kind: "file",
      required: true,
      dependsOn: [runtimeManifest, runtimeModules, runtimeAssets],
    });
    mergeDescriptor(descriptors, {
      path: manifest.targets.cloudflare.configFile,
      kind: "file",
      required: true,
      dependsOn: [manifest.targets.cloudflare.entry],
    });
  }

  if (manifest.targets?.fly) {
    mergeDescriptor(descriptors, {
      path: manifest.targets.fly.entry,
      kind: "file",
      required: true,
      dependsOn: [serverEntry],
    });
    mergeDescriptor(descriptors, {
      path: manifest.targets.fly.configFile,
      kind: "file",
      required: true,
      dependsOn: [manifest.targets.fly.entry],
    });
  }

  return [...descriptors.values()].sort((left, right) => {
    if (left.path === right.path) {
      return 0;
    }
    return left.path < right.path ? -1 : 1;
  });
}

async function hashFile(filePath: string): Promise<{ hash: string; bytes: number }> {
  const buffer = await readFile(filePath);
  return {
    hash: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.byteLength,
  };
}

async function hashDirectoryTree(directoryPath: string): Promise<{ hash: string; bytes: number }> {
  const entries = (await readdir(directoryPath, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const aggregate = createHash("sha256");
  let bytes = 0;

  for (const entry of entries) {
    const fullPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await hashDirectoryTree(fullPath);
      bytes += nested.bytes;
      aggregate.update(`dir:${entry.name}`);
      aggregate.update("\0");
      aggregate.update(nested.hash);
      aggregate.update("\0");
      aggregate.update(String(nested.bytes));
      aggregate.update("\0");
      continue;
    }

    if (entry.isFile()) {
      const { hash, bytes: fileBytes } = await hashFile(fullPath);
      bytes += fileBytes;
      aggregate.update(`file:${entry.name}`);
      aggregate.update("\0");
      aggregate.update(hash);
      aggregate.update("\0");
      aggregate.update(String(fileBytes));
      aggregate.update("\0");
    }
  }

  return { hash: aggregate.digest("hex"), bytes };
}

async function hashArtifact(rootDir: string, descriptor: DeployArtifactDescriptor): Promise<DeployArtifactIntegrityRecord> {
  const absolutePath = resolve(rootDir, descriptor.path);
  const rootResolved = resolve(rootDir);
  const relativePath = normalizePortablePath(relative(rootResolved, absolutePath));

  if (relativePath.startsWith("..")) {
    throw new Error(`Artifact path escapes the build root: ${descriptor.path}`);
  }

  if (descriptor.kind === "directory") {
    const directoryStats = await stat(absolutePath);
    if (!directoryStats.isDirectory()) {
      throw new Error(`Expected directory artifact at ${descriptor.path}`);
    }
    const { hash, bytes } = await hashDirectoryTree(absolutePath);
    return {
      path: descriptor.path,
      kind: "directory",
      hash,
      bytes,
      required: descriptor.required,
      dependsOn: [...descriptor.dependsOn].sort(),
    };
  }

  const fileStats = await stat(absolutePath);
  if (!fileStats.isFile()) {
    throw new Error(`Expected file artifact at ${descriptor.path}`);
  }
  const { hash, bytes } = await hashFile(absolutePath);
  return {
    path: descriptor.path,
    kind: "file",
    hash,
    bytes,
    required: descriptor.required,
    dependsOn: [...descriptor.dependsOn].sort(),
  };
}

function sortIntegrityRecords(records: DeployArtifactIntegrityRecord[]): DeployArtifactIntegrityRecord[] {
  return [...records].sort((left, right) => {
    if (left.path === right.path) {
      return 0;
    }
    return left.path < right.path ? -1 : 1;
  });
}

function formatHash(hash: string): string {
  return hash.length <= 12 ? hash : `${hash.slice(0, 12)}…`;
}

function compareStringArrays(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry === right[index]);
}

export function validateDeployManifestShape(value: unknown): DeployContractDiagnostic[] {
  const diagnostics: DeployContractDiagnostic[] = [];

  if (!isRecord(value)) {
    pushIssue(
      diagnostics,
      "invalid_deploy_manifest",
      "The deployment manifest must be a JSON object.",
      "Re-run `capstan build` to regenerate the contract.",
    );
    return diagnostics;
  }

  if (value.schemaVersion !== 1) {
    pushIssue(
      diagnostics,
      "invalid_schema_version",
      "The deployment manifest schemaVersion must be 1.",
      "Re-run `capstan build` so the CLI can regenerate the latest contract shape.",
    );
  }

  validateStringField(diagnostics, value.createdAt, "invalid_created_at", "The deployment manifest must include createdAt.");

  if (!isRecord(value.app)) {
    pushIssue(diagnostics, "invalid_app_contract", "The deployment manifest app block must be an object.");
  } else {
    validateStringField(diagnostics, value.app.name, "invalid_app_name", "The deployment manifest app.name must be a string.");
    if (value.app.description !== undefined && !isString(value.app.description)) {
      pushIssue(diagnostics, "invalid_app_description", "The deployment manifest app.description must be a string when present.");
    }
  }

  if (!isRecord(value.build)) {
    pushIssue(diagnostics, "invalid_build_contract", "The deployment manifest build block must be an object.");
  } else {
    validateStringField(diagnostics, value.build.command, "invalid_build_command", "The deployment manifest build.command must be a string.");
    validateStringField(diagnostics, value.build.mode, "invalid_build_mode", "The deployment manifest build.mode must be a string.");
    if (value.build.mode !== "server" && value.build.mode !== "hybrid-static") {
      pushIssue(diagnostics, "invalid_build_mode_value", "The deployment manifest build.mode must be server or hybrid-static.");
    }
    validatePathField(diagnostics, value.build.distDir, "invalid_build_dist_dir", "The deployment manifest build.distDir must be a portable relative path.");
    if (value.build.target !== undefined) {
      if (!isString(value.build.target) || !KNOWN_BUILD_TARGETS.includes(value.build.target as (typeof KNOWN_BUILD_TARGETS)[number])) {
        pushIssue(diagnostics, "invalid_build_target", "The deployment manifest build.target must be one of the supported build targets when present.");
      }
    }
  }

  if (!isRecord(value.server)) {
    pushIssue(diagnostics, "invalid_server_contract", "The deployment manifest server block must be an object.");
  } else {
    validatePathField(diagnostics, value.server.entry, "invalid_server_entry", "The deployment manifest server.entry must be a portable relative path.");
    validateStringField(diagnostics, value.server.startCommand, "invalid_server_start_command", "The deployment manifest server.startCommand must be a string.");
    validateStringArrayField(diagnostics, value.server.runtimes, "invalid_server_runtimes", "The deployment manifest server.runtimes must be an array of strings.");
    validateStringArrayField(diagnostics, value.server.hostEnv, "invalid_server_host_env", "The deployment manifest server.hostEnv must be an array of strings.");
    validateStringArrayField(diagnostics, value.server.portEnv, "invalid_server_port_env", "The deployment manifest server.portEnv must be an array of strings.");
    if (Array.isArray(value.server.runtimes) && value.server.runtimes.some((runtime) => runtime !== "node" && runtime !== "bun")) {
      pushIssue(diagnostics, "invalid_server_runtime_value", "The deployment manifest server.runtimes must only contain node or bun.");
    }
  }

  if (!isRecord(value.assets)) {
    pushIssue(diagnostics, "invalid_assets_contract", "The deployment manifest assets block must be an object.");
  } else {
    validatePathField(diagnostics, value.assets.sourcePublicDir, "invalid_assets_source_public_dir", "The deployment manifest assets.sourcePublicDir must be a portable relative path.");
    validatePathField(diagnostics, value.assets.outputPublicDir, "invalid_assets_output_public_dir", "The deployment manifest assets.outputPublicDir must be a portable relative path.");
    if (value.assets.publicUrlPrefix !== "/") {
      pushIssue(diagnostics, "invalid_assets_public_url_prefix", "The deployment manifest assets.publicUrlPrefix must remain /.");
    }
    if (typeof value.assets.copied !== "boolean") {
      pushIssue(diagnostics, "invalid_assets_copied", "The deployment manifest assets.copied must be a boolean.");
    }
    if (value.assets.staticHtmlDir !== null && !isPortableRelativePath(value.assets.staticHtmlDir)) {
      pushIssue(diagnostics, "invalid_assets_static_html_dir", "The deployment manifest assets.staticHtmlDir must be a portable relative path or null.");
    }
  }

  if (!isRecord(value.artifacts)) {
    pushIssue(diagnostics, "invalid_artifacts_contract", "The deployment manifest artifacts block must be an object.");
  } else {
    validatePathField(diagnostics, value.artifacts.routeManifest, "invalid_artifacts_route_manifest", "The deployment manifest artifacts.routeManifest must be a portable relative path.");
    validatePathField(diagnostics, value.artifacts.agentManifest, "invalid_artifacts_agent_manifest", "The deployment manifest artifacts.agentManifest must be a portable relative path.");
    validatePathField(diagnostics, value.artifacts.openApiSpec, "invalid_artifacts_openapi_spec", "The deployment manifest artifacts.openApiSpec must be a portable relative path.");
    validatePathField(diagnostics, value.artifacts.serverEntry, "invalid_artifacts_server_entry", "The deployment manifest artifacts.serverEntry must be a portable relative path.");
    validatePathField(diagnostics, value.artifacts.deployManifest, "invalid_artifacts_deploy_manifest", "The deployment manifest artifacts.deployManifest must be a portable relative path.");
    validatePathField(diagnostics, value.artifacts.publicDir, "invalid_artifacts_public_dir", "The deployment manifest artifacts.publicDir must be a portable relative path.");
    if (value.artifacts.staticDir !== null && !isPortableRelativePath(value.artifacts.staticDir)) {
      pushIssue(diagnostics, "invalid_artifacts_static_dir", "The deployment manifest artifacts.staticDir must be a portable relative path or null.");
    }
  }

  validateEnvironmentEntries(diagnostics, value.environment);

  if (value.targets !== undefined) {
  if (!isRecord(value.targets)) {
      pushIssue(diagnostics, "invalid_targets_contract", "The deployment manifest targets block must be an object when present.");
    } else {
      if (value.targets.nodeStandalone !== undefined) {
        validateTargetContract(diagnostics, value.targets.nodeStandalone, "nodeStandalone");
      }
      if (value.targets.docker !== undefined) {
        validateTargetContract(diagnostics, value.targets.docker, "docker");
      }
      if (value.targets.vercelNode !== undefined) {
        validateTargetContract(diagnostics, value.targets.vercelNode, "vercelNode");
      }
      if (value.targets.vercelEdge !== undefined) {
        validateTargetContract(diagnostics, value.targets.vercelEdge, "vercelEdge");
      }
      if (value.targets.cloudflare !== undefined) {
        validateTargetContract(diagnostics, value.targets.cloudflare, "cloudflare");
      }
      if (value.targets.fly !== undefined) {
        validateTargetContract(diagnostics, value.targets.fly, "fly");
      }
    }
  }

  if (value.integrity !== undefined) {
    if (!isRecord(value.integrity)) {
      pushIssue(diagnostics, "invalid_integrity_contract", "The deployment manifest integrity block must be an object when present.");
    } else {
      if (value.integrity.algorithm !== "sha256") {
        pushIssue(diagnostics, "invalid_integrity_algorithm", "The deployment manifest integrity.algorithm must be sha256.");
      }
      if (!Array.isArray(value.integrity.artifactGraph)) {
        pushIssue(diagnostics, "invalid_integrity_graph", "The deployment manifest integrity.artifactGraph must be an array.");
      } else {
        const seenPaths = new Set<string>();
        const recordedPaths: string[] = [];
        value.integrity.artifactGraph.forEach((entry: unknown, index: number) => validateIntegrityRecord(diagnostics, entry, index));
        for (const entry of value.integrity.artifactGraph as Array<Record<string, unknown>>) {
          if (isPortableRelativePath(entry.path)) {
            recordedPaths.push(normalizePortablePath(entry.path));
          }
        }
        for (const path of recordedPaths) {
          if (seenPaths.has(path)) {
            pushIssue(
              diagnostics,
              "duplicate_integrity_path",
              `The deployment manifest integrity graph records ${path} more than once.`,
            );
            continue;
          }
          seenPaths.add(path);
        }
        const sortedRecordedPaths = [...recordedPaths].sort();
        if (recordedPaths.length > 0 && recordedPaths.some((path, index) => path !== sortedRecordedPaths[index])) {
          pushIssue(
            diagnostics,
            "non_deterministic_integrity_order",
            "The deployment manifest integrity graph must be sorted by artifact path.",
            "Re-run `capstan build` to regenerate the deployment contract.",
          );
        }
      }
    }
  }

  return diagnostics;
}

export async function loadDeployManifestContract(projectDir: string): Promise<DeployManifestLoadResult> {
  const manifestPath = join(projectDir, "dist", "deploy-manifest.json");

  try {
    const raw = await readFile(manifestPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        manifest: null,
        diagnostics: [
          {
            severity: "error",
            code: "invalid_deploy_manifest_json",
            message: "dist/deploy-manifest.json is not valid JSON.",
            hint: "Re-run `capstan build` so the deployment contract can be regenerated.",
          },
        ],
      };
    }

    const diagnostics = validateDeployManifestShape(parsed);
    if (diagnostics.length > 0) {
      return { manifest: null, diagnostics };
    }

    return { manifest: parsed as DeployManifest, diagnostics: [] };
  } catch {
    return {
      manifest: null,
      diagnostics: [
        {
          severity: "error",
          code: "missing_deploy_manifest",
          message: "dist/deploy-manifest.json is missing.",
          hint: "Run `capstan build` or `capstan build --target <target>` before deployment verification.",
        },
      ],
    };
  }
}

export async function buildDeployManifestIntegrity(
  rootDir: string,
  manifest: DeployManifest,
): Promise<{ integrity: DeployManifestIntegrity | null; diagnostics: DeployContractDiagnostic[] }> {
  const descriptors = collectDeployArtifactDescriptors(manifest);
  const diagnostics: DeployContractDiagnostic[] = [];
  const artifactGraph: DeployArtifactIntegrityRecord[] = [];

  for (const descriptor of descriptors) {
    try {
      const record = await hashArtifact(rootDir, descriptor);
      artifactGraph.push(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        severity: "error",
        code: descriptor.missingCode ?? "missing_artifact",
        message: `${descriptor.path} could not be verified: ${message}`,
        hint: "Re-run `capstan build` and keep the generated deployment files intact.",
      });
    }
  }

  if (diagnostics.length > 0) {
    return { integrity: null, diagnostics };
  }

  return {
    integrity: {
      algorithm: "sha256",
      artifactGraph: sortIntegrityRecords(artifactGraph),
    },
    diagnostics,
  };
}

export async function compareDeployManifestIntegrity(
  rootDir: string,
  manifest: DeployManifest,
): Promise<DeployContractDiagnostic[]> {
  const diagnostics: DeployContractDiagnostic[] = [];
  const expectedIntegrity = manifest.integrity;

  if (!expectedIntegrity) {
    return [
      {
        severity: "error",
        code: "missing_deploy_integrity",
        message: "The deployment manifest does not include artifact integrity metadata.",
        hint: "Re-run `capstan build` to regenerate the manifest with the integrity contract.",
      },
    ];
  }

  if (expectedIntegrity.algorithm !== "sha256") {
    diagnostics.push({
      severity: "error",
      code: "unsupported_integrity_algorithm",
      message: `Unsupported deployment integrity algorithm ${expectedIntegrity.algorithm}.`,
      hint: "Re-run `capstan build` with the current CLI version.",
    });
    return diagnostics;
  }

  const descriptors = collectDeployArtifactDescriptors(manifest);
  const actualGraph: DeployArtifactIntegrityRecord[] = [];
  for (const descriptor of descriptors) {
    try {
      actualGraph.push(await hashArtifact(rootDir, descriptor));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        severity: "error",
        code: descriptor.missingCode ?? "missing_artifact",
        message: `${descriptor.path} could not be verified: ${message}`,
        hint: "Re-run `capstan build` and keep the generated deployment files intact.",
      });
    }
  }

  if (diagnostics.length > 0) {
    return diagnostics;
  }

  const expectedGraph = sortIntegrityRecords(expectedIntegrity.artifactGraph);
  const actualSortedGraph = sortIntegrityRecords(actualGraph);

  if (expectedGraph.length !== actualSortedGraph.length) {
    diagnostics.push({
      severity: "error",
      code: "artifact_graph_mismatch",
      message: `The deployment artifact graph has ${actualSortedGraph.length} recorded entries, but the manifest expects ${expectedGraph.length}.`,
      hint: "Re-run `capstan build` to regenerate the deployment manifest and all derived artifacts.",
    });
  }

  const expectedByPath = new Map(expectedGraph.map((entry) => [entry.path, entry]));
  for (const actual of actualSortedGraph) {
    const expected = expectedByPath.get(actual.path);
    if (!expected) {
      diagnostics.push({
        severity: "error",
        code: "unexpected_artifact",
        message: `The deployment artifact ${actual.path} was generated but is not recorded in the manifest graph.`,
        hint: "Re-run `capstan build` so the manifest and artifact graph stay in sync.",
      });
      continue;
    }

    if (expected.kind !== actual.kind) {
      diagnostics.push({
        severity: "error",
        code: "artifact_kind_mismatch",
        message: `The deployment artifact ${actual.path} was recorded as ${expected.kind} but exists as ${actual.kind}.`,
        hint: "Re-run `capstan build` to refresh the deployment artifact graph.",
      });
    }
    if (expected.hash !== actual.hash) {
      diagnostics.push({
        severity: "error",
        code: "artifact_hash_mismatch",
        message: `The deployment artifact ${actual.path} hash changed from ${formatHash(expected.hash)} to ${formatHash(actual.hash)}.`,
        hint: "Re-run `capstan build` and redeploy the regenerated output.",
      });
    }
    if (expected.bytes !== actual.bytes) {
      diagnostics.push({
        severity: "error",
        code: "artifact_size_mismatch",
        message: `The deployment artifact ${actual.path} byte size changed from ${expected.bytes} to ${actual.bytes}.`,
        hint: "Re-run `capstan build` and redeploy the regenerated output.",
      });
    }
    if (!compareStringArrays(expected.dependsOn, actual.dependsOn)) {
      diagnostics.push({
        severity: "error",
        code: "artifact_dependency_mismatch",
        message: `The deployment artifact ${actual.path} dependencies are not deterministic.`,
        hint: "Re-run `capstan build` so the artifact graph is regenerated from the current route contract.",
      });
    }
  }

  return diagnostics;
}

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type {
  AppGraph,
  ArtifactSpec,
  CapabilitySpec,
  PolicySpec,
  ResourceSpec,
  TaskSpec,
  ViewSpec
} from "@capstan/app-graph";
import { introspectAppGraph, normalizeAppGraph, validateAppGraph } from "@capstan/app-graph";
import { applyBuiltinAppGraphPacks } from "@capstan/packs-core";
import type { AgentSurfaceProjection } from "@capstan/surface-agent";
import { projectAgentSurface, renderAgentManifestJson } from "@capstan/surface-agent";
import type { HumanSurfaceProjection } from "@capstan/surface-web";
import { projectHumanSurface, renderHumanSurfaceDocument } from "@capstan/surface-web";

const CAPSTAN_DIR = ".capstan";
const GENERATED_MANIFEST_PATH = `${CAPSTAN_DIR}/generated-files.json`;

export interface GeneratedFile {
  path: string;
  contents: string;
}

export interface ScaffoldOptions {
  appName?: string;
  force?: boolean;
}

export interface ScaffoldResult {
  rootDir: string;
  appName: string;
  files: string[];
  manifestPath: string;
  userFiles: string[];
}

interface GeneratedManifest {
  version: 1;
  appName: string;
  graphHash: string;
  files: string[];
}

export function compileAppGraph(
  graph: AppGraph,
  options: ScaffoldOptions = {}
): GeneratedFile[] {
  const resolvedGraph = applyBuiltinAppGraphPacks(graph);
  assertValidGraph(resolvedGraph);
  const normalizedGraph = normalizeAppGraph(resolvedGraph);
  const introspection = introspectAppGraph(resolvedGraph);
  const agentSurface = projectAgentSurface(normalizedGraph);
  const humanSurface = projectHumanSurface(normalizedGraph);
  const humanSurfaceHtml = renderHumanSurfaceDocument(humanSurface, {
    runtimeModulePath: "./dist/human-surface/index.js"
  });
  const agentManifest = renderAgentManifestJson(agentSurface);
  const releaseContract = createGeneratedReleaseContract(normalizedGraph);
  const releaseEnvironmentSnapshot = createGeneratedReleaseEnvironmentSnapshot(releaseContract);
  const releaseMigrationPlan = createGeneratedReleaseMigrationPlan();

  const appName = normalizePackageName(
    options.appName ?? `${toKebabCase(normalizedGraph.domain.key)}-app`
  );
  const files: GeneratedFile[] = [
    {
      path: "README.md",
      contents: renderGeneratedReadme(normalizedGraph, appName)
    },
    {
      path: "AGENTS.md",
      contents: renderGeneratedAgentsGuide(normalizedGraph, appName)
    },
    {
      path: "capstan.app.json",
      contents: `${JSON.stringify(normalizedGraph, null, 2)}\n`
    },
    {
      path: ".capstan/graph-metadata.json",
      contents: `${JSON.stringify(introspection.metadata, null, 2)}\n`
    },
    {
      path: "agent-surface.json",
      contents: agentManifest
    },
    {
      path: "human-surface.html",
      contents: humanSurfaceHtml
    },
    {
      path: "capstan.release.json",
      contents: `${JSON.stringify(releaseContract, null, 2)}\n`
    },
    {
      path: "capstan.release-env.json",
      contents: `${JSON.stringify(releaseEnvironmentSnapshot, null, 2)}\n`
    },
    {
      path: "capstan.migrations.json",
      contents: `${JSON.stringify(releaseMigrationPlan, null, 2)}\n`
    },
    {
      path: "package.json",
      contents: `${JSON.stringify(createGeneratedPackageJson(appName), null, 2)}\n`
    },
    {
      path: "tsconfig.json",
      contents: `${JSON.stringify(createGeneratedTsconfig(), null, 2)}\n`
    },
    {
      path: "src/types.ts",
      contents: renderTypesFile()
    },
    {
      path: "src/domain.ts",
      contents: renderDomainFile(normalizedGraph)
    },
    {
      path: "src/human-surface/index.ts",
      contents: renderHumanSurfaceModule(humanSurface, humanSurfaceHtml)
    },
    {
      path: "src/agent-surface/index.ts",
      contents: renderAgentSurfaceModule(agentSurface, agentManifest)
    },
    {
      path: "src/agent-surface/transport.ts",
      contents: renderAgentSurfaceTransportModule()
    },
    {
      path: "src/agent-surface/http.ts",
      contents: renderAgentSurfaceHttpModule()
    },
    {
      path: "src/agent-surface/mcp.ts",
      contents: renderAgentSurfaceMcpModule()
    },
    {
      path: "src/agent-surface/a2a.ts",
      contents: renderAgentSurfaceA2aModule()
    },
    {
      path: "src/resources/index.ts",
      contents: renderResourceIndex(normalizedGraph.resources)
    },
    {
      path: "src/capabilities/index.ts",
      contents: renderCapabilityIndex(normalizedGraph.capabilities)
    },
    {
      path: "src/tasks/index.ts",
      contents: renderTaskIndex(normalizedGraph.tasks)
    },
    {
      path: "src/policies/index.ts",
      contents: renderPolicyIndex(normalizedGraph.policies)
    },
    {
      path: "src/artifacts/index.ts",
      contents: renderArtifactIndex(normalizedGraph.artifacts)
    },
    {
      path: "src/views/index.ts",
      contents: renderViewIndex(normalizedGraph.views)
    },
    {
      path: "src/control-plane/index.ts",
      contents: renderControlPlaneFile(normalizedGraph)
    },
    {
      path: "src/assertions/index.ts",
      contents: renderAssertionsIndex(normalizedGraph)
    },
    {
      path: "src/release/index.ts",
      contents: renderReleaseModule(
        releaseContract,
        releaseEnvironmentSnapshot,
        releaseMigrationPlan
      )
    },
    {
      path: "src/index.ts",
      contents: renderRootIndex()
    }
  ];

  for (const resource of normalizedGraph.resources) {
    files.push({
      path: `src/resources/${toKebabCase(resource.key)}.ts`,
      contents: renderResourceFile(resource)
    });
  }

  for (const capability of normalizedGraph.capabilities) {
    files.push({
      path: `src/capabilities/generated/${toKebabCase(capability.key)}.ts`,
      contents: renderCapabilityFile(capability)
    });
  }

  for (const task of normalizedGraph.tasks) {
    files.push({
      path: `src/tasks/${toKebabCase(task.key)}.ts`,
      contents: renderTaskFile(task)
    });
  }

  for (const policy of normalizedGraph.policies) {
    files.push({
      path: `src/policies/${toKebabCase(policy.key)}.ts`,
      contents: renderPolicyFile(policy)
    });
  }

  for (const artifact of normalizedGraph.artifacts) {
    files.push({
      path: `src/artifacts/${toKebabCase(artifact.key)}.ts`,
      contents: renderArtifactFile(artifact)
    });
  }

  for (const view of normalizedGraph.views) {
    files.push({
      path: `src/views/generated/${toKebabCase(view.key)}.ts`,
      contents: renderGeneratedViewDefinitionFile(view)
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function scaffoldAppGraph(
  graph: AppGraph,
  rootDir: string,
  options: ScaffoldOptions = {}
): Promise<ScaffoldResult> {
  const resolvedGraph = applyBuiltinAppGraphPacks(graph);
  const normalizedGraph = normalizeAppGraph(resolvedGraph);
  const appName = normalizePackageName(
    options.appName ?? `${toKebabCase(normalizedGraph.domain.key)}-app`
  );
  const introspection = introspectAppGraph(resolvedGraph);
  const existingManifest = await readGeneratedManifest(rootDir);
  await ensureOutputDirectory(rootDir, options.force ?? false);

  const files = compileAppGraph(resolvedGraph, options);
  const userFiles = compileUserOwnedFiles(normalizedGraph);
  const nextFileSet = new Set(files.map((file) => file.path));

  if (options.force && existingManifest) {
    await removeStaleGeneratedFiles(rootDir, existingManifest.files, nextFileSet);
  }

  for (const file of files) {
    const destination = join(rootDir, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.contents, "utf8");
  }

  for (const file of userFiles) {
    const destination = join(rootDir, file.path);
    if (await pathExists(destination)) {
      continue;
    }

    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.contents, "utf8");
  }

  const manifest: GeneratedManifest = {
    version: 1,
    appName,
    graphHash: introspection.metadata.graphHash,
    files: [...nextFileSet].sort((left, right) => left.localeCompare(right))
  };
  const manifestDestination = join(rootDir, GENERATED_MANIFEST_PATH);
  await mkdir(dirname(manifestDestination), { recursive: true });
  await writeFile(`${manifestDestination}`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    rootDir,
    appName,
    files: manifest.files,
    manifestPath: GENERATED_MANIFEST_PATH,
    userFiles: userFiles.map((file) => file.path)
  };
}

function assertValidGraph(graph: AppGraph): void {
  const result = validateAppGraph(graph);
  if (result.ok) {
    return;
  }

  throw new Error(
    `Cannot compile an invalid App Graph:\n${result.issues
      .map((issue) => `- ${issue.path}: ${issue.message}`)
      .join("\n")}`
  );
}

async function ensureOutputDirectory(rootDir: string, force: boolean): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  const existingEntries = await readdir(rootDir);

  if (existingEntries.length > 0 && !force) {
    throw new Error(
      `Output directory "${rootDir}" is not empty. Pass --force to overwrite existing files.`
    );
  }
}

async function readGeneratedManifest(rootDir: string): Promise<GeneratedManifest | null> {
  const manifestPath = join(rootDir, GENERATED_MANIFEST_PATH);

  try {
    const contents = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(contents) as GeneratedManifest;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

async function removeStaleGeneratedFiles(
  rootDir: string,
  previousFiles: string[],
  nextFiles: Set<string>
): Promise<void> {
  const staleFiles = previousFiles.filter((file) => !nextFiles.has(file));

  for (const file of staleFiles) {
    if (isMigratedUserOwnedPath(file)) {
      continue;
    }

    if (await shouldPreserveLegacyCapabilityDefinition(rootDir, file)) {
      continue;
    }

    if (await shouldPreserveLegacyViewDefinition(rootDir, file)) {
      continue;
    }

    const absolutePath = join(rootDir, file);
    await rm(absolutePath, {
      force: true
    });
    await removeEmptyParentDirectories(rootDir, dirname(absolutePath));
  }
}

async function removeEmptyParentDirectories(rootDir: string, startDir: string): Promise<void> {
  let currentDir = startDir;

  while (relative(rootDir, currentDir) && relative(rootDir, currentDir) !== CAPSTAN_DIR) {
    let directoryStat;

    try {
      directoryStat = await stat(currentDir);
    } catch {
      return;
    }

    if (!directoryStat.isDirectory()) {
      return;
    }

    const entries = await readdir(currentDir);
    if (entries.length > 0) {
      return;
    }

    await rm(currentDir, {
      force: true,
      recursive: true
    });

    currentDir = dirname(currentDir);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isMigratedUserOwnedPath(path: string): boolean {
  return (
    (/^src\/capabilities\/[^/]+\.ts$/.test(path) && path !== "src/capabilities/index.ts") ||
    (/^src\/views\/[^/]+\.ts$/.test(path) && path !== "src/views/index.ts")
  );
}

async function shouldPreserveLegacyCapabilityDefinition(
  rootDir: string,
  path: string
): Promise<boolean> {
  const match = /^src\/capabilities\/generated\/([^/]+)\.ts$/.exec(path);
  if (!match) {
    return false;
  }

  const capabilityFile = match[1];
  return pathExists(join(rootDir, "src/capabilities", `${capabilityFile}.ts`));
}

async function shouldPreserveLegacyViewDefinition(
  rootDir: string,
  path: string
): Promise<boolean> {
  const match = /^src\/views\/generated\/([^/]+)\.ts$/.exec(path);
  if (!match) {
    return false;
  }

  const viewFile = match[1];
  return pathExists(join(rootDir, "src/views", `${viewFile}.ts`));
}

function createGeneratedPackageJson(appName: string): Record<string, unknown> {
  return {
    name: appName,
    version: "0.1.0",
    private: true,
    description: "Generated by Capstan from an App Graph.",
    type: "module",
    scripts: {
      build: "tsc -p tsconfig.json",
      typecheck: "tsc -p tsconfig.json --noEmit"
    },
    devDependencies: {
      "@types/node": "^24.6.1",
      typescript: "^5.9.3"
    }
  };
}

function createGeneratedTsconfig(): Record<string, unknown> {
  return {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      outDir: "dist",
      rootDir: "src",
      declaration: true,
      sourceMap: true,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      skipLibCheck: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true
    },
    include: ["src/**/*.ts"]
  };
}

function renderGeneratedReadme(graph: AppGraph, appName: string): string {
  return `# ${graph.domain.title}

This project was generated by Capstan from an App Graph.

## Package Name

\`${appName}\`

## Domain

- Key: \`${graph.domain.key}\`
- Title: ${graph.domain.title}
${graph.packs?.length ? `\n## Included Packs\n\n${graph.packs.map((pack) => `- \`${pack.key}\``).join("\n")}\n` : ""}

## Included Projections

- resource stubs
- generated human surface shell
- a generated coding-agent guide in \`AGENTS.md\`
- generated capability definitions
- user-owned capability handlers
- generated view definitions
- generated application assertions
- user-owned custom assertions
- generated release contract
- generated release environment snapshot
- generated migration plan
- task, policy, artifact, and view registries
- an AI-facing control plane entry point

## Recommended Next Steps

1. Read \`AGENTS.md\` before using Claude Code or another coding agent on this generated app
2. Implement the generated capability handlers in \`src/capabilities\`
3. Open \`human-surface.html\` to review the generated operator-facing shell
4. Add domain-specific checks in \`src/assertions/custom.ts\`
5. Run \`npm run typecheck\`, then \`npx capstan verify . --json\` when the Capstan CLI is available
6. Review \`capstan.release-env.json\` and \`capstan.migrations.json\` before preview or release
7. Use \`capstan release:run <app-dir> preview|release\` to simulate promotion and inspect the persisted trace
8. Use \`capstan release:history\` and \`capstan release:rollback\` to inspect prior runs and simulate rollback from a known-good trace
`;
}

function renderGeneratedAgentsGuide(graph: AppGraph, appName: string): string {
  return `# Capstan Agent Guide

This application was scaffolded by Capstan. Keep the generated structure
predictable so coding agents can discover, execute, verify, and recover work
without reverse-engineering the repo.

## Source Of Truth

- For product or schema changes, edit the upstream Capstan brief or App Graph and re-scaffold the application.
- \`capstan.app.json\` is the generated graph snapshot for this app, not the preferred place for handwritten customization.
- Use this generated app for implementation, verification, and supervised operation after the graph has been projected.

## Safe To Edit

- \`src/capabilities/*.ts\`
- \`src/views/*.ts\`
- \`src/assertions/custom.ts\`
- new user-owned files added outside framework-generated paths when needed

## Framework-Owned Paths

Avoid hand-editing these unless you are deliberately changing Capstan itself or regenerating the app:

- \`AGENTS.md\`
- \`README.md\`
- \`.capstan/**\`
- \`capstan.app.json\`
- \`agent-surface.json\`
- \`human-surface.html\`
- \`capstan.release.json\`
- \`capstan.release-env.json\`
- \`capstan.migrations.json\`
- \`src/control-plane/**\`
- \`src/agent-surface/**\`
- \`src/human-surface/**\`
- \`src/resources/**\`
- \`src/tasks/**\`
- \`src/policies/**\`
- \`src/artifacts/**\`
- \`src/capabilities/generated/**\`
- \`src/views/generated/**\`

## Workflow

1. Read \`README.md\` and this file before changing the app.
2. If the request changes resources, relations, capabilities, tasks, policies, artifacts, views, or route structure, update the upstream brief or App Graph and re-scaffold instead of hand-editing generated framework files.
3. Implement behavior in user-owned files such as \`src/capabilities/*.ts\`, \`src/views/*.ts\`, and \`src/assertions/custom.ts\`.
4. Run \`npm run typecheck\`.
5. When the Capstan CLI is available, run \`npx capstan verify . --json\`.
6. Use verify output as the repair loop. Prefer fixing user-owned files or regenerating from an updated graph over patching generated framework files by hand.

## App Snapshot

- Package name: \`${appName}\`
- Domain: \`${graph.domain.key}\`
${graph.packs?.length ? `- Included packs: ${graph.packs.map((pack) => `\`${pack.key}\``).join(", ")}\n` : ""}

## Official Starter Prompt

\`\`\`text
Use Capstan as the source-of-truth framework for this app.
Read AGENTS.md and README.md first.
Start from the upstream Capstan brief or App Graph instead of rewriting generated app structure by hand.
If the requested change is structural, update the brief or graph and re-scaffold.
After scaffolding, edit only user-owned files such as src/capabilities/*.ts, src/views/*.ts, and src/assertions/custom.ts unless you are explicitly regenerating framework-owned files.
Run npm run typecheck, then run npx capstan verify . --json when the Capstan CLI is available.
Use verify output as the repair loop and report what changed, what passed, and any remaining risks.
\`\`\`
`;
}

function renderTypesFile(): string {
  return `export interface FieldConstraints {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  enum?: string[];
}

export interface DomainDefinition {
  key: string;
  title: string;
  description?: string;
}

export interface ResourceDefinition {
  key: string;
  title: string;
  description?: string;
  fields: Record<string, FieldDefinition>;
  relations?: Record<string, RelationDefinition>;
}

export interface FieldDefinition {
  type: "string" | "integer" | "number" | "boolean" | "date" | "datetime" | "json";
  required?: boolean;
  description?: string;
  constraints?: FieldConstraints;
}

export interface RelationDefinition {
  resource: string;
  kind: "one" | "many";
  description?: string;
}

export interface CapabilityDefinition {
  key: string;
  title: string;
  description?: string;
  mode: "read" | "write" | "external";
  input?: Record<string, FieldDefinition>;
  output?: Record<string, FieldDefinition>;
  resources?: string[];
  task?: string;
  policy?: string;
}

export interface CapabilityExecutionResult {
  capability: string;
  status:
    | "not_implemented"
    | "completed"
    | "failed"
    | "blocked"
    | "approval_required"
    | "input_required"
    | "cancelled";
  input: Record<string, unknown>;
  output?: unknown;
  note?: string;
}

export interface TaskDefinition {
  key: string;
  title: string;
  description?: string;
  kind: "sync" | "durable";
  artifacts?: string[];
}

export interface PolicyDefinition {
  key: string;
  title: string;
  description?: string;
  effect: "allow" | "approve" | "deny" | "redact";
}

export interface ArtifactDefinition {
  key: string;
  title: string;
  description?: string;
  kind: "record" | "file" | "report" | "dataset" | "message";
}

export interface ViewDefinition {
  key: string;
  title: string;
  description?: string;
  kind: "list" | "detail" | "form" | "dashboard" | "workspace";
  resource?: string;
  capability?: string;
}

export interface AppAssertionContext {
  domain: DomainDefinition;
  resources: readonly ResourceDefinition[];
  capabilities: readonly CapabilityDefinition[];
  tasks: readonly TaskDefinition[];
  policies: readonly PolicyDefinition[];
  artifacts: readonly ArtifactDefinition[];
  views: readonly ViewDefinition[];
  controlPlane: {
    search(query?: string): unknown;
  };
  agentSurface: {
    summary?: {
      capabilityCount?: number;
      taskCount?: number;
      artifactCount?: number;
    };
    capabilities?: readonly unknown[];
    tasks?: readonly unknown[];
    artifacts?: readonly unknown[];
  };
  humanSurface: {
    summary?: {
      resourceCount?: number;
      capabilityCount?: number;
      routeCount?: number;
    };
    routes?: readonly { key?: string }[];
  };
  createHumanSurfaceRuntimeSnapshot(): {
    activeRouteKey: string;
    results: Record<string, unknown>;
  };
}

export interface AppAssertionResult {
  status: "passed" | "failed";
  summary: string;
  detail?: string;
  hint?: string;
  file?: string;
}

export interface AppAssertion {
  key: string;
  title: string;
  source?: "generated" | "custom";
  run(
    context: AppAssertionContext
  ): AppAssertionResult | Promise<AppAssertionResult>;
}

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
  domain: DomainDefinition;
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
`;
}

function renderDomainFile(graph: AppGraph): string {
  return `import type { DomainDefinition } from "./types.js";

export const domain = ${serializeObject(graph.domain)} satisfies DomainDefinition;
`;
}

function renderHumanSurfaceModule(
  projection: HumanSurfaceProjection,
  htmlDocument: string
): string {
  return `import { execute, listAttentionItems, listAttentionQueues } from "../control-plane/index.js";

export const humanSurface = ${serializeObject(projection)};

export const humanSurfaceHtml = ${JSON.stringify(htmlDocument)};

export type HumanSurfaceRuntimeMode = "ready" | "loading" | "empty" | "error";
export type HumanSurfaceRouteResultStatus =
  | "idle"
  | "blocked"
  | "approval_required"
  | "input_required"
  | "failed"
  | "paused"
  | "cancelled"
  | "not_implemented"
  | "completed"
  | "redacted"
  | "error";
export type HumanSurfaceAttentionStatus =
  | "approval_required"
  | "input_required"
  | "blocked"
  | "failed"
  | "paused"
  | "cancelled";

export interface HumanSurfaceAttentionFilterDefinition {
  taskKey?: string;
  resourceKey?: string;
  routeKey?: string;
  actionKey?: string;
  status?: HumanSurfaceAttentionStatus;
}

export type HumanSurfaceAttentionScopeFilterDefinition = Omit<
  HumanSurfaceAttentionFilterDefinition,
  "status"
>;

export interface HumanSurfaceAttentionQueueDefinition {
  key: string;
  label: string;
  status: HumanSurfaceAttentionStatus;
  actionKey: string;
  actionTitle: string;
  taskKey: string;
  taskTitle: string;
  filter: {
    taskKey: string;
    routeKey: string;
    actionKey: string;
    status: HumanSurfaceAttentionStatus;
  };
}

export interface HumanSurfaceGlobalAttentionInboxDefinition {
  key: string;
  label: string;
}

export interface HumanSurfaceGlobalAttentionQueueDefinition {
  key: string;
  label: string;
  status: HumanSurfaceAttentionStatus;
}

export interface HumanSurfaceAttentionPresetQueueDefinition {
  key: string;
  label: string;
  status: HumanSurfaceAttentionStatus;
  filter: HumanSurfaceAttentionFilterDefinition;
}

export interface HumanSurfaceAttentionPresetDefinition {
  key: string;
  label: string;
  scope: "task" | "resource" | "route";
  autoSlotKey: HumanSurfaceSupervisionWorkspaceSlotKey;
  description: string;
  filter: HumanSurfaceAttentionScopeFilterDefinition;
  inbox: {
    key: string;
    label: string;
    filter: HumanSurfaceAttentionScopeFilterDefinition;
  };
  queues: HumanSurfaceAttentionPresetQueueDefinition[];
}

export interface HumanSurfaceGlobalAttentionDefinition {
  inbox?: HumanSurfaceGlobalAttentionInboxDefinition;
  queues: HumanSurfaceGlobalAttentionQueueDefinition[];
  presets: HumanSurfaceAttentionPresetDefinition[];
}

type HumanSurfaceActionDefinition = (typeof humanSurface.routes)[number]["actions"][number] & {
  task?: string;
  taskKind?: "sync" | "durable";
  taskTitle?: string;
};

type HumanSurfaceRouteDefinition = Omit<
  (typeof humanSurface.routes)[number],
  "actions" | "attentionQueues"
> & {
  resourceKey?: string;
  sourceResourceKey?: string;
  sourceRelationKey?: string;
  actions: HumanSurfaceActionDefinition[];
  attentionQueues: HumanSurfaceAttentionQueueDefinition[];
};

const routes = humanSurface.routes as HumanSurfaceRouteDefinition[];
const attention = humanSurface.attention as HumanSurfaceGlobalAttentionDefinition;

export interface HumanSurfaceRouteResult {
  status: HumanSurfaceRouteResultStatus;
  payload: unknown;
}

export interface HumanSurfaceAttentionHandoff {
  event: "console.attention.preset.inbox" | "console.attention.preset.queue";
  preset: {
    key: string;
    label: string;
    scope: HumanSurfaceAttentionPresetDefinition["scope"];
    filter: HumanSurfaceAttentionFilterDefinition;
  };
  status?: HumanSurfaceAttentionStatus;
  parent?: HumanSurfaceAttentionHandoff;
}

export interface HumanSurfacePersistedAttentionHandoff {
  event: HumanSurfaceAttentionHandoff["event"];
  presetKey: string;
  status?: HumanSurfaceAttentionStatus;
  parent?: HumanSurfacePersistedAttentionHandoff;
}

export type HumanSurfaceSupervisionWorkspaceSlotKey =
  | "primary"
  | "secondary"
  | "watchlist";
export type HumanSurfaceSupervisionWorkspaceSlotMode = "auto" | "manual";

export interface HumanSurfaceSupervisionWorkspaceSlot {
  key: HumanSurfaceSupervisionWorkspaceSlotKey;
  label: string;
  handoff?: HumanSurfaceAttentionHandoff;
  mode?: HumanSurfaceSupervisionWorkspaceSlotMode;
  seenAttentionIds?: readonly string[];
}

export interface HumanSurfaceSupervisionWorkspaceSlotQueueSummary {
  status: HumanSurfaceAttentionStatus;
  label: string;
  openCount: number;
  newOpenCount: number;
}

export interface HumanSurfaceSupervisionWorkspaceSlotSummary {
  key: HumanSurfaceSupervisionWorkspaceSlotKey;
  label: string;
  mode?: HumanSurfaceSupervisionWorkspaceSlotMode;
  openCount: number;
  newOpenCount: number;
  queueCount: number;
  savedWorkspace?: string;
  topQueue?: HumanSurfaceSupervisionWorkspaceSlotQueueSummary;
}

export interface HumanSurfacePersistedSupervisionWorkspaceSlot {
  key: HumanSurfaceSupervisionWorkspaceSlotKey;
  handoff?: HumanSurfacePersistedAttentionHandoff;
  mode?: HumanSurfaceSupervisionWorkspaceSlotMode;
  seenAttentionIds?: readonly string[];
}

export interface HumanSurfacePersistedSupervisionWorkspaceState {
  version: 1 | 2 | 3 | 4;
  active?: HumanSurfacePersistedAttentionHandoff;
  history: HumanSurfacePersistedAttentionHandoff[];
  slots?: HumanSurfacePersistedSupervisionWorkspaceSlot[];
}

export interface HumanSurfaceRuntimeSnapshot {
  activeRouteKey: string;
  modes: Record<string, HumanSurfaceRuntimeMode>;
  resourceRecords: Record<string, Array<Record<string, unknown>>>;
  results: Record<string, HumanSurfaceRouteResult>;
  consoleAttention: HumanSurfaceRouteResult;
  attention: Record<string, HumanSurfaceRouteResult>;
  attentionHandoffs: Record<string, HumanSurfaceAttentionHandoff | undefined>;
  activeAttentionPreset: HumanSurfaceAttentionHandoff | undefined;
  supervisionWorkspace: HumanSurfaceAttentionHandoff | undefined;
  supervisionWorkspaceHistory: HumanSurfaceAttentionHandoff[];
  supervisionWorkspaceSlots: HumanSurfaceSupervisionWorkspaceSlot[];
  supervisionWorkspaceSlotSummaries: HumanSurfaceSupervisionWorkspaceSlotSummary[];
}

const attentionQueueStatusOrder: readonly HumanSurfaceAttentionStatus[] = [
  "approval_required",
  "input_required",
  "blocked",
  "failed",
  "paused",
  "cancelled"
];

function humanSurfaceAttentionQueueLabel(status: HumanSurfaceAttentionStatus): string {
  switch (status) {
    case "approval_required":
      return "Approval Required";
    case "input_required":
      return "Input Required";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "paused":
      return "Paused";
    case "cancelled":
      return "Cancelled";
  }
}

const supervisionWorkspaceSlotDefinitions = [
  {
    key: "primary" as const,
    label: "Primary"
  },
  {
    key: "secondary" as const,
    label: "Secondary"
  },
  {
    key: "watchlist" as const,
    label: "Watchlist"
  }
] as const;

function createDefaultSupervisionWorkspaceSlots(): HumanSurfaceSupervisionWorkspaceSlot[] {
  return supervisionWorkspaceSlotDefinitions.map((slot) => ({
    key: slot.key,
    label: slot.label
  }));
}

function dedupeAttentionItemIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => id.length > 0))).sort();
}

function createSupervisionWorkspaceSlotSummaries(
  slots: HumanSurfaceSupervisionWorkspaceSlot[]
): HumanSurfaceSupervisionWorkspaceSlotSummary[] {
  return slots.map((slot) => {
    const items = slot.handoff ? listAttentionItems(slot.handoff.preset.filter) : [];
    const seenAttentionIds = new Set(slot.seenAttentionIds ?? []);
    const newItems = items.filter((item) => !seenAttentionIds.has(item.id));
    const queues = slot.handoff
      ? listAttentionQueues(slot.handoff.preset.filter).filter((queue) => queue.openCount > 0)
      : [];
    const topQueue = queues[0];

    return {
      key: slot.key,
      label: slot.label,
      ...(slot.mode ? { mode: slot.mode } : {}),
      openCount: items.length,
      newOpenCount: newItems.length,
      queueCount: queues.length,
      ...(slot.handoff ? { savedWorkspace: slot.handoff.preset.key } : {}),
      ...(topQueue
        ? {
            topQueue: {
              status: topQueue.status,
              label: humanSurfaceAttentionQueueLabel(topQueue.status),
              openCount: topQueue.openCount,
              newOpenCount: newItems.filter((item) => item.status === topQueue.status).length
            }
          }
        : {})
    };
  });
}

function sampleValue(type: string, label: string): string {
  switch (type) {
    case "integer":
      return "7";
    case "number":
      return "42.5";
    case "boolean":
      return "true";
    case "date":
      return "2026-03-22";
    case "datetime":
      return "2026-03-22T10:00";
    case "json":
      return '{"ok":true}';
    default:
      return \`\${label} sample\`;
  }
}

function createSeedRecord(route: HumanSurfaceRouteDefinition): Record<string, unknown> {
  if (route.table?.sampleRow) {
    return route.table.sampleRow;
  }

  return Object.fromEntries(
    (route.fields ?? []).map((field) => [field.key, sampleValue(field.type, field.label)])
  );
}

function createSeedRecords(
  route: HumanSurfaceRouteDefinition
): Array<Record<string, unknown>> {
  if (!route.resourceKey) {
    return [];
  }

  const seedRecord = createSeedRecord(route);
  return Object.keys(seedRecord).length ? [seedRecord] : [];
}

export function renderHumanSurfaceDocument(): string {
  return humanSurfaceHtml;
}

export function createHumanSurfaceRuntimeSnapshot(): HumanSurfaceRuntimeSnapshot {
  const resourceRecords = new Map<string, Array<Record<string, unknown>>>();

  for (const route of routes) {
    if (!route.resourceKey || resourceRecords.has(route.resourceKey)) {
      continue;
    }

    resourceRecords.set(route.resourceKey, createSeedRecords(route));
  }

  return {
    activeRouteKey: routes[0]?.key ?? "",
    modes: Object.fromEntries(
      routes.map((route) => [route.key, "ready" as HumanSurfaceRuntimeMode])
    ) as Record<string, HumanSurfaceRuntimeMode>,
    resourceRecords: Object.fromEntries(resourceRecords.entries()) as Record<
      string,
      Array<Record<string, unknown>>
    >,
    consoleAttention: {
      status: "idle" as HumanSurfaceRouteResultStatus,
      payload: {
        event: "console.attention.idle",
        message: "No global attention inbox or queue has been opened yet."
      }
    },
    results: Object.fromEntries(
      routes.map((route) => [
        route.key,
        {
          status: "idle" as HumanSurfaceRouteResultStatus,
          payload: {
            event: "route.idle",
            routeKey: route.key,
            message: "No capability has been executed for this route yet."
          }
        }
      ])
    ) as Record<string, HumanSurfaceRouteResult>,
    attention: Object.fromEntries(
      routes.map((route) => [
        route.key,
        {
          status: "idle" as HumanSurfaceRouteResultStatus,
          payload: {
            event: "route.attention.idle",
            routeKey: route.key,
            message: "No attention queue lane has been opened for this route yet."
          }
        }
      ])
    ) as Record<string, HumanSurfaceRouteResult>,
    attentionHandoffs: Object.fromEntries(
      routes.map((route) => [route.key, undefined])
    ) as Record<string, HumanSurfaceAttentionHandoff | undefined>,
    activeAttentionPreset: undefined,
    supervisionWorkspace: undefined,
    supervisionWorkspaceHistory: [],
    supervisionWorkspaceSlots: createDefaultSupervisionWorkspaceSlots(),
    supervisionWorkspaceSlotSummaries: createSupervisionWorkspaceSlotSummaries(
      createDefaultSupervisionWorkspaceSlots()
    )
  };
}

export function mountHumanSurfaceBrowser(root: Document = document): HumanSurfaceRuntimeSnapshot {
  const runtime = createHumanSurfaceRuntimeSnapshot();
  const supervisionWorkspaceStorageKey =
    \`capstan:human-surface:supervision:\${humanSurface.domain.key}\`;
  const routeNodes = Array.from(root.querySelectorAll<HTMLElement>("[data-route-key]"));
  const navNodes = Array.from(root.querySelectorAll<HTMLElement>("[data-route-nav]"));
  const consoleRouteNode = root.querySelector<HTMLElement>("[data-console-route]");
  const consoleModeNode = root.querySelector<HTMLElement>("[data-console-mode]");
  const consoleOutputNode = root.querySelector<HTMLElement>("[data-console-output]");
  const consoleAttentionStatusNode = root.querySelector<HTMLElement>("[data-console-attention-status]");
  const consoleAttentionOutputNode = root.querySelector<HTMLElement>("[data-console-attention-output]");

  const findRoute = (routeKey: string) =>
    routes.find((route) => route.key === routeKey) as
      | HumanSurfaceRouteDefinition
      | undefined;

  const findRouteByPath = (routePath: string) =>
    routes.find((route) => route.path === routePath) as
      | HumanSurfaceRouteDefinition
      | undefined;

  const findAttentionPreset = (presetKey: string) =>
    attention.presets.find((preset) => preset.key === presetKey) as
      | HumanSurfaceAttentionPresetDefinition
      | undefined;

  const resolveRouteReference = (reference: string) =>
    findRoute(reference) ?? findRouteByPath(reference);

  const findField = (route: HumanSurfaceRouteDefinition, fieldKey: string) =>
    route.fields.find((field) => field.key === fieldKey);

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const isAttentionStatus = (value: unknown): value is HumanSurfaceAttentionStatus =>
    typeof value === "string" &&
    attentionQueueStatusOrder.includes(value as HumanSurfaceAttentionStatus);

  const isSupervisionWorkspaceSlotMode = (
    value: unknown
  ): value is HumanSurfaceSupervisionWorkspaceSlotMode =>
    value === "auto" || value === "manual";

  const getSupervisionWorkspaceStorage = (): Storage | undefined => {
    try {
      return root.defaultView?.localStorage;
    } catch {
      return undefined;
    }
  };

  const readyCopy = (route: HumanSurfaceRouteDefinition) =>
    \`Ready to operate \${route.title.toLowerCase()} from the generated human surface.\`;

  const stringifyValue = (value: unknown, type: string): string => {
    if (value === undefined || value === null) {
      return "";
    }

    if (type === "json") {
      return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }

    return String(value);
  };

  const escapeHtml = (value: string): string =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const normalizeFieldValue = (value: string, type: string): unknown => {
    switch (type) {
      case "integer": {
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? value : parsed;
      }
      case "number": {
        const parsed = Number.parseFloat(value);
        return Number.isNaN(parsed) ? value : parsed;
      }
      case "boolean":
        return value === "true";
      case "json":
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      default:
        return value;
    }
  };

  const collectInput = (route: HumanSurfaceRouteDefinition): Record<string, unknown> => {
    const inputs = Array.from(
      root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        \`[data-route-input-key="\${route.key}"]\`
      )
    );

    if (!inputs.length) {
      return Object.fromEntries(
        (route.fields ?? []).map((field) => [field.key, sampleValue(field.type, field.label)])
      );
    }

    const payload: Record<string, unknown> = {};

    for (const input of inputs) {
      const fieldKey = input.getAttribute("data-field-key");
      if (!fieldKey) {
        continue;
      }

      const field = findField(route, fieldKey);
      payload[fieldKey] = normalizeFieldValue(input.value, field?.type ?? "string");
    }

    return payload;
  };

  const writeConsole = (payload: unknown): void => {
    if (consoleOutputNode) {
      consoleOutputNode.textContent = JSON.stringify(payload, null, 2);
    }
  };

  const writeRouteResult = (
    routeKey: string,
    status: HumanSurfaceRouteResultStatus,
    payload: unknown
  ): void => {
    runtime.results[routeKey] = {
      status,
      payload
    };
  };

  const writeAttentionResult = (
    routeKey: string,
    status: HumanSurfaceRouteResultStatus,
    payload: unknown
  ): void => {
    runtime.attention[routeKey] = {
      status,
      payload
    };
  };

  const writeConsoleAttentionResult = (
    status: HumanSurfaceRouteResultStatus,
    payload: unknown
  ): void => {
    runtime.consoleAttention = {
      status,
      payload
    };
  };

  const writeAttentionHandoff = (
    routeKey: string,
    handoff?: HumanSurfaceAttentionHandoff
  ): void => {
    runtime.attentionHandoffs[routeKey] = handoff;
  };

  const writeActiveAttentionPreset = (
    handoff?: HumanSurfaceAttentionHandoff
  ): void => {
    runtime.activeAttentionPreset = handoff;
  };

  const findSupervisionWorkspaceSlot = (
    slotKey: HumanSurfaceSupervisionWorkspaceSlotKey
  ): HumanSurfaceSupervisionWorkspaceSlot | undefined =>
    runtime.supervisionWorkspaceSlots.find((slot) => slot.key === slotKey);

  const writeSupervisionWorkspaceSlot = (
    slotKey: HumanSurfaceSupervisionWorkspaceSlotKey,
    handoff?: HumanSurfaceAttentionHandoff,
    mode?: HumanSurfaceSupervisionWorkspaceSlotMode,
    seenAttentionIds: readonly string[] = []
  ): void => {
    runtime.supervisionWorkspaceSlots = runtime.supervisionWorkspaceSlots.map((slot) =>
      slot.key === slotKey
        ? {
            key: slot.key,
            label: slot.label,
            ...(handoff ? { handoff } : {}),
            ...(handoff && mode ? { mode } : {}),
            ...(handoff
              ? { seenAttentionIds: dedupeAttentionItemIds(seenAttentionIds) }
              : {})
          }
        : slot
    );
  };

  const listSeenAttentionIdsForHandoff = (
    handoff?: HumanSurfaceAttentionHandoff
  ): string[] =>
    dedupeAttentionItemIds(
      handoff ? listAttentionItems(handoff.preset.filter).map((item) => item.id) : []
    );

  const markMatchingSupervisionWorkspaceSlotsSeen = (
    handoff: HumanSurfaceAttentionHandoff
  ): void => {
    const signature = attentionTrailIdentity(handoff);

    runtime.supervisionWorkspaceSlots = runtime.supervisionWorkspaceSlots.map((slot) => {
      if (!slot.handoff || attentionTrailIdentity(slot.handoff) !== signature) {
        return slot;
      }

      return {
        ...slot,
        seenAttentionIds: listSeenAttentionIdsForHandoff(slot.handoff)
      };
    });
  };

  const refreshSupervisionWorkspaceSlotSummaries = (): HumanSurfaceSupervisionWorkspaceSlotSummary[] => {
    runtime.supervisionWorkspaceSlotSummaries = createSupervisionWorkspaceSlotSummaries(
      runtime.supervisionWorkspaceSlots
    );
    return runtime.supervisionWorkspaceSlotSummaries;
  };

  const autoSaveAttentionPresetToSlot = (
    preset: HumanSurfaceAttentionPresetDefinition,
    handoff: HumanSurfaceAttentionHandoff
  ): void => {
    const slot = findSupervisionWorkspaceSlot(preset.autoSlotKey);

    if (!slot) {
      return;
    }

    if (
      slot.mode === "manual" &&
      slot.handoff &&
      attentionTrailIdentity(slot.handoff) !== attentionTrailIdentity(handoff)
    ) {
      return;
    }

    if (
      slot.mode === "manual" &&
      slot.handoff &&
      attentionTrailIdentity(slot.handoff) === attentionTrailIdentity(handoff)
    ) {
      return;
    }

    writeSupervisionWorkspaceSlot(
      preset.autoSlotKey,
      handoff,
      "auto",
      listSeenAttentionIdsForHandoff(handoff)
    );
  };

  const writeSupervisionWorkspace = (
    handoff?: HumanSurfaceAttentionHandoff
  ): void => {
    runtime.supervisionWorkspace = handoff;

    if (handoff) {
      const signature = attentionTrailIdentity(handoff);
      runtime.supervisionWorkspaceHistory = [
        handoff,
        ...runtime.supervisionWorkspaceHistory.filter(
          (entry) => attentionTrailIdentity(entry) !== signature
        )
      ].slice(0, 5);
    }

    persistSupervisionWorkspaceState();
  };

  const setSupervisionWorkspace = (
    handoff?: HumanSurfaceAttentionHandoff
  ): void => {
    runtime.supervisionWorkspace = handoff;
    runtime.activeAttentionPreset = handoff;
    persistSupervisionWorkspaceState();
  };

  const clearActiveSupervisionWorkspace = (): void => {
    const active = runtime.supervisionWorkspace;

    if (!active) {
      return;
    }

    const signature = attentionTrailIdentity(active);
    runtime.supervisionWorkspaceHistory = runtime.supervisionWorkspaceHistory.filter(
      (entry) => attentionTrailIdentity(entry) !== signature
    );
    setSupervisionWorkspace(runtime.supervisionWorkspaceHistory[0]);
  };

  const clearSupervisionWorkspaceHistory = (): void => {
    runtime.supervisionWorkspaceHistory = [];
    setSupervisionWorkspace(undefined);
  };

  const saveActiveSupervisionWorkspaceToSlot = (
    slotKey: HumanSurfaceSupervisionWorkspaceSlotKey
  ): HumanSurfaceSupervisionWorkspaceSlot | undefined => {
    const workspace = runtime.supervisionWorkspace;

    if (!workspace) {
      return undefined;
    }

    writeSupervisionWorkspaceSlot(
      slotKey,
      workspace,
      "manual",
      listSeenAttentionIdsForHandoff(workspace)
    );
    persistSupervisionWorkspaceState();
    return findSupervisionWorkspaceSlot(slotKey);
  };

  const clearSupervisionWorkspaceSlot = (
    slotKey: HumanSurfaceSupervisionWorkspaceSlotKey
  ): HumanSurfaceSupervisionWorkspaceSlot | undefined => {
    writeSupervisionWorkspaceSlot(slotKey, undefined);
    persistSupervisionWorkspaceState();
    return findSupervisionWorkspaceSlot(slotKey);
  };

  const attentionStatusToResultStatus = (
    status: string
  ): HumanSurfaceRouteResultStatus => {
    switch (status) {
      case "approval_required":
      case "input_required":
      case "blocked":
      case "failed":
      case "paused":
      case "cancelled":
        return status;
      default:
        return "idle";
    }
  };

  const buildAttentionFilter = (
    filter: HumanSurfaceAttentionScopeFilterDefinition,
    status?: HumanSurfaceAttentionStatus | ""
  ): HumanSurfaceAttentionFilterDefinition => ({
    ...(filter.taskKey ? { taskKey: filter.taskKey } : {}),
    ...(filter.resourceKey ? { resourceKey: filter.resourceKey } : {}),
    ...(filter.routeKey ? { routeKey: filter.routeKey } : {}),
    ...(filter.actionKey ? { actionKey: filter.actionKey } : {}),
    ...(status ? { status } : {})
  });

  const routeMatchesAttentionScopeFilter = (
    route: HumanSurfaceRouteDefinition,
    filter: HumanSurfaceAttentionScopeFilterDefinition
  ): boolean => {
    if (filter.routeKey && filter.routeKey !== route.key) {
      return false;
    }

    if (
      filter.resourceKey &&
      route.resourceKey !== filter.resourceKey &&
      route.sourceResourceKey !== filter.resourceKey
    ) {
      return false;
    }

    if (
      filter.taskKey &&
      !route.actions.some((action) => action.task === filter.taskKey)
    ) {
      return false;
    }

    if (
      filter.actionKey &&
      !route.actions.some((action) => action.key === filter.actionKey)
    ) {
      return false;
    }

    return true;
  };

  const attentionPresetFiltersOverlap = (
    left: HumanSurfaceAttentionScopeFilterDefinition,
    right: HumanSurfaceAttentionScopeFilterDefinition
  ): boolean =>
    routes.some(
      (route) =>
        routeMatchesAttentionScopeFilter(route, left) &&
        routeMatchesAttentionScopeFilter(route, right)
    );

  const resolveAttentionHandoffParent = (
    preset: HumanSurfaceAttentionPresetDefinition
  ): HumanSurfaceAttentionHandoff | undefined => {
    const activePreset =
      runtime.activeAttentionPreset?.preset.key === preset.key
        ? runtime.activeAttentionPreset.parent
        : runtime.activeAttentionPreset;

    if (!activePreset) {
      return undefined;
    }

    return attentionPresetFiltersOverlap(activePreset.preset.filter, preset.filter)
      ? activePreset
      : undefined;
  };

  const activatePresetRoute = (
    preset: HumanSurfaceAttentionPresetDefinition
  ): void => {
    const routeKey = preset.filter.routeKey;

    if (routeKey && findRoute(routeKey)) {
      runtime.activeRouteKey = routeKey;
    }
  };

  const createAttentionHandoff = (
    event: HumanSurfaceAttentionHandoff["event"],
    preset: HumanSurfaceAttentionPresetDefinition,
    status?: HumanSurfaceAttentionStatus | "",
    parent?: HumanSurfaceAttentionHandoff
  ): HumanSurfaceAttentionHandoff => {
    return {
      event,
      preset: {
        key: preset.key,
        label: preset.label,
        scope: preset.scope,
        filter: buildAttentionFilter(preset.filter)
      },
      ...(status ? { status } : {}),
      ...(parent ? { parent } : {})
    };
  };

  const serializePersistedAttentionHandoff = (
    handoff?: HumanSurfaceAttentionHandoff
  ): HumanSurfacePersistedAttentionHandoff | undefined => {
    if (!handoff) {
      return undefined;
    }

    const parent = serializePersistedAttentionHandoff(handoff.parent);

    return {
      event: handoff.event,
      presetKey: handoff.preset.key,
      ...(handoff.status ? { status: handoff.status } : {}),
      ...(parent ? { parent } : {})
    };
  };

  const restorePersistedAttentionHandoff = (
    candidate: unknown
  ): HumanSurfaceAttentionHandoff | undefined => {
    if (!isRecord(candidate)) {
      return undefined;
    }

    const event = candidate.event;

    if (
      event !== "console.attention.preset.inbox" &&
      event !== "console.attention.preset.queue"
    ) {
      return undefined;
    }

    const presetKey = typeof candidate.presetKey === "string" ? candidate.presetKey : "";
    const preset = presetKey ? findAttentionPreset(presetKey) : undefined;

    if (!preset) {
      return undefined;
    }

    const statusValue = candidate.status;

    if (statusValue !== undefined && !isAttentionStatus(statusValue)) {
      return undefined;
    }

    const parentCandidate = candidate.parent;
    const parent =
      parentCandidate === undefined
        ? undefined
        : restorePersistedAttentionHandoff(parentCandidate);
    const status =
      statusValue !== undefined && isAttentionStatus(statusValue) ? statusValue : undefined;

    if (parentCandidate !== undefined && !parent) {
      return undefined;
    }

    return createAttentionHandoff(event, preset, status, parent);
  };

  const serializePersistedSupervisionWorkspaceSlot = (
    slot: HumanSurfaceSupervisionWorkspaceSlot
  ): HumanSurfacePersistedSupervisionWorkspaceSlot => {
    const handoff = serializePersistedAttentionHandoff(slot.handoff);

    return {
      key: slot.key,
      ...(handoff ? { handoff } : {}),
      ...(slot.mode ? { mode: slot.mode } : {}),
      ...(handoff ? { seenAttentionIds: dedupeAttentionItemIds(slot.seenAttentionIds ?? []) } : {})
    };
  };

  const restorePersistedSupervisionWorkspaceSlots = (
    candidate: unknown,
    version: HumanSurfacePersistedSupervisionWorkspaceState["version"]
  ): HumanSurfaceSupervisionWorkspaceSlot[] => {
    const slots = createDefaultSupervisionWorkspaceSlots();

    if (!Array.isArray(candidate)) {
      return slots;
    }

    return slots.map((slot) => {
      const persistedSlot = candidate.find(
        (entry) => isRecord(entry) && entry.key === slot.key
      );

      if (!persistedSlot) {
        return slot;
      }

      const handoff = restorePersistedAttentionHandoff(persistedSlot.handoff);
      const mode = isSupervisionWorkspaceSlotMode(persistedSlot.mode)
        ? persistedSlot.mode
        : "manual";
      const seenAttentionIds = Array.isArray(persistedSlot.seenAttentionIds)
        ? dedupeAttentionItemIds(
            persistedSlot.seenAttentionIds.filter(
              (entry: unknown): entry is string => typeof entry === "string"
            )
          )
        : undefined;
      return handoff
        ? {
            ...slot,
            handoff,
            mode,
            seenAttentionIds:
              version === 4
                ? seenAttentionIds ?? []
                : listSeenAttentionIdsForHandoff(handoff)
          }
        : slot;
    });
  };

  const flattenAttentionHandoffChain = (
    current?: HumanSurfaceAttentionHandoff
  ): HumanSurfaceAttentionHandoff[] => {
    if (!current) {
      return [];
    }

    return [...flattenAttentionHandoffChain(current.parent), current];
  };

  const attentionTrailIdentity = (
    handoff: HumanSurfaceAttentionHandoff
  ): string => flattenAttentionHandoffChain(handoff).map((entry) => entry.preset.key).join(">");

  const persistSupervisionWorkspaceState = (): void => {
    const storage = getSupervisionWorkspaceStorage();

    if (!storage) {
      return;
    }

    try {
      const history = runtime.supervisionWorkspaceHistory
        .map((entry) => serializePersistedAttentionHandoff(entry))
        .filter(
          (entry): entry is HumanSurfacePersistedAttentionHandoff => Boolean(entry)
        );
      const active = serializePersistedAttentionHandoff(runtime.supervisionWorkspace);
      const slots = runtime.supervisionWorkspaceSlots
        .map((slot) => serializePersistedSupervisionWorkspaceSlot(slot))
        .filter((slot) => Boolean(slot.handoff));

      if (!active && !history.length && !slots.length) {
        storage.removeItem(supervisionWorkspaceStorageKey);
        return;
      }

      const state: HumanSurfacePersistedSupervisionWorkspaceState = {
        version: 4,
        history,
        ...(slots.length ? { slots } : {}),
        ...(active ? { active } : {})
      };

      storage.setItem(supervisionWorkspaceStorageKey, JSON.stringify(state));
    } catch {
      // Ignore browser storage failures so the surface remains usable in restricted runtimes.
    }
  };

  const restoreSupervisionWorkspaceState = (): void => {
    const storage = getSupervisionWorkspaceStorage();

    if (!storage) {
      return;
    }

    try {
      const serializedState = storage.getItem(supervisionWorkspaceStorageKey);

      if (!serializedState) {
        return;
      }

      const parsedState = JSON.parse(serializedState) as unknown;

      if (
        !isRecord(parsedState) ||
        (parsedState.version !== 1 &&
          parsedState.version !== 2 &&
          parsedState.version !== 3 &&
          parsedState.version !== 4) ||
        !Array.isArray(parsedState.history)
      ) {
        storage.removeItem(supervisionWorkspaceStorageKey);
        return;
      }

      runtime.supervisionWorkspaceSlots = restorePersistedSupervisionWorkspaceSlots(
        parsedState.slots,
        parsedState.version
      );
      runtime.supervisionWorkspaceHistory = parsedState.history
        .map((entry) => restorePersistedAttentionHandoff(entry))
        .filter((entry): entry is HumanSurfaceAttentionHandoff => Boolean(entry))
        .slice(0, 5);

      const restoredActive = restorePersistedAttentionHandoff(parsedState.active);
      const activeWorkspace = restoredActive ?? runtime.supervisionWorkspaceHistory[0];

      if (!activeWorkspace) {
        storage.removeItem(supervisionWorkspaceStorageKey);
        return;
      }

      const preset = findAttentionPreset(activeWorkspace.preset.key);

      if (!preset) {
        storage.removeItem(supervisionWorkspaceStorageKey);
        return;
      }

      openAttentionPreset(preset, {
        event: activeWorkspace.event,
        ...(activeWorkspace.status ? { status: activeWorkspace.status } : {}),
        ...(activeWorkspace.parent ? { parent: activeWorkspace.parent } : {}),
        syncWorkspaceSlots: false
      });
    } catch {
      storage.removeItem(supervisionWorkspaceStorageKey);
    }
  };

  const attentionPresetScopeLabel = (
    scope: HumanSurfaceAttentionPresetDefinition["scope"]
  ): string => {
    switch (scope) {
      case "task":
        return "Task Attention";
      case "resource":
        return "Resource Attention";
      case "route":
        return "Route Attention";
    }
  };

  const renderAttentionTrailBadges = (
    handoff?: HumanSurfaceAttentionHandoff
    ,
    leadLabel = "Console Handoff"
  ): string => {
    const chain = flattenAttentionHandoffChain(handoff);

    if (!handoff) {
      return \`<span class="capstan-badge">\${escapeHtml(leadLabel === "Pinned Workspace" ? "No Pinned Workspace" : "No Console Handoff")}</span>\`;
    }

    return chain
      .flatMap((entry, index) => [
        index === 0 ? \`<span class="capstan-badge">\${escapeHtml(leadLabel)}</span>\` : "",
        \`<span class="capstan-badge">\${escapeHtml(attentionPresetScopeLabel(entry.preset.scope))}</span>\`,
        \`<span class="capstan-badge">\${escapeHtml(entry.preset.label)}</span>\`,
        entry.status
          ? \`<span class="capstan-badge">\${escapeHtml(entry.status)}</span>\`
          : ""
      ])
      .filter(Boolean)
      .join("");
  };

  const renderAttentionHandoffBadges = (
    handoff?: HumanSurfaceAttentionHandoff
  ): string => renderAttentionTrailBadges(handoff);

  const renderSupervisionWorkspaceBadges = (
    handoff?: HumanSurfaceAttentionHandoff
  ): string => renderAttentionTrailBadges(handoff, "Pinned Workspace");

  const attentionHandoffControlLabel = (
    handoff: HumanSurfaceAttentionHandoff
  ): string =>
    handoff.status
      ? \`Open \${handoff.preset.label} \${handoff.status} Queue\`
      : \`Open \${handoff.preset.label} Inbox\`;

  const renderAttentionHandoffControls = (
    routeKey: string,
    handoff?: HumanSurfaceAttentionHandoff
  ): string => {
    if (!handoff) {
      return "";
    }

    const chain = flattenAttentionHandoffChain(handoff);

    return chain
      .map(
        (entry, index) =>
          \`<button type="button" class="capstan-state-toggle\${index === chain.length - 1 ? " is-active" : ""}" data-route-attention-handoff-open="\${escapeHtml(routeKey)}" data-route-attention-handoff-step="\${index}">\${escapeHtml(attentionHandoffControlLabel(entry))}</button>\`
      )
      .join("");
  };

  const attentionHandoffCopy = (
    handoff: HumanSurfaceAttentionHandoff | undefined,
    route: HumanSurfaceRouteDefinition
  ): string => {
    const describeAttentionHandoffStep = (
      entry: HumanSurfaceAttentionHandoff
    ): string => {
      const statusCopy = entry.status ? \` via the \${entry.status} queue\` : "";
      return \`\${attentionPresetScopeLabel(entry.preset.scope).toLowerCase()} preset "\${entry.preset.label}"\${statusCopy}\`;
    };

    const chain = flattenAttentionHandoffChain(handoff);

    if (!handoff) {
      return "Open a task-, resource-, or route-scoped attention preset from the operator console to carry breadcrumb context into this route-local queue lane.";
    }

    if (chain.length === 1) {
      const only = chain[0]!;
      return \`Handoff from \${describeAttentionHandoffStep(only)} into \${route.title}.\`;
    }

    const first = chain[0]!;
    const last = chain[chain.length - 1]!;
    const middle = chain.slice(1, -1);

    return \`Handoff from \${describeAttentionHandoffStep(first)}\${middle.length ? \`, through \${middle.map((entry) => describeAttentionHandoffStep(entry)).join(", through ")}\` : ""}, into \${describeAttentionHandoffStep(last)} for \${route.title}.\`;
  };

  const supervisionWorkspaceCopy = (
    handoff?: HumanSurfaceAttentionHandoff
  ): string => {
    if (!handoff) {
      return "Open a task-, resource-, or route-scoped attention preset to pin a reusable supervision workspace.";
    }

    const chain = flattenAttentionHandoffChain(handoff);
    const describeAttentionHandoffStep = (
      entry: HumanSurfaceAttentionHandoff
    ): string => {
      const statusCopy = entry.status ? \` via the \${entry.status} queue\` : "";
      return \`\${attentionPresetScopeLabel(entry.preset.scope).toLowerCase()} preset "\${entry.preset.label}"\${statusCopy}\`;
    };
    const first = chain[0]!;
    const last = chain[chain.length - 1]!;
    const middle = chain.slice(1, -1);

    return \`Pinned from \${describeAttentionHandoffStep(first)}\${middle.length ? \`, through \${middle.map((entry) => describeAttentionHandoffStep(entry)).join(", through ")}\` : ""}, into \${describeAttentionHandoffStep(last)}. Refresh or reopen this workspace from anywhere in the surface.\`;
  };

  const supervisionWorkspaceRefreshLabel = (
    handoff?: HumanSurfaceAttentionHandoff
  ): string => {
    if (!handoff) {
      return "Refresh Workspace";
    }

    return handoff.status
      ? \`Refresh \${handoff.preset.label} \${handoff.status} Queue\`
      : \`Refresh \${handoff.preset.label} Inbox\`;
  };

  const supervisionWorkspaceInboxLabel = (
    handoff?: HumanSurfaceAttentionHandoff
  ): string => handoff ? \`Open \${handoff.preset.label} Inbox\` : "Open Workspace Inbox";

  const supervisionWorkspaceHistoryCountLabel = (
    history: HumanSurfaceAttentionHandoff[]
  ): string => \`\${history.length} saved\`;

  const supervisionWorkspaceSlotCountLabel = (
    slots: HumanSurfaceSupervisionWorkspaceSlot[]
  ): string => \`\${slots.filter((slot) => slot.handoff).length} named\`;

  const supervisionWorkspaceSlotSummaryCountLabel = (
    summaries: HumanSurfaceSupervisionWorkspaceSlotSummary[]
  ): string => {
    const activeCount = summaries.filter((summary) => summary.openCount > 0).length;
    const newCount = summaries.filter((summary) => summary.newOpenCount > 0).length;

    return newCount ? \`\${activeCount} active · \${newCount} new\` : \`\${activeCount} active\`;
  };

  const supervisionWorkspaceSlotLabel = (
    slotKey: HumanSurfaceSupervisionWorkspaceSlotKey
  ): string =>
    supervisionWorkspaceSlotDefinitions.find((slot) => slot.key === slotKey)?.label ??
    slotKey;

  const supervisionWorkspaceSlotRoleBadge = (
    slotKey: HumanSurfaceSupervisionWorkspaceSlotKey
  ): string => {
    switch (slotKey) {
      case "primary":
        return "Task Auto Slot";
      case "secondary":
        return "Resource Auto Slot";
      case "watchlist":
        return "Route Auto Slot";
    }
  };

  const supervisionWorkspaceSlotCopy = (
    slot: HumanSurfaceSupervisionWorkspaceSlot
  ): string => {
    if (!slot.handoff) {
      switch (slot.key) {
        case "primary":
          return "Task attention presets auto-save here unless you manually replace the slot.";
        case "secondary":
          return "Resource attention presets auto-save here unless you manually replace the slot.";
        case "watchlist":
          return "Route attention presets auto-save here unless you manually replace the slot.";
      }
    }

    if (slot.mode === "manual") {
      return \`Saved manually in the \${slot.label.toLowerCase()} slot. This manual override keeps its workspace until you clear or replace the slot yourself.\`;
    }

    return \`Auto-saved in the \${slot.label.toLowerCase()} slot. Opening matching presets refreshes this named workspace without relying on recent history.\`;
  };

  const renderSupervisionWorkspaceSlotBadges = (
    slot: HumanSurfaceSupervisionWorkspaceSlot,
    isActive: boolean
  ): string => {
    if (!slot.handoff) {
      return \`<span class="capstan-badge">\${escapeHtml(slot.label)} Slot</span><span class="capstan-badge">\${escapeHtml(supervisionWorkspaceSlotRoleBadge(slot.key))}</span>\`;
    }

    return renderAttentionTrailBadges(
      slot.handoff,
      isActive
        ? \`\${slot.label} Active \${slot.mode === "manual" ? "Manual" : "Auto"} Slot\`
        : \`\${slot.label} \${slot.mode === "manual" ? "Manual" : "Auto"} Slot\`
    );
  };

  const renderSupervisionWorkspaceSlots = (
    slots: HumanSurfaceSupervisionWorkspaceSlot[],
    active?: HumanSurfaceAttentionHandoff
  ): string =>
    slots
      .map((slot) => {
        const openCount = slot.handoff ? listAttentionItems(slot.handoff.preset.filter).length : 0;
        const isActive = Boolean(
          slot.handoff &&
            active &&
            attentionTrailIdentity(slot.handoff) === attentionTrailIdentity(active)
        );
        const saveLabel = slot.handoff ? "Replace With Active" : "Save Active Here";
        const slotStateLabel = isActive
          ? "Active Slot"
          : slot.handoff
            ? slot.mode === "manual"
              ? "Manual Slot"
              : "Auto Slot"
            : "Empty Slot";

        return \`<article class="capstan-console-card">
  <span>\${escapeHtml(slotStateLabel)}</span>
  <strong>\${escapeHtml(slot.label)}</strong>
  <div class="capstan-badges">\${renderSupervisionWorkspaceSlotBadges(slot, isActive)}</div>
  <p class="capstan-console-copy">\${escapeHtml(supervisionWorkspaceSlotCopy(slot))}</p>
  <span class="capstan-attention-count">\${openCount} open</span>
  <button type="button" class="capstan-action-button" data-console-supervision-slot-open="\${escapeHtml(slot.key)}"\${slot.handoff ? "" : " disabled"}>\${escapeHtml(isActive ? "Open Active Slot" : "Open Slot")}</button>
  <button type="button" class="capstan-state-toggle" data-console-supervision-slot-save="\${escapeHtml(slot.key)}"\${runtime.supervisionWorkspace ? "" : " disabled"}>\${escapeHtml(saveLabel)}</button>
  <button type="button" class="capstan-state-toggle" data-console-supervision-slot-clear="\${escapeHtml(slot.key)}"\${slot.handoff ? "" : " disabled"}>Clear Slot</button>
</article>\`;
      })
      .join("");

  const renderSupervisionWorkspaceHistory = (
    history: HumanSurfaceAttentionHandoff[],
    active?: HumanSurfaceAttentionHandoff
  ): string => {
    if (!history.length) {
      return '<article class="capstan-console-card"><span>No Saved Workspaces</span><strong>Pin an attention trail to recover it later.</strong></article>';
    }

    const activeSignature = active ? attentionTrailIdentity(active) : "";

    return history
      .map((entry, index) => {
        const entrySignature = attentionTrailIdentity(entry);
        const entryFilter = entry.preset.filter;
        const openCount = listAttentionItems(entryFilter).length;
        const isActive = entrySignature === activeSignature;

        return \`<article class="capstan-console-card">
  <span>\${escapeHtml(isActive ? "Active Workspace" : "Saved Workspace")}</span>
  <strong>\${escapeHtml(entry.preset.label)}</strong>
  <div class="capstan-badges">\${renderAttentionTrailBadges(entry, isActive ? "Active Trail" : "Saved Trail")}</div>
  <p class="capstan-console-copy">\${escapeHtml(supervisionWorkspaceCopy(entry))}</p>
  <span class="capstan-attention-count">\${openCount} open</span>
  <button type="button" class="capstan-action-button" data-console-supervision-history-resume="\${index}">\${escapeHtml(isActive ? "Resume Active Workspace" : "Resume Workspace")}</button>
</article>\`;
      })
      .join("");
  };

  const openAttentionPreset = (
    preset: HumanSurfaceAttentionPresetDefinition,
    options: {
      event: HumanSurfaceAttentionHandoff["event"];
      status?: HumanSurfaceAttentionStatus | "";
      parent?: HumanSurfaceAttentionHandoff;
      syncWorkspaceSlots?: boolean;
    }
  ): void => {
    const baseFilter = buildAttentionFilter(preset.filter);
    const filter = buildAttentionFilter(preset.filter, options.status);
    const items = listAttentionItems(filter);
    activatePresetRoute(preset);
    const handoff = createAttentionHandoff(
      options.event,
      preset,
      options.status,
      options.parent
    );
    writeActiveAttentionPreset(handoff);
    writeSupervisionWorkspace(handoff);
    if (options.syncWorkspaceSlots !== false) {
      autoSaveAttentionPresetToSlot(preset, handoff);
      markMatchingSupervisionWorkspaceSlotsSeen(handoff);
    }
    refreshSupervisionWorkspaceSlotSummaries();
    persistSupervisionWorkspaceState();
    const workspaceSlot = findSupervisionWorkspaceSlot(preset.autoSlotKey);
    const workspaceSlotSummary = runtime.supervisionWorkspaceSlotSummaries.find(
      (summary) => summary.key === preset.autoSlotKey
    );
    const workspaceSlotPayload = workspaceSlot
      ? {
          workspaceSlot: {
            key: workspaceSlot.key,
            label: supervisionWorkspaceSlotLabel(workspaceSlot.key),
            mode: workspaceSlot.mode ?? "auto",
            savedWorkspace: workspaceSlot.handoff?.preset.key ?? null,
            summary: workspaceSlotSummary ?? null
          }
        }
      : {};
    const payload = options.event === "console.attention.preset.queue"
      ? (() => {
          const queue =
            listAttentionQueues(filter)[0] ??
            {
              status: options.status,
              openCount: 0,
              filter
            };

          return {
            event: "console.attention.preset.queue" as const,
            preset: {
              key: preset.key,
              label: preset.label,
              scope: preset.scope,
              filter: baseFilter
            },
            status: options.status,
            openCount: queue.openCount,
            queue,
            items,
            ...workspaceSlotPayload
          };
        })()
      : {
          event: "console.attention.preset.inbox" as const,
          preset: {
            key: preset.key,
            label: preset.label,
            scope: preset.scope,
            filter: baseFilter
          },
          openCount: items.length,
          queues: listAttentionQueues(baseFilter),
          items,
          ...workspaceSlotPayload
        };

    if (handoff.preset.filter.routeKey) {
      writeAttentionHandoff(handoff.preset.filter.routeKey, handoff);
    }

    writeConsoleAttentionResult(
      options.event === "console.attention.preset.queue"
        ? attentionStatusToResultStatus(options.status ?? "")
        : attentionStatusToResultStatus(listAttentionQueues(baseFilter)[0]?.status ?? ""),
      payload
    );
    render();
    writeConsole(payload);
  };

  const extractRecord = (
    route: HumanSurfaceRouteDefinition,
    candidate: unknown
  ): Record<string, unknown> | undefined => {
    if (!isRecord(candidate)) {
      return undefined;
    }

    const entries = route.fields
      .filter((field) => candidate[field.key] !== undefined)
      .map((field) => [field.key, candidate[field.key]]);

    return entries.length ? Object.fromEntries(entries) : undefined;
  };

  const deriveRecords = (
    route: HumanSurfaceRouteDefinition,
    result: { output?: unknown },
    input: Record<string, unknown>
  ): Array<Record<string, unknown>> => {
    const candidates: unknown[] = [];
    const output = result.output;

    if (Array.isArray(output)) {
      candidates.push(...output);
    } else if (isRecord(output)) {
      if (Array.isArray(output.records)) {
        candidates.push(...output.records);
      }

      if (Array.isArray(output.items)) {
        candidates.push(...output.items);
      }

      if (isRecord(output.record)) {
        candidates.push(output.record);
      }

      if (isRecord(output.item)) {
        candidates.push(output.item);
      }

      candidates.push(output);
    }

    if (!candidates.length && Object.keys(input).length) {
      candidates.push(input);
    }

    return candidates
      .map((candidate) => extractRecord(route, candidate))
      .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  };

  const renderAttentionProjection = (route: HumanSurfaceRouteDefinition): void => {
    if (!route.attentionQueues?.length) {
      return;
    }

    route.attentionQueues.forEach((queue) => {
      const queueResult = listAttentionQueues(queue.filter).find(
        (entry) => entry.status === queue.status
      );
      const openCount = queueResult?.openCount ?? 0;
      const countNode = root.querySelector<HTMLElement>(
        \`[data-attention-open-count-route="\${route.key}"][data-attention-action-key="\${queue.actionKey}"][data-attention-status="\${queue.status}"]\`
      );

      if (countNode) {
        countNode.textContent = \`\${openCount} open\`;
        countNode.setAttribute("data-open-count", String(openCount));
      }
    });
  };

  const renderConsoleAttentionProjection = (): void => {
    const items = listAttentionItems();
    const queues = listAttentionQueues();

    root.querySelectorAll<HTMLElement>("[data-console-attention-total]").forEach((node) => {
      node.textContent = \`\${items.length} open\`;
    });

    attention.queues.forEach((queue) => {
      const openCount = queues.find((entry) => entry.status === queue.status)?.openCount ?? 0;
      root
        .querySelectorAll<HTMLElement>(\`[data-console-attention-count="\${queue.status}"]\`)
        .forEach((node) => {
          node.textContent = \`\${openCount} open\`;
        });
    });

    attention.presets.forEach((preset) => {
      const presetFilter = buildAttentionFilter(preset.filter);
      const presetItems = listAttentionItems(presetFilter);
      const presetQueues = listAttentionQueues(presetFilter);

      root
        .querySelectorAll<HTMLElement>(
          \`[data-console-attention-preset-total="\${preset.key}"]\`
        )
        .forEach((node) => {
          node.textContent = \`\${presetItems.length} open\`;
        });

      preset.queues.forEach((queue) => {
        const openCount =
          presetQueues.find((entry) => entry.status === queue.status)?.openCount ?? 0;

        root
          .querySelectorAll<HTMLButtonElement>(
            \`[data-console-attention-preset-queue="\${preset.key}"][data-console-attention-preset-status="\${queue.status}"]\`
          )
          .forEach((node) => {
            const label =
              node.getAttribute("data-console-attention-preset-queue-label") ??
              queue.label;
            node.textContent = \`Open \${label} Queue · \${openCount} open\`;
        });
      });
    });

    const workspace = runtime.supervisionWorkspace;
    const workspaceHistory = runtime.supervisionWorkspaceHistory;
    const workspaceSlots = runtime.supervisionWorkspaceSlots;
    const workspaceSlotSummaries = refreshSupervisionWorkspaceSlotSummaries();
    const workspaceFilter = workspace?.preset.filter;
    const workspaceItems = workspaceFilter ? listAttentionItems(workspaceFilter) : [];
    const workspaceQueues = workspaceFilter ? listAttentionQueues(workspaceFilter) : [];
    const workspaceStatus = workspace
      ? attentionStatusToResultStatus(workspace.status ?? workspaceQueues[0]?.status ?? "")
      : "idle";
    const workspaceTrailNode = root.querySelector<HTMLElement>(
      "[data-console-supervision-trail]"
    );
    const workspaceCopyNode = root.querySelector<HTMLElement>(
      "[data-console-supervision-copy]"
    );
    const workspaceStatusNode = root.querySelector<HTMLElement>(
      "[data-console-supervision-status]"
    );
    const workspaceHistoryNode = root.querySelector<HTMLElement>(
      "[data-console-supervision-history]"
    );
    const workspaceHistoryCountNode = root.querySelector<HTMLElement>(
      "[data-console-supervision-history-count]"
    );
    const workspaceSlotsNode = root.querySelector<HTMLElement>(
      "[data-console-supervision-slots]"
    );
    const workspaceSlotCountNode = root.querySelector<HTMLElement>(
      "[data-console-supervision-slot-count]"
    );
    const workspaceSlotSummariesNode = root.querySelector<HTMLElement>(
      "[data-console-supervision-slot-summaries]"
    );
    const workspaceSlotSummaryCountNode = root.querySelector<HTMLElement>(
      "[data-console-supervision-slot-summary-count]"
    );

    if (workspaceTrailNode) {
      workspaceTrailNode.innerHTML = renderSupervisionWorkspaceBadges(workspace);
    }

    if (workspaceCopyNode) {
      workspaceCopyNode.textContent = supervisionWorkspaceCopy(workspace);
    }

    if (workspaceStatusNode) {
      workspaceStatusNode.textContent = workspaceStatus;
      workspaceStatusNode.setAttribute("data-console-supervision-state", workspaceStatus);
    }

    if (workspaceHistoryNode) {
      workspaceHistoryNode.innerHTML = renderSupervisionWorkspaceHistory(
        workspaceHistory,
        workspace
      );
    }

    if (workspaceHistoryCountNode) {
      workspaceHistoryCountNode.textContent = supervisionWorkspaceHistoryCountLabel(
        workspaceHistory
      );
    }

    if (workspaceSlotsNode) {
      workspaceSlotsNode.innerHTML = renderSupervisionWorkspaceSlots(workspaceSlots, workspace);
    }

    if (workspaceSlotCountNode) {
      workspaceSlotCountNode.textContent = supervisionWorkspaceSlotCountLabel(workspaceSlots);
    }

    if (workspaceSlotSummariesNode) {
      workspaceSlotSummariesNode.innerHTML = renderSupervisionWorkspaceSlotSummaries(
        workspaceSlotSummaries
      );
    }

    if (workspaceSlotSummaryCountNode) {
      workspaceSlotSummaryCountNode.textContent = supervisionWorkspaceSlotSummaryCountLabel(
        workspaceSlotSummaries
      );
    }

    root
      .querySelectorAll<HTMLElement>("[data-console-supervision-total]")
      .forEach((node) => {
        node.textContent = \`\${workspaceItems.length} open\`;
      });

    root
      .querySelectorAll<HTMLButtonElement>("[data-console-supervision-refresh]")
      .forEach((node) => {
        node.textContent = supervisionWorkspaceRefreshLabel(workspace);
        node.disabled = !workspace;
      });

    root
      .querySelectorAll<HTMLButtonElement>("[data-console-supervision-inbox]")
      .forEach((node) => {
        node.textContent = supervisionWorkspaceInboxLabel(workspace);
        node.disabled = !workspace;
      });

    root
      .querySelectorAll<HTMLButtonElement>("[data-console-supervision-clear-active]")
      .forEach((node) => {
        node.disabled = !workspace;
      });

    root
      .querySelectorAll<HTMLButtonElement>("[data-console-supervision-clear-history]")
      .forEach((node) => {
        node.disabled = !workspaceHistory.length;
      });

    attentionQueueStatusOrder.forEach((status) => {
      const openCount = workspaceQueues.find((entry) => entry.status === status)?.openCount ?? 0;

      root
        .querySelectorAll<HTMLButtonElement>(
          \`[data-console-supervision-queue-status="\${status}"]\`
        )
        .forEach((node) => {
          const label =
            node.getAttribute("data-console-supervision-queue-label") ?? status;
          node.textContent = \`Open \${label} Queue · \${openCount} open\`;
          node.disabled = !workspace;
        });
    });
  };

  const renderTableRows = (
    route: HumanSurfaceRouteDefinition,
    records: Array<Record<string, unknown>>
  ): string => {
    const columns = route.table?.columns ?? [];
    const rows = records.length ? records : createSeedRecords(route);

    if (!rows.length) {
      return \`<tr><td colspan="\${Math.max(columns.length, 1)}">No records available.</td></tr>\`;
    }

    return rows
      .map(
        (record) =>
          \`<tr>\${columns
            .map(
              (column) =>
                \`<td>\${escapeHtml(stringifyValue(record[column.key] ?? "", column.type))}</td>\`
            )
            .join("")}</tr>\`
      )
      .join("");
  };

  const renderRouteProjection = (route: HumanSurfaceRouteDefinition): void => {
    if (!route.resourceKey) {
      return;
    }

    const records = runtime.resourceRecords[route.resourceKey] ?? [];

    if (route.kind === "list") {
      const tableBody = root.querySelector<HTMLElement>(
        \`[data-route-table-body="\${route.key}"]\`
      );

      if (tableBody) {
        tableBody.innerHTML = renderTableRows(route, records);
      }

      return;
    }

    const firstRecord = records[0] ?? createSeedRecord(route);

    if (route.kind === "detail") {
      const detailNodes = Array.from(
        root.querySelectorAll<HTMLElement>(
          \`[data-route-detail-value-route="\${route.key}"]\`
        )
      );

      detailNodes.forEach((node) => {
        const fieldKey = node.getAttribute("data-field-key");
        const field = fieldKey ? findField(route, fieldKey) : undefined;

        if (!fieldKey || !field) {
          return;
        }

        node.textContent = stringifyValue(
          firstRecord[fieldKey] ?? sampleValue(field.type, field.label),
          field.type
        );
      });

      return;
    }

    if (route.kind === "form") {
      const inputs = Array.from(
        root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          \`[data-route-input-key="\${route.key}"]\`
        )
      );

      inputs.forEach((input) => {
        const fieldKey = input.getAttribute("data-field-key");
        const field = fieldKey ? findField(route, fieldKey) : undefined;

        if (!fieldKey || !field) {
          return;
        }

        input.value = stringifyValue(
          firstRecord[fieldKey] ?? sampleValue(field.type, field.label),
          field.type
        );
      });
    }
  };

  const render = (): void => {
    renderConsoleAttentionProjection();

    routeNodes.forEach((node, index) => {
      const routeKey = node.getAttribute("data-route-key") ?? "";
      const active = routeKey === runtime.activeRouteKey || (!runtime.activeRouteKey && index === 0);
      const route = findRoute(routeKey);
      const mode = runtime.modes[routeKey] ?? "ready";

      node.hidden = !active;
      node.setAttribute("data-runtime-state", mode);

      const modeLabelNode = node.querySelector<HTMLElement>("[data-route-mode-label]");
      if (modeLabelNode) {
        modeLabelNode.textContent = mode;
      }

      const stateCopyNode = node.querySelector<HTMLElement>("[data-route-state-copy]");
      if (stateCopyNode && route) {
        stateCopyNode.textContent = mode === "ready" ? readyCopy(route) : route.states[mode];
      }

      node.querySelectorAll<HTMLElement>("[data-route-mode]").forEach((button) => {
        button.classList.toggle("is-active", button.getAttribute("data-route-mode") === mode);
      });

      node.querySelectorAll<HTMLElement>("[data-state-card-value]").forEach((card) => {
        card.classList.toggle("is-active", card.getAttribute("data-state-card-value") === mode);
      });

      node.querySelectorAll<HTMLButtonElement>(".capstan-action-button").forEach((button) => {
        button.disabled = mode === "loading";
      });

      if (route) {
        renderRouteProjection(route);
        renderAttentionProjection(route);
      }

      const routeResult = runtime.results[routeKey];
      const resultStatusNode = root.querySelector<HTMLElement>(
        \`[data-route-result-status="\${routeKey}"]\`
      );
      const resultOutputNode = root.querySelector<HTMLElement>(
        \`[data-route-result-output="\${routeKey}"]\`
      );

      if (resultStatusNode) {
        resultStatusNode.textContent = routeResult?.status ?? "idle";
        resultStatusNode.setAttribute(
          "data-route-result-state",
          routeResult?.status ?? "idle"
        );
      }

      if (resultOutputNode) {
        resultOutputNode.textContent = JSON.stringify(
          routeResult?.payload ?? {
            event: "route.idle",
            routeKey,
            message: "No capability has been executed for this route yet."
          },
          null,
          2
        );
      }

      const attentionResult = runtime.attention[routeKey];
      const attentionStatusNode = root.querySelector<HTMLElement>(
        \`[data-route-attention-status="\${routeKey}"]\`
      );
      const attentionOutputNode = root.querySelector<HTMLElement>(
        \`[data-route-attention-output="\${routeKey}"]\`
      );

      if (attentionStatusNode) {
        attentionStatusNode.textContent = attentionResult?.status ?? "idle";
        attentionStatusNode.setAttribute(
          "data-route-attention-state",
          attentionResult?.status ?? "idle"
        );
      }

      if (attentionOutputNode) {
        attentionOutputNode.textContent = JSON.stringify(
          attentionResult?.payload ?? {
            event: "route.attention.idle",
            routeKey,
            message: "No attention queue lane has been opened for this route yet."
          },
          null,
          2
        );
      }

      const attentionHandoffNode = root.querySelector<HTMLElement>(
        \`[data-route-attention-handoff="\${routeKey}"]\`
      );
      const attentionHandoffControlsNode = root.querySelector<HTMLElement>(
        \`[data-route-attention-handoff-controls="\${routeKey}"]\`
      );
      const attentionHandoffCopyNode = root.querySelector<HTMLElement>(
        \`[data-route-attention-handoff-copy="\${routeKey}"]\`
      );
      const handoff = runtime.attentionHandoffs[routeKey];

      if (attentionHandoffNode) {
        attentionHandoffNode.innerHTML = renderAttentionHandoffBadges(handoff);
      }

      if (attentionHandoffControlsNode) {
        attentionHandoffControlsNode.innerHTML = renderAttentionHandoffControls(
          routeKey,
          handoff
        );
      }

      if (attentionHandoffCopyNode && route) {
        attentionHandoffCopyNode.textContent = attentionHandoffCopy(handoff, route);
      }
    });

    navNodes.forEach((node) => {
      node.classList.toggle(
        "is-active",
        node.getAttribute("data-route-nav") === runtime.activeRouteKey
      );
    });

    const activeRoute = findRoute(runtime.activeRouteKey) ?? routes[0];

    if (activeRoute && consoleRouteNode) {
      consoleRouteNode.textContent = activeRoute.title;
    }

    if (activeRoute && consoleModeNode) {
      consoleModeNode.textContent = runtime.modes[activeRoute.key] ?? "ready";
    }

    if (consoleAttentionStatusNode) {
      consoleAttentionStatusNode.textContent = runtime.consoleAttention.status;
      consoleAttentionStatusNode.setAttribute(
        "data-console-attention-state",
        runtime.consoleAttention.status
      );
    }

    if (consoleAttentionOutputNode) {
      consoleAttentionOutputNode.textContent = JSON.stringify(
        runtime.consoleAttention.payload,
        null,
        2
      );
    }

    if (activeRoute && root.defaultView) {
      const currentHash = root.defaultView.location.hash.replace(/^#/, "");

      if (currentHash !== activeRoute.key) {
        root.defaultView.location.hash = activeRoute.key;
      }
    }
  };

  const supervisionWorkspaceSlotSummaryCopy = (
    summary: HumanSurfaceSupervisionWorkspaceSlotSummary
  ): string => {
    if (!summary.savedWorkspace) {
      return \`No saved workspace is tracking the \${summary.label.toLowerCase()} slot yet.\`;
    }

    if (!summary.openCount) {
      return \`The \${summary.label.toLowerCase()} slot is tracking \${summary.savedWorkspace}, and it currently has no open attention.\`;
    }

    if (summary.newOpenCount) {
      if (summary.topQueue && summary.topQueue.newOpenCount) {
        return \`The \${summary.label.toLowerCase()} slot is tracking \${summary.savedWorkspace}, with \${summary.newOpenCount} new item(s) since you last opened it. \${summary.topQueue.newOpenCount} of those new item(s) are in the highest-priority \${summary.topQueue.label.toLowerCase()} lane, and \${summary.openCount} item(s) remain open overall.\`;
      }

      return \`The \${summary.label.toLowerCase()} slot is tracking \${summary.savedWorkspace}, with \${summary.newOpenCount} new item(s) since you last opened it and \${summary.openCount} item(s) open overall.\`;
    }

    if (summary.topQueue) {
      return \`The \${summary.label.toLowerCase()} slot is tracking \${summary.savedWorkspace}, with \${summary.topQueue.openCount} item(s) in the highest-priority \${summary.topQueue.label.toLowerCase()} lane and \${summary.openCount} open item(s) overall.\`;
    }

    return \`The \${summary.label.toLowerCase()} slot is tracking \${summary.savedWorkspace}, with \${summary.openCount} open item(s).\`;
  };

  const renderSupervisionWorkspaceSlotSummaryBadges = (
    summary: HumanSurfaceSupervisionWorkspaceSlotSummary
  ): string => {
    const badges = [
      \`<span class="capstan-badge">\${escapeHtml(supervisionWorkspaceSlotRoleBadge(summary.key))}</span>\`,
      summary.mode
        ? \`<span class="capstan-badge">\${escapeHtml(summary.mode === "manual" ? "Manual Override" : "Auto Tracking")}</span>\`
        : \`<span class="capstan-badge">No Workspace</span>\`,
      summary.newOpenCount
        ? \`<span class="capstan-badge">\${escapeHtml(\`\${summary.newOpenCount} New Since Open\`)}</span>\`
        : summary.savedWorkspace
          ? \`<span class="capstan-badge">No New Attention</span>\`
          : "",
      summary.topQueue
        ? \`<span class="capstan-badge">\${escapeHtml(summary.topQueue.label)}</span>\`
        : summary.savedWorkspace
          ? \`<span class="capstan-badge">No Open Attention</span>\`
          : \`<span class="capstan-badge">Waiting For Save</span>\`
    ].filter(Boolean);

    return badges.join("");
  };

  const renderSupervisionWorkspaceSlotSummaries = (
    summaries: HumanSurfaceSupervisionWorkspaceSlotSummary[]
  ): string =>
    summaries
      .map((summary) => {
        const stateLabel = !summary.savedWorkspace
          ? "No Workspace"
          : summary.newOpenCount
            ? "New Attention"
          : summary.openCount
            ? "Needs Attention"
            : "Quiet Workspace";
        const queueLabel = summary.topQueue
          ? \`Open \${summary.topQueue.label} Queue\${summary.topQueue.newOpenCount ? \` · +\${summary.topQueue.newOpenCount} new\` : ""}\`
          : "Open Priority Queue";
        const summaryLabel = summary.newOpenCount
          ? \`Open Slot Summary · +\${summary.newOpenCount} new\`
          : "Open Slot Summary";

        return \`<article class="capstan-console-card">
  <span>\${escapeHtml(stateLabel)}</span>
  <strong>\${escapeHtml(summary.label)}</strong>
  <div class="capstan-badges">\${renderSupervisionWorkspaceSlotSummaryBadges(summary)}</div>
  <p class="capstan-console-copy">\${escapeHtml(supervisionWorkspaceSlotSummaryCopy(summary))}</p>
  <span class="capstan-attention-count">\${summary.openCount} open</span>
  <button type="button" class="capstan-action-button" data-console-supervision-slot-summary-open="\${escapeHtml(summary.key)}"\${summary.savedWorkspace ? "" : " disabled"}>\${escapeHtml(summaryLabel)}</button>
  <button type="button" class="capstan-state-toggle" data-console-supervision-slot-summary-queue="\${escapeHtml(summary.key)}"\${summary.topQueue ? "" : " disabled"}>\${escapeHtml(queueLabel)}</button>
</article>\`;
      })
      .join("");

  const initialHash = root.defaultView?.location.hash.replace(/^#/, "");
  const initialRoute = initialHash ? resolveRouteReference(initialHash) : undefined;

  if (initialRoute) {
    runtime.activeRouteKey = initialRoute.key;
  }

  restoreSupervisionWorkspaceState();

  if (!initialRoute) {
    const restoredRouteKey = runtime.supervisionWorkspace?.preset.filter.routeKey;

    if (restoredRouteKey && findRoute(restoredRouteKey)) {
      runtime.activeRouteKey = restoredRouteKey;
    }
  }

  const isElementTarget = (value: EventTarget | null): value is Element => {
    const elementConstructor = root.defaultView?.Element;
    return Boolean(elementConstructor && value instanceof elementConstructor);
  };

  root.addEventListener("click", async (event) => {
    const target =
      isElementTarget(event.target)
        ? event.target.closest<HTMLElement>(
            "[data-route-nav], [data-route-mode], [data-action-key], [data-related-path], [data-attention-queue], [data-console-attention-inbox], [data-console-attention-queue], [data-console-attention-preset-inbox], [data-console-attention-preset-queue], [data-route-attention-handoff-open], [data-console-supervision-refresh], [data-console-supervision-inbox], [data-console-supervision-queue-status], [data-console-supervision-history-resume], [data-console-supervision-slot-open], [data-console-supervision-slot-summary-open], [data-console-supervision-slot-summary-queue], [data-console-supervision-slot-save], [data-console-supervision-slot-clear], [data-console-supervision-clear-active], [data-console-supervision-clear-history]"
          )
        : null;

    if (!target) {
      return;
    }

    if (target.hasAttribute("data-route-nav")) {
      event.preventDefault();
      const routeKey = target.getAttribute("data-route-nav") ?? "";
      runtime.activeRouteKey = routeKey;
      render();
      const route = findRoute(routeKey);

      if (route) {
        writeConsole({
          event: "route.selected",
          routeKey,
          routeTitle: route.title,
          mode: runtime.modes[routeKey] ?? "ready"
        });
      }

      return;
    }

    if (target.hasAttribute("data-route-mode")) {
      const routeKey = target.getAttribute("data-route-mode-target") ?? "";
      const mode = (target.getAttribute("data-route-mode") ?? "ready") as HumanSurfaceRuntimeMode;
      runtime.activeRouteKey = routeKey || runtime.activeRouteKey;
      runtime.modes[routeKey] = mode;
      render();
      const route = findRoute(routeKey);

      if (route) {
        writeConsole({
          event: "route.state",
          routeKey,
          routeTitle: route.title,
          mode,
          message: mode === "ready" ? readyCopy(route) : route.states[mode]
        });
      }

      return;
    }

    if (target.hasAttribute("data-related-path")) {
      event.preventDefault();
      const routePath = target.getAttribute("data-related-path") ?? "";
      const route = resolveRouteReference(routePath);

      if (!route) {
        return;
      }

      runtime.activeRouteKey = route.key;
      render();
      writeConsole({
        event: "route.related",
        routeKey: route.key,
        routeTitle: route.title,
        path: route.path
      });
      return;
    }

    if (target.hasAttribute("data-attention-queue")) {
      event.preventDefault();
      const routeKey = target.getAttribute("data-attention-route-key") ?? runtime.activeRouteKey;
      const actionKey = target.getAttribute("data-attention-action-key") ?? "";
      const taskKey = target.getAttribute("data-attention-task-key") ?? "";
      const status = (target.getAttribute("data-attention-queue-status") ?? "") as HumanSurfaceAttentionStatus | "";
      const route = findRoute(routeKey);

      if (!route) {
        return;
      }

      const filter: {
        taskKey?: string;
        routeKey?: string;
        actionKey?: string;
        status?: HumanSurfaceAttentionStatus;
      } = {
        ...(taskKey ? { taskKey } : {}),
        ...(routeKey ? { routeKey } : {}),
        ...(actionKey ? { actionKey } : {}),
        ...(status ? { status } : {})
      };
      const queue =
        listAttentionQueues(filter)[0] ??
        {
          status,
          openCount: 0,
          filter
        };
      const items = listAttentionItems(filter);
      const payload = {
        event: "route.attention",
        routeKey,
        routeTitle: route.title,
        actionKey,
        taskKey,
        status,
        queue,
        items,
        ...(runtime.attentionHandoffs[routeKey]
          ? { handoff: runtime.attentionHandoffs[routeKey] }
          : {})
      };

      runtime.activeRouteKey = routeKey;
      writeAttentionResult(routeKey, attentionStatusToResultStatus(status), payload);
      render();
      writeConsole(payload);
      return;
    }

    if (target.hasAttribute("data-console-attention-inbox")) {
      event.preventDefault();
      writeActiveAttentionPreset(undefined);
      const items = listAttentionItems();
      const queues = listAttentionQueues();
      const status = attentionStatusToResultStatus(queues[0]?.status ?? "");
      const payload = {
        event: "console.attention.inbox",
        openCount: items.length,
        queues,
        items
      };

      writeConsoleAttentionResult(status, payload);
      render();
      writeConsole(payload);
      return;
    }

    if (target.hasAttribute("data-console-attention-queue")) {
      event.preventDefault();
      writeActiveAttentionPreset(undefined);
      const status = (target.getAttribute("data-console-attention-queue") ?? "") as HumanSurfaceAttentionStatus | "";
      const filter = status ? { status } : {};
      const queue =
        listAttentionQueues(filter)[0] ??
        {
          status,
          openCount: 0,
          filter
        };
      const items = listAttentionItems(filter);
      const payload = {
        event: "console.attention.queue",
        status,
        openCount: queue.openCount,
        queue,
        items
      };

      writeConsoleAttentionResult(attentionStatusToResultStatus(status), payload);
      render();
      writeConsole(payload);
      return;
    }

    if (target.hasAttribute("data-console-attention-preset-inbox")) {
      event.preventDefault();
      const presetKey = target.getAttribute("data-console-attention-preset-inbox") ?? "";
      const preset = findAttentionPreset(presetKey);

      if (!preset) {
        return;
      }

      openAttentionPreset(preset, {
        event: "console.attention.preset.inbox",
        ...(() => {
          const parent = resolveAttentionHandoffParent(preset);
          return parent ? { parent } : {};
        })()
      });
      return;
    }

    if (target.hasAttribute("data-console-attention-preset-queue")) {
      event.preventDefault();
      const presetKey = target.getAttribute("data-console-attention-preset-queue") ?? "";
      const preset = findAttentionPreset(presetKey);
      const status = (target.getAttribute("data-console-attention-preset-status") ?? "") as HumanSurfaceAttentionStatus | "";

      if (!preset) {
        return;
      }

      openAttentionPreset(preset, {
        event: "console.attention.preset.queue",
        ...(status ? { status } : {}),
        ...(() => {
          const parent = resolveAttentionHandoffParent(preset);
          return parent ? { parent } : {};
        })()
      });
      return;
    }

    if (target.hasAttribute("data-route-attention-handoff-open")) {
      event.preventDefault();
      const routeKey = target.getAttribute("data-route-attention-handoff-open") ?? "";
      const stepIndex = Number.parseInt(
        target.getAttribute("data-route-attention-handoff-step") ?? "",
        10
      );
      const handoff = flattenAttentionHandoffChain(runtime.attentionHandoffs[routeKey])[stepIndex];
      const preset = handoff ? findAttentionPreset(handoff.preset.key) : undefined;

      if (!handoff || !preset) {
        return;
      }

      openAttentionPreset(preset, {
        event: handoff.event,
        ...(handoff.status ? { status: handoff.status } : {}),
        ...(handoff.parent ? { parent: handoff.parent } : {})
      });
      return;
    }

    if (target.hasAttribute("data-console-supervision-refresh")) {
      event.preventDefault();
      const workspace = runtime.supervisionWorkspace;
      const preset = workspace ? findAttentionPreset(workspace.preset.key) : undefined;

      if (!workspace || !preset) {
        return;
      }

      openAttentionPreset(preset, {
        event: workspace.event,
        ...(workspace.status ? { status: workspace.status } : {}),
        ...(workspace.parent ? { parent: workspace.parent } : {})
      });
      return;
    }

    if (target.hasAttribute("data-console-supervision-inbox")) {
      event.preventDefault();
      const workspace = runtime.supervisionWorkspace;
      const preset = workspace ? findAttentionPreset(workspace.preset.key) : undefined;

      if (!workspace || !preset) {
        return;
      }

      openAttentionPreset(preset, {
        event: "console.attention.preset.inbox",
        ...(workspace.parent ? { parent: workspace.parent } : {})
      });
      return;
    }

    if (target.hasAttribute("data-console-supervision-queue-status")) {
      event.preventDefault();
      const workspace = runtime.supervisionWorkspace;
      const preset = workspace ? findAttentionPreset(workspace.preset.key) : undefined;
      const status = (target.getAttribute("data-console-supervision-queue-status") ?? "") as HumanSurfaceAttentionStatus | "";

      if (!workspace || !preset) {
        return;
      }

      openAttentionPreset(preset, {
        event: "console.attention.preset.queue",
        ...(status ? { status } : {}),
        ...(workspace.parent ? { parent: workspace.parent } : {})
      });
      return;
    }

    if (target.hasAttribute("data-console-supervision-history-resume")) {
      event.preventDefault();
      const index = Number.parseInt(
        target.getAttribute("data-console-supervision-history-resume") ?? "",
        10
      );
      const workspace = runtime.supervisionWorkspaceHistory[index];
      const preset = workspace ? findAttentionPreset(workspace.preset.key) : undefined;

      if (!workspace || !preset) {
        return;
      }

      openAttentionPreset(preset, {
        event: workspace.event,
        ...(workspace.status ? { status: workspace.status } : {}),
        ...(workspace.parent ? { parent: workspace.parent } : {})
      });
      return;
    }

    if (target.hasAttribute("data-console-supervision-slot-open")) {
      event.preventDefault();
      const slotKey = (
        target.getAttribute("data-console-supervision-slot-open") ?? ""
      ) as HumanSurfaceSupervisionWorkspaceSlotKey;
      const slot = findSupervisionWorkspaceSlot(slotKey);
      const preset = slot?.handoff ? findAttentionPreset(slot.handoff.preset.key) : undefined;

      if (!slot?.handoff || !preset) {
        return;
      }

      openAttentionPreset(preset, {
        event: slot.handoff.event,
        ...(slot.handoff.status ? { status: slot.handoff.status } : {}),
        ...(slot.handoff.parent ? { parent: slot.handoff.parent } : {})
      });
      return;
    }

    if (target.hasAttribute("data-console-supervision-slot-summary-open")) {
      event.preventDefault();
      const slotKey = (
        target.getAttribute("data-console-supervision-slot-summary-open") ?? ""
      ) as HumanSurfaceSupervisionWorkspaceSlotKey;
      const slot = findSupervisionWorkspaceSlot(slotKey);
      const preset = slot?.handoff ? findAttentionPreset(slot.handoff.preset.key) : undefined;

      if (!slot?.handoff || !preset) {
        return;
      }

      openAttentionPreset(preset, {
        event: slot.handoff.event,
        ...(slot.handoff.status ? { status: slot.handoff.status } : {}),
        ...(slot.handoff.parent ? { parent: slot.handoff.parent } : {})
      });
      return;
    }

    if (target.hasAttribute("data-console-supervision-slot-summary-queue")) {
      event.preventDefault();
      const slotKey = (
        target.getAttribute("data-console-supervision-slot-summary-queue") ?? ""
      ) as HumanSurfaceSupervisionWorkspaceSlotKey;
      const slot = findSupervisionWorkspaceSlot(slotKey);
      const preset = slot?.handoff ? findAttentionPreset(slot.handoff.preset.key) : undefined;
      const slotSummary = runtime.supervisionWorkspaceSlotSummaries.find(
        (summary) => summary.key === slotKey
      );

      if (!slot?.handoff || !preset || !slotSummary?.topQueue) {
        return;
      }

      openAttentionPreset(preset, {
        event: "console.attention.preset.queue",
        status: slotSummary.topQueue.status,
        ...(slot.handoff.parent ? { parent: slot.handoff.parent } : {})
      });
      return;
    }

    if (target.hasAttribute("data-console-supervision-slot-save")) {
      event.preventDefault();
      const slotKey = (
        target.getAttribute("data-console-supervision-slot-save") ?? ""
      ) as HumanSurfaceSupervisionWorkspaceSlotKey;
      const slot = saveActiveSupervisionWorkspaceToSlot(slotKey);
      render();
      writeConsole({
        event: "console.supervision.slot.save",
        slotKey,
        slotLabel: slot?.label ?? slotKey,
        slotSummary: runtime.supervisionWorkspaceSlotSummaries.find(
          (summary) => summary.key === slotKey
        ) ?? null,
        activeWorkspace: runtime.supervisionWorkspace?.preset.key ?? null,
        savedWorkspace: slot?.handoff?.preset.key ?? null
      });
      return;
    }

    if (target.hasAttribute("data-console-supervision-slot-clear")) {
      event.preventDefault();
      const slotKey = (
        target.getAttribute("data-console-supervision-slot-clear") ?? ""
      ) as HumanSurfaceSupervisionWorkspaceSlotKey;
      const slot = clearSupervisionWorkspaceSlot(slotKey);
      render();
      writeConsole({
        event: "console.supervision.slot.clear",
        slotKey,
        slotLabel: slot?.label ?? slotKey,
        slotSummary: runtime.supervisionWorkspaceSlotSummaries.find(
          (summary) => summary.key === slotKey
        ) ?? null
      });
      return;
    }

    if (target.hasAttribute("data-console-supervision-clear-active")) {
      event.preventDefault();
      clearActiveSupervisionWorkspace();
      render();
      writeConsole({
        event: "console.supervision.clear_active",
        remainingWorkspaces: runtime.supervisionWorkspaceHistory.length,
        activeWorkspace: runtime.supervisionWorkspace?.preset.key ?? null
      });
      return;
    }

    if (target.hasAttribute("data-console-supervision-clear-history")) {
      event.preventDefault();
      clearSupervisionWorkspaceHistory();
      render();
      writeConsole({
        event: "console.supervision.clear_history",
        remainingWorkspaces: 0
      });
      return;
    }

    if (!target.hasAttribute("data-action-key")) {
      return;
    }

    const routeKey = target.getAttribute("data-route-action") ?? runtime.activeRouteKey;
    const actionKey = target.getAttribute("data-action-key") ?? "";
    const route = findRoute(routeKey);
    const action = route?.actions.find((entry) => entry.key === actionKey);

    if (!route || !action) {
      return;
    }

    runtime.activeRouteKey = routeKey;
    const input = collectInput(route);
    const policyState = action.policyState as
      | "allowed"
      | "approval_required"
      | "blocked"
      | "redacted";

    if (policyState === "blocked") {
      runtime.modes[routeKey] = "error";
      const payload = {
        event: "capability.blocked",
        routeKey,
        routeTitle: route.title,
        capability: action.capability,
        policyState,
        note: action.note
      };
      writeRouteResult(routeKey, "blocked", payload);
      render();
      writeConsole(payload);
      return;
    }

    if (policyState === "approval_required") {
      runtime.modes[routeKey] = "empty";
      const payload = {
        event: "capability.pending_approval",
        routeKey,
        routeTitle: route.title,
        capability: action.capability,
        policyState,
        input,
        note: action.note
      };
      writeRouteResult(routeKey, "approval_required", payload);
      render();
      writeConsole(payload);
      return;
    }

    runtime.modes[routeKey] = "loading";
    render();

    try {
      const result = await execute(action.capability, input);
      const records = deriveRecords(route, result, input);
      const affectedResources = Array.from(
        new Set([route.resourceKey, ...action.resources].filter((value): value is string => Boolean(value)))
      );

      if (records.length) {
        affectedResources.forEach((resourceKey) => {
          runtime.resourceRecords[resourceKey] = records;
        });
      }

      runtime.modes[routeKey] = result.status === "completed" && records.length ? "ready" : "empty";

      const payload = {
        event:
          result.status === "completed"
            ? "capability.execute"
            : "capability.not_implemented",
        routeKey,
        routeTitle: route.title,
        capability: action.capability,
        policyState,
        result,
        records,
        note:
          result.status === "not_implemented"
            ? result.note ?? "The generated capability stub has not been replaced yet."
            : policyState === "redacted"
              ? "Execution completed through the real handler. The surface is flagged as redacted."
              : action.note
      };

      writeRouteResult(
        routeKey,
        result.status === "completed"
          ? policyState === "redacted"
            ? "redacted"
            : "completed"
          : "not_implemented",
        payload
      );
      render();
      writeConsole(payload);
    } catch (error) {
      runtime.modes[routeKey] = "error";
      const payload = {
        event: "capability.error",
        routeKey,
        routeTitle: route.title,
        capability: action.capability,
        input,
        error: error instanceof Error ? error.message : String(error)
      };
      writeRouteResult(routeKey, "error", payload);
      render();
      writeConsole(payload);
    }
  });

  render();

  if (runtime.activeRouteKey) {
    const initialRoute = findRoute(runtime.activeRouteKey);

    if (initialRoute) {
      writeConsole({
        event: "human_surface.ready",
        activeRoute: initialRoute.key,
        activeRouteTitle: initialRoute.title,
        routes: routes.length,
        restoredSupervisionWorkspaces: runtime.supervisionWorkspaceHistory.length,
        restoredSupervisionWorkspaceSlots: runtime.supervisionWorkspaceSlots.filter(
          (slot) => slot.handoff
        ).length,
        supervisionWorkspaceSlotSummaries: runtime.supervisionWorkspaceSlotSummaries,
        activeSupervisionWorkspace: runtime.supervisionWorkspace?.preset.key ?? null
      });
    }
  }

  return runtime;
}
`;
}

function renderAgentSurfaceModule(
  projection: AgentSurfaceProjection,
  manifest: string
): string {
  return `export const agentSurface = ${serializeObject(projection)} as const;

export const agentSurfaceManifest = ${JSON.stringify(manifest)};

export function renderAgentSurfaceManifest(): string {
  return agentSurfaceManifest;
}
`;
}

function renderAgentSurfaceTransportModule(): string {
  return `import {
  agentSurface,
  renderAgentSurfaceManifest
} from "./index.js";
import {
  advanceWorkflowRun,
  artifact,
  executeAction,
  execute,
  getArtifactRecord,
  resource,
  getTaskRun,
  getWorkflowRun,
  listAttentionItems,
  listAttentionQueues,
  listArtifactRecords,
  listTaskRuns,
  listWorkflowRuns,
  search,
  startTaskAction,
  startTask,
  task
} from "../control-plane/index.js";

export type AgentSurfaceRequest =
  | { operation: "manifest" }
  | { operation: "resource"; key: string }
  | { operation: "search"; query?: string }
  | {
      operation: "listAttentionItems";
      taskKey?: string;
      resourceKey?: string;
      routeKey?: string;
      actionKey?: string;
      status?:
        | "paused"
        | "approval_required"
        | "input_required"
        | "failed"
        | "blocked"
        | "cancelled";
    }
  | {
      operation: "listAttentionQueues";
      taskKey?: string;
      resourceKey?: string;
      routeKey?: string;
      actionKey?: string;
    }
  | {
      operation: "executeAction";
      routeKey: string;
      actionKey: string;
      input?: Record<string, unknown>;
      context?: Record<string, unknown>;
    }
  | {
      operation: "startTaskAction";
      routeKey: string;
      actionKey: string;
      input?: Record<string, unknown>;
      context?: Record<string, unknown>;
    }
  | { operation: "execute"; key: string; input?: Record<string, unknown> }
  | { operation: "task"; key: string }
  | { operation: "artifact"; key: string }
  | { operation: "startTask"; key: string; input?: Record<string, unknown> }
  | { operation: "getTaskRun"; id: string }
  | { operation: "listTaskRuns"; taskKey?: string }
  | {
      operation: "listWorkflowRuns";
      taskKey?: string;
      routeKey?: string;
      actionKey?: string;
      status?:
        | "running"
        | "paused"
        | "approval_required"
        | "input_required"
        | "failed"
        | "blocked"
        | "completed"
        | "cancelled";
      attentionOnly?: boolean;
    }
  | { operation: "getWorkflowRun"; id: string }
  | {
      operation: "advanceWorkflowRun";
      id: string;
      action: "approve" | "provideInput" | "retry" | "cancel";
      input?: Record<string, unknown>;
      note?: string;
    }
  | { operation: "getArtifactRecord"; id: string }
  | { operation: "listArtifactRecords"; artifactKey?: string };

export interface AgentSurfaceSuccessResponse {
  ok: true;
  status: number;
  body: unknown;
}

export interface AgentSurfaceErrorResponse {
  ok: false;
  status: number;
  error: string;
  code?: string;
  details?: unknown;
}

export type AgentSurfaceResponse = AgentSurfaceSuccessResponse | AgentSurfaceErrorResponse;

export interface AgentSurfaceAuthDecision {
  effect: "allow" | "approve" | "deny" | "redact";
  reason?: string;
  status?: number;
  body?: unknown;
}

export interface AgentSurfaceCapabilityEntry {
  key: string;
  title: string;
  task?: string;
  policy?: string;
}

export interface AgentSurfaceTaskEntry {
  key: string;
  title: string;
  artifactKeys?: readonly string[];
  capabilityKeys?: readonly string[];
}

export interface AgentSurfaceArtifactEntry {
  key: string;
  title: string;
  taskKeys: readonly string[];
  capabilityKeys: readonly string[];
}

export interface AgentSurfaceResourceEntry {
  key: string;
  title: string;
  routes?: readonly AgentSurfaceRouteEntry[];
  relations?: readonly AgentSurfaceResourceRelationEntry[];
}

export interface AgentSurfaceRouteActionEntry {
  key: string;
  task?: string;
  policy?: string;
}

export interface AgentSurfaceRouteEntry {
  key: string;
  resourceKey: string;
  sourceResourceKey?: string;
  sourceRelationKey?: string;
  actions: readonly AgentSurfaceRouteActionEntry[];
}

export interface AgentSurfaceResourceRelationEntry {
  route: AgentSurfaceRouteEntry;
}

export interface AgentSurfaceAuthorizationContext {
  request: AgentSurfaceRequest;
  operation: AgentSurfaceRequest["operation"];
  resource?: AgentSurfaceResourceEntry;
  capability?: AgentSurfaceCapabilityEntry;
  task?: AgentSurfaceTaskEntry;
  artifact?: AgentSurfaceArtifactEntry;
  policyKey?: string;
}

export interface AgentSurfaceTransportHooks {
  authorize?:
    | ((context: AgentSurfaceAuthorizationContext) =>
        | AgentSurfaceAuthDecision
        | void
        | Promise<AgentSurfaceAuthDecision | void>);
}

export interface AgentSurfaceTransport {
  handle(request: AgentSurfaceRequest): Promise<AgentSurfaceResponse>;
}

function inferErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);

  if (message.startsWith("Unknown ")) {
    return 404;
  }

  if (message.includes("cannot be")) {
    return 409;
  }

  return 500;
}

const capabilityEntries = agentSurface.capabilities as readonly AgentSurfaceCapabilityEntry[];
const resourceEntries = agentSurface.resources as readonly AgentSurfaceResourceEntry[];
const taskEntries = agentSurface.tasks as readonly AgentSurfaceTaskEntry[];
const artifactEntries = agentSurface.artifacts as readonly AgentSurfaceArtifactEntry[];

function findCapability(key: string) {
  return capabilityEntries.find((capability) => capability.key === key);
}

function findResource(key: string) {
  return resourceEntries.find((resourceEntry) => resourceEntry.key === key);
}

function findRouteAction(routeKey: string, actionKey: string) {
  for (const resourceEntry of resourceEntries) {
    const routes = resourceEntry.routes ?? [];
    const relationRoutes = (resourceEntry.relations ?? []).map((relation) => relation.route);

    for (const route of [...routes, ...relationRoutes]) {
      if (route.key !== routeKey) {
        continue;
      }

      const action = route.actions.find((entry) => entry.key === actionKey);

      if (!action) {
        return undefined;
      }

      return {
        resource: resourceEntry,
        route,
        action
      };
    }
  }

  return undefined;
}

function findTask(key: string) {
  return taskEntries.find((taskEntry) => taskEntry.key === key);
}

function findArtifact(key: string) {
  return artifactEntries.find((artifactEntry) => artifactEntry.key === key);
}

function capabilityTaskKey(
  capability: AgentSurfaceAuthorizationContext["capability"]
): string | undefined {
  return capability?.task;
}

function capabilityPolicyKey(
  capability: AgentSurfaceAuthorizationContext["capability"]
): string | undefined {
  return capability?.policy;
}

function findCapabilityByTask(taskKey?: string) {
  if (!taskKey) {
    return undefined;
  }

  return capabilityEntries.find((entry) => capabilityTaskKey(entry) === taskKey);
}

function findPrimaryTaskForArtifact(artifactKey?: string) {
  if (!artifactKey) {
    return undefined;
  }

  const artifactEntry = findArtifact(artifactKey);

  if (!artifactEntry) {
    return undefined;
  }

  return taskEntries.find((entry) => artifactEntry.taskKeys.includes(entry.key));
}

function deriveAuthorizationContext(
  request: AgentSurfaceRequest
): AgentSurfaceAuthorizationContext {
  let resourceEntry = undefined as AgentSurfaceAuthorizationContext["resource"];
  let capability = undefined as AgentSurfaceAuthorizationContext["capability"];
  let taskEntry = undefined as AgentSurfaceAuthorizationContext["task"];
  let artifactEntry = undefined as AgentSurfaceAuthorizationContext["artifact"];

  switch (request.operation) {
    case "resource":
      resourceEntry = findResource(request.key);
      break;
    case "listAttentionItems":
    case "listAttentionQueues":
      resourceEntry = request.resourceKey ? findResource(request.resourceKey) : undefined;
      taskEntry = request.taskKey ? findTask(request.taskKey) : undefined;
      capability = findCapabilityByTask(taskEntry?.key);

      if ((!taskEntry || !capability || !resourceEntry) && request.routeKey && request.actionKey) {
        const routeAction = findRouteAction(request.routeKey, request.actionKey);
        resourceEntry =
          resourceEntry ??
          (routeAction
            ? findResource(routeAction.route.sourceResourceKey ?? routeAction.route.resourceKey)
            : undefined);
        capability = routeAction ? findCapability(routeAction.action.key) : capability;
        taskEntry = routeAction?.action.task ? findTask(routeAction.action.task) : taskEntry;
      }
      break;
    case "executeAction":
    case "startTaskAction": {
      const routeAction = findRouteAction(request.routeKey, request.actionKey);
      resourceEntry = routeAction
        ? findResource(routeAction.route.sourceResourceKey ?? routeAction.route.resourceKey)
        : undefined;
      capability = routeAction ? findCapability(routeAction.action.key) : undefined;
      taskEntry = routeAction?.action.task ? findTask(routeAction.action.task) : undefined;
      break;
    }
    case "execute":
      capability = findCapability(request.key);
      break;
    case "task":
    case "startTask":
      taskEntry = findTask(request.key);
      capability = findCapabilityByTask(taskEntry?.key);
      break;
    case "artifact":
      artifactEntry = findArtifact(request.key);
      if (artifactEntry) {
        taskEntry = findPrimaryTaskForArtifact(artifactEntry.key);
        capability = findCapabilityByTask(taskEntry?.key);
      }
      break;
    case "listTaskRuns":
      taskEntry = request.taskKey ? findTask(request.taskKey) : undefined;
      capability = findCapabilityByTask(taskEntry?.key);
      break;
    case "listWorkflowRuns": {
      taskEntry = request.taskKey ? findTask(request.taskKey) : undefined;
      capability = findCapabilityByTask(taskEntry?.key);

      if ((!taskEntry || !capability) && request.routeKey && request.actionKey) {
        const routeAction = findRouteAction(request.routeKey, request.actionKey);
        resourceEntry = routeAction
          ? findResource(routeAction.route.sourceResourceKey ?? routeAction.route.resourceKey)
          : undefined;
        capability = routeAction ? findCapability(routeAction.action.key) : capability;
        taskEntry = routeAction?.action.task ? findTask(routeAction.action.task) : taskEntry;
      }
      break;
    }
    case "getTaskRun": {
      const run = getTaskRun(request.id);
      taskEntry = run ? findTask(run.taskKey) : undefined;
      capability = run ? findCapability(run.capabilityKey) : undefined;
      break;
    }
    case "getWorkflowRun":
    case "advanceWorkflowRun": {
      const run = getTaskRun(request.id);
      taskEntry = run ? findTask(run.taskKey) : undefined;
      capability = run ? findCapability(run.capabilityKey) : undefined;
      break;
    }
    case "listArtifactRecords":
      artifactEntry = request.artifactKey ? findArtifact(request.artifactKey) : undefined;
      if (artifactEntry) {
        taskEntry = findPrimaryTaskForArtifact(artifactEntry.key);
        capability = findCapabilityByTask(taskEntry?.key);
      }
      break;
    case "getArtifactRecord": {
      const record = getArtifactRecord(request.id);
      artifactEntry = record ? findArtifact(record.artifactKey) : undefined;
      taskEntry = record ? findTask(record.taskKey) : undefined;
      capability = record ? findCapability(record.capabilityKey) : undefined;
      break;
    }
    case "manifest":
    case "search":
    default:
      break;
  }

  const context: AgentSurfaceAuthorizationContext = {
    request,
    operation: request.operation
  };

  if (resourceEntry) {
    context.resource = resourceEntry;
  }

  if (capability) {
    context.capability = capability;
  }

  if (taskEntry) {
    context.task = taskEntry;
  }

  if (artifactEntry) {
    context.artifact = artifactEntry;
  }

  const policyKey = capabilityPolicyKey(capability);

  if (policyKey) {
    context.policyKey = policyKey;
  }

  return context;
}

async function applyAuthorization(
  request: AgentSurfaceRequest,
  hooks: AgentSurfaceTransportHooks
): Promise<AgentSurfaceResponse | undefined> {
  if (!hooks.authorize) {
    return undefined;
  }

  const context = deriveAuthorizationContext(request);
  const decision = await hooks.authorize(context);

  if (!decision || decision.effect === "allow") {
    return undefined;
  }

  switch (decision.effect) {
    case "deny":
      return {
        ok: false,
        status: decision.status ?? 403,
        error: decision.reason ?? "Access denied.",
        code: "access_denied",
        details: {
          operation: request.operation,
          ...(context.policyKey ? { policyKey: context.policyKey } : {})
        }
      };
    case "approve":
      return {
        ok: false,
        status: decision.status ?? 202,
        error: decision.reason ?? "Approval required.",
        code: "approval_required",
        details: {
          operation: request.operation,
          ...(context.policyKey ? { policyKey: context.policyKey } : {})
        }
      };
    case "redact":
      return {
        ok: true,
        status: decision.status ?? 200,
        body:
          decision.body ?? {
            redacted: true,
            operation: request.operation,
            ...(context.artifact ? { artifactKey: context.artifact.key } : {}),
            ...(context.capability ? { capabilityKey: context.capability.key } : {})
          }
      };
    default:
      return undefined;
  }
}

export function createAgentSurfaceTransport(
  hooks: AgentSurfaceTransportHooks = {}
): AgentSurfaceTransport {
  return {
    async handle(request: AgentSurfaceRequest): Promise<AgentSurfaceResponse> {
      const authorized = await applyAuthorization(request, hooks);

      if (authorized) {
        return authorized;
      }

      try {
        switch (request.operation) {
          case "manifest":
            return {
              ok: true,
              status: 200,
              body: {
                manifest: JSON.parse(renderAgentSurfaceManifest()),
                summary: agentSurface.summary
              }
            };
          case "resource":
            return {
              ok: true,
              status: 200,
              body: resource(request.key)
            };
          case "search":
            return {
              ok: true,
              status: 200,
              body: search(request.query ?? "")
            };
          case "listAttentionItems":
            return {
              ok: true,
              status: 200,
              body: listAttentionItems({
                ...(request.taskKey ? { taskKey: request.taskKey } : {}),
                ...(request.resourceKey ? { resourceKey: request.resourceKey } : {}),
                ...(request.routeKey ? { routeKey: request.routeKey } : {}),
                ...(request.actionKey ? { actionKey: request.actionKey } : {}),
                ...(request.status ? { status: request.status } : {})
              })
            };
          case "listAttentionQueues":
            return {
              ok: true,
              status: 200,
              body: listAttentionQueues({
                ...(request.taskKey ? { taskKey: request.taskKey } : {}),
                ...(request.resourceKey ? { resourceKey: request.resourceKey } : {}),
                ...(request.routeKey ? { routeKey: request.routeKey } : {}),
                ...(request.actionKey ? { actionKey: request.actionKey } : {})
              })
            };
          case "executeAction":
            return {
              ok: true,
              status: 200,
              body: await executeAction(
                request.routeKey,
                request.actionKey,
                request.input ?? {},
                request.context ?? {}
              )
            };
          case "startTaskAction":
            return {
              ok: true,
              status: 202,
              body: await startTaskAction(
                request.routeKey,
                request.actionKey,
                request.input ?? {},
                request.context ?? {}
              )
            };
          case "execute":
            return {
              ok: true,
              status: 200,
              body: await execute(request.key, request.input ?? {})
            };
          case "task":
            return {
              ok: true,
              status: 200,
              body: task(request.key)
            };
          case "artifact":
            return {
              ok: true,
              status: 200,
              body: artifact(request.key)
            };
          case "startTask":
            return {
              ok: true,
              status: 202,
              body: await startTask(request.key, request.input ?? {})
            };
          case "getTaskRun": {
            const run = getTaskRun(request.id);

            if (!run) {
              return {
                ok: false,
                status: 404,
                error: \`Unknown task run "\${request.id}".\`,
                code: "task_run_not_found"
              };
            }

            return {
              ok: true,
              status: 200,
              body: run
            };
          }
          case "listTaskRuns":
            return {
              ok: true,
              status: 200,
              body: listTaskRuns(request.taskKey)
            };
          case "listWorkflowRuns":
            return {
              ok: true,
              status: 200,
              body: listWorkflowRuns({
                ...(request.taskKey ? { taskKey: request.taskKey } : {}),
                ...(request.routeKey ? { routeKey: request.routeKey } : {}),
                ...(request.actionKey ? { actionKey: request.actionKey } : {}),
                ...(request.status ? { status: request.status } : {}),
                ...(typeof request.attentionOnly === "boolean"
                  ? { attentionOnly: request.attentionOnly }
                  : {})
              })
            };
          case "getWorkflowRun": {
            const run = getTaskRun(request.id);

            if (!run) {
              return {
                ok: false,
                status: 404,
                error: \`Unknown workflow run "\${request.id}".\`,
                code: "workflow_run_not_found"
              };
            }

            return {
              ok: true,
              status: 200,
              body: getWorkflowRun(request.id)
            };
          }
          case "advanceWorkflowRun": {
            const run = getTaskRun(request.id);

            if (!run) {
              return {
                ok: false,
                status: 404,
                error: \`Unknown workflow run "\${request.id}".\`,
                code: "workflow_run_not_found"
              };
            }

            return {
              ok: true,
              status: 200,
              body: await advanceWorkflowRun(
                request.id,
                request.action,
                request.input ?? {},
                request.note
              )
            };
          }
          case "getArtifactRecord": {
            const record = getArtifactRecord(request.id);

            if (!record) {
              return {
                ok: false,
                status: 404,
                error: \`Unknown artifact record "\${request.id}".\`,
                code: "artifact_record_not_found"
              };
            }

            return {
              ok: true,
              status: 200,
              body: record
            };
          }
          case "listArtifactRecords":
            return {
              ok: true,
              status: 200,
              body: listArtifactRecords(request.artifactKey)
            };
          default: {
            const exhaustive: never = request;

            return {
              ok: false,
              status: 400,
              error: \`Unsupported operation \${String(exhaustive)}.\`,
              code: "unsupported_operation"
            };
          }
        }
      } catch (error) {
        return {
          ok: false,
          status: inferErrorStatus(error),
          error: error instanceof Error ? error.message : String(error),
          code: "runtime_error"
        };
      }
    }
  };
}

export const defaultAgentSurfaceTransport = createAgentSurfaceTransport();

export async function handleAgentSurfaceRequest(
  request: AgentSurfaceRequest
): Promise<AgentSurfaceResponse> {
  return defaultAgentSurfaceTransport.handle(request);
}
`;
}

function renderAgentSurfaceHttpModule(): string {
  return `import {
  defaultAgentSurfaceTransport,
  type AgentSurfaceRequest,
  type AgentSurfaceResponse,
  type AgentSurfaceTransport
} from "./transport.js";

export interface AgentSurfaceHttpRequest {
  method: string;
  path: string;
  query?: Record<string, string | readonly string[] | undefined>;
  headers?: Record<string, string | undefined>;
  body?: unknown;
}

export interface AgentSurfaceHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface AgentSurfaceHttpTransport {
  handle(request: AgentSurfaceHttpRequest): Promise<AgentSurfaceHttpResponse>;
}

class HttpRouteError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function readQueryValue(
  query: AgentSurfaceHttpRequest["query"],
  key: string
): string | undefined {
  const value = query?.[key];

  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function isWorkflowStatusValue(
  value: unknown
): value is Extract<Extract<AgentSurfaceRequest, { operation: "listWorkflowRuns" }>["status"], string> {
  return (
    value === "running" ||
    value === "paused" ||
    value === "approval_required" ||
    value === "input_required" ||
    value === "failed" ||
    value === "blocked" ||
    value === "completed" ||
    value === "cancelled"
  );
}

function isWorkflowAttentionStatusValue(
  value: unknown
): value is Extract<Extract<AgentSurfaceRequest, { operation: "listAttentionItems" }>["status"], string> {
  return (
    value === "paused" ||
    value === "approval_required" ||
    value === "input_required" ||
    value === "failed" ||
    value === "blocked" ||
    value === "cancelled"
  );
}

function readBooleanQueryValue(
  query: AgentSurfaceHttpRequest["query"],
  key: string
): boolean | undefined {
  const value = readQueryValue(query, key);

  if (typeof value === "undefined") {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new HttpRouteError(
    400,
    "invalid_query_boolean",
    \`Query parameter "\${key}" must be "true" or "false".\`
  );
}

function normalizePath(path: string): string {
  const normalized = path.trim() || "/";
  return normalized.endsWith("/") && normalized !== "/" ? normalized.slice(0, -1) : normalized;
}

function ensureObjectBody(body: unknown, message: string): Record<string, unknown> {
  if (!body) {
    return {};
  }

  if (typeof body !== "object" || Array.isArray(body)) {
    throw new HttpRouteError(400, "invalid_body", message);
  }

  return body as Record<string, unknown>;
}

function decodePathSegment(value: string, message: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpRouteError(400, "invalid_path", message);
  }
}

function parseRpcRequest(body: unknown): AgentSurfaceRequest {
  const payload = ensureObjectBody(body, "RPC requests must carry a JSON object body.");
  const operation = payload.operation;

  if (typeof operation !== "string") {
    throw new HttpRouteError(400, "invalid_rpc_operation", "RPC requests must include an operation.");
  }

  switch (operation) {
    case "manifest":
      return { operation };
    case "resource":
      if (typeof payload.key !== "string" || !payload.key.trim()) {
        throw new HttpRouteError(400, "invalid_rpc_key", "RPC resource requests must include a key.");
      }

      return {
        operation,
        key: payload.key
      };
    case "search":
      return {
        operation,
        ...(typeof payload.query === "string" ? { query: payload.query } : {})
      };
    case "listAttentionItems": {
      if (typeof payload.status !== "undefined" && !isWorkflowAttentionStatusValue(payload.status)) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_status",
          "RPC listAttentionItems status must be a supported attention status."
        );
      }

      return {
        operation,
        ...(typeof payload.taskKey === "string" ? { taskKey: payload.taskKey } : {}),
        ...(typeof payload.resourceKey === "string" ? { resourceKey: payload.resourceKey } : {}),
        ...(typeof payload.routeKey === "string" ? { routeKey: payload.routeKey } : {}),
        ...(typeof payload.actionKey === "string" ? { actionKey: payload.actionKey } : {}),
        ...(isWorkflowAttentionStatusValue(payload.status) ? { status: payload.status } : {})
      };
    }
    case "listAttentionQueues":
      return {
        operation,
        ...(typeof payload.taskKey === "string" ? { taskKey: payload.taskKey } : {}),
        ...(typeof payload.resourceKey === "string" ? { resourceKey: payload.resourceKey } : {}),
        ...(typeof payload.routeKey === "string" ? { routeKey: payload.routeKey } : {}),
        ...(typeof payload.actionKey === "string" ? { actionKey: payload.actionKey } : {})
      };
    case "executeAction":
      if (typeof payload.routeKey !== "string" || !payload.routeKey.trim()) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_route_key",
          "RPC executeAction requests must include a routeKey."
        );
      }

      if (typeof payload.actionKey !== "string" || !payload.actionKey.trim()) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_action_key",
          "RPC executeAction requests must include an actionKey."
        );
      }

      return {
        operation,
        routeKey: payload.routeKey,
        actionKey: payload.actionKey,
        input: ensureObjectBody(payload.input, "RPC executeAction input must be a JSON object."),
        context: ensureObjectBody(
          payload.context,
          "RPC executeAction context must be a JSON object."
        )
      };
    case "startTaskAction":
      if (typeof payload.routeKey !== "string" || !payload.routeKey.trim()) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_route_key",
          "RPC startTaskAction requests must include a routeKey."
        );
      }

      if (typeof payload.actionKey !== "string" || !payload.actionKey.trim()) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_action_key",
          "RPC startTaskAction requests must include an actionKey."
        );
      }

      return {
        operation,
        routeKey: payload.routeKey,
        actionKey: payload.actionKey,
        input: ensureObjectBody(payload.input, "RPC startTaskAction input must be a JSON object."),
        context: ensureObjectBody(
          payload.context,
          "RPC startTaskAction context must be a JSON object."
        )
      };
    case "execute":
      if (typeof payload.key !== "string" || !payload.key.trim()) {
        throw new HttpRouteError(400, "invalid_rpc_key", "RPC execute requests must include a key.");
      }

      return {
        operation,
        key: payload.key,
        input: ensureObjectBody(payload.input, "RPC execute input must be a JSON object.")
      };
    case "task":
    case "artifact":
    case "startTask":
      if (typeof payload.key !== "string" || !payload.key.trim()) {
        throw new HttpRouteError(400, "invalid_rpc_key", \`RPC \${operation} requests must include a key.\`);
      }

      return operation === "startTask"
        ? {
            operation,
            key: payload.key,
            input: ensureObjectBody(payload.input, "RPC task input must be a JSON object.")
          }
        : {
            operation,
            key: payload.key
          };
    case "getTaskRun":
    case "getArtifactRecord":
    case "getWorkflowRun":
      if (typeof payload.id !== "string" || !payload.id.trim()) {
        throw new HttpRouteError(400, "invalid_rpc_id", \`RPC \${operation} requests must include an id.\`);
      }

      return {
        operation,
        id: payload.id
      };
    case "advanceWorkflowRun":
      if (typeof payload.id !== "string" || !payload.id.trim()) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_id",
          "RPC advanceWorkflowRun requests must include an id."
        );
      }

      if (
        payload.action !== "approve" &&
        payload.action !== "provideInput" &&
        payload.action !== "retry" &&
        payload.action !== "cancel"
      ) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_action",
          "RPC advanceWorkflowRun requests must include a supported action."
        );
      }

      return {
        operation,
        id: payload.id,
        action: payload.action,
        input: ensureObjectBody(
          payload.input,
          "RPC advanceWorkflowRun input must be a JSON object."
        ),
        ...(typeof payload.note === "string" ? { note: payload.note } : {})
      };
    case "listTaskRuns":
      return {
        operation,
        ...(typeof payload.taskKey === "string" ? { taskKey: payload.taskKey } : {})
      };
    case "listWorkflowRuns": {
      if (typeof payload.status !== "undefined" && !isWorkflowStatusValue(payload.status)) {
        throw new HttpRouteError(
          400,
          "invalid_rpc_status",
          "RPC listWorkflowRuns status must be a supported workflow status."
        );
      }

      if (typeof payload.attentionOnly !== "undefined" && typeof payload.attentionOnly !== "boolean") {
        throw new HttpRouteError(
          400,
          "invalid_rpc_attention",
          "RPC listWorkflowRuns attentionOnly must be a boolean."
        );
      }

      return {
        operation,
        ...(typeof payload.taskKey === "string" ? { taskKey: payload.taskKey } : {}),
        ...(typeof payload.routeKey === "string" ? { routeKey: payload.routeKey } : {}),
        ...(typeof payload.actionKey === "string" ? { actionKey: payload.actionKey } : {}),
        ...(isWorkflowStatusValue(payload.status) ? { status: payload.status } : {}),
        ...(typeof payload.attentionOnly === "boolean"
          ? { attentionOnly: payload.attentionOnly }
          : {})
      };
    }
    case "listArtifactRecords":
      return {
        operation,
        ...(typeof payload.artifactKey === "string" ? { artifactKey: payload.artifactKey } : {})
      };
    default:
      throw new HttpRouteError(400, "unsupported_rpc_operation", \`Unsupported RPC operation "\${operation}".\`);
  }
}

function mapHttpRequestToAgentRequest(request: AgentSurfaceHttpRequest): AgentSurfaceRequest {
  const method = request.method.toUpperCase();
  const path = normalizePath(request.path);
  const segments = path.split("/").filter(Boolean);

  if (method === "GET" && path === "/manifest") {
    return { operation: "manifest" };
  }

  if (method === "GET" && path === "/search") {
    const query = readQueryValue(request.query, "q") ?? readQueryValue(request.query, "query");
    return {
      operation: "search",
      ...(query ? { query } : {})
    };
  }

  if (method === "GET" && path === "/attention-items") {
    const taskKey = readQueryValue(request.query, "taskKey");
    const resourceKey = readQueryValue(request.query, "resourceKey");
    const routeKey = readQueryValue(request.query, "routeKey");
    const actionKey = readQueryValue(request.query, "actionKey");
    const status = readQueryValue(request.query, "status");

    if (typeof status !== "undefined" && !isWorkflowAttentionStatusValue(status)) {
      throw new HttpRouteError(
        400,
        "invalid_attention_status",
        "Attention item status filters must use a supported attention status."
      );
    }

    return {
      operation: "listAttentionItems",
      ...(taskKey ? { taskKey } : {}),
      ...(resourceKey ? { resourceKey } : {}),
      ...(routeKey ? { routeKey } : {}),
      ...(actionKey ? { actionKey } : {}),
      ...(status ? { status } : {})
    };
  }

  if (method === "GET" && path === "/attention-queues") {
    const taskKey = readQueryValue(request.query, "taskKey");
    const resourceKey = readQueryValue(request.query, "resourceKey");
    const routeKey = readQueryValue(request.query, "routeKey");
    const actionKey = readQueryValue(request.query, "actionKey");

    return {
      operation: "listAttentionQueues",
      ...(taskKey ? { taskKey } : {}),
      ...(resourceKey ? { resourceKey } : {}),
      ...(routeKey ? { routeKey } : {}),
      ...(actionKey ? { actionKey } : {})
    };
  }

  if (method === "POST" && path === "/rpc") {
    return parseRpcRequest(request.body);
  }

  if (method === "GET" && path === "/task-runs") {
    const taskKey = readQueryValue(request.query, "taskKey");
    return {
      operation: "listTaskRuns",
      ...(taskKey ? { taskKey } : {})
    };
  }

  if (method === "GET" && path === "/workflow-runs") {
    const taskKey = readQueryValue(request.query, "taskKey");
    const routeKey = readQueryValue(request.query, "routeKey");
    const actionKey = readQueryValue(request.query, "actionKey");
    const status = readQueryValue(request.query, "status");
    const attentionOnly = readBooleanQueryValue(request.query, "attentionOnly");

    if (typeof status !== "undefined" && !isWorkflowStatusValue(status)) {
      throw new HttpRouteError(
        400,
        "invalid_workflow_status",
        "Workflow run status filters must use a supported workflow status."
      );
    }

    return {
      operation: "listWorkflowRuns",
      ...(taskKey ? { taskKey } : {}),
      ...(routeKey ? { routeKey } : {}),
      ...(actionKey ? { actionKey } : {}),
      ...(status ? { status } : {}),
      ...(typeof attentionOnly === "boolean" ? { attentionOnly } : {})
    };
  }

  if (method === "GET" && segments[0] === "workflow-runs" && segments[1]) {
    return {
      operation: "getWorkflowRun",
      id: decodePathSegment(segments[1], "Workflow run ids must be URL-encoded strings.")
    };
  }

  if (
    method === "POST" &&
    segments[0] === "workflow-runs" &&
    segments[1] &&
    segments[2] === "actions" &&
    segments[3]
  ) {
    const action = decodePathSegment(
      segments[3],
      "Workflow action path segments must be URL-encoded strings."
    );

    if (
      action !== "approve" &&
      action !== "provideInput" &&
      action !== "retry" &&
      action !== "cancel"
    ) {
      throw new HttpRouteError(
        400,
        "invalid_workflow_action",
        \`Unsupported workflow action "\${action}".\`
      );
    }

    const body = ensureObjectBody(
      request.body,
      "Workflow advance requests must carry a JSON object body."
    );

    return {
      operation: "advanceWorkflowRun",
      id: decodePathSegment(segments[1], "Workflow run ids must be URL-encoded strings."),
      action,
      input: ensureObjectBody(body.input, "Workflow advance input must be a JSON object."),
      ...(typeof body.note === "string" ? { note: body.note } : {})
    };
  }

  if (method === "GET" && path === "/artifact-records") {
    const artifactKey = readQueryValue(request.query, "artifactKey");
    return {
      operation: "listArtifactRecords",
      ...(artifactKey ? { artifactKey } : {})
    };
  }

  if (method === "POST" && segments[0] === "execute" && segments[1]) {
    return {
      operation: "execute",
      key: decodePathSegment(segments[1], "Execute path segments must be URL-encoded strings."),
      input: ensureObjectBody(request.body, "Execute requests must carry a JSON object body.")
    };
  }

  if (
    method === "POST" &&
    segments[0] === "routes" &&
    segments[1] &&
    segments[2] === "actions" &&
    segments[3] &&
    segments[4] === "execute"
  ) {
    const body = ensureObjectBody(
      request.body,
      "Route action execute requests must carry a JSON object body."
    );

    return {
      operation: "executeAction",
      routeKey: decodePathSegment(segments[1], "Route path segments must be URL-encoded strings."),
      actionKey: decodePathSegment(segments[3], "Action path segments must be URL-encoded strings."),
      input: ensureObjectBody(body.input, "Route action input must be a JSON object."),
      context: ensureObjectBody(body.context, "Route action context must be a JSON object.")
    };
  }

  if (
    method === "POST" &&
    segments[0] === "routes" &&
    segments[1] &&
    segments[2] === "actions" &&
    segments[3] &&
    segments[4] === "start"
  ) {
    const body = ensureObjectBody(
      request.body,
      "Route action task start requests must carry a JSON object body."
    );

    return {
      operation: "startTaskAction",
      routeKey: decodePathSegment(segments[1], "Route path segments must be URL-encoded strings."),
      actionKey: decodePathSegment(segments[3], "Action path segments must be URL-encoded strings."),
      input: ensureObjectBody(body.input, "Route action task input must be a JSON object."),
      context: ensureObjectBody(body.context, "Route action task context must be a JSON object.")
    };
  }

  if (method === "GET" && segments[0] === "resources" && segments[1]) {
    return {
      operation: "resource",
      key: decodePathSegment(segments[1], "Resource path segments must be URL-encoded strings.")
    };
  }

  if (segments[0] === "tasks" && segments[1]) {
    const key = decodePathSegment(segments[1], "Task path segments must be URL-encoded strings.");

    if (method === "GET" && segments.length === 2) {
      return {
        operation: "task",
        key
      };
    }

    if (method === "POST" && segments[2] === "start") {
      return {
        operation: "startTask",
        key,
        input: ensureObjectBody(request.body, "Task start requests must carry a JSON object body.")
      };
    }
  }

  if (method === "GET" && segments[0] === "task-runs" && segments[1]) {
    return {
      operation: "getTaskRun",
      id: decodePathSegment(segments[1], "Task run ids must be URL-encoded strings.")
    };
  }

  if (method === "GET" && segments[0] === "artifacts" && segments[1]) {
    return {
      operation: "artifact",
      key: decodePathSegment(segments[1], "Artifact path segments must be URL-encoded strings.")
    };
  }

  if (method === "GET" && segments[0] === "artifact-records" && segments[1]) {
    return {
      operation: "getArtifactRecord",
      id: decodePathSegment(segments[1], "Artifact record ids must be URL-encoded strings.")
    };
  }

  throw new HttpRouteError(404, "http_route_not_found", \`No HTTP route matches \${method} \${path}.\`);
}

function createHttpResponse(
  operation: AgentSurfaceRequest["operation"],
  response: AgentSurfaceResponse
): AgentSurfaceHttpResponse {
  const body = response.ok
    ? response.body
    : {
        error: response.error,
        ...(response.code ? { code: response.code } : {}),
        ...(typeof response.details !== "undefined" ? { details: response.details } : {})
      };

  return {
    status: response.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-capstan-operation": operation,
      "x-capstan-ok": response.ok ? "true" : "false"
    },
    body: \`\${JSON.stringify(body, null, 2)}\\n\`
  };
}

export function createAgentSurfaceHttpTransport(
  transport: AgentSurfaceTransport = defaultAgentSurfaceTransport
): AgentSurfaceHttpTransport {
  return {
    async handle(request: AgentSurfaceHttpRequest): Promise<AgentSurfaceHttpResponse> {
      try {
        const mapped = mapHttpRequestToAgentRequest(request);
        const response = await transport.handle(mapped);
        return createHttpResponse(mapped.operation, response);
      } catch (error) {
        if (error instanceof HttpRouteError) {
          return {
            status: error.status,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "x-capstan-ok": "false"
            },
            body: \`\${JSON.stringify({ error: error.message, code: error.code }, null, 2)}\\n\`
          };
        }

        return {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-capstan-ok": "false"
          },
          body: \`\${JSON.stringify(
            {
              error: error instanceof Error ? error.message : String(error),
              code: "http_transport_runtime_error"
            },
            null,
            2
          )}\\n\`
        };
      }
    }
  };
}

export const defaultAgentSurfaceHttpTransport = createAgentSurfaceHttpTransport();

export async function handleAgentSurfaceHttpRequest(
  request: AgentSurfaceHttpRequest
): Promise<AgentSurfaceHttpResponse> {
  return defaultAgentSurfaceHttpTransport.handle(request);
}
`;
}

function renderAgentSurfaceMcpModule(): string {
  return `import {
  type AgentSurfaceRequest,
  type AgentSurfaceResponse,
  type AgentSurfaceTransport,
  defaultAgentSurfaceTransport
} from "./transport.js";

export interface AgentSurfaceMcpTool {
  name: string;
  title: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
}

export interface AgentSurfaceMcpToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface AgentSurfaceMcpAdapter {
  listTools(): AgentSurfaceMcpTool[];
  callTool(name: string, args?: Record<string, unknown>): Promise<AgentSurfaceMcpToolCallResult>;
}

const agentSurfaceMcpTools = [
  {
    name: "capstan_manifest",
    title: "Capstan Manifest",
    description: "Return the full Capstan agent manifest and summary.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "capstan_resource",
    title: "Capstan Resource",
    description: "Read resource metadata, default route skeletons, and related-resource projections.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Resource key."
        }
      },
      required: ["key"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_search",
    title: "Capstan Search",
    description: "Search resources, capabilities, tasks, and artifacts exposed by this Capstan app.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-form search query."
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_list_attention_items",
    title: "Capstan Attention Inbox",
    description:
      "List workflow attention items across durable tasks, optionally scoped by task, resource, or attention status.",
    inputSchema: {
      type: "object",
      properties: {
        taskKey: {
          type: "string",
          description: "Optional task key."
        },
        resourceKey: {
          type: "string",
          description: "Optional resource key."
        },
        routeKey: {
          type: "string",
          description: "Optional route key."
        },
        actionKey: {
          type: "string",
          description: "Optional action key."
        },
        status: {
          type: "string",
          description: "Optional attention status filter."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "capstan_list_attention_queues",
    title: "Capstan Attention Queues",
    description:
      "List grouped workflow attention queues, optionally scoped by task, resource, route, or action.",
    inputSchema: {
      type: "object",
      properties: {
        taskKey: {
          type: "string",
          description: "Optional task key."
        },
        resourceKey: {
          type: "string",
          description: "Optional resource key."
        },
        routeKey: {
          type: "string",
          description: "Optional route key."
        },
        actionKey: {
          type: "string",
          description: "Optional action key."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "capstan_execute_action",
    title: "Capstan Execute Action",
    description: "Execute a route action through the Capstan control plane with optional relation context.",
    inputSchema: {
      type: "object",
      properties: {
        routeKey: {
          type: "string",
          description: "Projected route key."
        },
        actionKey: {
          type: "string",
          description: "Projected route action key."
        },
        input: {
          type: "object",
          description: "Structured route action input."
        },
        context: {
          type: "object",
          description: "Optional relation context, such as sourceRecordId."
        }
      },
      required: ["routeKey", "actionKey"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_start_task_action",
    title: "Capstan Start Task Action",
    description: "Start the durable task linked to a route action with optional relation context.",
    inputSchema: {
      type: "object",
      properties: {
        routeKey: {
          type: "string",
          description: "Projected route key."
        },
        actionKey: {
          type: "string",
          description: "Projected route action key."
        },
        input: {
          type: "object",
          description: "Structured route action task input."
        },
        context: {
          type: "object",
          description: "Optional relation context, such as sourceRecordId."
        }
      },
      required: ["routeKey", "actionKey"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_execute",
    title: "Capstan Execute",
    description: "Execute a capability directly through the Capstan control plane.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Capability key."
        },
        input: {
          type: "object",
          description: "Structured capability input."
        }
      },
      required: ["key"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_task",
    title: "Capstan Task",
    description: "Read task metadata and latest task state.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Task key."
        }
      },
      required: ["key"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_start_task",
    title: "Capstan Start Task",
    description: "Start a durable task through the Capstan control plane.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Task key."
        },
        input: {
          type: "object",
          description: "Structured task input."
        }
      },
      required: ["key"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_get_task_run",
    title: "Capstan Get Task Run",
    description: "Read one persisted task run.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Task run id."
        }
      },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_get_workflow_run",
    title: "Capstan Get Workflow Run",
    description: "Read one workflow supervision snapshot derived from a task run.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Workflow run id."
        }
      },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_advance_workflow_run",
    title: "Capstan Advance Workflow Run",
    description: "Advance a workflow run through approval, input, retry, or cancellation.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Workflow run id."
        },
        action: {
          type: "string",
          description: "One of approve, provideInput, retry, or cancel."
        },
        input: {
          type: "object",
          description: "Optional structured input override for the transition."
        },
        note: {
          type: "string",
          description: "Optional operator note."
        }
      },
      required: ["id", "action"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_list_task_runs",
    title: "Capstan List Task Runs",
    description: "List persisted task runs, optionally scoped to one task.",
    inputSchema: {
      type: "object",
      properties: {
        taskKey: {
          type: "string",
          description: "Optional task key."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "capstan_list_workflow_runs",
    title: "Capstan List Workflow Runs",
    description: "List workflow supervision snapshots, optionally filtered to runs that need attention.",
    inputSchema: {
      type: "object",
      properties: {
        taskKey: {
          type: "string",
          description: "Optional task key."
        },
        routeKey: {
          type: "string",
          description: "Optional route key."
        },
        actionKey: {
          type: "string",
          description: "Optional action key."
        },
        status: {
          type: "string",
          description: "Optional workflow status filter."
        },
        attentionOnly: {
          type: "boolean",
          description: "When true, only return runs that need supervision or recovery."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "capstan_artifact",
    title: "Capstan Artifact",
    description: "Read artifact metadata and latest produced record.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Artifact key."
        }
      },
      required: ["key"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_get_artifact_record",
    title: "Capstan Get Artifact Record",
    description: "Read one artifact record by id.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Artifact record id."
        }
      },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "capstan_list_artifact_records",
    title: "Capstan List Artifact Records",
    description: "List artifact records, optionally scoped to one artifact.",
    inputSchema: {
      type: "object",
      properties: {
        artifactKey: {
          type: "string",
          description: "Optional artifact key."
        }
      },
      additionalProperties: false
    }
  }
] satisfies AgentSurfaceMcpTool[];

function ensureObjectArgs(args: unknown): Record<string, unknown> {
  if (!args) {
    return {};
  }

  if (typeof args !== "object" || Array.isArray(args)) {
    throw new Error("MCP tool arguments must be a JSON object.");
  }

  return args as Record<string, unknown>;
}

function readStringArg(args: Record<string, unknown>, key: string, message: string): string {
  const value = args[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }

  return value;
}

function readObjectArg(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key];

  if (typeof value === "undefined") {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(\`MCP tool "\${key}" input must be a JSON object.\`);
  }

  return value as Record<string, unknown>;
}

function readOptionalWorkflowStatusArg(
  args: Record<string, unknown>,
  key: string
): Extract<Extract<AgentSurfaceRequest, { operation: "listWorkflowRuns" }>["status"], string> | undefined {
  const value = args[key];

  if (typeof value === "undefined") {
    return undefined;
  }

  if (
    value === "running" ||
    value === "paused" ||
    value === "approval_required" ||
    value === "input_required" ||
    value === "failed" ||
    value === "blocked" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(
    \`MCP tool "\${key}" status must be running, paused, approval_required, input_required, failed, blocked, completed, or cancelled.\`
  );
}

function readOptionalWorkflowAttentionStatusArg(
  args: Record<string, unknown>,
  key: string
): Extract<Extract<AgentSurfaceRequest, { operation: "listAttentionItems" }>["status"], string> | undefined {
  const value = args[key];

  if (typeof value === "undefined") {
    return undefined;
  }

  if (
    value === "paused" ||
    value === "approval_required" ||
    value === "input_required" ||
    value === "failed" ||
    value === "blocked" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(
    \`MCP tool "\${key}" status must be paused, approval_required, input_required, failed, blocked, or cancelled.\`
  );
}

function readOptionalBooleanArg(
  args: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = args[key];

  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(\`MCP tool "\${key}" must be a boolean.\`);
  }

  return value;
}

function mapMcpToolCallToRequest(
  name: string,
  rawArgs: unknown
): AgentSurfaceRequest {
  const args = ensureObjectArgs(rawArgs);

  switch (name) {
    case "capstan_manifest":
      return { operation: "manifest" };
    case "capstan_resource":
      return {
        operation: "resource",
        key: readStringArg(args, "key", "capstan_resource requires a resource key.")
      };
    case "capstan_search":
      return {
        operation: "search",
        query: readStringArg(args, "query", "capstan_search requires a query string.")
      };
    case "capstan_list_attention_items": {
      const status = readOptionalWorkflowAttentionStatusArg(args, "status");

      return {
        operation: "listAttentionItems",
        ...(typeof args.taskKey === "string" ? { taskKey: args.taskKey } : {}),
        ...(typeof args.resourceKey === "string" ? { resourceKey: args.resourceKey } : {}),
        ...(typeof args.routeKey === "string" ? { routeKey: args.routeKey } : {}),
        ...(typeof args.actionKey === "string" ? { actionKey: args.actionKey } : {}),
        ...(status ? { status } : {})
      };
    }
    case "capstan_list_attention_queues":
      return {
        operation: "listAttentionQueues",
        ...(typeof args.taskKey === "string" ? { taskKey: args.taskKey } : {}),
        ...(typeof args.resourceKey === "string" ? { resourceKey: args.resourceKey } : {}),
        ...(typeof args.routeKey === "string" ? { routeKey: args.routeKey } : {}),
        ...(typeof args.actionKey === "string" ? { actionKey: args.actionKey } : {})
      };
    case "capstan_execute_action":
      return {
        operation: "executeAction",
        routeKey: readStringArg(
          args,
          "routeKey",
          "capstan_execute_action requires a routeKey."
        ),
        actionKey: readStringArg(
          args,
          "actionKey",
          "capstan_execute_action requires an actionKey."
        ),
        input: readObjectArg(args, "input"),
        context: readObjectArg(args, "context")
      };
    case "capstan_start_task_action":
      return {
        operation: "startTaskAction",
        routeKey: readStringArg(
          args,
          "routeKey",
          "capstan_start_task_action requires a routeKey."
        ),
        actionKey: readStringArg(
          args,
          "actionKey",
          "capstan_start_task_action requires an actionKey."
        ),
        input: readObjectArg(args, "input"),
        context: readObjectArg(args, "context")
      };
    case "capstan_execute":
      return {
        operation: "execute",
        key: readStringArg(args, "key", "capstan_execute requires a capability key."),
        input: readObjectArg(args, "input")
      };
    case "capstan_task":
      return {
        operation: "task",
        key: readStringArg(args, "key", "capstan_task requires a task key.")
      };
    case "capstan_start_task":
      return {
        operation: "startTask",
        key: readStringArg(args, "key", "capstan_start_task requires a task key."),
        input: readObjectArg(args, "input")
      };
    case "capstan_get_task_run":
      return {
        operation: "getTaskRun",
        id: readStringArg(args, "id", "capstan_get_task_run requires a run id.")
      };
    case "capstan_get_workflow_run":
      return {
        operation: "getWorkflowRun",
        id: readStringArg(args, "id", "capstan_get_workflow_run requires a run id.")
      };
    case "capstan_advance_workflow_run": {
      const action = readStringArg(
        args,
        "action",
        "capstan_advance_workflow_run requires an action."
      );

      if (
        action !== "approve" &&
        action !== "provideInput" &&
        action !== "retry" &&
        action !== "cancel"
      ) {
        throw new Error(
          "capstan_advance_workflow_run action must be approve, provideInput, retry, or cancel."
        );
      }

      return {
        operation: "advanceWorkflowRun",
        id: readStringArg(args, "id", "capstan_advance_workflow_run requires a run id."),
        action,
        input: readObjectArg(args, "input"),
        ...(typeof args.note === "string" ? { note: args.note } : {})
      };
    }
    case "capstan_list_task_runs":
      return {
        operation: "listTaskRuns",
        ...(typeof args.taskKey === "string" ? { taskKey: args.taskKey } : {})
      };
    case "capstan_list_workflow_runs": {
      const status = readOptionalWorkflowStatusArg(args, "status");
      const attentionOnly = readOptionalBooleanArg(args, "attentionOnly");

      return {
        operation: "listWorkflowRuns",
        ...(typeof args.taskKey === "string" ? { taskKey: args.taskKey } : {}),
        ...(typeof args.routeKey === "string" ? { routeKey: args.routeKey } : {}),
        ...(typeof args.actionKey === "string" ? { actionKey: args.actionKey } : {}),
        ...(status ? { status } : {}),
        ...(typeof attentionOnly === "boolean" ? { attentionOnly } : {})
      };
    }
    case "capstan_artifact":
      return {
        operation: "artifact",
        key: readStringArg(args, "key", "capstan_artifact requires an artifact key.")
      };
    case "capstan_get_artifact_record":
      return {
        operation: "getArtifactRecord",
        id: readStringArg(args, "id", "capstan_get_artifact_record requires a record id.")
      };
    case "capstan_list_artifact_records":
      return {
        operation: "listArtifactRecords",
        ...(typeof args.artifactKey === "string" ? { artifactKey: args.artifactKey } : {})
      };
    default:
      throw new Error(\`Unknown MCP tool "\${name}".\`);
  }
}

function createMcpToolResult(response: AgentSurfaceResponse): AgentSurfaceMcpToolCallResult {
  if (response.ok) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.body, null, 2)
        }
      ],
      structuredContent: response.body
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            error: response.error,
            ...(response.code ? { code: response.code } : {}),
            ...(typeof response.details !== "undefined" ? { details: response.details } : {})
          },
          null,
          2
        )
      }
    ],
    structuredContent: {
      error: response.error,
      ...(response.code ? { code: response.code } : {}),
      ...(typeof response.details !== "undefined" ? { details: response.details } : {})
    },
    isError: true
  };
}

export function listAgentSurfaceMcpTools(): AgentSurfaceMcpTool[] {
  return [...agentSurfaceMcpTools];
}

export function createAgentSurfaceMcpAdapter(
  transport: AgentSurfaceTransport = defaultAgentSurfaceTransport
): AgentSurfaceMcpAdapter {
  return {
    listTools(): AgentSurfaceMcpTool[] {
      return listAgentSurfaceMcpTools();
    },
    async callTool(name: string, args?: Record<string, unknown>): Promise<AgentSurfaceMcpToolCallResult> {
      const request = mapMcpToolCallToRequest(name, args);
      const response = await transport.handle(request);
      return createMcpToolResult(response);
    }
  };
}

export const defaultAgentSurfaceMcpAdapter = createAgentSurfaceMcpAdapter();

export async function callAgentSurfaceMcpTool(
  name: string,
  args?: Record<string, unknown>
): Promise<AgentSurfaceMcpToolCallResult> {
  return defaultAgentSurfaceMcpAdapter.callTool(name, args);
}
`;
}

function renderAgentSurfaceA2aModule(): string {
  return `import { agentSurface } from "./index.js";
import {
  type AgentSurfaceRequest,
  type AgentSurfaceResponse,
  type AgentSurfaceTransport,
  defaultAgentSurfaceTransport
} from "./transport.js";

export interface AgentSurfaceA2aSkill {
  id: string;
  name: string;
  description?: string;
  tags: string[];
}

export interface AgentSurfaceA2aCard {
  protocol: "a2a";
  version: "preview";
  name: string;
  description?: string;
  capabilities: {
    stateTransitionHistory: boolean;
    interruptible: boolean;
    memory: boolean;
  };
  defaultInputModes: readonly ["text", "data"];
  defaultOutputModes: readonly ["text", "data"];
  skills: AgentSurfaceA2aSkill[];
}

export interface AgentSurfaceA2aMessage {
  id?: string;
  operation: AgentSurfaceRequest["operation"];
  params?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AgentSurfaceA2aTask {
  id: string;
  state: "working" | "input-required" | "completed" | "failed" | "blocked" | "cancelled";
  operation: AgentSurfaceRequest["operation"];
  message: {
    role: "agent";
    parts: Array<
      | { type: "text"; text: string }
      | { type: "data"; data: unknown }
    >;
  };
  structuredContent?: unknown;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

export interface AgentSurfaceA2aAdapter {
  getCard(): AgentSurfaceA2aCard;
  sendMessage(message: AgentSurfaceA2aMessage): Promise<AgentSurfaceA2aTask>;
}

type AgentSurfaceA2aCapabilityEntry = {
  key: string;
  title: string;
  description?: string;
  mode: string;
  resources: readonly string[];
  task?: string;
  policy?: string;
};

type AgentSurfaceA2aTaskEntry = {
  key: string;
  title: string;
  description?: string;
  kind: string;
  artifactKeys: readonly string[];
};

type AgentSurfaceA2aArtifactEntry = {
  key: string;
  title: string;
  description?: string;
  kind: string;
  taskKeys: readonly string[];
};

type AgentSurfaceA2aResourceEntry = {
  key: string;
  title: string;
  description?: string;
  fieldKeys: readonly string[];
  capabilityKeys: readonly string[];
  relations: readonly {
    key: string;
    resourceKey: string;
    kind: string;
  }[];
};

let a2aTaskSequence = 0;

function createA2aTaskId(operation: AgentSurfaceRequest["operation"]): string {
  a2aTaskSequence += 1;
  return \`a2a-\${operation}-\${String(a2aTaskSequence).padStart(4, "0")}\`;
}

function ensureObjectParams(params: unknown): Record<string, unknown> {
  if (!params) {
    return {};
  }

  if (typeof params !== "object" || Array.isArray(params)) {
    throw new Error("A2A message params must be a JSON object.");
  }

  return params as Record<string, unknown>;
}

function readRequiredString(
  params: Record<string, unknown>,
  key: string,
  message: string
): string {
  const value = params[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }

  return value;
}

function readOptionalString(
  params: Record<string, unknown>,
  key: string
): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readOptionalBooleanParam(
  params: Record<string, unknown>,
  key: string,
  message: string
): boolean | undefined {
  const value = params[key];

  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(message);
  }

  return value;
}

function readOptionalWorkflowStatusParam(
  params: Record<string, unknown>,
  key: string,
  message: string
): Extract<Extract<AgentSurfaceRequest, { operation: "listWorkflowRuns" }>["status"], string> | undefined {
  const value = params[key];

  if (typeof value === "undefined") {
    return undefined;
  }

  if (
    value === "running" ||
    value === "paused" ||
    value === "approval_required" ||
    value === "input_required" ||
    value === "failed" ||
    value === "blocked" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(message);
}

function readOptionalWorkflowAttentionStatusParam(
  params: Record<string, unknown>,
  key: string,
  message: string
): Extract<Extract<AgentSurfaceRequest, { operation: "listAttentionItems" }>["status"], string> | undefined {
  const value = params[key];

  if (typeof value === "undefined") {
    return undefined;
  }

  if (
    value === "paused" ||
    value === "approval_required" ||
    value === "input_required" ||
    value === "failed" ||
    value === "blocked" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(message);
}

function readObjectParam(
  params: Record<string, unknown>,
  key: string,
  message: string
): Record<string, unknown> {
  const value = params[key];

  if (typeof value === "undefined") {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function mapA2aMessageToRequest(message: AgentSurfaceA2aMessage): AgentSurfaceRequest {
  const params = ensureObjectParams(message.params);

  switch (message.operation) {
    case "manifest":
      return { operation: "manifest" };
    case "resource":
      return {
        operation: "resource",
        key: readRequiredString(params, "key", "A2A resource lookup requires a resource key.")
      };
    case "search": {
      const query = readOptionalString(params, "query");
      return {
        operation: "search",
        ...(query ? { query } : {})
      };
    }
    case "listAttentionItems": {
      const taskKey = readOptionalString(params, "taskKey");
      const resourceKey = readOptionalString(params, "resourceKey");
      const routeKey = readOptionalString(params, "routeKey");
      const actionKey = readOptionalString(params, "actionKey");
      const status = readOptionalWorkflowAttentionStatusParam(
        params,
        "status",
        "A2A listAttentionItems status must be a supported attention status."
      );

      return {
        operation: "listAttentionItems",
        ...(taskKey ? { taskKey } : {}),
        ...(resourceKey ? { resourceKey } : {}),
        ...(routeKey ? { routeKey } : {}),
        ...(actionKey ? { actionKey } : {}),
        ...(status ? { status } : {})
      };
    }
    case "listAttentionQueues": {
      const taskKey = readOptionalString(params, "taskKey");
      const resourceKey = readOptionalString(params, "resourceKey");
      const routeKey = readOptionalString(params, "routeKey");
      const actionKey = readOptionalString(params, "actionKey");

      return {
        operation: "listAttentionQueues",
        ...(taskKey ? { taskKey } : {}),
        ...(resourceKey ? { resourceKey } : {}),
        ...(routeKey ? { routeKey } : {}),
        ...(actionKey ? { actionKey } : {})
      };
    }
    case "executeAction":
      return {
        operation: "executeAction",
        routeKey: readRequiredString(
          params,
          "routeKey",
          "A2A executeAction requires a routeKey."
        ),
        actionKey: readRequiredString(
          params,
          "actionKey",
          "A2A executeAction requires an actionKey."
        ),
        input: readObjectParam(
          params,
          "input",
          "A2A executeAction input must be a JSON object."
        ),
        context: readObjectParam(
          params,
          "context",
          "A2A executeAction context must be a JSON object."
        )
      };
    case "startTaskAction":
      return {
        operation: "startTaskAction",
        routeKey: readRequiredString(
          params,
          "routeKey",
          "A2A startTaskAction requires a routeKey."
        ),
        actionKey: readRequiredString(
          params,
          "actionKey",
          "A2A startTaskAction requires an actionKey."
        ),
        input: readObjectParam(
          params,
          "input",
          "A2A startTaskAction input must be a JSON object."
        ),
        context: readObjectParam(
          params,
          "context",
          "A2A startTaskAction context must be a JSON object."
        )
      };
    case "execute":
      return {
        operation: "execute",
        key: readRequiredString(params, "key", "A2A execute requires a capability key."),
        input: readObjectParam(params, "input", "A2A execute input must be a JSON object.")
      };
    case "task":
      return {
        operation: "task",
        key: readRequiredString(params, "key", "A2A task lookup requires a task key.")
      };
    case "artifact":
      return {
        operation: "artifact",
        key: readRequiredString(params, "key", "A2A artifact lookup requires an artifact key.")
      };
    case "startTask":
      return {
        operation: "startTask",
        key: readRequiredString(params, "key", "A2A task start requires a task key."),
        input: readObjectParam(params, "input", "A2A task input must be a JSON object.")
      };
    case "getTaskRun":
      return {
        operation: "getTaskRun",
        id: readRequiredString(params, "id", "A2A getTaskRun requires a task run id.")
      };
    case "getWorkflowRun":
      return {
        operation: "getWorkflowRun",
        id: readRequiredString(params, "id", "A2A getWorkflowRun requires a workflow run id.")
      };
    case "advanceWorkflowRun": {
      const action = readRequiredString(
        params,
        "action",
        "A2A advanceWorkflowRun requires an action."
      );
      const note = readOptionalString(params, "note");

      if (
        action !== "approve" &&
        action !== "provideInput" &&
        action !== "retry" &&
        action !== "cancel"
      ) {
        throw new Error(
          "A2A advanceWorkflowRun action must be approve, provideInput, retry, or cancel."
        );
      }

      return {
        operation: "advanceWorkflowRun",
        id: readRequiredString(params, "id", "A2A advanceWorkflowRun requires a workflow run id."),
        action,
        input: readObjectParam(
          params,
          "input",
          "A2A advanceWorkflowRun input must be a JSON object."
        ),
        ...(note ? { note } : {})
      };
    }
    case "listTaskRuns": {
      const taskKey = readOptionalString(params, "taskKey");
      return {
        operation: "listTaskRuns",
        ...(taskKey ? { taskKey } : {})
      };
    }
    case "listWorkflowRuns": {
      const taskKey = readOptionalString(params, "taskKey");
      const routeKey = readOptionalString(params, "routeKey");
      const actionKey = readOptionalString(params, "actionKey");
      const status = readOptionalWorkflowStatusParam(
        params,
        "status",
        "A2A listWorkflowRuns status must be a supported workflow status."
      );
      const attentionOnly = readOptionalBooleanParam(
        params,
        "attentionOnly",
        "A2A listWorkflowRuns attentionOnly must be a boolean."
      );

      return {
        operation: "listWorkflowRuns",
        ...(taskKey ? { taskKey } : {}),
        ...(routeKey ? { routeKey } : {}),
        ...(actionKey ? { actionKey } : {}),
        ...(status ? { status } : {}),
        ...(typeof attentionOnly === "boolean" ? { attentionOnly } : {})
      };
    }
    case "getArtifactRecord":
      return {
        operation: "getArtifactRecord",
        id: readRequiredString(params, "id", "A2A getArtifactRecord requires a record id.")
      };
    case "listArtifactRecords": {
      const artifactKey = readOptionalString(params, "artifactKey");
      return {
        operation: "listArtifactRecords",
        ...(artifactKey ? { artifactKey } : {})
      };
    }
  }

  const unsupportedOperation: never = message.operation;
  return unsupportedOperation;
}

function mapAgentResponseToA2aState(response: AgentSurfaceResponse): AgentSurfaceA2aTask["state"] {
  if (!response.ok) {
    if (response.code === "agent_transport_approval_required") {
      return "input-required";
    }

    if (response.code === "agent_transport_blocked") {
      return "blocked";
    }

    if (response.code === "agent_transport_cancelled") {
      return "cancelled";
    }

    return "failed";
  }

  const body = response.body;

  if (!body || typeof body !== "object" || Array.isArray(body) || !("status" in body)) {
    return "completed";
  }

  const status = body.status;

  if (typeof status !== "string") {
    return "completed";
  }

  switch (status) {
    case "pending":
    case "running":
    case "ready":
    case "awaiting_execution":
      return "working";
    case "input_required":
    case "approval_required":
      return "input-required";
    case "blocked":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "completed";
  }
}

function createA2aCard(): AgentSurfaceA2aCard {
  const capabilitySkills = (agentSurface.capabilities as readonly unknown[]).map((entry) => {
    const capability = entry as AgentSurfaceA2aCapabilityEntry;

    return {
      id: \`capability:\${capability.key}\`,
      name: capability.title,
      ...(typeof capability.description === "string"
        ? { description: capability.description }
        : {}),
      tags: [
        "capability",
        capability.mode,
        ...capability.resources,
        ...(typeof capability.task === "string" ? [capability.task] : []),
        ...(typeof capability.policy === "string" ? [capability.policy] : [])
      ]
    };
  });
  const taskSkills = (agentSurface.tasks as readonly unknown[]).map((entry) => {
    const task = entry as AgentSurfaceA2aTaskEntry;

    return {
      id: \`task:\${task.key}\`,
      name: task.title,
      ...(typeof task.description === "string" ? { description: task.description } : {}),
      tags: ["task", task.kind, ...task.artifactKeys]
    };
  });
  const artifactSkills = (agentSurface.artifacts as readonly unknown[]).map((entry) => {
    const artifact = entry as AgentSurfaceA2aArtifactEntry;

    return {
      id: \`artifact:\${artifact.key}\`,
      name: artifact.title,
      ...(typeof artifact.description === "string"
        ? { description: artifact.description }
        : {}),
      tags: ["artifact", artifact.kind, ...artifact.taskKeys]
    };
  });
  const resourceSkills = (agentSurface.resources as readonly unknown[]).map((entry) => {
    const resource = entry as AgentSurfaceA2aResourceEntry;

    return {
      id: \`resource:\${resource.key}\`,
      name: resource.title,
      ...(typeof resource.description === "string"
        ? { description: resource.description }
        : {}),
      tags: [
        "resource",
        resource.key,
        ...resource.fieldKeys,
        ...resource.capabilityKeys,
        ...resource.relations.flatMap((relation) => [
          relation.key,
          relation.resourceKey,
          relation.kind
        ])
      ]
    };
  });

  return {
    protocol: "a2a",
    version: "preview",
    name: agentSurface.domain.title,
    ...("description" in agentSurface.domain &&
    typeof agentSurface.domain.description === "string"
      ? { description: agentSurface.domain.description }
      : {}),
    capabilities: {
      stateTransitionHistory: true,
      interruptible: true,
      memory: true
    },
    defaultInputModes: ["text", "data"],
    defaultOutputModes: ["text", "data"],
    skills: [...resourceSkills, ...capabilitySkills, ...taskSkills, ...artifactSkills]
  };
}

function createA2aTask(
  taskId: string,
  operation: AgentSurfaceRequest["operation"],
  response: AgentSurfaceResponse
): AgentSurfaceA2aTask {
  const state = mapAgentResponseToA2aState(response);

  if (response.ok) {
    return {
      id: taskId,
      state,
      operation,
      message: {
        role: "agent",
        parts: [
          {
            type: "text",
            text: \`Capstan completed \${operation} via the shared control plane.\`
          },
          {
            type: "data",
            data: response.body
          }
        ]
      },
      structuredContent: response.body
    };
  }

  return {
    id: taskId,
    state,
    operation,
    message: {
      role: "agent",
      parts: [
        {
          type: "text",
          text: response.error
        }
      ]
    },
    error: {
      message: response.error,
      ...(response.code ? { code: response.code } : {}),
      ...(typeof response.details !== "undefined" ? { details: response.details } : {})
    }
  };
}

export function getAgentSurfaceA2aCard(): AgentSurfaceA2aCard {
  return createA2aCard();
}

export function createAgentSurfaceA2aAdapter(
  transport: AgentSurfaceTransport = defaultAgentSurfaceTransport
): AgentSurfaceA2aAdapter {
  return {
    getCard(): AgentSurfaceA2aCard {
      return getAgentSurfaceA2aCard();
    },
    async sendMessage(message: AgentSurfaceA2aMessage): Promise<AgentSurfaceA2aTask> {
      const request = mapA2aMessageToRequest(message);
      const response = await transport.handle(request);
      return createA2aTask(message.id ?? createA2aTaskId(request.operation), request.operation, response);
    }
  };
}

export const defaultAgentSurfaceA2aAdapter = createAgentSurfaceA2aAdapter();

export async function sendAgentSurfaceA2aMessage(
  message: AgentSurfaceA2aMessage
): Promise<AgentSurfaceA2aTask> {
  return defaultAgentSurfaceA2aAdapter.sendMessage(message);
}
`;
}

function renderResourceFile(resource: ResourceSpec): string {
  return `import type { ResourceDefinition } from "../types.js";

export const ${toIdentifier(resource.key)}Resource = ${serializeObject({
    key: resource.key,
    title: resource.title,
    description: resource.description,
    fields: resource.fields,
    relations: resource.relations
  })} satisfies ResourceDefinition;
`;
}

function renderCapabilityFile(capability: CapabilitySpec): string {
  return renderGeneratedCapabilityDefinitionFile(capability);
}

function compileUserOwnedFiles(graph: AppGraph): GeneratedFile[] {
  const capabilityFiles = graph.capabilities.map((capability) => ({
      path: `src/capabilities/${toKebabCase(capability.key)}.ts`,
      contents: renderUserOwnedCapabilityHandlerFile(capability)
    }));
  const viewFiles = (graph.views ?? []).map((view) => ({
    path: `src/views/${toKebabCase(view.key)}.ts`,
    contents: renderUserOwnedViewModuleFile(view)
  }));
  const assertionFiles: GeneratedFile[] = [
    {
      path: "src/assertions/custom.ts",
      contents: renderUserOwnedAssertionModuleFile()
    }
  ];

  return [...capabilityFiles, ...viewFiles, ...assertionFiles].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
}

function renderGeneratedCapabilityDefinitionFile(capability: CapabilitySpec): string {
  const handlerName = toIdentifier(capability.key);

  return `import type {
  CapabilityDefinition
} from "../../types.js";

export const ${handlerName}Capability = ${serializeObject({
    key: capability.key,
    title: capability.title,
    description: capability.description,
    mode: capability.mode,
    input: capability.input,
    output: capability.output,
    resources: capability.resources,
    task: capability.task,
    policy: capability.policy
  })} satisfies CapabilityDefinition;
`;
}

function renderUserOwnedCapabilityHandlerFile(capability: CapabilitySpec): string {
  const handlerName = toIdentifier(capability.key);

  return `import type { CapabilityExecutionResult } from "../types.js";

export async function ${handlerName}(input: Record<string, unknown> = {}): Promise<CapabilityExecutionResult> {
  return {
    capability: ${JSON.stringify(capability.key)},
    status: "not_implemented",
    input,
    note: "Implement this capability in src/capabilities/${toKebabCase(capability.key)}.ts."
  };
}
`;
}

function renderUserOwnedViewModuleFile(view: ViewSpec): string {
  const viewName = `${toIdentifier(view.key)}View`;

  return `export { ${viewName} } from "./generated/${toKebabCase(view.key)}.js";
`;
}

function renderUserOwnedAssertionModuleFile(): string {
  return `import type { AppAssertion } from "../types.js";

export const customAssertions: readonly AppAssertion[] = [];
`;
}

function renderTaskFile(task: TaskSpec): string {
  return `import type { TaskDefinition } from "../types.js";

export const ${toIdentifier(task.key)}Task = ${serializeObject({
    key: task.key,
    title: task.title,
    description: task.description,
    kind: task.kind,
    artifacts: task.artifacts
  })} satisfies TaskDefinition;
`;
}

function renderPolicyFile(policy: PolicySpec): string {
  return `import type { PolicyDefinition } from "../types.js";

export const ${toIdentifier(policy.key)}Policy = ${serializeObject({
    key: policy.key,
    title: policy.title,
    description: policy.description,
    effect: policy.effect
  })} satisfies PolicyDefinition;
`;
}

function renderArtifactFile(artifact: ArtifactSpec): string {
  return `import type { ArtifactDefinition } from "../types.js";

export const ${toIdentifier(artifact.key)}Artifact = ${serializeObject({
    key: artifact.key,
    title: artifact.title,
    description: artifact.description,
    kind: artifact.kind
  })} satisfies ArtifactDefinition;
`;
}

function renderGeneratedViewDefinitionFile(view: ViewSpec): string {
  return `import type { ViewDefinition } from "../../types.js";

export const ${toIdentifier(view.key)}View = ${serializeObject({
    key: view.key,
    title: view.title,
    description: view.description,
    kind: view.kind,
    resource: view.resource,
    capability: view.capability
  })} satisfies ViewDefinition;
`;
}

function renderResourceIndex(resources: ResourceSpec[]): string {
  return renderRegistryIndex({
    typeName: "ResourceDefinition",
    typeImportFrom: "../types.js",
    imports: resources.map((resource) => ({
      from: `./${toKebabCase(resource.key)}.js`,
      symbol: `${toIdentifier(resource.key)}Resource`
    })),
    symbol: "resources"
  });
}

function renderCapabilityIndex(capabilities: CapabilitySpec[]): string {
  const imports = capabilities.flatMap((capability) => [
    {
      from: `./generated/${toKebabCase(capability.key)}.js`,
      symbol: `${toIdentifier(capability.key)}Capability`
    },
    {
      from: `./${toKebabCase(capability.key)}.js`,
      symbol: toIdentifier(capability.key)
    }
  ]);

  const capabilitySymbols = capabilities.map(
    (capability) => `${toIdentifier(capability.key)}Capability`
  );

  return `import type {
  CapabilityDefinition,
  CapabilityExecutionResult
} from "../types.js";
${imports.length ? `\n${imports.map((entry) => `import { ${entry.symbol} } from "${entry.from}";`).join("\n")}` : ""}

export const capabilities: readonly CapabilityDefinition[] = [
${capabilitySymbols.map((symbol) => `  ${symbol}`).join(",\n")}
] as const;

export const capabilityHandlers: Record<
  string,
  (input: Record<string, unknown>) => Promise<CapabilityExecutionResult>
> = {
${capabilities.map((capability) => `  ${JSON.stringify(capability.key)}: ${toIdentifier(capability.key)}`).join(",\n")}
};
`;
}

function renderTaskIndex(tasks: TaskSpec[]): string {
  return renderRegistryIndex({
    typeName: "TaskDefinition",
    typeImportFrom: "../types.js",
    imports: tasks.map((task) => ({
      from: `./${toKebabCase(task.key)}.js`,
      symbol: `${toIdentifier(task.key)}Task`
    })),
    symbol: "tasks"
  });
}

function renderPolicyIndex(policies: PolicySpec[]): string {
  return renderRegistryIndex({
    typeName: "PolicyDefinition",
    typeImportFrom: "../types.js",
    imports: policies.map((policy) => ({
      from: `./${toKebabCase(policy.key)}.js`,
      symbol: `${toIdentifier(policy.key)}Policy`
    })),
    symbol: "policies"
  });
}

function renderArtifactIndex(artifacts: ArtifactSpec[]): string {
  return renderRegistryIndex({
    typeName: "ArtifactDefinition",
    typeImportFrom: "../types.js",
    imports: artifacts.map((artifact) => ({
      from: `./${toKebabCase(artifact.key)}.js`,
      symbol: `${toIdentifier(artifact.key)}Artifact`
    })),
    symbol: "artifacts"
  });
}

function renderViewIndex(views: ViewSpec[]): string {
  return renderRegistryIndex({
    typeName: "ViewDefinition",
    typeImportFrom: "../types.js",
    imports: views.map((view) => ({
      from: `./generated/${toKebabCase(view.key)}.js`,
      symbol: `${toIdentifier(view.key)}View`
    })),
    symbol: "views"
  });
}

function renderRegistryIndex({
  imports,
  symbol,
  typeName,
  typeImportFrom
}: {
  imports: Array<{ from: string; symbol: string }>;
  symbol: string;
  typeName: string;
  typeImportFrom: string;
}): string {
  const typeImport = `import type { ${typeName} } from "${typeImportFrom}";`;

  if (!imports.length) {
    return `${typeImport}

export const ${symbol}: readonly ${typeName}[] = [];
`;
  }

  return `${typeImport}
${imports.length ? `\n${imports.map((entry) => `import { ${entry.symbol} } from "${entry.from}";`).join("\n")}` : ""}

export const ${symbol}: readonly ${typeName}[] = [
${imports.map((entry) => `  ${entry.symbol}`).join(",\n")}
];
`;
}

function renderControlPlaneFile(graph: AppGraph): string {
  return `import { artifacts } from "../artifacts/index.js";
import { capabilities, capabilityHandlers } from "../capabilities/index.js";
import { resources } from "../resources/index.js";
import { tasks } from "../tasks/index.js";
import { views } from "../views/index.js";
import type {
  ArtifactDefinition,
  CapabilityDefinition,
  CapabilityExecutionResult,
  FieldDefinition,
  ResourceDefinition,
  TaskDefinition
} from "../types.js";

export interface SearchResult {
  resources: readonly ResourceDefinition[];
  capabilities: readonly CapabilityDefinition[];
  tasks: readonly TaskResult[];
  artifacts: readonly ArtifactDefinition[];
}

export interface ResourceRouteAction {
  key: string;
  title: string;
  mode: "read" | "write" | "external";
  resourceKeys: readonly string[];
  task?: string;
  policy?: string;
  inputFieldKeys: readonly string[];
  outputFieldKeys: readonly string[];
  entry: boolean;
  execution: ResourceRouteActionExecution;
  taskStart?: ResourceRouteActionTaskStart;
  workflow?: ResourceRouteActionWorkflow;
}

export interface ResourceRouteActionExecution {
  operation: "executeAction";
  routeKey: string;
  actionKey: string;
  inputSchema: Record<string, FieldDefinition>;
  scope: ResourceRouteActionScope;
}

export interface ResourceRouteActionScope {
  kind: "resource" | "relation";
  resourceKey: string;
  sourceResourceKey?: string;
  sourceRelationKey?: string;
  contextSchema?: Record<string, FieldDefinition>;
}

export interface ResourceRouteActionTaskStart {
  operation: "startTaskAction";
  routeKey: string;
  actionKey: string;
  task: {
    key: string;
    title: string;
    kind: "sync" | "durable";
    artifactKeys: readonly string[];
  };
  inputSchema: Record<string, FieldDefinition>;
  scope: ResourceRouteActionScope;
}

export type WorkflowStatus =
  | "running"
  | "paused"
  | "approval_required"
  | "input_required"
  | "failed"
  | "blocked"
  | "completed"
  | "cancelled";

export type WorkflowNextAction =
  | "continue"
  | "resume"
  | "await_approval"
  | "await_input"
  | "retry"
  | "resolve_block"
  | "inspect_output"
  | "review_cancellation";

export type WorkflowTransitionAction = "approve" | "provideInput" | "retry" | "cancel";

export interface WorkflowTransition {
  key: WorkflowTransitionAction;
  inputSchema?: Record<string, FieldDefinition>;
}

export interface WorkflowRunFilter {
  taskKey?: string;
  routeKey?: string;
  actionKey?: string;
  status?: WorkflowStatus;
  attentionOnly?: boolean;
}

export interface ResourceRouteActionWorkflowCommand {
  key:
    | "start"
    | "get"
    | "summary"
    | "memory"
    | "pause"
    | "resume"
    | "approve"
    | "provideInput"
    | "retry";
  command: "capstan";
  args: readonly string[];
  placeholders: readonly ("appDir" | "runId" | "inputPath")[];
}

export interface ResourceRouteActionWorkflowControlPlane {
  getRun: {
    operation: "getWorkflowRun";
  };
  listRuns: {
    operation: "listWorkflowRuns";
    defaultFilter: WorkflowRunFilter;
  };
  attention: {
    operation: "listAttentionItems";
    defaultFilter: AttentionItemFilter;
    queues: {
      operation: "listAttentionQueues";
      defaultFilter: AttentionItemFilter;
      statuses: readonly AttentionItemStatus[];
    };
  };
  advance: {
    operation: "advanceWorkflowRun";
    transitions: readonly WorkflowTransition[];
  };
}

export interface ResourceRouteActionWorkflow {
  kind: "starter_run_recipe";
  runtime: "harness";
  interface: "cli";
  routeKey: string;
  actionKey: string;
  task: {
    key: string;
    title: string;
    kind: "sync" | "durable";
    artifactKeys: readonly string[];
  };
  inputSchema: Record<string, FieldDefinition>;
  scope: ResourceRouteActionScope;
  inputEnvelope: {
    injectedRoute: {
      routeKey: string;
      actionKey: string;
      path: string;
      kind: "list" | "detail" | "form";
      resourceKey: string;
      sourceResourceKey?: string;
      sourceRelationKey?: string;
    };
    relationContext?: {
      sourceResourceKey: string;
      sourceRelationKey: string;
      contextSchema: Record<string, FieldDefinition>;
    };
  };
  start: ResourceRouteActionWorkflowCommand;
  observe: readonly ResourceRouteActionWorkflowCommand[];
  controlPlane: ResourceRouteActionWorkflowControlPlane;
  recover: {
    nextActions: Record<WorkflowStatus, WorkflowNextAction>;
    commands: readonly ResourceRouteActionWorkflowCommand[];
  };
}

export interface WorkflowRun {
  id: string;
  status: WorkflowStatus;
  nextAction: WorkflowNextAction;
  attempt: number;
  task: {
    key: string;
    title: string;
    kind: "sync" | "durable";
    artifactKeys: readonly string[];
  };
  capability: {
    key: string;
    title: string;
  };
  route?: ResourceRouteActionWorkflow["inputEnvelope"]["injectedRoute"];
  relation?: Record<string, unknown>;
  activeCheckpoint?: {
    type: "approval" | "input";
    note?: string;
  };
  availableTransitions: readonly WorkflowTransition[];
  input: Record<string, unknown>;
  artifacts: readonly ArtifactRecord[];
  result?: CapabilityExecutionResult;
  error?: string;
  updatedAt: string;
}

export interface ResourceRouteReference {
  key: string;
  title: string;
  kind: "list" | "detail" | "form";
  path: string;
  resourceKey: string;
  capabilityKey?: string;
  generated: boolean;
  sourceResourceKey?: string;
  sourceRelationKey?: string;
  actions: readonly ResourceRouteAction[];
}

export interface ResourceRelationResult {
  relation: {
    key: string;
    label: string;
    kind: "one" | "many";
    description?: string;
  };
  resource: ResourceDefinition;
  route: ResourceRouteReference;
  capabilities: readonly CapabilityDefinition[];
}

export interface ResourceResult {
  resource: ResourceDefinition;
  capabilities: readonly CapabilityDefinition[];
  routes: readonly ResourceRouteReference[];
  relations: readonly ResourceRelationResult[];
  workflowAttention?: WorkflowAttentionSummary;
}

export type WorkflowAttentionStatus =
  | "paused"
  | "approval_required"
  | "input_required"
  | "failed"
  | "blocked"
  | "cancelled";

export interface WorkflowAttentionRunSummary {
  id: string;
  status: WorkflowAttentionStatus;
  nextAction: WorkflowNextAction;
  attempt: number;
  updatedAt: string;
  route?: WorkflowRun["route"];
}

export interface WorkflowAttentionSummary {
  openCount: number;
  statusCounts: Partial<Record<WorkflowAttentionStatus, number>>;
  latestRun?: WorkflowAttentionRunSummary;
  runs?: readonly WorkflowAttentionRunSummary[];
  queues?: readonly AttentionQueue[];
}

export type AttentionItemStatus = WorkflowAttentionStatus;

export interface AttentionItemFilter {
  taskKey?: string;
  resourceKey?: string;
  routeKey?: string;
  actionKey?: string;
  status?: AttentionItemStatus;
}

export interface AttentionItem {
  kind: "workflow_run";
  id: string;
  status: AttentionItemStatus;
  nextAction: WorkflowNextAction;
  attempt: number;
  updatedAt: string;
  task: WorkflowRun["task"];
  capability: WorkflowRun["capability"];
  route?: WorkflowRun["route"];
  relation?: WorkflowRun["relation"];
  activeCheckpoint?: WorkflowRun["activeCheckpoint"];
  availableTransitions: readonly WorkflowTransition[];
}

export interface AttentionQueue {
  status: AttentionItemStatus;
  openCount: number;
  filter: AttentionItemFilter;
  latestItem?: AttentionItem;
}

export interface TaskResult {
  task: TaskDefinition;
  status:
    | "ready"
    | "awaiting_execution"
    | "running"
    | "input_required"
    | "approval_required"
    | "completed"
    | "failed"
    | "cancelled"
    | "blocked";
  capabilities: readonly CapabilityDefinition[];
  artifacts: readonly ArtifactDefinition[];
  runCount: number;
  workflowAttention?: WorkflowAttentionSummary;
  latestRun?: TaskRun;
}

export interface ArtifactResult {
  artifact: ArtifactDefinition;
  tasks: readonly TaskDefinition[];
  capabilities: readonly CapabilityDefinition[];
  records: readonly ArtifactRecord[];
  latestRecord?: ArtifactRecord;
}

export type TaskRunStatus =
  | "pending"
  | "running"
  | "input_required"
  | "approval_required"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export interface ArtifactRecord {
  id: string;
  artifactKey: string;
  taskRunId: string;
  taskKey: string;
  capabilityKey: string;
  payload: unknown;
  createdAt: string;
}

export interface TaskRun {
  id: string;
  taskKey: string;
  capabilityKey: string;
  status: TaskRunStatus;
  attempt: number;
  input: Record<string, unknown>;
  artifacts: readonly ArtifactRecord[];
  result?: CapabilityExecutionResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface ControlPlaneRuntimeState {
  taskRuns: Map<string, TaskRun>;
  artifactRecords: Map<string, ArtifactRecord>;
  taskRunSequence: number;
  artifactRecordSequence: number;
}

const runtimeStateKey = \`__capstanControlPlaneRuntime:\${new URL(import.meta.url).pathname}\`;
const runtimeStateRegistry = globalThis as typeof globalThis & Record<
  string,
  ControlPlaneRuntimeState | undefined
>;
const runtimeState =
  runtimeStateRegistry[runtimeStateKey] ??
  (runtimeStateRegistry[runtimeStateKey] = {
    taskRuns: new Map<string, TaskRun>(),
    artifactRecords: new Map<string, ArtifactRecord>(),
    taskRunSequence: 0,
    artifactRecordSequence: 0
  });
const taskRuns = runtimeState.taskRuns;
const artifactRecords = runtimeState.artifactRecords;

function nextTaskRunId(): string {
  runtimeState.taskRunSequence += 1;
  return \`task-run-\${runtimeState.taskRunSequence}\`;
}

function nextArtifactRecordId(): string {
  runtimeState.artifactRecordSequence += 1;
  return \`artifact-record-\${runtimeState.artifactRecordSequence}\`;
}

function taskRunSequenceValue(run: Pick<TaskRun, "id">): number {
  return Number(run.id.replace("task-run-", "")) || 0;
}

function artifactRecordSequenceValue(record: Pick<ArtifactRecord, "id">): number {
  return Number(record.id.replace("artifact-record-", "")) || 0;
}

function persistTaskRun(run: TaskRun): TaskRun {
  taskRuns.set(run.id, run);
  return run;
}

function persistArtifactRecord(record: ArtifactRecord): ArtifactRecord {
  artifactRecords.set(record.id, record);
  return record;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveTaskStatus(taskDefinition: TaskDefinition, latestRun?: TaskRun): TaskResult["status"] {
  if (!latestRun) {
    return taskDefinition.kind === "durable" ? "awaiting_execution" : "ready";
  }

  switch (latestRun.status) {
    case "pending":
    case "running":
      return "running";
    case "input_required":
      return "input_required";
    case "approval_required":
      return "approval_required";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "blocked":
      return "blocked";
    default:
      return taskDefinition.kind === "durable" ? "awaiting_execution" : "ready";
  }
}

function resolveTaskRunStatus(result: CapabilityExecutionResult): TaskRunStatus {
  switch (result.status) {
    case "completed":
      return "completed";
    case "input_required":
      return "input_required";
    case "approval_required":
      return "approval_required";
    case "cancelled":
      return "cancelled";
    case "blocked":
      return "blocked";
    case "failed":
    case "not_implemented":
    default:
      return "failed";
  }
}

function extractArtifactPayload(output: unknown, artifactKey: string): unknown {
  if (isRecordValue(output)) {
    const artifactMap = output.artifacts;

    if (isRecordValue(artifactMap) && artifactMap[artifactKey] !== undefined) {
      return artifactMap[artifactKey];
    }

    if (output[artifactKey] !== undefined) {
      return output[artifactKey];
    }
  }

  return output;
}

function createArtifactRecords(
  taskDefinition: TaskDefinition,
  capabilityKey: string,
  taskRunId: string,
  result: CapabilityExecutionResult
): ArtifactRecord[] {
  const timestamp = new Date().toISOString();

  return (taskDefinition.artifacts ?? []).map((artifactKey) =>
    persistArtifactRecord({
      id: nextArtifactRecordId(),
      artifactKey,
      taskRunId,
      taskKey: taskDefinition.key,
      capabilityKey,
      payload: extractArtifactPayload(result.output, artifactKey),
      createdAt: timestamp
    })
  );
}

export function search(query = ""): SearchResult {
  const normalized = query.trim().toLowerCase();
  const taskMatches = (normalized
    ? tasks.filter((taskDefinition) =>
        [taskDefinition.key, taskDefinition.title, taskDefinition.description ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalized)
      )
    : tasks
  ).map((taskDefinition) => task(taskDefinition.key));

  if (!normalized) {
    return {
      resources,
      capabilities,
      tasks: taskMatches,
      artifacts
    };
  }

  return {
    resources: resources.filter((resource) =>
      [
        resource.key,
        resource.title,
        resource.description ?? "",
        ...Object.keys(resource.fields ?? {}),
        ...Object.entries(resource.relations ?? {}).flatMap(([relationKey, relation]) => [
          relationKey,
          relation.resource,
          relation.description ?? ""
        ])
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    ),
    capabilities: capabilities.filter((capability) =>
      [capability.key, capability.title, capability.description ?? "", ...(capability.resources ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    ),
    tasks: taskMatches,
    artifacts: artifacts.filter((artifact) =>
      [artifact.key, artifact.title, artifact.description ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    )
  };
}

export function getCapability(key: string): CapabilityDefinition | undefined {
  return capabilities.find((capability) => capability.key === key);
}

export function getResource(key: string): ResourceDefinition | undefined {
  return resources.find((resource) => resource.key === key);
}

export function getTask(key: string): TaskDefinition | undefined {
  return tasks.find((task) => task.key === key);
}

export function getArtifact(key: string): ArtifactDefinition | undefined {
  return artifacts.find((artifact) => artifact.key === key);
}

function getResourceViews(key: string) {
  return views.filter((view) => view.resource === key);
}

function getResourceCapabilities(key: string) {
  return capabilities.filter((capability) => (capability.resources ?? []).includes(key));
}

function startCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function optionalProperty<Key extends string, Value>(
  key: Key,
  value: Value | undefined
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}

function selectRouteCapability(
  kind: ResourceRouteReference["kind"],
  explicitCapabilityKey: string | undefined,
  resourceCapabilities: readonly CapabilityDefinition[]
) {
  if (explicitCapabilityKey) {
    return resourceCapabilities.find((capability) => capability.key === explicitCapabilityKey);
  }

  switch (kind) {
    case "list":
      return resourceCapabilities.find((capability) => capability.mode === "read");
    case "form":
      return resourceCapabilities.find((capability) => capability.mode === "write");
    case "detail":
      return (
        resourceCapabilities.find((capability) => capability.mode === "external") ??
        resourceCapabilities.find((capability) => capability.mode === "read")
      );
  }
}

function projectRouteActions(
  resourceCapabilities: readonly CapabilityDefinition[],
  entryCapabilityKey: string | undefined,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): ResourceRouteAction[] {
  return resourceCapabilities.map((capability) => ({
    key: capability.key,
    title: capability.title,
    mode: capability.mode,
    resourceKeys: capability.resources ?? [],
    ...optionalProperty("task", capability.task),
    ...optionalProperty("policy", capability.policy),
    inputFieldKeys: Object.keys(capability.input ?? {}),
    outputFieldKeys: Object.keys(capability.output ?? {}),
    entry: capability.key === entryCapabilityKey,
    execution: createRouteActionExecution(capability, routeContext),
    ...optionalProperty("taskStart", createRouteActionTaskStart(capability, routeContext)),
    ...optionalProperty("workflow", createRouteActionWorkflow(capability, routeContext))
  }));
}

function createRouteActionExecution(
  capability: CapabilityDefinition,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): ResourceRouteActionExecution {
  return {
    operation: "executeAction",
    routeKey: routeContext.routeKey,
    actionKey: capability.key,
    inputSchema: capability.input ?? {},
    scope: createRouteActionScope(routeContext)
  };
}

function createRouteActionTaskStart(
  capability: CapabilityDefinition,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): ResourceRouteActionTaskStart | undefined {
  if (!capability.task) {
    return undefined;
  }

  const taskDefinition = getTask(capability.task);

  if (!taskDefinition) {
    return undefined;
  }

  return {
    operation: "startTaskAction",
    routeKey: routeContext.routeKey,
    actionKey: capability.key,
    task: {
      key: taskDefinition.key,
      title: taskDefinition.title,
      kind: taskDefinition.kind,
      artifactKeys: taskDefinition.artifacts ?? []
    },
    inputSchema: capability.input ?? {},
    scope: createRouteActionScope(routeContext)
  };
}

function createRouteActionWorkflow(
  capability: CapabilityDefinition,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): ResourceRouteActionWorkflow | undefined {
  if (!capability.task) {
    return undefined;
  }

  const taskDefinition = getTask(capability.task);

  if (!taskDefinition || taskDefinition.kind !== "durable") {
    return undefined;
  }

  const scope = createRouteActionScope(routeContext);

  return {
    kind: "starter_run_recipe",
    runtime: "harness",
    interface: "cli",
    routeKey: routeContext.routeKey,
    actionKey: capability.key,
    task: {
      key: taskDefinition.key,
      title: taskDefinition.title,
      kind: taskDefinition.kind,
      artifactKeys: taskDefinition.artifacts ?? []
    },
    inputSchema: capability.input ?? {},
    scope,
    inputEnvelope: {
      injectedRoute: createRouteActionEnvelope(capability.key, routeContext),
      ...optionalProperty(
        "relationContext",
        scope.kind === "relation"
          ? {
              sourceResourceKey: routeContext.sourceResourceKey ?? "",
              sourceRelationKey: routeContext.sourceRelationKey ?? "",
              contextSchema: scope.contextSchema ?? {}
            }
          : undefined
      )
    },
    start: createWorkflowCommand("start", [
      "harness:start",
      "<app-dir>",
      taskDefinition.key,
      "--json",
      "--input",
      "<input-path>"
    ]),
    observe: [
      createWorkflowCommand("get", ["harness:get", "<app-dir>", "<run-id>", "--json"]),
      createWorkflowCommand("summary", [
        "harness:summary",
        "<app-dir>",
        "<run-id>",
        "--json"
      ]),
      createWorkflowCommand("memory", [
        "harness:memory",
        "<app-dir>",
        "<run-id>",
        "--json"
      ])
    ],
    controlPlane: {
      getRun: {
        operation: "getWorkflowRun"
      },
      listRuns: {
        operation: "listWorkflowRuns",
        defaultFilter: {
          taskKey: taskDefinition.key,
          routeKey: routeContext.routeKey,
          actionKey: capability.key,
          attentionOnly: true
        }
      },
      attention: {
        operation: "listAttentionItems",
        defaultFilter: {
          taskKey: taskDefinition.key,
          routeKey: routeContext.routeKey,
          actionKey: capability.key
        },
        queues: {
          operation: "listAttentionQueues",
          defaultFilter: {
            taskKey: taskDefinition.key,
            routeKey: routeContext.routeKey,
            actionKey: capability.key
          },
          statuses: [
            "approval_required",
            "input_required",
            "blocked",
            "failed",
            "paused",
            "cancelled"
          ]
        }
      },
      advance: {
        operation: "advanceWorkflowRun",
        transitions: createWorkflowTransitions(capability.input ?? {})
      }
    },
    recover: {
      nextActions: createWorkflowNextActions(),
      commands: [
        createWorkflowCommand("pause", [
          "harness:pause",
          "<app-dir>",
          "<run-id>",
          "--json"
        ]),
        createWorkflowCommand("resume", [
          "harness:resume",
          "<app-dir>",
          "<run-id>",
          "--json"
        ]),
        createWorkflowCommand("approve", [
          "harness:approve",
          "<app-dir>",
          "<run-id>",
          "--json"
        ]),
        createWorkflowCommand("provideInput", [
          "harness:provide-input",
          "<app-dir>",
          "<run-id>",
          "--input",
          "<input-path>",
          "--json"
        ]),
        createWorkflowCommand("retry", [
          "harness:retry",
          "<app-dir>",
          "<run-id>",
          "--json"
        ])
      ]
    }
  };
}

function createRouteActionScope(routeContext: {
  routeKey: string;
  resourceKey: string;
  sourceResourceKey?: string;
  sourceResourceTitle?: string;
  sourceRelationKey?: string;
  path?: string;
  kind?: "list" | "detail" | "form";
}): ResourceRouteActionScope {
  return routeContext.sourceResourceKey && routeContext.sourceRelationKey
    ? {
        kind: "relation",
        resourceKey: routeContext.resourceKey,
        sourceResourceKey: routeContext.sourceResourceKey,
        sourceRelationKey: routeContext.sourceRelationKey,
        contextSchema: {
          sourceRecordId: {
            type: "string",
            required: true,
            description: \`Identifier for the \${routeContext.sourceResourceTitle ?? startCase(routeContext.sourceResourceKey)} record whose \${startCase(routeContext.sourceRelationKey)} relation scopes this action.\`
          }
        }
      }
    : {
        kind: "resource",
        resourceKey: routeContext.resourceKey
      };
}

function createRouteActionEnvelope(
  actionKey: string,
  routeContext: {
    routeKey: string;
    resourceKey: string;
    sourceResourceKey?: string;
    sourceResourceTitle?: string;
    sourceRelationKey?: string;
    path?: string;
    kind?: "list" | "detail" | "form";
  }
): ResourceRouteActionWorkflow["inputEnvelope"]["injectedRoute"] {
  return {
    routeKey: routeContext.routeKey,
    actionKey,
    path: routeContext.path ?? "",
    kind: routeContext.kind ?? "detail",
    resourceKey: routeContext.resourceKey,
    ...optionalProperty("sourceResourceKey", routeContext.sourceResourceKey),
    ...optionalProperty("sourceRelationKey", routeContext.sourceRelationKey)
  };
}

function createWorkflowCommand(
  key: ResourceRouteActionWorkflowCommand["key"],
  args: string[]
): ResourceRouteActionWorkflowCommand {
  return {
    key,
    command: "capstan",
    args,
    placeholders: Array.from(
      new Set(
        args.flatMap((value) =>
          value === "<app-dir>"
            ? ["appDir" as const]
            : value === "<run-id>"
              ? ["runId" as const]
              : value === "<input-path>"
                ? ["inputPath" as const]
                : []
        )
      )
    )
  };
}

function createWorkflowNextActions(): Record<WorkflowStatus, WorkflowNextAction> {
  return {
    running: "continue",
    paused: "resume",
    approval_required: "await_approval",
    input_required: "await_input",
    failed: "retry",
    blocked: "resolve_block",
    completed: "inspect_output",
    cancelled: "review_cancellation"
  };
}

function createWorkflowTransitions(
  inputSchema: Record<string, FieldDefinition>
): WorkflowTransition[] {
  return [
    {
      key: "approve",
      ...optionalProperty("inputSchema", inputSchema)
    },
    {
      key: "provideInput",
      inputSchema
    },
    {
      key: "retry",
      ...optionalProperty("inputSchema", inputSchema)
    },
    {
      key: "cancel"
    }
  ];
}

function createResourceRouteReference(
  resource: ResourceDefinition,
  kind: ResourceRouteReference["kind"]
): ResourceRouteReference {
  const explicitView = getResourceViews(resource.key).find((view) => view.kind === kind);
  const matchedCapability = selectRouteCapability(
    kind,
    explicitView?.capability,
    getResourceCapabilities(resource.key)
  );
  const capabilityKey = explicitView?.capability ?? matchedCapability?.key;
  const resourceCapabilities = getResourceCapabilities(resource.key);

  return {
    key: explicitView?.key ?? \`\${resource.key}\${startCase(kind).replace(/\\s+/g, "")}\`,
    title: explicitView?.title ?? \`\${resource.title} \${startCase(kind)}\`,
    kind,
    path: \`/resources/\${toKebabCase(resource.key)}/\${kind}\`,
    resourceKey: resource.key,
    ...optionalProperty("capabilityKey", capabilityKey),
    generated: !explicitView,
    actions: projectRouteActions(resourceCapabilities, capabilityKey, {
      routeKey: explicitView?.key ?? \`\${resource.key}\${startCase(kind).replace(/\\s+/g, "")}\`,
      resourceKey: resource.key,
      path: \`/resources/\${toKebabCase(resource.key)}/\${kind}\`,
      kind
    })
  };
}

function createRelationRouteReference(
  resource: ResourceDefinition,
  relationKey: string,
  relation: NonNullable<ResourceDefinition["relations"]>[string]
): {
  key: string;
  path: string;
  title: string;
} {
  const routeKind = relation.kind === "many" ? "list" : "detail";
  const relationStem = startCase(relationKey).replace(/\\s+/g, "");
  const routeKindStem = startCase(routeKind).replace(/\\s+/g, "");

  return {
    key: \`\${resource.key}\${relationStem}Relation\${routeKindStem}\`,
    path: \`/resources/\${toKebabCase(resource.key)}/relations/\${toKebabCase(relationKey)}/\${routeKind}\`,
    title: \`\${resource.title} \${startCase(relationKey)} \${startCase(routeKind)}\`
  };
}

export function resource(key: string): ResourceResult {
  const resourceDefinition = getResource(key);

  if (!resourceDefinition) {
    throw new Error(\`Unknown resource "\${key}".\`);
  }

  const linkedCapabilities = getResourceCapabilities(resourceDefinition.key);
  const routeReferences = (["list", "detail", "form"] as const).map((kind) =>
    createResourceRouteReference(resourceDefinition, kind)
  );
  const relations = Object.entries(resourceDefinition.relations ?? {}).flatMap(
    ([relationKey, relation]) => {
      const targetResource = getResource(relation.resource);

      if (!targetResource) {
        return [];
      }

      const routeKind: ResourceRouteReference["kind"] =
        relation.kind === "many" ? "list" : "detail";
      const targetExplicitView = getResourceViews(targetResource.key).find(
        (view) => view.kind === routeKind
      );
      const targetCapabilities = getResourceCapabilities(targetResource.key);
      const matchedCapability = selectRouteCapability(
        routeKind,
        targetExplicitView?.capability,
        targetCapabilities
      );
      const routeReference = createRelationRouteReference(resourceDefinition, relationKey, relation);
      const capabilityKey = targetExplicitView?.capability ?? matchedCapability?.key;

      return [
        {
          relation: {
            key: relationKey,
            label: startCase(relationKey),
            kind: relation.kind,
            ...(relation.description ? { description: relation.description } : {})
          },
          resource: targetResource,
          route: {
            key: routeReference.key,
            title: routeReference.title,
            kind: routeKind,
            path: routeReference.path,
            resourceKey: targetResource.key,
            ...optionalProperty(
              "capabilityKey",
              capabilityKey
            ),
            generated: true,
            sourceResourceKey: resourceDefinition.key,
            sourceRelationKey: relationKey,
            actions: projectRouteActions(targetCapabilities, capabilityKey, {
              routeKey: routeReference.key,
              resourceKey: targetResource.key,
              sourceResourceKey: resourceDefinition.key,
              sourceResourceTitle: resourceDefinition.title,
              sourceRelationKey: relationKey,
              path: routeReference.path,
              kind: routeKind
            })
          },
          capabilities: targetCapabilities
        }
      ];
    }
  );
  const hasWorkflowActions =
    routeReferences.some((route) => route.actions.some((action) => action.workflow)) ||
    relations.some((relationResult) =>
      relationResult.route.actions.some((action) => action.workflow)
    );

  return {
    resource: resourceDefinition,
    capabilities: linkedCapabilities,
    routes: routeReferences,
    relations,
    ...optionalProperty(
      "workflowAttention",
      hasWorkflowActions ? createResourceWorkflowAttentionSummary(resourceDefinition.key) : undefined
    )
  };
}

function getRouteReference(routeKey: string): ResourceRouteReference | undefined {
  for (const resourceDefinition of resources) {
    const result = resource(resourceDefinition.key);
    const directRoute = result.routes.find((route) => route.key === routeKey);

    if (directRoute) {
      return directRoute;
    }

    const relationRoute = result.relations.find((relation) => relation.route.key === routeKey)?.route;

    if (relationRoute) {
      return relationRoute;
    }
  }

  return undefined;
}

function getRouteAction(
  routeKey: string,
  actionKey: string
): { route: ResourceRouteReference; action: ResourceRouteAction } | undefined {
  const route = getRouteReference(routeKey);
  const action = route?.actions.find((entry) => entry.key === actionKey);

  if (!route || !action) {
    return undefined;
  }

  return {
    route,
    action
  };
}

function createRouteActionInvocation(
  routeKey: string,
  actionKey: string,
  input: Record<string, unknown>,
  context: Record<string, unknown>
): {
  route: ResourceRouteReference;
  action: ResourceRouteAction;
  input: Record<string, unknown>;
  relationContext?: Record<string, unknown> & {
    sourceResourceKey: string;
    sourceRelationKey: string;
  };
} {
  const route = getRouteReference(routeKey);

  if (!route) {
    throw new Error(\`Unknown route "\${routeKey}".\`);
  }

  const routeAction = getRouteAction(routeKey, actionKey);

  if (!routeAction) {
    throw new Error(\`Unknown action "\${actionKey}" on route "\${routeKey}".\`);
  }

  const relationContext:
    | (Record<string, unknown> & {
        sourceResourceKey: string;
        sourceRelationKey: string;
      })
    | undefined =
    route.sourceResourceKey && route.sourceRelationKey
      ? {
          sourceResourceKey: route.sourceResourceKey,
          sourceRelationKey: route.sourceRelationKey,
          ...context
        }
      : undefined;
  const sourceRecordId = relationContext?.["sourceRecordId"];

  if (relationContext && (typeof sourceRecordId !== "string" || !sourceRecordId.trim())) {
    throw new Error(
      \`Route action "\${routeKey}" requires context.sourceRecordId for the "\${route.sourceResourceKey}.\${route.sourceRelationKey}" relation.\`
    );
  }

  return {
    route,
    action: routeAction.action,
    input: {
      ...input,
      _capstanRoute: {
        routeKey: route.key,
        actionKey: routeAction.action.key,
        path: route.path,
        kind: route.kind,
        resourceKey: route.resourceKey,
        ...(route.sourceResourceKey ? { sourceResourceKey: route.sourceResourceKey } : {}),
        ...(route.sourceRelationKey ? { sourceRelationKey: route.sourceRelationKey } : {})
      },
      ...(relationContext ? { _capstanRelation: relationContext } : {})
    },
    ...(relationContext ? { relationContext } : {})
  };
}

export async function executeAction(
  routeKey: string,
  actionKey: string,
  input: Record<string, unknown> = {},
  context: Record<string, unknown> = {}
): Promise<CapabilityExecutionResult> {
  const invocation = createRouteActionInvocation(routeKey, actionKey, input, context);
  return execute(invocation.action.key, invocation.input);
}

export async function startTaskAction(
  routeKey: string,
  actionKey: string,
  input: Record<string, unknown> = {},
  context: Record<string, unknown> = {}
): Promise<TaskRun> {
  const invocation = createRouteActionInvocation(routeKey, actionKey, input, context);
  const taskKey = invocation.action.taskStart?.task.key ?? invocation.action.task;

  if (!taskKey) {
    throw new Error(\`Route action "\${actionKey}" on route "\${routeKey}" is not linked to a task.\`);
  }

  return startTask(taskKey, invocation.input);
}

export function task(key: string): TaskResult {
  const taskDefinition = getTask(key);

  if (!taskDefinition) {
    throw new Error(\`Unknown task "\${key}".\`);
  }

  const matchingCapabilities = capabilities.filter((capability) => capability.task === key);
  const linkedArtifacts = (taskDefinition.artifacts ?? [])
    .map((artifactKey) => getArtifact(artifactKey))
    .filter((artifact): artifact is ArtifactDefinition => Boolean(artifact));
  const runs = listTaskRuns(key);

  return {
    task: taskDefinition,
    status: resolveTaskStatus(taskDefinition, runs[0]),
    capabilities: matchingCapabilities,
    artifacts: linkedArtifacts,
    runCount: runs.length,
    ...optionalProperty("workflowAttention", createWorkflowAttentionSummary(key)),
    ...(runs[0] ? { latestRun: runs[0] } : {})
  };
}

export function artifact(key: string): ArtifactResult {
  const artifactDefinition = getArtifact(key);

  if (!artifactDefinition) {
    throw new Error(\`Unknown artifact "\${key}".\`);
  }

  const producingTasks = tasks.filter((task) => (task.artifacts ?? []).includes(key));
  const producingTaskKeys = new Set(producingTasks.map((task) => task.key));
  const producingCapabilities = capabilities.filter((capability) =>
    capability.task ? producingTaskKeys.has(capability.task) : false
  );
  const records = listArtifactRecords(key);

  return {
    artifact: artifactDefinition,
    tasks: producingTasks,
    capabilities: producingCapabilities,
    records,
    ...(records[0] ? { latestRecord: records[0] } : {})
  };
}

export function getTaskRun(id: string): TaskRun | undefined {
  return taskRuns.get(id);
}

export function listTaskRuns(taskKey?: string): TaskRun[] {
  const runs = Array.from(taskRuns.values());

  return runs
    .filter((run) => (taskKey ? run.taskKey === taskKey : true))
    .sort((left, right) => taskRunSequenceValue(right) - taskRunSequenceValue(left));
}

export function getArtifactRecord(id: string): ArtifactRecord | undefined {
  return artifactRecords.get(id);
}

export function listArtifactRecords(artifactKey?: string): ArtifactRecord[] {
  return Array.from(artifactRecords.values())
    .filter((record) => (artifactKey ? record.artifactKey === artifactKey : true))
    .sort((left, right) => artifactRecordSequenceValue(right) - artifactRecordSequenceValue(left));
}

function taskCapability(key: string): CapabilityDefinition | undefined {
  return capabilities.find((entry) => entry.task === key);
}

function workflowRunStatus(run: TaskRun): WorkflowRun["status"] {
  return run.status === "pending" ? "running" : run.status;
}

function workflowRunNextAction(status: WorkflowRun["status"]): WorkflowNextAction {
  switch (status) {
    case "running":
      return "continue";
    case "paused":
      return "resume";
    case "approval_required":
      return "await_approval";
    case "input_required":
      return "await_input";
    case "failed":
      return "retry";
    case "blocked":
      return "resolve_block";
    case "completed":
      return "inspect_output";
    case "cancelled":
      return "review_cancellation";
  }
}

function workflowRunTransitions(run: TaskRun): WorkflowTransition[] {
  const capability = getCapability(run.capabilityKey);
  const transitions = createWorkflowTransitions(capability?.input ?? {});

  switch (workflowRunStatus(run)) {
    case "approval_required":
      return transitions.filter((transition) =>
        transition.key === "approve" || transition.key === "cancel"
      );
    case "input_required":
      return transitions.filter((transition) =>
        transition.key === "provideInput" || transition.key === "cancel"
      );
    case "failed":
    case "blocked":
      return transitions.filter((transition) =>
        transition.key === "retry" || transition.key === "cancel"
      );
    case "cancelled":
      return transitions.filter((transition) => transition.key === "retry");
    case "running":
    case "paused":
    case "completed":
      return [];
  }
}

function workflowCheckpoint(
  run: TaskRun
): WorkflowRun["activeCheckpoint"] | undefined {
  if (run.status === "approval_required") {
    return {
      type: "approval",
      ...optionalProperty("note", run.result?.note)
    };
  }

  if (run.status === "input_required") {
    return {
      type: "input",
      ...optionalProperty("note", run.result?.note)
    };
  }

  return undefined;
}

function workflowRoute(
  run: TaskRun
): WorkflowRun["route"] | undefined {
  return isRecordValue(run.input._capstanRoute)
    ? (run.input._capstanRoute as WorkflowRun["route"])
    : undefined;
}

function workflowRelation(
  run: TaskRun
): WorkflowRun["relation"] | undefined {
  return isRecordValue(run.input._capstanRelation)
    ? (run.input._capstanRelation as Record<string, unknown>)
    : undefined;
}

function createWorkflowRunSnapshot(run: TaskRun): WorkflowRun {
  const taskDefinition = getTask(run.taskKey);
  const capability = getCapability(run.capabilityKey);

  if (!taskDefinition) {
    throw new Error(\`Unknown task "\${run.taskKey}" for workflow run "\${run.id}".\`);
  }

  if (!capability) {
    throw new Error(
      \`Unknown capability "\${run.capabilityKey}" for workflow run "\${run.id}".\`
    );
  }

  const status = workflowRunStatus(run);

  return {
    id: run.id,
    status,
    nextAction: workflowRunNextAction(status),
    attempt: run.attempt,
    task: {
      key: taskDefinition.key,
      title: taskDefinition.title,
      kind: taskDefinition.kind,
      artifactKeys: taskDefinition.artifacts ?? []
    },
    capability: {
      key: capability.key,
      title: capability.title
    },
    ...optionalProperty("route", workflowRoute(run)),
    ...optionalProperty("relation", workflowRelation(run)),
    ...optionalProperty("activeCheckpoint", workflowCheckpoint(run)),
    availableTransitions: workflowRunTransitions(run),
    input: run.input,
    artifacts: run.artifacts,
    ...optionalProperty("result", run.result),
    ...optionalProperty("error", run.error),
    updatedAt: run.updatedAt
  };
}

function mergeWorkflowInput(
  currentInput: Record<string, unknown>,
  nextInput: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...currentInput,
    ...nextInput,
    ...(currentInput._capstanRoute !== undefined
      ? { _capstanRoute: currentInput._capstanRoute }
      : {}),
    ...(currentInput._capstanRelation !== undefined
      ? { _capstanRelation: currentInput._capstanRelation }
      : {})
  };
}

async function executeTaskRunAttempt(
  run: TaskRun,
  input: Record<string, unknown>,
  options: { incrementAttempt?: boolean } = {}
): Promise<TaskRun> {
  const taskDefinition = getTask(run.taskKey);
  const capability = getCapability(run.capabilityKey);

  if (!taskDefinition) {
    throw new Error(\`Unknown task "\${run.taskKey}".\`);
  }

  if (!capability) {
    throw new Error(\`Unknown capability "\${run.capabilityKey}".\`);
  }

  const { result: _previousResult, error: _previousError, ...runWithoutOutcome } = run;
  const running = persistTaskRun({
    ...runWithoutOutcome,
    status: "running",
    attempt: options.incrementAttempt ? run.attempt + 1 : run.attempt,
    input,
    artifacts: [],
    updatedAt: new Date().toISOString()
  });

  try {
    const result = await execute(capability.key, input);
    const runStatus = resolveTaskRunStatus(result);
    const linkedArtifactRecords =
      runStatus === "completed"
        ? createArtifactRecords(taskDefinition, capability.key, running.id, result)
        : [];

    return persistTaskRun({
      ...running,
      status: runStatus,
      artifacts: linkedArtifactRecords,
      result,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return persistTaskRun({
      ...running,
      status: "failed",
      artifacts: [],
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString()
    });
  }
}

export function getWorkflowRun(id: string): WorkflowRun {
  const run = getTaskRun(id);

  if (!run) {
    throw new Error(\`Unknown workflow run "\${id}".\`);
  }

  return createWorkflowRunSnapshot(run);
}

function workflowNeedsAttention(status: WorkflowStatus): boolean {
  return (
    status === "paused" ||
    status === "approval_required" ||
    status === "input_required" ||
    status === "failed" ||
    status === "blocked" ||
    status === "cancelled"
  );
}

function toWorkflowAttentionRunSummary(run: WorkflowRun): WorkflowAttentionRunSummary {
  return {
    id: run.id,
    status: run.status as WorkflowAttentionStatus,
    nextAction: run.nextAction,
    attempt: run.attempt,
    updatedAt: run.updatedAt,
    ...optionalProperty("route", run.route)
  };
}

function createWorkflowAttentionSummaryFromRuns(
  attentionRuns: WorkflowRun[],
  options: { includeRuns?: boolean; queueFilter?: AttentionItemFilter } = {}
): WorkflowAttentionSummary {
  const statusCounts = attentionRuns.reduce<WorkflowAttentionSummary["statusCounts"]>((counts, run) => {
    const status = run.status as WorkflowAttentionStatus;
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const latestRun = attentionRuns[0];

  return {
    openCount: attentionRuns.length,
    statusCounts,
    ...optionalProperty(
      "latestRun",
      latestRun ? toWorkflowAttentionRunSummary(latestRun) : undefined
    ),
    ...optionalProperty(
      "runs",
      options.includeRuns ? attentionRuns.map((run) => toWorkflowAttentionRunSummary(run)) : undefined
    ),
    ...optionalProperty(
      "queues",
      options.queueFilter ? listAttentionQueues(options.queueFilter) : undefined
    )
  };
}

function createWorkflowAttentionSummary(taskKey: string): WorkflowAttentionSummary | undefined {
  const taskDefinition = getTask(taskKey);

  if (!taskDefinition || taskDefinition.kind !== "durable") {
    return undefined;
  }

  return createWorkflowAttentionSummaryFromRuns(
    listWorkflowRuns({
      taskKey,
      attentionOnly: true
    }),
    {
      queueFilter: {
        taskKey
      }
    }
  );
}

function workflowRunMatchesResourceKey(run: WorkflowRun, resourceKey: string): boolean {
  const route = run.route;

  if (!route) {
    return false;
  }

  return route.resourceKey === resourceKey || route.sourceResourceKey === resourceKey;
}

function createResourceWorkflowAttentionSummary(resourceKey: string): WorkflowAttentionSummary {
  return createWorkflowAttentionSummaryFromRuns(
    listWorkflowRuns({
      attentionOnly: true
    }).filter((run) => workflowRunMatchesResourceKey(run, resourceKey)),
    {
      includeRuns: true,
      queueFilter: {
        resourceKey
      }
    }
  );
}

const attentionQueueStatusOrder: readonly AttentionItemStatus[] = [
  "approval_required",
  "input_required",
  "blocked",
  "failed",
  "paused",
  "cancelled"
];

function toAttentionItem(run: WorkflowRun): AttentionItem {
  return {
    kind: "workflow_run",
    id: run.id,
    status: run.status as AttentionItemStatus,
    nextAction: run.nextAction,
    attempt: run.attempt,
    updatedAt: run.updatedAt,
    task: run.task,
    capability: run.capability,
    availableTransitions: run.availableTransitions,
    ...optionalProperty("route", run.route),
    ...optionalProperty("relation", run.relation),
    ...optionalProperty("activeCheckpoint", run.activeCheckpoint)
  };
}

export function listWorkflowRuns(filter: WorkflowRunFilter = {}): WorkflowRun[] {
  return listTaskRuns(filter.taskKey)
    .map((run) => createWorkflowRunSnapshot(run))
    .filter((run) => {
      if (filter.routeKey && run.route?.routeKey !== filter.routeKey) {
        return false;
      }

      if (filter.actionKey && run.route?.actionKey !== filter.actionKey) {
        return false;
      }

      if (filter.status && run.status !== filter.status) {
        return false;
      }

      if (filter.attentionOnly && !workflowNeedsAttention(run.status)) {
        return false;
      }

      return true;
    });
}

export function listAttentionItems(filter: AttentionItemFilter = {}): AttentionItem[] {
  return listWorkflowRuns({
    ...(filter.taskKey ? { taskKey: filter.taskKey } : {}),
    ...(filter.routeKey ? { routeKey: filter.routeKey } : {}),
    ...(filter.actionKey ? { actionKey: filter.actionKey } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    attentionOnly: true
  })
    .filter((run) =>
      filter.resourceKey ? workflowRunMatchesResourceKey(run, filter.resourceKey) : true
    )
    .map((run) => toAttentionItem(run));
}

export function listAttentionQueues(filter: AttentionItemFilter = {}): AttentionQueue[] {
  const { status: _status, ...baseFilter } = filter;
  const items = listAttentionItems(filter);

  return attentionQueueStatusOrder.flatMap((status) => {
    const matchingItems = items.filter((item) => item.status === status);

    if (!matchingItems.length) {
      return [];
    }

    return [
      {
        status,
        openCount: matchingItems.length,
        filter: {
          ...baseFilter,
          status
        },
        ...optionalProperty("latestItem", matchingItems[0])
      }
    ];
  });
}

export async function advanceWorkflowRun(
  id: string,
  action: WorkflowTransitionAction,
  input: Record<string, unknown> = {},
  _note?: string
): Promise<WorkflowRun> {
  const run = getTaskRun(id);

  if (!run) {
    throw new Error(\`Unknown workflow run "\${id}".\`);
  }

  let updated: TaskRun;

  switch (action) {
    case "approve":
      if (run.status !== "approval_required") {
        throw new Error(
          \`Workflow run "\${id}" cannot be approved from status "\${run.status}".\`
        );
      }

      updated = await executeTaskRunAttempt(run, mergeWorkflowInput(run.input, input));
      break;
    case "provideInput":
      if (run.status !== "input_required") {
        throw new Error(
          \`Workflow run "\${id}" cannot accept input from status "\${run.status}".\`
        );
      }

      updated = await executeTaskRunAttempt(run, mergeWorkflowInput(run.input, input));
      break;
    case "retry":
      if (!["failed", "cancelled", "blocked"].includes(run.status)) {
        throw new Error(
          \`Workflow run "\${id}" cannot be retried from status "\${run.status}".\`
        );
      }

      updated = await executeTaskRunAttempt(run, mergeWorkflowInput(run.input, input), {
        incrementAttempt: true
      });
      break;
    case "cancel":
      if (run.status === "completed" || run.status === "cancelled") {
        throw new Error(
          \`Workflow run "\${id}" cannot be cancelled from status "\${run.status}".\`
        );
      }

      updated = persistTaskRun({
        ...run,
        status: "cancelled",
        updatedAt: new Date().toISOString()
      });
      break;
    default: {
      const exhaustive: never = action;
      throw new Error(\`Unsupported workflow action "\${String(exhaustive)}".\`);
    }
  }

  return createWorkflowRunSnapshot(updated);
}

export async function startTask(
  key: string,
  input: Record<string, unknown> = {}
): Promise<TaskRun> {
  const taskDefinition = getTask(key);

  if (!taskDefinition) {
    throw new Error(\`Unknown task "\${key}".\`);
  }

  const capability = taskCapability(key);

  if (!capability) {
    throw new Error(\`Task "\${key}" is not linked to an executable capability.\`);
  }

  const timestamp = new Date().toISOString();
  let run = persistTaskRun({
    id: nextTaskRunId(),
    taskKey: key,
    capabilityKey: capability.key,
    status: "pending",
    attempt: 1,
    input,
    artifacts: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return executeTaskRunAttempt(run, input);
}

export async function execute(
  key: string,
  input: Record<string, unknown> = {}
): Promise<CapabilityExecutionResult> {
  const handler = capabilityHandlers[key as keyof typeof capabilityHandlers];

  if (!handler) {
    throw new Error(\`Unknown capability "\${key}".\`);
  }

  return handler(input);
}

export const controlPlane = {
  domain: ${JSON.stringify(graph.domain.key)},
  resource,
  search,
  listAttentionItems,
  listAttentionQueues,
  executeAction,
  startTaskAction,
  task,
  artifact,
  startTask,
  getTaskRun,
  listTaskRuns,
  listWorkflowRuns,
  getWorkflowRun,
  advanceWorkflowRun,
  getArtifactRecord,
  listArtifactRecords,
  execute,
  getResource,
  getCapability,
  getTask,
  getArtifact
} as const;
`;
}

function createGeneratedReleaseContract(graph: AppGraph) {
  return {
    version: 1 as const,
    domain: graph.domain,
    application: {
      key: `${graph.domain.key}.app`,
      title: `${graph.domain.title} Release Contract`,
      generatedBy: "capstan" as const
    },
    environments: [
      {
        key: "preview",
        title: "Preview Environment",
        strategy: "ephemeral" as const,
        baseUrl: "http://localhost:3000",
        variables: [
          {
            key: "NODE_ENV",
            title: "Node Environment",
            description: "Controls runtime mode for preview builds.",
            required: true,
            defaultValue: "production"
          },
          {
            key: "PORT",
            title: "Preview Port",
            description: "Port used to expose preview infrastructure.",
            required: false,
            defaultValue: "3000"
          }
        ],
        secrets: []
      },
      {
        key: "release",
        title: "Release Environment",
        strategy: "managed" as const,
        variables: [
          {
            key: "NODE_ENV",
            title: "Node Environment",
            description: "Controls runtime mode for release builds.",
            required: true,
            defaultValue: "production"
          }
        ],
        secrets: []
      }
    ],
    inputs: {
      environmentSnapshot: {
        path: "capstan.release-env.json",
        title: "Release Environment Snapshot",
        description:
          "Machine-readable snapshot of the variables and secret handles expected for preview and release."
      },
      migrationPlan: {
        path: "capstan.migrations.json",
        title: "Release Migration Plan",
        description:
          "Machine-readable migration status that must remain safe before preview or release can continue."
      }
    },
    artifacts: [
      {
        key: "compiledDist",
        title: "Compiled Dist Output",
        kind: "directory" as const,
        path: "dist",
        required: true
      },
      {
        key: "humanSurfaceDocument",
        title: "Human Surface HTML",
        kind: "html" as const,
        path: "human-surface.html",
        required: true
      },
      {
        key: "agentSurfaceManifest",
        title: "Agent Surface Manifest",
        kind: "json" as const,
        path: "agent-surface.json",
        required: true
      }
    ],
    healthChecks: [
      {
        key: "verifyPasses",
        title: "Capstan Verify Passes",
        kind: "verify_pass" as const,
        description: "The generated application must pass Capstan verify before promotion.",
        required: true
      },
      {
        key: "distExists",
        title: "Compiled Dist Exists",
        kind: "path_exists" as const,
        target: "dist",
        description: "The compiled dist directory must exist before preview or release.",
        required: true
      },
      {
        key: "agentManifestParses",
        title: "Agent Manifest Parses",
        kind: "json_parse" as const,
        target: "agent-surface.json",
        description: "The generated agent manifest must remain machine-readable.",
        required: true
      },
      {
        key: "humanSurfaceExists",
        title: "Human Surface Exists",
        kind: "path_exists" as const,
        target: "human-surface.html",
        description: "The generated human surface document must be present for operator preview.",
        required: true
      }
    ],
    preview: {
      steps: [
        {
          key: "verify",
          title: "Run Capstan Verify",
          command: "capstan verify . --json"
        },
        {
          key: "build",
          title: "Build Generated App",
          command: "tsc -p tsconfig.json"
        },
        {
          key: "inspectPreviewArtifacts",
          title: "Inspect Preview Artifacts",
          description: "Review human-surface.html and agent-surface.json before preview publication."
        }
      ]
    },
    release: {
      steps: [
        {
          key: "verify",
          title: "Run Capstan Verify",
          command: "capstan verify . --json"
        },
        {
          key: "build",
          title: "Build Generated App",
          command: "tsc -p tsconfig.json"
        },
        {
          key: "publishArtifacts",
          title: "Publish Compiled And Surface Artifacts",
          description: "Promote dist/, human-surface.html, and agent-surface.json to the target runtime."
        },
        {
          key: "confirmHealth",
          title: "Confirm Release Health",
          description: "Run the configured health checks before final promotion."
        }
      ]
    },
    rollback: {
      strategy: "restore_previous_artifacts",
      steps: [
        "Restore the previously known-good dist/ artifact bundle.",
        "Restore the previous human-surface.html and agent-surface.json projections.",
        "Rerun Capstan verify before reopening traffic."
      ]
    },
    trace: {
      captures: ["verify_report", "release_contract", "artifact_inventory", "health_results"]
    }
  };
}

function createGeneratedReleaseEnvironmentSnapshot(
  releaseContract: {
    environments: Array<{
      key: string;
      variables: Array<{ key: string; defaultValue?: string }>;
      secrets: Array<{ key: string }>;
    }>;
  }
) {
  return {
    version: 1 as const,
    environments: releaseContract.environments.map((environment) => ({
      key: environment.key,
      variables: Object.fromEntries(
        environment.variables.map((variable) => [variable.key, variable.defaultValue ?? ""])
      ),
      secrets: environment.secrets.map((secret) => secret.key)
    }))
  };
}

function createGeneratedReleaseMigrationPlan() {
  return {
    version: 1 as const,
    generatedBy: "capstan" as const,
    status: "safe" as const,
    steps: [
      {
        key: "graphProjection",
        title: "Graph Projection Schema",
        status: "applied" as const,
        description:
          "The generated graph projection is in sync with the current scaffolded schema."
      }
    ]
  };
}

function renderReleaseModule(
  releaseContract: ReturnType<typeof createGeneratedReleaseContract>,
  releaseEnvironmentSnapshot: ReturnType<typeof createGeneratedReleaseEnvironmentSnapshot>,
  releaseMigrationPlan: ReturnType<typeof createGeneratedReleaseMigrationPlan>
): string {
  return `import type {
  ReleaseContract,
  ReleaseEnvironmentSnapshot,
  ReleaseMigrationPlan
} from "../types.js";

export const releaseContract = ${serializeObject(releaseContract)} satisfies ReleaseContract;
export const releaseEnvironmentSnapshot =
  ${serializeObject(releaseEnvironmentSnapshot)} satisfies ReleaseEnvironmentSnapshot;
export const releaseMigrationPlan =
  ${serializeObject(releaseMigrationPlan)} satisfies ReleaseMigrationPlan;

export function renderReleaseContract(): string {
  return \`${JSON.stringify(releaseContract, null, 2)}\n\`;
}

export function renderReleaseEnvironmentSnapshot(): string {
  return \`${JSON.stringify(releaseEnvironmentSnapshot, null, 2)}\n\`;
}

export function renderReleaseMigrationPlan(): string {
  return \`${JSON.stringify(releaseMigrationPlan, null, 2)}\n\`;
}
`;
}

function renderAssertionsIndex(graph: AppGraph): string {
  return `import { agentSurface } from "../agent-surface/index.js";
import { artifacts } from "../artifacts/index.js";
import { capabilities } from "../capabilities/index.js";
import { controlPlane } from "../control-plane/index.js";
import { domain } from "../domain.js";
import {
  createHumanSurfaceRuntimeSnapshot,
  humanSurface
} from "../human-surface/index.js";
import { policies } from "../policies/index.js";
import { resources } from "../resources/index.js";
import { tasks } from "../tasks/index.js";
import type {
  AppAssertion,
  AppAssertionContext,
  AppAssertionResult
} from "../types.js";
import { views } from "../views/index.js";
import { customAssertions } from "./custom.js";

export interface AppAssertionRun {
  assertion: {
    key: string;
    title: string;
    source: "generated" | "custom";
  };
  result: AppAssertionResult;
}

function pass(summary: string, detail?: string): AppAssertionResult {
  return {
    status: "passed",
    summary,
    ...(detail ? { detail } : {})
  };
}

function fail(
  summary: string,
  hint: string,
  options: {
    detail?: string;
    file?: string;
  } = {}
): AppAssertionResult {
  return {
    status: "failed",
    summary,
    hint,
    ...(options.detail ? { detail: options.detail } : {}),
    ...(options.file ? { file: options.file } : {})
  };
}

const generatedAssertions = [
  {
    key: "agentSurfaceSummary",
    title: "Agent Surface Summary Matches Projections",
    source: "generated",
    run(context: AppAssertionContext): AppAssertionResult {
      const expected = {
        capabilities: context.capabilities.length,
        tasks: context.tasks.length,
        artifacts: context.artifacts.length
      };
      const received = {
        capabilities: context.agentSurface.summary?.capabilityCount ?? -1,
        tasks: context.agentSurface.summary?.taskCount ?? -1,
        artifacts: context.agentSurface.summary?.artifactCount ?? -1
      };

      if (
        expected.capabilities !== received.capabilities ||
        expected.tasks !== received.tasks ||
        expected.artifacts !== received.artifacts
      ) {
        return fail(
          "Agent surface summary counts diverged from the generated projections.",
          "Regenerate the app so the agent surface summary converges again.",
          {
            detail: \`Expected \${expected.capabilities}/\${expected.tasks}/\${expected.artifacts}, received \${received.capabilities}/\${received.tasks}/\${received.artifacts}.\`,
            file: "src/assertions/index.ts"
          }
        );
      }

      return pass("Agent surface summary matches generated capability, task, and artifact counts.");
    }
  },
  {
    key: "humanSurfaceSummary",
    title: "Human Surface Summary Matches Projections",
    source: "generated",
    run(context: AppAssertionContext): AppAssertionResult {
      const expected = {
        resources: context.resources.length,
        capabilities: context.capabilities.length,
        routes: context.humanSurface.routes?.length ?? 0
      };
      const received = {
        resources: context.humanSurface.summary?.resourceCount ?? -1,
        capabilities: context.humanSurface.summary?.capabilityCount ?? -1,
        routes: context.humanSurface.summary?.routeCount ?? -1
      };

      if (
        expected.resources !== received.resources ||
        expected.capabilities !== received.capabilities ||
        expected.routes !== received.routes
      ) {
        return fail(
          "Human surface summary counts diverged from the generated projections.",
          "Regenerate the app so the human surface summary stays aligned with the projected routes.",
          {
            detail: \`Expected \${expected.resources}/\${expected.capabilities}/\${expected.routes}, received \${received.resources}/\${received.capabilities}/\${received.routes}.\`,
            file: "src/assertions/index.ts"
          }
        );
      }

      return pass("Human surface summary matches generated resource, capability, and route counts.");
    }
  },
  {
    key: "controlPlaneDiscovery",
    title: "Control Plane Discovery Matches Runtime Registries",
    source: "generated",
    run(context: AppAssertionContext): AppAssertionResult {
      const searchResult = context.controlPlane.search("") as {
        capabilities?: unknown[];
        tasks?: unknown[];
        artifacts?: unknown[];
      };

      if (
        !Array.isArray(searchResult?.capabilities) ||
        !Array.isArray(searchResult?.tasks) ||
        !Array.isArray(searchResult?.artifacts)
      ) {
        return fail(
          "Control plane search returned an invalid discovery shape.",
          "Preserve the generated control plane discovery contract.",
          {
            file: "src/assertions/index.ts"
          }
        );
      }

      if (
        searchResult.capabilities.length !== context.capabilities.length ||
        searchResult.tasks.length !== context.tasks.length ||
        searchResult.artifacts.length !== context.artifacts.length
      ) {
        return fail(
          "Control plane search no longer exposes the full generated discovery set.",
          "Keep control plane discovery aligned with the generated registries.",
          {
            detail: \`Expected \${context.capabilities.length}/\${context.tasks.length}/\${context.artifacts.length}, received \${searchResult.capabilities.length}/\${searchResult.tasks.length}/\${searchResult.artifacts.length}.\`,
            file: "src/assertions/index.ts"
          }
        );
      }

      return pass("Control plane discovery matches the generated capability, task, and artifact registries.");
    }
  },
  {
    key: "humanSurfaceRuntimeSnapshot",
    title: "Human Surface Runtime Snapshot Covers Every Route",
    source: "generated",
    run(context: AppAssertionContext): AppAssertionResult {
      const snapshot = context.createHumanSurfaceRuntimeSnapshot();
      const routeCount = context.humanSurface.routes?.length ?? 0;
      const resultCount = Object.keys(snapshot.results ?? {}).length;
      const firstRouteKey = context.humanSurface.routes?.[0]?.key;

      if (!snapshot.activeRouteKey || (firstRouteKey && snapshot.activeRouteKey !== firstRouteKey)) {
        return fail(
          "Human surface runtime snapshot did not activate the expected default route.",
          "Keep the human surface runtime snapshot aligned with the generated route order.",
          {
            detail: \`Expected "\${firstRouteKey ?? "unknown"}", received "\${snapshot.activeRouteKey ?? "missing"}".\`,
            file: "src/assertions/index.ts"
          }
        );
      }

      if (resultCount !== routeCount) {
        return fail(
          "Human surface runtime snapshot does not track every generated route result.",
          "Keep runtime snapshot generation aligned with the projected human routes.",
          {
            detail: \`Expected \${routeCount} route results, received \${resultCount}.\`,
            file: "src/assertions/index.ts"
          }
        );
      }

      return pass("Human surface runtime snapshot covers every generated route result.");
    }
  }
] as const satisfies readonly AppAssertion[];

export const appAssertions: readonly AppAssertion[] = [
  ...generatedAssertions,
  ...customAssertions
];

export function createAppAssertionContext(): AppAssertionContext {
  return {
    domain,
    resources,
    capabilities,
    tasks,
    policies,
    artifacts,
    views,
    controlPlane: {
      search: controlPlane.search
    },
    agentSurface,
    humanSurface,
    createHumanSurfaceRuntimeSnapshot
  };
}

export async function runAppAssertions(
  context: AppAssertionContext = createAppAssertionContext()
): Promise<AppAssertionRun[]> {
  const runs: AppAssertionRun[] = [];

  for (const assertion of appAssertions) {
    try {
      const result = await assertion.run(context);
      runs.push({
        assertion: {
          key: assertion.key,
          title: assertion.title,
          source: assertion.source ?? "custom"
        },
        result
      });
    } catch (error: unknown) {
      runs.push({
        assertion: {
          key: assertion.key,
          title: assertion.title,
          source: assertion.source ?? "custom"
        },
        result: {
          status: "failed",
          summary: \`Assertion "\${assertion.key}" threw before it could complete.\`,
          detail: error instanceof Error ? error.stack ?? error.message : String(error),
          hint: "Fix the assertion runtime or simplify the assertion body before rerunning \`capstan verify\`.",
          file:
            assertion.source === "generated"
              ? "src/assertions/index.ts"
              : "src/assertions/custom.ts"
        }
      });
    }
  }

  return runs;
}
`;
}

function renderRootIndex(): string {
  return `export { domain } from "./domain.js";
export {
  agentSurface,
  agentSurfaceManifest,
  renderAgentSurfaceManifest
} from "./agent-surface/index.js";
export {
  handleAgentSurfaceHttpRequest
} from "./agent-surface/http.js";
export {
  callAgentSurfaceMcpTool,
  listAgentSurfaceMcpTools
} from "./agent-surface/mcp.js";
export {
  createAgentSurfaceA2aAdapter,
  getAgentSurfaceA2aCard,
  sendAgentSurfaceA2aMessage
} from "./agent-surface/a2a.js";
export { handleAgentSurfaceRequest } from "./agent-surface/transport.js";
export {
  humanSurface,
  humanSurfaceHtml,
  renderHumanSurfaceDocument
} from "./human-surface/index.js";
export { resources } from "./resources/index.js";
export { capabilities, capabilityHandlers } from "./capabilities/index.js";
export { tasks } from "./tasks/index.js";
export { policies } from "./policies/index.js";
export { artifacts } from "./artifacts/index.js";
export { views } from "./views/index.js";
export { controlPlane } from "./control-plane/index.js";
export {
  appAssertions,
  createAppAssertionContext,
  runAppAssertions
} from "./assertions/index.js";
export {
  releaseContract,
  releaseEnvironmentSnapshot,
  releaseMigrationPlan,
  renderReleaseContract,
  renderReleaseEnvironmentSnapshot,
  renderReleaseMigrationPlan
} from "./release/index.js";
`;
}

function serializeObject(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function normalizePackageName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_/]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "capstan-app";
}

function toIdentifier(value: string): string {
  const parts = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "unnamed";
  }

  const first = parts[0]!;
  const rest = parts.slice(1);
  const normalized = [
    first.toLowerCase(),
    ...rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
  ].join("");

  return normalized.replace(/^[^a-zA-Z_]+/, "_");
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

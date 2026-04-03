import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateFlyToml,
  generateVercelConfig,
  generateWranglerConfigWithOptions,
} from "@zauso-ai/capstan-dev";
import type {
  DeployManifest,
  DeployTargetContract,
  DockerTargetContract,
  NodeStandaloneTargetContract,
  PlatformTargetContract,
} from "./deploy-manifest.js";
import type { RouteManifest } from "@zauso-ai/capstan-router";

const CLI_PACKAGE_JSON_URL = new URL("../package.json", import.meta.url);
const require = createRequire(import.meta.url);

export const BUILD_TARGETS = [
  "node-standalone",
  "docker",
  "vercel-node",
  "vercel-edge",
  "cloudflare",
  "fly",
] as const;

export type BuildTarget = (typeof BUILD_TARGETS)[number];

export const DEPLOY_INIT_TARGETS = [
  "docker",
  "vercel-node",
  "vercel-edge",
  "cloudflare",
  "fly",
] as const;

export type DeployInitTarget = (typeof DEPLOY_INIT_TARGETS)[number];

export interface ProjectPackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  description?: string;
  packageManager?: string;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
}

export interface PortableRuntimeAssetRecord {
  body: string;
  encoding?: "utf-8" | "base64";
  contentType?: string;
}

export interface PortableRuntimeAssetMaps {
  publicAssets: Record<string, PortableRuntimeAssetRecord>;
  staticHtml: Record<string, string>;
  clientAssets: Record<string, PortableRuntimeAssetRecord>;
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".html": "text/html",
  ".htm": "text/html",
  ".txt": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".map": "application/json",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
};

const TEXT_ASSET_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".htm",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".svg",
  ".txt",
  ".xml",
]);

const PORTABLE_RUNTIME_ROOT = "/virtual/dist";

function cloneStringRecord(
  value: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entries = Object.entries(value).filter((entry) => typeof entry[1] === "string");
  return entries.length > 0 ? (Object.fromEntries(entries) as Record<string, string>) : undefined;
}

function mergeDependencyMaps(
  ...maps: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged = Object.assign({}, ...maps);
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function sortStringRecord(
  value: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => {
      if (left === right) {
        return 0;
      }
      return left < right ? -1 : 1;
    }),
  ) as Record<string, string>;
}

async function loadCliGeneratedRuntimeDeps(): Promise<Record<string, string>> {
  const raw = await readFile(CLI_PACKAGE_JSON_URL, "utf-8");
  const cliPackageJson = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
  };

  return {
    "@zauso-ai/capstan-dev":
      cliPackageJson.dependencies?.["@zauso-ai/capstan-dev"] ?? "^1.0.0-beta.8",
    picocolors: cliPackageJson.dependencies?.picocolors ?? "^1.1.1",
  };
}

export async function readProjectPackageJson(
  rootDir: string,
): Promise<ProjectPackageJson | null> {
  try {
    const raw = await readFile(join(rootDir, "package.json"), "utf-8");
    return JSON.parse(raw) as ProjectPackageJson;
  } catch {
    return null;
  }
}

export function getStandaloneOutputDir(rootDir: string): string {
  return join(rootDir, "dist", "standalone");
}

function toPortablePath(value: string): string {
  return value.split(sep).join("/");
}

function toRuntimeImportPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizePublicUrlPath(relativePath: string): string {
  const portable = toPortablePath(relativePath).replace(/^\/+/, "");
  return portable === "" ? "/" : `/${portable}`;
}

function normalizeStaticUrlPath(relativePath: string): string {
  const portable = toPortablePath(relativePath).replace(/^\/+/, "");
  if (portable === "index.html") {
    return "/";
  }
  if (portable.endsWith("/index.html")) {
    const withoutIndex = portable.slice(0, -"index.html".length).replace(/\/+$/, "");
    return withoutIndex === "" ? "/" : `/${withoutIndex}`;
  }
  return `/${portable.replace(/\.html$/, "")}`;
}

function inferContentType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function walkFilesRecursive(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFilesRecursive(fullPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readAssetRecord(filePath: string): Promise<PortableRuntimeAssetRecord> {
  const buffer = await readFile(filePath);
  const contentType = inferContentType(filePath);
  const extension = extname(filePath).toLowerCase();

  if (TEXT_ASSET_EXTENSIONS.has(extension)) {
    return {
      body: buffer.toString("utf-8"),
      encoding: "utf-8",
      contentType,
    };
  }

  return {
    body: buffer.toString("base64"),
    encoding: "base64",
    contentType,
  };
}

async function resolveReactClientDistDir(): Promise<string> {
  const candidates: string[] = [];

  try {
    const clientEntryUrl = await import.meta.resolve("@zauso-ai/capstan-react/client");
    candidates.push(dirname(fileURLToPath(clientEntryUrl)));
  } catch {
    try {
      candidates.push(dirname(require.resolve("@zauso-ai/capstan-react/client")));
    } catch {
      // Fall through to repo-relative candidates.
    }
  }

  candidates.push(
    fileURLToPath(new URL("../../react/dist/client/", import.meta.url)),
    fileURLToPath(new URL("../../../react/dist/client/", import.meta.url)),
  );

  for (const candidate of candidates) {
    try {
      const candidateStat = await readdir(candidate);
      if (candidateStat.length > 0) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Capstan React client runtime could not be resolved.");
}

function createDockerContract(baseDir: string): DockerTargetContract {
  return {
    contextDir: baseDir,
    dockerfile: `${baseDir === "." ? "" : `${baseDir}/`}Dockerfile`.replace(/^\//, ""),
    dockerIgnore: `${baseDir === "." ? "" : `${baseDir}/`}.dockerignore`.replace(/^\//, ""),
    buildCommand: `docker build -t capstan-app ${baseDir}`,
    imagePort: 3000,
  };
}

function createPlatformTargetContract(
  buildTarget: Exclude<BuildTarget, "node-standalone" | "docker">,
  baseDir: string,
): PlatformTargetContract {
  const prefix = baseDir === "." ? "" : `${baseDir}/`;

  switch (buildTarget) {
    case "vercel-node":
      return {
        runtime: "node",
        outputDir: baseDir,
        entry: `${prefix}api/index.js`,
        configFile: `${prefix}vercel.json`,
        deployCommand: "vercel deploy",
        verificationProfile: "serverless-node",
      };
    case "vercel-edge":
      return {
        runtime: "edge",
        outputDir: baseDir,
        entry: `${prefix}api/index.js`,
        configFile: `${prefix}vercel.json`,
        deployCommand: "vercel deploy",
        verificationProfile: "edge",
      };
    case "cloudflare":
      return {
        runtime: "worker",
        outputDir: baseDir,
        entry: `${prefix}worker.js`,
        configFile: `${prefix}wrangler.toml`,
        deployCommand: "wrangler deploy",
        verificationProfile: "worker",
      };
    case "fly":
      return {
        runtime: "node",
        outputDir: baseDir,
        entry: `${prefix}dist/_capstan_server.js`,
        configFile: `${prefix}fly.toml`,
        deployCommand: "fly deploy",
        verificationProfile: "multi-region-node",
      };
  }
}

export function createDeployTargetContract(
  buildTarget: BuildTarget,
): DeployTargetContract {
  return createTargetContracts("dist/standalone", buildTarget);
}

export function createProjectRootDeployTargetContract(): DeployTargetContract {
  return {
    nodeStandalone: {
      outputDir: "dist",
      packageJson: "package.json",
      installCommand: "npm install --omit=dev",
      startCommand: "capstan start",
    },
  };
}

export function createStandaloneDeployManifest(
  manifest: DeployManifest,
  buildTarget: BuildTarget,
): DeployManifest {
  return {
    ...manifest,
    targets: createTargetContracts(".", buildTarget),
  };
}

export async function createStandalonePackageJson(options: {
  projectPackageJson: ProjectPackageJson | null;
  appName: string;
}): Promise<string> {
  const { projectPackageJson, appName } = options;
  const generatedRuntimeDeps = await loadCliGeneratedRuntimeDeps();
  const runtimeDependencies = mergeDependencyMaps(
    cloneStringRecord(projectPackageJson?.dependencies),
    generatedRuntimeDeps,
  );
  const sortedRuntimeDependencies = sortStringRecord(runtimeDependencies);

  const standalonePackageJson = {
    name: `${projectPackageJson?.name ?? appName}-standalone`,
    version: projectPackageJson?.version ?? "0.1.0",
    private: true,
    type:
      projectPackageJson?.type === "commonjs"
        ? "module"
        : projectPackageJson?.type ?? "module",
    description:
      projectPackageJson?.description ??
      `${appName} standalone Capstan runtime bundle`,
    scripts: {
      start: "node ./dist/_capstan_server.js",
    },
    ...(sortedRuntimeDependencies ? { dependencies: sortedRuntimeDependencies } : {}),
    ...(projectPackageJson?.packageManager
      ? { packageManager: projectPackageJson.packageManager }
      : {}),
    ...(projectPackageJson?.engines
      ? { engines: projectPackageJson.engines }
      : {}),
  };

  return JSON.stringify(standalonePackageJson, null, 2);
}

export function createPortableRouteManifest(
  manifest: RouteManifest,
  distDir: string,
): RouteManifest {
  const relativeRootDir = toPortablePath(relative(distDir, manifest.rootDir));
  const portableRootDir =
    relativeRootDir.length > 0 && !relativeRootDir.startsWith("..")
      ? relativeRootDir
      : "app/routes";
  const rewrite = (filePath: string): string => {
    const relativeToRoot = toPortablePath(relative(manifest.rootDir, filePath));
    if (relativeToRoot.length > 0 && !relativeToRoot.startsWith("..")) {
      return toPortablePath(join(portableRootDir, relativeToRoot));
    }

    const relativeToDist = toPortablePath(relative(distDir, filePath));
    return relativeToDist.length > 0 && !relativeToDist.startsWith("..")
      ? relativeToDist
      : toPortablePath(filePath);
  };

  return {
    ...manifest,
    rootDir: portableRootDir,
    routes: manifest.routes.map((route) => ({
      ...route,
      filePath: rewrite(route.filePath),
      layouts: route.layouts.map(rewrite),
      middlewares: route.middlewares.map(rewrite),
      ...(route.loading ? { loading: rewrite(route.loading) } : {}),
      ...(route.error ? { error: rewrite(route.error) } : {}),
      ...(route.notFound ? { notFound: rewrite(route.notFound) } : {}),
    })),
  };
}

function collectManifestModulePaths(manifest: RouteManifest): string[] {
  const modulePaths = new Set<string>();
  for (const route of manifest.routes) {
    modulePaths.add(route.filePath);
    for (const layout of route.layouts) {
      modulePaths.add(layout);
    }
    for (const middleware of route.middlewares) {
      modulePaths.add(middleware);
    }
    if (route.loading) {
      modulePaths.add(route.loading);
    }
    if (route.error) {
      modulePaths.add(route.error);
    }
    if (route.notFound) {
      modulePaths.add(route.notFound);
    }
  }

  return [...modulePaths].sort();
}

export async function collectPortableRuntimeAssets(
  distDir: string,
): Promise<PortableRuntimeAssetMaps> {
  const publicAssets: Record<string, PortableRuntimeAssetRecord> = {};
  const staticHtml: Record<string, string> = {};
  const clientAssets: Record<string, PortableRuntimeAssetRecord> = {};

  const publicDir = join(distDir, "public");
  for (const filePath of await walkFilesRecursive(publicDir)) {
    const relativePath = relative(publicDir, filePath);
    publicAssets[normalizePublicUrlPath(relativePath)] = await readAssetRecord(filePath);
  }

  const staticDir = join(distDir, "static");
  for (const filePath of await walkFilesRecursive(staticDir)) {
    const relativePath = relative(staticDir, filePath);
    if (!relativePath.endsWith(".html")) {
      continue;
    }
    staticHtml[normalizeStaticUrlPath(relativePath)] = await readFile(filePath, "utf-8");
  }

  const clientDir = await resolveReactClientDistDir();
  for (const filePath of await walkFilesRecursive(clientDir)) {
    const relativePath = toPortablePath(relative(clientDir, filePath));
    if (relativePath.endsWith(".d.ts") || relativePath.endsWith(".d.ts.map")) {
      continue;
    }
    clientAssets[relativePath] = await readAssetRecord(filePath);
  }

  return {
    publicAssets,
    staticHtml,
    clientAssets,
  };
}

export async function readJsonArtifact<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf-8")) as T;
}

export function createPortableRuntimeManifestModuleSource(options: {
  manifest: RouteManifest;
  agentManifest: unknown;
  openApiSpec: unknown;
}): string {
  return [
    `export const manifest = ${JSON.stringify(options.manifest, null, 2)};`,
    `export const agentManifest = ${JSON.stringify(options.agentManifest, null, 2)};`,
    `export const openApiSpec = ${JSON.stringify(options.openApiSpec, null, 2)};`,
    "",
  ].join("\n");
}

export function createPortableRuntimeModulesModuleSource(
  manifest: RouteManifest,
  options?: {
    runtimeRoot?: string;
  },
): string {
  const runtimeRoot = options?.runtimeRoot ?? PORTABLE_RUNTIME_ROOT;
  const runtimeSourceRoot = runtimeRoot.replace(/\/+$/, "");
  const modulePaths = collectManifestModulePaths(manifest);
  const importLines: string[] = [];
  const registryLines: string[] = [];

  modulePaths.forEach((modulePath, index) => {
    const identifier = `module${index}`;
    const relativeSourcePath = toPortablePath(modulePath)
      .replace(/\.(tsx|ts)$/, ".js");
    importLines.push(`import * as ${identifier} from "../dist/${relativeSourcePath}";`);
    registryLines.push(
      `  "${toPortablePath(join(runtimeSourceRoot, modulePath))}": ${identifier},`,
    );
  });

  return [
    ...importLines,
    "",
    "export const routeModules = {",
    ...registryLines,
    "};",
    "",
  ].join("\n");
}

export function createPortableRuntimeAssetsModuleSource(
  assetMaps: PortableRuntimeAssetMaps,
): string {
  return [
    `export const publicAssets = ${JSON.stringify(assetMaps.publicAssets, null, 2)};`,
    `export const staticHtml = ${JSON.stringify(assetMaps.staticHtml, null, 2)};`,
    `export const clientAssets = ${JSON.stringify(assetMaps.clientAssets, null, 2)};`,
    "",
    "function normalizeUrlPath(urlPath) {",
    "  const normalized = (urlPath.startsWith(\"/\") ? urlPath : `/${urlPath}`).replace(/\\/+/g, \"/\");",
    "  return normalized.length > 1 && normalized.endsWith(\"/\") ? normalized.slice(0, -1) : normalized;",
    "}",
    "",
    "export function createAssetProvider() {",
    "  return {",
    "    async readStaticHtml(urlPath) {",
    "      return staticHtml[normalizeUrlPath(urlPath)] ?? null;",
    "    },",
    "    async readPublicAsset(urlPath) {",
    "      return publicAssets[normalizeUrlPath(urlPath)] ?? null;",
    "    },",
    "    async readClientAsset(assetPath) {",
    "      return clientAssets[assetPath.replace(/^\\/+/, \"\")] ?? null;",
    "    },",
    "  };",
    "}",
    "",
  ].join("\n");
}

export function createStandaloneDockerfile(): string {
  return `FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY dist ./dist

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV CAPSTAN_HOST=0.0.0.0

CMD ["node", "dist/_capstan_server.js"]
`;
}

export function createStandaloneDockerIgnore(): string {
  return `node_modules/
npm-debug.log*
`;
}

export function createProjectDockerfile(options?: {
  buildTarget?: BuildTarget;
}): string {
  const buildTarget = options?.buildTarget ?? "node-standalone";

  return `FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npx capstan build --target ${buildTarget}

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist/standalone/package.json ./package.json
RUN npm install --omit=dev

COPY --from=builder /app/dist/standalone/dist ./dist

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV CAPSTAN_HOST=0.0.0.0

CMD ["node", "dist/_capstan_server.js"]
`;
}

export function createProjectDockerIgnore(): string {
  return `node_modules/
dist/
.git/
.DS_Store
npm-debug.log*
`;
}

export function createProjectEnvExample(): string {
  return `PORT=3000
CAPSTAN_HOST=0.0.0.0
# CAPSTAN_PORT=3000
# CAPSTAN_CORS_ORIGIN=https://example.com
# CAPSTAN_MAX_BODY_SIZE=1048576
NODE_ENV=production
# DATABASE_URL=
# SESSION_SECRET=
`;
}

export function createProjectVercelConfig(
  target: "vercel-node" | "vercel-edge",
): string {
  const config = generateVercelConfig({
    runtime: target === "vercel-edge" ? "edge" : "nodejs",
    entry: "dist/standalone/api/index.js",
    buildCommand: `npx capstan build --target ${target}`,
    outputDirectory: "dist/standalone",
  });

  return `${JSON.stringify(config, null, 2)}\n`;
}

export function createStandaloneVercelConfig(
  target: "vercel-node" | "vercel-edge",
): string {
  const config = generateVercelConfig({
    runtime: target === "vercel-edge" ? "edge" : "nodejs",
    entry: "api/index.js",
    buildCommand: "npm install --omit=dev",
    outputDirectory: ".",
  });

  return `${JSON.stringify(config, null, 2)}\n`;
}

export function createProjectWranglerConfig(appName: string): string {
  return generateWranglerConfigWithOptions(appName, {
    main: "dist/standalone/worker.js",
  });
}

export function createStandaloneWranglerConfig(appName: string): string {
  return generateWranglerConfigWithOptions(appName, {
    main: "worker.js",
  });
}

export function createProjectFlyToml(appName: string): string {
  return generateFlyToml(appName);
}

export function createVercelNodeEntrySource(): string {
  return `import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildRuntimeApp, createVercelNodeHandler } from "@zauso-ai/capstan-dev";

const bundleRoot = dirname(fileURLToPath(new URL(import.meta.url)));
const standaloneRoot = resolve(bundleRoot, "..");
const distDir = join(standaloneRoot, "dist");
const manifest = JSON.parse(
  readFileSync(join(distDir, "_capstan_manifest.json"), "utf-8"),
);

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

async function loadAppConfig() {
  const candidate = join(distDir, "capstan.config.js");
  if (!existsSync(candidate)) {
    return null;
  }

  try {
    const configUrl = pathToFileURL(candidate).href;
    const configMod = await import(configUrl);
    return configMod.default ?? configMod;
  } catch {
    return null;
  }
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
  } catch {}

  return registry;
}

let handlerPromise;

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      const appConfig = await loadAppConfig();
      const authConfig = normalizeAuthConfig(appConfig);
      const policyRegistry = await loadPolicyRegistry();
      const { app } = await buildRuntimeApp({
        rootDir: distDir,
        manifest,
        mode: "production",
        host: "0.0.0.0",
        port: 3000,
        appName: appConfig?.app?.name ?? appConfig?.name ?? "capstan-app",
        appDescription: appConfig?.app?.description ?? appConfig?.description,
        publicDir: join(distDir, "public"),
        staticDir: join(distDir, "static"),
        liveReload: false,
        unknownPolicyMode: "deny",
        policyRegistry,
        ...(authConfig ? { auth: authConfig } : {}),
        ...(typeof appConfig?.findAgentByKeyPrefix === "function"
          ? { findAgentByKeyPrefix: appConfig.findAgentByKeyPrefix }
          : {}),
      });
      return createVercelNodeHandler(app);
    })();
  }

  return handlerPromise;
}

export default async function handler(req, res) {
  const runtimeHandler = await getHandler();
  return runtimeHandler(req, res);
}
`;
}

export function createPortableEdgeEntrySource(options: {
  appName: string;
  appDescription?: string;
  entryKind: "vercel-edge" | "cloudflare";
  hasConfig: boolean;
  hasPolicies: boolean;
}): string {
  const runtimeImports = options.entryKind === "cloudflare"
    ? {
        manifest: "./runtime/manifest.js",
        modules: "./runtime/modules.js",
        assets: "./runtime/assets.js",
        config: "./dist/capstan.config.js",
        policies: "./dist/app/policies/index.js",
      }
    : {
        manifest: "../runtime/manifest.js",
        modules: "../runtime/modules.js",
        assets: "../runtime/assets.js",
        config: "../dist/capstan.config.js",
        policies: "../dist/app/policies/index.js",
      };

  const maybeConfigImport = options.hasConfig
    ? `import configModule from "${runtimeImports.config}";`
    : `const configModule = null;`;
  const maybePoliciesImport = options.hasPolicies
    ? `import * as policiesModule from "${runtimeImports.policies}";`
    : `const policiesModule = null;`;

  return `import { buildPortableRuntimeApp } from "@zauso-ai/capstan-dev/runtime";
import { manifest, agentManifest, openApiSpec } from "${runtimeImports.manifest}";
import { routeModules } from "${runtimeImports.modules}";
import { createAssetProvider } from "${runtimeImports.assets}";
${maybeConfigImport}
${maybePoliciesImport}

function createEdgeHandler(app) {
  return async function handler(request) {
    return app.fetch(request);
  };
}

function createWorkerHandler(app) {
  return {
    async fetch(request, env, ctx) {
      return app.fetch(request, env, ctx);
    },
  };
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

function createPolicyRegistry() {
  const registry = new Map();
  const exportsObject = policiesModule?.default ?? policiesModule;
  if (exportsObject && typeof exportsObject === "object") {
    for (const [key, value] of Object.entries(exportsObject)) {
      if (value && typeof value === "object" && "check" in value) {
        registry.set(value.key ?? key, value);
      }
    }
  }
  return registry;
}

let runtimePromise;

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const appConfig = configModule?.default ?? configModule ?? null;
      const policyRegistry = createPolicyRegistry();
      const authConfig = normalizeAuthConfig(appConfig);
      const { app } = await buildPortableRuntimeApp({
        rootDir: "${PORTABLE_RUNTIME_ROOT}",
        manifest,
        routeModules,
        assetProvider: createAssetProvider(),
        agentManifest,
        openApiSpec,
        mode: "production",
        appName: appConfig?.app?.name ?? appConfig?.name ?? ${JSON.stringify(options.appName)},
        appDescription: appConfig?.app?.description ?? appConfig?.description ?? ${JSON.stringify(options.appDescription ?? "")},
        host: "0.0.0.0",
        port: 3000,
        unknownPolicyMode: "deny",
        ...(policyRegistry.size > 0 ? { policyRegistry } : {}),
        ...(authConfig ? { auth: authConfig } : {}),
        ...(typeof appConfig?.findAgentByKeyPrefix === "function"
          ? { findAgentByKeyPrefix: appConfig.findAgentByKeyPrefix }
          : {}),
      });
      return ${options.entryKind === "cloudflare"
        ? "createWorkerHandler(app)"
        : "createEdgeHandler(app)"};
    })();
  }

  return runtimePromise;
}

${options.entryKind === "cloudflare"
    ? `export default {
  async fetch(request, env, ctx) {
    const runtime = await getRuntime();
    return runtime.fetch(request, env, ctx);
  },
};
`
    : `export default async function handler(request) {
  const runtime = await getRuntime();
  return runtime(request);
}
`}
`;
}

export function createProjectDeploymentFiles(options: {
  target: DeployInitTarget;
  appName: string;
}): Array<{ path: string; content: string }> {
  const envExample = { path: ".env.example", content: createProjectEnvExample() };

  switch (options.target) {
    case "docker":
      return [
        { path: "Dockerfile", content: createProjectDockerfile() },
        { path: ".dockerignore", content: createProjectDockerIgnore() },
        envExample,
      ];
    case "vercel-node":
    case "vercel-edge":
      return [
        { path: "vercel.json", content: createProjectVercelConfig(options.target) },
        envExample,
      ];
    case "cloudflare":
      return [
        { path: "wrangler.toml", content: createProjectWranglerConfig(options.appName) },
        envExample,
      ];
    case "fly":
      return [
        { path: "Dockerfile", content: createProjectDockerfile({ buildTarget: "fly" }) },
        { path: ".dockerignore", content: createProjectDockerIgnore() },
        { path: "fly.toml", content: createProjectFlyToml(options.appName) },
        envExample,
      ];
  }
}

export function createStandalonePlatformFiles(options: {
  buildTarget: BuildTarget;
  appName: string;
  appDescription?: string;
  hasConfig: boolean;
  hasPolicies: boolean;
}): Array<{ path: string; content: string }> {
  switch (options.buildTarget) {
    case "docker":
      return [
        { path: "Dockerfile", content: createStandaloneDockerfile() },
        { path: ".dockerignore", content: createStandaloneDockerIgnore() },
      ];
    case "vercel-node":
      return [
        { path: "api/index.js", content: createVercelNodeEntrySource() },
        { path: "vercel.json", content: createStandaloneVercelConfig("vercel-node") },
      ];
    case "vercel-edge":
      return [
        {
          path: "api/index.js",
          content: createPortableEdgeEntrySource({
            appName: options.appName,
            entryKind: "vercel-edge",
            hasConfig: options.hasConfig,
            hasPolicies: options.hasPolicies,
            ...(options.appDescription ? { appDescription: options.appDescription } : {}),
          }),
        },
        { path: "vercel.json", content: createStandaloneVercelConfig("vercel-edge") },
      ];
    case "cloudflare":
      return [
        {
          path: "worker.js",
          content: createPortableEdgeEntrySource({
            appName: options.appName,
            entryKind: "cloudflare",
            hasConfig: options.hasConfig,
            hasPolicies: options.hasPolicies,
            ...(options.appDescription ? { appDescription: options.appDescription } : {}),
          }),
        },
        { path: "wrangler.toml", content: createStandaloneWranglerConfig(options.appName) },
      ];
    case "fly":
      return [
        { path: "Dockerfile", content: createStandaloneDockerfile() },
        { path: ".dockerignore", content: createStandaloneDockerIgnore() },
        { path: "fly.toml", content: generateFlyToml(options.appName) },
      ];
    default:
      return [];
  }
}

export function shouldEmitPortableRuntimeBundle(buildTarget: BuildTarget): boolean {
  return buildTarget === "vercel-edge" || buildTarget === "cloudflare";
}

export function getPortableRuntimeRootDir(): string {
  return PORTABLE_RUNTIME_ROOT;
}

function createTargetContracts(
  baseDir: string,
  buildTarget: BuildTarget,
): DeployTargetContract {
  const nodeStandalone: NodeStandaloneTargetContract = {
    outputDir: baseDir,
    packageJson: `${baseDir === "." ? "" : `${baseDir}/`}package.json`.replace(/^\//, ""),
    installCommand: "npm install --omit=dev",
    startCommand: "node dist/_capstan_server.js",
  };

  const contracts: DeployTargetContract = {
    nodeStandalone,
  };

  if (buildTarget === "docker" || buildTarget === "fly") {
    contracts.docker = createDockerContract(baseDir);
  }
  if (buildTarget === "vercel-node") {
    contracts.vercelNode = createPlatformTargetContract(buildTarget, baseDir);
  }
  if (buildTarget === "vercel-edge") {
    contracts.vercelEdge = createPlatformTargetContract(buildTarget, baseDir);
  }
  if (buildTarget === "cloudflare") {
    contracts.cloudflare = createPlatformTargetContract(buildTarget, baseDir);
  }
  if (buildTarget === "fly") {
    contracts.fly = createPlatformTargetContract(buildTarget, baseDir);
  }

  return contracts;
}

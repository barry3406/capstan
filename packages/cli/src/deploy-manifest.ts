import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export interface DeploymentEnvironmentVariable {
  name: string;
  required: boolean;
  description: string;
  default?: string;
}

export interface NodeStandaloneTargetContract {
  outputDir: string;
  packageJson: string;
  installCommand: string;
  startCommand: string;
}

export interface DockerTargetContract {
  contextDir: string;
  dockerfile: string;
  dockerIgnore: string;
  buildCommand: string;
  imagePort: number;
}

export interface PlatformTargetContract {
  runtime: "node" | "edge" | "worker";
  outputDir: string;
  entry: string;
  configFile: string;
  deployCommand: string;
  verificationProfile: "node" | "serverless-node" | "edge" | "worker" | "multi-region-node";
}

export interface DeployTargetContract {
  nodeStandalone?: NodeStandaloneTargetContract;
  docker?: DockerTargetContract;
  vercelNode?: PlatformTargetContract;
  vercelEdge?: PlatformTargetContract;
  cloudflare?: PlatformTargetContract;
  fly?: PlatformTargetContract;
}

export interface DeployManifest {
  schemaVersion: 1;
  createdAt: string;
  app: {
    name: string;
    description?: string;
  };
  build: {
    command: string;
    mode: "server" | "hybrid-static";
    distDir: string;
    target?:
      | "node-standalone"
      | "docker"
      | "vercel-node"
      | "vercel-edge"
      | "cloudflare"
      | "fly";
  };
  server: {
    entry: string;
    startCommand: string;
    runtimes: Array<"node" | "bun">;
    hostEnv: string[];
    portEnv: string[];
  };
  assets: {
    sourcePublicDir: string;
    outputPublicDir: string;
    publicUrlPrefix: "/";
    copied: boolean;
    staticHtmlDir: string | null;
  };
  artifacts: {
    routeManifest: string;
    agentManifest: string;
    openApiSpec: string;
    serverEntry: string;
    deployManifest: string;
    publicDir: string;
    staticDir: string | null;
  };
  environment: DeploymentEnvironmentVariable[];
  targets?: DeployTargetContract;
}

export interface CreateDeployManifestOptions {
  rootDir: string;
  distDir: string;
  appName: string;
  appDescription?: string;
  isStaticBuild: boolean;
  publicAssetsCopied: boolean;
  buildTarget?:
    | "node-standalone"
    | "docker"
    | "vercel-node"
    | "vercel-edge"
    | "cloudflare"
    | "fly";
  targets?: DeployTargetContract;
}

function toContractPath(rootDir: string, targetPath: string): string {
  const rel = relative(rootDir, targetPath) || ".";
  return rel.split(sep).join("/");
}

export function getDeployManifestPath(projectDir: string): string {
  return join(projectDir, "dist", "deploy-manifest.json");
}

export function getFallbackServerEntryPath(projectDir: string): string {
  return join(projectDir, "dist", "_capstan_server.js");
}

export function resolveServerEntryPath(
  projectDir: string,
  manifest: DeployManifest | null,
): string {
  if (manifest?.server.entry) {
    return resolve(projectDir, manifest.server.entry);
  }

  return getFallbackServerEntryPath(projectDir);
}

export async function loadDeployManifest(projectDir: string): Promise<DeployManifest | null> {
  try {
    const raw = await readFile(getDeployManifestPath(projectDir), "utf-8");
    return JSON.parse(raw) as DeployManifest;
  } catch {
    return null;
  }
}

export function createDeployManifest(
  options: CreateDeployManifestOptions,
): DeployManifest {
  const {
    rootDir,
    distDir,
    appName,
    appDescription,
    isStaticBuild,
    publicAssetsCopied,
    buildTarget,
    targets,
  } = options;
  const serverEntryPath = join(distDir, "_capstan_server.js");
  const publicDirPath = join(distDir, "public");
  const staticDirPath = join(distDir, "static");
  const deployManifestPath = getDeployManifestPath(rootDir);
  const buildCommandParts = ["capstan", "build"];
  if (isStaticBuild) {
    buildCommandParts.push("--static");
  }
  if (buildTarget) {
    buildCommandParts.push("--target", buildTarget);
  }

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    app: {
      name: appName,
      ...(appDescription ? { description: appDescription } : {}),
    },
    build: {
      command: buildCommandParts.join(" "),
      mode: isStaticBuild ? "hybrid-static" : "server",
      distDir: toContractPath(rootDir, distDir),
      ...(buildTarget ? { target: buildTarget } : {}),
    },
    server: {
      entry: toContractPath(rootDir, serverEntryPath),
      startCommand: "capstan start",
      runtimes: ["node", "bun"],
      hostEnv: ["CAPSTAN_HOST"],
      portEnv: ["CAPSTAN_PORT", "PORT"],
    },
    assets: {
      sourcePublicDir: "app/public",
      outputPublicDir: toContractPath(rootDir, publicDirPath),
      publicUrlPrefix: "/",
      copied: publicAssetsCopied,
      staticHtmlDir: isStaticBuild ? toContractPath(rootDir, staticDirPath) : null,
    },
    artifacts: {
      routeManifest: toContractPath(rootDir, join(distDir, "_capstan_manifest.json")),
      agentManifest: toContractPath(rootDir, join(distDir, "agent-manifest.json")),
      openApiSpec: toContractPath(rootDir, join(distDir, "openapi.json")),
      serverEntry: toContractPath(rootDir, serverEntryPath),
      deployManifest: toContractPath(rootDir, deployManifestPath),
      publicDir: toContractPath(rootDir, publicDirPath),
      staticDir: isStaticBuild ? toContractPath(rootDir, staticDirPath) : null,
    },
    environment: [
      {
        name: "PORT",
        required: false,
        description: "Port exposed by the deployment platform.",
        default: "3000",
      },
      {
        name: "CAPSTAN_PORT",
        required: false,
        description: "Overrides PORT for the Capstan production server.",
      },
      {
        name: "CAPSTAN_HOST",
        required: false,
        description: "Bind host for the Capstan production server.",
        default: "0.0.0.0",
      },
      {
        name: "CAPSTAN_CORS_ORIGIN",
        required: false,
        description: "Optional explicit CORS origin allowlist for production requests.",
      },
      {
        name: "CAPSTAN_MAX_BODY_SIZE",
        required: false,
        description: "Maximum allowed request body size in bytes.",
        default: "1048576",
      },
      {
        name: "NODE_ENV",
        required: false,
        description: "Set to production in deployed environments.",
        default: "production",
      },
    ],
    ...(targets ? { targets } : {}),
  };
}

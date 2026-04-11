import { describe, expect, it } from "bun:test";

import { createDeployManifest } from "../../packages/cli/src/deploy-manifest.js";
import {
  createDeployTargetContract,
  createPortableEdgeEntrySource,
  createPortableRouteManifest,
  createPortableRuntimeAssetsModuleSource,
  createPortableRuntimeManifestModuleSource,
  createPortableRuntimeModulesModuleSource,
  createProjectDeploymentFiles,
  createProjectRootDeployTargetContract,
  createProjectEnvExample,
  createProjectFlyToml,
  createProjectDockerIgnore,
  createProjectDockerfile,
  createProjectVercelConfig,
  createProjectWranglerConfig,
  createStandalonePlatformFiles,
  createStandaloneDeployManifest,
  createStandaloneDockerIgnore,
  createStandaloneDockerfile,
  createStandalonePackageJson,
  createStandaloneVercelConfig,
  createStandaloneWranglerConfig,
  createVercelNodeEntrySource,
  getPortableRuntimeRootDir,
} from "../../packages/cli/src/deploy-targets.js";
import type { RouteManifest } from "@zauso-ai/capstan-router";

const compiledManifest: RouteManifest = {
  scannedAt: "2026-04-03T00:00:00.000Z",
  rootDir: "/tmp/fixture/dist/app/routes",
  routes: [
    {
      filePath: "/tmp/fixture/dist/app/routes/index.page.js",
      type: "page",
      urlPattern: "/",
      layouts: ["/tmp/fixture/dist/app/routes/_layout.js"],
      middlewares: [],
      params: [],
      isCatchAll: false,
      componentType: "server",
      loading: "/tmp/fixture/dist/app/routes/_loading.js",
      error: "/tmp/fixture/dist/app/routes/_error.js",
    },
    {
      filePath: "/tmp/fixture/dist/app/routes/api/health.api.js",
      type: "api",
      urlPattern: "/health",
      methods: ["GET"],
      layouts: [],
      middlewares: ["/tmp/fixture/dist/app/routes/_middleware.js"],
      params: [],
      isCatchAll: false,
    },
  ],
};

describe("deploy target helpers", () => {
  it("creates a node-standalone contract rooted under dist/standalone", () => {
    expect(createDeployTargetContract("node-standalone")).toEqual({
      nodeStandalone: {
        outputDir: "dist/standalone",
        packageJson: "dist/standalone/package.json",
        installCommand: "npm install --omit=dev",
        startCommand: "node dist/_capstan_server.js",
      },
    });
  });

  it("creates a root deployment contract for plain builds without a target override", () => {
    expect(createProjectRootDeployTargetContract()).toEqual({
      nodeStandalone: {
        outputDir: "dist",
        packageJson: "package.json",
        installCommand: "npm install --omit=dev",
        startCommand: "capstan start",
      },
    });
  });

  it("creates a docker contract that reuses the standalone output as build context", () => {
    expect(createDeployTargetContract("docker")).toEqual({
      nodeStandalone: {
        outputDir: "dist/standalone",
        packageJson: "dist/standalone/package.json",
        installCommand: "npm install --omit=dev",
        startCommand: "node dist/_capstan_server.js",
      },
      docker: {
        contextDir: "dist/standalone",
        dockerfile: "dist/standalone/Dockerfile",
        dockerIgnore: "dist/standalone/.dockerignore",
        buildCommand: "docker build -t capstan-app dist/standalone",
        imagePort: 3000,
      },
    });
  });

  it("creates platform contracts for vercel, cloudflare, and fly targets", () => {
    expect(createDeployTargetContract("vercel-node").vercelNode?.entry).toBe("dist/standalone/api/index.js");
    expect(createDeployTargetContract("vercel-edge").vercelEdge?.runtime).toBe("edge");
    expect(createDeployTargetContract("cloudflare").cloudflare?.configFile).toBe("dist/standalone/wrangler.toml");
    expect(createDeployTargetContract("fly").fly?.configFile).toBe("dist/standalone/fly.toml");
    expect(createDeployTargetContract("fly").docker?.dockerfile).toBe("dist/standalone/Dockerfile");
  });

  it("creates a standalone runtime package.json with generated runtime dependencies", async () => {
    const packageJson = JSON.parse(
      await createStandalonePackageJson({
        projectPackageJson: {
          name: "fixture-app",
          version: "1.2.3",
          description: "Fixture app",
          packageManager: "npm@10.9.0",
          engines: {
            node: ">=20",
          },
          dependencies: {
            react: "^19.0.0",
          },
        },
        appName: "Fixture App",
      }),
    ) as {
      name: string;
      scripts: { start: string };
      dependencies: Record<string, string>;
      engines: Record<string, string>;
      packageManager: string;
    };

    expect(packageJson.name).toBe("fixture-app-standalone");
    expect(packageJson.scripts.start).toBe("node ./dist/_capstan_server.js");
    expect(packageJson.dependencies.react).toBe("^19.0.0");
    expect(packageJson.dependencies["@zauso-ai/capstan-dev"]).toBeTruthy();
    expect(packageJson.dependencies.picocolors).toBeTruthy();
    expect(packageJson.engines).toEqual({ node: ">=20" });
    expect(packageJson.packageManager).toBe("npm@10.9.0");
  });

  it("sorts standalone runtime dependencies deterministically", async () => {
    const packageJson = JSON.parse(
      await createStandalonePackageJson({
        projectPackageJson: {
          name: "fixture-app",
          dependencies: {
            zeta: "^1.0.0",
            alpha: "^2.0.0",
          },
        },
        appName: "Fixture App",
      }),
    ) as {
      dependencies: Record<string, string>;
    };

    expect(Object.keys(packageJson.dependencies)).toEqual([
      "@zauso-ai/capstan-dev",
      "alpha",
      "picocolors",
      "zeta",
    ]);
  });

  it("rewrites deploy target metadata when the manifest is copied into a standalone root", () => {
    const rootManifest = createDeployManifest({
      rootDir: "/tmp/fixture",
      distDir: "/tmp/fixture/dist",
      appName: "fixture-app",
      isStaticBuild: false,
      publicAssetsCopied: true,
      buildTarget: "docker",
      targets: createDeployTargetContract("docker"),
    });

    const standaloneManifest = createStandaloneDeployManifest(
      rootManifest,
      "docker",
    );

    expect(standaloneManifest.build.target).toBe("docker");
    expect(standaloneManifest.targets).toEqual({
      nodeStandalone: {
        outputDir: ".",
        packageJson: "package.json",
        installCommand: "npm install --omit=dev",
        startCommand: "node dist/_capstan_server.js",
      },
      docker: {
        contextDir: ".",
        dockerfile: "Dockerfile",
        dockerIgnore: ".dockerignore",
        buildCommand: "docker build -t capstan-app .",
        imagePort: 3000,
      },
    });
  });

  it("rewrites compiled route manifests into portable standalone paths", () => {
    const portable = createPortableRouteManifest(compiledManifest, "/tmp/fixture/dist");

    expect(portable.rootDir).toBe("app/routes");
    expect(portable.routes[0]?.filePath).toBe("app/routes/index.page.js");
    expect(portable.routes[0]?.layouts).toEqual(["app/routes/_layout.js"]);
    expect(portable.routes[0]?.loading).toBe("app/routes/_loading.js");
    expect(portable.routes[1]?.middlewares).toEqual(["app/routes/_middleware.js"]);
  });

  it("creates portable runtime helper modules for edge and worker targets", () => {
    const portableManifest = createPortableRouteManifest(compiledManifest, "/tmp/fixture/dist");
    const manifestModule = createPortableRuntimeManifestModuleSource({
      manifest: portableManifest,
      agentManifest: { name: "fixture-app" },
      openApiSpec: { openapi: "3.1.0" },
    });
    const modulesModule = createPortableRuntimeModulesModuleSource(portableManifest, {
      runtimeRoot: getPortableRuntimeRootDir(),
    });
    const assetsModule = createPortableRuntimeAssetsModuleSource({
      publicAssets: {
        "/logo.svg": {
          body: "<svg />",
          encoding: "utf-8",
          contentType: "image/svg+xml",
        },
      },
      staticHtml: {
        "/": "<html>home</html>",
      },
      clientAssets: {
        "entry.js": {
          body: "console.log('client')",
          encoding: "utf-8",
          contentType: "application/javascript",
        },
      },
    });

    expect(manifestModule).toContain('export const manifest =');
    expect(manifestModule).toContain('"app/routes/index.page.js"');
    expect(modulesModule).toContain('import * as module0 from "../dist/app/routes/');
    expect(modulesModule).toContain('"/virtual/dist/app/routes/index.page.js"');
    expect(assetsModule).toContain('export const publicAssets =');
    expect(assetsModule).toContain('normalizeUrlPath');
    expect(assetsModule).toContain('clientAssets[assetPath.replace');
  });

  it("emits stable Docker templates for standalone and project-root workflows", () => {
    const standaloneDockerfile = createStandaloneDockerfile();
    const projectDockerfile = createProjectDockerfile();
    const flyDockerfile = createProjectDockerfile({ buildTarget: "fly" });

    expect(standaloneDockerfile).toContain("RUN npm install --omit=dev");
    expect(standaloneDockerfile).toContain('CMD ["node", "dist/_capstan_server.js"]');
    expect(createStandaloneDockerIgnore()).toContain("node_modules/");

    expect(projectDockerfile).toContain("RUN npx capstan build --target node-standalone");
    expect(projectDockerfile).toContain("COPY --from=builder /app/dist/standalone/dist ./dist");
    expect(flyDockerfile).toContain("RUN npx capstan build --target fly");
    expect(createProjectDockerIgnore()).toContain("dist/");
  });

  it("emits a deploy init env example that matches the documented runtime knobs", () => {
    const envExample = createProjectEnvExample();

    expect(envExample).toContain("PORT=3000");
    expect(envExample).toContain("CAPSTAN_HOST=0.0.0.0");
    expect(envExample).toContain("# CAPSTAN_PORT=3000");
    expect(envExample).toContain("# CAPSTAN_CORS_ORIGIN=https://example.com");
    expect(envExample).toContain("# CAPSTAN_MAX_BODY_SIZE=1048576");
    expect(envExample).toContain("NODE_ENV=production");
    expect(envExample).toContain("# DATABASE_URL=");
    expect(envExample).toContain("# SESSION_SECRET=");
  });

  it("creates root deployment file sets for every supported stage-three target", () => {
    const dockerFiles = createProjectDeploymentFiles({
      target: "docker",
      appName: "fixture-app",
    });
    const vercelFiles = createProjectDeploymentFiles({
      target: "vercel-edge",
      appName: "fixture-app",
    });
    const workerFiles = createProjectDeploymentFiles({
      target: "cloudflare",
      appName: "fixture-app",
    });
    const flyFiles = createProjectDeploymentFiles({
      target: "fly",
      appName: "fixture-app",
    });

    expect(dockerFiles.map((file) => file.path)).toEqual([
      "Dockerfile",
      ".dockerignore",
      ".env.example",
    ]);
    expect(vercelFiles.map((file) => file.path)).toEqual([
      "vercel.json",
      ".env.example",
    ]);
    expect(workerFiles.map((file) => file.path)).toEqual([
      "wrangler.toml",
      ".env.example",
    ]);
    expect(flyFiles.map((file) => file.path)).toEqual([
      "Dockerfile",
      ".dockerignore",
      "fly.toml",
      ".env.example",
    ]);
  });

  it("creates standalone platform file sets for every stage-three build target", () => {
    const vercelNodeFiles = createStandalonePlatformFiles({
      buildTarget: "vercel-node",
      appName: "fixture-app",
      hasConfig: true,
      hasPolicies: true,
    });
    const vercelEdgeFiles = createStandalonePlatformFiles({
      buildTarget: "vercel-edge",
      appName: "fixture-app",
      appDescription: "Fixture App",
      hasConfig: true,
      hasPolicies: true,
    });
    const workerFiles = createStandalonePlatformFiles({
      buildTarget: "cloudflare",
      appName: "fixture-app",
      hasConfig: false,
      hasPolicies: false,
    });
    const flyFiles = createStandalonePlatformFiles({
      buildTarget: "fly",
      appName: "fixture-app",
      hasConfig: true,
      hasPolicies: true,
    });

    expect(vercelNodeFiles.map((file) => file.path)).toEqual([
      "api/index.js",
      "vercel.json",
    ]);
    expect(vercelEdgeFiles.map((file) => file.path)).toEqual([
      "api/index.js",
      "vercel.json",
    ]);
    expect(workerFiles.map((file) => file.path)).toEqual([
      "worker.js",
      "wrangler.toml",
    ]);
    expect(flyFiles.map((file) => file.path)).toEqual([
      "Dockerfile",
      ".dockerignore",
      "fly.toml",
    ]);
  });

  it("emits platform configs and entry templates with the correct target wiring", () => {
    expect(createProjectVercelConfig("vercel-node")).toContain('"dist/standalone/api/index.js"');
    expect(createStandaloneVercelConfig("vercel-edge")).toContain('"runtime": "edge"');
    expect(createProjectWranglerConfig("fixture-app")).toContain('main = "dist/standalone/worker.js"');
    expect(createStandaloneWranglerConfig("fixture-app")).toContain('main = "worker.js"');
    expect(createProjectFlyToml("fixture-app")).toContain('app = "fixture-app"');
    expect(createVercelNodeEntrySource()).toContain('createVercelNodeHandler');

    const edgeEntry = createPortableEdgeEntrySource({
      appName: "fixture-app",
      appDescription: "Fixture App",
      entryKind: "vercel-edge",
      hasConfig: true,
      hasPolicies: true,
    });
    const workerEntry = createPortableEdgeEntrySource({
      appName: "fixture-app",
      entryKind: "cloudflare",
      hasConfig: false,
      hasPolicies: false,
    });

    expect(edgeEntry).toContain('buildPortableRuntimeApp');
    expect(edgeEntry).toContain('import configModule from "../dist/capstan.config.js";');
    expect(edgeEntry).toContain('createEdgeHandler(app)');
    expect(workerEntry).toContain('export default {');
    expect(workerEntry).toContain('const configModule = null;');
  });
});

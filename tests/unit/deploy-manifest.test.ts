import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDeployManifest,
  getDeployManifestPath,
  getFallbackServerEntryPath,
  loadDeployManifest,
  resolveServerEntryPath,
} from "../../packages/cli/src/deploy-manifest.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "capstan-deploy-manifest-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("deploy manifest helpers", () => {
  it("creates a server-mode deploy manifest with root static asset contract", () => {
    const manifest = createDeployManifest({
      rootDir: tempDir,
      distDir: join(tempDir, "dist"),
      appName: "phase-one-app",
      appDescription: "Deployment contract fixture",
      isStaticBuild: false,
      publicAssetsCopied: true,
    });

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.app).toEqual({
      name: "phase-one-app",
      description: "Deployment contract fixture",
    });
    expect(manifest.build).toEqual({
      command: "capstan build",
      mode: "server",
      distDir: "dist",
    });
    expect(manifest.server).toEqual({
      entry: "dist/_capstan_server.js",
      startCommand: "capstan start",
      runtimes: ["node", "bun"],
      hostEnv: ["CAPSTAN_HOST"],
      portEnv: ["CAPSTAN_PORT", "PORT"],
    });
    expect(manifest.assets).toEqual({
      sourcePublicDir: "app/public",
      outputPublicDir: "dist/public",
      publicUrlPrefix: "/",
      copied: true,
      staticHtmlDir: null,
    });
    expect(manifest.artifacts).toEqual({
      routeManifest: "dist/_capstan_manifest.json",
      agentManifest: "dist/agent-manifest.json",
      openApiSpec: "dist/openapi.json",
      serverEntry: "dist/_capstan_server.js",
      deployManifest: "dist/deploy-manifest.json",
      publicDir: "dist/public",
      staticDir: null,
    });
    expect(manifest.environment.map((entry) => entry.name)).toEqual([
      "PORT",
      "CAPSTAN_PORT",
      "CAPSTAN_HOST",
      "CAPSTAN_CORS_ORIGIN",
      "CAPSTAN_MAX_BODY_SIZE",
      "NODE_ENV",
    ]);
    expect(new Date(manifest.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("creates a hybrid-static deploy manifest when build uses --static", () => {
    const manifest = createDeployManifest({
      rootDir: tempDir,
      distDir: join(tempDir, "dist"),
      appName: "hybrid-app",
      isStaticBuild: true,
      publicAssetsCopied: false,
    });

    expect(manifest.build.command).toBe("capstan build --static");
    expect(manifest.build.mode).toBe("hybrid-static");
    expect(manifest.assets.copied).toBe(false);
    expect(manifest.assets.staticHtmlDir).toBe("dist/static");
    expect(manifest.artifacts.staticDir).toBe("dist/static");
  });

  it("returns canonical manifest and fallback paths under dist", () => {
    expect(getDeployManifestPath(tempDir)).toBe(join(tempDir, "dist", "deploy-manifest.json"));
    expect(getFallbackServerEntryPath(tempDir)).toBe(join(tempDir, "dist", "_capstan_server.js"));
  });

  it("loads a deploy manifest from disk and resolves the server entry from it", async () => {
    const distDir = join(tempDir, "dist");
    await mkdir(distDir, { recursive: true });

    const manifest = createDeployManifest({
      rootDir: tempDir,
      distDir,
      appName: "loaded-app",
      isStaticBuild: false,
      publicAssetsCopied: true,
    });

    await writeFile(getDeployManifestPath(tempDir), JSON.stringify(manifest, null, 2), "utf-8");

    const loaded = await loadDeployManifest(tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.app.name).toBe("loaded-app");
    expect(resolveServerEntryPath(tempDir, loaded)).toBe(join(tempDir, "dist", "_capstan_server.js"));
  });

  it("falls back cleanly when the deploy manifest is missing or malformed", async () => {
    expect(await loadDeployManifest(tempDir)).toBeNull();
    expect(resolveServerEntryPath(tempDir, null)).toBe(join(tempDir, "dist", "_capstan_server.js"));

    await mkdir(join(tempDir, "dist"), { recursive: true });
    await writeFile(getDeployManifestPath(tempDir), "{not-json", "utf-8");

    expect(await loadDeployManifest(tempDir)).toBeNull();
    expect(resolveServerEntryPath(tempDir, null)).toBe(join(tempDir, "dist", "_capstan_server.js"));
  });
});

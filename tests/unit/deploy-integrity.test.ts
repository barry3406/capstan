import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDeployManifest } from "../../packages/cli/src/deploy-manifest.js";
import {
  buildDeployManifestIntegrity,
  compareDeployManifestIntegrity,
  loadDeployManifestContract,
} from "../../packages/cli/src/deploy-integrity.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "capstan-deploy-integrity-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeCoreDeployArtifacts(rootDir: string): Promise<void> {
  const distDir = join(rootDir, "dist");
  await mkdir(distDir, { recursive: true });
  await mkdir(join(distDir, "public"), { recursive: true });

  await writeFile(join(distDir, "_capstan_manifest.json"), JSON.stringify({ routes: [] }, null, 2), "utf-8");
  await writeFile(join(distDir, "agent-manifest.json"), JSON.stringify({ name: "demo" }, null, 2), "utf-8");
  await writeFile(join(distDir, "openapi.json"), JSON.stringify({ openapi: "3.1.0" }, null, 2), "utf-8");
  await writeFile(join(distDir, "_capstan_server.js"), "console.log('hello');\n", "utf-8");
  await writeFile(join(distDir, "public", "asset.txt"), "asset\n", "utf-8");
}

describe("deploy integrity helpers", () => {
  it("rejects invalid manifest schema fields before verification", async () => {
    const manifest = createDeployManifest({
      rootDir: tempDir,
      distDir: join(tempDir, "dist"),
      appName: "schema-app",
      isStaticBuild: false,
      publicAssetsCopied: false,
    });
    manifest.build.target = "spaceship" as never;

    await mkdir(join(tempDir, "dist"), { recursive: true });
    await writeFile(join(tempDir, "dist", "deploy-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

    const result = await loadDeployManifestContract(tempDir);
    expect(result.manifest).toBeNull();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid_build_target");
  });

  it("records a deterministic artifact graph with content hashes", async () => {
    const manifest = createDeployManifest({
      rootDir: tempDir,
      distDir: join(tempDir, "dist"),
      appName: "integrity-app",
      isStaticBuild: false,
      publicAssetsCopied: true,
    });
    await writeCoreDeployArtifacts(tempDir);

    const integrity = await buildDeployManifestIntegrity(tempDir, manifest);
    expect(integrity.diagnostics).toEqual([]);
    expect(integrity.integrity).toBeTruthy();
    expect(integrity.integrity!.algorithm).toBe("sha256");

    const recordedPaths = integrity.integrity!.artifactGraph.map((entry) => entry.path);
    expect(recordedPaths).toEqual([...recordedPaths].sort());
    expect(recordedPaths).toContain("dist/_capstan_server.js");
    expect(recordedPaths).toContain("dist/public");

    for (const entry of integrity.integrity!.artifactGraph) {
      expect(entry.hash.length).toBeGreaterThan(0);
      expect(entry.bytes).toBeGreaterThanOrEqual(0);
      expect(entry.dependsOn).toEqual([...entry.dependsOn].sort());
    }
  });

  it("detects tampering when the recorded artifact hash no longer matches disk", async () => {
    const manifest = createDeployManifest({
      rootDir: tempDir,
      distDir: join(tempDir, "dist"),
      appName: "tamper-app",
      isStaticBuild: false,
      publicAssetsCopied: true,
    });
    await writeCoreDeployArtifacts(tempDir);

    const integrity = await buildDeployManifestIntegrity(tempDir, manifest);
    expect(integrity.integrity).toBeTruthy();

    const manifestWithIntegrity = {
      ...manifest,
      integrity: integrity.integrity,
    };
    await writeFile(
      join(tempDir, "dist", "deploy-manifest.json"),
      JSON.stringify(manifestWithIntegrity, null, 2),
      "utf-8",
    );

    await appendFile(join(tempDir, "dist", "_capstan_server.js"), "// tampered\n", "utf-8");

    const diagnostics = await compareDeployManifestIntegrity(tempDir, manifestWithIntegrity);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain("artifact_hash_mismatch");
  });
});

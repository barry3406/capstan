import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

type PackageJson = {
  name: string;
  private?: boolean;
  main?: string;
  types?: string;
  files?: string[];
  exports?: Record<string, {
    import?: string;
    require?: string;
    types?: string;
  }>;
};

const repoRoot = process.cwd();
const packagesDir = join(repoRoot, "packages");

function readWorkspacePackageJsons(): Array<{ dir: string; manifest: PackageJson }> {
  return readdirSync(packagesDir)
    .map((entry) => join(packagesDir, entry, "package.json"))
    .filter((file) => {
      try {
        readFileSync(file, "utf8");
        return true;
      } catch {
        return false;
      }
    })
    .map((file) => ({
      dir: join(file, ".."),
      manifest: JSON.parse(readFileSync(file, "utf8")) as PackageJson,
    }));
}

function packageUsesDist(manifest: PackageJson): boolean {
  if (manifest.main?.startsWith("./dist/") || manifest.types?.startsWith("./dist/")) {
    return true;
  }

  if (!manifest.exports) {
    return false;
  }

  return Object.values(manifest.exports).some((entry) =>
    entry.import?.startsWith("./dist/")
    || entry.require?.startsWith("./dist/")
    || entry.types?.startsWith("./dist/"));
}

function hasDistArtifacts(packageDir: string): boolean {
  const distDir = join(packageDir, "dist");
  if (!existsSync(distDir)) return false;
  try {
    return readdirSync(distDir).length > 0;
  } catch {
    return false;
  }
}

describe("publish contract", () => {
  it("includes built dist artifacts for every public workspace package that exports dist entrypoints", () => {
    const candidates = readWorkspacePackageJsons()
      .filter(({ manifest }) => !manifest.private)
      .filter(({ manifest }) => packageUsesDist(manifest));

    const failures: string[] = [];

    for (const candidate of candidates) {
      if (!hasDistArtifacts(candidate.dir)) {
        failures.push(candidate.manifest.name);
      }
    }

    expect(failures).toEqual([]);
  });
});

import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type PackageJson = {
  name: string;
  private?: boolean;
  main?: string;
  types?: string;
  exports?: Record<string, {
    import?: string;
    require?: string;
    types?: string;
  }>;
};

type PackedFile = {
  path: string;
};

type PackedPackage = {
  files: PackedFile[];
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

function readPackedFiles(packageDir: string): PackedFile[] {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: packageDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [result] = JSON.parse(raw) as PackedPackage[];
  return result?.files ?? [];
}

describe("publish contract", () => {
  it(
    "includes built dist artifacts for every public workspace package that exports dist entrypoints",
    () => {
      const candidates = readWorkspacePackageJsons()
        .filter(({ manifest }) => !manifest.private)
        .filter(({ manifest }) => packageUsesDist(manifest));

      const failures: string[] = [];

      for (const candidate of candidates) {
        const packedFiles = readPackedFiles(candidate.dir);
        const includesDist = packedFiles.some((file) => file.path.startsWith("dist/"));

        if (!includesDist) {
          failures.push(candidate.manifest.name);
        }
      }

      expect(failures).toEqual([]);
    },
    20_000,
  );
});

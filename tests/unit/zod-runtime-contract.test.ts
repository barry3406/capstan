import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type PackageJson = {
  dependencies?: Record<string, string>;
};

function readPackageJson(relativePath: string): PackageJson {
  return JSON.parse(
    readFileSync(join(process.cwd(), relativePath), "utf8"),
  ) as PackageJson;
}

describe("zod runtime contract", () => {
  it("declares zod in every runtime package that imports it directly", () => {
    const runtimePackages = [
      "packages/agent/package.json",
      "packages/cli/package.json",
      "packages/core/package.json",
      "packages/dev/package.json",
    ];

    for (const packagePath of runtimePackages) {
      const pkg = readPackageJson(packagePath);
      expect(pkg.dependencies?.zod, `${packagePath} should declare zod`).toMatch(/^\^4\./);
    }
  });
});

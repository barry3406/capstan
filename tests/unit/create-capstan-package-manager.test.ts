import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  detectPackageManagerRuntime,
  runInstallCommand,
} from "../../packages/create-capstan/src/package-manager.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeScript(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

describe("create-capstan package manager runtime", () => {
  it("detects the Bun command set when running under Bun", () => {
    const runtime = detectPackageManagerRuntime(true);

    expect(runtime.installCommand.display).toBe("bun install");
    expect(runtime.installCommand.command).toBe("bun");
    expect(runtime.installCommand.args).toEqual(["install"]);
    expect(runtime.runCommand).toBe("bun run");
    expect(runtime.devCommand).toBe("bun run capstan dev");
  });

  it("detects the npm command set when running under Node.js", () => {
    const runtime = detectPackageManagerRuntime(false);

    expect(runtime.installCommand.display).toBe("npm install");
    expect(runtime.installCommand.args).toEqual(["install"]);
    expect(runtime.runCommand).toBe("npx");
    expect(runtime.devCommand).toBe("npx capstan dev");
  });

  it("runs the install command in the target project directory", async () => {
    const dir = await createTempDir("capstan-install-success-");
    const scriptPath = join(dir, "install-success.mjs");

    await writeScript(
      scriptPath,
      `import { writeFileSync } from "node:fs";
writeFileSync("install.log", process.cwd(), "utf8");
`,
    );

    await runInstallCommand(dir, {
      command: process.execPath,
      args: [scriptPath],
      display: "node install-success.mjs",
    });

    expect(await realpath(await readFile(join(dir, "install.log"), "utf8"))).toBe(await realpath(dir));
  });

  it("surfaces a useful error when the install command exits non-zero", async () => {
    const dir = await createTempDir("capstan-install-failure-");
    const scriptPath = join(dir, "install-failure.mjs");

    await writeScript(
      scriptPath,
      "process.exit(3);\n",
    );

    await expect(runInstallCommand(dir, {
      command: process.execPath,
      args: [scriptPath],
      display: "node install-failure.mjs",
    })).rejects.toThrow('Install command "node install-failure.mjs" exited with code 3.');
  });
});

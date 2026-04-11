import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

import { runBenchmarkSuite } from "../../benchmarks/harness.js";

const repoRoot = process.cwd();
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

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function runNodeScript(
  scriptPath: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  const [code] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  return {
    exitCode: code ?? 0,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

describe("meta stability gates", () => {
  it("forwards explicit targets through the Bun test wrapper", async () => {
    const tempDir = await createTempDir("capstan-meta-bun-");
    const binDir = join(tempDir, "bin");
    await mkdir(binDir, { recursive: true });

    const logFile = join(tempDir, "bun-args.json");
    const bunStub = join(binDir, "bun");

    await writeExecutable(
      bunStub,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.CAPSTAN_BUN_ARGS_LOG, JSON.stringify(process.argv.slice(2)));
process.exit(0);
`,
    );

    const scriptPath = join(repoRoot, "scripts", "run-bun-tests.mjs");
    const result = await runNodeScript(
      scriptPath,
      [
        "tests/unit/meta-stability.test.ts",
        "tests/unit/benchmark-suite.test.ts",
      ],
      {
        CAPSTAN_BUN_ARGS_LOG: logFile,
        CAPSTAN_COVERAGE: "",
        PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(await readFile(logFile, "utf8"))).toEqual([
      "test",
      "tests/unit/meta-stability.test.ts",
      "tests/unit/benchmark-suite.test.ts",
    ]);
  });

  it("stops the workspace build loop after the first failing package", async () => {
    const tempDir = await createTempDir("capstan-meta-build-");
    const binDir = join(tempDir, "bin");
    await mkdir(binDir, { recursive: true });

    const logFile = join(tempDir, "npm-calls.txt");
    const npmStub = join(binDir, "npm");

    await writeExecutable(
      npmStub,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const logFile = process.env.CAPSTAN_BUILD_LOG;
fs.appendFileSync(logFile, process.cwd() + "\\n");
if (process.cwd().includes(path.join("packages", "router"))) {
  process.exit(1);
}
process.exit(0);
`,
    );

    const scriptPath = join(repoRoot, "scripts", "run-workspace-builds.mjs");
    const result = await runNodeScript(
      scriptPath,
      [],
      {
        CAPSTAN_BUILD_LOG: logFile,
        PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Building @zauso-ai/capstan-core");
    expect(result.stdout).toContain("Building @zauso-ai/capstan-router");
    expect(result.stdout).not.toContain("Building @zauso-ai/capstan-db");
    expect(result.stderr).toContain("Build for @zauso-ai/capstan-router failed with exit code 1");

    const loggedWorkspaces = (await readFile(logFile, "utf8"))
      .trim()
      .split("\n")
      .map((workspacePath) => relative(repoRoot, workspacePath).replace(/\\/g, "/"));

    expect(loggedWorkspaces).toEqual([
      "packages/core",
      "packages/router",
    ]);
    expect(loggedWorkspaces[1]).toContain("packages/router");
  });

  it("records benchmark scenario failures without aborting the suite", async () => {
    const report = await runBenchmarkSuite({
      scenarios: [
        {
          id: "fail-fast",
          description: "scenario that throws during execution",
          group: "test",
          iterations: 1,
          samples: 1,
          warmupSamples: 0,
          run: () => {
            throw new Error("scenario exploded");
          },
        },
        {
          id: "still-runs",
          description: "scenario that should still execute",
          group: "test",
          iterations: 1,
          samples: 1,
          warmupSamples: 0,
          run: () => undefined,
        },
      ],
      budgets: {
        "still-runs": {
          maxAvgMs: 100,
          maxP95Ms: 100,
        },
      },
    });

    expect(report.failed).toBe(true);
    expect(report.results).toHaveLength(2);
    expect(report.results[0]?.status).toBe("fail");
    expect(report.results[0]?.failures).toEqual(["scenario execution failed"]);
    expect(report.results[0]?.error).toBe("scenario exploded");
    expect(report.results[1]?.status).toBe("pass");
  });
});

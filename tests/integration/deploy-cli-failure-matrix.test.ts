import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = process.cwd();
const capstanCliEntry = join(repoRoot, "packages", "cli", "src", "index.ts");

let tempDir: string;

async function runCli(
  args: string[],
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(process.execPath, [capstanCliEntry, ...args], {
    cwd: tempDir,
    env: {
      ...process.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  return {
    exitCode: code ?? 0,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "capstan-deploy-cli-failure-"));
});

afterAll(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("deploy/build CLI failure matrix", () => {
  it("rejects unsupported build targets before touching the project tree", async () => {
    const result = await runCli(["build", "--target", "spaceship"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unsupported build target "spaceship"');
    expect(result.stderr).toContain("node-standalone");
    expect(result.stderr).toContain("docker");
  });

  it("rejects unsupported deploy:init targets before generating files", async () => {
    const result = await runCli(["deploy:init", "--target", "spaceship"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unsupported deploy:init target "spaceship"');
    expect(result.stderr).toContain("docker");
  });

  it("fails fast when start is invoked without a built server entry", async () => {
    const result = await runCli(["start"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Capstan Deployment Verify");
    expect(result.stderr).toContain("Doctor");
    expect(result.stderr).toContain("dist/deploy-manifest.json is missing");
    expect(result.stderr).toContain("Run `capstan build`");
  });

  it("fails fast when start --from points at an unbuilt standalone bundle", async () => {
    const result = await runCli(["start", "--from", "dist/standalone"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Capstan Deployment Verify");
    expect(result.stderr).toContain("Doctor");
    expect(result.stderr).toContain("dist/deploy-manifest.json is missing");
    expect(result.stderr).toContain("Run `capstan build`");
  });
});

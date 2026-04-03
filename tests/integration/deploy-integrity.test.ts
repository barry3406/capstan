import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { appendFile, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scaffoldProject } from "../../packages/create-capstan/src/scaffold.ts";

const repoRoot = process.cwd();
const rootNodeModules = join(repoRoot, "node_modules");
const capstanCliEntry = join(repoRoot, "packages", "cli", "src", "index.ts");

let tempDir: string;
let projectDir: string;
let productionServer: ChildProcessWithoutNullStreams | null = null;
const productionPort = 37000 + Math.floor(Math.random() * 20000);
const PROCESS_SHUTDOWN_GRACE_MS = 4_000;

setDefaultTimeout(120_000);

async function runRepoCommand(args: string[]): Promise<void> {
  const child = spawn("npm", args, {
    cwd: repoRoot,
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
  if (code !== 0) {
    throw new Error(
      `npm ${args.join(" ")} failed with code ${code}${signal ? ` signal ${signal}` : ""}\n` +
      `STDOUT:\n${stdout.join("")}\nSTDERR:\n${stderr.join("")}`,
    );
  }
}

async function runCli(
  args: string[],
  expectedExitCode = 0,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [capstanCliEntry, ...args], {
    cwd: projectDir,
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
  const exitCode = code ?? 0;
  if (exitCode !== expectedExitCode) {
    throw new Error(
      `capstan ${args.join(" ")} failed with code ${code}${signal ? ` signal ${signal}` : ""}\n` +
      `STDOUT:\n${stdout.join("")}\nSTDERR:\n${stderr.join("")}`,
    );
  }

  return {
    exitCode,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function startProductionServer(): Promise<void> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  productionServer = spawn(
    process.execPath,
    [
      capstanCliEntry,
      "start",
      "--host",
      "127.0.0.1",
      "--port",
      String(productionPort),
    ],
    {
      cwd: projectDir,
      env: {
        ...process.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  productionServer.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  productionServer.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  const ready = waitForServer(`http://127.0.0.1:${productionPort}/health`);
  const exited = once(productionServer, "exit").then(([code, signal]) => ({
    kind: "exit" as const,
    code,
    signal,
  }));

  const outcome = await Promise.race([
    ready.then(() => ({ kind: "ready" as const })),
    exited,
  ]);

  if (outcome.kind === "exit") {
    throw new Error(
      `capstan start exited before the server became ready (code ${outcome.code}${outcome.signal ? ` signal ${outcome.signal}` : ""})\n` +
      `STDOUT:\n${stdout.join("")}\nSTDERR:\n${stderr.join("")}`,
    );
  }
}

async function stopProductionServer(): Promise<void> {
  if (!productionServer) {
    return;
  }

  if (productionServer.exitCode === null && productionServer.signalCode === null) {
    productionServer.kill("SIGTERM");
    await Promise.race([
      once(productionServer, "exit"),
      new Promise((resolve) => setTimeout(resolve, PROCESS_SHUTDOWN_GRACE_MS)),
    ]);

    if (productionServer.exitCode === null && productionServer.signalCode === null) {
      productionServer.kill("SIGKILL");
    }
  }

  productionServer = null;
}

beforeAll(async () => {
  await runRepoCommand(["run", "build", "--workspace", "@zauso-ai/capstan-core"]);
  await runRepoCommand(["run", "build", "--workspace", "@zauso-ai/capstan-router"]);
  await runRepoCommand(["run", "build", "--workspace", "@zauso-ai/capstan-react"]);
  await runRepoCommand(["run", "build", "--workspace", "@zauso-ai/capstan-agent"]);
  await runRepoCommand(["run", "build", "--workspace", "@zauso-ai/capstan-dev"]);

  tempDir = await mkdtemp(join(tmpdir(), "capstan-deploy-integrity-int-"));
  projectDir = join(tempDir, "integrity-app");
  await scaffoldProject({
    projectName: "integrity-app",
    template: "blank",
    outputDir: projectDir,
  });
  await symlink(rootNodeModules, join(projectDir, "node_modules"), "dir");
});

afterAll(async () => {
  await stopProductionServer();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("deployment integrity CLI integration", () => {
  it("records integrity metadata and rejects tampered artifacts during verify and start", async () => {
    await runCli(["build"]);

    const verifyBeforeTamper = await runCli(["verify", "--deployment", "--json"]);
    const cleanReport = JSON.parse(verifyBeforeTamper.stdout) as {
      status: string;
      summary?: { errorCount?: number; warningCount?: number };
    };

    expect(cleanReport.status).toBe("passed");
    expect(cleanReport.summary?.errorCount).toBe(0);

    await startProductionServer();

    const health = await fetch(`http://127.0.0.1:${productionPort}/health`);
    const home = await fetch(`http://127.0.0.1:${productionPort}/`);

    expect(health.status).toBe(200);
    expect((await health.json()) as { status: string }).toMatchObject({ status: "ok" });
    expect(await home.text()).toContain("Welcome to Integrity App");

    await stopProductionServer();

    const manifest = JSON.parse(
      await readFile(join(projectDir, "dist", "deploy-manifest.json"), "utf-8"),
    ) as {
      integrity?: {
        algorithm: string;
        artifactGraph: Array<{ path: string }>;
      };
    };

    expect(manifest.integrity?.algorithm).toBe("sha256");
    expect((manifest.integrity?.artifactGraph ?? []).length).toBeGreaterThan(0);

    await appendFile(join(projectDir, "dist", "_capstan_server.js"), "\n// tampered\n", "utf-8");

    const verify = await runCli(["verify", "--deployment", "--json"], 1);
    const report = JSON.parse(verify.stdout) as {
      status: string;
      diagnostics: Array<{ code: string; message: string }>;
      doctor: Array<{ title: string; reasonCodes: string[]; steps: string[] }>;
    };

    expect(report.status).toBe("failed");
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("artifact_hash_mismatch");
    expect(report.doctor.map((action) => action.title)).toContain("Regenerate tampered artifacts");

    const start = await runCli(["start"], 1);
    expect(start.stderr).toContain("Deployment Verify");
    expect(start.stderr).toContain("Doctor");
    expect(start.stderr).toContain("Regenerate tampered artifacts");
    expect(start.stderr).toContain("_capstan_server.js");
    expect(start.stderr).toContain("hash changed");
  });
});

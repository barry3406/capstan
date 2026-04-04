import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { access, copyFile, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { scaffoldProject } from "../../packages/create-capstan/src/scaffold.ts";

const repoRoot = process.cwd();
const rootNodeModules = join(repoRoot, "node_modules");
const capstanCliEntry = join(repoRoot, "packages", "cli", "src", "index.ts");

let tempDir: string;
let standaloneProjectDir: string;
let deployInitProjectDir: string;
let verificationProjectDir: string;
let scaffoldedDeployProjectDir: string;
let standaloneServer: ChildProcessWithoutNullStreams | null = null;

const standalonePort = 38000 + Math.floor(Math.random() * 10000);
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
  cwd: string,
  args: string[],
  expectedExitCode = 0,
): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [capstanCliEntry, ...args], {
    cwd,
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
  if (code !== expectedExitCode) {
    throw new Error(
      `capstan ${args.join(" ")} failed with code ${code}${signal ? ` signal ${signal}` : ""}\n` +
      `STDOUT:\n${stdout.join("")}\nSTDERR:\n${stderr.join("")}`,
    );
  }

  return {
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
}

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
      lastError = new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function startStandaloneServer(): Promise<void> {
  const child = spawn(
    process.execPath,
    [
      capstanCliEntry,
      "start",
      "--from",
      "dist/standalone",
      "--port",
      String(standalonePort),
      "--host",
      "127.0.0.1",
    ],
    {
      cwd: standaloneProjectDir,
      env: {
        ...process.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  const ready = waitForServer(`http://127.0.0.1:${standalonePort}/health`);
  const exited = once(child, "exit").then(([code, signal]) => ({
    code,
    signal,
  }));

  const outcome = await Promise.race([
    ready.then(() => ({ kind: "ready" as const })),
    exited.then((result) => ({ kind: "exit" as const, ...result })),
  ]);

  if (outcome.kind === "exit") {
    throw new Error(
      `capstan start --from dist/standalone exited before the server became ready (code ${outcome.code}${outcome.signal ? ` signal ${outcome.signal}` : ""})\n` +
      `STDOUT:\n${stdout.join("")}\nSTDERR:\n${stderr.join("")}`,
    );
  }

  standaloneServer = child;
}

async function importFresh<T>(filePath: string): Promise<T> {
  const clonedPath = filePath.replace(
    /\.js$/,
    `.${Date.now()}.${Math.floor(Math.random() * 1_000_000)}.js`,
  );
  await copyFile(filePath, clonedPath);
  return import(pathToFileURL(clonedPath).href) as Promise<T>;
}

async function invokeGeneratedVercelNodeHandler(entryPath: string, urlPath: string): Promise<{
  status: number;
  body: string;
}> {
  const mod = await importFresh<{
    default: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<void>;
  }>(entryPath);

  const { EventEmitter } = await import("node:events");
  const req = Object.assign(new EventEmitter(), {
    url: urlPath,
    method: "GET",
    headers: { host: "example.com" },
  }) as unknown as import("node:http").IncomingMessage;

  let status = 0;
  let body = "";
  const res = {
    writeHead: (nextStatus: number) => {
      status = nextStatus;
    },
    end: (data?: Buffer) => {
      body = data?.toString("utf-8") ?? "";
    },
  } as unknown as import("node:http").ServerResponse;

  await mod.default(req, res);
  return { status, body };
}

async function invokeGeneratedFetchHandler(
  entryPath: string,
  urlPath: string,
): Promise<Response> {
  const mod = await importFresh<{ default: unknown }>(entryPath);
  const request = new Request(`http://localhost${urlPath}`);

  if (typeof mod.default === "function") {
    return (mod.default as (request: Request) => Promise<Response>)(request);
  }

  return (mod.default as {
    fetch: (
      request: Request,
      env: Record<string, unknown>,
      ctx: { waitUntil: (promise: Promise<unknown>) => void },
    ) => Promise<Response>;
  }).fetch(request, {}, { waitUntil: () => {} });
}

beforeAll(async () => {
  await runRepoCommand(["run", "build", "--workspace", "@zauso-ai/capstan-core"]);
  await runRepoCommand(["run", "build", "--workspace", "@zauso-ai/capstan-router"]);
  await runRepoCommand(["run", "build", "--workspace", "@zauso-ai/capstan-react"]);
  await runRepoCommand(["run", "build", "--workspace", "@zauso-ai/capstan-agent"]);
  await runRepoCommand(["run", "build", "--workspace", "@zauso-ai/capstan-dev"]);

  tempDir = await mkdtemp(join(tmpdir(), "capstan-deploy-targets-"));
  standaloneProjectDir = join(tempDir, "standalone-app");
  deployInitProjectDir = join(tempDir, "deploy-init-app");
  verificationProjectDir = join(tempDir, "verification-app");
  scaffoldedDeployProjectDir = join(tempDir, "scaffold-cloudflare-app");

  await scaffoldProject({
    projectName: "standalone-app",
    template: "blank",
    outputDir: standaloneProjectDir,
  });
  await scaffoldProject({
    projectName: "deploy-init-app",
    template: "blank",
    outputDir: deployInitProjectDir,
  });
  await scaffoldProject({
    projectName: "verification-app",
    template: "tickets",
    outputDir: verificationProjectDir,
  });
  await scaffoldProject({
    projectName: "scaffold-cloudflare-app",
    template: "blank",
    outputDir: scaffoldedDeployProjectDir,
    deployTarget: "cloudflare",
  });

  await symlink(rootNodeModules, join(standaloneProjectDir, "node_modules"), "dir");
  await symlink(rootNodeModules, join(deployInitProjectDir, "node_modules"), "dir");
  await symlink(rootNodeModules, join(verificationProjectDir, "node_modules"), "dir");
  await symlink(rootNodeModules, join(scaffoldedDeployProjectDir, "node_modules"), "dir");

  await runCli(standaloneProjectDir, ["build", "--target", "node-standalone"]);
  await symlink(
    rootNodeModules,
    join(standaloneProjectDir, "dist", "standalone", "node_modules"),
    "dir",
  );
});

afterAll(async () => {
  if (standaloneServer && standaloneServer.exitCode === null && standaloneServer.signalCode === null) {
    standaloneServer.kill("SIGTERM");
    await Promise.race([
      once(standaloneServer, "exit"),
      new Promise((resolve) => setTimeout(resolve, PROCESS_SHUTDOWN_GRACE_MS)),
    ]);
    if (standaloneServer.exitCode === null && standaloneServer.signalCode === null) {
      standaloneServer.kill("SIGKILL");
    }
  }

  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("deployment targets integration", () => {
  it("builds a standalone runtime bundle with target-aware manifest metadata", async () => {
    const rootManifest = JSON.parse(
      await readFile(join(standaloneProjectDir, "dist", "deploy-manifest.json"), "utf-8"),
    ) as {
      build: { target?: string };
      targets?: {
        nodeStandalone?: {
          outputDir: string;
          packageJson: string;
          startCommand: string;
        };
      };
    };
    const standaloneManifest = JSON.parse(
      await readFile(
        join(standaloneProjectDir, "dist", "standalone", "dist", "deploy-manifest.json"),
        "utf-8",
      ),
    ) as {
      targets?: {
        nodeStandalone?: {
          outputDir: string;
          packageJson: string;
          startCommand: string;
        };
      };
    };
    const standalonePackageJson = JSON.parse(
      await readFile(join(standaloneProjectDir, "dist", "standalone", "package.json"), "utf-8"),
    ) as {
      scripts: { start: string };
      dependencies: Record<string, string>;
    };

    expect(rootManifest.build.target).toBe("node-standalone");
    expect(rootManifest.targets?.nodeStandalone).toEqual({
      outputDir: "dist/standalone",
      packageJson: "dist/standalone/package.json",
      startCommand: "node dist/_capstan_server.js",
      installCommand: "npm install --omit=dev",
    });
    expect(standaloneManifest.targets?.nodeStandalone).toEqual({
      outputDir: ".",
      packageJson: "package.json",
      startCommand: "node dist/_capstan_server.js",
      installCommand: "npm install --omit=dev",
    });
    expect(standalonePackageJson.scripts.start).toBe("node ./dist/_capstan_server.js");
    expect(standalonePackageJson.dependencies["@zauso-ai/capstan-dev"]).toBeTruthy();
  });

  it("starts successfully from dist/standalone via capstan start --from", async () => {
    await startStandaloneServer();

    const health = await fetch(`http://127.0.0.1:${standalonePort}/health`);
    const home = await fetch(`http://127.0.0.1:${standalonePort}/`);
    const homeHtml = await home.text();

    expect(health.status).toBe(200);
    expect(home.status).toBe(200);
    expect((await health.json()) as { status: string }).toMatchObject({ status: "ok" });
    expect(homeHtml).toContain("Standalone App");
    expect(homeHtml).toContain("Launch deck");
  });

  it("builds a docker-ready standalone context with generated Docker assets", async () => {
    if (standaloneServer && standaloneServer.exitCode === null && standaloneServer.signalCode === null) {
      standaloneServer.kill("SIGTERM");
      await once(standaloneServer, "exit");
      standaloneServer = null;
    }

    await runCli(standaloneProjectDir, ["build", "--target", "docker"]);

    const rootManifest = JSON.parse(
      await readFile(join(standaloneProjectDir, "dist", "deploy-manifest.json"), "utf-8"),
    ) as {
      build: { target?: string };
      targets?: {
        docker?: {
          contextDir: string;
          dockerfile: string;
          dockerIgnore: string;
        };
      };
    };
    const standaloneManifest = JSON.parse(
      await readFile(
        join(standaloneProjectDir, "dist", "standalone", "dist", "deploy-manifest.json"),
        "utf-8",
      ),
    ) as {
      targets?: {
        docker?: {
          contextDir: string;
          dockerfile: string;
          dockerIgnore: string;
        };
      };
    };
    const dockerfile = await readFile(
      join(standaloneProjectDir, "dist", "standalone", "Dockerfile"),
      "utf-8",
    );

    expect(rootManifest.build.target).toBe("docker");
    expect(rootManifest.targets?.docker).toEqual({
      contextDir: "dist/standalone",
      dockerfile: "dist/standalone/Dockerfile",
      dockerIgnore: "dist/standalone/.dockerignore",
      buildCommand: "docker build -t capstan-app dist/standalone",
      imagePort: 3000,
    });
    expect(standaloneManifest.targets?.docker).toEqual({
      contextDir: ".",
      dockerfile: "Dockerfile",
      dockerIgnore: ".dockerignore",
      buildCommand: "docker build -t capstan-app .",
      imagePort: 3000,
    });
    expect(dockerfile).toContain("RUN npm install --omit=dev");
    expect(dockerfile).toContain('CMD ["node", "dist/_capstan_server.js"]');
    await access(join(standaloneProjectDir, "dist", "standalone", ".dockerignore"));

    const mismatch = await runCli(standaloneProjectDir, [
      "verify",
      "--deployment",
      "--target",
      "node-standalone",
      "--json",
    ], 1);
    const mismatchReport = JSON.parse(mismatch.stdout) as {
      status: string;
      diagnostics: Array<{ code: string }>;
    };

    expect(mismatchReport.status).toBe("failed");
    expect(mismatchReport.diagnostics.map((diagnostic) => diagnostic.code)).toContain("target_mismatch");
  });

  it("generates root Docker deployment files and requires --force before overwriting", async () => {
    await runCli(deployInitProjectDir, ["deploy:init"]);

    const dockerfile = await readFile(join(deployInitProjectDir, "Dockerfile"), "utf-8");
    const envExample = await readFile(join(deployInitProjectDir, ".env.example"), "utf-8");
    expect(dockerfile).toContain("RUN npx capstan build --target node-standalone");
    expect(envExample).toContain("PORT=3000");
    expect(envExample).toContain("CAPSTAN_HOST=0.0.0.0");
    expect(envExample).toContain("# CAPSTAN_PORT=3000");
    expect(envExample).toContain("# CAPSTAN_CORS_ORIGIN=https://example.com");
    expect(envExample).toContain("# CAPSTAN_MAX_BODY_SIZE=1048576");
    expect(envExample).toContain("NODE_ENV=production");

    const failure = await runCli(deployInitProjectDir, ["deploy:init"], 1);
    expect(failure.stderr).toContain("Refusing to overwrite existing deployment files");

    await runCli(deployInitProjectDir, ["deploy:init", "--force"]);
    await access(join(deployInitProjectDir, ".dockerignore"));
  });

  it("builds a vercel-node target with a runnable serverless entry", async () => {
    await runCli(standaloneProjectDir, ["build", "--target", "vercel-node"]);

    const rootManifest = JSON.parse(
      await readFile(join(standaloneProjectDir, "dist", "deploy-manifest.json"), "utf-8"),
    ) as {
      build: { target?: string };
      targets?: {
        vercelNode?: {
          entry: string;
          configFile: string;
        };
      };
    };
    const standaloneConfig = JSON.parse(
      await readFile(join(standaloneProjectDir, "dist", "standalone", "vercel.json"), "utf-8"),
    ) as {
      functions: Record<string, unknown>;
    };
    const result = await invokeGeneratedVercelNodeHandler(
      join(standaloneProjectDir, "dist", "standalone", "api", "index.js"),
      "/health",
    );

    expect(rootManifest.build.target).toBe("vercel-node");
    expect(rootManifest.targets?.vercelNode?.entry).toBe("dist/standalone/api/index.js");
    expect(standaloneConfig.functions["api/index.js"]).toBeTruthy();
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ status: "ok" });
  });

  it("builds a vercel-edge target with portable runtime assets", async () => {
    await runCli(standaloneProjectDir, ["build", "--target", "vercel-edge"]);

    const rootManifest = JSON.parse(
      await readFile(join(standaloneProjectDir, "dist", "deploy-manifest.json"), "utf-8"),
    ) as {
      build: { target?: string };
      targets?: {
        vercelEdge?: {
          entry: string;
        };
      };
    };
    await access(join(standaloneProjectDir, "dist", "standalone", "runtime", "manifest.js"));
    await access(join(standaloneProjectDir, "dist", "standalone", "runtime", "modules.js"));
    await access(join(standaloneProjectDir, "dist", "standalone", "runtime", "assets.js"));

    const health = await invokeGeneratedFetchHandler(
      join(standaloneProjectDir, "dist", "standalone", "api", "index.js"),
      "/health",
    );
    const home = await invokeGeneratedFetchHandler(
      join(standaloneProjectDir, "dist", "standalone", "api", "index.js"),
      "/",
    );
    const homeHtml = await home.text();

    expect(rootManifest.build.target).toBe("vercel-edge");
    expect(rootManifest.targets?.vercelEdge?.entry).toBe("dist/standalone/api/index.js");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });
    expect(homeHtml).toContain("Standalone App");
    expect(homeHtml).toContain("Launch deck");
  });

  it("builds a cloudflare worker target with a runnable worker entry", async () => {
    await runCli(standaloneProjectDir, ["build", "--target", "cloudflare"]);

    const rootManifest = JSON.parse(
      await readFile(join(standaloneProjectDir, "dist", "deploy-manifest.json"), "utf-8"),
    ) as {
      build: { target?: string };
      targets?: {
        cloudflare?: {
          entry: string;
          configFile: string;
        };
      };
    };
    const workerToml = await readFile(
      join(standaloneProjectDir, "dist", "standalone", "wrangler.toml"),
      "utf-8",
    );
    const health = await invokeGeneratedFetchHandler(
      join(standaloneProjectDir, "dist", "standalone", "worker.js"),
      "/health",
    );

    expect(rootManifest.build.target).toBe("cloudflare");
    expect(rootManifest.targets?.cloudflare?.entry).toBe("dist/standalone/worker.js");
    expect(workerToml).toContain('main = "worker.js"');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });
  });

  it("builds a fly target with docker and fly metadata", async () => {
    await runCli(standaloneProjectDir, ["build", "--target", "fly"]);

    const rootManifest = JSON.parse(
      await readFile(join(standaloneProjectDir, "dist", "deploy-manifest.json"), "utf-8"),
    ) as {
      build: { target?: string };
      targets?: {
        fly?: {
          configFile: string;
        };
        docker?: {
          dockerfile: string;
        };
      };
    };
    const flyToml = await readFile(
      join(standaloneProjectDir, "dist", "standalone", "fly.toml"),
      "utf-8",
    );

    expect(rootManifest.build.target).toBe("fly");
    expect(rootManifest.targets?.fly?.configFile).toBe("dist/standalone/fly.toml");
    expect(rootManifest.targets?.docker?.dockerfile).toBe("dist/standalone/Dockerfile");
    expect(flyToml).toContain('app = "standalone-app"');
  });

  it("generates stage-three deploy:init files for vercel, cloudflare, and fly", async () => {
    await runCli(deployInitProjectDir, ["deploy:init", "--target", "vercel-edge", "--force"]);
    const vercelConfig = await readFile(join(deployInitProjectDir, "vercel.json"), "utf-8");
    expect(vercelConfig).toContain('"dist/standalone/api/index.js"');

    await runCli(deployInitProjectDir, ["deploy:init", "--target", "cloudflare", "--force"]);
    const wranglerConfig = await readFile(join(deployInitProjectDir, "wrangler.toml"), "utf-8");
    expect(wranglerConfig).toContain('main = "dist/standalone/worker.js"');

    await runCli(deployInitProjectDir, ["deploy:init", "--target", "fly", "--force"]);
    const flyToml = await readFile(join(deployInitProjectDir, "fly.toml"), "utf-8");
    const dockerfile = await readFile(join(deployInitProjectDir, "Dockerfile"), "utf-8");
    expect(flyToml).toContain('app = "deploy-init-app"');
    expect(dockerfile).toContain("RUN npx capstan build --target fly");
  });

  it("emits a root deployment contract for plain builds", async () => {
    await runCli(verificationProjectDir, ["build"]);

    const rootManifest = JSON.parse(
      await readFile(join(verificationProjectDir, "dist", "deploy-manifest.json"), "utf-8"),
    ) as {
      build: { target?: string };
      targets?: {
        nodeStandalone?: {
          outputDir: string;
          packageJson: string;
          startCommand: string;
        };
      };
    };

    expect(rootManifest.build.target).toBe("node-standalone");
    expect(rootManifest.targets?.nodeStandalone).toEqual({
      outputDir: "dist",
      packageJson: "package.json",
      installCommand: "npm install --omit=dev",
      startCommand: "capstan start",
    });
  });

  it("verifies a blank edge deployment bundle successfully", async () => {
    await runCli(standaloneProjectDir, ["build", "--target", "vercel-edge"]);

    const result = await runCli(standaloneProjectDir, [
      "verify",
      "--deployment",
      "--target",
      "vercel-edge",
      "--json",
    ]);
    const report = JSON.parse(result.stdout) as {
      status: string;
      target: string;
      summary: { errorCount: number; warningCount: number };
    };

    expect(report.target).toBe("vercel-edge");
    expect(report.status).toBe("passed");
    expect(report.summary.errorCount).toBe(0);
  });

  it("flags sqlite and auth risks for edge deployment verification", async () => {
    await runCli(verificationProjectDir, ["build", "--target", "vercel-edge"]);

    const result = await runCli(verificationProjectDir, [
      "verify",
      "--deployment",
      "--target",
      "vercel-edge",
      "--json",
    ], 1);
    const report = JSON.parse(result.stdout) as {
      status: string;
      diagnostics: Array<{ code: string }>;
    };

    expect(report.status).toBe("failed");
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("sqlite_edge_unsupported");
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("edge_auth_runtime");
  });

  it("fails deployment verification when a required artifact is missing", async () => {
    await runCli(verificationProjectDir, ["build"]);
    await rm(join(verificationProjectDir, "dist", "agent-manifest.json"), { force: true });

    const result = await runCli(verificationProjectDir, [
      "verify",
      "--deployment",
      "--json",
    ], 1);
    const report = JSON.parse(result.stdout) as {
      status: string;
      diagnostics: Array<{ code: string }>;
    };

    expect(report.status).toBe("failed");
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain("missing_agent_manifest");
  });

  it("scaffolds cloudflare deployment files directly from create-capstan templates", async () => {
    await access(join(scaffoldedDeployProjectDir, "wrangler.toml"));
    await access(join(scaffoldedDeployProjectDir, ".env.example"));

    const packageJson = JSON.parse(
      await readFile(join(scaffoldedDeployProjectDir, "package.json"), "utf-8"),
    ) as {
      scripts: Record<string, string>;
    };
    const wranglerConfig = await readFile(join(scaffoldedDeployProjectDir, "wrangler.toml"), "utf-8");

    expect(packageJson.scripts["build:cloudflare"]).toBe("capstan build --target cloudflare");
    expect(wranglerConfig).toContain('main = "dist/standalone/worker.js"');
  });
});

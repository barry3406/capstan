import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDevServer } from "@zauso-ai/capstan-dev";
import type { DevServerInstance } from "@zauso-ai/capstan-dev";

const repoRoot = process.cwd();
const rootNodeModules = join(repoRoot, "node_modules");
const repoTsconfigBase = join(repoRoot, "tsconfig.base.json");
const capstanCliEntry = join(repoRoot, "packages", "cli", "src", "index.ts");

let tempDir: string;
let traceFile: string;
let devServer: DevServerInstance | null = null;
let prodServer: ChildProcessWithoutNullStreams | null = null;

const devPort = 18000 + Math.floor(Math.random() * 20000);
const prodPort = devPort + 1;
const PROCESS_SHUTDOWN_GRACE_MS = 4_000;

setDefaultTimeout(120_000);

function devBaseUrl(path = ""): string {
  return `http://127.0.0.1:${devPort}${path}`;
}

function prodBaseUrl(path = ""): string {
  return `http://127.0.0.1:${prodPort}${path}`;
}

async function clearTrace(): Promise<void> {
  await writeFile(traceFile, "", "utf-8");
}

async function readTrace(): Promise<string[]> {
  const raw = await readFile(traceFile, "utf-8");
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function normalizeRenderedHtml(html: string): string {
  return html.replace(/<!-- -->/g, "");
}

async function writeFixtureFile(relPath: string, content: string): Promise<void> {
  const fullPath = join(tempDir, relPath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

async function writeFixtureApp(): Promise<void> {
  await writeFixtureFile(
    "package.json",
    JSON.stringify(
      {
        name: "page-runtime-test-app",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );

  await writeFixtureFile(
    "tsconfig.json",
    JSON.stringify(
      {
        extends: repoTsconfigBase,
        compilerOptions: {
          rootDir: ".",
          outDir: "dist",
          jsx: "react-jsx",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          types: ["node"],
        },
        include: ["app/**/*.ts", "app/**/*.tsx", "capstan.config.ts"],
      },
      null,
      2,
    ),
  );

  await writeFixtureFile(
    "capstan.config.ts",
    `import { defineConfig } from "@zauso-ai/capstan-core";

export default defineConfig({
  app: {
    name: "page-runtime-test-app",
    title: "Page Runtime Test App",
    description: "Integration test fixture for phase-one page runtime",
  },
  agent: {
    manifest: true,
    openapi: true,
  },
});
`,
  );

  await writeFixtureFile(
    "app/routes/_trace.ts",
    `import { appendFileSync } from "node:fs";

const traceFile = ${JSON.stringify(traceFile)};

export function trace(entry: string): void {
  if (!traceFile) return;
  appendFileSync(traceFile, entry + "\\n");
}
`,
  );

  await writeFixtureFile(
    "app/routes/_layout.tsx",
    `import { Outlet } from "@zauso-ai/capstan-react";

export default function RootLayout() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Page Runtime Test App</title>
      </head>
      <body>
        <div data-layout="root">
          <Outlet />
        </div>
      </body>
    </html>
  );
}
`,
  );

  await writeFixtureFile(
    "app/routes/_loading.tsx",
    `export default function RootLoading() {
  return <div data-loading="root">root loading</div>;
}
`,
  );

  await writeFixtureFile(
    "app/routes/_error.tsx",
    `export default function RootError({
  error,
}: {
  error: Error;
  reset: () => void;
}) {
  return <div data-error="root">root error: {error.message}</div>;
}
`,
  );

  await writeFixtureFile(
    "app/routes/_middleware.ts",
    `import { defineMiddleware } from "@zauso-ai/capstan-core";
import { trace } from "./_trace.js";

export default defineMiddleware(async ({ next }) => {
  trace("root:before");
  const response = await next();
  trace("root:after");
  return response;
});
`,
  );

  await writeFixtureFile(
    "app/routes/index.page.tsx",
    `export default function HomePage() {
  return <main data-page="home">home page</main>;
}
`,
  );

  await writeFixtureFile(
    "app/routes/not-found.tsx",
    `import { defineMetadata } from "@zauso-ai/capstan-react";
import { trace } from "./_trace.js";

export const metadata = defineMetadata({
  title: "Not Found",
  description: "Root fallback for missing routes",
});

export default function RootNotFoundPage() {
  trace("root:not-found:render");
  return <main data-page="root-not-found">root not found</main>;
}
`,
  );

  await writeFixtureFile(
    "app/public/favicon.ico",
    "phase-one-icon",
  );

  await writeFixtureFile(
    "app/public/assets/runtime.js",
    `console.log("phase-one-runtime");`,
  );

  await writeFixtureFile(
    "app/routes/slow.page.tsx",
    `import { trace } from "./_trace.js";

export const renderMode = "streaming";

let ready = false;
const pending = new Promise<void>((resolve) => {
  setTimeout(() => {
    ready = true;
    resolve();
  }, 40);
});

export default function SlowPage() {
  if (!ready) {
    trace("slow:suspend");
    throw pending;
  }

  return <main data-page="slow">root slow ready</main>;
}
`,
  );

  await writeFixtureFile(
    "app/routes/boom.page.tsx",
    `import { trace } from "./_trace.js";

export default function BoomPage() {
  trace("boom:render");
  throw new Error("root boom failure");
}
`,
  );

  await writeFixtureFile(
    "app/routes/api/_middleware.ts",
    `import { defineMiddleware } from "@zauso-ai/capstan-core";
import { trace } from "../_trace.js";

export default defineMiddleware(async ({ request, next }) => {
  trace("api:before");
  const url = new URL(request.url);
  if (url.pathname === "/api/private" && request.headers.get("x-capstan-allow") !== "1") {
    trace("api:block");
    return new Response(JSON.stringify({ error: "blocked by middleware" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const response = await next();
  trace("api:after");
  return response;
});
`,
  );

  await writeFixtureFile(
    "app/routes/api/ping.api.ts",
    `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";
import { trace } from "../_trace.js";

export const GET = defineAPI({
  description: "Ping endpoint",
  capability: "read",
  input: z.object({
    from: z.string().optional(),
  }),
  output: z.object({
    message: z.string(),
    query: z.object({
      from: z.string().optional(),
    }),
  }),
  async handler({ input }) {
    trace("api:ping");
    return {
      message: "pong",
      query: {
        from: input.from,
      },
    };
  },
});
`,
  );

  await writeFixtureFile(
    "app/routes/api/echo.api.ts",
    `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";
import { trace } from "../_trace.js";

export const POST = defineAPI({
  description: "Echo endpoint",
  capability: "write",
  input: z.object({
    title: z.string(),
  }),
  output: z.object({
    echo: z.object({
      title: z.string(),
    }),
  }),
  async handler({ input }) {
    trace("api:echo");
    return {
      echo: {
        title: input.title,
      },
    };
  },
});
`,
  );

  await writeFixtureFile(
    "app/routes/api/private.api.ts",
    `import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";
import { trace } from "../_trace.js";

export const GET = defineAPI({
  description: "Private endpoint",
  capability: "read",
  input: z.object({}).optional(),
  output: z.object({
    secret: z.string(),
  }),
  async handler() {
    trace("api:private:handler");
    return {
      secret: "allowed",
    };
  },
});
`,
  );

  await writeFixtureFile(
    "app/routes/dashboard/_layout.tsx",
    `import { Outlet } from "@zauso-ai/capstan-react";

export default function DashboardLayout() {
  return (
    <section data-layout="dashboard">
      <Outlet />
    </section>
  );
}
`,
  );

  await writeFixtureFile(
    "app/routes/dashboard/_loading.tsx",
    `export default function DashboardLoading() {
  return <div data-loading="dashboard">dashboard loading</div>;
}
`,
  );

  await writeFixtureFile(
    "app/routes/dashboard/_error.tsx",
    `export default function DashboardError({
  error,
}: {
  error: Error;
  reset: () => void;
}) {
  return <div data-error="dashboard">dashboard error: {error.message}</div>;
}
`,
  );

  await writeFixtureFile(
    "app/routes/dashboard/_middleware.ts",
    `import { defineMiddleware } from "@zauso-ai/capstan-core";
import { trace } from "../_trace.js";

export default defineMiddleware(async ({ next }) => {
  trace("dashboard:before");
  const response = await next();
  trace("dashboard:after");
  return response;
});
`,
  );

  await writeFixtureFile(
    "app/routes/dashboard/index.page.tsx",
    `import { defineMetadata, useLoaderData } from "@zauso-ai/capstan-react";
import { trace } from "../_trace.js";

export const metadata = defineMetadata({
  title: "Dashboard",
  description: "Dashboard page for runtime integration tests",
});

export const loader = async ({
  fetch,
}: {
  fetch: {
    get: <T = unknown>(path: string, params?: Record<string, string>) => Promise<T>;
    post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  };
}) => {
  trace("dashboard:loader:start");
  const ping = await fetch.get<{ message: string; query: { from?: string } }>("/api/ping", {
    from: "dashboard",
  });
  const echo = await fetch.post<{ echo: { title: string } }>("/api/echo", {
    title: "from-dashboard",
  });
  trace("dashboard:loader:end");
  return { ping, echo };
};

export default function DashboardPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <main data-page="dashboard">
      <h1>Dashboard</h1>
      <div data-value="ping">
        {data.ping.message}:{data.ping.query.from}
      </div>
      <div data-value="echo">{data.echo.echo.title}</div>
    </main>
  );
}
`,
  );

  await writeFixtureFile(
    "app/routes/dashboard/slow.page.tsx",
    `import { trace } from "../_trace.js";

export const renderMode = "streaming";

let ready = false;
const pending = new Promise<void>((resolve) => {
  setTimeout(() => {
    ready = true;
    resolve();
  }, 40);
});

export default function DashboardSlowPage() {
  if (!ready) {
    trace("dashboard:slow:suspend");
    throw pending;
  }

  return <main data-page="dashboard-slow">dashboard slow ready</main>;
}
`,
  );

  await writeFixtureFile(
    "app/routes/dashboard/boom.page.tsx",
    `import { trace } from "../_trace.js";

export default function DashboardBoomPage() {
  trace("dashboard:boom:render");
  throw new Error("dashboard boom failure");
}
`,
  );

  await writeFixtureFile(
    "app/routes/dashboard/not-found.tsx",
    `import { defineMetadata } from "@zauso-ai/capstan-react";
import { trace } from "../_trace.js";

export const metadata = defineMetadata({
  title: "Dashboard Not Found",
  description: "Dashboard fallback for missing routes",
});

export default function DashboardNotFoundPage() {
  trace("dashboard:not-found:render");
  return <main data-page="dashboard-not-found">dashboard not found</main>;
}
`,
  );

  await symlink(rootNodeModules, join(tempDir, "node_modules"), "dir");
}

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

async function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  const child = spawn(process.execPath, [capstanCliEntry, ...args], {
    cwd: tempDir,
    env: {
      ...process.env,
      ...env,
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
      `capstan ${args.join(" ")} failed with code ${code}${signal ? ` signal ${signal}` : ""}\n` +
      `STDOUT:\n${stdout.join("")}\nSTDERR:\n${stderr.join("")}`,
    );
  }
}

async function startProdServer(): Promise<void> {
  const child = spawn(process.execPath, [capstanCliEntry, "start", "--port", String(prodPort), "--host", "127.0.0.1"], {
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

  const ready = waitForServer(prodBaseUrl("/health"));
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
      `capstan start exited before the server became ready (code ${outcome.code}${outcome.signal ? ` signal ${outcome.signal}` : ""})\n` +
      `STDOUT:\n${stdout.join("")}\nSTDERR:\n${stderr.join("")}`,
    );
  }

  prodServer = child;
}

async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
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

async function requestTextWithTrace(baseUrl: string, path: string, init?: RequestInit): Promise<{
  status: number;
  text: string;
  headers: Headers;
  trace: string[];
}> {
  await clearTrace();
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = normalizeRenderedHtml(await res.text());
  const trace = await readTrace();
  return {
    status: res.status,
    text,
    headers: res.headers,
    trace,
  };
}

async function requestJsonWithTrace<T>(baseUrl: string, path: string, init?: RequestInit): Promise<{
  status: number;
  body: T;
  headers: Headers;
  trace: string[];
}> {
  await clearTrace();
  const res = await fetch(`${baseUrl}${path}`, init);
  const body = await res.json() as T;
  const trace = await readTrace();
  return {
    status: res.status,
    body,
    headers: res.headers,
    trace,
  };
}

function normalizeRenderedHtml(html: string): string {
  return html.replace(/<!-- -->/g, "");
}

function normalizeLayoutKey(layoutKey: string): string {
  return layoutKey
    .replace(/^\/private/, "")
    .replace("/dist/app/routes/", "/app/routes/")
    .replace(/\.js$/, ".tsx");
}

function expectTraceToContainSequence(actual: string[], sequence: string[]): void {
  let cursor = 0;

  for (const entry of actual) {
    if (entry === sequence[cursor]) {
      cursor += 1;
      if (cursor === sequence.length) {
        return;
      }
    }
  }

  throw new Error(
    `Trace did not contain expected sequence.\nExpected: ${sequence.join(" -> ")}\nActual: ${actual.join(" -> ")}`,
  );
}

beforeAll(async () => {
  await runRepoCommand(["run", "build", "--workspace", "@zauso-ai/capstan-dev"]);

  tempDir = await mkdtemp(join(tmpdir(), "capstan-page-runtime-prod-"));
  traceFile = join(tempDir, "trace.log");

  await writeFixtureApp();
  await clearTrace();

  devServer = await createDevServer({
    rootDir: tempDir,
    port: devPort,
    host: "127.0.0.1",
    appName: "page-runtime-test-app",
    appDescription: "Integration test fixture for phase-one page runtime",
  });
  await devServer.start();

  await runCli(["build"]);
  await startProdServer();
});

afterAll(async () => {
  if (devServer) {
    await devServer.stop();
  }
  if (prodServer && prodServer.exitCode === null && prodServer.signalCode === null) {
    prodServer.kill("SIGTERM");
    await Promise.race([
      once(prodServer, "exit"),
      new Promise((resolve) => setTimeout(resolve, PROCESS_SHUTDOWN_GRACE_MS)),
    ]);
    if (prodServer.exitCode === null && prodServer.signalCode === null) {
      prodServer.kill("SIGKILL");
    }
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("page runtime integration (prod parity)", () => {
  it("writes a deploy manifest that captures the production contract", async () => {
    const manifest = JSON.parse(
      await readFile(join(tempDir, "dist", "deploy-manifest.json"), "utf-8"),
    ) as {
      schemaVersion: number;
      build: { mode: string; distDir: string };
      server: { entry: string; startCommand: string };
      assets: {
        sourcePublicDir: string;
        outputPublicDir: string;
        publicUrlPrefix: string;
        copied: boolean;
        staticHtmlDir: string | null;
      };
      artifacts: { deployManifest: string };
    };

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.build).toMatchObject({
      mode: "server",
      distDir: "dist",
    });
    expect(manifest.server).toMatchObject({
      entry: "dist/_capstan_server.js",
      startCommand: "capstan start",
    });
    expect(manifest.assets).toMatchObject({
      sourcePublicDir: "app/public",
      outputPublicDir: "dist/public",
      publicUrlPrefix: "/",
      copied: true,
      staticHtmlDir: null,
    });
    expect(manifest.artifacts.deployManifest).toBe("dist/deploy-manifest.json");
  });

  it("matches dev behavior for dashboard rendering, loader fetch, and middleware ordering", async () => {
    const dev = await requestTextWithTrace(devBaseUrl(), "/dashboard");
    const prod = await requestTextWithTrace(prodBaseUrl(), "/dashboard");

    expect(dev.status).toBe(200);
    expect(prod.status).toBe(200);

    for (const body of [normalizeRenderedHtml(dev.text), normalizeRenderedHtml(prod.text)]) {
      expect(body).toContain('data-layout="root"');
      expect(body).toContain('data-layout="dashboard"');
      expect(body).toContain('data-page="dashboard"');
      expect(body).toContain("pong:dashboard");
      expect(body).toContain("from-dashboard");
    }

    const expectedSequence = [
      "root:before",
      "dashboard:before",
      "dashboard:loader:start",
      "api:ping",
      "api:echo",
      "dashboard:loader:end",
      "dashboard:after",
      "root:after",
    ];

    expectTraceToContainSequence(dev.trace, expectedSequence);
    expectTraceToContainSequence(prod.trace, expectedSequence);
  });

  it("returns equivalent navigation payloads in dev and prod", async () => {
    const init = {
      headers: {
        "X-Capstan-Nav": "1",
        Accept: "application/json",
      },
    };

    const dev = await requestJsonWithTrace<{
      url: string;
      layoutKey: string;
      html?: string;
      loaderData: {
        ping: { message: string; query: { from?: string } };
        echo: { echo: { title: string } };
      };
      metadata?: { title?: string; description?: string };
      componentType: string;
    }>(devBaseUrl(), "/dashboard", init);
    const prod = await requestJsonWithTrace<{
      url: string;
      layoutKey: string;
      html?: string;
      loaderData: {
        ping: { message: string; query: { from?: string } };
        echo: { echo: { title: string } };
      };
      metadata?: { title?: string; description?: string };
      componentType: string;
    }>(prodBaseUrl(), "/dashboard", init);

    expect(dev.status).toBe(200);
    expect(prod.status).toBe(200);

    for (const payload of [dev.body, prod.body]) {
      expect(payload.url).toBe("/dashboard");
      expect(payload.componentType).toBe("server");
      expect(normalizeLayoutKey(payload.layoutKey)).toBe(join(tempDir, "app/routes/dashboard/_layout.tsx"));
      expect(payload.metadata).toEqual({
        title: "Dashboard",
        description: "Dashboard page for runtime integration tests",
      });
      expect(payload.loaderData.ping.message).toBe("pong");
      expect(payload.loaderData.ping.query.from).toBe("dashboard");
      expect(payload.loaderData.echo.echo.title).toBe("from-dashboard");
      const normalizedHtml = normalizeRenderedHtml(payload.html ?? "");
      expect(normalizedHtml).toContain('data-layout="root"');
      expect(normalizedHtml).toContain('data-layout="dashboard"');
      expect(normalizedHtml).toContain('data-page="dashboard"');
      expect(normalizedHtml).toContain("from-dashboard");
    }
  });

  it("renders equivalent root not-found documents in dev and prod", async () => {
    const init = {
      headers: {
        Accept: "text/html",
      },
    };
    const dev = await requestTextWithTrace(devBaseUrl(), "/missing-route", init);
    const prod = await requestTextWithTrace(prodBaseUrl(), "/missing-route", init);

    expect(dev.status).toBe(404);
    expect(prod.status).toBe(404);

    for (const result of [dev, prod]) {
      expect(result.text).toContain('data-page="root-not-found"');
      expect(result.text).toContain("<title>Not Found</title>");
      expect(result.text).toContain("Root fallback for missing routes");
      expectTraceToContainSequence(result.trace, [
        "root:before",
        "root:not-found:render",
        "root:after",
      ]);
    }
  });

  it("returns equivalent scoped dashboard not-found navigation payloads in dev and prod", async () => {
    const init = {
      headers: {
        "X-Capstan-Nav": "1",
        Accept: "application/json",
      },
    };

    const dev = await requestJsonWithTrace<{
      url: string;
      layoutKey: string;
      html?: string;
      metadata?: { title?: string; description?: string };
      componentType: string;
    }>(devBaseUrl(), "/dashboard/missing", init);
    const prod = await requestJsonWithTrace<{
      url: string;
      layoutKey: string;
      html?: string;
      metadata?: { title?: string; description?: string };
      componentType: string;
    }>(prodBaseUrl(), "/dashboard/missing", init);

    expect(dev.status).toBe(404);
    expect(prod.status).toBe(404);

    for (const payload of [dev.body, prod.body]) {
      expect(payload.url).toBe("/dashboard/missing");
      expect(normalizeLayoutKey(payload.layoutKey)).toBe(join(tempDir, "app/routes/dashboard/_layout.tsx"));
      expect(payload.componentType).toBe("server");
      expect(payload.metadata).toEqual({
        title: "Dashboard Not Found",
        description: "Dashboard fallback for missing routes",
      });
      const normalizedHtml = normalizeRenderedHtml(payload.html ?? "");
      expect(normalizedHtml).toContain('data-layout="root"');
      expect(normalizedHtml).toContain('data-layout="dashboard"');
      expect(normalizedHtml).toContain('data-page="dashboard-not-found"');
    }

    for (const trace of [dev.trace, prod.trace]) {
      expectTraceToContainSequence(trace, [
        "root:before",
        "dashboard:before",
        "dashboard:not-found:render",
        "dashboard:after",
        "root:after",
      ]);
    }
  });

  it("preserves loading and error boundaries in prod and keeps middleware wrapping intact", async () => {
    const cases = [
      {
        path: "/slow",
        loading: "root loading",
        done: "root slow ready",
        trace: ["root:before", "slow:suspend", "root:after"],
      },
      {
        path: "/dashboard/slow",
        loading: "dashboard loading",
        done: "dashboard slow ready",
        trace: [
          "root:before",
          "dashboard:before",
          "dashboard:slow:suspend",
          "dashboard:after",
          "root:after",
        ],
      },
      {
        path: "/boom",
        loading: "root error",
        done: "root boom failure",
        trace: ["root:before", "boom:render", "root:after"],
      },
      {
        path: "/dashboard/boom",
        loading: "dashboard error",
        done: "dashboard boom failure",
        trace: [
          "root:before",
          "dashboard:before",
          "dashboard:boom:render",
          "dashboard:after",
          "root:after",
        ],
      },
    ] as const;

    for (const testCase of cases) {
      const dev = await requestTextWithTrace(devBaseUrl(), testCase.path);
      const prod = await requestTextWithTrace(prodBaseUrl(), testCase.path);

      expect(dev.status).toBe(200);
      expect(prod.status).toBe(200);

      const normalizedDevHtml = normalizeRenderedHtml(dev.text);
      const normalizedProdHtml = normalizeRenderedHtml(prod.text);

      expect(normalizedDevHtml).toContain(testCase.done);
      expect(normalizedProdHtml).toContain(testCase.done);

      const stableTraceSequence = testCase.path.includes("/slow")
        ? testCase.path.includes("/dashboard")
          ? ["root:before", "dashboard:before", "dashboard:after", "root:after"]
          : ["root:before", "root:after"]
        : testCase.trace;

      expectTraceToContainSequence(dev.trace, stableTraceSequence);
      expectTraceToContainSequence(prod.trace, stableTraceSequence);
    }
  });

  it("short-circuits private API routes in prod the same way as dev", async () => {
    const blockedDev = await requestTextWithTrace(devBaseUrl(), "/api/private");
    const blockedProd = await requestTextWithTrace(prodBaseUrl(), "/api/private");

    expect(blockedDev.status).toBe(401);
    expect(blockedProd.status).toBe(401);
    expect(JSON.parse(blockedDev.text)).toEqual({ error: "blocked by middleware" });
    expect(JSON.parse(blockedProd.text)).toEqual({ error: "blocked by middleware" });
    expect(blockedDev.trace).toEqual([
      "root:before",
      "api:before",
      "api:block",
      "root:after",
    ]);
    expect(blockedProd.trace).toEqual([
      "root:before",
      "api:before",
      "api:block",
      "root:after",
    ]);

    const allowedInit = {
      headers: {
        "x-capstan-allow": "1",
      },
    };
    const allowedDev = await requestTextWithTrace(devBaseUrl(), "/api/private", allowedInit);
    const allowedProd = await requestTextWithTrace(prodBaseUrl(), "/api/private", allowedInit);

    expect(allowedDev.status).toBe(200);
    expect(allowedProd.status).toBe(200);
    expect(JSON.parse(allowedDev.text)).toEqual({ secret: "allowed" });
    expect(JSON.parse(allowedProd.text)).toEqual({ secret: "allowed" });
    expect(allowedDev.trace).toEqual([
      "root:before",
      "api:before",
      "api:private:handler",
      "api:after",
      "root:after",
    ]);
    expect(allowedProd.trace).toEqual([
      "root:before",
      "api:before",
      "api:private:handler",
      "api:after",
      "root:after",
    ]);
  });

  it("returns 404 for unknown routes in both runtimes", async () => {
    const dev = await requestTextWithTrace(devBaseUrl(), "/missing-route");
    const prod = await requestTextWithTrace(prodBaseUrl(), "/missing-route");

    expect(dev.status).toBe(404);
    expect(prod.status).toBe(404);
    expect(dev.trace).toEqual([]);
    expect(prod.trace).toEqual([]);
  });

  it("serves app/public assets from the root URL path in both runtimes", async () => {
    const iconDev = await requestTextWithTrace(devBaseUrl(), "/favicon.ico");
    const iconProd = await requestTextWithTrace(prodBaseUrl(), "/favicon.ico");

    expect(iconDev.status).toBe(200);
    expect(iconProd.status).toBe(200);
    expect(iconDev.text).toBe("phase-one-icon");
    expect(iconProd.text).toBe("phase-one-icon");
    expect(iconDev.headers.get("content-type")).toBe("image/x-icon");
    expect(iconProd.headers.get("content-type")).toBe("image/x-icon");
    expect(iconDev.trace).toEqual([]);
    expect(iconProd.trace).toEqual([]);

    const nestedDev = await requestTextWithTrace(devBaseUrl(), "/assets/runtime.js");
    const nestedProd = await requestTextWithTrace(prodBaseUrl(), "/assets/runtime.js");

    expect(nestedDev.status).toBe(200);
    expect(nestedProd.status).toBe(200);
    expect(nestedDev.text).toBe(`console.log("phase-one-runtime");`);
    expect(nestedProd.text).toBe(`console.log("phase-one-runtime");`);
    expect(nestedDev.headers.get("content-type")).toBe("application/javascript");
    expect(nestedProd.headers.get("content-type")).toBe("application/javascript");
  });

  it("does not require a /public prefix for production static assets", async () => {
    const dev = await requestTextWithTrace(devBaseUrl(), "/public/favicon.ico");
    const prod = await requestTextWithTrace(prodBaseUrl(), "/public/favicon.ico");

    expect(dev.status).toBe(404);
    expect(prod.status).toBe(404);
    expect(dev.trace).toEqual([]);
    expect(prod.trace).toEqual([]);
  });

  it("serves the shared client runtime assets in both runtimes", async () => {
    for (const base of [devBaseUrl(), prodBaseUrl()]) {
      const bootstrap = await fetch(`${base}/_capstan/client.js`);
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.headers.get("content-type")).toBe(
        "application/javascript; charset=utf-8",
      );
      expect(await bootstrap.text()).toContain("bootstrapClient");

      const entry = await fetch(`${base}/_capstan/client/entry.js`);
      expect(entry.status).toBe(200);
      expect(entry.headers.get("content-type")).toBe("application/javascript");
      expect(await entry.text()).toContain("initRouter");

      const missing = await fetch(`${base}/_capstan/client/missing.js`);
      expect(missing.status).toBe(404);
    }
  });
});

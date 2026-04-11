import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDevServer } from "@zauso-ai/capstan-dev";
import type { DevServerInstance } from "@zauso-ai/capstan-dev";

let tempDir: string;
let traceFile: string;
let server: DevServerInstance;
const port = 12000 + Math.floor(Math.random() * 50000);

const repoRoot = process.cwd();
const rootNodeModules = join(repoRoot, "node_modules");
const repoTsconfigBase = join(repoRoot, "tsconfig.base.json");

function baseUrl(): string {
  return `http://127.0.0.1:${port}`;
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

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "capstan-page-runtime-dev-"));
  traceFile = join(tempDir, "trace.log");
  await writeFixtureApp();
  await clearTrace();

  server = await createDevServer({
    rootDir: tempDir,
    port,
    host: "127.0.0.1",
    appName: "page-runtime-test-app",
    appDescription: "Integration test fixture for phase-one page runtime",
  });

  await server.start();
});

afterAll(async () => {
  if (server) {
    await server.stop();
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("page runtime integration (dev)", () => {
  it("loads dashboard data through in-process fetch and preserves middleware ordering", async () => {
    await clearTrace();
    const res = await fetch(`${baseUrl()}/dashboard`);
    expect(res.status).toBe(200);

    const html = normalizeRenderedHtml(await res.text());
    expect(html).toContain('data-layout="root"');
    expect(html).toContain('data-layout="dashboard"');
    expect(html).toContain('data-page="dashboard"');
    expect(html).toContain("pong:dashboard");
    expect(html).toContain("from-dashboard");

    expectTraceToContainSequence(await readTrace(), [
      "root:before",
      "dashboard:before",
      "dashboard:loader:start",
      "api:ping",
      "api:echo",
      "dashboard:loader:end",
      "dashboard:after",
      "root:after",
    ]);
  });

  it("streams loading fallbacks and renders the nearest loading boundary", async () => {
    await clearTrace();

    const rootRes = await fetch(`${baseUrl()}/slow`);
    const rootHtml = normalizeRenderedHtml(await rootRes.text());
    expect(rootRes.status).toBe(200);
    expect(rootHtml).toContain("root slow ready");
    expectTraceToContainSequence(await readTrace(), [
      "root:before",
      "root:after",
    ]);

    await clearTrace();
    const nestedRes = await fetch(`${baseUrl()}/dashboard/slow`);
    const nestedHtml = normalizeRenderedHtml(await nestedRes.text());
    expect(nestedRes.status).toBe(200);
    expect(nestedHtml).toContain("dashboard slow ready");
    expectTraceToContainSequence(await readTrace(), [
      "root:before",
      "dashboard:before",
      "dashboard:after",
      "root:after",
    ]);
  });

  it("renders the nearest error boundary for thrown page errors", async () => {
    await clearTrace();

    const rootRes = await fetch(`${baseUrl()}/boom`);
    const rootHtml = normalizeRenderedHtml(await rootRes.text());
    expect(rootRes.status).toBe(200);
    expect(rootHtml).toContain("root error");
    expect(rootHtml).toContain("root boom failure");
    expectTraceToContainSequence(await readTrace(), [
      "root:before",
      "boom:render",
      "root:after",
    ]);

    await clearTrace();
    const nestedRes = await fetch(`${baseUrl()}/dashboard/boom`);
    const nestedHtml = normalizeRenderedHtml(await nestedRes.text());
    expect(nestedRes.status).toBe(200);
    expect(nestedHtml).toContain("dashboard error");
    expect(nestedHtml).toContain("dashboard boom failure");
    expect(nestedHtml).not.toContain("root error");
    expectTraceToContainSequence(await readTrace(), [
      "root:before",
      "dashboard:before",
      "dashboard:boom:render",
      "dashboard:after",
      "root:after",
    ]);
  });

  it("short-circuits protected API routes and keeps the handler from running", async () => {
    await clearTrace();

    const blocked = await fetch(`${baseUrl()}/api/private`);
    expect(blocked.status).toBe(401);
    expect(await blocked.json()).toEqual({ error: "blocked by middleware" });
    expect(await readTrace()).toEqual([
      "root:before",
      "api:before",
      "api:block",
      "root:after",
    ]);

    await clearTrace();
    const allowed = await fetch(`${baseUrl()}/api/private`, {
      headers: { "x-capstan-allow": "1" },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ secret: "allowed" });
    expect(await readTrace()).toEqual([
      "root:before",
      "api:before",
      "api:private:handler",
      "api:after",
      "root:after",
    ]);
  });

  it("returns a navigation payload with layout, metadata, and prerendered HTML", async () => {
    await clearTrace();

    const res = await fetch(`${baseUrl()}/dashboard`, {
      headers: {
        "X-Capstan-Nav": "1",
        Accept: "application/json",
      },
    });

    expect(res.status).toBe(200);

    const payload = (await res.json()) as {
      url: string;
      layoutKey: string;
      html?: string;
      loaderData: {
        ping: { message: string; query: { from?: string } };
        echo: { echo: { title: string } };
      };
      metadata?: { title?: string; description?: string };
      componentType: string;
    };

    expect(payload.url).toBe("/dashboard");
    expect(payload.componentType).toBe("server");
    expect(payload.layoutKey).toBe(join(tempDir, "app/routes/dashboard/_layout.tsx"));
    expect(payload.metadata).toEqual({
      title: "Dashboard",
      description: "Dashboard page for runtime integration tests",
    });
    expect(payload.loaderData.ping.message).toBe("pong");
    expect(payload.loaderData.ping.query.from).toBe("dashboard");
    expect(payload.loaderData.echo.echo.title).toBe("from-dashboard");
    expect(payload.html).toContain('data-layout="root"');
    expect(payload.html).toContain('data-layout="dashboard"');
    expect(payload.html).toContain('data-page="dashboard"');
    expect(payload.html).toContain("from-dashboard");
  });

  it("renders the root not-found page for unknown document routes", async () => {
    await clearTrace();

    const res = await fetch(`${baseUrl()}/missing-route`, {
      headers: {
        Accept: "text/html",
      },
    });
    expect(res.status).toBe(404);

    const html = normalizeRenderedHtml(await res.text());
    expect(html).toContain('data-page="root-not-found"');
    expect(html).toContain("<title>Not Found</title>");
    expect(html).toContain("Root fallback for missing routes");
    expect(await readTrace()).toEqual([
      "root:before",
      "root:not-found:render",
      "root:after",
    ]);
  });

  it("returns a scoped dashboard not-found navigation payload for nested unknown routes", async () => {
    await clearTrace();

    const res = await fetch(`${baseUrl()}/dashboard/missing`, {
      headers: {
        "X-Capstan-Nav": "1",
        Accept: "application/json",
      },
    });

    expect(res.status).toBe(404);

    const payload = (await res.json()) as {
      url: string;
      layoutKey: string;
      html?: string;
      metadata?: { title?: string; description?: string };
      componentType: string;
    };

    expect(payload.url).toBe("/dashboard/missing");
    expect(payload.layoutKey).toBe(join(tempDir, "app/routes/dashboard/_layout.tsx"));
    expect(payload.componentType).toBe("server");
    expect(payload.metadata).toEqual({
      title: "Dashboard Not Found",
      description: "Dashboard fallback for missing routes",
    });
    expect(payload.html).toContain('data-layout="root"');
    expect(payload.html).toContain('data-layout="dashboard"');
    expect(payload.html).toContain('data-page="dashboard-not-found"');
    expect(await readTrace()).toEqual([
      "root:before",
      "dashboard:before",
      "dashboard:not-found:render",
      "dashboard:after",
      "root:after",
    ]);
  });
});

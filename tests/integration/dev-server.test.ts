import { describe, it, expect, afterAll, beforeAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDevServer } from "@zauso-ai/capstan-dev";
import type { DevServerInstance } from "@zauso-ai/capstan-dev";

// ---------------------------------------------------------------------------
// Setup: create a minimal Capstan app in a temp directory
// ---------------------------------------------------------------------------

let tempDir: string;
let server: DevServerInstance;
const port = 10000 + Math.floor(Math.random() * 50000);

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "capstan-dev-test-"));

  // Create the directory structure: app/routes/api/ and app/routes/
  const routesDir = join(tempDir, "app", "routes");
  const apiDir = join(routesDir, "api");
  await mkdir(apiDir, { recursive: true });

  // Write the health API route
  // This file is dynamically imported by the dev server, so it needs to be
  // a valid ES module with a GET export.
  await writeFile(
    join(apiDir, "health.api.ts"),
    `
export const GET = {
  description: "Health check endpoint",
  capability: "read",
  handler: async () => {
    return { status: "healthy", timestamp: new Date().toISOString() };
  },
};
`,
    "utf-8",
  );

  // Write a minimal page route
  await writeFile(
    join(routesDir, "index.page.tsx"),
    `
export default function HomePage() {
  return null;
}
`,
    "utf-8",
  );

  // Create app/public/ with a test CSS file
  const publicDir = join(tempDir, "app", "public");
  await mkdir(publicDir, { recursive: true });

  await writeFile(
    join(publicDir, "test.css"),
    `body { color: red; }`,
    "utf-8",
  );

  await writeFile(
    join(publicDir, "data.json"),
    JSON.stringify({ hello: "world" }),
    "utf-8",
  );

  // Create a subdirectory with a file
  const subDir = join(publicDir, "assets");
  await mkdir(subDir, { recursive: true });
  await writeFile(
    join(subDir, "app.js"),
    `console.log("hello");`,
    "utf-8",
  );

  // Create and start the dev server
  server = await createDevServer({
    rootDir: tempDir,
    port,
    host: "127.0.0.1",
    appName: "test-dev-app",
    appDescription: "Test application for dev server integration tests",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const baseUrl = () => `http://127.0.0.1:${port}`;

describe("Dev server integration", () => {
  it("GET /api/health returns JSON with status healthy", async () => {
    const res = await fetch(`${baseUrl()}/api/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("healthy");
    expect(body.timestamp).toBeTruthy();
  });

  it("GET /.well-known/capstan.json returns agent manifest JSON", async () => {
    const res = await fetch(`${baseUrl()}/.well-known/capstan.json`);
    expect(res.status).toBe(200);

    const manifest = (await res.json()) as {
      capstan: string;
      name: string;
      description: string;
      authentication: { schemes: Array<{ type: string }> };
      capabilities: Array<{
        key: string;
        title: string;
        mode: string;
        endpoint: { method: string; path: string };
      }>;
    };

    expect(manifest.capstan).toBe("1.0");
    expect(manifest.name).toBe("test-dev-app");
    expect(manifest.authentication).toBeDefined();
    expect(manifest.authentication.schemes.length).toBeGreaterThan(0);
  });

  it("GET /openapi.json returns OpenAPI spec", async () => {
    const res = await fetch(`${baseUrl()}/openapi.json`);
    expect(res.status).toBe(200);

    const spec = (await res.json()) as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
    };

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("test-dev-app");
    expect(spec.info.version).toBe("0.3.0");
    expect(spec.paths).toBeDefined();
  });

  it("agent manifest includes the health check capability", async () => {
    const res = await fetch(`${baseUrl()}/.well-known/capstan.json`);
    const manifest = (await res.json()) as {
      capabilities: Array<{
        key: string;
        endpoint: { method: string; path: string };
      }>;
    };

    const healthCap = manifest.capabilities.find(
      (c) => c.endpoint.path === "/api/health",
    );
    expect(healthCap).toBeDefined();
    expect(healthCap!.endpoint.method).toBe("GET");
  });

  it("built-in health endpoint responds", async () => {
    const res = await fetch(`${baseUrl()}/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      uptime: number;
      timestamp: string;
    };
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  it("page route is served", async () => {
    const res = await fetch(`${baseUrl()}/`);
    expect(res.status).toBe(200);

    const html = await res.text();
    // Should return HTML (either from SSR or the fallback shell)
    expect(html).toContain("<");
  });

  // --- Static file serving tests -------------------------------------------

  it("GET /test.css returns 200 with text/css content type", async () => {
    const res = await fetch(`${baseUrl()}/test.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css");

    const body = await res.text();
    expect(body).toBe("body { color: red; }");
  });

  it("GET /data.json returns 200 with application/json content type", async () => {
    const res = await fetch(`${baseUrl()}/data.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");

    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ hello: "world" });
  });

  it("GET /assets/app.js returns 200 with application/javascript content type", async () => {
    const res = await fetch(`${baseUrl()}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/javascript");

    const body = await res.text();
    expect(body).toBe(`console.log("hello");`);
  });

  it("GET /nonexistent.css returns 404", async () => {
    const res = await fetch(`${baseUrl()}/nonexistent.css`);
    expect(res.status).toBe(404);
  });
});

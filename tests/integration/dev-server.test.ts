import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDevServer } from "@capstan/dev";
import type { DevServerInstance } from "@capstan/dev";

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
    expect(spec.info.version).toBe("0.1.0");
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
});

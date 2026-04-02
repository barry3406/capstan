import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDevServer } from "@zauso-ai/capstan-dev";
import type { DevServerInstance } from "@zauso-ai/capstan-dev";

// ---------------------------------------------------------------------------
// Spin up a minimal dev server and verify navigation payload + manifest
// ---------------------------------------------------------------------------

let tempDir: string;
let server: DevServerInstance;
const port = 40000 + Math.floor(Math.random() * 10000);

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "nav-payload-test-"));

  const routesDir = join(tempDir, "app", "routes");
  const publicDir = join(tempDir, "app", "public");
  await mkdir(routesDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  await writeFile(
    join(routesDir, "index.page.tsx"),
    `export default function Home() { return null; }\nexport const metadata = { title: "Home Page" };`,
    "utf-8",
  );

  await writeFile(
    join(routesDir, "about.page.tsx"),
    `export default function About() { return null; }\nexport const metadata = { title: "About Page" };`,
    "utf-8",
  );

  server = await createDevServer({
    rootDir: tempDir,
    port,
    host: "127.0.0.1",
    appName: "nav-test",
    publicDir,
  });

  await server.start();
});

afterAll(async () => {
  if (server) await server.stop();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("navigation payload (X-Capstan-Nav: 1)", () => {
  test("returns JSON payload for nav request", async () => {
    const url = `http://127.0.0.1:${port}/about`;
    const res = await fetch(url, {
      headers: { "X-Capstan-Nav": "1", Accept: "application/json" },
    });

    // The response should be JSON (not HTML)
    expect(res.ok).toBe(true);

    const payload = (await res.json()) as Record<string, unknown>;
    expect(payload["url"]).toBeDefined();
    expect(payload["layoutKey"]).toBeDefined();
    expect(payload["componentType"]).toBe("server");
    expect("loaderData" in payload).toBe(true);
  });
});

describe("manifest injection", () => {
  test("full page response includes __CAPSTAN_MANIFEST__ script", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("__CAPSTAN_MANIFEST__");

    // Extract and parse the manifest
    const match = html.match(/__CAPSTAN_MANIFEST__=(\{[^<]*\})/s);
    expect(match).toBeTruthy();
    if (match) {
      const manifest = JSON.parse(match[1]!.replace(/\\u003c/g, "<"));
      expect(manifest.routes).toBeInstanceOf(Array);
      expect(manifest.routes.length).toBeGreaterThan(0);

      // Each route should have urlPattern and componentType
      for (const route of manifest.routes) {
        expect(typeof route.urlPattern).toBe("string");
        expect(typeof route.componentType).toBe("string");
      }
    }
  });

  test("normal page GET returns HTML (not JSON)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/about`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("</html>");
  });
});

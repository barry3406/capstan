import { describe, it, expect, afterAll, beforeAll, setDefaultTimeout } from "bun:test";
import { mkdtemp, rm, access, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDevServer } from "@zauso-ai/capstan-dev";
import type { DevServerInstance } from "@zauso-ai/capstan-dev";

// Import scaffoldProject from source so the integration test always exercises
// the current scaffold templates rather than a stale build artifact.
import { scaffoldProject } from "../../packages/create-capstan/src/scaffold.ts";

const repoRoot = process.cwd();
const rootNodeModules = join(repoRoot, "node_modules");

// ---------------------------------------------------------------------------
// Setup: scaffold a "tickets" template project and start a dev server
// ---------------------------------------------------------------------------

let tempDir: string;
let projectDir: string;
let server: DevServerInstance;
const port = 10000 + Math.floor(Math.random() * 50000);

setDefaultTimeout(120_000);

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "capstan-pipeline-test-"));
  projectDir = join(tempDir, "test-tickets-app");

  // Scaffold the tickets template
  await scaffoldProject({
    projectName: "test-tickets-app",
    template: "tickets",
    outputDir: projectDir,
    deployTarget: "docker",
  });

  // The scaffolded route files import from "capstan" which is not
  // resolvable in the temp directory (there is no node_modules).
  // Rewrite the route files with self-contained handlers that the dev
  // server can load without external imports.
  await writeFile(
    join(projectDir, "app/routes/api/health.api.ts"),
    `
export const GET = {
  description: "Health check endpoint",
  capability: "read",
  handler: async () => ({
    status: "healthy",
    timestamp: new Date().toISOString(),
  }),
};
`,
    "utf-8",
  );

  await writeFile(
    join(projectDir, "app/routes/tickets/index.api.ts"),
    `
export const GET = {
  description: "List all tickets",
  capability: "read",
  resource: "ticket",
  handler: async () => ({
    tickets: [
      { id: "1", title: "Example ticket", status: "open", priority: "medium" },
    ],
  }),
};

export const POST = {
  description: "Create a new ticket",
  capability: "write",
  resource: "ticket",
  handler: async ({ input }) => ({
    id: crypto.randomUUID(),
    title: input?.title ?? "New ticket",
    status: "open",
    priority: input?.priority ?? "medium",
  }),
};
`,
    "utf-8",
  );

  await writeFile(
    join(projectDir, "app/routes/tickets/[id].api.ts"),
    `
export const GET = {
  description: "Get a ticket by ID",
  capability: "read",
  resource: "ticket",
  handler: async () => ({
    id: "1",
    title: "Example ticket",
    description: "This is an example",
    status: "open",
    priority: "medium",
  }),
};
`,
    "utf-8",
  );

  // Rewrite the page to not require JSX/React
  await writeFile(
    join(projectDir, "app/routes/index.page.tsx"),
    `
export default function HomePage() {
  return null;
}
`,
    "utf-8",
  );

  await symlink(rootNodeModules, join(projectDir, "node_modules"), "dir");

  // Start a dev server pointing to the scaffolded project
  server = await createDevServer({
    rootDir: projectDir,
    port,
    host: "127.0.0.1",
    appName: "test-tickets-app",
    appDescription: "Scaffolded test project",
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
// Helper
// ---------------------------------------------------------------------------

const baseUrl = () => `http://127.0.0.1:${port}`;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tests: scaffolded project structure
// ---------------------------------------------------------------------------

describe("Scaffolded project structure", () => {
  it("package.json exists and has correct name", async () => {
    const pkgPath = join(projectDir, "package.json");
    expect(await fileExists(pkgPath)).toBe(true);

    const content = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      name: string;
      scripts: Record<string, string>;
    };
    expect(content.name).toBe("test-tickets-app");
    expect(content.scripts["build:standalone"]).toBe("capstan build --target node-standalone");
    expect(content.scripts["build:docker"]).toBe("capstan build --target docker");
    expect(content.scripts["start:standalone"]).toBe("capstan start --from dist/standalone");
    expect(content.scripts["deploy:init"]).toBe("capstan deploy:init");
  });

  it("capstan.config.ts exists and contains defineConfig", async () => {
    const configPath = join(projectDir, "capstan.config.ts");
    expect(await fileExists(configPath)).toBe(true);

    const content = await readFile(configPath, "utf-8");
    expect(content).toContain("defineConfig");
    expect(content).toContain("test-tickets-app");
  });

  it("tsconfig.json exists", async () => {
    expect(await fileExists(join(projectDir, "tsconfig.json"))).toBe(true);
  });

  it(".gitignore exists", async () => {
    expect(await fileExists(join(projectDir, ".gitignore"))).toBe(true);
  });

  it("AGENTS.md exists and includes Capstan onboarding guidance", async () => {
    const agentsPath = join(projectDir, "AGENTS.md");
    expect(await fileExists(agentsPath)).toBe(true);

    const content = await readFile(agentsPath, "utf-8");
    expect(content).toContain("## Golden Paths");
    expect(content).toContain("capstan verify --json");
    expect(content).toContain("HTTP + MCP + A2A + OpenAPI");
  });

  it("docker deployment files exist when scaffolded with docker target", async () => {
    expect(await fileExists(join(projectDir, "Dockerfile"))).toBe(true);
    expect(await fileExists(join(projectDir, ".dockerignore"))).toBe(true);
    expect(await fileExists(join(projectDir, ".env.example"))).toBe(true);
  });

  it("root layout exists", async () => {
    expect(
      await fileExists(join(projectDir, "app/routes/_layout.tsx")),
    ).toBe(true);
  });

  it("index page exists", async () => {
    expect(
      await fileExists(join(projectDir, "app/routes/index.page.tsx")),
    ).toBe(true);
  });

  it("health API route exists", async () => {
    expect(
      await fileExists(join(projectDir, "app/routes/api/health.api.ts")),
    ).toBe(true);
  });

  it("policies file exists", async () => {
    expect(
      await fileExists(join(projectDir, "app/policies/index.ts")),
    ).toBe(true);
  });

  // Template-specific: tickets
  it("ticket model file exists", async () => {
    expect(
      await fileExists(join(projectDir, "app/models/ticket.model.ts")),
    ).toBe(true);
  });

  it("tickets index API route exists", async () => {
    expect(
      await fileExists(
        join(projectDir, "app/routes/tickets/index.api.ts"),
      ),
    ).toBe(true);
  });

  it("tickets [id] API route exists", async () => {
    expect(
      await fileExists(
        join(projectDir, "app/routes/tickets/[id].api.ts"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: running dev server against the scaffolded project
// ---------------------------------------------------------------------------

describe("Dev server serving scaffolded project", () => {
  it("built-in health endpoint responds with ok", async () => {
    const res = await fetch(`${baseUrl()}/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("agent manifest lists ticket-related capabilities", async () => {
    const res = await fetch(`${baseUrl()}/.well-known/capstan.json`);
    expect(res.status).toBe(200);

    const manifest = (await res.json()) as {
      capabilities: Array<{
        key: string;
        endpoint: { method: string; path: string };
      }>;
    };

    // Should have capabilities for the tickets API
    const ticketCapabilities = manifest.capabilities.filter(
      (c) =>
        c.endpoint.path === "/tickets" ||
        c.endpoint.path === "/tickets/:id",
    );
    expect(ticketCapabilities.length).toBeGreaterThan(0);

    // Should include both GET and POST for /tickets
    const ticketsGetCap = manifest.capabilities.find(
      (c) =>
        c.endpoint.method === "GET" && c.endpoint.path === "/tickets",
    );
    expect(ticketsGetCap).toBeDefined();
  });

  it("tickets list API route responds", async () => {
    const res = await fetch(`${baseUrl()}/tickets`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      tickets: Array<{ id: string; title: string }>;
    };
    expect(body.tickets).toBeDefined();
    expect(Array.isArray(body.tickets)).toBe(true);
  });

  it("ticket by ID API route responds", async () => {
    const res = await fetch(`${baseUrl()}/tickets/1`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      id: string;
      title: string;
      status: string;
    };
    expect(body.id).toBe("1");
    expect(body.title).toBeTruthy();
  });

  it("OpenAPI spec includes ticket paths", async () => {
    const res = await fetch(`${baseUrl()}/openapi.json`);
    expect(res.status).toBe(200);

    const spec = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toBe("3.1.0");

    // Should have ticket-related paths
    const pathKeys = Object.keys(spec.paths);
    const ticketPaths = pathKeys.filter((p) => p.includes("ticket"));
    expect(ticketPaths.length).toBeGreaterThan(0);
  });

  it("page routes are served as HTML", async () => {
    const res = await fetch(`${baseUrl()}/`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("<");
    expect(html.toLowerCase()).toContain("html");
  });
});

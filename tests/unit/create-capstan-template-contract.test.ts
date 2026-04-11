import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { deployOptions, templateOptions } from "../../packages/create-capstan/src/options.ts";
import { scaffoldProject } from "../../packages/create-capstan/src/scaffold.ts";
import {
  agentsMd,
  indexPage,
  mainCss,
  packageJson,
} from "../../packages/create-capstan/src/templates.ts";

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

describe("create-capstan scaffold contract", () => {
  it("exports friendly template and deploy options with descriptive hints", () => {
    expect(templateOptions).toEqual([
      {
        value: "blank",
        label: "Blank launchpad",
        hint: "One page, one API route, one clean place to start.",
      },
      {
        value: "tickets",
        label: "Tickets example",
        hint: "CRUD routes, auth, database, and a realistic Capstan reference.",
      },
    ]);

    expect(deployOptions.map((option) => option.value)).toEqual([
      "none",
      "docker",
      "vercel-node",
      "vercel-edge",
      "cloudflare",
      "fly",
    ]);
    expect(deployOptions.every((option) => option.hint && option.hint.length > 10)).toBe(true);
  });

  it("pins scaffolded Capstan packages to the current version line", () => {
    const pkg = JSON.parse(packageJson("hello-world", "tickets")) as {
      dependencies: Record<string, string>;
    };

    expect(pkg.dependencies["@zauso-ai/capstan-cli"]).toBe("^0.3.0");
    expect(pkg.dependencies["@zauso-ai/capstan-auth"]).toBe("^0.3.0");
    expect(pkg.dependencies["@zauso-ai/capstan-db"]).toBe("^0.3.0");
    expect(pkg.dependencies.zod).toBe("^4.0.0");
  });

  it("renders a friendlier blank starter page with actionable Capstan links", () => {
    const page = indexPage("Orbit Desk", "orbit-desk", "blank");

    expect(page).toContain("Make Orbit Desk feel like a product on day one.");
    expect(page).toContain("Capstan starter · Blank launchpad");
    expect(page).toContain("Launch deck");
    expect(page).toContain("One route, four surfaces");
    expect(page).toContain('href="/.well-known/capstan.json"');
    expect(page).toContain('href="/openapi.json"');
    expect(page).toContain('href="/health"');
    expect(page).toContain("capstan add api hello");
    expect(page).toContain("AGENTS.md");
  });

  it("renders a tickets starter page that points agents toward the reference flow", () => {
    const page = indexPage("Ticket Garden", "ticket-garden", "tickets");

    expect(page).toContain("Capstan starter · Tickets reference app");
    expect(page).toContain("Make Ticket Garden feel like a product on day one.");
    expect(page).toContain("Template briefing");
    expect(page).toContain("app/routes/tickets/index.api.ts");
    expect(page).toContain("app/models/ticket.model.ts");
    expect(page).toContain("capstan verify --json");
  });

  it("ships intentional starter CSS instead of a flat default page style", () => {
    const css = mainCss();

    expect(css).toContain("--paper");
    expect(css).toContain(".landing-stage");
    expect(css).toContain(".launch-deck");
    expect(css).toContain(".feature-grid");
    expect(css).toContain("radial-gradient");
    expect(css).toContain("@keyframes drift");
    expect(css).toContain("Iowan Old Style");
  });

  it("generates an AGENTS guide that teaches the Capstan golden path", () => {
    const guide = agentsMd("orbit-desk", "blank");

    expect(guide).toContain("# AGENTS.md — Capstan Operating Guide");
    expect(guide).toContain("## Start Here");
    expect(guide).toContain("A single `defineAPI()` becomes **HTTP + MCP + A2A + OpenAPI**.");
    expect(guide).toContain("capstan verify --json");
    expect(guide).toContain("capstan add api orders");
    expect(guide).toContain("app/public/` is served from the root URL path");
    expect(guide).toContain("Do not hand-edit `dist/`");
  });

  it("adds template-specific AGENTS guidance for the tickets starter", () => {
    const guide = agentsMd("orbit-desk", "tickets");

    expect(guide).toContain("This app was scaffolded from the **tickets** template.");
    expect(guide).toContain("app/routes/tickets/index.api.ts");
    expect(guide).toContain("app/routes/tickets/[id].api.ts");
    expect(guide).toContain("app/models/ticket.model.ts");
  });

  it("writes the upgraded landing page and AGENTS guide into scaffolded projects", async () => {
    const outputDir = await createTempDir("capstan-scaffold-contract-");

    await scaffoldProject({
      projectName: "storyboard",
      template: "blank",
      outputDir,
    });

    const page = await readFile(join(outputDir, "app/routes/index.page.tsx"), "utf-8");
    const guide = await readFile(join(outputDir, "AGENTS.md"), "utf-8");

    expect(page).toContain("Make Storyboard feel like a product on day one.");
    expect(page).toContain("Launch deck");
    expect(page).toContain("Command rail");
    expect(guide).toContain("## Golden Paths");
    expect(guide).toContain("## Common Mistakes");
  });

  it("keeps npm-facing scaffold commands consistent", async () => {
    const cliSource = await readFile(join(process.cwd(), "packages/create-capstan/src/index.ts"), "utf-8");
    const gettingStarted = await readFile(join(process.cwd(), "docs/getting-started.md"), "utf-8");
    const apiReference = await readFile(join(process.cwd(), "docs/api-reference.md"), "utf-8");
    const templatesSource = await readFile(join(process.cwd(), "packages/create-capstan/src/templates.ts"), "utf-8");

    expect(cliSource).toContain("npx create-capstan-app my-app");
    expect(gettingStarted).toContain("npx create-capstan-app");
    expect(apiReference).toContain("npx create-capstan-app");
    expect(templatesSource).toContain("npm install @zauso-ai/capstan-ai");
  });
});

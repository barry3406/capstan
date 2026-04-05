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
        value: "agent",
        label: "Agent-first workspace",
        hint: "Capabilities, workflows, policies, memory spaces, and operator views from day one.",
      },
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

  it("pins scaffolded Capstan packages to the current beta line", () => {
    const pkg = JSON.parse(packageJson("hello-world", "tickets")) as {
      dependencies: Record<string, string>;
    };
    const agentPkg = JSON.parse(packageJson("hello-world", "agent")) as {
      dependencies: Record<string, string>;
    };

    expect(pkg.dependencies["@zauso-ai/capstan-cli"]).toBe("^1.0.0-beta.8");
    expect(pkg.dependencies["@zauso-ai/capstan-auth"]).toBe("^1.0.0-beta.8");
    expect(pkg.dependencies["@zauso-ai/capstan-db"]).toBe("^1.0.0-beta.8");
    expect(pkg.dependencies.zod).toBe("^4.0.0");
    expect(agentPkg.dependencies["@zauso-ai/capstan-ai"]).toBe("^1.0.0-beta.8");
    expect(agentPkg.dependencies["@zauso-ai/capstan-core"]).toBe("^1.0.0-beta.8");
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

  it("renders an agent-first starter page that teaches the contract graph", () => {
    const page = indexPage("Orbit Desk", "orbit-desk", "agent");

    expect(page).toContain("Capstan starter · Agent-first workspace");
    expect(page).toContain("agent contracts");
    expect(page).toContain('href="/api/agent/app"');
    expect(page).toContain("Capability layer");
    expect(page).toContain("Workflow layer");
    expect(page).toContain("Operator layer");
    expect(page).toContain("app/agent/index.ts");
    expect(page).toContain("app/agent/runtime.ts");
    expect(page).toContain("app/routes/api/agent/app.api.ts");
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

  it("adds contract-first AGENTS guidance for the agent starter", () => {
    const guide = agentsMd("orbit-desk", "agent");

    expect(guide).toContain("This app was scaffolded from the **agent** template.");
    expect(guide).toContain("app/agent/contracts.ts");
    expect(guide).toContain("app/agent/runtime.ts");
    expect(guide).toContain("app/agent/capabilities/index.ts");
    expect(guide).toContain("app/routes/api/agent/app.api.ts");
    expect(guide).toContain("contract file and keep the projection in sync");
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

  it("writes the agent-first scaffold with contract graph files and runtime adapter", async () => {
    const outputDir = await createTempDir("capstan-agent-scaffold-");

    await scaffoldProject({
      projectName: "signal-room",
      template: "agent",
      outputDir,
    });

    const page = await readFile(join(outputDir, "app/routes/index.page.tsx"), "utf-8");
    const guide = await readFile(join(outputDir, "AGENTS.md"), "utf-8");
    const app = await readFile(join(outputDir, "app/agent/index.ts"), "utf-8");
    const readme = await readFile(join(outputDir, "app/agent/README.md"), "utf-8");
    const contracts = await readFile(join(outputDir, "app/agent/contracts.ts"), "utf-8");
    const runtime = await readFile(join(outputDir, "app/agent/runtime.ts"), "utf-8");
    const pkg = JSON.parse(await readFile(join(outputDir, "package.json"), "utf-8")) as {
      dependencies: Record<string, string>;
    };
    const capabilities = await readFile(join(outputDir, "app/agent/capabilities/index.ts"), "utf-8");
    const workflows = await readFile(join(outputDir, "app/agent/workflows/index.ts"), "utf-8");
    const policies = await readFile(join(outputDir, "app/agent/policies/index.ts"), "utf-8");
    const memory = await readFile(join(outputDir, "app/agent/memory/index.ts"), "utf-8");
    const views = await readFile(join(outputDir, "app/agent/views/index.ts"), "utf-8");
    const api = await readFile(join(outputDir, "app/routes/api/agent/app.api.ts"), "utf-8");

    expect(page).toContain("Capstan starter · Agent-first workspace");
    expect(page).toContain("Inspect agent graph");
    expect(page).toContain("Capability layer");
    expect(page).toContain("app/agent/README.md");
    expect(page).toContain("app/agent/capabilities/index.ts");
    expect(page).toContain("app/routes/api/agent/app.api.ts");
    expect(guide).toContain("app/agent/contracts.ts");
    expect(guide).toContain("app/agent/README.md");
    expect(guide).toContain("app/agent/runtime.ts");
    expect(guide).toContain("app/routes/api/agent/app.api.ts");
    expect(readme).toContain("# Agent App Guide");
    expect(readme).toContain("Golden Path");
    expect(readme).toContain("app/agent/capabilities/index.ts");
    expect(readme).toContain("app/routes/api/agent/app.api.ts");
    expect(pkg.dependencies["@zauso-ai/capstan-ai"]).toBe("^1.0.0-beta.8");
    expect(app).toContain("defineAgentApp");
    expect(app).toContain("agentAppSummary");
    expect(contracts).toContain('from "@zauso-ai/capstan-ai"');
    expect(contracts).toContain("summarizeAgentApp");
    expect(contracts).toContain("defineCapability");
    expect(contracts).toContain("defineOperatorView");
    expect(contracts).not.toContain("export function summarizeAgentApp");
    expect(runtime).toContain("createAgentRuntime");
    expect(runtime).toContain("@zauso-ai/capstan-ai");
    expect(capabilities).toContain("inspect-mailbox");
    expect(workflows).toContain("triage-loop");
    expect(policies).toContain("require-review");
    expect(memory).toContain("project-memory");
    expect(views).toContain("command-center");
    expect(api).toContain("Inspect the agent app contract graph");
    expect(api).toContain("agentAppSummary");
  });

  it("keeps npm-facing scaffold commands on the beta channel", async () => {
    const cliSource = await readFile(join(process.cwd(), "packages/create-capstan/src/index.ts"), "utf-8");
    const gettingStarted = await readFile(join(process.cwd(), "docs/getting-started.md"), "utf-8");
    const frameworkGuide = await readFile(join(process.cwd(), "docs/agent-framework.md"), "utf-8");
    const apiReference = await readFile(join(process.cwd(), "docs/api-reference.md"), "utf-8");
    const readme = await readFile(join(process.cwd(), "README.md"), "utf-8");
    const templatesSource = await readFile(join(process.cwd(), "packages/create-capstan/src/templates.ts"), "utf-8");

    expect(cliSource).toContain("npx create-capstan-app@beta my-app");
    expect(cliSource).toContain("my-agent --template agent");
    expect(gettingStarted).toContain("npx create-capstan-app@beta my-app --template blank");
    expect(gettingStarted).toContain("npx create-capstan-app@beta my-agent --template agent");
    expect(gettingStarted).toContain("Agent Framework Guide");
    expect(frameworkGuide).toContain("## Golden Path");
    expect(frameworkGuide).toContain("## The Five Contracts");
    expect(apiReference).toContain("npx create-capstan-app@beta my-app --template tickets");
    expect(readme).toContain("[Agent Framework Guide](docs/agent-framework.md)");
    expect(templatesSource).toContain("npm install @zauso-ai/capstan-ai@beta");
  });
});

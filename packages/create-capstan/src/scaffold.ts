import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  packageJson,
  tsconfig,
  capstanConfig,
  rootLayout,
  indexPage,
  healthApi,
  policiesIndex,
  gitignore,
  dockerfile,
  flyDockerfile,
  dockerignore,
  envExample,
  flyToml,
  vercelConfig,
  wranglerConfig,
  agentsMd,
  mainCss,
  ticketModel,
  ticketsIndexApi,
  ticketByIdApi,
} from "./templates.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a slug like "my-capstan-app" to a title like "My Capstan App". */
function toTitle(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface FileEntry {
  path: string;
  content: string;
}

async function writeFiles(
  outputDir: string,
  files: FileEntry[],
): Promise<void> {
  // Collect every unique directory we need to create
  const dirs = new Set<string>();
  for (const file of files) {
    const fullPath = join(outputDir, file.path);
    dirs.add(join(fullPath, ".."));
  }

  // Create directories (recursive so order doesn't matter)
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  // Write files
  for (const file of files) {
    await writeFile(join(outputDir, file.path), file.content, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function scaffoldProject(config: {
  projectName: string;
  template: "blank" | "tickets";
  outputDir: string;
  deployTarget?: "docker" | "vercel-node" | "vercel-edge" | "cloudflare" | "fly";
}): Promise<void> {
  const { projectName, template, outputDir, deployTarget } = config;
  const title = toTitle(projectName);

  // Files shared by every template
  const files: FileEntry[] = [
    { path: "package.json", content: packageJson(projectName, template) },
    { path: "tsconfig.json", content: tsconfig() },
    { path: "capstan.config.ts", content: capstanConfig(projectName, title, template) },
    { path: "app/routes/_layout.tsx", content: rootLayout(title) },
    { path: "app/routes/index.page.tsx", content: indexPage(title, projectName, template) },
    { path: "app/routes/api/health.api.ts", content: healthApi() },
    { path: "app/policies/index.ts", content: policiesIndex() },
    { path: ".gitignore", content: gitignore() },
    { path: "AGENTS.md", content: agentsMd(projectName, template) },
    { path: "app/styles/main.css", content: mainCss() },
  ];

  // Template-specific files
  if (template === "tickets") {
    files.push(
      { path: "app/models/ticket.model.ts", content: ticketModel() },
      { path: "app/routes/tickets/index.api.ts", content: ticketsIndexApi() },
      { path: "app/routes/tickets/[id].api.ts", content: ticketByIdApi() },
    );
  }

  if (deployTarget === "docker") {
    files.push(
      { path: "Dockerfile", content: dockerfile() },
      { path: ".dockerignore", content: dockerignore() },
      { path: ".env.example", content: envExample() },
    );
  }

  if (deployTarget === "vercel-node" || deployTarget === "vercel-edge") {
    files.push(
      { path: "vercel.json", content: vercelConfig(deployTarget) },
      { path: ".env.example", content: envExample() },
    );
  }

  if (deployTarget === "cloudflare") {
    files.push(
      { path: "wrangler.toml", content: wranglerConfig(projectName) },
      { path: ".env.example", content: envExample() },
    );
  }

  if (deployTarget === "fly") {
    files.push(
      { path: "Dockerfile", content: flyDockerfile() },
      { path: ".dockerignore", content: dockerignore() },
      { path: "fly.toml", content: flyToml(projectName) },
      { path: ".env.example", content: envExample() },
    );
  }

  // Ensure the empty directories the spec calls for exist even when no files
  // land in them (e.g. models/ and migrations/ for the blank template).
  const emptyDirs = ["app/models", "app/migrations"];
  for (const dir of emptyDirs) {
    await mkdir(join(outputDir, dir), { recursive: true });
  }

  await writeFiles(outputDir, files);

  console.log(
    `\n  Scaffolded "${projectName}" with the "${template}" template${deployTarget ? ` (+ ${deployTarget} deploy files)` : ""}.`,
  );
}

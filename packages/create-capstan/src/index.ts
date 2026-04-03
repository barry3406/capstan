#!/usr/bin/env node

import { runPrompts, prompt, select, confirmPrompt } from "./prompts.js";
import { scaffoldProject } from "./scaffold.js";
import { join } from "node:path";
import { execSync } from "node:child_process";
import * as p from "@clack/prompts";
import pc from "picocolors";

// ---------------------------------------------------------------------------
// CLI argument parsing (no external deps)
// ---------------------------------------------------------------------------

const VALID_TEMPLATES = ["blank", "tickets"] as const;
type Template = (typeof VALID_TEMPLATES)[number];
const VALID_DEPLOY_TARGETS = [
  "none",
  "docker",
  "vercel-node",
  "vercel-edge",
  "cloudflare",
  "fly",
] as const;
type DeployTarget = (typeof VALID_DEPLOY_TARGETS)[number];

function printHelp(): void {
  console.log(`
${pc.bold("Usage:")} create-capstan-app [project-name] [options]

${pc.bold("Options:")}
  ${pc.cyan("--template, -t")} <name>   Template to use (blank, tickets)
  ${pc.cyan("--deploy")} <target>       Deployment files to generate (none, docker, vercel-node, vercel-edge, cloudflare, fly)
  ${pc.cyan("--install")}              Auto-install dependencies after scaffolding
  ${pc.cyan("--no-install")}           Skip dependency install prompt
  ${pc.cyan("--help, -h")}             Show this help message

${pc.bold("Examples:")}
  npx create-capstan-app
  npx create-capstan-app my-app
  npx create-capstan-app my-app --template tickets
  npx create-capstan-app my-app --template tickets --deploy docker
  npx create-capstan-app my-app --template tickets --deploy vercel-node
  npx create-capstan-app my-app --template tickets --install
`);
}

function parseArgs(argv: string[]): {
  projectName: string | undefined;
  template: Template | undefined;
  deploy: DeployTarget | undefined;
  help: boolean;
  install: boolean | undefined;
} {
  let projectName: string | undefined;
  let template: Template | undefined;
  let deploy: DeployTarget | undefined;
  let help = false;
  let install: boolean | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--install") {
      install = true;
      continue;
    }

    if (arg === "--no-install") {
      install = false;
      continue;
    }

    if (arg === "--template" || arg === "-t") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        if (VALID_TEMPLATES.includes(next as Template)) {
          template = next as Template;
        } else {
          console.error(
            pc.red(`  Error: unknown template "${next}". Valid templates: ${VALID_TEMPLATES.join(", ")}`),
          );
          process.exit(1);
        }
        i++; // skip the value
      } else {
        console.error(pc.red("  Error: --template requires a value"));
        process.exit(1);
      }
      continue;
    }

    if (arg === "--deploy") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        if (VALID_DEPLOY_TARGETS.includes(next as DeployTarget)) {
          deploy = next as DeployTarget;
        } else {
          console.error(
            pc.red(`  Error: unknown deploy target "${next}". Valid targets: ${VALID_DEPLOY_TARGETS.join(", ")}`),
          );
          process.exit(1);
        }
        i++;
      } else {
        console.error(pc.red("  Error: --deploy requires a value"));
        process.exit(1);
      }
      continue;
    }

    // Unknown flag
    if (arg.startsWith("-")) {
      console.error(pc.red(`  Error: unknown option "${arg}"`));
      printHelp();
      process.exit(1);
    }

    // Positional argument = project name
    if (!projectName) {
      projectName = arg;
    }
  }

  return { projectName, template, deploy, help, install };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const {
    projectName: argName,
    template: argTemplate,
    deploy: argDeploy,
    help,
    install: argInstall,
  } = parseArgs(
    process.argv.slice(2),
  );

  if (help) {
    printHelp();
    process.exit(0);
  }

  p.intro(pc.bold("Create Capstan App"));

  let projectName: string;
  let template: Template;
  let deploy: DeployTarget;

  if (argName && argTemplate) {
    // Fully non-interactive
    projectName = argName;
    template = argTemplate;
    deploy = argDeploy ?? "none";
  } else if (argName) {
    // Have name, still need template
    projectName = argName;
    const chosen = await select("Which template?", [...VALID_TEMPLATES]);
    template = chosen as Template;
    deploy = argDeploy ?? (await select("Deployment target?", [...VALID_DEPLOY_TARGETS]) as DeployTarget);
  } else {
    // Fully interactive
    const answers = await runPrompts();
    projectName = answers.projectName;
    template = answers.template;
    deploy = argDeploy ?? answers.deploy;
  }

  const outputDir = join(process.cwd(), projectName);

  await scaffoldProject({
    projectName,
    template,
    outputDir,
    ...(deploy !== "none" ? { deployTarget: deploy } : {}),
  });

  // Auto-install option
  let shouldInstall = argInstall;

  if (shouldInstall === undefined) {
    shouldInstall = await confirmPrompt("Install dependencies?");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isBun = typeof (globalThis as any).Bun !== "undefined";
  const installCmd = isBun ? "bun install" : "npm install";
  const runCmd = isBun ? "bun run" : "npx";

  if (shouldInstall) {
    const s = p.spinner();
    s.start("Installing dependencies...");
    try {
      execSync(installCmd, { cwd: outputDir, stdio: "ignore" });
      s.stop(pc.green("Dependencies installed."));
    } catch {
      s.stop(pc.red("Failed to install dependencies."));
      p.log.warn(`Run ${pc.cyan(installCmd)} manually in the project directory.`);
    }
  }

  console.log("");
  p.note(
    [
      `cd ${projectName}`,
      ...(shouldInstall ? [] : [installCmd]),
      `${runCmd} capstan dev`,
      `${runCmd} capstan build --target node-standalone`,
      ...(deploy === "docker" ? ["docker build -t " + projectName + " ."] : []),
      ...(deploy === "vercel-node" ? ["vercel"] : []),
      ...(deploy === "vercel-edge" ? ["vercel"] : []),
      ...(deploy === "cloudflare" ? ["wrangler deploy"] : []),
      ...(deploy === "fly" ? ["fly deploy"] : []),
    ].join("\n"),
    "Next steps",
  );

  p.outro(pc.green("Your app is ready!"));
}

main().catch(console.error);

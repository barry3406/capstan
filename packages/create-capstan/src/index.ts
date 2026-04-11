#!/usr/bin/env node

import { runPrompts, select, confirmPrompt } from "./prompts.js";
import { scaffoldProject } from "./scaffold.js";
import { detectPackageManagerRuntime, runInstallCommand } from "./package-manager.js";
import {
  deployOptions,
  templateOptions,
  validDeployTargets,
  validTemplates,
  type DeployTarget,
  type Template,
} from "./options.js";
import { join } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";

// ---------------------------------------------------------------------------
// CLI argument parsing (no external deps)
// ---------------------------------------------------------------------------

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
        if (validTemplates.includes(next as Template)) {
          template = next as Template;
        } else {
          console.error(
            pc.red(`  Error: unknown template "${next}". Valid templates: ${validTemplates.join(", ")}`),
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
        if (validDeployTargets.includes(next as DeployTarget)) {
          deploy = next as DeployTarget;
        } else {
          console.error(
            pc.red(`  Error: unknown deploy target "${next}". Valid targets: ${validDeployTargets.join(", ")}`),
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

  p.intro(`${pc.bold("Create Capstan App")} ${pc.dim("· operable by default, pleasant from minute one")}`);

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
    const chosen = await select("What kind of starting point do you want?", templateOptions);
    template = chosen as Template;
    deploy = argDeploy ?? (await select("Do you want deployment files from day one?", deployOptions) as DeployTarget);
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

  const runtime = detectPackageManagerRuntime();
  const installCmd = runtime.installCommand.display;
  const runCmd = runtime.runCommand;
  const devCmd = runtime.devCommand;

  if (shouldInstall) {
    p.log.step(`Running ${pc.cyan(installCmd)} in ${pc.bold(projectName)}. This can take a minute on a fresh machine.`);
    try {
      await runInstallCommand(outputDir, runtime.installCommand);
      p.log.success(pc.green("Dependencies installed."));
    } catch (error) {
      p.log.error(pc.red("Failed to install dependencies."));
      if (error instanceof Error && error.message) {
        p.log.warn(error.message);
      }
      p.log.warn(`Run ${pc.cyan(installCmd)} manually in the project directory.`);
    }
  }

  console.log("");
  const firstFiles = template === "tickets"
    ? [
        "app/routes/index.page.tsx",
        "app/routes/tickets/index.api.ts",
        "app/models/ticket.model.ts",
        "AGENTS.md",
      ]
    : [
        "app/routes/index.page.tsx",
        "app/routes/api/health.api.ts",
        "app/policies/index.ts",
        "AGENTS.md",
      ];
  p.note(
    [
      "Try it",
      `cd ${projectName}`,
      ...(shouldInstall ? [] : [installCmd]),
      devCmd,
      "",
      "Open these",
      "http://localhost:3000/",
      "http://localhost:3000/.well-known/capstan.json",
      "http://localhost:3000/openapi.json",
      "",
      "Edit these first",
      ...firstFiles,
      "",
      "Ship path",
      `${runCmd} capstan build --target node-standalone`,
      ...(deploy === "docker" ? ["docker build -t " + projectName + " ."] : []),
      ...(deploy === "vercel-node" ? ["vercel"] : []),
      ...(deploy === "vercel-edge" ? ["vercel"] : []),
      ...(deploy === "cloudflare" ? ["wrangler deploy"] : []),
      ...(deploy === "fly" ? ["fly deploy"] : []),
    ].join("\n"),
    "Your first five minutes",
  );

  p.outro(pc.green(`"${projectName}" is ready. Build something agents can operate.`));
}

main().catch(console.error);

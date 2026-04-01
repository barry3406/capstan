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

function printHelp(): void {
  console.log(`
${pc.bold("Usage:")} create-capstan-app [project-name] [options]

${pc.bold("Options:")}
  ${pc.cyan("--template, -t")} <name>   Template to use (blank, tickets)
  ${pc.cyan("--install")}              Auto-install dependencies after scaffolding
  ${pc.cyan("--no-install")}           Skip dependency install prompt
  ${pc.cyan("--help, -h")}             Show this help message

${pc.bold("Examples:")}
  npx create-capstan-app
  npx create-capstan-app my-app
  npx create-capstan-app my-app --template tickets
  npx create-capstan-app my-app --template tickets --install
`);
}

function parseArgs(argv: string[]): {
  projectName: string | undefined;
  template: Template | undefined;
  help: boolean;
  install: boolean | undefined;
} {
  let projectName: string | undefined;
  let template: Template | undefined;
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

  return { projectName, template, help, install };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { projectName: argName, template: argTemplate, help, install: argInstall } = parseArgs(
    process.argv.slice(2),
  );

  if (help) {
    printHelp();
    process.exit(0);
  }

  p.intro(pc.bold("Create Capstan App"));

  let projectName: string;
  let template: Template;

  if (argName && argTemplate) {
    // Fully non-interactive
    projectName = argName;
    template = argTemplate;
  } else if (argName) {
    // Have name, still need template
    projectName = argName;
    const chosen = await select("Which template?", [...VALID_TEMPLATES]);
    template = chosen as Template;
  } else {
    // Fully interactive
    const answers = await runPrompts();
    projectName = answers.projectName;
    template = answers.template;
  }

  const outputDir = join(process.cwd(), projectName);

  await scaffoldProject({ projectName, template, outputDir });

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
    ].join("\n"),
    "Next steps",
  );

  p.outro(pc.green("Your app is ready!"));
}

main().catch(console.error);

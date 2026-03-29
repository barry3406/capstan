#!/usr/bin/env node

import { runPrompts, prompt, select } from "./prompts.js";
import { scaffoldProject } from "./scaffold.js";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// CLI argument parsing (no external deps)
// ---------------------------------------------------------------------------

const VALID_TEMPLATES = ["blank", "tickets"] as const;
type Template = (typeof VALID_TEMPLATES)[number];

function printHelp(): void {
  console.log(`
Usage: create-capstan-app [project-name] [options]

Options:
  --template, -t <name>   Template to use (blank, tickets)
  --help, -h              Show this help message

Examples:
  npx create-capstan-app
  npx create-capstan-app my-app
  npx create-capstan-app my-app --template tickets
`);
}

function parseArgs(argv: string[]): {
  projectName: string | undefined;
  template: Template | undefined;
  help: boolean;
} {
  let projectName: string | undefined;
  let template: Template | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--template" || arg === "-t") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        if (VALID_TEMPLATES.includes(next as Template)) {
          template = next as Template;
        } else {
          console.error(
            `  Error: unknown template "${next}". Valid templates: ${VALID_TEMPLATES.join(", ")}`,
          );
          process.exit(1);
        }
        i++; // skip the value
      } else {
        console.error("  Error: --template requires a value");
        process.exit(1);
      }
      continue;
    }

    // Unknown flag
    if (arg.startsWith("-")) {
      console.error(`  Error: unknown option "${arg}"`);
      printHelp();
      process.exit(1);
    }

    // Positional argument = project name
    if (!projectName) {
      projectName = arg;
    }
  }

  return { projectName, template, help };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { projectName: argName, template: argTemplate, help } = parseArgs(
    process.argv.slice(2),
  );

  if (help) {
    printHelp();
    process.exit(0);
  }

  console.log("\n  Create Capstan App\n");

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

  console.log(`\n  Project created at ./${projectName}\n`);
  console.log("  Next steps:");
  console.log(`    cd ${projectName}`);
  console.log("    npm install");
  console.log("    npx capstan dev\n");
}

main().catch(console.error);

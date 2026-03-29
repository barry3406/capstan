#!/usr/bin/env node

import { runPrompts } from "./prompts.js";
import { scaffoldProject } from "./scaffold.js";
import { join } from "node:path";

async function main() {
  console.log("\n  Create Capstan App\n");

  const { projectName, template } = await runPrompts();
  const outputDir = join(process.cwd(), projectName);

  await scaffoldProject({ projectName, template, outputDir });

  console.log(`\n  Project created at ./${projectName}\n`);
  console.log("  Next steps:");
  console.log(`    cd ${projectName}`);
  console.log("    npm install");
  console.log("    npx capstan dev\n");
}

main().catch(console.error);

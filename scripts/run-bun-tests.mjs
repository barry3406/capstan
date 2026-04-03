import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";

function collectTestFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        files.push(relative(process.cwd(), fullPath).replace(/\\/g, "/"));
      }
    }
  }

  return files.sort();
}

const cliTestFiles = process.argv.slice(2);
const testFiles = cliTestFiles.length > 0
  ? cliTestFiles
  : collectTestFiles(join(process.cwd(), "tests"));

if (testFiles.length === 0) {
  console.error("[capstan] No test files found under tests/.");
  process.exit(1);
}

const child = spawn("bun", ["test", ...testFiles], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

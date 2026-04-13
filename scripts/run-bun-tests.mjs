import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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
        // Skip real-LLM e2e tests from default run (use npm run test:llm)
        const rel = relative(process.cwd(), fullPath).replace(/\\/g, "/");
        if (rel === "tests/e2e/llm") continue;
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

const coverageFlag = process.env.CAPSTAN_COVERAGE === "1"
  ? ["--coverage", "--coverage-reporter=lcov"]
  : [];

const child = spawn("bun", ["test", ...coverageFlag, ...testFiles], {
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

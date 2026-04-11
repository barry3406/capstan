import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const benchmarkEntry = join(rootDir, "benchmarks", "run.ts");
const workspaceTsconfig = join(rootDir, "tsconfig.workspace-sources.json");

const child = spawn(
  process.execPath,
  ["--expose-gc", "--import", "tsx", benchmarkEntry, ...process.argv.slice(2)],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: workspaceTsconfig,
    },
  },
);

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});

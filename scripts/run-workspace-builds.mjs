import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceBuildOrder = [
  { name: "@zauso-ai/capstan-core", dir: "packages/core" },
  { name: "@zauso-ai/capstan-router", dir: "packages/router" },
  { name: "@zauso-ai/capstan-db", dir: "packages/db" },
  { name: "@zauso-ai/capstan-auth", dir: "packages/auth" },
  { name: "@zauso-ai/capstan-ai", dir: "packages/ai" },
  { name: "@zauso-ai/capstan-cron", dir: "packages/cron" },
  { name: "@zauso-ai/capstan-agent", dir: "packages/agent" },
  { name: "@zauso-ai/capstan-react", dir: "packages/react" },
  { name: "@zauso-ai/capstan-ops", dir: "packages/ops" },
  { name: "@zauso-ai/capstan-dev", dir: "packages/dev" },
  { name: "@zauso-ai/capstan-cli", dir: "packages/cli" },
  { name: "create-capstan-app", dir: "packages/create-capstan" },
];

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runWorkspaceBuild(workspace) {
  return new Promise((resolve, reject) => {
    const workspaceDir = join(rootDir, workspace.dir);
    if (!existsSync(workspaceDir)) {
      console.log(`[capstan] Skipping ${workspace.name} (missing ${workspace.dir})`);
      resolve();
      return;
    }

    const child = spawn(npmCommand, ["run", "build"], {
      cwd: workspaceDir,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Build for ${workspace.name} was terminated by signal ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Build for ${workspace.name} failed with exit code ${code ?? "unknown"}.`));
        return;
      }

      resolve();
    });
  });
}

for (const workspace of workspaceBuildOrder) {
  console.log(`[capstan] Building ${workspace.name}...`);
  await runWorkspaceBuild(workspace);
}

console.log(`[capstan] Built ${workspaceBuildOrder.length} workspaces successfully.`);

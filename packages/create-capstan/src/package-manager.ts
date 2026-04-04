import { spawn } from "node:child_process";

export interface PackageManagerRuntime {
  installCommand: {
    command: string;
    args: string[];
    display: string;
  };
  runCommand: string;
  devCommand: string;
}

export function detectPackageManagerRuntime(
  isBun = typeof (globalThis as typeof globalThis & { Bun?: unknown }).Bun !== "undefined",
): PackageManagerRuntime {
  if (isBun) {
    return {
      installCommand: {
        command: "bun",
        args: ["install"],
        display: "bun install",
      },
      runCommand: "bun run",
      devCommand: "bun run capstan dev",
    };
  }

  return {
    installCommand: {
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      args: ["install"],
      display: "npm install",
    },
    runCommand: "npx",
    devCommand: "npx capstan dev",
  };
}

export async function runInstallCommand(
  cwd: string,
  installCommand: PackageManagerRuntime["installCommand"],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(installCommand.command, installCommand.args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal
        ? `terminated by signal ${signal}`
        : `exited with code ${code ?? "unknown"}`;
      reject(new Error(`Install command "${installCommand.display}" ${reason}.`));
    });
  });
}

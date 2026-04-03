import { spawn } from "node:child_process";

import type { AgentTask } from "../types.js";

export interface ShellTaskOptions {
  name: string;
  description?: string;
  command:
    | string
    | string[]
    | ((args: Record<string, unknown>) => string | string[]);
  cwd?: string | ((args: Record<string, unknown>) => string | undefined);
  env?:
    | Record<string, string>
    | ((args: Record<string, unknown>) => Record<string, string> | undefined);
  timeoutMs?: number;
  shell?: boolean;
  isConcurrencySafe?: boolean;
  failureMode?: "soft" | "hard";
}

export function createShellTask(options: ShellTaskOptions): AgentTask {
  return {
    name: options.name,
    description: options.description ?? `Runs shell command for ${options.name}`,
    kind: "shell",
    isConcurrencySafe: options.isConcurrencySafe,
    failureMode: options.failureMode,
    async execute(args, context) {
      throwIfTaskAborted(context.signal);
      const command = resolveCommand(options.command, args);
      assertValidCommand(options.name, command);
      const cwd = typeof options.cwd === "function" ? options.cwd(args) : options.cwd;
      const env = {
        ...process.env,
        ...(typeof options.env === "function" ? options.env(args) : options.env),
      };

      return new Promise((resolve, reject) => {
        let settled = false;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const child = Array.isArray(command)
          ? spawn(command[0]!, command.slice(1), {
              cwd,
              env,
              signal: context.signal,
              shell: options.shell ?? false,
            })
          : spawn(command, [], {
              cwd,
              env,
              signal: context.signal,
              shell: options.shell ?? true,
            });

        let stdout = "";
        let stderr = "";
        const timer =
          options.timeoutMs != null
            ? setTimeout(() => {
                settle(
                  "reject",
                  new Error(
                    `Shell task ${options.name} timed out after ${options.timeoutMs}ms`,
                  ),
                );
                killTimer = terminateChild(child);
              }, options.timeoutMs)
            : undefined;

        const settle = (
          mode: "resolve" | "reject",
          value: unknown,
        ): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (timer) {
            clearTimeout(timer);
          }
          if (killTimer) {
            clearTimeout(killTimer);
            killTimer = undefined;
          }
          if (mode === "resolve") {
            resolve(value);
            return;
          }
          reject(value);
        };

        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr?.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", (error) => {
          settle("reject", error);
        });
        child.on("close", (code, signal) => {
          if (code !== 0) {
            settle(
              "reject",
              new Error(
                `Shell task ${options.name} failed with exit code ${code ?? "null"}${signal ? ` (${signal})` : ""}: ${stderr || stdout || "no output"}`,
              ),
            );
            return;
          }
          settle("resolve", {
            command,
            cwd,
            stdout,
            stderr,
            exitCode: code ?? 0,
            signal: signal ?? undefined,
          });
        });
      });
    },
  };
}

function resolveCommand(
  command: ShellTaskOptions["command"],
  args: Record<string, unknown>,
): string | string[] {
  return typeof command === "function" ? command(args) : command;
}

function assertValidCommand(name: string, command: string | string[]): void {
  if (Array.isArray(command)) {
    if (command.length === 0 || !command[0]?.trim()) {
      throw new Error(`Shell task ${name} requires a non-empty command`);
    }
    return;
  }
  if (!command.trim()) {
    throw new Error(`Shell task ${name} requires a non-empty command`);
  }
}

function terminateChild(
  child: ReturnType<typeof spawn>,
): ReturnType<typeof setTimeout> | undefined {
  if (child.killed) {
    return undefined;
  }
  child.kill("SIGTERM");
  const killTimer = setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }, 250);
  child.once("close", () => clearTimeout(killTimer));
  return killTimer;
}

function throwIfTaskAborted(signal: AbortSignal): void {
  if (typeof signal.throwIfAborted === "function") {
    signal.throwIfAborted();
    return;
  }
  if (signal.aborted) {
    throw new Error("Task canceled");
  }
}

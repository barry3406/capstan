import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { repoRoot } from "./paths.ts";

const execFileAsync = promisify(execFile);
const tsxBinary = join(repoRoot, "node_modules/.bin/tsx");
const cliEntry = join(repoRoot, "packages/cli/src/index.ts");
const tscBinary = join(repoRoot, "node_modules/.bin/tsc");

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCapstanCli(
  args: string[],
  options: { cwd?: string } = {}
): Promise<CommandResult> {
  return runCommand(tsxBinary, [cliEntry, ...args], options.cwd ?? repoRoot);
}

export async function runTypeScriptCheck(
  tsconfigPath: string,
  options: { cwd?: string } = {}
): Promise<CommandResult> {
  return runCommand(tscBinary, ["-p", tsconfigPath, "--noEmit"], options.cwd ?? repoRoot);
}

export async function runTypeScriptBuild(
  tsconfigPath: string,
  options: { cwd?: string } = {}
): Promise<CommandResult> {
  return runCommand(tscBinary, ["-p", tsconfigPath], options.cwd ?? repoRoot);
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd
    });

    return {
      exitCode: 0,
      stdout,
      stderr
    };
  } catch (error: unknown) {
    const failed = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };

    return {
      exitCode: typeof failed.code === "number" ? failed.code : 1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? ""
    };
  }
}

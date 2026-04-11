import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

export type CSSMode = "tailwind" | "lightningcss" | "none";

/**
 * Detect CSS processing mode by examining app/styles/main.css.
 *
 * - If the file contains `@import "tailwindcss"` or `@import 'tailwindcss'`,
 *   we use the Tailwind CLI.
 * - If the file exists but does not reference Tailwind, we bundle it with
 *   Lightning CSS (vendor prefixing, nesting, @import resolution, minification).
 * - If the file does not exist, CSS processing is skipped entirely.
 */
export async function detectCSSMode(rootDir: string): Promise<CSSMode> {
  const entry = join(rootDir, "app", "styles", "main.css");
  if (!existsSync(entry)) return "none";
  const content = await readFile(entry, "utf-8");
  if (
    content.includes('@import "tailwindcss"') ||
    content.includes("@import 'tailwindcss'")
  ) {
    return "tailwind";
  }
  return "lightningcss";
}

/**
 * Build CSS using Lightning CSS (`bundleAsync`).
 *
 * Handles @import resolution, vendor prefixing, nesting, and minification.
 * Lightning CSS is loaded via dynamic import so it remains an optional
 * peer dependency -- projects that only use Tailwind (or no CSS at all)
 * do not need it installed.
 */
export async function buildCSS(
  entryFile: string,
  outFile: string,
  isDev: boolean,
): Promise<void> {
  // Dynamic import so lightningcss is optional
  const lcss = (await import("lightningcss")) as {
    bundleAsync: (opts: {
      filename: string;
      minify: boolean;
      sourceMap: boolean;
    }) => Promise<{ code: Uint8Array }>;
  };

  await mkdir(dirname(outFile), { recursive: true });

  const { code } = await lcss.bundleAsync({
    filename: entryFile,
    minify: !isDev,
    sourceMap: isDev,
  });

  await writeFile(outFile, code);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isBun = typeof (globalThis as any).Bun !== "undefined";

/**
 * Start the Tailwind CLI in watch mode as a child process.
 *
 * Returns a handle whose `stop()` method kills the child process.
 * The child is spawned with `stdio: "pipe"` so its output does not
 * pollute the dev server console.
 */
export function startTailwindWatch(
  entryFile: string,
  outFile: string,
): { stop: () => void } {
  const tailwindArgs = ["@tailwindcss/cli", "-i", entryFile, "-o", outFile, "--watch"];

  if (isBun) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const child = (globalThis as any).Bun.spawn(["bunx", ...tailwindArgs], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      stop: () => {
        child.kill();
      },
    };
  }

  // Node.js fallback
  const child = spawn(
    "npx",
    tailwindArgs,
    { stdio: "pipe", shell: true },
  );
  return {
    stop: () => {
      child.kill();
    },
  };
}

/**
 * Build Tailwind CSS for production (one-shot, with minify).
 */
export async function buildTailwind(
  entryFile: string,
  outFile: string,
): Promise<void> {
  await mkdir(dirname(outFile), { recursive: true });

  const tailwindArgs = ["@tailwindcss/cli", "-i", entryFile, "-o", outFile, "--minify"];

  if (isBun) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const child = (globalThis as any).Bun.spawn(["bunx", ...tailwindArgs], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) {
      throw new Error(`Tailwind CSS build failed with exit code ${exitCode}`);
    }
    return;
  }

  // Node.js fallback
  const execFileAsync = promisify(execFile);
  await execFileAsync("npx", tailwindArgs);
}

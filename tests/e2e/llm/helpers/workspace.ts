import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface Workspace {
  dir: string;
  cleanup(): Promise<void>;
}

/** Create an empty temporary workspace directory. */
export async function createWorkspace(prefix = "capstan-llm-"): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a workspace pre-loaded with a buggy TypeScript file and a failing test.
 * The bug: fibonacci uses n-3 instead of n-2 in the recursive case.
 */
export async function createBugFixWorkspace(): Promise<Workspace> {
  const ws = await createWorkspace("capstan-llm-bugfix-");

  await writeFile(
    join(ws.dir, "math.ts"),
    [
      "export function fibonacci(n: number): number {",
      "  if (n <= 0) return 0;",
      "  if (n === 1) return 1;",
      "  return fibonacci(n - 1) + fibonacci(n - 3); // BUG: should be n - 2",
      "}",
      "",
    ].join("\n"),
  );

  await writeFile(
    join(ws.dir, "math.test.ts"),
    [
      'import { expect, test } from "bun:test";',
      'import { fibonacci } from "./math.ts";',
      "",
      'test("fibonacci(0) = 0", () => expect(fibonacci(0)).toBe(0));',
      'test("fibonacci(1) = 1", () => expect(fibonacci(1)).toBe(1));',
      'test("fibonacci(2) = 1", () => expect(fibonacci(2)).toBe(1));',
      'test("fibonacci(5) = 5", () => expect(fibonacci(5)).toBe(5));',
      'test("fibonacci(10) = 55", () => expect(fibonacci(10)).toBe(55));',
      "",
    ].join("\n"),
  );

  return ws;
}

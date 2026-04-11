import { it, expect, afterEach } from "bun:test";
import { createSmartAgent } from "../../../packages/ai/src/index.js";
import { describeWithLLM } from "./helpers/env.js";
import { createWorkspaceTools } from "./helpers/tools.js";
import { createWorkspace, createBugFixWorkspace, type Workspace } from "./helpers/workspace.js";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Scenario layer — real filesystem + shell, 10 min timeout per case
// ---------------------------------------------------------------------------

describeWithLLM("Scenario — code generation & bug fixing", (provider) => {
  let ws: Workspace | null = null;

  afterEach(async () => {
    if (ws) {
      await ws.cleanup();
      ws = null;
    }
  });

  it("creates a function + tests from scratch and makes bun test pass", async () => {
    ws = await createWorkspace("capstan-llm-codegen-");
    const tools = createWorkspaceTools(ws.dir);

    const agent = createSmartAgent({
      llm: provider,
      tools,
      maxIterations: 30,
    });

    const result = await agent.run(
      "In the workspace, create a TypeScript file `is-prime.ts` that exports a function `isPrime(n: number): boolean` "
      + "which returns true if n is a prime number and false otherwise. Handle edge cases (n <= 1 is not prime). "
      + "Then create `is-prime.test.ts` using bun:test with at least 5 test cases including edge cases. "
      + "Finally run `bun test is-prime.test.ts` and make sure all tests pass. "
      + "If tests fail, read the error output, fix the code, and run tests again until they pass.",
    );

    expect(result.status).toBe("completed");

    // Verify files were created
    expect(existsSync(join(ws.dir, "is-prime.ts"))).toBe(true);
    expect(existsSync(join(ws.dir, "is-prime.test.ts"))).toBe(true);

    // Verify tests actually pass by running them ourselves
    const verify = spawnSync("bun", ["test", "is-prime.test.ts"], {
      cwd: ws.dir,
      timeout: 15_000,
      encoding: "utf-8",
    });
    expect(verify.status).toBe(0);

    // Verify the function is correct with spot checks
    const src = readFileSync(join(ws.dir, "is-prime.ts"), "utf-8");
    expect(src).toContain("isPrime");
  }, 600_000);

  it("reads a buggy file, diagnoses the issue, and fixes it", async () => {
    ws = await createBugFixWorkspace();
    const tools = createWorkspaceTools(ws.dir);

    const agent = createSmartAgent({
      llm: provider,
      tools,
      maxIterations: 30,
    });

    const result = await agent.run(
      "There is a bug in this workspace. The file `math.ts` has a `fibonacci` function and "
      + "`math.test.ts` has tests for it. First run `bun test math.test.ts` to see the failures. "
      + "Then read `math.ts` to find the bug, fix it, and run the tests again until they all pass.",
    );

    expect(result.status).toBe("completed");

    // Verify the fix by running tests ourselves
    const verify = spawnSync("bun", ["test", "math.test.ts"], {
      cwd: ws.dir,
      timeout: 15_000,
      encoding: "utf-8",
    });
    expect(verify.status).toBe(0);

    // Verify the bug was actually fixed (n-3 → n-2)
    const src = readFileSync(join(ws.dir, "math.ts"), "utf-8");
    expect(src).not.toContain("n - 3");
  }, 600_000);

});

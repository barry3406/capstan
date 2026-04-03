import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import type { HarnessConfig } from "@zauso-ai/capstan-ai";
import { LocalHarnessSandboxDriver } from "../../packages/ai/src/harness/runtime/local-driver.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-driver-"));
  tempDirs.push(dir);
  return dir;
}

function createConfig(patch: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    llm: {
      name: "mock",
      async chat() {
        return { content: "done", model: "mock-1" };
      },
    },
    ...patch,
  };
}

describe("LocalHarnessSandboxDriver", () => {
  it("creates an inert local context when no sandboxes are enabled", async () => {
    const rootDir = await createTempDir();
    const driver = new LocalHarnessSandboxDriver();

    const context = await driver.createContext(createConfig(), {
      runId: "run-a",
      paths: { sandboxesDir: join(rootDir, "sandboxes") },
      sandboxDir: join(rootDir, "sandboxes", "run-a"),
      artifactDir: join(rootDir, "artifacts", "run-a"),
    });

    expect(context.mode).toBe("local");
    expect(context.browser).toBeNull();
    expect(context.fs).toBeNull();
    expect(context.workspaceDir).toBeUndefined();

    await expect(context.abort?.()).resolves.toBeUndefined();
    await expect(context.destroy()).resolves.toBeUndefined();
  });

  it("creates an isolated workspace automatically when fs=true", async () => {
    const rootDir = await createTempDir();
    const driver = new LocalHarnessSandboxDriver();
    const sandboxDir = join(rootDir, "sandboxes", "run-a");

    const context = await driver.createContext(
      createConfig({ sandbox: { fs: true } }),
      {
        runId: "run-a",
        paths: { sandboxesDir: join(rootDir, "sandboxes") },
        sandboxDir,
        artifactDir: join(rootDir, "artifacts", "run-a"),
      },
    );

    expect(context.fs).not.toBeNull();
    expect(context.workspaceDir).toBe(resolve(sandboxDir, "workspace"));

    await context.fs!.write("notes/report.txt", "hello");
    expect(await context.fs!.read("notes/report.txt")).toBe("hello");
    expect(await context.fs!.exists("notes/report.txt")).toBe(true);
    expect(await context.fs!.list("notes")).toEqual(["report.txt"]);
    expect(await context.fs!.stat("notes/report.txt")).toEqual({
      size: 5,
      isDir: false,
    });
  });

  it("respects an explicit filesystem root instead of forcing the run sandbox directory", async () => {
    const rootDir = await createTempDir();
    const customRoot = join(rootDir, "custom-workspace");
    const driver = new LocalHarnessSandboxDriver();

    const context = await driver.createContext(
      createConfig({
        sandbox: {
          fs: { rootDir: customRoot, allowDelete: false },
        },
      }),
      {
        runId: "run-a",
        paths: { sandboxesDir: join(rootDir, "sandboxes") },
        sandboxDir: join(rootDir, "sandboxes", "run-a"),
        artifactDir: join(rootDir, "artifacts", "run-a"),
      },
    );

    expect(context.workspaceDir).toBe(resolve(customRoot));
    await context.fs!.write("keep.txt", "keep");
    expect(await readFile(join(customRoot, "keep.txt"), "utf8")).toBe("keep");
    await expect(context.fs!.delete("keep.txt")).rejects.toThrow(
      "Filesystem sandbox: deletes are disabled",
    );
  });

  it("supports delete operations when the explicit fs config allows them", async () => {
    const rootDir = await createTempDir();
    const customRoot = join(rootDir, "deletable-workspace");
    const driver = new LocalHarnessSandboxDriver();

    const context = await driver.createContext(
      createConfig({
        sandbox: {
          fs: { rootDir: customRoot, allowDelete: true },
        },
      }),
      {
        runId: "run-a",
        paths: { sandboxesDir: join(rootDir, "sandboxes") },
        sandboxDir: join(rootDir, "sandboxes", "run-a"),
        artifactDir: join(rootDir, "artifacts", "run-a"),
      },
    );

    await writeFile(join(customRoot, "remove.txt"), "bye", "utf8");
    expect(await context.fs!.exists("remove.txt")).toBe(true);
    await context.fs!.delete("remove.txt");
    expect(await context.fs!.exists("remove.txt")).toBe(false);
  });

  it("keeps the filesystem sandbox rooted and blocks traversal attempts", async () => {
    const rootDir = await createTempDir();
    const driver = new LocalHarnessSandboxDriver();

    const context = await driver.createContext(
      createConfig({ sandbox: { fs: true } }),
      {
        runId: "run-a",
        paths: { sandboxesDir: join(rootDir, "sandboxes") },
        sandboxDir: join(rootDir, "sandboxes", "run-a"),
        artifactDir: join(rootDir, "artifacts", "run-a"),
      },
    );

    await expect(context.fs!.write("../escape.txt", "bad")).rejects.toThrow(
      "Path traversal blocked: ../escape.txt",
    );
    await expect(context.fs!.read("../escape.txt")).rejects.toThrow(
      "Path traversal blocked: ../escape.txt",
    );
  });
});

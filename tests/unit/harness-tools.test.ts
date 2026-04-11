import { describe, expect, it } from "bun:test";

import type {
  BrowserSandbox,
  BrowserSession,
  FsSandbox,
  HarnessArtifactInput,
  HarnessArtifactRecord,
} from "@zauso-ai/capstan-ai";
import { buildHarnessTools } from "../../packages/ai/src/harness/runtime/tools.ts";

class FakeBrowserSession implements BrowserSession {
  currentUrl = "about:blank";
  clicks: Array<{ x: number; y: number }> = [];
  typed: Array<{ selector: string; text: string }> = [];
  scrolls: Array<{ direction: "up" | "down"; amount?: number }> = [];

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  }

  async screenshotElement(_selector: string): Promise<Buffer> {
    return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  }

  async evaluate<T>(_fn: string): Promise<T> {
    return undefined as T;
  }

  async click(x: number, y: number): Promise<void> {
    this.clicks.push({ x, y });
  }

  async type(selector: string, text: string): Promise<void> {
    this.typed.push({ selector, text });
  }

  async scroll(direction: "up" | "down", amount?: number): Promise<void> {
    this.scrolls.push({ direction, amount });
  }

  async waitForNavigation(_timeout?: number): Promise<void> {}

  url(): string {
    return this.currentUrl;
  }

  async close(): Promise<void> {}
}

class FakeBrowserSandbox implements BrowserSandbox {
  readonly session = new FakeBrowserSession();
  acts: Array<{ goal: string; maxSteps?: number }> = [];

  async act(goal: string, maxSteps?: number): Promise<Array<{ action: "done"; reason: string }>> {
    this.acts.push({ goal, maxSteps });
    return [{ action: "done", reason: "complete" }];
  }

  async destroy(): Promise<void> {}
}

class FakeFsSandbox implements FsSandbox {
  reads: string[] = [];
  writes: Array<{ path: string; content: string }> = [];
  lists: string[] = [];
  existsChecks: string[] = [];
  deletes: string[] = [];

  async read(path: string): Promise<string> {
    this.reads.push(path);
    return `read:${path}`;
  }

  async write(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
  }

  async list(dir = "."): Promise<string[]> {
    this.lists.push(dir);
    return ["a.txt", "b.txt"];
  }

  async exists(path: string): Promise<boolean> {
    this.existsChecks.push(path);
    return path === "exists.txt";
  }

  async delete(path: string): Promise<void> {
    this.deletes.push(path);
  }

  async stat(_path: string): Promise<{ size: number; isDir: boolean }> {
    return { size: 0, isDir: false };
  }
}

describe("buildHarnessTools", () => {
  it("returns an empty toolset when neither browser nor filesystem sandboxes are available", () => {
    expect(buildHarnessTools(null, null, async () => {
      throw new Error("should not write artifacts");
    })).toEqual([]);
  });

  it("builds the full browser toolset and persists screenshots through the artifact writer", async () => {
    const browser = new FakeBrowserSandbox();
    const artifactInputs: HarnessArtifactInput[] = [];
    const tools = buildHarnessTools(browser, null, async (input) => {
      artifactInputs.push(input);
      return {
        id: "artifact-1",
        runId: "run-a",
        kind: input.kind,
        path: "/tmp/artifact-1.png",
        createdAt: "2026-04-03T00:00:00.000Z",
        mimeType: "image/png",
        size: 4,
        metadata: input.metadata,
      } satisfies HarnessArtifactRecord;
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "browser_navigate",
      "browser_screenshot",
      "browser_click",
      "browser_type",
      "browser_scroll",
      "browser_act",
    ]);

    await tools[0]!.execute({ url: "https://example.com" });
    expect(browser.session.url()).toBe("https://example.com");

    const screenshot = await tools[1]!.execute({});
    expect(artifactInputs).toEqual([
      {
        kind: "screenshot",
        content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        extension: ".png",
        mimeType: "image/png",
        metadata: { url: "https://example.com" },
      },
    ]);
    expect(screenshot).toEqual({
      artifactId: "artifact-1",
      path: "/tmp/artifact-1.png",
      url: "https://example.com",
      mimeType: "image/png",
      size: 4,
    });

    await tools[2]!.execute({ x: 10, y: 20 });
    expect(browser.session.clicks).toEqual([{ x: 10, y: 20 }]);

    await tools[3]!.execute({ selector: "#q", text: "hello" });
    expect(browser.session.typed).toEqual([{ selector: "#q", text: "hello" }]);

    await tools[4]!.execute({});
    expect(browser.session.scrolls).toEqual([{ direction: "down", amount: undefined }]);

    const acted = await tools[5]!.execute({ goal: "finish checkout", maxSteps: 7 });
    expect(browser.acts).toEqual([{ goal: "finish checkout", maxSteps: 7 }]);
    expect(acted).toEqual({
      actions: [{ action: "done", reason: "complete" }],
      finalUrl: "https://example.com",
    });
  });

  it("builds the filesystem toolset and delegates each operation to the sandbox", async () => {
    const fs = new FakeFsSandbox();
    const tools = buildHarnessTools(null, fs, async () => {
      throw new Error("fs tools should not write artifacts");
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "fs_read",
      "fs_write",
      "fs_list",
      "fs_exists",
      "fs_delete",
    ]);

    await expect(tools[0]!.execute({ path: "notes/todo.md" })).resolves.toEqual({
      content: "read:notes/todo.md",
    });
    expect(fs.reads).toEqual(["notes/todo.md"]);

    await expect(
      tools[1]!.execute({ path: "notes/todo.md", content: "updated" }),
    ).resolves.toEqual({ written: true });
    expect(fs.writes).toEqual([{ path: "notes/todo.md", content: "updated" }]);

    await expect(tools[2]!.execute({})).resolves.toEqual({
      files: ["a.txt", "b.txt"],
    });
    expect(fs.lists).toEqual(["."]);

    await expect(tools[3]!.execute({ path: "exists.txt" })).resolves.toEqual({
      exists: true,
    });
    expect(fs.existsChecks).toEqual(["exists.txt"]);

    await expect(tools[4]!.execute({ path: "exists.txt" })).resolves.toEqual({
      deleted: true,
    });
    expect(fs.deletes).toEqual(["exists.txt"]);
  });

  it("combines browser and filesystem tools in a stable order", () => {
    const tools = buildHarnessTools(
      new FakeBrowserSandbox(),
      new FakeFsSandbox(),
      async () => {
        throw new Error("not needed");
      },
    );

    expect(tools.map((tool) => tool.name)).toEqual([
      "browser_navigate",
      "browser_screenshot",
      "browser_click",
      "browser_type",
      "browser_scroll",
      "browser_act",
      "fs_read",
      "fs_write",
      "fs_list",
      "fs_exists",
      "fs_delete",
    ]);
  });
});

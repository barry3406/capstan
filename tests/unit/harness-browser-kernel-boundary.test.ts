import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "@zauso-ai/capstan-ai";

const tempDirs: string[] = [];

afterEach(async () => {
  mock.restore();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function mockLLM(
  responses: Array<string | Error | (() => Promise<string> | string)>,
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _opts?: LLMOptions): Promise<LLMResponse> {
      const next = responses[callIndex++];
      if (next instanceof Error) {
        throw next;
      }
      const content =
        typeof next === "function" ? await next() : (next ?? "done");
      return { content, model: "mock-1" };
    },
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-harness-kernel-boundary-"));
  tempDirs.push(dir);
  return dir;
}

describe("createHarness browser/kernel boundary", () => {
  it("routes camoufox runs through the kernel adapter seam and persists screenshot artifacts", async () => {
    const kernelModuleTsPath = new URL(
      "../../packages/ai/src/harness/kernel/adapter/kernel-engine.ts",
      import.meta.url,
    ).pathname;
    const kernelModuleJsPath = kernelModuleTsPath.replace(/\.ts$/, ".js");

    const state = {
      constructedPlatforms: [] as Array<string | undefined>,
      launchOptions: [] as Array<Record<string, unknown>>,
      gotoUrls: [] as string[],
      sessionCloseCount: 0,
      engineCloseCount: 0,
      currentUrl: "about:blank",
    };

    class FakeKernelBrowserEngine {
      readonly name = "kernel-stub";

      constructor(platform?: string) {
        state.constructedPlatforms.push(platform);
      }

      async launch(options: Record<string, unknown>) {
        state.launchOptions.push(options);
        return {
          async goto(url: string) {
            state.gotoUrls.push(url);
            state.currentUrl = url;
          },
          async screenshot() {
            return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
          },
          async screenshotElement() {
            return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
          },
          async evaluate<T>() {
            return undefined as T;
          },
          async click() {},
          async type() {},
          async scroll() {},
          async waitForNavigation() {},
          url() {
            return state.currentUrl;
          },
          async close() {
            state.sessionCloseCount++;
          },
        };
      }

      async close() {
        state.engineCloseCount++;
      }
    }

    mock.module(kernelModuleTsPath, () => ({
      KernelBrowserEngine: FakeKernelBrowserEngine,
    }));
    mock.module(kernelModuleJsPath, () => ({
      KernelBrowserEngine: FakeKernelBrowserEngine,
    }));

    const { createHarness } = await import("../../packages/ai/src/harness/index.ts");

    const rootDir = await createTempDir();
    const harness = await createHarness({
      llm: mockLLM([
        JSON.stringify({
          tool: "browser_navigate",
          arguments: { url: "https://example.com/dashboard" },
        }),
        JSON.stringify({
          tool: "browser_screenshot",
          arguments: {},
        }),
        "done",
      ]),
      runtime: { rootDir },
      sandbox: {
        browser: {
          engine: "camoufox",
          platform: "taobao",
          accountId: "acct-1",
          guardMode: "hybrid",
        },
      },
      verify: { enabled: false },
    });

    const result = await harness.run({ goal: "open and capture dashboard" });

    expect(result.runtimeStatus).toBe("completed");
    expect(state.constructedPlatforms).toEqual(["taobao"]);
    expect(state.gotoUrls).toEqual(["https://example.com/dashboard"]);
    expect(state.launchOptions).toHaveLength(1);
    expect(state.launchOptions[0]?.accountId).toBe("acct-1");
    expect(state.launchOptions[0]?.guardMode).toBe("hybrid");
    expect(String(state.launchOptions[0]?.screenshotDir)).toContain(result.runId);

    const artifacts = await harness.getArtifacts(result.runId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.kind).toBe("screenshot");
    expect(artifacts[0]?.metadata).toEqual({
      url: "https://example.com/dashboard",
    });

    const run = await harness.getRun(result.runId);
    expect(run?.sandbox.driver).toBe("local");
    expect(run?.sandbox.mode).toBe("local");
    expect(run?.sandbox.browser).toBe(true);

    expect(state.sessionCloseCount).toBe(1);
    expect(state.engineCloseCount).toBe(1);
  });
});

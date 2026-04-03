import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { PlaywrightEngine } from "../browser/engine.js";
import { runVisionLoop } from "../browser/vision.js";
import { FsSandboxImpl } from "../sandbox/filesystem.js";
import type {
  BrowserEngine,
  BrowserSandbox,
  BrowserSandboxConfig,
  BrowserSession,
  FsSandbox,
  FsSandboxConfig,
  HarnessConfig,
  HarnessSandboxContext,
  HarnessSandboxDriver,
  VisionAction,
} from "../types.js";

export class LocalHarnessSandboxDriver implements HarnessSandboxDriver {
  readonly name = "local";

  async createContext(
    config: HarnessConfig,
    runtime: {
      runId: string;
      paths: { sandboxesDir: string };
      sandboxDir: string;
      artifactDir: string;
    },
  ): Promise<HarnessSandboxContext> {
    const browser = await this.createBrowser(config, runtime.artifactDir);
    const { fs, workspaceDir } = await this.createFs(config, runtime.sandboxDir);

    return {
      mode: "local",
      artifactDir: runtime.artifactDir,
      ...(workspaceDir ? { workspaceDir } : {}),
      browser,
      fs,
      async abort(): Promise<void> {
        if (browser) {
          await browser.destroy();
        }
      },
      async destroy(): Promise<void> {
        if (browser) {
          await browser.destroy();
        }
      },
    };
  }

  private async createBrowser(
    config: HarnessConfig,
    artifactDir: string,
  ): Promise<BrowserSandbox | null> {
    if (!config.sandbox?.browser) {
      return null;
    }

    const browserConfig: BrowserSandboxConfig =
      typeof config.sandbox.browser === "boolean"
        ? {}
        : config.sandbox.browser;

    let engine: BrowserEngine | null = null;

    try {
      let session: BrowserSession;
      if (browserConfig.engine === "camoufox") {
        const modPath = "../kernel/adapter/kernel-engine.js";
        const mod = await import(modPath);
        engine = new mod.KernelBrowserEngine(browserConfig.platform) as BrowserEngine;
        session = await engine.launch({
          ...browserConfig,
          screenshotDir: browserConfig.screenshotDir ?? artifactDir,
        });
      } else {
        engine = new PlaywrightEngine();
        session = await engine.launch({
          ...browserConfig,
          screenshotDir: browserConfig.screenshotDir ?? artifactDir,
        });
      }

      return new LocalBrowserSandbox(
        session,
        engine,
        config,
        browserConfig.maxActSteps,
      );
    } catch (error) {
      if (engine) {
        await engine.close().catch(() => {
          // Best-effort cleanup when launch partially succeeded.
        });
      }
      throw error;
    }
  }

  private async createFs(
    config: HarnessConfig,
    sandboxDir: string,
  ): Promise<{ fs: FsSandbox | null; workspaceDir?: string }> {
    if (!config.sandbox?.fs) {
      return { fs: null };
    }

    const fsConfig: FsSandboxConfig =
      typeof config.sandbox.fs === "boolean"
        ? { rootDir: resolve(sandboxDir, "workspace") }
        : config.sandbox.fs;

    const workspaceDir = resolve(fsConfig.rootDir);
    await mkdir(workspaceDir, { recursive: true });

    return {
      fs: new FsSandboxImpl({ ...fsConfig, rootDir: workspaceDir }),
      workspaceDir,
    };
  }
}

class LocalBrowserSandbox implements BrowserSandbox {
  readonly session: BrowserSession;
  private readonly engine: BrowserEngine;
  private readonly llmConfig: HarnessConfig;
  private readonly maxActSteps: number;

  constructor(
    session: BrowserSession,
    engine: BrowserEngine,
    config: HarnessConfig,
    maxActSteps?: number,
  ) {
    this.session = session;
    this.engine = engine;
    this.llmConfig = config;
    this.maxActSteps = maxActSteps ?? 15;
  }

  async act(goal: string, maxSteps?: number): Promise<VisionAction[]> {
    return runVisionLoop(
      this.llmConfig.llm,
      this.session,
      goal,
      maxSteps ?? this.maxActSteps,
    );
  }

  async destroy(): Promise<void> {
    await this.session.close();
    await this.engine.close();
  }
}

/**
 * Playwright-based browser engine.
 *
 * Extracted & simplified from crawlab-test/src/kernel/engine/.
 * - No account pool / persistent profiles
 * - Optional stealth via injectStealthScripts()
 * - Proxy support (SOCKS5 / HTTP)
 */

import type {
  BrowserEngine,
  BrowserSession,
  BrowserSandboxConfig,
  GuardFn,
} from "../types.js";

// Playwright is a peer dependency — imported dynamically so the package
// compiles even when playwright is not installed. We use `any` for
// Playwright types to avoid requiring @types/playwright at build time.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PlaywrightModule = { chromium: { launch(opts?: any): Promise<any> } };
type PlaywrightBrowser = { newContext(opts?: any): Promise<any>; close(): Promise<void> };
type PlaywrightPage = { goto(url: string, opts?: any): Promise<void>; screenshot(opts?: any): Promise<Uint8Array>; $(selector: string): Promise<any>; evaluate(fn: any, ...args: any[]): Promise<any>; mouse: { click(x: number, y: number): Promise<void>; wheel(dx: number, dy: number): Promise<void> }; fill(selector: string, text: string): Promise<void>; waitForLoadState(state: string, opts?: any): Promise<void>; url(): string; close(): Promise<void>; addInitScript(fn: () => void): Promise<void> };

let _pw: PlaywrightModule | null = null;

async function loadPlaywright(): Promise<PlaywrightModule> {
  if (!_pw) {
    try {
      _pw = (await import("playwright")) as unknown as PlaywrightModule;
    } catch {
      throw new Error(
        "playwright is required for browser-use. Install it: bun add playwright",
      );
    }
  }
  return _pw;
}

// ---------------------------------------------------------------------------
// PlaywrightSession — wraps a Playwright Page as BrowserSession
// ---------------------------------------------------------------------------

class PlaywrightSession implements BrowserSession {
  constructor(
    private page: PlaywrightPage,
    private guards: GuardFn[],
  ) {}

  async goto(url: string): Promise<void> {
    // Execute guards before navigation
    for (const guard of this.guards) {
      await guard({ url, session: this });
    }
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async screenshot(): Promise<Buffer> {
    const buf = await this.page.screenshot({ fullPage: true, type: "png" });
    return Buffer.from(buf);
  }

  async screenshotElement(selector: string): Promise<Buffer> {
    const el = await this.page.$(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    const buf = await el.screenshot({ type: "png" });
    return Buffer.from(buf);
  }

  async evaluate<T>(fn: string): Promise<T> {
    return this.page.evaluate(fn) as Promise<T>;
  }

  async click(x: number, y: number): Promise<void> {
    await this.page.mouse.click(x, y);
  }

  async type(selector: string, text: string): Promise<void> {
    await this.page.fill(selector, text);
  }

  async scroll(direction: "up" | "down", amount = 300): Promise<void> {
    const delta = direction === "down" ? amount : -amount;
    await this.page.mouse.wheel(0, delta);
  }

  async waitForNavigation(timeout = 30_000): Promise<void> {
    await this.page.waitForLoadState("domcontentloaded", { timeout });
  }

  url(): string {
    return this.page.url();
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}

// ---------------------------------------------------------------------------
// PlaywrightEngine — implements BrowserEngine
// ---------------------------------------------------------------------------

export class PlaywrightEngine implements BrowserEngine {
  readonly name = "playwright";
  private browser: PlaywrightBrowser | null = null;

  async launch(opts: BrowserSandboxConfig): Promise<BrowserSession> {
    const pw = await loadPlaywright();
    const launchOpts: Record<string, unknown> = {
      headless: opts.headless ?? true,
    };

    if (opts.proxy) {
      launchOpts["proxy"] = { server: opts.proxy };
    }

    this.browser = await pw.chromium.launch(launchOpts) as PlaywrightBrowser;

    const context = await this.browser!.newContext({
      viewport: opts.viewport ?? { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    // Inject stealth scripts if enabled
    if (opts.stealth !== false) {
      await injectStealthScripts(page);
    }

    return new PlaywrightSession(page, opts.guards ?? []);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Stealth script injection (extracted from crawlab-test/src/kernel/stealth/)
// ---------------------------------------------------------------------------

async function injectStealthScripts(page: PlaywrightPage): Promise<void> {
  await page.addInitScript(() => {
    // Hide webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => false });

    // Mask automation-related properties
    const originalQuery = window.navigator.permissions.query.bind(
      window.navigator.permissions,
    );
    (window.navigator.permissions as unknown as Record<string, unknown>)[
      "query"
    ] = (parameters: { name: string }) =>
      parameters.name === "notifications"
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters as PermissionDescriptor);

    // Fake plugins array (Chrome normally has 5 default plugins)
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });

    // Fake languages
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });

    // Override chrome runtime (Playwright doesn't set this)
    (window as unknown as Record<string, unknown>)["chrome"] = {
      runtime: {},
    };
  });
}

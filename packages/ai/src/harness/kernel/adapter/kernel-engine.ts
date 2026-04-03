/**
 * Kernel Adapter — bridges kernel CamoufoxEngine / PlaywrightSession / stealth engines
 * into the harness BrowserEngine / BrowserSession interfaces.
 *
 * This file lives under tsconfig.kernel.json (relaxed mode) because it imports
 * kernel internals that use `any` types extensively.
 */

import type { KernelSession } from '../session/types.js';
import { PlaywrightSession } from '../session/playwright-session.js';
import { CamoufoxEngine } from '../engine/camoufox.js';
import { BrowserManager } from '../engine/browser-manager.js';
import { MouseEngine } from '../stealth/mouse-engine.js';
import { KeyboardEngine } from '../stealth/keyboard-engine.js';
import { ScrollEngine } from '../stealth/scroll-engine.js';
import { GuardRegistry as KernelGuardRegistry } from '../guard/registry.js';
import { autoDelay } from '../guard/builtins/auto-delay.js';
import { captchaDetector } from '../guard/builtins/captcha-detector.js';
import { requestLogger } from '../guard/builtins/request-logger.js';

// Harness-layer types — imported from compiled dist at runtime.
// We duplicate the minimal shape here to avoid cross-tsconfig issues.
interface BrowserSession {
  goto(url: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  screenshotElement(selector: string): Promise<Buffer>;
  evaluate<T>(fn: string): Promise<T>;
  click(x: number, y: number): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  scroll(direction: 'up' | 'down', amount?: number): Promise<void>;
  waitForNavigation(timeout?: number): Promise<void>;
  url(): string;
  close(): Promise<void>;
}

interface BrowserSandboxConfig {
  headless?: boolean;
  proxy?: string;
  viewport?: { width: number; height: number };
  stealth?: boolean;
  screenshotDir?: string;
  guards?: HarnessGuardFn[];
  maxActSteps?: number;
  engine?: string;
  platform?: string;
  accountId?: string;
  guardMode?: 'vision' | 'hybrid';
}

interface BrowserEngine {
  readonly name: string;
  launch(opts: BrowserSandboxConfig): Promise<BrowserSession>;
  close(): Promise<void>;
}

type HarnessGuardFn = (ctx: { url: string; session: BrowserSession }) => Promise<void>;

// ---------------------------------------------------------------------------
// KernelBrowserSession — wraps KernelSession + stealth engines
// ---------------------------------------------------------------------------

export class KernelBrowserSession implements BrowserSession {
  constructor(
    private kernelSession: KernelSession,
    private page: any, // PlaywrightSession.rawPage
    private mouseEngine: MouseEngine,
    private keyboardEngine: KeyboardEngine,
    private scrollEngine: ScrollEngine,
    private harnessGuards: HarnessGuardFn[],
  ) {}

  async goto(url: string): Promise<void> {
    // 1. Run harness-layer guards (pre-navigation)
    for (const guard of this.harnessGuards) {
      await guard({ url, session: this });
    }
    // 2. Delegate to kernel session (runs kernel guards post-navigation)
    await this.kernelSession.goto(url);
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from(
      await this.page.screenshot({ fullPage: true, type: 'png' }),
    );
  }

  async screenshotElement(selector: string): Promise<Buffer> {
    const el = await this.page.$(selector);
    if (!el) throw new Error(`Element not found: "${selector}"`);
    return Buffer.from(await el.screenshot({ type: 'png' }));
  }

  async evaluate<T>(fn: string): Promise<T> {
    return this.page.evaluate(fn);
  }

  async click(x: number, y: number): Promise<void> {
    // Fitts' Law mouse movement → click
    await this.mouseEngine.moveTo(this.page, { x, y });
    await this.page.mouse.down();
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
    await this.page.mouse.up();
  }

  async type(selector: string, text: string): Promise<void> {
    // QWERTY-distance typing with typo simulation and IME support
    await this.keyboardEngine.typeText(this.page, text, selector);
  }

  async scroll(direction: 'up' | 'down', amount?: number): Promise<void> {
    await this.scrollEngine.scroll(this.page, {
      direction: direction === 'down' ? 1 : -1,
      distance: amount ?? 300,
    });
  }

  async waitForNavigation(timeout?: number): Promise<void> {
    await this.kernelSession.waitForNavigation({ timeout });
  }

  url(): string {
    return this.kernelSession.url();
  }

  async close(): Promise<void> {
    await this.kernelSession.close();
  }
}

// ---------------------------------------------------------------------------
// KernelBrowserEngine — wraps CamoufoxEngine + BrowserManager
// ---------------------------------------------------------------------------

export class KernelBrowserEngine implements BrowserEngine {
  readonly name = 'camoufox';

  private manager: BrowserManager | null = null;
  private platform: string;

  constructor(platform?: string) {
    this.platform = platform ?? 'generic';
  }

  async launch(opts: BrowserSandboxConfig): Promise<BrowserSession> {
    // 1. Create engine + manager
    const camoufoxEngine = new CamoufoxEngine();
    this.manager = new BrowserManager(camoufoxEngine);

    // 2. Map harness config → kernel engine options
    const engineOptions: any = {
      headless: opts.headless ?? true,
      humanize: true,
    };
    if (opts.proxy) engineOptions.proxy = opts.proxy;
    if (opts.viewport) engineOptions.viewport = opts.viewport;

    // 3. Launch browser
    await this.manager.initialize(engineOptions);

    // 4. Create stealth engines
    const os = process.platform === 'darwin' ? 'macos'
      : process.platform === 'win32' ? 'windows' : 'linux';
    const mouseEngine = new MouseEngine();
    const keyboardEngine = new KeyboardEngine({ os: os as any });
    const scrollEngine = new ScrollEngine();

    // 5. Set up kernel guard registry
    // 'vision' (default): safety + rate-limit only — LLM handles captchas/login via screenshots
    // 'hybrid': full guards including DOM-level captcha detection + auto-solve
    const guardRegistry = new KernelGuardRegistry();
    guardRegistry.register(this.platform, autoDelay(800, 2000));
    guardRegistry.register(this.platform, requestLogger());
    if (opts.guardMode === 'hybrid') {
      guardRegistry.register(this.platform, captchaDetector());
    }
    const kernelGuards = guardRegistry.getGuards(this.platform);

    // 6. Create kernel session
    const kernelSession = await this.manager.createSession(
      opts.accountId ?? 'harness',
      this.platform,
      kernelGuards,
    );

    // 7. Get raw Playwright Page for direct operations
    const rawPage = (kernelSession as PlaywrightSession).rawPage;

    // 8. Wrap in adapter
    return new KernelBrowserSession(
      kernelSession,
      rawPage,
      mouseEngine,
      keyboardEngine,
      scrollEngine,
      opts.guards ?? [],
    );
  }

  async close(): Promise<void> {
    if (this.manager) {
      await this.manager.close();
      this.manager = null;
    }
  }
}

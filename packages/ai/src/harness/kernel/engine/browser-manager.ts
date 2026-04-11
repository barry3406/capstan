type BrowserContext = any;

import type { BrowserEngine, BrowserEngineOptions } from './types.js';
import type { KernelSession } from '../session/types.js';
import type { GuardFn } from '../guard/types.js';
import { PlaywrightSession } from '../session/playwright-session.js';

export class BrowserManager {
  private context: BrowserContext | null = null;

  constructor(private engine: BrowserEngine) {}

  get engineName(): string {
    return this.engine.name;
  }

  hasSession(userDataDir: string): boolean {
    return this.engine.hasSession(userDataDir);
  }

  async initialize(options: BrowserEngineOptions): Promise<BrowserContext> {
    this.context = await this.engine.launch(options);
    return this.context;
  }

  async getContext(): Promise<BrowserContext> {
    if (!this.context) throw new Error('Browser not initialized');
    return this.context;
  }

  async createSession(
    accountId: string,
    platform: string,
    guards: GuardFn[],
    options?: { onPageOpen?: () => Promise<void> },
  ): Promise<KernelSession> {
    if (!this.context) throw new Error('Browser not initialized');
    const page = await this.context.newPage();
    return new PlaywrightSession(page, accountId, this.engineName, platform, guards, options?.onPageOpen);
  }

  async close(): Promise<void> {
    await this.engine.close();
    this.context = null;
  }
}

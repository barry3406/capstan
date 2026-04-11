type Page = any;

// ─── 上下文感知页面交互引擎 ───

export type PageType = 'search-results' | 'product-detail' | 'shop-page' | 'generic';

interface BehaviorConfig {
  fatigue?: number;
  pageIndex?: number;
}

function lognormalDelay(min: number, max: number): number {
  const u1 = Math.random() || 0.001;
  const u2 = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mu = Math.log(min + (max - min) * 0.25);
  const value = Math.exp(mu + 0.4 * normal);
  return Math.max(min, Math.min(max, Math.round(value)));
}

export class PageBehaviorEngine {
  private fatigue: number;
  private pageIndex: number;
  private sessionStartTime = Date.now();

  constructor(config: BehaviorConfig = {}) {
    this.fatigue = config.fatigue ?? 0;
    this.pageIndex = config.pageIndex ?? 0;
  }

  private fatigueDelay(min: number, max: number): number {
    const m = 1 + this.fatigue * 0.3;
    return lognormalDelay(min * m, max * m);
  }

  updateFatigue(): void {
    const elapsed = (Date.now() - this.sessionStartTime) / 60_000;
    this.fatigue = Math.min(0.5, elapsed / 120);
  }

  recordPageVisit(): void {
    this.pageIndex++;
    this.updateFatigue();
  }

  /** 搜索结果页 */
  async browseSearchResults(page: Page): Promise<void> {
    const vh = await page.evaluate(() => window.innerHeight);
    // 快速概览 1-2 屏
    for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
      await page.mouse.wheel(0, vh * (0.6 + Math.random() * 0.3));
      await new Promise(r => setTimeout(r, this.fatigueDelay(400, 800)));
    }
    // 回顶
    await page.keyboard.press('Home');
    await new Promise(r => setTimeout(r, this.fatigueDelay(500, 1000)));
    // 逐条浏览
    const browseCount = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < browseCount; i++) {
      await page.mouse.wheel(0, 150 + Math.random() * 200);
      const att = Math.max(0.4, 1 - i * 0.12);
      await new Promise(r => setTimeout(r, this.fatigueDelay(800, 2500) * att));
    }
    this.recordPageVisit();
  }

  /** 商品详情页 */
  async browseProductDetail(page: Page): Promise<void> {
    // 看图
    await new Promise(r => setTimeout(r, this.fatigueDelay(2000, 5000)));
    // 看价格
    await page.mouse.wheel(0, 200 + Math.random() * 300);
    await new Promise(r => setTimeout(r, this.fatigueDelay(1000, 3000)));
    // 看详情
    const steps = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, 300 + Math.random() * 400);
      await new Promise(r => setTimeout(r, this.fatigueDelay(1500, 4000)));
    }
    // 30% 回顶
    if (Math.random() < 0.3) {
      await page.keyboard.press('Home');
      await new Promise(r => setTimeout(r, this.fatigueDelay(1000, 2000)));
    }
    this.recordPageVisit();
  }

  /** 店铺页 */
  async browseShopPage(page: Page): Promise<void> {
    await new Promise(r => setTimeout(r, this.fatigueDelay(1000, 3000)));
    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, 400 + Math.random() * 300);
      await new Promise(r => setTimeout(r, this.fatigueDelay(1000, 3000)));
    }
    this.recordPageVisit();
  }

  /** 定期休息 */
  async maybeRest(signal?: AbortSignal): Promise<boolean> {
    const elapsed = (Date.now() - this.sessionStartTime) / 60_000;
    const restInterval = 10 + Math.random() * 5;
    if (elapsed > 0 && this.pageIndex > 5 && Math.random() < 1 / restInterval * (this.pageIndex / 10)) {
      const restMs = 30000 + Math.random() * 30000;
      await new Promise<void>((resolve) => {
        if (signal?.aborted) { resolve(); return; }
        const timer = setTimeout(() => { cleanup(); resolve(); }, restMs);
        const onAbort = () => { clearTimeout(timer); resolve(); };
        signal?.addEventListener('abort', onAbort, { once: true });
        const cleanup = () => { signal?.removeEventListener('abort', onAbort); };
      });
      return true;
    }
    return false;
  }

  /** 自动交互 */
  async autoInteract(page: Page, pageType: PageType, signal?: AbortSignal): Promise<void> {
    await this.maybeRest(signal);
    switch (pageType) {
      case 'search-results': await this.browseSearchResults(page); break;
      case 'product-detail': await this.browseProductDetail(page); break;
      case 'shop-page': await this.browseShopPage(page); break;
      default: {
        const s = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < s; i++) {
          await page.mouse.wheel(0, 200 + Math.random() * 400);
          await new Promise(r => setTimeout(r, this.fatigueDelay(1000, 3000)));
        }
        this.recordPageVisit();
      }
    }
  }
}

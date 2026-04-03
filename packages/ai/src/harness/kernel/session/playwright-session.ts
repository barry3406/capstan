type Page = any;
type Response = any;

import type { KernelSession, ScreenshotOptions } from './types.js';
import type { GuardFn, GuardContext } from '../guard/types.js';
import { humanDelayWithMicro, humanScroll as doHumanScroll } from '../stealth/utils.js';

const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

export class PlaywrightSession implements KernelSession {
  readonly accountId: string;
  readonly engine: string;
  readonly platform: string;

  constructor(
    private page: Page,
    accountId: string,
    engine: string,
    platform: string,
    private guards: GuardFn[],
    private onPageOpen?: () => Promise<void>,
  ) {
    this.accountId = accountId;
    this.engine = engine;
    this.platform = platform;
  }

  url(): string {
    return this.page.url();
  }

  async goto(url: string, options?: { waitUntil?: string }): Promise<void> {
    await this.page.goto(url, {
      waitUntil: (options?.waitUntil as any) ?? 'domcontentloaded',
    });

    // 执行 guard pipeline
    const ctx: GuardContext = {
      url,
      session: this,
      platform: this.platform,
      logger: log,
    };
    for (const guard of this.guards) {
      await guard(ctx);
    }

    // 页面计数回调 — guard 通过后才算真正加载
    await this.onPageOpen?.();
  }

  async waitForNavigation(options?: { timeout?: number }): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', {
      timeout: options?.timeout,
    });
  }

  async fetch(url: string, init?: RequestInit): Promise<any> {
    return this.page.evaluate(
      async ({ url, init }: { url: string; init: any }) => {
        const resp = await fetch(url, init as any);
        return resp.json();
      },
      { url, init: init as any },
    );
  }

  intercept(urlPattern: string | RegExp, handler: (resp: any) => void): Disposable {
    const listener = (response: Response) => {
      const url = response.url();
      const matches = typeof urlPattern === 'string'
        ? url.includes(urlPattern)
        : urlPattern.test(url);
      if (matches) {
        response.json().then(handler).catch(() => {});
      }
    };

    this.page.on('response', listener);

    return {
      [Symbol.dispose]() {
        // page.off is the correct way to remove listeners
        // but we can't guarantee page is still alive
      },
    };
  }

  async evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T> {
    return this.page.evaluate(fn as any, ...args);
  }

  async querySelector(selector: string): Promise<any> {
    return this.page.$(selector);
  }

  async getCookies(): Promise<Array<{ name: string; value: string }>> {
    const context = this.page.context();
    const cookies = await context.cookies();
    return cookies.map((c: any) => ({ name: c.name, value: c.value }));
  }

  async hasCookie(name: string): Promise<boolean> {
    const cookies = await this.getCookies();
    return cookies.some(c => c.name === name);
  }

  async humanDelay(min: number, max: number): Promise<void> {
    await humanDelayWithMicro(this.page, min, max);
  }

  async humanScroll(): Promise<void> {
    await doHumanScroll(this.page);
  }

  async screenshot(path: string, options?: ScreenshotOptions): Promise<void> {
    const {
      fullPage = true,
      viewportOnly,
      aboveFold,
      selector,
      clip,
      type = 'png',
      quality,
      omitBackground,
    } = options ?? {};

    // 1. 元素截图：优先级最高
    if (selector) {
      const el = await this.page.$(selector);
      if (!el) throw new Error(`截图失败: 未找到元素 "${selector}"`);
      await el.screenshot({ path, type, quality, omitBackground });
      return;
    }

    // 2. 智能首屏截图：截全页 → 测量 body 宽度 + 首屏高度 → sharp 裁剪
    if (aboveFold !== undefined && aboveFold !== false) {
      // 截图前消除所有 hover/放大镜浮层
      try {
        // 1. 鼠标移到左上角安全区域（远离主图，避免触发放大镜）
        await this.page.mouse.move(0, 0);
        // 2. JS 强制隐藏放大镜/浮层
        await this.page.evaluate(() => {
          // 在主图区域触发 mouseleave/mouseout，让 JS 控制的放大镜自行关闭
          const imgAreas = document.querySelectorAll(
            '#spec-list, [class*="spec-list"], [class*="preview-wrap"], ' +
            '.tb-booth, [class*="main-img"], [class*="mainImg"], [class*="pic-box"], ' +
            '[class*="goods-gallery"], [class*="goodsGallery"], ' +
            '[class*="sku-pic"], [class*="skuPic"], [class*="product-img"]'
          );
          imgAreas.forEach(el => {
            el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            (el as HTMLElement).style.pointerEvents = 'none';
          });

          // 按选择器精确隐藏已知放大镜元素
          const selectors = [
            // 京东（经典版 + React 新版）
            '.jqzoom-big', '.jqzoom-lens', '.MagnifierMain', '.magnifier-lens',
            '[class*="zoom-main"]', '[class*="zoom-big"]', '[class*="zoom-lens"]',
            '[class*="magnifier"]', '[class*="Magnifier"]',
            '[class*="preview-zoom"]', '[class*="previewZoom"]',
            // 淘宝/天猫
            '.tb-booth .zoom', '.tb-booth .magnifier', '[class*="imgZoom"]',
            '[class*="enlarge"]', '[class*="Enlarge"]', '.ks-imagezoom-lens',
            '.ks-imagezoom-viewer', '[class*="imagezoom"]',
            // 拼多多
            '[class*="preview-big"]',
          ];
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(el => {
              (el as HTMLElement).style.setProperty('display', 'none', 'important');
            });
          }

          // 通用策略：遍历首屏所有元素，隐藏高 z-index 的浮层大图
          // 只检查首屏区域（y < 1200）内的元素，避免遍历整个 DOM
          const allEls = document.querySelectorAll('*');
          for (let i = 0; i < allEls.length; i++) {
            const el = allEls[i] as HTMLElement;
            const rect = el.getBoundingClientRect();
            // 跳过不在首屏或太小的元素
            if (rect.top > 1200 || rect.width < 200 || rect.height < 200) continue;
            const cs = getComputedStyle(el);
            if ((cs.position === 'absolute' || cs.position === 'fixed') && parseInt(cs.zIndex) > 50) {
              const imgs = el.querySelectorAll('img');
              const hasLargeImg = Array.from(imgs).some(img => img.naturalWidth > 300 || img.width > 300);
              if (hasLargeImg) {
                el.style.setProperty('display', 'none', 'important');
              }
            }
          }
        });
        await new Promise(r => setTimeout(r, 500));
      } catch { /* 页面可能已关闭 */ }
      const dims = await this.page.evaluate((requestedH: number | null) => {
        const body = document.body;
        const html = document.documentElement;
        // 宽度：body/html 实际渲染宽度，不小于视口宽度
        const bodyW = Math.max(
          body.scrollWidth, body.offsetWidth,
          html.scrollWidth, html.offsetWidth,
          window.innerWidth,
        );
        // 高度：用户指定 > 视口高度，上限为文档实际高度
        const docH = Math.max(body.scrollHeight, html.scrollHeight);
        const viewH = window.innerHeight;
        const h = requestedH ?? viewH;
        return { width: bodyW, height: Math.min(h, docH), docH };
      }, typeof aboveFold === 'number' ? aboveFold : null);

      // 先截全页到内存 buffer（能拿到完整宽度）
      const buf = await this.page.screenshot({
        fullPage: true,
        type,
        quality,
        omitBackground,
      });

      // 用 sharp 裁剪首屏区域
      let sharp: any;
      try {
        sharp = (await import('sharp' as any)).default;
      } catch {
        throw new Error(
          'sharp is required for aboveFold screenshots but is not installed. ' +
          'Install it with: npm install sharp'
        );
      }

      const meta = await sharp(buf).metadata();
      const imgW = meta.width ?? dims.width;
      const imgH = meta.height ?? dims.docH;
      const cropW = Math.min(dims.width, imgW);
      const cropH = Math.min(dims.height, imgH);

      await sharp(buf)
        .extract({ left: 0, top: 0, width: cropW, height: cropH })
        .toFile(path);
      return;
    }

    // 3. viewportOnly / clip / fullPage
    const shouldFullPage = clip ? false : (viewportOnly ? false : fullPage);

    await this.page.screenshot({
      path,
      fullPage: shouldFullPage,
      clip,
      type,
      quality,
      omitBackground,
    });
  }

  async close(): Promise<void> {
    if (!this.page.isClosed()) {
      await this.page.close();
    }
  }

  /** 内部方法：供需要原始 Page 的场景使用 */
  get rawPage(): Page {
    return this.page;
  }
}

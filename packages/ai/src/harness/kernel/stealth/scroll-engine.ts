type Page = any;

// ─── 物理滚动引擎 ───

type ScrollDevice = 'trackpad' | 'mousewheel';

interface ScrollOptions {
  device?: ScrollDevice;
  direction?: 1 | -1;
  distance?: number;
}

export class ScrollEngine {
  private device: ScrollDevice;
  private scrollCount = 0;

  constructor(device?: ScrollDevice) {
    this.device = device ?? (Math.random() < 0.7 ? 'trackpad' : 'mousewheel');
  }

  async scroll(page: Page, options: ScrollOptions = {}): Promise<void> {
    const direction = options.direction ?? 1;
    const device = options.device ?? this.device;
    const distance = options.distance ?? (200 + Math.random() * 400);

    if (device === 'trackpad') {
      await this.trackpadScroll(page, distance * direction);
    } else {
      await this.mousewheelScroll(page, distance * direction);
    }
    this.scrollCount++;
  }

  /** 触控板惯性滚动 */
  private async trackpadScroll(page: Page, totalDelta: number): Promise<void> {
    const absTotal = Math.abs(totalDelta);
    const sign = totalDelta > 0 ? 1 : -1;
    const events: { delta: number; delay: number }[] = [];

    // 发力阶段
    const attackCount = 3 + Math.floor(Math.random() * 3);
    let consumed = 0;
    for (let i = 0; i < attackCount; i++) {
      const progress = (i + 1) / attackCount;
      const delta = (absTotal * 0.4 * progress / attackCount) * sign;
      events.push({ delta, delay: 12 + Math.random() * 8 });
      consumed += Math.abs(delta);
    }

    // 惯性衰减阶段
    const remaining = absTotal - consumed;
    const decayCount = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < decayCount; i++) {
      const decay = Math.exp(-i * 0.4);
      const delta = (remaining * decay / decayCount) * sign;
      if (Math.abs(delta) < 1) break;
      events.push({ delta, delay: 16 + i * 4 + Math.random() * 8 });
    }

    for (const evt of events) {
      await page.mouse.wheel(0, evt.delta);
      await new Promise(r => setTimeout(r, evt.delay));
    }
  }

  /** 鼠标滚轮离散滚动 */
  private async mousewheelScroll(page: Page, totalDelta: number): Promise<void> {
    const sign = totalDelta > 0 ? 1 : -1;
    const absTotal = Math.abs(totalDelta);
    const stepSize = 100 + Math.random() * 20;
    const steps = Math.max(1, Math.round(absTotal / stepSize));

    for (let i = 0; i < steps; i++) {
      const jitteredDelta = stepSize * sign * (0.9 + Math.random() * 0.2);
      await page.mouse.wheel(0, jitteredDelta);
      await new Promise(r => setTimeout(r, 80 + Math.random() * 120));
    }
  }

  /** 自然浏览滚动 */
  async browseScroll(page: Page, screenCount = 3): Promise<void> {
    const viewport = await page.evaluate(() => ({
      height: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    const maxScroll = viewport.scrollHeight - viewport.height;
    let currentScroll = await page.evaluate(() => window.scrollY);

    for (let i = 0; i < screenCount; i++) {
      const scrollDist = viewport.height * (0.5 + Math.random() * 0.5);
      if (currentScroll + scrollDist > maxScroll) break;

      await this.scroll(page, { distance: scrollDist, direction: 1 });
      currentScroll += scrollDist;
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 3000));

      if (Math.random() < 0.15 && i > 0) {
        const backDist = viewport.height * (0.1 + Math.random() * 0.2);
        await this.scroll(page, { distance: backDist, direction: -1 });
        currentScroll -= backDist;
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
      }

      if (Math.random() < 0.05) {
        await page.keyboard.press(Math.random() < 0.5 ? 'Space' : 'PageDown');
        await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
      }
    }
  }

  /** 快速滚动到底部 */
  async scrollToBottom(page: Page): Promise<void> {
    const viewport = await page.evaluate(() => ({
      height: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
    }));
    const remaining = viewport.scrollHeight - viewport.scrollY - viewport.height;
    if (remaining <= 0) return;

    const chunks = 3 + Math.floor(Math.random() * 3);
    const chunkSize = remaining / chunks;
    for (let i = 0; i < chunks; i++) {
      await this.scroll(page, { distance: chunkSize, direction: 1 });
      await new Promise(r => setTimeout(r, 300 + Math.random() * 700));
    }
  }
}

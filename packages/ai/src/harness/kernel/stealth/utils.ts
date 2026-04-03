type Page = any;

/**
 * 对数正态分布延迟 — 模拟真实用户行为
 * 大多数操作偏快（接近 min），偶尔一次很慢（长停留看内容）
 */
export function randomDelay(min: number, max: number): Promise<void> {
  // Box-Muller 变换生成正态分布 → 取 exp 得到对数正态
  const u1 = Math.random() || 0.001;  // 避免 log(0)
  const u2 = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  // 均值偏向 min 端（sigma=0.4 让大部分值集中在前 1/3）
  const mu = Math.log(min + (max - min) * 0.25);
  const sigma = 0.4;
  const lognormal = Math.exp(mu + sigma * normal);

  // 钳位到 [min, max] 范围
  const delay = Math.max(min, Math.min(max, Math.round(lognormal)));
  return new Promise(resolve => setTimeout(resolve, delay));
}

// 记录最后鼠标位置（避免每次 evaluate 获取 + 从上次位置漂移）
const lastMouse = new WeakMap<Page, { x: number; y: number; vw: number; vh: number }>();

/**
 * 带鼠标微动的延迟 — 真实用户在"看"页面时鼠标会无意识漂移
 * @param page  Playwright Page
 * @param min   最小延迟（毫秒）
 * @param max   最大延迟（毫秒）
 */
export async function humanDelayWithMicro(page: Page, min: number, max: number): Promise<void> {
  // 计算总延迟（对数正态）
  const u1 = Math.random() || 0.001;
  const u2 = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mu = Math.log(min + (max - min) * 0.25);
  const sigma = 0.4;
  const total = Math.max(min, Math.min(max, Math.round(Math.exp(mu + sigma * normal))));

  // 短延迟（< 500ms）不做微动
  if (total < 500) {
    await new Promise(r => setTimeout(r, total));
    return;
  }

  // 将总延迟分成几段，每段之间做一次微小鼠标移动
  const segments = Math.max(1, Math.floor(total / 800));
  const segmentTime = Math.floor(total / segments);

  // 获取或初始化鼠标位置和 viewport 尺寸（只在首次 evaluate 一次）
  if (!lastMouse.has(page)) {
    try {
      const dims = await page.evaluate(() => ({
        w: window.innerWidth, h: window.innerHeight,
      }));
      lastMouse.set(page, {
        x: dims.w * 0.4 + Math.random() * dims.w * 0.2,
        y: dims.h * 0.3 + Math.random() * dims.h * 0.4,
        vw: dims.w, vh: dims.h,
      });
    } catch {
      lastMouse.set(page, { x: 400, y: 300, vw: 1920, vh: 1080 });
    }
  }

  for (let i = 0; i < segments; i++) {
    await new Promise(r => setTimeout(r, segmentTime));

    // 60% 概率微动，从上次位置漂移（±3-15 像素）
    if (Math.random() < 0.6 && i < segments - 1) {
      try {
        const pos = lastMouse.get(page)!;
        const nx = pos.x + (Math.random() - 0.5) * 30;
        const ny = pos.y + (Math.random() - 0.5) * 20;
        // 钳位到 viewport 安全范围
        const x = Math.max(10, Math.min(pos.vw - 10, nx));
        const y = Math.max(10, Math.min(pos.vh - 10, ny));
        await page.mouse.move(x, y);
        pos.x = x;
        pos.y = y;
      } catch {
        // page 可能已关闭
      }
    }
  }
}

/**
 * 模拟真人滚动 — 使用 mouse.wheel 生成原生 wheel 事件。
 * window.scrollBy 只产生 scroll 事件不产生 wheel 事件，风控一查便知。
 */
export async function humanScroll(page: Page): Promise<void> {
  const scrollSteps = Math.floor(Math.random() * 3) + 2;
  for (let i = 0; i < scrollSteps; i++) {
    // 约 15% 概率回滚（真实用户偶尔会往回翻）
    const direction = Math.random() < 0.15 ? -1 : 1;
    const delta = (Math.random() * 300 + 100) * direction;
    await page.mouse.wheel(0, delta);
    await randomDelay(500, 1500);
  }
}

/**
 * 三次贝塞尔鼠标移动 — 起点→控制点1→控制点2→终点。
 */
export async function bezierMouseMove(page: Page, x: number, y: number): Promise<void> {
  const steps = 25;
  const start = await page.evaluate(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));

  const dx = x - start.x;
  const dy = y - start.y;
  const cp1 = {
    x: start.x + dx * 0.25 + (Math.random() - 0.5) * Math.abs(dx) * 0.3,
    y: start.y + dy * 0.1 + (Math.random() - 0.5) * Math.abs(dy) * 0.4,
  };
  const cp2 = {
    x: start.x + dx * 0.75 + (Math.random() - 0.5) * Math.abs(dx) * 0.2,
    y: start.y + dy * 0.9 + (Math.random() - 0.5) * Math.abs(dy) * 0.2,
  };

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const cx = u * u * u * start.x + 3 * u * u * t * cp1.x + 3 * u * t * t * cp2.x + t * t * t * x;
    const cy = u * u * u * start.y + 3 * u * u * t * cp1.y + 3 * u * t * t * cp2.y + t * t * t * y;
    await page.mouse.move(cx, cy);
    const speed = Math.sin(t * Math.PI);
    await randomDelay(5 + Math.floor((1 - speed) * 25), 15 + Math.floor((1 - speed) * 35));
  }
}

type Page = any;

// ─── Fitts' Law 鼠标运动引擎 ───
// 基于人类运动学模型生成不可区分于真人的鼠标轨迹

interface MousePosition { x: number; y: number }
interface MouseEngineOptions {
  /** Fitts' Law a 参数（截距，ms） */
  fittsA?: number;
  /** Fitts' Law b 参数（斜率，ms/bit） */
  fittsB?: number;
  /** 疲劳系数（0-1，0=无疲劳，会话后期传入更高值） */
  fatigue?: number;
}

// Perlin noise 简化实现（1D）
function perlinNoise1D(x: number, seed: number): number {
  const n = (x * 127.1 + seed * 311.7) | 0;
  const h = (n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff;
  return (h / 1073741824.0) - 1.0;
}

// 最小急动度轨迹 (Minimum Jerk Trajectory)
// 模拟人类神经肌肉系统的平滑运动
function minimumJerkPosition(t: number): number {
  // 5 次多项式：10t³ - 15t⁴ + 6t⁵
  return 10 * t * t * t - 15 * t * t * t * t + 6 * t * t * t * t * t;
}

// 钟形速度曲线 — 真实人类运动的速度分布
function bellVelocity(t: number): number {
  return 30 * t * t * (1 - t) * (1 - t);
}

export class MouseEngine {
  private lastPos: MousePosition = { x: 960, y: 540 };
  private readonly fittsA: number;
  private readonly fittsB: number;
  private fatigue: number;
  private moveCount = 0;
  private noiseSeed: number;

  constructor(options: MouseEngineOptions = {}) {
    this.fittsA = options.fittsA ?? 50;
    this.fittsB = options.fittsB ?? 150;
    this.fatigue = options.fatigue ?? 0;
    this.noiseSeed = Math.random() * 10000;
  }

  /** 更新疲劳系数（会话进行中逐渐增加） */
  setFatigue(value: number): void {
    this.fatigue = Math.max(0, Math.min(1, value));
  }

  /** Fitts' Law 计算运动时间 */
  private calculateMovementTime(distance: number, targetWidth: number): number {
    if (distance < 1) return 50;
    const id = Math.log2(distance / targetWidth + 1); // Index of Difficulty
    const baseTime = this.fittsA + this.fittsB * id;
    // 疲劳增加 10-30% 运动时间
    return baseTime * (1 + this.fatigue * 0.3);
  }

  /** 生成从当前位置到目标的鼠标轨迹点序列 */
  private generateTrajectory(
    start: MousePosition,
    end: MousePosition,
    duration: number,
  ): { points: MousePosition[]; delays: number[] } {
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    // 采样点数量与距离和时间成正比（模拟显示器刷新率抖动）
    const baseSteps = Math.max(10, Math.floor(duration / 12));
    const steps = baseSteps + Math.floor(Math.random() * 6) - 3;

    const points: MousePosition[] = [];
    const delays: number[] = [];

    // 路径弯曲度与距离相关：短距离近似直线，长距离有 S 形弯曲
    const curvature = Math.min(0.3, distance / 2000);
    // 控制点偏移（垂直于运动方向）
    const perpX = -(end.y - start.y) / (distance || 1);
    const perpY = (end.x - start.x) / (distance || 1);
    const curveOffset = curvature * distance * (Math.random() - 0.5) * 2;

    for (let i = 0; i <= steps; i++) {
      const rawT = i / steps;
      // 最小急动度插值
      const t = minimumJerkPosition(rawT);

      // 基础线性插值
      let x = start.x + (end.x - start.x) * t;
      let y = start.y + (end.y - start.y) * t;

      // 弧形偏移（在运动中段最大）
      const arcFactor = 4 * rawT * (1 - rawT); // 0→1→0 抛物线
      x += perpX * curveOffset * arcFactor;
      y += perpY * curveOffset * arcFactor;

      // Perlin 噪声模拟手部颤抖（1-3px，频率 8-12Hz）
      const noiseAmp = (1 + this.fatigue * 2) * (1 + Math.sin(rawT * Math.PI) * 0.5);
      x += perlinNoise1D(rawT * 8 + this.moveCount, this.noiseSeed) * noiseAmp;
      y += perlinNoise1D(rawT * 8 + this.moveCount + 100, this.noiseSeed + 50) * noiseAmp;

      points.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });

      // 非均匀时间间隔：基于钟形速度曲线
      if (i < steps) {
        const speed = bellVelocity(rawT) || 0.1;
        const baseDelay = duration / steps;
        // 速度快时间隔短，速度慢时间隔长
        const delay = baseDelay * (1 / (speed * steps / 3 + 0.3));
        // 添加 ±20% 抖动（模拟刷新率不精确）
        const jitter = delay * (0.8 + Math.random() * 0.4);
        delays.push(Math.max(4, Math.round(jitter)));
      }
    }

    return { points, delays };
  }

  /** 移动鼠标到目标位置（主入口） */
  async moveTo(page: Page, target: MousePosition, targetWidth = 20): Promise<void> {
    const distance = Math.hypot(target.x - this.lastPos.x, target.y - this.lastPos.y);
    const duration = this.calculateMovementTime(distance, targetWidth);

    const { points, delays } = this.generateTrajectory(this.lastPos, target, duration);

    for (let i = 0; i < points.length; i++) {
      await page.mouse.move(points[i].x, points[i].y);
      if (i < delays.length) {
        await new Promise(r => setTimeout(r, delays[i]));
      }
    }

    // 终点过冲 + 微修正（10-20% 概率）
    if (Math.random() < 0.15 && distance > 50) {
      const overshootX = target.x + (Math.random() - 0.3) * 5;
      const overshootY = target.y + (Math.random() - 0.3) * 4;
      await page.mouse.move(overshootX, overshootY);
      await new Promise(r => setTimeout(r, 30 + Math.random() * 60));
      await page.mouse.move(target.x, target.y);
      await new Promise(r => setTimeout(r, 20 + Math.random() * 30));
    }

    this.lastPos = { x: target.x, y: target.y };
    this.moveCount++;
  }

  /** 点击目标元素（移动 + 悬停 + 点击） */
  async clickElement(page: Page, selector: string): Promise<void> {
    const box = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }, selector);
    if (!box) throw new Error(`Element not found: ${selector}`);

    // 点击位置：不精确对准中心，偏移 ±30% 范围
    const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

    await this.moveTo(page, { x: targetX, y: targetY }, Math.min(box.width, box.height));

    // 悬停延迟（模拟视觉确认）
    await new Promise(r => setTimeout(r, 80 + Math.random() * 200));

    await page.mouse.down();
    // mousedown-mouseup 间隔：50-150ms
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
    await page.mouse.up();
  }

  /** 鼠标微漂移（阅读/等待时的无意识移动） */
  async microDrift(page: Page, durationMs: number): Promise<void> {
    const segments = Math.max(1, Math.floor(durationMs / (600 + Math.random() * 400)));
    const segmentTime = Math.floor(durationMs / segments);

    for (let i = 0; i < segments; i++) {
      await new Promise(r => setTimeout(r, segmentTime));

      // 60% 概率微动
      if (Math.random() < 0.6) {
        const amp = 3 + this.fatigue * 5 + Math.random() * 12;
        const nx = this.lastPos.x + (Math.random() - 0.5) * amp * 2;
        const ny = this.lastPos.y + (Math.random() - 0.5) * amp * 1.5;
        await page.mouse.move(nx, ny);
        this.lastPos = { x: nx, y: ny };
      }
    }
  }

  /** 鼠标移出窗口再返回（模拟切换注意力） */
  async leaveAndReturn(page: Page): Promise<void> {
    // 移到窗口边缘
    const edge = Math.random() < 0.5 ? { x: -10, y: this.lastPos.y } : { x: this.lastPos.x, y: -10 };
    await this.moveTo(page, edge);
    // 停留 1-3 秒
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
    // 回到页面内随机位置
    const dims = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const returnPos = { x: dims.w * (0.2 + Math.random() * 0.6), y: dims.h * (0.2 + Math.random() * 0.6) };
    await this.moveTo(page, returnPos);
  }
}

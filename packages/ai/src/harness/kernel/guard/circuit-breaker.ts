const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

// ─── 全局熔断器 ───
// 当风控触发比例超过阈值时，暂停所有请求以保护剩余健康账号

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** 滑动窗口大小（ms） */
  windowMs: number;
  /** 触发熔断的风控比例（0-1） */
  tripThreshold: number;
  /** 熔断冷却时间（ms） */
  cooldownMs: number;
  /** 半开状态允许的探测请求数 */
  halfOpenProbeCount: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  windowMs: 5 * 60_000,
  tripThreshold: 0.3,
  cooldownMs: 10 * 60_000,
  halfOpenProbeCount: 1,
};

interface RequestRecord {
  timestamp: number;
  tripped: boolean;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private records: RequestRecord[] = [];
  private openedAt = 0;
  private halfOpenSuccessCount = 0;
  private halfOpenAllowed = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 获取当前熔断状态 */
  getState(): CircuitState {
    this.checkTransition();
    return this.state;
  }

  /** 获取距离恢复的剩余时间（ms），仅 open 状态有意义 */
  getRetryAfterMs(): number {
    if (this.state !== 'open') return 0;
    const elapsed = Date.now() - this.openedAt;
    return Math.max(0, this.config.cooldownMs - elapsed);
  }

  /** 检查是否允许通过（请求前调用） */
  isAllowed(): boolean {
    this.checkTransition();

    if (this.state === 'closed') return true;

    if (this.state === 'half-open') {
      if (this.halfOpenAllowed < this.config.halfOpenProbeCount) {
        this.halfOpenAllowed++;
        log.info({ probeIndex: this.halfOpenAllowed }, '半开状态：放行探测请求');
        return true;
      }
      return false;
    }

    // open
    return false;
  }

  /** 记录请求结果（请求后调用） */
  recordResult(tripped: boolean): void {
    const now = Date.now();
    this.records.push({ timestamp: now, tripped });
    // 清理窗口外的记录
    this.records = this.records.filter(r => now - r.timestamp < this.config.windowMs);

    if (this.state === 'half-open') {
      if (tripped) {
        // 探测失败 → 重新熔断
        this.tripOpen('半开探测失败，重新熔断');
      } else {
        this.halfOpenSuccessCount++;
        if (this.halfOpenSuccessCount >= this.config.halfOpenProbeCount) {
          this.state = 'closed';
          this.halfOpenSuccessCount = 0;
          this.halfOpenAllowed = 0;
          log.info('熔断器关闭：探测成功，恢复正常');
        }
      }
      return;
    }

    // closed 状态：检查是否需要熔断
    if (this.state === 'closed' && this.records.length >= 3) {
      const trippedCount = this.records.filter(r => r.tripped).length;
      const ratio = trippedCount / this.records.length;
      if (ratio >= this.config.tripThreshold) {
        this.tripOpen(`风控比例 ${(ratio * 100).toFixed(0)}% 超过阈值 ${(this.config.tripThreshold * 100).toFixed(0)}%`);
      }
    }
  }

  /** 手动重置 */
  reset(): void {
    this.state = 'closed';
    this.records = [];
    this.openedAt = 0;
    this.halfOpenSuccessCount = 0;
    this.halfOpenAllowed = 0;
    log.info('熔断器已手动重置');
  }

  /** 获取统计信息 */
  getStats(): { state: CircuitState; windowSize: number; trippedCount: number; trippedRatio: number; retryAfterMs: number } {
    this.checkTransition();
    const now = Date.now();
    const active = this.records.filter(r => now - r.timestamp < this.config.windowMs);
    const trippedCount = active.filter(r => r.tripped).length;
    return {
      state: this.state,
      windowSize: active.length,
      trippedCount,
      trippedRatio: active.length > 0 ? trippedCount / active.length : 0,
      retryAfterMs: this.getRetryAfterMs(),
    };
  }

  private tripOpen(reason: string): void {
    this.state = 'open';
    this.openedAt = Date.now();
    this.halfOpenSuccessCount = 0;
    this.halfOpenAllowed = 0;
    log.error({ reason, cooldownMs: this.config.cooldownMs }, '熔断器打开：全局暂停请求');
  }

  private checkTransition(): void {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.config.cooldownMs) {
      this.state = 'half-open';
      this.halfOpenSuccessCount = 0;
      this.halfOpenAllowed = 0;
      log.info('熔断器进入半开状态：开始探测');
    }
  }
}

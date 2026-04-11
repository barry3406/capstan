import { HealthTracker } from './health-tracker.js';
import { PageThrottle } from './page-throttle.js';
import type { AccountConfig, ScoredAccount, SelectionResult } from './types.js';

const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

export class AccountSelector {
  constructor(
    private healthTracker: HealthTracker,
    private pageThrottle: PageThrottle,
  ) {}

  async select(
    accounts: AccountConfig[],
    options?: { preferAccountIds?: string[] },
  ): Promise<SelectionResult> {
    const preferSet = options?.preferAccountIds ? new Set(options.preferAccountIds) : null;
    const now = Date.now();
    const candidates: ScoredAccount[] = [];
    let earliestAvailable: number | undefined;

    for (const config of accounts) {
      const health = await this.healthTracker.getHealth(config.id);
      if (health.status === 'banned' || health.status === 'offline') {
        log.debug({ id: config.id, status: health.status }, '账号不可用，跳过');
        continue;
      }
      if (health.status === 'cooldown' && now < health.cooldownUntil) {
        log.debug({ id: config.id, cooldownUntil: health.cooldownUntil }, '账号冷却中，跳过');
        earliestAvailable = Math.min(earliestAvailable ?? Infinity, health.cooldownUntil);
        continue;
      }

      // 轮休检查
      const throttle = await this.pageThrottle.getStatus(config.id);
      if (throttle.resting) {
        log.debug({ id: config.id, restUntil: throttle.restUntil }, '账号轮休中，跳过');
        earliestAvailable = Math.min(earliestAvailable ?? Infinity, throttle.restUntil);
        continue;
      }

      let score = this.calculateScore(config, health, throttle.pageCount, now);

      // 亲和加分：本地已有浏览器的账号优先（避免跨 Worker 冷启动）
      if (preferSet?.has(config.id)) {
        score += 50;
      }

      candidates.push({ config, health, score });
    }

    if (candidates.length === 0) {
      log.warn({ earliestAvailable }, '所有账号不可用');
      return { account: null, earliestAvailableAt: earliestAvailable };
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    log.info(
      { id: best.config.id, score: best.score, candidates: candidates.length },
      '选中账号',
    );

    return { account: best.config };
  }

  private calculateScore(
    config: AccountConfig,
    health: { captchaCount: number; totalRequests: number; totalErrors: number; lastRequestAt: number },
    pageCount: number,
    now: number,
  ): number {
    const priorityScore = config.priority * 2;

    const idleSec = health.lastRequestAt > 0 ? (now - health.lastRequestAt) / 1000 : 600;
    const cooldownScore = Math.min(idleSec / 20, 30);

    const recentErrorRate = health.totalRequests > 0
      ? health.totalErrors / health.totalRequests
      : 0;
    const healthScore = Math.max(0, 50 - health.captchaCount * 15 - recentErrorRate * 30);

    // 轮休因子：pageCount 越低分越高，均衡负载
    const throttleScore = Math.max(0, 15 - pageCount * 1.5);

    return priorityScore + cooldownScore + healthScore + throttleScore;
  }
}

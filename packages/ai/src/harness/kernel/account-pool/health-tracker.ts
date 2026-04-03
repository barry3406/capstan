import type { AccountHealth, AccountStatus, ReleaseOptions } from './types.js';

const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

const CAPTCHA_COOLDOWN_THRESHOLD = 3;
const CAPTCHA_BAN_THRESHOLD = 5;
const ERROR_COOLDOWN_THRESHOLD = 5;
const COOLDOWN_CAPTCHA_MS = 30 * 60_000;
const COOLDOWN_ERROR_MS = 10 * 60_000;
const HEALTH_KEY_TTL = 86400;

function healthKey(accountId: string): string {
  return `scraper:health:${accountId}`;
}

const DEFAULT_HEALTH: AccountHealth = {
  status: 'online',
  captchaCount: 0,
  errorCount: 0,
  cooldownUntil: 0,
  totalRequests: 0,
  totalErrors: 0,
  lastRequestAt: 0,
};

export interface HealthStore {
  hgetall(key: string): Promise<Record<string, string>>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
  hmset(key: string, data: Record<string, string>): Promise<unknown>;
}

export class HealthTracker {
  constructor(private readonly store: HealthStore) {}

  async getHealth(accountId: string): Promise<AccountHealth> {
    const data = await this.store.hgetall(healthKey(accountId));
    if (!data || Object.keys(data).length === 0) {
      return { ...DEFAULT_HEALTH };
    }

    const health: AccountHealth = {
      status: (data.status as AccountStatus) || 'online',
      captchaCount: parseInt(data.captchaCount) || 0,
      errorCount: parseInt(data.errorCount) || 0,
      cooldownUntil: parseInt(data.cooldownUntil) || 0,
      totalRequests: parseInt(data.totalRequests) || 0,
      totalErrors: parseInt(data.totalErrors) || 0,
      lastRequestAt: parseInt(data.lastRequestAt) || 0,
    };

    if (health.status === 'cooldown' && health.cooldownUntil > 0 && Date.now() >= health.cooldownUntil) {
      health.status = 'online';
      health.cooldownUntil = 0;
      health.captchaCount = 0;
      health.errorCount = 0;
      await this.saveHealth(accountId, health);
      log.info({ accountId }, '账号冷却结束，自动恢复');
    }

    return health;
  }

  async recordRequest(accountId: string): Promise<void> {
    const now = Date.now();
    const key = healthKey(accountId);
    await this.store.hincrby(key, 'totalRequests', 1);
    await this.store.hset(key, 'lastRequestAt', now.toString());
    await this.store.expire(key, HEALTH_KEY_TTL);
  }

  async processRelease(accountId: string, options: ReleaseOptions): Promise<void> {
    const health = await this.getHealth(accountId);
    const now = Date.now();

    if (options.success) {
      health.captchaCount = 0;
      health.errorCount = 0;
      if (health.status === 'cooldown' && now >= health.cooldownUntil) {
        health.status = 'online';
      }
    }

    if (options.captcha) {
      health.captchaCount += 1;
      log.warn({ accountId, captchaCount: health.captchaCount }, '触发验证码');

      if (health.captchaCount >= CAPTCHA_BAN_THRESHOLD) {
        health.status = 'banned';
        log.error({ accountId }, '验证码过多，账号已标记为 banned，需手动恢复');
      } else if (health.captchaCount >= CAPTCHA_COOLDOWN_THRESHOLD) {
        health.status = 'cooldown';
        health.cooldownUntil = now + COOLDOWN_CAPTCHA_MS;
        log.warn({ accountId, cooldownMin: COOLDOWN_CAPTCHA_MS / 60_000 }, '验证码频繁，进入冷却');
      }
    }

    if (options.error) {
      health.errorCount += 1;
      health.totalErrors += 1;
      log.warn({ accountId, errorCount: health.errorCount, msg: options.errorMessage }, '请求错误');

      if (health.errorCount >= ERROR_COOLDOWN_THRESHOLD) {
        health.status = 'cooldown';
        health.cooldownUntil = now + COOLDOWN_ERROR_MS;
        health.errorCount = 0;
        log.warn({ accountId, cooldownMin: COOLDOWN_ERROR_MS / 60_000 }, '连续错误过多，进入冷却');
      }
    }

    if (options.sessionExpired) {
      health.status = 'offline';
      log.error({ accountId }, 'Session 过期，需要重新登录');
    }

    await this.saveHealth(accountId, health);
  }

  async recover(accountId: string): Promise<void> {
    const health = await this.getHealth(accountId);
    health.status = 'online';
    health.captchaCount = 0;
    health.errorCount = 0;
    health.cooldownUntil = 0;
    await this.saveHealth(accountId, health);
    log.info({ accountId }, '账号已手动恢复');
  }

  async isAvailable(accountId: string): Promise<boolean> {
    const health = await this.getHealth(accountId);
    if (health.status === 'banned' || health.status === 'offline') return false;
    if (health.status === 'cooldown' && Date.now() < health.cooldownUntil) return false;
    return true;
  }

  async reset(accountId: string): Promise<void> {
    await this.store.del(healthKey(accountId));
    log.info({ accountId }, '健康状态已清空');
  }

  private async saveHealth(accountId: string, health: AccountHealth): Promise<void> {
    const key = healthKey(accountId);
    await this.store.hmset(key, {
      status: health.status,
      captchaCount: health.captchaCount.toString(),
      errorCount: health.errorCount.toString(),
      cooldownUntil: health.cooldownUntil.toString(),
      totalRequests: health.totalRequests.toString(),
      totalErrors: health.totalErrors.toString(),
      lastRequestAt: health.lastRequestAt.toString(),
    });
    await this.store.expire(key, HEALTH_KEY_TTL);
  }
}

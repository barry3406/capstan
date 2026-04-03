const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

const KEY_PREFIX = 'scraper:throttle:';
const TTL_SECONDS = 86_400; // 24h

export interface ThrottleStatus {
  pageCount: number;
  resting: boolean;
  restUntil: number; // epoch ms, 0 = not resting
}

export interface PageThrottleStore {
  hget(key: string, field: string): Promise<string | null>;
  hmset(key: string, data: Record<string, string>): Promise<unknown>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  expire(key: string, seconds: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
}

export class PageThrottle {
  constructor(
    private readonly store: PageThrottleStore,
    private limit: number = 10,
    private restMs: number = 3 * 60_000,
  ) {}

  private key(accountId: string): string {
    return `${KEY_PREFIX}${accountId}`;
  }

  async recordPage(accountId: string): Promise<ThrottleStatus> {
    const k = this.key(accountId);
    const now = Date.now();

    // Check if rest period has expired → reset
    const rawRestUntil = await this.store.hget(k, 'restUntil');
    const currentRestUntil = rawRestUntil ? Number(rawRestUntil) : 0;
    if (currentRestUntil > 0 && currentRestUntil <= now) {
      await this.store.hmset(k, { pageCount: '0', restUntil: '0' });
    }

    // Increment page count
    const newCount = await this.store.hincrby(k, 'pageCount', 1);
    await this.store.expire(k, TTL_SECONDS);

    // Check if limit reached → enter rest
    if (newCount >= this.limit) {
      const restUntil = now + this.restMs;
      await this.store.hmset(k, { pageCount: '0', restUntil: String(restUntil) });
      log.info({ accountId, pages: newCount, restMinutes: this.restMs / 60_000 }, '账号连续页面达上限，进入轮休');
      return { pageCount: 0, resting: true, restUntil };
    }

    log.debug({ accountId, pageCount: newCount }, '页面计数');
    return { pageCount: newCount, resting: false, restUntil: 0 };
  }

  async getStatus(accountId: string): Promise<ThrottleStatus> {
    const k = this.key(accountId);
    const data = await this.store.hgetall(k);

    if (!data.pageCount && !data.restUntil) {
      return { pageCount: 0, resting: false, restUntil: 0 };
    }

    const now = Date.now();
    const pageCount = Number(data.pageCount) || 0;
    const restUntil = Number(data.restUntil) || 0;

    // Rest expired → auto-reset
    if (restUntil > 0 && restUntil <= now) {
      await this.store.hmset(k, { pageCount: '0', restUntil: '0' });
      return { pageCount: 0, resting: false, restUntil: 0 };
    }

    return {
      pageCount,
      resting: restUntil > now,
      restUntil,
    };
  }

  async reset(accountId: string): Promise<void> {
    await this.store.del(this.key(accountId));
    log.info({ accountId }, '轮休状态已重置');
  }
}

import { HealthTracker } from './health-tracker.js';
import { AccountSelector } from './account-selector.js';
import { BrowserLifecycle } from './browser-lifecycle.js';
import { PageThrottle } from './page-throttle.js';
import type { AccountLock } from './account-lock.js';
import type {
  AccountConfig,
  AccountPoolStatus,
  AcquireOptions,
  KernelSession,
  PooledSession,
  ReleaseOptions,
} from './types.js';

const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

// ─── Re-use guard types from kernel guard module ───

import type { GuardFn } from '../guard/types.js';

/** Registry that returns platform-specific guard functions */
export interface GuardRegistry {
  getGuards(platform: string): GuardFn[];
}

/** Circuit breaker for failure detection */
export interface CircuitBreaker {
  recordResult(tripped: boolean): void;
  reset(): void;
}

/** SessionProvider — the interface AccountPool implements */
export interface SessionProvider {
  acquireSession(platform: string, options?: AcquireOptions): Promise<PooledSession>;
}

export interface AccountPoolOptions {
  headless?: boolean;
}

export interface AccountPoolDeps {
  healthTracker: HealthTracker;
  pageThrottle: PageThrottle;
  lifecycle: BrowserLifecycle;
  guardRegistry: GuardRegistry;
  accountLock: AccountLock;
  circuitBreaker?: CircuitBreaker;
}

export class AccountPool implements SessionProvider {
  private accounts: AccountConfig[] = [];
  private selector: AccountSelector;
  private initialized = false;

  readonly headless: boolean;

  constructor(
    private readonly deps: AccountPoolDeps,
    private options: AccountPoolOptions = {},
  ) {
    this.headless = options.headless ?? true;
    this.selector = new AccountSelector(deps.healthTracker, deps.pageThrottle);
  }

  async initialize(accounts: AccountConfig[]): Promise<void> {
    if (this.initialized) return;

    // 启动时清理上一进程残留的账号锁，防止重启后所有任务卡在"被占用"
    await this.deps.accountLock.releaseAll();

    this.accounts = [...accounts];
    this.lifecycle.start();
    this.initialized = true;

    log.info({ accounts: this.accounts.map(a => a.id) }, '账号池初始化完成');
  }

  async acquireSession(platform: string, options?: AcquireOptions): Promise<PooledSession> {
    this.ensureInitialized();

    // 强制指定账号
    if (options?.accountId) {
      const pinned = this.accounts.find(a => a.id === options.accountId);
      if (!pinned) {
        throw new Error(`指定账号 ${options.accountId} 不存在`);
      }
      if (pinned.platform && pinned.platform !== platform) {
        throw new Error(`账号 ${options.accountId} 属于 ${pinned.platform}，不能用于 ${platform}`);
      }
      return this.acquireForAccount(pinned, platform);
    }

    let candidates = this.accounts.filter(a => !a.platform || a.platform === platform);
    if (options?.tag) {
      const tagged = candidates.filter(a => a.tags?.includes(options.tag!));
      if (tagged.length > 0) candidates = tagged;
    }

    if (candidates.length === 0) {
      throw new Error(`平台 ${platform} 没有可用的候选账号`);
    }

    // 无限等待直到有可用账号，每轮间隔 5 秒
    // 可通过 options.signal 从外部中断等待（如任务被终止）
    const RETRY_INTERVAL_MS = 5_000;
    const LOG_INTERVAL_MS = 60_000;
    const startTime = Date.now();
    let lastLogTime = 0;
    const signal = options?.signal;

    /** 可被 AbortSignal 中断的 sleep，signal 已 aborted 时立即返回 */
    const interruptibleSleep = (ms: number): Promise<void> => {
      if (signal?.aborted) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
        const onAbort = () => { clearTimeout(timer); resolve(); };
        signal?.addEventListener('abort', onAbort, { once: true });
        const cleanup = () => { signal?.removeEventListener('abort', onAbort); };
      });
    };

    while (true) {
      if (signal?.aborted) {
        throw new Error('等待账号时被外部中断');
      }

      const tried = new Set<string>();
      let allUnhealthy = false;

      while (tried.size < candidates.length) {
        const remaining = candidates.filter(a => !tried.has(a.id));
        const preferAccountIds = this.lifecycle.getActiveAccountIds();
        const { account, earliestAvailableAt } = await this.selector.select(remaining, { preferAccountIds });

        if (!account) {
          allUnhealthy = true;

          // 没有 earliestAvailableAt → 全部 offline/banned，不会自动恢复，立即抛错
          if (!earliestAvailableAt) {
            throw new Error(`平台 ${platform} 所有账号均已离线或被封禁，需要重新登录后恢复`);
          }

          // 有冷却中的账号 → 等待后重试
          const now = Date.now();
          const waitSec = Math.ceil((earliestAvailableAt - now) / 1000);
          const sleepMs = waitSec > 0
            ? Math.min(waitSec * 1000, 60_000)
            : RETRY_INTERVAL_MS;
          if (now - lastLogTime > LOG_INTERVAL_MS) {
            log.info(
              { platform, waited: now - startTime, nextRetryMs: sleepMs, earliestAvailableAt },
              '所有账号不可用（冷却中），等待重试',
            );
            lastLogTime = now;
          }
          await interruptibleSleep(sleepMs);
          break; // 跳出内层循环，重新开始一轮选择
        }

        try {
          return await this.acquireForAccount(account, platform);
        } catch (err: any) {
          const msg: string = err.message ?? '';
          if (msg.includes('被其他 Worker 占用') || msg.includes('并发上限')) {
            tried.add(account.id);
            log.debug({ accountId: account.id, reason: msg }, '账号不可用，尝试下一个');
            continue;
          }
          throw err;
        }
      }

      // 所有候选账号都被占用（不健康路径已在上面 sleep 过，跳过）
      if (!allUnhealthy && tried.size >= candidates.length) {
        const now = Date.now();
        if (now - lastLogTime > LOG_INTERVAL_MS) {
          log.info({ platform, waited: now - startTime }, '所有账号被占用，等待重试');
          lastLogTime = now;
        }
        await interruptibleSleep(RETRY_INTERVAL_MS);
      }
    }
  }

  async getStatus(): Promise<AccountPoolStatus> {
    this.ensureInitialized();

    const accountStatuses = await Promise.all(
      this.accounts.map(async (config) => {
        const health = await this.healthTracker.getHealth(config.id);
        const throttle = await this.pageThrottle.getStatus(config.id);

        return {
          id: config.id,
          name: config.name,
          status: health.status,
          health,
          browserActive: this.lifecycle.isActive(config.id),
          pageCount: throttle.pageCount,
          resting: throttle.resting,
          restUntil: throttle.restUntil,
        };
      }),
    );

    const available = accountStatuses.filter(
      a => a.status === 'online' && !a.resting,
    );

    return {
      accounts: accountStatuses,
      totalAccounts: this.accounts.length,
      availableAccounts: available.length,
      activeBrowsers: this.lifecycle.getSlots().length,
    };
  }

  async recoverAccount(accountId: string): Promise<void> {
    await this.healthTracker.recover(accountId);
  }

  async resetAccount(accountId: string): Promise<void> {
    await this.healthTracker.reset(accountId);
    await this.pageThrottle.reset(accountId);
    log.info({ accountId }, '账号状态已重置');
  }

  async resetAll(): Promise<void> {
    await Promise.all(this.accounts.map(a => this.resetAccount(a.id)));
    await this.deps.accountLock.releaseAll();
    if (this.deps.circuitBreaker) {
      this.deps.circuitBreaker.reset();
    }
    log.info({ count: this.accounts.length }, '所有账号状态已重置');
  }

  /** 热更新账号列表（回收被删账号的浏览器） */
  reloadAccounts(accounts: AccountConfig[]): void {
    this.ensureInitialized();
    const newIds = new Set(accounts.map(a => a.id));

    const added = accounts.filter(a => !this.accounts.some(o => o.id === a.id));
    const removed = this.accounts.filter(a => !newIds.has(a.id));

    this.accounts = [...accounts];

    for (const acc of added) {
      this.lifecycle.restoreAccount(acc.id);
    }

    // 关闭被删除账号占用的浏览器（包括仅在 launch 队列里排队的），释放槽位
    for (const acc of removed) {
      this.lifecycle.closeBrowserForAccount(acc.id).catch(err => {
        log.error({ accountId: acc.id, err }, '热更新: 关闭被删账号浏览器失败');
      });
    }

    if (added.length > 0) log.info({ ids: added.map(a => a.id) }, '热更新: 新增账号');
    if (removed.length > 0) log.info({ ids: removed.map(a => a.id) }, '热更新: 移除账号并回收浏览器');
    log.info({ total: this.accounts.length }, '账号列表已热更新');
  }

  async shutdown(): Promise<void> {
    await this.lifecycle.shutdown();
    this.initialized = false;
    log.info('账号池已关闭');
  }

  private async acquireForAccount(account: AccountConfig, platform: string): Promise<PooledSession> {
    // 轮休检查：如果正在休息但被强制指定，记录警告
    const throttle = await this.pageThrottle.getStatus(account.id);
    if (throttle.resting) {
      log.warn({ accountId: account.id, restUntil: new Date(throttle.restUntil).toISOString() }, '账号正在轮休但被强制调度');
    }

    // 分布式锁：保证同一账号同一时间只被一个 Worker 使用
    const locked = await this.deps.accountLock.acquire(account.id);
    if (!locked) {
      throw new Error(`账号 ${account.id} 被其他 Worker 占用`);
    }

    await this.healthTracker.recordRequest(account.id);

    let session: KernelSession;
    try {
      const guards = this.deps.guardRegistry.getGuards(platform);
      const onPageOpen = async () => { await this.pageThrottle.recordPage(account.id); };
      session = await this.lifecycle.acquireSession(account, platform, guards, { onPageOpen });
    } catch (err) {
      // 浏览器启动失败时释放锁，避免账号被锁死直到 TTL 过期
      await this.deps.accountLock.release(account.id);
      throw err;
    }

    log.info(
      { accountId: account.id, pageCount: throttle.pageCount },
      '分配 Session',
    );

    const release = async (opts?: ReleaseOptions) => {
      try {
        if (this.headless) {
          await session.close();
        }
      } catch {
        // session 可能已关闭
      }
      this.lifecycle.releaseSession(account.id);
      await this.deps.accountLock.release(account.id);
      if (opts) {
        await this.healthTracker.processRelease(account.id, opts);
      }
      if (this.deps.circuitBreaker && opts) {
        const tripped = !!(opts.captcha || opts.sessionExpired);
        this.deps.circuitBreaker.recordResult(tripped);
      }
    };

    return { session, accountId: account.id, release };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('AccountPool 未初始化，请先调用 initialize()');
    }
  }

  private get healthTracker(): HealthTracker {
    return this.deps.healthTracker;
  }

  private get pageThrottle(): PageThrottle {
    return this.deps.pageThrottle;
  }

  private get lifecycle(): BrowserLifecycle {
    return this.deps.lifecycle;
  }
}

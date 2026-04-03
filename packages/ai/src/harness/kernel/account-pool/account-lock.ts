import { hostname } from 'node:os';

const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

/** 分布式账号锁 — 保证同一账号同一时间只被一个 Worker 占用 */

const LOCK_PREFIX = 'account:lock:';
const DEFAULT_TTL_SEC = 900; // 15 分钟，覆盖详情截图+AI 分析等耗时操作
const RENEW_INTERVAL_MS = 60_000; // 每 60 秒续期一次

// 释放锁的 Lua 脚本：仅当值匹配 workerId 时才删除（compare-and-delete 原子性）
const LUA_RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

// 续期锁的 Lua 脚本：仅当值匹配 workerId 时才续期（防止续了别人的锁）
const LUA_RENEW = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
else
  return 0
end
`;

// 清理所有账号锁的 Lua 脚本（启动时清理上一进程残留）
const LUA_RELEASE_ALL = `
local keys = redis.call('KEYS', ARGV[1])
for i, key in ipairs(keys) do
  redis.call('DEL', key)
end
return #keys
`;

export interface AccountLockStore {
  set(...args: unknown[]): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: unknown[]): Promise<unknown>;
  exists(...keys: string[]): Promise<number>;
}

export class AccountLock {
  private readonly workerId: string;
  private readonly renewTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private readonly store: AccountLockStore) {
    this.workerId = `${process.pid}@${hostname()}`;
  }

  /** 尝试获取账号锁，成功返回 true，已被占用返回 false */
  async acquire(accountId: string, ttlSec: number = DEFAULT_TTL_SEC): Promise<boolean> {
    const key = LOCK_PREFIX + accountId;
    const result = await this.store.set(key, this.workerId, 'NX', 'EX', ttlSec);
    const acquired = result === 'OK';

    if (acquired) {
      log.debug({ accountId, workerId: this.workerId, ttlSec }, '获取账号锁');
      this.startAutoRenew(accountId, ttlSec);
    }
    return acquired;
  }

  /** 释放账号锁（仅释放自己持有的锁） */
  async release(accountId: string): Promise<void> {
    this.stopAutoRenew(accountId);
    const key = LOCK_PREFIX + accountId;
    const released = await this.store.eval(LUA_RELEASE, 1, key, this.workerId);
    if (released) {
      log.debug({ accountId }, '释放账号锁');
    }
  }

  /** 检查账号是否被锁定 */
  async isLocked(accountId: string): Promise<boolean> {
    const key = LOCK_PREFIX + accountId;
    return (await this.store.exists(key)) > 0;
  }

  /** 启动时清理所有残留的账号锁（上一进程崩溃/重启后遗留） */
  async releaseAll(): Promise<number> {
    const pattern = LOCK_PREFIX + '*';
    const count = await this.store.eval(LUA_RELEASE_ALL, 0, pattern) as number;
    if (count > 0) {
      log.info({ count }, '清理残留账号锁');
    }
    return count;
  }

  /** 启动自动续期：每 60 秒续期一次，防止长任务锁过期 */
  private startAutoRenew(accountId: string, ttlSec: number): void {
    this.stopAutoRenew(accountId); // 防止重复
    const timer = setInterval(async () => {
      try {
        const key = LOCK_PREFIX + accountId;
        const renewed = await this.store.eval(LUA_RENEW, 1, key, this.workerId, String(ttlSec));
        if (!renewed) {
          // 锁已不属于自己（过期被抢或已释放），停止续期
          log.warn({ accountId }, '锁续期失败，锁已不属于当前 worker');
          this.stopAutoRenew(accountId);
        }
      } catch (err: any) {
        log.warn({ accountId, err: err.message }, '锁续期异常');
      }
    }, RENEW_INTERVAL_MS);
    // 不阻止进程退出
    timer.unref();
    this.renewTimers.set(accountId, timer);
  }

  /** 停止自动续期 */
  private stopAutoRenew(accountId: string): void {
    const timer = this.renewTimers.get(accountId);
    if (timer) {
      clearInterval(timer);
      this.renewTimers.delete(accountId);
    }
  }
}

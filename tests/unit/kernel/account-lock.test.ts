import { describe, test, expect, beforeEach } from 'bun:test';
import { AccountLock, type AccountLockStore } from '../../../packages/ai/dist/harness/kernel/account-pool/account-lock.js';

function createMockStore(): AccountLockStore & { __data: Map<string, { value: string; ttl: number }> } {
  const data = new Map<string, { value: string; ttl: number }>();

  return {
    __data: data,
    async set(...args: unknown[]): Promise<unknown> {
      const [key, value, nx, _ex, ttl] = args as [string, string, string, string, number];
      if (nx === 'NX' && data.has(key)) return null;
      data.set(key, { value, ttl });
      return 'OK';
    },
    async eval(script: string, _numKeys: number, ...args: unknown[]): Promise<unknown> {
      // compare-and-delete Lua simulation
      const key = args[0] as string;
      const expectedValue = args[1] as string;
      const entry = data.get(key);
      if (entry && entry.value === expectedValue) {
        data.delete(key);
        return 1;
      }
      return 0;
    },
    async exists(...keys: string[]): Promise<number> {
      return keys.filter(k => data.has(k)).length;
    },
  };
}

describe('AccountLock', () => {
  let store: ReturnType<typeof createMockStore>;
  let lock: AccountLock;

  beforeEach(() => {
    store = createMockStore();
    lock = new AccountLock(store);
  });

  test('acquire returns true on success', async () => {
    expect(await lock.acquire('acc_1')).toBe(true);
  });

  test('duplicate acquire on same account returns false (already occupied)', async () => {
    await lock.acquire('acc_1');
    expect(await lock.acquire('acc_1')).toBe(false);
  });

  test('different accounts can acquire simultaneously', async () => {
    expect(await lock.acquire('acc_1')).toBe(true);
    expect(await lock.acquire('acc_2')).toBe(true);
  });

  test('can re-acquire after release', async () => {
    await lock.acquire('acc_1');
    await lock.release('acc_1');
    expect(await lock.acquire('acc_1')).toBe(true);
  });

  test('releasing non-existent lock does not throw', async () => {
    await lock.release('nonexistent');
  });

  test('isLocked correctly reflects lock state', async () => {
    expect(await lock.isLocked('acc_1')).toBe(false);
    await lock.acquire('acc_1');
    expect(await lock.isLocked('acc_1')).toBe(true);
    await lock.release('acc_1');
    expect(await lock.isLocked('acc_1')).toBe(false);
  });

  test('different worker cannot release another worker lock', async () => {
    // lock1 acquires the lock
    const lock1 = new AccountLock(store);
    await lock1.acquire('acc_1');

    // Simulate a different worker by manually setting a different value
    store.__data.set('account:lock:acc_1', { value: 'other-worker', ttl: 300 });
    await lock1.release('acc_1');
    // Value mismatch, lock was not released
    expect(await lock1.isLocked('acc_1')).toBe(true);
  });

  test('acquire with TTL parameter', async () => {
    await lock.acquire('acc_1', 60);
    const entry = store.__data.get('account:lock:acc_1');
    expect(entry?.ttl).toBe(60);
  });

  test('acquire starts auto-renewal, release stops it', async () => {
    // acquire should create a timer
    await lock.acquire('acc_1');
    // @ts-ignore -- access private field to check timer exists
    expect(lock['renewTimers'].has('acc_1')).toBe(true);

    await lock.release('acc_1');
    // @ts-ignore
    expect(lock['renewTimers'].has('acc_1')).toBe(false);
  });

  test('failed acquire does not start renewal', async () => {
    await lock.acquire('acc_1');
    // Second acquire should fail
    const lock2 = new AccountLock(store);
    await lock2.acquire('acc_1'); // false
    // @ts-ignore
    expect(lock2['renewTimers'].has('acc_1')).toBe(false);
  });

  test('repeated acquire/release on same account does not leak timers', async () => {
    await lock.acquire('acc_1');
    await lock.release('acc_1');
    await lock.acquire('acc_1');
    // @ts-ignore
    expect(lock['renewTimers'].size).toBe(1);
    await lock.release('acc_1');
    // @ts-ignore
    expect(lock['renewTimers'].size).toBe(0);
  });
});

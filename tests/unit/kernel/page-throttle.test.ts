import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { PageThrottle, type PageThrottleStore } from '../../../packages/ai/dist/harness/kernel/account-pool/page-throttle.js';

function createStore(): PageThrottleStore & { __store: Map<string, Map<string, string>> } {
  const store = new Map<string, Map<string, string>>();
  return {
    hget: mock(async (key: string, field: string) => {
      return store.get(key)?.get(field) ?? null;
    }),
    hmset: mock(async (key: string, data: Record<string, string>) => {
      if (!store.has(key)) store.set(key, new Map());
      const hash = store.get(key)!;
      for (const [field, value] of Object.entries(data)) {
        hash.set(field, value);
      }
      return 'OK';
    }),
    hincrby: mock(async (key: string, field: string, increment: number) => {
      if (!store.has(key)) store.set(key, new Map());
      const hash = store.get(key)!;
      const current = Number(hash.get(field) || '0');
      const next = current + increment;
      hash.set(field, String(next));
      return next;
    }),
    hgetall: mock(async (key: string) => {
      const hash = store.get(key);
      if (!hash || hash.size === 0) return {};
      const object: Record<string, string> = {};
      for (const [field, value] of hash) object[field] = value;
      return object;
    }),
    expire: mock(async () => 1),
    del: mock(async (key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
    __store: store,
  };
}

describe('PageThrottle', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  test('recordPage increments count', async () => {
    const throttle = new PageThrottle(store, 5, 1000);

    const s1 = await throttle.recordPage('acc_01');
    expect(s1.pageCount).toBe(1);
    expect(s1.resting).toBe(false);

    const s2 = await throttle.recordPage('acc_01');
    expect(s2.pageCount).toBe(2);
    expect(s2.resting).toBe(false);
  });

  test('enters rest after reaching limit', async () => {
    const throttle = new PageThrottle(store, 3, 60_000);

    await throttle.recordPage('acc_01');
    await throttle.recordPage('acc_01');
    const s3 = await throttle.recordPage('acc_01');

    expect(s3.resting).toBe(true);
    expect(s3.pageCount).toBe(0);
    expect(s3.restUntil).toBeGreaterThan(Date.now());
  });

  test('getStatus returns correct rest state', async () => {
    const throttle = new PageThrottle(store, 2, 60_000);

    const s0 = await throttle.getStatus('acc_01');
    expect(s0.pageCount).toBe(0);
    expect(s0.resting).toBe(false);

    await throttle.recordPage('acc_01');
    const s1 = await throttle.getStatus('acc_01');
    expect(s1.pageCount).toBe(1);
    expect(s1.resting).toBe(false);

    await throttle.recordPage('acc_01');
    const s2 = await throttle.getStatus('acc_01');
    expect(s2.resting).toBe(true);
    expect(s2.restUntil).toBeGreaterThan(Date.now());
  });

  test('auto-resets after rest expires', async () => {
    const throttle = new PageThrottle(store, 2, 100);

    await throttle.recordPage('acc_01');
    await throttle.recordPage('acc_01');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const status = await throttle.getStatus('acc_01');
    expect(status.resting).toBe(false);
    expect(status.pageCount).toBe(0);
  });

  test('recordPage restarts count after rest expires', async () => {
    const throttle = new PageThrottle(store, 2, 100);

    await throttle.recordPage('acc_01');
    await throttle.recordPage('acc_01');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const status = await throttle.recordPage('acc_01');
    expect(status.pageCount).toBe(1);
    expect(status.resting).toBe(false);
  });

  test('reset clears all state', async () => {
    const throttle = new PageThrottle(store, 2, 60_000);

    await throttle.recordPage('acc_01');
    await throttle.recordPage('acc_01');
    await throttle.reset('acc_01');

    const status = await throttle.getStatus('acc_01');
    expect(status.pageCount).toBe(0);
    expect(status.resting).toBe(false);
    expect(status.restUntil).toBe(0);
  });

  test('different accounts count independently', async () => {
    const throttle = new PageThrottle(store, 3, 60_000);

    await throttle.recordPage('acc_01');
    await throttle.recordPage('acc_01');
    await throttle.recordPage('acc_02');

    const s1 = await throttle.getStatus('acc_01');
    const s2 = await throttle.getStatus('acc_02');

    expect(s1.pageCount).toBe(2);
    expect(s2.pageCount).toBe(1);
  });
});

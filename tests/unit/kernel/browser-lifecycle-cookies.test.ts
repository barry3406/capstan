import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { BrowserLifecycle } from '../../../packages/ai/dist/harness/kernel/account-pool/browser-lifecycle.js';
import type { AccountConfig } from '../../../packages/ai/dist/harness/kernel/account-pool/types.js';
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

// --- Mock helpers ---

function makeMockContext(
  cookies: Array<{ name: string; value: string; domain: string; path: string }> = [],
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> = [],
) {
  return {
    pages: () => [],
    newPage: mock(() => Promise.resolve({ close: mock(() => {}) })),
    addCookies: mock(() => {}),
    addInitScript: mock(() => {}),
    cookies: mock(() => Promise.resolve(cookies)),
    storageState: mock(() => Promise.resolve({
      cookies,
      origins,
    })),
    close: mock(() => {}),
  };
}

function makeMockManager(mockContext: ReturnType<typeof makeMockContext>) {
  return {
    initialize: mock(() => Promise.resolve(mockContext)),
    getContext: mock(() => Promise.resolve(mockContext)),
    close: mock(() => Promise.resolve(undefined)),
    createSession: mock(() => Promise.resolve({ close: mock(() => {}) })),
    engineName: 'camoufox',
  };
}

function makeAccount(id: string): AccountConfig {
  return { id, name: `account-${id}`, engine: 'camoufox', priority: 5, tags: [] };
}

// --- Tests ---

describe('BrowserLifecycle - cookies persistence', () => {
  let lifecycle: BrowserLifecycle;
  let testDir: string;
  let previousBrowserRoot: string | undefined;

  beforeEach(() => {
    previousBrowserRoot = process.env.CAPSTAN_BROWSER_ROOT;
    lifecycle = new BrowserLifecycle();
    testDir = join(tmpdir(), `test-userdata-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    await lifecycle.shutdown();
    if (previousBrowserRoot == null) {
      delete process.env.CAPSTAN_BROWSER_ROOT;
    } else {
      process.env.CAPSTAN_BROWSER_ROOT = previousBrowserRoot;
    }
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  test('closeBrowser calls persistCookies before closing', async () => {
    const ctx = makeMockContext([{ name: 'pin', value: 'v1', domain: '.jd.com', path: '/' }]);
    const mgr = makeMockManager(ctx);
    const entry = {
      manager: mgr,
      slot: { accountId: 'jd-01', lastUsedAt: Date.now(), inUse: false },
      lockPromise: null,
      lockResolve: null,
      cookieFileMtimeMs: 0,
    };
    (lifecycle as any).browsers.set('jd-01', entry);

    await lifecycle.closeBrowser('jd-01');

    expect(ctx.storageState).toHaveBeenCalled();
    expect(mgr.close).toHaveBeenCalled();
    expect((lifecycle as any).browsers.has('jd-01')).toBe(false);
  });

  test('releaseSession async writes cookies', async () => {
    const ctx = makeMockContext([{ name: 'pin', value: 'refreshed', domain: '.jd.com', path: '/' }]);
    const mgr = makeMockManager(ctx);
    const entry = {
      manager: mgr,
      slot: { accountId: 'jd-02', lastUsedAt: Date.now() - 1000, inUse: true },
      lockPromise: null,
      lockResolve: null,
      cookieFileMtimeMs: 0,
    };
    (lifecycle as any).browsers.set('jd-02', entry);

    lifecycle.releaseSession('jd-02');

    expect(entry.slot.inUse).toBe(false);
    expect(entry.slot.lastUsedAt).toBeGreaterThan(Date.now() - 100);

    await new Promise(r => setTimeout(r, 50));
    expect(ctx.storageState).toHaveBeenCalled();
  });

  test('releaseSession on non-existent account does not throw', () => {
    expect(() => lifecycle.releaseSession('nonexistent')).not.toThrow();
  });

  test('persistCookies with empty cookies does not write file', async () => {
    const ctx = makeMockContext([]);
    const mgr = makeMockManager(ctx);

    await (lifecycle as any).persistCookies('jd-03', mgr);

    expect(ctx.storageState).toHaveBeenCalled();
  });

  test('persistCookies does not crash when manager is already closed', async () => {
    const mgr = {
      getContext: mock(() => Promise.reject(new Error('Browser not initialized'))),
      engineName: 'camoufox',
    };

    const result = await (lifecycle as any).persistCookies('jd-04', mgr);
    expect(result).toBeUndefined();
  });

  test('evictIdle persists cookies before closing idle browser', async () => {
    const ctx = makeMockContext([{ name: 'pin', value: 'v1', domain: '.jd.com', path: '/' }]);
    const mgr = makeMockManager(ctx);
    const entry = {
      manager: mgr,
      slot: { accountId: 'jd-05', lastUsedAt: Date.now() - 6 * 60_000, inUse: false },
      lockPromise: null,
      lockResolve: null,
      cookieFileMtimeMs: 0,
    };
    (lifecycle as any).browsers.set('jd-05', entry);

    await (lifecycle as any).evictIdle();

    expect(ctx.storageState).toHaveBeenCalled();
    expect(mgr.close).toHaveBeenCalled();
    expect((lifecycle as any).browsers.has('jd-05')).toBe(false);
  });

  test('evictIdle does not evict in-use browsers', async () => {
    const ctx = makeMockContext();
    const mgr = makeMockManager(ctx);
    const entry = {
      manager: mgr,
      slot: { accountId: 'jd-06', lastUsedAt: Date.now() - 10 * 60_000, inUse: true },
      lockPromise: null,
      lockResolve: null,
      cookieFileMtimeMs: 0,
    };
    (lifecycle as any).browsers.set('jd-06', entry);

    await (lifecycle as any).evictIdle();

    expect(mgr.close).not.toHaveBeenCalled();
    expect((lifecycle as any).browsers.has('jd-06')).toBe(true);
  });

  test('LRU eviction persists cookies first', async () => {
    const ctx1 = makeMockContext([{ name: 'pin', value: 'old', domain: '.jd.com', path: '/' }]);
    const mgr1 = makeMockManager(ctx1);
    const ctx2 = makeMockContext([{ name: 'pin', value: 'new', domain: '.jd.com', path: '/' }]);
    const mgr2 = makeMockManager(ctx2);

    (lifecycle as any).browsers.set('old-acc', {
      manager: mgr1,
      slot: { accountId: 'old-acc', lastUsedAt: Date.now() - 100_000, inUse: false },
      lockPromise: null, lockResolve: null, cookieFileMtimeMs: 0,
    });
    (lifecycle as any).browsers.set('new-acc', {
      manager: mgr2,
      slot: { accountId: 'new-acc', lastUsedAt: Date.now(), inUse: true },
      lockPromise: null, lockResolve: null, cookieFileMtimeMs: 0,
    });

    const evicted = await (lifecycle as any).evictLRU('some-other');

    expect(evicted).toBe(true);
    expect(ctx1.storageState).toHaveBeenCalled();
    expect(mgr1.close).toHaveBeenCalled();
    expect((lifecycle as any).browsers.has('old-acc')).toBe(false);
    expect((lifecycle as any).browsers.has('new-acc')).toBe(true);
  });

  test('shutdown persists cookies for all browsers', async () => {
    const ctx = makeMockContext([{ name: 'token', value: 'abc', domain: '.taobao.com', path: '/' }]);
    const mgr = makeMockManager(ctx);

    (lifecycle as any).browsers.set('tb-01', {
      manager: mgr,
      slot: { accountId: 'tb-01', lastUsedAt: Date.now(), inUse: false },
      lockPromise: null, lockResolve: null, cookieFileMtimeMs: 0,
    });

    await lifecycle.shutdown();

    expect(ctx.storageState).toHaveBeenCalled();
    expect(mgr.close).toHaveBeenCalled();
  });

  test('launchRemoteBrowser uses configurable browser root and persists fingerprint', async () => {
    process.env.CAPSTAN_BROWSER_ROOT = testDir;

    const ctx = makeMockContext();
    const mgr = makeMockManager(ctx);
    const remoteLifecycle = new BrowserLifecycle(true, () => mgr as any);

    try {
      await remoteLifecycle.launchRemoteBrowser('jd-root', 'camoufox', { platform: 'jd' });

      expect(mgr.initialize).toHaveBeenCalled();
      expect(existsSync(join(testDir, 'jd-root', 'fingerprint.json'))).toBe(true);
    } finally {
      await remoteLifecycle.shutdown();
    }
  });

  // --- Cookie refresh on browser reuse ---

  test('reuse browser refreshes cookies from disk', async () => {
    const freshCookies = [
      { name: 'pin', value: 'fresh_user', domain: '.jd.com', path: '/' },
      { name: 'thor', value: 'fresh_token', domain: '.jd.com', path: '/' },
    ];
    const ctx = makeMockContext(freshCookies);
    const mgr = makeMockManager(ctx);
    const entry = {
      manager: mgr,
      slot: { accountId: 'jd-10', lastUsedAt: Date.now() - 1000, inUse: false },
      lockPromise: null,
      lockResolve: null,
      cookieFileMtimeMs: 0, // initial 0 ensures load
    };
    (lifecycle as any).browsers.set('jd-10', entry);

    // Simulate remote login writing storageState.json
    const userDataDir = join(homedir(), '.capstan', 'browsers', 'jd-10');
    mkdirSync(userDataDir, { recursive: true });
    const statePath = join(userDataDir, 'storageState.json');
    writeFileSync(statePath, JSON.stringify({ cookies: freshCookies, origins: [] }));

    try {
      await (lifecycle as any).loadCookiesFromDisk('jd-10', entry);

      expect(ctx.addCookies).toHaveBeenCalledWith(freshCookies);
      expect(entry.cookieFileMtimeMs).toBeGreaterThan(0);
    } finally {
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('loadCookiesFromDisk skips loading when file not updated', async () => {
    const ctx = makeMockContext();
    const mgr = makeMockManager(ctx);

    const userDataDir = join(homedir(), '.capstan', 'browsers', 'jd-11');
    mkdirSync(userDataDir, { recursive: true });
    const statePath = join(userDataDir, 'storageState.json');
    writeFileSync(statePath, JSON.stringify({
      cookies: [{ name: 'pin', value: 'v1', domain: '.jd.com', path: '/' }],
      origins: [],
    }));

    try {
      const mtime = statSync(statePath).mtimeMs;

      const entry = {
        manager: mgr,
        slot: { accountId: 'jd-11', lastUsedAt: Date.now(), inUse: false },
        lockPromise: null,
        lockResolve: null,
        cookieFileMtimeMs: mtime, // already loaded this version
      };
      (lifecycle as any).browsers.set('jd-11', entry);

      await (lifecycle as any).loadCookiesFromDisk('jd-11', entry);

      // File not updated, should not call addCookies
      expect(ctx.addCookies).not.toHaveBeenCalled();
    } finally {
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('persistCookies skips writeback when external update detected', async () => {
    const staleCookies = [{ name: 'pin', value: 'stale', domain: '.jd.com', path: '/' }];
    const ctx = makeMockContext(staleCookies);
    const mgr = makeMockManager(ctx);

    const userDataDir = join(homedir(), '.capstan', 'browsers', 'jd-12');
    mkdirSync(userDataDir, { recursive: true });
    const statePath = join(userDataDir, 'storageState.json');

    // Write an old version (simulating the one loaded at browser start)
    writeFileSync(statePath, JSON.stringify({ cookies: staleCookies, origins: [] }));
    const oldMtime = statSync(statePath).mtimeMs;

    const entry = {
      manager: mgr,
      slot: { accountId: 'jd-12', lastUsedAt: Date.now(), inUse: false },
      lockPromise: null,
      lockResolve: null,
      cookieFileMtimeMs: oldMtime,
    };
    (lifecycle as any).browsers.set('jd-12', entry);

    // Simulate remote login updating storageState.json (mtime changes)
    await new Promise(r => setTimeout(r, 50)); // ensure different mtime
    const freshCookies = [{ name: 'pin', value: 'fresh', domain: '.jd.com', path: '/' }];
    writeFileSync(statePath, JSON.stringify({ cookies: freshCookies, origins: [] }));

    try {
      // persistCookies should skip writeback (file was externally updated)
      await (lifecycle as any).persistCookies('jd-12', mgr);

      // File content should still be fresh cookies (not overwritten with stale)
      const saved = JSON.parse(readFileSync(statePath, 'utf-8'));
      expect(saved.cookies[0].value).toBe('fresh');
    } finally {
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('persistAllCookies periodically persists all active browsers', async () => {
    const ctx1 = makeMockContext([{ name: 'pin', value: 'u1', domain: '.jd.com', path: '/' }]);
    const mgr1 = makeMockManager(ctx1);
    const ctx2 = makeMockContext([{ name: 'token', value: 'u2', domain: '.taobao.com', path: '/' }]);
    const mgr2 = makeMockManager(ctx2);

    (lifecycle as any).browsers.set('jd-20', {
      manager: mgr1,
      slot: { accountId: 'jd-20', lastUsedAt: Date.now(), inUse: true },
      lockPromise: null, lockResolve: null, cookieFileMtimeMs: 0,
    });
    (lifecycle as any).browsers.set('tb-20', {
      manager: mgr2,
      slot: { accountId: 'tb-20', lastUsedAt: Date.now(), inUse: false },
      lockPromise: null, lockResolve: null, cookieFileMtimeMs: 0,
    });

    // Directly call persistAllCookies
    (lifecycle as any).persistAllCookies();

    // Wait for async persistence to complete
    await new Promise(r => setTimeout(r, 50));

    // Both browsers should have been persisted
    expect(ctx1.storageState).toHaveBeenCalled();
    expect(ctx2.storageState).toHaveBeenCalled();
  });

  test('start sets cookiePersistTimer', () => {
    lifecycle.start();
    expect((lifecycle as any).cookiePersistTimer).not.toBeNull();
  });

  test('shutdown clears cookiePersistTimer', async () => {
    lifecycle.start();
    expect((lifecycle as any).cookiePersistTimer).not.toBeNull();
    await lifecycle.shutdown();
    expect((lifecycle as any).cookiePersistTimer).toBeNull();
  });

  test('loadCookiesFromDisk also restores localStorage', async () => {
    const lsData = [
      { origin: 'https://www.jd.com', localStorage: [{ name: 'token', value: 'abc123' }] },
    ];
    const ctx = makeMockContext(
      [{ name: 'pin', value: 'user', domain: '.jd.com', path: '/' }],
      lsData,
    );
    const mgr = makeMockManager(ctx);
    const entry = {
      manager: mgr,
      slot: { accountId: 'jd-30', lastUsedAt: Date.now(), inUse: false },
      lockPromise: null, lockResolve: null, cookieFileMtimeMs: 0,
    };
    (lifecycle as any).browsers.set('jd-30', entry);

    const userDataDir = join(homedir(), '.capstan', 'browsers', 'jd-30');
    mkdirSync(userDataDir, { recursive: true });
    const statePath = join(userDataDir, 'storageState.json');
    writeFileSync(statePath, JSON.stringify({
      cookies: [{ name: 'pin', value: 'user', domain: '.jd.com', path: '/' }],
      origins: lsData,
    }));

    try {
      await (lifecycle as any).loadCookiesFromDisk('jd-30', entry);

      expect(ctx.addCookies).toHaveBeenCalled();
      // addInitScript should have been called to restore localStorage
      expect(ctx.addInitScript).toHaveBeenCalled();
    } finally {
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('restoreLocalStorage injects localStorage into open pages', async () => {
    const mockEvaluate = mock(() => Promise.resolve());
    const lsData = [
      { origin: 'https://www.jd.com', localStorage: [{ name: 'tk', value: 'v1' }] },
    ];
    const ctx = makeMockContext([], lsData);
    // Simulate already-open pages
    (ctx as any).pages = () => [{
      url: () => 'https://www.jd.com/product/123',
      evaluate: mockEvaluate,
    }];

    await (lifecycle as any).restoreLocalStorage(ctx, lsData);

    // Open page should be injected via evaluate
    expect(mockEvaluate).toHaveBeenCalledWith(expect.any(Function), lsData[0].localStorage);
    // Also register addInitScript for future pages
    expect(ctx.addInitScript).toHaveBeenCalled();
  });

  test('persistCookies saves when only localStorage present (no cookies)', async () => {
    const origins = [{ origin: 'https://www.jd.com', localStorage: [{ name: 'tk', value: 'v1' }] }];
    const ctx = makeMockContext([], origins);
    const mgr = makeMockManager(ctx);

    const userDataDir = join(homedir(), '.capstan', 'browsers', 'jd-31');
    mkdirSync(userDataDir, { recursive: true });
    const statePath = join(userDataDir, 'storageState.json');

    try {
      await (lifecycle as any).persistCookies('jd-31', mgr);

      // Should write file (because there is localStorage data)
      expect(existsSync(statePath)).toBe(true);
      const saved = JSON.parse(readFileSync(statePath, 'utf-8'));
      expect(saved.origins[0].localStorage[0].name).toBe('tk');
    } finally {
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }
  });

  test('persistCookies force mode ignores mtime check', async () => {
    const remoteCookies = [{ name: 'pin', value: 'remote_fresh', domain: '.jd.com', path: '/' }];
    const ctx = makeMockContext(remoteCookies);
    const mgr = makeMockManager(ctx);

    const userDataDir = join(homedir(), '.capstan', 'browsers', 'jd-13');
    mkdirSync(userDataDir, { recursive: true });
    const statePath = join(userDataDir, 'storageState.json');

    // Write an old version
    writeFileSync(statePath, JSON.stringify({ cookies: [{ name: 'pin', value: 'old', domain: '.jd.com', path: '/' }], origins: [] }));
    const oldMtime = statSync(statePath).mtimeMs;

    // Set entry mtime to old value
    const entry = {
      manager: mgr,
      slot: { accountId: 'jd-13', lastUsedAt: Date.now(), inUse: false },
      lockPromise: null,
      lockResolve: null,
      cookieFileMtimeMs: oldMtime,
    };
    (lifecycle as any).browsers.set('jd-13', entry);

    // Simulate external update
    await new Promise(r => setTimeout(r, 50));
    writeFileSync(statePath, JSON.stringify({ cookies: [{ name: 'pin', value: 'external', domain: '.jd.com', path: '/' }], origins: [] }));

    try {
      // force=true should bypass mtime check and write directly
      await (lifecycle as any).persistCookies('jd-13', mgr, true);

      const saved = JSON.parse(readFileSync(statePath, 'utf-8'));
      expect(saved.cookies[0].value).toBe('remote_fresh');
    } finally {
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }
  });
});

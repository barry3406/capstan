import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { KernelSession, AccountConfig, BrowserSlot } from './types.js';
import type { GuardFn } from '../guard/types.js';
import { loadOrCreateFingerprint } from '../stealth/fingerprint.js';

const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

// ─── Inline crawlab-specific helpers ───

function getBrowserProfilesRoot(): string {
  return process.env.CAPSTAN_BROWSER_ROOT || join(homedir(), '.capstan', 'browsers');
}

/** Resolve user data directory for browser profiles */
function getUserDataDir(accountId: string, engine: string): string {
  const normalizedEngine = engine || 'camoufox';
  const rootDir = getBrowserProfilesRoot();
  return normalizedEngine === 'camoufox'
    ? join(rootDir, accountId)
    : join(rootDir, normalizedEngine, accountId);
}

// ─── Stub engine / BrowserManager ───

/** Minimal browser engine interface */
interface BrowserEngine {
  name: string;
}

/** Stub: create engine — defaults to a CamoufoxEngine-like object */
function createEngine(engineName?: string): BrowserEngine {
  return { name: engineName ?? 'camoufox' };
}

/** Minimal BrowserManager interface matching the original usage */
export interface BrowserManager {
  engineName: string;
  initialize(options: {
    headless: boolean;
    userDataDir: string;
    proxy?: string | { server: string; username?: string; password?: string };
    viewport?: any;
    mobile?: boolean;
    humanize?: boolean;
  }): Promise<any>;
  createSession(
    accountId: string,
    platform: string,
    guards: GuardFn[],
    options?: { onPageOpen?: () => Promise<void> },
  ): Promise<KernelSession>;
  getContext(): Promise<any>;
  close(): Promise<void>;
}

const MAX_CONCURRENT_BROWSERS = parseInt(process.env.MAX_BROWSERS ?? '6', 10);
const IDLE_TIMEOUT_MS = 5 * 60_000;
const SCAN_INTERVAL_MS = 60_000;
const COOKIE_PERSIST_INTERVAL_MS = 5_000;

/** 各平台的关键登录 cookie — persistCookies 会保护这些 cookie 不被平台的 set-cookie 清除覆盖 */
const AUTH_COOKIE_NAMES = new Set([
  'thor', 'pin', 'pt_key', 'pt_pin', 'pt_token', 'unick', '_token',  // JD
  'login', '_m_h5_tk', '_m_h5_tk_enc', 'cookie2', '_tb_token_',       // Taobao
  'PASS_ID', 'PASS_LOGIN', 'PDDAccessToken',                          // PDD
]);

interface BrowserEntry {
  manager: BrowserManager;
  slot: BrowserSlot;
  lockPromise: Promise<void> | null;
  lockResolve: (() => void) | null;
  /** storageState.json 最后一次被本进程加载/写入时的 mtime（ms），用于防止 remote 登录被覆盖 */
  cookieFileMtimeMs: number;
}

export class BrowserLifecycle {
  private browsers = new Map<string, BrowserEntry>();
  private remoteBrowsers = new Map<string, BrowserManager>();
  private pendingLaunches = new Map<string, Promise<BrowserEntry>>();
  private queuedLaunches = new Set<string>();
  /** 全局 launch 串行锁：保证容量检查和 launchBrowser 之间不被并发插入 */
  private launchMutex: Promise<void> = Promise.resolve();
  /** 已被标记为删除的账号 — doLaunch 入口检查，拒绝为其启动浏览器 */
  private revokedAccounts = new Set<string>();
  /** 账号生命周期代际：删除后递增，阻止旧请求在重新创建同 ID 后"复活" */
  private accountEpochs = new Map<string, number>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private cookiePersistTimer: ReturnType<typeof setInterval> | null = null;
  private headless: boolean;

  /** Factory for creating BrowserManager instances — inject to customize */
  createBrowserManager: (engine: BrowserEngine) => BrowserManager;

  constructor(
    headless: boolean = true,
    createBrowserManager?: (engine: BrowserEngine) => BrowserManager,
  ) {
    this.headless = headless;
    this.createBrowserManager = createBrowserManager ?? (() => {
      throw new Error('BrowserManager factory not provided. Inject via constructor.');
    });
  }

  start(): void {
    if (this.scanTimer) return;
    this.scanTimer = setInterval(() => this.evictIdle(), SCAN_INTERVAL_MS);
    this.cookiePersistTimer = setInterval(() => this.persistAllCookies(), COOKIE_PERSIST_INTERVAL_MS);
    log.info('浏览器生命周期管理已启动');
  }

  async acquireSession(
    account: AccountConfig,
    platform: string,
    guards: GuardFn[],
    options?: { onPageOpen?: () => Promise<void> },
  ): Promise<KernelSession> {
    await this.waitForLock(account.id);

    let entry = this.browsers.get(account.id);
    if (!entry) {
      // 同账号已在启动中 → 等它完成
      const pending = this.pendingLaunches.get(account.id);
      if (pending) {
        entry = await pending;
      } else {
        // 通过全局互斥锁串行化"容量检查 + 启动"，防止跨账号并发绕过上限
        entry = await this.serializedLaunch(account, platform);
      }
    } else {
      // 复用已有浏览器 → 从磁盘刷新 cookies（remote 登录可能已更新 storageState）
      await this.loadCookiesFromDisk(account.id, entry);
    }

    this.setLock(entry);
    entry.slot.inUse = true;
    entry.slot.lastUsedAt = Date.now();

    try {
      const session = await entry.manager.createSession(account.id, platform, guards, options);
      return session;
    } catch (err) {
      this.releaseLock(entry);
      entry.slot.inUse = false;
      throw err;
    }
  }

  /** 串行化容量检查 + 浏览器启动，防止跨账号并发突破上限 */
  private async serializedLaunch(account: AccountConfig, platform: string): Promise<BrowserEntry> {
    const launchEpoch = this.getAccountEpoch(account.id);
    this.queuedLaunches.add(account.id);

    // 同 profile 不能同时被两个 Firefox 实例使用 —— 在 mutex 外关闭，避免阻塞全局链
    await this.closeRemoteBrowser(account.id);

    const doLaunch = async (): Promise<BrowserEntry> => {
      this.queuedLaunches.delete(account.id);

      // 检查账号是否已被撤销（删除账号后排队中的 launch 到达这里时应中止）
      if (this.revokedAccounts.has(account.id) || this.getAccountEpoch(account.id) !== launchEpoch) {
        throw new Error(`账号 ${account.id} 已被删除，取消启动浏览器`);
      }

      // 二次检查：可能在等锁期间其他请求已为该账号启动
      const existing = this.browsers.get(account.id);
      if (existing) return existing;

      // 活跃数 = 已就绪 + 正在启动中
      const activeCount = this.browsers.size + this.pendingLaunches.size;
      if (activeCount >= MAX_CONCURRENT_BROWSERS) {
        const evicted = await this.evictLRU(account.id);
        const afterEvict = this.browsers.size + this.pendingLaunches.size;
        if (!evicted && afterEvict >= MAX_CONCURRENT_BROWSERS) {
          throw new Error(`已达浏览器并发上限 ${MAX_CONCURRENT_BROWSERS}，所有浏览器都在使用中`);
        }
      }

      const launchPromise = this.launchBrowser(account, platform);
      this.pendingLaunches.set(account.id, launchPromise);
      try {
        return await launchPromise;
      } finally {
        this.pendingLaunches.delete(account.id);
      }
    };

    // 链式互斥：每个 launch 排队在上一个之后
    const prev = this.launchMutex;
    let resolve!: () => void;
    this.launchMutex = new Promise<void>(r => { resolve = r; });
    return prev.then(doLaunch).finally(() => {
      this.queuedLaunches.delete(account.id);
      resolve();
    });
  }

  releaseSession(accountId: string): void {
    const entry = this.browsers.get(accountId);
    if (entry) {
      entry.slot.inUse = false;
      entry.slot.lastUsedAt = Date.now();
      this.releaseLock(entry);

      // 异步回写 cookies，不阻塞释放
      this.persistCookies(accountId, entry.manager).catch(() => {});
    }
  }

  async closeBrowser(accountId: string): Promise<void> {
    const entry = this.browsers.get(accountId);
    if (!entry) return;

    // 关闭前先保存 cookies，防止丢失
    await this.persistCookies(accountId, entry.manager);

    try {
      await entry.manager.close();
    } catch (err) {
      log.error({ accountId, err }, '关闭浏览器失败');
    }
    this.browsers.delete(accountId);
    log.info({ accountId }, '浏览器已关闭');
  }

  async shutdown(): Promise<void> {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.cookiePersistTimer) {
      clearInterval(this.cookiePersistTimer);
      this.cookiePersistTimer = null;
    }

    const poolIds = [...this.browsers.keys()];
    const remoteIds = [...this.remoteBrowsers.keys()];
    await Promise.allSettled([
      ...poolIds.map(id => this.closeBrowser(id)),
      ...remoteIds.map(id => this.closeRemoteBrowser(id)),
    ]);
    log.info({ pool: poolIds.length, remote: remoteIds.length }, '所有浏览器已关闭');
  }

  getSlots(): BrowserSlot[] {
    return [...this.browsers.values()].map(e => ({ ...e.slot }));
  }

  /** 返回当前本地已有浏览器的账号 ID 列表（用于亲和调度） */
  getActiveAccountIds(): string[] {
    return [...this.browsers.keys()];
  }

  /** 检查账号是否有活跃或正在启动的浏览器 */
  isActive(accountId: string): boolean {
    return this.browsers.has(accountId) || this.pendingLaunches.has(accountId) || this.queuedLaunches.has(accountId);
  }

  /** 关闭账号的浏览器（包括等待正在启动的完成后再关闭，并阻止排队中的 launch） */
  async closeBrowserForAccount(accountId: string): Promise<void> {
    // 标记撤销，阻止排队中的 launch 在后续真正启动
    this.accountEpochs.set(accountId, this.getAccountEpoch(accountId) + 1);
    this.revokedAccounts.add(accountId);

    // 如果正在启动中，等它完成再关
    const pending = this.pendingLaunches.get(accountId);
    if (pending) {
      try {
        await pending;
      } catch {
        // launch 失败或被 revoke 拦截，没有需要关的
      }
    }
    await this.closeBrowser(accountId);
  }

  /** 账号重新加入池子后，允许新的 launch 使用当前代际继续启动 */
  restoreAccount(accountId: string): void {
    this.revokedAccounts.delete(accountId);
  }

  // ─── Remote 浏览器（独立于池，不计入并发上限） ───

  async launchRemoteBrowser(
    accountId: string,
    engine?: string,
    options?: { proxy?: string | { server: string; username?: string; password?: string }; platform?: string },
  ): Promise<{ manager: BrowserManager; context: any }> {
    await this.closeRemoteBrowser(accountId);
    // 同 profile 不能同时被两个 Firefox 实例使用
    await this.closeBrowser(accountId);

    log.info({ accountId }, '启动远程浏览器');
    const eng = createEngine(engine as any);
    const manager = this.createBrowserManager(eng);
    const userDataDir = getUserDataDir(accountId, engine ?? 'camoufox');

    const mobile = options?.platform === 'pdd';

    // viewport 必须和爬取浏览器一致（来自 fingerprint），否则平台检测到分辨率突变会清除登录态
    const fp = loadOrCreateFingerprint(userDataDir);
    const viewport = mobile ? fp.mobile : fp.desktop;

    const context = await manager.initialize({
      headless: this.headless,
      userDataDir,
      proxy: options?.proxy,
      viewport,
      mobile,
      humanize: false,
    });

    this.remoteBrowsers.set(accountId, manager);
    return { manager, context };
  }

  async closeRemoteBrowser(accountId: string): Promise<void> {
    const manager = this.remoteBrowsers.get(accountId);
    if (!manager) return;

    // 关闭前回写 cookies（remote 浏览器里的 token 可能比 confirm-login 时更新）
    // force=true：remote 浏览器的 cookies 始终是最新的，不受 mtime 保护限制
    await this.persistCookies(accountId, manager, true);

    try {
      await manager.close();
    } catch (err) {
      log.error({ accountId, err }, '关闭远程浏览器失败');
    }
    this.remoteBrowsers.delete(accountId);
  }

  // ─── 内部方法 ───

  /**
   * 从 storageState.json 加载 cookies + localStorage 到浏览器 context。
   * 每次复用已有浏览器时也会调用，确保 remote 登录后的新状态被加载。
   */
  private async loadCookiesFromDisk(accountId: string, entry: BrowserEntry): Promise<void> {
    try {
      const userDataDir = getUserDataDir(accountId, entry.manager.engineName);
      const statePath = join(userDataDir, 'storageState.json');
      if (!existsSync(statePath)) return;

      const fileMtime = statSync(statePath).mtimeMs;
      // 文件没有更新过，跳过重复加载
      if (fileMtime <= entry.cookieFileMtimeMs) return;

      const state = JSON.parse(readFileSync(statePath, 'utf-8'));

      // 过滤已过期的 cookie
      if (state.cookies) {
        const now = Math.floor(Date.now() / 1000);
        state.cookies = state.cookies.filter((c: any) => {
          // 没有 expires 的是 session cookie，保留
          if (!c.expires || c.expires < 0) return true;
          // 过期的移除
          if (c.expires < now) {
            log.debug({ name: c.name, domain: c.domain }, '移除过期 cookie');
            return false;
          }
          return true;
        });
      }

      const ctx = await entry.manager.getContext();

      if (state.cookies?.length > 0) {
        await ctx.addCookies(state.cookies);
        log.info({ accountId, cookies: state.cookies.length }, '已加载 cookies');
      }

      // 恢复 localStorage：注入到已有页面 + 未来新页面
      const origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> = state.origins ?? [];
      const originsWithData = origins.filter(o => o.localStorage?.length > 0);
      if (originsWithData.length > 0) {
        await this.restoreLocalStorage(ctx, originsWithData);
        const totalItems = originsWithData.reduce((sum, o) => sum + o.localStorage.length, 0);
        log.info({ accountId, origins: originsWithData.length, items: totalItems }, '已加载 localStorage');
      }

      entry.cookieFileMtimeMs = fileMtime;
    } catch (err) {
      log.warn({ accountId, err }, '加载 storageState 失败');
    }
  }

  /**
   * 将 storageState 中的 localStorage 恢复到浏览器 context：
   * 1. 已打开的页面 — 通过 page.evaluate 直接注入
   * 2. 未来的页面 — 通过 addInitScript 在页面加载前注入
   */
  private async restoreLocalStorage(
    ctx: any,
    origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>,
  ): Promise<void> {
    // 注入已打开页面
    for (const page of ctx.pages()) {
      try {
        const pageOrigin = new URL(page.url()).origin;
        const match = origins.find(o => o.origin === pageOrigin);
        if (match) {
          await page.evaluate((items: Array<{ name: string; value: string }>) => {
            for (const { name, value } of items) {
              window.localStorage.setItem(name, value);
            }
          }, match.localStorage);
        }
      } catch { /* page closed or about:blank */ }
    }

    // 为未来新页面注入 localStorage（addInitScript 在每次导航前执行）
    const lsMap: Record<string, Array<{ name: string; value: string }>> = {};
    for (const { origin, localStorage } of origins) {
      lsMap[origin] = localStorage;
    }
    await ctx.addInitScript((map: Record<string, Array<{ name: string; value: string }>>) => {
      try {
        const items = map[window.location.origin];
        if (items) {
          for (const { name, value } of items) {
            window.localStorage.setItem(name, value);
          }
        }
      } catch { /* localStorage not available */ }
    }, lsMap);
  }

  /**
   * 将当前浏览器 context 的 cookies + localStorage 回写到 storageState.json。
   * JD 等平台会在使用过程中刷新 token，如果不回写，
   * 下次浏览器重启时加载的是旧状态，登录态就丢了。
   *
   * 如果 storageState.json 在浏览器加载之后被外部更新
   * （如 remote 登录写入了新鲜状态），则跳过回写，防止用旧状态覆盖。
   */
  private async persistCookies(accountId: string, manager: BrowserManager, force = false): Promise<void> {
    try {
      const ctx = await manager.getContext();
      const state = await ctx.storageState();

      // storageState() 在 Firefox 下可能漏掉 httpOnly cookie（如 JD 的 thor）
      // 用 context.cookies() 补全，合并两个来源确保关键登录凭证不丢
      try {
        const allCookies = await ctx.cookies();
        if (allCookies.length > 0) {
          // 以 name+domain 为 key 合并，cookies() 的值优先（更完整）
          const merged = new Map<string, any>();
          for (const c of state.cookies ?? []) merged.set(`${c.name}@${c.domain}`, c);
          for (const c of allCookies) merged.set(`${c.name}@${c.domain}`, c);
          state.cookies = [...merged.values()];
        }
      } catch { /* cookies() 失败时仍用 storageState 的 */ }

      const hasCookies = state.cookies?.length > 0;
      const hasLocalStorage = state.origins?.some((o: any) => o.localStorage?.length > 0);
      if (!hasCookies && !hasLocalStorage) return;

      const userDataDir = getUserDataDir(accountId, manager.engineName);
      mkdirSync(userDataDir, { recursive: true });
      const statePath = join(userDataDir, 'storageState.json');

      // 非 force 模式下，检查文件是否被外部更新（如 remote 登录）
      if (!force) {
        const entry = this.browsers.get(accountId);
        if (entry?.cookieFileMtimeMs) {
          try {
            const currentMtime = statSync(statePath).mtimeMs;
            if (currentMtime > entry.cookieFileMtimeMs) {
              log.info({ accountId }, 'storageState 已被外部更新（如 remote 登录），跳过回写');
              // 不更新 cookieFileMtimeMs，后续 persistCookies 也会跳过，
              // 直到 loadCookiesFromDisk 加载新文件后才更新
              return;
            }
          } catch { /* file might not exist yet */ }
        }
      }

      // Auth cookie 安全防护：如果旧文件里有登录 cookie 但当前浏览器已被平台清掉，
      // 将旧的 auth cookie 合并回去，防止 persistAllCookies 把清空后的状态写入磁盘
      if (!force && existsSync(statePath)) {
        try {
          const oldState = JSON.parse(readFileSync(statePath, 'utf-8'));
          const oldAuthCookies = (oldState.cookies ?? []).filter(
            (c: any) => AUTH_COOKIE_NAMES.has(c.name),
          );
          if (oldAuthCookies.length > 0) {
            const newCookieKeys = new Set(
              (state.cookies ?? []).map((c: any) => `${c.name}@${c.domain}`),
            );
            const missing = oldAuthCookies.filter(
              (c: any) => !newCookieKeys.has(`${c.name}@${c.domain}`),
            );
            if (missing.length > 0) {
              log.warn(
                { accountId, missing: missing.map((c: any) => c.name) },
                '检测到平台清除了登录 cookie，从旧备份恢复（不覆盖）',
              );
              // 备份当前文件以便事后分析
              try {
                copyFileSync(statePath, statePath + '.bak');
              } catch { /* ignore */ }
              // 把旧的 auth cookie 合并回新状态
              state.cookies = [...(state.cookies ?? []), ...missing];
            }
          }
        } catch { /* 旧文件解析失败则直接写入 */ }
      }

      writeFileSync(statePath, JSON.stringify(state));

      // 更新时间戳
      const entry = this.browsers.get(accountId);
      if (entry) {
        try {
          entry.cookieFileMtimeMs = statSync(statePath).mtimeMs;
        } catch {
          entry.cookieFileMtimeMs = Date.now();
        }
      }

      log.debug({ accountId, cookies: state.cookies?.length ?? 0, origins: state.origins?.length ?? 0 }, 'storageState 已回写');
    } catch (err) {
      log.warn({ accountId, err }, 'cookies 回写失败');
    }
  }

  /** 监控 set-cookie 变更：追踪平台何时刷新/清除关键登录 cookie，被清时立即恢复 */
  private monitorCookieChanges(accountId: string, manager: BrowserManager): void {
    /** 防抖：同一账号短时间内只恢复一次 */
    let restoring = false;

    manager.getContext().then(ctx => {
      ctx.on('response', (response: any) => {
        try {
          const headers = response.headers();
          const setCookie = headers['set-cookie'];
          if (!setCookie) return;

          const deletedNames: string[] = [];
          const entries = setCookie.split('\n');
          for (const entry of entries) {
            const name = entry.split('=')[0]?.trim();
            if (!name || !AUTH_COOKIE_NAMES.has(name)) continue;

            const isDelete = /expires=.*1970/i.test(entry)
              || /max-age=0/i.test(entry)
              || entry.includes(`${name}=;`)
              || entry.includes(`${name}=deleted`);

            const url = response.url();
            const domain = new URL(url).hostname;

            if (isDelete) {
              log.warn({ accountId, cookie: name, domain, url: url.slice(0, 120) },
                'set-cookie 清除登录 cookie');
              deletedNames.push(name);
            } else {
              log.info({ accountId, cookie: name, domain, url: url.slice(0, 120) },
                'set-cookie 刷新登录 cookie');
            }
          }

          // 检测到 auth cookie 被清除 → 立即从 storageState.json 恢复到浏览器内存
          if (deletedNames.length > 0 && !restoring) {
            restoring = true;
            this.restoreAuthCookies(accountId, manager, deletedNames).finally(() => {
              // 3 秒防抖，避免 JD 连续 4 个 passport URL 触发 4 次恢复
              setTimeout(() => { restoring = false; }, 3000);
            });
          }
        } catch { /* response may be closed */ }
      });
    }).catch(() => {});
  }

  /**
   * 从 storageState.json 读取 auth cookie 并用 addCookies 塞回浏览器内存，
   * 抵消平台通过 set-cookie 清除登录态的操作。
   */
  private async restoreAuthCookies(accountId: string, manager: BrowserManager, deletedNames: string[]): Promise<void> {
    try {
      const userDataDir = getUserDataDir(accountId, manager.engineName);
      const statePath = join(userDataDir, 'storageState.json');
      if (!existsSync(statePath)) return;

      const state = JSON.parse(readFileSync(statePath, 'utf-8'));
      const deletedSet = new Set(deletedNames);
      const toRestore = (state.cookies ?? []).filter((c: any) => deletedSet.has(c.name));
      if (toRestore.length === 0) return;

      const ctx = await manager.getContext();
      await ctx.addCookies(toRestore);
      log.info(
        { accountId, restored: toRestore.map((c: any) => c.name) },
        '已从 storageState 恢复被清除的 auth cookie 到浏览器内存',
      );
    } catch (err) {
      log.warn({ accountId, err }, '恢复 auth cookie 失败');
    }
  }

  /** 周期性持久化所有活跃浏览器的 cookies，防止进程崩溃时丢失登录态 */
  private persistAllCookies(): void {
    for (const [accountId, entry] of this.browsers) {
      this.persistCookies(accountId, entry.manager).catch(() => {});
    }
  }

  private async launchBrowser(account: AccountConfig, platform: string): Promise<BrowserEntry> {
    log.info({ accountId: account.id, engine: account.engine }, '启动浏览器');

    const engine = createEngine(account.engine);
    const manager = this.createBrowserManager(engine);
    const userDataDir = getUserDataDir(account.id, account.engine);

    await manager.initialize({
      headless: this.headless,
      userDataDir,
      proxy: account.proxy,
      mobile: platform === 'pdd',
    });

    const entry: BrowserEntry = {
      manager,
      slot: {
        accountId: account.id,
        lastUsedAt: Date.now(),
        inUse: false,
      },
      lockPromise: null,
      lockResolve: null,
      cookieFileMtimeMs: 0,
    };

    // 恢复 cookies（remote 登录或上次会话保存的）
    await this.loadCookiesFromDisk(account.id, entry);

    // 监控 set-cookie：追踪 JD 等平台何时刷新/清除登录 cookie
    this.monitorCookieChanges(account.id, manager);

    this.browsers.set(account.id, entry);
    return entry;
  }

  private async evictLRU(excludeId: string): Promise<boolean> {
    let oldest: BrowserEntry | null = null;
    let oldestId: string | null = null;

    for (const [id, entry] of this.browsers) {
      if (id === excludeId || entry.slot.inUse) continue;
      if (!oldest || entry.slot.lastUsedAt < oldest.slot.lastUsedAt) {
        oldest = entry;
        oldestId = id;
      }
    }

    if (oldestId) {
      log.info({ accountId: oldestId }, 'LRU 淘汰浏览器');
      await this.closeBrowser(oldestId);
      return true;
    }
    return false;
  }

  private async evictIdle(): Promise<void> {
    const now = Date.now();
    const toEvict: string[] = [];

    for (const [id, entry] of this.browsers) {
      if (!entry.slot.inUse && now - entry.slot.lastUsedAt > IDLE_TIMEOUT_MS) {
        toEvict.push(id);
      }
    }

    for (const id of toEvict) {
      log.info({ accountId: id }, '空闲超时，回收浏览器');
      await this.closeBrowser(id);
    }
  }

  private async waitForLock(accountId: string): Promise<void> {
    const entry = this.browsers.get(accountId);
    if (entry?.lockPromise) {
      await entry.lockPromise;
    }
  }

  private setLock(entry: BrowserEntry): void {
    entry.lockPromise = new Promise<void>(resolve => {
      entry.lockResolve = resolve;
    });
  }

  private releaseLock(entry: BrowserEntry): void {
    if (entry.lockResolve) {
      entry.lockResolve();
      entry.lockPromise = null;
      entry.lockResolve = null;
    }
  }

  private getAccountEpoch(accountId: string): number {
    return this.accountEpochs.get(accountId) ?? 0;
  }
}

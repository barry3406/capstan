/**
 * loginDetector 守卫测试
 *
 * 验证：截图触发 + 60 秒冷却 + URL 过滤 + 容错
 *
 * 注意：Capstan dist 版本已移除 GPT 诊断（diagnoseEmptyResult），
 * 本测试适配为测试实际 dist 行为：截图 + 冷却 + 容错。
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { GuardContext } from '../../../packages/ai/dist/harness/kernel/guard/types.js';
import type { KernelSession } from '../../../packages/ai/dist/harness/kernel/session/types.js';

// Mock logger (replaces pino Logger)
const mockLogger = {
  info: mock(() => {}),
  debug: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
} as unknown as any;

let accountCounter = 0;
function mockCtx(
  url: string = 'https://search.jd.com/Search?keyword=test',
  platform: string = 'jd',
): GuardContext {
  accountCounter++;
  return {
    url,
    platform,
    logger: mockLogger,
    session: {
      accountId: `acct_ld_${accountCounter}`,
      engine: 'camoufox',
      platform,
      screenshot: mock(() => Promise.resolve(undefined)),
      getCookies: mock(() => Promise.resolve([])),
    } as unknown as KernelSession,
  };
}

/** 同一 accountId 复用的 ctx，用于冷却测试 */
function mockCtxWithId(accountId: string, url: string = 'https://search.jd.com'): GuardContext {
  return {
    url,
    platform: 'jd',
    logger: mockLogger,
    session: {
      accountId,
      engine: 'camoufox',
      platform: 'jd',
      screenshot: mock(() => Promise.resolve(undefined)),
      getCookies: mock(() => Promise.resolve([])),
    } as unknown as KernelSession,
  };
}

describe('loginDetector', () => {
  // Use dynamic import to get a fresh module-level Map per test suite.
  // Since the Capstan dist version simplified the guard (no GPT diagnosis),
  // we test: URL filtering, screenshot invocation, cooldown, and error tolerance.

  async function getGuard() {
    const { loginDetector } = await import(
      '../../../packages/ai/dist/harness/kernel/guard/builtins/login-detector.js'
    );
    return loginDetector();
  }

  // ─── URL 过滤 ───

  it('about:blank → 跳过检测', async () => {
    const guard = await getGuard();
    const ctx = mockCtx('about:blank');

    await guard(ctx);
    expect(ctx.session.screenshot).not.toHaveBeenCalled();
  });

  it('data: URL → 跳过检测', async () => {
    const guard = await getGuard();
    const ctx = mockCtx('data:text/html,<h1>test</h1>');

    await guard(ctx);
    expect(ctx.session.screenshot).not.toHaveBeenCalled();
  });

  it('空 URL → 跳过检测', async () => {
    const guard = await getGuard();
    const ctx = mockCtx('');

    await guard(ctx);
    expect(ctx.session.screenshot).not.toHaveBeenCalled();
  });

  // ─── 正常调用 ───

  it('正常 URL → 调用 screenshot 且不抛异常', async () => {
    const guard = await getGuard();
    const ctx = mockCtx();

    await expect(guard(ctx)).resolves.toBeUndefined();
    expect(ctx.session.screenshot).toHaveBeenCalled();
  });

  // ─── 容错 ───

  it('截图失败 → 不抛异常', async () => {
    const guard = await getGuard();
    const ctx = mockCtx();
    (ctx.session.screenshot as any).mockImplementation(() =>
      Promise.reject(new Error('browser closed')),
    );

    await expect(guard(ctx)).resolves.toBeUndefined();
  });

  // ─── 冷却机制 ───

  it('同一 session 60 秒内第二次调用跳过检测', async () => {
    const guard = await getGuard();
    const accountId = `acct_cooldown_${Date.now()}_${Math.random()}`;
    const ctx1 = mockCtxWithId(accountId);
    const ctx2 = mockCtxWithId(accountId);

    // 第一次调用
    await guard(ctx1);
    expect(ctx1.session.screenshot).toHaveBeenCalled();

    // 第二次调用 → 仍在冷却
    await guard(ctx2);
    // ctx2 的 screenshot 不应该被调用（冷却跳过）
    expect(ctx2.session.screenshot).not.toHaveBeenCalled();
  });

  it('不同 session 的冷却互不影响', async () => {
    const guard = await getGuard();

    const ctxA = mockCtxWithId(`acct_iso_a_${Date.now()}_${Math.random()}`);
    const ctxB = mockCtxWithId(`acct_iso_b_${Date.now()}_${Math.random()}`);

    await guard(ctxA);
    await guard(ctxB);
    // 两个不同 session 都触发了检测
    expect(ctxA.session.screenshot).toHaveBeenCalled();
    expect(ctxB.session.screenshot).toHaveBeenCalled();
  });
});

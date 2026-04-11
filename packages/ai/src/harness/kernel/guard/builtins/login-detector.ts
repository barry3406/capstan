import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync } from 'node:fs';
import type { GuardFn } from '../types.js';

const log = { info: console.log, warn: console.warn, error: console.error, debug: (..._: any[]) => {} };

/**
 * 同一 session 在冷却期内不重复做视觉登录检测，避免每次导航都调用 GPT。
 * 检测到异常时清除冷却，确保换号后立即重新检测。
 */
const lastCheckTime = new Map<string, number>();
const LOGIN_CHECK_COOLDOWN_MS = 60_000;

/**
 * 登录态检测守卫 — 截取首屏发给 GPT 判断页面状态（以视觉检测为准）
 *
 * 放在 guard pipeline 末尾（captchaDetector 之后），
 * 仅在实际业务页面导航时触发，跳过 about:blank 等内部 URL。
 * 同一 session 60 秒内只检测一次，平衡准确性和性能。
 */
export function loginDetector(): GuardFn {
  return async (ctx) => {
    // 跳过非业务 URL
    if (!ctx.url || ctx.url === 'about:blank' || ctx.url.startsWith('data:')) {
      return;
    }

    // 同一 session 冷却期内不重复检查
    const sessionKey = ctx.session.accountId;
    const now = Date.now();
    if (now - (lastCheckTime.get(sessionKey) ?? 0) < LOGIN_CHECK_COOLDOWN_MS) {
      return;
    }

    const tmpPath = join(tmpdir(), `login_check_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);

    try {
      await ctx.session.screenshot(tmpPath, { aboveFold: true });

      // Simplified: log warning instead of GPT-based diagnosis (crawlab-specific dep removed)
      log.warn({ url: ctx.url, platform: ctx.platform, accountId: ctx.session.accountId }, '登录态检测：截图已捕获，跳过 GPT 诊断');

      // 检测通过，记录冷却时间
      lastCheckTime.set(sessionKey, Date.now());
    } catch (err) {
      // 截图失败等其他异常，容错跳过
      log.warn({ url: ctx.url, err: (err as any)?.message }, '登录态检测异常，跳过');
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  };
}

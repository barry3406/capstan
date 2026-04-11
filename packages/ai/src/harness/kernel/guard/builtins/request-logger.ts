import type { GuardFn } from '../types.js';

/**
 * 请求日志守卫 — 记录导航 URL + accountId + timestamp
 */
export function requestLogger(): GuardFn {
  return async (ctx) => {
    ctx.logger.info({
      url: ctx.url,
      accountId: ctx.session.accountId,
      platform: ctx.platform,
      timestamp: new Date().toISOString(),
    }, '页面导航');
  };
}

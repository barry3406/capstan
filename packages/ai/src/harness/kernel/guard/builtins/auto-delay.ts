import type { GuardFn } from '../types.js';

/**
 * 导航后注入 1-3s 随机延迟
 */
export function autoDelay(minMs = 1000, maxMs = 3000): GuardFn {
  return async (ctx) => {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    ctx.logger.debug({ delay, url: ctx.url }, '自动延迟');
    await new Promise(resolve => setTimeout(resolve, delay));
  };
}

import type { GuardFn } from '../types.js';

export function domainWhitelist(allowedDomains: string[]): GuardFn {
  return async (ctx) => {
    const url = new URL(ctx.url);
    const hostname = url.hostname;

    const allowed = allowedDomains.some(
      domain => hostname === domain || hostname.endsWith(`.${domain}`),
    );

    if (!allowed) {
      throw new Error(`域名 ${hostname} 不在白名单中: ${allowedDomains.join(', ')}`);
    }
  };
}

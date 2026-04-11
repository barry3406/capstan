import type { GuardFn, GuardContext } from './types.js';

export class GuardRegistry {
  private guards = new Map<string, GuardFn[]>();

  register(platform: string, ...fns: GuardFn[]): void {
    const existing = this.guards.get(platform) ?? [];
    this.guards.set(platform, [...existing, ...fns]);
  }

  getGuards(platform: string): GuardFn[] {
    return this.guards.get(platform) ?? [];
  }

  async execute(platform: string, ctx: GuardContext): Promise<void> {
    const fns = this.getGuards(platform);
    for (const fn of fns) {
      await fn(ctx);
    }
  }
}

/** 模块级单例 — 仅供守卫注册子系统（guard/index.ts）使用，业务代码走 DI */
let _instance: GuardRegistry | undefined;

export function getGuardRegistryInstance(): GuardRegistry {
  return (_instance ??= new GuardRegistry());
}

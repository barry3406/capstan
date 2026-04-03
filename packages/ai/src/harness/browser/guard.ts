/**
 * Navigation guard system for browser sandbox.
 *
 * Extracted from crawlab-test/src/kernel/guard/.
 * Guards run sequentially before each navigation (session.goto).
 */

import type { GuardFn, GuardContext, BrowserSession } from "../types.js";

// ---------------------------------------------------------------------------
// GuardRegistry — composable guard chain
// ---------------------------------------------------------------------------

export class GuardRegistry {
  private guards: GuardFn[] = [];

  /** Add one or more guard functions to the chain */
  register(...fns: GuardFn[]): void {
    this.guards.push(...fns);
  }

  /** Execute all guards sequentially */
  async execute(ctx: GuardContext): Promise<void> {
    for (const fn of this.guards) {
      await fn(ctx);
    }
  }

  /** Get current guard count */
  get size(): number {
    return this.guards.length;
  }
}

// ---------------------------------------------------------------------------
// Built-in guards
// ---------------------------------------------------------------------------

/**
 * Domain whitelist guard — blocks navigation to domains not in the list.
 */
export function domainWhitelist(allowedDomains: string[]): GuardFn {
  return async (ctx: GuardContext) => {
    try {
      const hostname = new URL(ctx.url).hostname;
      const allowed = allowedDomains.some(
        (d) => hostname === d || hostname.endsWith(`.${d}`),
      );
      if (!allowed) {
        throw new Error(
          `Navigation blocked: ${hostname} is not in the allowed domains [${allowedDomains.join(", ")}]`,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Navigation blocked")) {
        throw err;
      }
      // Invalid URL — let the browser handle it
    }
  };
}

/**
 * Auto-delay guard — adds a human-like pause before each navigation.
 */
export function autoDelay(min = 500, max = 2000): GuardFn {
  return async () => {
    const delay = min + Math.random() * (max - min);
    await new Promise((r) => setTimeout(r, delay));
  };
}

/**
 * Max navigations guard — prevents runaway navigation loops.
 */
export function maxNavigations(limit: number): GuardFn {
  let count = 0;
  return async () => {
    count++;
    if (count > limit) {
      throw new Error(
        `Navigation limit exceeded: ${count} navigations (max: ${limit})`,
      );
    }
  };
}

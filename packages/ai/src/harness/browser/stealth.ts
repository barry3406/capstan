/**
 * Human-like behavior utilities for browser automation.
 *
 * Extracted from crawlab-test/src/kernel/stealth/utils.ts.
 * Provides delay, scroll, and mouse movement functions that mimic real users.
 */

import type { BrowserSession } from "../types.js";

/**
 * Log-normal random delay — most delays cluster near `min`,
 * with occasional longer pauses (like a human reading).
 */
export function randomDelay(min: number, max: number): Promise<void> {
  const u1 = Math.random() || 0.001;
  const u2 = Math.random();
  const normal =
    Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  const mu = Math.log(min + (max - min) * 0.25);
  const sigma = 0.4;
  const lognormal = Math.exp(mu + sigma * normal);

  const delay = Math.max(min, Math.min(max, Math.round(lognormal)));
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Simulate natural scrolling — multiple wheel events with random
 * deltas and occasional reverse scrolls.
 */
export async function humanScroll(session: BrowserSession): Promise<void> {
  const steps = Math.floor(Math.random() * 3) + 2;
  for (let i = 0; i < steps; i++) {
    const direction = Math.random() < 0.15 ? "up" : "down";
    const amount = Math.floor(Math.random() * 300) + 100;
    await session.scroll(direction, amount);
    await randomDelay(500, 1500);
  }
}

/**
 * Human-like delay with configurable range.
 */
export async function humanDelay(
  min = 800,
  max = 2500,
): Promise<void> {
  await randomDelay(min, max);
}

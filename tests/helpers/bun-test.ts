import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  test,
  vi,
} from "vitest";

export { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test };

export const mock = vi.fn.bind(vi) as typeof vi.fn;
export const spyOn = vi.spyOn.bind(vi) as typeof vi.spyOn;

export function setDefaultTimeout(timeout: number): void {
  vi.setConfig({
    testTimeout: timeout,
  });
}

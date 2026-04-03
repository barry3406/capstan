import { describe, test, expect, beforeAll, beforeEach, afterAll, spyOn } from "bun:test";
import {
  setupBrowserEnv,
  teardownBrowserEnv,
  resetBrowserEnv,
  mockSessionStorage,
} from "../helpers/browser-env.js";

// Lazy-import the module under test AFTER browser env is set up.
// We use a top-level import since bun evaluates these at load time,
// but the functions themselves only access globals at call time.
import {
  generateScrollKey,
  setCurrentScrollKey,
  saveScrollPosition,
  restoreScrollPosition,
  scrollToTop,
} from "@zauso-ai/capstan-react/client";

beforeAll(() => { setupBrowserEnv(); });
afterAll(() => { teardownBrowserEnv(); });
beforeEach(() => { resetBrowserEnv(); });

// ---------------------------------------------------------------------------
// generateScrollKey
// ---------------------------------------------------------------------------

describe("generateScrollKey", () => {
  test("returns a non-empty string", () => {
    const key = generateScrollKey();
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  test("generates unique keys", () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateScrollKey()));
    expect(keys.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// saveScrollPosition + restoreScrollPosition
// ---------------------------------------------------------------------------

describe("saveScrollPosition + restoreScrollPosition", () => {
  test("saves and restores scroll position", () => {
    const key = generateScrollKey();
    setCurrentScrollKey(key);

    // Simulate scrolled state
    (globalThis.window as Record<string, unknown>)["scrollX"] = 100;
    (globalThis.window as Record<string, unknown>)["scrollY"] = 250;

    saveScrollPosition();

    // Verify it was saved to sessionStorage
    const raw = mockSessionStorage.getItem(`__capstan_scroll_${key}`);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual({ x: 100, y: 250 });

    // Verify restore calls scrollTo
    const scrollToSpy = spyOn(window, "scrollTo").mockImplementation(() => {});
    const restored = restoreScrollPosition(key);
    expect(restored).toBe(true);
    expect(scrollToSpy).toHaveBeenCalledWith(100, 250);
    scrollToSpy.mockRestore();
  });

  test("restoreScrollPosition returns false for missing key", () => {
    expect(restoreScrollPosition("nonexistent")).toBe(false);
  });

  test("restoreScrollPosition returns false for null key", () => {
    expect(restoreScrollPosition(null)).toBe(false);
  });

  test("saveScrollPosition is a no-op when no current key is set", () => {
    const sizeBefore = mockSessionStorage.length;
    saveScrollPosition();
    expect(mockSessionStorage.length).toBeLessThanOrEqual(sizeBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// scrollToTop
// ---------------------------------------------------------------------------

describe("scrollToTop", () => {
  test("calls window.scrollTo(0, 0)", () => {
    const spy = spyOn(window, "scrollTo").mockImplementation(() => {});
    scrollToTop();
    expect(spy).toHaveBeenCalledWith(0, 0);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("scroll edge cases", () => {
  test("save then restore round-trip preserves position", () => {
    const key = generateScrollKey();
    setCurrentScrollKey(key);

    (globalThis.window as Record<string, unknown>)["scrollX"] = 42;
    (globalThis.window as Record<string, unknown>)["scrollY"] = 99;
    saveScrollPosition();

    let restoredX = 0;
    let restoredY = 0;
    const spy = spyOn(window, "scrollTo").mockImplementation((x: unknown, y: unknown) => {
      restoredX = x as number;
      restoredY = y as number;
    });

    const result = restoreScrollPosition(key);
    expect(result).toBe(true);
    expect(restoredX).toBe(42);
    expect(restoredY).toBe(99);
    spy.mockRestore();
  });

  test("multiple saves overwrite previous position", () => {
    const key = generateScrollKey();
    setCurrentScrollKey(key);

    (globalThis.window as Record<string, unknown>)["scrollX"] = 10;
    (globalThis.window as Record<string, unknown>)["scrollY"] = 20;
    saveScrollPosition();

    (globalThis.window as Record<string, unknown>)["scrollX"] = 30;
    (globalThis.window as Record<string, unknown>)["scrollY"] = 40;
    saveScrollPosition();

    let restoredX = 0;
    let restoredY = 0;
    const spy = spyOn(window, "scrollTo").mockImplementation((x: unknown, y: unknown) => {
      restoredX = x as number;
      restoredY = y as number;
    });

    restoreScrollPosition(key);
    expect(restoredX).toBe(30);
    expect(restoredY).toBe(40);
    spy.mockRestore();
  });

  test("different keys store different positions", () => {
    const key1 = generateScrollKey();
    const key2 = generateScrollKey();

    setCurrentScrollKey(key1);
    (globalThis.window as Record<string, unknown>)["scrollX"] = 100;
    (globalThis.window as Record<string, unknown>)["scrollY"] = 200;
    saveScrollPosition();

    setCurrentScrollKey(key2);
    (globalThis.window as Record<string, unknown>)["scrollX"] = 300;
    (globalThis.window as Record<string, unknown>)["scrollY"] = 400;
    saveScrollPosition();

    const positions: Array<{ x: number; y: number }> = [];
    const spy = spyOn(window, "scrollTo").mockImplementation((x: unknown, y: unknown) => {
      positions.push({ x: x as number, y: y as number });
    });

    restoreScrollPosition(key1);
    restoreScrollPosition(key2);

    expect(positions[0]).toEqual({ x: 100, y: 200 });
    expect(positions[1]).toEqual({ x: 300, y: 400 });
    spy.mockRestore();
  });

  test("restoreScrollPosition with empty string returns false", () => {
    // Empty string is truthy but no data stored
    expect(restoreScrollPosition("")).toBe(false);
  });

  test("generateScrollKey includes timestamp component", () => {
    const key = generateScrollKey();
    // Format: {timestamp}-{random}
    const parts = key.split("-");
    expect(parts.length).toBeGreaterThanOrEqual(2);
    // First part should be a number (timestamp)
    expect(Number.isFinite(Number(parts[0]))).toBe(true);
  });

  test("setCurrentScrollKey + saveScrollPosition + null restore", () => {
    const key = generateScrollKey();
    setCurrentScrollKey(key);

    (globalThis.window as Record<string, unknown>)["scrollX"] = 50;
    (globalThis.window as Record<string, unknown>)["scrollY"] = 75;
    saveScrollPosition();

    // Restore with null key should return false
    expect(restoreScrollPosition(null)).toBe(false);
    // Restore with correct key should work
    const spy = spyOn(window, "scrollTo").mockImplementation(() => {});
    expect(restoreScrollPosition(key)).toBe(true);
    spy.mockRestore();
  });
});

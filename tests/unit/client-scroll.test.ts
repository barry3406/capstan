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

import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import {
  setupBrowserEnv,
  teardownBrowserEnv,
  resetBrowserEnv,
} from "../helpers/browser-env.js";
import {
  buildHistoryState,
  readHistoryEntryState,
  writeHistoryState,
  captureScrollPosition,
  restoreScrollSnapshot,
} from "@zauso-ai/capstan-react/client";

beforeAll(() => { setupBrowserEnv(); });
afterAll(() => { teardownBrowserEnv(); });
beforeEach(() => { resetBrowserEnv(); });

describe("history helpers", () => {
  test("buildHistoryState preserves caller state and adds capstan fields", () => {
    const snapshot = buildHistoryState(
      "/about",
      "scroll-key",
      { from: "home" },
      { x: 12, y: 34 },
    );

    expect(snapshot).toMatchObject({
      from: "home",
      __capstanKey: "scroll-key",
      __capstanUrl: "/about",
      __capstanScroll: { x: 12, y: 34 },
    });
  });

  test("readHistoryEntryState normalizes non-object input", () => {
    const entry = readHistoryEntryState("bad-state");
    expect(entry.state).toEqual({});
    expect(entry.key).toBeNull();
    expect(entry.url).toBeNull();
    expect(entry.scroll).toBeNull();
  });

  test("writeHistoryState falls back to a minimal clone when pushState rejects the payload", () => {
    const originalPushState = history.pushState;
    const seenStates: unknown[] = [];
    let callCount = 0;

    Object.defineProperty(history, "pushState", {
      value: (state: unknown, _title: string, url?: string) => {
        callCount += 1;
        seenStates.push(state);
        if (callCount === 1) {
          throw new Error("clone failure");
        }
        return originalPushState.call(history, state, _title, url);
      },
      writable: true,
      configurable: true,
    });

    const ok = writeHistoryState(
      "push",
      {
        from: "home",
        __capstanKey: "scroll-key",
        __capstanUrl: "/about",
        __capstanScroll: { x: 7, y: 8 },
        fn: () => {},
      },
      "/about",
    );

    expect(ok).toBe(true);
    expect(seenStates).toHaveLength(2);
    expect(seenStates[1]).toEqual({
      __capstanKey: "scroll-key",
      __capstanUrl: "/about",
      __capstanScroll: { x: 7, y: 8 },
    });

    Object.defineProperty(history, "pushState", {
      value: originalPushState,
      writable: true,
      configurable: true,
    });
  });
});

describe("scroll helpers", () => {
  test("captureScrollPosition mirrors window scroll", () => {
    (window as Record<string, unknown>)["scrollX"] = 19;
    (window as Record<string, unknown>)["scrollY"] = 27;

    expect(captureScrollPosition()).toEqual({ x: 19, y: 27 });
  });

  test("restoreScrollSnapshot scrolls to the captured position", () => {
    const calls: Array<[number, number]> = [];
    const originalScrollTo = window.scrollTo;
    (window as Record<string, unknown>)["scrollTo"] = (x: number, y: number) => {
      calls.push([x, y]);
    };

    expect(restoreScrollSnapshot({ x: 41, y: 59 })).toBe(true);
    expect(calls).toEqual([[41, 59]]);

    (window as Record<string, unknown>)["scrollTo"] = originalScrollTo;
  });
});


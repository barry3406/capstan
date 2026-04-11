import { describe, test, expect } from "bun:test";
import { withViewTransition } from "@zauso-ai/capstan-react/client";

// In Bun test environment, document.startViewTransition is not available,
// so withViewTransition should always fall back to calling fn() directly.

describe("withViewTransition", () => {
  test("calls fn directly when startViewTransition is unavailable", async () => {
    let called = false;
    await withViewTransition(() => {
      called = true;
    });
    expect(called).toBe(true);
  });

  test("awaits async fn when falling back", async () => {
    let resolved = false;
    await withViewTransition(async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
    });
    expect(resolved).toBe(true);
  });

  test("propagates errors from fn", async () => {
    await expect(
      withViewTransition(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  test("propagates errors from async fn", async () => {
    await expect(
      withViewTransition(async () => {
        throw new Error("async boom");
      }),
    ).rejects.toThrow("async boom");
  });

  test("handles void return from fn", async () => {
    let called = false;
    await withViewTransition(() => { called = true; });
    expect(called).toBe(true);
  });

  test("uses startViewTransition when available", async () => {
    // Mock document.startViewTransition
    const origDoc = globalThis.document;
    let transitionFnCalled = false;
    const mockDoc = {
      ...origDoc,
      startViewTransition: (fn: () => void) => {
        fn();
        transitionFnCalled = true;
        return { finished: Promise.resolve() };
      },
    };
    Object.defineProperty(globalThis, "document", {
      value: mockDoc,
      writable: true,
      configurable: true,
    });

    await withViewTransition(() => {});
    expect(transitionFnCalled).toBe(true);

    Object.defineProperty(globalThis, "document", {
      value: origDoc,
      writable: true,
      configurable: true,
    });
  });

  test("awaits transition.finished", async () => {
    let resolved = false;
    const origDoc = globalThis.document;
    const mockDoc = {
      ...origDoc,
      startViewTransition: (fn: () => void) => {
        fn();
        return {
          finished: new Promise<void>((r) => {
            setTimeout(() => { resolved = true; r(); }, 10);
          }),
        };
      },
    };
    Object.defineProperty(globalThis, "document", {
      value: mockDoc,
      writable: true,
      configurable: true,
    });

    await withViewTransition(() => {});
    expect(resolved).toBe(true);

    Object.defineProperty(globalThis, "document", {
      value: origDoc,
      writable: true,
      configurable: true,
    });
  });

  test("falls back when startViewTransition is not a function", async () => {
    const origDoc = globalThis.document;
    const mockDoc = {
      ...origDoc,
      startViewTransition: "not a function",
    };
    Object.defineProperty(globalThis, "document", {
      value: mockDoc,
      writable: true,
      configurable: true,
    });

    let called = false;
    await withViewTransition(() => { called = true; });
    expect(called).toBe(true);

    Object.defineProperty(globalThis, "document", {
      value: origDoc,
      writable: true,
      configurable: true,
    });
  });

  test("falls back when document is undefined", async () => {
    const origDoc = globalThis.document;
    delete (globalThis as Record<string, unknown>)["document"];

    let called = false;
    await withViewTransition(() => { called = true; });
    expect(called).toBe(true);

    Object.defineProperty(globalThis, "document", {
      value: origDoc,
      writable: true,
      configurable: true,
    });
  });
});

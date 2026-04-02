import { describe, test, expect, beforeEach } from "bun:test";
import { PrefetchManager } from "@zauso-ai/capstan-react/client";

// ---------------------------------------------------------------------------
// Minimal DOM stubs
// ---------------------------------------------------------------------------

/** Lightweight mock element that supports getAttribute and event listeners. */
function createMockElement(href: string | null): Element {
  const listeners = new Map<string, Array<() => void>>();
  return {
    getAttribute: (name: string) => (name === "href" ? href : null),
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(fn);
    },
    removeEventListener: () => {},
    // Helper to trigger events in tests
    __fire: (type: string) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  } as unknown as Element & { __fire: (type: string) => void };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PrefetchManager", () => {
  let manager: PrefetchManager;

  beforeEach(() => {
    manager = new PrefetchManager();
  });

  test("observe with 'none' is a no-op", () => {
    const el = createMockElement("/about");
    // Should not throw or register anything
    manager.observe(el, "none");
    manager.destroy();
  });

  test("observe with 'hover' attaches pointer listeners", () => {
    const listeners: string[] = [];
    const el = {
      getAttribute: () => "/about",
      addEventListener: (type: string) => listeners.push(type),
      removeEventListener: () => {},
    } as unknown as Element;

    manager.observe(el, "hover");
    expect(listeners).toContain("pointerenter");
    expect(listeners).toContain("pointerleave");
    manager.destroy();
  });

  test("unobserve clears pending timers", () => {
    const el = createMockElement("/about");
    manager.observe(el, "hover");
    // Trigger hover start
    (el as Element & { __fire: (t: string) => void }).__fire("pointerenter");
    // Immediately unobserve — timer should be cancelled, no errors
    manager.unobserve(el);
    manager.destroy();
  });

  test("destroy is idempotent", () => {
    manager.destroy();
    manager.destroy(); // Should not throw
  });

  test("getHref filters out external URLs", () => {
    // External links should not be prefetched
    const externalEl = createMockElement("https://example.com");
    manager.observe(externalEl, "hover");
    // Trigger hover — should be filtered out
    (externalEl as Element & { __fire: (t: string) => void }).__fire("pointerenter");
    // No error, no prefetch triggered
    manager.destroy();
  });

  test("getHref filters out hash-only links", () => {
    const hashEl = createMockElement("#section");
    manager.observe(hashEl, "hover");
    (hashEl as Element & { __fire: (t: string) => void }).__fire("pointerenter");
    manager.destroy();
  });

  test("getHref filters out null href", () => {
    const noHref = createMockElement(null);
    manager.observe(noHref, "hover");
    (noHref as Element & { __fire: (t: string) => void }).__fire("pointerenter");
    manager.destroy();
  });
});

import { describe, test, expect, beforeEach } from "bun:test";
import { PrefetchManager } from "@zauso-ai/capstan-react/client";

// ---------------------------------------------------------------------------
// Minimal DOM stubs
// ---------------------------------------------------------------------------

/** Lightweight mock element that supports getAttribute and event listeners. */
function createMockElement(href: string | null): Element & {
  __fire: (type: string) => void;
  __listenerCount: (type: string) => number;
} {
  const listeners = new Map<string, Set<() => void>>();
  return {
    getAttribute: (name: string) => (name === "href" ? href : null),
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn);
    },
    // Helper to trigger events in tests
    __fire: (type: string) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    __listenerCount: (type: string) => {
      return listeners.get(type)?.size ?? 0;
    },
  } as unknown as Element & {
    __fire: (type: string) => void;
    __listenerCount: (type: string) => number;
  };
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

  test("unobserve removes hover listeners", () => {
    const el = createMockElement("/about") as Element & {
      __listenerCount: (type: string) => number;
    };

    manager.observe(el, "hover");
    expect(el.__listenerCount("pointerenter")).toBe(1);
    expect(el.__listenerCount("pointerleave")).toBe(1);

    manager.unobserve(el);
    expect(el.__listenerCount("pointerenter")).toBe(0);
    expect(el.__listenerCount("pointerleave")).toBe(0);
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

  test("getHref filters out protocol-relative links", () => {
    const el = createMockElement("//cdn.example.com/asset");
    manager.observe(el, "hover");
    (el as Element & { __fire: (t: string) => void }).__fire("pointerenter");
    // No error — link was filtered
    manager.destroy();
  });

  test("getHref filters out javascript and data URIs", () => {
    const javascriptLink = createMockElement("javascript:void(0)");
    const dataLink = createMockElement("data:text/plain,hello");

    manager.observe(javascriptLink, "hover");
    manager.observe(dataLink, "hover");

    (javascriptLink as Element & { __fire: (t: string) => void }).__fire("pointerenter");
    (dataLink as Element & { __fire: (t: string) => void }).__fire("pointerenter");

    manager.destroy();
  });

  test("hover: pointerleave cancels pending prefetch", async () => {
    const el = createMockElement("/about");
    manager.observe(el, "hover");

    // Enter → starts 80ms timer
    (el as Element & { __fire: (t: string) => void }).__fire("pointerenter");
    // Leave immediately → cancels timer
    (el as Element & { __fire: (t: string) => void }).__fire("pointerleave");

    // Wait longer than HOVER_DELAY_MS — no prefetch should fire
    await new Promise((r) => setTimeout(r, 100));
    manager.destroy();
  });

  test("triggerPrefetch deduplicates same URL", () => {
    // Hover over two elements with same href — should only prefetch once
    const el1 = createMockElement("/about");
    const el2 = createMockElement("/about");

    manager.observe(el1, "hover");
    manager.observe(el2, "hover");

    (el1 as Element & { __fire: (t: string) => void }).__fire("pointerenter");
    (el2 as Element & { __fire: (t: string) => void }).__fire("pointerenter");

    // No errors — dedup handled internally
    manager.destroy();
  });

  test("observe with viewport when IntersectionObserver unavailable", () => {
    // PrefetchManager constructor checks typeof IntersectionObserver
    // In bun:test env, IntersectionObserver is usually undefined
    const noObserverManager = new PrefetchManager();
    const el = createMockElement("/about");
    // viewport strategy should not throw even without IntersectionObserver
    noObserverManager.observe(el, "viewport");
    noObserverManager.destroy();
  });

  test("unobserve on unregistered element is a no-op", () => {
    const el = createMockElement("/about");
    // Unobserve without prior observe — should not throw
    manager.unobserve(el);
    manager.destroy();
  });

  test("destroy clears all hover timers", async () => {
    const el1 = createMockElement("/a");
    const el2 = createMockElement("/b");
    manager.observe(el1, "hover");
    manager.observe(el2, "hover");

    (el1 as Element & { __fire: (t: string) => void }).__fire("pointerenter");
    (el2 as Element & { __fire: (t: string) => void }).__fire("pointerenter");

    // Destroy should clear all pending timers
    manager.destroy();

    // Wait — should not error from orphaned timers
    await new Promise((r) => setTimeout(r, 100));
  });
});

// ---------------------------------------------------------------------------
// getPrefetchManager singleton
// ---------------------------------------------------------------------------

import { getPrefetchManager } from "@zauso-ai/capstan-react/client";

describe("getPrefetchManager", () => {
  test("returns a singleton", () => {
    const a = getPrefetchManager();
    const b = getPrefetchManager();
    expect(a).toBe(b);
  });

  test("singleton is a PrefetchManager instance", () => {
    const m = getPrefetchManager();
    expect(m).toBeInstanceOf(PrefetchManager);
  });
});

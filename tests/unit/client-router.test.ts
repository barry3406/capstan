import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import type { ClientRouteManifest, NavigationPayload } from "@zauso-ai/capstan-react/client";

import {
  setupBrowserEnv,
  teardownBrowserEnv,
  resetBrowserEnv,
  historyStack,
  popstateListeners,
} from "../helpers/browser-env.js";

// Save original fetch before any mock replaces it
const originalFetch = globalThis.fetch;

const mockFetchResponses: Array<{
  url: string;
  payload: NavigationPayload;
}> = [];

function mockFetchForNav(): void {
  (globalThis as Record<string, unknown>)["fetch"] = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const isNav = (init?.headers as Record<string, string>)?.["X-Capstan-Nav"] === "1";

    if (isNav) {
      const match = mockFetchResponses.find((r) => url.endsWith(r.url));
      if (match) {
        return {
          ok: true,
          status: 200,
          json: async () => match.payload,
        };
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    }
    return { ok: false, status: 404, statusText: "Not Found" };
  };
}

// ---------------------------------------------------------------------------
// Import after polyfills
// ---------------------------------------------------------------------------

import { CapstanRouter, initRouter, getRouter } from "@zauso-ai/capstan-react/client";

// ---------------------------------------------------------------------------
// Test manifest
// ---------------------------------------------------------------------------

const manifest: ClientRouteManifest = {
  routes: [
    { urlPattern: "/", componentType: "server", layouts: [] },
    { urlPattern: "/about", componentType: "server", layouts: [] },
    { urlPattern: "/posts/:id", componentType: "client", layouts: ["/_layout.tsx"] },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeAll(() => { setupBrowserEnv(); });

beforeEach(() => {
  resetBrowserEnv();
  mockFetchForNav();
  mockFetchResponses.length = 0;
  (window.location as Record<string, string>)["pathname"] = "/";
  document.title = "";
});

type MockHeadNode = {
  tagName: string;
  attrs: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  remove: () => void;
};

function installHeadMock(): {
  nodes: MockHeadNode[];
  restore: () => void;
  find: (tagName: string, attrs: Record<string, string>) => MockHeadNode | undefined;
} {
  const nodes: MockHeadNode[] = [];

  const matches = (node: MockHeadNode, selector: string): boolean => {
    const tagMatch = selector.match(/^[a-z]+/i);
    if (tagMatch && node.tagName !== tagMatch[0]!.toLowerCase()) {
      return false;
    }

    for (const attrMatch of selector.matchAll(/\[([^=\]]+)="([^"]*)"\]/g)) {
      const attrName = attrMatch[1]!;
      const attrValue = attrMatch[2]!;
      if (node.getAttribute(attrName) !== attrValue) {
        return false;
      }
    }

    return true;
  };

  const createNode = (tagName: string): MockHeadNode => {
    const attrs: Record<string, string> = {};
    return {
      tagName: tagName.toLowerCase(),
      attrs,
      setAttribute(name: string, value: string) {
        attrs[name] = value;
      },
      getAttribute(name: string) {
        return attrs[name] ?? null;
      },
      remove() {
        const idx = nodes.indexOf(this);
        if (idx >= 0) nodes.splice(idx, 1);
      },
    };
  };

  const head = {
    appendChild(node: MockHeadNode) {
      nodes.push(node);
      return node;
    },
    querySelector(selector: string) {
      return nodes.find((node) => matches(node, selector)) ?? null;
    },
    querySelectorAll(selector: string) {
      return nodes.filter((node) => matches(node, selector));
    },
  };

  const originalHead = (document as Record<string, unknown>)["head"];
  const originalCreateElement = (document as Record<string, unknown>)["createElement"];

  Object.defineProperty(document, "head", {
    value: head,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(document, "createElement", {
    value: (tagName: string) => createNode(tagName),
    writable: true,
    configurable: true,
  });

  return {
    nodes,
    find(tagName: string, attrs: Record<string, string>) {
      return nodes.find((node) => {
        if (node.tagName !== tagName.toLowerCase()) return false;
        return Object.entries(attrs).every(([name, value]) => node.getAttribute(name) === value);
      });
    },
    restore() {
      Object.defineProperty(document, "head", {
        value: originalHead,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(document, "createElement", {
        value: originalCreateElement,
        writable: true,
        configurable: true,
      });
    },
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterAll(() => {
  // Restore real fetch + remove browser globals so later tests are unaffected
  (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
  teardownBrowserEnv();
});

describe("CapstanRouter", () => {
  test("initial state reflects current URL", () => {
    const router = new CapstanRouter(manifest);
    expect(router.state.url).toBe("/");
    expect(router.state.status).toBe("idle");
    router.destroy();
  });

  test("navigate updates state to loading then idle", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: { title: "About" },
        componentType: "server",
        html: "<div>About page</div>",
      },
    });

    const router = new CapstanRouter(manifest);
    const states: string[] = [];
    router.subscribe((s) => states.push(s.status));

    await router.navigate("/about");

    expect(states).toContain("loading");
    expect(router.state.status).toBe("idle");
    expect(router.state.url).toBe("/about");
    router.destroy();
  });

  test("navigate pushes to history", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
      },
    });

    const router = new CapstanRouter(manifest);
    const beforeLen = historyStack.length;
    await router.navigate("/about");

    expect(historyStack.length).toBe(beforeLen + 1);
    router.destroy();
  });

  test("navigate with replace does not add history entry", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
      },
    });

    const router = new CapstanRouter(manifest);
    const beforeLen = historyStack.length;
    await router.navigate("/about", { replace: true });

    expect(historyStack.length).toBe(beforeLen);
    router.destroy();
  });

  test("navigate to same URL is a no-op", async () => {
    const router = new CapstanRouter(manifest);
    const states: string[] = [];
    router.subscribe((s) => states.push(s.status));

    await router.navigate("/"); // already at /

    // Should not have changed state to "loading"
    expect(states).not.toContain("loading");
    router.destroy();
  });

  test("subscribe returns an unsubscribe function", () => {
    const router = new CapstanRouter(manifest);
    const calls: string[] = [];
    const unsub = router.subscribe((s) => calls.push(s.url));

    unsub();

    // After unsubscribe, listener should not be called
    expect(calls.length).toBe(0);
    router.destroy();
  });

  test("prefetch stores result in cache", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: { cached: true },
        componentType: "server",
      },
    });

    const router = new CapstanRouter(manifest);
    await router.prefetch("/about");

    // Second navigate should use the cached payload (no additional fetch)
    let fetchCount = 0;
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async (...args: unknown[]) => {
      fetchCount++;
      return (origFetch as Function)(...args);
    };

    await router.navigate("/about");
    expect(fetchCount).toBe(0); // Cache hit — no fetch
    (globalThis as Record<string, unknown>)["fetch"] = origFetch;
    router.destroy();
  });

  test("prefetch is a no-op for already-cached URL", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    const router = new CapstanRouter(manifest);
    await router.prefetch("/about");

    let fetchCount = 0;
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async (...args: unknown[]) => {
      fetchCount++;
      return (origFetch as Function)(...args);
    };

    await router.prefetch("/about"); // should skip
    expect(fetchCount).toBe(0);
    (globalThis as Record<string, unknown>)["fetch"] = origFetch;
    router.destroy();
  });

  test("navigate updates document.title from metadata", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        metadata: { title: "About Us" },
      },
    });

    const router = new CapstanRouter(manifest);
    await router.navigate("/about");

    expect(document.title).toBe("About Us");
    router.destroy();
  });

  test("navigate synchronizes title, meta, and link head tags", async () => {
    const head = installHeadMock();

    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        metadata: {
          title: "About Us",
          description: "About page",
          canonical: "https://example.com/about",
          icons: { icon: "/favicon-about.ico" },
          alternates: { en: "https://example.com/en/about" },
        },
      },
    });
    mockFetchResponses.push({
      url: "/posts/1",
      payload: {
        url: "/posts/1",
        layoutKey: "/",
        loaderData: null,
        componentType: "client",
        metadata: {
          title: "Post One",
          description: "Post page",
        },
      },
    });
    mockFetchResponses.push({
      url: "/",
      payload: {
        url: "/",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
      },
    });

    const router = new CapstanRouter(manifest);
    try {
      await router.navigate("/about");

      expect(document.title).toBe("About Us");
      expect(head.find("meta", { name: "description", content: "About page" })).toBeDefined();
      expect(head.find("link", { rel: "canonical", href: "https://example.com/about" })).toBeDefined();
      expect(head.find("link", { rel: "icon", href: "/favicon-about.ico" })).toBeDefined();
      expect(head.find("link", { rel: "alternate", hreflang: "en", href: "https://example.com/en/about" })).toBeDefined();

      await router.navigate("/posts/1");

      expect(document.title).toBe("Post One");
      expect(head.find("meta", { name: "description", content: "Post page" })).toBeDefined();
      expect(head.find("link", { rel: "canonical", href: "https://example.com/about" })).toBeUndefined();
      expect(head.find("link", { rel: "icon", href: "/favicon-about.ico" })).toBeUndefined();
      expect(head.find("link", { rel: "alternate", hreflang: "en", href: "https://example.com/en/about" })).toBeUndefined();

      await router.navigate("/");

      expect(document.title).toBe("Post One");
    } finally {
      head.restore();
      router.destroy();
    }
  });

  test("navigate falls back on invalid navigation payload", async () => {
    const origLocation = window.location;
    let locationChanged = false;
    Object.defineProperty(window, "location", {
      value: {
        ...origLocation,
        get href() { return "/"; },
        set href(_: string) { locationChanged = true; },
        pathname: "/",
      },
      writable: true,
      configurable: true,
    });

    (globalThis as Record<string, unknown>)["fetch"] = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        layoutKey: "/",
        componentType: "server",
        loaderData: null,
      }),
    });

    const router = new CapstanRouter(manifest);
    try {
      await router.navigate("/about");

      expect(locationChanged).toBe(true);
      expect(router.state.status).toBe("error");
      expect(router.state.error?.message).toContain("Invalid navigation payload");
    } finally {
      Object.defineProperty(window, "location", {
        value: origLocation,
        writable: true,
        configurable: true,
      });
      router.destroy();
      mockFetchForNav();
    }
  });

  test("destroy cleans up listeners", () => {
    const initialListeners = popstateListeners.length;
    const router = new CapstanRouter(manifest);
    expect(popstateListeners.length).toBe(initialListeners + 1);

    router.destroy();
    expect(popstateListeners.length).toBe(initialListeners);
  });

  test("navigate dispatches capstan:navigate CustomEvent", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: { hello: "world" },
        componentType: "client",
      },
    });

    let eventDetail: unknown = null;
    const origDispatch = window.dispatchEvent;
    (window as Record<string, unknown>)["dispatchEvent"] = (e: Event) => {
      if (e.type === "capstan:navigate") {
        eventDetail = (e as CustomEvent).detail;
      }
      return true;
    };

    const router = new CapstanRouter(manifest);
    await router.navigate("/about");

    expect(eventDetail).toBeDefined();
    expect((eventDetail as Record<string, unknown>)["url"]).toBe("/about");
    expect((eventDetail as Record<string, unknown>)["loaderData"]).toEqual({ hello: "world" });

    (window as Record<string, unknown>)["dispatchEvent"] = origDispatch;
    router.destroy();
  });

  // ------- Abort logic -------

  test("aborting in-flight navigation cancels previous", async () => {
    // Set up two responses with different delays
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });
    mockFetchResponses.push({
      url: "/posts/1",
      payload: { url: "/posts/1", layoutKey: "/", loaderData: { id: 1 }, componentType: "client" },
    });

    const router = new CapstanRouter(manifest);

    // Start two navigations — the first should be aborted
    const nav1 = router.navigate("/about");
    const nav2 = router.navigate("/posts/1");

    await Promise.all([nav1, nav2]);

    // Final state should be the second navigation
    expect(router.state.url).toBe("/posts/1");
    router.destroy();
  });

  // ------- scroll: false -------

  test("navigate with scroll: false suppresses scrollToTop", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    let scrolledToTop = false;
    const origScroll = window.scrollTo;
    (window as Record<string, unknown>)["scrollTo"] = (...args: unknown[]) => {
      if (args[0] === 0 && args[1] === 0) scrolledToTop = true;
    };

    const router = new CapstanRouter(manifest);
    await router.navigate("/about", { scroll: false });
    expect(scrolledToTop).toBe(false);

    (window as Record<string, unknown>)["scrollTo"] = origScroll;
    router.destroy();
  });

  test("navigate with scroll: true (default) calls scrollToTop", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    let scrolledToTop = false;
    const origScroll = window.scrollTo;
    (window as Record<string, unknown>)["scrollTo"] = (...args: unknown[]) => {
      if (args[0] === 0 && args[1] === 0) scrolledToTop = true;
    };

    const router = new CapstanRouter(manifest);
    await router.navigate("/about"); // scroll defaults to true
    expect(scrolledToTop).toBe(true);

    (window as Record<string, unknown>)["scrollTo"] = origScroll;
    router.destroy();
  });

  // ------- fetchNavPayload error → fallback -------

  test("navigate falls back to window.location on fetch error", async () => {
    // No mock response → will 404
    const router = new CapstanRouter(manifest);

    let locationChanged = false;
    const origLocation = window.location;
    Object.defineProperty(window, "location", {
      value: {
        ...origLocation,
        get href() { return "/"; },
        set href(_: string) { locationChanged = true; },
        pathname: "/",
      },
      writable: true,
      configurable: true,
    });

    await router.navigate("/nonexistent");

    // Should have fallen back to window.location.href
    expect(locationChanged).toBe(true);
    expect(router.state.status).toBe("error");

    Object.defineProperty(window, "location", {
      value: origLocation,
      writable: true,
      configurable: true,
    });
    router.destroy();
  });

  // ------- prefetch failure -------

  test("prefetch silently ignores fetch failure", async () => {
    // Install fetch that always throws
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async () => {
      throw new Error("Network error");
    };

    const router = new CapstanRouter(manifest);
    // Should not throw
    await router.prefetch("/about");

    (globalThis as Record<string, unknown>)["fetch"] = origFetch;
    router.destroy();
  });

  test("prefetch ignores non-ok response", async () => {
    // 500 response should be silently skipped
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const router = new CapstanRouter(manifest);
    await router.prefetch("/about");

    // Verify it wasn't cached — next fetch should still happen
    let fetchCount = 0;
    (globalThis as Record<string, unknown>)["fetch"] = async () => {
      fetchCount++;
      return { ok: false, status: 404, statusText: "Not Found" };
    };
    await router.prefetch("/about"); // should attempt again since not cached
    expect(fetchCount).toBe(1);

    (globalThis as Record<string, unknown>)["fetch"] = origFetch;
    router.destroy();
  });

  test("prefetch ignores malformed payloads and does not poison cache", async () => {
    const origFetch = globalThis.fetch;
    let fetchCount = 0;
    (globalThis as Record<string, unknown>)["fetch"] = async () => {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          layoutKey: "/",
          componentType: "server",
          loaderData: null,
        }),
      };
    };

    const router = new CapstanRouter(manifest);
    try {
      await router.prefetch("/about");
      expect(fetchCount).toBe(1);

      (globalThis as Record<string, unknown>)["fetch"] = async () => {
        fetchCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            url: "/about",
            layoutKey: "/",
            loaderData: null,
            componentType: "server",
          }),
        };
      };

      await router.navigate("/about");
      expect(fetchCount).toBe(2);
    } finally {
      (globalThis as Record<string, unknown>)["fetch"] = origFetch;
      router.destroy();
    }
  });

  // ------- noCache option -------

  test("navigate with noCache bypasses cache", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: { v: 1 }, componentType: "server" },
    });

    const router = new CapstanRouter(manifest);
    await router.navigate("/about");

    // Update mock payload
    mockFetchResponses.length = 0;
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: { v: 2 }, componentType: "server" },
    });

    let eventDetail: unknown = null;
    const origDispatch = window.dispatchEvent;
    (window as Record<string, unknown>)["dispatchEvent"] = (e: Event) => {
      if (e.type === "capstan:navigate") {
        eventDetail = (e as CustomEvent).detail;
      }
      return true;
    };

    // navigate with noCache should re-fetch
    await router.navigate("/about", { noCache: true });
    expect(eventDetail).toBeDefined();
    expect((eventDetail as Record<string, unknown>)["loaderData"]).toEqual({ v: 2 });

    (window as Record<string, unknown>)["dispatchEvent"] = origDispatch;
    router.destroy();
  });

  // ------- metadata in event -------

  test("navigate includes metadata in CustomEvent when present", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        metadata: { title: "About Us", description: "About page" },
      },
    });

    let eventDetail: Record<string, unknown> = {};
    const origDispatch = window.dispatchEvent;
    (window as Record<string, unknown>)["dispatchEvent"] = (e: Event) => {
      if (e.type === "capstan:navigate") {
        eventDetail = (e as CustomEvent).detail as Record<string, unknown>;
      }
      return true;
    };

    const router = new CapstanRouter(manifest);
    await router.navigate("/about");

    expect(eventDetail["metadata"]).toBeDefined();
    expect((eventDetail["metadata"] as Record<string, string>)["title"]).toBe("About Us");

    (window as Record<string, unknown>)["dispatchEvent"] = origDispatch;
    router.destroy();
  });

  test("navigate omits metadata from event when absent", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        // no metadata
      },
    });

    let eventDetail: Record<string, unknown> = {};
    const origDispatch = window.dispatchEvent;
    (window as Record<string, unknown>)["dispatchEvent"] = (e: Event) => {
      if (e.type === "capstan:navigate") {
        eventDetail = (e as CustomEvent).detail as Record<string, unknown>;
      }
      return true;
    };

    const router = new CapstanRouter(manifest);
    await router.navigate("/about");

    expect(eventDetail["metadata"]).toBeUndefined();

    (window as Record<string, unknown>)["dispatchEvent"] = origDispatch;
    router.destroy();
  });

  test("navigate includes auth in CustomEvent when present", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        auth: {
          isAuthenticated: true,
          type: "human",
          userId: "user-42",
          permissions: ["projects:read"],
        },
      },
    });

    let eventDetail: Record<string, unknown> = {};
    const origDispatch = window.dispatchEvent;
    (window as Record<string, unknown>)["dispatchEvent"] = (e: Event) => {
      if (e.type === "capstan:navigate") {
        eventDetail = (e as CustomEvent).detail as Record<string, unknown>;
      }
      return true;
    };

    const router = new CapstanRouter(manifest);
    await router.navigate("/about");

    expect(eventDetail["auth"]).toEqual({
      isAuthenticated: true,
      type: "human",
      userId: "user-42",
      permissions: ["projects:read"],
    });

    (window as Record<string, unknown>)["dispatchEvent"] = origDispatch;
    router.destroy();
  });

  test("navigate rejects malformed auth payloads and falls back to full reload", async () => {
    const origLocation = window.location;
    let locationChanged = false;
    Object.defineProperty(window, "location", {
      value: {
        ...origLocation,
        get href() { return "/"; },
        set href(_: string) { locationChanged = true; },
        pathname: "/",
      },
      writable: true,
      configurable: true,
    });

    (globalThis as Record<string, unknown>)["fetch"] = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        url: "/about",
        layoutKey: "/",
        componentType: "server",
        loaderData: null,
        auth: "bad-auth",
      }),
    });

    const router = new CapstanRouter(manifest);
    try {
      await router.navigate("/about");

      expect(locationChanged).toBe(true);
      expect(router.state.status).toBe("error");
      expect(router.state.error?.message).toContain("auth must be an object");
    } finally {
      Object.defineProperty(window, "location", {
        value: origLocation,
        writable: true,
        configurable: true,
      });
      router.destroy();
      mockFetchForNav();
    }
  });

  // ------- morphOutlet -------

  test("morphOutlet falls back to innerHTML when no idiomorph", async () => {
    // Set up a DOM element for the outlet
    let outletHtml = "";
    const mockOutlet = {
      set innerHTML(v: string) { outletHtml = v; },
      get innerHTML() { return outletHtml; },
    };
    const origQuery = document.querySelector;
    (document as Record<string, unknown>)["querySelector"] = (sel: string) => {
      if (sel.includes("capstan-outlet") || sel.includes("capstan-root")) return mockOutlet;
      return null;
    };
    const origById = document.getElementById;
    (document as Record<string, unknown>)["getElementById"] = (id: string) => {
      if (id === "capstan-root") return mockOutlet;
      return null;
    };

    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        html: "<div>New Content</div>",
      },
    });

    const router = new CapstanRouter(manifest);
    await router.navigate("/about");

    expect(outletHtml).toBe("<div>New Content</div>");

    (document as Record<string, unknown>)["querySelector"] = origQuery;
    (document as Record<string, unknown>)["getElementById"] = origById;
    router.destroy();
  });

  test("morphOutlet does nothing when no outlet element found", async () => {
    // Ensure no outlet elements
    (document as Record<string, unknown>)["querySelector"] = () => null;
    (document as Record<string, unknown>)["getElementById"] = () => null;

    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        html: "<div>Content</div>",
      },
    });

    const router = new CapstanRouter(manifest);
    // Should not throw
    await router.navigate("/about");
    expect(router.state.url).toBe("/about");

    router.destroy();
  });

  test("morphOutlet uses idiomorph when available", async () => {
    let morphCalled = false;
    let morphArgs: unknown[] = [];
    (globalThis as Record<string, unknown>)["Idiomorph"] = {
      morph: (...args: unknown[]) => {
        morphCalled = true;
        morphArgs = args;
      },
    };

    const mockOutlet = { innerHTML: "" };
    (document as Record<string, unknown>)["querySelector"] = (sel: string) => {
      if (sel.includes("capstan-outlet")) return mockOutlet;
      return null;
    };

    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        html: "<div>Morphed</div>",
      },
    });

    const router = new CapstanRouter(manifest);
    await router.navigate("/about");

    expect(morphCalled).toBe(true);
    expect(morphArgs[1]).toBe("<div>Morphed</div>");

    delete (globalThis as Record<string, unknown>)["Idiomorph"];
    (document as Record<string, unknown>)["querySelector"] = () => null;
    router.destroy();
  });

  // ------- initRouter singleton -------

  test("initRouter returns same instance on second call", () => {
    const r1 = initRouter(manifest);
    const r2 = initRouter(manifest);
    expect(r1).toBe(r2);
    r1.destroy();
  });

  // ------- popstate -------

  test("popstate navigates from cached payload", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    const router = new CapstanRouter(manifest);
    await router.navigate("/about");

    const states: string[] = [];
    router.subscribe((s) => states.push(s.status));

    // Simulate popstate (browser back)
    for (const fn of [...popstateListeners]) {
      fn({ state: { __capstanUrl: "/", __capstanKey: "test-key" } } as unknown as PopStateEvent);
    }

    // Give async handler time to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(states).toContain("loading");
    router.destroy();
  });

  // ------- destroy -------

  test("destroy aborts in-flight navigation", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    const router = new CapstanRouter(manifest);
    const navPromise = router.navigate("/about");
    router.destroy();

    // Should not throw even though aborted
    await navPromise;
  });

  test("destroy clears cache and listeners", () => {
    const router = new CapstanRouter(manifest);
    const unsub = router.subscribe(() => {});

    router.destroy();
    // After destroy, getRouter should return null
    expect(getRouter()).toBeNull();
  });

  // ------- multiple subscribers -------

  test("multiple subscribers all receive state updates", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    const router = new CapstanRouter(manifest);
    const calls1: string[] = [];
    const calls2: string[] = [];
    router.subscribe((s) => calls1.push(s.url));
    router.subscribe((s) => calls2.push(s.url));

    await router.navigate("/about");

    expect(calls1.length).toBeGreaterThan(0);
    expect(calls2.length).toBeGreaterThan(0);
    expect(calls1).toEqual(calls2);
    router.destroy();
  });

  // ------- fetchNavPayload caching -------

  test("fetchNavPayload caches result for subsequent navigations", async () => {
    let fetchCount = 0;
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      fetchCount++;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          url: "/about",
          layoutKey: "/",
          loaderData: null,
          componentType: "server",
        }),
      };
    };

    const router = new CapstanRouter(manifest);
    await router.navigate("/about");
    expect(fetchCount).toBe(1);

    // Force navigate again by using noCache on URL, then navigate normally
    // But first navigate to / then back to /about
    (globalThis as Record<string, unknown>)["fetch"] = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        url: "/",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
      }),
    });
    await router.navigate("/");

    fetchCount = 0;
    (globalThis as Record<string, unknown>)["fetch"] = async () => {
      fetchCount++;
      return { ok: true, status: 200, json: async () => ({}) };
    };

    await router.navigate("/about"); // should use cache
    expect(fetchCount).toBe(0);

    (globalThis as Record<string, unknown>)["fetch"] = origFetch;
    router.destroy();
  });

  // ------- navigate status transitions -------

  test("navigate goes through loading → idle on success", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    const router = new CapstanRouter(manifest);
    const statuses: string[] = [];
    router.subscribe((s) => statuses.push(s.status));

    await router.navigate("/about");

    expect(statuses[0]).toBe("loading");
    expect(statuses[statuses.length - 1]).toBe("idle");
    router.destroy();
  });

  test("navigate sets error status on fetch failure", async () => {
    // No mock responses → 404
    const origLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...origLocation, href: "/", pathname: "/" },
      writable: true,
      configurable: true,
    });

    const router = new CapstanRouter(manifest);
    const statuses: string[] = [];
    router.subscribe((s) => statuses.push(s.status));

    await router.navigate("/nonexistent");

    expect(statuses).toContain("error");
    expect(router.state.error).toBeDefined();

    Object.defineProperty(window, "location", {
      value: origLocation,
      writable: true,
      configurable: true,
    });
    router.destroy();
  });

  // ------- history state -------

  test("navigate stores __capstanKey and __capstanUrl in history state", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    const router = new CapstanRouter(manifest);
    await router.navigate("/about");

    const lastEntry = historyStack[historyStack.length - 1];
    const state = lastEntry?.state as Record<string, unknown>;
    expect(state["__capstanKey"]).toBeDefined();
    expect(state["__capstanUrl"]).toBe("/about");
    router.destroy();
  });

  test("constructor takes ownership of scroll restoration and destroy restores it", () => {
    (history as Record<string, unknown>)["scrollRestoration"] = "auto";

    const router = new CapstanRouter(manifest);
    expect((history as Record<string, unknown>)["scrollRestoration"]).toBe("manual");

    router.destroy();
    expect((history as Record<string, unknown>)["scrollRestoration"]).toBe("auto");
  });

  test("navigate with state merges custom state into history", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    const router = new CapstanRouter(manifest);
    await router.navigate("/about", { state: { from: "home" } });

    const lastEntry = historyStack[historyStack.length - 1];
    const state = lastEntry?.state as Record<string, unknown>;
    expect(state["from"]).toBe("home");
    expect(state["__capstanKey"]).toBeDefined();
    router.destroy();
  });

  test("constructor preserves existing history state while normalizing capstan fields", () => {
    history.replaceState({ fromServer: true, __capstanKey: "existing-key" }, "", "/");

    const router = new CapstanRouter(manifest);
    const state = history.state as Record<string, unknown>;

    expect(state["fromServer"]).toBe(true);
    expect(state["__capstanKey"]).toBe("existing-key");
    expect(state["__capstanUrl"]).toBe("/");
    router.destroy();
  });

  test("navigate ignores non-object custom history state instead of spreading it", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    const router = new CapstanRouter(manifest);
    await router.navigate("/about", { state: "bad-state" as unknown });

    const lastEntry = historyStack[historyStack.length - 1];
    const state = lastEntry?.state as Record<string, unknown>;
    expect(state["__capstanUrl"]).toBe("/about");
    expect(state["__capstanKey"]).toBeDefined();
    expect(state["0"]).toBeUndefined();
    router.destroy();
  });

  test("failed noCache navigation reuses the last cached payload instead of hard reloading", async () => {
    const router = new CapstanRouter(manifest);
    const origLocation = window.location;
    const origDispatch = window.dispatchEvent;
    let locationChanged = false;
    let eventDetail: Record<string, unknown> | null = null;

    (window as Record<string, unknown>)["dispatchEvent"] = (event: Event) => {
      if (event.type === "capstan:navigate") {
        eventDetail = (event as CustomEvent).detail as Record<string, unknown>;
      }
      return true;
    };

    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: { version: "stale" },
        componentType: "server",
      },
    });

    await router.prefetch("/about");

    Object.defineProperty(window, "location", {
      value: {
        ...origLocation,
        get href() { return "/"; },
        set href(_: string) { locationChanged = true; },
        pathname: "/",
      },
      writable: true,
      configurable: true,
    });

    (globalThis as Record<string, unknown>)["fetch"] = async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await router.navigate("/about", { noCache: true });

    expect(locationChanged).toBe(false);
    expect(router.state.status).toBe("idle");
    expect(router.state.url).toBe("/about");
    expect(eventDetail?.["loaderData"]).toEqual({ version: "stale" });

    let fetchCount = 0;
    (globalThis as Record<string, unknown>)["fetch"] = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      fetchCount++;
      if (url.endsWith("/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            url: "/",
            layoutKey: "/",
            loaderData: null,
            componentType: "server",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          url: "/about",
          layoutKey: "/",
          loaderData: { version: "fresh" },
          componentType: "server",
        }),
      };
    };

    await router.navigate("/", { replace: true });
    await router.navigate("/about", { noCache: true });

    expect(fetchCount).toBe(2);
    expect(eventDetail?.["loaderData"]).toEqual({ version: "fresh" });

    (window as Record<string, unknown>)["dispatchEvent"] = origDispatch;
    Object.defineProperty(window, "location", {
      value: origLocation,
      writable: true,
      configurable: true,
    });
    mockFetchForNav();
    router.destroy();
  });

  test("navigation failure after head sync restores the last stable head state", async () => {
    const head = installHeadMock();
    const origDispatch = window.dispatchEvent;
    const origLocation = window.location;
    let locationChanged = false;

    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        metadata: {
          title: "About Us",
          description: "About page",
        },
      },
    });
    mockFetchResponses.push({
      url: "/posts/1",
      payload: {
        url: "/posts/1",
        layoutKey: "/",
        loaderData: null,
        componentType: "client",
        metadata: {
          title: "Broken Post",
          description: "Broken page",
        },
      },
    });

    const router = new CapstanRouter(manifest);

    try {
      await router.navigate("/about");
      expect(document.title).toBe("About Us");
      expect(head.find("meta", { name: "description", content: "About page" })).toBeDefined();

      Object.defineProperty(window, "location", {
        value: {
          ...origLocation,
          get href() { return "/about"; },
          set href(_: string) { locationChanged = true; },
          pathname: "/about",
        },
        writable: true,
        configurable: true,
      });

      (window as Record<string, unknown>)["dispatchEvent"] = (event: Event) => {
        if (event.type === "capstan:navigate") {
          throw new Error("listener failed");
        }
        return true;
      };

      await router.navigate("/posts/1");

      expect(locationChanged).toBe(true);
      expect(router.state.status).toBe("error");
      expect(router.state.url).toBe("/about");
      expect(document.title).toBe("About Us");
      expect(head.find("meta", { name: "description", content: "About page" })).toBeDefined();
      expect(head.find("meta", { name: "description", content: "Broken page" })).toBeUndefined();
    } finally {
      (window as Record<string, unknown>)["dispatchEvent"] = origDispatch;
      Object.defineProperty(window, "location", {
        value: origLocation,
        writable: true,
        configurable: true,
      });
      head.restore();
      router.destroy();
    }
  });

  test("popstate restores saved scroll position for the target history entry", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });
    mockFetchResponses.push({
      url: "/",
      payload: { url: "/", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    const router = new CapstanRouter(manifest);
    const rootState = history.state as Record<string, string>;
    const rootKey = rootState["__capstanKey"];

    await router.navigate("/about");

    sessionStorage.setItem(
      `__capstan_scroll_${rootKey}`,
      JSON.stringify({ x: 0, y: 140 }),
    );

    let restoredY = -1;
    const origScrollTo = window.scrollTo;
    (window as Record<string, unknown>)["scrollTo"] = (_x: number, y: number) => {
      restoredY = y;
    };

    for (const fn of [...popstateListeners]) {
      fn({ state: { __capstanUrl: "/", __capstanKey: rootKey } } as unknown as PopStateEvent);
    }

    await new Promise((r) => setTimeout(r, 20));

    expect(restoredY).toBe(140);

    (window as Record<string, unknown>)["scrollTo"] = origScrollTo;
    router.destroy();
  });

  test("popstate navigation failure restores the stable view without forcing a hard reload", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: {
        url: "/about",
        layoutKey: "/",
        loaderData: { section: "about" },
        componentType: "server",
        metadata: { title: "About Stable" },
      },
    });

    const router = new CapstanRouter(manifest);
    const origLocation = window.location;
    let locationChanged = false;

    await router.navigate("/about");

    Object.defineProperty(window, "location", {
      value: {
        ...origLocation,
        get href() { return "/about"; },
        set href(_: string) { locationChanged = true; },
        pathname: "/about",
      },
      writable: true,
      configurable: true,
    });

    (globalThis as Record<string, unknown>)["fetch"] = async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    for (const fn of [...popstateListeners]) {
      fn({ state: { __capstanUrl: "/", __capstanKey: "root-key" } } as unknown as PopStateEvent);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(locationChanged).toBe(false);
    expect(router.state.status).toBe("error");
    expect(router.state.url).toBe("/about");
    expect(document.title).toBe("About Stable");

    Object.defineProperty(window, "location", {
      value: origLocation,
      writable: true,
      configurable: true,
    });
    mockFetchForNav();
    router.destroy();
  });

  test("new navigate aborts an in-flight popstate navigation before it can win", async () => {
    const aboutDeferred = createDeferred<NavigationPayload>();
    const origFetch = globalThis.fetch;
    const origLocation = window.location;
    let locationChanged = false;

    Object.defineProperty(window, "location", {
      value: {
        ...origLocation,
        get href() { return "/"; },
        set href(_: string) { locationChanged = true; },
        pathname: "/",
      },
      writable: true,
      configurable: true,
    });

    (globalThis as Record<string, unknown>)["fetch"] = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.endsWith("/about")) {
        return await new Promise((resolve, reject) => {
          const signal = init?.signal;
          const abort = () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          };

          if (signal?.aborted) {
            abort();
            return;
          }

          signal?.addEventListener("abort", abort, { once: true });
          void aboutDeferred.promise.then((payload) => {
            resolve({
              ok: true,
              status: 200,
              json: async () => payload,
            });
          });
        });
      }

      if (url.endsWith("/posts/1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            url: "/posts/1",
            layoutKey: "/",
            loaderData: { id: 1 },
            componentType: "client",
          }),
        };
      }

      return { ok: false, status: 404, statusText: "Not Found" };
    };

    const router = new CapstanRouter(manifest);

    for (const fn of [...popstateListeners]) {
      fn({ state: { __capstanUrl: "/about", __capstanKey: "about-key" } } as unknown as PopStateEvent);
    }

    await Promise.resolve();
    await router.navigate("/posts/1");
    aboutDeferred.resolve({
      url: "/about",
      layoutKey: "/",
      loaderData: null,
      componentType: "server",
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(router.state.url).toBe("/posts/1");
    expect(locationChanged).toBe(false);
    expect(historyStack[historyStack.length - 1]?.url).toBe("/posts/1");

    (globalThis as Record<string, unknown>)["fetch"] = origFetch;
    Object.defineProperty(window, "location", {
      value: origLocation,
      writable: true,
      configurable: true,
    });
    router.destroy();
  });

  // ------- applyNavigation with client componentType -------

  test("client componentType does not morph DOM", async () => {
    let morphCalled = false;
    const origQuery = document.querySelector;
    (document as Record<string, unknown>)["querySelector"] = () => ({
      set innerHTML(v: string) { morphCalled = true; },
    });

    mockFetchResponses.push({
      url: "/posts/1",
      payload: {
        url: "/posts/1",
        layoutKey: "/",
        loaderData: { id: 1 },
        componentType: "client", // client — no morphing
        html: "<div>Should not morph</div>",
      },
    });

    const router = new CapstanRouter(manifest);
    await router.navigate("/posts/1");

    // Client components don't morph (condition: componentType === "server" && html)
    expect(morphCalled).toBe(false);

    (document as Record<string, unknown>)["querySelector"] = origQuery;
    router.destroy();
  });

  // ------- params extraction in applyNavigation -------

  test("navigate extracts params from URL pattern", async () => {
    mockFetchResponses.push({
      url: "/posts/42",
      payload: {
        url: "/posts/42",
        layoutKey: "/",
        loaderData: { id: 42 },
        componentType: "client",
      },
    });

    let eventParams: Record<string, string> = {};
    const origDispatch = window.dispatchEvent;
    (window as Record<string, unknown>)["dispatchEvent"] = (e: Event) => {
      if (e.type === "capstan:navigate") {
        eventParams = (e as CustomEvent).detail.params;
      }
      return true;
    };

    const router = new CapstanRouter(manifest);
    await router.navigate("/posts/42");

    expect(eventParams["id"]).toBe("42");

    (window as Record<string, unknown>)["dispatchEvent"] = origDispatch;
    router.destroy();
  });

  // ------- NavigationCache integration -------

  test("cache is cleared on destroy", async () => {
    mockFetchResponses.push({
      url: "/about",
      payload: { url: "/about", layoutKey: "/", loaderData: null, componentType: "server" },
    });

    const router = new CapstanRouter(manifest);
    await router.prefetch("/about");
    router.destroy();

    // After destroy, creating a new router and navigating should re-fetch
    const router2 = new CapstanRouter(manifest);
    let fetchHappened = false;
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async () => {
      fetchHappened = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          url: "/about",
          layoutKey: "/",
          loaderData: null,
          componentType: "server",
        }),
      };
    };

    await router2.navigate("/about");
    expect(fetchHappened).toBe(true);

    (globalThis as Record<string, unknown>)["fetch"] = origFetch;
    router2.destroy();
  });

  // ------- findSharedLayout via applyNavigation -------

  test("navigate between routes with shared layout", async () => {
    const sharedManifest: ClientRouteManifest = {
      routes: [
        { urlPattern: "/posts/:id", componentType: "client", layouts: ["/_layout.tsx", "/posts/_layout.tsx"] },
        { urlPattern: "/posts/new", componentType: "client", layouts: ["/_layout.tsx", "/posts/_layout.tsx"] },
      ],
    };

    (globalThis as Record<string, unknown>)["fetch"] = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        url: "/posts/new",
        layoutKey: "/posts/_layout.tsx",
        loaderData: null,
        componentType: "client",
      }),
    });

    const router = new CapstanRouter(sharedManifest);
    // Simulate being on /posts/1
    await router.navigate("/posts/new");
    expect(router.state.url).toBe("/posts/new");

    router.destroy();
    mockFetchForNav(); // restore
  });
});

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

import { CapstanRouter } from "@zauso-ai/capstan-react/client";

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
});

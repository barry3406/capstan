import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import {
  setupBrowserEnv,
  teardownBrowserEnv,
  resetBrowserEnv,
} from "../helpers/browser-env.js";
import {
  initRouter,
  getRouter,
  getPrefetchManager,
  type ClientRouteManifest,
  type NavigationPayload,
} from "@zauso-ai/capstan-react/client";

const manifest: ClientRouteManifest = {
  routes: [
    { urlPattern: "/", componentType: "server", layouts: [] },
    { urlPattern: "/about", componentType: "server", layouts: [] },
  ],
};

const originalFetch = globalThis.fetch;

function makeElement(href: string): Element & { fire: (type: string) => void } {
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
    fire: (type: string) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
  } as unknown as Element & { fire: (type: string) => void };
}

beforeAll(() => { setupBrowserEnv(); });
afterAll(() => {
  (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
  teardownBrowserEnv();
});

beforeEach(() => {
  resetBrowserEnv();
  getRouter()?.destroy();
  getPrefetchManager().destroy();
});

describe("PrefetchManager invalidation", () => {
  test("re-prefetches after the router cache is cleared", async () => {
    const responses: Record<string, NavigationPayload> = {
      "/about": {
        url: "/about",
        layoutKey: "/",
        loaderData: { prefetch: true },
        componentType: "server",
        html: "<div>About</div>",
      },
    };

    let fetchCount = 0;
    (globalThis as Record<string, unknown>)["fetch"] = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const isNav = (init?.headers as Record<string, string>)?.["X-Capstan-Nav"] === "1";
      if (isNav && responses[url]) {
        fetchCount += 1;
        return {
          ok: true,
          status: 200,
          json: async () => responses[url],
        };
      }

      return { ok: false, status: 404, statusText: "Not Found" };
    };

    const manager = getPrefetchManager();
    const element = makeElement("/about");

    const router1 = initRouter(manifest);
    manager.observe(element, "hover");
    element.fire("pointerenter");
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(fetchCount).toBe(1);
    router1.destroy();

    const router2 = initRouter(manifest);
    element.fire("pointerenter");
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(fetchCount).toBe(2);

    router2.destroy();
    manager.destroy();
  });
});

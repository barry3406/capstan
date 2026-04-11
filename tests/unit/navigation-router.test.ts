import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import {
  setupBrowserEnv,
  teardownBrowserEnv,
  resetBrowserEnv,
  historyStack,
  popstateListeners,
  mockSessionStorage,
} from "../helpers/browser-env.js";
import {
  CapstanRouter,
} from "@zauso-ai/capstan-react/client";
import type {
  ClientRouteManifest,
  NavigationPayload,
} from "@zauso-ai/capstan-react/client";

const manifest: ClientRouteManifest = {
  routes: [
    { urlPattern: "/", componentType: "server", layouts: [] },
    { urlPattern: "/about", componentType: "server", layouts: [] },
  ],
};

const originalFetch = globalThis.fetch;

beforeAll(() => { setupBrowserEnv(); });
afterAll(() => {
  (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
  teardownBrowserEnv();
});

beforeEach(() => {
  resetBrowserEnv();
  (window as Record<string, unknown>)["scrollX"] = 0;
  (window as Record<string, unknown>)["scrollY"] = 0;
  (window.location as Record<string, unknown>)["href"] = "https://example.com/";
  (window.location as Record<string, unknown>)["pathname"] = "/";
  (window.location as Record<string, unknown>)["search"] = "";
  (window.location as Record<string, unknown>)["hash"] = "";
  document.title = "";
});

function installFetch(responses: Record<string, NavigationPayload>): void {
  (globalThis as Record<string, unknown>)["fetch"] = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const isNav = (init?.headers as Record<string, string>)?.["X-Capstan-Nav"] === "1";

    if (isNav && responses[url]) {
      return {
        ok: true,
        status: 200,
        json: async () => responses[url],
      };
    }

    return { ok: false, status: 404, statusText: "Not Found" };
  };
}

describe("CapstanRouter navigation robustness", () => {
  test("navigates same-origin absolute URLs through the normalized path", async () => {
    installFetch({
      "/about?ref=1": {
        url: "/about?ref=1",
        layoutKey: "/",
        loaderData: { ok: true },
        componentType: "server",
        html: "<div>About</div>",
      },
    });

    const router = new CapstanRouter(manifest);
    try {
      await router.navigate("https://example.com/about?ref=1#team");

      expect(router.state.url).toBe("/about?ref=1#team");
      expect(historyStack[historyStack.length - 1]?.url).toBe("/about?ref=1#team");
    } finally {
      router.destroy();
    }
  });

  test("popstate falls back to the history snapshot when sessionStorage is missing", async () => {
    (window as Record<string, unknown>)["scrollY"] = 120;
    installFetch({
      "/about": {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        html: "<div>About</div>",
      },
      "/": {
        url: "/",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        html: "<div>Home</div>",
      },
    });

    const router = new CapstanRouter(manifest);
    const rootState = historyStack[0]?.state as Record<string, unknown>;
    const rootKey = String(rootState["__capstanKey"]);
    mockSessionStorage.removeItem(`__capstan_scroll_${rootKey}`);

    await router.navigate("/about");

    const scrollCalls: Array<[number, number]> = [];
    const originalScrollTo = window.scrollTo;
    (window as Record<string, unknown>)["scrollTo"] = (x: number, y: number) => {
      scrollCalls.push([x, y]);
    };

    for (const listener of [...popstateListeners]) {
      listener({ state: historyStack[0]?.state } as unknown as PopStateEvent);
    }

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(scrollCalls).toContainEqual([0, 120]);

    (window as Record<string, unknown>)["scrollTo"] = originalScrollTo;
    router.destroy();
  });

  test("failed navigation rolls back to the previous scroll position", async () => {
    installFetch({
      "/about": {
        url: "/about",
        layoutKey: "/",
        loaderData: null,
        componentType: "server",
        html: "<div>About</div>",
      },
    });

    const router = new CapstanRouter(manifest);
    const originalLocation = window.location;
    const originalDispatch = window.dispatchEvent;
    const originalScrollTo = window.scrollTo;
    const scrollCalls: Array<[number, number]> = [];
    let locationChanged = false;

    (window as Record<string, unknown>)["scrollY"] = 88;
    (window as Record<string, unknown>)["scrollTo"] = (x: number, y: number) => {
      scrollCalls.push([x, y]);
    };

    Object.defineProperty(window, "location", {
      value: {
        ...originalLocation,
        get href() { return "/"; },
        set href(_: string) { locationChanged = true; },
        pathname: "/",
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

    try {
      await router.navigate("/about");

      expect(locationChanged).toBe(true);
      expect(router.state.status).toBe("error");
      expect(router.state.url).toBe("/");
      expect(scrollCalls).toContainEqual([0, 88]);
    } finally {
      (window as Record<string, unknown>)["dispatchEvent"] = originalDispatch;
      (window as Record<string, unknown>)["scrollTo"] = originalScrollTo;
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
      router.destroy();
    }
  });
});


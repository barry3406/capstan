/**
 * Shared browser environment polyfills for client-side tests.
 *
 * Call `setupBrowserEnv()` in `beforeAll` and `teardownBrowserEnv()` in
 * `afterAll`. This avoids global pollution that breaks SSR-oriented tests
 * (e.g., rsc.test.ts which requires `typeof window === "undefined"`).
 */

// ---------------------------------------------------------------------------
// Session storage mock
// ---------------------------------------------------------------------------

const storageMap = new Map<string, string>();

export const mockSessionStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => storageMap.set(key, value),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear(),
  get length() { return storageMap.size; },
  key: () => null,
};

// ---------------------------------------------------------------------------
// History state tracking (exported for test assertions)
// ---------------------------------------------------------------------------

export const historyStack: Array<{ state: unknown; url: string }> = [{ state: null, url: "/" }];
export let currentHistoryIdx = 0;
export const popstateListeners: Array<(e: PopStateEvent) => void> = [];

// ---------------------------------------------------------------------------
// Setup — install browser globals
// ---------------------------------------------------------------------------

export function setupBrowserEnv(): void {
  if (typeof globalThis.sessionStorage === "undefined") {
    Object.defineProperty(globalThis, "sessionStorage", {
      value: mockSessionStorage,
      writable: true,
      configurable: true,
    });
  }

  // Force-define (don't guard with typeof check — another test may have deleted it)
  Object.defineProperty(globalThis, "window", {
    value: {
      scrollX: 0,
      scrollY: 0,
      scrollTo: () => {},
      location: { pathname: "/", href: "/" },
      addEventListener: (type: string, fn: (...args: unknown[]) => void) => {
        if (type === "popstate") popstateListeners.push(fn as (e: PopStateEvent) => void);
      },
      removeEventListener: (type: string, fn: (...args: unknown[]) => void) => {
        if (type === "popstate") {
          const idx = popstateListeners.indexOf(fn as (e: PopStateEvent) => void);
          if (idx >= 0) popstateListeners.splice(idx, 1);
        }
      },
      dispatchEvent: () => true,
      sessionStorage: mockSessionStorage,
      CustomEvent: class extends Event {
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          super(type);
          this.detail = init?.detail;
        }
      },
    },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(globalThis, "history", {
    value: {
      get state() { return historyStack[currentHistoryIdx]?.state ?? null; },
      pushState: (state: unknown, _title: string, url?: string) => {
        historyStack.push({ state, url: url ?? "/" });
        currentHistoryIdx = historyStack.length - 1;
      },
      replaceState: (state: unknown, _title: string, _url?: string) => {
        historyStack[currentHistoryIdx] = {
          state,
          url: _url ?? historyStack[currentHistoryIdx]!.url,
        };
      },
    },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(globalThis, "document", {
    value: {
      title: "",
      querySelector: () => null,
      getElementById: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Teardown — remove browser globals so SSR-oriented tests are unaffected
// ---------------------------------------------------------------------------

export function teardownBrowserEnv(): void {
  delete (globalThis as Record<string, unknown>)["window"];
  delete (globalThis as Record<string, unknown>)["history"];
  delete (globalThis as Record<string, unknown>)["document"];
  delete (globalThis as Record<string, unknown>)["sessionStorage"];
}

// ---------------------------------------------------------------------------
// Reset — call in beforeEach to get a clean slate (globals stay installed)
// ---------------------------------------------------------------------------

export function resetBrowserEnv(): void {
  storageMap.clear();

  historyStack.length = 0;
  historyStack.push({ state: null, url: "/" });
  currentHistoryIdx = 0;
  popstateListeners.length = 0;

  if (typeof globalThis.window !== "undefined") {
    const w = globalThis.window as Record<string, unknown>;
    w["scrollX"] = 0;
    w["scrollY"] = 0;
    (w["location"] as Record<string, string>)["pathname"] = "/";
    (w["location"] as Record<string, string>)["href"] = "/";
  }

  if (typeof globalThis.document !== "undefined") {
    document.title = "";
  }
}

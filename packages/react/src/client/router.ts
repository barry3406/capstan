import type {
  NavigationPayload,
  NavigateOptions,
  RouterState,
  NavigateEventDetail,
  ClientRouteEntry,
} from "./types.js";
import { NavigationCache } from "./cache.js";
import type { ClientRouteManifest } from "./manifest.js";
import { matchRoute, findSharedLayout } from "./manifest.js";
import { normalizeNavigationPayload } from "./payload.js";
import { syncDocumentHead } from "./head.js";
import {
  saveScrollPosition,
  restoreScrollPosition,
  scrollToTop,
  generateScrollKey,
  setCurrentScrollKey,
} from "./scroll.js";
import { withViewTransition } from "./transition.js";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _router: CapstanRouter | null = null;

export function getRouter(): CapstanRouter | null {
  return _router;
}

export function initRouter(manifest: ClientRouteManifest): CapstanRouter {
  if (_router) return _router;
  _router = new CapstanRouter(manifest);
  return _router;
}

// ---------------------------------------------------------------------------
// CapstanRouter
// ---------------------------------------------------------------------------

type StateListener = (state: RouterState) => void;

const NAV_HEADER = "X-Capstan-Nav";

export class CapstanRouter {
  private manifest: ClientRouteManifest;
  private cache = new NavigationCache();
  private listeners = new Set<StateListener>();
  private currentRoute: ClientRouteEntry | undefined;
  private abortController: AbortController | null = null;

  state: RouterState = {
    url: typeof window !== "undefined" ? window.location.pathname : "/",
    status: "idle",
  };

  constructor(manifest: ClientRouteManifest) {
    this.manifest = manifest;

    if (typeof window !== "undefined") {
      // Resolve the current route from the manifest
      const match = matchRoute(manifest, window.location.pathname);
      if (match) this.currentRoute = match.route;

      // Set initial scroll key
      const key = generateScrollKey();
      setCurrentScrollKey(key);
      history.replaceState(
        { ...history.state, __capstanKey: key },
        "",
      );

      window.addEventListener("popstate", this.onPopState);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Navigate to a new URL.  This is the primary entry point used by
   * `<Link>` and programmatic navigation.
   */
  async navigate(url: string, opts: NavigateOptions = {}): Promise<void> {
    // Same-page navigation — skip
    if (url === this.state.url && !opts.noCache) return;

    // Abort any in-flight navigation
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Save scroll position before leaving
    saveScrollPosition();

    this.setState({ url, status: "loading" });

    try {
      const payload = await this.fetchNavPayload(url, opts, signal);
      if (signal.aborted) return;

      // Apply the navigation inside a View Transition
      await withViewTransition(() => {
        this.applyNavigation(payload);
      });

      // Update history
      const scrollKey = generateScrollKey();
      const historyState = { __capstanKey: scrollKey, __capstanUrl: url, ...(opts.state ?? {}) };

      if (opts.replace) {
        history.replaceState(historyState, "", url);
      } else {
        history.pushState(historyState, "", url);
      }
      setCurrentScrollKey(scrollKey);

      // Scroll
      if (opts.scroll !== false) {
        scrollToTop();
      }

      this.setState({ url, status: "idle" });
    } catch (err) {
      if (signal.aborted) return;
      this.setState({ url: this.state.url, status: "error", error: err instanceof Error ? err : new Error(String(err)) });

      // If the client-side navigation failed, fall back to a full page load
      // so the user still reaches the destination.
      window.location.href = url;
    }
  }

  /**
   * Prefetch a URL's navigation payload into the cache.
   * No-op if already cached.
   */
  async prefetch(url: string): Promise<void> {
    if (this.cache.peek(url)) return;
    try {
      const res = await fetch(url, {
        headers: { [NAV_HEADER]: "1", Accept: "application/json" },
      });
      if (!res.ok) return;
      const payload = normalizeNavigationPayload(url, await res.json());
      this.cache.set(url, payload);
    } catch {
      // Prefetch failures are non-critical — silently ignore
    }
  }

  /**
   * Subscribe to router state changes.  Returns an unsubscribe function.
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Destroy the router and clean up event listeners.
   */
  destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", this.onPopState);
    }
    this.abortController?.abort();
    this.cache.clear();
    this.listeners.clear();
    _router = null;
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async fetchNavPayload(
    url: string,
    opts: NavigateOptions,
    signal: AbortSignal,
  ): Promise<NavigationPayload> {
    // Check cache first
    if (!opts.noCache) {
      const cached = this.cache.get(url);
      if (cached) return cached;
    }

    const res = await fetch(url, {
      headers: { [NAV_HEADER]: "1", Accept: "application/json" },
      signal,
    });

    if (!res.ok) {
      throw new Error(`Navigation fetch failed: ${res.status} ${res.statusText}`);
    }

    const payload = normalizeNavigationPayload(url, await res.json());
    this.cache.set(url, payload);
    return payload;
  }

  /**
   * Apply a navigation payload to the DOM.
   *
   * - Server components: morphdom the outlet content
   * - Client components: dispatch a CustomEvent so React can re-render
   */
  private applyNavigation(payload: NavigationPayload): void {
    // Resolve the target route
    const match = matchRoute(this.manifest, payload.url);
    const targetRoute = match?.route;
    const params = match?.params ?? {};

    syncDocumentHead(payload.metadata);

    // Find the deepest shared layout between current and target
    const layoutKey = targetRoute
      ? findSharedLayout(this.currentRoute, targetRoute)
      : "/";

    if (payload.componentType === "server" && payload.html) {
      // Server component — morph the DOM outlet
      this.morphOutlet(layoutKey, payload.html);
    }

    // Dispatch CustomEvent for React (used by both server and client components)
    const detail: NavigateEventDetail = {
      url: payload.url,
      loaderData: payload.loaderData,
      params,
    };
    if (payload.metadata) detail.metadata = payload.metadata;
    window.dispatchEvent(
      new CustomEvent("capstan:navigate", { detail }),
    );

    // Update current route reference
    this.currentRoute = targetRoute;
  }

  /**
   * Morph the content of the outlet matching the layout key.
   * Uses idiomorph if available, otherwise falls back to innerHTML.
   */
  private morphOutlet(layoutKey: string, html: string): void {
    // Find the outlet element for this layout
    const outlet =
      document.querySelector(`[data-capstan-outlet="${layoutKey}"]`) ??
      document.querySelector("[data-capstan-outlet]") ??
      document.getElementById("capstan-root");

    if (!outlet) return;

    // Try idiomorph first (loaded at bootstrap), fall back to innerHTML
    const Idiomorph = (globalThis as Record<string, unknown>)["Idiomorph"] as
      | { morph: (target: Element, html: string, options?: object) => void }
      | undefined;

    if (Idiomorph?.morph) {
      Idiomorph.morph(outlet, html, {
        morphStyle: "innerHTML",
        ignoreActiveValue: true,
      });
    } else {
      outlet.innerHTML = html;
    }
  }

  private onPopState = (event: PopStateEvent): void => {
    const state = event.state as
      | { __capstanKey?: string; __capstanUrl?: string }
      | null;
    const url = state?.__capstanUrl ?? window.location.pathname;
    const scrollKey = state?.__capstanKey ?? null;

    // Try to navigate from cache, otherwise fetch
    void (async () => {
      saveScrollPosition();
      this.setState({ url, status: "loading" });

      try {
        const payload = await this.fetchNavPayload(url, {}, new AbortController().signal);

        await withViewTransition(() => {
          this.applyNavigation(payload);
        });

        setCurrentScrollKey(scrollKey ?? generateScrollKey());

        // Restore scroll position for back/forward
        if (!restoreScrollPosition(scrollKey)) {
          scrollToTop();
        }

        this.setState({ url, status: "idle" });
      } catch {
        // On failure, let the browser handle it
        window.location.href = url;
      }
    })();
  };

  private setState(next: RouterState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}

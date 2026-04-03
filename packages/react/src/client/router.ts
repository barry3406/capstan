import type {
  NavigationPayload,
  NavigateOptions,
  RouterState,
  NavigateEventDetail,
  ClientRouteEntry,
  ClientMetadata,
} from "./types.js";
import { NavigationCache } from "./cache.js";
import type { ClientRouteManifest } from "./manifest.js";
import { matchRoute, findSharedLayout } from "./manifest.js";
import { normalizeNavigationPayload } from "./payload.js";
import { syncDocumentHead } from "./head.js";
import { normalizeClientNavigationUrl } from "./navigation-url.js";
import {
  buildHistoryState,
  readHistoryEntryState,
  writeHistoryState,
} from "./history.js";
import {
  captureScrollPosition,
  saveScrollPosition,
  restoreScrollPosition,
  restoreScrollSnapshot,
  scrollToTop,
  generateScrollKey,
  setCurrentScrollKey,
} from "./scroll.js";
import { withViewTransition } from "./transition.js";
import { NavigationTransactionStack, type NavigationTransaction, type StableViewState } from "./transaction.js";

type NormalizedNavigationTarget = NonNullable<ReturnType<typeof normalizeClientNavigationUrl>>;

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
  private transactions = new NavigationTransactionStack();
  private stableUrl = this.getCurrentLocationUrl();
  private stableMetadata: ClientMetadata | undefined;
  private stableTitle = typeof document !== "undefined" ? document.title : "";
  private stableScroll = captureScrollPosition();
  private originalScrollRestoration: History["scrollRestoration"] | null = null;

  state: RouterState = {
    url: this.getCurrentLocationUrl(),
    status: "idle",
  };

  constructor(manifest: ClientRouteManifest) {
    this.manifest = manifest;

    if (typeof window !== "undefined") {
      // Resolve the current route from the manifest
      const currentLocation = this.getCurrentLocationUrl();
      const match = matchRoute(manifest, this.getCurrentLocationPathname());
      if (match) this.currentRoute = match.route;
      this.stableUrl = currentLocation;
      this.stableTitle = typeof document !== "undefined" ? document.title : "";
      this.stableScroll = captureScrollPosition();

      // Set initial scroll key
      const historyState = readHistoryEntryState();
      const key = historyState.key ?? generateScrollKey();
      setCurrentScrollKey(key);
      const initialState = buildHistoryState(
        currentLocation,
        key,
        historyState.state,
        historyState.scroll ?? this.stableScroll,
      );
      writeHistoryState("replace", initialState, currentLocation);

      if (typeof history.scrollRestoration === "string") {
        this.originalScrollRestoration = history.scrollRestoration;
        history.scrollRestoration = "manual";
      }

      window.addEventListener("popstate", this.onPopState);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Navigate to a new URL.  This is the primary entry point used by
   * `<Link>` and programmatic navigation.
   */
  async navigate(url: string, opts: NavigateOptions = {}): Promise<void> {
    const target = this.normalizeNavigationTarget(url);
    if (!target) {
      return;
    }

    // Same-page navigation — skip unless the caller explicitly wants to bypass cache.
    if (target.href === this.state.url && !opts.noCache) return;

    await this.runNavigation(target, opts, {
      type: opts.replace ? "replace" : "push",
      state: opts.state,
      scroll: opts.scroll !== false ? "top" : "none",
    });
  }

  /**
   * Prefetch a URL's navigation payload into the cache.
   * No-op if already cached.
   */
  async prefetch(url: string): Promise<void> {
    const target = this.normalizeNavigationTarget(url);
    if (!target) return;
    if (this.cache.peek(target.requestUrl)) return;
    try {
      const payload = await this.requestNavigationPayload(target.requestUrl);
      this.cache.set(target.requestUrl, payload);
    } catch {
      this.cache.delete(target.requestUrl);
      // Prefetch failures are non-critical — silently ignore
    }
  }

  hasCachedNavigation(url: string): boolean {
    const target = this.normalizeNavigationTarget(url);
    if (!target) return false;
    return this.cache.peek(target.requestUrl) !== undefined;
  }

  invalidate(url?: string): void {
    if (!url) {
      this.cache.clear();
      return;
    }

    const target = this.normalizeNavigationTarget(url);
    if (!target) {
      return;
    }

    this.cache.delete(target.requestUrl);
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
    this.transactions.clear();
    if (typeof history !== "undefined" && this.originalScrollRestoration) {
      history.scrollRestoration = this.originalScrollRestoration;
    }
    this.cache.clear();
    this.listeners.clear();
    _router = null;
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private async fetchNavPayload(
    target: NormalizedNavigationTarget,
    opts: NavigateOptions,
    signal: AbortSignal,
  ): Promise<NavigationPayload> {
    const cachedFallback = this.cache.peek(target.requestUrl);

    // Check cache first
    if (!opts.noCache) {
      const cached = this.cache.get(target.requestUrl);
      if (cached) return cached;
    }

    try {
      const payload = await this.requestNavigationPayload(target.requestUrl, signal);
      this.cache.set(target.requestUrl, payload);
      return payload;
    } catch (error) {
      if (cachedFallback) {
        return cachedFallback;
      }
      throw error;
    }
  }

  private async requestNavigationPayload(
    url: string,
    signal?: AbortSignal,
  ): Promise<NavigationPayload> {
    const requestInit: RequestInit = {
      headers: { [NAV_HEADER]: "1", Accept: "application/json" },
    };
    if (signal) {
      requestInit.signal = signal;
    }

    const res = await fetch(url, requestInit);

    if (!res.ok) {
      throw new Error(`Navigation fetch failed: ${res.status} ${res.statusText}`);
    }

    return normalizeNavigationPayload(url, await res.json());
  }

  /**
   * Apply a navigation payload to the DOM.
   *
   * - Server components: morphdom the outlet content
   * - Client components: dispatch a CustomEvent so React can re-render
   */
  private applyNavigation(payload: NavigationPayload, target: NormalizedNavigationTarget): void {
    // Resolve the target route
    const normalizedPayload = this.normalizeNavigationTarget(payload.url) ?? target;
    const match = matchRoute(this.manifest, normalizedPayload.pathname);
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
      url: `${normalizedPayload.requestUrl}${target.hash || normalizedPayload.hash}`,
      loaderData: payload.loaderData,
      params,
    };
    if (payload.auth) detail.auth = payload.auth;
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
    const state = readHistoryEntryState(event.state);
    const url = state.url ?? this.getCurrentLocationUrl();
    const scrollKey = state.key ?? null;

    const target = this.normalizeNavigationTarget(url) ?? this.normalizeNavigationTarget(this.getCurrentLocationUrl());
    if (!target) return;

    void this.runNavigation(target, {}, {
      type: "popstate",
      state: event.state,
      scroll: "restore",
      scrollKey,
      scrollSnapshot: state.scroll,
    });
  };

  private setState(next: RouterState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  private async runNavigation(
    target: NormalizedNavigationTarget,
    opts: NavigateOptions,
    mode: {
      type: "push" | "replace" | "popstate";
      state?: unknown;
      scroll: "top" | "restore" | "none";
      scrollKey?: string | null;
      scrollSnapshot?: ReturnType<typeof captureScrollPosition>;
    },
  ): Promise<void> {
    const navigation = this.beginNavigation(target);
    const { signal } = navigation.controller;

    try {
      const payload = await this.fetchNavPayload(target, opts, signal);
      if (!this.isActiveNavigation(navigation)) return;

      await withViewTransition(() => {
        this.applyNavigation(payload, target);
      });
      if (!this.isActiveNavigation(navigation)) return;

      const finalUrl = this.resolveFinalUrl(payload.url, target);
      const scrollKey = mode.type === "popstate" ? mode.scrollKey ?? generateScrollKey() : generateScrollKey();
      const entryState = buildHistoryState(
        finalUrl,
        scrollKey,
        mode.type === "popstate" ? history.state : mode.state,
        captureScrollPosition(),
      );

      if (mode.type === "replace") {
        writeHistoryState("replace", entryState, finalUrl);
      } else if (mode.type === "push") {
        writeHistoryState("push", entryState, finalUrl);
      } else {
        writeHistoryState("replace", buildHistoryState(finalUrl, scrollKey, history.state, captureScrollPosition()), finalUrl);
      }

      setCurrentScrollKey(scrollKey);

      if (mode.scroll === "restore") {
        if (!restoreScrollPosition(scrollKey) && !restoreScrollSnapshot(mode.scrollSnapshot ?? null)) {
          scrollToTop();
        }
      } else if (mode.scroll === "top") {
        scrollToTop();
      }

      this.stableUrl = finalUrl;
      this.stableMetadata = payload.metadata;
      this.stableTitle = typeof document !== "undefined" ? document.title : this.stableTitle;
      this.stableScroll = captureScrollPosition();
      writeHistoryState("replace", buildHistoryState(finalUrl, scrollKey, history.state, this.stableScroll), finalUrl);

      this.transactions.complete(navigation);

      this.setState({ url: finalUrl, status: "idle" });
    } catch (error) {
      if (signal.aborted || !this.isActiveNavigation(navigation)) {
        return;
      }

      this.cache.delete(target.requestUrl);
      this.restoreStableView(navigation.previous);
      restoreScrollSnapshot(navigation.previous.scroll);

      this.transactions.rollback(navigation);

      this.setState({
        url: navigation.previous.url,
        status: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      });

      if (mode.type !== "popstate") {
        // If a direct client-side navigation failed and no cached payload was
        // available, fall back to a full page load so the user still reaches
        // the destination.
        window.location.href = target.href;
      }
    }
  }

  private beginNavigation(target: NormalizedNavigationTarget): NavigationTransaction {
    const controller = new AbortController();
    const previousScroll = captureScrollPosition();
    const previous = {
      url: this.stableUrl,
      route: this.currentRoute,
      metadata: this.stableMetadata,
      title: this.stableTitle,
      scroll: previousScroll,
    };

    this.transactions.begin({
      targetUrl: target.href,
      controller,
      previous,
    });
    saveScrollPosition();
    this.setState({ url: target.href, status: "loading" });

    return this.transactions.current()!;
  }

  private isActiveNavigation(navigation: NavigationTransaction): boolean {
    return this.transactions.isCurrent(navigation) && !navigation.controller.signal.aborted;
  }

  private restoreStableView(snapshot: StableViewState): void {
    this.currentRoute = snapshot.route;
    this.stableUrl = snapshot.url;
    this.stableMetadata = snapshot.metadata;
    this.stableTitle = snapshot.title;
    this.stableScroll = snapshot.scroll;
    syncDocumentHead(snapshot.metadata);
    if (typeof document !== "undefined") {
      document.title = snapshot.title;
    }
  }

  private getCurrentLocationPathname(): string {
    if (typeof window === "undefined" || typeof window.location === "undefined") {
      return "/";
    }

    return window.location.pathname || "/";
  }

  private getCurrentLocationUrl(): string {
    if (typeof window === "undefined" || typeof window.location === "undefined") {
      return "/";
    }

    const pathname = window.location.pathname || "/";
    const search = window.location.search || "";
    const hash = window.location.hash || "";
    return `${pathname}${search}${hash}`;
  }

  private normalizeNavigationTarget(url: string): NormalizedNavigationTarget | null {
    return normalizeClientNavigationUrl(url);
  }

  private resolveFinalUrl(payloadUrl: string, target: NormalizedNavigationTarget): string {
    const normalized = this.normalizeNavigationTarget(payloadUrl);
    if (!normalized) {
      return target.href;
    }

    return `${normalized.requestUrl}${target.hash || normalized.hash}`;
  }
}

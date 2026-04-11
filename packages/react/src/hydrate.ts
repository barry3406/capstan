// Client-side hydration entry point.
// Used by the dev server / production build to hydrate a server-rendered page
// in the browser.

import { createElement } from "react";
import type { ReactElement } from "react";
import { hydrateRoot, createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { PageContext } from "./loader.js";
import { OutletProvider } from "./layout.js";
import type { CapstanPageContext } from "./types.js";

// ---------------------------------------------------------------------------
// Hydration options
// ---------------------------------------------------------------------------

export type HydrationPriority = "full" | "visible" | "idle" | "interaction";

export interface HydrateOptions {
  /** Hydration strategy: full (immediate), visible (in viewport), idle (requestIdleCallback), interaction (first click/focus). */
  mode?: HydrationPriority;
  /** Called when a hydration mismatch is detected. */
  onHydrationError?: (error: Error, info: { componentStack: string }) => void;
  /** Called when a recoverable error occurs during hydration. */
  onRecoverableError?: (error: Error) => void;
  /** Enable hydration timing metrics on window.__CAPSTAN_HYDRATION_METRICS__. */
  enableMetrics?: boolean;
}

// ---------------------------------------------------------------------------
// Hydration metrics
// ---------------------------------------------------------------------------

export interface HydrationMetrics {
  /** Time from hydration start to completion in milliseconds. */
  hydrationTimeMs: number;
  /** Number of components that were hydrated. */
  componentCount: number;
  /** Whether hydration succeeded or fell back to client render. */
  mode: "hydrate" | "client-render-fallback";
  /** Mismatch errors captured during hydration. */
  mismatches: HydrationMismatch[];
}

export interface HydrationMismatch {
  /** Human-readable description of the mismatch. */
  message: string;
  /** Component stack where the mismatch occurred, if available. */
  componentStack?: string;
}

// ---------------------------------------------------------------------------
// Hydration island support
// ---------------------------------------------------------------------------

export interface HydrationIslandOptions {
  /** CSS selector or Element for the island root. */
  target: string | Element;
  /** React component to hydrate into the island. */
  component: React.ComponentType<Record<string, unknown>>;
  /** Props to pass to the component. */
  props?: Record<string, unknown>;
  /** Hydration priority for this island. */
  mode?: HydrationPriority;
}

// ---------------------------------------------------------------------------
// Internal: deferred hydration scheduler
// ---------------------------------------------------------------------------

function scheduleHydration(
  mode: HydrationPriority,
  element: Element,
  callback: () => void,
): () => void {
  if (mode === "full") {
    callback();
    return () => {};
  }

  if (mode === "visible") {
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          observer.disconnect();
          callback();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }

  if (mode === "idle") {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => callback());
      return () => cancelIdleCallback(id);
    }
    // Fallback: schedule after a short delay
    const timer = setTimeout(callback, 100);
    return () => clearTimeout(timer);
  }

  if (mode === "interaction") {
    const events = ["click", "focus", "touchstart", "pointerdown"] as const;
    let cleaned = false;
    const handler = () => {
      if (cleaned) return;
      cleaned = true;
      for (const evt of events) {
        element.removeEventListener(evt, handler);
      }
      callback();
    };
    for (const evt of events) {
      element.addEventListener(evt, handler, { once: true, passive: true });
    }
    return () => {
      cleaned = true;
      for (const evt of events) {
        element.removeEventListener(evt, handler);
      }
    };
  }

  // Unknown mode: hydrate immediately
  callback();
  return () => {};
}

// ---------------------------------------------------------------------------
// Internal: build the React tree for hydration
// ---------------------------------------------------------------------------

function buildHydrationTree(
  PageComponent: React.ComponentType,
  layouts: React.ComponentType[],
  data: CapstanPageContext,
): ReactElement {
  let content: ReactElement = createElement(PageComponent, {});

  // Wrap in layouts from innermost to outermost
  for (let i = layouts.length - 1; i >= 0; i--) {
    const Layout = layouts[i]!;
    content = createElement(OutletProvider, {
      outlet: content,
      children: createElement(Layout, {}),
    });
  }

  return createElement(
    PageContext.Provider,
    { value: data },
    content,
  );
}

// ---------------------------------------------------------------------------
// Main hydration entry point
// ---------------------------------------------------------------------------

export function hydrateCapstanPage(
  rootElement: Element,
  PageComponent: React.ComponentType,
  layouts: React.ComponentType[],
  data: CapstanPageContext,
  options?: HydrateOptions,
): void {
  // If hydration mode was "none", there is no serialised data on the page and
  // no client JS should have been loaded in the first place.  Guard against
  // accidental invocation so the page remains a static server render.
  if (
    typeof (globalThis as Record<string, unknown>)["window"] !== "undefined" &&
    (window as unknown as Record<string, unknown>)["__CAPSTAN_DATA__"] === undefined
  ) {
    return;
  }

  const mode = options?.mode ?? "full";
  const enableMetrics = options?.enableMetrics ?? false;

  scheduleHydration(mode, rootElement, () => {
    performHydration(rootElement, PageComponent, layouts, data, options, enableMetrics);
  });
}

function performHydration(
  rootElement: Element,
  PageComponent: React.ComponentType,
  layouts: React.ComponentType[],
  data: CapstanPageContext,
  options: HydrateOptions | undefined,
  enableMetrics: boolean,
): void {
  const startTime = performance.now();
  const mismatches: HydrationMismatch[] = [];
  let hydrateMode: "hydrate" | "client-render-fallback" = "hydrate";

  const tree = buildHydrationTree(PageComponent, layouts, data);

  const onRecoverableError = (error: unknown, errorInfo?: { componentStack?: string }) => {
    const err = error instanceof Error ? error : new Error(String(error));
    const stack = errorInfo?.componentStack ?? "";

    // Check if this is a hydration mismatch
    const msg = err.message || "";
    const isMismatch =
      msg.includes("Hydration") ||
      msg.includes("hydrat") ||
      msg.includes("did not match") ||
      msg.includes("server-rendered");

    if (isMismatch) {
      const mismatch: HydrationMismatch = { message: msg };
      if (stack) mismatch.componentStack = stack;
      mismatches.push(mismatch);
      options?.onHydrationError?.(err, { componentStack: stack });
    } else {
      options?.onRecoverableError?.(err);
    }
  };

  try {
    hydrateRoot(rootElement, tree, {
      onRecoverableError,
    });
  } catch (error) {
    // Hydration failed catastrophically -- fall back to client-side render
    hydrateMode = "client-render-fallback";
    const err = error instanceof Error ? error : new Error(String(error));
    mismatches.push({ message: `Hydration failed: ${err.message}` });
    options?.onHydrationError?.(err, { componentStack: "" });

    // Clear the root and do a fresh client render
    rootElement.innerHTML = "";
    const root: Root = createRoot(rootElement);
    root.render(tree);
  }

  if (enableMetrics) {
    const metrics: HydrationMetrics = {
      hydrationTimeMs: performance.now() - startTime,
      componentCount: rootElement.querySelectorAll("[data-reactroot], [data-capstan-layout], [data-capstan-outlet]").length + 1,
      mode: hydrateMode,
      mismatches,
    };
    (window as unknown as Record<string, unknown>).__CAPSTAN_HYDRATION_METRICS__ = metrics;
  }
}

// ---------------------------------------------------------------------------
// Hydration island: hydrate individual components independently
// ---------------------------------------------------------------------------

const islandCleanups = new Map<Element, () => void>();

/**
 * Hydrate a single component island independently. Useful for pages that
 * are mostly static with a few interactive widgets.
 *
 * Returns a cleanup function that disconnects any observers.
 */
export function hydrateIsland(options: HydrationIslandOptions): () => void {
  const target =
    typeof options.target === "string"
      ? document.querySelector(options.target)
      : options.target;

  if (!target) {
    return () => {};
  }

  // Clean up any previous island hydration on this element
  const existing = islandCleanups.get(target);
  if (existing) {
    existing();
    islandCleanups.delete(target);
  }

  const mode = options.mode ?? "visible";
  const cleanup = scheduleHydration(mode, target, () => {
    try {
      const element = createElement(options.component, options.props ?? {});
      hydrateRoot(target, element);
    } catch {
      // Hydration failed -- fall back to client render
      target.innerHTML = "";
      const root = createRoot(target);
      root.render(createElement(options.component, options.props ?? {}));
    }
    islandCleanups.delete(target);
  });

  islandCleanups.set(target, cleanup);
  return cleanup;
}

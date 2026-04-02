import type { PrefetchStrategy } from "./types.js";
import { getRouter } from "./router.js";

/**
 * PrefetchManager — watches links and prefetches their targets.
 *
 * Two strategies:
 * - **viewport**: IntersectionObserver with 200px root margin —
 *   prefetches when the link scrolls near the viewport.
 * - **hover**: Prefetches after 80ms of hovering over a link,
 *   cancelling if the mouse leaves sooner.
 */

const HOVER_DELAY_MS = 80;
const VIEWPORT_MARGIN = "200px";

export class PrefetchManager {
  private observer: IntersectionObserver | null = null;
  private hoverTimers = new Map<Element, ReturnType<typeof setTimeout>>();
  private prefetched = new Set<string>();

  constructor() {
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const href = this.getHref(entry.target);
            if (href) this.triggerPrefetch(href);
            this.observer!.unobserve(entry.target);
          }
        },
        { rootMargin: VIEWPORT_MARGIN },
      );
    }
  }

  /**
   * Register a link element for prefetching.
   */
  observe(element: Element, strategy: PrefetchStrategy): void {
    if (strategy === "none") return;

    if (strategy === "viewport" && this.observer) {
      this.observer.observe(element);
    }

    if (strategy === "hover") {
      const onEnter = (): void => {
        const href = this.getHref(element);
        if (!href) return;
        const timer = setTimeout(() => {
          this.triggerPrefetch(href);
          this.hoverTimers.delete(element);
        }, HOVER_DELAY_MS);
        this.hoverTimers.set(element, timer);
      };

      const onLeave = (): void => {
        const timer = this.hoverTimers.get(element);
        if (timer !== undefined) {
          clearTimeout(timer);
          this.hoverTimers.delete(element);
        }
      };

      element.addEventListener("pointerenter", onEnter);
      element.addEventListener("pointerleave", onLeave);
    }
  }

  /**
   * Unregister a link element.
   */
  unobserve(element: Element): void {
    this.observer?.unobserve(element);
    const timer = this.hoverTimers.get(element);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.hoverTimers.delete(element);
    }
  }

  /**
   * Tear down the manager.
   */
  destroy(): void {
    this.observer?.disconnect();
    for (const timer of this.hoverTimers.values()) {
      clearTimeout(timer);
    }
    this.hoverTimers.clear();
    this.prefetched.clear();
  }

  private triggerPrefetch(href: string): void {
    if (this.prefetched.has(href)) return;
    this.prefetched.add(href);
    const router = getRouter();
    if (router) {
      void router.prefetch(href);
    }
  }

  private getHref(element: Element): string | null {
    const href = element.getAttribute("href");
    if (!href) return null;
    // Only prefetch same-origin, non-hash links
    if (href.startsWith("http") || href.startsWith("//") || href.startsWith("#")) {
      return null;
    }
    return href;
  }
}

// Singleton
let _prefetchManager: PrefetchManager | null = null;

export function getPrefetchManager(): PrefetchManager {
  if (!_prefetchManager) {
    _prefetchManager = new PrefetchManager();
  }
  return _prefetchManager;
}

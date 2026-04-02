import { createElement, useRef, useEffect } from "react";
import type { ReactElement, AnchorHTMLAttributes } from "react";
import type { PrefetchStrategy } from "./types.js";
import { getRouter } from "./router.js";
import { getPrefetchManager } from "./prefetch.js";

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** URL to navigate to. */
  href: string;
  /** When to prefetch (default: "hover"). */
  prefetch?: PrefetchStrategy;
  /** Replace history entry instead of pushing. */
  replace?: boolean;
  /** Scroll to top after navigation (default: true). */
  scroll?: boolean;
}

/**
 * `<Link>` — client-side navigation link.
 *
 * Renders a standard `<a>` tag so the page works without JS.  When the
 * client router is active, clicks are intercepted and handled as SPA
 * navigations.  Links are automatically registered with the prefetch
 * manager based on the `prefetch` prop.
 */
export function Link({
  href,
  prefetch: prefetchStrategy = "hover",
  replace,
  scroll,
  onClick,
  children,
  ...rest
}: LinkProps): ReactElement {
  const ref = useRef<HTMLAnchorElement>(null);

  // Register with PrefetchManager on mount
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const manager = getPrefetchManager();
    manager.observe(el, prefetchStrategy);
    return () => manager.unobserve(el);
  }, [prefetchStrategy]);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>): void {
    // Run user's onClick first
    onClick?.(e);
    if (e.defaultPrevented) return;

    // Let the browser handle modified clicks (new tab, etc.)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }

    // Only intercept same-origin, non-hash links
    if (href.startsWith("http") || href.startsWith("//") || href.startsWith("#")) {
      return;
    }

    e.preventDefault();

    const router = getRouter();
    if (router) {
      const opts: Record<string, boolean> = {};
      if (replace !== undefined) opts["replace"] = replace;
      if (scroll !== undefined) opts["scroll"] = scroll;
      void router.navigate(href, opts);
    } else {
      // Fallback: full navigation
      window.location.href = href;
    }
  }

  return createElement(
    "a",
    { ...rest, href, ref, onClick: handleClick },
    children,
  );
}

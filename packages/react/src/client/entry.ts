import { getManifest } from "./manifest.js";
import { initRouter, getRouter } from "./router.js";

/**
 * Bootstrap the client-side router.
 *
 * Called once when the page loads.  Reads the route manifest from
 * `window.__CAPSTAN_MANIFEST__`, initialises the router singleton,
 * and sets up global `<a>` click delegation so that *all* internal
 * links benefit from SPA navigation — even those rendered outside
 * React (e.g. server-rendered HTML from morphdom).
 */
export function bootstrapClient(): void {
  const manifest = getManifest();
  if (!manifest) {
    // No manifest injected — running in a context without client routing
    // (e.g. statically rendered page or test environment).
    return;
  }

  const router = initRouter(manifest);

  // Global click delegation — intercept all <a> clicks that target
  // internal routes.  This catches links rendered by morphdom that
  // don't go through the React <Link> component.
  document.addEventListener("click", (e: MouseEvent) => {
    // Only handle left clicks without modifiers
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    if (e.defaultPrevented) return;

    // Walk up from the click target to find the nearest <a>
    const anchor = (e.target as Element).closest("a");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href) return;

    // Skip external, hash-only, and download links
    if (
      href.startsWith("http") ||
      href.startsWith("//") ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      anchor.hasAttribute("download") ||
      anchor.getAttribute("target") === "_blank"
    ) {
      return;
    }

    // Skip links with data-capstan-external attribute (opt-out)
    if (anchor.hasAttribute("data-capstan-external")) return;

    e.preventDefault();
    void router.navigate(href, {
      replace: anchor.hasAttribute("data-capstan-replace"),
    });
  });
}

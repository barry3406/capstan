// Client-side router — public API
export { Link } from "./link.js";
export type { LinkProps } from "./link.js";
export { NavigationProvider, useRouterState, useNavigate } from "./navigation-provider.js";
export { bootstrapClient } from "./entry.js";
export { getRouter, initRouter, CapstanRouter } from "./router.js";
export { NavigationCache } from "./cache.js";
export { getManifest, matchRoute, findSharedLayout } from "./manifest.js";
export type { ClientRouteManifest } from "./manifest.js";
export { getPrefetchManager, PrefetchManager } from "./prefetch.js";
export {
  generateScrollKey,
  setCurrentScrollKey,
  saveScrollPosition,
  restoreScrollPosition,
  scrollToTop,
} from "./scroll.js";
export { withViewTransition } from "./transition.js";

// Re-export types used by consumers
export type {
  NavigationPayload,
  NavigateOptions,
  RouterState,
  RouterStatus,
  PrefetchStrategy,
  ClientRouteEntry,
  NavigateEventDetail,
} from "./types.js";

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
  normalizeClientNavigationUrl,
} from "./navigation-url.js";
export type { NormalizedNavigationUrl } from "./navigation-url.js";
export {
  buildHistoryState,
  readHistoryEntryState,
  writeHistoryState,
} from "./history.js";
export type { HistoryStateRecord } from "./history.js";
export {
  captureScrollPosition,
  generateScrollKey,
  setCurrentScrollKey,
  saveScrollPosition,
  restoreScrollPosition,
  restoreScrollSnapshot,
  scrollToTop,
} from "./scroll.js";
export type { ScrollSnapshot } from "./scroll.js";
export { NavigationTransactionStack } from "./transaction.js";
export type { NavigationTransaction, StableViewState } from "./transaction.js";
export { withViewTransition } from "./transition.js";
export { createHmrRuntime, buildHmrClientScript } from "./hmr-runtime.js";

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

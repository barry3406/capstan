/**
 * Shared href guards for client-side navigation and prefetching.
 */

import { normalizeClientNavigationUrl } from "./navigation-url.js";

export function isClientNavigableHref(href: string): boolean {
  return normalizeClientNavigationUrl(href) !== null;
}

export function isPrefetchableHref(href: string): boolean {
  if (href === "") return false;
  return normalizeClientNavigationUrl(href) !== null;
}

/**
 * Shared href guards for client-side navigation and prefetching.
 */

const SAFE_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

export function isClientNavigableHref(href: string): boolean {
  if (href === "") return true;
  if (href.startsWith("#") || href.startsWith("//")) return false;
  if (href.startsWith("http://") || href.startsWith("https://")) return false;
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return false;
  if (SAFE_SCHEME_RE.test(href)) return false;
  return true;
}

export function isPrefetchableHref(href: string): boolean {
  if (href === "") return false;
  return isClientNavigableHref(href);
}

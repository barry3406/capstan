/**
 * Shared same-origin URL normalization for client navigation.
 *
 * The router, link interception, and prefetch manager all need the same
 * rules:
 * - accept relative URLs and same-origin absolute URLs
 * - reject cross-origin URLs and unsafe schemes
 * - preserve `hash` for history updates but drop it for fetch requests
 */

const UNSAFE_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

export interface NormalizedNavigationUrl {
  /** Canonical URL used for history updates. */
  href: string;
  /** Canonical URL used for navigation fetches. */
  requestUrl: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
}

function getBaseUrl(): URL {
  if (typeof window === "undefined" || typeof window.location === "undefined") {
    return new URL("http://localhost/");
  }

  const location = window.location as Partial<Location> & {
    href?: string;
    origin?: string;
    pathname?: string;
    search?: string;
    hash?: string;
  };

  if (typeof location.href === "string" && /^https?:\/\//i.test(location.href)) {
    return new URL(location.href);
  }

  const pathname = typeof location.pathname === "string" ? location.pathname : "/";
  const search = typeof location.search === "string" ? location.search : "";
  const hash = typeof location.hash === "string" ? location.hash : "";

  if (typeof location.origin === "string" && location.origin) {
    return new URL(`${location.origin}${pathname}${search}${hash}`);
  }

  return new URL(`${pathname}${search}${hash}`, "http://localhost");
}

function isUnsafeHref(href: string): boolean {
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return false;
  }

  return (
    href.startsWith("#") ||
    href.startsWith("//") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:") ||
    UNSAFE_SCHEME_RE.test(href)
  );
}

export function normalizeClientNavigationUrl(href: string): NormalizedNavigationUrl | null {
  if (href === "") {
    const base = getBaseUrl();
    return {
      href: `${base.pathname}${base.search}${base.hash}`,
      requestUrl: `${base.pathname}${base.search}`,
      pathname: base.pathname,
      search: base.search,
      hash: base.hash,
      origin: base.origin,
    };
  }

  if (isUnsafeHref(href)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(href, getBaseUrl());
  } catch {
    return null;
  }

  const base = getBaseUrl();
  if (url.origin !== base.origin) {
    return null;
  }

  return {
    href: `${url.pathname}${url.search}${url.hash}`,
    requestUrl: `${url.pathname}${url.search}`,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: url.origin,
  };
}

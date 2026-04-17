import type { CapstanPageContext } from "../types.js";

/**
 * Client-side router type definitions.
 *
 * These types are shared across the router, cache, prefetch manager,
 * and React integration layer.
 */

// ---------------------------------------------------------------------------
// Navigation payload — JSON returned by the server for client-side navigations
// ---------------------------------------------------------------------------

/**
 * Metadata carried by client navigations.
 *
 * This mirrors the page metadata shape used by the server-side metadata
 * utilities, but keeps the client bundle self-contained.
 */
export interface ClientMetadata {
  title?: string | { default: string; template?: string };
  description?: string;
  keywords?: string[];
  robots?: string | { index?: boolean; follow?: boolean };
  openGraph?: {
    title?: string;
    description?: string;
    type?: string;
    url?: string;
    image?: string;
    siteName?: string;
  };
  twitter?: {
    card?: "summary" | "summary_large_image";
    title?: string;
    description?: string;
    image?: string;
  };
  icons?: { icon?: string; apple?: string };
  canonical?: string;
  alternates?: Record<string, string>;
}

/**
 * Payload returned when the server receives a request with the
 * `X-Capstan-Nav: 1` header.  Contains everything the client needs
 * to update the page without a full reload.
 */
export interface NavigationPayload {
  /** Target URL. */
  url: string;
  /** Deepest shared layout key (e.g. "/posts/_layout"). */
  layoutKey: string;
  /** Pre-rendered HTML for server components (absent for client components). */
  html?: string;
  /** Loader data for the target page. */
  loaderData: unknown;
  /** Auth snapshot for the target page. */
  auth?: CapstanPageContext["auth"];
  /** Page metadata (title, description, links, etc.). */
  metadata?: ClientMetadata;
  /** Whether the page is a server or client component. */
  componentType: "server" | "client";
}

// ---------------------------------------------------------------------------
// Navigation options
// ---------------------------------------------------------------------------

export interface NavigateOptions {
  /** Replace the current history entry instead of pushing. */
  replace?: boolean;
  /** State to associate with the history entry. */
  state?: unknown;
  /** Scroll to top after navigation (default: true). */
  scroll?: boolean;
  /** Skip the navigation cache for this request. */
  noCache?: boolean;
}

// ---------------------------------------------------------------------------
// Router state
// ---------------------------------------------------------------------------

export type RouterStatus = "idle" | "loading" | "error";

export interface RouterState {
  /** Current URL path. */
  url: string;
  /** Current navigation status. */
  status: RouterStatus;
  /** Error from the last navigation, if any. */
  error?: Error;
}

// ---------------------------------------------------------------------------
// Prefetch strategy
// ---------------------------------------------------------------------------

/** When to prefetch a link's target. */
export type PrefetchStrategy = "none" | "hover" | "viewport";

// ---------------------------------------------------------------------------
// Route manifest entry (client-side subset of RouteEntry)
// ---------------------------------------------------------------------------

export interface ClientRouteEntry {
  /** URL pattern with :param placeholders. */
  urlPattern: string;
  /** Server or client component. */
  componentType: "server" | "client";
  /** Whether this route requires browser hydration (client page or client layout). */
  needsHydration: boolean;
  /** Layout chain (paths relative to routes root). */
  layouts: string[];
}

// ---------------------------------------------------------------------------
// Custom event detail dispatched on `capstan:navigate`
// ---------------------------------------------------------------------------

export interface NavigateEventDetail {
  url: string;
  loaderData: unknown;
  params: Record<string, string>;
  auth?: CapstanPageContext["auth"];
  metadata?: ClientMetadata;
}

import { createElement } from "react";
import type { ReactNode, ReactElement } from "react";

/**
 * ServerOnly — renders children during SSR, renders empty on client.
 * Reduces client bundle by excluding server-only UI from hydration.
 */
export function ServerOnly({ children }: { children?: ReactNode }): ReactElement {
  if (typeof window === "undefined") {
    return createElement("capstan-server", { "data-ssr": "" }, children);
  }
  return createElement("capstan-server", { "data-ssr": "" });
}

/**
 * ClientOnly — renders children only in browser, shows fallback during SSR.
 */
export function ClientOnly({ children, fallback }: { children?: ReactNode; fallback?: ReactNode }): ReactElement {
  if (typeof window === "undefined") {
    return createElement("capstan-client", null, fallback ?? null);
  }
  return createElement("capstan-client", null, children);
}

/**
 * Guard: throws if imported in a client (browser) module.
 */
export function serverOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error("This module is server-only and cannot be imported in client code.");
  }
}

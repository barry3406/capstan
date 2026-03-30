import { createElement, Fragment } from "react";
import type { ReactNode, ReactElement } from "react";

/**
 * Semantic marker for server-only content.
 *
 * Currently renders its children as-is via a Fragment.  In the future, RSC
 * bundler integration will strip `ServerOnly` children from the client bundle
 * so they are never shipped to the browser.
 */
export function ServerOnly({ children }: { children: ReactNode }): ReactElement {
  return createElement(Fragment, null, children);
}

// Client-side hydration entry point.
// Used by the dev server / production build to hydrate a server-rendered page
// in the browser.

import { createElement } from "react";
import type { ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { PageContext } from "./loader.js";
import { OutletProvider } from "./layout.js";
import type { CapstanPageContext } from "./types.js";

export function hydrateCapstanPage(
  rootElement: Element,
  PageComponent: React.ComponentType,
  layouts: React.ComponentType[],
  data: CapstanPageContext,
): void {
  // Build the component tree identically to SSR so React can hydrate cleanly
  let content: ReactElement = createElement(PageComponent, {});

  // Wrap in layouts from innermost to outermost
  for (let i = layouts.length - 1; i >= 0; i--) {
    const Layout = layouts[i]!;
    content = createElement(OutletProvider, {
      outlet: content,
      children: createElement(Layout, {}),
    });
  }

  const tree = createElement(
    PageContext.Provider,
    { value: data },
    content,
  );

  hydrateRoot(rootElement, tree);
}

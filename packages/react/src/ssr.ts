import { renderToString } from "react-dom/server";
import { createElement } from "react";
import type { ReactElement } from "react";
import { PageContext } from "./loader.js";
import { OutletProvider } from "./layout.js";
import type { RenderPageOptions, RenderResult } from "./types.js";

/**
 * Escapes a string for safe embedding inside a <script> tag.
 * Prevents XSS via </script> injection or HTML comment breakout.
 */
function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export async function renderPage(
  options: RenderPageOptions,
): Promise<RenderResult> {
  const { pageModule, layouts, loaderArgs, params } = options;

  // 1. Run loader if present
  let loaderData: unknown = null;
  if (pageModule.loader) {
    loaderData = await pageModule.loader(loaderArgs);
  }

  // 2. Create the page context value
  const contextValue = {
    loaderData,
    params,
    auth: loaderArgs.ctx.auth,
  };

  // 3. Render page component
  let content: ReactElement = createElement(pageModule.default, {});

  // 4. Wrap in layouts from innermost to outermost
  for (let i = layouts.length - 1; i >= 0; i--) {
    const layout = layouts[i]!;
    content = createElement(OutletProvider, {
      outlet: content,
      children: createElement(layout.default, {}),
    });
  }

  // 5. Wrap in PageContext provider
  const tree = createElement(
    PageContext.Provider,
    { value: contextValue },
    content,
  );

  // 6. Render to HTML string
  const html = renderToString(tree);

  // 7. Build serialised data payload, escaped for safe script embedding
  const serializedData = escapeJsonForScript(
    JSON.stringify({ loaderData, params, auth: contextValue.auth }),
  );

  // 8. Create full HTML document with embedded loader data for hydration
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <div id="capstan-root">${html}</div>
  <script>window.__CAPSTAN_DATA__ = ${serializedData}</script>
  <script type="module" src="/_capstan/client.js"></script>
</body>
</html>`;

  return {
    html: fullHtml,
    loaderData,
    statusCode: 200,
  };
}

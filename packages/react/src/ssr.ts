import { renderToReadableStream } from "react-dom/server";
import { createElement } from "react";
import type { ReactElement } from "react";
import { PageContext } from "./loader.js";
import { OutletProvider } from "./layout.js";
import type {
  HydrationMode,
  RenderPageOptions,
  RenderResult,
  RenderStreamResult,
} from "./types.js";

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

/**
 * Minimal document shell used when no layout provides the full <html> wrapper.
 * Rendered via createElement so JSX transform is not required.
 */
function DocumentShell(props: { children?: ReactElement }) {
  return createElement(
    "html",
    { lang: "en" },
    createElement(
      "head",
      null,
      createElement("meta", { charSet: "utf-8" }),
      createElement("meta", {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      }),
    ),
    createElement(
      "body",
      null,
      createElement("div", { id: "capstan-root" }, props.children),
    ),
  );
}

/**
 * Streaming SSR entry point.
 *
 * Returns a ReadableStream produced by React 18's `renderToReadableStream`,
 * which flushes the shell immediately and streams Suspense fallbacks as they
 * resolve. Use this in the dev server / production handler to pipe directly
 * into the HTTP response for optimal TTFB.
 */
export async function renderPageStream(
  options: RenderPageOptions,
): Promise<RenderStreamResult> {
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

  // 6. When no layout provides a full document, wrap in a minimal shell so
  //    React can generate the proper DOCTYPE and <html> structure.
  const finalTree =
    layouts.length > 0 ? tree : createElement(DocumentShell, null, tree);

  // 7. Resolve effective hydration mode.  The explicit option takes
  //    precedence; otherwise fall back to the page module's export, then
  //    the default "full" mode.
  const hydrationMode: HydrationMode =
    options.hydration ?? pageModule.hydration ?? "full";

  // 8. Build serialised data payload, escaped for safe script embedding
  const serializedData = escapeJsonForScript(
    JSON.stringify({ loaderData, params, auth: contextValue.auth }),
  );

  // 9. Build renderToReadableStream options based on hydration mode.
  //    - "full"   : inject data + load client module immediately (default)
  //    - "visible": inject data + lazy-load client when root scrolls into view
  //    - "none"   : pure server render, zero client JS
  const streamOptions: Parameters<typeof renderToReadableStream>[1] =
    hydrationMode === "none"
      ? {}
      : hydrationMode === "visible"
        ? {
            bootstrapScriptContent: [
              `window.__CAPSTAN_DATA__ = ${serializedData}`,
              `(function(){`,
              `var o=new IntersectionObserver(function(e){`,
              `if(e[0].isIntersecting){o.disconnect();import('/_capstan/client.js');}`,
              `});`,
              `o.observe(document.getElementById('capstan-root'));`,
              `})();`,
            ].join(""),
          }
        : {
            // "full" — original behaviour
            bootstrapScriptContent: `window.__CAPSTAN_DATA__ = ${serializedData}`,
            bootstrapModules: ["/_capstan/client.js"],
          };

  // 10. Render to a ReadableStream with hydration bootstrap
  const stream = await renderToReadableStream(finalTree, streamOptions);

  // `allReady` resolves once the entire document (including all Suspense
  // boundaries) has been emitted.  Callers serving bots/crawlers can await
  // it before piping the stream to guarantee a complete response.
  const allReady = (stream as unknown as { allReady: Promise<void> }).allReady;

  return { stream, allReady, loaderData, statusCode: 200 };
}

/**
 * String-based SSR entry point (backward compatible).
 *
 * Internally delegates to `renderPageStream()` and collects the full stream
 * into a string. Prefer `renderPageStream()` in new code for better TTFB.
 */
export async function renderPage(
  options: RenderPageOptions,
): Promise<RenderResult> {
  const { stream, loaderData, statusCode } = await renderPageStream(options);

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  // Flush any remaining bytes
  html += decoder.decode();

  return { html, loaderData, statusCode };
}

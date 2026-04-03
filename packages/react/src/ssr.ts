import { renderToReadableStream } from "react-dom/server";
import { createElement, Suspense } from "react";
import type { ReactElement } from "react";
import { PageContext } from "./loader.js";
import { OutletProvider } from "./layout.js";
import { ErrorBoundary } from "./error-boundary.js";
import { generateMetadataElements } from "./metadata.js";
import type {
  HydrationMode,
  RenderPageOptions,
  RenderResult,
  RenderStreamResult,
} from "./types.js";

/**
 * React 18's `renderToReadableStream` returns a `ReadableStream` with an
 * additional `allReady` promise that resolves once ALL content (including
 * Suspense boundaries) has been emitted. The DOM typings don't include it
 * because it's React-specific, so we extend the type here.
 */
interface ReactDOMStream extends ReadableStream<Uint8Array> {
  allReady: Promise<void>;
}

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
      createElement("link", {
        rel: "stylesheet",
        href: "/styles.css",
        precedence: "default",
      }),
    ),
    createElement(
      "body",
      null,
      createElement("div", { id: "capstan-root" }, props.children),
    ),
  );
}

function wrapWithLayouts(
  content: ReactElement,
  options: RenderPageOptions,
): ReactElement {
  const { layouts } = options;
  let wrappedContent = content;

  for (let i = layouts.length - 1; i >= 0; i--) {
    const layout = layouts[i]!;
    const layoutKey = options.layoutKeys?.[i];

    const outlet = layoutKey
      ? createElement("div", { "data-capstan-outlet": layoutKey }, wrappedContent)
      : wrappedContent;

    const wrapped = createElement(OutletProvider, {
      outlet,
      children: createElement(layout.default, {}),
    });

    wrappedContent = layoutKey
      ? createElement("div", { "data-capstan-layout": layoutKey }, wrapped)
      : wrapped;
  }

  return wrappedContent;
}

function buildPageTree(
  options: RenderPageOptions,
  loaderData: unknown,
  content: ReactElement,
  includeDocumentShell: boolean,
  includeMetadata: boolean,
): ReactElement {
  const contextValue = {
    loaderData,
    params: options.params,
    auth: options.loaderArgs.ctx.auth,
  };

  const wrappedContent = wrapWithLayouts(content, options);
  const pageMetadata = (options.pageModule as RenderPageOptions["pageModule"] & {
    metadata?: unknown;
  }).metadata;
  const metadataElements =
    includeMetadata && pageMetadata && typeof pageMetadata === "object"
      ? generateMetadataElements(
          pageMetadata as Parameters<typeof generateMetadataElements>[0],
        )
      : [];
  const tree = createElement(
    PageContext.Provider,
    { value: contextValue },
    ...metadataElements,
    wrappedContent,
  );

  if (includeDocumentShell && options.layouts.length === 0) {
    return createElement(DocumentShell, null, tree);
  }

  return tree;
}

function buildPageContent(options: RenderPageOptions): ReactElement {
  let content: ReactElement = createElement(options.pageModule.default, {});

  if (options.loadingComponent) {
    content = createElement(
      Suspense,
      { fallback: createElement(options.loadingComponent) },
      content,
    );
  }

  if (options.errorComponent) {
    content = createElement(
      ErrorBoundary,
      {
        fallback: (error: Error, reset: () => void) =>
          createElement(options.errorComponent!, { error, reset }),
      },
      content,
    );
  }

  return content;
}

function buildErrorFallbackContent(
  options: RenderPageOptions,
  error: Error,
): ReactElement {
  if (!options.errorComponent) {
    throw error;
  }

  return createElement(options.errorComponent, {
    error,
    reset: () => {},
  });
}

async function collectRenderedStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }

  html += decoder.decode();
  return html;
}

function buildStreamOptions(
  options: RenderPageOptions,
  loaderData: unknown,
): Parameters<typeof renderToReadableStream>[1] {
  const componentType = options.componentType ?? options.pageModule.componentType;
  const hydrationMode: HydrationMode =
    options.hydration ?? options.pageModule.hydration ?? "full";
  const serializedData = escapeJsonForScript(
    JSON.stringify({
      loaderData,
      params: options.params,
      auth: options.loaderArgs.ctx.auth,
    }),
  );

  return componentType === "server"
    ? {}
    : hydrationMode === "none"
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
            bootstrapScriptContent: `window.__CAPSTAN_DATA__ = ${serializedData}`,
            bootstrapModules: ["/_capstan/client.js"],
          };
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

  const content = buildPageContent(options);
  const finalTree = buildPageTree(
    options,
    loaderData,
    content,
    layouts.length === 0,
    true,
  );
  const streamOptions = buildStreamOptions(options, loaderData);
  const stream = await renderToReadableStream(finalTree, streamOptions) as ReactDOMStream;

  return { stream, allReady: stream.allReady, loaderData, statusCode: 200 };
}

/**
 * Render a page and its inner layouts WITHOUT the document shell.
 * Used by the dev server to produce navigation payloads for
 * client-side SPA navigation (X-Capstan-Nav: 1 requests).
 *
 * Returns plain HTML suitable for morphdom-ing into the page outlet.
 */
export async function renderPartialStream(
  options: RenderPageOptions,
): Promise<{ html: string; loaderData: unknown; statusCode: number }> {
  const { pageModule, layouts, loaderArgs, params } = options;

  // Run loader
  let loaderData: unknown = null;
  if (pageModule.loader) {
    loaderData = await pageModule.loader(loaderArgs);
  }

  let renderError: Error | null = null;
  const tree = buildPageTree(
    options,
    loaderData,
    buildPageContent(options),
    false,
    false,
  );
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await renderToReadableStream(tree, {
      onError(error) {
        if (renderError === null) {
          renderError = error instanceof Error ? error : new Error(String(error));
        }
      },
    });
  } catch (error) {
    renderError = error instanceof Error ? error : new Error(String(error));
    if (!options.errorComponent) {
      throw renderError;
    }

    const fallbackTree = buildPageTree(
      options,
      loaderData,
      buildErrorFallbackContent(options, renderError),
      false,
      false,
    );
    return {
      html: await collectRenderedStream(
        await renderToReadableStream(fallbackTree),
      ),
      loaderData,
      statusCode: 200,
    };
  }
  let html = await collectRenderedStream(stream);

  if (renderError && options.errorComponent) {
    const fallbackTree = buildPageTree(
      options,
      loaderData,
      buildErrorFallbackContent(options, renderError),
      false,
      false,
    );
    html = await collectRenderedStream(
      await renderToReadableStream(fallbackTree),
    );
  }

  return { html, loaderData, statusCode: 200 };
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
  const { pageModule, loaderArgs } = options;
  let loaderData: unknown = null;
  if (pageModule.loader) {
    loaderData = await pageModule.loader(loaderArgs);
  }

  let renderError: Error | null = null;
  const tree = buildPageTree(
    options,
    loaderData,
    buildPageContent(options),
    options.layouts.length === 0,
    true,
  );
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await renderToReadableStream(tree, {
      ...buildStreamOptions(options, loaderData),
      onError(error) {
        if (renderError === null) {
          renderError = error instanceof Error ? error : new Error(String(error));
        }
      },
    });
  } catch (error) {
    renderError = error instanceof Error ? error : new Error(String(error));
    if (!options.errorComponent) {
      throw renderError;
    }

    const fallbackTree = buildPageTree(
      options,
      loaderData,
      buildErrorFallbackContent(options, renderError),
      options.layouts.length === 0,
      true,
    );
    return {
      html: await collectRenderedStream(
        await renderToReadableStream(
          fallbackTree,
          buildStreamOptions(options, loaderData),
        ),
      ),
      loaderData,
      statusCode: 200,
    };
  }

  let html = await collectRenderedStream(stream);

  if (renderError && options.errorComponent) {
    const fallbackTree = buildPageTree(
      options,
      loaderData,
      buildErrorFallbackContent(options, renderError),
      options.layouts.length === 0,
      true,
    );
    html = await collectRenderedStream(
      await renderToReadableStream(
        fallbackTree,
        buildStreamOptions(options, loaderData),
      ),
    );
  }

  return { html, loaderData, statusCode: 200 };
}

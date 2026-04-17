import { renderToReadableStream } from "react-dom/server";
import { createElement, Suspense } from "react";
import type { ReactElement } from "react";
import { PageContext } from "./loader.js";
import { OutletProvider } from "./layout.js";
import { ErrorBoundary } from "./error-boundary.js";
import { generateMetadataElements } from "./metadata.js";
import { ActionContext } from "./action.js";
import type { ActionContextValue } from "./action.js";
import type {
  HydrationMode,
  RenderPageOptions,
  RenderResult,
  RenderStreamResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// SSR options -- configurable timeout, abort signal, streaming callbacks
// ---------------------------------------------------------------------------

export interface SSROptions {
  /** Abort SSR after N ms and serve whatever shell has been emitted. */
  timeout?: number;
  /** Called when an error occurs during rendering. */
  onError?: (error: Error) => void;
  /** Called when the outer shell is ready (React streaming lifecycle). */
  onShellReady?: () => void;
  /** Called when all Suspense boundaries have resolved. */
  onAllReady?: () => void;
  /** External abort signal -- the caller can cancel SSR from the outside. */
  signal?: AbortSignal;
  /** Scripts to inject via bootstrapScripts (appended after the default client entry). */
  bootstrapScripts?: string[];
  /** Enable progressive hydration: flush shell immediately, stream Suspense boundaries. */
  progressiveHydration?: boolean;
}

// ---------------------------------------------------------------------------
// SSR performance metrics
// ---------------------------------------------------------------------------

export interface SSRMetrics {
  /** Total wall-clock render time in milliseconds. */
  renderTimeMs: number;
  /** Number of chunks emitted by the stream. */
  chunkCount: number;
  /** Time-to-first-byte in milliseconds (first chunk emitted). */
  firstByteMs: number;
  /** Whether the render was aborted by timeout or signal. */
  aborted: boolean;
  /** Error captured during rendering, if any. */
  error?: Error | undefined;
}

// ---------------------------------------------------------------------------
// Extended stream result with metrics
// ---------------------------------------------------------------------------

export interface RenderStreamResultWithMetrics extends RenderStreamResult {
  metrics: Promise<SSRMetrics>;
}

// ---------------------------------------------------------------------------
// SSR error serialization -- encode errors so the client can rehydrate them
// ---------------------------------------------------------------------------

export interface SerializedSSRError {
  message: string;
  stack?: string;
  componentStack?: string;
  digest?: string;
}

/**
 * Serialize an SSR error into a JSON-safe object suitable for embedding in the
 * HTML document so the client-side error boundary can pick it up.
 */
export function serializeSSRError(
  error: Error,
  componentStack?: string,
): SerializedSSRError {
  const serialized: SerializedSSRError = {
    message: error.message,
  };

  if (error.stack) {
    serialized.stack = error.stack;
  }
  if (componentStack) {
    serialized.componentStack = componentStack;
  }
  if ("digest" in error && typeof (error as Record<string, unknown>).digest === "string") {
    serialized.digest = (error as Record<string, unknown>).digest as string;
  }

  return serialized;
}

/**
 * Deserialize an SSR error on the client side into an Error instance.
 */
export function deserializeSSRError(data: SerializedSSRError): Error {
  const error = new Error(data.message);
  if (data.stack) {
    error.stack = data.stack;
  }
  return error;
}

/**
 * Build an inline script tag that serializes SSR errors for client
 * rehydration error boundaries to pick up.
 */
function buildSSRErrorScript(errors: SerializedSSRError[]): string {
  if (errors.length === 0) return "";
  const json = escapeJsonForScript(JSON.stringify(errors));
  return `<script>window.__CAPSTAN_SSR_ERRORS__=${json}</script>`;
}

/**
 * React's renderToReadableStream returns a ReadableStream with an
 * additional allReady promise that resolves once ALL content (including
 * Suspense boundaries) has been emitted. The DOM typings don't include it
 * because it's React-specific, so we extend the type here.
 */
interface ReactDOMStream extends ReadableStream<Uint8Array> {
  allReady: Promise<void>;
}

/** Default SSR timeout in milliseconds (10 seconds). */
const DEFAULT_SSR_TIMEOUT_MS = 10_000;

/**
 * Escapes a string for safe embedding inside a script tag.
 * Prevents XSS via script injection or HTML comment breakout.
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
 * Minimal document shell used when no layout provides the full html wrapper.
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
  let tree: ReactElement = createElement(
    PageContext.Provider,
    { value: contextValue },
    ...metadataElements,
    wrappedContent,
  );

  // Wrap with ActionContext.Provider when action data is available (form POST re-render)
  if (options.actionResult !== undefined || options.actionFormData !== undefined) {
    const actionCtxValue: ActionContextValue = {};
    if (options.actionResult !== undefined) actionCtxValue.result = options.actionResult;
    if (options.actionFormData !== undefined) actionCtxValue.formData = options.actionFormData;
    tree = createElement(ActionContext.Provider, { value: actionCtxValue }, tree);
  }

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
  ssrOptions?: SSROptions,
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

  const baseOptions = componentType === "server"
    ? {}
    : hydrationMode === "none"
      ? {}
      : hydrationMode === "visible"
        ? {
            bootstrapScriptContent: [
              `window.__CAPSTAN_DATA__ = ${serializedData}`,
              `(function(){`,
              `var t=document.getElementById('capstan-root')||document.querySelector('[data-capstan-layout],[data-capstan-outlet]')||document.body;`,
              `var o=new IntersectionObserver(function(e){`,
              `if(e[0].isIntersecting){o.disconnect();import('/_capstan/client.js');}`,
              `});`,
              `if(t)o.observe(t);`,
              `})();`,
            ].join(""),
          }
        : {
            bootstrapScriptContent: `window.__CAPSTAN_DATA__ = ${serializedData}`,
            bootstrapModules: ["/_capstan/client.js"],
          };

  // Merge additional bootstrapScripts from SSROptions
  if (ssrOptions?.bootstrapScripts && ssrOptions.bootstrapScripts.length > 0) {
    const existing = (baseOptions as Record<string, unknown>).bootstrapModules as string[] | undefined;
    (baseOptions as Record<string, unknown>).bootstrapModules = [
      ...(existing ?? []),
      ...ssrOptions.bootstrapScripts,
    ];
  }

  return baseOptions;
}

// ---------------------------------------------------------------------------
// Combined abort signal helper: merges timeout + external signal
// ---------------------------------------------------------------------------

function createCombinedAbortController(
  ssrOptions?: SSROptions,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  // Timeout-based abort
  const timeoutMs = ssrOptions?.timeout;
  if (timeoutMs !== undefined && timeoutMs > 0) {
    const timer = setTimeout(() => controller.abort(new Error("SSR timeout")), timeoutMs);
    cleanups.push(() => clearTimeout(timer));
  }

  // External signal passthrough
  if (ssrOptions?.signal) {
    const externalSignal = ssrOptions.signal;
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      const onAbort = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => externalSignal.removeEventListener("abort", onAbort));
    }
  }

  return {
    controller,
    cleanup() {
      for (const fn of cleanups) fn();
    },
  };
}

// ---------------------------------------------------------------------------
// Stream instrumentation: wraps a ReadableStream to collect metrics
// ---------------------------------------------------------------------------

function instrumentStream(
  stream: ReadableStream<Uint8Array>,
  startTime: number,
  ssrOptions?: SSROptions,
  abortController?: AbortController,
): { instrumented: ReadableStream<Uint8Array>; metrics: Promise<SSRMetrics> } {
  let chunkCount = 0;
  let firstByteMs = -1;
  let capturedError: Error | undefined;

  const metricsDeferred: {
    resolve: (m: SSRMetrics) => void;
    reject: (e: Error) => void;
    promise: Promise<SSRMetrics>;
  } = {} as typeof metricsDeferred;
  metricsDeferred.promise = new Promise<SSRMetrics>((resolve, reject) => {
    metricsDeferred.resolve = resolve;
    metricsDeferred.reject = reject;
  });

  const reader = stream.getReader();
  const instrumented = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          metricsDeferred.resolve({
            renderTimeMs: performance.now() - startTime,
            chunkCount,
            firstByteMs: firstByteMs >= 0 ? firstByteMs : performance.now() - startTime,
            aborted: Boolean(abortController?.signal.aborted),
            error: capturedError,
          });
          return;
        }

        chunkCount++;
        if (firstByteMs < 0) {
          firstByteMs = performance.now() - startTime;
          ssrOptions?.onShellReady?.();
        }

        controller.enqueue(value);
      } catch (err) {
        capturedError = err instanceof Error ? err : new Error(String(err));
        ssrOptions?.onError?.(capturedError);
        controller.error(capturedError);
        metricsDeferred.resolve({
          renderTimeMs: performance.now() - startTime,
          chunkCount,
          firstByteMs: firstByteMs >= 0 ? firstByteMs : performance.now() - startTime,
          aborted: Boolean(abortController?.signal.aborted),
          error: capturedError,
        });
      }
    },
    cancel(reason) {
      reader.cancel(reason);
      metricsDeferred.resolve({
        renderTimeMs: performance.now() - startTime,
        chunkCount,
        firstByteMs: firstByteMs >= 0 ? firstByteMs : performance.now() - startTime,
        aborted: true,
        error: capturedError,
      });
    },
  });

  return { instrumented, metrics: metricsDeferred.promise };
}

// ---------------------------------------------------------------------------
// Shell-first rendering helper
// ---------------------------------------------------------------------------

/**
 * Render the page as a shell-first stream: the outer HTML shell is flushed
 * immediately (before Suspense boundaries resolve), and inner content streams
 * in progressively. If ssrOptions.timeout is set, the stream is aborted
 * after the deadline and whatever has been emitted is served.
 */
export async function renderShellFirstStream(
  options: RenderPageOptions,
  ssrOptions?: SSROptions,
): Promise<RenderStreamResultWithMetrics> {
  const startTime = performance.now();
  const { pageModule, loaderArgs } = options;
  const { controller: abortCtl, cleanup } = createCombinedAbortController(ssrOptions);
  const ssrErrors: SerializedSSRError[] = [];

  // 1. Run loader
  let loaderData: unknown = null;
  if (pageModule.loader) {
    loaderData = await pageModule.loader(loaderArgs);
  }

  // 2. Build tree -- wrap in Suspense for progressive rendering
  let content: ReactElement = buildPageContent(options);
  if (ssrOptions?.progressiveHydration && options.loadingComponent) {
    content = createElement(
      Suspense,
      { fallback: createElement(options.loadingComponent) },
      content,
    );
  }

  const finalTree = buildPageTree(
    options,
    loaderData,
    content,
    options.layouts.length === 0,
    true,
  );

  const streamOpts = buildStreamOptions(options, loaderData, ssrOptions);
  let stream: ReactDOMStream;
  try {
    stream = await renderToReadableStream(finalTree, {
      ...streamOpts,
      signal: abortCtl.signal,
      onError(error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        ssrErrors.push(serializeSSRError(err));
        ssrOptions?.onError?.(err);
      },
    }) as ReactDOMStream;
  } catch (error) {
    cleanup();
    const err = error instanceof Error ? error : new Error(String(error));
    ssrOptions?.onError?.(err);

    // Fall back to error component if available
    if (options.errorComponent) {
      const fallbackTree = buildPageTree(
        options,
        loaderData,
        buildErrorFallbackContent(options, err),
        options.layouts.length === 0,
        true,
      );
      const fallbackStream = await renderToReadableStream(
        fallbackTree,
        streamOpts,
      ) as ReactDOMStream;

      const { instrumented, metrics } = instrumentStream(
        fallbackStream,
        startTime,
        ssrOptions,
      );
      return {
        stream: instrumented,
        allReady: fallbackStream.allReady,
        loaderData,
        statusCode: 500,
        metrics,
      };
    }
    throw err;
  }

  // Wire up allReady callback
  const allReadyPromise = stream.allReady.then(() => {
    ssrOptions?.onAllReady?.();
    cleanup();
  });

  const { instrumented, metrics } = instrumentStream(
    stream,
    startTime,
    ssrOptions,
    abortCtl,
  );

  return {
    stream: instrumented,
    allReady: allReadyPromise,
    loaderData,
    statusCode: ssrErrors.length > 0 ? 500 : 200,
    metrics,
  };
}

/**
 * Streaming SSR entry point.
 *
 * Returns a ReadableStream produced by React's renderToReadableStream,
 * which flushes the shell immediately and streams Suspense fallbacks as they
 * resolve. Use this in the dev server / production handler to pipe directly
 * into the HTTP response for optimal TTFB.
 */
export async function renderPageStream(
  options: RenderPageOptions,
  ssrOptions?: SSROptions,
): Promise<RenderStreamResult> {
  // When SSROptions are provided, delegate to the richer shell-first path
  if (ssrOptions) {
    const result = await renderShellFirstStream(options, ssrOptions);
    return {
      stream: result.stream,
      allReady: result.allReady,
      loaderData: result.loaderData,
      statusCode: result.statusCode,
    };
  }

  const { pageModule, layouts, loaderArgs } = options;

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
  const { pageModule, loaderArgs } = options;

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
 * Internally delegates to renderPageStream() and collects the full stream
 * into a string. Prefer renderPageStream() in new code for better TTFB.
 */
export async function renderPage(
  options: RenderPageOptions,
  ssrOptions?: SSROptions,
): Promise<RenderResult> {
  // When SSROptions are provided, use the instrumented path
  if (ssrOptions) {
    const result = await renderShellFirstStream(options, ssrOptions);
    const html = await collectRenderedStream(result.stream);
    return {
      html,
      loaderData: result.loaderData,
      statusCode: result.statusCode,
    };
  }

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

/**
 * Render a page with SSR timeout. If SSR does not complete within timeoutMs,
 * the shell that has been flushed so far is served and the stream is closed.
 * This prevents slow data-fetching from blocking the response indefinitely.
 *
 * This is a convenience wrapper around renderShellFirstStream().
 */
export async function renderPageWithTimeout(
  options: RenderPageOptions,
  timeoutMs: number = DEFAULT_SSR_TIMEOUT_MS,
): Promise<RenderResult> {
  return renderPage(options, { timeout: timeoutMs });
}

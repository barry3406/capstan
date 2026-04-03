import {
  createStrategy,
  mergeMetadata,
  renderPage,
  renderPageStream,
  renderPartialStream,
} from "@zauso-ai/capstan-react";
import type {
  HydrationMode,
  LayoutModule,
  LoaderArgs,
  PageModule,
  RenderMode,
  RenderPageOptions,
  RenderStrategy,
  RenderStrategyResult,
} from "@zauso-ai/capstan-react";
import type { NavigationPayload } from "@zauso-ai/capstan-react/client";

export interface PageRuntimePageModule extends PageModule {}

export type PageRuntimeTransport = "html" | "stream";

export interface PageRuntimeOptions {
  pageModule: PageRuntimePageModule;
  layouts: LayoutModule[];
  params: Record<string, string>;
  request: Request;
  loaderArgs: LoaderArgs;
  statusCode?: number;
  transport?: PageRuntimeTransport;
  hydration?: HydrationMode;
  componentType?: "server" | "client";
  loadingComponent?: RenderPageOptions["loadingComponent"];
  errorComponent?: RenderPageOptions["errorComponent"];
  layoutKeys?: string[];
  renderMode?: RenderMode;
  strategyOptions?: Parameters<typeof createStrategy>[1];
  strategyFactory?: (mode: RenderMode, opts?: Parameters<typeof createStrategy>[1]) => RenderStrategy;
  navHeaderName?: string;
  metadataChain?: unknown[];
}

export interface PageRuntimeBaseResult {
  kind: "document" | "navigation";
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  componentType: "server" | "client";
  renderMode: RenderMode;
  metadata?: NavigationPayload["metadata"];
}

export interface PageRuntimeNavigationResult extends PageRuntimeBaseResult {
  kind: "navigation";
  body: string;
  payload: NavigationPayload;
  html?: string;
  loaderData: unknown;
}

export interface PageRuntimeHtmlResult extends PageRuntimeBaseResult {
  kind: "document";
  transport: "html";
  body: string;
  html: string;
  loaderData: unknown;
  cacheStatus?: RenderStrategyResult["cacheStatus"];
}

export interface PageRuntimeStreamResult extends PageRuntimeBaseResult {
  kind: "document";
  transport: "stream";
  stream: ReadableStream<Uint8Array>;
  allReady: Promise<void>;
  loaderData: unknown;
  cacheStatus?: RenderStrategyResult["cacheStatus"];
}

export type PageRuntimeResult =
  | PageRuntimeNavigationResult
  | PageRuntimeHtmlResult
  | PageRuntimeStreamResult;

function isRenderablePageModule(value: PageRuntimePageModule): value is PageRuntimePageModule & {
  default: NonNullable<PageModule["default"]>;
} {
  return typeof value.default === "function";
}

function normalizeRenderMode(mode: unknown): RenderMode {
  if (mode === "ssr" || mode === "ssg" || mode === "isr" || mode === "streaming") {
    return mode;
  }
  return "ssr";
}

function normalizeComponentType(value: unknown): "server" | "client" {
  return value === "client" ? "client" : "server";
}

function normalizeMetadata(metadata: unknown): NavigationPayload["metadata"] | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;

  const result: Record<string, unknown> = {};
  const typed = metadata as Record<string, unknown>;

  if (typeof typed.title === "string") {
    result.title = typed.title;
  } else if (
    typed.title &&
    typeof typed.title === "object" &&
    typeof (typed.title as { default?: unknown }).default === "string"
  ) {
    const titleConfig = typed.title as { default: string; template?: unknown };
    result.title =
      typeof titleConfig.template === "string"
        ? titleConfig.template.replace("%s", titleConfig.default)
        : titleConfig.default;
  }
  if (typeof typed.description === "string") {
    result.description = typed.description;
  }

  for (const key of [
    "canonical",
    "keywords",
    "robots",
    "openGraph",
    "twitter",
    "icons",
    "alternates",
  ] as const) {
    if (typed[key] !== undefined) {
      result[key] = typed[key];
    }
  }

  return Object.keys(result).length > 0
    ? result as NonNullable<NavigationPayload["metadata"]>
    : undefined;
}

function resolveMetadata(
  metadataChain: readonly unknown[] | undefined,
  pageMetadata: unknown,
): unknown {
  let resolved: unknown;

  for (const metadata of metadataChain ?? []) {
    if (!metadata || typeof metadata !== "object") {
      continue;
    }

    resolved = resolved && typeof resolved === "object"
      ? mergeMetadata(
          resolved as Parameters<typeof mergeMetadata>[0],
          metadata as Parameters<typeof mergeMetadata>[1],
        )
      : metadata;
  }

  if (!pageMetadata || typeof pageMetadata !== "object") {
    return resolved;
  }

  if (!resolved || typeof resolved !== "object") {
    return pageMetadata;
  }

  return mergeMetadata(
    resolved as Parameters<typeof mergeMetadata>[0],
    pageMetadata as Parameters<typeof mergeMetadata>[1],
  );
}

function createStreamFromText(html: string): {
  stream: ReadableStream<Uint8Array>;
  allReady: Promise<void>;
} {
  const encoder = new TextEncoder();

  return {
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(html));
        controller.close();
      },
    }),
    allReady: Promise.resolve(),
  };
}

function buildRenderOptions(
  options: PageRuntimeOptions,
  metadata: unknown,
): RenderPageOptions {
  const renderOptions: RenderPageOptions = {
    pageModule: {
      ...options.pageModule,
      ...(metadata !== undefined ? { metadata } : {}),
    } as RenderPageOptions["pageModule"],
    layouts: options.layouts,
    params: options.params,
    request: options.request,
    loaderArgs: options.loaderArgs,
  };

  if (options.hydration !== undefined) renderOptions.hydration = options.hydration;
  if (options.componentType !== undefined) renderOptions.componentType = options.componentType;
  if (options.loadingComponent !== undefined) renderOptions.loadingComponent = options.loadingComponent;
  if (options.errorComponent !== undefined) renderOptions.errorComponent = options.errorComponent;
  if (options.layoutKeys !== undefined) renderOptions.layoutKeys = options.layoutKeys;

  return renderOptions;
}

function buildNavigationPayload(
  options: PageRuntimeOptions,
  metadata: unknown,
  loaderData: unknown,
  html?: string,
): NavigationPayload {
  const url = new URL(options.request.url).pathname;
  const layoutKey = options.layoutKeys?.at(-1) ?? "/";
  const payload: NavigationPayload = {
    url,
    layoutKey,
    loaderData,
    componentType: normalizeComponentType(options.componentType ?? options.pageModule.componentType),
  };

  const navigationMetadata = normalizeMetadata(metadata);
  if (navigationMetadata) {
    payload.metadata = navigationMetadata;
  }

  if (html !== undefined) {
    payload.html = html;
  }

  return payload;
}

function buildBaseResult(
  options: PageRuntimeOptions,
  metadata: unknown,
  statusCode: number,
): Pick<PageRuntimeBaseResult, "url" | "statusCode" | "headers" | "componentType" | "renderMode" | "metadata"> {
  const normalizedMetadata = normalizeMetadata(metadata);
  return {
    url: new URL(options.request.url).pathname,
    statusCode,
    headers: {},
    componentType: normalizeComponentType(options.componentType ?? options.pageModule.componentType),
    renderMode: normalizeRenderMode(options.renderMode ?? options.pageModule.renderMode),
    ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
  };
}

/**
 * Execute the page rendering flow without binding the result to any web framework.
 * The caller can turn the structured result into a Hono Response, a Node response,
 * or any other transport later.
 */
export async function runPageRuntime(options: PageRuntimeOptions): Promise<PageRuntimeResult> {
  if (!isRenderablePageModule(options.pageModule)) {
    throw new TypeError("Capstan page modules must export a default React component.");
  }

  const metadata = resolveMetadata(options.metadataChain, options.pageModule.metadata);
  const renderOptions = buildRenderOptions(options, metadata);
  const componentType = normalizeComponentType(options.componentType ?? options.pageModule.componentType);
  const renderMode = normalizeRenderMode(options.renderMode ?? options.pageModule.renderMode);
  const transport = options.transport ?? "html";
  const navHeaderName = options.navHeaderName ?? "X-Capstan-Nav";
  const isNavigationRequest = options.request.headers.get(navHeaderName) === "1";
  const statusCode = options.statusCode ?? 200;

  if (isNavigationRequest) {
    if (componentType === "server") {
      const partial = await renderPartialStream(renderOptions);
      const payload = buildNavigationPayload(options, metadata, partial.loaderData, partial.html);
      const body = JSON.stringify(payload);

      return {
        kind: "navigation",
        ...buildBaseResult(options, metadata, statusCode),
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
        body,
        payload,
        loaderData: partial.loaderData,
        html: partial.html,
      };
    }

    let loaderData: unknown = null;
    if (options.pageModule.loader) {
      loaderData = await options.pageModule.loader(options.loaderArgs);
    }

    const payload = buildNavigationPayload(options, metadata, loaderData);
    const body = JSON.stringify(payload);

    return {
      kind: "navigation",
      ...buildBaseResult(options, metadata, statusCode),
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
      body,
      payload,
      loaderData,
    };
  }

  const strategyFactory = options.strategyFactory ?? createStrategy;

  if (renderMode === "ssg" || renderMode === "isr") {
    const strategy = strategyFactory(renderMode, options.strategyOptions);
    const strategyContext = {
      options: renderOptions,
      url: new URL(options.request.url).pathname,
      ...(options.pageModule.revalidate !== undefined ? { revalidate: options.pageModule.revalidate } : {}),
      ...(options.pageModule.cacheTags !== undefined ? { cacheTags: options.pageModule.cacheTags } : {}),
    } satisfies Parameters<RenderStrategy["render"]>[0];
    const rendered = await strategy.render(strategyContext);

    if (transport === "stream") {
      const wrapped = createStreamFromText(rendered.html);
      return {
        kind: "document",
        transport: "stream",
        ...buildBaseResult(options, metadata, options.statusCode ?? rendered.statusCode),
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
        stream: wrapped.stream,
        allReady: wrapped.allReady,
        loaderData: rendered.loaderData,
        cacheStatus: rendered.cacheStatus,
      };
    }

    return {
      kind: "document",
      transport: "html",
      ...buildBaseResult(options, metadata, options.statusCode ?? rendered.statusCode),
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      body: rendered.html,
      html: rendered.html,
      loaderData: rendered.loaderData,
      cacheStatus: rendered.cacheStatus,
    };
  }

  if (transport === "stream") {
    const rendered = await renderPageStream(renderOptions);
    return {
      kind: "document",
      transport: "stream",
      ...buildBaseResult(options, metadata, statusCode),
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      stream: rendered.stream,
      allReady: rendered.allReady,
      loaderData: rendered.loaderData,
    };
  }

  const rendered = await renderPage(renderOptions);
  return {
    kind: "document",
    transport: "html",
    ...buildBaseResult(options, metadata, statusCode),
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
    body: rendered.html,
    html: rendered.html,
    loaderData: rendered.loaderData,
  };
}

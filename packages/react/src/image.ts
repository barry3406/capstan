import { createElement } from "react";
import type { CSSProperties, ImgHTMLAttributes, ReactElement } from "react";

export type ImageFormat = "auto" | "avif" | "webp" | "jpeg" | "png" | "gif" | string;

export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "width" | "height" | "loading" | "srcSet" | "sizes" | "decoding" | "fetchPriority"> {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  preload?: boolean;
  quality?: number; // 1-100, default 80 when a transformed URL is generated
  format?: ImageFormat;
  placeholder?: "blur" | "empty";
  blurDataURL?: string;
  sizes?: string;
  loading?: "lazy" | "eager";
  style?: CSSProperties;
  /** Fallback image src to show when the primary image fails to load. */
  fallbackSrc?: string;
  /** Fallback component to render when the image fails to load. */
  fallbackComponent?: () => ReactElement;
  /** Responsive art-direction sources for the <picture> element. */
  sources?: ArtDirectionSource[];
  /** Callback when image loads successfully. */
  onLoad?: () => void;
  /** Callback when image fails to load. */
  onError?: () => void;
}

// ---------------------------------------------------------------------------
// Art direction support
// ---------------------------------------------------------------------------

export interface ArtDirectionSource {
  /** Media query for this source (e.g. "(min-width: 768px)"). */
  media: string;
  /** Image src for this breakpoint. */
  src: string;
  /** Width for this breakpoint source. */
  width?: number;
  /** Format for this breakpoint source. */
  format?: ImageFormat;
  /** Quality for this breakpoint source. */
  quality?: number;
}

export interface ImagePreloadOptions {
  src: string;
  width?: number;
  sizes?: string;
  quality?: number;
  format?: ImageFormat;
  priority?: boolean;
  preload?: boolean;
  widths?: readonly number[];
}

const DEFAULT_IMAGE_WIDTHS = [640, 750, 828, 1080, 1200, 1920] as const;

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeWidth(value: number | undefined): number | undefined {
  if (!isFinitePositiveNumber(value)) {
    return undefined;
  }
  return Math.round(value);
}

function normalizeQuality(value: number | undefined): number | undefined {
  if (!isFinitePositiveNumber(value)) {
    return undefined;
  }
  return Math.min(100, Math.max(1, Math.round(value)));
}

function normalizeFormat(format: ImageFormat | undefined): string | undefined {
  if (!format || format === "auto") {
    return undefined;
  }
  return String(format).trim() || undefined;
}

function splitSource(source: string): { path: string; search: string; hash: string } {
  const hashIndex = source.indexOf("#");
  const hash = hashIndex >= 0 ? source.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const search = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "";
  return { path, search, hash };
}

function serializeAttributes(attributes: Record<string, string | undefined>): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => `${name}="${value!.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}"`)
    .join(" ");
}

function resolveWidths(widths: readonly number[] = DEFAULT_IMAGE_WIDTHS, maxWidth?: number): number[] {
  const widthLimit = normalizeWidth(maxWidth);
  const unique = new Set<number>();

  for (const width of widths) {
    const normalized = normalizeWidth(width);
    if (normalized === undefined) {
      continue;
    }
    if (widthLimit !== undefined && normalized > widthLimit * 2) {
      continue;
    }
    unique.add(normalized);
  }

  return Array.from(unique).sort((left, right) => left - right);
}

function createTransformOptions(options: {
  width?: number | undefined;
  quality?: number | undefined;
  format?: ImageFormat | undefined;
  widths?: readonly number[] | undefined;
}): {
  width?: number;
  quality?: number;
  format?: ImageFormat;
  widths?: readonly number[];
} {
  const result: {
    width?: number;
    quality?: number;
    format?: ImageFormat;
    widths?: readonly number[];
  } = {};

  if (options.width !== undefined) {
    result.width = options.width;
  }
  if (options.quality !== undefined) {
    result.quality = options.quality;
  }
  if (options.format !== undefined) {
    result.format = options.format;
  }
  if (options.widths !== undefined) {
    result.widths = options.widths;
  }

  return result;
}

/**
 * Returns true when the source should be routed through the
 * `/_capstan/image` optimization endpoint. External URLs and
 * protocol-relative paths are left untouched.
 */
function isLocalImagePath(src: string): boolean {
  if (!src || src.startsWith("//") || /^https?:\/\//i.test(src)) {
    return false;
  }
  return src.startsWith("/");
}

/**
 * Build a stable image URL with query parameters encoded in a predictable order.
 *
 * Local paths (starting with `/`) are routed through the `/_capstan/image`
 * optimization endpoint. External URLs are returned unchanged.
 */
export function buildImageUrl(src: string, options: { width?: number; quality?: number; format?: ImageFormat } = {}): string {
  if (!src) return src;

  const { path, search, hash } = splitSource(src);
  const width = normalizeWidth(options.width);
  const quality = normalizeQuality(options.quality);
  const format = normalizeFormat(options.format);

  // Route local paths through optimizer only when at least one transform is requested
  if (isLocalImagePath(src) && (width !== undefined || quality !== undefined || format !== undefined)) {
    const params = new URLSearchParams();
    const originalUrl = search ? `${path}?${search}` : path;
    params.set("url", originalUrl);

    if (width !== undefined) {
      params.set("w", String(width));
    }
    if (quality !== undefined) {
      params.set("q", String(quality));
    }
    if (format !== undefined) {
      params.set("f", format);
    }

    return `/_capstan/image?${params.toString()}${hash}`;
  }

  // External URL: append transform params directly
  const params = new URLSearchParams(search);

  if (width !== undefined) {
    params.set("w", String(width));
  }
  if (quality !== undefined) {
    params.set("q", String(quality));
  }
  if (format !== undefined) {
    params.set("format", format);
  }

  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash}`;
}

/**
 * Build a stable responsive srcset string.
 */
export function buildImageSrcSet(
  src: string,
  options: { width?: number; quality?: number; format?: ImageFormat; widths?: readonly number[] } = {},
): string {
  const candidates = resolveWidths(options.widths, options.width);

  if (candidates.length === 0) {
    return "";
  }

  const quality = normalizeQuality(options.quality) ?? 80;
  return candidates
    .map((candidateWidth) =>
      `${buildImageUrl(
        src,
        createTransformOptions({
          width: candidateWidth,
          quality,
          format: options.format,
        }),
      )} ${candidateWidth}w`,
    )
    .join(", ");
}

/**
 * Generate a prefetch/preload hint for an image resource.
 */
export function imagePreloadLink(options: ImagePreloadOptions): string {
  const shouldPreload = options.priority || options.preload !== false;
  const src = options.src.trim();

  if (!shouldPreload || !src) {
    return "";
  }

  const width = normalizeWidth(options.width);
  const hasTransform = width !== undefined || normalizeFormat(options.format) !== undefined;
  const quality = options.quality !== undefined
    ? normalizeQuality(options.quality) ?? 80
    : hasTransform
      ? 80
      : undefined;
  const href = width !== undefined || quality !== undefined || normalizeFormat(options.format) !== undefined
    ? buildImageUrl(
        src,
        createTransformOptions({
          width,
          quality,
          format: options.format,
        }),
      )
    : src;
  const srcSet = buildImageSrcSet(
    src,
    createTransformOptions({
      width,
      quality,
      format: options.format,
      widths: options.widths,
    }),
  );

  return `<link ${serializeAttributes({
    rel: "preload",
    as: "image",
    href,
    imagesrcset: srcSet || undefined,
    imagesizes: options.sizes,
    fetchpriority: "high",
  })}>`;
}

// ---------------------------------------------------------------------------
// Blur-up placeholder generation
// ---------------------------------------------------------------------------

/**
 * Generate a tiny inline SVG data URL for blur-up placeholder.
 * This creates a 10x10 pixel SVG with a blurred rect that can be used
 * as a placeholder while the full image loads.
 */
export function generateBlurPlaceholder(
  width: number,
  height: number,
  color?: string,
): string {
  const w = Math.max(1, Math.round(width / 100));
  const h = Math.max(1, Math.round(height / 100));
  const fill = color ?? "#e0e0e0";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><filter id="b"><feGaussianBlur stdDeviation="1"/></filter><rect width="${w}" height="${h}" fill="${fill}" filter="url(#b)"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// ---------------------------------------------------------------------------
// Image component
// ---------------------------------------------------------------------------

/**
 * Optimized image component with stable srcset generation, preload hints,
 * lazy loading, art direction, error fallback, and arbitrary attribute passthrough.
 */
export function Image(props: ImageProps): ReactElement {
  const {
    src,
    alt,
    width,
    height,
    priority,
    preload,
    quality,
    format,
    placeholder,
    blurDataURL,
    sizes,
    loading,
    style,
    fallbackSrc,
    fallbackComponent,
    sources,
    onLoad,
    onError,
    ...rest
  } = props;

  const normalizedWidth = normalizeWidth(width);
  const formatValue = normalizeFormat(format);
  const sourceQuality = quality !== undefined
    ? normalizeQuality(quality) ?? 80
    : normalizedWidth !== undefined || formatValue !== undefined
      ? 80
      : undefined;
  const shouldPreload = Boolean(priority || preload);
  const shouldTransformSource = normalizedWidth !== undefined || sourceQuality !== undefined || formatValue !== undefined;
  const srcSet = buildImageSrcSet(
    src,
    createTransformOptions({
      width: normalizedWidth,
      quality: quality !== undefined ? sourceQuality : undefined,
      format,
    }),
  );

  // Blur-up placeholder styles
  const resolvedBlurDataURL = placeholder === "blur"
    ? blurDataURL ?? (normalizedWidth && isFinitePositiveNumber(height)
        ? generateBlurPlaceholder(normalizedWidth, Math.round(height))
        : undefined)
    : undefined;

  const imageStyle: CSSProperties | undefined = resolvedBlurDataURL
    ? {
        ...style,
        backgroundImage: `url(${resolvedBlurDataURL})`,
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
      }
    : style;

  const resolvedSrc = shouldTransformSource
    ? buildImageUrl(
        src,
        createTransformOptions({
          width: normalizedWidth,
          quality: sourceQuality,
          format,
        }),
      )
    : src;

  const imgAttrs: Record<string, unknown> = {
    ...rest,
    src: resolvedSrc,
    alt,
    loading: shouldPreload ? "eager" : (loading ?? "lazy"),
    decoding: "async",
    style: imageStyle,
  };

  if (normalizedWidth !== undefined) {
    imgAttrs.width = normalizedWidth;
  }
  if (isFinitePositiveNumber(height)) {
    imgAttrs.height = Math.round(height);
  }
  if (srcSet) {
    imgAttrs.srcSet = srcSet;
  }
  if (sizes) {
    imgAttrs.sizes = sizes;
  }
  if (shouldPreload) {
    imgAttrs.fetchPriority = "high";
  }

  // Error fallback: swap src on error, or render fallback component
  if (fallbackSrc || fallbackComponent || onError) {
    imgAttrs.onError = (event: Event) => {
      onError?.();
      const imgEl = event.target as HTMLImageElement | null;
      if (imgEl && fallbackSrc && imgEl.src !== fallbackSrc) {
        imgEl.src = fallbackSrc;
        imgEl.srcset = "";
      }
    };
  }

  if (onLoad) {
    imgAttrs.onLoad = () => onLoad();
  }

  // Art direction: wrap in <picture> with <source> elements
  if (sources && sources.length > 0) {
    const sourceElements = sources.map((artSource, index) => {
      const artTransformOpts: { width?: number; quality?: number; format?: ImageFormat } = {};
      const artTransW = normalizeWidth(artSource.width);
      if (artTransW !== undefined) artTransformOpts.width = artTransW;
      const artTransQ = artSource.quality !== undefined ? normalizeQuality(artSource.quality) : sourceQuality;
      if (artTransQ !== undefined) artTransformOpts.quality = artTransQ;
      if (artSource.format !== undefined) artTransformOpts.format = artSource.format;
      const artSrcSet = buildImageSrcSet(artSource.src, artTransformOpts);
      const artUrlOpts: { width?: number; quality?: number; format?: ImageFormat } = {};
      const artW = normalizeWidth(artSource.width);
      if (artW !== undefined) artUrlOpts.width = artW;
      const artQ = artSource.quality !== undefined ? normalizeQuality(artSource.quality) : sourceQuality;
      if (artQ !== undefined) artUrlOpts.quality = artQ;
      if (artSource.format !== undefined) artUrlOpts.format = artSource.format;
      const artSrc = buildImageUrl(artSource.src, artUrlOpts);

      return createElement("source", {
        key: `art-${index}`,
        media: artSource.media,
        srcSet: artSrcSet || artSrc,
        ...(artSource.format ? { type: `image/${artSource.format}` } : {}),
      });
    });

    return createElement(
      "picture",
      null,
      ...sourceElements,
      createElement("img", imgAttrs),
    );
  }

  return createElement("img", imgAttrs);
}

/**
 * Preload an image using React 19's resource preloading API.
 * Signals to the browser to start fetching the image early.
 */
export function preloadImage(options: {
  src: string;
  srcSet?: string;
  sizes?: string;
  type?: string;
}): void {
  try {
    const reactDom = require("react-dom") as typeof import("react-dom");
    if ("preload" in reactDom && typeof (reactDom as any).preload === "function") {
      (reactDom as any).preload(options.src, {
        as: "image",
        imageSrcSet: options.srcSet,
        imageSizes: options.sizes,
        type: options.type,
      });
    }
  } catch {
    // react-dom preload not available — no-op
  }
}

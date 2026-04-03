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
 * Build a stable image URL with query parameters encoded in a predictable order.
 */
export function buildImageUrl(src: string, options: { width?: number; quality?: number; format?: ImageFormat } = {}): string {
  const { path, search, hash } = splitSource(src);
  const params = new URLSearchParams(search);
  const width = normalizeWidth(options.width);
  const quality = normalizeQuality(options.quality);
  const format = normalizeFormat(options.format);

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

/**
 * Optimized image component with stable srcset generation, preload hints,
 * and arbitrary attribute passthrough.
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

  const imageStyle: CSSProperties | undefined = placeholder === "blur" && blurDataURL
    ? {
        ...style,
        backgroundImage: `url(${blurDataURL})`,
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
      }
    : style;

  const imgAttrs: Record<string, unknown> = {
    ...rest,
    src: shouldTransformSource
      ? buildImageUrl(
          src,
          createTransformOptions({
            width: normalizedWidth,
            quality: sourceQuality,
            format,
          }),
        )
      : src,
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

  return createElement("img", imgAttrs);
}

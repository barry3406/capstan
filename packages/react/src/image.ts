import { createElement } from "react";
import type { ReactElement } from "react";

export interface ImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  priority?: boolean;
  quality?: number; // 1-100, default 80
  placeholder?: "blur" | "empty";
  blurDataURL?: string;
  sizes?: string;
  loading?: "lazy" | "eager";
  className?: string;
  style?: Record<string, string | number>;
}

/**
 * Optimized image component. Generates responsive srcset,
 * handles lazy loading, and provides placeholder blur-up.
 */
export function Image(props: ImageProps): ReactElement {
  const { src, alt, width, height, priority, quality = 80, placeholder, blurDataURL, sizes, loading, className, style } = props;

  const imgLoading = priority ? "eager" : (loading ?? "lazy");
  const fetchPriority = priority ? "high" : undefined;

  // Generate srcset for responsive images
  const widths = [640, 750, 828, 1080, 1200, 1920];
  const srcSet = widths
    .filter(w => !width || w <= width * 2)
    .map(w => `${src}?w=${w}&q=${quality} ${w}w`)
    .join(", ");

  const imgAttrs: Record<string, unknown> = {
    src: width ? `${src}?w=${width}&q=${quality}` : src,
    alt,
    loading: imgLoading,
    decoding: "async",
    className,
    style: {
      ...style,
      ...(placeholder === "blur" && blurDataURL ? {
        backgroundImage: `url(${blurDataURL})`,
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
      } : {}),
    },
  };

  if (width) imgAttrs.width = width;
  if (height) imgAttrs.height = height;
  if (srcSet) imgAttrs.srcSet = srcSet;
  if (sizes) imgAttrs.sizes = sizes;
  if (fetchPriority) imgAttrs.fetchPriority = fetchPriority;

  return createElement("img", imgAttrs);
}

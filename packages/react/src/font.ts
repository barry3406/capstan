export interface FontConfig {
  family: string;
  src?: string; // URL to font file
  weight?: string | number;
  style?: string;
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
  preload?: boolean;
  subsets?: string[];
  variable?: string; // CSS variable name
}

export interface FontResult {
  className: string;
  style: { fontFamily: string };
  variable?: string;
}

/**
 * Configure a font for optimized loading.
 * Returns className and style for use in components.
 */
export function defineFont(config: FontConfig): FontResult {
  const safeName = config.family.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  const variable = config.variable ?? `--font-${safeName}`;

  return {
    className: `font-${safeName}`,
    style: { fontFamily: `'${config.family}', system-ui, sans-serif` },
    variable,
  };
}

/**
 * Generate a <link> preload tag for a font file.
 */
export function fontPreloadLink(config: FontConfig): string {
  if (!config.src) return "";
  const rel = config.preload !== false ? "preload" : "stylesheet";
  return `<link rel="${rel}" href="${config.src}" as="font" type="font/woff2" crossorigin>`;
}

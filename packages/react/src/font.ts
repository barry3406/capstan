import { createElement } from "react";
import type { CSSProperties, ReactElement } from "react";

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

export interface FontStyle extends CSSProperties, Record<string, string | number | undefined> {}

export interface FontResult {
  className: string;
  style: FontStyle;
  variable?: string;
}

function sanitizeFontIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "font";
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeAttributes(attributes: Record<string, string | undefined>): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([name, value]) => {
      const renderedName = name === "crossOrigin" ? "crossorigin" : name;
      return `${renderedName}="${escapeHtmlAttribute(value!)}"`;
    })
    .join(" ");
}

function quoteFontFamily(family: string): string {
  return `'${family.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}', system-ui, sans-serif`;
}

function buildFontLinkAttributes(config: FontConfig): Record<string, string> | null {
  const src = config.src?.trim();
  if (!src) {
    return null;
  }

  if (config.preload === false) {
    return {
      rel: "stylesheet",
      href: src,
    };
  }

  return {
    rel: "preload",
    href: src,
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  };
}

/**
 * Configure a font for optimized loading.
 * Returns className, style, and variable for use in components.
 */
export function defineFont(config: FontConfig): FontResult {
  const safeName = sanitizeFontIdentifier(config.family);
  const variable = config.variable ?? `--font-${safeName}`;
  const fontFamily = quoteFontFamily(config.family);

  const style: FontStyle = {
    fontFamily,
  };

  if (config.weight !== undefined) {
    style.fontWeight = config.weight;
  }
  if (config.style !== undefined) {
    style.fontStyle = config.style;
  }

  style[variable] = fontFamily;

  return {
    className: `font-${safeName}`,
    style,
    variable,
  };
}

/**
 * Generate a <link> element for a font file.
 */
export function fontPreloadElement(config: FontConfig): ReactElement | null {
  const attributes = buildFontLinkAttributes(config);
  if (!attributes) {
    return null;
  }

  return createElement("link", attributes);
}

/**
 * Generate a <link> preload tag for a font file.
 */
export function fontPreloadLink(config: FontConfig): string {
  const attributes = buildFontLinkAttributes(config);
  if (!attributes) {
    return "";
  }

  return `<link ${serializeAttributes(attributes)}>`;
}

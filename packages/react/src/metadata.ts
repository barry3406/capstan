import { createElement } from "react";
import type { ReactElement } from "react";

export interface Metadata {
  title?: string | { default: string; template?: string };
  description?: string;
  keywords?: string[];
  robots?: string | { index?: boolean; follow?: boolean };
  openGraph?: {
    title?: string;
    description?: string;
    type?: string;
    url?: string;
    image?: string;
    siteName?: string;
  };
  twitter?: {
    card?: "summary" | "summary_large_image";
    title?: string;
    description?: string;
    image?: string;
  };
  icons?: { icon?: string; apple?: string };
  canonical?: string;
  alternates?: Record<string, string>; // hreflang
}

/**
 * Generate <head> elements from a Metadata object.
 */
export function generateMetadataElements(metadata: Metadata): ReactElement[] {
  const elements: ReactElement[] = [];
  let key = 0;

  // Title
  if (metadata.title) {
    const titleStr = typeof metadata.title === "string"
      ? metadata.title
      : metadata.title.template
        ? metadata.title.template.replace("%s", metadata.title.default)
        : metadata.title.default;
    elements.push(createElement("title", { key: key++ }, titleStr));
  }

  // Description
  if (metadata.description) {
    elements.push(createElement("meta", { key: key++, name: "description", content: metadata.description }));
  }

  // Keywords
  if (metadata.keywords?.length) {
    elements.push(createElement("meta", { key: key++, name: "keywords", content: metadata.keywords.join(", ") }));
  }

  // Robots
  if (metadata.robots) {
    const robotsStr = typeof metadata.robots === "string"
      ? metadata.robots
      : [
          metadata.robots.index === false ? "noindex" : "index",
          metadata.robots.follow === false ? "nofollow" : "follow",
        ].join(", ");
    elements.push(createElement("meta", { key: key++, name: "robots", content: robotsStr }));
  }

  // Canonical
  if (metadata.canonical) {
    elements.push(createElement("link", { key: key++, rel: "canonical", href: metadata.canonical }));
  }

  // Open Graph
  if (metadata.openGraph) {
    const og = metadata.openGraph;
    if (og.title) elements.push(createElement("meta", { key: key++, property: "og:title", content: og.title }));
    if (og.description) elements.push(createElement("meta", { key: key++, property: "og:description", content: og.description }));
    if (og.type) elements.push(createElement("meta", { key: key++, property: "og:type", content: og.type }));
    if (og.url) elements.push(createElement("meta", { key: key++, property: "og:url", content: og.url }));
    if (og.image) elements.push(createElement("meta", { key: key++, property: "og:image", content: og.image }));
    if (og.siteName) elements.push(createElement("meta", { key: key++, property: "og:site_name", content: og.siteName }));
  }

  // Twitter
  if (metadata.twitter) {
    const tw = metadata.twitter;
    if (tw.card) elements.push(createElement("meta", { key: key++, name: "twitter:card", content: tw.card }));
    if (tw.title) elements.push(createElement("meta", { key: key++, name: "twitter:title", content: tw.title }));
    if (tw.description) elements.push(createElement("meta", { key: key++, name: "twitter:description", content: tw.description }));
    if (tw.image) elements.push(createElement("meta", { key: key++, name: "twitter:image", content: tw.image }));
  }

  // Icons
  if (metadata.icons) {
    if (metadata.icons.icon) elements.push(createElement("link", { key: key++, rel: "icon", href: metadata.icons.icon }));
    if (metadata.icons.apple) elements.push(createElement("link", { key: key++, rel: "apple-touch-icon", href: metadata.icons.apple }));
  }

  // Alternates (hreflang)
  if (metadata.alternates) {
    for (const [lang, href] of Object.entries(metadata.alternates)) {
      elements.push(createElement("link", { key: key++, rel: "alternate", hrefLang: lang, href }));
    }
  }

  return elements;
}

/**
 * Define metadata for a page (exported from page files).
 */
export function defineMetadata(metadata: Metadata): Metadata {
  return metadata;
}

/**
 * Merge parent and child metadata (child overrides parent).
 */
export function mergeMetadata(parent: Metadata, child: Metadata): Metadata {
  // Build result manually to satisfy exactOptionalPropertyTypes —
  // spreading optional fields can introduce `undefined` values which
  // are not assignable to the non-undefined property types.
  const merged: Metadata = {};

  // Scalar fields: child overrides parent
  const title = child.title ?? parent.title;
  if (title !== undefined) merged.title = title;

  const description = child.description ?? parent.description;
  if (description !== undefined) merged.description = description;

  const robots = child.robots ?? parent.robots;
  if (robots !== undefined) merged.robots = robots;

  const canonical = child.canonical ?? parent.canonical;
  if (canonical !== undefined) merged.canonical = canonical;

  // Keywords: child overrides parent entirely
  const kw = child.keywords ?? parent.keywords;
  if (kw !== undefined) merged.keywords = kw;

  // Nested objects: merge child into parent
  const og = child.openGraph
    ? { ...parent.openGraph, ...child.openGraph }
    : parent.openGraph;
  if (og !== undefined) merged.openGraph = og;

  const tw = child.twitter
    ? { ...parent.twitter, ...child.twitter }
    : parent.twitter;
  if (tw !== undefined) merged.twitter = tw;

  const ic = child.icons
    ? { ...parent.icons, ...child.icons }
    : parent.icons;
  if (ic !== undefined) merged.icons = ic;

  const alt = child.alternates
    ? { ...parent.alternates, ...child.alternates }
    : parent.alternates;
  if (alt !== undefined) merged.alternates = alt;

  return merged;
}

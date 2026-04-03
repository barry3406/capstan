import { createElement } from "react";
import type { ReactElement } from "react";
import type {
  Metadata,
  MetadataAlternates,
  MetadataAlternatesObject,
  MetadataIcons,
  MetadataLinkDescriptor,
  MetadataLinkInput,
  MetadataRobotsObject,
  MetadataTitle,
  MetadataTitleObject,
  ResolvedMetadata,
  ResolvedMetadataAlternates,
  ResolvedMetadataIcons,
  ResolvedMetadataLinkDescriptor,
} from "./types.js";

export type {
  Metadata,
  MetadataAlternates,
  MetadataAlternatesObject,
  MetadataIcons,
  MetadataLinkDescriptor,
  MetadataLinkInput,
  MetadataRobotsObject,
  MetadataTitle,
  MetadataTitleObject,
  ResolvedMetadata,
  ResolvedMetadataAlternates,
  ResolvedMetadataIcons,
  ResolvedMetadataLinkDescriptor,
} from "./types.js";

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeText(value: string | undefined): string | undefined {
  return hasText(value) ? value.trim() : undefined;
}

function normalizeTemplate(value: string | undefined): string | undefined {
  return hasText(value) ? value : undefined;
}

function applyTitleTemplate(title: string, template: string): string {
  return template.includes("%s")
    ? template.replace("%s", title)
    : `${title}${template}`;
}

function resolveTitle(title: MetadataTitle | undefined): string | undefined {
  if (title === undefined) return undefined;
  if (typeof title === "string") {
    return normalizeText(title);
  }
  const absolute = normalizeText(title.absolute);
  if (absolute !== undefined) return absolute;

  const fallback = normalizeText(title.default);
  if (fallback === undefined) return undefined;

  const template = normalizeTemplate(title.template);
  return template !== undefined
    ? applyTitleTemplate(fallback, template)
    : fallback;
}

function normalizeLinks(
  input: MetadataLinkInput | MetadataLinkInput[] | undefined,
): ResolvedMetadataLinkDescriptor[] {
  if (input === undefined) return [];

  const links = Array.isArray(input) ? input : [input];
  const normalized: ResolvedMetadataLinkDescriptor[] = [];

  for (const link of links) {
    if (typeof link === "string") {
      const url = normalizeText(link);
      if (url !== undefined) normalized.push({ url });
      continue;
    }

    const url = normalizeText(link.url);
    if (url === undefined) continue;

    const entry: ResolvedMetadataLinkDescriptor = { url };
    const type = normalizeText(link.type);
    const sizes = normalizeText(link.sizes);
    const media = normalizeText(link.media);
    const color = normalizeText(link.color);
    const title = normalizeText(link.title);

    if (type !== undefined) entry.type = type;
    if (sizes !== undefined) entry.sizes = sizes;
    if (media !== undefined) entry.media = media;
    if (color !== undefined) entry.color = color;
    if (title !== undefined) entry.title = title;

    normalized.push(entry);
  }

  return normalized;
}

function normalizeIcons(icons: MetadataIcons | undefined): ResolvedMetadataIcons | undefined {
  if (icons === undefined) return undefined;

  const icon = normalizeLinks(icons.icon);
  const apple = normalizeLinks(icons.apple);
  const shortcut = normalizeLinks(icons.shortcut);
  const other: ResolvedMetadataIcons["other"] = [];

  for (const link of icons.other ?? []) {
    const rel = normalizeText(link.rel);
    const url = normalizeText(link.url);
    if (rel === undefined || url === undefined) continue;

    const entry: ResolvedMetadataIcons["other"][number] = { rel, url };
    const type = normalizeText(link.type);
    const sizes = normalizeText(link.sizes);
    const media = normalizeText(link.media);
    const color = normalizeText(link.color);
    const title = normalizeText(link.title);

    if (type !== undefined) entry.type = type;
    if (sizes !== undefined) entry.sizes = sizes;
    if (media !== undefined) entry.media = media;
    if (color !== undefined) entry.color = color;
    if (title !== undefined) entry.title = title;

    other.push(entry);
  }

  if (icon.length === 0 && apple.length === 0 && shortcut.length === 0 && other.length === 0) {
    return undefined;
  }

  return { icon, apple, shortcut, other };
}

function normalizeAlternates(
  alternates: MetadataAlternates | undefined,
): ResolvedMetadataAlternates | undefined {
  if (alternates === undefined) return undefined;

  const resolved: ResolvedMetadataAlternates = {
    languages: {},
    media: {},
    types: {},
  };

  const assignEntries = (target: Record<string, string>, source: Record<string, string> | undefined): void => {
    if (!source) return;
    for (const [key, value] of Object.entries(source)) {
      const nextKey = normalizeText(key);
      const nextValue = normalizeText(value);
      if (nextKey !== undefined && nextValue !== undefined) {
        target[nextKey] = nextValue;
      }
    }
  };

  const looksLikeStructured =
    Object.prototype.hasOwnProperty.call(alternates, "languages") ||
    Object.prototype.hasOwnProperty.call(alternates, "media") ||
    Object.prototype.hasOwnProperty.call(alternates, "types");

  if (looksLikeStructured) {
    const structured = alternates as MetadataAlternatesObject;
    assignEntries(
      resolved.languages,
      structured.languages,
    );
    assignEntries(
      resolved.media,
      structured.media,
    );
    assignEntries(
      resolved.types,
      structured.types,
    );
  } else {
    assignEntries(resolved.languages, alternates as Record<string, string>);
  }

  if (
    Object.keys(resolved.languages).length === 0 &&
    Object.keys(resolved.media).length === 0 &&
    Object.keys(resolved.types).length === 0
  ) {
    return undefined;
  }

  return resolved;
}

function resolveRobots(robots: Metadata["robots"]): string | undefined {
  if (robots === undefined) return undefined;
  if (typeof robots === "string") {
    return normalizeText(robots);
  }

  const directives = [
    robots.index === false ? "noindex" : "index",
    robots.follow === false ? "nofollow" : "follow",
  ];

  if (robots.noarchive) directives.push("noarchive");
  if (robots.nosnippet) directives.push("nosnippet");
  if (robots.noimageindex) directives.push("noimageindex");
  if (robots.notranslate) directives.push("notranslate");
  if (hasText(robots.unavailableAfter)) {
    directives.push(`unavailable_after:${robots.unavailableAfter.trim()}`);
  }
  if (robots.maxImagePreview !== undefined) {
    directives.push(`max-image-preview:${robots.maxImagePreview}`);
  }
  if (robots.maxSnippet !== undefined) {
    directives.push(`max-snippet:${robots.maxSnippet}`);
  }
  if (robots.maxVideoPreview !== undefined) {
    directives.push(`max-video-preview:${robots.maxVideoPreview}`);
  }

  return directives.join(", ");
}

function mergeTitle(parent: MetadataTitle | undefined, child: MetadataTitle | undefined): MetadataTitle | undefined {
  if (child === undefined) return parent;
  if (typeof child === "string") {
    const trimmedChild = normalizeText(child);
    if (trimmedChild === undefined) return parent;
    if (typeof parent === "object" && hasText(parent.template)) {
      return { default: trimmedChild, template: parent.template };
    }
    return trimmedChild;
  }

  if (hasText(child.absolute)) {
    const merged: MetadataTitleObject = { absolute: child.absolute.trim() };
    if (hasText(child.template)) merged.template = child.template;
    if (hasText(child.default)) merged.default = child.default.trim();
    return merged;
  }

  if (hasText(child.default)) {
    const merged: MetadataTitleObject = { default: child.default.trim() };
    const inheritedTemplate =
      hasText(child.template)
        ? child.template
        : typeof parent === "object" && hasText(parent.template)
          ? parent.template
          : undefined;
    if (inheritedTemplate !== undefined) merged.template = inheritedTemplate;
    return merged;
  }

  if (hasText(child.template)) {
    if (typeof parent === "string") {
      return { default: parent.trim(), template: child.template };
    }
    const merged: MetadataTitleObject = { ...parent, template: child.template };
    if (!hasText(merged.default)) delete merged.default;
    if (!hasText(merged.absolute)) delete merged.absolute;
    return merged;
  }

  return parent;
}

/**
 * Resolve raw metadata into a stable structure that can be consumed by
 * renderers and client-side head managers without re-applying merge logic.
 */
export function resolveMetadata(metadata: Metadata): ResolvedMetadata {
  const resolved: ResolvedMetadata = {};

  const title = resolveTitle(metadata.title);
  const description = normalizeText(metadata.description);
  const canonical = normalizeText(metadata.canonical);
  const robots = resolveRobots(metadata.robots);
  const icons = normalizeIcons(metadata.icons);
  const alternates = normalizeAlternates(metadata.alternates);

  if (title !== undefined) resolved.title = title;
  if (description !== undefined) resolved.description = description;
  if (canonical !== undefined) resolved.canonical = canonical;
  if (robots !== undefined) resolved.robots = robots;

  if (metadata.keywords) {
    const keywords = metadata.keywords
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0);
    if (keywords.length > 0) resolved.keywords = keywords;
  }

  const openGraph = {
    ...(metadata.openGraph ?? {}),
  };
  const ogTitle = normalizeText(openGraph.title) ?? title;
  const ogDescription = normalizeText(openGraph.description) ?? description;
  const ogType = normalizeText(openGraph.type);
  const ogUrl = normalizeText(openGraph.url) ?? canonical;
  const ogImage = normalizeText(openGraph.image);
  const ogSiteName = normalizeText(openGraph.siteName);
  if (
    ogTitle !== undefined ||
    ogDescription !== undefined ||
    ogType !== undefined ||
    ogUrl !== undefined ||
    ogImage !== undefined ||
    ogSiteName !== undefined
  ) {
    resolved.openGraph = {};
    if (ogTitle !== undefined) resolved.openGraph.title = ogTitle;
    if (ogDescription !== undefined) resolved.openGraph.description = ogDescription;
    if (ogType !== undefined) resolved.openGraph.type = ogType;
    if (ogUrl !== undefined) resolved.openGraph.url = ogUrl;
    if (ogImage !== undefined) resolved.openGraph.image = ogImage;
    if (ogSiteName !== undefined) resolved.openGraph.siteName = ogSiteName;
  }

  const twitter = {
    ...(metadata.twitter ?? {}),
  };
  const twitterCard = twitter.card;
  const twitterTitle = normalizeText(twitter.title) ?? title;
  const twitterDescription = normalizeText(twitter.description) ?? description;
  const twitterImage = normalizeText(twitter.image);
  if (
    twitterCard !== undefined ||
    twitterTitle !== undefined ||
    twitterDescription !== undefined ||
    twitterImage !== undefined
  ) {
    resolved.twitter = {};
    if (twitterCard !== undefined) resolved.twitter.card = twitterCard;
    if (twitterTitle !== undefined) resolved.twitter.title = twitterTitle;
    if (twitterDescription !== undefined) resolved.twitter.description = twitterDescription;
    if (twitterImage !== undefined) resolved.twitter.image = twitterImage;
  }

  if (icons !== undefined) resolved.icons = icons;
  if (alternates !== undefined) resolved.alternates = alternates;

  return resolved;
}

/**
 * Generate <head> elements from metadata after resolving templates and
 * normalizing nested structures.
 */
export function generateMetadataElements(metadata: Metadata): ReactElement[] {
  const resolved = resolveMetadata(metadata);
  const elements: ReactElement[] = [];
  let key = 0;

  if (resolved.title) {
    elements.push(createElement("title", { key: key++ }, resolved.title));
  }

  if (resolved.description) {
    elements.push(createElement("meta", { key: key++, name: "description", content: resolved.description }));
  }

  if (resolved.keywords?.length) {
    elements.push(createElement("meta", { key: key++, name: "keywords", content: resolved.keywords.join(", ") }));
  }

  if (resolved.robots) {
    elements.push(createElement("meta", { key: key++, name: "robots", content: resolved.robots }));
  }

  if (resolved.canonical) {
    elements.push(createElement("link", { key: key++, rel: "canonical", href: resolved.canonical }));
  }

  if (metadata.openGraph && resolved.openGraph) {
    const og = resolved.openGraph;
    if (og.title) elements.push(createElement("meta", { key: key++, property: "og:title", content: og.title }));
    if (og.description) elements.push(createElement("meta", { key: key++, property: "og:description", content: og.description }));
    if (og.type) elements.push(createElement("meta", { key: key++, property: "og:type", content: og.type }));
    if (og.url) elements.push(createElement("meta", { key: key++, property: "og:url", content: og.url }));
    if (og.image) elements.push(createElement("meta", { key: key++, property: "og:image", content: og.image }));
    if (og.siteName) elements.push(createElement("meta", { key: key++, property: "og:site_name", content: og.siteName }));
  }

  if (metadata.twitter && resolved.twitter) {
    const tw = resolved.twitter;
    if (tw.card) elements.push(createElement("meta", { key: key++, name: "twitter:card", content: tw.card }));
    if (tw.title) elements.push(createElement("meta", { key: key++, name: "twitter:title", content: tw.title }));
    if (tw.description) elements.push(createElement("meta", { key: key++, name: "twitter:description", content: tw.description }));
    if (tw.image) elements.push(createElement("meta", { key: key++, name: "twitter:image", content: tw.image }));
  }

  if (resolved.icons) {
    for (const icon of resolved.icons.icon) {
      elements.push(createElement("link", { key: key++, rel: "icon", href: icon.url, ...(icon.type ? { type: icon.type } : {}), ...(icon.sizes ? { sizes: icon.sizes } : {}), ...(icon.media ? { media: icon.media } : {}), ...(icon.color ? { color: icon.color } : {}), ...(icon.title ? { title: icon.title } : {}) }));
    }
    for (const apple of resolved.icons.apple) {
      elements.push(createElement("link", { key: key++, rel: "apple-touch-icon", href: apple.url, ...(apple.type ? { type: apple.type } : {}), ...(apple.sizes ? { sizes: apple.sizes } : {}), ...(apple.media ? { media: apple.media } : {}), ...(apple.color ? { color: apple.color } : {}), ...(apple.title ? { title: apple.title } : {}) }));
    }
    for (const shortcut of resolved.icons.shortcut) {
      elements.push(createElement("link", { key: key++, rel: "shortcut icon", href: shortcut.url, ...(shortcut.type ? { type: shortcut.type } : {}), ...(shortcut.sizes ? { sizes: shortcut.sizes } : {}), ...(shortcut.media ? { media: shortcut.media } : {}), ...(shortcut.color ? { color: shortcut.color } : {}), ...(shortcut.title ? { title: shortcut.title } : {}) }));
    }
    for (const other of resolved.icons.other) {
      elements.push(createElement("link", { key: key++, rel: other.rel, href: other.url, ...(other.type ? { type: other.type } : {}), ...(other.sizes ? { sizes: other.sizes } : {}), ...(other.media ? { media: other.media } : {}), ...(other.color ? { color: other.color } : {}), ...(other.title ? { title: other.title } : {}) }));
    }
  }

  if (resolved.alternates) {
    for (const [lang, href] of Object.entries(resolved.alternates.languages)) {
      elements.push(createElement("link", { key: key++, rel: "alternate", hrefLang: lang, href }));
    }
    for (const [media, href] of Object.entries(resolved.alternates.media)) {
      elements.push(createElement("link", { key: key++, rel: "alternate", media, href }));
    }
    for (const [type, href] of Object.entries(resolved.alternates.types)) {
      elements.push(createElement("link", { key: key++, rel: "alternate", type, href }));
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
  const merged: Metadata = {};

  const title = mergeTitle(parent.title, child.title);
  if (title !== undefined) merged.title = title;

  const description = child.description ?? parent.description;
  if (description !== undefined) merged.description = description;

  const canonical = child.canonical ?? parent.canonical;
  if (canonical !== undefined) merged.canonical = canonical;

  const kw = child.keywords ?? parent.keywords;
  if (kw !== undefined) merged.keywords = kw;

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

  let robots = child.robots ?? parent.robots;
  if (
    typeof parent.robots === "object" &&
    typeof child.robots === "object"
  ) {
    robots = { ...parent.robots, ...child.robots };
  }
  if (robots !== undefined) merged.robots = robots;

  const parentAlternates = normalizeAlternates(parent.alternates);
  const childAlternates = normalizeAlternates(child.alternates);
  let alt: Metadata["alternates"] | undefined;
  if (parentAlternates && childAlternates) {
    alt = {
      languages: { ...parentAlternates.languages, ...childAlternates.languages },
      media: { ...parentAlternates.media, ...childAlternates.media },
      types: { ...parentAlternates.types, ...childAlternates.types },
    };
  } else if (childAlternates) {
    alt = childAlternates;
  } else if (parentAlternates) {
    alt = parentAlternates;
  }
  if (alt !== undefined) merged.alternates = alt;

  return merged;
}

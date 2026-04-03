import type { ClientMetadata } from "./types.js";

const MANAGED_ATTR = "data-capstan-head";
const MANAGED_VALUE = "navigation";
const MANAGED_KEY_ATTR = "data-capstan-head-key";

type HeadNode = Element & {
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  remove?: () => void;
};

function resolveTitle(title: NonNullable<ClientMetadata["title"]>): string {
  return typeof title === "string"
    ? title
    : title.template
      ? title.template.replace("%s", title.default)
      : title.default;
}

function getHead(): (ParentNode & {
  appendChild?(node: Node): Node;
  querySelectorAll?(selectors: string): NodeListOf<Element>;
  querySelector?(selectors: string): Element | null;
}) | null {
  return (document.head ?? null) as typeof document.head | null;
}

function markManaged(node: HeadNode, key: string): void {
  node.setAttribute(MANAGED_ATTR, MANAGED_VALUE);
  node.setAttribute(MANAGED_KEY_ATTR, key);
}

function updateOrCreate(head: NonNullable<ReturnType<typeof getHead>>, key: string, tagName: string, attrs: Record<string, string>): void {
  const selector = attrsToSelector(tagName, attrs);
  const existing = head.querySelector?.(selector) as HeadNode | null;
  if (existing) {
    for (const [name, value] of Object.entries(attrs)) {
      existing.setAttribute(name, value);
    }
    markManaged(existing, key);
    return;
  }

  if (typeof document.createElement !== "function" || typeof head.appendChild !== "function") {
    return;
  }

  const node = document.createElement(tagName) as HeadNode;
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value);
  }
  markManaged(node, key);
  head.appendChild(node);
}

function attrsToSelector(tagName: string, attrs: Record<string, string>): string {
  const parts = [tagName];
  for (const [name, value] of Object.entries(attrs)) {
    if (name === "content") continue;
    if (name === "charSet") {
      parts.push(`[${name.toLowerCase()}]`);
      continue;
    }
    if (name === "hreflang") {
      parts.push(`[hreflang="${cssEscape(value)}"]`);
      continue;
    }
    parts.push(`[${name}="${cssEscape(value)}"]`);
  }
  return parts.join("");
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function removeManaged(head: NonNullable<ReturnType<typeof getHead>>): void {
  const managed = head.querySelectorAll?.(`[${MANAGED_ATTR}="${MANAGED_VALUE}"]`);
  if (!managed) return;
  for (const node of Array.from(managed)) {
    node.remove?.();
  }
}

export function syncDocumentHead(metadata: ClientMetadata | undefined): void {
  const head = getHead();
  if (!metadata) {
    if (head) {
      removeManaged(head);
    }
    return;
  }

  if (metadata.title !== undefined) {
    document.title = resolveTitle(metadata.title);
  }

  if (!head) return;

  removeManaged(head);

  const descriptors: Array<{ key: string; tagName: string; attrs: Record<string, string> }> = [];

  if (metadata.description !== undefined) {
    descriptors.push({
      key: "meta:description",
      tagName: "meta",
      attrs: { name: "description", content: metadata.description },
    });
  }

  if (metadata.keywords?.length) {
    descriptors.push({
      key: "meta:keywords",
      tagName: "meta",
      attrs: { name: "keywords", content: metadata.keywords.join(", ") },
    });
  }

  if (metadata.robots !== undefined) {
    const robots = typeof metadata.robots === "string"
      ? metadata.robots
      : [
          metadata.robots.index === false ? "noindex" : "index",
          metadata.robots.follow === false ? "nofollow" : "follow",
        ].join(", ");
    descriptors.push({
      key: "meta:robots",
      tagName: "meta",
      attrs: { name: "robots", content: robots },
    });
  }

  if (metadata.canonical) {
    descriptors.push({
      key: "link:canonical",
      tagName: "link",
      attrs: { rel: "canonical", href: metadata.canonical },
    });
  }

  if (metadata.openGraph) {
    const og = metadata.openGraph;
    if (og.title) descriptors.push({ key: "meta:og:title", tagName: "meta", attrs: { property: "og:title", content: og.title } });
    if (og.description) descriptors.push({ key: "meta:og:description", tagName: "meta", attrs: { property: "og:description", content: og.description } });
    if (og.type) descriptors.push({ key: "meta:og:type", tagName: "meta", attrs: { property: "og:type", content: og.type } });
    if (og.url) descriptors.push({ key: "meta:og:url", tagName: "meta", attrs: { property: "og:url", content: og.url } });
    if (og.image) descriptors.push({ key: "meta:og:image", tagName: "meta", attrs: { property: "og:image", content: og.image } });
    if (og.siteName) descriptors.push({ key: "meta:og:site_name", tagName: "meta", attrs: { property: "og:site_name", content: og.siteName } });
  }

  if (metadata.twitter) {
    const tw = metadata.twitter;
    if (tw.card) descriptors.push({ key: "meta:twitter:card", tagName: "meta", attrs: { name: "twitter:card", content: tw.card } });
    if (tw.title) descriptors.push({ key: "meta:twitter:title", tagName: "meta", attrs: { name: "twitter:title", content: tw.title } });
    if (tw.description) descriptors.push({ key: "meta:twitter:description", tagName: "meta", attrs: { name: "twitter:description", content: tw.description } });
    if (tw.image) descriptors.push({ key: "meta:twitter:image", tagName: "meta", attrs: { name: "twitter:image", content: tw.image } });
  }

  if (metadata.icons) {
    if (metadata.icons.icon) descriptors.push({ key: "link:icon", tagName: "link", attrs: { rel: "icon", href: metadata.icons.icon } });
    if (metadata.icons.apple) descriptors.push({ key: "link:apple-touch-icon", tagName: "link", attrs: { rel: "apple-touch-icon", href: metadata.icons.apple } });
  }

  if (metadata.alternates) {
    for (const [lang, href] of Object.entries(metadata.alternates)) {
      descriptors.push({
        key: `link:alternate:${lang}`,
        tagName: "link",
        attrs: { rel: "alternate", hreflang: lang, href },
      });
    }
  }

  for (const descriptor of descriptors) {
    updateOrCreate(head, descriptor.key, descriptor.tagName, descriptor.attrs);
  }
}

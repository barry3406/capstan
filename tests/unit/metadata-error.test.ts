import { describe, it, expect } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  generateMetadataElements,
  defineMetadata,
  mergeMetadata,
  resolveMetadata,
} from "../../packages/react/src/metadata.ts";
import { ErrorBoundary, NotFound } from "../../packages/react/src/error-boundary.ts";
import type { Metadata } from "../../packages/react/src/types.ts";

// ---------------------------------------------------------------------------
// generateMetadataElements
// ---------------------------------------------------------------------------

describe("generateMetadataElements", () => {
  it("generates title from string", () => {
    const els = generateMetadataElements({ title: "My Page" });
    expect(els).toHaveLength(1);
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain("<title>My Page</title>");
  });

  it("generates title from object with template (%s replacement)", () => {
    const els = generateMetadataElements({
      title: { default: "Home", template: "%s | MySite" },
    });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain("<title>Home | MySite</title>");
  });

  it("generates title from object without template (uses default)", () => {
    const els = generateMetadataElements({
      title: { default: "Dashboard" },
    });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain("<title>Dashboard</title>");
  });

  it("applies template even when it omits %s by appending the title", () => {
    const els = generateMetadataElements({
      title: { default: "Dashboard", template: " | Capstan" },
    });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain("<title>Dashboard | Capstan</title>");
  });

  it("generates description meta tag", () => {
    const els = generateMetadataElements({ description: "A cool page" });
    expect(els).toHaveLength(1);
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('name="description"');
    expect(html).toContain('content="A cool page"');
  });

  it("generates keywords joined by comma", () => {
    const els = generateMetadataElements({ keywords: ["ai", "agent", "framework"] });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('content="ai, agent, framework"');
  });

  it("generates robots from string", () => {
    const els = generateMetadataElements({ robots: "noindex, nofollow" });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('name="robots"');
    expect(html).toContain('content="noindex, nofollow"');
  });

  it("generates robots from object with index:false → noindex", () => {
    const els = generateMetadataElements({ robots: { index: false, follow: true } });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('content="noindex, follow"');
  });

  it("generates robots from object with defaults (index, follow)", () => {
    const els = generateMetadataElements({ robots: {} });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('content="index, follow"');
  });

  it("generates canonical link", () => {
    const els = generateMetadataElements({ canonical: "https://example.com/page" });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('href="https://example.com/page"');
  });

  it("generates openGraph all fields", () => {
    const els = generateMetadataElements({
      openGraph: {
        title: "OG Title",
        description: "OG Desc",
        type: "website",
        url: "https://example.com",
        image: "https://example.com/img.png",
        siteName: "MySite",
      },
    });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('property="og:title"');
    expect(html).toContain('content="OG Title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('property="og:type"');
    expect(html).toContain('property="og:url"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('property="og:site_name"');
  });

  it("generates openGraph partial fields", () => {
    const els = generateMetadataElements({
      openGraph: { title: "Partial OG" },
    });
    expect(els).toHaveLength(1);
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('property="og:title"');
    expect(html).not.toContain("og:description");
  });

  it("generates twitter card", () => {
    const els = generateMetadataElements({
      twitter: {
        card: "summary_large_image",
        title: "TW Title",
        description: "TW Desc",
        image: "https://example.com/tw.png",
      },
    });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('content="summary_large_image"');
    expect(html).toContain('name="twitter:title"');
    expect(html).toContain('name="twitter:description"');
    expect(html).toContain('name="twitter:image"');
  });

  it("generates icons (icon + apple)", () => {
    const els = generateMetadataElements({
      icons: { icon: "/favicon.ico", apple: "/apple-icon.png" },
    });
    expect(els).toHaveLength(2);
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('href="/apple-icon.png"');
  });

  it("generates descriptor-based icons including shortcut and custom rel entries", () => {
    const els = generateMetadataElements({
      icons: {
        shortcut: [{ url: "/shortcut.ico", sizes: "48x48" }],
        other: [
          { rel: "mask-icon", url: "/mask.svg", color: "#111111" },
        ],
      },
    });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('rel="shortcut icon"');
    expect(html).toContain('sizes="48x48"');
    expect(html).toContain('rel="mask-icon"');
    expect(html).toContain('color="#111111"');
  });

  it("generates alternates hreflang", () => {
    const els = generateMetadataElements({
      alternates: { en: "https://example.com/en", zh: "https://example.com/zh" },
    });
    expect(els).toHaveLength(2);
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('rel="alternate"');
    expect(html).toContain('href="https://example.com/en"');
    expect(html).toContain('href="https://example.com/zh"');
  });

  it("generates structured alternates for media and type variants", () => {
    const els = generateMetadataElements({
      alternates: {
        media: { "only screen and (max-width: 600px)": "https://m.example.com" },
        types: { "application/rss+xml": "https://example.com/rss.xml" },
      },
    });
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('media="only screen and (max-width: 600px)"');
    expect(html).toContain('href="https://m.example.com"');
    expect(html).toContain('type="application/rss+xml"');
    expect(html).toContain('href="https://example.com/rss.xml"');
  });

  it("returns empty array for empty metadata", () => {
    const els = generateMetadataElements({});
    expect(els).toHaveLength(0);
    expect(els).toEqual([]);
  });

  it("returns no meta tag for empty keywords array", () => {
    const els = generateMetadataElements({ keywords: [] });
    expect(els).toHaveLength(0);
  });

  it("handles undefined metadata fields gracefully", () => {
    const meta: Metadata = {
      title: undefined,
      description: undefined,
      keywords: undefined,
    };
    const els = generateMetadataElements(meta);
    expect(els).toHaveLength(0);
  });

  it("handles alternates with no entries", () => {
    const els = generateMetadataElements({ alternates: {} });
    expect(els).toHaveLength(0);
  });

  it("handles openGraph with only image", () => {
    const els = generateMetadataElements({
      openGraph: { image: "https://example.com/hero.jpg" },
    });
    expect(els).toHaveLength(1);
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('property="og:image"');
    expect(html).not.toContain("og:title");
  });

  it("handles twitter with only card", () => {
    const els = generateMetadataElements({
      twitter: { card: "summary" },
    });
    expect(els).toHaveLength(1);
    const html = renderToString(createElement("head", null, ...els));
    expect(html).toContain('content="summary"');
  });

  it("drops blank metadata values instead of emitting empty tags", () => {
    const els = generateMetadataElements({
      title: "   ",
      description: "   ",
      canonical: "   ",
      robots: "   ",
      icons: {
        icon: ["   ", { url: " " }],
        other: [{ rel: "mask-icon", url: "   " }],
      },
      alternates: {
        languages: { en: "   " },
      },
    });
    expect(els).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resolveMetadata
// ---------------------------------------------------------------------------

describe("resolveMetadata", () => {
  it("resolves title template and social fallbacks from base metadata", () => {
    const resolved = resolveMetadata({
      title: { default: "Billing", template: "%s | Capstan" },
      description: "Billing page",
      canonical: "https://example.com/billing",
    });

    expect(resolved.title).toBe("Billing | Capstan");
    expect(resolved.openGraph).toEqual({
      title: "Billing | Capstan",
      description: "Billing page",
      url: "https://example.com/billing",
    });
    expect(resolved.twitter).toEqual({
      title: "Billing | Capstan",
      description: "Billing page",
    });
  });

  it("preserves explicit social overrides over base metadata fallbacks", () => {
    const resolved = resolveMetadata({
      title: "Base",
      description: "Base description",
      openGraph: { title: "OG title" },
      twitter: { description: "TW description", card: "summary" },
    });

    expect(resolved.openGraph).toEqual({
      title: "OG title",
      description: "Base description",
    });
    expect(resolved.twitter).toEqual({
      card: "summary",
      title: "Base",
      description: "TW description",
    });
  });

  it("normalizes robots object into a stable directive string", () => {
    const resolved = resolveMetadata({
      robots: {
        index: false,
        follow: true,
        noarchive: true,
        maxSnippet: 120,
        unavailableAfter: "2026-12-31",
      },
    });

    expect(resolved.robots).toBe(
      "noindex, follow, noarchive, unavailable_after:2026-12-31, max-snippet:120",
    );
  });

  it("normalizes icon and alternates collections into structured output", () => {
    const resolved = resolveMetadata({
      icons: {
        icon: ["/favicon.ico", { url: "/icon.svg", type: "image/svg+xml" }],
        other: [{ rel: "mask-icon", url: "/mask.svg", color: "#000000" }],
      },
      alternates: {
        languages: { en: "https://example.com/en" },
        media: { print: "https://example.com/print" },
      },
    });

    expect(resolved.icons).toEqual({
      icon: [
        { url: "/favicon.ico" },
        { url: "/icon.svg", type: "image/svg+xml" },
      ],
      apple: [],
      shortcut: [],
      other: [{ rel: "mask-icon", url: "/mask.svg", color: "#000000" }],
    });
    expect(resolved.alternates).toEqual({
      languages: { en: "https://example.com/en" },
      media: { print: "https://example.com/print" },
      types: {},
    });
  });
});

// ---------------------------------------------------------------------------
// defineMetadata
// ---------------------------------------------------------------------------

describe("defineMetadata", () => {
  it("returns the same metadata object (identity function)", () => {
    const meta: Metadata = { title: "Test", description: "Desc" };
    const result = defineMetadata(meta);
    expect(result).toBe(meta);
  });

  it("preserves all fields", () => {
    const meta: Metadata = {
      title: "T",
      description: "D",
      keywords: ["a"],
      canonical: "https://x.com",
    };
    expect(defineMetadata(meta)).toEqual(meta);
  });
});

// ---------------------------------------------------------------------------
// mergeMetadata
// ---------------------------------------------------------------------------

describe("mergeMetadata", () => {
  it("child overrides parent scalar fields", () => {
    const parent: Metadata = { title: "Parent", description: "Parent desc" };
    const child: Metadata = { title: "Child" };
    const merged = mergeMetadata(parent, child);
    expect(merged.title).toBe("Child");
    expect(merged.description).toBe("Parent desc");
  });

  it("parent fills gaps when child has no value", () => {
    const parent: Metadata = { title: "P", description: "PD", canonical: "https://p.com" };
    const child: Metadata = {};
    const merged = mergeMetadata(parent, child);
    expect(merged.title).toBe("P");
    expect(merged.description).toBe("PD");
    expect(merged.canonical).toBe("https://p.com");
  });

  it("merges nested openGraph objects", () => {
    const parent: Metadata = {
      openGraph: { title: "Parent OG", type: "website" },
    };
    const child: Metadata = {
      openGraph: { title: "Child OG", image: "https://img.png" },
    };
    const merged = mergeMetadata(parent, child);
    expect(merged.openGraph?.title).toBe("Child OG");
    expect(merged.openGraph?.type).toBe("website");
    expect(merged.openGraph?.image).toBe("https://img.png");
  });

  it("preserves parent title template when child provides a plain title string", () => {
    const parent: Metadata = {
      title: { default: "Capstan", template: "%s | Capstan" },
    };
    const child: Metadata = { title: "Billing" };
    const merged = mergeMetadata(parent, child);

    expect(merged.title).toEqual({ default: "Billing", template: "%s | Capstan" });
    expect(resolveMetadata(merged).title).toBe("Billing | Capstan");
  });

  it("allows child absolute title to bypass inherited parent template", () => {
    const parent: Metadata = {
      title: { default: "Capstan", template: "%s | Capstan" },
    };
    const child: Metadata = {
      title: { absolute: "Billing Console" },
    };
    const merged = mergeMetadata(parent, child);

    expect(resolveMetadata(merged).title).toBe("Billing Console");
  });

  it("merges robots objects instead of replacing them wholesale", () => {
    const parent: Metadata = {
      robots: { index: false, follow: true, noarchive: true },
    };
    const child: Metadata = {
      robots: { follow: false, maxSnippet: 50 },
    };
    const merged = mergeMetadata(parent, child);

    expect(merged.robots).toEqual({
      index: false,
      follow: false,
      noarchive: true,
      maxSnippet: 50,
    });
  });

  it("merges structured alternates by subsection", () => {
    const parent: Metadata = {
      alternates: {
        languages: { en: "/en" },
        media: { print: "/print-v1" },
      },
    };
    const child: Metadata = {
      alternates: {
        media: { print: "/print-v2" },
        types: { "application/rss+xml": "/feed.xml" },
      },
    };
    const merged = mergeMetadata(parent, child);

    expect(merged.alternates).toEqual({
      languages: { en: "/en" },
      media: { print: "/print-v2" },
      types: { "application/rss+xml": "/feed.xml" },
    });
  });

  it("child keywords override parent keywords entirely", () => {
    const parent: Metadata = { keywords: ["a", "b"] };
    const child: Metadata = { keywords: ["c"] };
    const merged = mergeMetadata(parent, child);
    expect(merged.keywords).toEqual(["c"]);
  });

  it("uses parent keywords when child has none", () => {
    const parent: Metadata = { keywords: ["x", "y"] };
    const child: Metadata = {};
    const merged = mergeMetadata(parent, child);
    expect(merged.keywords).toEqual(["x", "y"]);
  });

  it("merges twitter objects", () => {
    const parent: Metadata = { twitter: { card: "summary", title: "PT" } };
    const child: Metadata = { twitter: { title: "CT" } };
    const merged = mergeMetadata(parent, child);
    expect(merged.twitter?.card).toBe("summary");
    expect(merged.twitter?.title).toBe("CT");
  });

  it("merges icons objects", () => {
    const parent: Metadata = { icons: { icon: "/fav.ico" } };
    const child: Metadata = { icons: { apple: "/apple.png" } };
    const merged = mergeMetadata(parent, child);
    expect(merged.icons?.icon).toBe("/fav.ico");
    expect(merged.icons?.apple).toBe("/apple.png");
  });

  it("merges alternates objects", () => {
    const parent: Metadata = { alternates: { en: "/en" } };
    const child: Metadata = { alternates: { zh: "/zh" } };
    const merged = mergeMetadata(parent, child);
    expect(merged.alternates).toEqual({
      languages: { en: "/en", zh: "/zh" },
      media: {},
      types: {},
    });
  });

  it("child alternates override parent for same key", () => {
    const parent: Metadata = { alternates: { en: "/en-old" } };
    const child: Metadata = { alternates: { en: "/en-new" } };
    const merged = mergeMetadata(parent, child);
    expect(merged.alternates).toEqual({
      languages: { en: "/en-new" },
      media: {},
      types: {},
    });
  });

  it("merges two empty metadata objects", () => {
    const merged = mergeMetadata({}, {});
    expect(merged).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// ErrorBoundary
// ---------------------------------------------------------------------------

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    const html = renderToString(
      createElement(
        ErrorBoundary,
        { fallback: createElement("div", null, "Error!") },
        createElement("p", null, "All good"),
      ),
    );
    expect(html).toContain("All good");
    expect(html).not.toContain("Error!");
  });

  it("getDerivedStateFromError returns error state", () => {
    const err = new Error("boom");
    const state = ErrorBoundary.getDerivedStateFromError(err);
    expect(state).toEqual({ error: err });
  });

  it("renders static fallback when state has error", () => {
    // Simulate error state by rendering with error already set.
    // We test the render method directly via the class prototype.
    const fallback = createElement("div", null, "Caught it");
    const boundary = new ErrorBoundary({ fallback, children: createElement("p", null, "ok") });
    boundary.state = { error: new Error("boom") };
    const rendered = boundary.render();
    expect(rendered).toBe(fallback);
  });

  it("renders function fallback with error and reset when state has error", () => {
    const fallback = (error: Error, _reset: () => void) =>
      createElement("div", null, `Error: ${error.message}`);
    const boundary = new ErrorBoundary({ fallback, children: createElement("p", null, "ok") });
    const err = new Error("kaboom");
    boundary.state = { error: err };
    const rendered = boundary.render() as ReturnType<typeof createElement>;
    // The function fallback should have been called
    expect(rendered.props.children).toBe("Error: kaboom");
  });

  it("reset clears the error state", () => {
    const fallback = createElement("div", null, "Error");
    const boundary = new ErrorBoundary({ fallback });
    boundary.state = { error: new Error("test") };
    // Mock setState
    let newState: unknown = null;
    boundary.setState = ((s: unknown) => { newState = s; }) as typeof boundary.setState;
    boundary.reset();
    expect(newState).toEqual({ error: null, retryCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// NotFound
// ---------------------------------------------------------------------------

describe("NotFound", () => {
  it("renders 404 heading", () => {
    const html = renderToString(createElement(NotFound, {}));
    expect(html).toContain("404");
  });

  it("renders default message 'Page not found'", () => {
    const html = renderToString(createElement(NotFound, {}));
    expect(html).toContain("Page not found");
  });

  it("renders custom message", () => {
    const html = renderToString(createElement(NotFound, { message: "Gone!" }));
    expect(html).toContain("Gone!");
    expect(html).not.toContain("Page not found");
  });

  it("has capstan-not-found class", () => {
    const html = renderToString(createElement(NotFound, {}));
    expect(html).toContain("capstan-not-found");
  });
});

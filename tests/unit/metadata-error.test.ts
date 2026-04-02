import { describe, it, expect } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  generateMetadataElements,
  defineMetadata,
  mergeMetadata,
  ErrorBoundary,
  NotFound,
} from "@zauso-ai/capstan-react";
import type { Metadata } from "@zauso-ai/capstan-react";

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
    expect(merged.alternates?.en).toBe("/en");
    expect(merged.alternates?.zh).toBe("/zh");
  });

  it("child alternates override parent for same key", () => {
    const parent: Metadata = { alternates: { en: "/en-old" } };
    const child: Metadata = { alternates: { en: "/en-new" } };
    const merged = mergeMetadata(parent, child);
    expect(merged.alternates?.en).toBe("/en-new");
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
    expect(newState).toEqual({ error: null });
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

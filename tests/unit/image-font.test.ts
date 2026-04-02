import { describe, it, expect } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Image, defineFont, fontPreloadLink } from "@zauso-ai/capstan-react";
import type { ImageProps, FontConfig, FontResult } from "@zauso-ai/capstan-react";

// ---------------------------------------------------------------------------
// Image component
// ---------------------------------------------------------------------------

describe("Image", () => {
  it("renders img tag with src and alt", () => {
    const html = renderToString(createElement(Image, { src: "/photo.jpg", alt: "A photo" }));
    expect(html).toContain("<img");
    expect(html).toContain('src="/photo.jpg"');
    expect(html).toContain('alt="A photo"');
  });

  it("sets loading='lazy' by default", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test" }));
    expect(html).toContain('loading="lazy"');
  });

  it("priority=true sets loading='eager' and fetchPriority='high'", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test", priority: true }));
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');
  });

  it("generates srcset with multiple widths", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test" }));
    expect(html).toContain("srcSet=");
    expect(html).toContain("640w");
    expect(html).toContain("1920w");
  });

  it("srcset respects width constraint (no sizes > width*2)", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test", width: 400 }));
    // width*2 = 800, so 828 and above should be filtered out
    expect(html).toContain("640w");
    expect(html).toContain("750w");
    expect(html).not.toContain("828w");
    expect(html).not.toContain("1080w");
    expect(html).not.toContain("1920w");
  });

  it("quality defaults to 80", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test" }));
    expect(html).toContain("q=80");
  });

  it("custom quality in src query", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test", quality: 50 }));
    expect(html).toContain("q=50");
    expect(html).not.toContain("q=80");
  });

  it("placeholder='blur' adds background styles", () => {
    const html = renderToString(
      createElement(Image, {
        src: "/img.jpg",
        alt: "test",
        placeholder: "blur",
        blurDataURL: "data:image/png;base64,abc",
      }),
    );
    expect(html).toContain("background-image");
    expect(html).toContain("background-size:cover");
  });

  it("placeholder='blur' without blurDataURL has no background", () => {
    const html = renderToString(
      createElement(Image, {
        src: "/img.jpg",
        alt: "test",
        placeholder: "blur",
      }),
    );
    expect(html).not.toContain("background-image");
  });

  it("width/height attributes set", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test", width: 300, height: 200 }));
    expect(html).toContain('width="300"');
    expect(html).toContain('height="200"');
  });

  it("sizes attribute passed through", () => {
    const html = renderToString(
      createElement(Image, { src: "/img.jpg", alt: "test", sizes: "(max-width: 768px) 100vw, 50vw" }),
    );
    expect(html).toContain("sizes=");
    expect(html).toContain("100vw");
  });

  it("className passed through", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test", className: "hero-img" }));
    expect(html).toContain('class="hero-img"');
  });

  it("custom style merged with blur styles", () => {
    const html = renderToString(
      createElement(Image, {
        src: "/img.jpg",
        alt: "test",
        placeholder: "blur",
        blurDataURL: "data:image/png;base64,abc",
        style: { borderRadius: "8px" },
      }),
    );
    expect(html).toContain("border-radius:8px");
    expect(html).toContain("background-image");
  });

  it("no srcset when no valid widths", () => {
    // width=100, width*2=200, all predefined widths (640+) are too large
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test", width: 100 }));
    // srcset would be empty string, which is falsy, so should not be set
    expect(html).not.toContain("srcset=");
  });

  it("alt='' is valid (decorative image)", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "" }));
    expect(html).toContain('alt=""');
  });

  it("sets decoding='async'", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test" }));
    expect(html).toContain('decoding="async"');
  });

  it("uses width in src when width is provided", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test", width: 500 }));
    expect(html).toContain('src="/img.jpg?w=500&amp;q=80"');
  });

  it("does not modify src when no width", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test" }));
    expect(html).toContain('src="/img.jpg"');
  });

  it("loading prop overrides default lazy when not priority", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test", loading: "eager" }));
    expect(html).toContain('loading="eager"');
  });

  it("priority overrides explicit loading='lazy'", () => {
    const html = renderToString(createElement(Image, { src: "/img.jpg", alt: "test", priority: true, loading: "lazy" }));
    expect(html).toContain('loading="eager"');
  });
});

// ---------------------------------------------------------------------------
// defineFont
// ---------------------------------------------------------------------------

describe("defineFont", () => {
  it("returns className, style, and variable", () => {
    const result = defineFont({ family: "Inter" });
    expect(result.className).toBe("font-inter");
    expect(result.style.fontFamily).toContain("Inter");
    expect(result.variable).toBe("--font-inter");
  });

  it("className is sanitized family name", () => {
    const result = defineFont({ family: "Fira Code" });
    expect(result.className).toBe("font-fira-code");
  });

  it("style.fontFamily includes fallback", () => {
    const result = defineFont({ family: "Inter" });
    expect(result.style.fontFamily).toContain("system-ui");
    expect(result.style.fontFamily).toContain("sans-serif");
  });

  it("custom variable name used", () => {
    const result = defineFont({ family: "Inter", variable: "--my-font" });
    expect(result.variable).toBe("--my-font");
  });

  it("default variable generated from family", () => {
    const result = defineFont({ family: "Roboto Mono" });
    expect(result.variable).toBe("--font-roboto-mono");
  });

  it("special characters in family name sanitized", () => {
    const result = defineFont({ family: "Font@123!Special" });
    expect(result.className).toBe("font-font-123-special");
    expect(result.variable).toBe("--font-font-123-special");
  });

  it("weight and style preserved in config", () => {
    const config: FontConfig = { family: "Inter", weight: "700", style: "italic" };
    // defineFont doesn't use weight/style directly but they are part of the config
    const result = defineFont(config);
    expect(result.className).toBeTruthy();
    expect(config.weight).toBe("700");
    expect(config.style).toBe("italic");
  });

  it("family with numbers is sanitized correctly", () => {
    const result = defineFont({ family: "Source Sans 3" });
    expect(result.className).toBe("font-source-sans-3");
  });
});

// ---------------------------------------------------------------------------
// fontPreloadLink
// ---------------------------------------------------------------------------

describe("fontPreloadLink", () => {
  it("generates link tag with preload", () => {
    const link = fontPreloadLink({ family: "Inter", src: "/fonts/inter.woff2" });
    expect(link).toContain('rel="preload"');
    expect(link).toContain('href="/fonts/inter.woff2"');
    expect(link).toContain('as="font"');
    expect(link).toContain('type="font/woff2"');
    expect(link).toContain("crossorigin");
  });

  it("preload=false uses rel='stylesheet'", () => {
    const link = fontPreloadLink({ family: "Inter", src: "/fonts/inter.woff2", preload: false });
    expect(link).toContain('rel="stylesheet"');
    expect(link).not.toContain('rel="preload"');
  });

  it("no src returns empty string", () => {
    const link = fontPreloadLink({ family: "Inter" });
    expect(link).toBe("");
  });

  it("preload=true explicitly generates preload link", () => {
    const link = fontPreloadLink({ family: "Inter", src: "/fonts/inter.woff2", preload: true });
    expect(link).toContain('rel="preload"');
  });
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

describe("type exports", () => {
  it("ImageProps type is usable", () => {
    const props: ImageProps = { src: "/img.jpg", alt: "test" };
    expect(props.src).toBe("/img.jpg");
  });

  it("FontConfig type is usable", () => {
    const config: FontConfig = { family: "Inter", display: "swap", subsets: ["latin"] };
    expect(config.family).toBe("Inter");
    expect(config.subsets).toEqual(["latin"]);
  });

  it("FontResult type is usable", () => {
    const result: FontResult = { className: "font-inter", style: { fontFamily: "Inter" }, variable: "--font-inter" };
    expect(result.className).toBe("font-inter");
  });
});

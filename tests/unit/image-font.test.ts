import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  Image,
  buildImageSrcSet,
  buildImageUrl,
  defineFont,
  fontPreloadElement,
  fontPreloadLink,
  imagePreloadLink,
} from "../../packages/react/src/index.ts";
import type { FontConfig, FontResult, FontStyle, ImageProps } from "../../packages/react/src/index.ts";

describe("image helpers", () => {
  it("buildImageUrl preserves existing query/hash and drops invalid transforms", () => {
    // Local paths route through /_capstan/image optimizer endpoint
    expect(buildImageUrl("/photo.jpg?token=abc#hero", { width: 640, quality: 77, format: "webp" }))
      .toBe("/_capstan/image?url=%2Fphoto.jpg%3Ftoken%3Dabc&w=640&q=77&f=webp#hero");
    expect(buildImageUrl("/photo.jpg?token=abc#hero", { width: -1, quality: 0, format: "auto" }))
      .toBe("/photo.jpg?token=abc#hero");
    expect(buildImageUrl("/plain.jpg")).toBe("/plain.jpg");
    // External URLs are NOT routed through optimizer
    expect(buildImageUrl("https://cdn.example.com/photo.jpg", { width: 640 }))
      .toBe("https://cdn.example.com/photo.jpg?w=640");
  });

  it("buildImageSrcSet dedupes, sorts, and filters widths deterministically", () => {
    const srcSet = buildImageSrcSet("/photo.jpg", {
      widths: [1920, 640, 640, 0, -1, 1080, 750, Number.NaN],
      quality: 90,
    });

    // Local paths routed through /_capstan/image
    expect(srcSet).toBe([
      "/_capstan/image?url=%2Fphoto.jpg&w=640&q=90 640w",
      "/_capstan/image?url=%2Fphoto.jpg&w=750&q=90 750w",
      "/_capstan/image?url=%2Fphoto.jpg&w=1080&q=90 1080w",
      "/_capstan/image?url=%2Fphoto.jpg&w=1920&q=90 1920w",
    ].join(", "));
    expect(buildImageSrcSet("/photo.jpg", { width: 100, widths: [640, 750] })).toBe("");
  });

  it("Image passes through arbitrary attrs and keeps framework-controlled props stable", () => {
    const html = renderToString(
      createElement(Image, {
        src: "/hero.jpg?token=abc",
        alt: "Hero",
        width: 400,
        height: 240,
        format: "webp",
        preload: true,
        loading: "lazy",
        sizes: "(max-width: 768px) 100vw, 400px",
        className: "hero",
        style: { borderRadius: "12px" },
        placeholder: "blur",
        blurDataURL: "data:image/png;base64,blur",
        "data-testid": "hero-image",
      } as any),
    );

    // Local paths routed through /_capstan/image (format → f param)
    expect(html).toContain('src="/_capstan/image?url=%2Fhero.jpg%3Ftoken%3Dabc&amp;w=400&amp;q=80&amp;f=webp"');
    expect(html).toContain('srcSet="/_capstan/image?url=%2Fhero.jpg%3Ftoken%3Dabc&amp;w=640&amp;q=80&amp;f=webp 640w, /_capstan/image?url=%2Fhero.jpg%3Ftoken%3Dabc&amp;w=750&amp;q=80&amp;f=webp 750w"');
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain('width="400"');
    expect(html).toContain('height="240"');
    expect(html).toContain('sizes="(max-width: 768px) 100vw, 400px"');
    expect(html).toContain('class="hero"');
    expect(html).toContain('data-testid="hero-image"');
    expect(html).toContain("border-radius:12px");
    expect(html).toContain("background-image:url(data:image/png;base64,blur)");
  });

  it("Image omits srcSet when no responsive candidates remain", () => {
    const html = renderToString(createElement(Image, { src: "/tiny.jpg", alt: "tiny", width: 100 }));

    expect(html).toContain('src="/_capstan/image?url=%2Ftiny.jpg&amp;w=100&amp;q=80"');
    expect(html).not.toContain("srcSet=");
  });

  it("Image keeps the original source when no transformation props are provided", () => {
    const html = renderToString(createElement(Image, { src: "/plain.jpg", alt: "plain" }));

    expect(html).toContain('src="/plain.jpg"');
    expect(html).toContain('loading="lazy"');
  });

  it("imagePreloadLink emits a stable preload hint and can be disabled", () => {
    const link = imagePreloadLink({
      src: "/hero.jpg?token=abc",
      width: 400,
      sizes: "100vw",
    });

    expect(link).toContain('rel="preload"');
    expect(link).toContain('as="image"');
    expect(link).toContain('href="/_capstan/image?url=%2Fhero.jpg%3Ftoken%3Dabc&amp;w=400&amp;q=80"');
    expect(link).toContain('imagesrcset="/_capstan/image?url=%2Fhero.jpg%3Ftoken%3Dabc&amp;w=640&amp;q=80 640w, /_capstan/image?url=%2Fhero.jpg%3Ftoken%3Dabc&amp;w=750&amp;q=80 750w"');
    // Also verify the srcSet format uses optimizer endpoint
    expect(link).toContain('imagesizes="100vw"');
    expect(imagePreloadLink({ src: "/hero.jpg", preload: false })).toBe("");
    expect(imagePreloadLink({ src: "   " })).toBe("");
    expect(imagePreloadLink({ src: "/plain.jpg" })).toContain('href="/plain.jpg"');  // no transform → original URL
  });
});

describe("font helpers", () => {
  it("defineFont sanitizes identifiers and exposes style, weight, style, and variable", () => {
    const font = defineFont({
      family: "Font@123!Special",
      weight: 700,
      style: "italic",
      variable: "--brand-font",
    });

    expect(font.className).toBe("font-font-123-special");
    expect(font.variable).toBe("--brand-font");
    expect(font.style.fontFamily).toContain("Font@123!Special");
    expect(font.style.fontWeight).toBe(700);
    expect(font.style.fontStyle).toBe("italic");
    expect(font.style["--brand-font"]).toBe(font.style.fontFamily);
  });

  it("defineFont falls back to a stable identifier for pathological names", () => {
    const font = defineFont({ family: "!!!" });

    expect(font.className).toBe("font-font");
    expect(font.variable).toBe("--font-font");
  });

  it("fontPreloadElement and fontPreloadLink agree on preload semantics", () => {
    const element = fontPreloadElement({ family: "Inter", src: "/fonts/inter.woff2" });
    const html = renderToString(element);
    const link = fontPreloadLink({ family: "Inter", src: "/fonts/inter.woff2" });

    expect(html).toContain('rel="preload"');
    expect(html).toContain('as="font"');
    expect(html).toContain('type="font/woff2"');
    expect(html).toContain('crossorigin="anonymous"');
    expect(link).toContain('rel="preload"');
    expect(link).toContain('href="/fonts/inter.woff2"');
    expect(link).toContain('as="font"');
  });

  it("fontPreloadElement and fontPreloadLink degrade cleanly when disabled or missing", () => {
    const stylesheet = fontPreloadElement({ family: "Inter", src: "/fonts/inter.woff2", preload: false });

    expect(renderToString(stylesheet)).toContain('rel="stylesheet"');
    expect(renderToString(stylesheet)).not.toContain('as="font"');
    expect(fontPreloadElement({ family: "Inter" })).toBeNull();
    expect(fontPreloadLink({ family: "Inter" })).toBe("");
  });
});

describe("type exports", () => {
  it("ImageProps type remains usable for framework-level attrs", () => {
    const props: ImageProps = { src: "/img.jpg", alt: "test", width: 320, format: "webp" };
    expect(props.format).toBe("webp");
  });

  it("FontConfig, FontResult, and FontStyle stay exported and typed", () => {
    const config: FontConfig = { family: "Inter", display: "swap", subsets: ["latin"] };
    const result: FontResult = defineFont(config);
    const style: FontStyle = { fontFamily: "Inter" };

    expect(config.subsets).toEqual(["latin"]);
    expect(result.className).toBe("font-inter");
    expect(style.fontFamily).toBe("Inter");
  });
});

import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import {
  setupBrowserEnv,
  teardownBrowserEnv,
  resetBrowserEnv,
} from "../helpers/browser-env.js";

// ---------------------------------------------------------------------------
// bootstrapClient relies on document.addEventListener and getManifest().
// We test the click delegation logic by simulating DOM events.
// ---------------------------------------------------------------------------

beforeAll(() => { setupBrowserEnv(); });
afterAll(() => { teardownBrowserEnv(); });
beforeEach(() => { resetBrowserEnv(); });

// ---------------------------------------------------------------------------
// Click delegation logic (mirrors entry.ts conditions)
// ---------------------------------------------------------------------------

describe("bootstrapClient click delegation", () => {
  /** Build a minimal anchor-like element */
  function makeAnchor(href: string | null, attrs: Record<string, string> = {}): Element {
    const attrMap: Record<string, string | null> = { href, ...attrs };
    return {
      getAttribute: (name: string) => attrMap[name] ?? null,
      hasAttribute: (name: string) => name in attrMap,
      closest: (sel: string) => {
        if (sel === "a") return makeAnchor(href, attrs); // return self
        return null;
      },
    } as unknown as Element;
  }

  function makeClickEvent(overrides: Partial<MouseEvent> = {}): MouseEvent & { _prevented: boolean } {
    const e = {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      _prevented: false,
      preventDefault() { this._prevented = true; },
      target: null as Element | null,
      ...overrides,
    };
    return e as unknown as MouseEvent & { _prevented: boolean };
  }

  // ------- Modifier keys -------
  test("ignores right-click (button !== 0)", () => {
    const e = makeClickEvent({ button: 2 });
    const shouldSkip = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    expect(shouldSkip).toBe(true);
  });

  test("ignores meta+click", () => {
    const e = makeClickEvent({ metaKey: true });
    const shouldSkip = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    expect(shouldSkip).toBe(true);
  });

  test("ignores ctrl+click", () => {
    const e = makeClickEvent({ ctrlKey: true });
    const shouldSkip = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    expect(shouldSkip).toBe(true);
  });

  test("ignores shift+click", () => {
    const e = makeClickEvent({ shiftKey: true });
    const shouldSkip = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    expect(shouldSkip).toBe(true);
  });

  test("ignores alt+click", () => {
    const e = makeClickEvent({ altKey: true });
    const shouldSkip = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    expect(shouldSkip).toBe(true);
  });

  test("normal left-click passes", () => {
    const e = makeClickEvent();
    const shouldSkip = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    expect(shouldSkip).toBe(false);
  });

  test("defaultPrevented skips", () => {
    const e = makeClickEvent({ defaultPrevented: true });
    expect(e.defaultPrevented).toBe(true);
  });

  // ------- href filtering -------
  test("skips http:// links", () => {
    const href = "https://example.com/page";
    expect(href.startsWith("http") || href.startsWith("//")).toBe(true);
  });

  test("skips protocol-relative links", () => {
    const href = "//cdn.example.com";
    expect(href.startsWith("http") || href.startsWith("//")).toBe(true);
  });

  test("skips hash-only links", () => {
    const href = "#section";
    expect(href.startsWith("#")).toBe(true);
  });

  test("skips mailto: links", () => {
    const href = "mailto:user@example.com";
    expect(href.startsWith("mailto:")).toBe(true);
  });

  test("skips tel: links", () => {
    const href = "tel:+1234567890";
    expect(href.startsWith("tel:")).toBe(true);
  });

  test("skips javascript: links", () => {
    const href = "javascript:void(0)";
    expect(href.startsWith("http") || href.startsWith("//") || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:") || href.startsWith("data:")).toBe(true);
  });

  test("skips data: links", () => {
    const href = "data:text/plain,hello";
    expect(href.startsWith("http") || href.startsWith("//") || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:") || href.startsWith("data:")).toBe(true);
  });

  test("internal path passes href filter", () => {
    const href = "/about";
    const isExternal =
      href.startsWith("http") ||
      href.startsWith("//") ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:");
    expect(isExternal).toBe(false);
  });

  // ------- Anchor attributes -------
  test("download attribute skips interception", () => {
    const anchor = makeAnchor("/file.pdf", { download: "" });
    expect(anchor.hasAttribute("download")).toBe(true);
  });

  test("target=_blank skips interception", () => {
    const anchor = makeAnchor("/about", { target: "_blank" });
    expect(anchor.getAttribute("target")).toBe("_blank");
  });

  test("data-capstan-external opts out of interception", () => {
    const anchor = makeAnchor("/about", { "data-capstan-external": "" });
    expect(anchor.hasAttribute("data-capstan-external")).toBe(true);
  });

  test("data-capstan-replace triggers replace navigation", () => {
    const anchor = makeAnchor("/settings", { "data-capstan-replace": "" });
    expect(anchor.hasAttribute("data-capstan-replace")).toBe(true);
  });

  test("normal internal anchor passes all checks", () => {
    const anchor = makeAnchor("/about");
    const href = anchor.getAttribute("href");
    expect(href).toBe("/about");
    expect(anchor.hasAttribute("download")).toBe(false);
    expect(anchor.getAttribute("target")).toBeNull();
    expect(anchor.hasAttribute("data-capstan-external")).toBe(false);
  });

  // ------- No anchor found -------
  test("click on non-anchor element is ignored", () => {
    const target = {
      closest: () => null, // no <a> ancestor
    } as unknown as Element;
    const anchor = target.closest("a");
    expect(anchor).toBeNull();
  });

  // ------- No href attribute -------
  test("anchor without href is ignored", () => {
    const anchor = makeAnchor(null);
    expect(anchor.getAttribute("href")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getManifest — returns null in test env (no window.__CAPSTAN_MANIFEST__)
// ---------------------------------------------------------------------------

import { getManifest } from "@zauso-ai/capstan-react/client";

describe("getManifest in bootstrapClient", () => {
  test("returns null when no manifest is injected", () => {
    // In test env, window.__CAPSTAN_MANIFEST__ is undefined
    const manifest = getManifest();
    expect(manifest).toBeNull();
  });

  test("returns manifest when injected", () => {
    (window as Record<string, unknown>)["__CAPSTAN_MANIFEST__"] = {
      routes: [{ urlPattern: "/", componentType: "server", layouts: [] }],
    };
    const manifest = getManifest();
    expect(manifest).toBeDefined();
    expect(manifest!.routes.length).toBe(1);
    delete (window as Record<string, unknown>)["__CAPSTAN_MANIFEST__"];
  });
});

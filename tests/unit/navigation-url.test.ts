import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import {
  setupBrowserEnv,
  teardownBrowserEnv,
  resetBrowserEnv,
} from "../helpers/browser-env.js";
import { normalizeClientNavigationUrl } from "@zauso-ai/capstan-react/client";

beforeAll(() => { setupBrowserEnv(); });
afterAll(() => { teardownBrowserEnv(); });
beforeEach(() => { resetBrowserEnv(); });

describe("normalizeClientNavigationUrl", () => {
  test("normalizes same-origin absolute URLs to internal hrefs", () => {
    Object.defineProperty(window.location, "href", {
      value: "https://example.com/base",
      writable: true,
      configurable: true,
    });
    (window.location as Record<string, unknown>)["pathname"] = "/base";

    const target = normalizeClientNavigationUrl("https://example.com/about?ref=1#team");

    expect(target).toEqual({
      href: "/about?ref=1#team",
      requestUrl: "/about?ref=1",
      pathname: "/about",
      search: "?ref=1",
      hash: "#team",
      origin: "https://example.com",
    });
  });

  test("returns null for cross-origin and unsafe schemes", () => {
    expect(normalizeClientNavigationUrl("https://other.example.com/about")).toBeNull();
    expect(normalizeClientNavigationUrl("javascript:void(0)")).toBeNull();
    expect(normalizeClientNavigationUrl("mailto:user@example.com")).toBeNull();
  });

  test("resolves empty href against the current location", () => {
    Object.defineProperty(window.location, "href", {
      value: "https://example.com/posts/1?tab=notes#top",
      writable: true,
      configurable: true,
    });
    (window.location as Record<string, unknown>)["pathname"] = "/posts/1";
    (window.location as Record<string, unknown>)["search"] = "?tab=notes";
    (window.location as Record<string, unknown>)["hash"] = "#top";

    const target = normalizeClientNavigationUrl("");

    expect(target?.href).toBe("/posts/1?tab=notes#top");
    expect(target?.requestUrl).toBe("/posts/1?tab=notes");
  });
});


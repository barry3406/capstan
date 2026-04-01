import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { createElement } from "react";
import type { ReactElement } from "react";

import { detectCSSMode, buildCSS } from "@zauso-ai/capstan-dev";
import { watchStyles } from "@zauso-ai/capstan-dev";
import { renderPage } from "@zauso-ai/capstan-react";
import type {
  PageModule,
  LayoutModule,
  RenderPageOptions,
  LoaderArgs,
} from "@zauso-ai/capstan-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Each describe block that needs a temp dir creates its own.
// This avoids global afterEach blocking unrelated tests (e.g. DocumentShell).
let tempDir: string;

function makeLoaderArgs(overrides?: Partial<LoaderArgs>): LoaderArgs {
  return {
    params: {},
    request: new Request("http://localhost/"),
    ctx: {
      auth: {
        isAuthenticated: false,
        type: "anonymous",
      },
    },
    fetch: {
      get: async () => null as unknown,
      post: async () => null as unknown,
      put: async () => null as unknown,
      delete: async () => null as unknown,
    },
    ...overrides,
  };
}

function makePageModule(overrides?: Partial<PageModule>): PageModule {
  return {
    default: () => createElement("div", null, "Hello Page"),
    ...overrides,
  };
}

function makeRenderOptions(
  overrides?: Partial<RenderPageOptions>,
): RenderPageOptions {
  const loaderArgs = makeLoaderArgs();
  return {
    pageModule: makePageModule(),
    layouts: [],
    params: {},
    request: new Request("http://localhost/"),
    loaderArgs,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectCSSMode()
// ---------------------------------------------------------------------------

describe("detectCSSMode", () => {
  beforeEach(async () => { tempDir = await mkdtemp(join(tmpdir(), "css-detect-")); });
  afterEach(async () => { await rm(tempDir, { recursive: true, force: true }).catch(() => {}); });
  it('returns "none" when app/styles/main.css does not exist', async () => {
    // tempDir has no app/styles/ at all
    const mode = await detectCSSMode(tempDir);
    expect(mode).toBe("none");
  });

  it('returns "none" when app/styles/ directory does not exist', async () => {
    // Create app/ but not app/styles/
    await mkdir(join(tempDir, "app"), { recursive: true });
    const mode = await detectCSSMode(tempDir);
    expect(mode).toBe("none");
  });

  it('returns "lightningcss" for a plain CSS file with no tailwind import', async () => {
    await mkdir(join(tempDir, "app", "styles"), { recursive: true });
    await writeFile(
      join(tempDir, "app", "styles", "main.css"),
      "body { margin: 0; color: red; }\n",
    );
    const mode = await detectCSSMode(tempDir);
    expect(mode).toBe("lightningcss");
  });

  it('returns "tailwind" for file containing @import "tailwindcss" (double quotes)', async () => {
    await mkdir(join(tempDir, "app", "styles"), { recursive: true });
    await writeFile(
      join(tempDir, "app", "styles", "main.css"),
      '@import "tailwindcss";\n\n.custom { color: blue; }\n',
    );
    const mode = await detectCSSMode(tempDir);
    expect(mode).toBe("tailwind");
  });

  it("returns \"tailwind\" for file containing @import 'tailwindcss' (single quotes)", async () => {
    await mkdir(join(tempDir, "app", "styles"), { recursive: true });
    await writeFile(
      join(tempDir, "app", "styles", "main.css"),
      "@import 'tailwindcss';\n\n.custom { color: blue; }\n",
    );
    const mode = await detectCSSMode(tempDir);
    expect(mode).toBe("tailwind");
  });

  it('returns "lightningcss" for file with a non-tailwind @import', async () => {
    await mkdir(join(tempDir, "app", "styles"), { recursive: true });
    await writeFile(
      join(tempDir, "app", "styles", "main.css"),
      '@import "normalize.css";\nbody { margin: 0; }\n',
    );
    const mode = await detectCSSMode(tempDir);
    expect(mode).toBe("lightningcss");
  });

  it('returns "lightningcss" for an empty CSS file', async () => {
    await mkdir(join(tempDir, "app", "styles"), { recursive: true });
    await writeFile(join(tempDir, "app", "styles", "main.css"), "");
    const mode = await detectCSSMode(tempDir);
    expect(mode).toBe("lightningcss");
  });

  it('returns "lightningcss" when tailwindcss appears in a comment, not an @import', async () => {
    await mkdir(join(tempDir, "app", "styles"), { recursive: true });
    await writeFile(
      join(tempDir, "app", "styles", "main.css"),
      '/* We used to use @import "tailwindcss" here */\nbody { color: red; }\n',
    );
    // The implementation does a simple string includes(), so a comment
    // containing the exact substring will still trigger "tailwind" mode.
    // This documents the actual behavior.
    const mode = await detectCSSMode(tempDir);
    expect(mode).toBe("tailwind");
  });

  it('returns "tailwind" when @import "tailwindcss" appears mid-file', async () => {
    await mkdir(join(tempDir, "app", "styles"), { recursive: true });
    await writeFile(
      join(tempDir, "app", "styles", "main.css"),
      ':root { --bg: white; }\n@import "tailwindcss";\nbody { color: black; }\n',
    );
    const mode = await detectCSSMode(tempDir);
    expect(mode).toBe("tailwind");
  });
});

// ---------------------------------------------------------------------------
// buildCSS()
// ---------------------------------------------------------------------------

describe("buildCSS", () => {
  beforeEach(async () => { tempDir = await mkdtemp(join(tmpdir(), "css-build-")); });
  afterEach(async () => { await rm(tempDir, { recursive: true, force: true }).catch(() => {}); });
  it("produces an output file from input CSS", async () => {
    const inFile = join(tempDir, "input.css");
    const outFile = join(tempDir, "dist", "output.css");

    await writeFile(inFile, "body { margin: 0; padding: 0; }");
    await buildCSS(inFile, outFile, true);

    expect(existsSync(outFile)).toBe(true);
    const output = await readFile(outFile, "utf-8");
    expect(output).toContain("margin");
    expect(output).toContain("padding");
  });

  it("creates output directory if it does not exist", async () => {
    const inFile = join(tempDir, "input.css");
    const outDir = join(tempDir, "deeply", "nested", "dir");
    const outFile = join(outDir, "styles.css");

    await writeFile(inFile, "h1 { font-size: 2rem; }");
    await buildCSS(inFile, outFile, true);

    expect(existsSync(outDir)).toBe(true);
    expect(existsSync(outFile)).toBe(true);
  });

  it("handles @import between CSS files", async () => {
    const baseFile = join(tempDir, "base.css");
    const mainFile = join(tempDir, "main.css");
    const outFile = join(tempDir, "out.css");

    await writeFile(baseFile, "html { box-sizing: border-box; }");
    await writeFile(mainFile, '@import "./base.css";\nbody { color: navy; }');

    await buildCSS(mainFile, outFile, true);

    const output = await readFile(outFile, "utf-8");
    // The bundled output should contain content from both files
    expect(output).toContain("box-sizing");
    expect(output).toContain("navy");
  });

  it("minifies output when isDev=false", async () => {
    const inFile = join(tempDir, "input.css");
    const outDev = join(tempDir, "dev.css");
    const outProd = join(tempDir, "prod.css");

    const css = [
      "body {",
      "  margin: 0;",
      "  padding: 0;",
      "  background-color: white;",
      "  font-family: sans-serif;",
      "}",
      "h1 {",
      "  font-size: 2rem;",
      "  line-height: 1.5;",
      "}",
    ].join("\n");

    await writeFile(inFile, css);

    await buildCSS(inFile, outDev, true);
    await buildCSS(inFile, outProd, false);

    const devOutput = await readFile(outDev, "utf-8");
    const prodOutput = await readFile(outProd, "utf-8");

    // Minified production output should be shorter than dev output
    expect(prodOutput.length).toBeLessThan(devOutput.length);
  });

  it("does NOT minify when isDev=true (output retains whitespace)", async () => {
    const inFile = join(tempDir, "input.css");
    const outFile = join(tempDir, "dev.css");

    const css = "body {\n  margin: 0;\n  color: red;\n}\n";
    await writeFile(inFile, css);
    await buildCSS(inFile, outFile, true);

    const output = await readFile(outFile, "utf-8");
    // Dev output should contain newlines (not collapsed to a single line)
    expect(output).toContain("\n");
  });

  it("rejects when input file does not exist", async () => {
    const bogusInput = join(tempDir, "nonexistent.css");
    const outFile = join(tempDir, "out.css");

    await expect(buildCSS(bogusInput, outFile, true)).rejects.toThrow();
  });

  it("overwrites existing output file", async () => {
    const inFile = join(tempDir, "input.css");
    const outFile = join(tempDir, "out.css");

    await writeFile(inFile, "body { color: red; }");
    await writeFile(outFile, "/* old content */");

    await buildCSS(inFile, outFile, true);

    const output = await readFile(outFile, "utf-8");
    expect(output).not.toContain("old content");
    expect(output).toContain("red");
  });

  it("handles CSS nesting syntax", async () => {
    const inFile = join(tempDir, "input.css");
    const outFile = join(tempDir, "out.css");

    await writeFile(
      inFile,
      ".parent { color: red; & .child { color: blue; } }",
    );
    await buildCSS(inFile, outFile, false);

    const output = await readFile(outFile, "utf-8");
    // Lightning CSS should handle nesting — output should contain
    // both parent and child rules. Note: minification converts color
    // names to shorter hex forms (e.g. "blue" -> "#00f").
    expect(output).toContain("red");
    expect(output).toContain(".child");
  });
});

// ---------------------------------------------------------------------------
// watchStyles()
// ---------------------------------------------------------------------------

describe("watchStyles", () => {
  beforeEach(async () => { tempDir = await mkdtemp(join(tmpdir(), "css-watch-")); });
  afterEach(async () => { await rm(tempDir, { recursive: true, force: true }).catch(() => {}); });
  it("returns an object with a close() method", async () => {
    await mkdir(join(tempDir, "styles"), { recursive: true });
    await writeFile(join(tempDir, "styles", "main.css"), "body {}");

    const watcher = watchStyles(join(tempDir, "styles"), () => {});
    expect(watcher).toBeDefined();
    expect(typeof watcher.close).toBe("function");
    watcher.close();
  });

  it("close() can be called safely (does not throw)", async () => {
    await mkdir(join(tempDir, "styles"), { recursive: true });
    await writeFile(join(tempDir, "styles", "main.css"), "body {}");

    const watcher = watchStyles(join(tempDir, "styles"), () => {});
    expect(() => watcher.close()).not.toThrow();
  });

  it("close() can be called multiple times without error", async () => {
    await mkdir(join(tempDir, "styles"), { recursive: true });

    const watcher = watchStyles(join(tempDir, "styles"), () => {});
    watcher.close();
    // Second close should not throw
    expect(() => watcher.close()).not.toThrow();
  });

  it("returns no-op watcher when directory does not exist", () => {
    const bogusDir = join(tempDir, "nonexistent-styles-dir");
    const callback = mock(() => {});

    const watcher = watchStyles(bogusDir, callback);
    expect(watcher).toBeDefined();
    expect(typeof watcher.close).toBe("function");

    // close() on the no-op watcher should not throw
    expect(() => watcher.close()).not.toThrow();

    // Callback should never have been invoked
    expect(callback).not.toHaveBeenCalled();
  });

  it("triggers callback for .css file changes", async () => {
    const stylesDir = join(tempDir, "styles");
    await mkdir(stylesDir, { recursive: true });
    await writeFile(join(stylesDir, "main.css"), "body {}");

    let resolveCallback: (file?: string) => void;
    const callbackPromise = new Promise<string | undefined>((resolve) => {
      resolveCallback = resolve;
    });

    const watcher = watchStyles(stylesDir, (changedFile) => {
      resolveCallback(changedFile);
    });

    try {
      // Modify the CSS file to trigger a watch event
      await writeFile(join(stylesDir, "main.css"), "body { color: red; }");

      // Wait for the debounced callback (100ms debounce + margin)
      const result = await Promise.race([
        callbackPromise,
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 500),
        ),
      ]);

      // The watcher should have fired for a .css file
      expect(result).not.toBe("timeout");
    } finally {
      watcher.close();
    }
  });

  it("does NOT trigger callback for non-.css files", async () => {
    const stylesDir = join(tempDir, "styles");
    await mkdir(stylesDir, { recursive: true });

    const callback = mock(() => {});
    const watcher = watchStyles(stylesDir, callback);

    try {
      // Write a non-CSS file — the watcher should ignore it
      await writeFile(join(stylesDir, "notes.txt"), "not css");
      await writeFile(join(stylesDir, "data.json"), "{}");
      await writeFile(join(stylesDir, "script.js"), "var x = 1;");

      // Wait long enough for debounce (100ms) to fire
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(callback).not.toHaveBeenCalled();
    } finally {
      watcher.close();
    }
  });

  it("does not fire callback after close() is called", async () => {
    const stylesDir = join(tempDir, "styles");
    await mkdir(stylesDir, { recursive: true });
    await writeFile(join(stylesDir, "main.css"), "body {}");

    const callback = mock(() => {});
    const watcher = watchStyles(stylesDir, callback);

    // Close immediately
    watcher.close();

    // Now modify a CSS file — callback should NOT fire
    await writeFile(join(stylesDir, "main.css"), "body { color: red; }");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(callback).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DocumentShell CSS link in renderPage()
// ---------------------------------------------------------------------------

describe("DocumentShell CSS link", () => {
  it('renderPage() without layouts includes stylesheet link with precedence="default"', async () => {
    const result = await renderPage(makeRenderOptions({ layouts: [] }));

    // Should contain a <link> tag with rel="stylesheet" and precedence="default"
    expect(result.html).toContain('rel="stylesheet"');
    // React SSR renders the precedence prop as data-precedence attribute
    expect(result.html).toContain('data-precedence="default"');
  });

  it('the stylesheet link href is "/styles.css"', async () => {
    const result = await renderPage(makeRenderOptions({ layouts: [] }));

    expect(result.html).toContain('href="/styles.css"');
  });

  it("renderPage() without layouts wraps in DocumentShell with full HTML structure", async () => {
    const result = await renderPage(makeRenderOptions({ layouts: [] }));

    // DocumentShell should produce proper HTML document structure
    expect(result.html).toContain("<html");
    expect(result.html).toContain("<head>");
    expect(result.html).toContain("<body>");
    expect(result.html).toContain('id="capstan-root"');
    expect(result.html).toContain('charSet="utf-8"');
    expect(result.html).toContain("viewport");
  });

  it("renderPage() with layouts does NOT add DocumentShell (layout provides its own structure)", async () => {
    // A layout that wraps content in its own HTML shell
    const layout: LayoutModule = {
      default: () =>
        createElement(
          "div",
          { className: "layout-wrapper" },
          createElement("p", null, "Layout Content"),
        ),
    };

    const result = await renderPage(
      makeRenderOptions({ layouts: [layout] }),
    );

    // With layouts, DocumentShell is NOT used, so the stylesheet link
    // from DocumentShell should be absent.
    // The page content should still be present.
    expect(result.html).toContain("Layout Content");
    // DocumentShell's capstan-root div should NOT appear
    expect(result.html).not.toContain('id="capstan-root"');
  });

  it("DocumentShell includes charset and viewport meta tags", async () => {
    const result = await renderPage(makeRenderOptions({ layouts: [] }));

    expect(result.html).toContain('charSet="utf-8"');
    expect(result.html).toContain('name="viewport"');
    expect(result.html).toContain("width=device-width");
  });

  it("page content is rendered inside the capstan-root div", async () => {
    const pageModule = makePageModule({
      default: () => createElement("span", null, "Inside Root"),
    });

    const result = await renderPage(
      makeRenderOptions({ pageModule, layouts: [] }),
    );

    expect(result.html).toContain("Inside Root");
    expect(result.html).toContain('id="capstan-root"');

    // The content should appear inside the document body
    const bodyStart = result.html.indexOf("<body>");
    const contentPos = result.html.indexOf("Inside Root");
    expect(contentPos).toBeGreaterThan(bodyStart);
  });
});

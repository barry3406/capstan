import { describe, it, expect } from "bun:test";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";

// Regression guard for the "standard install -> hydration 500s site-wide" bug.
//
// The dev server (packages/dev/src/server.ts) builds each route's hydration
// bundle from capstan-react's browser/client/hydrate entries. Under a normal
// npm install, capstan-react ships ONLY `dist` (its package `files` is
// ["dist"]), so the dev server must resolve those entries from the installed
// package's dist — and the dist MUST contain them. server.ts previously assumed
// the monorepo's `../../react/src/*.ts` layout, which is absent on a real
// install, so every hydrating route 500'd. This test pins the invariant: the
// published capstan-react dist ships exactly the entries the dev server needs.

describe("capstan-react hydration entries (npm-install layout)", () => {
  const reactPkgJson = createRequire(import.meta.url).resolve(
    "@zauso-ai/capstan-react/package.json",
  );
  const dist = path.join(path.dirname(reactPkgJson), "dist");

  for (const entry of ["browser.js", "client/index.js", "client/entry.js", "hydrate.js"]) {
    it(`ships dist/${entry}`, () => {
      expect(existsSync(path.join(dist, entry))).toBe(true);
    });
  }
});

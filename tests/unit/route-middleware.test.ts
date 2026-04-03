import { describe, it, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { defineMiddleware } from "@zauso-ai/capstan-core";
import {
  composeRouteMiddlewares,
  loadRouteMiddleware,
  loadRouteMiddlewares,
  runRouteMiddlewares,
  RouteMiddlewareExportError,
  RouteMiddlewareLoadError,
} from "../../packages/dev/src/route-middleware.ts";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "capstan-route-mw-test-"));
}

async function writeTempFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const filePath = join(root, relativePath);
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

const coreMiddlewareSource = pathToFileURL(
  join(process.cwd(), "packages", "core", "src", "middleware.ts"),
).href;

function makeArgs() {
  return {
    request: new Request("http://localhost/test"),
    ctx: {
      auth: {
        isAuthenticated: false,
        type: "anonymous" as const,
        permissions: [],
      },
      request: new Request("http://localhost/test"),
      env: {},
      honoCtx: {} as never,
    },
  };
}

describe("loadRouteMiddleware", () => {
  it("loads a defineMiddleware default export", async () => {
    const root = await makeTempDir();
    try {
      const filePath = await writeTempFile(
        root,
        "_middleware.ts",
        [
          `import { defineMiddleware } from "${coreMiddlewareSource}";`,
          "export default defineMiddleware({",
          '  name: "logging",',
          "  handler: async ({ next }) => next(),",
          "});",
        ].join("\n"),
      );

      const loaded = await loadRouteMiddleware(filePath);
      expect(loaded.filePath).toBe(filePath);
      expect(typeof loaded.definition.handler).toBe("function");
      expect(loaded.definition.name).toBe("logging");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("wraps a function default export as a middleware definition", async () => {
    const root = await makeTempDir();
    try {
      const filePath = await writeTempFile(
        root,
        "nested/_middleware.ts",
        [
          "export default async function middleware({ next }) {",
          "  return next();",
          "}",
        ].join("\n"),
      );

      const loaded = await loadRouteMiddleware(filePath);
      expect(typeof loaded.definition.handler).toBe("function");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails fast when the default export is missing", async () => {
    const root = await makeTempDir();
    try {
      const filePath = await writeTempFile(
        root,
        "_middleware.ts",
        "export const value = 1;",
      );

      await expect(loadRouteMiddleware(filePath)).rejects.toBeInstanceOf(
        RouteMiddlewareExportError,
      );
      await expect(loadRouteMiddleware(filePath)).rejects.toThrow(
        "must export a default middleware definition",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails fast when the default export is not callable", async () => {
    const root = await makeTempDir();
    try {
      const filePath = await writeTempFile(
        root,
        "_middleware.ts",
        "export default { name: 'broken' };",
      );

      await expect(loadRouteMiddleware(filePath)).rejects.toBeInstanceOf(
        RouteMiddlewareExportError,
      );
      await expect(loadRouteMiddleware(filePath)).rejects.toThrow(
        "expected default export from defineMiddleware()",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("wraps module load failures with the file path", async () => {
    const root = await makeTempDir();
    try {
      const filePath = await writeTempFile(
        root,
        "_middleware.ts",
        [
          'import "./missing.ts";',
          "export default {",
          "  handler: async () => new Response('ok'),",
          "};",
        ].join("\n"),
      );

      await expect(loadRouteMiddleware(filePath)).rejects.toBeInstanceOf(
        RouteMiddlewareLoadError,
      );
      await expect(loadRouteMiddleware(filePath)).rejects.toThrow(filePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("composeRouteMiddlewares", () => {
  it("executes outer-to-inner with post-processing", async () => {
    const calls: string[] = [];
    const middlewareA = defineMiddleware(async ({ next }) => {
      calls.push("a:before");
      const response = await next();
      calls.push("a:after");
      return new Response(`${await response.text()}|a`);
    });
    const middlewareB = defineMiddleware(async ({ next }) => {
      calls.push("b:before");
      const response = await next();
      calls.push("b:after");
      return new Response(`${await response.text()}|b`);
    });

    const run = composeRouteMiddlewares(
      [middlewareA, middlewareB],
      async () => new Response("terminal"),
    );

    const response = await run(makeArgs());
    expect(await response.text()).toBe("terminal|b|a");
    expect(calls).toEqual(["a:before", "b:before", "b:after", "a:after"]);
  });

  it("short-circuits when an outer middleware returns early", async () => {
    const calls: string[] = [];
    const middlewareA = defineMiddleware(async () => {
      calls.push("a");
      return new Response("blocked", { status: 403 });
    });
    const middlewareB = defineMiddleware(async ({ next }) => {
      calls.push("b");
      return next();
    });

    const run = composeRouteMiddlewares(
      [middlewareA, middlewareB],
      async () => {
        calls.push("terminal");
        return new Response("terminal");
      },
    );

    const response = await run(makeArgs());
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("blocked");
    expect(calls).toEqual(["a"]);
  });

  it("rejects multiple next() calls from the same middleware", async () => {
    const middleware = defineMiddleware(async ({ next }) => {
      await next();
      return next();
    });

    const run = composeRouteMiddlewares([middleware], async () => {
      return new Response("terminal");
    });

    await expect(run(makeArgs())).rejects.toThrow(
      "next() called multiple times in route middleware chain",
    );
  });
});

describe("runRouteMiddlewares", () => {
  it("loads and executes the middleware chain in order", async () => {
    const root = await makeTempDir();
    try {
      const outer = await writeTempFile(
        root,
        "_middleware.ts",
        [
          `import { defineMiddleware } from "${coreMiddlewareSource}";`,
          "export default defineMiddleware(async ({ next }) => {",
          "  const response = await next();",
          "  return new Response(`${await response.text()}|outer`);",
          "});",
        ].join("\n"),
      );

      const inner = await writeTempFile(
        root,
        "admin/_middleware.ts",
        [
          `import { defineMiddleware } from "${coreMiddlewareSource}";`,
          "export default defineMiddleware(async ({ next }) => {",
          "  const response = await next();",
          "  return new Response(`${await response.text()}|inner`);",
          "});",
        ].join("\n"),
      );

      const response = await runRouteMiddlewares(
        [outer, inner],
        makeArgs(),
        async () => new Response("terminal"),
      );

      expect(await response.text()).toBe("terminal|inner|outer");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads middlewares sequentially and preserves order", async () => {
    const root = await makeTempDir();
    try {
      const first = await writeTempFile(
        root,
        "_middleware.ts",
        [
          `import { defineMiddleware } from "${coreMiddlewareSource}";`,
          "export default defineMiddleware(async ({ next }) => {",
          "  return next();",
          "});",
        ].join("\n"),
      );
      const second = await writeTempFile(
        root,
        "child/_middleware.ts",
        [
          `import { defineMiddleware } from "${coreMiddlewareSource}";`,
          "export default defineMiddleware(async ({ next }) => {",
          "  return next();",
          "});",
        ].join("\n"),
      );

      const loaded = await loadRouteMiddlewares([first, second]);
      expect(loaded.map((entry) => entry.filePath)).toEqual([first, second]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

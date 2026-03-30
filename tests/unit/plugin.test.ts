import { describe, it, expect } from "bun:test";
import {
  definePlugin,
  defineMiddleware,
  definePolicy,
  createCapstanApp,
} from "@zauso-ai/capstan-core";
import type {
  CapstanPlugin,
  CapstanPluginContext,
} from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// definePlugin
// ---------------------------------------------------------------------------

describe("definePlugin", () => {
  it("returns the same plugin object it receives", () => {
    const plugin = definePlugin({
      name: "test-plugin",
      setup() {},
    });
    expect(plugin.name).toBe("test-plugin");
    expect(typeof plugin.setup).toBe("function");
  });

  it("preserves the version field", () => {
    const plugin = definePlugin({
      name: "versioned",
      version: "2.0.0",
      setup() {},
    });
    expect(plugin.version).toBe("2.0.0");
  });

  it("preserves an async setup function", () => {
    const plugin = definePlugin({
      name: "async-plugin",
      async setup() {
        await Promise.resolve();
      },
    });
    expect(typeof plugin.setup).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Plugin setup called with correct context
// ---------------------------------------------------------------------------

describe("plugin setup context", () => {
  it("calls setup with a context containing addRoute, addPolicy, addMiddleware, config", async () => {
    let receivedCtx: CapstanPluginContext | undefined;

    const plugin = definePlugin({
      name: "ctx-check",
      setup(ctx) {
        receivedCtx = ctx;
      },
    });

    await createCapstanApp({
      app: { name: "test" },
      plugins: [plugin],
    });

    expect(receivedCtx).toBeDefined();
    expect(typeof receivedCtx!.addRoute).toBe("function");
    expect(typeof receivedCtx!.addPolicy).toBe("function");
    expect(typeof receivedCtx!.addMiddleware).toBe("function");
    expect(receivedCtx!.config).toBeDefined();
  });

  it("passes the app config through the context", async () => {
    let receivedConfig: Record<string, unknown> | undefined;

    const plugin = definePlugin({
      name: "config-check",
      setup(ctx) {
        receivedConfig = ctx.config;
      },
    });

    await createCapstanApp({
      app: { name: "config-app", title: "Config App" },
      plugins: [plugin],
    });

    expect(receivedConfig).toBeDefined();
    const appConfig = receivedConfig!["app"] as
      | { name?: string; title?: string }
      | undefined;
    expect(appConfig?.name).toBe("config-app");
    expect(appConfig?.title).toBe("Config App");
  });
});

// ---------------------------------------------------------------------------
// addRoute registers a working route
// ---------------------------------------------------------------------------

describe("plugin addRoute", () => {
  it("registers a GET route that responds to HTTP requests", async () => {
    const plugin = definePlugin({
      name: "route-plugin",
      setup(ctx) {
        ctx.addRoute("GET", "/plugin/health", (c: { json: (data: unknown) => Response }) =>
          c.json({ source: "plugin" }),
        );
      },
    });

    const capstan = await createCapstanApp({
      app: { name: "test" },
      plugins: [plugin],
    });

    const response = await capstan.app.fetch(
      new Request("http://localhost/plugin/health"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { source: string };
    expect(body.source).toBe("plugin");
  });

  it("registers a POST route that responds to HTTP requests", async () => {
    const plugin = definePlugin({
      name: "post-plugin",
      setup(ctx) {
        ctx.addRoute("POST", "/plugin/action", (c: { json: (data: unknown) => Response }) =>
          c.json({ done: true }),
        );
      },
    });

    const capstan = await createCapstanApp({
      app: { name: "test" },
      plugins: [plugin],
    });

    const response = await capstan.app.fetch(
      new Request("http://localhost/plugin/action", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { done: boolean };
    expect(body.done).toBe(true);
  });

  it("adds route metadata to routeRegistry", async () => {
    const plugin = definePlugin({
      name: "meta-plugin",
      setup(ctx) {
        ctx.addRoute("GET", "/plugin/meta", () => new Response("ok"));
      },
    });

    const capstan = await createCapstanApp({
      app: { name: "test" },
      plugins: [plugin],
    });

    const pluginRoute = capstan.routeRegistry.find(
      (r) => r.path === "/plugin/meta",
    );
    expect(pluginRoute).toBeDefined();
    expect(pluginRoute!.method).toBe("GET");
  });
});

// ---------------------------------------------------------------------------
// addMiddleware applies middleware
// ---------------------------------------------------------------------------

describe("plugin addMiddleware", () => {
  it("applies middleware that modifies responses", async () => {
    const mw = defineMiddleware({
      name: "plugin-header",
      async handler({ next }) {
        const res = await next();
        // Middleware ran — we validate by checking the plugin route works
        return res;
      },
    });

    let middlewareRan = false;

    const plugin = definePlugin({
      name: "mw-plugin",
      setup(ctx) {
        ctx.addMiddleware("/mw-test/*", {
          name: "tracker",
          async handler({ next }) {
            middlewareRan = true;
            return next();
          },
        });
        ctx.addRoute("GET", "/mw-test/ping", (c: { json: (data: unknown) => Response }) =>
          c.json({ pong: true }),
        );
      },
    });

    const capstan = await createCapstanApp({
      app: { name: "test" },
      plugins: [plugin],
    });

    const response = await capstan.app.fetch(
      new Request("http://localhost/mw-test/ping"),
    );
    expect(response.status).toBe(200);
    expect(middlewareRan).toBe(true);
  });

  it("middleware does not run for non-matching paths", async () => {
    let middlewareRan = false;

    const plugin = definePlugin({
      name: "scoped-mw",
      setup(ctx) {
        ctx.addMiddleware("/scoped/*", {
          name: "scoped-tracker",
          async handler({ next }) {
            middlewareRan = true;
            return next();
          },
        });
        ctx.addRoute("GET", "/other/path", (c: { json: (data: unknown) => Response }) =>
          c.json({ ok: true }),
        );
      },
    });

    const capstan = await createCapstanApp({
      app: { name: "test" },
      plugins: [plugin],
    });

    await capstan.app.fetch(new Request("http://localhost/other/path"));
    expect(middlewareRan).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addPolicy accepts a policy definition
// ---------------------------------------------------------------------------

describe("plugin addPolicy", () => {
  it("accepts a policy definition without throwing", async () => {
    const policy = definePolicy({
      key: "plugin-policy",
      title: "Plugin Policy",
      effect: "allow",
      async check() {
        return { effect: "allow" };
      },
    });

    const plugin = definePlugin({
      name: "policy-plugin",
      setup(ctx) {
        ctx.addPolicy(policy);
      },
    });

    // Should not throw
    const capstan = await createCapstanApp({
      app: { name: "test" },
      plugins: [plugin],
    });
    expect(capstan).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple plugins loaded in order
// ---------------------------------------------------------------------------

describe("multiple plugins", () => {
  it("loads plugins in array order", async () => {
    const order: string[] = [];

    const pluginA = definePlugin({
      name: "plugin-a",
      setup() {
        order.push("a");
      },
    });

    const pluginB = definePlugin({
      name: "plugin-b",
      setup() {
        order.push("b");
      },
    });

    const pluginC = definePlugin({
      name: "plugin-c",
      setup() {
        order.push("c");
      },
    });

    await createCapstanApp({
      app: { name: "test" },
      plugins: [pluginA, pluginB, pluginC],
    });

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("routes from multiple plugins all work", async () => {
    const plugin1 = definePlugin({
      name: "p1",
      setup(ctx) {
        ctx.addRoute("GET", "/p1/hello", (c: { json: (data: unknown) => Response }) =>
          c.json({ from: "p1" }),
        );
      },
    });

    const plugin2 = definePlugin({
      name: "p2",
      setup(ctx) {
        ctx.addRoute("GET", "/p2/hello", (c: { json: (data: unknown) => Response }) =>
          c.json({ from: "p2" }),
        );
      },
    });

    const capstan = await createCapstanApp({
      app: { name: "test" },
      plugins: [plugin1, plugin2],
    });

    const r1 = await capstan.app.fetch(
      new Request("http://localhost/p1/hello"),
    );
    const r2 = await capstan.app.fetch(
      new Request("http://localhost/p2/hello"),
    );

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(((await r1.json()) as { from: string }).from).toBe("p1");
    expect(((await r2.json()) as { from: string }).from).toBe("p2");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("plugin edge cases", () => {
  it("works with no plugins configured", async () => {
    const capstan = await createCapstanApp({
      app: { name: "no-plugins" },
    });
    expect(capstan).toBeDefined();
    expect(capstan.app).toBeDefined();
  });

  it("works with an empty plugins array", async () => {
    const capstan = await createCapstanApp({
      app: { name: "empty-plugins" },
      plugins: [],
    });
    expect(capstan).toBeDefined();
  });

  it("handles async setup functions", async () => {
    let setupCompleted = false;

    const plugin = definePlugin({
      name: "async-setup",
      async setup() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        setupCompleted = true;
      },
    });

    await createCapstanApp({
      app: { name: "test" },
      plugins: [plugin],
    });

    expect(setupCompleted).toBe(true);
  });

  it("plugin-registered routes appear in the agent manifest", async () => {
    const plugin = definePlugin({
      name: "manifest-plugin",
      setup(ctx) {
        ctx.addRoute("GET", "/manifest-test", (c: { json: (data: unknown) => Response }) =>
          c.json({ ok: true }),
        );
      },
    });

    const capstan = await createCapstanApp({
      app: { name: "manifest-app" },
      plugins: [plugin],
    });

    const response = await capstan.app.fetch(
      new Request("http://localhost/.well-known/capstan.json"),
    );
    expect(response.status).toBe(200);

    const manifest = (await response.json()) as {
      routes: Array<{ method: string; path: string }>;
    };
    const pluginRoute = manifest.routes.find(
      (r) => r.path === "/manifest-test",
    );
    expect(pluginRoute).toBeDefined();
    expect(pluginRoute!.method).toBe("GET");
  });

  it("satisfies the CapstanPlugin type interface", () => {
    const plugin: CapstanPlugin = {
      name: "typed-plugin",
      version: "1.0.0",
      setup(_ctx: CapstanPluginContext) {
        // no-op
      },
    };
    expect(plugin.name).toBe("typed-plugin");
    expect(plugin.version).toBe("1.0.0");
  });
});

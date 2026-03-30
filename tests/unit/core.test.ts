import { describe, it, expect } from "bun:test";
import {
  defineConfig,
  defineAPI,
  defineMiddleware,
  definePolicy,
  enforcePolicies,
  createCapstanApp,
  env,
} from "@zauso-ai/capstan-core";
import type { CapstanContext, PolicyDefinition } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// defineConfig
// ---------------------------------------------------------------------------

describe("defineConfig", () => {
  it("returns the same config object it receives", () => {
    const config = {
      app: { name: "test-app", title: "Test App" },
      database: { provider: "sqlite" as const, url: ":memory:" },
    };
    const result = defineConfig(config);
    expect(result).toEqual(config);
  });

  it("preserves all config fields including nested ones", () => {
    const config = defineConfig({
      app: { name: "x", title: "X", description: "desc" },
      server: { port: 4000, host: "127.0.0.1" },
      auth: {
        session: { strategy: "jwt", secret: "s", maxAge: "1d" },
        providers: [{ type: "apiKey" }],
      },
      agent: { manifest: true, mcp: true, openapi: true },
    });
    expect(config.server?.port).toBe(4000);
    expect(config.auth?.session?.secret).toBe("s");
    expect(config.agent?.manifest).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

describe("env", () => {
  it("reads an existing environment variable", () => {
    process.env["CAPSTAN_TEST_VAR"] = "hello";
    expect(env("CAPSTAN_TEST_VAR")).toBe("hello");
    delete process.env["CAPSTAN_TEST_VAR"];
  });

  it("returns empty string for a missing variable", () => {
    delete process.env["CAPSTAN_NONEXISTENT"];
    expect(env("CAPSTAN_NONEXISTENT")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// defineAPI
// ---------------------------------------------------------------------------

describe("defineAPI", () => {
  it("wraps a handler and returns an APIDefinition with metadata", () => {
    const api = defineAPI({
      description: "Get items",
      capability: "read",
      resource: "item",
      async handler() {
        return { items: [] };
      },
    });

    expect(api.description).toBe("Get items");
    expect(api.capability).toBe("read");
    expect(api.resource).toBe("item");
    expect(typeof api.handler).toBe("function");
  });

  it("handler can be invoked and returns data", async () => {
    const api = defineAPI({
      async handler() {
        return { ok: true };
      },
    });

    const ctx = makeFakeContext();
    const result = await api.handler({ input: undefined, ctx });
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// defineMiddleware
// ---------------------------------------------------------------------------

describe("defineMiddleware", () => {
  it("accepts a full object definition with name", () => {
    const mw = defineMiddleware({
      name: "logger",
      handler: async ({ next }) => next(),
    });
    expect(mw.name).toBe("logger");
    expect(typeof mw.handler).toBe("function");
  });

  it("accepts a bare handler function", () => {
    const mw = defineMiddleware(async ({ next }) => next());
    expect(mw.name).toBeUndefined();
    expect(typeof mw.handler).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// definePolicy / enforcePolicies
// ---------------------------------------------------------------------------

describe("definePolicy", () => {
  it("stores the policy definition with all fields", () => {
    const policy = definePolicy({
      key: "requireAuth",
      title: "Require Auth",
      effect: "deny",
      async check() {
        return { effect: "deny", reason: "not authenticated" };
      },
    });
    expect(policy.key).toBe("requireAuth");
    expect(policy.title).toBe("Require Auth");
    expect(policy.effect).toBe("deny");
  });
});

describe("enforcePolicies", () => {
  const ctx = makeFakeContext();

  it("returns allow when no policies are provided", async () => {
    const result = await enforcePolicies([], ctx);
    expect(result.effect).toBe("allow");
  });

  it("deny beats allow (deny > allow)", async () => {
    const allowPolicy = makePolicy("allow");
    const denyPolicy = makePolicy("deny", "forbidden");
    const result = await enforcePolicies([allowPolicy, denyPolicy], ctx);
    expect(result.effect).toBe("deny");
    expect(result.reason).toBe("forbidden");
  });

  it("deny beats approve (deny > approve > allow)", async () => {
    const approvePolicy = makePolicy("approve", "needs approval");
    const denyPolicy = makePolicy("deny", "blocked");
    const result = await enforcePolicies([approvePolicy, denyPolicy], ctx);
    expect(result.effect).toBe("deny");
    expect(result.reason).toBe("blocked");
  });

  it("approve beats allow", async () => {
    const allowPolicy = makePolicy("allow");
    const approvePolicy = makePolicy("approve", "needs human review");
    const result = await enforcePolicies([allowPolicy, approvePolicy], ctx);
    expect(result.effect).toBe("approve");
    expect(result.reason).toBe("needs human review");
  });

  it("redact beats allow but is less restrictive than approve", async () => {
    const allowPolicy = makePolicy("allow");
    const redactPolicy = makePolicy("redact", "sensitive data");
    const result = await enforcePolicies([allowPolicy, redactPolicy], ctx);
    expect(result.effect).toBe("redact");
  });

  it("later policy wins on ties", async () => {
    const deny1 = makePolicy("deny", "first");
    const deny2 = makePolicy("deny", "second");
    const result = await enforcePolicies([deny1, deny2], ctx);
    expect(result.reason).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// createCapstanApp / registerAPI / agent manifest
// ---------------------------------------------------------------------------

describe("createCapstanApp", () => {
  it("returns an app with a routeRegistry array", async () => {
    const { app, routeRegistry } = await createCapstanApp({
      app: { name: "test" },
    });
    expect(app).toBeDefined();
    expect(Array.isArray(routeRegistry)).toBe(true);
  });

  it("registerAPI adds route metadata to routeRegistry", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const api = defineAPI({
      description: "List items",
      capability: "read",
      async handler() {
        return { items: [] };
      },
    });
    capstan.registerAPI("GET", "/items", api);
    expect(capstan.routeRegistry.length).toBe(1);
    expect(capstan.routeRegistry[0]!.method).toBe("GET");
    expect(capstan.routeRegistry[0]!.path).toBe("/items");
    expect(capstan.routeRegistry[0]!.description).toBe("List items");
  });

  it("registered endpoint responds to HTTP requests", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const api = defineAPI({
      async handler() {
        return { status: "ok" };
      },
    });
    capstan.registerAPI("GET", "/health", api);

    const response = await capstan.app.fetch(
      new Request("http://localhost/health"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("agent manifest endpoint returns JSON at /.well-known/capstan.json", async () => {
    const capstan = await createCapstanApp({
      app: { name: "my-app", title: "My App", description: "test desc" },
    });
    const api = defineAPI({
      description: "Health check",
      capability: "read",
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/health", api);

    const response = await capstan.app.fetch(
      new Request("http://localhost/.well-known/capstan.json"),
    );
    expect(response.status).toBe(200);

    const manifest = (await response.json()) as {
      name: string;
      title: string;
      description: string;
      routes: Array<{ method: string; path: string; description?: string }>;
    };
    expect(manifest.name).toBe("my-app");
    expect(manifest.title).toBe("My App");
    expect(manifest.description).toBe("test desc");
    expect(manifest.routes.length).toBeGreaterThanOrEqual(1);
    expect(manifest.routes[0]!.path).toBe("/health");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeContext(): CapstanContext {
  return {
    auth: { isAuthenticated: false, type: "anonymous", permissions: [] },
    request: new Request("http://localhost/test"),
    env: {},
    honoCtx: {} as CapstanContext["honoCtx"],
  };
}

function makePolicy(
  effect: "allow" | "deny" | "approve" | "redact",
  reason?: string,
): PolicyDefinition {
  return definePolicy({
    key: `test-${effect}`,
    title: `Test ${effect}`,
    effect,
    async check() {
      const result: { effect: typeof effect; reason?: string } = { effect };
      if (reason !== undefined) {
        result.reason = reason;
      }
      return result;
    },
  });
}

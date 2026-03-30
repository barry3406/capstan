import { describe, it, expect, beforeEach } from "bun:test";
import {
  createCapstanApp,
  defineAPI,
  definePolicy,
} from "@zauso-ai/capstan-core";
import type { CapstanConfig } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// createCapstanApp — extended tests
// ---------------------------------------------------------------------------

describe("createCapstanApp (extended)", () => {
  it("returns app, routeRegistry, registerAPI", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    expect(capstan.app).toBeDefined();
    expect(Array.isArray(capstan.routeRegistry)).toBe(true);
    expect(typeof capstan.registerAPI).toBe("function");
  });

  it("registerAPI adds route to Hono app and responds to HTTP", async () => {
    const capstan = await createCapstanApp({ app: { name: "test" } });
    const api = defineAPI({
      description: "Echo endpoint",
      capability: "read",
      async handler({ input }) {
        return { echo: input };
      },
    });
    capstan.registerAPI("GET", "/echo", api);

    const res = await capstan.app.fetch(
      new Request("http://localhost/echo?msg=hello"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { echo: unknown };
    expect(body.echo).toBeDefined();
  });

  it("multiple routes registered correctly", async () => {
    const capstan = await createCapstanApp({ app: { name: "multi" } });
    const api1 = defineAPI({
      description: "Route A",
      async handler() {
        return { route: "a" };
      },
    });
    const api2 = defineAPI({
      description: "Route B",
      async handler() {
        return { route: "b" };
      },
    });
    capstan.registerAPI("GET", "/a", api1);
    capstan.registerAPI("GET", "/b", api2);

    expect(capstan.routeRegistry.length).toBe(2);

    const resA = await capstan.app.fetch(new Request("http://localhost/a"));
    const bodyA = (await resA.json()) as { route: string };
    expect(bodyA.route).toBe("a");

    const resB = await capstan.app.fetch(new Request("http://localhost/b"));
    const bodyB = (await resB.json()) as { route: string };
    expect(bodyB.route).toBe("b");
  });

  it("agent manifest endpoint returns correct JSON", async () => {
    const capstan = await createCapstanApp({
      app: { name: "manifest-test", title: "Manifest Test", description: "desc" },
    });
    const api = defineAPI({
      description: "A route",
      capability: "read",
      async handler() {
        return {};
      },
    });
    capstan.registerAPI("GET", "/foo", api);

    const res = await capstan.app.fetch(
      new Request("http://localhost/.well-known/capstan.json"),
    );
    expect(res.status).toBe(200);

    const manifest = (await res.json()) as {
      name: string;
      title: string;
      description: string;
      routes: Array<{ method: string; path: string }>;
    };
    expect(manifest.name).toBe("manifest-test");
    expect(manifest.title).toBe("Manifest Test");
    expect(manifest.routes.length).toBeGreaterThanOrEqual(1);
    expect(manifest.routes.some((r) => r.path === "/foo")).toBe(true);
  });

  it("CORS middleware applied — OPTIONS returns Access-Control headers", async () => {
    const capstan = await createCapstanApp({ app: { name: "cors-test" } });
    const api = defineAPI({
      async handler() {
        return {};
      },
    });
    capstan.registerAPI("GET", "/data", api);

    const res = await capstan.app.fetch(
      new Request("http://localhost/data", {
        method: "OPTIONS",
        headers: {
          Origin: "http://example.com",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    // CORS middleware should set Access-Control-Allow-Origin
    const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
    expect(allowOrigin).toBeDefined();
  });

  it("POST route parses JSON body", async () => {
    const capstan = await createCapstanApp({ app: { name: "post-test" } });
    const api = defineAPI({
      description: "Create item",
      capability: "write",
      async handler({ input }) {
        return { received: input };
      },
    });
    capstan.registerAPI("POST", "/items", api);

    const res = await capstan.app.fetch(
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "widget" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: { name: string } };
    expect(body.received.name).toBe("widget");
  });

  it("handler error returns 500 with error message", async () => {
    const capstan = await createCapstanApp({ app: { name: "err-test" } });
    const api = defineAPI({
      async handler() {
        throw new Error("Something broke");
      },
    });
    capstan.registerAPI("GET", "/fail", api);

    const res = await capstan.app.fetch(new Request("http://localhost/fail"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Something broke");
  });

  it("policy deny returns 403", async () => {
    const capstan = await createCapstanApp({ app: { name: "policy-test" } });
    const policy = definePolicy({
      key: "blockAll",
      title: "Block All",
      effect: "deny",
      async check() {
        return { effect: "deny", reason: "blocked" };
      },
    });
    const api = defineAPI({
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("GET", "/protected", api, [policy]);

    const res = await capstan.app.fetch(
      new Request("http://localhost/protected"),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe("Forbidden");
    expect(body.reason).toBe("blocked");
  });

  it("metrics endpoint returns text/plain", async () => {
    const capstan = await createCapstanApp({ app: { name: "metrics-test" } });
    const res = await capstan.app.fetch(
      new Request("http://localhost/metrics"),
    );
    expect(res.status).toBe(200);
    const contentType = res.headers.get("Content-Type") ?? "";
    expect(contentType).toContain("text/plain");
  });

  it("plugins loaded and routes accessible", async () => {
    const config: CapstanConfig = {
      app: { name: "plugin-test" },
      plugins: [
        {
          name: "test-plugin",
          setup(ctx) {
            ctx.addRoute("GET", "/plugin-route", async (c: { json: (data: unknown) => Response }) => {
              return c.json({ from: "plugin" });
            });
          },
        },
      ],
    };
    const capstan = await createCapstanApp(config);

    // Plugin route should be in the registry
    expect(capstan.routeRegistry.some((r) => r.path === "/plugin-route")).toBe(true);

    // Plugin route should respond
    const res = await capstan.app.fetch(
      new Request("http://localhost/plugin-route"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { from: string };
    expect(body.from).toBe("plugin");
  });

  it("routeRegistry records inputSchema when input zod schema provided", async () => {
    const { z } = await import("zod");
    const capstan = await createCapstanApp({ app: { name: "schema-test" } });
    const api = defineAPI({
      input: z.object({ name: z.string() }),
      async handler({ input }) {
        return { name: (input as { name: string }).name };
      },
    });
    capstan.registerAPI("POST", "/with-schema", api);

    const entry = capstan.routeRegistry.find((r) => r.path === "/with-schema");
    expect(entry).toBeDefined();
    expect(entry!.inputSchema).toBeDefined();
  });

  it("approval flow returns 202 when policy effect is approve", async () => {
    const capstan = await createCapstanApp({ app: { name: "approval-test" } });
    const policy = definePolicy({
      key: "needsApproval",
      title: "Needs Approval",
      effect: "approve",
      async check() {
        return { effect: "approve", reason: "Human review required" };
      },
    });
    const api = defineAPI({
      async handler() {
        return { ok: true };
      },
    });
    capstan.registerAPI("POST", "/sensitive", api, [policy]);

    const res = await capstan.app.fetch(
      new Request("http://localhost/sensitive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; approvalId: string };
    expect(body.status).toBe("approval_required");
    expect(body.approvalId).toBeDefined();
  });
});

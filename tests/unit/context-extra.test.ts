import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createContext } from "@zauso-ai/capstan-core";
import type { CapstanContext } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// createContext
// ---------------------------------------------------------------------------

describe("createContext", () => {
  it("returns a CapstanContext object", async () => {
    const app = new Hono();
    let captured: CapstanContext | undefined;

    app.get("/test", (c) => {
      captured = createContext(c);
      return c.json({ ok: true });
    });

    await app.fetch(new Request("http://localhost/test"));
    expect(captured).toBeDefined();
  });

  it("contains auth object defaulting to anonymous", async () => {
    const app = new Hono();
    let captured: CapstanContext | undefined;

    app.get("/test", (c) => {
      captured = createContext(c);
      return c.json({ ok: true });
    });

    await app.fetch(new Request("http://localhost/test"));
    expect(captured!.auth).toBeDefined();
    expect(captured!.auth.isAuthenticated).toBe(false);
    expect(captured!.auth.type).toBe("anonymous");
    expect(captured!.auth.permissions).toEqual([]);
  });

  it("contains request object matching the incoming request", async () => {
    const app = new Hono();
    let captured: CapstanContext | undefined;

    app.get("/check-req", (c) => {
      captured = createContext(c);
      return c.json({ ok: true });
    });

    await app.fetch(new Request("http://localhost/check-req"));
    expect(captured!.request).toBeDefined();
    expect(captured!.request instanceof Request).toBe(true);
    expect(captured!.request.url).toContain("/check-req");
  });

  it("contains env record from process.env", async () => {
    const app = new Hono();
    let captured: CapstanContext | undefined;

    process.env["CAPSTAN_CTX_TEST"] = "ctx_value";
    app.get("/env-test", (c) => {
      captured = createContext(c);
      return c.json({ ok: true });
    });

    await app.fetch(new Request("http://localhost/env-test"));
    expect(captured!.env).toBeDefined();
    expect(captured!.env["CAPSTAN_CTX_TEST"]).toBe("ctx_value");
    delete process.env["CAPSTAN_CTX_TEST"];
  });

  it("uses existing auth from middleware when present", async () => {
    const app = new Hono();
    let captured: CapstanContext | undefined;

    app.use("*", async (c, next) => {
      c.set("capstanAuth", {
        isAuthenticated: true,
        type: "human",
        userId: "user-42",
        permissions: ["read", "write"],
      });
      await next();
    });

    app.get("/authed", (c) => {
      captured = createContext(c);
      return c.json({ ok: true });
    });

    await app.fetch(new Request("http://localhost/authed"));
    expect(captured!.auth.isAuthenticated).toBe(true);
    expect(captured!.auth.type).toBe("human");
    expect(captured!.auth.userId).toBe("user-42");
    expect(captured!.auth.permissions).toEqual(["read", "write"]);
  });

  it("contains honoCtx reference", async () => {
    const app = new Hono();
    let captured: CapstanContext | undefined;

    app.get("/hono-ctx", (c) => {
      captured = createContext(c);
      return c.json({ ok: true });
    });

    await app.fetch(new Request("http://localhost/hono-ctx"));
    expect(captured!.honoCtx).toBeDefined();
  });
});

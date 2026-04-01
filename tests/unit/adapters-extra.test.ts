import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createVercelHandler, createVercelNodeHandler, generateVercelConfig } from "../../packages/dev/src/adapter-vercel.js";
import { createFlyAdapter } from "../../packages/dev/src/adapter-fly.js";
import { createCloudflareHandler, generateWranglerConfig } from "../../packages/dev/src/adapter-cloudflare.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 40000);
}

function stubApp(body: string, status = 200) {
  return {
    fetch: async (_req: Request) => new Response(body, { status }),
  };
}

// ---------------------------------------------------------------------------
// Vercel adapter
// ---------------------------------------------------------------------------

describe("Vercel adapter", () => {
  it("createVercelHandler returns a callable function", async () => {
    const handler = createVercelHandler(stubApp("ok"));
    expect(typeof handler).toBe("function");
    // Actually invoke to prove it works
    const res = await handler(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("Vercel handler calls app.fetch and returns response", async () => {
    const handler = createVercelHandler(stubApp("hello vercel", 200));
    const res = await handler(new Request("http://localhost/test"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello vercel");
  });

  it("Vercel handler forwards request URL", async () => {
    let capturedUrl = "";
    const app = {
      fetch: async (req: Request) => {
        capturedUrl = req.url;
        return new Response("ok");
      },
    };
    const handler = createVercelHandler(app);
    await handler(new Request("http://localhost/api/users"));
    expect(capturedUrl).toBe("http://localhost/api/users");
  });

  it("createVercelNodeHandler converts Node request to Web Request", async () => {
    let capturedMethod = "";
    let capturedUrl = "";
    const app = {
      fetch: async (req: Request) => {
        capturedMethod = req.method;
        capturedUrl = req.url;
        return new Response("node ok");
      },
    };
    const handler = createVercelNodeHandler(app);

    // Simulate a minimal Node.js IncomingMessage + ServerResponse
    const { EventEmitter } = await import("node:events");
    const req = Object.assign(new EventEmitter(), {
      url: "/api/data",
      method: "GET",
      headers: { host: "example.com" },
    }) as unknown as import("node:http").IncomingMessage;

    let writtenStatus = 0;
    let writtenBody: Buffer | null = null;
    const res = {
      writeHead: (status: number, _headers: Record<string, string>) => { writtenStatus = status; },
      end: (data?: Buffer) => { writtenBody = data ?? null; },
    } as unknown as import("node:http").ServerResponse;

    // Fire the handler (it won't read body for GET)
    const promise = handler(req, res);

    // Emit end to trigger body read completion for non-GET
    // For GET, the handler skips body reading, so just await
    await promise;

    expect(capturedMethod).toBe("GET");
    expect(capturedUrl).toBe("http://example.com/api/data");
    expect(writtenStatus).toBe(200);
    expect(writtenBody).not.toBeNull();
  });

  it("createVercelNodeHandler handles POST with body", async () => {
    let capturedBody = "";
    const app = {
      fetch: async (req: Request) => {
        capturedBody = await req.text();
        return new Response("posted");
      },
    };
    const handler = createVercelNodeHandler(app);

    const { EventEmitter } = await import("node:events");
    const req = Object.assign(new EventEmitter(), {
      url: "/api/create",
      method: "POST",
      headers: { host: "example.com", "content-type": "application/json" },
    }) as unknown as import("node:http").IncomingMessage;

    const res = {
      writeHead: () => {},
      end: () => {},
    } as unknown as import("node:http").ServerResponse;

    const promise = handler(req, res);
    // Emit data and end events
    (req as unknown as import("node:events").EventEmitter).emit("data", Buffer.from('{"name":"test"}'));
    (req as unknown as import("node:events").EventEmitter).emit("end");
    await promise;

    expect(capturedBody).toBe('{"name":"test"}');
  });

  it("generateVercelConfig returns object with buildCommand", () => {
    const config = generateVercelConfig();
    expect(config["buildCommand"]).toBe("npx capstan build");
    expect(config["outputDirectory"]).toBe("dist");
  });

  it("Vercel handler propagates 500 status from app", async () => {
    const handler = createVercelHandler(stubApp("internal error", 500));
    const res = await handler(new Request("http://localhost/api/fail"));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("internal error");
  });

  it("Vercel handler propagates 404 status from app", async () => {
    const handler = createVercelHandler(stubApp("not found", 404));
    const res = await handler(new Request("http://localhost/missing"));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Fly.io adapter
// ---------------------------------------------------------------------------

describe("Fly.io adapter", () => {
  const originalEnv = process.env["FLY_REGION"];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["FLY_REGION"];
    } else {
      process.env["FLY_REGION"] = originalEnv;
    }
  });

  it("createFlyAdapter returns a ServerAdapter with a working listen method", async () => {
    const adapter = createFlyAdapter();
    expect(typeof adapter.listen).toBe("function");
    // Actually invoke listen to prove it works
    const port = randomPort();
    const handle = await adapter.listen(stubApp("alive"), port, "127.0.0.1");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("alive");
    } finally {
      await handle.close();
    }
  });

  it("Fly write replay sends 409 for DELETE requests in non-primary region", async () => {
    process.env["FLY_REGION"] = "lax";
    const adapter = createFlyAdapter({ primaryRegion: "iad", replayWrites: true });
    const port = randomPort();

    const handle = await adapter.listen(stubApp("nope"), port, "127.0.0.1");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/data`, { method: "DELETE" });
      expect(res.status).toBe(409);
      expect(res.headers.get("fly-replay")).toBe("region=iad");
    } finally {
      await handle.close();
    }
  });

  it("Fly write replay sends 409 with fly-replay header for POST in non-primary region", async () => {
    process.env["FLY_REGION"] = "lax";
    const adapter = createFlyAdapter({ primaryRegion: "iad", replayWrites: true });
    const port = randomPort();

    const handle = await adapter.listen(stubApp("should not reach"), port, "127.0.0.1");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/data`, { method: "POST" });
      expect(res.status).toBe(409);
      expect(res.headers.get("fly-replay")).toBe("region=iad");
    } finally {
      await handle.close();
    }
  });

  it("Fly write replay sends 409 for PUT requests", async () => {
    process.env["FLY_REGION"] = "lax";
    const adapter = createFlyAdapter({ primaryRegion: "iad", replayWrites: true });
    const port = randomPort();

    const handle = await adapter.listen(stubApp("nope"), port, "127.0.0.1");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/data`, { method: "PUT" });
      expect(res.status).toBe(409);
    } finally {
      await handle.close();
    }
  });

  it("Fly read requests pass through in non-primary region", async () => {
    process.env["FLY_REGION"] = "lax";
    const adapter = createFlyAdapter({ primaryRegion: "iad", replayWrites: true });
    const port = randomPort();

    const handle = await adapter.listen(stubApp("read ok"), port, "127.0.0.1");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/data`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("read ok");
    } finally {
      await handle.close();
    }
  });

  it("Fly without config passes through all requests", async () => {
    process.env["FLY_REGION"] = "lax";
    const adapter = createFlyAdapter();
    const port = randomPort();

    const handle = await adapter.listen(stubApp("pass through"), port, "127.0.0.1");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/data`, { method: "POST", body: "{}" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("pass through");
    } finally {
      await handle.close();
    }
  });

  it("Fly in primary region passes through writes", async () => {
    process.env["FLY_REGION"] = "iad";
    const adapter = createFlyAdapter({ primaryRegion: "iad", replayWrites: true });
    const port = randomPort();

    const handle = await adapter.listen(stubApp("primary write ok"), port, "127.0.0.1");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/data`, { method: "POST", body: "{}" });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("primary write ok");
    } finally {
      await handle.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Cloudflare Workers adapter
// ---------------------------------------------------------------------------

describe("Cloudflare Workers adapter", () => {
  it("createCloudflareHandler returns object with working fetch method", async () => {
    const handler = createCloudflareHandler(stubApp("ok"));
    expect(typeof handler.fetch).toBe("function");
    // Actually call it to verify behavior
    const res = await handler.fetch(
      new Request("http://localhost/"),
      {},
      { waitUntil: () => {} },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("Cloudflare handler calls app.fetch and returns response", async () => {
    const handler = createCloudflareHandler(stubApp("hello cf", 200));
    const env = {};
    const ctx = { waitUntil: () => {} };
    const res = await handler.fetch(new Request("http://localhost/test"), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello cf");
  });

  it("Cloudflare handler passes through request URL", async () => {
    let capturedUrl = "";
    const app = {
      fetch: async (req: Request) => {
        capturedUrl = req.url;
        return new Response("ok");
      },
    };
    const handler = createCloudflareHandler(app);
    await handler.fetch(
      new Request("http://localhost/api/items"),
      {},
      { waitUntil: () => {} },
    );
    expect(capturedUrl).toBe("http://localhost/api/items");
  });

  it("Cloudflare handler preserves response status codes", async () => {
    const handler = createCloudflareHandler(stubApp("not found", 404));
    const res = await handler.fetch(
      new Request("http://localhost/missing"),
      {},
      { waitUntil: () => {} },
    );
    expect(res.status).toBe(404);
  });

  it("generateWranglerConfig includes app name", () => {
    const config = generateWranglerConfig("my-app");
    expect(config).toContain('name = "my-app"');
  });

  it("generateWranglerConfig includes nodejs_compat flag", () => {
    const config = generateWranglerConfig("test");
    expect(config).toContain("nodejs_compat");
  });

  it("generateWranglerConfig includes main entry point", () => {
    const config = generateWranglerConfig("test");
    expect(config).toContain('main = "dist/_worker.js"');
  });

  it("generateWranglerConfig includes compatibility_date", () => {
    const config = generateWranglerConfig("test");
    expect(config).toContain("compatibility_date");
  });

  it("generateWranglerConfig with empty app name still produces valid TOML", () => {
    const config = generateWranglerConfig("");
    expect(config).toContain('name = ""');
    expect(config).toContain('main = "dist/_worker.js"');
  });

  it("generateWranglerConfig with special characters in app name", () => {
    const config = generateWranglerConfig("my-app-2.0");
    expect(config).toContain('name = "my-app-2.0"');
  });

  it("Cloudflare handler propagates 500 status", async () => {
    const handler = createCloudflareHandler(stubApp("server error", 500));
    const res = await handler.fetch(
      new Request("http://localhost/fail"),
      {},
      { waitUntil: () => {} },
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("server error");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createNodeAdapter,
  notifyLiveReloadClients,
  closeLiveReloadClients,
} from "../../packages/dev/src/adapter-node.js";
import type { ServerAdapter } from "@zauso-ai/capstan-dev";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick a random port in a high range to avoid conflicts. */
function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 40000);
}

/** Simple app stub that returns a fixed response. */
function stubApp(body: string, status = 200, headers?: Record<string, string>) {
  return {
    fetch: async (_req: Request) =>
      new Response(body, { status, headers: headers ? new Headers(headers) : undefined }),
  };
}

// ---------------------------------------------------------------------------
// Tests: ServerAdapter Interface
// ---------------------------------------------------------------------------

describe("createNodeAdapter — interface", () => {
  it("returns an object with a listen method", () => {
    const adapter = createNodeAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.listen).toBe("function");
  });

  it("listen() returns a promise with a close function", async () => {
    const adapter = createNodeAdapter();
    const handle = await adapter.listen(stubApp("ok"), 0, "127.0.0.1");

    expect(handle).toBeDefined();
    expect(typeof handle.close).toBe("function");

    await handle.close();
  });

  it("close() stops the server and resolves", async () => {
    const adapter = createNodeAdapter();
    const port = randomPort();
    const handle = await adapter.listen(stubApp("ok"), port, "127.0.0.1");

    await handle.close();

    // After close, the port should no longer respond
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      // If fetch succeeds, the server is still listening (unexpected)
      expect(true).toBe(false);
    } catch (err: unknown) {
      // Expected: connection refused or timeout
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/ECONNREFUSED|connection|closed|timeout|abort|Unable to connect/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: Integration (actual HTTP)
// ---------------------------------------------------------------------------

describe("createNodeAdapter — HTTP integration", () => {
  let handle: { close: () => Promise<void> } | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  it("starts server on specified port and serves requests", async () => {
    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(stubApp("hello from capstan"), port, "127.0.0.1");

    const res = await fetch(`http://127.0.0.1:${port}/test`);
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).toBe("hello from capstan");
  });

  it("serves requests through the app.fetch function", async () => {
    let capturedUrl: string | null = null;
    let capturedMethod: string | null = null;

    const app = {
      fetch: async (req: Request) => {
        capturedUrl = req.url;
        capturedMethod = req.method;
        return new Response(JSON.stringify({ received: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    };

    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(app, port, "127.0.0.1");

    const res = await fetch(`http://127.0.0.1:${port}/api/test?q=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "value" }),
    });

    expect(res.status).toBe(200);
    expect(capturedUrl).toContain("/api/test");
    expect(capturedMethod).toBe("POST");
  });

  it("handles streaming responses (response.body exists)", async () => {
    const app = {
      fetch: async (_req: Request) => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("chunk1"));
            controller.enqueue(new TextEncoder().encode("chunk2"));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/plain" },
        });
      },
    };

    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(app, port, "127.0.0.1");

    const res = await fetch(`http://127.0.0.1:${port}/stream`);
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).toBe("chunk1chunk2");
  });

  it("handles non-streaming responses (null body)", async () => {
    const app = {
      fetch: async (_req: Request) => {
        // Response with no body — status-only responses
        return new Response(null, { status: 204 });
      },
    };

    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(app, port, "127.0.0.1");

    const res = await fetch(`http://127.0.0.1:${port}/empty`);
    expect(res.status).toBe(204);
  });

  it("sets correct status codes from app response", async () => {
    const app = {
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname === "/not-found") {
          return new Response("Not Found", { status: 404 });
        }
        if (url.pathname === "/created") {
          return new Response("Created", { status: 201 });
        }
        return new Response("OK", { status: 200 });
      },
    };

    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(app, port, "127.0.0.1");

    const res200 = await fetch(`http://127.0.0.1:${port}/`);
    expect(res200.status).toBe(200);

    const res404 = await fetch(`http://127.0.0.1:${port}/not-found`);
    expect(res404.status).toBe(404);

    const res201 = await fetch(`http://127.0.0.1:${port}/created`);
    expect(res201.status).toBe(201);
  });

  it("forwards response headers from app to client", async () => {
    const app = {
      fetch: async (_req: Request) => {
        return new Response("ok", {
          status: 200,
          headers: {
            "X-Custom-Header": "custom-value",
            "X-Request-Id": "req-123",
          },
        });
      },
    };

    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(app, port, "127.0.0.1");

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.headers.get("x-custom-header")).toBe("custom-value");
    expect(res.headers.get("x-request-id")).toBe("req-123");
  });

  it("forwards request headers from client to app", async () => {
    let receivedAuth: string | null = null;

    const app = {
      fetch: async (req: Request) => {
        receivedAuth = req.headers.get("authorization");
        return new Response("ok");
      },
    };

    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(app, port, "127.0.0.1");

    await fetch(`http://127.0.0.1:${port}/`, {
      headers: { Authorization: "Bearer test-token-123" },
    });

    expect(receivedAuth).toBe("Bearer test-token-123");
  });

  it("passes request body to app for POST requests", async () => {
    let receivedBody: string | null = null;

    const app = {
      fetch: async (req: Request) => {
        receivedBody = await req.text();
        return new Response("ok");
      },
    };

    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(app, port, "127.0.0.1");

    await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
    });

    expect(receivedBody).toBeDefined();
    const parsed = JSON.parse(receivedBody!);
    expect(parsed.key).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// Tests: Live Reload
// ---------------------------------------------------------------------------

describe("createNodeAdapter — live reload", () => {
  let handle: { close: () => Promise<void> } | null = null;

  afterEach(async () => {
    closeLiveReloadClients();
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  it("/__capstan_livereload returns SSE response", async () => {
    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(stubApp("ok"), port, "127.0.0.1");

    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/__capstan_livereload`, {
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");

    controller.abort();
  });

  it("notifyLiveReloadClients sends reload event to SSE clients", async () => {
    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(stubApp("ok"), port, "127.0.0.1");

    // Connect an SSE client
    const controller = new AbortController();
    const resPromise = fetch(`http://127.0.0.1:${port}/__capstan_livereload`, {
      signal: controller.signal,
    });

    const res = await resPromise;
    expect(res.status).toBe(200);

    // Give the SSE connection time to register
    await new Promise((r) => setTimeout(r, 50));

    // Trigger a reload notification
    notifyLiveReloadClients();

    // Read a small chunk from the stream to verify data was sent
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";

    // Read until we see "reload" or timeout
    const readWithTimeout = async () => {
      const timeout = setTimeout(() => {
        controller.abort();
      }, 2000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          if (accumulated.includes("reload")) break;
        }
      } catch {
        // Aborted by timeout or manual abort
      } finally {
        clearTimeout(timeout);
      }
    };

    await readWithTimeout();

    expect(accumulated).toContain("reload");
    controller.abort();
  });
});

// ---------------------------------------------------------------------------
// Tests: Error Handling
// ---------------------------------------------------------------------------

describe("createNodeAdapter — error handling", () => {
  let handle: { close: () => Promise<void> } | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  it("request body exceeding size limit returns 413 or connection reset", async () => {
    const adapter = createNodeAdapter({ maxBodySize: 100 });
    const port = randomPort();
    handle = await adapter.listen(stubApp("ok"), port, "127.0.0.1");

    // Send a body larger than 100 bytes.
    // The adapter calls req.destroy() on oversized bodies, which may cause
    // either a 413 response or a connection reset depending on timing.
    const largeBody = "x".repeat(200);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: largeBody,
      });
      expect(res.status).toBe(413);
      const body = await res.json() as Record<string, unknown>;
      expect(body["error"]).toBe("Payload Too Large");
    } catch (err: unknown) {
      // Connection reset is acceptable — the server destroyed the request
      // stream before it could finish sending the response.
      const msg = err instanceof Error ? err.message : String(err);
      expect(
        msg.includes("ECONNRESET") ||
        msg.includes("closed unexpectedly") ||
        msg.includes("connection"),
      ).toBe(true);
    }
  });

  // Note: server error → 500 response is tested in server-extra.test.ts
  // ("handler error returns 500 with error message"). Removed from adapter
  // tests because the thrown error leaks as an unhandled rejection in Bun's
  // test runner when running all 53 files in parallel.

  it("graceful shutdown returns 503 for new requests", async () => {
    const app = {
      fetch: async (_req: Request) => new Response("ok"),
    };

    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(app, port, "127.0.0.1");

    // Initiate shutdown (don't await yet)
    const closePromise = handle.close();

    // Give the shutdown flag a moment to set
    await new Promise((r) => setTimeout(r, 50));

    // New requests during shutdown should get 503
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1000),
      });
      // If we got a response, it should be 503
      expect(res.status).toBe(503);
    } catch (err: unknown) {
      // Connection refused is also acceptable during shutdown
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/ECONNREFUSED|connection|closed|timeout|abort|Unable to connect/i);
    }

    await closePromise;
    handle = null;
  });

  it("server handles GET requests without reading body", async () => {
    let fetchCalled = false;
    const app = {
      fetch: async (req: Request) => {
        fetchCalled = true;
        // GET requests should not have body read
        return new Response(JSON.stringify({ method: req.method }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    };

    const adapter = createNodeAdapter();
    const port = randomPort();
    handle = await adapter.listen(app, port, "127.0.0.1");

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(fetchCalled).toBe(true);

    const body = await res.json() as Record<string, unknown>;
    expect(body["method"]).toBe("GET");
  });
});

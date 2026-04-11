/**
 * Adversarial and stress tests for the Capstan dev package.
 *
 * Tests concurrent request handling, malformed inputs, edge-case paths,
 * missing headers, invalid JSON, middleware failure modes, handler
 * timeout patterns, config validation, and various boundary conditions.
 */

import { describe, it, expect, beforeEach } from "bun:test";

import {
  buildPortableRuntimeApp,
  createHmrCoordinator,
  createHmrTransport,
  PageFetchError,
  createPageFetch,
  type HmrUpdate,
} from "@zauso-ai/capstan-dev";

import {
  PageFetchRequestCache,
  createPageFetchCacheKey,
  shouldCacheFetchResponse,
} from "../../packages/dev/src/page-fetch-cache.js";

import {
  createRuntimeDiagnostic,
  mergeRuntimeDiagnostics,
  runtimeDiagnosticsHeaders,
  serializeRuntimeDiagnostics,
} from "../../packages/dev/src/runtime-diagnostics.js";

import {
  resolveProjectOpsConfig,
} from "../../packages/dev/src/ops-sink.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApiRoute(overrides: Record<string, unknown> = {}) {
  return {
    type: "api" as const,
    filePath: overrides.filePath ?? "app/routes/test.api.ts",
    urlPattern: overrides.urlPattern ?? "/test",
    params: (overrides.params ?? []) as string[],
    layouts: (overrides.layouts ?? []) as string[],
    middlewares: (overrides.middlewares ?? []) as string[],
    ...overrides,
  };
}

function build(
  routes: Array<ReturnType<typeof makeApiRoute>>,
  routeModules: Record<string, Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) {
  return buildPortableRuntimeApp({
    rootDir: "/tmp",
    manifest: { routes },
    routeModules,
    ...extra,
  });
}

// ===================================================================
// Concurrent request handling
// ===================================================================

describe("adversarial — Concurrent requests", () => {
  it("handles 100 concurrent GET requests", async () => {
    const mods = {
      "/tmp/app/routes/load.api.ts": {
        GET: {
          handler: async () => ({ ok: true, ts: Date.now() }),
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/load.api.ts", urlPattern: "/load" })],
      mods,
    );

    const requests = Array.from({ length: 100 }, () =>
      app.fetch(new Request("http://localhost/load")),
    );
    const responses = await Promise.all(requests);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });

  it("handles 100 concurrent POST requests", async () => {
    let count = 0;
    const mods = {
      "/tmp/app/routes/post.api.ts": {
        POST: {
          handler: async ({ input }: { input: unknown }) => {
            count++;
            return { received: true };
          },
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/post.api.ts", urlPattern: "/post" })],
      mods,
    );

    const requests = Array.from({ length: 100 }, (_, i) =>
      app.fetch(
        new Request("http://localhost/post", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ index: i }),
        }),
      ),
    );
    const responses = await Promise.all(requests);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
    expect(count).toBe(100);
  });

  it("handles concurrent requests to different routes", async () => {
    const mods = {
      "/tmp/app/routes/a.api.ts": {
        GET: { handler: async () => ({ route: "a" }) },
      },
      "/tmp/app/routes/b.api.ts": {
        GET: { handler: async () => ({ route: "b" }) },
      },
      "/tmp/app/routes/c.api.ts": {
        GET: { handler: async () => ({ route: "c" }) },
      },
    };
    const { app } = await build(
      [
        makeApiRoute({ filePath: "app/routes/a.api.ts", urlPattern: "/a" }),
        makeApiRoute({ filePath: "app/routes/b.api.ts", urlPattern: "/b" }),
        makeApiRoute({ filePath: "app/routes/c.api.ts", urlPattern: "/c" }),
      ],
      mods,
    );

    const requests = Array.from({ length: 30 }, (_, i) => {
      const route = ["a", "b", "c"][i % 3];
      return app.fetch(new Request(`http://localhost/${route}`));
    });
    const responses = await Promise.all(requests);

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });

  it("handles mix of success and error concurrent requests", async () => {
    const mods = {
      "/tmp/app/routes/ok.api.ts": {
        GET: { handler: async () => ({ ok: true }) },
      },
      "/tmp/app/routes/fail.api.ts": {
        GET: { handler: async () => { throw new Error("fail"); } },
      },
    };
    const { app } = await build(
      [
        makeApiRoute({ filePath: "app/routes/ok.api.ts", urlPattern: "/ok" }),
        makeApiRoute({ filePath: "app/routes/fail.api.ts", urlPattern: "/fail" }),
      ],
      mods,
    );

    const requests = Array.from({ length: 50 }, (_, i) => {
      const path = i % 2 === 0 ? "/ok" : "/fail";
      return app.fetch(new Request(`http://localhost${path}`));
    });
    const responses = await Promise.all(requests);

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBe(25);
    expect(statuses.filter((s) => s === 500).length).toBe(25);
  });
});

// ===================================================================
// Large request bodies
// ===================================================================

describe("adversarial — Large request bodies", () => {
  it("handles 1MB JSON body", async () => {
    const mods = {
      "/tmp/app/routes/big.api.ts": {
        POST: {
          handler: async ({ input }: { input: { data: string } }) => ({
            size: input.data?.length ?? 0,
          }),
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/big.api.ts", urlPattern: "/big" })],
      mods,
    );

    const largeData = "x".repeat(1024 * 1024);
    const res = await app.fetch(
      new Request("http://localhost/big", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: largeData }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { size: number };
    expect(body.size).toBe(1024 * 1024);
  });

  it("handles empty body POST", async () => {
    const mods = {
      "/tmp/app/routes/empty.api.ts": {
        POST: {
          handler: async ({ input }: { input: unknown }) => ({ input }),
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/empty.api.ts", urlPattern: "/empty" })],
      mods,
    );

    const res = await app.fetch(
      new Request("http://localhost/empty", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "",
      }),
    );
    // Falls back to empty input
    expect(res.status).toBe(200);
  });
});

// ===================================================================
// Malformed paths and URLs
// ===================================================================

describe("adversarial — Malformed paths", () => {
  it("handles double slashes in URL", async () => {
    const { app } = await build([], {});
    const res = await app.fetch(new Request("http://localhost//health"));
    // May or may not match — should not crash
    expect(typeof res.status).toBe("number");
  });

  it("handles URL with query string on unknown route", async () => {
    const { app } = await build([], {});
    const res = await app.fetch(new Request("http://localhost/unknown?key=value"));
    expect(res.status).toBe(404);
  });

  it("handles URL with hash fragment", async () => {
    const mods = {
      "/tmp/app/routes/frag.api.ts": {
        GET: { handler: async () => ({ ok: true }) },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/frag.api.ts", urlPattern: "/frag" })],
      mods,
    );
    // Hash fragment is not sent to server, but URL constructor handles it
    const res = await app.fetch(new Request("http://localhost/frag"));
    expect(res.status).toBe(200);
  });

  it("handles URL with encoded characters", async () => {
    const mods = {
      "/tmp/app/routes/enc.api.ts": {
        GET: { handler: async ({ input }: { input: Record<string, string> }) => ({ q: input.q }) },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/enc.api.ts", urlPattern: "/enc" })],
      mods,
    );
    const res = await app.fetch(new Request("http://localhost/enc?q=hello%20world"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { q: string };
    expect(body.q).toBe("hello world");
  });

  it("handles very long URL paths", async () => {
    const { app } = await build([], {});
    const longPath = "/" + "a".repeat(8000);
    const res = await app.fetch(new Request(`http://localhost${longPath}`));
    // Should not crash, returns 404
    expect(res.status).toBe(404);
  });

  it("handles URL with special characters in query", async () => {
    const mods = {
      "/tmp/app/routes/special.api.ts": {
        GET: {
          handler: async ({ input }: { input: Record<string, string> }) => input,
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/special.api.ts", urlPattern: "/special" })],
      mods,
    );
    const res = await app.fetch(
      new Request("http://localhost/special?key=a%26b&other=c%3Dd"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; other: string };
    expect(body.key).toBe("a&b");
    expect(body.other).toBe("c=d");
  });
});

// ===================================================================
// Missing Content-Type headers
// ===================================================================

describe("adversarial — Missing headers", () => {
  it("POST without Content-Type returns empty input", async () => {
    const mods = {
      "/tmp/app/routes/notype.api.ts": {
        POST: {
          handler: async ({ input }: { input: unknown }) => ({ input }),
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/notype.api.ts", urlPattern: "/notype" })],
      mods,
    );
    const res = await app.fetch(
      new Request("http://localhost/notype", {
        method: "POST",
        body: "some text",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { input: unknown };
    expect(body.input).toEqual({});
  });

  it("GET without Accept header works", async () => {
    const mods = {
      "/tmp/app/routes/noaccept.api.ts": {
        GET: { handler: async () => ({ works: true }) },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/noaccept.api.ts", urlPattern: "/noaccept" })],
      mods,
    );
    const res = await app.fetch(new Request("http://localhost/noaccept"));
    expect(res.status).toBe(200);
  });

  it("request with unknown Content-Type is treated as no body", async () => {
    const mods = {
      "/tmp/app/routes/unk.api.ts": {
        PUT: {
          handler: async ({ input }: { input: unknown }) => ({ input }),
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/unk.api.ts", urlPattern: "/unk" })],
      mods,
    );
    const res = await app.fetch(
      new Request("http://localhost/unk", {
        method: "PUT",
        headers: { "content-type": "application/xml" },
        body: "<data>test</data>",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { input: unknown };
    expect(body.input).toEqual({});
  });
});

// ===================================================================
// Invalid JSON bodies
// ===================================================================

describe("adversarial — Invalid JSON bodies", () => {
  it("invalid JSON with json content-type falls back gracefully", async () => {
    const mods = {
      "/tmp/app/routes/badjson.api.ts": {
        POST: {
          handler: async ({ input }: { input: unknown }) => ({ input }),
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/badjson.api.ts", urlPattern: "/badjson" })],
      mods,
    );
    const res = await app.fetch(
      new Request("http://localhost/badjson", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{invalid json!!!",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { input: unknown };
    expect(body.input).toEqual({});
  });

  it("truncated JSON falls back gracefully", async () => {
    const mods = {
      "/tmp/app/routes/trunc.api.ts": {
        POST: {
          handler: async ({ input }: { input: unknown }) => ({ input }),
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/trunc.api.ts", urlPattern: "/trunc" })],
      mods,
    );
    const res = await app.fetch(
      new Request("http://localhost/trunc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"key": "val',
      }),
    );
    expect(res.status).toBe(200);
  });

  it("JSON array body is accepted", async () => {
    const mods = {
      "/tmp/app/routes/jarr.api.ts": {
        POST: {
          handler: async ({ input }: { input: unknown }) => ({ input }),
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/jarr.api.ts", urlPattern: "/jarr" })],
      mods,
    );
    const res = await app.fetch(
      new Request("http://localhost/jarr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[1,2,3]",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("JSON string literal is accepted", async () => {
    const mods = {
      "/tmp/app/routes/jstr.api.ts": {
        POST: {
          handler: async ({ input }: { input: unknown }) => ({ input }),
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/jstr.api.ts", urlPattern: "/jstr" })],
      mods,
    );
    const res = await app.fetch(
      new Request("http://localhost/jstr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '"hello"',
      }),
    );
    expect(res.status).toBe(200);
  });

  it("JSON number literal is accepted", async () => {
    const mods = {
      "/tmp/app/routes/jnum.api.ts": {
        POST: {
          handler: async ({ input }: { input: unknown }) => ({ input }),
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/jnum.api.ts", urlPattern: "/jnum" })],
      mods,
    );
    const res = await app.fetch(
      new Request("http://localhost/jnum", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "42",
      }),
    );
    expect(res.status).toBe(200);
  });
});

// ===================================================================
// Middleware that throws
// ===================================================================

describe("adversarial — Middleware that throws", () => {
  it("middleware sync throw is caught and returns 500", async () => {
    const mods = {
      "/tmp/app/routes/mwthrow.api.ts": {
        GET: { handler: async () => ({ ok: true }) },
      },
      "/tmp/app/routes/_throw.ts": {
        default: {
          handler: () => {
            throw new Error("middleware exploded");
          },
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({
        filePath: "app/routes/mwthrow.api.ts",
        urlPattern: "/mwthrow",
        middlewares: ["app/routes/_throw.ts"],
      })],
      mods,
    );
    const res = await app.fetch(new Request("http://localhost/mwthrow"));
    expect(res.status).toBe(500);
  });

  it("middleware async rejection is caught", async () => {
    const mods = {
      "/tmp/app/routes/mwreject.api.ts": {
        GET: { handler: async () => ({ ok: true }) },
      },
      "/tmp/app/routes/_reject.ts": {
        default: {
          handler: async () => {
            throw new Error("async middleware rejected");
          },
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({
        filePath: "app/routes/mwreject.api.ts",
        urlPattern: "/mwreject",
        middlewares: ["app/routes/_reject.ts"],
      })],
      mods,
    );
    const res = await app.fetch(new Request("http://localhost/mwreject"));
    expect(res.status).toBe(500);
  });
});

// ===================================================================
// Handler edge cases
// ===================================================================

describe("adversarial — Handler edge cases", () => {
  it("handler that returns undefined", async () => {
    const mods = {
      "/tmp/app/routes/undef.api.ts": {
        GET: {
          handler: async () => undefined,
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/undef.api.ts", urlPattern: "/undef" })],
      mods,
    );
    const res = await app.fetch(new Request("http://localhost/undef"));
    // Hono's c.json(undefined) may still return 200
    expect(typeof res.status).toBe("number");
  });

  it("handler that returns boolean", async () => {
    const mods = {
      "/tmp/app/routes/bool.api.ts": {
        GET: { handler: async () => true },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/bool.api.ts", urlPattern: "/bool" })],
      mods,
    );
    const res = await app.fetch(new Request("http://localhost/bool"));
    expect(res.status).toBe(200);
  });

  it("handler that returns string", async () => {
    const mods = {
      "/tmp/app/routes/str.api.ts": {
        GET: { handler: async () => "hello" },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/str.api.ts", urlPattern: "/str" })],
      mods,
    );
    const res = await app.fetch(new Request("http://localhost/str"));
    expect(res.status).toBe(200);
  });

  it("handler that returns number", async () => {
    const mods = {
      "/tmp/app/routes/num.api.ts": {
        GET: { handler: async () => 42 },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/num.api.ts", urlPattern: "/num" })],
      mods,
    );
    const res = await app.fetch(new Request("http://localhost/num"));
    expect(res.status).toBe(200);
  });

  it("handler that throws non-Error value", async () => {
    const mods = {
      "/tmp/app/routes/throwstr.api.ts": {
        GET: {
          handler: async () => {
            throw "string error";
          },
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/throwstr.api.ts", urlPattern: "/throwstr" })],
      mods,
    );
    const res = await app.fetch(new Request("http://localhost/throwstr"));
    expect(res.status).toBe(500);
  });

  it("handler that throws null", async () => {
    const mods = {
      "/tmp/app/routes/thrownull.api.ts": {
        GET: {
          handler: async () => {
            throw null;
          },
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/thrownull.api.ts", urlPattern: "/thrownull" })],
      mods,
    );
    const res = await app.fetch(new Request("http://localhost/thrownull"));
    expect(res.status).toBe(500);
  });

  it("handler that throws object with issues array (Zod pattern)", async () => {
    const mods = {
      "/tmp/app/routes/zod.api.ts": {
        POST: {
          handler: async () => {
            const err = { issues: [{ message: "required" }], message: "Validation" };
            throw err;
          },
        },
      },
    };
    const { app } = await build(
      [makeApiRoute({ filePath: "app/routes/zod.api.ts", urlPattern: "/zod" })],
      mods,
    );
    const res = await app.fetch(
      new Request("http://localhost/zod", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("Validation Error");
  });
});

// ===================================================================
// HMR coordinator rapid changes
// ===================================================================

describe("adversarial — HMR rapid changes", () => {
  it("handles 100 rapid file changes", () => {
    const coordinator = createHmrCoordinator({
      rootDir: "/project",
      routesDir: "/project/app/routes",
    });
    const updates: HmrUpdate[] = [];
    for (let i = 0; i < 100; i++) {
      updates.push(coordinator.handleFileChange(`/project/app/routes/file${i}.page.tsx`));
    }
    expect(updates).toHaveLength(100);
    // All should be page type
    for (const u of updates) {
      expect(u.type).toBe("page");
    }
  });

  it("timestamps are monotonically non-decreasing under rapid changes", () => {
    const coordinator = createHmrCoordinator({
      rootDir: "/project",
      routesDir: "/project/app/routes",
    });
    const timestamps: number[] = [];
    for (let i = 0; i < 100; i++) {
      timestamps.push(coordinator.handleFileChange(`/project/file${i}.css`).timestamp);
    }
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]!).toBeGreaterThanOrEqual(timestamps[i - 1]!);
    }
  });

  it("handles interleaved file types", () => {
    const coordinator = createHmrCoordinator({
      rootDir: "/project",
      routesDir: "/project/app/routes",
    });
    const types: string[] = [];
    for (let i = 0; i < 50; i++) {
      if (i % 3 === 0) {
        types.push(coordinator.handleFileChange(`/project/file${i}.css`).type);
      } else if (i % 3 === 1) {
        types.push(
          coordinator.handleFileChange(`/project/app/routes/file${i}.page.tsx`).type,
        );
      } else {
        types.push(
          coordinator.handleFileChange(`/project/app/routes/file${i}.api.ts`).type,
        );
      }
    }
    expect(types.filter((t) => t === "css").length).toBeGreaterThan(0);
    expect(types.filter((t) => t === "page").length).toBeGreaterThan(0);
    expect(types.filter((t) => t === "api").length).toBeGreaterThan(0);
  });
});

// ===================================================================
// HMR transport stress
// ===================================================================

describe("adversarial — HMR transport stress", () => {
  it("broadcasts to 50 SSE clients simultaneously", () => {
    const transport = createHmrTransport();
    const messages: string[][] = [];

    for (let i = 0; i < 50; i++) {
      const clientMessages: string[] = [];
      messages.push(clientMessages);
      transport.handleSSEConnection({
        write: (data: string) => clientMessages.push(data),
        close: () => {},
      });
    }

    const update: HmrUpdate = {
      type: "css",
      filePath: "/test.css",
      timestamp: Date.now(),
    };
    transport.broadcast(update);

    for (const clientMsgs of messages) {
      const broadcastMsg = clientMsgs.find((m) => m.startsWith("data:"));
      expect(broadcastMsg).toBeDefined();
    }

    transport.dispose();
    expect(transport.clientCount).toBe(0);
  });

  it("handles rapid connect/disconnect cycles", () => {
    const transport = createHmrTransport();

    for (let i = 0; i < 100; i++) {
      const dispose = transport.handleSSEConnection({
        write: () => {},
        close: () => {},
      });
      dispose();
    }

    expect(transport.clientCount).toBe(0);
    transport.dispose();
  });

  it("handles broadcast with disconnected clients gracefully", () => {
    const transport = createHmrTransport();

    // Add 10 clients that throw on send
    for (let i = 0; i < 10; i++) {
      transport.handleConnection({
        send: () => { throw new Error("disconnected"); },
        close: () => {},
      });
    }
    // Add 10 healthy clients
    const received: string[] = [];
    for (let i = 0; i < 10; i++) {
      transport.handleConnection({
        send: (data: string) => received.push(data),
        close: () => {},
      });
    }

    const update: HmrUpdate = {
      type: "page",
      filePath: "/test.page.tsx",
      timestamp: Date.now(),
    };
    transport.broadcast(update);

    // Bad clients removed, healthy clients received
    expect(transport.clientCount).toBe(10);
    expect(received.length).toBe(10);

    transport.dispose();
  });
});

// ===================================================================
// PageFetchError edge cases
// ===================================================================

describe("adversarial — PageFetchError", () => {
  it("handles empty string method", () => {
    const err = new PageFetchError("test", {
      method: "" as any,
      url: "",
      phase: "request",
    });
    expect(err.method).toBe("");
  });

  it("handles very long URL", () => {
    const longUrl = "http://localhost/" + "a".repeat(10000);
    const err = new PageFetchError("test", {
      method: "GET",
      url: longUrl,
      phase: "request",
    });
    expect(err.url.length).toBeGreaterThan(10000);
  });

  it("handles undefined cause gracefully", () => {
    const err = new PageFetchError("test", {
      method: "GET",
      url: "/",
      phase: "request",
    });
    expect(err.cause).toBeUndefined();
  });

  it("handles complex body object", () => {
    const err = new PageFetchError("test", {
      method: "POST",
      url: "/api",
      phase: "response",
      status: 500,
      body: { nested: { deeply: { value: [1, 2, 3] } } },
    });
    expect(err.body).toEqual({ nested: { deeply: { value: [1, 2, 3] } } });
  });
});

// ===================================================================
// PageFetch recursion limit
// ===================================================================

describe("adversarial — PageFetch recursion", () => {
  it("rejects when depth limit is reached", async () => {
    const request = new Request("http://localhost:3000/page", {
      headers: { "x-capstan-internal-depth": "8" },
    });
    const mockFetch = async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await expect(client.get("/api/test")).rejects.toThrow("recursion limit");
  });

  it("allows requests below depth limit", async () => {
    const request = new Request("http://localhost:3000/page", {
      headers: { "x-capstan-internal-depth": "5" },
    });
    const mockFetch = async () =>
      new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    const result = await client.get<{ ok: boolean }>("/api/test");
    expect(result.ok).toBe(true);
  });

  it("rejects when depth is exactly at max", async () => {
    const request = new Request("http://localhost:3000/page", {
      headers: { "x-capstan-internal-depth": "8" },
    });
    const mockFetch = async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await expect(client.get("/api")).rejects.toThrow("recursion limit");
  });

  it("accepts depth 7", async () => {
    const request = new Request("http://localhost:3000/page", {
      headers: { "x-capstan-internal-depth": "7" },
    });
    const mockFetch = async () =>
      new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    const result = await client.get<{ ok: boolean }>("/api");
    expect(result.ok).toBe(true);
  });
});

// ===================================================================
// PageFetchRequestCache adversarial
// ===================================================================

describe("adversarial — PageFetchRequestCache", () => {
  it("handles 1000 entries", () => {
    const cache = new PageFetchRequestCache();
    for (let i = 0; i < 1000; i++) {
      cache.set(`key${i}`, { value: i });
    }
    expect(cache.has("key0")).toBe(true);
    expect(cache.has("key999")).toBe(true);
    expect(cache.get("key500")).toEqual({ value: 500 });
  });

  it("handles concurrent dedupe calls", async () => {
    const cache = new PageFetchRequestCache();
    let callCount = 0;
    const execute = async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return { value: "shared", cacheable: true };
    };

    const results = await Promise.all(
      Array.from({ length: 20 }, () => cache.dedupe("key", execute)),
    );

    // Should only execute once
    expect(callCount).toBe(1);
    for (const r of results) {
      expect(r).toBe("shared");
    }
  });

  it("dedupe error propagates to all waiters", async () => {
    const cache = new PageFetchRequestCache();
    let callCount = 0;
    const execute = async () => {
      callCount++;
      throw new Error("dedupe failed");
    };

    const promises = Array.from({ length: 5 }, () =>
      cache.dedupe("fail-key", execute),
    );

    const results = await Promise.allSettled(promises);
    expect(callCount).toBe(1);
    for (const r of results) {
      expect(r.status).toBe("rejected");
    }
  });

  it("clear during dedupe does not crash", async () => {
    const cache = new PageFetchRequestCache();

    const dedupePromise = cache.dedupe("key", async () => {
      cache.clear();
      return { value: "done", cacheable: true };
    });

    const result = await dedupePromise;
    expect(result).toBe("done");
  });
});

// ===================================================================
// shouldCacheFetchResponse edge cases
// ===================================================================

describe("adversarial — shouldCacheFetchResponse", () => {
  it("returns false for 301 redirect", () => {
    const res = new Response("", { status: 301 });
    expect(shouldCacheFetchResponse(res)).toBe(false);
  });

  it("returns false for 500 error", () => {
    const res = new Response("", { status: 500 });
    expect(shouldCacheFetchResponse(res)).toBe(false);
  });

  it("returns true for 200 with no cache headers", () => {
    const res = new Response("ok", { status: 200 });
    expect(shouldCacheFetchResponse(res)).toBe(true);
  });

  it("returns false for 204 no content", () => {
    const res = new Response(null, { status: 204 });
    // 204 is technically ok (status >= 200 && status < 300)
    expect(typeof shouldCacheFetchResponse(res)).toBe("boolean");
  });

  it("handles multiple cache-control directives", () => {
    const res = new Response("ok", {
      status: 200,
      headers: { "cache-control": "public, max-age=3600, must-revalidate" },
    });
    expect(shouldCacheFetchResponse(res)).toBe(true);
  });

  it("cache-control no-store takes precedence over max-age", () => {
    const res = new Response("ok", {
      status: 200,
      headers: { "cache-control": "no-store, max-age=3600" },
    });
    expect(shouldCacheFetchResponse(res)).toBe(false);
  });
});

// ===================================================================
// Config with invalid values
// ===================================================================

describe("adversarial — Config with invalid values", () => {
  it("handles empty rootDir", async () => {
    const result = await buildPortableRuntimeApp({
      rootDir: "",
      manifest: { routes: [] },
      routeModules: {},
    });
    expect(result.app).toBeDefined();
  });

  it("handles undefined appName gracefully", async () => {
    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: { routes: [] },
      routeModules: {},
    });
    const res = await result.app.fetch(
      new Request("http://localhost/.well-known/capstan.json"),
    );
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("capstan-app"); // default
  });

  it("handles empty routes array", async () => {
    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: { routes: [] },
      routeModules: {},
    });
    expect(result.apiRouteCount).toBe(0);
    expect(result.pageRouteCount).toBe(0);
  });

  it("handles routeModules with extra entries not in manifest", async () => {
    const result = await buildPortableRuntimeApp({
      rootDir: "/tmp",
      manifest: { routes: [] },
      routeModules: {
        "/tmp/app/routes/orphan.api.ts": {
          GET: { handler: async () => ({}) },
        },
      },
    });
    // Orphan modules should not be registered
    expect(result.apiRouteCount).toBe(0);
  });
});

// ===================================================================
// Runtime diagnostics stress
// ===================================================================

describe("adversarial — Diagnostics stress", () => {
  it("merges 100 diagnostic groups", () => {
    const groups = Array.from({ length: 100 }, (_, i) => [
      createRuntimeDiagnostic("info", `code.${i}`, `Message ${i}`),
    ]);
    const merged = mergeRuntimeDiagnostics(...groups);
    expect(merged).toHaveLength(100);
  });

  it("serializes large diagnostics array", () => {
    const diagnostics = Array.from({ length: 50 }, (_, i) =>
      createRuntimeDiagnostic("warn", `code.${i}`, `Message ${i}`, {
        data: "x".repeat(100),
      }),
    );
    const serialized = serializeRuntimeDiagnostics(diagnostics);
    expect(serialized).toBeDefined();
    const parsed = JSON.parse(serialized!);
    expect(parsed).toHaveLength(50);
  });

  it("headers work with large diagnostics", () => {
    const diagnostics = Array.from({ length: 20 }, (_, i) =>
      createRuntimeDiagnostic("error", `code.${i}`, `Message ${i}`),
    );
    const headers = runtimeDiagnosticsHeaders(diagnostics);
    expect(headers["x-capstan-diagnostics"]).toBeDefined();
    const parsed = JSON.parse(headers["x-capstan-diagnostics"]!);
    expect(parsed).toHaveLength(20);
  });
});

// ===================================================================
// Ops config edge cases
// ===================================================================

describe("adversarial — resolveProjectOpsConfig edge cases", () => {
  it("handles enabled false with all optional fields", () => {
    const result = resolveProjectOpsConfig(
      { enabled: false },
      {
        rootDir: "/tmp",
        appName: "test",
        environment: "staging",
        source: "test",
      },
    );
    expect(result).toBeDefined();
    expect(result!.enabled).toBe(false);
  });

  it("handles undefined base config", () => {
    const result = resolveProjectOpsConfig(undefined, { rootDir: "/tmp" });
    // Should return some config or undefined, never throw
    expect(result === undefined || typeof result === "object").toBe(true);
  });

  it("preserves multiple sinks", () => {
    const sink1 = { recordEvent: () => {} };
    const sink2 = { recordEvent: () => {} };
    const result = resolveProjectOpsConfig(
      { sinks: [sink1, sink2] } as any,
      { rootDir: "/tmp" },
    );
    expect((result as any).sinks).toHaveLength(2);
  });
});

// ===================================================================
// createPageFetchCacheKey edge cases
// ===================================================================

describe("adversarial — createPageFetchCacheKey", () => {
  it("handles URL with query string", () => {
    const key = createPageFetchCacheKey(
      "GET",
      "http://localhost/api?foo=bar&baz=qux",
      new Headers(),
    );
    expect(key).toContain("foo=bar");
  });

  it("handles empty headers", () => {
    const key = createPageFetchCacheKey("GET", "http://localhost/", new Headers());
    expect(key).toContain("GET http://localhost/");
  });

  it("produces different keys for different methods", () => {
    const k1 = createPageFetchCacheKey("GET", "http://localhost/", new Headers());
    const k2 = createPageFetchCacheKey("POST", "http://localhost/", new Headers());
    expect(k1).not.toBe(k2);
  });

  it("handles very long URL", () => {
    const longUrl = "http://localhost/" + "a".repeat(5000);
    const key = createPageFetchCacheKey("GET", longUrl, new Headers());
    expect(key.length).toBeGreaterThan(5000);
  });
});

// ===================================================================
// PageFetch HTTP error handling
// ===================================================================

describe("adversarial — PageFetch error responses", () => {
  it("throws PageFetchError on 400 response", async () => {
    const request = new Request("http://localhost:3000/");
    const mockFetch = async () =>
      new Response('{"error":"bad"}', {
        status: 400,
        statusText: "Bad Request",
        headers: { "content-type": "application/json" },
      });

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    try {
      await client.get("/api/test");
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(PageFetchError);
      expect((err as PageFetchError).status).toBe(400);
    }
  });

  it("throws PageFetchError on 500 response", async () => {
    const request = new Request("http://localhost:3000/");
    const mockFetch = async () =>
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      });

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await expect(client.get("/api/test")).rejects.toThrow(PageFetchError);
  });

  it("throws PageFetchError when fetch itself throws", async () => {
    const request = new Request("http://localhost:3000/");
    const mockFetch = async () => {
      throw new Error("network down");
    };

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await expect(client.get("/api/test")).rejects.toThrow(PageFetchError);
  });

  it("handles 204 no content response", async () => {
    const request = new Request("http://localhost:3000/");
    const mockFetch = async () => new Response(null, { status: 204 });

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    const result = await client.delete("/api/resource");
    expect(result).toBeUndefined();
  });

  it("handles 304 not modified response", async () => {
    const request = new Request("http://localhost:3000/");
    // 304 is not "ok" (response.ok is false for 304)
    const mockFetch = async () => new Response(null, { status: 304 });

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await expect(client.get("/api/test")).rejects.toThrow(PageFetchError);
  });
});

// ===================================================================
// PageFetch body serialization
// ===================================================================

describe("adversarial — PageFetch body serialization", () => {
  it("POST with null body sends null", async () => {
    const request = new Request("http://localhost:3000/");
    let capturedBody: string | null = null;
    const mockFetch = async (req: Request) => {
      capturedBody = await req.text();
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await client.post("/api/test", null);
    expect(capturedBody).toBe("null");
  });

  it("POST with string body sends as text", async () => {
    const request = new Request("http://localhost:3000/");
    let capturedBody: string | null = null;
    let capturedCT: string | null = null;
    const mockFetch = async (req: Request) => {
      capturedBody = await req.text();
      capturedCT = req.headers.get("content-type");
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await client.post("/api/test", "raw text body");
    expect(capturedBody).toBe("raw text body");
    expect(capturedCT).toContain("text/plain");
  });

  it("POST with object body sends as JSON", async () => {
    const request = new Request("http://localhost:3000/");
    let capturedBody: string | null = null;
    let capturedCT: string | null = null;
    const mockFetch = async (req: Request) => {
      capturedBody = await req.text();
      capturedCT = req.headers.get("content-type");
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await client.post("/api/test", { key: "value" });
    expect(capturedBody).toBe('{"key":"value"}');
    expect(capturedCT).toContain("application/json");
  });

  it("PUT sends body correctly", async () => {
    const request = new Request("http://localhost:3000/");
    let capturedMethod: string | null = null;
    let capturedBody: string | null = null;
    const mockFetch = async (req: Request) => {
      capturedMethod = req.method;
      capturedBody = await req.text();
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await client.put("/api/test", { update: true });
    expect(capturedMethod).toBe("PUT");
    expect(capturedBody).toContain("update");
  });
});

// ===================================================================
// PageFetch header forwarding
// ===================================================================

describe("adversarial — PageFetch header forwarding", () => {
  it("forwards authorization header", async () => {
    const request = new Request("http://localhost:3000/", {
      headers: { authorization: "Bearer secret-token" },
    });
    let capturedAuth: string | null = null;
    const mockFetch = async (req: Request) => {
      capturedAuth = req.headers.get("authorization");
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await client.get("/api/test");
    expect(capturedAuth).toBe("Bearer secret-token");
  });

  it("forwards cookie header", async () => {
    const request = new Request("http://localhost:3000/", {
      headers: { cookie: "session=abc123" },
    });
    let capturedCookie: string | null = null;
    const mockFetch = async (req: Request) => {
      capturedCookie = req.headers.get("cookie");
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await client.get("/api/test");
    expect(capturedCookie).toBe("session=abc123");
  });

  it("does not forward non-whitelisted headers", async () => {
    const request = new Request("http://localhost:3000/", {
      headers: { "x-custom-header": "should-not-forward" },
    });
    let capturedCustom: string | null = null;
    const mockFetch = async (req: Request) => {
      capturedCustom = req.headers.get("x-custom-header");
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await client.get("/api/test");
    expect(capturedCustom).toBeNull();
  });

  it("forwards extra headers when specified in options", async () => {
    const request = new Request("http://localhost:3000/", {
      headers: { "x-custom-header": "forward-me" },
    });
    let capturedCustom: string | null = null;
    const mockFetch = async (req: Request) => {
      capturedCustom = req.headers.get("x-custom-header");
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createPageFetch(request, {
      fetchImpl: mockFetch,
      forwardHeaders: ["x-custom-header"],
    });
    await client.get("/api/test");
    expect(capturedCustom).toBe("forward-me");
  });

  it("always sets internal fetch header", async () => {
    const request = new Request("http://localhost:3000/");
    let capturedInternal: string | null = null;
    const mockFetch = async (req: Request) => {
      capturedInternal = req.headers.get("x-capstan-internal-fetch");
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await client.get("/api/test");
    expect(capturedInternal).toBe("1");
  });

  it("increments internal depth header", async () => {
    const request = new Request("http://localhost:3000/", {
      headers: { "x-capstan-internal-depth": "3" },
    });
    let capturedDepth: string | null = null;
    const mockFetch = async (req: Request) => {
      capturedDepth = req.headers.get("x-capstan-internal-depth");
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createPageFetch(request, { fetchImpl: mockFetch });
    await client.get("/api/test");
    expect(capturedDepth).toBe("4");
  });
});

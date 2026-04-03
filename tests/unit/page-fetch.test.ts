import { beforeEach, describe, expect, test } from "bun:test";
import {
  MemoryStore,
  cacheClear,
  cacheInvalidatePath,
  cacheInvalidateTag,
  setCacheStore,
} from "@zauso-ai/capstan-core";
import { createPageFetch, PageFetchError } from "../../packages/dev/src/page-fetch.js";

function makeRequest(
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { headers });
}

beforeEach(async () => {
  setCacheStore(new MemoryStore());
  await cacheClear();
});

describe("createPageFetch", () => {
  test("builds URLs from the current request, merges query params, and forwards only security-relevant headers by default", async () => {
    const calls: Array<{
      url: string;
      method: string;
      headers: Headers;
    }> = [];

    const fetchImpl = async (request: Request): Promise<Response> => {
      calls.push({
        url: request.url,
        method: request.method,
        headers: new Headers(request.headers),
      });
      return Response.json({ ok: true });
    };

    const client = createPageFetch(
      makeRequest("https://example.com/app/posts/42?draft=1", {
        authorization: "Bearer abc",
        cookie: "sid=123; theme=dark",
        origin: "https://example.com",
        referer: "https://example.com/app/posts/42",
        "x-api-key": "key-123",
        "x-csrf-token": "csrf-456",
        "x-trace-id": "skip-me",
      }),
      { fetchImpl },
    );

    await client.get("/api/tickets?status=open", {
      page: "2",
      q: "space here",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(
      "https://example.com/api/tickets?status=open&page=2&q=space+here",
    );
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer abc");
    expect(calls[0]!.headers.get("cookie")).toBe("sid=123; theme=dark");
    expect(calls[0]!.headers.get("origin")).toBe("https://example.com");
    expect(calls[0]!.headers.get("referer")).toBe("https://example.com/app/posts/42");
    expect(calls[0]!.headers.get("x-api-key")).toBe("key-123");
    expect(calls[0]!.headers.get("x-csrf-token")).toBe("csrf-456");
    expect(calls[0]!.headers.get("accept")).toBe("application/json");
    expect(calls[0]!.headers.get("x-capstan-internal-fetch")).toBe("1");
    expect(calls[0]!.headers.get("x-capstan-internal-depth")).toBe("1");
    expect(calls[0]!.headers.get("x-trace-id")).toBeNull();
  });

  test("allows opt-in forwarding of additional headers", async () => {
    let forwardedTraceId: string | null = null;

    const client = createPageFetch(
      makeRequest("https://example.com/dashboard", {
        authorization: "Bearer abc",
        "x-trace-id": "trace-123",
      }),
      {
        fetchImpl: async (request: Request): Promise<Response> => {
          forwardedTraceId = request.headers.get("x-trace-id");
          return Response.json({ ok: true });
        },
        forwardHeaders: ["x-trace-id"],
      },
    );

    await client.get("/api/health");

    expect(forwardedTraceId).toBe("trace-123");
  });

  test("resolves relative paths against the current request URL", async () => {
    let seenUrl = "";

    const client = createPageFetch(
      makeRequest("https://example.com/app/users/42"),
      {
        fetchImpl: async (request: Request): Promise<Response> => {
          seenUrl = request.url;
          return new Response("ok");
        },
      },
    );

    await client.get("../api/logs");

    expect(seenUrl).toBe("https://example.com/app/api/logs");
  });

  test("serializes object bodies as JSON and keeps explicit content type when present", async () => {
    let seenBody = "";
    let seenContentType = "";

    const client = createPageFetch(
      makeRequest("https://example.com/app"),
      {
        fetchImpl: async (request: Request): Promise<Response> => {
          seenBody = await request.text();
          seenContentType = request.headers.get("content-type") ?? "";
          return Response.json({ id: 1 });
        },
      },
    );

    const result = await client.post("/api/items", {
      name: "Alpha",
      enabled: true,
    });

    expect(seenBody).toBe(JSON.stringify({ name: "Alpha", enabled: true }));
    expect(seenContentType).toBe("application/json;charset=UTF-8");
    expect(result).toEqual({ id: 1 });
  });

  test("derives the CSRF header from the cookie for internal state-changing requests", async () => {
    let seenCsrfHeader = "";

    const client = createPageFetch(
      makeRequest("https://example.com/app", {
        cookie: "__csrf=csrf-cookie-value; sid=123",
      }),
      {
        fetchImpl: async (request: Request): Promise<Response> => {
          seenCsrfHeader = request.headers.get("x-csrf-token") ?? "";
          return Response.json({ ok: true });
        },
      },
    );

    await client.post("/api/items", { name: "With CSRF" });

    expect(seenCsrfHeader).toBe("csrf-cookie-value");
  });

  test("supports put requests with JSON bodies", async () => {
    let seenMethod = "";
    let seenBody = "";

    const client = createPageFetch(
      makeRequest("https://example.com/app"),
      {
        fetchImpl: async (request: Request): Promise<Response> => {
          seenMethod = request.method;
          seenBody = await request.text();
          return Response.json({ updated: true });
        },
      },
    );

    await expect(
      client.put("/api/items/42", { status: "done" }),
    ).resolves.toEqual({ updated: true });

    expect(seenMethod).toBe("PUT");
    expect(seenBody).toBe(JSON.stringify({ status: "done" }));
  });

  test("supports delete requests without a request body", async () => {
    let seenMethod = "";
    let seenBody = "";

    const client = createPageFetch(
      makeRequest("https://example.com/app"),
      {
        fetchImpl: async (request: Request): Promise<Response> => {
          seenMethod = request.method;
          seenBody = await request.text();
          return Response.json({ removed: true });
        },
      },
    );

    await expect(
      client.delete("/api/items/42"),
    ).resolves.toEqual({ removed: true });

    expect(seenMethod).toBe("DELETE");
    expect(seenBody).toBe("");
  });

  test("parses JSON, text, and no-content responses", async () => {
    const client = createPageFetch(
      makeRequest("https://example.com/app"),
      {
        fetchImpl: async (request: Request): Promise<Response> => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/api/json") {
            return Response.json({ ok: true, count: 3 });
          }
          if (pathname === "/api/empty") {
            return new Response(null, { status: 204 });
          }
          return new Response("plain text");
        },
      },
    );

    await expect(client.get("/api/json")).resolves.toEqual({ ok: true, count: 3 });
    await expect(client.get("/api/text")).resolves.toBe("plain text");
    await expect(client.get("/api/empty")).resolves.toBeUndefined();
  });

  test("deduplicates concurrent GET requests and caches the successful result", async () => {
    let calls = 0;
    const client = createPageFetch(
      makeRequest("https://example.com/app", {
        authorization: "Bearer abc",
      }),
      {
        fetchImpl: async (request: Request): Promise<Response> => {
          calls++;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return Response.json({
            url: request.url,
            call: calls,
          });
        },
      },
    );

    const [first, second] = await Promise.all([
      client.get<{ url: string; call: number }>("/api/dedupe?foo=1"),
      client.get<{ url: string; call: number }>("/api/dedupe?foo=1"),
    ]);

    expect(calls).toBe(1);
    expect(first).toEqual(second);
    expect(first.call).toBe(1);

    const third = await client.get<{ url: string; call: number }>("/api/dedupe?foo=1");
    expect(calls).toBe(1);
    expect(third).toEqual(first);
  });

  test("does not persist responses that opt out of caching", async () => {
    let calls = 0;
    const client = createPageFetch(
      makeRequest("https://example.com/app"),
      {
        fetchImpl: async (): Promise<Response> => {
          calls++;
          return new Response(JSON.stringify({ call: calls }), {
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          });
        },
      },
    );

    const first = await client.get<{ call: number }>("/api/no-store");
    const second = await client.get<{ call: number }>("/api/no-store");

    expect(first.call).toBe(1);
    expect(second.call).toBe(2);
    expect(calls).toBe(2);
  });

  test("reuses shared GET cache across page fetch clients and invalidates by path", async () => {
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls++;
      return new Response(JSON.stringify({ call: calls }), {
        headers: {
          "content-type": "application/json",
          "cache-control": "max-age=60",
        },
      });
    };

    const firstClient = createPageFetch(
      makeRequest("https://example.com/app/projects"),
      { fetchImpl },
    );
    const secondClient = createPageFetch(
      makeRequest("https://example.com/app/dashboard"),
      { fetchImpl },
    );

    expect(await firstClient.get<{ call: number }>("/api/projects")).toEqual({ call: 1 });
    expect(await secondClient.get<{ call: number }>("/api/projects")).toEqual({ call: 1 });
    expect(calls).toBe(1);

    await cacheInvalidatePath("/api/projects");
    const thirdClient = createPageFetch(
      makeRequest("https://example.com/app/reports"),
      { fetchImpl },
    );

    expect(await thirdClient.get<{ call: number }>("/api/projects")).toEqual({ call: 2 });
    expect(calls).toBe(2);
  });

  test("propagates shared cache tags so invalidating a tag evicts cached fetch payloads", async () => {
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls++;
      return new Response(JSON.stringify({ call: calls }), {
        headers: {
          "content-type": "application/json",
          "cache-control": "max-age=120",
          "x-capstan-cache-tags": "team:ops, project:atlas",
        },
      });
    };

    const firstClient = createPageFetch(
      makeRequest("https://example.com/app/ops"),
      { fetchImpl },
    );
    const secondClient = createPageFetch(
      makeRequest("https://example.com/app/ops/settings"),
      { fetchImpl },
    );

    expect(await firstClient.get<{ call: number }>("/api/ops")).toEqual({ call: 1 });
    expect(await secondClient.get<{ call: number }>("/api/ops")).toEqual({ call: 1 });
    expect(calls).toBe(1);

    await cacheInvalidateTag("team:ops");
    const thirdClient = createPageFetch(
      makeRequest("https://example.com/app/ops/overview"),
      { fetchImpl },
    );

    expect(await thirdClient.get<{ call: number }>("/api/ops")).toEqual({ call: 2 });
    expect(calls).toBe(2);
  });

  test("throws an informative error for non-ok JSON responses", async () => {
    const client = createPageFetch(
      makeRequest("https://example.com/app"),
      {
        fetchImpl: async () =>
          Response.json(
            { error: "Forbidden", reason: "Authentication required" },
            { status: 403, statusText: "Forbidden" },
          ),
      },
    );

    try {
      await client.get("/api/secure");
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(PageFetchError);
      const pageError = error as PageFetchError;
      expect(pageError.phase).toBe("response");
      expect(pageError.status).toBe(403);
      expect(pageError.method).toBe("GET");
      expect(pageError.url).toBe("https://example.com/api/secure");
      expect(pageError.message).toContain("GET https://example.com/api/secure");
      expect(pageError.message).toContain("403 Forbidden");
      expect(pageError.message).toContain("Authentication required");
    }
  });

  test("throws a parse error when a JSON response is malformed", async () => {
    const client = createPageFetch(
      makeRequest("https://example.com/app"),
      {
        fetchImpl: async () =>
          new Response("{not json", {
            headers: { "content-type": "application/json" },
          }),
      },
    );

    try {
      await client.get("/api/broken");
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(PageFetchError);
      const pageError = error as PageFetchError;
      expect(pageError.phase).toBe("parse");
      expect(pageError.method).toBe("GET");
      expect(pageError.url).toBe("https://example.com/api/broken");
      expect(pageError.message).toContain("Failed to parse JSON response");
      expect(pageError.message).toContain("GET https://example.com/api/broken");
    }
  });

  test("fails fast when the internal fetch depth limit is exceeded", async () => {
    const client = createPageFetch(
      makeRequest("https://example.com/app", {
        "x-capstan-internal-depth": "8",
      }),
      {
        fetchImpl: async (): Promise<Response> => {
          throw new Error("should not reach fetchImpl");
        },
      },
    );

    await expect(client.get("/api/loop")).rejects.toMatchObject({
      name: "PageFetchError",
      phase: "request",
    });
  });
});

import { describe, it, expect } from "bun:test";
import { csrfProtection } from "@zauso-ai/capstan-core";
import type { Context, Next } from "hono";

// ---------------------------------------------------------------------------
// Helpers — lightweight Hono context mock
// ---------------------------------------------------------------------------

interface MockContextOpts {
  method: string;
  url?: string;
  headers?: Record<string, string>;
}

function createMockContext(opts: MockContextOpts) {
  const headers = new Map<string, string>();
  const responseHeaders = new Map<string, string>();
  let responseStatus: number | undefined;
  let responseBody: unknown;
  let nextCalled = false;

  // Normalise incoming headers to lowercase keys for lookup.
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) {
      headers.set(k.toLowerCase(), v);
    }
  }

  const ctx = {
    req: {
      method: opts.method,
      url: opts.url ?? "http://localhost/test",
      header(name: string) {
        return headers.get(name.toLowerCase());
      },
    },
    header(name: string, value: string) {
      responseHeaders.set(name, value);
    },
    json(body: unknown, status?: number) {
      responseBody = body;
      responseStatus = status ?? 200;
      return new Response(JSON.stringify(body), { status: responseStatus });
    },
  } as unknown as Context;

  const next: Next = async () => {
    nextCalled = true;
  };

  return {
    ctx,
    next,
    get nextCalled() {
      return nextCalled;
    },
    responseHeaders,
    get responseStatus() {
      return responseStatus;
    },
    get responseBody() {
      return responseBody;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("csrfProtection", () => {
  it("returns a function (middleware factory)", () => {
    const middleware = csrfProtection();
    expect(typeof middleware).toBe("function");
  });

  // -----------------------------------------------------------------------
  // Safe methods — token issuance
  // -----------------------------------------------------------------------

  it("GET request: sets CSRF cookie in response", async () => {
    const middleware = csrfProtection();
    const { ctx, next, responseHeaders } = createMockContext({ method: "GET" });

    await middleware(ctx, next);

    const setCookie = responseHeaders.get("Set-Cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("__csrf=");
  });

  it("GET request: sets X-CSRF-Token response header", async () => {
    const middleware = csrfProtection();
    const { ctx, next, responseHeaders } = createMockContext({ method: "GET" });

    await middleware(ctx, next);

    const tokenHeader = responseHeaders.get("X-CSRF-Token");
    expect(tokenHeader).toBeDefined();
    expect(typeof tokenHeader).toBe("string");
    expect(tokenHeader!.length).toBeGreaterThan(0);
  });

  it("GET request: calls next()", async () => {
    const middleware = csrfProtection();
    const mock = createMockContext({ method: "GET" });

    await middleware(mock.ctx, mock.next);

    expect(mock.nextCalled).toBe(true);
  });

  it("CSRF token cookie has correct attributes (SameSite, Path)", async () => {
    const middleware = csrfProtection();
    const { ctx, next, responseHeaders } = createMockContext({ method: "GET" });

    await middleware(ctx, next);

    const setCookie = responseHeaders.get("Set-Cookie")!;
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    // The cookie should NOT be HttpOnly — client JS needs to read it.
    expect(setCookie).not.toContain("HttpOnly");
  });

  it("GET request: token in cookie matches token in response header", async () => {
    const middleware = csrfProtection();
    const { ctx, next, responseHeaders } = createMockContext({ method: "GET" });

    await middleware(ctx, next);

    const tokenHeader = responseHeaders.get("X-CSRF-Token")!;
    const setCookie = responseHeaders.get("Set-Cookie")!;
    // Extract token value from cookie string: "__csrf=<value>; ..."
    const cookieToken = setCookie.split("=")[1]!.split(";")[0]!;
    expect(cookieToken).toBe(tokenHeader);
  });

  // -----------------------------------------------------------------------
  // State-changing methods — token validation
  // -----------------------------------------------------------------------

  it("POST request without token: returns 403", async () => {
    const middleware = csrfProtection();
    const mock = createMockContext({ method: "POST" });

    const response = await middleware(mock.ctx, mock.next);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(403);
    expect(mock.nextCalled).toBe(false);
  });

  it("POST request with valid token (cookie + header match): passes through", async () => {
    const middleware = csrfProtection();
    const token = "abc123def456";
    const mock = createMockContext({
      method: "POST",
      headers: {
        Cookie: `__csrf=${token}`,
        "X-CSRF-Token": token,
      },
    });

    await middleware(mock.ctx, mock.next);

    expect(mock.nextCalled).toBe(true);
  });

  it("POST request with mismatched cookie/header: returns 403", async () => {
    const middleware = csrfProtection();
    const mock = createMockContext({
      method: "POST",
      headers: {
        Cookie: "__csrf=token_a",
        "X-CSRF-Token": "token_b",
      },
    });

    const response = await middleware(mock.ctx, mock.next);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(403);
    expect(mock.nextCalled).toBe(false);
  });

  it("Missing CSRF cookie on POST: returns 403", async () => {
    const middleware = csrfProtection();
    const mock = createMockContext({
      method: "POST",
      headers: {
        "X-CSRF-Token": "some_token",
      },
    });

    const response = await middleware(mock.ctx, mock.next);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(403);
    expect(mock.nextCalled).toBe(false);
  });

  it("Missing CSRF header on POST: returns 403", async () => {
    const middleware = csrfProtection();
    const mock = createMockContext({
      method: "POST",
      headers: {
        Cookie: "__csrf=some_token",
      },
    });

    const response = await middleware(mock.ctx, mock.next);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(403);
    expect(mock.nextCalled).toBe(false);
  });

  // -----------------------------------------------------------------------
  // PUT / DELETE / PATCH also require CSRF
  // -----------------------------------------------------------------------

  it("PUT request without token: returns 403", async () => {
    const middleware = csrfProtection();
    const mock = createMockContext({ method: "PUT" });

    const response = await middleware(mock.ctx, mock.next);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(403);
  });

  it("DELETE request without token: returns 403", async () => {
    const middleware = csrfProtection();
    const mock = createMockContext({ method: "DELETE" });

    const response = await middleware(mock.ctx, mock.next);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(403);
  });

  it("PATCH request without token: returns 403", async () => {
    const middleware = csrfProtection();
    const mock = createMockContext({ method: "PATCH" });

    const response = await middleware(mock.ctx, mock.next);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(403);
  });

  it("PUT request with valid token: passes through", async () => {
    const middleware = csrfProtection();
    const token = "valid_put_token";
    const mock = createMockContext({
      method: "PUT",
      headers: {
        Cookie: `__csrf=${token}`,
        "X-CSRF-Token": token,
      },
    });

    await middleware(mock.ctx, mock.next);

    expect(mock.nextCalled).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Bearer-authenticated requests bypass CSRF
  // -----------------------------------------------------------------------

  it("Bearer-authenticated POST bypasses CSRF check", async () => {
    const middleware = csrfProtection();
    const mock = createMockContext({
      method: "POST",
      headers: {
        Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.test",
      },
    });

    await middleware(mock.ctx, mock.next);

    expect(mock.nextCalled).toBe(true);
  });

  it("Bearer-authenticated DELETE bypasses CSRF check", async () => {
    const middleware = csrfProtection();
    const mock = createMockContext({
      method: "DELETE",
      headers: {
        Authorization: "Bearer some-api-token",
      },
    });

    await middleware(mock.ctx, mock.next);

    expect(mock.nextCalled).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 403 response body
  // -----------------------------------------------------------------------

  it("403 response body contains error message", async () => {
    const middleware = csrfProtection();
    const mock = createMockContext({ method: "POST" });

    const response = (await middleware(mock.ctx, mock.next)) as Response;

    const body = await response.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toContain("CSRF");
  });
});

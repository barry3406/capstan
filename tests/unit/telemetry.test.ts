import { describe, it, expect, beforeEach } from "bun:test";
import { withSpan } from "@zauso-ai/capstan-agent";

// ---------------------------------------------------------------------------
// withSpan() — graceful degradation path
//
// Since @opentelemetry/api is not installed in this project, every call to
// withSpan() takes the "tracer is null" branch and calls fn() directly.
// This is by design: the primary contract is that instrumentation never
// breaks application code when OTel is absent.
// ---------------------------------------------------------------------------

describe("withSpan (OTel not installed — graceful degradation)", () => {
  it("calls the function directly and returns its result", async () => {
    const result = await withSpan("test.span", {}, async () => 42);
    expect(result).toBe(42);
  });

  it("returns the function's return value for strings", async () => {
    const result = await withSpan("test.span", {}, async () => "hello");
    expect(result).toBe("hello");
  });

  it("returns the function's return value for objects", async () => {
    const obj = { key: "value", nested: { a: 1 } };
    const result = await withSpan("test.span", {}, async () => obj);
    expect(result).toEqual(obj);
  });

  it("passes through thrown errors", async () => {
    const error = new Error("boom");
    await expect(
      withSpan("test.span", {}, async () => {
        throw error;
      }),
    ).rejects.toThrow("boom");
  });

  it("preserves the original error type", async () => {
    class CustomError extends Error {
      code = "CUSTOM";
    }
    const err = new CustomError("custom");
    try {
      await withSpan("test.span", {}, async () => {
        throw err;
      });
      expect.unreachable("should have thrown");
    } catch (caught) {
      expect(caught).toBeInstanceOf(CustomError);
      expect((caught as CustomError).code).toBe("CUSTOM");
    }
  });

  it("handles function with void return", async () => {
    let sideEffect = false;
    const result = await withSpan("test.span", {}, async () => {
      sideEffect = true;
    });
    expect(sideEffect).toBe(true);
    expect(result).toBeUndefined();
  });

  it("handles async function that takes time", async () => {
    const start = Date.now();
    const result = await withSpan("test.span", {}, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "delayed";
    });
    const elapsed = Date.now() - start;
    expect(result).toBe("delayed");
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timing variance
  });

  it("concurrent withSpan calls do not interfere", async () => {
    const results = await Promise.all([
      withSpan("span.a", {}, async () => {
        await new Promise((r) => setTimeout(r, 30));
        return "a";
      }),
      withSpan("span.b", {}, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "b";
      }),
      withSpan("span.c", {}, async () => "c"),
    ]);
    expect(results).toEqual(["a", "b", "c"]);
  });

  it("nested withSpan calls work correctly", async () => {
    const result = await withSpan(
      "outer",
      { level: "1" },
      async () => {
        const inner = await withSpan(
          "inner",
          { level: "2" },
          async () => "inner-value",
        );
        return `outer-${inner}`;
      },
    );
    expect(result).toBe("outer-inner-value");
  });

  it("attributes are accepted without error", async () => {
    // Attributes are only used when OTel is present, but should not cause
    // errors when OTel is absent.
    const result = await withSpan(
      "test.span",
      {
        "capstan.route.path": "/tickets",
        "capstan.route.method": "GET",
        "capstan.count": 42,
        "capstan.enabled": true,
      },
      async () => "ok",
    );
    expect(result).toBe("ok");
  });

  it("span name is accepted without error", async () => {
    // The span name is only meaningful when OTel is present.
    const result = await withSpan(
      "capstan.capability.register",
      {},
      async () => "registered",
    );
    expect(result).toBe("registered");
  });

  it("fn receives undefined as span argument when OTel absent", async () => {
    let receivedSpan: unknown = "sentinel";
    await withSpan("test.span", {}, async (span) => {
      receivedSpan = span;
    });
    // When tracer is null, fn() is called with no arguments -> span is undefined
    expect(receivedSpan).toBeUndefined();
  });

  it("handles function returning a promise that rejects", async () => {
    await expect(
      withSpan("test.span", {}, () => Promise.reject(new Error("rejected"))),
    ).rejects.toThrow("rejected");
  });

  it("handles function returning null", async () => {
    const result = await withSpan("test.span", {}, async () => null);
    expect(result).toBeNull();
  });

  it("handles function returning array", async () => {
    const result = await withSpan("test.span", {}, async () => [1, 2, 3]);
    expect(result).toEqual([1, 2, 3]);
  });
});

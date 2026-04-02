import { describe, test, expect } from "bun:test";
import { withViewTransition } from "@zauso-ai/capstan-react/client";

// In Bun test environment, document.startViewTransition is not available,
// so withViewTransition should always fall back to calling fn() directly.

describe("withViewTransition", () => {
  test("calls fn directly when startViewTransition is unavailable", async () => {
    let called = false;
    await withViewTransition(() => {
      called = true;
    });
    expect(called).toBe(true);
  });

  test("awaits async fn when falling back", async () => {
    let resolved = false;
    await withViewTransition(async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
    });
    expect(resolved).toBe(true);
  });

  test("propagates errors from fn", async () => {
    await expect(
      withViewTransition(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  test("propagates errors from async fn", async () => {
    await expect(
      withViewTransition(async () => {
        throw new Error("async boom");
      }),
    ).rejects.toThrow("async boom");
  });
});

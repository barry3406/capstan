import { describe, expect, it } from "bun:test";

import {
  isHarnessRunResumable,
  mapAgentRunStatusToHarnessStatus,
  sanitizeHarnessEventData,
  summarizeHarnessResult,
} from "../../packages/ai/src/harness/runtime/utils.ts";

describe("harness runtime utils", () => {
  it("summarizeHarnessResult truncates long strings recursively across arrays and nested objects", () => {
    const long = "x".repeat(520);

    expect(
      summarizeHarnessResult({
        top: long,
        nested: {
          value: long,
          list: [long, { inner: long }],
        },
      }),
    ).toEqual({
      top: `${"x".repeat(500)}... (truncated)`,
      nested: {
        value: `${"x".repeat(500)}... (truncated)`,
        list: [
          `${"x".repeat(500)}... (truncated)`,
          { inner: `${"x".repeat(500)}... (truncated)` },
        ],
      },
    });
  });

  it("summarizeHarnessResult caps large arrays and protects against runaway object depth", () => {
    const largeArray = Array.from({ length: 20 }, (_, index) => index);

    expect(summarizeHarnessResult(largeArray)).toEqual(
      Array.from({ length: 10 }, (_, index) => index),
    );

    expect(
      summarizeHarnessResult({
        a: { b: { c: { d: { e: "deep" } } } },
      }),
    ).toEqual({
      a: {
        b: {
          c: {
            d: "[Max summary depth reached]",
          },
        },
      },
    });
  });

  it("sanitizeHarnessEventData converts bigint, errors, and buffers while removing unsupported fields", () => {
    const error = new Error("boom");
    const sanitized = sanitizeHarnessEventData({
      id: 1n,
      error,
      buffer: Buffer.from("hello world"),
      nested: {
        fn: () => "hidden",
        undef: undefined,
        ok: true,
      },
    });

    expect(sanitized).toEqual({
      id: "1",
      error: {
        name: "Error",
        message: "boom",
        stack: error.stack,
      },
      buffer: {
        type: "buffer",
        size: 11,
        preview: Buffer.from("hello world").toString("base64"),
      },
      nested: {
        ok: true,
      },
    });
  });

  it("sanitizeHarnessEventData handles circular references without throwing", () => {
    const circular: Record<string, unknown> = { name: "root" };
    circular["self"] = circular;

    expect(sanitizeHarnessEventData({ circular })).toEqual({
      circular: {
        name: "root",
        self: "[Circular]",
      },
    });
  });

  it("mapAgentRunStatusToHarnessStatus preserves every supported agent terminal state", () => {
    expect(mapAgentRunStatusToHarnessStatus("completed")).toBe("completed");
    expect(mapAgentRunStatusToHarnessStatus("max_iterations")).toBe("max_iterations");
    expect(mapAgentRunStatusToHarnessStatus("approval_required")).toBe(
      "approval_required",
    );
    expect(mapAgentRunStatusToHarnessStatus("paused")).toBe("paused");
    expect(mapAgentRunStatusToHarnessStatus("canceled")).toBe("canceled");
  });

  it("mapAgentRunStatusToHarnessStatus rejects impossible statuses loudly", () => {
    expect(() =>
      mapAgentRunStatusToHarnessStatus("unsupported" as never),
    ).toThrow("Unsupported harness status: unsupported");
  });

  it("isHarnessRunResumable only accepts paused and approval_required", () => {
    expect(isHarnessRunResumable("paused")).toBe(true);
    expect(isHarnessRunResumable("approval_required")).toBe(true);
    expect(isHarnessRunResumable("running")).toBe(false);
    expect(isHarnessRunResumable("pause_requested")).toBe(false);
    expect(isHarnessRunResumable("cancel_requested")).toBe(false);
    expect(isHarnessRunResumable("canceled")).toBe(false);
    expect(isHarnessRunResumable("completed")).toBe(false);
    expect(isHarnessRunResumable("max_iterations")).toBe(false);
    expect(isHarnessRunResumable("failed")).toBe(false);
    expect(isHarnessRunResumable(undefined)).toBe(false);
  });
});

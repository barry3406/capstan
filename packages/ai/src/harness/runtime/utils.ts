import type { HarnessRunRecord, HarnessRunResult } from "../types.js";

export function summarizeHarnessResult(result: unknown): unknown {
  return summarizeValue(result, 0);
}

export function sanitizeHarnessEventData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeValue(data, new WeakSet()) as Record<string, unknown>;
}

export function mapAgentRunStatusToHarnessStatus(
  status: HarnessRunResult["status"],
): HarnessRunResult["runtimeStatus"] {
  switch (status) {
    case "completed":
      return "completed";
    case "max_iterations":
      return "max_iterations";
    case "approval_required":
      return "approval_required";
    case "paused":
      return "paused";
    case "canceled":
      return "canceled";
  }

  throw new Error(`Unsupported harness status: ${String(status)}`);
}

export function isHarnessRunResumable(
  status: HarnessRunRecord["status"] | undefined,
): status is "paused" | "approval_required" {
  return status === "paused" || status === "approval_required";
}

function summarizeValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}... (truncated)` : value;
  }

  if (depth >= 4) {
    return "[Max summary depth reached]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) => summarizeValue(entry, depth + 1));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = summarizeValue(entry, depth + 1);
    }
    return out;
  }

  return value;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (Buffer.isBuffer(value)) {
    return {
      type: "buffer",
      size: value.byteLength,
      preview: value.subarray(0, 32).toString("base64"),
    };
  }

  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "function" || typeof value === "undefined" || typeof value === "symbol") {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeValue(entry, seen))
      .filter((entry) => entry !== undefined);
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const sanitized = sanitizeValue(entry, seen);
      if (sanitized !== undefined) {
        out[key] = sanitized;
      }
    }

    seen.delete(value);
    return out;
  }

  return String(value);
}

import { describe, it, expect } from "bun:test";
import {
  defineTransaction,
  validateMandate,
  UsageMeter,
} from "@zauso-ai/capstan-agent";
import type {
  PaymentMandate,
  TransactionConfig,
  TransactionResult,
} from "@zauso-ai/capstan-agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function futureDate(hours = 1): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function pastDate(): string {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

function validMandate(overrides?: Partial<PaymentMandate>): PaymentMandate {
  return {
    id: "mandate-001",
    maxAmount: 100,
    currency: "USD",
    expiresAt: futureDate(),
    authorizedBy: "user-42",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// defineTransaction
// ---------------------------------------------------------------------------

describe("defineTransaction", () => {
  it("returns the config unchanged", () => {
    const cfg: TransactionConfig = {
      name: "purchase",
      amount: () => 10,
      currency: "USD",
      maxAmount: 500,
    };
    const result = defineTransaction(cfg);
    expect(result).toBe(cfg);
  });

  it("preserves amount calculator", () => {
    const cfg = defineTransaction({
      name: "metered",
      amount: (input: unknown) => {
        const r = input as { tokens: number };
        return r.tokens * 0.001;
      },
    });
    expect(cfg.amount({ tokens: 5000 })).toBe(5);
  });

  it("defaults currency to undefined when not provided", () => {
    const cfg = defineTransaction({ name: "basic", amount: () => 1 });
    expect(cfg.currency).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateMandate
// ---------------------------------------------------------------------------

describe("validateMandate", () => {
  it("accepts a valid mandate", () => {
    const result = validateMandate(validMandate());
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects missing mandate ID", () => {
    const result = validateMandate(validMandate({ id: "" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Missing mandate ID");
  });

  it("rejects zero maxAmount", () => {
    const result = validateMandate(validMandate({ maxAmount: 0 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Invalid amount");
  });

  it("rejects negative maxAmount", () => {
    const result = validateMandate(validMandate({ maxAmount: -5 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Invalid amount");
  });

  it("rejects missing currency", () => {
    const result = validateMandate(validMandate({ currency: "" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Missing currency");
  });

  it("rejects expired mandate", () => {
    const result = validateMandate(validMandate({ expiresAt: pastDate() }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Mandate expired");
  });

  it("rejects missing authorizedBy", () => {
    const result = validateMandate(validMandate({ authorizedBy: "" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Missing authorization");
  });

  it("accepts mandate with optional signature", () => {
    const result = validateMandate(validMandate({ signature: "sig-abc" }));
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// UsageMeter
// ---------------------------------------------------------------------------

describe("UsageMeter", () => {
  it("returns zero usage for unknown agent", () => {
    const meter = new UsageMeter();
    const usage = meter.getUsage("unknown");
    expect(usage.calls).toBe(0);
    expect(usage.totalAmount).toBe(0);
  });

  it("records a single call", () => {
    const meter = new UsageMeter();
    meter.record("agent-1", 5);
    const usage = meter.getUsage("agent-1");
    expect(usage.calls).toBe(1);
    expect(usage.totalAmount).toBe(5);
  });

  it("accumulates multiple calls for same agent", () => {
    const meter = new UsageMeter();
    meter.record("agent-1", 5);
    meter.record("agent-1", 3);
    meter.record("agent-1", 7);
    const usage = meter.getUsage("agent-1");
    expect(usage.calls).toBe(3);
    expect(usage.totalAmount).toBe(15);
  });

  it("tracks agents independently", () => {
    const meter = new UsageMeter();
    meter.record("agent-1", 10);
    meter.record("agent-2", 20);
    expect(meter.getUsage("agent-1").totalAmount).toBe(10);
    expect(meter.getUsage("agent-2").totalAmount).toBe(20);
  });

  it("returns all usage via getAllUsage", () => {
    const meter = new UsageMeter();
    meter.record("agent-1", 10);
    meter.record("agent-2", 20);
    const all = meter.getAllUsage();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all["agent-1"]?.totalAmount).toBe(10);
    expect(all["agent-2"]?.totalAmount).toBe(20);
  });

  it("resets all usage data", () => {
    const meter = new UsageMeter();
    meter.record("agent-1", 10);
    meter.record("agent-2", 20);
    meter.reset();
    expect(meter.getUsage("agent-1").calls).toBe(0);
    expect(meter.getUsage("agent-2").calls).toBe(0);
    expect(Object.keys(meter.getAllUsage())).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Type-level checks (compile-time only, always passes at runtime)
// ---------------------------------------------------------------------------

describe("type contracts", () => {
  it("TransactionResult has expected shape", () => {
    const result: TransactionResult = {
      transactionId: "tx-001",
      amount: 9.99,
      currency: "USD",
      status: "completed",
      mandateId: "mandate-001",
    };
    expect(result.status).toBe("completed");
  });
});

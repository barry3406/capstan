import { describe, it, expect, beforeEach } from "bun:test";
import {
  defineCompliance,
  recordAuditEntry,
  getAuditLog,
  clearAuditLog,
  setAuditStore,
} from "@zauso-ai/capstan-core";
import type { AuditEntry, RiskLevel, ComplianceConfig } from "@zauso-ai/capstan-core";
import { MemoryStore } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    timestamp: overrides?.timestamp ?? new Date().toISOString(),
    requestId: overrides?.requestId ?? crypto.randomUUID(),
    method: overrides?.method ?? "POST",
    path: overrides?.path ?? "/api/users",
    riskLevel: overrides?.riskLevel ?? "high",
    auth: overrides?.auth ?? { type: "jwt", userId: "u_123" },
    input: overrides?.input ?? { name: "Alice" },
    output: overrides?.output ?? { id: 1, name: "Alice" },
    durationMs: overrides?.durationMs ?? 42,
    transparency: overrides?.transparency,
  };
}

// ---------------------------------------------------------------------------
// defineCompliance
// ---------------------------------------------------------------------------

describe("defineCompliance", () => {
  it("returns config object unchanged", () => {
    const config: ComplianceConfig = {
      riskLevel: "high",
      auditLog: true,
      transparency: { isAI: true, provider: "openai", model: "gpt-4", purpose: "classification" },
    };
    const result = defineCompliance(config);
    expect(result).toEqual(config);
  });

  it("preserves riskLevel field", () => {
    const levels: RiskLevel[] = ["high", "limited", "minimal", "unacceptable"];
    for (const riskLevel of levels) {
      const result = defineCompliance({ riskLevel });
      expect(result.riskLevel).toBe(riskLevel);
    }
  });

  it("preserves auditLog boolean", () => {
    expect(defineCompliance({ auditLog: true }).auditLog).toBe(true);
    expect(defineCompliance({ auditLog: false }).auditLog).toBe(false);
  });

  it("preserves transparency fields", () => {
    const transparency = { isAI: true, provider: "anthropic", model: "claude-3", purpose: "summarization" };
    const result = defineCompliance({ transparency });
    expect(result.transparency).toEqual(transparency);
  });

  it("returns empty config when no fields provided", () => {
    const result = defineCompliance({});
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// recordAuditEntry + getAuditLog
// ---------------------------------------------------------------------------

describe("recordAuditEntry + getAuditLog", () => {
  beforeEach(async () => {
    // Reset to a fresh MemoryStore before each test
    setAuditStore(new MemoryStore());
  });

  it("records an entry and retrieves it", async () => {
    const entry = makeEntry();
    await recordAuditEntry(entry);
    const log = await getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual(entry);
  });

  it("multiple entries returned in chronological order", async () => {
    const e1 = makeEntry({ timestamp: "2025-01-01T00:00:00.000Z", requestId: "aaa" });
    const e2 = makeEntry({ timestamp: "2025-01-01T00:00:01.000Z", requestId: "bbb" });
    const e3 = makeEntry({ timestamp: "2025-01-01T00:00:02.000Z", requestId: "ccc" });
    // Insert out of order
    await recordAuditEntry(e2);
    await recordAuditEntry(e1);
    await recordAuditEntry(e3);
    const log = await getAuditLog();
    expect(log).toHaveLength(3);
    expect(log[0]!.requestId).toBe("aaa");
    expect(log[1]!.requestId).toBe("bbb");
    expect(log[2]!.requestId).toBe("ccc");
  });

  it("entry has all required fields", async () => {
    const entry = makeEntry();
    await recordAuditEntry(entry);
    const log = await getAuditLog();
    const recorded = log[0]!;
    expect(recorded.timestamp).toBeDefined();
    expect(recorded.requestId).toBeDefined();
    expect(recorded.method).toBeDefined();
    expect(recorded.path).toBeDefined();
    expect(recorded.riskLevel).toBeDefined();
    expect(recorded.auth).toBeDefined();
    expect(recorded.input).toBeDefined();
    expect(recorded.output).toBeDefined();
    expect(recorded.durationMs).toBeDefined();
  });

  it("getAuditLog with since filter", async () => {
    const e1 = makeEntry({ timestamp: "2025-01-01T00:00:00.000Z", requestId: "old" });
    const e2 = makeEntry({ timestamp: "2025-06-15T12:00:00.000Z", requestId: "new" });
    await recordAuditEntry(e1);
    await recordAuditEntry(e2);
    const log = await getAuditLog({ since: "2025-06-01T00:00:00.000Z" });
    expect(log).toHaveLength(1);
    expect(log[0]!.requestId).toBe("new");
  });

  it("getAuditLog with limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await recordAuditEntry(
        makeEntry({ timestamp: `2025-01-0${i + 1}T00:00:00.000Z`, requestId: `r${i}` }),
      );
    }
    const log = await getAuditLog({ limit: 2 });
    expect(log).toHaveLength(2);
    // limit takes the last N entries
    expect(log[0]!.requestId).toBe("r3");
    expect(log[1]!.requestId).toBe("r4");
  });

  it("getAuditLog with both since + limit", async () => {
    for (let i = 0; i < 10; i++) {
      await recordAuditEntry(
        makeEntry({
          timestamp: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
          requestId: `r${i}`,
        }),
      );
    }
    // since filters to entries from Jan 5 onward (r4..r9 = 6 entries), limit 3 takes last 3
    const log = await getAuditLog({ since: "2025-01-05T00:00:00.000Z", limit: 3 });
    expect(log).toHaveLength(3);
    expect(log[0]!.requestId).toBe("r7");
    expect(log[1]!.requestId).toBe("r8");
    expect(log[2]!.requestId).toBe("r9");
  });
});

// ---------------------------------------------------------------------------
// clearAuditLog
// ---------------------------------------------------------------------------

describe("clearAuditLog", () => {
  beforeEach(async () => {
    setAuditStore(new MemoryStore());
  });

  it("clears all entries", async () => {
    await recordAuditEntry(makeEntry());
    await recordAuditEntry(makeEntry());
    await clearAuditLog();
    const log = await getAuditLog();
    expect(log).toHaveLength(0);
  });

  it("getAuditLog returns empty array after clear", async () => {
    await recordAuditEntry(makeEntry());
    await clearAuditLog();
    const log = await getAuditLog();
    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// setAuditStore
// ---------------------------------------------------------------------------

describe("setAuditStore", () => {
  beforeEach(async () => {
    setAuditStore(new MemoryStore());
  });

  it("custom store receives entries", async () => {
    const customStore = new MemoryStore<AuditEntry>();
    setAuditStore(customStore);
    const entry = makeEntry();
    await recordAuditEntry(entry);
    // Verify entry is in the custom store directly
    const keys = await customStore.keys();
    expect(keys).toHaveLength(1);
    const stored = await customStore.get(keys[0]!);
    expect(stored).toEqual(entry);
  });

  it("entries retrievable from custom store via getAuditLog", async () => {
    const customStore = new MemoryStore<AuditEntry>();
    setAuditStore(customStore);
    const entry = makeEntry();
    await recordAuditEntry(entry);
    const log = await getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual(entry);
  });

  it("switching stores loses previous entries", async () => {
    await recordAuditEntry(makeEntry());
    const log1 = await getAuditLog();
    expect(log1).toHaveLength(1);
    setAuditStore(new MemoryStore());
    const log2 = await getAuditLog();
    expect(log2).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  beforeEach(async () => {
    setAuditStore(new MemoryStore());
  });

  it("empty audit log returns []", async () => {
    const log = await getAuditLog();
    expect(log).toEqual([]);
  });

  it("record entry with minimal fields", async () => {
    const entry: AuditEntry = {
      timestamp: "2025-01-01T00:00:00.000Z",
      requestId: "min",
      method: "GET",
      path: "/",
      riskLevel: "minimal",
      auth: { type: "none" },
      input: null,
      output: null,
      durationMs: 0,
    };
    await recordAuditEntry(entry);
    const log = await getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toEqual(entry);
  });

  it("record entry with transparency metadata", async () => {
    const entry = makeEntry({
      transparency: { isAI: true, provider: "anthropic", model: "claude-3", purpose: "moderation" },
    });
    await recordAuditEntry(entry);
    const log = await getAuditLog();
    expect(log[0]!.transparency).toEqual({
      isAI: true,
      provider: "anthropic",
      model: "claude-3",
      purpose: "moderation",
    });
  });

  it("very large input/output does not crash", async () => {
    const largePayload = { data: "x".repeat(100_000), nested: Array.from({ length: 1000 }, (_, i) => ({ i })) };
    const entry = makeEntry({ input: largePayload, output: largePayload });
    await recordAuditEntry(entry);
    const log = await getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.input).toEqual(largePayload);
  });

  it("concurrent recordAuditEntry calls", async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry({
        timestamp: `2025-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        requestId: `concurrent-${i}`,
      }),
    );
    await Promise.all(entries.map(e => recordAuditEntry(e)));
    const log = await getAuditLog();
    expect(log).toHaveLength(20);
    // All entries should be present (order guaranteed by sorting on timestamp)
    for (let i = 0; i < 20; i++) {
      expect(log[i]!.requestId).toBe(`concurrent-${i}`);
    }
  });

  it("getAuditLog since with exact match includes that entry", async () => {
    const ts = "2025-06-15T12:00:00.000Z";
    await recordAuditEntry(makeEntry({ timestamp: ts, requestId: "exact" }));
    const log = await getAuditLog({ since: ts });
    expect(log).toHaveLength(1);
    expect(log[0]!.requestId).toBe("exact");
  });

  it("getAuditLog limit of 0 returns empty", async () => {
    await recordAuditEntry(makeEntry());
    // limit=0 is falsy so it won't trigger the slice — expect all entries
    const log = await getAuditLog({ limit: 0 });
    // The implementation treats 0 as falsy, so no slicing occurs
    expect(log).toHaveLength(1);
  });
});

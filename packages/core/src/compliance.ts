import type { KeyValueStore } from "./store.js";
import { MemoryStore } from "./store.js";

export type RiskLevel = "high" | "limited" | "minimal" | "unacceptable";

export interface ComplianceConfig {
  /** EU AI Act risk classification for this route */
  riskLevel?: RiskLevel;
  /** Enable WORM audit logging for this route */
  auditLog?: boolean;
  /** AI system transparency metadata */
  transparency?: {
    isAI: boolean;
    provider?: string;
    model?: string;
    purpose?: string;
  };
}

export interface AuditEntry {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  riskLevel: RiskLevel;
  auth: {
    type: string;
    userId?: string;
    agentId?: string;
  };
  input: unknown;
  output: unknown;
  durationMs: number;
  transparency?: ComplianceConfig["transparency"];
}

/**
 * Pluggable audit log store.  Defaults to in-memory (`MemoryStore`).
 *
 * Each entry is stored with a composite key of `<timestamp>:<requestId>` so
 * that entries are naturally ordered and globally unique.
 *
 * Production deployments should call `setAuditStore()` at startup to swap in
 * a persistent backend (e.g. `RedisStore`).
 */
let auditStore: KeyValueStore<AuditEntry> = new MemoryStore();

/**
 * Replace the default in-memory audit store with a custom implementation.
 *
 * Call this at application startup before any requests are processed.
 */
export function setAuditStore(store: KeyValueStore<AuditEntry>): void {
  auditStore = store;
}

export async function recordAuditEntry(entry: AuditEntry): Promise<void> {
  const key = `${entry.timestamp}:${entry.requestId}`;
  await auditStore.set(key, entry);
}

export async function getAuditLog(opts?: { since?: string; limit?: number }): Promise<AuditEntry[]> {
  const allKeys = await auditStore.keys();
  // Keys are `<timestamp>:<requestId>` — sorting lexicographically gives
  // chronological order since timestamps are ISO-8601.
  allKeys.sort();

  let entries: AuditEntry[] = [];
  for (const key of allKeys) {
    const entry = await auditStore.get(key);
    if (entry) {
      entries.push(entry);
    }
  }

  if (opts?.since) {
    entries = entries.filter(e => e.timestamp >= opts.since!);
  }
  if (opts?.limit) {
    entries = entries.slice(-opts.limit);
  }
  return entries;
}

export async function clearAuditLog(): Promise<void> {
  await auditStore.clear();
}

/**
 * Define a compliance configuration for an API route.
 * Returns the config as-is for attachment to a defineAPI call.
 */
export function defineCompliance(config: ComplianceConfig): ComplianceConfig {
  return config;
}

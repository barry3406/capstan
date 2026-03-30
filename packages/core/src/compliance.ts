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

/** In-memory audit log (dev). Production should use persistent store. */
const auditLog: AuditEntry[] = [];

export function recordAuditEntry(entry: AuditEntry): void {
  auditLog.push(entry);
}

export function getAuditLog(opts?: { since?: string; limit?: number }): AuditEntry[] {
  let entries = auditLog;
  if (opts?.since) {
    entries = entries.filter(e => e.timestamp >= opts.since!);
  }
  if (opts?.limit) {
    entries = entries.slice(-opts.limit);
  }
  return entries;
}

export function clearAuditLog(): void {
  auditLog.length = 0;
}

/**
 * Define a compliance configuration for an API route.
 * Returns the config as-is for attachment to a defineAPI call.
 */
export function defineCompliance(config: ComplianceConfig): ComplianceConfig {
  return config;
}

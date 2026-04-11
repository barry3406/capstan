import type {
  OpsHealthSignal,
  OpsHealthStatus,
  OpsIncidentRecord,
  OpsIncidentStatus,
  OpsRetentionConfig,
  OpsScope,
  OpsScopeFilter,
  OpsSeverity,
  OpsSortOrder,
} from "./contracts.js";

const SEVERITY_RANK: Record<OpsSeverity, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  critical: 4,
};

const INCIDENT_STATUS_RANK: Record<OpsIncidentStatus, number> = {
  resolved: 0,
  suppressed: 1,
  acknowledged: 2,
  open: 3,
};

const HEALTH_STATUS_RANK: Record<OpsHealthStatus, number> = {
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
};

export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeIsoTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ops timestamp: ${timestamp}`);
  }
  return date.toISOString();
}

export function compareIsoTimestamp(left: string, right: string): number {
  return normalizeIsoTimestamp(left).localeCompare(normalizeIsoTimestamp(right));
}

export function sortByTimestamp<T extends { timestamp: string }>(
  records: T[],
  sort: OpsSortOrder = "desc",
): T[] {
  const direction = sort === "asc" ? 1 : -1;
  return [...records].sort((left, right) => {
    const timestampCompare = compareIsoTimestamp(left.timestamp, right.timestamp);
    if (timestampCompare !== 0) {
      return timestampCompare * direction;
    }
    return direction * JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

export function scopeMatchesFilters(
  scope: OpsScope,
  filters: OpsScopeFilter[] | undefined,
): boolean {
  if (!filters || filters.length === 0) {
    return true;
  }

  return filters.every((filter) => {
    const value = scope[filter.key];
    return value !== undefined && filter.values.includes(value);
  });
}

export function tagsContainAll(source: string[], required: string[] | undefined): boolean {
  if (!required || required.length === 0) {
    return true;
  }

  const tagSet = new Set(source);
  return required.every((tag) => tagSet.has(tag));
}

export function coerceRetentionConfig(
  retention: OpsRetentionConfig | undefined,
): Required<OpsRetentionConfig> {
  return {
    events: retention?.events ?? {},
    incidents: retention?.incidents ?? {},
    snapshots: retention?.snapshots ?? {},
  };
}

export function pruneByMaxAge<T extends { timestamp: string }>(
  records: T[],
  maxAgeMs: number | undefined,
  nowIso: string,
): { kept: T[]; removed: T[] } {
  if (!maxAgeMs || maxAgeMs <= 0) {
    return {
      kept: [...records],
      removed: [],
    };
  }

  const cutoff = new Date(normalizeIsoTimestamp(nowIso)).getTime() - maxAgeMs;
  const kept: T[] = [];
  const removed: T[] = [];

  for (const record of records) {
    const timestamp = new Date(normalizeIsoTimestamp(record.timestamp)).getTime();
    if (timestamp < cutoff) {
      removed.push(record);
    } else {
      kept.push(record);
    }
  }

  return { kept, removed };
}

export function nextSeverity(
  left: OpsSeverity,
  right: OpsSeverity,
): OpsSeverity {
  return SEVERITY_RANK[left] >= SEVERITY_RANK[right] ? left : right;
}

export function nextIncidentStatus(
  left: OpsIncidentStatus,
  right: OpsIncidentStatus,
): OpsIncidentStatus {
  return INCIDENT_STATUS_RANK[left] >= INCIDENT_STATUS_RANK[right] ? left : right;
}

export function nextHealthStatus(
  left: OpsHealthStatus,
  right: OpsHealthStatus,
): OpsHealthStatus {
  return HEALTH_STATUS_RANK[left] >= HEALTH_STATUS_RANK[right] ? left : right;
}

export function dedupeSignals(signals: OpsHealthSignal[]): OpsHealthSignal[] {
  const byKey = new Map<string, OpsHealthSignal>();

  for (const signal of signals) {
    const existing = byKey.get(signal.key);
    if (!existing) {
      byKey.set(signal.key, cloneValue(signal));
      continue;
    }

    byKey.set(signal.key, {
      ...existing,
      severity: nextSeverity(existing.severity, signal.severity),
      status: nextHealthStatus(existing.status, signal.status),
      summary: signal.summary,
      title: signal.title,
      ...(signal.kind ?? existing.kind ? { kind: signal.kind ?? existing.kind } : {}),
      ...(signal.fingerprint ?? existing.fingerprint
        ? { fingerprint: signal.fingerprint ?? existing.fingerprint }
        : {}),
      ...(signal.scope ?? existing.scope ? { scope: signal.scope ?? existing.scope } : {}),
      ...(signal.metadata ?? existing.metadata
        ? { metadata: signal.metadata ?? existing.metadata }
        : {}),
    });
  }

  return [...byKey.values()].sort((left, right) => {
    const severityCompare = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
    if (severityCompare !== 0) {
      return severityCompare;
    }
    return left.key.localeCompare(right.key);
  });
}

export function defaultIncidentFromEventKind(kind: string): string {
  return kind.replace(/[^a-z0-9]+/gi, ":").replace(/^:+|:+$/g, "").toLowerCase();
}

export function mergeIncident(existing: OpsIncidentRecord, next: OpsIncidentRecord): OpsIncidentRecord {
  const observations = Math.max(existing.observations ?? 1, 1) + 1;
  const firstSeenAt = existing.firstSeenAt ?? existing.timestamp;
  const lastSeenAt = next.timestamp;
  const status =
    next.status === "resolved"
      ? "resolved"
      : nextIncidentStatus(existing.status, next.status);

  return {
    ...existing,
    ...next,
    id: existing.id,
    severity: nextSeverity(existing.severity, next.severity),
    status,
    metadata: {
      ...existing.metadata,
      ...next.metadata,
    },
    firstSeenAt,
    lastSeenAt,
    observations,
    ...(next.tags ?? existing.tags ? { tags: next.tags ?? existing.tags } : {}),
    ...(next.correlation ?? existing.correlation
      ? { correlation: next.correlation ?? existing.correlation }
      : {}),
    ...(next.status === "resolved"
      ? { resolvedAt: next.resolvedAt ?? next.timestamp }
      : existing.resolvedAt
        ? { resolvedAt: existing.resolvedAt }
        : {}),
  };
}

export function createHealthSignalFromIncident(incident: OpsIncidentRecord): OpsHealthSignal {
  return {
    key: `incident:${incident.fingerprint}`,
    source: "incident",
    severity: incident.severity,
    status:
      incident.status === "resolved"
        ? "healthy"
        : incident.severity === "critical"
          ? "unhealthy"
          : "degraded",
    title: incident.title,
    summary: incident.summary,
    kind: incident.kind,
    fingerprint: incident.fingerprint,
    scope: incident.scope,
    metadata: incident.metadata,
  };
}

export function createHealthSignalFromEvent(
  kind: string,
  severity: OpsSeverity,
  summary: string,
  scope: OpsScope,
  metadata: Record<string, unknown>,
): OpsHealthSignal {
  return {
    key: `event:${kind}:${JSON.stringify(scope)}`,
    source: "event",
    severity,
    status:
      severity === "critical" || severity === "error"
        ? "unhealthy"
        : severity === "warning"
          ? "degraded"
          : "healthy",
    title: kind,
    summary,
    kind,
    scope,
    metadata,
  };
}

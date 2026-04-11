import type {
  OpsCaptureSnapshotInput,
  OpsEventRecord,
  OpsIncidentRecord,
  OpsOverview,
  OpsRecordEventInput,
  OpsRecordIncidentInput,
  OpsRuntimeOptions,
  OpsSnapshotRecord,
} from "./contracts.js";
import { createOpsOverview, deriveOpsHealthStatus } from "./health.js";
import { createOpsQuery, createOpsQueryIndex } from "./query.js";
import {
  cloneValue,
  defaultIncidentFromEventKind,
  mergeIncident,
  normalizeIsoTimestamp,
  nextSeverity,
} from "./utils.js";

const HEALTH_STATUS_RANK = {
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
} as const;

function createRecordId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function summarizeOverviewHealth(
  overview: OpsOverview,
): OpsOverview {
  const activeIncidents = overview.windows.recentIncidents.filter((incident) => incident.status !== "resolved");
  const hasCriticalIncident = activeIncidents.some((incident) => incident.severity === "critical" || incident.severity === "error");
  const hasWarningIncident = activeIncidents.some((incident) => incident.severity === "warning");

  const desiredStatus =
    hasCriticalIncident
      ? "unhealthy"
      : hasWarningIncident
        ? "degraded"
        : overview.health.status;

  if (HEALTH_STATUS_RANK[desiredStatus] <= HEALTH_STATUS_RANK[overview.health.status]) {
    return overview;
  }

  const statusPrefix = desiredStatus === "unhealthy" ? "Unhealthy" : "Degraded";
  const relevantSignal = overview.health.signals.find((signal) =>
    desiredStatus === "unhealthy"
      ? signal.severity === "critical" || signal.severity === "error"
      : signal.severity === "warning",
  );
  const relevantIncident = activeIncidents.find((incident) =>
    desiredStatus === "unhealthy"
      ? incident.severity === "critical" || incident.severity === "error"
      : incident.severity === "warning",
  );
  const summarySource = relevantSignal?.summary ?? relevantIncident?.summary ?? overview.health.summary;

  return {
    ...overview,
    health: {
      ...overview.health,
      status: desiredStatus,
      summary: `${statusPrefix}: ${summarySource}`,
    },
  };
}

function normalizeEventInput(
  input: OpsRecordEventInput,
  options: OpsRuntimeOptions,
): OpsEventRecord {
  return {
    id: input.id ?? createRecordId("evt"),
    kind: input.kind,
    timestamp: normalizeIsoTimestamp(input.timestamp),
    severity: input.severity,
    status: input.status,
    target: input.target,
    scope: {
      ...input.scope,
      ...(options.serviceName ? { service: options.serviceName } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
    },
    ...(input.title ? { title: input.title } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.message ? { message: input.message } : {}),
    ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
    tags: [...input.tags].sort(),
    ...(input.correlation ? { correlation: cloneValue(input.correlation) } : {}),
    metadata: cloneValue(input.metadata),
  };
}

function normalizeIncidentInput(
  input: OpsRecordIncidentInput,
  options: OpsRuntimeOptions,
): OpsIncidentRecord {
  const normalizedTimestamp = normalizeIsoTimestamp(input.timestamp);
  return {
    id: input.id ?? createRecordId("inc"),
    fingerprint: input.fingerprint,
    kind: input.kind,
    timestamp: normalizedTimestamp,
    severity: input.severity,
    status: input.status,
    title: input.title,
    summary: input.summary,
    ...(input.target ? { target: input.target } : {}),
    scope: {
      ...input.scope,
      ...(options.serviceName ? { service: options.serviceName } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
    },
    ...(input.tags ? { tags: [...input.tags].sort() } : {}),
    ...(input.correlation ? { correlation: cloneValue(input.correlation) } : {}),
    metadata: cloneValue(input.metadata),
    firstSeenAt: normalizeIsoTimestamp(input.firstSeenAt ?? input.timestamp),
    lastSeenAt: normalizeIsoTimestamp(input.lastSeenAt ?? input.timestamp),
    observations: input.observations ?? 1,
    ...(input.lastEventId ? { lastEventId: input.lastEventId } : {}),
    ...(input.resolvedAt ? { resolvedAt: normalizeIsoTimestamp(input.resolvedAt) } : {}),
  };
}

function normalizeSnapshotInput(
  input: OpsCaptureSnapshotInput,
): OpsSnapshotRecord {
  return {
    id: input.id ?? createRecordId("snap"),
    timestamp: normalizeIsoTimestamp(input.timestamp),
    health: input.health,
    summary: input.summary,
    signals: cloneValue(input.signals),
    ...(input.scope ? { scope: cloneValue(input.scope) } : {}),
    ...(input.metadata ? { metadata: cloneValue(input.metadata) } : {}),
  };
}

export function createCapstanOpsRuntime(options: OpsRuntimeOptions) {
  const activeStatuses = new Set(options.incidentDedupeStatuses ?? ["open", "acknowledged", "suppressed"]);

  return {
    store: options.store,
    serviceName: options.serviceName,
    environment: options.environment,

    async recordEvent(input: OpsRecordEventInput): Promise<OpsEventRecord> {
      const normalized = normalizeEventInput(input, options);
      const stored = options.store.addEvent(normalized);

      if (stored.fingerprint && (stored.severity === "error" || stored.severity === "critical")) {
        await this.recordIncident({
          fingerprint: stored.fingerprint,
          kind: stored.kind,
          timestamp: stored.timestamp,
          severity: stored.severity,
          status: "open",
          title: stored.title ?? stored.kind,
          summary:
            stored.summary ??
            stored.message ??
            `${stored.kind} recorded a ${stored.severity} event`,
          target: stored.target,
          scope: stored.scope,
          tags: stored.tags,
          metadata: stored.metadata,
          lastEventId: stored.id,
          ...(stored.correlation ? { correlation: stored.correlation } : {}),
        });
      }

      return stored;
    },

    async recordIncident(input: OpsRecordIncidentInput): Promise<OpsIncidentRecord> {
      const normalized = normalizeIncidentInput(input, options);
      const existing = options.store.getIncidentByFingerprint(normalized.fingerprint);
      if (existing && activeStatuses.has(existing.status)) {
        const merged = mergeIncident(existing, normalized);
        return options.store.addIncident(merged);
      }

      return options.store.addIncident(normalized);
    },

    async captureSnapshot(input: OpsCaptureSnapshotInput): Promise<OpsSnapshotRecord> {
      const normalized = normalizeSnapshotInput(input);
      return options.store.addSnapshot(normalized);
    },

    createOverview(): OpsOverview {
      return summarizeOverviewHealth(createOpsOverview(
        createOpsQuery(options.store),
        createOpsQueryIndex(options.store),
      ));
    },

    async captureDerivedSnapshot(
      timestamp = new Date().toISOString(),
    ): Promise<OpsSnapshotRecord> {
      const derived = deriveOpsHealthStatus(options.store);
      return this.captureSnapshot({
        timestamp,
        health: derived.status,
        summary: derived.summary,
        signals: derived.signals,
        scope: {
          ...(options.serviceName ? { service: options.serviceName } : {}),
          ...(options.environment ? { environment: options.environment } : {}),
        },
      });
    },

    async recordRecoveryFromEvent(input: OpsRecordEventInput): Promise<OpsEventRecord> {
      const event = await this.recordEvent({
        ...input,
        severity: input.severity,
        fingerprint: input.fingerprint ?? `recovery:${defaultIncidentFromEventKind(input.kind)}`,
      });

      if (!input.fingerprint) {
        return event;
      }

      const existing = options.store.getIncidentByFingerprint(input.fingerprint);
      if (!existing || !activeStatuses.has(existing.status)) {
        return event;
      }

      options.store.addIncident({
        ...existing,
        severity: nextSeverity(existing.severity, "info"),
        status: "resolved",
        resolvedAt: event.timestamp,
        lastSeenAt: event.timestamp,
        summary: input.summary ?? input.message ?? existing.summary,
        metadata: {
          ...existing.metadata,
          recoveryEventId: event.id,
        },
      });

      return event;
    },
  };
}

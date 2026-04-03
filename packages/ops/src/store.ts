import type {
  OpsCompactionOptions,
  OpsCompactionResult,
  OpsEventFilter,
  OpsEventRecord,
  OpsIncidentFilter,
  OpsIncidentRecord,
  OpsRetentionConfig,
  OpsSnapshotFilter,
  OpsSnapshotRecord,
  OpsStore,
} from "./contracts.js";
import { filterOpsEvents, filterOpsIncidents, filterOpsSnapshots } from "./query.js";
import {
  cloneValue,
  coerceRetentionConfig,
  normalizeIsoTimestamp,
  pruneByMaxAge,
} from "./utils.js";

export interface InMemoryOpsStoreOptions {
  retention?: OpsRetentionConfig;
  eventRetentionMs?: number;
  incidentRetentionMs?: number;
  snapshotRetentionMs?: number;
}

export class InMemoryOpsStore implements OpsStore {
  private readonly eventRecords = new Map<string, OpsEventRecord>();
  private readonly incidentRecords = new Map<string, OpsIncidentRecord>();
  private readonly snapshotRecords = new Map<string, OpsSnapshotRecord>();
  private readonly incidentFingerprintIndex = new Map<string, string>();
  private readonly retention: Required<OpsRetentionConfig>;

  constructor(options: InMemoryOpsStoreOptions = {}) {
    const createRule = (maxAgeMs: number | undefined) =>
      maxAgeMs !== undefined ? { maxAgeMs } : null;
    const eventsRule = createRule(
      options.retention?.events?.maxAgeMs ?? options.eventRetentionMs,
    );
    const incidentsRule = createRule(
      options.retention?.incidents?.maxAgeMs ?? options.incidentRetentionMs,
    );
    const snapshotsRule = createRule(
      options.retention?.snapshots?.maxAgeMs ?? options.snapshotRetentionMs,
    );

    this.retention = coerceRetentionConfig({
      ...(eventsRule ? { events: eventsRule } : {}),
      ...(incidentsRule ? { incidents: incidentsRule } : {}),
      ...(snapshotsRule ? { snapshots: snapshotsRule } : {}),
    });
  }

  addEvent(record: OpsEventRecord): OpsEventRecord {
    const cloned = cloneValue(record);
    this.eventRecords.set(cloned.id, cloned);
    return cloneValue(cloned);
  }

  getEvent(id: string): OpsEventRecord | undefined {
    this.compact();
    const record = this.eventRecords.get(id);
    return record ? cloneValue(record) : undefined;
  }

  listEvents(filter?: OpsEventFilter): OpsEventRecord[] {
    this.compact();
    return filterOpsEvents(
      [...this.eventRecords.values()].map((record) => cloneValue(record)),
      filter?.sort ? filter : { ...(filter ?? {}), sort: "asc" },
    );
  }

  addIncident(record: OpsIncidentRecord): OpsIncidentRecord {
    const cloned = cloneValue({
      ...record,
      timestamp: normalizeIsoTimestamp(record.timestamp),
      ...(record.firstSeenAt ? { firstSeenAt: normalizeIsoTimestamp(record.firstSeenAt) } : {}),
      ...(record.lastSeenAt ? { lastSeenAt: normalizeIsoTimestamp(record.lastSeenAt) } : {}),
      ...(record.resolvedAt ? { resolvedAt: normalizeIsoTimestamp(record.resolvedAt) } : {}),
    });
    this.incidentRecords.set(cloned.id, cloned);
    this.incidentFingerprintIndex.set(cloned.fingerprint, cloned.id);
    return cloneValue(cloned);
  }

  getIncident(id: string): OpsIncidentRecord | undefined {
    this.compact();
    const record = this.incidentRecords.get(id);
    return record ? cloneValue(record) : undefined;
  }

  getIncidentByFingerprint(fingerprint: string): OpsIncidentRecord | undefined {
    this.compact();
    const id = this.incidentFingerprintIndex.get(fingerprint);
    if (!id) {
      return undefined;
    }
    return this.getIncident(id);
  }

  listIncidents(filter?: OpsIncidentFilter): OpsIncidentRecord[] {
    this.compact();
    return filterOpsIncidents(
      [...this.incidentRecords.values()].map((record) => cloneValue(record)),
      filter?.sort ? filter : { ...(filter ?? {}), sort: "asc" },
    );
  }

  addSnapshot(record: OpsSnapshotRecord): OpsSnapshotRecord {
    const cloned = cloneValue(record);
    this.snapshotRecords.set(cloned.id, cloned);
    return cloneValue(cloned);
  }

  listSnapshots(filter?: OpsSnapshotFilter): OpsSnapshotRecord[] {
    this.compact();
    return filterOpsSnapshots(
      [...this.snapshotRecords.values()].map((record) => cloneValue(record)),
      filter?.sort ? filter : { ...(filter ?? {}), sort: "asc" },
    );
  }

  compact(options: OpsCompactionOptions = {}): OpsCompactionResult {
    const now = options.now ?? new Date().toISOString();

    const eventPruned = pruneByMaxAge(
      [...this.eventRecords.values()],
      this.retention.events.maxAgeMs,
      now,
    );
    this.eventRecords.clear();
    for (const record of eventPruned.kept) {
      this.eventRecords.set(record.id, record);
    }

    const incidentPruned = pruneByMaxAge(
      [...this.incidentRecords.values()],
      this.retention.incidents.maxAgeMs,
      now,
    );
    this.incidentRecords.clear();
    this.incidentFingerprintIndex.clear();
    for (const record of incidentPruned.kept) {
      this.incidentRecords.set(record.id, record);
      this.incidentFingerprintIndex.set(record.fingerprint, record.id);
    }

    const snapshotPruned = pruneByMaxAge(
      [...this.snapshotRecords.values()],
      this.retention.snapshots.maxAgeMs,
      now,
    );
    this.snapshotRecords.clear();
    for (const record of snapshotPruned.kept) {
      this.snapshotRecords.set(record.id, record);
    }

    return {
      eventsRemoved: eventPruned.removed.length,
      incidentsRemoved: incidentPruned.removed.length,
      snapshotsRemoved: snapshotPruned.removed.length,
    };
  }

  close(): void {
    // No-op for the in-memory store.
  }
}

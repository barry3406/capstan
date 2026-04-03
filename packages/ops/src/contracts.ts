export type OpsSeverity = "debug" | "info" | "warning" | "error" | "critical";

export type OpsHealthStatus = "healthy" | "degraded" | "unhealthy";

export type OpsIncidentStatus =
  | "open"
  | "acknowledged"
  | "suppressed"
  | "resolved";

export type OpsSortOrder = "asc" | "desc";

export type OpsRecordStatus =
  | "ok"
  | "warn"
  | "error"
  | "started"
  | "pending"
  | "degraded"
  | "unhealthy"
  | "approval_required"
  | OpsIncidentStatus
  | (string & {});

export type OpsTarget =
  | "runtime"
  | "release"
  | "approval"
  | "policy"
  | "capability"
  | "cron"
  | "ops"
  | "cli"
  | (string & {});

export interface OpsScope {
  app?: string;
  route?: string;
  method?: string;
  target?: string;
  capability?: string;
  resource?: string;
  policy?: string;
  approvalId?: string;
  releaseId?: string;
  traceId?: string;
  requestId?: string;
  [key: string]: string | undefined;
}

export interface OpsCorrelation {
  requestId?: string;
  traceId?: string;
  parentId?: string;
  releaseId?: string;
  approvalId?: string;
  runId?: string;
}

export interface OpsScopeFilter {
  key: string;
  values: string[];
}

export interface OpsEventRecord {
  id: string;
  kind: string;
  timestamp: string;
  severity: OpsSeverity;
  status: OpsRecordStatus;
  target: OpsTarget;
  scope: OpsScope;
  title?: string;
  summary?: string;
  message?: string;
  fingerprint?: string;
  tags: string[];
  correlation?: OpsCorrelation;
  metadata: Record<string, unknown>;
}

export interface OpsIncidentRecord {
  id: string;
  fingerprint: string;
  kind: string;
  timestamp: string;
  severity: OpsSeverity;
  status: OpsIncidentStatus;
  title: string;
  summary: string;
  target?: OpsTarget;
  scope: OpsScope;
  tags?: string[];
  correlation?: OpsCorrelation;
  metadata: Record<string, unknown>;
  firstSeenAt?: string;
  lastSeenAt?: string;
  resolvedAt?: string;
  observations?: number;
  lastEventId?: string;
}

export interface OpsHealthSignal {
  key: string;
  source: "event" | "incident" | "snapshot" | "query";
  severity: OpsSeverity;
  status: OpsHealthStatus;
  title: string;
  summary: string;
  kind?: string;
  fingerprint?: string;
  scope?: OpsScope;
  metadata?: Record<string, unknown>;
}

export interface OpsSnapshotRecord {
  id: string;
  timestamp: string;
  health: OpsHealthStatus;
  summary: string;
  signals: OpsHealthSignal[];
  scope?: OpsScope;
  metadata?: Record<string, unknown>;
}

export interface OpsEventFilter {
  ids?: string[];
  kinds?: string[];
  severities?: OpsSeverity[];
  statuses?: OpsRecordStatus[];
  targets?: OpsTarget[];
  tags?: string[];
  scopes?: OpsScopeFilter[];
  from?: string;
  to?: string;
  sort?: OpsSortOrder;
  limit?: number;
}

export interface OpsIncidentFilter {
  ids?: string[];
  fingerprints?: string[];
  kinds?: string[];
  severities?: OpsSeverity[];
  statuses?: OpsIncidentStatus[];
  targets?: OpsTarget[];
  tags?: string[];
  scopes?: OpsScopeFilter[];
  from?: string;
  to?: string;
  sort?: OpsSortOrder;
  limit?: number;
}

export interface OpsSnapshotFilter {
  ids?: string[];
  health?: OpsHealthStatus[];
  scopes?: OpsScopeFilter[];
  from?: string;
  to?: string;
  sort?: OpsSortOrder;
  limit?: number;
}

export interface OpsRetentionRule {
  maxAgeMs?: number;
}

export interface OpsRetentionConfig {
  events?: OpsRetentionRule;
  incidents?: OpsRetentionRule;
  snapshots?: OpsRetentionRule;
}

export interface OpsCompactionOptions {
  now?: string;
}

export interface OpsCompactionResult {
  eventsRemoved: number;
  incidentsRemoved: number;
  snapshotsRemoved: number;
}

export interface OpsQueryIndex {
  totalEvents: number;
  totalIncidents: number;
  totalSnapshots: number;
  eventsBySeverity: Partial<Record<OpsSeverity, number>>;
  eventsByStatus: Partial<Record<string, number>>;
  incidentsBySeverity: Partial<Record<OpsSeverity, number>>;
  incidentsByStatus: Partial<Record<OpsIncidentStatus, number>>;
  snapshotsByHealth: Partial<Record<OpsHealthStatus, number>>;
}

export interface OpsOverview {
  totals: {
    events: number;
    incidents: number;
    snapshots: number;
  };
  incidents: {
    open: number;
    acknowledged: number;
    suppressed: number;
    resolved: number;
  };
  health: {
    status: OpsHealthStatus;
    summary: string;
    signals: OpsHealthSignal[];
  };
  windows: {
    recentEvents: OpsEventRecord[];
    recentIncidents: OpsIncidentRecord[];
    recentSnapshots: OpsSnapshotRecord[];
  };
  index: OpsQueryIndex;
}

export interface OpsRuntimeOptions {
  store: OpsStore;
  serviceName?: string;
  environment?: string;
  incidentDedupeStatuses?: OpsIncidentStatus[];
}

export interface OpsRecordEventInput extends Omit<OpsEventRecord, "id"> {
  id?: string;
}

export interface OpsRecordIncidentInput extends Omit<OpsIncidentRecord, "id"> {
  id?: string;
}

export interface OpsCaptureSnapshotInput extends Omit<OpsSnapshotRecord, "id"> {
  id?: string;
}

export interface OpsStore {
  addEvent(record: OpsEventRecord): OpsEventRecord;
  getEvent(id: string): OpsEventRecord | undefined;
  listEvents(filter?: OpsEventFilter): OpsEventRecord[];
  addIncident(record: OpsIncidentRecord): OpsIncidentRecord;
  getIncident(id: string): OpsIncidentRecord | undefined;
  getIncidentByFingerprint(fingerprint: string): OpsIncidentRecord | undefined;
  listIncidents(filter?: OpsIncidentFilter): OpsIncidentRecord[];
  addSnapshot(record: OpsSnapshotRecord): OpsSnapshotRecord;
  listSnapshots(filter?: OpsSnapshotFilter): OpsSnapshotRecord[];
  compact(options?: OpsCompactionOptions): OpsCompactionResult;
  close(): void | Promise<void>;
}

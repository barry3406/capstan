import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import pc from "picocolors";

const OPS_PACKAGE_NAME = "@zauso-ai/capstan-ops";
const OPS_STORE_DIRNAME = ".capstan/ops";
const OPS_STORE_FILENAMES = ["ops.db", "ops.sqlite", "capstan-ops.db"];

export interface OpsEvent {
  id: string;
  timestamp: string;
  kind: string;
  status?: string;
  severity?: string;
  summary?: string;
  message?: string;
  source?: string;
  traceId?: string;
  requestId?: string;
  releaseId?: string;
  approvalId?: string;
  incidentId?: string;
  correlationId?: string;
  target?: string;
  resource?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}

export interface OpsIncident {
  id: string;
  timestamp: string;
  status: string;
  severity?: string;
  fingerprint?: string;
  summary?: string;
  message?: string;
  source?: string;
  traceId?: string;
  requestId?: string;
  releaseId?: string;
  approvalId?: string;
  correlationId?: string;
  events?: string[];
  metadata?: Record<string, unknown>;
}

export interface OpsHealthIssue {
  severity: "info" | "warning" | "error";
  code: string;
  summary: string;
  detail?: string;
  hint?: string;
}

export interface OpsHealthSnapshot {
  status: "healthy" | "degraded" | "unhealthy" | "unknown";
  summary: string;
  generatedAt: string;
  events: number;
  incidents: number;
  openIncidents: number;
  criticalIncidents: number;
  warningIncidents: number;
  lastEventAt?: string;
  lastIncidentAt?: string;
  issues: OpsHealthIssue[];
}

export interface OpsSnapshot {
  appRoot: string;
  storeDir: string;
  generatedAt?: string;
  events: OpsEvent[];
  incidents: OpsIncident[];
  health?: OpsHealthSnapshot;
  source: "filesystem" | "package";
}

export interface OpsQueryOptions {
  limit?: number;
  kind?: string;
  severity?: string;
  status?: string;
  since?: string;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date(0).toISOString();
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return entries.length > 0 ? entries : undefined;
}

function findExistingOpsStoreFile(storeDir: string): string | null {
  for (const name of OPS_STORE_FILENAMES) {
    const candidate = join(storeDir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return toRecord(value);
}

function mapOpsEventRecord(record: unknown, index: number): OpsEvent | null {
  const source = toRecord(record);
  if (!source) {
    return null;
  }

  const id = readOptionalString(source.id) ?? `event-${index + 1}`;
  const timestamp = normalizeTimestamp(source.timestamp ?? source.createdAt ?? source.ts);
  const kind = readString(source.kind, "event");
  const event: OpsEvent = {
    id,
    timestamp,
    kind,
  };

  const status = readOptionalString(source.status);
  const severity = readOptionalString(source.severity);
  const summary = readOptionalString(source.summary) ?? readOptionalString(source.title);
  const message = readOptionalString(source.message);
  const sourceName = readOptionalString(source.source) ?? "package";
  const target = readOptionalString(source.target) ?? readOptionalString(readOptionalRecord(source.scope)?.target);
  const resource = readOptionalString(source.resource) ?? readOptionalString(readOptionalRecord(source.scope)?.resource);
  const actor = readOptionalString(source.actor);
  const scope = readOptionalRecord(source.scope);
  const correlation = readOptionalRecord(source.correlation);
  const traceId = readOptionalString(source.traceId)
    ?? readOptionalString(scope?.traceId)
    ?? readOptionalString(correlation?.traceId);
  const requestId = readOptionalString(source.requestId)
    ?? readOptionalString(scope?.requestId)
    ?? readOptionalString(correlation?.requestId);
  const releaseId = readOptionalString(source.releaseId)
    ?? readOptionalString(scope?.releaseId)
    ?? readOptionalString(correlation?.releaseId);
  const approvalId = readOptionalString(source.approvalId)
    ?? readOptionalString(scope?.approvalId)
    ?? readOptionalString(correlation?.approvalId);
  const correlationId = readOptionalString(source.correlationId)
    ?? readOptionalString(correlation?.parentId);
  const metadata = toRecord(source.metadata);

  if (status) event.status = status;
  if (severity) event.severity = severity;
  if (summary) event.summary = summary;
  if (message) event.message = message;
  if (sourceName) event.source = sourceName;
  if (traceId) event.traceId = traceId;
  if (requestId) event.requestId = requestId;
  if (releaseId) event.releaseId = releaseId;
  if (approvalId) event.approvalId = approvalId;
  if (correlationId) event.correlationId = correlationId;
  if (target) event.target = target;
  if (resource) event.resource = resource;
  if (actor) event.actor = actor;
  if (metadata) event.metadata = metadata;

  return event;
}

function mapOpsIncidentRecord(record: unknown, index: number): OpsIncident | null {
  const source = toRecord(record);
  if (!source) {
    return null;
  }

  const id = readOptionalString(source.id) ?? `incident-${index + 1}`;
  const timestamp = normalizeTimestamp(source.timestamp ?? source.createdAt ?? source.ts);
  const status = readString(source.status, "open");
  const incident: OpsIncident = {
    id,
    timestamp,
    status,
  };

  const severity = readOptionalString(source.severity);
  const fingerprint = readOptionalString(source.fingerprint);
  const summary = readOptionalString(source.summary) ?? readOptionalString(source.title);
  const message = readOptionalString(source.message);
  const sourceName = readOptionalString(source.source) ?? "package";
  const scope = readOptionalRecord(source.scope);
  const correlation = readOptionalRecord(source.correlation);
  const traceId = readOptionalString(source.traceId)
    ?? readOptionalString(scope?.traceId)
    ?? readOptionalString(correlation?.traceId);
  const requestId = readOptionalString(source.requestId)
    ?? readOptionalString(scope?.requestId)
    ?? readOptionalString(correlation?.requestId);
  const releaseId = readOptionalString(source.releaseId)
    ?? readOptionalString(scope?.releaseId)
    ?? readOptionalString(correlation?.releaseId);
  const approvalId = readOptionalString(source.approvalId)
    ?? readOptionalString(scope?.approvalId)
    ?? readOptionalString(correlation?.approvalId);
  const correlationId = readOptionalString(source.correlationId)
    ?? readOptionalString(correlation?.parentId);
  const events = toStringArray(source.events);
  const metadata = toRecord(source.metadata);

  if (severity) incident.severity = severity;
  if (fingerprint) incident.fingerprint = fingerprint;
  if (summary) incident.summary = summary;
  if (message) incident.message = message;
  if (sourceName) incident.source = sourceName;
  if (traceId) incident.traceId = traceId;
  if (requestId) incident.requestId = requestId;
  if (releaseId) incident.releaseId = releaseId;
  if (approvalId) incident.approvalId = approvalId;
  if (correlationId) incident.correlationId = correlationId;
  if (events) incident.events = events;
  if (metadata) incident.metadata = metadata;

  return incident;
}

function signalToIssue(signal: unknown): OpsHealthIssue | null {
  const record = toRecord(signal);
  if (!record) {
    return null;
  }

  const summary = readOptionalString(record.summary);
  const key = readOptionalString(record.key);
  const title = readOptionalString(record.title);
  const status = readOptionalString(record.status);
  const severity = status === "unhealthy" ? "error" : status === "degraded" ? "warning" : "info";
  const issue: OpsHealthIssue = {
    severity,
    code: readOptionalString(record.fingerprint) ?? readOptionalString(record.kind) ?? key ?? "signal",
    summary: summary ?? title ?? "Ops signal",
  };

  if (title && title !== issue.summary) {
    issue.detail = title;
  }
  const metadata = toRecord(record.metadata);
  const hint = metadata ? readOptionalString(metadata.hint) : undefined;
  if (hint) {
    issue.hint = hint;
  }

  return issue;
}

function buildHealthSnapshotFromStoreRecords(options: {
  events: OpsEvent[];
  incidents: OpsIncident[];
  snapshots: Array<{ timestamp: string; health: string; summary: string; signals?: unknown[] }>;
  generatedAt: string;
}): OpsHealthSnapshot | undefined {
  const latestSnapshot = options.snapshots[0];
  if (!latestSnapshot) {
    return undefined;
  }

  const issues = Array.isArray(latestSnapshot.signals)
    ? latestSnapshot.signals.map(signalToIssue).filter((item): item is OpsHealthIssue => item !== null)
    : [];

  const health: OpsHealthSnapshot = {
    status:
      latestSnapshot.health === "healthy" ||
      latestSnapshot.health === "degraded" ||
      latestSnapshot.health === "unhealthy"
        ? latestSnapshot.health
        : "unknown",
    summary: latestSnapshot.summary || "No summary available.",
    generatedAt: normalizeTimestamp(latestSnapshot.timestamp ?? options.generatedAt),
    events: options.events.length,
    incidents: options.incidents.length,
    openIncidents: options.incidents.filter((incident) => incident.status !== "resolved" && incident.status !== "closed").length,
    criticalIncidents: options.incidents.filter((incident) => incident.severity === "critical" || incident.severity === "error").length,
    warningIncidents: options.incidents.filter((incident) => incident.severity === "warning").length,
    issues,
  };

  const lastEventAt = options.events[0]?.timestamp;
  const lastIncidentAt = options.incidents[0]?.timestamp;
  if (lastEventAt) {
    health.lastEventAt = lastEventAt;
  }
  if (lastIncidentAt) {
    health.lastIncidentAt = lastIncidentAt;
  }

  return health;
}

function collectStoreSnapshot(
  appRoot: string,
  storeDir: string,
  events: OpsEvent[],
  incidents: OpsIncident[],
  health: OpsHealthSnapshot | undefined,
): OpsSnapshot {
  const snapshot: OpsSnapshot = {
    appRoot,
    storeDir,
    events: dedupeByIdAndTimestamp(sortNewest(events)),
    incidents: dedupeByIdAndTimestamp(sortNewest(incidents)),
    source: "package",
  };

  if (health) {
    snapshot.health = health;
  }

  snapshot.generatedAt = health?.generatedAt ?? snapshot.events[0]?.timestamp ?? snapshot.incidents[0]?.timestamp ?? new Date().toISOString();
  return snapshot;
}

function toEvent(value: unknown, index: number): OpsEvent | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const id = readOptionalString(record.id) ?? `event-${index + 1}`;
  const timestamp = normalizeTimestamp(record.timestamp ?? record.createdAt ?? record.ts);
  const kind = readString(record.kind ?? record.type, "event");

  const event: OpsEvent = {
    id,
    timestamp,
    kind,
  };

  const status = readOptionalString(record.status);
  const severity = readOptionalString(record.severity);
  const summary = readOptionalString(record.summary);
  const message = readOptionalString(record.message);
  const source = readOptionalString(record.source);
  const traceId = readOptionalString(record.traceId);
  const requestId = readOptionalString(record.requestId);
  const releaseId = readOptionalString(record.releaseId);
  const approvalId = readOptionalString(record.approvalId);
  const incidentId = readOptionalString(record.incidentId);
  const correlationId = readOptionalString(record.correlationId);
  const target = readOptionalString(record.target);
  const resource = readOptionalString(record.resource);
  const actor = readOptionalString(record.actor);
  const metadata = toRecord(record.metadata);

  if (status) event.status = status;
  if (severity) event.severity = severity;
  if (summary) event.summary = summary;
  if (message) event.message = message;
  if (source) event.source = source;
  if (traceId) event.traceId = traceId;
  if (requestId) event.requestId = requestId;
  if (releaseId) event.releaseId = releaseId;
  if (approvalId) event.approvalId = approvalId;
  if (incidentId) event.incidentId = incidentId;
  if (correlationId) event.correlationId = correlationId;
  if (target) event.target = target;
  if (resource) event.resource = resource;
  if (actor) event.actor = actor;
  if (metadata) event.metadata = metadata;

  return event;
}

function toIncident(value: unknown, index: number): OpsIncident | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const id = readOptionalString(record.id) ?? `incident-${index + 1}`;
  const timestamp = normalizeTimestamp(record.timestamp ?? record.createdAt ?? record.ts);
  const status = readString(record.status, "open");

  const incident: OpsIncident = {
    id,
    timestamp,
    status,
  };

  const severity = readOptionalString(record.severity);
  const fingerprint = readOptionalString(record.fingerprint);
  const summary = readOptionalString(record.summary);
  const message = readOptionalString(record.message);
  const source = readOptionalString(record.source);
  const traceId = readOptionalString(record.traceId);
  const requestId = readOptionalString(record.requestId);
  const releaseId = readOptionalString(record.releaseId);
  const approvalId = readOptionalString(record.approvalId);
  const correlationId = readOptionalString(record.correlationId);
  const events = toStringArray(record.events);
  const metadata = toRecord(record.metadata);

  if (severity) incident.severity = severity;
  if (fingerprint) incident.fingerprint = fingerprint;
  if (summary) incident.summary = summary;
  if (message) incident.message = message;
  if (source) incident.source = source;
  if (traceId) incident.traceId = traceId;
  if (requestId) incident.requestId = requestId;
  if (releaseId) incident.releaseId = releaseId;
  if (approvalId) incident.approvalId = approvalId;
  if (correlationId) incident.correlationId = correlationId;
  if (events) incident.events = events;
  if (metadata) incident.metadata = metadata;

  return incident;
}

function toHealthSnapshot(value: unknown): OpsHealthSnapshot | undefined {
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }

  const issues: OpsHealthIssue[] = [];
  const issueRecords = Array.isArray(record.issues) ? record.issues : [];
  for (const issueValue of issueRecords) {
    const issueRecord = toRecord(issueValue);
    if (!issueRecord) {
      continue;
    }
    const severity = readOptionalString(issueRecord.severity);
    if (severity !== "info" && severity !== "warning" && severity !== "error") {
      continue;
    }
    const code = readOptionalString(issueRecord.code);
    const summary = readOptionalString(issueRecord.summary);
    if (!code || !summary) {
      continue;
    }
    const detail = readOptionalString(issueRecord.detail);
    const hint = readOptionalString(issueRecord.hint);
    const issue: OpsHealthIssue = {
      severity,
      code,
      summary,
    };
    if (detail) {
      issue.detail = detail;
    }
    if (hint) {
      issue.hint = hint;
    }
    issues.push(issue);
  }

  const status = readOptionalString(record.status);
  if (status !== "healthy" && status !== "degraded" && status !== "unhealthy" && status !== "unknown") {
    return undefined;
  }

  const summary = readOptionalString(record.summary) ?? "No summary available.";
  const generatedAt = normalizeTimestamp(record.generatedAt ?? record.timestamp ?? record.ts);
  const health: OpsHealthSnapshot = {
    status,
    summary,
    generatedAt,
    events: Number.isFinite(Number(record.events)) ? Number(record.events) : 0,
    incidents: Number.isFinite(Number(record.incidents)) ? Number(record.incidents) : 0,
    openIncidents: Number.isFinite(Number(record.openIncidents)) ? Number(record.openIncidents) : 0,
    criticalIncidents: Number.isFinite(Number(record.criticalIncidents)) ? Number(record.criticalIncidents) : 0,
    warningIncidents: Number.isFinite(Number(record.warningIncidents)) ? Number(record.warningIncidents) : 0,
    issues,
  };
  const lastEventAt = readOptionalString(record.lastEventAt);
  const lastIncidentAt = readOptionalString(record.lastIncidentAt);
  if (lastEventAt) {
    health.lastEventAt = normalizeTimestamp(lastEventAt);
  }
  if (lastIncidentAt) {
    health.lastIncidentAt = normalizeTimestamp(lastIncidentAt);
  }
  return health;
}

function sortNewest<T extends { timestamp: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

function dedupeByIdAndTimestamp<T extends { id: string; timestamp: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = `${item.id}:${item.timestamp}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function filterByQuery<T extends { timestamp: string; severity?: string; status?: string }>(
  items: T[],
  options: OpsQueryOptions,
): T[] {
  const sinceAt = options.since ? Date.parse(options.since) : undefined;
  return items.filter((item) => {
    if (sinceAt !== undefined && !Number.isNaN(sinceAt) && Date.parse(item.timestamp) < sinceAt) {
      return false;
    }
    if (options.kind && (item as { kind?: string }).kind !== options.kind) {
      return false;
    }
    if (options.severity && item.severity !== options.severity) {
      return false;
    }
    if (options.status && item.status !== options.status) {
      return false;
    }
    return true;
  });
}

function filterByLimit<T>(items: T[], limit?: number): T[] {
  if (!limit || limit <= 0) {
    return items;
  }
  return items.slice(0, limit);
}

function mergeStoreFiles(
  payload: Record<string, unknown>,
  snapshot: OpsSnapshot,
): void {
  if (Array.isArray(payload.events)) {
    snapshot.events.push(...payload.events.map(toEvent).filter((item): item is OpsEvent => item !== null));
  }
  if (Array.isArray(payload.incidents)) {
    snapshot.incidents.push(...payload.incidents.map(toIncident).filter((item): item is OpsIncident => item !== null));
  }
  if (!snapshot.health && payload.health) {
    const health = toHealthSnapshot(payload.health);
    if (health) {
      snapshot.health = health;
    }
  }
  if (!snapshot.generatedAt && typeof payload.generatedAt === "string") {
    snapshot.generatedAt = normalizeTimestamp(payload.generatedAt);
  }
}

function hasAnyOpsFiles(storeDir: string): boolean {
  return existsSync(join(storeDir, "ops.json")) ||
    existsSync(join(storeDir, "events.json")) ||
    existsSync(join(storeDir, "events.jsonl")) ||
    existsSync(join(storeDir, "events.ndjson")) ||
    existsSync(join(storeDir, "incidents.json")) ||
    existsSync(join(storeDir, "incidents.jsonl")) ||
    existsSync(join(storeDir, "health.json")) ||
    existsSync(join(storeDir, "snapshot.json"));
}

async function readJsonFileIfExists(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function readJsonLinesFileIfExists(filePath: string): Promise<unknown[] | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.map((line) => JSON.parse(line) as unknown);
  } catch {
    return null;
  }
}

async function loadOpsSnapshotFromFilesystem(appRoot: string): Promise<OpsSnapshot> {
  const storeDir = join(appRoot, OPS_STORE_DIRNAME);
  const snapshot: OpsSnapshot = {
    appRoot,
    storeDir,
    events: [],
    incidents: [],
    source: "filesystem",
  };

  if (!hasAnyOpsFiles(storeDir)) {
    return snapshot;
  }

  const opsJson = await readJsonFileIfExists(join(storeDir, "ops.json"));
  if (opsJson && typeof opsJson === "object" && !Array.isArray(opsJson)) {
    mergeStoreFiles(opsJson as Record<string, unknown>, snapshot);
  }

  const eventsJson = await readJsonFileIfExists(join(storeDir, "events.json"));
  if (eventsJson && typeof eventsJson === "object" && !Array.isArray(eventsJson)) {
    mergeStoreFiles(eventsJson as Record<string, unknown>, snapshot);
  } else if (Array.isArray(eventsJson)) {
    snapshot.events.push(...eventsJson.map(toEvent).filter((item): item is OpsEvent => item !== null));
  }

  const eventsJsonl = await readJsonLinesFileIfExists(join(storeDir, "events.jsonl"))
    ?? await readJsonLinesFileIfExists(join(storeDir, "events.ndjson"));
  if (eventsJsonl) {
    snapshot.events.push(...eventsJsonl.map(toEvent).filter((item): item is OpsEvent => item !== null));
  }

  const incidentsJson = await readJsonFileIfExists(join(storeDir, "incidents.json"));
  if (incidentsJson && typeof incidentsJson === "object" && !Array.isArray(incidentsJson)) {
    mergeStoreFiles(incidentsJson as Record<string, unknown>, snapshot);
  } else if (Array.isArray(incidentsJson)) {
    snapshot.incidents.push(...incidentsJson.map(toIncident).filter((item): item is OpsIncident => item !== null));
  }

  const incidentsJsonl = await readJsonLinesFileIfExists(join(storeDir, "incidents.jsonl"));
  if (incidentsJsonl) {
    snapshot.incidents.push(...incidentsJsonl.map(toIncident).filter((item): item is OpsIncident => item !== null));
  }

  const healthJson = await readJsonFileIfExists(join(storeDir, "health.json"))
    ?? await readJsonFileIfExists(join(storeDir, "snapshot.json"));
  if (healthJson) {
    const health = toHealthSnapshot(healthJson);
    if (health) {
      snapshot.health = health;
    }
  }

  snapshot.events = sortNewest(snapshot.events);
  snapshot.events = dedupeByIdAndTimestamp(snapshot.events);
  snapshot.incidents = sortNewest(snapshot.incidents);
  snapshot.incidents = dedupeByIdAndTimestamp(snapshot.incidents);
  if (!snapshot.generatedAt) {
    snapshot.generatedAt = new Date().toISOString();
  }

  return snapshot;
}

async function loadOpsSnapshotFromPackage(appRoot: string): Promise<OpsSnapshot | null> {
  try {
    const external = await import(OPS_PACKAGE_NAME).catch(async () => {
      const localCandidates = [
        new URL("../../ops/dist/index.js", import.meta.url).href,
        new URL("../../ops/src/index.ts", import.meta.url).href,
      ];
      for (const candidate of localCandidates) {
        try {
          return await import(candidate);
        } catch {
          // Try the next candidate.
        }
      }
      return null;
    });
    if (!external) {
      return null;
    }

    const module = external as Record<string, unknown>;
    const storeDir = join(appRoot, OPS_STORE_DIRNAME);
    const storeFile = findExistingOpsStoreFile(storeDir);
    if (storeFile && typeof module.SqliteCapstanOpsStore === "function") {
      const StoreClass = module.SqliteCapstanOpsStore as new (options: { path: string }) => {
        listEvents(filter?: unknown): Promise<unknown[]> | unknown[];
        listIncidents(filter?: unknown): Promise<unknown[]> | unknown[];
        listSnapshots(filter?: unknown): Promise<unknown[]> | unknown[];
        close(): Promise<void> | void;
      };
      const store = new StoreClass({ path: storeFile });
      try {
        const [eventsRaw, incidentsRaw, snapshotsRaw] = await Promise.all([
          store.listEvents(),
          store.listIncidents(),
          store.listSnapshots(),
        ]);

        const events = Array.isArray(eventsRaw)
          ? eventsRaw.map(mapOpsEventRecord).filter((item): item is OpsEvent => item !== null)
          : [];
        const incidents = Array.isArray(incidentsRaw)
          ? incidentsRaw.map(mapOpsIncidentRecord).filter((item): item is OpsIncident => item !== null)
          : [];
        const snapshots = Array.isArray(snapshotsRaw)
          ? snapshotsRaw
              .map((snapshot) => {
                const record = toRecord(snapshot);
                if (!record) {
                  return null;
                }
                return {
                  timestamp: normalizeTimestamp(record.timestamp ?? record.createdAt ?? record.ts),
                  health: readOptionalString(record.health) ?? "unknown",
                  summary: readOptionalString(record.summary) ?? "No summary available.",
                  signals: Array.isArray(record.signals) ? record.signals : [],
                };
              })
              .filter(
                (item): item is { timestamp: string; health: string; summary: string; signals: unknown[] } =>
                  item !== null,
              )
          : [];

        const health = buildHealthSnapshotFromStoreRecords({
          events: sortNewest(dedupeByIdAndTimestamp(events)),
          incidents: sortNewest(dedupeByIdAndTimestamp(incidents)),
          snapshots: sortNewest(snapshots),
          generatedAt: new Date().toISOString(),
        });

        return collectStoreSnapshot(
          appRoot,
          storeDir,
          events,
          incidents,
          health,
        );
      } finally {
        await Promise.resolve(store.close()).catch(() => {});
      }
    }

    for (const key of ["loadOpsSnapshot", "readOpsSnapshot"] as const) {
      const candidate = module[key];
      if (typeof candidate !== "function") {
        continue;
      }
      const result = await candidate(appRoot);
      if (!result || typeof result !== "object") {
        continue;
      }
      const record = result as Partial<OpsSnapshot> & {
        events?: unknown[];
        incidents?: unknown[];
        health?: unknown;
      };
      const snapshot: OpsSnapshot = {
        appRoot,
        storeDir,
        generatedAt: record.generatedAt ?? new Date().toISOString(),
        events: Array.isArray(record.events)
          ? record.events.map(mapOpsEventRecord).filter((item): item is OpsEvent => item !== null)
          : [],
        incidents: Array.isArray(record.incidents)
          ? record.incidents.map(mapOpsIncidentRecord).filter((item): item is OpsIncident => item !== null)
          : [],
        source: "package",
      };
      if (record.health) {
        const health = toHealthSnapshot(record.health);
        if (health) {
          snapshot.health = health;
        }
      }
      snapshot.events = dedupeByIdAndTimestamp(sortNewest(snapshot.events));
      snapshot.incidents = dedupeByIdAndTimestamp(sortNewest(snapshot.incidents));
      return snapshot;
    }
  } catch {
    return null;
  }

  return null;
}

export async function loadOpsSnapshot(appRoot: string): Promise<OpsSnapshot> {
  const packageSnapshot = await loadOpsSnapshotFromPackage(appRoot);
  if (packageSnapshot) {
    return packageSnapshot;
  }

  return loadOpsSnapshotFromFilesystem(appRoot);
}

export function summarizeOpsHealth(snapshot: OpsSnapshot): OpsHealthSnapshot {
  const openIncidents = snapshot.incidents.filter((incident) => incident.status !== "resolved" && incident.status !== "closed");
  const criticalIncidents = openIncidents.filter((incident) => incident.severity === "critical" || incident.severity === "error");
  const warningIncidents = openIncidents.filter((incident) => incident.severity === "warning");

  if (snapshot.health) {
    const merged: OpsHealthSnapshot = {
      ...snapshot.health,
      events: Math.max(snapshot.health.events, snapshot.events.length),
      incidents: Math.max(snapshot.health.incidents, snapshot.incidents.length),
      openIncidents: Math.max(snapshot.health.openIncidents, openIncidents.length),
      criticalIncidents: Math.max(snapshot.health.criticalIncidents, criticalIncidents.length),
      warningIncidents: Math.max(snapshot.health.warningIncidents, warningIncidents.length),
    };
    if (criticalIncidents.length > 0) {
      merged.status = "unhealthy";
    } else if (openIncidents.length > 0 || warningIncidents.length > 0) {
      if (merged.status === "healthy") {
        merged.status = "degraded";
      }
    }
    const lastEventAt = snapshot.health.lastEventAt ?? snapshot.events[0]?.timestamp;
    const lastIncidentAt = snapshot.health.lastIncidentAt ?? snapshot.incidents[0]?.timestamp;
    if (lastEventAt) {
      merged.lastEventAt = lastEventAt;
    }
    if (lastIncidentAt) {
      merged.lastIncidentAt = lastIncidentAt;
    }
    if (merged.issues.length === 0) {
      for (const incident of criticalIncidents.slice(0, 5)) {
        merged.issues.push({
          severity: "error",
          code: incident.fingerprint ?? incident.id,
          summary: incident.summary ?? incident.message ?? "Open critical incident",
          ...(incident.message ? { detail: incident.message } : {}),
        });
      }
      for (const incident of warningIncidents.slice(0, 5)) {
        merged.issues.push({
          severity: "warning",
          code: incident.fingerprint ?? incident.id,
          summary: incident.summary ?? incident.message ?? "Open warning incident",
          ...(incident.message ? { detail: incident.message } : {}),
        });
      }
    }
    return merged;
  }

  const status =
    criticalIncidents.length > 0
      ? "unhealthy"
      : openIncidents.length > 0 || warningIncidents.length > 0
        ? "degraded"
        : "healthy";

  const issues: OpsHealthIssue[] = [];
  for (const incident of criticalIncidents.slice(0, 5)) {
    issues.push({
      severity: "error",
      code: incident.fingerprint ?? incident.id,
      summary: incident.summary ?? incident.message ?? "Open critical incident",
      ...(incident.message ? { detail: incident.message } : {}),
    });
  }
  for (const incident of warningIncidents.slice(0, 5)) {
    issues.push({
      severity: "warning",
      code: incident.fingerprint ?? incident.id,
      summary: incident.summary ?? incident.message ?? "Open warning incident",
      ...(incident.message ? { detail: incident.message } : {}),
    });
  }

  const health: OpsHealthSnapshot = {
    status,
    summary: status === "healthy"
      ? "No active incidents detected."
      : status === "degraded"
        ? "Some incidents need attention."
        : "Critical incidents are open.",
    generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
    events: snapshot.events.length,
    incidents: snapshot.incidents.length,
    openIncidents: openIncidents.length,
    criticalIncidents: criticalIncidents.length,
    warningIncidents: warningIncidents.length,
    issues,
  };
  const lastEventAt = snapshot.events[0]?.timestamp;
  const lastIncidentAt = snapshot.incidents[0]?.timestamp;
  if (lastEventAt) {
    health.lastEventAt = lastEventAt;
  }
  if (lastIncidentAt) {
    health.lastIncidentAt = lastIncidentAt;
  }
  return health;
}

export function normalizeOpsEvents(snapshot: OpsSnapshot, options: OpsQueryOptions = {}): OpsEvent[] {
  return filterByLimit(
    filterByQuery(snapshot.events, options),
    options.limit,
  );
}

export function normalizeOpsIncidents(snapshot: OpsSnapshot, options: OpsQueryOptions = {}): OpsIncident[] {
  return filterByLimit(
    filterByQuery(snapshot.incidents, options),
    options.limit,
  );
}

function printOpsJson<T>(payload: T): void {
  console.log(JSON.stringify(payload, null, 2));
}

function renderOpsHeading(snapshot: OpsSnapshot, title: string): string {
  return [
    `${title} ${pc.dim(`(${snapshot.source})`)}`,
    `  App root: ${snapshot.appRoot}`,
    `  Store: ${snapshot.storeDir}`,
    "",
  ].join("\n");
}

function renderOpsEventLines(events: OpsEvent[]): string[] {
  if (events.length === 0) {
    return ["  No events found."];
  }

  const lines: string[] = [];
  for (const event of events) {
    lines.push(
      `  - ${event.timestamp} ${pc.cyan(event.kind)}${event.status ? ` ${pc.dim(`[${event.status}]`)}` : ""}${event.summary ? ` ${event.summary}` : ""}`,
    );
    if (event.message && event.message !== event.summary) {
      lines.push(`    → ${event.message}`);
    }
    const contextBits = [
      event.id ? `id=${event.id}` : undefined,
      event.traceId ? `trace=${event.traceId}` : undefined,
      event.requestId ? `request=${event.requestId}` : undefined,
      event.releaseId ? `release=${event.releaseId}` : undefined,
      event.approvalId ? `approval=${event.approvalId}` : undefined,
    ].filter(Boolean);
    if (contextBits.length > 0) {
      lines.push(`    ${pc.dim(contextBits.join(" "))}`);
    }
  }
  return lines;
}

function renderOpsIncidentLines(incidents: OpsIncident[]): string[] {
  if (incidents.length === 0) {
    return ["  No incidents found."];
  }

  const lines: string[] = [];
  for (const incident of incidents) {
    const statusTag = pc.dim(`[${incident.status}]`);
    lines.push(
      `  - ${incident.timestamp} ${statusTag}${incident.severity ? ` ${pc.yellow(incident.severity)}` : ""}${incident.summary ? ` ${incident.summary}` : ""}`,
    );
    if (incident.message && incident.message !== incident.summary) {
      lines.push(`    → ${incident.message}`);
    }
    const contextBits = [
      incident.id ? `id=${incident.id}` : undefined,
      incident.fingerprint ? `fingerprint=${incident.fingerprint}` : undefined,
      incident.traceId ? `trace=${incident.traceId}` : undefined,
      incident.requestId ? `request=${incident.requestId}` : undefined,
      incident.releaseId ? `release=${incident.releaseId}` : undefined,
    ].filter(Boolean);
    if (contextBits.length > 0) {
      lines.push(`    ${pc.dim(contextBits.join(" "))}`);
    }
  }
  return lines;
}

function parseOpsPathArg(args: string[]): string {
  const explicit = readFlagValue(args, "--path") ?? readFlagValue(args, "--root");
  if (explicit) {
    return resolve(process.cwd(), explicit);
  }

  const flagsWithValues = new Set([
    "--path",
    "--root",
    "--limit",
    "--kind",
    "--severity",
    "--status",
    "--since",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== "string") {
      continue;
    }
    if (arg === "--json" || arg === "--follow") {
      continue;
    }
    if (flagsWithValues.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) {
      return resolve(process.cwd(), arg);
    }
  }
  return process.cwd();
}

function readFlagNumber(args: string[], flag: string, fallback: number): number {
  return parseInteger(readFlagValue(args, flag), fallback);
}

export async function runOpsEvents(args: string[]): Promise<void> {
  const appRoot = parseOpsPathArg(args);
  const snapshot = await loadOpsSnapshot(appRoot);
  const query: OpsQueryOptions = { limit: readFlagNumber(args, "--limit", 20) };
  const kind = readFlagValue(args, "--kind");
  const severity = readFlagValue(args, "--severity");
  const since = readFlagValue(args, "--since");
  if (kind) query.kind = kind;
  if (severity) query.severity = severity;
  if (since) query.since = since;
  const events = normalizeOpsEvents(snapshot, query);

  if (hasFlag(args, "--json")) {
    printOpsJson({
      appRoot,
      source: snapshot.source,
      generatedAt: snapshot.generatedAt,
      total: events.length,
      events,
    });
    return;
  }

  console.log(renderOpsHeading(snapshot, "Capstan Ops Events"));
  console.log(renderOpsEventLines(events).join("\n"));
  console.log("");
  console.log(`  ${events.length} event${events.length === 1 ? "" : "s"} shown.`);
}

export async function runOpsIncidents(args: string[]): Promise<void> {
  const appRoot = parseOpsPathArg(args);
  const snapshot = await loadOpsSnapshot(appRoot);
  const query: OpsQueryOptions = { limit: readFlagNumber(args, "--limit", 20) };
  const status = readFlagValue(args, "--status");
  const severity = readFlagValue(args, "--severity");
  const since = readFlagValue(args, "--since");
  if (status) query.status = status;
  if (severity) query.severity = severity;
  if (since) query.since = since;
  const incidents = normalizeOpsIncidents(snapshot, query);

  if (hasFlag(args, "--json")) {
    printOpsJson({
      appRoot,
      source: snapshot.source,
      generatedAt: snapshot.generatedAt,
      total: incidents.length,
      incidents,
    });
    return;
  }

  console.log(renderOpsHeading(snapshot, "Capstan Ops Incidents"));
  console.log(renderOpsIncidentLines(incidents).join("\n"));
  console.log("");
  console.log(`  ${incidents.length} incident${incidents.length === 1 ? "" : "s"} shown.`);
}

export async function runOpsHealth(args: string[]): Promise<void> {
  const appRoot = parseOpsPathArg(args);
  const snapshot = await loadOpsSnapshot(appRoot);
  const health = summarizeOpsHealth(snapshot);

  if (hasFlag(args, "--json")) {
    printOpsJson({
      appRoot,
      source: snapshot.source,
      generatedAt: health.generatedAt,
      health,
      events: snapshot.events.length,
      incidents: snapshot.incidents.length,
    });
    return;
  }

  console.log(renderOpsHeading(snapshot, "Capstan Ops Health"));
  console.log(`  Status: ${health.status}`);
  console.log(`  Summary: ${health.summary}`);
  console.log(`  Events: ${health.events}`);
  console.log(`  Incidents: ${health.incidents} (${health.openIncidents} open)`);
  if (health.lastEventAt) {
    console.log(`  Last event: ${health.lastEventAt}`);
  }
  if (health.lastIncidentAt) {
    console.log(`  Last incident: ${health.lastIncidentAt}`);
  }
  if (health.issues.length > 0) {
    console.log("");
    console.log("  Issues:");
    for (const issue of health.issues) {
      console.log(`    - ${issue.severity.toUpperCase()} ${issue.code}: ${issue.summary}`);
      if (issue.detail) {
        console.log(`      → ${issue.detail}`);
      }
      if (issue.hint) {
        console.log(`      hint: ${issue.hint}`);
      }
    }
  }
}

function mergeFeedItems(snapshot: OpsSnapshot): Array<
  | { kind: "event"; timestamp: string; id: string; summary: string; severity?: string; status?: string; source?: string }
  | { kind: "incident"; timestamp: string; id: string; summary: string; severity?: string; status: string; source?: string }
> {
  const events = snapshot.events.map((event) => {
    const feedEvent: {
      kind: "event";
      timestamp: string;
      id: string;
      summary: string;
      severity?: string;
      status?: string;
      source?: string;
    } = {
      kind: "event" as const,
      timestamp: event.timestamp,
      id: event.id,
      summary: event.summary ?? event.message ?? event.kind,
    };
    if (event.severity) {
      feedEvent.severity = event.severity;
    }
    if (event.status) {
      feedEvent.status = event.status;
    }
    if (event.source) {
      feedEvent.source = event.source;
    }
    return feedEvent;
  });
  const incidents = snapshot.incidents.map((incident) => {
    const feedIncident: {
      kind: "incident";
      timestamp: string;
      id: string;
      summary: string;
      severity?: string;
      status: string;
      source?: string;
    } = {
      kind: "incident" as const,
      timestamp: incident.timestamp,
      id: incident.id,
      summary: incident.summary ?? incident.message ?? "Incident",
      status: incident.status,
    };
    if (incident.severity) {
      feedIncident.severity = incident.severity;
    }
    if (incident.source) {
      feedIncident.source = incident.source;
    }
    return feedIncident;
  });

  return [...events, ...incidents].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

export async function runOpsTail(args: string[]): Promise<void> {
  const appRoot = parseOpsPathArg(args);
  const limit = readFlagNumber(args, "--limit", 20);
  const follow = hasFlag(args, "--follow");
  const snapshot = await loadOpsSnapshot(appRoot);
  const feed = filterByLimit(mergeFeedItems(snapshot), limit);

  if (hasFlag(args, "--json")) {
    printOpsJson({
      appRoot,
      source: snapshot.source,
      generatedAt: snapshot.generatedAt,
      total: feed.length,
      feed,
      follow,
    });
    return;
  }

  const printBatch = (items: typeof feed, seenIds: Set<string>): void => {
    for (const item of items) {
      const key = `${item.kind}:${item.id}:${item.timestamp}`;
      if (seenIds.has(key)) {
        continue;
      }
      seenIds.add(key);
      const tag = item.kind === "event" ? pc.cyan("event") : pc.yellow("incident");
      console.log(`  - ${item.timestamp} ${tag} ${item.summary}`);
      console.log(`    ${pc.dim(`id=${item.id}${item.severity ? ` severity=${item.severity}` : ""}${item.status ? ` status=${item.status}` : ""}${item.source ? ` source=${item.source}` : ""}`)}`);
    }
  };

  console.log(renderOpsHeading(snapshot, "Capstan Ops Tail"));
  if (!follow) {
    if (feed.length === 0) {
      console.log("  No events or incidents found.");
      return;
    }
    printBatch(feed, new Set<string>());
    return;
  }

  const seen = new Set<string>();
  printBatch(feed, seen);
  if (feed.length === 0) {
    console.log("  No events or incidents found.");
  }
  console.log(pc.dim("  Follow mode is active. Press Ctrl+C to stop."));

  let stop = false;
  process.once("SIGINT", () => {
    stop = true;
  });
  process.once("SIGTERM", () => {
    stop = true;
  });

  while (!stop) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const nextSnapshot = await loadOpsSnapshot(appRoot);
    const nextFeed = filterByLimit(mergeFeedItems(nextSnapshot), limit);
    const before = seen.size;
    printBatch(nextFeed, seen);
    if (seen.size === before) {
      continue;
    }
  }
}

export function getOpsStoreDir(appRoot: string): string {
  return join(appRoot, OPS_STORE_DIRNAME);
}

export function hasOpsStore(appRoot: string): boolean {
  return hasAnyOpsFiles(getOpsStoreDir(appRoot));
}

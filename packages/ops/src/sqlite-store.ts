import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

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

interface SqliteOpsStoreOptions {
  path: string;
  retention?: OpsRetentionConfig;
}

interface SerializedRow {
  id: string;
  timestamp: string;
  payload: string;
}

type SyncSqliteStatement<Row> = {
  all(...params: unknown[]): Row[];
  get(...params: unknown[]): Row | undefined;
  run(...params: unknown[]): unknown;
};

type SyncSqliteDatabase = {
  exec(sql: string): void;
  prepare<Row>(sql: string): SyncSqliteStatement<Row>;
  close(): void;
};

const runtimeRequire = createRequire(import.meta.url);

function openSqliteDatabase(path: string): SyncSqliteDatabase {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
    const bunSqlite = runtimeRequire("bun:sqlite") as {
      Database: new (path: string) => {
        exec(sql: string): void;
        query<Row>(sql: string): {
          all(...params: unknown[]): Row[];
          get(...params: unknown[]): Row | undefined;
          run(...params: unknown[]): unknown;
        };
        close(): void;
      };
    };
    const db = new bunSqlite.Database(path);
    return {
      exec(sql: string) {
        db.exec(sql);
      },
      prepare<Row>(sql: string) {
        const statement = db.query<Row>(sql);
        return {
          all(...params: unknown[]) {
            return statement.all(...params);
          },
          get(...params: unknown[]) {
            return statement.get(...params);
          },
          run(...params: unknown[]) {
            return statement.run(...params);
          },
        };
      },
      close() {
        db.close();
      },
    };
  }

  const betterSqlite = runtimeRequire("better-sqlite3") as {
    default?: new (path: string) => {
      exec(sql: string): void;
      prepare<Row>(sql: string): SyncSqliteStatement<Row>;
      close(): void;
    };
  };
  const BetterSqliteDatabase = betterSqlite.default ?? (betterSqlite as unknown as new (path: string) => SyncSqliteDatabase);
  return new BetterSqliteDatabase(path);
}

function serializePayload(value: unknown): string {
  return JSON.stringify(value);
}

function parsePayload<T>(value: string): T {
  return JSON.parse(value) as T;
}

export class SqliteOpsStore implements OpsStore {
  private readonly db: SyncSqliteDatabase;
  private readonly retention: Required<OpsRetentionConfig>;

  constructor(options: SqliteOpsStoreOptions) {
    mkdirSync(dirname(options.path), { recursive: true });
    this.db = openSqliteDatabase(options.path);
    this.retention = coerceRetentionConfig(options.retention);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS ops_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ops_incidents (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ops_incidents_fingerprint ON ops_incidents (fingerprint);
      CREATE TABLE IF NOT EXISTS ops_snapshots (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        health TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ops_events_timestamp ON ops_events (timestamp);
      CREATE INDEX IF NOT EXISTS idx_ops_incidents_timestamp ON ops_incidents (timestamp);
      CREATE INDEX IF NOT EXISTS idx_ops_snapshots_timestamp ON ops_snapshots (timestamp);
    `);
  }

  private readEvents(): OpsEventRecord[] {
    const rows = this.db
      .prepare<SerializedRow>(
        "SELECT id, timestamp, payload FROM ops_events ORDER BY timestamp ASC, id ASC",
      )
      .all();
    return rows.map((row) => parsePayload<OpsEventRecord>(row.payload));
  }

  private readIncidents(): OpsIncidentRecord[] {
    const rows = this.db
      .prepare<SerializedRow>(
        "SELECT id, timestamp, payload FROM ops_incidents ORDER BY timestamp ASC, id ASC",
      )
      .all();
    return rows.map((row) => parsePayload<OpsIncidentRecord>(row.payload));
  }

  private readSnapshots(): OpsSnapshotRecord[] {
    const rows = this.db
      .prepare<SerializedRow>(
        "SELECT id, timestamp, payload FROM ops_snapshots ORDER BY timestamp ASC, id ASC",
      )
      .all();
    return rows.map((row) => parsePayload<OpsSnapshotRecord>(row.payload));
  }

  addEvent(record: OpsEventRecord): OpsEventRecord {
    const normalized = cloneValue({
      ...record,
      timestamp: normalizeIsoTimestamp(record.timestamp),
    });

    this.db
      .prepare(`
        INSERT OR REPLACE INTO ops_events (id, timestamp, kind, payload)
        VALUES (?, ?, ?, ?)
      `)
      .run(
        normalized.id,
        normalized.timestamp,
        normalized.kind,
        serializePayload(normalized),
      );

    return cloneValue(normalized);
  }

  getEvent(id: string): OpsEventRecord | undefined {
    this.compact();
    const row = this.db
      .prepare<SerializedRow>(
        "SELECT id, timestamp, payload FROM ops_events WHERE id = ?",
      )
      .get(id);
    return row ? parsePayload<OpsEventRecord>(row.payload) : undefined;
  }

  listEvents(filter?: OpsEventFilter): OpsEventRecord[] {
    this.compact();
    return filterOpsEvents(
      this.readEvents(),
      filter?.sort ? filter : { ...(filter ?? {}), sort: "asc" },
    );
  }

  addIncident(record: OpsIncidentRecord): OpsIncidentRecord {
    const normalized = cloneValue({
      ...record,
      timestamp: normalizeIsoTimestamp(record.timestamp),
      firstSeenAt: normalizeIsoTimestamp(record.firstSeenAt ?? record.timestamp),
      lastSeenAt: normalizeIsoTimestamp(record.lastSeenAt ?? record.timestamp),
      observations: record.observations ?? 1,
      ...(record.resolvedAt ? { resolvedAt: normalizeIsoTimestamp(record.resolvedAt) } : {}),
    });

    this.db
      .prepare(`
        INSERT OR REPLACE INTO ops_incidents (id, fingerprint, timestamp, kind, payload)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        normalized.id,
        normalized.fingerprint,
        normalized.timestamp,
        normalized.kind,
        serializePayload(normalized),
      );

    return cloneValue(normalized);
  }

  getIncident(id: string): OpsIncidentRecord | undefined {
    this.compact();
    const row = this.db
      .prepare<SerializedRow>(
        "SELECT id, timestamp, payload FROM ops_incidents WHERE id = ?",
      )
      .get(id);
    return row ? parsePayload<OpsIncidentRecord>(row.payload) : undefined;
  }

  getIncidentByFingerprint(fingerprint: string): OpsIncidentRecord | undefined {
    this.compact();
    const row = this.db
      .prepare<SerializedRow>(
        "SELECT id, timestamp, payload FROM ops_incidents WHERE fingerprint = ? ORDER BY timestamp DESC LIMIT 1",
      )
      .get(fingerprint);
    return row ? parsePayload<OpsIncidentRecord>(row.payload) : undefined;
  }

  listIncidents(filter?: OpsIncidentFilter): OpsIncidentRecord[] {
    this.compact();
    return filterOpsIncidents(
      this.readIncidents(),
      filter?.sort ? filter : { ...(filter ?? {}), sort: "asc" },
    );
  }

  addSnapshot(record: OpsSnapshotRecord): OpsSnapshotRecord {
    const normalized = cloneValue({
      ...record,
      timestamp: normalizeIsoTimestamp(record.timestamp),
    });

    this.db
      .prepare(`
        INSERT OR REPLACE INTO ops_snapshots (id, timestamp, health, payload)
        VALUES (?, ?, ?, ?)
      `)
      .run(
        normalized.id,
        normalized.timestamp,
        normalized.health,
        serializePayload(normalized),
      );

    return cloneValue(normalized);
  }

  listSnapshots(filter?: OpsSnapshotFilter): OpsSnapshotRecord[] {
    this.compact();
    return filterOpsSnapshots(
      this.readSnapshots(),
      filter?.sort ? filter : { ...(filter ?? {}), sort: "asc" },
    );
  }

  compact(options: OpsCompactionOptions = {}): OpsCompactionResult {
    const now = options.now ?? new Date().toISOString();

    const events = this.readEvents();
    const incidents = this.readIncidents();
    const snapshots = this.readSnapshots();

    const prunedEvents = pruneByMaxAge(events, this.retention.events.maxAgeMs, now);
    const prunedIncidents = pruneByMaxAge(incidents, this.retention.incidents.maxAgeMs, now);
    const prunedSnapshots = pruneByMaxAge(snapshots, this.retention.snapshots.maxAgeMs, now);

    const eventIds = prunedEvents.removed.map((record) => record.id);
    const incidentIds = prunedIncidents.removed.map((record) => record.id);
    const snapshotIds = prunedSnapshots.removed.map((record) => record.id);

    if (eventIds.length > 0) {
      const placeholders = eventIds.map(() => "?").join(", ");
      this.db.prepare(`DELETE FROM ops_events WHERE id IN (${placeholders})`).run(...eventIds);
    }
    if (incidentIds.length > 0) {
      const placeholders = incidentIds.map(() => "?").join(", ");
      this.db.prepare(`DELETE FROM ops_incidents WHERE id IN (${placeholders})`).run(...incidentIds);
    }
    if (snapshotIds.length > 0) {
      const placeholders = snapshotIds.map(() => "?").join(", ");
      this.db.prepare(`DELETE FROM ops_snapshots WHERE id IN (${placeholders})`).run(...snapshotIds);
    }

    return {
      eventsRemoved: eventIds.length,
      incidentsRemoved: incidentIds.length,
      snapshotsRemoved: snapshotIds.length,
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

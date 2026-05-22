import type { MemoryBackend, MemoryEntry, MemoryScope } from "./types.js";
import { bm25Scores, bm25QueryTerms } from "./bm25.js";

/**
 * Minimal SQLite connection interface.
 * Compatible with both `better-sqlite3` and `bun:sqlite` Database.
 */
export interface SqliteConnection {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * Persistent memory backend using SQLite.
 *
 * Requires `better-sqlite3` as a peer dependency (or use `bun:sqlite` under Bun).
 * Compatible with both better-sqlite3 and bun:sqlite.
 *
 * Usage:
 * ```typescript
 * import { SqliteMemoryBackend } from "@zauso-ai/capstan-ai";
 * import Database from "better-sqlite3";
 *
 * const db = new Database("./data/memory.db");
 * const memory = new SqliteMemoryBackend(db);
 * ```
 */
export class SqliteMemoryBackend implements MemoryBackend {
  private _db: SqliteConnection;
  private _tableName: string;

  constructor(db: SqliteConnection, opts?: { tableName?: string }) {
    const name = opts?.tableName ?? "capstan_memories";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid table name: "${name}". Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`);
    }
    this._db = db;
    this._tableName = name;
    this._ensureTable();
  }

  private _ensureTable(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS ${this._tableName} (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        embedding TEXT,
        created_at TEXT NOT NULL,
        metadata TEXT
      )
    `);
    this._db.exec(
      `CREATE INDEX IF NOT EXISTS idx_${this._tableName}_scope ON ${this._tableName}(scope_type, scope_id)`,
    );
  }

  async store(
    entry: Omit<MemoryEntry, "id" | "createdAt">,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const embeddingJson =
      entry.embedding != null ? JSON.stringify(entry.embedding) : null;
    const metadataJson =
      entry.metadata != null ? JSON.stringify(entry.metadata) : null;

    this._db
      .prepare(
        `INSERT INTO ${this._tableName} (id, content, scope_type, scope_id, embedding, created_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.content,
        entry.scope.type,
        entry.scope.id,
        embeddingJson,
        createdAt,
        metadataJson,
      );

    return id;
  }

  async query(
    scope: MemoryScope,
    text: string,
    k: number,
  ): Promise<MemoryEntry[]> {
    const rows = this._db
      .prepare(
        `SELECT id, content, scope_type, scope_id, embedding, created_at, metadata FROM ${this._tableName} WHERE scope_type = ? AND scope_id = ?`,
      )
      .all(scope.type, scope.id) as RawRow[];

    if (rows.length === 0) return [];

    const entries = rows.map(rowToEntry);

    // Empty query = bulk fetch the scope (used by the reconciler to read all).
    if (text === "") return entries.slice(0, k);

    // BM25 keyword relevance over the in-scope memories (the candidate set
    // supplies the corpus statistics — IDF, average length). A non-empty query
    // with no usable terms (e.g. punctuation only) scores all zeros, so the
    // `> 0` filter yields no results — matching BuiltinMemoryBackend.
    const scores = bm25Scores(bm25QueryTerms(text), entries.map((e) => e.content));
    const scored = entries.map((entry, i) => ({ entry, score: scores[i]! }));
    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter((s) => s.score > 0)
      .slice(0, k)
      .map((s) => s.entry);
  }

  async remove(id: string): Promise<boolean> {
    const result = this._db
      .prepare(`DELETE FROM ${this._tableName} WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  async clear(scope: MemoryScope): Promise<void> {
    this._db
      .prepare(
        `DELETE FROM ${this._tableName} WHERE scope_type = ? AND scope_id = ?`,
      )
      .run(scope.type, scope.id);
  }
}

/** Raw row shape returned from SQLite queries. */
interface RawRow {
  id: string;
  content: string;
  scope_type: string;
  scope_id: string;
  embedding: string | null;
  created_at: string;
  metadata: string | null;
}

/** Convert a raw SQLite row into a MemoryEntry. */
function rowToEntry(row: RawRow): MemoryEntry {
  const entry: MemoryEntry = {
    id: row.id,
    content: row.content,
    scope: { type: row.scope_type, id: row.scope_id },
    createdAt: row.created_at,
  };
  if (row.embedding != null) {
    try { entry.embedding = JSON.parse(row.embedding) as number[]; } catch { /* corrupted — skip */ }
  }
  if (row.metadata != null) {
    try { entry.metadata = JSON.parse(row.metadata) as Record<string, unknown>; } catch { /* corrupted — skip */ }
  }
  return entry;
}

/**
 * Create a SQLite-backed memory store.
 *
 * @param pathOrDb - Path to SQLite file, or an existing database connection
 */
export async function createSqliteMemoryStore(
  pathOrDb: string | SqliteConnection,
  opts?: { tableName?: string },
): Promise<SqliteMemoryBackend> {
  if (typeof pathOrDb === "string") {
    try {
      const mod = await import("better-sqlite3");
      const Database = mod.default;
      const db = new Database(pathOrDb);
      db.pragma("journal_mode = WAL");
      return new SqliteMemoryBackend(db, opts);
    } catch {
      throw new Error(
        "better-sqlite3 is required for SqliteMemoryBackend. Install it: npm install better-sqlite3",
      );
    }
  }
  return new SqliteMemoryBackend(pathOrDb, opts);
}

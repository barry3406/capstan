import type { ModelDefinition, FieldDefinition, ScalarType, IndexDefinition, DbProvider } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

function pluralise(name: string): string {
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  if (lower.endsWith("y") && !/[aeiou]y$/i.test(lower)) {
    return lower.slice(0, -1) + "ies";
  }
  if (lower.endsWith("s") || lower.endsWith("x") || lower.endsWith("sh") || lower.endsWith("ch")) {
    return lower + "es";
  }
  return lower + "s";
}

/**
 * Map a Capstan scalar type to a SQLite column type.
 */
function sqliteType(type: ScalarType): string {
  switch (type) {
    case "string":
    case "text":
    case "date":
    case "datetime":
    case "json":
    case "vector":
      return "TEXT";
    case "integer":
    case "boolean":
      return "INTEGER";
    case "number":
      return "REAL";
  }
}

/**
 * Generate the SQL default expression for a field.
 */
function sqlDefault(def: FieldDefinition): string | null {
  if (def.default === undefined) return null;
  if (def.default === "now") return "DEFAULT (datetime('now'))";
  if (typeof def.default === "string") return `DEFAULT '${def.default.replace(/'/g, "''")}'`;
  if (typeof def.default === "boolean") return `DEFAULT ${def.default ? 1 : 0}`;
  if (typeof def.default === "number") return `DEFAULT ${def.default}`;
  return null;
}

/**
 * Build a column definition clause for a CREATE TABLE statement.
 */
function columnDef(fieldName: string, def: FieldDefinition): string {
  const colName = toSnakeCase(fieldName);
  const parts: string[] = [colName, sqliteType(def.type)];

  if (def.autoId) {
    parts.push("PRIMARY KEY");
  }
  if (def.required && !def.autoId) {
    parts.push("NOT NULL");
  }
  if (def.unique && !def.autoId) {
    parts.push("UNIQUE");
  }
  const defaultExpr = sqlDefault(def);
  if (defaultExpr) {
    parts.push(defaultExpr);
  }
  if (def.references) {
    const refTable = pluralise(def.references);
    parts.push(`REFERENCES ${refTable}(id)`);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Diff engine
// ---------------------------------------------------------------------------

interface TableInfo {
  tableName: string;
  model: ModelDefinition;
}

function tableInfo(model: ModelDefinition): TableInfo {
  return { tableName: pluralise(model.name), model };
}

function createTableSQL(model: ModelDefinition): string {
  const tableName = pluralise(model.name);
  const cols = Object.entries(model.fields).map(([name, def]) => `  ${columnDef(name, def)}`);
  return `CREATE TABLE ${tableName} (\n${cols.join(",\n")}\n)`;
}

function dropTableSQL(tableName: string): string {
  return `DROP TABLE IF EXISTS ${tableName}`;
}

function addColumnSQL(tableName: string, fieldName: string, def: FieldDefinition): string {
  return `ALTER TABLE ${tableName} ADD COLUMN ${columnDef(fieldName, def)}`;
}

function createIndexSQL(tableName: string, idx: IndexDefinition, idxNum: number): string {
  const idxName = `idx_${tableName}_${idx.fields.map(toSnakeCase).join("_")}`;
  const unique = idx.unique ? "UNIQUE " : "";
  const cols = idx.fields.map((f) => {
    const col = toSnakeCase(f);
    return idx.order ? `${col} ${idx.order.toUpperCase()}` : col;
  });
  return `CREATE ${unique}INDEX IF NOT EXISTS ${idxName} ON ${tableName} (${cols.join(", ")})`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate SQL migration statements that transform `fromModels` into
 * `toModels`. This is a forward-only diff: it creates new tables, adds new
 * columns, and creates indexes. It does NOT handle column drops, renames, or
 * type changes (SQLite has limited ALTER TABLE support).
 *
 * @param fromModels - The previous set of model definitions (can be empty for
 *   initial migration).
 * @param toModels - The target set of model definitions.
 * @returns An array of SQL statements to execute.
 */
export function generateMigration(
  fromModels: ModelDefinition[],
  toModels: ModelDefinition[],
): string[] {
  const statements: string[] = [];

  const fromMap = new Map<string, TableInfo>();
  for (const m of fromModels) {
    const info = tableInfo(m);
    fromMap.set(info.tableName, info);
  }

  const toMap = new Map<string, TableInfo>();
  for (const m of toModels) {
    const info = tableInfo(m);
    toMap.set(info.tableName, info);
  }

  // Tables that exist in `from` but not in `to` — drop them
  for (const [tableName] of fromMap) {
    if (!toMap.has(tableName)) {
      statements.push(dropTableSQL(tableName));
    }
  }

  // Tables in `to`
  for (const [tableName, toInfo] of toMap) {
    const fromInfo = fromMap.get(tableName);

    if (!fromInfo) {
      // New table — CREATE TABLE
      statements.push(createTableSQL(toInfo.model));

      // Create indexes for the new table
      for (let i = 0; i < toInfo.model.indexes.length; i++) {
        statements.push(createIndexSQL(tableName, toInfo.model.indexes[i]!, i));
      }
    } else {
      // Existing table — check for new columns
      const existingFields = new Set(Object.keys(fromInfo.model.fields));
      for (const [fieldName, def] of Object.entries(toInfo.model.fields)) {
        if (!existingFields.has(fieldName)) {
          statements.push(addColumnSQL(tableName, fieldName, def));
        }
      }

      // Check for new indexes
      const existingIndexKeys = new Set(
        fromInfo.model.indexes.map((idx) => idx.fields.join(",") + (idx.unique ? ":u" : "")),
      );
      for (let i = 0; i < toInfo.model.indexes.length; i++) {
        const idx = toInfo.model.indexes[i]!;
        const key = idx.fields.join(",") + (idx.unique ? ":u" : "");
        if (!existingIndexKeys.has(key)) {
          statements.push(createIndexSQL(tableName, idx, i));
        }
      }
    }
  }

  return statements;
}

/**
 * Execute an array of SQL migration statements against a database.
 *
 * The statements are run inside a transaction so that either all succeed or
 * none are applied.
 *
 * @param db - A Drizzle `BetterSQLite3Database` instance (or any object whose
 *   `$client` property is a better-sqlite3 `Database`).
 * @param sql - The SQL statements to execute.
 */
export function applyMigration(db: { $client: { exec: (sql: string) => void } }, sql: string[]): void {
  if (sql.length === 0) return;

  const client = db.$client;
  client.exec("BEGIN TRANSACTION");
  try {
    for (const stmt of sql) {
      client.exec(stmt);
    }
    client.exec("COMMIT");
  } catch (err) {
    client.exec("ROLLBACK");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Migration tracking
// ---------------------------------------------------------------------------

/**
 * SQL to create the `_capstan_migrations` tracking table, per provider.
 */
function createTrackingTableSQL(provider: DbProvider): string {
  switch (provider) {
    case "postgres":
      return `CREATE TABLE IF NOT EXISTS _capstan_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
)`;
    case "mysql":
      return `CREATE TABLE IF NOT EXISTS _capstan_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
    case "sqlite":
    case "libsql":
    default:
      return `CREATE TABLE IF NOT EXISTS _capstan_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;
  }
}

/** A database client that can execute and query SQL (SQLite via better-sqlite3). */
export interface MigrationDbClient {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    run: (...params: unknown[]) => unknown;
    get: (...params: unknown[]) => unknown;
  };
}

/**
 * Ensure the `_capstan_migrations` tracking table exists.
 */
export function ensureTrackingTable(client: MigrationDbClient, provider: DbProvider = "sqlite"): void {
  client.exec(createTrackingTableSQL(provider));
}

/**
 * Get the list of migration names that have already been applied.
 */
export function getAppliedMigrations(client: MigrationDbClient): string[] {
  const rows = client.prepare(
    "SELECT name FROM _capstan_migrations ORDER BY id ASC",
  ).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export interface MigrationStatus {
  applied: Array<{ name: string; appliedAt: string }>;
  pending: string[];
}

/**
 * Return which migrations have been applied and which are pending.
 *
 * @param client - The underlying database client (e.g. better-sqlite3 `Database`).
 * @param allMigrationNames - Every migration file name, sorted chronologically.
 * @param provider - The database provider (defaults to `"sqlite"`).
 */
export function getMigrationStatus(
  client: MigrationDbClient,
  allMigrationNames: string[],
  provider: DbProvider = "sqlite",
): MigrationStatus {
  ensureTrackingTable(client, provider);

  const rows = client.prepare(
    "SELECT name, applied_at FROM _capstan_migrations ORDER BY id ASC",
  ).all() as Array<{ name: string; applied_at: string }>;

  const appliedSet = new Set(rows.map((r) => r.name));

  return {
    applied: rows.map((r) => ({ name: r.name, appliedAt: r.applied_at })),
    pending: allMigrationNames.filter((n) => !appliedSet.has(n)),
  };
}

/**
 * Apply migration file SQL against a database, tracking each file in the
 * `_capstan_migrations` table. Only files not yet recorded are executed.
 *
 * @param client - The underlying database client.
 * @param migrations - Array of `{ name, sql }` objects (file name + raw SQL content).
 * @param provider - The database provider (defaults to `"sqlite"`).
 * @returns The list of migration names that were applied in this call.
 */
export function applyTrackedMigrations(
  client: MigrationDbClient,
  migrations: Array<{ name: string; sql: string }>,
  provider: DbProvider = "sqlite",
): string[] {
  ensureTrackingTable(client, provider);

  const applied = getAppliedMigrations(client);
  const appliedSet = new Set(applied);

  const pending = migrations.filter((m) => !appliedSet.has(m.name));
  if (pending.length === 0) return [];

  const executed: string[] = [];

  for (const migration of pending) {
    const statements = migration.sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));

    client.exec("BEGIN TRANSACTION");
    try {
      for (const stmt of statements) {
        client.exec(stmt);
      }
      client.prepare(
        "INSERT INTO _capstan_migrations (name) VALUES (?)",
      ).run(migration.name);
      client.exec("COMMIT");
      executed.push(migration.name);
    } catch (err) {
      client.exec("ROLLBACK");
      throw err;
    }
  }

  return executed;
}

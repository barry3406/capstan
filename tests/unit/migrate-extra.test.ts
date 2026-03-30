import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  generateMigration,
  applyMigration,
  getMigrationStatus,
  getAppliedMigrations,
  applyTrackedMigrations,
} from "@zauso-ai/capstan-db";
import type { MigrationDbClient, MigrationStatus } from "@zauso-ai/capstan-db";
import { defineModel, field } from "@zauso-ai/capstan-db";
import type { ModelDefinition } from "@zauso-ai/capstan-db";
import { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// In-memory SQLite lifecycle (bun:sqlite)
// ---------------------------------------------------------------------------

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
});

afterEach(() => {
  db.close();
});

/**
 * Wrap bun:sqlite Database to match the MigrationDbClient interface that
 * the Capstan migration system expects (shaped like better-sqlite3).
 */
function asMigrationClient(raw: Database): MigrationDbClient {
  return {
    exec: (sql: string) => { raw.exec(sql); },
    prepare: (sql: string) => {
      const stmt = raw.prepare(sql);
      return {
        all: (...params: unknown[]) => stmt.all(...params),
        run: (...params: unknown[]) => stmt.run(...params),
        get: (...params: unknown[]) => stmt.get(...params),
      };
    },
  };
}

/**
 * Wrap bun:sqlite for applyMigration which expects { $client: { exec } }.
 */
function asDrizzleDb(raw: Database) {
  return { $client: { exec: (sql: string) => { raw.exec(sql); } } };
}

// ---------------------------------------------------------------------------
// Helper: create model definitions
// ---------------------------------------------------------------------------

function makeModel(name: string, fields: Record<string, any>, indexes: any[] = []): ModelDefinition {
  return defineModel(name, {
    fields: {
      id: field.id(),
      ...fields,
    },
    ...(indexes.length > 0 ? { indexes } : {}),
  });
}

// ---------------------------------------------------------------------------
// generateMigration
// ---------------------------------------------------------------------------

describe("generateMigration", () => {
  it("creates SQL from model diff (empty to new)", () => {
    const model = makeModel("Post", {
      title: field.string({ required: true }),
      body: field.text(),
    });
    const sql = generateMigration([], [model]);
    expect(sql.length).toBeGreaterThan(0);
    expect(sql.some((s) => s.includes("CREATE TABLE"))).toBe(true);
  });

  it("CREATE TABLE SQL contains table name derived from model name", () => {
    const model = makeModel("Post", { title: field.string() });
    const sql = generateMigration([], [model]);
    const createStmt = sql.find((s) => s.includes("CREATE TABLE"));
    expect(createStmt).toBeDefined();
    expect(createStmt!).toContain("posts"); // pluralized
  });

  it("CREATE TABLE SQL includes column definitions", () => {
    const model = makeModel("User", {
      email: field.string({ required: true, unique: true }),
      age: field.integer(),
    });
    const sql = generateMigration([], [model]);
    const createStmt = sql.find((s) => s.includes("CREATE TABLE"));
    expect(createStmt).toBeDefined();
    expect(createStmt!).toContain("email");
    expect(createStmt!).toContain("NOT NULL");
    expect(createStmt!).toContain("UNIQUE");
    expect(createStmt!).toContain("age");
  });

  it("ALTER TABLE SQL is generated for new columns on existing model", () => {
    const v1 = makeModel("Post", { title: field.string() });
    const v2 = makeModel("Post", {
      title: field.string(),
      body: field.text(),
    });
    const sql = generateMigration([v1], [v2]);
    expect(sql.length).toBeGreaterThan(0);
    const alterStmt = sql.find((s) => s.includes("ALTER TABLE"));
    expect(alterStmt).toBeDefined();
    expect(alterStmt!).toContain("posts");
    expect(alterStmt!).toContain("body");
  });

  it("drops tables that no longer exist", () => {
    const v1 = makeModel("OldModel", { name: field.string() });
    const sql = generateMigration([v1], []);
    expect(sql.length).toBeGreaterThan(0);
    expect(sql.some((s) => s.includes("DROP TABLE"))).toBe(true);
  });

  it("returns empty array when models are identical", () => {
    const model = makeModel("Post", { title: field.string() });
    const sql = generateMigration([model], [model]);
    expect(sql).toEqual([]);
  });

  it("creates indexes for new tables", () => {
    const model = makeModel(
      "Post",
      { title: field.string(), createdAt: field.datetime() },
      [{ fields: ["title"], unique: false }],
    );
    const sql = generateMigration([], [model]);
    const indexStmt = sql.find((s) => s.includes("CREATE") && s.includes("INDEX"));
    expect(indexStmt).toBeDefined();
    expect(indexStmt!).toContain("title");
  });

  it("creates new indexes on existing tables", () => {
    const v1 = makeModel("Post", { title: field.string() });
    const v2 = makeModel(
      "Post",
      { title: field.string() },
      [{ fields: ["title"], unique: true }],
    );
    const sql = generateMigration([v1], [v2]);
    const indexStmt = sql.find((s) => s.includes("INDEX"));
    expect(indexStmt).toBeDefined();
    expect(indexStmt!).toContain("UNIQUE");
  });

  it("handles references (foreign keys)", () => {
    const model = makeModel("Comment", {
      postId: field.integer({ references: "Post" }),
    });
    const sql = generateMigration([], [model]);
    const createStmt = sql.find((s) => s.includes("CREATE TABLE"));
    expect(createStmt).toBeDefined();
    expect(createStmt!).toContain("REFERENCES");
    expect(createStmt!).toContain("posts"); // pluralized reference table
  });

  it("handles default values in column definitions", () => {
    const model = makeModel("Setting", {
      enabled: field.boolean({ default: true }),
      count: field.integer({ default: 0 }),
    });
    const sql = generateMigration([], [model]);
    const createStmt = sql.find((s) => s.includes("CREATE TABLE"));
    expect(createStmt).toBeDefined();
    expect(createStmt!).toContain("DEFAULT 1"); // true -> 1
    expect(createStmt!).toContain("DEFAULT 0");
  });

  it("handles multiple new tables in one migration", () => {
    const user = makeModel("User", { name: field.string() });
    const post = makeModel("Post", { title: field.string() });
    const sql = generateMigration([], [user, post]);
    const createStmts = sql.filter((s) => s.includes("CREATE TABLE"));
    expect(createStmts.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// applyMigration
// ---------------------------------------------------------------------------

describe("applyMigration", () => {
  it("executes SQL statements in a transaction", () => {
    const model = makeModel("Task", { title: field.string({ required: true }) });
    const sql = generateMigration([], [model]);
    applyMigration(asDrizzleDb(db), sql);

    // Verify table was created
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
      .all();
    expect(tables.length).toBe(1);
  });

  it("does nothing for empty SQL array", () => {
    applyMigration(asDrizzleDb(db), []);
    // Should not throw
  });

  it("rolls back on error", () => {
    const model = makeModel("Item", { name: field.string() });
    const sql = generateMigration([], [model]);
    applyMigration(asDrizzleDb(db), sql);

    // Now try to create the same table again — should fail
    expect(() => {
      applyMigration(asDrizzleDb(db), sql);
    }).toThrow();

    // Original table should still be intact
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items'")
      .all();
    expect(tables.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getMigrationStatus
// ---------------------------------------------------------------------------

describe("getMigrationStatus", () => {
  it("returns pending and applied lists", () => {
    const client = asMigrationClient(db);
    const status = getMigrationStatus(client, ["001_init.sql", "002_add_users.sql"]);
    expect(status.applied).toEqual([]);
    expect(status.pending).toEqual(["001_init.sql", "002_add_users.sql"]);
  });

  it("auto-creates the tracking table", () => {
    const client = asMigrationClient(db);
    getMigrationStatus(client, []);
    // Tracking table should now exist
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_capstan_migrations'",
      )
      .all();
    expect(tables.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// applyTrackedMigrations
// ---------------------------------------------------------------------------

describe("applyTrackedMigrations", () => {
  it("applies pending migrations and records them", () => {
    const client = asMigrationClient(db);
    const migrations = [
      { name: "001_init.sql", sql: "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)" },
    ];
    const executed = applyTrackedMigrations(client, migrations);
    expect(executed).toEqual(["001_init.sql"]);

    // Verify table exists
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items'")
      .all();
    expect(tables.length).toBe(1);

    // Verify tracking record
    const applied = getAppliedMigrations(client);
    expect(applied).toContain("001_init.sql");
  });

  it("skips already-applied migrations", () => {
    const client = asMigrationClient(db);
    const migrations = [
      { name: "001_init.sql", sql: "CREATE TABLE items (id INTEGER PRIMARY KEY)" },
    ];

    // Apply once
    applyTrackedMigrations(client, migrations);
    // Apply again — should skip
    const executed = applyTrackedMigrations(client, migrations);
    expect(executed).toEqual([]);
  });

  it("rolls back a failing migration and throws", () => {
    const client = asMigrationClient(db);
    const migrations = [
      { name: "001_init.sql", sql: "CREATE TABLE items (id INTEGER PRIMARY KEY)" },
      { name: "002_bad.sql", sql: "INVALID SQL STATEMENT" },
    ];

    expect(() => {
      applyTrackedMigrations(client, migrations);
    }).toThrow();

    // First migration should have been applied before the second failed
    const applied = getAppliedMigrations(client);
    expect(applied).toContain("001_init.sql");
    expect(applied).not.toContain("002_bad.sql");
  });

  it("returns empty array when no migrations are provided", () => {
    const client = asMigrationClient(db);
    const executed = applyTrackedMigrations(client, []);
    expect(executed).toEqual([]);
  });

  it("applies multiple migrations in order", () => {
    const client = asMigrationClient(db);
    const migrations = [
      { name: "001_users.sql", sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)" },
      { name: "002_posts.sql", sql: "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)" },
      { name: "003_comments.sql", sql: "CREATE TABLE comments (id INTEGER PRIMARY KEY, body TEXT)" },
    ];
    const executed = applyTrackedMigrations(client, migrations);
    expect(executed).toEqual(["001_users.sql", "002_posts.sql", "003_comments.sql"]);

    const status = getMigrationStatus(client, migrations.map((m) => m.name));
    expect(status.applied.length).toBe(3);
    expect(status.pending.length).toBe(0);
  });
});

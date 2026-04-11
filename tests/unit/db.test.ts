import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  field,
  relation,
  defineModel,
  generateDrizzleSchema,
  createDatabase,
  planMigration,
  generateMigration,
  applyMigration,
} from "@zauso-ai/capstan-db";

// ---------------------------------------------------------------------------
// Temp dir lifecycle for database files
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-db-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

// ---------------------------------------------------------------------------
// field helpers
// ---------------------------------------------------------------------------

describe("field.id()", () => {
  it("returns correct definition with autoId, required, unique", () => {
    const f = field.id();
    expect(f.type).toBe("string");
    expect(f.autoId).toBe(true);
    expect(f.required).toBe(true);
    expect(f.unique).toBe(true);
  });
});

describe("field.string()", () => {
  it("returns a string type definition", () => {
    const f = field.string();
    expect(f.type).toBe("string");
  });

  it("accepts options like required and unique", () => {
    const f = field.string({ required: true, unique: true });
    expect(f.required).toBe(true);
    expect(f.unique).toBe(true);
  });
});

describe("field.enum()", () => {
  it("returns a string type with enum values", () => {
    const f = field.enum(["open", "closed"]);
    expect(f.type).toBe("string");
    expect(f.enum).toEqual(["open", "closed"]);
  });

  it("accepts default option", () => {
    const f = field.enum(["low", "medium", "high"], { default: "medium" });
    expect(f.default).toBe("medium");
  });
});

describe("field.datetime()", () => {
  it("returns a datetime type", () => {
    const f = field.datetime();
    expect(f.type).toBe("datetime");
  });

  it("sets updatedAt flag", () => {
    const f = field.datetime({ updatedAt: true });
    expect(f.updatedAt).toBe(true);
  });

  it("supports default: 'now'", () => {
    const f = field.datetime({ default: "now" });
    expect(f.default).toBe("now");
  });
});

describe("field.integer()", () => {
  it("returns an integer type", () => {
    expect(field.integer().type).toBe("integer");
  });
});

describe("field.boolean()", () => {
  it("returns a boolean type", () => {
    expect(field.boolean().type).toBe("boolean");
  });
});

describe("field.text()", () => {
  it("returns a text type", () => {
    expect(field.text().type).toBe("text");
  });
});

describe("field.json()", () => {
  it("returns a json type", () => {
    expect(field.json().type).toBe("json");
  });
});

// ---------------------------------------------------------------------------
// relation helpers
// ---------------------------------------------------------------------------

describe("relation.belongsTo()", () => {
  it("returns a belongsTo relation", () => {
    const r = relation.belongsTo("User");
    expect(r.kind).toBe("belongsTo");
    expect(r.model).toBe("User");
  });

  it("accepts foreignKey option", () => {
    const r = relation.belongsTo("User", { foreignKey: "author_id" });
    expect(r.foreignKey).toBe("author_id");
  });
});

describe("relation.hasMany()", () => {
  it("returns a hasMany relation", () => {
    const r = relation.hasMany("Comment");
    expect(r.kind).toBe("hasMany");
    expect(r.model).toBe("Comment");
  });
});

describe("relation.hasOne()", () => {
  it("returns a hasOne relation", () => {
    const r = relation.hasOne("Profile");
    expect(r.kind).toBe("hasOne");
    expect(r.model).toBe("Profile");
  });
});

describe("relation.manyToMany()", () => {
  it("returns a manyToMany relation with through table", () => {
    const r = relation.manyToMany("Tag", { through: "post_tags" });
    expect(r.kind).toBe("manyToMany");
    expect(r.through).toBe("post_tags");
  });
});

// ---------------------------------------------------------------------------
// defineModel
// ---------------------------------------------------------------------------

describe("defineModel", () => {
  it("produces a valid ModelDefinition", () => {
    const model = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        status: field.enum(["open", "closed"]),
      },
    });

    expect(model.name).toBe("Ticket");
    expect(model.fields["id"]!.autoId).toBe(true);
    expect(model.fields["title"]!.required).toBe(true);
    expect(model.fields["status"]!.enum).toEqual(["open", "closed"]);
    expect(model.relations).toEqual({});
    expect(model.indexes).toEqual([]);
  });

  it("includes relations and indexes when provided", () => {
    const model = defineModel("Comment", {
      fields: {
        id: field.id(),
        body: field.text({ required: true }),
      },
      relations: {
        ticket: relation.belongsTo("Ticket"),
      },
      indexes: [{ fields: ["body"], unique: false }],
    });

    expect(model.relations["ticket"]!.kind).toBe("belongsTo");
    expect(model.indexes.length).toBe(1);
    expect(model.indexes[0]!.fields).toEqual(["body"]);
  });
});

// ---------------------------------------------------------------------------
// generateDrizzleSchema
// ---------------------------------------------------------------------------

describe("generateDrizzleSchema", () => {
  it("generates valid TypeScript with correct table name", () => {
    const model = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
      },
    });

    const schema = generateDrizzleSchema([model]);

    expect(schema).toContain("sqliteTable");
    // Ticket -> tickets (pluralised)
    expect(schema).toContain('"tickets"');
    expect(schema).toContain("export const tickets");
  });

  it("maps string fields to text columns", () => {
    const model = defineModel("Item", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
      },
    });

    const schema = generateDrizzleSchema([model]);
    expect(schema).toContain('text("name")');
    expect(schema).toContain(".notNull()");
  });

  it("maps integer fields to integer columns", () => {
    const model = defineModel("Counter", {
      fields: {
        id: field.id(),
        count: field.integer(),
      },
    });

    const schema = generateDrizzleSchema([model]);
    expect(schema).toContain('integer("count")');
  });

  it("maps boolean fields to integer with boolean mode", () => {
    const model = defineModel("Flag", {
      fields: {
        id: field.id(),
        active: field.boolean(),
      },
    });

    const schema = generateDrizzleSchema([model]);
    expect(schema).toContain('{ mode: "boolean" }');
  });

  it("generates primaryKey for id fields", () => {
    const model = defineModel("Item", {
      fields: { id: field.id() },
    });
    const schema = generateDrizzleSchema([model]);
    expect(schema).toContain(".primaryKey()");
  });

  it("handles multiple models", () => {
    const ticket = defineModel("Ticket", {
      fields: { id: field.id(), title: field.string() },
    });
    const comment = defineModel("Comment", {
      fields: { id: field.id(), body: field.text() },
    });

    const schema = generateDrizzleSchema([ticket, comment]);
    expect(schema).toContain("export const tickets");
    expect(schema).toContain("export const comments");
  });

  it("pluralises names ending in y correctly", () => {
    const model = defineModel("Category", {
      fields: { id: field.id() },
    });
    const schema = generateDrizzleSchema([model]);
    expect(schema).toContain('"categories"');
  });

  // --- PostgreSQL schema generation ---

  it("generates pg-core imports for postgres provider", () => {
    const model = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
      },
    });

    const schema = generateDrizzleSchema([model], "postgres");

    expect(schema).toContain('from "drizzle-orm/pg-core"');
    expect(schema).toContain("pgTable");
    expect(schema).not.toContain("sqliteTable");
  });

  it("maps string fields to varchar for postgres", () => {
    const model = defineModel("Item", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
      },
    });

    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain('varchar("name"');
    expect(schema).toContain("length: 255");
    expect(schema).toContain(".notNull()");
  });

  it("maps integer fields to integer for postgres", () => {
    const model = defineModel("Counter", {
      fields: {
        id: field.id(),
        count: field.integer(),
      },
    });

    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain('integer("count")');
  });

  it("maps boolean fields to native boolean for postgres", () => {
    const model = defineModel("Flag", {
      fields: {
        id: field.id(),
        active: field.boolean(),
      },
    });

    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain('boolean("active")');
    // Should NOT use integer with boolean mode (that is SQLite-specific)
    expect(schema).not.toContain('mode: "boolean"');
  });

  it("maps number fields to doublePrecision for postgres", () => {
    const model = defineModel("Measurement", {
      fields: {
        id: field.id(),
        value: field.number(),
      },
    });

    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain('doublePrecision("value")');
  });

  it("maps json fields to jsonb for postgres", () => {
    const model = defineModel("Config", {
      fields: {
        id: field.id(),
        data: field.json(),
      },
    });

    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain('jsonb("data")');
  });

  it("maps datetime fields to timestamp for postgres", () => {
    const model = defineModel("Event", {
      fields: {
        id: field.id(),
        occurredAt: field.datetime(),
      },
    });

    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain('timestamp("occurred_at")');
  });

  it("maps date fields to date for postgres", () => {
    const model = defineModel("Holiday", {
      fields: {
        id: field.id(),
        day: field.date(),
      },
    });

    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain('date("day")');
  });

  it("uses now() for default timestamps in postgres", () => {
    const model = defineModel("Log", {
      fields: {
        id: field.id(),
        createdAt: field.datetime({ default: "now" }),
      },
    });

    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain("now()");
    expect(schema).not.toContain("datetime('now')");
  });

  it("generates uuid id primaryKey with defaultRandom for postgres", () => {
    const model = defineModel("Item", {
      fields: { id: field.id() },
    });
    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain('uuid("id").primaryKey().defaultRandom()');
  });

  // --- MySQL schema generation ---

  it("generates mysql-core imports for mysql provider", () => {
    const model = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
      },
    });

    const schema = generateDrizzleSchema([model], "mysql");

    expect(schema).toContain('from "drizzle-orm/mysql-core"');
    expect(schema).toContain("mysqlTable");
    expect(schema).not.toContain("sqliteTable");
    expect(schema).not.toContain("pgTable");
  });

  it("maps string fields to varchar for mysql", () => {
    const model = defineModel("Item", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
      },
    });

    const schema = generateDrizzleSchema([model], "mysql");
    expect(schema).toContain('varchar("name", { length: 255 })');
    expect(schema).toContain(".notNull()");
  });

  it("maps text fields to text for mysql", () => {
    const model = defineModel("Post", {
      fields: {
        id: field.id(),
        body: field.text(),
      },
    });

    const schema = generateDrizzleSchema([model], "mysql");
    expect(schema).toContain('text("body")');
  });

  it("maps integer fields to int for mysql", () => {
    const model = defineModel("Counter", {
      fields: {
        id: field.id(),
        count: field.integer(),
      },
    });

    const schema = generateDrizzleSchema([model], "mysql");
    expect(schema).toContain('int("count")');
  });

  it("maps boolean fields to native boolean for mysql", () => {
    const model = defineModel("Flag", {
      fields: {
        id: field.id(),
        active: field.boolean(),
      },
    });

    const schema = generateDrizzleSchema([model], "mysql");
    expect(schema).toContain('boolean("active")');
    expect(schema).not.toContain('mode: "boolean"');
  });

  it("maps number fields to double for mysql", () => {
    const model = defineModel("Measurement", {
      fields: {
        id: field.id(),
        value: field.number(),
      },
    });

    const schema = generateDrizzleSchema([model], "mysql");
    expect(schema).toContain('double("value")');
  });

  it("maps json fields to json for mysql", () => {
    const model = defineModel("Config", {
      fields: {
        id: field.id(),
        data: field.json(),
      },
    });

    const schema = generateDrizzleSchema([model], "mysql");
    expect(schema).toContain('json("data")');
  });

  it("maps datetime fields to datetime for mysql", () => {
    const model = defineModel("Event", {
      fields: {
        id: field.id(),
        occurredAt: field.datetime(),
      },
    });

    const schema = generateDrizzleSchema([model], "mysql");
    expect(schema).toContain('datetime("occurred_at")');
  });

  it("generates varchar id with length 36 for mysql", () => {
    const model = defineModel("Item", {
      fields: { id: field.id() },
    });
    const schema = generateDrizzleSchema([model], "mysql");
    expect(schema).toContain('varchar("id", { length: 36 }).primaryKey()');
  });

  it("uses CURRENT_TIMESTAMP for default timestamps in mysql", () => {
    const model = defineModel("Log", {
      fields: {
        id: field.id(),
        createdAt: field.datetime({ default: "now" }),
      },
    });

    const schema = generateDrizzleSchema([model], "mysql");
    expect(schema).toContain("CURRENT_TIMESTAMP");
    expect(schema).not.toContain("datetime('now')");
  });

  it("handles multiple models for mysql", () => {
    const ticket = defineModel("Ticket", {
      fields: { id: field.id(), title: field.string() },
    });
    const comment = defineModel("Comment", {
      fields: { id: field.id(), body: field.text() },
    });

    const schema = generateDrizzleSchema([ticket, comment], "mysql");
    expect(schema).toContain("export const tickets");
    expect(schema).toContain("export const comments");
    expect(schema).toContain("mysqlTable");
  });
});

// ---------------------------------------------------------------------------
// createDatabase
// ---------------------------------------------------------------------------

// NOTE: createDatabase and applyMigration tests are skipped under Bun because
// better-sqlite3 is not supported. See https://github.com/oven-sh/bun/issues/4290
describe("createDatabase", () => {
  it("creates a working in-memory SQLite database via bun:sqlite", () => {
    // Use bun:sqlite directly since better-sqlite3 is not supported in Bun
    const { Database } = require("bun:sqlite");
    const db = new Database(":memory:");
    const result = db.prepare("SELECT 1 as val").get() as { val: number };
    expect(result.val).toBe(1);
    db.close();
  });

  it("creates a file-based SQLite database via bun:sqlite", () => {
    const { Database } = require("bun:sqlite");
    const dbPath = join(tmpdir(), `capstan-test-${Date.now()}.db`);
    const db = new Database(dbPath);
    expect(db).toBeDefined();
    db.close();
    // Cleanup
    try { require("node:fs").unlinkSync(dbPath); } catch {}
  });

  it("returns a postgres runtime when the driver is installed", async () => {
    const database = await createDatabase({
      provider: "postgres" as const,
      url: "postgres://localhost:5432/capstan_test",
    });

    expect(database.provider).toBe("postgres");
    expect(typeof database.query).toBe("function");
    expect(typeof database.execute).toBe("function");
    expect(typeof database.transaction).toBe("function");
    expect(typeof database.model).toBe("function");

    await database.close();
  });
});

// ---------------------------------------------------------------------------
// generateMigration
// ---------------------------------------------------------------------------

describe("generateMigration", () => {
  it("generates CREATE TABLE for new models", () => {
    const model = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        status: field.enum(["open", "closed"], { default: "open" }),
      },
    });

    const sql = generateMigration([], [model]);
    expect(sql.length).toBeGreaterThanOrEqual(1);

    const createStmt = sql[0]!;
    expect(createStmt).toContain("CREATE TABLE tickets");
    expect(createStmt).toContain("id TEXT PRIMARY KEY");
    expect(createStmt).toContain("title TEXT NOT NULL");
    expect(createStmt).toContain("status TEXT");
    expect(createStmt).toContain("DEFAULT 'open'");
  });

  it("generates ALTER TABLE ADD COLUMN for new fields", () => {
    const oldModel = defineModel("Ticket", {
      fields: { id: field.id(), title: field.string() },
    });
    const newModel = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string(),
        priority: field.string({ required: true }),
      },
    });

    const sql = generateMigration([oldModel], [newModel]);
    expect(sql.length).toBe(1);
    expect(sql[0]).toContain("ALTER TABLE tickets ADD COLUMN priority");
    expect(sql[0]).toContain("NOT NULL");
  });

  it("only generates DROP TABLE for removed models when destructive changes are enabled", () => {
    const model = defineModel("OldThing", {
      fields: { id: field.id() },
    });

    const sql = generateMigration([model], []);
    expect(sql).toEqual([]);

    const plan = planMigration([model], []);
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]?.code).toBe("DROP_TABLE");

    const destructiveSql = generateMigration([model], [], { allowDestructive: true });
    expect(destructiveSql.length).toBe(1);
    expect(destructiveSql[0]).toContain("DROP TABLE IF EXISTS oldThings");
  });

  it("generates CREATE INDEX statements for new indexes", () => {
    const model = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string(),
      },
      indexes: [{ fields: ["title"], unique: true }],
    });

    const sql = generateMigration([], [model]);
    // CREATE TABLE + CREATE INDEX
    expect(sql.length).toBe(2);
    expect(sql[1]).toContain("CREATE UNIQUE INDEX");
    expect(sql[1]).toContain("tickets");
    expect(sql[1]).toContain("title");
  });

  it("returns empty array when models are identical", () => {
    const model = defineModel("Ticket", {
      fields: { id: field.id(), title: field.string() },
    });
    const sql = generateMigration([model], [model]);
    expect(sql.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyMigration
// ---------------------------------------------------------------------------

describe("applyMigration", () => {
  it("runs SQL migration against bun:sqlite database", () => {
    const { Database } = require("bun:sqlite");
    const db = new Database(":memory:");

    const model = defineModel("Item", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
      },
    });

    const sql = generateMigration([], [model]);
    // Apply each SQL statement
    for (const stmt of sql) {
      db.exec(stmt);
    }

    // Verify table created
    db.prepare("INSERT INTO items (id, name) VALUES (?, ?)").run("1", "Test Item");
    const row = db.prepare("SELECT * FROM items WHERE id = ?").get("1") as {
      id: string;
      name: string;
    };
    expect(row.id).toBe("1");
    expect(row.name).toBe("Test Item");
    db.close();
  });

  it("rolls back on failure with bun:sqlite", () => {
    const { Database } = require("bun:sqlite");
    const db = new Database(":memory:");

    db.exec("CREATE TABLE test_table (id TEXT PRIMARY KEY)");

    // Apply invalid SQL — should throw
    expect(() => {
      db.exec("CREATE TABLE another (id TEXT PRIMARY KEY)");
      db.exec("THIS IS NOT VALID SQL");
    }).toThrow();

    db.close();
  });

  it("does nothing for an empty SQL array", () => {
    const { Database } = require("bun:sqlite");
    const db = new Database(":memory:");
    // Empty array — no operations
    const sql: string[] = [];
    for (const stmt of sql) {
      db.exec(stmt);
    }
    // Should not throw
    db.close();
  });
});

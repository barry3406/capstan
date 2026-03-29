import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  field,
  relation,
  defineModel,
  generateDrizzleSchema,
  createDatabase,
  generateMigration,
  applyMigration,
} from "@capstan/db";

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
});

// ---------------------------------------------------------------------------
// createDatabase
// ---------------------------------------------------------------------------

describe("createDatabase", () => {
  it("creates a working in-memory SQLite database", () => {
    const { db, close } = createDatabase({
      provider: "sqlite",
      url: ":memory:",
    });

    expect(db).toBeDefined();
    // Verify we can execute SQL
    const result = db.$client.prepare("SELECT 1 as val").get() as {
      val: number;
    };
    expect(result.val).toBe(1);

    close();
  });

  it("creates a file-based SQLite database", async () => {
    const dir = await makeTempDir();
    const dbPath = join(dir, "test.db");

    const { db, close } = createDatabase({
      provider: "sqlite",
      url: dbPath,
    });

    expect(db).toBeDefined();
    close();
  });

  it("throws for unsupported providers", () => {
    expect(() =>
      createDatabase({ provider: "postgres", url: "postgres://localhost" }),
    ).toThrow("Unsupported");
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

  it("generates DROP TABLE for removed models", () => {
    const model = defineModel("OldThing", {
      fields: { id: field.id() },
    });

    const sql = generateMigration([model], []);
    expect(sql.length).toBe(1);
    // The pluralise function lowercases the first letter: "OldThing" -> "oldThings"
    expect(sql[0]).toContain("DROP TABLE IF EXISTS oldThings");
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
  it("successfully runs SQL against a database", () => {
    const { db, close } = createDatabase({
      provider: "sqlite",
      url: ":memory:",
    });

    const model = defineModel("Item", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
      },
    });

    const sql = generateMigration([], [model]);
    applyMigration(db, sql);

    // Verify the table was created by inserting and querying
    db.$client
      .prepare("INSERT INTO items (id, name) VALUES (?, ?)")
      .run("1", "Test Item");
    const row = db.$client.prepare("SELECT * FROM items WHERE id = ?").get("1") as {
      id: string;
      name: string;
    };

    expect(row.id).toBe("1");
    expect(row.name).toBe("Test Item");

    close();
  });

  it("rolls back on failure", () => {
    const { db, close } = createDatabase({
      provider: "sqlite",
      url: ":memory:",
    });

    // Apply a valid migration first
    applyMigration(db, ["CREATE TABLE test_table (id TEXT PRIMARY KEY)"]);

    // Now try to apply invalid SQL -- should roll back
    expect(() =>
      applyMigration(db, [
        "CREATE TABLE another (id TEXT PRIMARY KEY)",
        "THIS IS NOT VALID SQL",
      ]),
    ).toThrow();

    // The "another" table should NOT exist because the transaction rolled back
    const tables = db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='another'",
      )
      .all();
    expect(tables.length).toBe(0);

    close();
  });

  it("does nothing for an empty SQL array", () => {
    const { db, close } = createDatabase({
      provider: "sqlite",
      url: ":memory:",
    });

    // Should not throw
    applyMigration(db, []);
    close();
  });
});

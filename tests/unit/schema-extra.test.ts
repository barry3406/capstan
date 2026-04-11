import { describe, it, expect } from "bun:test";
import { generateDrizzleSchema, field } from "@zauso-ai/capstan-db";
import type { ModelDefinition, DbProvider } from "@zauso-ai/capstan-db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal model with given fields for testing schema generation. */
function makeModel(
  name: string,
  fields: ModelDefinition["fields"],
): ModelDefinition {
  return { name, fields, relations: {}, indexes: [] };
}

// ---------------------------------------------------------------------------
// Column mapping per provider
// ---------------------------------------------------------------------------

describe("generateDrizzleSchema — column mapping", () => {
  // String field
  describe("string field", () => {
    const model = makeModel("Item", { title: field.string({ required: true }) });

    it("SQLite → text", () => {
      const schema = generateDrizzleSchema([model], "sqlite");
      expect(schema).toContain('text("title")');
      expect(schema).toContain(".notNull()");
    });

    it("Postgres → varchar", () => {
      const schema = generateDrizzleSchema([model], "postgres");
      expect(schema).toContain('varchar("title"');
      expect(schema).toContain("length: 255");
    });

    it("MySQL → varchar", () => {
      const schema = generateDrizzleSchema([model], "mysql");
      expect(schema).toContain('varchar("title"');
      expect(schema).toContain("length: 255");
    });
  });

  // Integer field
  describe("integer field", () => {
    const model = makeModel("Counter", { count: field.integer() });

    it("SQLite → integer", () => {
      const schema = generateDrizzleSchema([model], "sqlite");
      expect(schema).toContain('integer("count")');
    });

    it("Postgres → integer", () => {
      const schema = generateDrizzleSchema([model], "postgres");
      expect(schema).toContain('integer("count")');
    });

    it("MySQL → int", () => {
      const schema = generateDrizzleSchema([model], "mysql");
      expect(schema).toContain('int("count")');
    });
  });

  // Boolean field
  describe("boolean field", () => {
    const model = makeModel("Flag", { active: field.boolean() });

    it("SQLite → integer with mode boolean", () => {
      const schema = generateDrizzleSchema([model], "sqlite");
      expect(schema).toContain('integer("active"');
      expect(schema).toContain('mode: "boolean"');
    });

    it("Postgres → boolean", () => {
      const schema = generateDrizzleSchema([model], "postgres");
      expect(schema).toContain('boolean("active")');
    });

    it("MySQL → boolean", () => {
      const schema = generateDrizzleSchema([model], "mysql");
      expect(schema).toContain('boolean("active")');
    });
  });

  // JSON field
  describe("json field", () => {
    const model = makeModel("Config", { data: field.json() });

    it("SQLite → text with mode json", () => {
      const schema = generateDrizzleSchema([model], "sqlite");
      expect(schema).toContain('text("data"');
      expect(schema).toContain('mode: "json"');
    });

    it("Postgres → jsonb", () => {
      const schema = generateDrizzleSchema([model], "postgres");
      expect(schema).toContain('jsonb("data")');
    });

    it("MySQL → json", () => {
      const schema = generateDrizzleSchema([model], "mysql");
      expect(schema).toContain('json("data")');
    });
  });

  // Vector field
  describe("vector field", () => {
    const model = makeModel("Embedding", {
      vec: { type: "vector", dimensions: 768 },
    });

    it("SQLite → text with mode json", () => {
      const schema = generateDrizzleSchema([model], "sqlite");
      expect(schema).toContain('text("vec"');
      expect(schema).toContain('mode: "json"');
    });

    it("Postgres → vector with dimensions", () => {
      const schema = generateDrizzleSchema([model], "postgres");
      expect(schema).toContain('vector("vec"');
      expect(schema).toContain("dimensions: 768");
    });

    it("MySQL → json", () => {
      const schema = generateDrizzleSchema([model], "mysql");
      expect(schema).toContain('json("vec")');
    });
  });

  // Date/datetime fields
  describe("date field", () => {
    const model = makeModel("Event", { day: { type: "date" } });

    it("SQLite → text", () => {
      const schema = generateDrizzleSchema([model], "sqlite");
      expect(schema).toContain('text("day")');
    });

    it("Postgres → date", () => {
      const schema = generateDrizzleSchema([model], "postgres");
      expect(schema).toContain('date("day")');
    });
  });

  describe("datetime field", () => {
    const model = makeModel("Log", { createdAt: { type: "datetime" } });

    it("SQLite → text", () => {
      const schema = generateDrizzleSchema([model], "sqlite");
      // datetime maps to text in sqlite; column name is snake_case
      expect(schema).toContain('text("created_at")');
    });

    it("Postgres → timestamp", () => {
      const schema = generateDrizzleSchema([model], "postgres");
      expect(schema).toContain('timestamp("created_at")');
    });

    it("MySQL → datetime", () => {
      const schema = generateDrizzleSchema([model], "mysql");
      expect(schema).toContain('datetime("created_at")');
    });
  });

  // Enum-like field (string with enum constraint — schema uses string type)
  describe("enum field (string with enum option)", () => {
    const model = makeModel("Task", {
      status: field.string({ enum: ["open", "closed"] as const }),
    });

    it("generates a string/text column", () => {
      const schema = generateDrizzleSchema([model], "sqlite");
      // Enum is a validation constraint; column type is still text
      expect(schema).toContain('text("status")');
    });
  });

  // field.id() → primary key
  describe("field.id()", () => {
    const model = makeModel("User", { id: field.id() });

    it("SQLite → text primaryKey", () => {
      const schema = generateDrizzleSchema([model], "sqlite");
      expect(schema).toContain('text("id").primaryKey()');
    });

    it("Postgres → uuid primaryKey with defaultRandom", () => {
      const schema = generateDrizzleSchema([model], "postgres");
      expect(schema).toContain('uuid("id").primaryKey().defaultRandom()');
    });

    it("MySQL → varchar primaryKey", () => {
      const schema = generateDrizzleSchema([model], "mysql");
      expect(schema).toContain('varchar("id"');
      expect(schema).toContain(".primaryKey()");
    });
  });
});

// ---------------------------------------------------------------------------
// Schema structure tests
// ---------------------------------------------------------------------------

describe("generateDrizzleSchema — structure", () => {
  it("uses correct table builder per provider", () => {
    const model = makeModel("Post", { id: field.id() });

    expect(generateDrizzleSchema([model], "sqlite")).toContain("sqliteTable");
    expect(generateDrizzleSchema([model], "postgres")).toContain("pgTable");
    expect(generateDrizzleSchema([model], "mysql")).toContain("mysqlTable");
  });

  it("pluralises table name", () => {
    const schema = generateDrizzleSchema(
      [makeModel("Category", { id: field.id() })],
      "sqlite",
    );
    expect(schema).toContain('"categories"');
  });

  it("imports sql when default now() is used", () => {
    const model = makeModel("Audit", {
      id: field.id(),
      createdAt: { type: "datetime", default: "now" },
    });

    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain('import { sql } from "drizzle-orm"');
    expect(schema).toContain("now()");
  });

  it("handles unique constraint", () => {
    const model = makeModel("Account", {
      email: field.string({ unique: true }),
    });

    const schema = generateDrizzleSchema([model], "sqlite");
    expect(schema).toContain(".unique()");
  });

  it("handles default string value", () => {
    const model = makeModel("Setting", {
      theme: field.string({ default: "light" }),
    });

    const schema = generateDrizzleSchema([model], "sqlite");
    expect(schema).toContain('.default("light")');
  });

  it("handles default boolean value", () => {
    const model = makeModel("Feature", {
      enabled: field.boolean({ default: false }),
    });

    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain(".default(false)");
  });

  it("handles default number value", () => {
    const model = makeModel("Product", {
      price: field.number({ default: 0 }),
    });

    const schema = generateDrizzleSchema([model], "sqlite");
    expect(schema).toContain(".default(0)");
  });
});

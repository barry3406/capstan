import { describe, expect, it } from "bun:test";
import { defineModel, field, generateMigration, planMigration } from "@zauso-ai/capstan-db";

describe("migration provider matrix", () => {
  it("generates provider-specific CREATE TABLE SQL for mixed models", () => {
    const account = defineModel("Account", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
    });
    const invoice = defineModel("Invoice", {
      fields: {
        invoiceId: field.id(),
        accountSlug: field.string({ references: "Account.slug", required: true }),
        total: field.number({ default: 0 }),
        issuedOn: field.date({ required: true }),
        paid: field.boolean({ default: false }),
        metadata: field.json(),
      },
      indexes: [{ fields: ["accountSlug", "issuedOn"] }],
    });

    const sqliteCreate = generateMigration([], [account, invoice], "sqlite")[1] ?? "";
    const postgresCreate = generateMigration([], [account, invoice], "postgres")[1] ?? "";
    const mysqlCreate = generateMigration([], [account, invoice], "mysql")[1] ?? "";

    expect(sqliteCreate).toContain("invoice_id TEXT PRIMARY KEY DEFAULT");
    expect(sqliteCreate).toContain("account_slug TEXT NOT NULL REFERENCES accounts(slug)");
    expect(sqliteCreate).toContain("total REAL DEFAULT 0");
    expect(sqliteCreate).toContain("issued_on TEXT NOT NULL");
    expect(sqliteCreate).toContain("paid INTEGER DEFAULT 0");
    expect(sqliteCreate).toContain("metadata TEXT");

    expect(postgresCreate).toContain("invoice_id UUID PRIMARY KEY DEFAULT gen_random_uuid()");
    expect(postgresCreate).toContain("account_slug VARCHAR(255) NOT NULL REFERENCES accounts(slug)");
    expect(postgresCreate).toContain("total DOUBLE PRECISION DEFAULT 0");
    expect(postgresCreate).toContain("issued_on DATE NOT NULL");
    expect(postgresCreate).toContain("paid BOOLEAN DEFAULT false");
    expect(postgresCreate).toContain("metadata JSONB");

    expect(mysqlCreate).toContain("invoice_id VARCHAR(36) PRIMARY KEY DEFAULT (UUID())");
    expect(mysqlCreate).toContain("account_slug VARCHAR(255) NOT NULL REFERENCES accounts(slug)");
    expect(mysqlCreate).toContain("total DOUBLE DEFAULT 0");
    expect(mysqlCreate).toContain("issued_on DATE NOT NULL");
    expect(mysqlCreate).toContain("paid BOOLEAN DEFAULT false");
    expect(mysqlCreate).toContain("metadata JSON");
  });

  it("uses a model's actual primary key when a plain reference target is supplied", () => {
    const author = defineModel("Author", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
    });
    const post = defineModel("Post", {
      fields: {
        id: field.id(),
        authorSlug: field.string({ references: "Author", required: true }),
      },
    });

    const sql = generateMigration([], [author, post], "postgres").find((statement) =>
      statement.includes("CREATE TABLE posts"),
    ) ?? "";

    expect(sql).toContain("author_slug VARCHAR(255) NOT NULL REFERENCES authors(slug)");
  });

  it("supports explicit Model.field reference syntax in migration output", () => {
    const organization = defineModel("Organization", {
      fields: {
        id: field.id(),
        slug: field.string({ required: true, unique: true }),
      },
    });
    const repository = defineModel("Repository", {
      fields: {
        id: field.id(),
        organizationSlug: field.string({ references: "Organization.slug", required: true }),
      },
    });

    const sql = generateMigration([], [organization, repository], "sqlite").find((statement) =>
      statement.includes("CREATE TABLE repositories"),
    ) ?? "";

    expect(sql).toContain("organization_slug TEXT NOT NULL REFERENCES organizations(slug)");
  });

  it("aligns postgres reference column SQL with uuid primary keys", () => {
    const user = defineModel("User", {
      fields: {
        id: field.id(),
      },
    });
    const session = defineModel("Session", {
      fields: {
        id: field.id(),
        userId: field.string({ references: "User", required: true }),
      },
    });

    const sql = generateMigration([], [user, session], "postgres").find((statement) =>
      statement.includes("CREATE TABLE sessions"),
    ) ?? "";

    expect(sql).toContain("user_id UUID NOT NULL REFERENCES users(id)");
  });

  it("adds columns with provider-specific types during ALTER TABLE", () => {
    const before = defineModel("Metric", {
      fields: {
        id: field.id(),
        name: field.string(),
      },
    });
    const after = defineModel("Metric", {
      fields: {
        id: field.id(),
        name: field.string(),
        value: field.number({ default: 0 }),
        observedAt: field.datetime({ default: "now" }),
      },
    });

    const sqlite = generateMigration([before], [after], "sqlite");
    const postgres = generateMigration([before], [after], "postgres");
    const mysql = generateMigration([before], [after], "mysql");

    expect(sqlite).toContain("ALTER TABLE metrics ADD COLUMN value REAL DEFAULT 0");
    expect(sqlite).toContain("ALTER TABLE metrics ADD COLUMN observed_at TEXT DEFAULT (datetime('now'))");

    expect(postgres).toContain("ALTER TABLE metrics ADD COLUMN value DOUBLE PRECISION DEFAULT 0");
    expect(postgres).toContain("ALTER TABLE metrics ADD COLUMN observed_at TIMESTAMP DEFAULT now()");

    expect(mysql).toContain("ALTER TABLE metrics ADD COLUMN value DOUBLE DEFAULT 0");
    expect(mysql).toContain("ALTER TABLE metrics ADD COLUMN observed_at DATETIME DEFAULT CURRENT_TIMESTAMP");
  });

  it("creates and names indexes consistently across providers", () => {
    const post = defineModel("Post", {
      fields: {
        id: field.id(),
        title: field.string(),
        authorId: field.string(),
      },
      indexes: [
        { fields: ["title"], unique: true },
        { fields: ["authorId", "title"] },
      ],
    });

    const sqlite = generateMigration([], [post], "sqlite");
    const postgres = generateMigration([], [post], "postgres");
    const mysql = generateMigration([], [post], "mysql");

    expect(sqlite).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_title ON posts (title)");
    expect(sqlite).toContain("CREATE INDEX IF NOT EXISTS idx_posts_author_id_title ON posts (author_id, title)");

    expect(postgres).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_title ON posts (title)");
    expect(postgres).toContain("CREATE INDEX IF NOT EXISTS idx_posts_author_id_title ON posts (author_id, title)");

    expect(mysql).toContain("CREATE UNIQUE INDEX idx_posts_title ON posts (title)");
    expect(mysql).toContain("CREATE INDEX idx_posts_author_id_title ON posts (author_id, title)");
  });

  it("reports dropped tables, dropped columns, altered columns, and dropped indexes in one plan", () => {
    const before = defineModel("User", {
      fields: {
        id: field.id(),
        email: field.string(),
        age: field.integer(),
      },
      indexes: [{ fields: ["email"], unique: true }],
    });
    const after = defineModel("User", {
      fields: {
        id: field.id(),
        email: field.integer(),
      },
    });
    const removed = defineModel("Removed", {
      fields: { id: field.id() },
    });

    const plan = planMigration([before, removed], [after], "sqlite");
    expect(plan.safe).toBe(false);
    expect(plan.issues.map((issue) => issue.code).sort()).toEqual([
      "ALTER_COLUMN",
      "DROP_COLUMN",
      "DROP_INDEX",
      "DROP_TABLE",
    ]);
  });

  it("allows strict mode when a type change can be handled by an automatic rewrite", () => {
    const before = defineModel("Thing", {
      fields: {
        id: field.id(),
        status: field.string(),
      },
    });
    const after = defineModel("Thing", {
      fields: {
        id: field.id(),
        status: field.integer(),
      },
    });

    expect(() =>
      generateMigration([before], [after], { provider: "sqlite", strict: true }),
    ).not.toThrow();

    const sql = generateMigration([before], [after], "sqlite");
    expect(sql[0]).toContain("CREATE TABLE __capstan_tmp_things");
  });

  it("can emit destructive drop statements when the caller opts in", () => {
    const before = defineModel("Thing", {
      fields: {
        id: field.id(),
        title: field.string(),
      },
      indexes: [{ fields: ["title"] }],
    });
    const after = defineModel("Thing", {
      fields: {
        id: field.id(),
        title: field.string(),
      },
    });

    const sql = generateMigration([before], [after], {
      provider: "sqlite",
      allowDestructive: true,
    });

    expect(sql).toContain("DROP INDEX IF EXISTS idx_things_title");
  });

  it("marks removed columns as destructive even though SQL is not generated automatically", () => {
    const before = defineModel("Thing", {
      fields: {
        id: field.id(),
        title: field.string(),
        obsolete: field.string(),
      },
    });
    const after = defineModel("Thing", {
      fields: {
        id: field.id(),
        title: field.string(),
      },
    });

    const plan = planMigration([before], [after], "sqlite");
    expect(plan.issues).toEqual([
      expect.objectContaining({
        code: "DROP_COLUMN",
        tableName: "things",
        fieldName: "obsolete",
        destructive: true,
      }),
    ]);
  });

  it("distinguishes a changed index definition from an unchanged one", () => {
    const before = defineModel("Audit", {
      fields: {
        id: field.id(),
        tenantId: field.string(),
        createdAt: field.datetime(),
      },
      indexes: [{ fields: ["tenantId", "createdAt"] }],
    });
    const after = defineModel("Audit", {
      fields: {
        id: field.id(),
        tenantId: field.string(),
        createdAt: field.datetime(),
      },
      indexes: [{ fields: ["tenantId", "createdAt"], order: "desc" }],
    });

    const plan = planMigration([before], [after], "postgres");
    expect(plan.statements).toContain(
      "CREATE INDEX IF NOT EXISTS idx_audits_tenant_id_created_at ON audits (tenant_id DESC, created_at DESC)",
    );
    expect(plan.issues.some((issue) => issue.code === "DROP_INDEX")).toBe(true);
  });

  it("handles libsql with sqlite-compatible SQL", () => {
    const model = defineModel("Doc", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
      },
    });

    const sql = generateMigration([], [model], "libsql");
    expect(sql[0]).toContain("CREATE TABLE docs");
    expect(sql[0]).toContain("id TEXT PRIMARY KEY DEFAULT");
  });
});

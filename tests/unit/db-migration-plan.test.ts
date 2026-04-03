import { describe, expect, it } from "bun:test";
import { defineModel, field, generateMigration, planMigration } from "@zauso-ai/capstan-db";

describe("planMigration", () => {
  it("flags dropped tables as destructive while keeping default SQL generation safe", () => {
    const user = defineModel("User", {
      fields: { id: field.id(), email: field.string() },
      indexes: [{ fields: ["email"], unique: true }],
    });

    const plan = planMigration([user], []);
    expect(plan.safe).toBe(false);
    expect(plan.issues.map((issue) => issue.code)).toEqual(["DROP_TABLE"]);
    expect(generateMigration([user], [])).toEqual([]);
  });

  it("emits destructive SQL when explicitly allowed", () => {
    const user = defineModel("User", {
      fields: { id: field.id(), email: field.string() },
      indexes: [{ fields: ["email"], unique: true }],
    });

    const sql = generateMigration([user], [], { allowDestructive: true });
    expect(sql).toEqual(["DROP TABLE IF EXISTS users"]);
  });

  it("reports removed indexes and only drops them when destructive changes are enabled", () => {
    const before = defineModel("User", {
      fields: { id: field.id(), email: field.string() },
      indexes: [{ fields: ["email"], unique: true }],
    });
    const after = defineModel("User", {
      fields: { id: field.id(), email: field.string() },
    });

    const plan = planMigration([before], [after]);
    expect(plan.issues.some((issue) => issue.code === "DROP_INDEX")).toBe(true);

    const destructiveSql = generateMigration([before], [after], {
      allowDestructive: true,
      provider: "sqlite",
    });
    expect(destructiveSql).toContain("DROP INDEX IF EXISTS idx_users_email");
  });

  it("automatically rewrites changed columns and lets strict mode pass when the rewrite is safe", () => {
    const before = defineModel("Post", {
      fields: {
        id: field.id(),
        title: field.string(),
      },
    });
    const after = defineModel("Post", {
      fields: {
        id: field.id(),
        title: field.integer(),
      },
    });

    const plan = planMigration([before], [after]);
    expect(plan.issues).toEqual([]);
    expect(plan.statements[0]).toContain("CREATE TABLE __capstan_tmp_posts");

    expect(() => generateMigration([before], [after], { strict: true })).not.toThrow();
  });

  it("generates provider-specific DDL for auto ids, references, and dates", () => {
    const model = defineModel("Invoice", {
      fields: {
        id: field.id(),
        accountId: field.string({ references: "Account" }),
        invoiceDate: field.date({ required: true }),
      },
    });

    const postgresSql = generateMigration([], [model], "postgres")[0] ?? "";
    const mysqlSql = generateMigration([], [model], "mysql")[0] ?? "";

    expect(postgresSql).toContain("UUID PRIMARY KEY DEFAULT gen_random_uuid()");
    expect(postgresSql).toContain("REFERENCES accounts(id)");
    expect(postgresSql).toContain("invoice_date DATE NOT NULL");

    expect(mysqlSql).toContain("VARCHAR(36) PRIMARY KEY DEFAULT (UUID())");
    expect(mysqlSql).toContain("invoice_date DATE NOT NULL");
  });
});

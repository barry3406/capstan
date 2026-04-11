import { describe, expect, it } from "bun:test";
import { defineModel, field, generateMigration, planMigration } from "@zauso-ai/capstan-db";

describe("migration rewrites and renames", () => {
  it("detects safe column renames and emits direct rename SQL", () => {
    const before = defineModel("User", {
      fields: {
        id: field.id(),
        email: field.string({ required: true, unique: true }),
      },
    });
    const after = defineModel("User", {
      fields: {
        id: field.id(),
        primaryEmail: field.string({ required: true, unique: true }),
      },
    });

    const plan = planMigration([before], [after], "sqlite");
    expect(plan.safe).toBe(true);
    expect(plan.issues).toEqual([
      expect.objectContaining({
        code: "RENAME_COLUMN",
        fieldName: "email->primaryEmail",
      }),
    ]);
    expect(plan.statements).toEqual([
      "ALTER TABLE users RENAME COLUMN email TO primary_email",
    ]);
  });

  it("automatically rewrites changed columns when no destructive drops are involved", () => {
    const before = defineModel("Metric", {
      fields: {
        id: field.id(),
        value: field.string(),
      },
      indexes: [{ fields: ["value"] }],
    });
    const after = defineModel("Metric", {
      fields: {
        id: field.id(),
        value: field.integer(),
      },
      indexes: [{ fields: ["value"] }],
    });

    const plan = planMigration([before], [after], "sqlite");
    const sql = generateMigration([before], [after], "sqlite");

    expect(plan.safe).toBe(true);
    expect(plan.issues).toEqual([]);
    expect(sql[0]).toContain("CREATE TABLE __capstan_tmp_metrics");
    expect(sql[1]).toBe("INSERT INTO __capstan_tmp_metrics (id, value) SELECT id, value FROM metrics");
    expect(sql[2]).toBe("DROP TABLE IF EXISTS metrics");
    expect(sql[3]).toBe("ALTER TABLE __capstan_tmp_metrics RENAME TO metrics");
    expect(sql[4]).toBe("CREATE INDEX IF NOT EXISTS idx_metrics_value ON metrics (value)");
  });

  it("lets strict mode pass when a rewrite fully handles the schema change", () => {
    const before = defineModel("Post", {
      fields: {
        id: field.id(),
        score: field.integer(),
      },
    });
    const after = defineModel("Post", {
      fields: {
        id: field.id(),
        score: field.number(),
      },
    });

    expect(() =>
      generateMigration([before], [after], { provider: "postgres", strict: true }),
    ).not.toThrow();

    const sql = generateMigration([before], [after], "postgres");
    expect(sql[0]).toContain("CREATE TABLE __capstan_tmp_posts");
    expect(sql[1]).toBe("INSERT INTO __capstan_tmp_posts (id, score) SELECT id, score FROM posts");
    expect(sql[2]).toBe("DROP TABLE IF EXISTS posts");
    expect(sql[3]).toBe("ALTER TABLE __capstan_tmp_posts RENAME TO posts");
  });

  it("stays safe-by-default when a rewrite would have to drop columns", () => {
    const before = defineModel("Deployment", {
      fields: {
        id: field.id(),
        region: field.string(),
        revision: field.string(),
      },
      indexes: [{ fields: ["region", "revision"] }],
    });
    const after = defineModel("Deployment", {
      fields: {
        id: field.id(),
        revision: field.integer(),
      },
    });

    const plan = planMigration([before], [after], "postgres");
    const sql = generateMigration([before], [after], "postgres");

    expect(plan.safe).toBe(false);
    expect(plan.issues.map((issue) => issue.code).sort()).toEqual([
      "ALTER_COLUMN",
      "DROP_COLUMN",
      "DROP_INDEX",
    ]);
    expect(sql).toEqual([]);
  });

  it("can opt into destructive rewrites for combined drop-and-type-change migrations", () => {
    const before = defineModel("Audit", {
      fields: {
        id: field.id(),
        tenantId: field.string(),
        sequence: field.string(),
        obsolete: field.string(),
      },
      indexes: [{ fields: ["tenantId", "sequence"] }],
    });
    const after = defineModel("Audit", {
      fields: {
        id: field.id(),
        tenantId: field.string(),
        sequence: field.integer(),
      },
      indexes: [{ fields: ["tenantId", "sequence"], order: "desc" }],
    });

    const sql = generateMigration([before], [after], {
      provider: "mysql",
      allowDestructive: true,
    });

    expect(sql[0]).toContain("CREATE TABLE __capstan_tmp_audits");
    expect(sql[1]).toBe("INSERT INTO __capstan_tmp_audits (id, tenant_id, sequence) SELECT id, tenant_id, sequence FROM audits");
    expect(sql[2]).toBe("DROP TABLE IF EXISTS audits");
    expect(sql[3]).toBe("RENAME TABLE __capstan_tmp_audits TO audits");
    expect(sql[4]).toBe("CREATE INDEX idx_audits_tenant_id_sequence ON audits (tenant_id DESC, sequence DESC)");
  });

  it("still performs additive column changes without forcing a rewrite", () => {
    const before = defineModel("Artifact", {
      fields: {
        id: field.id(),
        checksum: field.string(),
      },
    });
    const after = defineModel("Artifact", {
      fields: {
        id: field.id(),
        checksum: field.string(),
        algorithm: field.string({ default: "sha256" }),
      },
    });

    const sql = generateMigration([before], [after], "sqlite");
    expect(sql).toEqual([
      "ALTER TABLE artifacts ADD COLUMN algorithm TEXT DEFAULT 'sha256'",
    ]);
  });
});

import { describe, expect, it } from "bun:test";
import { defineModel, field, generateMigration, planMigration } from "@zauso-ai/capstan-db";

describe("db migration SQL contracts", () => {
  it("emits stable rename SQL across sqlite, postgres, and mysql", () => {
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

    expect(generateMigration([before], [after], "sqlite")).toEqual([
      "ALTER TABLE users RENAME COLUMN email TO primary_email",
    ]);
    expect(generateMigration([before], [after], "postgres")).toEqual([
      "ALTER TABLE users RENAME COLUMN email TO primary_email",
    ]);
    expect(generateMigration([before], [after], "mysql")).toEqual([
      "ALTER TABLE users RENAME COLUMN email TO primary_email",
    ]);
  });

  it("keeps rename-only migrations safe in the planner", () => {
    const before = defineModel("Credential", {
      fields: {
        id: field.id(),
        token: field.string({ required: true }),
      },
    });
    const after = defineModel("Credential", {
      fields: {
        id: field.id(),
        apiToken: field.string({ required: true }),
      },
    });

    const plan = planMigration([before], [after], "postgres");
    expect(plan.safe).toBe(true);
    expect(plan.issues).toEqual([
      expect.objectContaining({
        code: "RENAME_COLUMN",
        fieldName: "token->apiToken",
      }),
    ]);
  });

  it("uses target storage types for references to uuid ids on postgres and varchar ids on mysql", () => {
    const user = defineModel("User", {
      fields: {
        id: field.id(),
        email: field.string({ required: true }),
      },
    });
    const session = defineModel("Session", {
      fields: {
        id: field.id(),
        userId: field.string({ references: "User", required: true }),
      },
    });

    const postgres = generateMigration([], [user, session], "postgres").find((statement) =>
      statement.includes("CREATE TABLE sessions"),
    ) ?? "";
    const mysql = generateMigration([], [user, session], "mysql").find((statement) =>
      statement.includes("CREATE TABLE sessions"),
    ) ?? "";
    const sqlite = generateMigration([], [user, session], "sqlite").find((statement) =>
      statement.includes("CREATE TABLE sessions"),
    ) ?? "";

    expect(postgres).toContain("user_id UUID NOT NULL REFERENCES users(id)");
    expect(mysql).toContain("user_id VARCHAR(36) NOT NULL REFERENCES users(id)");
    expect(sqlite).toContain("user_id TEXT NOT NULL REFERENCES users(id)");
  });

  it("keeps natural-key references using the referenced field's native storage type", () => {
    const organization = defineModel("Organization", {
      fields: {
        slug: field.string({ required: true, unique: true }),
      },
    });
    const repository = defineModel("Repository", {
      fields: {
        id: field.id(),
        organizationSlug: field.string({ references: "Organization", required: true }),
      },
    });

    const postgres = generateMigration([], [organization, repository], "postgres").find((statement) =>
      statement.includes("CREATE TABLE repositories"),
    ) ?? "";
    const mysql = generateMigration([], [organization, repository], "mysql").find((statement) =>
      statement.includes("CREATE TABLE repositories"),
    ) ?? "";

    expect(postgres).toContain("organization_slug VARCHAR(255) NOT NULL REFERENCES organizations(slug)");
    expect(mysql).toContain("organization_slug VARCHAR(255) NOT NULL REFERENCES organizations(slug)");
  });

  it("builds rewrite SQL that copies only retained columns and lets defaults populate new columns", () => {
    const before = defineModel("Deployment", {
      fields: {
        id: field.id(),
        status: field.string(),
        obsolete: field.string(),
      },
    });
    const after = defineModel("Deployment", {
      fields: {
        id: field.id(),
        status: field.integer(),
        region: field.string({ default: "global" }),
      },
    });

    const sqlite = generateMigration([before], [after], {
      provider: "sqlite",
      allowDestructive: true,
    });
    const postgres = generateMigration([before], [after], {
      provider: "postgres",
      allowDestructive: true,
    });

    expect(sqlite[1]).toBe(
      "INSERT INTO __capstan_tmp_deployments (id, status) SELECT id, status FROM deployments",
    );
    expect(postgres[1]).toBe(
      "INSERT INTO __capstan_tmp_deployments (id, status) SELECT id, status FROM deployments",
    );
    expect(sqlite.join("\n")).not.toContain("obsolete");
    expect(postgres.join("\n")).not.toContain("obsolete");
    expect(sqlite[1]).not.toContain("region");
    expect(postgres[1]).not.toContain("region");
  });

  it("recreates indexes after rewrites instead of mixing in incremental index diffs", () => {
    const before = defineModel("Event", {
      fields: {
        id: field.id(),
        tenantId: field.string(),
        sequence: field.string(),
      },
      indexes: [{ fields: ["tenantId", "sequence"] }],
    });
    const after = defineModel("Event", {
      fields: {
        id: field.id(),
        tenantId: field.string(),
        sequence: field.integer(),
      },
      indexes: [{ fields: ["tenantId", "sequence"], order: "desc" }],
    });

    const sqlite = generateMigration([before], [after], "sqlite");
    const postgres = generateMigration([before], [after], "postgres");
    const mysql = generateMigration([before], [after], "mysql");

    expect(sqlite.at(-1)).toBe(
      "CREATE INDEX IF NOT EXISTS idx_events_tenant_id_sequence ON events (tenant_id DESC, sequence DESC)",
    );
    expect(postgres.at(-1)).toBe(
      "CREATE INDEX IF NOT EXISTS idx_events_tenant_id_sequence ON events (tenant_id DESC, sequence DESC)",
    );
    expect(mysql.at(-1)).toBe(
      "CREATE INDEX idx_events_tenant_id_sequence ON events (tenant_id DESC, sequence DESC)",
    );
  });

  it("keeps destructive index drops gated behind allowDestructive when no rewrite occurs", () => {
    const before = defineModel("Article", {
      fields: {
        id: field.id(),
        slug: field.string(),
      },
      indexes: [{ fields: ["slug"], unique: true }],
    });
    const after = defineModel("Article", {
      fields: {
        id: field.id(),
        slug: field.string(),
      },
    });

    const safePlan = planMigration([before], [after], "mysql");
    const destructiveSql = generateMigration([before], [after], {
      provider: "mysql",
      allowDestructive: true,
    });

    expect(safePlan.issues).toEqual([
      expect.objectContaining({
        code: "DROP_INDEX",
      }),
    ]);
    expect(destructiveSql).toEqual([
      "DROP INDEX idx_articles_slug ON articles",
    ]);
  });

  it("keeps libsql rewrite SQL aligned with sqlite", () => {
    const before = defineModel("Metric", {
      fields: {
        id: field.id(),
        value: field.string(),
      },
    });
    const after = defineModel("Metric", {
      fields: {
        id: field.id(),
        value: field.integer(),
      },
    });

    expect(generateMigration([before], [after], "libsql")).toEqual(
      generateMigration([before], [after], "sqlite"),
    );
  });

  it("combines safe renames with additive columns without forcing a rewrite", () => {
    const before = defineModel("Build", {
      fields: {
        id: field.id(),
        sha: field.string({ required: true }),
      },
    });
    const after = defineModel("Build", {
      fields: {
        id: field.id(),
        commitSha: field.string({ required: true }),
        channel: field.string({ default: "stable" }),
      },
    });

    const sql = generateMigration([before], [after], "sqlite");
    expect(sql).toEqual([
      "ALTER TABLE builds RENAME COLUMN sha TO commit_sha",
      "ALTER TABLE builds ADD COLUMN channel TEXT DEFAULT 'stable'",
    ]);
  });

  it("produces provider-specific create SQL for mixed defaults, enums, booleans, and json", () => {
    const featureFlag = defineModel("FeatureFlag", {
      fields: {
        id: field.id(),
        key: field.string({ required: true, unique: true }),
        enabled: field.boolean({ default: true }),
        rollout: field.number({ default: 0.5 }),
        strategy: field.enum(["all", "percent"] as const, { default: "all" }),
        metadata: field.json({ default: { actors: [] } }),
      },
    });

    const sqlite = generateMigration([], [featureFlag], "sqlite")[0] ?? "";
    const postgres = generateMigration([], [featureFlag], "postgres")[0] ?? "";
    const mysql = generateMigration([], [featureFlag], "mysql")[0] ?? "";

    expect(sqlite).toContain("enabled INTEGER DEFAULT 1");
    expect(sqlite).toContain("rollout REAL DEFAULT 0.5");
    expect(sqlite).toContain("strategy TEXT DEFAULT 'all'");
    expect(sqlite).toContain(`metadata TEXT DEFAULT '{"actors":[]}'`);

    expect(postgres).toContain("enabled BOOLEAN DEFAULT true");
    expect(postgres).toContain("rollout DOUBLE PRECISION DEFAULT 0.5");
    expect(postgres).toContain("strategy VARCHAR(255) DEFAULT 'all'");
    expect(postgres).toContain(`metadata JSONB DEFAULT '{"actors":[]}'`);

    expect(mysql).toContain("enabled BOOLEAN DEFAULT true");
    expect(mysql).toContain("rollout DOUBLE DEFAULT 0.5");
    expect(mysql).toContain("strategy VARCHAR(255) DEFAULT 'all'");
    expect(mysql).toContain(`metadata JSON DEFAULT '{"actors":[]}'`);
  });

  it("surfaces blocking issues in strict mode when destructive drops remain unresolved", () => {
    const before = defineModel("Release", {
      fields: {
        id: field.id(),
        version: field.string(),
        obsolete: field.string(),
      },
    });
    const after = defineModel("Release", {
      fields: {
        id: field.id(),
        version: field.integer(),
      },
    });

    expect(() =>
      generateMigration([before], [after], { provider: "postgres", strict: true }),
    ).toThrow("Unsafe or unsupported migration changes detected");
  });

  it("keeps rewrite temp-table names stable across providers", () => {
    const before = defineModel("Task", {
      fields: {
        id: field.id(),
        priority: field.string(),
      },
    });
    const after = defineModel("Task", {
      fields: {
        id: field.id(),
        priority: field.integer(),
      },
    });

    const sqlite = generateMigration([before], [after], "sqlite").join("\n");
    const postgres = generateMigration([before], [after], "postgres").join("\n");
    const mysql = generateMigration([before], [after], "mysql").join("\n");

    expect(sqlite).toContain("__capstan_tmp_tasks");
    expect(postgres).toContain("__capstan_tmp_tasks");
    expect(mysql).toContain("__capstan_tmp_tasks");
  });

  it("does not let safe renames trigger strict-mode failures", () => {
    const before = defineModel("Token", {
      fields: {
        id: field.id(),
        value: field.string({ required: true }),
      },
    });
    const after = defineModel("Token", {
      fields: {
        id: field.id(),
        secretValue: field.string({ required: true }),
      },
    });

    expect(() =>
      generateMigration([before], [after], { provider: "postgres", strict: true }),
    ).not.toThrow();
  });

  it("emits destructive table drops consistently when the caller opts in", () => {
    const obsolete = defineModel("Obsolete", {
      fields: {
        id: field.id(),
      },
    });

    expect(generateMigration([obsolete], [], { provider: "sqlite", allowDestructive: true })).toEqual([
      "DROP TABLE IF EXISTS obsoletes",
    ]);
    expect(generateMigration([obsolete], [], { provider: "postgres", allowDestructive: true })).toEqual([
      "DROP TABLE IF EXISTS obsoletes",
    ]);
    expect(generateMigration([obsolete], [], { provider: "mysql", allowDestructive: true })).toEqual([
      "DROP TABLE IF EXISTS obsoletes",
    ]);
  });

  it("rewrites multiple changed columns in a single table with one temp-table plan", () => {
    const before = defineModel("Snapshot", {
      fields: {
        id: field.id(),
        width: field.string(),
        height: field.string(),
      },
    });
    const after = defineModel("Snapshot", {
      fields: {
        id: field.id(),
        width: field.integer(),
        height: field.integer(),
      },
    });

    const sql = generateMigration([before], [after], "sqlite");
    expect(sql).toEqual([
      expect.stringContaining("CREATE TABLE __capstan_tmp_snapshots"),
      "INSERT INTO __capstan_tmp_snapshots (id, width, height) SELECT id, width, height FROM snapshots",
      "DROP TABLE IF EXISTS snapshots",
      "ALTER TABLE __capstan_tmp_snapshots RENAME TO snapshots",
    ]);
  });

  it("reports only destructive issues when an additive migration can still proceed", () => {
    const before = defineModel("Bundle", {
      fields: {
        id: field.id(),
        checksum: field.string(),
        obsolete: field.string(),
      },
    });
    const after = defineModel("Bundle", {
      fields: {
        id: field.id(),
        checksum: field.string(),
        algorithm: field.string({ default: "sha256" }),
      },
    });

    const plan = planMigration([before], [after], "sqlite");
    expect(plan.statements).toEqual([
      "ALTER TABLE bundles ADD COLUMN algorithm TEXT DEFAULT 'sha256'",
    ]);
    expect(plan.issues).toEqual([
      expect.objectContaining({
        code: "DROP_COLUMN",
        fieldName: "obsolete",
      }),
    ]);
  });

  it("keeps empty diffs empty", () => {
    const model = defineModel("Ping", {
      fields: {
        id: field.id(),
      },
    });

    expect(generateMigration([model], [model], "sqlite")).toEqual([]);
  });
});

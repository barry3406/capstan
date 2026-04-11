import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  applyMigration,
  applyTrackedMigrations,
  defineModel,
  field,
  generateMigration,
  getMigrationStatus,
  planMigration,
} from "@zauso-ai/capstan-db";

const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

function makeDatabase(): Database {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  databases.push(sqlite);
  return sqlite;
}

describe("db migration execution", () => {
  it("applies rename-column migrations while preserving existing row values", () => {
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

    const sqlite = makeDatabase();
    applyMigration({ $client: sqlite }, generateMigration([], [before], "sqlite"));
    sqlite.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run("u1", "ada@example.com");

    const sql = generateMigration([before], [after], "sqlite");
    applyMigration({ $client: sqlite }, sql);

    const row = sqlite.prepare("SELECT id, primary_email FROM users").get() as {
      id: string;
      primary_email: string;
    };
    expect(row).toEqual({ id: "u1", primary_email: "ada@example.com" });
  });

  it("applies automatic rewrite migrations for compatible type changes", () => {
    const before = defineModel("Metric", {
      fields: {
        id: field.id(),
        score: field.string(),
      },
    });
    const after = defineModel("Metric", {
      fields: {
        id: field.id(),
        score: field.integer(),
      },
    });

    const sqlite = makeDatabase();
    applyMigration({ $client: sqlite }, generateMigration([], [before], "sqlite"));
    sqlite.prepare("INSERT INTO metrics (id, score) VALUES (?, ?)").run("m1", 42);

    const sql = generateMigration([before], [after], "sqlite");
    applyMigration({ $client: sqlite }, sql);

    const row = sqlite.prepare("SELECT id, score FROM metrics").get() as {
      id: string;
      score: number;
    };
    expect(row.id).toBe("m1");
    expect(row.score).toBe(42);
  });

  it("keeps safe-by-default plans from dropping columns without an explicit opt-in", () => {
    const before = defineModel("Artifact", {
      fields: {
        id: field.id(),
        checksum: field.string(),
        obsolete: field.string(),
      },
    });
    const after = defineModel("Artifact", {
      fields: {
        id: field.id(),
        checksum: field.integer(),
      },
    });

    const plan = planMigration([before], [after], "sqlite");
    expect(plan.safe).toBe(false);
    expect(plan.issues.map((issue) => issue.code).sort()).toEqual([
      "ALTER_COLUMN",
      "DROP_COLUMN",
    ]);
    expect(generateMigration([before], [after], "sqlite")).toEqual([]);
  });

  it("can opt into destructive rewrites and preserve retained columns", () => {
    const before = defineModel("Artifact", {
      fields: {
        id: field.id(),
        checksum: field.string(),
        obsolete: field.string(),
      },
      indexes: [{ fields: ["checksum"] }],
    });
    const after = defineModel("Artifact", {
      fields: {
        id: field.id(),
        checksum: field.integer(),
      },
      indexes: [{ fields: ["checksum"] }],
    });

    const sqlite = makeDatabase();
    applyMigration({ $client: sqlite }, generateMigration([], [before], "sqlite"));
    sqlite.prepare("INSERT INTO artifacts (id, checksum, obsolete) VALUES (?, ?, ?)").run("a1", 7, "old");

    const sql = generateMigration([before], [after], {
      provider: "sqlite",
      allowDestructive: true,
    });
    applyMigration({ $client: sqlite }, sql);

    const row = sqlite.prepare("SELECT id, checksum FROM artifacts").get() as {
      id: string;
      checksum: number;
    };
    expect(row).toEqual({ id: "a1", checksum: 7 });

    const columns = sqlite.prepare("PRAGMA table_info(artifacts)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(["id", "checksum"]);
  });

  it("recreates indexes after a rewrite migration", () => {
    const before = defineModel("Audit", {
      fields: {
        id: field.id(),
        tenantId: field.string(),
        sequence: field.string(),
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

    const sqlite = makeDatabase();
    applyMigration({ $client: sqlite }, generateMigration([], [before], "sqlite"));

    const sql = generateMigration([before], [after], "sqlite");
    applyMigration({ $client: sqlite }, sql);

    const indexes = sqlite.prepare("PRAGMA index_list(audits)").all() as Array<{ name: string }>;
    expect(indexes.some((entry) => entry.name === "idx_audits_tenant_id_sequence")).toBe(true);
  });

  it("still applies additive changes even when destructive issues are present", () => {
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
        version: field.string(),
        channel: field.string({ default: "stable" }),
      },
    });

    const sqlite = makeDatabase();
    applyMigration({ $client: sqlite }, generateMigration([], [before], "sqlite"));
    sqlite.prepare("INSERT INTO releases (id, version, obsolete) VALUES (?, ?, ?)").run("r1", "1.0.0", "old");

    const sql = generateMigration([before], [after], "sqlite");
    applyMigration({ $client: sqlite }, sql);

    const row = sqlite.prepare("SELECT version, channel, obsolete FROM releases").get() as {
      version: string;
      channel: string;
      obsolete: string;
    };
    expect(row).toEqual({
      version: "1.0.0",
      channel: "stable",
      obsolete: "old",
    });
  });

  it("tracks rewrite migrations in the migration history table", () => {
    const before = defineModel("Thing", {
      fields: {
        id: field.id(),
        value: field.string(),
      },
    });
    const after = defineModel("Thing", {
      fields: {
        id: field.id(),
        value: field.integer(),
      },
    });

    const sqlite = makeDatabase();
    applyMigration({ $client: sqlite }, generateMigration([], [before], "sqlite"));

    const rewriteSql = generateMigration([before], [after], "sqlite").join(";\n");
    const executed = applyTrackedMigrations(
      sqlite,
      [{ name: "0002_rewrite_things", sql: rewriteSql }],
      "sqlite",
    );

    expect(executed).toEqual(["0002_rewrite_things"]);

    const status = getMigrationStatus(sqlite, ["0002_rewrite_things"], "sqlite");
    expect(status.applied).toHaveLength(1);
    expect(status.pending).toEqual([]);
  });

  it("preserves data across rewrites that also add new columns", () => {
    const before = defineModel("Deployment", {
      fields: {
        id: field.id(),
        status: field.string(),
      },
    });
    const after = defineModel("Deployment", {
      fields: {
        id: field.id(),
        status: field.integer(),
        region: field.string({ default: "global" }),
      },
    });

    const sqlite = makeDatabase();
    applyMigration({ $client: sqlite }, generateMigration([], [before], "sqlite"));
    sqlite.prepare("INSERT INTO deployments (id, status) VALUES (?, ?)").run("d1", 1);

    applyMigration({ $client: sqlite }, generateMigration([before], [after], "sqlite"));

    const row = sqlite.prepare("SELECT id, status, region FROM deployments").get() as {
      id: string;
      status: number;
      region: string;
    };
    expect(row).toEqual({ id: "d1", status: 1, region: "global" });
  });
});

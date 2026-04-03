import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createDatabaseRuntime,
  defineModel,
  field,
  generateMigration,
  relation,
} from "@zauso-ai/capstan-db";

const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

function createRuntime(models: Parameters<typeof generateMigration>[1]) {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  databases.push(sqlite);

  const adapter = {
    provider: "sqlite" as const,
    async query(sql: string, params?: unknown[]) {
      return sqlite.prepare(sql).all(...(params ?? [])) as Record<string, unknown>[];
    },
    async execute(sql: string, params?: unknown[]) {
      const statement = sqlite.prepare(sql);
      const normalized = sql.trim().toUpperCase();
      if (normalized.startsWith("SELECT") || normalized.includes(" RETURNING ")) {
        const rows = statement.all(...(params ?? [])) as Record<string, unknown>[];
        return { affectedRows: rows.length, rows };
      }
      const result = statement.run(...(params ?? []));
      return { affectedRows: Number(result.changes ?? 0) };
    },
    async transaction<T>(fn: (adapter: typeof adapter) => Promise<T>): Promise<T> {
      sqlite.exec("BEGIN");
      try {
        const result = await fn(adapter);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };

  const runtime = createDatabaseRuntime(sqlite, "sqlite", () => sqlite.close(), adapter, models);
  return { sqlite, runtime };
}

async function migrate(runtime: ReturnType<typeof createRuntime>["runtime"], models: Parameters<typeof generateMigration>[1]) {
  await runtime.applyMigration(generateMigration([], models, "sqlite"));
}

describe("db runtime error matrix", () => {
  it("refuses repository operations for models without a stable primary key", async () => {
    const audit = defineModel("Audit", {
      fields: {
        tenantId: field.string({ required: true, unique: true }),
        eventId: field.string({ required: true, unique: true }),
        payload: field.json(),
      },
    });

    const { runtime } = createRuntime([audit]);
    await migrate(runtime, [audit]);

    const audits = runtime.model(audit);
    await expect(audits.create({ tenantId: "a", eventId: "e1" })).rejects.toThrow(
      'Model "Audit" does not expose a stable primary key field.',
    );
    await expect(audits.findById("e1")).rejects.toThrow(
      'Model "Audit" does not expose a stable primary key field.',
    );
  });

  it("returns null and false when updates or deletes target missing rows", async () => {
    const task = defineModel("Task", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
      },
    });

    const { runtime } = createRuntime([task]);
    await migrate(runtime, [task]);

    const tasks = runtime.model(task);
    expect(await tasks.update("missing", { title: "noop" })).toBeNull();
    expect(await tasks.delete("missing")).toBe(false);
  });

  it("returns the current row when an update payload is empty", async () => {
    const preference = defineModel("Preference", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        value: field.string({ required: true }),
      },
    });

    const { runtime } = createRuntime([preference]);
    await migrate(runtime, [preference]);

    const preferences = runtime.model(preference);
    await preferences.create({ slug: "theme", value: "light" });

    const unchanged = await preferences.update("theme", {});
    expect(unchanged).toEqual({
      slug: "theme",
      value: "light",
    });
  });

  it("returns empty arrays for many-to-many relations with no join rows", async () => {
    const user = defineModel("User", {
      fields: {
        id: field.id(),
        email: field.string({ required: true, unique: true }),
      },
      relations: {
        groups: relation.manyToMany("Group", { through: "Membership" }),
      },
    });
    const group = defineModel("Group", {
      fields: {
        id: field.id(),
        name: field.string({ required: true, unique: true }),
      },
      relations: {
        users: relation.manyToMany("User", { through: "Membership" }),
      },
    });
    const membership = defineModel("Membership", {
      fields: {
        id: field.id(),
        userId: field.string({ references: "User", required: true }),
        groupId: field.string({ references: "Group", required: true }),
      },
    });

    const models = [user, group, membership];
    const { runtime } = createRuntime(models);
    await migrate(runtime, models);

    const created = await runtime.model(user).create({ email: "ada@example.com" });
    const loaded = await runtime.model(user).findById(created.id, { with: ["groups"] });
    expect(loaded?.groups).toEqual([]);
  });

  it("returns null for missing belongsTo and hasOne relations instead of throwing", async () => {
    const account = defineModel("Account", {
      fields: {
        id: field.id(),
        email: field.string({ required: true, unique: true }),
      },
      relations: {
        profile: relation.hasOne("Profile"),
      },
    });
    const invoice = defineModel("Invoice", {
      fields: {
        id: field.id(),
        accountId: field.string({ references: "Account" }),
      },
      relations: {
        account: relation.belongsTo("Account", { foreignKey: "accountId" }),
      },
    });
    const profile = defineModel("Profile", {
      fields: {
        id: field.id(),
        accountId: field.string({ references: "Account", required: true }),
      },
      relations: {
        account: relation.belongsTo("Account", { foreignKey: "accountId" }),
      },
    });

    const models = [account, invoice, profile];
    const { runtime } = createRuntime(models);
    await migrate(runtime, models);

    const invoiceRow = await runtime.model(invoice).create({ accountId: null });
    const loadedInvoice = await runtime.model(invoice).findById(invoiceRow.id, { with: ["account"] });
    expect(loadedInvoice?.account).toBeNull();

    const accountRow = await runtime.model(account).create({ email: "ada@example.com" });
    const loadedAccount = await runtime.model(account).findById(accountRow.id, { with: ["profile"] });
    expect(loadedAccount?.profile).toBeNull();
  });

  it("supports incremental model registration after the runtime is created", async () => {
    const tenant = defineModel("Tenant", {
      fields: {
        slug: field.string({ required: true, unique: true }),
      },
    });
    const project = defineModel("Project", {
      fields: {
        id: field.id(),
        tenantSlug: field.string({ references: "Tenant", required: true }),
      },
      relations: {
        tenant: relation.belongsTo("Tenant", { foreignKey: "tenantSlug" }),
      },
    });

    const { runtime } = createRuntime([tenant]);
    await migrate(runtime, [tenant, project]);
    runtime.registerModels([project]);

    await runtime.model(tenant).create({ slug: "prod" });
    const created = await runtime.model(project).create({ tenantSlug: "prod" });
    const loaded = await runtime.model(project).findById(created.id, { with: ["tenant"] });
    expect((loaded?.tenant as { slug: string }).slug).toBe("prod");
  });

  it("lets findMany return no rows for empty array filters", async () => {
    const user = defineModel("User", {
      fields: {
        id: field.id(),
        email: field.string({ required: true, unique: true }),
      },
    });

    const { runtime } = createRuntime([user]);
    await migrate(runtime, [user]);

    await runtime.model(user).create({ email: "ada@example.com" });
    const rows = await runtime.model(user).findMany({ where: { email: [] } });
    expect(rows).toEqual([]);
  });

  it("allows offset-only pagination by synthesizing LIMIT -1", async () => {
    const log = defineModel("Log", {
      fields: {
        id: field.id(),
        level: field.string({ required: true }),
      },
    });

    const { runtime } = createRuntime([log]);
    await migrate(runtime, [log]);

    const logs = runtime.model(log);
    await logs.create({ level: "info" });
    await logs.create({ level: "warn" });
    await logs.create({ level: "error" });

    const rows = await logs.findMany({
      orderBy: { field: "level", direction: "asc" },
      offset: 1,
    });
    expect(rows).toHaveLength(2);
  });

  it("makes applyMigration a no-op for empty statement lists", async () => {
    const user = defineModel("User", {
      fields: {
        id: field.id(),
        email: field.string({ required: true, unique: true }),
      },
    });

    const { runtime } = createRuntime([user]);
    await runtime.applyMigration([]);
    await migrate(runtime, [user]);

    const row = await runtime.model(user).create({ email: "ada@example.com" });
    expect(row.email).toBe("ada@example.com");
  });

  it("resolves lower-first model names through the registry", async () => {
    const invoice = defineModel("Invoice", {
      fields: {
        id: field.id(),
        code: field.string({ required: true, unique: true }),
      },
    });

    const { runtime } = createRuntime([invoice]);
    await migrate(runtime, [invoice]);

    await runtime.model("invoice").create({ code: "INV-1" });
    const loaded = await runtime.model("invoice").findMany();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.code).toBe("INV-1");
  });

  it("supports transaction-scoped raw SQL mixed with repository calls", async () => {
    const report = defineModel("Report", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
      },
    });

    const { runtime } = createRuntime([report]);
    await migrate(runtime, [report]);

    await runtime.transaction(async (tx) => {
      const created = await tx.model(report).create({ title: "Weekly" });
      const rows = await tx.query("SELECT title FROM reports WHERE id = ?", [created.id]);
      expect(rows[0]?.title).toBe("Weekly");
      await tx.execute("UPDATE reports SET title = ? WHERE id = ?", ["Monthly", created.id]);
    });

    const loaded = await runtime.model(report).findMany();
    expect(loaded[0]?.title).toBe("Monthly");
  });

  it("surfaces relation-resolution errors when a through model cannot be resolved", async () => {
    const user = defineModel("User", {
      fields: {
        id: field.id(),
        email: field.string({ required: true, unique: true }),
      },
      relations: {
        teams: relation.manyToMany("Team", { through: "missing_join" }),
      },
    });
    const team = defineModel("Team", {
      fields: {
        id: field.id(),
        name: field.string({ required: true, unique: true }),
      },
    });

    const { runtime } = createRuntime([user, team]);
    await migrate(runtime, [user, team]);

    const created = await runtime.model(user).create({ email: "ada@example.com" });
    await expect(runtime.model(user).findById(created.id, { with: ["teams"] })).rejects.toThrow(
      'Relation "User.teams" must resolve an explicit through model',
    );
  });
});

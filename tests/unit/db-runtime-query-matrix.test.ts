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

describe("db runtime query matrix", () => {
  it("supports array-based where filters and multi-column ordering", async () => {
    const event = defineModel("Event", {
      fields: {
        id: field.id(),
        tenantId: field.string({ required: true }),
        kind: field.string({ required: true }),
        sequence: field.integer({ required: true }),
      },
      indexes: [{ fields: ["tenantId", "kind"] }],
    });

    const { runtime } = createRuntime([event]);
    await migrate(runtime, [event]);

    const events = runtime.model(event);
    await events.create({ tenantId: "a", kind: "push", sequence: 1 });
    await events.create({ tenantId: "a", kind: "push", sequence: 3 });
    await events.create({ tenantId: "a", kind: "issue", sequence: 2 });
    await events.create({ tenantId: "b", kind: "push", sequence: 1 });

    const filtered = await events.findMany({
      where: {
        tenantId: ["a", "b"],
        kind: ["push"],
      },
      orderBy: [
        { field: "tenantId", direction: "asc" },
        { field: "sequence", direction: "desc" },
      ],
    });

    expect(filtered.map((row) => [row.tenantId, row.sequence])).toEqual([
      ["a", 3],
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("round-trips booleans, json, and vectors through repository queries", async () => {
    const document = defineModel("Document", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        published: field.boolean({ default: false }),
        metadata: field.json({ default: { tags: [] } }),
        embedding: field.vector(3),
      },
    });

    const { runtime } = createRuntime([document]);
    await migrate(runtime, [document]);

    const documents = runtime.model(document);
    const created = await documents.create({
      title: "Schema Notes",
      published: true,
      metadata: { tags: ["db", "orm"] },
      embedding: [1, 2, 3],
    });

    expect(created.published).toBe(true);
    expect(created.metadata).toEqual({ tags: ["db", "orm"] });
    expect(created.embedding).toEqual([1, 2, 3]);

    const loaded = await documents.findById(created.id);
    expect(loaded?.published).toBe(true);
    expect(loaded?.metadata).toEqual({ tags: ["db", "orm"] });
    expect(loaded?.embedding).toEqual([1, 2, 3]);
  });

  it("resolves hasMany and hasOne foreign keys from explicit overrides", async () => {
    const tenant = defineModel("Tenant", {
      fields: {
        slug: field.string({ required: true, unique: true }),
      },
      relations: {
        invoices: relation.hasMany("Invoice", { foreignKey: "tenantSlug" }),
        profile: relation.hasOne("TenantProfile", { foreignKey: "tenantSlug" }),
      },
    });
    const invoice = defineModel("Invoice", {
      fields: {
        id: field.id(),
        tenantSlug: field.string({ references: "Tenant", required: true }),
        amount: field.integer({ required: true }),
      },
      relations: {
        tenant: relation.belongsTo("Tenant", { foreignKey: "tenantSlug" }),
      },
    });
    const profile = defineModel("TenantProfile", {
      fields: {
        id: field.id(),
        tenantSlug: field.string({ references: "Tenant", required: true }),
        plan: field.string({ required: true }),
      },
      relations: {
        tenant: relation.belongsTo("Tenant", { foreignKey: "tenantSlug" }),
      },
    });

    const models = [tenant, invoice, profile];
    const { runtime } = createRuntime(models);
    await migrate(runtime, models);

    const tenants = runtime.model(tenant);
    await tenants.create({ slug: "prod" });
    await runtime.model(invoice).create({ tenantSlug: "prod", amount: 10 });
    await runtime.model(invoice).create({ tenantSlug: "prod", amount: 20 });
    await runtime.model(profile).create({ tenantSlug: "prod", plan: "enterprise" });

    const loaded = await tenants.findById("prod", { with: ["invoices", "profile"] });
    expect((loaded?.invoices as Array<{ amount: number }>).map((row) => row.amount).sort()).toEqual([10, 20]);
    expect((loaded?.profile as { plan: string }).plan).toBe("enterprise");
  });

  it("resolves many-to-many through models even when the relation points at a table-style name", async () => {
    const post = defineModel("Post", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
      },
      relations: {
        tags: relation.manyToMany("Tag", { through: "post_tags" }),
      },
    });
    const tag = defineModel("Tag", {
      fields: {
        id: field.id(),
        label: field.string({ required: true }),
      },
      relations: {
        posts: relation.manyToMany("Post", { through: "post_tags" }),
      },
    });
    const postTag = defineModel("PostTag", {
      fields: {
        id: field.id(),
        postId: field.string({ references: "Post", required: true }),
        tagId: field.string({ references: "Tag", required: true }),
      },
    });

    const models = [post, tag, postTag];
    const { runtime } = createRuntime(models);
    await migrate(runtime, models);

    const posts = runtime.model(post);
    const tags = runtime.model(tag);
    const links = runtime.model(postTag);

    const article = await posts.create({ title: "Capstan" });
    const orm = await tags.create({ label: "orm" });
    const agent = await tags.create({ label: "agent" });

    await links.create({ postId: article.id, tagId: orm.id });
    await links.create({ postId: article.id, tagId: agent.id });

    const loaded = await posts.findById(article.id, { with: ["tags"] });
    expect((loaded?.tags as Array<{ label: string }>).map((row) => row.label).sort()).toEqual([
      "agent",
      "orm",
    ]);
  });

  it("supports natural-key models for repository create, update, and delete", async () => {
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

    const loaded = await preferences.findById("theme");
    expect(loaded?.value).toBe("light");

    const updated = await preferences.update("theme", { value: "dark" });
    expect(updated?.value).toBe("dark");

    expect(await preferences.delete("theme")).toBe(true);
    expect(await preferences.findById("theme")).toBeNull();
  });

  it("supports explicit Model.field references in relation loading", async () => {
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
        name: field.string({ required: true }),
      },
      relations: {
        organization: relation.belongsTo("Organization", { foreignKey: "organizationSlug" }),
      },
    });

    const models = [organization, repository];
    const { runtime } = createRuntime(models);
    await migrate(runtime, models);

    const organizations = runtime.model(organization);
    const repositories = runtime.model(repository);

    await organizations.create({ id: "org-1", slug: "zauso" });
    const created = await repositories.create({ organizationSlug: "zauso", name: "capstan" });

    const loaded = await repositories.findById(created.id, { with: ["organization"] });
    expect((loaded?.organization as { slug: string }).slug).toBe("zauso");
  });

  it("returns affected row counts from raw execute calls", async () => {
    const task = defineModel("Task", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        done: field.boolean({ default: false }),
      },
    });

    const { runtime } = createRuntime([task]);
    await migrate(runtime, [task]);

    const tasks = runtime.model(task);
    const a = await tasks.create({ title: "one" });
    const b = await tasks.create({ title: "two" });

    const update = await runtime.execute("UPDATE tasks SET done = 1 WHERE id IN (?, ?)", [a.id, b.id]);
    expect(update.affectedRows).toBe(2);

    const remove = await runtime.execute("DELETE FROM tasks WHERE done = 1");
    expect(remove.affectedRows).toBe(2);
    expect(await tasks.count()).toBe(0);
  });

  it("throws clear errors for unknown relations and unregistered models", async () => {
    const project = defineModel("Project", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
      },
    });

    const { runtime } = createRuntime([project]);
    await migrate(runtime, [project]);

    const projects = runtime.model(project);
    const created = await projects.create({ name: "capstan" });

    await expect(projects.findById(created.id, { with: ["unknown"] })).rejects.toThrow(
      'Unknown relation "Project.unknown"',
    );

    expect(() => runtime.model("MissingModel")).toThrow(
      'Model "MissingModel" is not registered in this database runtime.',
    );
  });

  it("keeps relation loading stable when multiple parents share the same related model", async () => {
    const team = defineModel("Team", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
      },
      relations: {
        members: relation.hasMany("Member"),
      },
    });
    const member = defineModel("Member", {
      fields: {
        id: field.id(),
        teamId: field.string({ references: "Team", required: true }),
        handle: field.string({ required: true }),
      },
      relations: {
        team: relation.belongsTo("Team", { foreignKey: "teamId" }),
      },
    });

    const models = [team, member];
    const { runtime } = createRuntime(models);
    await migrate(runtime, models);

    const teams = runtime.model(team);
    const members = runtime.model(member);

    const alpha = await teams.create({ name: "alpha" });
    const beta = await teams.create({ name: "beta" });

    await members.create({ teamId: alpha.id, handle: "ada" });
    await members.create({ teamId: alpha.id, handle: "grace" });
    await members.create({ teamId: beta.id, handle: "linus" });

    const loaded = await teams.findMany({
      orderBy: { field: "name", direction: "asc" },
      with: ["members"],
    });

    expect((loaded[0]?.members as Array<{ handle: string }>).map((row) => row.handle).sort()).toEqual([
      "ada",
      "grace",
    ]);
    expect((loaded[1]?.members as Array<{ handle: string }>).map((row) => row.handle)).toEqual([
      "linus",
    ]);
  });

  it("allows transaction-scoped relation work with nested repository calls", async () => {
    const account = defineModel("Account", {
      fields: {
        id: field.id(),
        email: field.string({ required: true, unique: true }),
      },
      relations: {
        sessions: relation.hasMany("Session"),
      },
    });
    const session = defineModel("Session", {
      fields: {
        id: field.id(),
        accountId: field.string({ references: "Account", required: true }),
        userAgent: field.string({ required: true }),
      },
      relations: {
        account: relation.belongsTo("Account", { foreignKey: "accountId" }),
      },
    });

    const models = [account, session];
    const { runtime } = createRuntime(models);
    await migrate(runtime, models);

    await runtime.transaction(async (tx) => {
      const createdAccount = await tx.model(account).create({ email: "ada@example.com" });
      await tx.model(session).create({ accountId: createdAccount.id, userAgent: "Safari" });
      const loaded = await tx.model(account).findById(createdAccount.id, { with: ["sessions"] });
      expect((loaded?.sessions as Array<{ userAgent: string }>)[0]?.userAgent).toBe("Safari");
    });

    expect(await runtime.model(account).count()).toBe(1);
    expect(await runtime.model(session).count()).toBe(1);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createCrudRuntime,
  createDatabaseRuntime,
  defineModel,
  field,
  generateMigration,
  relation,
} from "@zauso-ai/capstan-db";

type SqliteRuntime = ReturnType<typeof makeSqliteRuntime>["runtime"];

const openDatabases: Database[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

function makeSqliteRuntime(models: Parameters<typeof generateMigration>[1]) {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  openDatabases.push(sqlite);

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

async function migrate(runtime: SqliteRuntime, models: Parameters<typeof generateMigration>[1]): Promise<void> {
  await runtime.applyMigration(generateMigration([], models, "sqlite"));
}

describe("db runtime repositories", () => {
  it("provides repository CRUD, count, ordering, pagination, and raw query access", async () => {
    const ticket = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string({ required: true, min: 3 }),
        priority: field.integer({ default: 1 }),
        status: field.enum(["open", "done"] as const, { default: "open" }),
        metadata: field.json({ default: { labels: [] } }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
      indexes: [{ fields: ["priority"] }],
    });

    const { runtime } = makeSqliteRuntime([ticket]);
    await migrate(runtime, [ticket]);

    const tickets = runtime.model(ticket);
    const created = await tickets.create({ title: "Ship docs" });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.priority).toBe(1);
    expect(created.status).toBe("open");
    expect(created.metadata).toEqual({ labels: [] });

    await tickets.create({ title: "Fix cache", priority: 3, status: "done" });
    await tickets.create({ title: "Cut release", priority: 2 });

    expect(await tickets.count()).toBe(3);
    expect(await tickets.count({ status: "done" })).toBe(1);

    const ordered = await tickets.findMany({
      orderBy: { field: "priority", direction: "desc" },
    });
    expect(ordered.map((row) => row.priority)).toEqual([3, 2, 1]);

    const paged = await tickets.findMany({
      orderBy: { field: "priority", direction: "desc" },
      limit: 1,
      offset: 1,
    });
    expect(paged).toHaveLength(1);
    expect(paged[0]?.priority).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await tickets.update(created.id, {
      status: "done",
      priority: 4,
    });
    expect(updated?.status).toBe("done");
    expect(updated?.priority).toBe(4);
    expect(updated?.updatedAt).not.toBe(created.updatedAt);

    const found = await tickets.findById(created.id);
    expect(found?.status).toBe("done");

    const raw = await runtime.query("SELECT COUNT(*) AS total FROM tickets");
    expect(raw[0]?.total).toBe(3);

    expect(await tickets.delete(created.id)).toBe(true);
    expect(await tickets.findById(created.id)).toBeNull();
    expect(await tickets.count()).toBe(2);
  });

  it("loads belongsTo, hasMany, and hasOne relations from the runtime registry", async () => {
    const author = defineModel("Author", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
      relations: {
        posts: relation.hasMany("Post"),
        profile: relation.hasOne("Profile"),
      },
    });
    const post = defineModel("Post", {
      fields: {
        id: field.id(),
        authorSlug: field.string({ references: "Author", required: true }),
        title: field.string({ required: true }),
      },
      relations: {
        author: relation.belongsTo("Author", { foreignKey: "authorSlug" }),
      },
    });
    const profile = defineModel("Profile", {
      fields: {
        id: field.id(),
        authorSlug: field.string({ references: "Author", required: true }),
        bio: field.text(),
      },
      relations: {
        author: relation.belongsTo("Author", { foreignKey: "authorSlug" }),
      },
    });

    const models = [author, post, profile];
    const { runtime } = makeSqliteRuntime(models);
    await migrate(runtime, models);

    const authors = runtime.model(author);
    const posts = runtime.model(post);
    const profiles = runtime.model(profile);

    const ada = await authors.create({ slug: "ada", name: "Ada" });
    await posts.create({ authorSlug: "ada", title: "Engines" });
    await posts.create({ authorSlug: "ada", title: "Compilers" });
    await profiles.create({ authorSlug: "ada", bio: "Wrote the notes." });

    const loadedAuthor = await authors.findById("ada", { with: ["posts", "profile"] });
    expect(loadedAuthor?.posts).toHaveLength(2);
    expect((loadedAuthor?.posts as Array<{ title: string }>).map((row) => row.title).sort()).toEqual([
      "Compilers",
      "Engines",
    ]);
    expect((loadedAuthor?.profile as { bio: string }).bio).toBe("Wrote the notes.");

    const loadedPost = await posts.findMany({ with: ["author"] });
    expect((loadedPost[0]?.author as { slug: string }).slug).toBe("ada");
  });

  it("treats many-to-many relations as first-class runtime relations through explicit join models", async () => {
    const user = defineModel("User", {
      fields: {
        id: field.id(),
        email: field.string({ required: true, unique: true }),
      },
      relations: {
        teams: relation.manyToMany("Team", { through: "TeamMembership" }),
      },
    });
    const team = defineModel("Team", {
      fields: {
        id: field.id(),
        name: field.string({ required: true, unique: true }),
      },
      relations: {
        members: relation.manyToMany("User", { through: "TeamMembership" }),
      },
    });
    const membership = defineModel("TeamMembership", {
      fields: {
        id: field.id(),
        userId: field.string({ references: "User", required: true }),
        teamId: field.string({ references: "Team", required: true }),
        role: field.enum(["member", "owner"] as const, { default: "member" }),
      },
      indexes: [{ fields: ["userId", "teamId"], unique: true }],
    });

    const models = [user, team, membership];
    const { runtime } = makeSqliteRuntime(models);
    await migrate(runtime, models);

    const users = runtime.model(user);
    const teams = runtime.model(team);
    const memberships = runtime.model(membership);

    const ada = await users.create({ email: "ada@example.com" });
    const grace = await users.create({ email: "grace@example.com" });
    const infra = await teams.create({ name: "infra" });
    const release = await teams.create({ name: "release" });

    await memberships.create({ userId: ada.id, teamId: infra.id, role: "owner" });
    await memberships.create({ userId: ada.id, teamId: release.id });
    await memberships.create({ userId: grace.id, teamId: release.id });

    const loadedUser = await users.findById(ada.id, { with: ["teams"] });
    expect((loadedUser?.teams as Array<{ name: string }>).map((row) => row.name).sort()).toEqual([
      "infra",
      "release",
    ]);

    const loadedTeam = await teams.findById(release.id, { with: ["members"] });
    expect((loadedTeam?.members as Array<{ email: string }>).map((row) => row.email).sort()).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);

    const relatedTeams = await users.relate(ada.id, "teams");
    expect(Array.isArray(relatedTeams)).toBe(true);
    expect((relatedTeams as Array<{ name: string }>).map((row) => row.name).sort()).toEqual([
      "infra",
      "release",
    ]);
  });

  it("applies relation-level ordering and pagination when using repository.relate()", async () => {
    const workspace = defineModel("Workspace", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
      relations: {
        projects: relation.hasMany("Project", { foreignKey: "workspaceSlug" }),
      },
    });
    const project = defineModel("Project", {
      fields: {
        id: field.id(),
        workspaceSlug: field.string({ references: "Workspace", required: true }),
        name: field.string({ required: true }),
      },
      relations: {
        workspace: relation.belongsTo("Workspace", { foreignKey: "workspaceSlug" }),
      },
    });

    const models = [workspace, project];
    const { runtime } = makeSqliteRuntime(models);
    await migrate(runtime, models);

    const workspaces = runtime.model(workspace);
    const projects = runtime.model(project);

    await workspaces.create({ slug: "platform", name: "Platform" });
    const alpha = await projects.create({ workspaceSlug: "platform", name: "alpha" });
    await projects.create({ workspaceSlug: "platform", name: "gamma" });
    await projects.create({ workspaceSlug: "platform", name: "beta" });

    const ordered = await workspaces.relate("platform", "projects", {
      orderBy: { field: "name", direction: "desc" },
      limit: 2,
    });
    expect((ordered as Array<{ name: string }>).map((row) => row.name)).toEqual(["gamma", "beta"]);

    const paged = await workspaces.relate("platform", "projects", {
      orderBy: { field: "name", direction: "asc" },
      limit: 1,
      offset: 1,
    });
    expect((paged as Array<{ name: string }>).map((row) => row.name)).toEqual(["beta"]);

    const inverse = await projects.relate(alpha.id, "workspace");
    expect((inverse as { slug: string }).slug).toBe("platform");
  });

  it("supports transaction-scoped repository work and rolls back on failure", async () => {
    const account = defineModel("Account", {
      fields: {
        id: field.id(),
        email: field.string({ required: true, unique: true }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const { runtime } = makeSqliteRuntime([account]);
    await migrate(runtime, [account]);
    const accounts = runtime.model(account);

    await expect(
      runtime.transaction(async (tx) => {
        await tx.model(account).create({ email: "ada@example.com" });
        await tx.model(account).create({ email: "grace@example.com" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(await accounts.count()).toBe(0);

    await runtime.transaction(async (tx) => {
      await tx.model(account).create({ email: "ada@example.com" });
      await tx.model(account).create({ email: "grace@example.com" });
    });

    expect(await accounts.count()).toBe(2);
  });

  it("powers higher-level CRUD runtimes from the same repository layer", async () => {
    const note = defineModel("Note", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        body: field.text(),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const { runtime } = makeSqliteRuntime([note]);
    await migrate(runtime, [note]);

    const crud = createCrudRuntime(runtime, note);
    const created = await crud.create({ title: "Primer", body: "hello" });
    expect(created.title).toBe("Primer");

    const fetched = await crud.get(created.id);
    expect(fetched?.body).toBe("hello");

    const listed = await crud.list();
    expect(listed).toHaveLength(1);

    const updated = await crud.update(created.id, { body: "updated" });
    expect(updated?.body).toBe("updated");

    expect(await crud.remove(created.id)).toBe(true);
    expect(await crud.get(created.id)).toBeNull();
  });

  it("exposes registered repositories through model names and table-style references", async () => {
    const repository = defineModel("Repository", {
      fields: {
        repositoryId: field.id(),
        name: field.string({ required: true }),
      },
    });

    const { runtime } = makeSqliteRuntime([repository]);
    await migrate(runtime, [repository]);

    await runtime.model("Repository").create({ name: "capstan" });

    const byModelName = await runtime.model("Repository").findMany();
    const byTableName = await runtime.model("repositories").findMany();
    const byVarName = await runtime.model("repository").findMany();

    expect(byModelName).toHaveLength(1);
    expect(byTableName).toHaveLength(1);
    expect(byVarName).toHaveLength(1);
    expect(runtime.models.Repository).toBeDefined();
  });
});

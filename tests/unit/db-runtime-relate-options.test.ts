import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createDatabaseRuntime,
  defineModel,
  field,
  generateMigration,
  relation,
} from "@zauso-ai/capstan-db";

const openDatabases: Database[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

function createRuntime(models: Parameters<typeof generateMigration>[1]) {
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
    async transaction<T>(fn: (inner: typeof adapter) => Promise<T>): Promise<T> {
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
  return { runtime };
}

async function migrate(runtime: ReturnType<typeof createRuntime>["runtime"], models: Parameters<typeof generateMigration>[1]) {
  await runtime.applyMigration(generateMigration([], models, "sqlite"));
}

describe("db runtime relate options", () => {
  it("applies ordering and pagination to hasMany relations", async () => {
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
        stars: field.integer({ default: 0 }),
      },
      relations: {
        workspace: relation.belongsTo("Workspace", { foreignKey: "workspaceSlug" }),
      },
    });

    const models = [workspace, project];
    const { runtime } = createRuntime(models);
    await migrate(runtime, models);

    const workspaces = runtime.model(workspace);
    const projects = runtime.model(project);

    await workspaces.create({ slug: "kernel", name: "Kernel" });
    await projects.create({ workspaceSlug: "kernel", name: "alpha", stars: 1 });
    await projects.create({ workspaceSlug: "kernel", name: "gamma", stars: 3 });
    await projects.create({ workspaceSlug: "kernel", name: "beta", stars: 2 });

    const topTwo = await workspaces.relate("kernel", "projects", {
      orderBy: { field: "stars", direction: "desc" },
      limit: 2,
    });
    expect((topTwo as Array<{ name: string }>).map((row) => row.name)).toEqual(["gamma", "beta"]);

    const middle = await workspaces.relate("kernel", "projects", {
      orderBy: { field: "name", direction: "asc" },
      limit: 1,
      offset: 1,
    });
    expect((middle as Array<{ name: string }>).map((row) => row.name)).toEqual(["beta"]);
  });

  it("applies ordering and pagination to many-to-many relations", async () => {
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
        priority: field.integer({ default: 0 }),
      },
      relations: {
        users: relation.manyToMany("User", { through: "TeamMembership" }),
      },
    });
    const membership = defineModel("TeamMembership", {
      fields: {
        id: field.id(),
        userId: field.string({ references: "User", required: true }),
        teamId: field.string({ references: "Team", required: true }),
      },
    });

    const models = [user, team, membership];
    const { runtime } = createRuntime(models);
    await migrate(runtime, models);

    const users = runtime.model(user);
    const teams = runtime.model(team);
    const memberships = runtime.model(membership);

    const ada = await users.create({ email: "ada@example.com" });
    const alpha = await teams.create({ name: "alpha", priority: 1 });
    const gamma = await teams.create({ name: "gamma", priority: 3 });
    const beta = await teams.create({ name: "beta", priority: 2 });

    await memberships.create({ userId: ada.id, teamId: alpha.id });
    await memberships.create({ userId: ada.id, teamId: gamma.id });
    await memberships.create({ userId: ada.id, teamId: beta.id });

    const highestPriority = await users.relate(ada.id, "teams", {
      orderBy: { field: "priority", direction: "desc" },
      limit: 2,
    });
    expect((highestPriority as Array<{ name: string }>).map((row) => row.name)).toEqual(["gamma", "beta"]);

    const lastByName = await users.relate(ada.id, "teams", {
      orderBy: { field: "name", direction: "asc" },
      limit: 1,
      offset: 2,
    });
    expect((lastByName as Array<{ name: string }>).map((row) => row.name)).toEqual(["gamma"]);
  });

  it("returns singular related rows for belongsTo and hasOne relations", async () => {
    const account = defineModel("Account", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
      relations: {
        profile: relation.hasOne("Profile", { foreignKey: "accountSlug" }),
      },
    });
    const profile = defineModel("Profile", {
      fields: {
        id: field.id(),
        accountSlug: field.string({ references: "Account", required: true }),
        title: field.string({ required: true }),
      },
      relations: {
        account: relation.belongsTo("Account", { foreignKey: "accountSlug" }),
      },
    });

    const models = [account, profile];
    const { runtime } = createRuntime(models);
    await migrate(runtime, models);

    const accounts = runtime.model(account);
    const profiles = runtime.model(profile);

    await accounts.create({ slug: "zauso", name: "Zauso" });
    const createdProfile = await profiles.create({ accountSlug: "zauso", title: "Platform" });

    const ownedProfile = await accounts.relate("zauso", "profile");
    expect((ownedProfile as { title: string }).title).toBe("Platform");

    const owner = await profiles.relate(createdProfile.id, "account");
    expect((owner as { slug: string }).slug).toBe("zauso");
  });
});

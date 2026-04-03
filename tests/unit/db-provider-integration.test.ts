import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createDatabase,
  defineModel,
  field,
  generateMigration,
  relation,
} from "@zauso-ai/capstan-db";

function runDocker(args: string[]): string {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function dockerAvailable(): boolean {
  const result = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
}

function parseHostPort(output: string): number {
  const line = output.trim().split("\n").at(-1) ?? "";
  const match = line.match(/:(\d+)\s*$/);
  if (!match) {
    throw new Error(`Could not parse docker port output: ${output}`);
  }
  return Number(match[1]);
}

async function waitFor(
  label: string,
  fn: () => Promise<void>,
  attempts = 40,
  delayMs = 1000,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      await sleep(delayMs);
    }
  }
  throw new Error(`Timed out waiting for ${label}: ${String(lastError)}`);
}

interface ContainerHandle {
  id: string;
  port: number;
}

const handles: ContainerHandle[] = [];
const maybeIt = dockerAvailable() ? it : it.skip;

afterAll(() => {
  for (const handle of handles.splice(0)) {
    spawnSync("docker", ["rm", "-f", handle.id], { stdio: "ignore" });
  }
});

describe("db provider integration", () => {
  let postgresUrl = "";
  let mysqlUrl = "";

  beforeAll(async () => {
    if (!dockerAvailable()) return;

    const postgresId = runDocker([
      "run",
      "-d",
      "--rm",
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-e",
      "POSTGRES_DB=capstan_test",
      "-p",
      "127.0.0.1::5432",
      "postgres:16-alpine",
    ]);
    const postgresPort = parseHostPort(runDocker(["port", postgresId, "5432/tcp"]));
    handles.push({ id: postgresId, port: postgresPort });
    postgresUrl = `postgres://postgres:postgres@127.0.0.1:${postgresPort}/capstan_test`;

    await waitFor("postgres", async () => {
      const database = await createDatabase({ provider: "postgres", url: postgresUrl });
      try {
        await database.execute("SELECT 1 AS ok");
      } finally {
        await database.close();
      }
    });

    const mysqlId = runDocker([
      "run",
      "-d",
      "--rm",
      "-e",
      "MYSQL_ROOT_PASSWORD=root",
      "-e",
      "MYSQL_ROOT_HOST=%",
      "-e",
      "MYSQL_DATABASE=capstan_test",
      "-p",
      "127.0.0.1::3306",
      "mysql:5.7",
    ]);
    const mysqlPort = parseHostPort(runDocker(["port", mysqlId, "3306/tcp"]));
    handles.push({ id: mysqlId, port: mysqlPort });
    mysqlUrl = `mysql://root:root@127.0.0.1:${mysqlPort}/capstan_test`;

    await waitFor("mysql", async () => {
      const database = await createDatabase({ provider: "mysql", url: mysqlUrl });
      try {
        await database.execute("SELECT 1 AS ok");
      } finally {
        await database.close();
      }
    }, 60, 1000);
  }, 180_000);

  maybeIt("runs repository relations and transactions end to end on PostgreSQL", async () => {
    const user = defineModel("User", {
      fields: {
        id: field.id(),
        email: field.string({ required: true, unique: true }),
      },
      relations: {
        roles: relation.manyToMany("Role", { through: "Membership" }),
      },
    });
    const role = defineModel("Role", {
      fields: {
        id: field.id(),
        key: field.string({ required: true, unique: true }),
      },
      relations: {
        users: relation.manyToMany("User", { through: "Membership" }),
      },
    });
    const membership = defineModel("Membership", {
      fields: {
        id: field.id(),
        userId: field.string({ references: "User", required: true }),
        roleId: field.string({ references: "Role", required: true }),
      },
      indexes: [{ fields: ["userId", "roleId"], unique: true }],
    });

    const models = [user, role, membership];
    const database = await createDatabase({ provider: "postgres", url: postgresUrl });

    try {
      await database.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto");
      await database.applyMigration(generateMigration([], models, "postgres"));
      database.registerModels(models);

      const users = database.model(user);
      const roles = database.model(role);
      const memberships = database.model(membership);

      const ada = await users.create({ email: "ada@example.com" });
      const admin = await roles.create({ key: "admin" });
      const reviewer = await roles.create({ key: "reviewer" });

      await memberships.create({ userId: ada.id, roleId: admin.id });
      await memberships.create({ userId: ada.id, roleId: reviewer.id });

      const loaded = await users.findById(ada.id, { with: ["roles"] });
      expect((loaded?.roles as Array<{ key: string }>).map((row) => row.key).sort()).toEqual([
        "admin",
        "reviewer",
      ]);

      await expect(
        database.transaction(async (tx) => {
          await tx.model(user).create({ email: "grace@example.com" });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");

      expect(await users.count()).toBe(1);
    } finally {
      await database.execute("DROP TABLE IF EXISTS memberships CASCADE");
      await database.execute("DROP TABLE IF EXISTS roles CASCADE");
      await database.execute("DROP TABLE IF EXISTS users CASCADE");
      await database.close();
    }
  }, 180_000);

  maybeIt("applies runtime repositories and rewrite migrations end to end on MySQL", async () => {
    const organization = defineModel("Organization", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
      relations: {
        repositories: relation.hasMany("Repository"),
      },
    });
    const repositoryV1 = defineModel("Repository", {
      fields: {
        repositoryKey: field.string({ required: true, unique: true }),
        organizationSlug: field.string({ references: "Organization", required: true }),
        score: field.string(),
      },
      relations: {
        organization: relation.belongsTo("Organization", { foreignKey: "organizationSlug" }),
      },
      indexes: [{ fields: ["organizationSlug"] }],
    });
    const repositoryV2 = defineModel("Repository", {
      fields: {
        repositoryKey: field.string({ required: true, unique: true }),
        organizationSlug: field.string({ references: "Organization", required: true }),
        score: field.integer(),
      },
      relations: {
        organization: relation.belongsTo("Organization", { foreignKey: "organizationSlug" }),
      },
      indexes: [{ fields: ["organizationSlug"] }],
    });

    const database = await createDatabase({ provider: "mysql", url: mysqlUrl });

    try {
      await database.applyMigration(generateMigration([], [organization, repositoryV1], "mysql"));
      database.registerModels([organization, repositoryV1]);

      const organizations = database.model(organization);
      const repositories = database.model(repositoryV1);

      await organizations.create({ slug: "zauso", name: "Zauso" });
      const created = await repositories.create({
        repositoryKey: "capstan",
        organizationSlug: "zauso",
        score: "42",
      });
      expect(created.score).toBe("42");

      const rewriteSql = generateMigration([organization, repositoryV1], [organization, repositoryV2], {
        provider: "mysql",
        strict: true,
      });
      await database.applyMigration(rewriteSql);

      database.registerModels([organization, repositoryV2]);
      const migrated = await database.model(repositoryV2).findById("capstan", { with: ["organization"] });

      expect(migrated?.score).toBe(42);
      expect((migrated?.organization as { slug: string }).slug).toBe("zauso");

      const orgWithRepos = await database.model(organization).findById("zauso", { with: ["repositories"] });
      expect((orgWithRepos?.repositories as Array<{ id: string }>)).toHaveLength(1);
    } finally {
      await database.execute("DROP TABLE IF EXISTS repositories");
      await database.execute("DROP TABLE IF EXISTS organizations");
      await database.close();
    }
  }, 180_000);
});

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { applyMigration, defineModel, field, generateDrizzleSchema, generateMigration, prepareCreateData, prepareUpdateData } from "@zauso-ai/capstan-db";

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(process.cwd(), ".capstan-db-runtime-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

async function importSchema(source: string): Promise<Record<string, unknown>> {
  const dir = await makeTempDir();
  const path = join(dir, "schema.ts");
  await writeFile(path, source);
  return import(pathToFileURL(path).href) as Promise<Record<string, unknown>>;
}

describe("db runtime contract", () => {
  it("supports non-id primary keys and foreign-key references end to end", async () => {
    const organization = defineModel("Organization", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
    });
    const repository = defineModel("Repository", {
      fields: {
        repositoryId: field.id(),
        organizationSlug: field.string({ references: "Organization", required: true }),
        name: field.string({ required: true }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const schema = await importSchema(generateDrizzleSchema([organization, repository], "sqlite"));
    const sqlite = new Database(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");

    try {
      applyMigration(
        { $client: sqlite },
        generateMigration([], [organization, repository], "sqlite"),
      );

      const db = drizzle(sqlite);
      const organizations = schema.organizations as never;
      const repositories = schema.repositories as never;

      await db.insert(organizations).values({ slug: "zauso", name: "Zauso" }).run();

      const prepared = await prepareCreateData(repository, {
        organizationSlug: "zauso",
        name: "capstan",
      });
      const created = await db.insert(repositories).values(prepared as never).returning();

      expect(created[0]?.organizationSlug).toBe("zauso");
      expect(created[0]?.repositoryId).toMatch(
        /^[0-9a-f-]{36}$/i,
      );

      const invalidValues = await prepareCreateData(repository, {
        organizationSlug: "missing",
        name: "broken",
      });
      expect(() =>
        db.insert(repositories).values(invalidValues as never).run(),
      ).toThrow();
    } finally {
      sqlite.close();
    }
  });

  it("keeps runtime defaults aligned between prepareCreateData and generated schema", async () => {
    const release = defineModel("Release", {
      fields: {
        id: field.id(),
        version: field.string({ required: true }),
        channel: field.enum(["stable", "beta"] as const, { default: "stable" }),
        metadata: field.json({ default: { notes: [] } }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const schema = await importSchema(generateDrizzleSchema([release], "sqlite"));
    const sqlite = new Database(":memory:");

    try {
      applyMigration({ $client: sqlite }, generateMigration([], [release], "sqlite"));
      const db = drizzle(sqlite);
      const releases = schema.releases as never;

      const prepared = await prepareCreateData(release, { version: "1.0.0" });
      expect(prepared.channel).toBe("stable");
      expect(prepared.metadata).toEqual({ notes: [] });

      const inserted = await db.insert(releases).values(prepared as never).returning();
      expect(inserted[0]?.channel).toBe("stable");
      expect(inserted[0]?.metadata).toEqual({ notes: [] });
    } finally {
      sqlite.close();
    }
  });

  it("propagates updatedAt changes through prepareUpdateData and generated schemas", async () => {
    const task = defineModel("Task", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        status: field.enum(["open", "done"] as const, { default: "open" }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const schema = await importSchema(generateDrizzleSchema([task], "sqlite"));
    const sqlite = new Database(":memory:");

    try {
      applyMigration({ $client: sqlite }, generateMigration([], [task], "sqlite"));
      const db = drizzle(sqlite);
      const tasks = schema.tasks as never;

      const inserted = await db.insert(tasks).values(
        await prepareCreateData(task, { title: "Ship it" }) as never,
      ).returning();

      const firstUpdatedAt = inserted[0]?.updatedAt;
      await new Promise((resolve) => setTimeout(resolve, 5));

      const updatePayload = await prepareUpdateData(task, { status: "done" });
      const updated = await db.update(tasks).set(updatePayload as never)
        .where(eq((schema.tasks as { id: unknown }).id as never, inserted[0]?.id as never))
        .returning();

      expect(updated[0]?.status).toBe("done");
      expect(updated[0]?.updatedAt).not.toBe(firstUpdatedAt);
    } finally {
      sqlite.close();
    }
  });

  it("persists explicit reference-field syntax all the way to SQLite", async () => {
    const tenant = defineModel("Tenant", {
      fields: {
        id: field.id(),
        slug: field.string({ required: true, unique: true }),
      },
    });
    const environment = defineModel("Environment", {
      fields: {
        id: field.id(),
        tenantSlug: field.string({ references: "Tenant.slug", required: true }),
        name: field.string({ required: true }),
      },
    });

    const sqlite = new Database(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");

    try {
      applyMigration(
        { $client: sqlite },
        generateMigration([], [tenant, environment], "sqlite"),
      );

      sqlite.prepare("INSERT INTO tenants (id, slug) VALUES (?, ?)").run("tenant-1", "prod");
      sqlite.prepare("INSERT INTO environments (id, tenant_slug, name) VALUES (?, ?, ?)").run(
        "env-1",
        "prod",
        "production",
      );

      const row = sqlite.prepare(
        "SELECT tenant_slug, name FROM environments WHERE id = ?",
      ).get("env-1") as { tenant_slug: string; name: string };

      expect(row).toEqual({ tenant_slug: "prod", name: "production" });
    } finally {
      sqlite.close();
    }
  });

  it("stores provider-generated UUID defaults even when writing raw SQL", () => {
    const session = defineModel("Session", {
      fields: {
        id: field.id(),
        userId: field.string({ required: true }),
      },
    });

    const sqlite = new Database(":memory:");
    try {
      applyMigration({ $client: sqlite }, generateMigration([], [session], "sqlite"));
      sqlite.prepare("INSERT INTO sessions (user_id) VALUES (?)").run("u1");
      sqlite.prepare("INSERT INTO sessions (user_id) VALUES (?)").run("u2");

      const rows = sqlite.prepare("SELECT id, user_id FROM sessions ORDER BY user_id").all() as Array<{
        id: string;
        user_id: string;
      }>;

      expect(rows).toHaveLength(2);
      expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(rows[1]?.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(rows[0]?.id).not.toBe(rows[1]?.id);
    } finally {
      sqlite.close();
    }
  });
});

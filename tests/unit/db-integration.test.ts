import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { applyMigration, defineModel, field, generateDrizzleSchema, generateMigration } from "@zauso-ai/capstan-db";

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(process.cwd(), ".capstan-db-integration-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("packages/db integration", () => {
  it("sqlite migrations now generate database-level UUID defaults for field.id()", () => {
    const user = defineModel("User", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
      },
    });

    const sqlite = new Database(":memory:");
    try {
      applyMigration({ $client: sqlite }, generateMigration([], [user], "sqlite"));
      sqlite.prepare("INSERT INTO users (name) VALUES (?)").run("Ada");

      const row = sqlite.prepare("SELECT id, name FROM users").get() as {
        id: string;
        name: string;
      };

      expect(row.name).toBe("Ada");
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    } finally {
      sqlite.close();
    }
  });

  it("generated sqlite schema works end-to-end with Drizzle runtime defaults and onUpdate hooks", async () => {
    const user = defineModel("User", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const dir = await makeTempDir();
    const schemaPath = join(dir, "schema.ts");
    await writeFile(schemaPath, generateDrizzleSchema([user], "sqlite"));

    const schemaModule = await import(pathToFileURL(schemaPath).href) as {
      users: unknown;
    };

    const sqlite = new Database(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");

    try {
      const db = drizzle(sqlite);
      applyMigration({ $client: sqlite }, generateMigration([], [user], "sqlite"));

      const created = await db
        .insert(schemaModule.users as never)
        .values({ name: "Ada" })
        .returning();

      expect(created).toHaveLength(1);
      expect(created[0]?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(typeof created[0]?.updatedAt).toBe("string");

      await new Promise((resolve) => setTimeout(resolve, 5));

      const updated = await db
        .update(schemaModule.users as never)
        .set({ name: "Grace" })
        .where(eq((schemaModule.users as { id: unknown }).id as never, created[0]?.id as never))
        .returning();

      expect(updated[0]?.name).toBe("Grace");
      expect(updated[0]?.updatedAt).not.toBe(created[0]?.updatedAt);
    } finally {
      sqlite.close();
    }
  });
});

import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import type { DatabaseConfig } from "./types.js";

export interface DatabaseInstance {
  /** The Drizzle ORM database instance. */
  db: BetterSQLite3Database;
  /** Close the underlying database connection. */
  close: () => void;
}

/**
 * Create a Drizzle database instance backed by better-sqlite3.
 *
 * @param config - Database configuration. Currently only `sqlite` provider is
 *   supported. The `url` field should be a file path (or `:memory:` for an
 *   in-memory database).
 *
 * @example
 *   const { db, close } = createDatabase({ provider: "sqlite", url: "./data.db" });
 *   // ... use db ...
 *   close();
 */
export function createDatabase(config: DatabaseConfig): DatabaseInstance {
  if (config.provider !== "sqlite") {
    throw new Error(
      `@capstan/db: Unsupported database provider "${config.provider}". Only "sqlite" is currently supported.`,
    );
  }

  const sqlite = new Database(config.url);

  // Enable WAL mode for better concurrent read performance.
  sqlite.pragma("journal_mode = WAL");

  const db = drizzle({ client: sqlite });

  return {
    db,
    close() {
      sqlite.close();
    },
  };
}

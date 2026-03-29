import { createRequire } from "node:module";
import type { DatabaseConfig } from "./types.js";

const require = createRequire(import.meta.url);

export interface DatabaseInstance {
  /** The Drizzle ORM database instance. */
  db: unknown;
  /** Close the underlying database connection. */
  close: () => void;
}

/**
 * Create a Drizzle database instance backed by better-sqlite3.
 *
 * Both `better-sqlite3` and `drizzle-orm` are optional peer dependencies. They
 * are loaded lazily so that `@zauso-ai/capstan-db` can be installed even when
 * native compilation of `better-sqlite3` fails. The actual database features
 * will not work until the peer dependencies are installed.
 *
 * @param config - Database configuration. Currently only `sqlite` provider is
 *   supported. The `url` field should be a file path (or `:memory:` for an
 *   in-memory database).
 *
 * @throws If `better-sqlite3` or `drizzle-orm` are not installed, throws an
 *   error with installation instructions.
 *
 * @example
 *   const { db, close } = createDatabase({ provider: "sqlite", url: "./data.db" });
 *   // ... use db ...
 *   close();
 */
export function createDatabase(config: DatabaseConfig): DatabaseInstance {
  if (config.provider !== "sqlite") {
    throw new Error(
      `@zauso-ai/capstan-db: Unsupported database provider "${config.provider}". Only "sqlite" is currently supported.`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let BetterSqlite3: any;
  try {
    BetterSqlite3 = require("better-sqlite3");
  } catch {
    throw new Error(
      `@zauso-ai/capstan-db: "better-sqlite3" is required for SQLite support but is not installed.\n` +
      `Install it with: npm install better-sqlite3\n` +
      `Note: this package requires native compilation (node-gyp). ` +
      `Make sure you have a C++ build toolchain installed.`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let drizzle: any;
  try {
    const drizzleModule = require("drizzle-orm/better-sqlite3");
    drizzle = drizzleModule.drizzle;
  } catch {
    throw new Error(
      `@zauso-ai/capstan-db: "drizzle-orm" is required for database support but is not installed.\n` +
      `Install it with: npm install drizzle-orm`,
    );
  }

  const sqlite = new BetterSqlite3(config.url);

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

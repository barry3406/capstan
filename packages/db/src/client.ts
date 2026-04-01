import type { DatabaseConfig } from "./types.js";

// Helper to dynamically import optional peer dependencies without TypeScript
// trying to resolve them at compile time (they may not be installed).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importPeer(specifier: string): Promise<any> {
  return import(specifier);
}

export interface DatabaseInstance {
  /** The Drizzle ORM database instance. */
  db: unknown;
  /** Close the underlying database connection. */
  close: () => void;
}

/**
 * Create a Drizzle database instance backed by better-sqlite3 (SQLite),
 * node-postgres (PostgreSQL), or mysql2 (MySQL).
 *
 * All driver dependencies are optional peer dependencies and are loaded lazily
 * so that `@zauso-ai/capstan-db` can be installed even when native compilation
 * of `better-sqlite3` fails or `pg`/`mysql2` are not needed. The actual
 * database features will not work until the appropriate peer dependencies are
 * installed.
 *
 * @param config - Database configuration.
 *   - `provider: "sqlite"` — `url` should be a file path (or `:memory:`).
 *   - `provider: "postgres"` — `url` should be a PostgreSQL connection string
 *     (e.g. `postgres://user:pass@host:5432/db`).
 *   - `provider: "mysql"` — `url` should be a MySQL connection string
 *     (e.g. `mysql://user:pass@host:3306/db`).
 *
 * @throws If the required driver or `drizzle-orm` adapter is not installed,
 *   throws an error with installation instructions.
 *
 * @example
 *   // SQLite
 *   const { db, close } = createDatabase({ provider: "sqlite", url: "./data.db" });
 *
 *   // PostgreSQL
 *   const { db, close } = createDatabase({
 *     provider: "postgres",
 *     url: "postgres://user:pass@localhost:5432/mydb",
 *   });
 *
 *   // MySQL
 *   const { db, close } = createDatabase({
 *     provider: "mysql",
 *     url: "mysql://user:pass@localhost:3306/mydb",
 *   });
 */
export async function createDatabase(config: DatabaseConfig): Promise<DatabaseInstance> {
  switch (config.provider) {
    case "sqlite":
      return createSqliteDatabase(config.url);
    case "postgres":
      return createPostgresDatabase(config.url);
    case "mysql":
      return createMysqlDatabase(config.url);
    case "libsql":
      return createLibsqlDatabase(config.url);
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(
        `@zauso-ai/capstan-db: Unsupported database provider "${String(_exhaustive)}".`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// SQLite (better-sqlite3)
// ---------------------------------------------------------------------------

async function createSqliteDatabase(url: string): Promise<DatabaseInstance> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let BetterSqlite3: any;
  try {
    const mod = await importPeer("better-sqlite3");
    BetterSqlite3 = mod.default ?? mod;
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
    const drizzleModule = await importPeer("drizzle-orm/better-sqlite3");
    drizzle = drizzleModule.drizzle;
  } catch {
    throw new Error(
      `@zauso-ai/capstan-db: "drizzle-orm" is required for database support but is not installed.\n` +
      `Install it with: npm install drizzle-orm`,
    );
  }

  const sqlite = new BetterSqlite3(url);

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

// ---------------------------------------------------------------------------
// PostgreSQL (node-postgres / pg)
// ---------------------------------------------------------------------------

async function createPostgresDatabase(url: string): Promise<DatabaseInstance> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Pool: any;
  try {
    const pgModule = await importPeer("pg");
    Pool = pgModule.Pool ?? (pgModule.default as { Pool: unknown })?.Pool;
  } catch {
    throw new Error(
      `@zauso-ai/capstan-db: "pg" (node-postgres) is required for PostgreSQL support but is not installed.\n` +
      `Install it with: npm install pg`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let drizzle: any;
  try {
    const drizzleModule = await importPeer("drizzle-orm/node-postgres");
    drizzle = drizzleModule.drizzle;
  } catch {
    throw new Error(
      `@zauso-ai/capstan-db: "drizzle-orm/node-postgres" adapter is required for PostgreSQL support but is not installed.\n` +
      `Install it with: npm install drizzle-orm`,
    );
  }

  const pool = new Pool({ connectionString: url });

  const db = drizzle({ client: pool });

  return {
    db,
    close() {
      pool.end();
    },
  };
}

// ---------------------------------------------------------------------------
// MySQL (mysql2)
// ---------------------------------------------------------------------------

async function createMysqlDatabase(url: string): Promise<DatabaseInstance> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createPool: any;
  try {
    const mysql2 = await importPeer("mysql2/promise");
    createPool = mysql2.createPool ?? (mysql2.default as { createPool: unknown })?.createPool;
  } catch {
    throw new Error(
      `@zauso-ai/capstan-db: "mysql2" is required for MySQL support but is not installed.\n` +
      `Install it with: npm install mysql2`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let drizzle: any;
  try {
    const drizzleModule = await importPeer("drizzle-orm/mysql2");
    drizzle = drizzleModule.drizzle;
  } catch {
    throw new Error(
      `@zauso-ai/capstan-db: "drizzle-orm/mysql2" adapter is required for MySQL support but is not installed.\n` +
      `Install it with: npm install drizzle-orm`,
    );
  }

  const pool = createPool({ uri: url });
  const db = drizzle({ client: pool });

  return {
    db,
    close() {
      // The interface is synchronous; fire-and-forget the async pool shutdown.
      void pool.end();
    },
  };
}

// ---------------------------------------------------------------------------
// libSQL / Turso (@libsql/client)
// ---------------------------------------------------------------------------

async function createLibsqlDatabase(url: string): Promise<DatabaseInstance> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createClient: any;
  try {
    const libsqlModule = await importPeer("@libsql/client");
    createClient = libsqlModule.createClient ?? (libsqlModule.default as { createClient: unknown })?.createClient;
  } catch {
    throw new Error(
      `@zauso-ai/capstan-db: "@libsql/client" is required for libSQL/Turso support but is not installed.\n` +
      `Install it with: npm install @libsql/client`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let drizzle: any;
  try {
    const drizzleModule = await importPeer("drizzle-orm/libsql");
    drizzle = drizzleModule.drizzle;
  } catch {
    throw new Error(
      `@zauso-ai/capstan-db: "drizzle-orm/libsql" adapter is required for libSQL/Turso support but is not installed.\n` +
      `Install it with: npm install drizzle-orm`,
    );
  }

  const client = createClient({ url });
  const db = drizzle({ client });

  return {
    db,
    close() {
      client.close();
    },
  };
}

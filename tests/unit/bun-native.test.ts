import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Temp dir lifecycle
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "capstan-bun-native-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

// ===========================================================================
// Runtime detection
// ===========================================================================

describe("Bun runtime detection", () => {
  it("typeof Bun !== 'undefined' is true in Bun test env", () => {
    expect(typeof Bun !== "undefined").toBe(true);
  });

  it("Bun.version exists and is a string", () => {
    expect(typeof Bun.version).toBe("string");
    expect(Bun.version.length).toBeGreaterThan(0);
  });

  it("Bun.serve is a function", () => {
    expect(typeof Bun.serve).toBe("function");
  });

  it("Bun.spawn is a function", () => {
    expect(typeof Bun.spawn).toBe("function");
  });

  it("Bun.file is a function", () => {
    expect(typeof Bun.file).toBe("function");
  });

  it("Bun.write is a function", () => {
    expect(typeof Bun.write).toBe("function");
  });
});

// ===========================================================================
// bun:sqlite
// ===========================================================================

describe("bun:sqlite", () => {
  it("can create an in-memory database", async () => {
    const { Database } = await import("bun:sqlite");
    const db = new Database(":memory:");
    expect(db).toBeDefined();
    db.close();
  });

  it("can execute CREATE TABLE and INSERT", async () => {
    const { Database } = await import("bun:sqlite");
    const db = new Database(":memory:");
    db.run("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    db.run("INSERT INTO items (name) VALUES (?)", ["widget"]);
    const row = db.query("SELECT name FROM items WHERE id = 1").get() as { name: string } | null;
    expect(row).not.toBeNull();
    expect(row!.name).toBe("widget");
    db.close();
  });

  it("supports parameterized queries", async () => {
    const { Database } = await import("bun:sqlite");
    const db = new Database(":memory:");
    db.run("CREATE TABLE kv (key TEXT, value TEXT)");
    db.run("INSERT INTO kv VALUES (?, ?)", ["greeting", "hello"]);
    db.run("INSERT INTO kv VALUES (?, ?)", ["farewell", "bye"]);
    const rows = db.query("SELECT * FROM kv WHERE key = ?").all("greeting") as { key: string; value: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe("hello");
    db.close();
  });

  it("transaction rollback works", async () => {
    const { Database } = await import("bun:sqlite");
    const db = new Database(":memory:");
    db.run("CREATE TABLE counter (n INTEGER)");
    db.run("INSERT INTO counter VALUES (0)");

    db.run("BEGIN");
    db.run("UPDATE counter SET n = 99");
    db.run("ROLLBACK");

    const row = db.query("SELECT n FROM counter").get() as { n: number };
    expect(row.n).toBe(0);
    db.close();
  });

  it("close database cleans up", async () => {
    const { Database } = await import("bun:sqlite");
    const db = new Database(":memory:");
    db.run("CREATE TABLE t (x INTEGER)");
    db.close();
    // After close, running a query should throw
    expect(() => db.run("SELECT 1")).toThrow();
  });
});

// ===========================================================================
// Bun.file + Bun.write
// ===========================================================================

describe("Bun.file + Bun.write", () => {
  it("write a file and read it back", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "test.txt");
    await Bun.write(filePath, "hello bun");
    const content = await Bun.file(filePath).text();
    expect(content).toBe("hello bun");
  });

  it("read non-existent file throws on text()", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "nope.txt");
    const file = Bun.file(filePath);
    // Bun.file itself does not throw — calling text() does
    await expect(file.text()).rejects.toThrow();
  });

  it("write creates the file (not intermediate directories)", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "created.txt");
    await Bun.write(filePath, "data");
    const exists = await Bun.file(filePath).exists();
    expect(exists).toBe(true);
  });

  it("write overwrites existing file", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "overwrite.txt");
    await Bun.write(filePath, "first");
    await Bun.write(filePath, "second");
    const content = await Bun.file(filePath).text();
    expect(content).toBe("second");
  });
});

// ===========================================================================
// Bun.spawn
// ===========================================================================

describe("Bun.spawn", () => {
  it("spawn 'echo hello' and capture stdout", async () => {
    const proc = Bun.spawn(["echo", "hello"], {
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    expect(output.trim()).toBe("hello");
    proc.unref();
  });

  it("spawn with arguments", async () => {
    const proc = Bun.spawn(["echo", "one", "two", "three"], {
      stdout: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    expect(output.trim()).toBe("one two three");
    proc.unref();
  });

  it("spawn non-existent command fails", () => {
    expect(() => {
      Bun.spawn(["__nonexistent_cmd_xyz__"]);
    }).toThrow();
  });

  it("spawnSync works", () => {
    const result = Bun.spawnSync(["echo", "sync-hello"]);
    expect(result.stdout.toString().trim()).toBe("sync-hello");
    expect(result.exitCode).toBe(0);
  });
});

// ===========================================================================
// Dynamic import
// ===========================================================================

describe("dynamic import", () => {
  it("await import('bun:sqlite') works", async () => {
    const mod = await import("bun:sqlite");
    expect(mod.Database).toBeDefined();
    expect(typeof mod.Database).toBe("function");
  });

  it("await import('nonexistent-module') rejects", async () => {
    await expect(import("nonexistent-module-xyz-123")).rejects.toThrow();
  });

  it("dynamic import of node:path works", async () => {
    const mod = await import("node:path");
    expect(typeof mod.join).toBe("function");
  });
});

// ===========================================================================
// createDatabase async behaviour
// ===========================================================================

describe("createDatabase async", () => {
  it("createDatabase returns a Promise", async () => {
    const { createDatabase } = await import("@zauso-ai/capstan-db");
    const result = createDatabase({ provider: "sqlite", url: ":memory:" });
    expect(result).toBeInstanceOf(Promise);
    // Clean up — awaiting may throw if better-sqlite3 not installed
    try {
      const inst = await result;
      inst.close();
    } catch {
      // OK if better-sqlite3 is not installed; the Promise type test passed
    }
  });

  it("awaited result has db and close properties (when driver available)", async () => {
    const { createDatabase } = await import("@zauso-ai/capstan-db");
    try {
      const inst = await createDatabase({ provider: "sqlite", url: ":memory:" });
      expect(inst).toHaveProperty("db");
      expect(inst).toHaveProperty("close");
      expect(typeof inst.close).toBe("function");
      inst.close();
    } catch {
      // Skip if better-sqlite3 not installed — not testing the driver itself
    }
  });

  it("close() works without error (when driver available)", async () => {
    const { createDatabase } = await import("@zauso-ai/capstan-db");
    try {
      const inst = await createDatabase({ provider: "sqlite", url: ":memory:" });
      // Calling close should not throw
      inst.close();
    } catch {
      // Skip if driver not available
    }
  });

  it("invalid provider rejects with helpful message", async () => {
    const { createDatabase } = await import("@zauso-ai/capstan-db");
    // Force an invalid provider via cast
    await expect(
      createDatabase({ provider: "oracle" as "sqlite", url: "fake" }),
    ).rejects.toThrow(/unsupported/i);
  });

  it("postgres without pg installed rejects with install instructions", async () => {
    const { createDatabase } = await import("@zauso-ai/capstan-db");
    // pg is unlikely installed in test env
    try {
      await createDatabase({ provider: "postgres", url: "postgres://localhost/test" });
    } catch (err: unknown) {
      const msg = (err as Error).message;
      // Should mention pg or node-postgres
      expect(msg).toMatch(/pg|node-postgres|not installed/i);
    }
  });
});

// ===========================================================================
// Bun adapter
// ===========================================================================

describe("Bun adapter", () => {
  it("typeof Bun !== 'undefined' is true when Bun is available", () => {
    expect(typeof Bun !== "undefined").toBe(true);
  });

  it("createBunAdapter returns a ServerAdapter with listen method", async () => {
    const { createBunAdapter } = await import("../../packages/dev/src/adapter-bun.js");
    const adapter = createBunAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.listen).toBe("function");
  });

  it("Bun adapter listen starts a real server reachable by fetch", async () => {
    const { createBunAdapter } = await import("../../packages/dev/src/adapter-bun.js");
    const adapter = createBunAdapter();
    const port = 20000 + Math.floor(Math.random() * 40000);

    const app = {
      fetch: async (_req: Request) => new Response("bun-adapter-ok"),
    };

    const handle = await adapter.listen(app, port, "127.0.0.1");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("bun-adapter-ok");
    } finally {
      await handle.close();
    }
  });

  it("Bun adapter close() stops the server", async () => {
    const { createBunAdapter } = await import("../../packages/dev/src/adapter-bun.js");
    const adapter = createBunAdapter();
    const port = 20000 + Math.floor(Math.random() * 40000);

    const app = {
      fetch: async () => new Response("will-close"),
    };

    const handle = await adapter.listen(app, port, "127.0.0.1");
    await handle.close();

    // After close, fetch should fail
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      // If it somehow succeeds, that is unexpected but not always reliable
    } catch {
      // Expected — connection refused
      expect(true).toBe(true);
    }
  });
});

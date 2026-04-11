import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SqliteMemoryBackend } from "../../packages/ai/src/memory-sqlite.js";
import type { MemoryScope } from "../../packages/ai/src/types.js";

const scope: MemoryScope = { type: "worker", id: "alice" };
const teamScope: MemoryScope = { type: "team", id: "ops" };

function createTestBackend(opts?: { tableName?: string }) {
  const db = new Database(":memory:");
  return new SqliteMemoryBackend(db as never, opts);
}

describe("SqliteMemoryBackend", () => {
  let backend: SqliteMemoryBackend;

  beforeEach(() => {
    backend = createTestBackend();
  });

  it("stores entry and queries it back by scope", async () => {
    await backend.store({ content: "the sky is blue", scope });
    const results = await backend.query(scope, "sky blue", 10);
    expect(results.length).toBe(1);
    expect(results[0]!.content).toBe("the sky is blue");
    expect(results[0]!.scope).toEqual(scope);
  });

  it("returns empty for different scope", async () => {
    await backend.store({ content: "hello world", scope });
    const results = await backend.query(teamScope, "hello", 10);
    expect(results).toEqual([]);
  });

  it("generated id is a valid UUID", async () => {
    const id = await backend.store({ content: "uuid test", scope });
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(uuidRegex.test(id)).toBe(true);
  });

  it("createdAt is set automatically", async () => {
    const before = new Date().toISOString();
    await backend.store({ content: "timestamp test", scope });
    const after = new Date().toISOString();
    const results = await backend.query(scope, "timestamp test", 1);
    const createdAt = results[0]!.createdAt;
    expect(createdAt >= before).toBe(true);
    expect(createdAt <= after).toBe(true);
  });

  it("removes entry by id, returns true", async () => {
    const id = await backend.store({ content: "to remove", scope });
    expect(await backend.remove(id)).toBe(true);
    const results = await backend.query(scope, "to remove", 10);
    expect(results.length).toBe(0);
  });

  it("returns false for removing non-existent id", async () => {
    expect(await backend.remove("non-existent-id")).toBe(false);
  });

  it("clears all entries for a scope without affecting other scopes", async () => {
    await backend.store({ content: "alice entry one", scope });
    await backend.store({ content: "alice entry two", scope });
    await backend.store({ content: "team entry", scope: teamScope });
    await backend.clear(scope);
    const aliceResults = await backend.query(scope, "alice entry", 10);
    expect(aliceResults).toEqual([]);
    const teamResults = await backend.query(teamScope, "team entry", 10);
    expect(teamResults.length).toBe(1);
  });

  it("limits results to k", async () => {
    await backend.store({ content: "alpha word", scope });
    await backend.store({ content: "beta word", scope });
    await backend.store({ content: "gamma word", scope });
    const results = await backend.query(scope, "word", 2);
    expect(results.length).toBe(2);
  });

  it("keyword search ranks by overlap (higher overlap = higher score)", async () => {
    await backend.store({ content: "apple banana cherry", scope });
    await backend.store({ content: "apple banana", scope });
    await backend.store({ content: "apple", scope });
    const results = await backend.query(scope, "apple banana cherry", 3);
    expect(results[0]!.content).toBe("apple banana cherry");
    expect(results[1]!.content).toBe("apple banana");
    expect(results[2]!.content).toBe("apple");
  });

  it("stores and retrieves metadata correctly (JSON round-trip)", async () => {
    const meta = { source: "test", priority: 5, tags: ["a", "b"] };
    await backend.store({ content: "with meta", scope, metadata: meta });
    const results = await backend.query(scope, "with meta", 1);
    expect(results[0]!.metadata).toEqual(meta);
  });

  it("stores and retrieves embedding correctly (JSON round-trip)", async () => {
    const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
    await backend.store({ content: "with embedding", scope, embedding });
    const results = await backend.query(scope, "with embedding", 1);
    expect(results[0]!.embedding).toEqual(embedding);
  });

  it("handles NULL metadata (no metadata field)", async () => {
    await backend.store({ content: "no meta", scope });
    const results = await backend.query(scope, "no meta", 1);
    expect(results[0]!.metadata).toBeUndefined();
  });

  it("handles NULL embedding (no embedding field)", async () => {
    await backend.store({ content: "no embed", scope });
    const results = await backend.query(scope, "no embed", 1);
    expect(results[0]!.embedding).toBeUndefined();
  });

  it("entry has exactly the MemoryEntry fields (no extras)", async () => {
    await backend.store({ content: "check fields", scope });
    const results = await backend.query(scope, "check fields", 1);
    const entry = results[0]!;
    const keys = Object.keys(entry).sort();
    // Only id, content, scope, createdAt should be present (no metadata/embedding when null)
    expect(keys).toEqual(["content", "createdAt", "id", "scope"]);
  });

  it("multiple entries in same scope, query returns most relevant", async () => {
    await backend.store({ content: "dogs and cats are pets", scope });
    await backend.store({ content: "the weather is sunny today", scope });
    await backend.store({ content: "cats love fish", scope });
    const results = await backend.query(scope, "cats fish", 1);
    expect(results[0]!.content).toBe("cats love fish");
  });

  it("persists across queries (not in-memory)", async () => {
    const db = new Database(":memory:");
    const b = new SqliteMemoryBackend(db as never);
    const id = await b.store({ content: "persistent data", scope });
    // Create a new backend instance on the same database
    const b2 = new SqliteMemoryBackend(db as never);
    const results = await b2.query(scope, "persistent data", 10);
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe(id);
  });

  it("custom table name works", async () => {
    const db = new Database(":memory:");
    const b = new SqliteMemoryBackend(db as never, {
      tableName: "custom_mem",
    });
    await b.store({ content: "custom table", scope });
    const results = await b.query(scope, "custom table", 10);
    expect(results.length).toBe(1);
    // Verify the custom table exists
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='custom_mem'",
    ).get() as { name: string } | null;
    expect(row).not.toBeNull();
    expect(row!.name).toBe("custom_mem");
  });

  it("concurrent writes don't corrupt (store 100 entries rapidly)", async () => {
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(backend.store({ content: `entry ${i}`, scope }));
    }
    const ids = await Promise.all(promises);
    expect(ids.length).toBe(100);
    // All ids should be unique
    expect(new Set(ids).size).toBe(100);
    // Query back with a broad term
    const results = await backend.query(scope, "entry", 200);
    expect(results.length).toBe(100);
  });

  it("empty query string returns entries", async () => {
    await backend.store({ content: "alpha", scope });
    await backend.store({ content: "beta", scope });
    const results = await backend.query(scope, "", 10);
    // Empty query has zero-length terms, so keywordOverlap returns 0 for all entries.
    // All entries get equal score (0), so all are returned up to k.
    expect(results.length).toBe(2);
  });

  it("very long content is stored correctly (10KB+)", async () => {
    const longContent = "word ".repeat(2500); // ~12.5KB
    await backend.store({ content: longContent, scope });
    const results = await backend.query(scope, "word", 1);
    expect(results[0]!.content).toBe(longContent);
  });

  it("special characters in content (quotes, newlines, unicode)", async () => {
    const content = `He said "hello"\nShe replied 'world'\tTab\u00e9\u00e8\u00ea\u2603\u{1F600}`;
    await backend.store({ content, scope });
    const results = await backend.query(scope, "hello world", 1);
    expect(results[0]!.content).toBe(content);
  });

  it("scope with special characters works", async () => {
    const weirdScope: MemoryScope = {
      type: "org/team",
      id: 'user:"alice"',
    };
    await backend.store({ content: "scoped data", scope: weirdScope });
    const results = await backend.query(weirdScope, "scoped data", 10);
    expect(results.length).toBe(1);
    expect(results[0]!.scope).toEqual(weirdScope);
    // Ensure it doesn't leak into normal scope
    const normalResults = await backend.query(scope, "scoped data", 10);
    expect(normalResults).toEqual([]);
  });

  it("table is created automatically on construction", async () => {
    const db = new Database(":memory:");
    new SqliteMemoryBackend(db as never);
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='capstan_memories'",
    ).get() as { name: string } | null;
    expect(row).not.toBeNull();
    expect(row!.name).toBe("capstan_memories");
  });

  it("rejects invalid table names (SQL injection prevention)", () => {
    const db = new Database(":memory:");
    expect(() => new SqliteMemoryBackend(db as never, { tableName: "Robert'); DROP TABLE students;--" })).toThrow("Invalid table name");
    expect(() => new SqliteMemoryBackend(db as never, { tableName: "table with spaces" })).toThrow("Invalid table name");
    expect(() => new SqliteMemoryBackend(db as never, { tableName: "123start" })).toThrow("Invalid table name");
    // Valid names should not throw
    expect(() => new SqliteMemoryBackend(db as never, { tableName: "valid_name" })).not.toThrow();
    expect(() => new SqliteMemoryBackend(db as never, { tableName: "_private" })).not.toThrow();
    expect(() => new SqliteMemoryBackend(db as never, { tableName: "CamelCase123" })).not.toThrow();
  });

  it("handles corrupted JSON in embedding/metadata columns gracefully", async () => {
    const db = new Database(":memory:");
    const mem = new SqliteMemoryBackend(db as never);
    // Manually insert a row with bad JSON
    db.exec(`INSERT INTO capstan_memories (id, content, scope_type, scope_id, embedding, metadata, created_at) VALUES ('bad', 'test content', 'w', 'x', 'not-json', '{broken', '2024-01-01')`);
    const results = await mem.query({ type: "w", id: "x" }, "test content", 10);
    // Should not throw, just return entry without embedding/metadata
    expect(results.length).toBe(1);
    expect(results[0]!.content).toBe("test content");
    expect(results[0]!.embedding).toBeUndefined();
    expect(results[0]!.metadata).toBeUndefined();
  });

  it("filters zero-score entries when query has terms (aligns with BuiltinMemoryBackend)", async () => {
    await backend.store({ content: "apples and oranges", scope });
    await backend.store({ content: "cats and dogs", scope });
    // Search for "elephants" — no keyword overlap
    const results = await backend.query(scope, "elephants", 10);
    expect(results).toEqual([]);
  });
});

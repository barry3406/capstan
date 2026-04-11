import { describe, it, expect } from "bun:test";
import { BuiltinMemoryBackend } from "../../packages/ai/src/memory.js";
import type { MemoryEntry, MemoryScope, MemoryEmbedder } from "../../packages/ai/src/types.js";

describe("BuiltinMemoryBackend (simplified)", () => {
  const scope: MemoryScope = { type: "agent", id: "a1" };

  it("stores and queries entries by scope", async () => {
    const backend = new BuiltinMemoryBackend();
    await backend.store({ content: "the sky is blue", scope });
    const results = await backend.query(scope, "sky blue", 10);
    expect(results.length).toBe(1);
    expect(results[0]!.content).toBe("the sky is blue");
    expect(results[0]!.scope).toEqual(scope);
  });

  it("returns empty for different scope", async () => {
    const backend = new BuiltinMemoryBackend();
    await backend.store({ content: "hello world", scope });
    const other: MemoryScope = { type: "agent", id: "other" };
    const results = await backend.query(other, "hello", 10);
    expect(results).toEqual([]);
  });

  it("removes an entry by id", async () => {
    const backend = new BuiltinMemoryBackend();
    const id = await backend.store({ content: "to remove", scope });
    expect(await backend.remove(id)).toBe(true);
    const results = await backend.query(scope, "to remove", 10);
    expect(results.length).toBe(0);
  });

  it("returns false when removing non-existent id", async () => {
    const backend = new BuiltinMemoryBackend();
    expect(await backend.remove("non-existent-id")).toBe(false);
  });

  it("clears all entries for a scope", async () => {
    const backend = new BuiltinMemoryBackend();
    await backend.store({ content: "first", scope });
    await backend.store({ content: "second", scope });
    await backend.clear(scope);
    const results = await backend.query(scope, "first second", 10);
    expect(results).toEqual([]);
  });

  it("limits results to k", async () => {
    const backend = new BuiltinMemoryBackend();
    await backend.store({ content: "alpha word", scope });
    await backend.store({ content: "beta word", scope });
    await backend.store({ content: "gamma word", scope });
    const results = await backend.query(scope, "word", 2);
    expect(results.length).toBe(2);
  });

  it("keyword search ranks by overlap", async () => {
    const backend = new BuiltinMemoryBackend();
    await backend.store({ content: "apple banana cherry", scope });
    await backend.store({ content: "apple banana", scope });
    await backend.store({ content: "apple", scope });
    const results = await backend.query(scope, "apple banana cherry", 3);
    // Most overlap first
    expect(results[0]!.content).toBe("apple banana cherry");
    expect(results[1]!.content).toBe("apple banana");
    expect(results[2]!.content).toBe("apple");
  });

  it("stores metadata and returns it", async () => {
    const backend = new BuiltinMemoryBackend();
    const meta = { source: "test", priority: 5 };
    const id = await backend.store({ content: "with meta", scope, metadata: meta });
    const results = await backend.query(scope, "with meta", 1);
    expect(results[0]!.metadata).toEqual(meta);
    expect(results[0]!.id).toBe(id);
  });

  it("uses embeddings for semantic search when provider is set", async () => {
    // Simple mock embedder: encodes words as indices in a fixed vocabulary
    const vocab = ["cat", "dog", "fish", "red", "blue", "green"];
    const embedder: MemoryEmbedder = {
      dimensions: vocab.length,
      async embed(texts: string[]) {
        return texts.map((t) => {
          const words = t.toLowerCase().split(/\s+/);
          return vocab.map((v) => (words.includes(v) ? 1 : 0));
        });
      },
    };
    const backend = new BuiltinMemoryBackend({ embedding: embedder });
    await backend.store({ content: "cat dog", scope });
    await backend.store({ content: "red blue green", scope });
    const results = await backend.query(scope, "cat fish", 2);
    // "cat dog" should rank higher than "red blue green" for query "cat fish"
    expect(results[0]!.content).toBe("cat dog");
  });

  it("deduplicates entries with very similar embeddings", async () => {
    // Embedder that always returns identical vectors -> similarity = 1.0 > 0.92 threshold
    const embedder: MemoryEmbedder = {
      dimensions: 3,
      async embed(_texts: string[]) {
        return _texts.map(() => [1, 0, 0]);
      },
    };
    const backend = new BuiltinMemoryBackend({ embedding: embedder });
    const id1 = await backend.store({ content: "first entry", scope });
    const id2 = await backend.store({ content: "second entry", scope });
    // Should dedup — id2 should be same as id1
    expect(id2).toBe(id1);
    const results = await backend.query(scope, "entry", 10);
    expect(results.length).toBe(1);
    // Merged content
    expect(results[0]!.content).toContain("first entry");
    expect(results[0]!.content).toContain("second entry");
  });

  it("entry has no importance, type, accessCount, lastAccessedAt, or updatedAt", async () => {
    const backend = new BuiltinMemoryBackend();
    await backend.store({ content: "check fields", scope });
    const results = await backend.query(scope, "check fields", 1);
    const entry = results[0]!;
    expect(entry.id).toBeDefined();
    expect(entry.content).toBe("check fields");
    expect(entry.scope).toEqual(scope);
    expect(entry.createdAt).toBeDefined();
    // These fields must NOT exist
    expect("importance" in entry).toBe(false);
    expect("type" in entry).toBe(false);
    expect("accessCount" in entry).toBe(false);
    expect("lastAccessedAt" in entry).toBe(false);
    expect("updatedAt" in entry).toBe(false);
  });
});

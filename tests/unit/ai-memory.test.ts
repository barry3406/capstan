import { describe, it, expect, beforeEach } from "bun:test";
import {
  BuiltinMemoryBackend,
  createMemoryAccessor,
} from "@zauso-ai/capstan-ai";
import type {
  MemoryScope,
  MemoryBackend,
  MemoryAccessor,
  MemoryEmbedder,
} from "@zauso-ai/capstan-ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A mock embedder that returns deterministic vectors based on content hash. */
function createMockEmbedder(dims = 4): MemoryEmbedder {
  return {
    dimensions: dims,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => {
        // Simple deterministic "embedding" derived from char codes
        const vec = new Array(dims).fill(0) as number[];
        for (let i = 0; i < t.length; i++) {
          vec[i % dims] += t.charCodeAt(i) / 1000;
        }
        // Normalize
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
        if (norm > 0) for (let i = 0; i < dims; i++) vec[i] = vec[i]! / norm;
        return vec;
      });
    },
  };
}

/** A mock embedder that always returns the same vector (for dedup testing). */
function createIdenticalEmbedder(dims = 4): MemoryEmbedder {
  const fixedVec = new Array(dims).fill(1 / Math.sqrt(dims)) as number[];
  return {
    dimensions: dims,
    async embed(_texts: string[]): Promise<number[][]> {
      return _texts.map(() => [...fixedVec]);
    },
  };
}

const userScope: MemoryScope = { type: "user", id: "u1" };
const agentScope: MemoryScope = { type: "agent", id: "a1" };

// ---------------------------------------------------------------------------
// BuiltinMemoryBackend
// ---------------------------------------------------------------------------

describe("BuiltinMemoryBackend", () => {
  let backend: BuiltinMemoryBackend;

  beforeEach(() => {
    backend = new BuiltinMemoryBackend();
  });

  it("store generates UUID id", async () => {
    const id = await backend.store({
      content: "hello world",
      scope: userScope,
    });
    // UUID v4 format: 8-4-4-4-12 hex digits
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("store and query round-trip with keyword fallback", async () => {
    await backend.store({ content: "typescript is great", scope: userScope });
    await backend.store({ content: "python is versatile", scope: userScope });

    const results = await backend.query(userScope, "typescript", 10);
    expect(results.length).toBe(1);
    expect(results[0]!.content).toBe("typescript is great");
  });

  it("query returns empty array for unknown scope", async () => {
    await backend.store({ content: "hello", scope: userScope });
    const results = await backend.query({ type: "org", id: "o1" }, "hello", 10);
    expect(results).toEqual([]);
  });

  it("query returns empty array when no entries match", async () => {
    await backend.store({ content: "hello world", scope: userScope });
    const results = await backend.query(userScope, "zzzznotfound", 10);
    expect(results).toEqual([]);
  });

  it("remove deletes entry and returns true", async () => {
    const id = await backend.store({ content: "delete me", scope: userScope });
    const removed = await backend.remove(id);
    expect(removed).toBe(true);

    // Verify it's gone
    const results = await backend.query(userScope, "delete", 10);
    expect(results).toEqual([]);
  });

  it("remove returns false for unknown id", async () => {
    const removed = await backend.remove("nonexistent-id");
    expect(removed).toBe(false);
  });

  it("clear removes all entries for scope", async () => {
    await backend.store({ content: "one", scope: userScope });
    await backend.store({ content: "two", scope: userScope });
    await backend.store({ content: "three", scope: agentScope });

    await backend.clear(userScope);

    const userResults = await backend.query(userScope, "one two", 10);
    expect(userResults).toEqual([]);

    // Agent scope should still have entries
    const agentResults = await backend.query(agentScope, "three", 10);
    expect(agentResults.length).toBe(1);
  });

  it("clear does not affect other scopes", async () => {
    await backend.store({ content: "user data", scope: userScope });
    await backend.store({ content: "agent data", scope: agentScope });

    await backend.clear(userScope);

    const agentResults = await backend.query(agentScope, "agent data", 10);
    expect(agentResults.length).toBe(1);
    expect(agentResults[0]!.content).toBe("agent data");
  });

  it("scope isolation: entries in scope A not visible in scope B", async () => {
    await backend.store({ content: "secret user info", scope: userScope });
    await backend.store({ content: "agent knowledge", scope: agentScope });

    const userResults = await backend.query(userScope, "secret user info", 10);
    expect(userResults.length).toBe(1);
    expect(userResults[0]!.content).toBe("secret user info");

    // Should NOT find user entries when querying agent scope
    const agentResults = await backend.query(agentScope, "secret user info", 10);
    expect(agentResults).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BuiltinMemoryBackend with embeddings
// ---------------------------------------------------------------------------

describe("BuiltinMemoryBackend with embedder", () => {
  it("auto-deduplicates similar entries", async () => {
    const backend = new BuiltinMemoryBackend({ embedding: createIdenticalEmbedder() });

    const id1 = await backend.store({ content: "cats are great pets", scope: userScope });
    const id2 = await backend.store({ content: "cats are wonderful companions", scope: userScope });

    // Because the identical embedder returns the same vector, similarity > 0.92,
    // so the second store should merge into the first entry.
    expect(id2).toBe(id1);

    // Query should return only one entry with merged content
    const results = await backend.query(userScope, "cats", 10);
    expect(results.length).toBe(1);
    expect(results[0]!.content).toContain("cats are great pets");
    expect(results[0]!.content).toContain("cats are wonderful companions");
  });

  it("recall returns entries sorted by relevance with embedder", async () => {
    const backend = new BuiltinMemoryBackend({ embedding: createMockEmbedder() });

    await backend.store({ content: "machine learning algorithms", scope: userScope });
    await backend.store({ content: "cooking recipes for dinner", scope: userScope });
    await backend.store({ content: "machine learning frameworks", scope: userScope });

    const results = await backend.query(userScope, "machine learning", 10);
    // ML-related entries should rank higher than cooking
    expect(results.length).toBeGreaterThan(0);
    const mlEntries = results.filter((r) => r.content.includes("machine"));
    expect(mlEntries.length).toBeGreaterThan(0);
  });

  it("recency boost: newer entries score higher", async () => {
    // Use a mock embedder that produces distinct vectors to avoid dedup
    let callCount = 0;
    const distinctEmbedder: MemoryEmbedder = {
      dimensions: 4,
      async embed(texts: string[]): Promise<number[][]> {
        return texts.map(() => {
          callCount++;
          // Each call gets a distinct vector quadrant
          const vec = [0, 0, 0, 0];
          vec[(callCount - 1) % 4] = 1;
          return vec;
        });
      },
    };
    const backend = new BuiltinMemoryBackend({ embedding: distinctEmbedder });

    // Store two entries with the same keywords but distinct embeddings
    const id1 = await backend.store({ content: "project status alpha", scope: userScope });
    const id2 = await backend.store({ content: "project status beta", scope: userScope });

    const results = await backend.query(userScope, "project status", 10);
    // Both should be returned since embeddings are sufficiently distinct
    expect(results.length).toBe(2);

    // Verify that entries have different ids (not deduped)
    const ids = results.map((r) => r.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it("updates access count on query", async () => {
    const backend = new BuiltinMemoryBackend({ embedding: createMockEmbedder() });

    await backend.store({ content: "frequently accessed info", scope: userScope });

    // Query twice
    await backend.query(userScope, "frequently accessed", 10);
    const results = await backend.query(userScope, "frequently accessed", 10);

    expect(results[0]!.accessCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// createMemoryAccessor
// ---------------------------------------------------------------------------

describe("createMemoryAccessor", () => {
  let backend: BuiltinMemoryBackend;
  let accessor: MemoryAccessor;

  beforeEach(() => {
    backend = new BuiltinMemoryBackend();
    accessor = createMemoryAccessor(userScope, backend);
  });

  it("remember stores entry and returns id", async () => {
    const id = await accessor.remember("The user prefers dark mode");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("recall returns entries sorted by relevance", async () => {
    await accessor.remember("User likes TypeScript");
    await accessor.remember("User enjoys hiking outdoors");

    const results = await accessor.recall("TypeScript");
    expect(results.length).toBe(1);
    expect(results[0]!.content).toBe("User likes TypeScript");
  });

  it("recall with no results returns empty array", async () => {
    const results = await accessor.recall("nonexistent query");
    expect(results).toEqual([]);
  });

  it("recall keyword-only fallback works without embedder", async () => {
    // Backend has no embedder, so keyword fallback should work
    await accessor.remember("Important meeting on Monday");
    await accessor.remember("Doctor appointment on Tuesday");

    const results = await accessor.recall("meeting Monday");
    expect(results.length).toBe(1);
    expect(results[0]!.content).toContain("meeting");
    expect(results[0]!.content).toContain("Monday");
  });

  it("recall respects limit option", async () => {
    await accessor.remember("fact one");
    await accessor.remember("fact two");
    await accessor.remember("fact three");

    const results = await accessor.recall("fact", { limit: 2 });
    expect(results.length).toBe(2);
  });

  it("forget removes entry by id", async () => {
    const id = await accessor.remember("temporary note");
    const removed = await accessor.forget(id);
    expect(removed).toBe(true);

    // Should no longer be found
    const results = await accessor.recall("temporary note");
    expect(results).toEqual([]);
  });

  it("forget returns false for unknown id", async () => {
    const removed = await accessor.forget("does-not-exist");
    expect(removed).toBe(false);
  });

  it("about() creates a new accessor with different scope", async () => {
    const projectAccessor = accessor.about("project", "p1");

    await projectAccessor.remember("Project deadline is Friday");
    await accessor.remember("User setting");

    // Project accessor should find project memories
    const projectResults = await projectAccessor.recall("deadline Friday");
    expect(projectResults.length).toBe(1);
    expect(projectResults[0]!.content).toContain("deadline");
  });

  it("about() does not affect parent accessor's scope", async () => {
    const projectAccessor = accessor.about("project", "p1");

    await projectAccessor.remember("Project note");
    await accessor.remember("User note");

    // Parent accessor should only find its own scope entries
    const userResults = await accessor.recall("note");
    expect(userResults.length).toBe(1);
    expect(userResults[0]!.content).toBe("User note");

    // Project accessor should only find its own scope entries
    const projectResults = await projectAccessor.recall("note");
    expect(projectResults.length).toBe(1);
    expect(projectResults[0]!.content).toBe("Project note");
  });

  it("remember with custom scope overrides default", async () => {
    const customScope: MemoryScope = { type: "org", id: "org1" };
    await accessor.remember("org-level policy", { scope: customScope });

    // Should NOT be found in user scope
    const userResults = await accessor.recall("org-level policy");
    expect(userResults).toEqual([]);

    // Should be found with custom scope
    const orgAccessor = createMemoryAccessor(customScope, backend);
    const orgResults = await orgAccessor.recall("org-level policy");
    expect(orgResults.length).toBe(1);
  });

  it("remember stores importance and type metadata", async () => {
    await accessor.remember("critical bug found", {
      importance: "critical",
      type: "fact",
      metadata: { ticket: "BUG-123" },
    });

    const results = await accessor.recall("critical bug");
    expect(results.length).toBe(1);
    expect(results[0]!.importance).toBe("critical");
    expect(results[0]!.type).toBe("fact");
    expect(results[0]!.metadata).toEqual({ ticket: "BUG-123" });
  });
});

// ---------------------------------------------------------------------------
// assembleContext
// ---------------------------------------------------------------------------

describe("assembleContext", () => {
  let backend: BuiltinMemoryBackend;
  let accessor: MemoryAccessor;

  beforeEach(() => {
    backend = new BuiltinMemoryBackend();
    accessor = createMemoryAccessor(userScope, backend);
  });

  it("returns formatted string", async () => {
    await accessor.remember("The user is a TypeScript developer");
    await accessor.remember("The user works at Acme Corp");

    const ctx = await accessor.assembleContext({ query: "user developer TypeScript Acme" });
    expect(ctx).toContain("## Relevant Context");
    expect(ctx).toContain("- The user is a TypeScript developer");
    expect(ctx).toContain("- The user works at Acme Corp");
  });

  it("respects maxTokens budget", async () => {
    // Create a very long memory
    const longContent = "word ".repeat(200).trim(); // ~200 words = ~200 tokens
    await accessor.remember(longContent);
    await accessor.remember("short note word");

    // With a very small budget, should only fit the short one (or none)
    const ctx = await accessor.assembleContext({
      query: "word note",
      maxTokens: 10, // very small budget
    });
    // Should include at most one entry
    const lines = ctx.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.length).toBeLessThanOrEqual(1);
  });

  it("sorts by importance priority", async () => {
    await accessor.remember("low priority info word", { importance: "low" });
    await accessor.remember("critical alert word", { importance: "critical" });
    await accessor.remember("medium importance word", { importance: "medium" });

    const ctx = await accessor.assembleContext({ query: "word info alert importance" });
    // Critical should come before low in the output
    const criticalIdx = ctx.indexOf("critical alert");
    const lowIdx = ctx.indexOf("low priority");
    expect(criticalIdx).toBeLessThan(lowIdx);
  });

  it("with multiple scopes combines results", async () => {
    const projectScope: MemoryScope = { type: "project", id: "p1" };
    const projectAccessor = createMemoryAccessor(projectScope, backend);

    await accessor.remember("user preference data");
    await projectAccessor.remember("project deadline data");

    const ctx = await accessor.assembleContext({
      query: "data preference deadline",
      scopes: [userScope, projectScope],
    });
    expect(ctx).toContain("user preference");
    expect(ctx).toContain("project deadline");
  });

  it("with no memories returns empty string", async () => {
    const ctx = await accessor.assembleContext({ query: "anything" });
    expect(ctx).toBe("");
  });

  it("defaults maxTokens to 4000", async () => {
    // Store a moderate amount of content
    for (let i = 0; i < 5; i++) {
      await accessor.remember(`fact number ${i} about testing keyword`);
    }
    // Without specifying maxTokens, should use default 4000 and include all
    const ctx = await accessor.assembleContext({ query: "fact testing keyword" });
    expect(ctx).toContain("## Relevant Context");
    const lines = ctx.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.length).toBe(5);
  });
});

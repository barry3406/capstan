import type {
  MemoryAccessor,
  MemoryEntry,
  MemoryScope,
  RecallOptions,
  RememberOptions,
  AssembleContextOptions,
  MemoryBackend,
  MemoryEmbedder,
} from "./types.js";

/** Compute a deterministic scope key */
function scopeKey(scope: MemoryScope): string {
  return `${scope.type}:${scope.id}`;
}

/**
 * Built-in memory backend using in-memory storage + optional embeddings.
 * No external dependencies. Works without an embedding provider (keyword-only fallback).
 */
export class BuiltinMemoryBackend implements MemoryBackend {
  private entries = new Map<string, Map<string, MemoryEntry>>(); // scopeKey -> id -> entry
  private embedder?: MemoryEmbedder;

  constructor(opts?: { embedding?: MemoryEmbedder | undefined }) {
    if (opts?.embedding) this.embedder = opts.embedding;
  }

  async store(
    entry: Omit<MemoryEntry, "id" | "createdAt">,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const key = scopeKey(entry.scope);

    // Generate embedding if adapter available
    let embedding: number[] | undefined;
    if (this.embedder) {
      const [vec] = await this.embedder.embed([entry.content]);
      embedding = vec;
    }

    // Dedup: check for very similar existing entries
    const scopeEntries = this.entries.get(key);
    if (scopeEntries && embedding) {
      for (const existing of scopeEntries.values()) {
        if (existing.embedding) {
          const similarity = 1 - cosineDistanceSimple(embedding, existing.embedding);
          if (similarity > 0.92) {
            // Merge: update existing instead of creating new
            existing.content = `${existing.content}\n${entry.content}`;
            existing.embedding = embedding;
            return existing.id;
          }
        }
      }
    }

    const full: MemoryEntry = {
      id,
      content: entry.content,
      scope: entry.scope,
      createdAt: now,
      ...(embedding ? { embedding } : {}),
      ...(entry.importance ? { importance: entry.importance } : {}),
      ...(entry.type ? { type: entry.type } : {}),
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
    };

    if (!this.entries.has(key)) this.entries.set(key, new Map());
    this.entries.get(key)!.set(id, full);
    return id;
  }

  async query(scope: MemoryScope, text: string, k: number): Promise<MemoryEntry[]> {
    const key = scopeKey(scope);
    const scopeEntries = this.entries.get(key);
    if (!scopeEntries || scopeEntries.size === 0) return [];

    const entries = [...scopeEntries.values()];

    // Empty query returns all entries (up to k) — used by reconciler to fetch full scope
    if (text === "") {
      return entries.slice(0, k);
    }

    // If we have an embedder, do hybrid search
    if (this.embedder) {
      const [queryVec] = await this.embedder.embed([text]);
      const scored = entries.map((e) => {
        let score = 0;
        if (e.embedding) {
          score = 1 - cosineDistanceSimple(queryVec!, e.embedding);
        }
        // Keyword boost
        const queryTerms = text.toLowerCase().split(/\W+/).filter((t) => t.length > 0);
        const contentTerms = e.content.toLowerCase().split(/\W+/).filter((t) => t.length > 0);
        const overlap = queryTerms.filter((t) => contentTerms.includes(t)).length;
        score = score * 0.7 + (overlap / Math.max(queryTerms.length, 1)) * 0.3;
        return { entry: e, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const results = scored.slice(0, k).map((s) => s.entry);
      for (const r of results) {
        r.accessCount = (r.accessCount ?? 0) + 1;
      }
      return results;
    }

    // Keyword-only fallback
    const queryTerms = text.toLowerCase().split(/\W+/).filter((t) => t.length > 0);
    const scored = entries
      .map((e) => {
        const contentTerms = e.content.toLowerCase().split(/\W+/).filter((t) => t.length > 0);
        const overlap = queryTerms.filter((t) => contentTerms.includes(t)).length;
        return { entry: e, score: overlap / Math.max(queryTerms.length, 1) };
      })
      .filter((s) => s.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => s.entry);
  }

  async remove(id: string): Promise<boolean> {
    for (const scope of this.entries.values()) {
      if (scope.delete(id)) return true;
    }
    return false;
  }

  async clear(scope: MemoryScope): Promise<void> {
    this.entries.delete(scopeKey(scope));
  }
}

/**
 * Create a MemoryAccessor scoped to a specific entity.
 */
export function createMemoryAccessor(scope: MemoryScope, backend: MemoryBackend): MemoryAccessor {
  return {
    async remember(content: string, opts?: RememberOptions): Promise<string> {
      const effectiveScope = opts?.scope ?? scope;
      return backend.store({
        content,
        scope: effectiveScope,
        importance: opts?.importance,
        type: opts?.type,
        metadata: opts?.metadata,
      });
    },

    async recall(query: string, opts?: RecallOptions): Promise<MemoryEntry[]> {
      const effectiveScope = opts?.scope ?? scope;
      return backend.query(effectiveScope, query, opts?.limit ?? 10);
    },

    async forget(entryId: string): Promise<boolean> {
      return backend.remove(entryId);
    },

    about(type: string, id: string): MemoryAccessor {
      return createMemoryAccessor({ type, id }, backend);
    },

    async assembleContext(opts: AssembleContextOptions): Promise<string> {
      const scopes = opts.scopes ?? [scope];
      const maxTokens = opts.maxTokens ?? 4000;

      const allMemories: MemoryEntry[] = [];
      for (const s of scopes) {
        const results = await backend.query(s, opts.query, 20);
        allMemories.push(...results);
      }

      const priority: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      allMemories.sort(
        (a, b) => (priority[b.importance ?? "medium"] ?? 2) - (priority[a.importance ?? "medium"] ?? 2),
      );

      let tokenCount = 0;
      const packed: string[] = [];
      for (const mem of allMemories) {
        const estTokens = Math.ceil(mem.content.length / 4);
        if (tokenCount + estTokens > maxTokens) break;
        packed.push(`- ${mem.content}`);
        tokenCount += estTokens;
      }

      if (packed.length === 0) return "";
      return `## Relevant Context\n\n${packed.join("\n")}`;
    },
  };
}

// Simple cosine distance without importing from db package (keeps ai package independent)
function cosineDistanceSimple(a: number[], b: number[]): number {
  if (a.length !== b.length) return 1; // Max distance for mismatched vectors
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

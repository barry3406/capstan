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
    entry: Omit<MemoryEntry, "id" | "accessCount" | "lastAccessedAt" | "createdAt" | "updatedAt">,
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
            existing.updatedAt = now;
            existing.embedding = embedding; // re-embed merged content would be ideal, use latest for now
            return existing.id;
          }
        }
      }
    }

    const full: MemoryEntry = {
      ...entry,
      id,
      embedding,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      lastAccessedAt: now,
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

    // If we have an embedder, do hybrid search
    if (this.embedder) {
      const [queryVec] = await this.embedder.embed([text]);
      // Score by vector similarity
      const scored = entries.map((e) => {
        let score = 0;
        if (e.embedding) {
          score = 1 - cosineDistanceSimple(queryVec!, e.embedding);
        }
        // Keyword boost
        const queryTerms = text.toLowerCase().split(/\s+/);
        const contentTerms = e.content.toLowerCase().split(/\s+/);
        const overlap = queryTerms.filter((t) => contentTerms.includes(t)).length;
        score = score * 0.7 + (overlap / Math.max(queryTerms.length, 1)) * 0.3;
        // Recency boost (30-day half-life)
        const ageMs = Date.now() - new Date(e.updatedAt).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        score *= 1 + 0.1 * Math.exp(-ageDays / 30);
        return { entry: e, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const results = scored.slice(0, k).map((s) => s.entry);
      // Update access counts
      for (const r of results) {
        r.accessCount++;
        r.lastAccessedAt = new Date().toISOString();
      }
      return results;
    }

    // Keyword-only fallback
    const queryTerms = text.toLowerCase().split(/\s+/);
    const scored = entries
      .map((e) => {
        const contentTerms = e.content.toLowerCase().split(/\s+/);
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

// Simple cosine distance without importing from db package (keeps ai package independent)
function cosineDistanceSimple(a: number[], b: number[]): number {
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
        type: opts?.type,
        importance: opts?.importance,
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

      // Recall from all scopes
      const allMemories: MemoryEntry[] = [];
      for (const s of scopes) {
        const results = await backend.query(s, opts.query, 20);
        allMemories.push(...results);
      }

      // Sort by importance priority
      const priority: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      allMemories.sort(
        (a, b) => (priority[b.importance ?? "medium"] ?? 2) - (priority[a.importance ?? "medium"] ?? 2),
      );

      // Pack into token budget
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

import type { LLMProvider, MemoryEntry, MemoryReconciler, ReconcileResult, MemoryOperation, MemoryBackend, MemoryScope } from "./types.js";

const RECONCILE_SYSTEM_PROMPT = `You are a memory manager for an AI agent. You will be given the agent's current memory entries and a new fact. Your job is to analyze how the new fact affects existing memories.

For each affected memory, decide:
- "keep" — the memory is still valid. Optionally add a "context" annotation.
- "supersede" — the new fact replaces this memory. It is no longer true.
- "revise" — the memory needs updating. Provide the revised content.
- "remove" — the memory is completely obsolete and should be deleted.

You may also suggest additional new memories that should be created based on implications of the new fact.

Respond with JSON only:
{
  "operations": [
    { "id": "mem_xxx", "action": "supersede", "reason": "..." },
    { "id": "mem_yyy", "action": "revise", "reason": "...", "revised": "new content" },
    { "id": "mem_zzz", "action": "keep", "reason": "still valid", "context": "note about changed context" }
  ],
  "newMemories": [
    "additional fact implied by the new information"
  ]
}

Rules:
- Only include memories that are AFFECTED. Don't list unaffected memories.
- "supersede" means the old fact is no longer true. Not just outdated — actually wrong now.
- "revise" means the core fact is still partially true but needs correction.
- "keep" with context means still true but the surrounding context changed.
- "remove" means the memory has no value at all anymore.
- Be conservative: if unsure, use "keep".
- newMemories should only contain genuinely new information, not restatements.`;

export class LlmMemoryReconciler implements MemoryReconciler {
  constructor(private llm: LLMProvider) {}

  async reconcile(
    newContent: string,
    existingMemories: MemoryEntry[],
  ): Promise<ReconcileResult> {
    if (existingMemories.length === 0) {
      return { operations: [], newMemories: [] };
    }

    // Build the full memory list for the LLM — no filtering, no ranking, just everything
    // Each memory is wrapped in XML tags for structural separation (prompt injection defense)
    const memoryList = existingMemories
      .map(m => `<memory id="${m.id}">${m.content}</memory>`)
      .join("\n");

    if (memoryList.length === 0) {
      return { operations: [], newMemories: [] };
    }

    const userPrompt = `## Current memories\n${memoryList}\n\n## New fact\n${newContent}\n\nAnalyze the impact and respond with JSON.`;

    try {
      const response = await this.llm.chat(
        [
          { role: "system", content: RECONCILE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0 },
      );

      return parseReconcileResponse(response.content);
    } catch {
      // Reconciliation failure is non-fatal — just store the new fact without reconciling
      return { operations: [], newMemories: [] };
    }
  }
}

export function parseReconcileResponse(content: string): ReconcileResult {
  try {
    // Extract JSON from response (may be wrapped in markdown fences)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { operations: [], newMemories: [] };

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const operations: MemoryOperation[] = [];
    if (Array.isArray(parsed.operations)) {
      for (const op of parsed.operations) {
        if (
          typeof op === "object" && op !== null &&
          typeof (op as Record<string, unknown>).id === "string" &&
          typeof (op as Record<string, unknown>).action === "string" &&
          ["keep", "supersede", "revise", "remove"].includes((op as Record<string, unknown>).action as string)
        ) {
          operations.push({
            id: (op as Record<string, unknown>).id as string,
            action: (op as Record<string, unknown>).action as MemoryOperation["action"],
            reason: ((op as Record<string, unknown>).reason as string) ?? "",
            revised: (op as Record<string, unknown>).revised as string | undefined,
            context: (op as Record<string, unknown>).context as string | undefined,
          });
        }
      }
    }

    const newMemories: string[] = [];
    if (Array.isArray(parsed.newMemories)) {
      for (const m of parsed.newMemories) {
        if (typeof m === "string" && m.trim().length > 0) {
          newMemories.push(m);
        }
      }
    }

    return { operations, newMemories };
  } catch {
    return { operations: [], newMemories: [] };
  }
}

/**
 * Reconcile a new fact against existing memories and store the result.
 * Queries ALL active memories in scope, lets the LLM judge relationships,
 * then applies operations (supersede, revise, remove) before storing the new fact.
 */
export async function reconcileAndStore(
  backend: MemoryBackend,
  scope: MemoryScope,
  newContent: string,
  reconciler: MemoryReconciler,
  maxMemories?: number,
): Promise<{ storedId: string; operations: MemoryOperation[] }> {
  // Get ALL memories in scope (no filtering — LLM sees everything)
  const existing = await backend.query(scope, "", maxMemories ?? 10_000);

  // Let LLM judge
  const result = await reconciler.reconcile(newContent, existing);

  // Store the new fact FIRST — never lose new data even if operations fail (C2)
  const storedId = await backend.store({ content: newContent, scope });

  // Build set of valid IDs from presented memories to prevent cross-scope operations (C3)
  const validIds = new Set(existing.map(m => m.id));

  // Apply operations with individual error handling (C2)
  for (const op of result.operations) {
    if (!validIds.has(op.id)) continue; // Skip IDs outside this scope
    try {
      switch (op.action) {
        case "supersede":
        case "remove":
          await backend.remove(op.id);
          break;
        case "revise":
          if (op.revised) {
            await backend.remove(op.id);
            await backend.store({ content: op.revised, scope });
          }
          // If no revised content, treat as keep (no-op)
          break;
        case "keep":
          // No-op (optionally could annotate with context in the future)
          break;
      }
    } catch {
      // Individual operation failure is non-fatal
    }
  }

  // Store any additional memories the LLM suggested
  for (const mem of result.newMemories) {
    if (typeof mem === "string" && mem.trim().length > 0) {
      try {
        await backend.store({ content: mem, scope });
      } catch {
        // Non-fatal
      }
    }
  }

  return { storedId, operations: result.operations };
}

export { RECONCILE_SYSTEM_PROMPT };

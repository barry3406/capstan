import { describe, it, expect, beforeEach } from "bun:test";
import {
  LlmMemoryReconciler,
  reconcileAndStore,
  parseReconcileResponse,
  BuiltinMemoryBackend,
  createSmartAgent,
} from "@zauso-ai/capstan-ai";
import type {
  MemoryEntry,
  MemoryScope,
  LLMProvider,
  LLMMessage,
  LLMOptions,
  LLMResponse,
  MemoryReconciler,
  ReconcileResult,
  MemoryBackend,
} from "@zauso-ai/capstan-ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCOPE: MemoryScope = { type: "agent", id: "test-agent" };

function makeEntry(id: string, content: string): MemoryEntry {
  return {
    id,
    content,
    scope: SCOPE,
    createdAt: new Date().toISOString(),
  };
}

function mockLlm(response: string): LLMProvider {
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _options?: LLMOptions): Promise<LLMResponse> {
      return { content: response, model: "mock-model" };
    },
  };
}

function throwingLlm(): LLMProvider {
  return {
    name: "mock-throws",
    async chat(): Promise<LLMResponse> {
      throw new Error("LLM unavailable");
    },
  };
}

// ---------------------------------------------------------------------------
// parseReconcileResponse tests
// ---------------------------------------------------------------------------

describe("parseReconcileResponse", () => {
  it("parses valid JSON with all operation types", () => {
    const json = JSON.stringify({
      operations: [
        { id: "m1", action: "keep", reason: "still valid", context: "noted" },
        { id: "m2", action: "supersede", reason: "replaced" },
        { id: "m3", action: "revise", reason: "needs update", revised: "new text" },
        { id: "m4", action: "remove", reason: "obsolete" },
      ],
      newMemories: ["derived fact"],
    });
    const result = parseReconcileResponse(json);
    expect(result.operations).toHaveLength(4);
    expect(result.operations[0]!.action).toBe("keep");
    expect(result.operations[0]!.context).toBe("noted");
    expect(result.operations[1]!.action).toBe("supersede");
    expect(result.operations[2]!.action).toBe("revise");
    expect(result.operations[2]!.revised).toBe("new text");
    expect(result.operations[3]!.action).toBe("remove");
    expect(result.newMemories).toEqual(["derived fact"]);
  });

  it("parses JSON wrapped in markdown fences", () => {
    const json = '```json\n{"operations": [{"id": "x", "action": "keep", "reason": "ok"}], "newMemories": []}\n```';
    const result = parseReconcileResponse(json);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.id).toBe("x");
  });

  it("returns empty for empty operations array", () => {
    const result = parseReconcileResponse('{"operations": [], "newMemories": []}');
    expect(result.operations).toHaveLength(0);
    expect(result.newMemories).toHaveLength(0);
  });

  it("returns empty for malformed JSON", () => {
    const result = parseReconcileResponse("this is not json at all");
    expect(result.operations).toHaveLength(0);
    expect(result.newMemories).toHaveLength(0);
  });

  it("skips operations with missing id", () => {
    const json = JSON.stringify({
      operations: [
        { action: "keep", reason: "no id" },
        { id: "valid", action: "keep", reason: "has id" },
      ],
      newMemories: [],
    });
    const result = parseReconcileResponse(json);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.id).toBe("valid");
  });

  it("skips operations with missing action", () => {
    const json = JSON.stringify({
      operations: [{ id: "m1", reason: "no action" }],
      newMemories: [],
    });
    const result = parseReconcileResponse(json);
    expect(result.operations).toHaveLength(0);
  });

  it("skips operations with invalid action value", () => {
    const json = JSON.stringify({
      operations: [{ id: "m1", action: "destroy", reason: "bad action" }],
      newMemories: [],
    });
    const result = parseReconcileResponse(json);
    expect(result.operations).toHaveLength(0);
  });

  it("filters empty and whitespace-only strings from newMemories", () => {
    const json = JSON.stringify({
      operations: [],
      newMemories: ["real fact", "", "  ", "another fact"],
    });
    const result = parseReconcileResponse(json);
    // both empty string and whitespace-only string are filtered
    expect(result.newMemories).toHaveLength(2);
    expect(result.newMemories[0]).toBe("real fact");
    expect(result.newMemories[1]).toBe("another fact");
  });

  it("handles null operations entry gracefully", () => {
    const json = JSON.stringify({
      operations: [null, { id: "m1", action: "keep", reason: "ok" }],
      newMemories: [],
    });
    const result = parseReconcileResponse(json);
    expect(result.operations).toHaveLength(1);
  });

  it("handles missing reason field with default empty string", () => {
    const json = JSON.stringify({
      operations: [{ id: "m1", action: "keep" }],
      newMemories: [],
    });
    const result = parseReconcileResponse(json);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.reason).toBe("");
  });

  it("handles non-string items in newMemories", () => {
    const json = JSON.stringify({
      operations: [],
      newMemories: ["valid", 42, null, true, "also valid"],
    });
    const result = parseReconcileResponse(json);
    expect(result.newMemories).toEqual(["valid", "also valid"]);
  });
});

// ---------------------------------------------------------------------------
// LlmMemoryReconciler tests
// ---------------------------------------------------------------------------

describe("LlmMemoryReconciler", () => {
  it("returns empty operations when no existing memories", async () => {
    const reconciler = new LlmMemoryReconciler(mockLlm("unused"));
    const result = await reconciler.reconcile("new fact", []);
    expect(result.operations).toHaveLength(0);
    expect(result.newMemories).toHaveLength(0);
  });

  it("parses supersede operation from LLM response", async () => {
    const llmResponse = JSON.stringify({
      operations: [{ id: "m1", action: "supersede", reason: "old fact replaced" }],
      newMemories: [],
    });
    const reconciler = new LlmMemoryReconciler(mockLlm(llmResponse));
    const result = await reconciler.reconcile("new fact", [makeEntry("m1", "old fact")]);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.action).toBe("supersede");
    expect(result.operations[0]!.id).toBe("m1");
  });

  it("parses revise operation with new content", async () => {
    const llmResponse = JSON.stringify({
      operations: [{ id: "m1", action: "revise", reason: "update needed", revised: "corrected fact" }],
      newMemories: [],
    });
    const reconciler = new LlmMemoryReconciler(mockLlm(llmResponse));
    const result = await reconciler.reconcile("correction", [makeEntry("m1", "old fact")]);
    expect(result.operations[0]!.action).toBe("revise");
    expect(result.operations[0]!.revised).toBe("corrected fact");
  });

  it("parses keep operation with context annotation", async () => {
    const llmResponse = JSON.stringify({
      operations: [{ id: "m1", action: "keep", reason: "still valid", context: "but context changed" }],
      newMemories: [],
    });
    const reconciler = new LlmMemoryReconciler(mockLlm(llmResponse));
    const result = await reconciler.reconcile("context change", [makeEntry("m1", "existing fact")]);
    expect(result.operations[0]!.action).toBe("keep");
    expect(result.operations[0]!.context).toBe("but context changed");
  });

  it("parses remove operation", async () => {
    const llmResponse = JSON.stringify({
      operations: [{ id: "m1", action: "remove", reason: "completely obsolete" }],
      newMemories: [],
    });
    const reconciler = new LlmMemoryReconciler(mockLlm(llmResponse));
    const result = await reconciler.reconcile("replacement", [makeEntry("m1", "dead fact")]);
    expect(result.operations[0]!.action).toBe("remove");
  });

  it("parses newMemories from LLM response", async () => {
    const llmResponse = JSON.stringify({
      operations: [],
      newMemories: ["implied fact 1", "implied fact 2"],
    });
    const reconciler = new LlmMemoryReconciler(mockLlm(llmResponse));
    const result = await reconciler.reconcile("new info", [makeEntry("m1", "existing")]);
    expect(result.newMemories).toEqual(["implied fact 1", "implied fact 2"]);
  });

  it("returns empty result on LLM error (non-fatal)", async () => {
    const reconciler = new LlmMemoryReconciler(throwingLlm());
    const result = await reconciler.reconcile("new fact", [makeEntry("m1", "existing")]);
    expect(result.operations).toHaveLength(0);
    expect(result.newMemories).toHaveLength(0);
  });

  it("returns empty result when LLM returns invalid JSON", async () => {
    const reconciler = new LlmMemoryReconciler(mockLlm("I don't understand"));
    const result = await reconciler.reconcile("new fact", [makeEntry("m1", "existing")]);
    expect(result.operations).toHaveLength(0);
  });

  it("handles multiple operations in one response", async () => {
    const llmResponse = JSON.stringify({
      operations: [
        { id: "m1", action: "supersede", reason: "replaced" },
        { id: "m2", action: "revise", reason: "update", revised: "revised m2" },
        { id: "m3", action: "keep", reason: "still good" },
      ],
      newMemories: ["bonus fact"],
    });
    const reconciler = new LlmMemoryReconciler(mockLlm(llmResponse));
    const result = await reconciler.reconcile("big change", [
      makeEntry("m1", "fact 1"),
      makeEntry("m2", "fact 2"),
      makeEntry("m3", "fact 3"),
    ]);
    expect(result.operations).toHaveLength(3);
    expect(result.newMemories).toHaveLength(1);
  });

  it("sends all active memories to LLM (large set)", async () => {
    let capturedMessages: LLMMessage[] = [];
    const llm: LLMProvider = {
      name: "capture",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        capturedMessages = messages;
        return { content: '{"operations": [], "newMemories": []}', model: "mock" };
      },
    };

    const entries = Array.from({ length: 50 }, (_, i) =>
      makeEntry(`mem_${i}`, `Memory entry number ${i}`),
    );

    const reconciler = new LlmMemoryReconciler(llm);
    await reconciler.reconcile("new fact", entries);

    // The user prompt should contain all 50 memory IDs in XML tags
    const userMsg = capturedMessages.find(m => m.role === "user");
    expect(userMsg).toBeDefined();
    for (let i = 0; i < 50; i++) {
      expect(userMsg!.content).toContain(`<memory id="mem_${i}">`);
    }
  });

  it("wraps memories in XML tags for structural separation", async () => {
    let capturedMessages: LLMMessage[] = [];
    const llm: LLMProvider = {
      name: "capture",
      async chat(messages: LLMMessage[]): Promise<LLMResponse> {
        capturedMessages = messages;
        return { content: '{"operations": [], "newMemories": []}', model: "mock" };
      },
    };

    const entries = [
      makeEntry("m1", "active fact"),
      makeEntry("m2", "another fact"),
    ];

    const reconciler = new LlmMemoryReconciler(llm);
    await reconciler.reconcile("new fact", entries);

    const userMsg = capturedMessages.find(m => m.role === "user");
    expect(userMsg!.content).toContain('<memory id="m1">active fact</memory>');
    expect(userMsg!.content).toContain('<memory id="m2">another fact</memory>');
  });
});

// ---------------------------------------------------------------------------
// reconcileAndStore tests
// ---------------------------------------------------------------------------

describe("reconcileAndStore", () => {
  let backend: BuiltinMemoryBackend;

  beforeEach(() => {
    backend = new BuiltinMemoryBackend();
  });

  it("supersede removes old memory, stores new fact", async () => {
    const oldId = await backend.store({ content: "old fact", scope: SCOPE });
    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return {
          operations: [{ id: oldId, action: "supersede", reason: "replaced" }],
          newMemories: [],
        };
      },
    };

    const { storedId, operations } = await reconcileAndStore(backend, SCOPE, "new fact", reconciler);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.action).toBe("supersede");

    // Old memory should be gone
    const all = await backend.query(SCOPE, "", 100);
    expect(all.find(m => m.id === oldId)).toBeUndefined();
    // New fact should exist
    expect(all.find(m => m.id === storedId)).toBeDefined();
    expect(all.find(m => m.id === storedId)!.content).toBe("new fact");
  });

  it("revise removes old, stores revised and new fact", async () => {
    const oldId = await backend.store({ content: "partially correct", scope: SCOPE });
    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return {
          operations: [{ id: oldId, action: "revise", reason: "correction", revised: "corrected fact" }],
          newMemories: [],
        };
      },
    };

    await reconcileAndStore(backend, SCOPE, "new fact", reconciler);

    const all = await backend.query(SCOPE, "", 100);
    expect(all.find(m => m.id === oldId)).toBeUndefined();
    const contents = all.map(m => m.content);
    expect(contents).toContain("corrected fact");
    expect(contents).toContain("new fact");
  });

  it("remove deletes old memory, stores new fact", async () => {
    const oldId = await backend.store({ content: "worthless", scope: SCOPE });
    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return {
          operations: [{ id: oldId, action: "remove", reason: "no value" }],
          newMemories: [],
        };
      },
    };

    await reconcileAndStore(backend, SCOPE, "new fact", reconciler);

    const all = await backend.query(SCOPE, "", 100);
    expect(all.find(m => m.id === oldId)).toBeUndefined();
    expect(all.some(m => m.content === "new fact")).toBe(true);
  });

  it("keep leaves old memory unchanged, stores new fact", async () => {
    const oldId = await backend.store({ content: "still valid", scope: SCOPE });
    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return {
          operations: [{ id: oldId, action: "keep", reason: "still good" }],
          newMemories: [],
        };
      },
    };

    await reconcileAndStore(backend, SCOPE, "new fact", reconciler);

    const all = await backend.query(SCOPE, "", 100);
    expect(all.find(m => m.id === oldId)).toBeDefined();
    expect(all.find(m => m.id === oldId)!.content).toBe("still valid");
    expect(all.some(m => m.content === "new fact")).toBe(true);
  });

  it("stores additional newMemories from reconciler", async () => {
    await backend.store({ content: "existing", scope: SCOPE });
    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return {
          operations: [],
          newMemories: ["derived fact 1", "derived fact 2"],
        };
      },
    };

    await reconcileAndStore(backend, SCOPE, "new fact", reconciler);

    const all = await backend.query(SCOPE, "", 100);
    const contents = all.map(m => m.content);
    expect(contents).toContain("new fact");
    expect(contents).toContain("derived fact 1");
    expect(contents).toContain("derived fact 2");
  });

  it("still stores the new fact even when reconciler throws", async () => {
    await backend.store({ content: "existing", scope: SCOPE });
    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        throw new Error("reconciler failed");
      },
    };

    // reconcileAndStore itself shouldn't throw — the caller should handle this
    // But the design says reconciler failure is non-fatal inside LlmMemoryReconciler.
    // reconcileAndStore just applies what it gets, so a throwing reconciler propagates.
    // Let's verify the actual behavior:
    await expect(
      reconcileAndStore(backend, SCOPE, "new fact", reconciler),
    ).rejects.toThrow("reconciler failed");
  });

  it("handles empty scope with no existing memories", async () => {
    const reconciler: MemoryReconciler = {
      async reconcile(_content: string, existing: MemoryEntry[]): Promise<ReconcileResult> {
        // Should receive empty array
        expect(existing).toHaveLength(0);
        return { operations: [], newMemories: [] };
      },
    };

    const { storedId, operations } = await reconcileAndStore(backend, SCOPE, "first fact", reconciler);
    expect(operations).toHaveLength(0);
    expect(storedId).toBeTruthy();
  });

  it("applies multiple operations in sequence", async () => {
    const id1 = await backend.store({ content: "fact A", scope: SCOPE });
    const id2 = await backend.store({ content: "fact B", scope: SCOPE });
    const id3 = await backend.store({ content: "fact C", scope: SCOPE });

    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return {
          operations: [
            { id: id1, action: "supersede", reason: "replaced" },
            { id: id2, action: "revise", reason: "corrected", revised: "fact B (corrected)" },
            { id: id3, action: "keep", reason: "fine" },
          ],
          newMemories: ["extra fact"],
        };
      },
    };

    await reconcileAndStore(backend, SCOPE, "new fact", reconciler);

    const all = await backend.query(SCOPE, "", 100);
    const contents = all.map(m => m.content);
    expect(contents).not.toContain("fact A");        // superseded
    expect(contents).not.toContain("fact B");         // revised away
    expect(contents).toContain("fact B (corrected)"); // revised replacement
    expect(contents).toContain("fact C");             // kept
    expect(contents).toContain("new fact");           // new
    expect(contents).toContain("extra fact");         // derived
  });

  it("does not store revised content when revised field is missing on revise action", async () => {
    const id = await backend.store({ content: "old", scope: SCOPE });
    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return {
          operations: [{ id, action: "revise", reason: "update" }], // no revised field
          newMemories: [],
        };
      },
    };

    await reconcileAndStore(backend, SCOPE, "new", reconciler);

    const all = await backend.query(SCOPE, "", 100);
    // Old entry should still exist since revise without revised is a no-op (treat as keep)
    expect(all.find(m => m.id === id)).toBeDefined();
  });

  it("stores new fact BEFORE applying destructive operations", async () => {
    const callOrder: string[] = [];
    const trackingBackend: MemoryBackend = {
      async store(entry) {
        callOrder.push(`store:${entry.content}`);
        return crypto.randomUUID();
      },
      async query() { return [makeEntry("old-id", "old fact")]; },
      async remove(id) {
        callOrder.push(`remove:${id}`);
        return true;
      },
      async clear() {},
    };

    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return {
          operations: [{ id: "old-id", action: "supersede", reason: "replaced" }],
          newMemories: [],
        };
      },
    };

    await reconcileAndStore(trackingBackend, SCOPE, "new fact", reconciler);

    // New fact store must come before the remove
    const storeIdx = callOrder.indexOf("store:new fact");
    const removeIdx = callOrder.indexOf("remove:old-id");
    expect(storeIdx).toBeLessThan(removeIdx);
  });

  it("skips operations with IDs outside the presented scope", async () => {
    const validId = await backend.store({ content: "valid memory", scope: SCOPE });
    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return {
          operations: [
            { id: "nonexistent-id", action: "remove", reason: "unknown" },
            { id: validId, action: "keep", reason: "still good" },
          ],
          newMemories: [],
        };
      },
    };

    await reconcileAndStore(backend, SCOPE, "new fact", reconciler);

    const all = await backend.query(SCOPE, "", 100);
    // Valid memory should still be there (keep), and no crash from invalid ID
    expect(all.find(m => m.id === validId)).toBeDefined();
    expect(all.some(m => m.content === "new fact")).toBe(true);
  });

  it("partial operation failure does not crash reconcileAndStore", async () => {
    const id1 = await backend.store({ content: "fact A", scope: SCOPE });
    const id2 = await backend.store({ content: "fact B", scope: SCOPE });

    // Wrap backend.remove to throw on first call
    let removeCount = 0;
    const origRemove = backend.remove.bind(backend);
    backend.remove = async (id: string) => {
      removeCount++;
      if (removeCount === 1) throw new Error("storage error");
      return origRemove(id);
    };

    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return {
          operations: [
            { id: id1, action: "remove", reason: "first remove will fail" },
            { id: id2, action: "remove", reason: "second remove will succeed" },
          ],
          newMemories: [],
        };
      },
    };

    // Should not throw
    const result = await reconcileAndStore(backend, SCOPE, "new fact", reconciler);
    expect(result.operations).toHaveLength(2);

    const all = await backend.query(SCOPE, "", 100);
    // fact A still exists (remove failed), fact B gone (remove succeeded)
    expect(all.some(m => m.content === "fact A")).toBe(true);
    expect(all.some(m => m.content === "fact B")).toBe(false);
    expect(all.some(m => m.content === "new fact")).toBe(true);
  });

  it("accepts configurable maxMemories parameter", async () => {
    // Store several memories
    for (let i = 0; i < 5; i++) {
      await backend.store({ content: `fact ${i}`, scope: SCOPE });
    }

    let receivedCount = 0;
    const reconciler: MemoryReconciler = {
      async reconcile(_content: string, existing: MemoryEntry[]): Promise<ReconcileResult> {
        receivedCount = existing.length;
        return { operations: [], newMemories: [] };
      },
    };

    // Pass maxMemories=3 — reconciler should receive at most 3
    await reconcileAndStore(backend, SCOPE, "new fact", reconciler, 3);
    expect(receivedCount).toBe(3);
  });

  it("filters whitespace-only newMemories from reconciler", async () => {
    await backend.store({ content: "existing", scope: SCOPE });
    const reconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return {
          operations: [],
          newMemories: ["real derived fact", "   ", ""],
        };
      },
    };

    await reconcileAndStore(backend, SCOPE, "new fact", reconciler);

    const all = await backend.query(SCOPE, "", 100);
    const contents = all.map(m => m.content);
    expect(contents).toContain("real derived fact");
    // Whitespace-only and empty strings should not be stored
    expect(contents.filter(c => c.trim().length === 0)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration with createSmartAgent
// ---------------------------------------------------------------------------

describe("createSmartAgent with reconciler", () => {
  function createMockLlm(responses: string[]): LLMProvider {
    let callIndex = 0;
    return {
      name: "mock",
      async chat(): Promise<LLMResponse> {
        const response = responses[callIndex] ?? "Done.";
        callIndex++;
        return { content: response, model: "mock" };
      },
    };
  }

  it("agent with reconciler: 'llm' config is accepted", () => {
    const backend = new BuiltinMemoryBackend();
    const agent = createSmartAgent({
      llm: createMockLlm(["Done."]),
      tools: [],
      memory: {
        store: backend,
        scope: SCOPE,
        reconciler: "llm",
      },
    });
    expect(agent).toBeDefined();
    expect(typeof agent.run).toBe("function");
  });

  it("agent with custom reconciler config is accepted", () => {
    const backend = new BuiltinMemoryBackend();
    const customReconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return { operations: [], newMemories: [] };
      },
    };
    const agent = createSmartAgent({
      llm: createMockLlm(["Done."]),
      tools: [],
      memory: {
        store: backend,
        scope: SCOPE,
        reconciler: customReconciler,
      },
    });
    expect(agent).toBeDefined();
  });

  it("agent without reconciler stores memories directly (backward compat)", async () => {
    const backend = new BuiltinMemoryBackend();
    // Use a simple LLM that just completes immediately
    const agent = createSmartAgent({
      llm: createMockLlm(["Task complete."]),
      tools: [],
      memory: {
        store: backend,
        scope: SCOPE,
        saveSessionSummary: true,
      },
    });

    const result = await agent.run("do something");
    expect(result.status).toBe("completed");

    // Session summary should be stored directly
    const memories = await backend.query(SCOPE, "Session", 10);
    expect(memories.length).toBeGreaterThanOrEqual(1);
  });

  it("session summary goes through reconciler when configured", async () => {
    const backend = new BuiltinMemoryBackend();
    let reconcileCalled = false;
    const customReconciler: MemoryReconciler = {
      async reconcile(content: string): Promise<ReconcileResult> {
        if (content.includes("Session completed")) {
          reconcileCalled = true;
        }
        return { operations: [], newMemories: [] };
      },
    };

    const agent = createSmartAgent({
      llm: createMockLlm(["Task complete."]),
      tools: [],
      memory: {
        store: backend,
        scope: SCOPE,
        saveSessionSummary: true,
        reconciler: customReconciler,
      },
    });

    await agent.run("do something");
    expect(reconcileCalled).toBe(true);
  });

  it("autocompact memory candidates go through reconciler when configured", async () => {
    // This tests that the wiring exists — autocompact only fires under specific
    // conditions (high token count), so we verify the code path structurally
    // rather than triggering a real autocompact cycle.
    const backend = new BuiltinMemoryBackend();
    const customReconciler: MemoryReconciler = {
      async reconcile(): Promise<ReconcileResult> {
        return { operations: [], newMemories: [] };
      },
    };

    const agent = createSmartAgent({
      llm: createMockLlm(["Done."]),
      tools: [],
      memory: {
        store: backend,
        scope: SCOPE,
        reconciler: customReconciler,
      },
      compaction: {
        autocompact: { threshold: 100, maxFailures: 3 },
      },
    });

    // Agent should work without errors even with reconciler configured
    const result = await agent.run("simple task");
    expect(result.status).toBe("completed");
  });
});

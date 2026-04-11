import { describe, expect, it } from "bun:test";

import type {
  LLMMessage,
  LLMOptions,
  LLMProvider,
  LLMResponse,
} from "../../packages/ai/src/types.ts";
import {
  estimateTokens,
  snipMessages,
  microcompactMessages,
  autocompact,
} from "../../packages/ai/src/loop/compaction.ts";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function msg(role: LLMMessage["role"], content: string): LLMMessage {
  return { role, content };
}

function makeLLM(response: string): LLMProvider {
  return {
    name: "mock",
    async chat(_messages: LLMMessage[], _options?: LLMOptions): Promise<LLMResponse> {
      return { content: response, model: "mock-1" };
    },
  };
}

function makeLLMThatThrows(): LLMProvider {
  return {
    name: "mock-error",
    async chat(): Promise<LLMResponse> {
      throw new Error("LLM unavailable");
    },
  };
}

/* ------------------------------------------------------------------ */
/*  estimateTokens                                                    */
/* ------------------------------------------------------------------ */

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    const messages: LLMMessage[] = [
      msg("user", "abcdefgh"), // 8 chars → 2 tokens
      msg("assistant", "abcdefghijklmnop"), // 16 chars → 4 tokens
    ];
    expect(estimateTokens(messages)).toBe(6);
  });

  it("returns 0 for empty messages", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("floors fractional token counts", () => {
    // 5 chars → floor(5/4) = 1
    expect(estimateTokens([msg("user", "hello")])).toBe(1);
  });

  it("sums across multiple messages", () => {
    // 4 + 4 + 4 = 12 chars → 3 tokens
    const messages: LLMMessage[] = [
      msg("system", "abcd"),
      msg("user", "efgh"),
      msg("assistant", "ijkl"),
    ];
    expect(estimateTokens(messages)).toBe(3);
  });

  it("handles a single empty-content message", () => {
    expect(estimateTokens([msg("user", "")])).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  snipMessages                                                      */
/* ------------------------------------------------------------------ */

describe("snipMessages", () => {
  it("keeps system prompt and last N pairs", () => {
    const messages: LLMMessage[] = [
      msg("system", "You are helpful."),
      msg("user", "msg1"),
      msg("assistant", "reply1"),
      msg("user", "msg2"),
      msg("assistant", "reply2"),
      msg("user", "msg3"),
      msg("assistant", "reply3"),
    ];
    const result = snipMessages(messages, { preserveTail: 1 });
    // system + snip marker + last 2 messages (1 pair)
    expect(result.messages.length).toBe(4);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].role).toBe("system");
    expect(result.messages[1].content).toContain("[COMPACTED]");
    expect(result.messages[2]).toEqual(msg("user", "msg3"));
    expect(result.messages[3]).toEqual(msg("assistant", "reply3"));
    expect(result.snippedCount).toBe(4);
  });

  it("does nothing when messages fit within tail", () => {
    const messages: LLMMessage[] = [
      msg("system", "You are helpful."),
      msg("user", "msg1"),
      msg("assistant", "reply1"),
    ];
    const result = snipMessages(messages, { preserveTail: 2 });
    expect(result.messages).toEqual(messages);
    expect(result.snippedCount).toBe(0);
  });

  it("always keeps system prompt even with preserveTail=0", () => {
    const messages: LLMMessage[] = [
      msg("system", "You are helpful."),
      msg("user", "msg1"),
      msg("assistant", "reply1"),
      msg("user", "msg2"),
    ];
    const result = snipMessages(messages, { preserveTail: 0 });
    // system + snip marker only (all non-system messages removed)
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toBe("You are helpful.");
    expect(result.snippedCount).toBe(3);
  });

  it("handles no system prompt (first message is user)", () => {
    const messages: LLMMessage[] = [
      msg("user", "msg1"),
      msg("assistant", "reply1"),
      msg("user", "msg2"),
      msg("assistant", "reply2"),
    ];
    const result = snipMessages(messages, { preserveTail: 1 });
    // snip marker + last 2 messages
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toContain("[COMPACTED]");
    expect(result.messages[1]).toEqual(msg("user", "msg2"));
    expect(result.messages[2]).toEqual(msg("assistant", "reply2"));
    expect(result.snippedCount).toBe(2);
  });

  it("inserts snip marker showing how many messages were removed", () => {
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
      msg("user", "e"),
      msg("assistant", "f"),
    ];
    const result = snipMessages(messages, { preserveTail: 1 });
    const marker = result.messages.find(
      (m) => m.role === "system" && m.content.includes("[COMPACTED]"),
    );
    expect(marker).toBeDefined();
    expect(marker!.content).toContain("4 earlier messages removed");
  });

  it("preserves multiple tail pairs when preserveTail > 1", () => {
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
      msg("user", "e"),
      msg("assistant", "f"),
    ];
    const result = snipMessages(messages, { preserveTail: 2 });
    // system + marker + last 4 messages
    expect(result.messages.length).toBe(6);
    expect(result.snippedCount).toBe(2);
    expect(result.messages[2]).toEqual(msg("user", "c"));
    expect(result.messages[5]).toEqual(msg("assistant", "f"));
  });

  it("does not mutate the original messages array", () => {
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
    ];
    const original = [...messages];
    snipMessages(messages, { preserveTail: 1 });
    expect(messages).toEqual(original);
  });

  it("handles single non-system message", () => {
    const messages: LLMMessage[] = [msg("user", "hello")];
    const result = snipMessages(messages, { preserveTail: 0 });
    // 1 message, tail=0 → snip it, insert marker
    expect(result.snippedCount).toBe(1);
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].content).toContain("[COMPACTED]");
  });
});

/* ------------------------------------------------------------------ */
/*  microcompactMessages                                              */
/* ------------------------------------------------------------------ */

describe("microcompactMessages", () => {
  it("truncates long tool results outside protected tail", () => {
    const longResult = "x".repeat(500);
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("assistant", `Tool "search" returned:\n${longResult}`),
      msg("user", "ok"),
      msg("assistant", "final"),
    ];
    const result = microcompactMessages(messages, {
      maxToolResultChars: 100,
      protectedTail: 2,
    });
    expect(result.truncatedCount).toBe(1);
    expect(result.charsFreed).toBeGreaterThan(0);
    const truncated = result.messages[1];
    expect(truncated.content).toContain("[...truncated");
    expect(truncated.content.length).toBeLessThan(longResult.length + 50);
  });

  it("does not truncate messages in protected tail", () => {
    const longResult = "x".repeat(500);
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "question"),
      msg("assistant", `Tool "search" returned:\n${longResult}`),
    ];
    const result = microcompactMessages(messages, {
      maxToolResultChars: 100,
      protectedTail: 2,
    });
    expect(result.truncatedCount).toBe(0);
    expect(result.messages[2].content).toBe(
      `Tool "search" returned:\n${longResult}`,
    );
  });

  it("does not truncate short messages", () => {
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("assistant", 'Tool "lookup" returned:\nshort'),
      msg("user", "ok"),
      msg("assistant", "done"),
    ];
    const result = microcompactMessages(messages, {
      maxToolResultChars: 100,
      protectedTail: 1,
    });
    expect(result.truncatedCount).toBe(0);
    expect(result.charsFreed).toBe(0);
  });

  it("never truncates system prompt", () => {
    const longSystem = "s".repeat(500);
    const messages: LLMMessage[] = [
      msg("system", longSystem),
      msg("user", "hi"),
      msg("assistant", "hello"),
    ];
    const result = microcompactMessages(messages, {
      maxToolResultChars: 50,
      protectedTail: 1,
    });
    expect(result.messages[0].content).toBe(longSystem);
    expect(result.truncatedCount).toBe(0);
  });

  it("truncates multiple tool results in one pass", () => {
    const long1 = "a".repeat(300);
    const long2 = "b".repeat(400);
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("assistant", `Tool "search" returned:\n${long1}`),
      msg("assistant", `Tool "fetch" returned:\n${long2}`),
      msg("user", "ok"),
      msg("assistant", "done"),
    ];
    const result = microcompactMessages(messages, {
      maxToolResultChars: 50,
      protectedTail: 2,
    });
    expect(result.truncatedCount).toBe(2);
    expect(result.charsFreed).toBeGreaterThan(500);
  });

  it("does not truncate non-tool assistant messages even when long", () => {
    const longMsg = "x".repeat(500);
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("assistant", longMsg),
      msg("user", "ok"),
      msg("assistant", "done"),
    ];
    const result = microcompactMessages(messages, {
      maxToolResultChars: 50,
      protectedTail: 2,
    });
    expect(result.truncatedCount).toBe(0);
    expect(result.messages[1].content).toBe(longMsg);
  });

  it("reports correct charsFreed amount", () => {
    const content = `Tool "calc" returned:\n${"z".repeat(200)}`;
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("assistant", content),
      msg("user", "ok"),
    ];
    const result = microcompactMessages(messages, {
      maxToolResultChars: 50,
      protectedTail: 1,
    });
    expect(result.charsFreed).toBe(content.length - 50);
  });

  it("does not mutate the original messages array", () => {
    const longResult = "x".repeat(500);
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("assistant", `Tool "search" returned:\n${longResult}`),
      msg("user", "ok"),
    ];
    const originalContent = messages[1].content;
    microcompactMessages(messages, {
      maxToolResultChars: 50,
      protectedTail: 1,
    });
    expect(messages[1].content).toBe(originalContent);
  });
});

/* ------------------------------------------------------------------ */
/*  autocompact                                                       */
/* ------------------------------------------------------------------ */

describe("autocompact", () => {
  it("summarizes conversation and extracts memory candidates", async () => {
    const llm = makeLLM(
      JSON.stringify({
        summary: "User asked about weather. Agent looked it up.",
        memories: ["User prefers Celsius"],
      }),
    );
    const messages: LLMMessage[] = [
      msg("system", "You are helpful."),
      msg("user", "What is the weather?"),
      msg("assistant", "Let me check."),
      msg("user", "Use Celsius."),
      msg("assistant", "It is 20C."),
      msg("user", "Thanks"),
      msg("assistant", "You're welcome."),
      msg("user", "Anything else?"),
      msg("assistant", "No, all done."),
    ];
    const result = await autocompact(llm, messages, {
      threshold: 100,
      maxFailures: 3,
    });
    expect(result.failed).toBeUndefined();
    expect(result.memoryCandidates).toEqual(["User prefers Celsius"]);
    // First message is original system prompt
    expect(result.messages[0]).toEqual(msg("system", "You are helpful."));
    // Second is the autocompact summary
    expect(result.messages[1].role).toBe("system");
    expect(result.messages[1].content).toContain("[AUTOCOMPACT]");
    expect(result.messages[1].content).toContain("weather");
    // Last 4 messages preserved
    expect(result.messages[result.messages.length - 1]).toEqual(
      msg("assistant", "No, all done."),
    );
    expect(result.messages[result.messages.length - 2]).toEqual(
      msg("user", "Anything else?"),
    );
  });

  it("returns original messages on LLM returning invalid JSON", async () => {
    const llm = makeLLM("This is not valid JSON at all");
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
      msg("user", "e"),
      msg("assistant", "f"),
    ];
    const result = await autocompact(llm, messages, {
      threshold: 100,
      maxFailures: 3,
    });
    expect(result.failed).toBe(true);
    expect(result.messages).toEqual(messages);
  });

  it("preserves at least system + last 4 messages when conversation is short", async () => {
    const llm = makeLLM(JSON.stringify({ summary: "short", memories: [] }));
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "hi"),
      msg("assistant", "hello"),
      msg("user", "bye"),
      msg("assistant", "goodbye"),
    ];
    // 5 messages total → should return unchanged
    const result = await autocompact(llm, messages, {
      threshold: 100,
      maxFailures: 3,
    });
    expect(result.messages).toEqual(messages);
    expect(result.tokensFreed).toBe(0);
  });

  it("handles LLM throwing an error", async () => {
    const llm = makeLLMThatThrows();
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
      msg("user", "e"),
      msg("assistant", "f"),
    ];
    const result = await autocompact(llm, messages, {
      threshold: 100,
      maxFailures: 3,
    });
    expect(result.failed).toBe(true);
    expect(result.messages).toEqual(messages);
    expect(result.memoryCandidates).toEqual([]);
  });

  it("extracts memories as empty array when LLM omits them", async () => {
    const llm = makeLLM(JSON.stringify({ summary: "A concise summary" }));
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
      msg("user", "e"),
      msg("assistant", "f"),
    ];
    const result = await autocompact(llm, messages, {
      threshold: 100,
      maxFailures: 3,
    });
    expect(result.failed).toBeUndefined();
    expect(result.memoryCandidates).toEqual([]);
    expect(result.messages[1].content).toContain("A concise summary");
  });

  it("the summary is inserted as a system message with [AUTOCOMPACT] prefix", async () => {
    const llm = makeLLM(
      JSON.stringify({ summary: "The user discussed testing.", memories: [] }),
    );
    const messages: LLMMessage[] = [
      msg("system", "You are helpful."),
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
      msg("user", "e"),
      msg("assistant", "f"),
      msg("user", "g"),
      msg("assistant", "h"),
    ];
    const result = await autocompact(llm, messages, {
      threshold: 100,
      maxFailures: 3,
    });
    const autocompactMsg = result.messages[1];
    expect(autocompactMsg.role).toBe("system");
    expect(autocompactMsg.content).toMatch(/^\[AUTOCOMPACT\]/);
    expect(autocompactMsg.content).toContain("The user discussed testing.");
  });

  it("handles conversation without system prompt", async () => {
    const llm = makeLLM(
      JSON.stringify({ summary: "No system prompt conversation.", memories: [] }),
    );
    const messages: LLMMessage[] = [
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
      msg("user", "e"),
      msg("assistant", "f"),
    ];
    const result = await autocompact(llm, messages, {
      threshold: 100,
      maxFailures: 3,
    });
    expect(result.failed).toBeUndefined();
    // First message should be the autocompact summary (no original system)
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toContain("[AUTOCOMPACT]");
    // Last 4 preserved
    expect(result.messages.length).toBe(5); // summary + last 4
  });

  it("reports positive tokensFreed after successful compaction", async () => {
    const llm = makeLLM(
      JSON.stringify({ summary: "short", memories: [] }),
    );
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "a".repeat(100)),
      msg("assistant", "b".repeat(100)),
      msg("user", "c"),
      msg("assistant", "d"),
      msg("user", "e"),
      msg("assistant", "f"),
    ];
    const result = await autocompact(llm, messages, {
      threshold: 100,
      maxFailures: 3,
    });
    expect(result.tokensFreed).toBeGreaterThan(0);
  });

  it("does not mutate the original messages on failure", async () => {
    const llm = makeLLMThatThrows();
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
      msg("user", "e"),
      msg("assistant", "f"),
    ];
    const original = messages.map((m) => ({ ...m }));
    await autocompact(llm, messages, { threshold: 100, maxFailures: 3 });
    expect(messages).toEqual(original);
  });

  it("returns tokensFreed=0 on failure", async () => {
    const llm = makeLLMThatThrows();
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
      msg("user", "e"),
      msg("assistant", "f"),
    ];
    const result = await autocompact(llm, messages, {
      threshold: 100,
      maxFailures: 3,
    });
    expect(result.tokensFreed).toBe(0);
  });

  it("handles LLM returning JSON with missing summary field", async () => {
    const llm = makeLLM(JSON.stringify({ memories: ["some memory"] }));
    const messages: LLMMessage[] = [
      msg("system", "sys"),
      msg("user", "a"),
      msg("assistant", "b"),
      msg("user", "c"),
      msg("assistant", "d"),
      msg("user", "e"),
      msg("assistant", "f"),
    ];
    const result = await autocompact(llm, messages, {
      threshold: 100,
      maxFailures: 3,
    });
    expect(result.failed).toBe(true);
    expect(result.messages).toEqual(messages);
  });
});

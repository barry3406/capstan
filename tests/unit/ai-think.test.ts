import { describe, it, expect } from "bun:test";
import { think, generate, thinkStream, generateStream } from "@zauso-ai/capstan-ai";
import type { LLMProvider, LLMMessage, LLMOptions, LLMStreamChunk } from "@zauso-ai/capstan-ai";

// ---------------------------------------------------------------------------
// Helper: create a mock LLM provider
// ---------------------------------------------------------------------------

function mockProvider(overrides?: {
  content?: string;
  model?: string;
  onChat?: (messages: LLMMessage[], opts?: LLMOptions) => void;
  streamChunks?: LLMStreamChunk[];
  chatError?: Error;
}): LLMProvider {
  return {
    name: "mock",
    async chat(messages: LLMMessage[], opts?: LLMOptions) {
      if (overrides?.chatError) throw overrides.chatError;
      overrides?.onChat?.(messages, opts);
      return {
        content: overrides?.content ?? "mock response",
        model: overrides?.model ?? "mock-model",
      };
    },
    async *stream(messages: LLMMessage[], _opts?: LLMOptions) {
      const chunks = overrides?.streamChunks ?? [
        { content: "chunk1", done: false },
        { content: "chunk2", done: false },
        { content: "", done: true },
      ];
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function mockProviderNoStream(overrides?: {
  content?: string;
  model?: string;
}): LLMProvider {
  return {
    name: "mock-no-stream",
    async chat() {
      return {
        content: overrides?.content ?? "mock response",
        model: overrides?.model ?? "mock-model",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// think()
// ---------------------------------------------------------------------------

describe("think", () => {
  it("calls LLM with correct messages", async () => {
    let capturedMessages: LLMMessage[] = [];
    const llm = mockProvider({
      onChat: (msgs) => { capturedMessages = msgs; },
    });

    await think(llm, "What is 2+2?");

    expect(capturedMessages).toHaveLength(1);
    expect(capturedMessages[0]).toEqual({ role: "user", content: "What is 2+2?" });
  });

  it("with systemPrompt prepends system message", async () => {
    let capturedMessages: LLMMessage[] = [];
    const llm = mockProvider({
      onChat: (msgs) => { capturedMessages = msgs; },
    });

    await think(llm, "hello", { systemPrompt: "You are helpful" });

    expect(capturedMessages).toHaveLength(2);
    expect(capturedMessages[0]).toEqual({ role: "system", content: "You are helpful" });
    expect(capturedMessages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("with schema parses JSON response", async () => {
    const llm = mockProvider({ content: '{"name":"Alice","age":30}' });
    const schema = {
      parse(data: unknown) {
        const d = data as { name: string; age: number };
        return { name: d.name, age: d.age };
      },
    };

    const result = await think(llm, "Get user info", { schema });

    expect(result).toEqual({ name: "Alice", age: 30 });
  });

  it("with schema validation failure throws", async () => {
    const llm = mockProvider({ content: '{"name":"Alice"}' });
    const schema = {
      parse(_data: unknown): { name: string; age: number } {
        throw new Error("Missing required field: age");
      },
    };

    await expect(think(llm, "Get user info", { schema })).rejects.toThrow("Missing required field: age");
  });

  it("with schema sends responseFormat to LLM", async () => {
    let capturedOpts: any = null;
    const llm = mockProvider({
      content: '{"value":42}',
      onChat: (_msgs, opts) => { capturedOpts = opts; },
    });
    const schema = { parse: (d: unknown) => d };

    await think(llm, "test", { schema });

    expect(capturedOpts?.responseFormat).toEqual({ type: "json_object" });
  });

  it("with temperature and maxTokens passes options", async () => {
    let capturedOpts: any = null;
    const llm = mockProvider({
      onChat: (_msgs, opts) => { capturedOpts = opts; },
    });

    await think(llm, "test", { temperature: 0.7, maxTokens: 500 });

    expect(capturedOpts?.temperature).toBe(0.7);
    expect(capturedOpts?.maxTokens).toBe(500);
  });

  it("with custom model passes model option", async () => {
    let capturedOpts: any = null;
    const llm = mockProvider({
      onChat: (_msgs, opts) => { capturedOpts = opts; },
    });

    await think(llm, "test", { model: "gpt-4o-mini" });

    expect(capturedOpts?.model).toBe("gpt-4o-mini");
  });

  it("with empty prompt still sends message", async () => {
    let capturedMessages: LLMMessage[] = [];
    const llm = mockProvider({
      onChat: (msgs) => { capturedMessages = msgs; },
    });

    await think(llm, "");

    expect(capturedMessages).toHaveLength(1);
    expect(capturedMessages[0]).toEqual({ role: "user", content: "" });
  });

  it("when LLM throws propagates error", async () => {
    const llm = mockProvider({ chatError: new Error("API rate limit exceeded") });

    await expect(think(llm, "test")).rejects.toThrow("API rate limit exceeded");
  });

  it("returns string content by default", async () => {
    const llm = mockProvider({ content: "The answer is 4" });

    const result = await think(llm, "What is 2+2?");

    expect(result).toBe("The answer is 4");
  });

  it("with schema and invalid JSON throws parse error", async () => {
    const llm = mockProvider({ content: "not valid json" });
    const schema = { parse: (d: unknown) => d };

    await expect(think(llm, "test", { schema })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generate()
// ---------------------------------------------------------------------------

describe("generate", () => {
  it("returns string content", async () => {
    const llm = mockProvider({ content: "Generated text" });

    const result = await generate(llm, "Write a poem");

    expect(result).toBe("Generated text");
  });

  it("with systemPrompt prepends system message", async () => {
    let capturedMessages: LLMMessage[] = [];
    const llm = mockProvider({
      onChat: (msgs) => { capturedMessages = msgs; },
    });

    await generate(llm, "hello", { systemPrompt: "Be creative" });

    expect(capturedMessages).toHaveLength(2);
    expect(capturedMessages[0]).toEqual({ role: "system", content: "Be creative" });
    expect(capturedMessages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("with custom model passes model option", async () => {
    let capturedOpts: any = null;
    const llm = mockProvider({
      onChat: (_msgs, opts) => { capturedOpts = opts; },
    });

    await generate(llm, "test", { model: "claude-sonnet-4-20250514" });

    expect(capturedOpts?.model).toBe("claude-sonnet-4-20250514");
  });

  it("passes temperature and maxTokens", async () => {
    let capturedOpts: any = null;
    const llm = mockProvider({
      onChat: (_msgs, opts) => { capturedOpts = opts; },
    });

    await generate(llm, "test", { temperature: 0.9, maxTokens: 1000 });

    expect(capturedOpts?.temperature).toBe(0.9);
    expect(capturedOpts?.maxTokens).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// thinkStream()
// ---------------------------------------------------------------------------

describe("thinkStream", () => {
  it("yields chunks from provider stream", async () => {
    const llm = mockProvider({
      streamChunks: [
        { content: "Hello", done: false },
        { content: " world", done: false },
        { content: "", done: true },
      ],
    });

    const chunks: string[] = [];
    for await (const chunk of thinkStream(llm, "hello")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hello", " world"]);
  });

  it("throws if provider has no stream", async () => {
    const llm = mockProviderNoStream();

    const consume = async () => {
      for await (const _chunk of thinkStream(llm, "hello")) {
        // should not reach here
      }
    };

    await expect(consume()).rejects.toThrow("LLM provider does not support streaming");
  });

  it("with systemPrompt sends correct messages", async () => {
    let capturedMessages: LLMMessage[] = [];
    const llm: LLMProvider = {
      name: "mock",
      async chat() { return { content: "", model: "mock" }; },
      async *stream(msgs: LLMMessage[]) {
        capturedMessages = msgs;
        yield { content: "ok", done: true };
      },
    };

    for await (const _chunk of thinkStream(llm, "test", { systemPrompt: "Be helpful" })) {
      // consume
    }

    expect(capturedMessages).toHaveLength(2);
    expect(capturedMessages[0]).toEqual({ role: "system", content: "Be helpful" });
    expect(capturedMessages[1]).toEqual({ role: "user", content: "test" });
  });
});

// ---------------------------------------------------------------------------
// generateStream()
// ---------------------------------------------------------------------------

describe("generateStream", () => {
  it("works like thinkStream (is the same function)", async () => {
    const llm = mockProvider({
      streamChunks: [
        { content: "A", done: false },
        { content: "B", done: false },
        { content: "", done: true },
      ],
    });

    const chunks: string[] = [];
    for await (const chunk of generateStream(llm, "prompt")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["A", "B"]);
  });
});

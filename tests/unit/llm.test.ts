import { describe, it, expect, afterEach } from "bun:test";
import { openaiProvider, anthropicProvider } from "@zauso-ai/capstan-agent";
import type { LLMProvider } from "@zauso-ai/capstan-agent";

// ---------------------------------------------------------------------------
// Preserve original fetch for cleanup
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helper: mock ReadableStream from SSE lines
// ---------------------------------------------------------------------------

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = lines.join("\n") + "\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

// ---------------------------------------------------------------------------
// openaiProvider
// ---------------------------------------------------------------------------

describe("openaiProvider", () => {
  it('returns provider with name "openai"', () => {
    const provider = openaiProvider({ apiKey: "sk-test" });
    expect(provider.name).toBe("openai");
  });

  it("chat sends correct URL, auth header, content-type", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
          model: "gpt-4o",
        }),
        { status: 200 },
      );
    };

    const provider = openaiProvider({ apiKey: "sk-test123" });
    await provider.chat([{ role: "user", content: "hello" }]);

    expect(capturedUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(capturedHeaders["Authorization"]).toBe("Bearer sk-test123");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });

  it("chat sends model in body", async () => {
    let capturedBody = "";

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          model: "gpt-4o",
        }),
        { status: 200 },
      );
    };

    const provider = openaiProvider({ apiKey: "sk-test", model: "gpt-4o-mini" });
    await provider.chat([{ role: "user", content: "test" }]);

    const body = JSON.parse(capturedBody);
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("chat with systemPrompt prepends system message", async () => {
    let capturedBody = "";

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          model: "gpt-4o",
        }),
        { status: 200 },
      );
    };

    const provider = openaiProvider({ apiKey: "sk-test" });
    await provider.chat(
      [{ role: "user", content: "hello" }],
      { systemPrompt: "You are helpful" },
    );

    const body = JSON.parse(capturedBody);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("chat with temperature and maxTokens", async () => {
    let capturedBody = "";

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          model: "gpt-4o",
        }),
        { status: 200 },
      );
    };

    const provider = openaiProvider({ apiKey: "sk-test" });
    await provider.chat(
      [{ role: "user", content: "test" }],
      { temperature: 0.5, maxTokens: 100 },
    );

    const body = JSON.parse(capturedBody);
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(100);
  });

  it("chat parses response (content, model, usage, finishReason)", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Hello world" }, finish_reason: "stop" }],
          model: "gpt-4o-2024-08-06",
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200 },
      );

    const provider = openaiProvider({ apiKey: "sk-test" });
    const result = await provider.chat([{ role: "user", content: "hi" }]);

    expect(result.content).toBe("Hello world");
    expect(result.model).toBe("gpt-4o-2024-08-06");
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(result.finishReason).toBe("stop");
  });

  it("chat throws on non-200", async () => {
    globalThis.fetch = async () =>
      new Response("Rate limit exceeded", { status: 429 });

    const provider = openaiProvider({ apiKey: "sk-test" });
    await expect(
      provider.chat([{ role: "user", content: "hi" }]),
    ).rejects.toThrow("LLM error 429: Rate limit exceeded");
  });

  it("chat with custom baseUrl", async () => {
    let capturedUrl = "";

    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          model: "gpt-4o",
        }),
        { status: 200 },
      );
    };

    const provider = openaiProvider({
      apiKey: "sk-test",
      baseUrl: "https://my-proxy.example.com/v1",
    });
    await provider.chat([{ role: "user", content: "test" }]);

    expect(capturedUrl).toBe("https://my-proxy.example.com/v1/chat/completions");
  });

  it("chat with responseFormat sends json_schema", async () => {
    let capturedBody = "";

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
          model: "gpt-4o",
        }),
        { status: 200 },
      );
    };

    const schema = { type: "object", properties: { name: { type: "string" } } };
    const provider = openaiProvider({ apiKey: "sk-test" });
    await provider.chat(
      [{ role: "user", content: "test" }],
      { responseFormat: schema },
    );

    const body = JSON.parse(capturedBody);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { schema, name: "response", strict: true },
    });
  });

  it("stream yields chunks", async () => {
    globalThis.fetch = async () =>
      new Response(
        sseStream([
          'data: {"choices":[{"delta":{"content":"Hello"}}]}',
          'data: {"choices":[{"delta":{"content":" world"}}]}',
          "data: [DONE]",
        ]),
        { status: 200 },
      );

    const provider = openaiProvider({ apiKey: "sk-test" });
    const chunks: Array<{ content: string; done: boolean }> = [];
    for await (const chunk of provider.stream!(
      [{ role: "user", content: "hi" }],
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "Hello", done: false },
      { content: " world", done: false },
      { content: "", done: true },
    ]);
  });

  it("stream handles [DONE]", async () => {
    globalThis.fetch = async () =>
      new Response(
        sseStream(["data: [DONE]"]),
        { status: 200 },
      );

    const provider = openaiProvider({ apiKey: "sk-test" });
    const chunks: Array<{ content: string; done: boolean }> = [];
    for await (const chunk of provider.stream!(
      [{ role: "user", content: "hi" }],
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ content: "", done: true });
  });

  it("stream throws on non-200", async () => {
    globalThis.fetch = async () =>
      new Response("Server error", { status: 500 });

    const provider = openaiProvider({ apiKey: "sk-test" });

    const consume = async () => {
      for await (const _chunk of provider.stream!(
        [{ role: "user", content: "hi" }],
      )) {
        // should not reach here
      }
    };

    await expect(consume()).rejects.toThrow("LLM error 500");
  });
});

// ---------------------------------------------------------------------------
// anthropicProvider
// ---------------------------------------------------------------------------

describe("anthropicProvider", () => {
  it('has name "anthropic"', () => {
    const provider = anthropicProvider({ apiKey: "sk-ant-test" });
    expect(provider.name).toBe("anthropic");
  });

  it("chat sends x-api-key and anthropic-version headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hi" }],
          model: "claude-sonnet-4-20250514",
          stop_reason: "end_turn",
        }),
        { status: 200 },
      );
    };

    const provider = anthropicProvider({ apiKey: "sk-ant-key123" });
    await provider.chat([{ role: "user", content: "hello" }]);

    expect(capturedHeaders["x-api-key"]).toBe("sk-ant-key123");
    expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });

  it("separates system message from messages array", async () => {
    let capturedBody = "";

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          model: "claude-sonnet-4-20250514",
          stop_reason: "end_turn",
        }),
        { status: 200 },
      );
    };

    const provider = anthropicProvider({ apiKey: "sk-ant-test" });
    await provider.chat([
      { role: "system", content: "Be concise" },
      { role: "user", content: "hello" },
    ]);

    const body = JSON.parse(capturedBody);
    expect(body.system).toBe("Be concise");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("parses content blocks to extract text", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          content: [
            { type: "text", text: "First block" },
            { type: "tool_use", id: "123" },
            { type: "text", text: "Second block" },
          ],
          model: "claude-sonnet-4-20250514",
          stop_reason: "end_turn",
          usage: { input_tokens: 20, output_tokens: 10 },
        }),
        { status: 200 },
      );

    const provider = anthropicProvider({ apiKey: "sk-ant-test" });
    const result = await provider.chat([{ role: "user", content: "hi" }]);

    // finds first text block
    expect(result.content).toBe("First block");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.usage).toEqual({
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
    });
    expect(result.finishReason).toBe("end_turn");
  });

  it("throws on non-200 error response", async () => {
    globalThis.fetch = async () =>
      new Response("Authentication required", { status: 401 });

    const provider = anthropicProvider({ apiKey: "bad-key" });
    await expect(
      provider.chat([{ role: "user", content: "hi" }]),
    ).rejects.toThrow("Anthropic error 401: Authentication required");
  });

  it("uses default max_tokens 4096", async () => {
    let capturedBody = "";

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          model: "claude-sonnet-4-20250514",
          stop_reason: "end_turn",
        }),
        { status: 200 },
      );
    };

    const provider = anthropicProvider({ apiKey: "sk-ant-test" });
    await provider.chat([{ role: "user", content: "test" }]);

    const body = JSON.parse(capturedBody);
    expect(body.max_tokens).toBe(4096);
  });
});

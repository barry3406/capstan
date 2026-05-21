import { describe, it, expect, afterEach } from "bun:test";
import { responsesProvider, parseResponsesPayload } from "../../packages/agent/src/llm.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function captureResponses(responseBody: string, cap: { url?: string; body?: any; headers?: Record<string, string> }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    cap.url = typeof url === "string" ? url : url.toString();
    cap.headers = init?.headers as Record<string, string>;
    cap.body = JSON.parse(init?.body as string);
    return new Response(responseBody, { status: 200 });
  }) as unknown as typeof fetch;
}

const JSON_OK = JSON.stringify({ model: "gpt-5.5", output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }] });

describe("responsesProvider — request shape", () => {
  it("posts to /v1/responses, maps system->instructions and roles->input blocks", async () => {
    const cap: { url?: string; body?: any; headers?: Record<string, string> } = {};
    globalThis.fetch = captureResponses(JSON_OK, cap);
    const p = responsesProvider({ apiKey: "sk-x", baseUrl: "https://cocode.cc", model: "gpt-5.5", reasoningEffort: "low" });
    await p.chat([
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "prior" },
    ], { maxTokens: 1024 });

    expect(cap.url).toBe("https://cocode.cc/v1/responses");
    expect(cap.headers!["Authorization"]).toBe("Bearer sk-x");
    expect(cap.body.instructions).toBe("be terse");
    // system excluded from input; user->input_text, assistant->output_text
    expect(cap.body.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "hi" }] },
      { role: "assistant", content: [{ type: "output_text", text: "prior" }] },
    ]);
    expect(cap.body.reasoning).toEqual({ effort: "low" });
    expect(cap.body.max_output_tokens).toBe(1024);
    expect(cap.body.store).toBe(false);
  });

  it("baseUrl already ending in /v1 is not double-versioned", async () => {
    const cap: { url?: string } = {};
    globalThis.fetch = captureResponses(JSON_OK, cap as any);
    const p = responsesProvider({ apiKey: "sk", baseUrl: "https://api.openai.com/v1" });
    await p.chat([{ role: "user", content: "hi" }]);
    expect(cap.url).toBe("https://api.openai.com/v1/responses");
  });

  it("omits reasoning when no effort configured (non-reasoning models)", async () => {
    const cap: { body?: any } = {};
    globalThis.fetch = captureResponses(JSON_OK, cap as any);
    const p = responsesProvider({ apiKey: "sk" });
    await p.chat([{ role: "user", content: "hi" }]);
    expect("reasoning" in cap.body).toBe(false);
  });

  it("never sends temperature (reasoning models reject it)", async () => {
    const cap: { body?: any } = {};
    globalThis.fetch = captureResponses(JSON_OK, cap as any);
    const p = responsesProvider({ apiKey: "sk", reasoningEffort: "low" });
    await p.chat([{ role: "user", content: "hi" }], { temperature: 0 });
    expect("temperature" in cap.body).toBe(false);
  });
});

describe("responsesProvider — response parsing", () => {
  it("parses plain JSON output blocks", async () => {
    globalThis.fetch = captureResponses(JSON_OK, {});
    const p = responsesProvider({ apiKey: "sk" });
    const r = await p.chat([{ role: "user", content: "hi" }]);
    expect(r.content).toBe("hello");
    expect(r.model).toBe("gpt-5.5");
  });

  it("parses the output_text shorthand", async () => {
    globalThis.fetch = captureResponses(JSON.stringify({ model: "m", output_text: "short" }), {});
    const p = responsesProvider({ apiKey: "sk" });
    expect((await p.chat([{ role: "user", content: "hi" }])).content).toBe("short");
  });

  it("parses an SSE response.completed payload", async () => {
    const sse =
      "event: response.created\n" +
      'data: {"type":"response.created"}\n\n' +
      "event: response.completed\n" +
      'data: {"response":{"model":"gpt-5.5","output":[{"type":"message","content":[{"type":"output_text","text":"streamed-final"}]}]}}\n\n';
    globalThis.fetch = captureResponses(sse, {});
    const p = responsesProvider({ apiKey: "sk" });
    expect((await p.chat([{ role: "user", content: "hi" }])).content).toBe("streamed-final");
  });

  it("falls back to accumulated SSE deltas when no completed event", () => {
    const sse =
      "event: response.output_text.delta\n" + 'data: {"delta":"He"}\n\n' +
      "event: response.output_text.delta\n" + 'data: {"delta":"llo"}\n\n';
    expect(parseResponsesPayload(sse, "m").content).toBe("Hello");
  });

  it("throws on non-200", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 429 })) as unknown as typeof fetch;
    const p = responsesProvider({ apiKey: "sk" });
    await expect(p.chat([{ role: "user", content: "hi" }])).rejects.toThrow("Responses API error 429");
  });
});

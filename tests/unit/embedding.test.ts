import { describe, it, expect, afterEach } from "bun:test";
import { defineEmbedding, openaiEmbeddings } from "@zauso-ai/capstan-db";
import type { EmbeddingAdapter } from "@zauso-ai/capstan-db";

// ---------------------------------------------------------------------------
// Preserve original fetch for cleanup
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// defineEmbedding
// ---------------------------------------------------------------------------

describe("defineEmbedding", () => {
  const dummyAdapter: EmbeddingAdapter = {
    dimensions: 128,
    async embed(texts: string[]) {
      return texts.map(() => new Array(128).fill(0));
    },
  };

  it("returns config with modelName attached", () => {
    const config = defineEmbedding("Article", {
      sourceField: "body",
      vectorField: "embedding",
      adapter: dummyAdapter,
    });
    expect(config.modelName).toBe("Article");
  });

  it("preserves sourceField and vectorField", () => {
    const config = defineEmbedding("Article", {
      sourceField: "body",
      vectorField: "embedding",
      adapter: dummyAdapter,
    });
    expect(config.sourceField).toBe("body");
    expect(config.vectorField).toBe("embedding");
  });

  it("preserves adapter reference", () => {
    const config = defineEmbedding("Article", {
      sourceField: "body",
      vectorField: "embedding",
      adapter: dummyAdapter,
    });
    expect(config.adapter).toBe(dummyAdapter);
    expect(config.adapter.dimensions).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// openaiEmbeddings
// ---------------------------------------------------------------------------

describe("openaiEmbeddings", () => {
  it("returns adapter with correct default dimensions", () => {
    const adapter = openaiEmbeddings({ apiKey: "test-key" });
    expect(adapter.dimensions).toBe(1536);
  });

  it('default model is "text-embedding-3-small"', async () => {
    // We verify the default model by inspecting what gets sent in fetch
    let capturedBody: string | undefined;
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }),
        { status: 200 },
      );
    };

    const adapter = openaiEmbeddings({ apiKey: "test-key" });
    // Trigger embed and await to capture the body
    await adapter.embed(["test"]);
    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.model).toBe("text-embedding-3-small");
  });

  it("default dimensions is 1536", () => {
    const adapter = openaiEmbeddings({ apiKey: "test-key" });
    expect(adapter.dimensions).toBe(1536);
  });

  it("accepts custom model and dimensions", () => {
    const adapter = openaiEmbeddings({
      apiKey: "test-key",
      model: "text-embedding-3-large",
      dimensions: 3072,
    });
    expect(adapter.dimensions).toBe(3072);
  });

  it("embed() calls fetch with correct URL and body", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({
          data: [
            { embedding: [0.1, 0.2, 0.3] },
            { embedding: [0.4, 0.5, 0.6] },
          ],
        }),
        { status: 200 },
      );
    };

    const adapter = openaiEmbeddings({
      apiKey: "sk-test123",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });

    await adapter.embed(["hello", "world"]);

    expect(capturedUrl).toBe("https://api.openai.com/v1/embeddings");

    const body = JSON.parse(capturedBody);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toEqual(["hello", "world"]);
    expect(body.dimensions).toBe(1536);
  });

  it("embed() includes Authorization header", async () => {
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      capturedHeaders = headers;
      return new Response(
        JSON.stringify({ data: [{ embedding: [0.1] }] }),
        { status: 200 },
      );
    };

    const adapter = openaiEmbeddings({ apiKey: "sk-secret-key" });
    await adapter.embed(["test"]);

    expect(capturedHeaders["Authorization"]).toBe("Bearer sk-secret-key");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });

  it("embed() handles API error (non-200 response)", async () => {
    globalThis.fetch = async () =>
      new Response("Rate limit exceeded", { status: 429 });

    const adapter = openaiEmbeddings({ apiKey: "test-key" });

    await expect(adapter.embed(["test"])).rejects.toThrow(
      "Embedding request failed (429): Rate limit exceeded",
    );
  });

  it("propagates network failures from fetch", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };

    const adapter = openaiEmbeddings({ apiKey: "test-key" });
    await expect(adapter.embed(["test"])).rejects.toThrow("fetch failed");
  });

  it("throws on malformed response where data is not an array", async () => {
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ data: "not-an-array" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const adapter = openaiEmbeddings({ apiKey: "test-key" });
    // data.data.map will throw because "not-an-array" has no .map method
    await expect(adapter.embed(["test"])).rejects.toThrow();
  });

  it("embed() with empty text array returns empty array", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200 });

    const adapter = openaiEmbeddings({ apiKey: "test-key" });
    const result = await adapter.embed([]);
    expect(result).toEqual([]);
  });

  it("embed() returns correct number of embeddings", async () => {
    const mockEmbeddings = [
      { embedding: [0.1, 0.2] },
      { embedding: [0.3, 0.4] },
      { embedding: [0.5, 0.6] },
    ];

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: mockEmbeddings }), { status: 200 });

    const adapter = openaiEmbeddings({ apiKey: "test-key", dimensions: 2 });
    const result = await adapter.embed(["a", "b", "c"]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual([0.1, 0.2]);
    expect(result[1]).toEqual([0.3, 0.4]);
    expect(result[2]).toEqual([0.5, 0.6]);
  });

  it("custom baseUrl is used in fetch call", async () => {
    let capturedUrl = "";

    globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return new Response(
        JSON.stringify({ data: [{ embedding: [0.1] }] }),
        { status: 200 },
      );
    };

    const adapter = openaiEmbeddings({
      apiKey: "test-key",
      baseUrl: "https://my-proxy.example.com/v1",
    });
    await adapter.embed(["test"]);

    expect(capturedUrl).toBe("https://my-proxy.example.com/v1/embeddings");
  });
});

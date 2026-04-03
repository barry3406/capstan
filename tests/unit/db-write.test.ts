import { describe, expect, it } from "bun:test";
import { defineEmbedding, defineModel, field, prepareCreateData, prepareUpdateData } from "@zauso-ai/capstan-db";

describe("prepareCreateData", () => {
  it("applies auto ids, defaults, and timestamps from the model contract", async () => {
    const model = defineModel("Article", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        status: field.enum(["draft", "published"], { default: "draft" }),
        metadata: field.json({ default: { reviewed: false } }),
        createdAt: field.datetime({ default: "now" }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const now = new Date("2026-04-03T10:11:12.345Z");
    const payload = await prepareCreateData(model, { title: "Hello" }, { now });

    expect(payload.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(payload.status).toBe("draft");
    expect(payload.createdAt).toBe(now.toISOString());
    expect(payload.updatedAt).toBe(now.toISOString());
    expect(payload.metadata).toEqual({ reviewed: false });
  });

  it("preserves explicit caller values while still filling framework-managed fields", async () => {
    const model = defineModel("Article", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        status: field.enum(["draft", "published"], { default: "draft" }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const payload = await prepareCreateData(model, {
      id: "manual-id",
      title: "Hello",
      status: "published",
    });

    expect(payload.id).toBe("manual-id");
    expect(payload.status).toBe("published");
    expect(typeof payload.updatedAt).toBe("string");
  });

  it("runs embedding adapters and stores the generated vector", async () => {
    const model = defineModel("Document", {
      fields: {
        id: field.id(),
        body: field.text({ required: true }),
        embedding: field.vector(2),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const embedding = defineEmbedding("Document", {
      sourceField: "body",
      vectorField: "embedding",
      adapter: {
        dimensions: 2,
        async embed(texts: string[]) {
          return texts.map((text) => [text.length, text.length + 1]);
        },
      },
    });

    const payload = await prepareCreateData(
      model,
      { body: "hello" },
      { embeddings: embedding },
    );

    expect(payload.embedding).toEqual([5, 6]);
  });

  it("throws when the embedding dimensions do not match the target vector field", async () => {
    const model = defineModel("Document", {
      fields: {
        id: field.id(),
        body: field.text({ required: true }),
        embedding: field.vector(3),
      },
    });

    const embedding = defineEmbedding("Document", {
      sourceField: "body",
      vectorField: "embedding",
      adapter: {
        dimensions: 2,
        async embed() {
          return [[1, 2]];
        },
      },
    });

    await expect(
      prepareCreateData(model, { body: "hello" }, { embeddings: embedding }),
    ).rejects.toThrow("Embedding dimensions mismatch");
  });
});

describe("prepareUpdateData", () => {
  it("updates only framework-managed timestamps and changed fields", async () => {
    const model = defineModel("Article", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        status: field.enum(["draft", "published"], { default: "draft" }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const now = new Date("2026-04-03T12:34:56.000Z");
    const payload = await prepareUpdateData(model, { title: "Next" }, { now });

    expect(payload).toEqual({
      title: "Next",
      updatedAt: now.toISOString(),
    });
  });

  it("does not regenerate embeddings when the source field is absent from an update", async () => {
    const model = defineModel("Document", {
      fields: {
        id: field.id(),
        body: field.text({ required: true }),
        embedding: field.vector(2),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const embedding = defineEmbedding("Document", {
      sourceField: "body",
      vectorField: "embedding",
      adapter: {
        dimensions: 2,
        async embed() {
          throw new Error("should not run");
        },
      },
    });

    const payload = await prepareUpdateData(
      model,
      {} as Record<string, unknown>,
      { embeddings: embedding },
    );

    expect(payload.embedding).toBeUndefined();
    expect(typeof payload.updatedAt).toBe("string");
  });
});

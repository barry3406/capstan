import { describe, expect, it } from "bun:test";
import { defineEmbedding, defineModel, field, prepareCreateData, prepareUpdateData } from "@zauso-ai/capstan-db";

function makeValidationModel() {
  return defineModel("ValidationModel", {
    fields: {
      id: field.id(),
      title: field.string({ required: true, min: 3, max: 10 }),
      body: field.text({ min: 5, max: 20 }),
      status: field.enum(["draft", "published"] as const, { default: "draft" }),
      count: field.integer({ min: 1, max: 5 }),
      score: field.number({ min: 0, max: 10 }),
      active: field.boolean(),
      publishDate: field.date(),
      publishedAt: field.datetime(),
      metadata: field.json(),
      embedding: field.vector(3),
      updatedAt: field.datetime({ updatedAt: true }),
    },
  });
}

describe("prepareCreateData validation", () => {
  it("rejects unknown fields on create", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", extra: true } as Record<string, unknown>),
    ).rejects.toThrow('Unknown field "extra"');
  });

  it("rejects unknown fields on update", async () => {
    const model = makeValidationModel();
    await expect(
      prepareUpdateData(model, { unknownField: 1 } as Record<string, unknown>),
    ).rejects.toThrow('Unknown field "unknownField"');
  });

  it("rejects missing required fields on create", async () => {
    const model = makeValidationModel();
    await expect(prepareCreateData(model, {})).rejects.toThrow(
      'Missing required field "ValidationModel.title"',
    );
  });

  it("rejects null for auto-managed and required fields", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: null } as Record<string, unknown>),
    ).rejects.toThrow('Field "ValidationModel.title" cannot be null');
  });

  it("accepts null on optional fields", async () => {
    const model = makeValidationModel();
    const payload = await prepareCreateData(model, {
      title: "valid",
      body: null,
      metadata: null,
    } as Record<string, unknown>);

    expect(payload.body).toBeNull();
    expect(payload.metadata).toBeNull();
  });

  it("rejects non-string values for string fields", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: 123 } as Record<string, unknown>),
    ).rejects.toThrow('Field "ValidationModel.title" must be a string');
  });

  it("rejects strings shorter than min length", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "no" }),
    ).rejects.toThrow('Field "ValidationModel.title" must be at least 3 characters');
  });

  it("rejects strings longer than max length", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "way-too-long" }),
    ).rejects.toThrow('Field "ValidationModel.title" must be at most 10 characters');
  });

  it("rejects text shorter than min length", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", body: "tiny" }),
    ).rejects.toThrow('Field "ValidationModel.body" must be at least 5 characters');
  });

  it("rejects text longer than max length", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, {
        title: "valid",
        body: "this body is definitely too long",
      }),
    ).rejects.toThrow('Field "ValidationModel.body" must be at most 20 characters');
  });

  it("rejects integers when a float is supplied", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", count: 1.5 }),
    ).rejects.toThrow('Field "ValidationModel.count" must be an integer');
  });

  it("rejects integers below min", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", count: 0 }),
    ).rejects.toThrow('Field "ValidationModel.count" must be at least 1');
  });

  it("rejects integers above max", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", count: 6 }),
    ).rejects.toThrow('Field "ValidationModel.count" must be at most 5');
  });

  it("rejects non-numeric values for number fields", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", score: "bad" } as Record<string, unknown>),
    ).rejects.toThrow('Field "ValidationModel.score" must be a number');
  });

  it("rejects numbers below min", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", score: -1 }),
    ).rejects.toThrow('Field "ValidationModel.score" must be at least 0');
  });

  it("rejects numbers above max", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", score: 11 }),
    ).rejects.toThrow('Field "ValidationModel.score" must be at most 10');
  });

  it("rejects non-boolean values for boolean fields", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", active: "true" } as Record<string, unknown>),
    ).rejects.toThrow('Field "ValidationModel.active" must be a boolean');
  });

  it("accepts real booleans", async () => {
    const model = makeValidationModel();
    const payload = await prepareCreateData(model, { title: "valid", active: true });
    expect(payload.active).toBe(true);
  });

  it("rejects invalid date formats", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", publishDate: "03/04/2026" }),
    ).rejects.toThrow('Field "ValidationModel.publishDate" must be a YYYY-MM-DD string');
  });

  it("accepts valid date formats", async () => {
    const model = makeValidationModel();
    const payload = await prepareCreateData(model, {
      title: "valid",
      publishDate: "2026-04-03",
    });
    expect(payload.publishDate).toBe("2026-04-03");
  });

  it("rejects invalid datetime strings", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", publishedAt: "not-a-date" }),
    ).rejects.toThrow('Field "ValidationModel.publishedAt" must be a valid datetime string');
  });

  it("accepts valid datetime strings", async () => {
    const model = makeValidationModel();
    const payload = await prepareCreateData(model, {
      title: "valid",
      publishedAt: "2026-04-03T10:20:30.000Z",
    });
    expect(payload.publishedAt).toBe("2026-04-03T10:20:30.000Z");
  });

  it("rejects enum values outside the declared set", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", status: "archived" }),
    ).rejects.toThrow('Field "ValidationModel.status" must be one of: draft, published');
  });

  it("applies enum defaults and validates explicit enum values", async () => {
    const model = makeValidationModel();
    const defaulted = await prepareCreateData(model, { title: "valid" });
    const explicit = await prepareCreateData(model, {
      title: "valid",
      status: "published",
    });

    expect(defaulted.status).toBe("draft");
    expect(explicit.status).toBe("published");
  });

  it("rejects non-array values for vectors", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", embedding: "bad" } as Record<string, unknown>),
    ).rejects.toThrow('Field "ValidationModel.embedding" must be a numeric vector');
  });

  it("rejects vectors containing non-numeric entries", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, {
        title: "valid",
        embedding: [1, "bad", 3],
      } as Record<string, unknown>),
    ).rejects.toThrow('Field "ValidationModel.embedding" must be a numeric vector');
  });

  it("rejects vectors with the wrong dimension count", async () => {
    const model = makeValidationModel();
    await expect(
      prepareCreateData(model, { title: "valid", embedding: [1, 2] }),
    ).rejects.toThrow('Field "ValidationModel.embedding" must contain exactly 3 dimensions');
  });

  it("accepts vectors with the declared dimensions", async () => {
    const model = makeValidationModel();
    const payload = await prepareCreateData(model, {
      title: "valid",
      embedding: [1, 2, 3],
    });
    expect(payload.embedding).toEqual([1, 2, 3]);
  });

  it("preserves arbitrary JSON payloads", async () => {
    const model = makeValidationModel();
    const payload = await prepareCreateData(model, {
      title: "valid",
      metadata: { deep: { value: 1 } },
    });
    expect(payload.metadata).toEqual({ deep: { value: 1 } });
  });

  it("clones object defaults so separate writes do not share mutable state", async () => {
    const model = defineModel("Settings", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        metadata: field.json({ default: { nested: { enabled: true } } }),
      },
    });

    const a = await prepareCreateData(model, { title: "first" });
    const b = await prepareCreateData(model, { title: "second" });

    (a.metadata as { nested: { enabled: boolean } }).nested.enabled = false;
    expect(b.metadata).toEqual({ nested: { enabled: true } });
  });

  it("regenerates updatedAt on create even if the caller omits it", async () => {
    const model = makeValidationModel();
    const now = new Date("2026-04-03T01:02:03.000Z");
    const payload = await prepareCreateData(model, { title: "valid" }, { now });
    expect(payload.updatedAt).toBe(now.toISOString());
  });

  it("filters embedding configs by model name when multiple configs are provided", async () => {
    const model = defineModel("Document", {
      fields: {
        id: field.id(),
        body: field.text({ required: true }),
        embedding: field.vector(2),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const matching = defineEmbedding("Document", {
      sourceField: "body",
      vectorField: "embedding",
      adapter: {
        dimensions: 2,
        async embed() {
          return [[1, 2]];
        },
      },
    });
    const ignored = defineEmbedding("OtherModel", {
      sourceField: "body",
      vectorField: "embedding",
      adapter: {
        dimensions: 2,
        async embed() {
          throw new Error("should not run");
        },
      },
    });

    const payload = await prepareCreateData(
      model,
      { body: "hello" },
      { embeddings: [ignored, matching] },
    );

    expect(payload.embedding).toEqual([1, 2]);
  });

  it("rejects non-string embedding source fields", async () => {
    const model = defineModel("Document", {
      fields: {
        id: field.id(),
        body: field.json(),
        embedding: field.vector(2),
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
      prepareCreateData(model, { body: { bad: true } }, { embeddings: embedding }),
    ).rejects.toThrow('Embedding source field "body" on model "Document" must resolve to a string');
  });

  it("rejects embedding adapters that return no vectors", async () => {
    const model = defineModel("Document", {
      fields: {
        id: field.id(),
        body: field.text({ required: true }),
        embedding: field.vector(2),
      },
    });
    const embedding = defineEmbedding("Document", {
      sourceField: "body",
      vectorField: "embedding",
      adapter: {
        dimensions: 2,
        async embed() {
          return [];
        },
      },
    });

    await expect(
      prepareCreateData(model, { body: "hello" }, { embeddings: embedding }),
    ).rejects.toThrow('returned no embedding');
  });
});

describe("prepareUpdateData validation", () => {
  it("still validates explicit values on update", async () => {
    const model = makeValidationModel();
    await expect(
      prepareUpdateData(model, { score: "bad" } as Record<string, unknown>),
    ).rejects.toThrow('Field "ValidationModel.score" must be a number');
  });

  it("allows partial updates while still refreshing updatedAt", async () => {
    const model = makeValidationModel();
    const now = new Date("2026-04-03T08:09:10.000Z");
    const payload = await prepareUpdateData(model, { title: "valid" }, { now });
    expect(payload).toEqual({
      title: "valid",
      updatedAt: now.toISOString(),
    });
  });

  it("recomputes embeddings on update when the source field is present", async () => {
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
          return texts.map((text) => [text.length, text.length * 2]);
        },
      },
    });

    const payload = await prepareUpdateData(
      model,
      { body: "abc" },
      { embeddings: embedding },
    );

    expect(payload.embedding).toEqual([3, 6]);
    expect(typeof payload.updatedAt).toBe("string");
  });

  it("does not require create-only required fields to be present on update", async () => {
    const model = makeValidationModel();
    const payload = await prepareUpdateData(model, { score: 3 });
    expect(payload.score).toBe(3);
    expect(typeof payload.updatedAt).toBe("string");
  });

  it("rejects invalid enum values on update", async () => {
    const model = makeValidationModel();
    await expect(
      prepareUpdateData(model, { status: "deleted" }),
    ).rejects.toThrow('Field "ValidationModel.status" must be one of: draft, published');
  });

  it("rejects invalid vectors on update", async () => {
    const model = makeValidationModel();
    await expect(
      prepareUpdateData(model, { embedding: [1, 2] }),
    ).rejects.toThrow('Field "ValidationModel.embedding" must contain exactly 3 dimensions');
  });
});

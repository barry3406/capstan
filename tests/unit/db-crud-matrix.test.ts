import { describe, expect, it } from "bun:test";
import { defineModel, field, generateCrudRoutes, relation } from "@zauso-ai/capstan-db";

function getFile(files: ReturnType<typeof generateCrudRoutes>, path: string): string {
  const file = files.find((entry) => entry.path === path);
  expect(file).toBeDefined();
  return file!.content;
}

describe("generateCrudRoutes matrix", () => {
  it("uses the model's real primary key field when it is not named id", () => {
    const model = defineModel("Customer", {
      fields: {
        customerId: field.id(),
        name: field.string({ required: true }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const files = generateCrudRoutes(model);
    const detail = getFile(files, "customers/[id].api.ts");

    expect(detail).toContain("eq(customers.customerId, params.id)");
    expect(detail).not.toContain("eq(customers.id, params.id)");
  });

  it("excludes auto-generated primary keys and updatedAt fields from create input", () => {
    const model = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const index = getFile(generateCrudRoutes(model), "tickets/index.api.ts");
    expect(index).not.toContain("id:");
    expect(index).not.toContain("updatedAt:");
    expect(index).toContain("title: z.string()");
  });

  it("makes non-auto fields optional for update input", () => {
    const model = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string({ required: true, min: 3 }),
        count: field.integer(),
      },
    });

    const detail = getFile(generateCrudRoutes(model), "tickets/[id].api.ts");
    expect(detail).toContain("title: z.string().min(3).optional()");
    expect(detail).toContain("count: z.number().int().optional()");
  });

  it("maps enums, numbers, booleans, json, and vector fields to the expected zod schema", () => {
    const model = defineModel("Document", {
      fields: {
        id: field.id(),
        status: field.enum(["draft", "published"] as const),
        priority: field.number({ min: 0, max: 10 }),
        approved: field.boolean(),
        metadata: field.json(),
        embedding: field.vector(4),
      },
    });

    const index = getFile(generateCrudRoutes(model), "documents/index.api.ts");
    expect(index).toContain('status: z.enum(["draft", "published"])');
    expect(index).toContain("priority: z.number().min(0).max(10).optional()");
    expect(index).toContain("approved: z.boolean().optional()");
    expect(index).toContain("metadata: z.unknown().optional()");
    expect(index).toContain("embedding: z.array(z.number()).length(4).optional()");
  });

  it("preserves string and integer constraints in generated zod schemas", () => {
    const model = defineModel("Review", {
      fields: {
        id: field.id(),
        title: field.string({ required: true, min: 5, max: 40 }),
        rating: field.integer({ min: 1, max: 5 }),
      },
    });

    const index = getFile(generateCrudRoutes(model), "reviews/index.api.ts");
    expect(index).toContain("title: z.string().min(5).max(40)");
    expect(index).toContain("rating: z.number().int().min(1).max(5).optional()");
  });

  it("serializes model metadata including relations and indexes into generated files", () => {
    const model = defineModel("Author", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
      },
      relations: {
        posts: relation.hasMany("Post"),
      },
      indexes: [{ fields: ["name"], unique: true }],
    });

    const index = getFile(generateCrudRoutes(model), "authors/index.api.ts");
    expect(index).toContain('"relations": {');
    expect(index).toContain('"posts": {');
    expect(index).toContain('"kind": "hasMany"');
    expect(index).toContain('"indexes": [');
    expect(index).toContain('"unique": true');
  });

  it("routes create writes through prepareCreateData before insert", () => {
    const model = defineModel("Book", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
      },
    });

    const index = getFile(generateCrudRoutes(model), "books/index.api.ts");
    expect(index).toContain('import { prepareCreateData } from "@zauso-ai/capstan-db"');
    expect(index).toContain("const values = await prepareCreateData(model, input)");
    expect(index).toContain("db.insert(books).values(values).returning()");
  });

  it("routes update writes through prepareUpdateData before update", () => {
    const model = defineModel("Book", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
      },
    });

    const detail = getFile(generateCrudRoutes(model), "books/[id].api.ts");
    expect(detail).toContain('import { prepareUpdateData } from "@zauso-ai/capstan-db"');
    expect(detail).toContain("const values = await prepareUpdateData(model, input)");
    expect(detail).toContain("db.update(books).set(values)");
  });

  it("uses the correct pluralized route directory for irregular endings", () => {
    const category = defineModel("Category", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
      },
    });
    const box = defineModel("Box", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
      },
    });

    const categoryFiles = generateCrudRoutes(category);
    const boxFiles = generateCrudRoutes(box);

    expect(categoryFiles.map((file) => file.path)).toEqual([
      "categories/index.api.ts",
      "categories/[id].api.ts",
    ]);
    expect(boxFiles.map((file) => file.path)).toEqual([
      "boxes/index.api.ts",
      "boxes/[id].api.ts",
    ]);
  });

  it("keeps resource metadata aligned with the singular model name", () => {
    const model = defineModel("Invoice", {
      fields: {
        id: field.id(),
        total: field.number({ required: true }),
      },
    });

    const index = getFile(generateCrudRoutes(model), "invoices/index.api.ts");
    const detail = getFile(generateCrudRoutes(model), "invoices/[id].api.ts");

    expect(index).toContain('export const meta = { resource: "Invoice" }');
    expect(detail).toContain('export const meta = { resource: "Invoice" }');
  });

  it("uses the generated table symbol name consistently across list, create, read, update, and delete", () => {
    const model = defineModel("Comment", {
      fields: {
        id: field.id(),
        body: field.text({ required: true }),
      },
    });

    const index = getFile(generateCrudRoutes(model), "comments/index.api.ts");
    const detail = getFile(generateCrudRoutes(model), "comments/[id].api.ts");

    expect(index).toContain("db.select().from(comments)");
    expect(index).toContain("db.insert(comments)");
    expect(detail).toContain("db.select().from(comments)");
    expect(detail).toContain("db.update(comments)");
    expect(detail).toContain("db.delete(comments)");
  });

  it("emits optional schemas for non-required string fields", () => {
    const model = defineModel("Profile", {
      fields: {
        id: field.id(),
        displayName: field.string({ required: true }),
        bio: field.text(),
        website: field.string(),
      },
    });

    const index = getFile(generateCrudRoutes(model), "profiles/index.api.ts");
    expect(index).toContain("displayName: z.string()");
    expect(index).toContain("bio: z.string().optional()");
    expect(index).toContain("website: z.string().optional()");
  });

  it("handles models with explicit custom references in the serialized contract", () => {
    const model = defineModel("Repository", {
      fields: {
        id: field.id(),
        organizationSlug: field.string({ references: "Organization.slug", required: true }),
      },
    });

    const index = getFile(generateCrudRoutes(model), "repositories/index.api.ts");
    expect(index).toContain('"references": "Organization.slug"');
  });

  it("preserves vector dimensions in the serialized contract", () => {
    const model = defineModel("Embedding", {
      fields: {
        id: field.id(),
        vector: field.vector(16),
      },
    });

    const index = getFile(generateCrudRoutes(model), "embeddings/index.api.ts");
    expect(index).toContain('"dimensions": 16');
  });
});

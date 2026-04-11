import type { DatabaseRuntime, FindManyOptions, ModelRepository } from "./runtime.js";
import type { PrepareWriteOptions } from "./write.js";
import type { ModelDefinition, FieldDefinition } from "./types.js";
import { autoFieldNames, findPrimaryKeyField, pluralizeModelName } from "./naming.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CrudRouteFiles {
  /** File path relative to app/routes/, e.g. "tickets/index.api.ts" */
  path: string;
  content: string;
}

export interface CrudQueryOptions extends FindManyOptions {}

export interface CrudRuntime<M extends ModelDefinition = ModelDefinition> {
  repository: ModelRepository<M>;
  list: (options?: CrudQueryOptions) => Promise<Array<Record<string, unknown>>>;
  get: (id: unknown, options?: Omit<CrudQueryOptions, "where" | "limit" | "offset">) => Promise<Record<string, unknown> | null>;
  create: (input: Record<string, unknown>, options?: PrepareWriteOptions) => Promise<Record<string, unknown>>;
  update: (id: unknown, input: Record<string, unknown>, options?: PrepareWriteOptions) => Promise<Record<string, unknown> | null>;
  remove: (id: unknown) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Pluralisation helper
// ---------------------------------------------------------------------------

/**
 * Naive English pluraliser — sufficient for model-name pluralisation.
 *
 *   ticket  -> tickets
 *   company -> companies
 *   status  -> statuses
 *   bus     -> buses
 */
export function pluralize(word: string): string {
  return pluralizeModelName(word);
}

// ---------------------------------------------------------------------------
// Field → Zod mapping
// ---------------------------------------------------------------------------

/**
 * Convert a FieldDefinition into a Zod expression string.
 */
function fieldToZod(field: FieldDefinition): string {
  let base: string;

  // Enum takes precedence when values are supplied.
  if (field.enum && field.enum.length > 0) {
    const values = field.enum.map((v) => `"${v}"`).join(", ");
    base = `z.enum([${values}])`;
  } else {
    switch (field.type) {
      case "string":
      case "text":
      case "date":
      case "datetime":
        base = "z.string()";
        break;
      case "integer":
        base = "z.number().int()";
        break;
      case "number":
        base = "z.number()";
        break;
      case "boolean":
        base = "z.boolean()";
        break;
      case "json":
        base = "z.unknown()";
        break;
      case "vector":
        base = field.dimensions !== undefined
          ? `z.array(z.number()).length(${field.dimensions})`
          : "z.array(z.number())";
        break;
      default:
        base = "z.unknown()";
    }
  }

  // Constraints (only meaningful for string and number types).
  if (field.min !== undefined) {
    if (
      field.type === "string" ||
      field.type === "text"
    ) {
      base += `.min(${field.min})`;
    } else if (
      field.type === "integer" ||
      field.type === "number"
    ) {
      base += `.min(${field.min})`;
    }
  }
  if (field.max !== undefined) {
    if (
      field.type === "string" ||
      field.type === "text"
    ) {
      base += `.max(${field.max})`;
    } else if (
      field.type === "integer" ||
      field.type === "number"
    ) {
      base += `.max(${field.max})`;
    }
  }

  // Mark as optional when the field is not required.
  if (!field.required) {
    base += ".optional()";
  }

  return base;
}

// ---------------------------------------------------------------------------
// Schema generation helpers
// ---------------------------------------------------------------------------

/**
 * Build a Zod object literal string from a set of fields, optionally
 * excluding certain field names (e.g. auto-generated id).
 */
function buildZodObject(
  fields: Record<string, FieldDefinition>,
  options?: { exclude?: Set<string>; allOptional?: boolean },
): string {
  const exclude = options?.exclude ?? new Set<string>();
  const allOptional = options?.allOptional ?? false;
  const lines: string[] = [];

  for (const [name, field] of Object.entries(fields)) {
    if (exclude.has(name)) continue;
    let zodExpr: string;
    if (allOptional) {
      // Strip existing .optional() to avoid duplicates, then add it.
      zodExpr = fieldToZod({ ...field, required: true });
      zodExpr += ".optional()";
    } else {
      zodExpr = fieldToZod(field);
    }
    lines.push(`  ${name}: ${zodExpr},`);
  }

  return `z.object({\n${lines.join("\n")}\n})`;
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/**
 * Generate CRUD API route handler files for a given model definition.
 *
 * Returns an array of `{ path, content }` objects where `path` is relative
 * to the app's `app/routes/` directory.
 *
 * Two files are produced:
 *  1. `<plural>/index.api.ts`  — GET (list) + POST (create)
 *  2. `<plural>/[id].api.ts`   — GET (by id) + PUT (update) + DELETE
 */
export function generateCrudRoutes(model: ModelDefinition): CrudRouteFiles[] {
  const plural = pluralize(model.name);
  const resourceName = model.name;
  const serializedModel = JSON.stringify(model, null, 2);
  const primaryKeyField = findPrimaryKeyField(model) ?? "id";

  const autoFields = autoFieldNames(model);

  // ----- index.api.ts (list + create) -----

  const createSchema = buildZodObject(model.fields, { exclude: autoFields });
  const tableName = plural;

  const indexContent = `// Auto-generated CRUD routes for ${resourceName}
// This file was generated by @zauso-ai/capstan-db generateCrudRoutes().

import { defineAPI } from "@zauso-ai/capstan-core";
import { prepareCreateData } from "@zauso-ai/capstan-db";
import { z } from "zod";
import { db } from "../../db.js";
import { ${tableName} } from "../../db/schema.js";

export const meta = { resource: "${resourceName}" };
const model = ${serializedModel};

const CreateInput = ${createSchema};

export const GET = defineAPI({
  capability: "read",
  resource: "${resourceName}",
  description: "List all ${plural}",
  handler: async ({ ctx }) => {
    const items = await db.select().from(${tableName});
    return { data: items, total: items.length };
  },
});

export const POST = defineAPI({
  capability: "write",
  resource: "${resourceName}",
  description: "Create a new ${resourceName}",
  policy: "requireAuth",
  input: CreateInput,
  handler: async ({ input, ctx }) => {
    const values = await prepareCreateData(model, input) as typeof ${tableName}.$inferInsert;
    const result = await db.insert(${tableName}).values(values).returning();
    return { data: result[0], created: true };
  },
});
`;

  // ----- [id].api.ts (get by id + update + delete) -----

  const updateSchema = buildZodObject(model.fields, {
    exclude: autoFields,
    allOptional: true,
  });

  const idContent = `// Auto-generated CRUD routes for ${resourceName} (by id)
// This file was generated by @zauso-ai/capstan-db generateCrudRoutes().

import { defineAPI } from "@zauso-ai/capstan-core";
import { prepareUpdateData } from "@zauso-ai/capstan-db";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db.js";
import { ${tableName} } from "../../db/schema.js";

export const meta = { resource: "${resourceName}" };
const model = ${serializedModel};

const UpdateInput = ${updateSchema};

export const GET = defineAPI({
  capability: "read",
  resource: "${resourceName}",
  description: "Get a ${resourceName} by id",
  handler: async ({ input, ctx, params }) => {
    const items = await db.select().from(${tableName}).where(eq(${tableName}.${primaryKeyField}, params.id));
    return { data: items[0] ?? null };
  },
});

export const PUT = defineAPI({
  capability: "write",
  resource: "${resourceName}",
  description: "Update a ${resourceName}",
  policy: "requireAuth",
  input: UpdateInput,
  handler: async ({ input, ctx, params }) => {
    const values = await prepareUpdateData(model, input) as Partial<typeof ${tableName}.$inferInsert>;
    const result = await db.update(${tableName}).set(values).where(eq(${tableName}.${primaryKeyField}, params.id)).returning();
    return { data: result[0], updated: true };
  },
});

export const DELETE = defineAPI({
  capability: "write",
  resource: "${resourceName}",
  description: "Delete a ${resourceName}",
  policy: "requireAuth",
  handler: async ({ ctx, params }) => {
    await db.delete(${tableName}).where(eq(${tableName}.${primaryKeyField}, params.id));
    return { deleted: true };
  },
});
`;

  return [
    { path: `${plural}/index.api.ts`, content: indexContent },
    { path: `${plural}/[id].api.ts`, content: idContent },
  ];
}

export function createCrudRepository<M extends ModelDefinition>(
  database: DatabaseRuntime,
  model: M | string,
): ModelRepository<M> {
  return database.model(model);
}

export function createCrudRuntime<M extends ModelDefinition>(
  database: DatabaseRuntime,
  model: M | string,
): CrudRuntime<M> {
  const repository = createCrudRepository(database, model);
  return {
    repository,
    list: (options) => repository.findMany(options),
    get: (id, options) => repository.findById(id, options),
    create: (input, options) => repository.create(input, options),
    update: (id, input, options) => repository.update(id, input, options),
    remove: (id) => repository.delete(id),
  };
}

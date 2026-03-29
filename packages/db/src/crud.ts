import type { ModelDefinition, FieldDefinition } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CrudRouteFiles {
  /** File path relative to app/routes/, e.g. "tickets/index.api.ts" */
  path: string;
  content: string;
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
  if (word.length === 0) return word;

  const lower = word.toLowerCase();

  // Words ending in consonant + y → ies
  if (
    lower.endsWith("y") &&
    lower.length > 1 &&
    !"aeiou".includes(lower[lower.length - 2]!)
  ) {
    return word.slice(0, -1) + "ies";
  }

  // Words ending in s, sh, ch, x, z → es
  if (
    lower.endsWith("s") ||
    lower.endsWith("sh") ||
    lower.endsWith("ch") ||
    lower.endsWith("x") ||
    lower.endsWith("z")
  ) {
    return word + "es";
  }

  return word + "s";
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
  const plural = pluralize(model.name.toLowerCase());
  const resourceName = model.name;

  // Determine which fields are auto-generated (id, updatedAt).
  const autoFields = new Set<string>();
  for (const [name, field] of Object.entries(model.fields)) {
    if (field.autoId) autoFields.add(name);
    if (field.updatedAt) autoFields.add(name);
  }

  // ----- index.api.ts (list + create) -----

  const createSchema = buildZodObject(model.fields, { exclude: autoFields });
  const indexContent = `// Auto-generated CRUD routes for ${resourceName}
// This file was generated by @zauso-ai/capstan-db generateCrudRoutes().

import { defineAPI } from "@zauso-ai/capstan-core";
import { z } from "zod";

export const meta = { resource: "${resourceName}" };

const CreateInput = ${createSchema};

export const GET = defineAPI({
  capability: "read",
  resource: "${resourceName}",
  description: "List all ${plural}",
  handler: async ({ ctx }) => {
    // TODO: replace with actual database query
    return { data: [], total: 0 };
  },
});

export const POST = defineAPI({
  capability: "write",
  resource: "${resourceName}",
  description: "Create a new ${resourceName}",
  policy: "requireAuth",
  input: CreateInput,
  handler: async ({ input, ctx }) => {
    // TODO: replace with actual database insert
    return { data: { id: "TODO", ...input }, created: true };
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
import { z } from "zod";

export const meta = { resource: "${resourceName}" };

const UpdateInput = ${updateSchema};

export const GET = defineAPI({
  capability: "read",
  resource: "${resourceName}",
  description: "Get a ${resourceName} by id",
  handler: async ({ input, ctx }) => {
    // TODO: replace with actual database lookup
    return { data: null };
  },
});

export const PUT = defineAPI({
  capability: "write",
  resource: "${resourceName}",
  description: "Update a ${resourceName}",
  policy: "requireAuth",
  input: UpdateInput,
  handler: async ({ input, ctx }) => {
    // TODO: replace with actual database update
    return { data: { id: "TODO", ...input }, updated: true };
  },
});

export const DELETE = defineAPI({
  capability: "write",
  resource: "${resourceName}",
  description: "Delete a ${resourceName}",
  policy: "requireAuth",
  handler: async ({ ctx }) => {
    // TODO: replace with actual database delete
    return { deleted: true };
  },
});
`;

  return [
    { path: `${plural}/index.api.ts`, content: indexContent },
    { path: `${plural}/[id].api.ts`, content: idContent },
  ];
}

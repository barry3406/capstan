import type { ModelDefinition, FieldDefinition, ScalarType } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a camelCase name to snake_case for column names.
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

/**
 * Pluralise a model name for the table name (very simple heuristic).
 * "Ticket" -> "tickets", "Category" -> "categories", "Status" -> "statuses"
 */
function pluralise(name: string): string {
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  if (lower.endsWith("y") && !/[aeiou]y$/i.test(lower)) {
    return lower.slice(0, -1) + "ies";
  }
  if (lower.endsWith("s") || lower.endsWith("x") || lower.endsWith("sh") || lower.endsWith("ch")) {
    return lower + "es";
  }
  return lower + "s";
}

/**
 * Escape a JavaScript string value for embedding in generated code.
 */
function jsString(val: unknown): string {
  if (typeof val === "string") {
    return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return String(val);
}

// ---------------------------------------------------------------------------
// Column type mapping  (model ScalarType -> drizzle-orm/sqlite-core helpers)
// ---------------------------------------------------------------------------

interface ColumnMapping {
  /** The drizzle column builder function name, e.g. "text", "integer", "real" */
  builder: string;
  /** Extra config argument for the builder, if any */
  config?: string;
  /** The import source (always "drizzle-orm/sqlite-core" for now) */
  import: string;
}

function columnMapping(fieldType: ScalarType): ColumnMapping {
  switch (fieldType) {
    case "string":
    case "text":
    case "date":
    case "datetime":
      return { builder: "text", import: "text" };
    case "integer":
      return { builder: "integer", import: "integer" };
    case "number":
      return { builder: "real", import: "real" };
    case "boolean":
      return { builder: "integer", import: "integer", config: '{ mode: "boolean" }' };
    case "json":
      return { builder: "text", import: "text", config: '{ mode: "json" }' };
  }
}

// ---------------------------------------------------------------------------
// Column expression builder
// ---------------------------------------------------------------------------

function buildColumnExpr(fieldName: string, def: FieldDefinition): string {
  const colName = toSnakeCase(fieldName);
  const mapping = columnMapping(def.type);

  let expr: string;
  if (mapping.config) {
    expr = `${mapping.builder}("${colName}", ${mapping.config})`;
  } else {
    expr = `${mapping.builder}("${colName}")`;
  }

  // Primary key for auto-id fields
  if (def.autoId) {
    expr += ".primaryKey()";
  }

  // NOT NULL for required fields (but not auto-id, which is already implied)
  if (def.required && !def.autoId) {
    expr += ".notNull()";
  }

  // Unique constraint
  if (def.unique && !def.autoId) {
    expr += ".unique()";
  }

  // Default values
  if (def.default !== undefined) {
    if (def.default === "now") {
      // For date/datetime fields, "now" means the current ISO timestamp.
      // We use a SQL expression: (datetime('now')) or store as text.
      expr += `.default(sql\`(datetime('now'))\`)`;
    } else if (typeof def.default === "string") {
      expr += `.default(${jsString(def.default)})`;
    } else if (typeof def.default === "boolean") {
      expr += `.default(${def.default})`;
    } else if (typeof def.default === "number") {
      expr += `.default(${def.default})`;
    } else {
      expr += `.default(${jsString(def.default)})`;
    }
  }

  return expr;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a Drizzle ORM schema file (as a TypeScript string) from an array
 * of model definitions.
 *
 * The generated code targets `drizzle-orm/sqlite-core`.
 *
 * @example
 *   const src = generateDrizzleSchema([ticketModel, userModel]);
 *   fs.writeFileSync("schema.ts", src);
 */
export function generateDrizzleSchema(models: ModelDefinition[]): string {
  // Collect all drizzle imports we need
  const neededImports = new Set<string>(["sqliteTable"]);
  let needsSql = false;

  // First pass: determine imports
  for (const model of models) {
    for (const def of Object.values(model.fields)) {
      const mapping = columnMapping(def.type);
      neededImports.add(mapping.import);
      if (def.default === "now") {
        needsSql = true;
      }
    }
  }

  // Build import line
  const importNames = [...neededImports].sort();
  const lines: string[] = [];
  lines.push(`import { ${importNames.join(", ")} } from "drizzle-orm/sqlite-core";`);
  if (needsSql) {
    lines.push(`import { sql } from "drizzle-orm";`);
  }

  // Generate each table
  for (const model of models) {
    const tableName = pluralise(model.name);
    const varName = tableName;

    lines.push("");
    lines.push(`export const ${varName} = sqliteTable("${tableName}", {`);

    const fieldEntries = Object.entries(model.fields);
    for (let i = 0; i < fieldEntries.length; i++) {
      const [fieldName, def] = fieldEntries[i]!;
      const expr = buildColumnExpr(fieldName, def);
      const comma = i < fieldEntries.length - 1 ? "," : ",";
      lines.push(`  ${fieldName}: ${expr}${comma}`);
    }

    lines.push("});");
  }

  return lines.join("\n") + "\n";
}

import type { ModelDefinition, FieldDefinition, ScalarType, DbProvider } from "./types.js";

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
// Column type mapping
// ---------------------------------------------------------------------------

type Provider = DbProvider;

interface ColumnMapping {
  /** The drizzle column builder function name, e.g. "text", "integer", "real" */
  builder: string;
  /** Extra config argument for the builder, if any */
  config?: string;
  /** The import name (function to import from the drizzle dialect module) */
  import: string;
}

function sqliteColumnMapping(fieldType: ScalarType): ColumnMapping {
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
    case "vector":
      // SQLite has no native vector type; store as JSON-serialised TEXT
      return { builder: "text", import: "text", config: '{ mode: "json" }' };
  }
}

function pgColumnMapping(fieldType: ScalarType, dimensions?: number): ColumnMapping {
  switch (fieldType) {
    case "string":
      return { builder: "varchar", import: "varchar", config: "{ length: 255 }" };
    case "text":
      return { builder: "text", import: "text" };
    case "date":
      return { builder: "date", import: "date" };
    case "datetime":
      return { builder: "timestamp", import: "timestamp" };
    case "integer":
      return { builder: "integer", import: "integer" };
    case "number":
      return { builder: "doublePrecision", import: "doublePrecision" };
    case "boolean":
      return { builder: "boolean", import: "boolean" };
    case "json":
      return { builder: "jsonb", import: "jsonb" };
    case "vector":
      // PostgreSQL uses pgvector's vector(dimensions) column type
      return { builder: "vector", import: "vector", config: `{ dimensions: ${dimensions ?? 1536} }` };
  }
}

function mysqlColumnMapping(fieldType: ScalarType): ColumnMapping {
  switch (fieldType) {
    case "string":
      return { builder: "varchar", import: "varchar", config: "{ length: 255 }" };
    case "text":
      return { builder: "text", import: "text" };
    case "date":
      return { builder: "varchar", import: "varchar", config: "{ length: 255 }" };
    case "datetime":
      return { builder: "datetime", import: "datetime" };
    case "integer":
      return { builder: "int", import: "int" };
    case "number":
      return { builder: "double", import: "double" };
    case "boolean":
      return { builder: "boolean", import: "boolean" };
    case "json":
      return { builder: "json", import: "json" };
    case "vector":
      // MySQL has no native vector type; store as JSON
      return { builder: "json", import: "json" };
  }
}

function columnMapping(fieldType: ScalarType, provider: Provider, dimensions?: number): ColumnMapping {
  switch (provider) {
    case "sqlite":
    case "libsql":
      return sqliteColumnMapping(fieldType);
    case "postgres":
      return pgColumnMapping(fieldType, dimensions);
    case "mysql":
      return mysqlColumnMapping(fieldType);
  }
}

// ---------------------------------------------------------------------------
// Provider-specific metadata
// ---------------------------------------------------------------------------

interface ProviderMeta {
  /** The drizzle table builder function name */
  tableBuilder: string;
  /** The drizzle import module path */
  importModule: string;
  /** SQL expression for "current timestamp" defaults */
  nowDefault: string;
}

function providerMeta(provider: Provider): ProviderMeta {
  switch (provider) {
    case "sqlite":
    case "libsql":
      return {
        tableBuilder: "sqliteTable",
        importModule: "drizzle-orm/sqlite-core",
        nowDefault: "(datetime('now'))",
      };
    case "postgres":
      return {
        tableBuilder: "pgTable",
        importModule: "drizzle-orm/pg-core",
        nowDefault: "now()",
      };
    case "mysql":
      return {
        tableBuilder: "mysqlTable",
        importModule: "drizzle-orm/mysql-core",
        nowDefault: "(NOW())",
      };
  }
}

// ---------------------------------------------------------------------------
// Auto-ID column expression per provider
// ---------------------------------------------------------------------------

/**
 * Build the column expression and required imports for an auto-id primary key
 * field. Each provider uses a slightly different column type:
 *  - SQLite:    text("col").primaryKey()
 *  - Postgres:  text("col").primaryKey()
 *  - MySQL:     varchar("col", { length: 36 }).primaryKey()
 */
function autoIdExpr(colName: string, provider: Provider): { expr: string; imports: string[] } {
  switch (provider) {
    case "sqlite":
    case "libsql":
      return { expr: `text("${colName}").primaryKey()`, imports: ["text"] };
    case "postgres":
      return { expr: `text("${colName}").primaryKey()`, imports: ["text"] };
    case "mysql":
      return { expr: `varchar("${colName}", { length: 36 }).primaryKey()`, imports: ["varchar"] };
  }
}

// ---------------------------------------------------------------------------
// Column expression builder
// ---------------------------------------------------------------------------

function buildColumnExpr(
  fieldName: string,
  def: FieldDefinition,
  provider: Provider,
): { expr: string; imports: string[]; needsSql: boolean } {
  const colName = toSnakeCase(fieldName);

  // Auto-id fields get special treatment per provider
  if (def.autoId) {
    const result = autoIdExpr(colName, provider);
    return { expr: result.expr, imports: result.imports, needsSql: false };
  }

  const mapping = columnMapping(def.type, provider, def.dimensions);

  let expr: string;
  if (mapping.config) {
    expr = `${mapping.builder}("${colName}", ${mapping.config})`;
  } else {
    expr = `${mapping.builder}("${colName}")`;
  }

  // NOT NULL for required fields
  if (def.required) {
    expr += ".notNull()";
  }

  // Unique constraint
  if (def.unique) {
    expr += ".unique()";
  }

  // Default values
  let needsSql = false;
  if (def.default !== undefined) {
    if (def.default === "now") {
      const meta = providerMeta(provider);
      expr += `.default(sql\`${meta.nowDefault}\`)`;
      needsSql = true;
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

  return { expr, imports: [mapping.import], needsSql };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a Drizzle ORM schema file (as a TypeScript string) from an array
 * of model definitions.
 *
 * The generated code targets the specified provider's drizzle package:
 *  - `"sqlite"`   -> `drizzle-orm/sqlite-core`
 *  - `"postgres"` -> `drizzle-orm/pg-core`
 *  - `"mysql"`    -> `drizzle-orm/mysql-core`
 *
 * @param models   - Array of model definitions to generate schema for.
 * @param provider - The database provider. Defaults to `"sqlite"` for
 *                   backwards compatibility.
 *
 * @example
 *   const src = generateDrizzleSchema([ticketModel, userModel]);
 *   fs.writeFileSync("schema.ts", src);
 *
 * @example
 *   const src = generateDrizzleSchema([ticketModel], "postgres");
 *
 * @example
 *   const src = generateDrizzleSchema([ticketModel], "mysql");
 */
export function generateDrizzleSchema(
  models: ModelDefinition[],
  provider: Provider = "sqlite",
): string {
  const meta = providerMeta(provider);

  // Collect all drizzle imports we need
  const neededImports = new Set<string>([meta.tableBuilder]);
  let needsSql = false;

  // First pass: determine imports
  for (const model of models) {
    for (const [fieldName, def] of Object.entries(model.fields)) {
      const result = buildColumnExpr(fieldName, def, provider);
      for (const imp of result.imports) {
        neededImports.add(imp);
      }
      if (result.needsSql) {
        needsSql = true;
      }
    }
  }

  // Build import line
  const importNames = [...neededImports].sort();
  const lines: string[] = [];
  lines.push(`import { ${importNames.join(", ")} } from "${meta.importModule}";`);
  if (needsSql) {
    lines.push(`import { sql } from "drizzle-orm";`);
  }

  // Generate each table
  for (const model of models) {
    const tableName = pluralise(model.name);
    const varName = tableName;

    lines.push("");
    lines.push(`export const ${varName} = ${meta.tableBuilder}("${tableName}", {`);

    const fieldEntries = Object.entries(model.fields);
    for (let i = 0; i < fieldEntries.length; i++) {
      const [fieldName, def] = fieldEntries[i]!;
      const result = buildColumnExpr(fieldName, def, provider);
      const comma = i < fieldEntries.length - 1 ? "," : ",";
      lines.push(`  ${fieldName}: ${result.expr}${comma}`);
    }

    lines.push("});");
  }

  return lines.join("\n") + "\n";
}

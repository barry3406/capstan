import type { DbProvider, FieldDefinition, ScalarType } from "./types.js";

export interface ProviderMeta {
  tableBuilder: string;
  importModule: string;
  nowDefaultSql: string;
}

export interface ColumnMapping {
  builder: string;
  import: string;
  config?: string;
  sqlType: string;
}

const SQLITE_UUID_SQL =
  "(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || " +
  "substr(lower(hex(randomblob(2))), 2) || '-' || " +
  "substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || " +
  "lower(hex(randomblob(6))))";

export function providerMeta(provider: DbProvider): ProviderMeta {
  switch (provider) {
    case "sqlite":
    case "libsql":
      return {
        tableBuilder: "sqliteTable",
        importModule: "drizzle-orm/sqlite-core",
        nowDefaultSql: "(datetime('now'))",
      };
    case "postgres":
      return {
        tableBuilder: "pgTable",
        importModule: "drizzle-orm/pg-core",
        nowDefaultSql: "now()",
      };
    case "mysql":
      return {
        tableBuilder: "mysqlTable",
        importModule: "drizzle-orm/mysql-core",
        nowDefaultSql: "CURRENT_TIMESTAMP",
      };
  }
}

function sqliteColumnMapping(fieldType: ScalarType): ColumnMapping {
  switch (fieldType) {
    case "string":
    case "text":
    case "date":
    case "datetime":
      return { builder: "text", import: "text", sqlType: "TEXT" };
    case "integer":
      return { builder: "integer", import: "integer", sqlType: "INTEGER" };
    case "number":
      return { builder: "real", import: "real", sqlType: "REAL" };
    case "boolean":
      return { builder: "integer", import: "integer", config: '{ mode: "boolean" }', sqlType: "INTEGER" };
    case "json":
      return { builder: "text", import: "text", config: '{ mode: "json" }', sqlType: "TEXT" };
    case "vector":
      return { builder: "text", import: "text", config: '{ mode: "json" }', sqlType: "TEXT" };
  }
}

function pgColumnMapping(fieldType: ScalarType, dimensions?: number): ColumnMapping {
  switch (fieldType) {
    case "string":
      return { builder: "varchar", import: "varchar", config: "{ length: 255 }", sqlType: "VARCHAR(255)" };
    case "text":
      return { builder: "text", import: "text", sqlType: "TEXT" };
    case "date":
      return { builder: "date", import: "date", sqlType: "DATE" };
    case "datetime":
      return { builder: "timestamp", import: "timestamp", sqlType: "TIMESTAMP" };
    case "integer":
      return { builder: "integer", import: "integer", sqlType: "INTEGER" };
    case "number":
      return { builder: "doublePrecision", import: "doublePrecision", sqlType: "DOUBLE PRECISION" };
    case "boolean":
      return { builder: "boolean", import: "boolean", sqlType: "BOOLEAN" };
    case "json":
      return { builder: "jsonb", import: "jsonb", sqlType: "JSONB" };
    case "vector":
      return {
        builder: "vector",
        import: "vector",
        config: `{ dimensions: ${dimensions ?? 1536} }`,
        sqlType: `vector(${dimensions ?? 1536})`,
      };
  }
}

function mysqlColumnMapping(fieldType: ScalarType): ColumnMapping {
  switch (fieldType) {
    case "string":
      return { builder: "varchar", import: "varchar", config: "{ length: 255 }", sqlType: "VARCHAR(255)" };
    case "text":
      return { builder: "text", import: "text", sqlType: "TEXT" };
    case "date":
      return { builder: "date", import: "date", sqlType: "DATE" };
    case "datetime":
      return { builder: "datetime", import: "datetime", sqlType: "DATETIME" };
    case "integer":
      return { builder: "int", import: "int", sqlType: "INT" };
    case "number":
      return { builder: "double", import: "double", sqlType: "DOUBLE" };
    case "boolean":
      return { builder: "boolean", import: "boolean", sqlType: "BOOLEAN" };
    case "json":
      return { builder: "json", import: "json", sqlType: "JSON" };
    case "vector":
      return { builder: "json", import: "json", sqlType: "JSON" };
  }
}

export function columnMapping(fieldType: ScalarType, provider: DbProvider, dimensions?: number): ColumnMapping {
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

export function columnMappingForReference(targetField: FieldDefinition, provider: DbProvider): ColumnMapping {
  if (targetField.autoId) {
    switch (provider) {
      case "sqlite":
      case "libsql":
        return { builder: "text", import: "text", sqlType: "TEXT" };
      case "postgres":
        return { builder: "uuid", import: "uuid", sqlType: "UUID" };
      case "mysql":
        return { builder: "varchar", import: "varchar", config: "{ length: 36 }", sqlType: "VARCHAR(36)" };
    }
  }

  return columnMapping(targetField.type, provider, targetField.dimensions);
}

export function sqlTypeForField(def: FieldDefinition, provider: DbProvider): string {
  if (def.autoId) {
    switch (provider) {
      case "sqlite":
      case "libsql":
        return "TEXT";
      case "postgres":
        return "UUID";
      case "mysql":
        return "VARCHAR(36)";
    }
  }
  return columnMapping(def.type, provider, def.dimensions).sqlType;
}

export function sqlTypeForReference(targetField: FieldDefinition, provider: DbProvider): string {
  return columnMappingForReference(targetField, provider).sqlType;
}

export function autoIdSchemaExpr(columnName: string, provider: DbProvider): { expr: string; imports: string[]; needsSql: boolean } {
  switch (provider) {
    case "sqlite":
    case "libsql":
      return {
        expr: `text("${columnName}").primaryKey().default(sql\`${SQLITE_UUID_SQL}\`)`,
        imports: ["text"],
        needsSql: true,
      };
    case "postgres":
      return {
        expr: `uuid("${columnName}").primaryKey().defaultRandom()`,
        imports: ["uuid"],
        needsSql: false,
      };
    case "mysql":
      return {
        expr: `varchar("${columnName}", { length: 36 }).primaryKey().default(sql\`(UUID())\`)`,
        imports: ["varchar"],
        needsSql: true,
      };
  }
}

export function autoIdSqlDefault(provider: DbProvider): string {
  switch (provider) {
    case "sqlite":
    case "libsql":
      return `DEFAULT ${SQLITE_UUID_SQL}`;
    case "postgres":
      return "DEFAULT gen_random_uuid()";
    case "mysql":
      return "DEFAULT (UUID())";
  }
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function sqlDefaultClause(def: FieldDefinition, provider: DbProvider): string | null {
  if (def.autoId) {
    return autoIdSqlDefault(provider);
  }

  if (def.updatedAt && def.default === undefined) {
    return `DEFAULT ${providerMeta(provider).nowDefaultSql}`;
  }

  if (def.default === undefined) return null;
  if (def.default === "now") {
    return `DEFAULT ${providerMeta(provider).nowDefaultSql}`;
  }
  if (typeof def.default === "string") {
    return `DEFAULT ${sqlStringLiteral(def.default)}`;
  }
  if (typeof def.default === "boolean") {
    switch (provider) {
      case "postgres":
      case "mysql":
        return `DEFAULT ${def.default ? "true" : "false"}`;
      case "sqlite":
      case "libsql":
        return `DEFAULT ${def.default ? "1" : "0"}`;
    }
  }
  if (typeof def.default === "number") {
    return `DEFAULT ${def.default}`;
  }
  if (typeof def.default === "object") {
    return `DEFAULT ${sqlStringLiteral(JSON.stringify(def.default))}`;
  }
  return null;
}

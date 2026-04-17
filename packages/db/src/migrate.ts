import { sqlDefaultClause, sqlTypeForField, sqlTypeForReference } from "./dialect.js";
import { indexSignature, resolveReferenceField, stableFieldSignature, tableNameForModel, toSnakeCase } from "./naming.js";
import type { DbProvider, FieldDefinition, IndexDefinition, ModelDefinition } from "./types.js";

function columnDef(
  fieldName: string,
  def: FieldDefinition,
  provider: DbProvider,
  modelMap: Map<string, ModelDefinition>,
): string {
  const colName = toSnakeCase(fieldName);
  const referencedField = def.references
    ? (() => {
        const target = resolveReferenceField(def.references, modelMap);
        return modelMap.get(target.modelName)?.fields[target.fieldName];
      })()
    : undefined;
  const parts: string[] = [colName, referencedField ? sqlTypeForReference(referencedField, provider) : sqlTypeForField(def, provider)];

  if (def.autoId) {
    parts.push("PRIMARY KEY");
  }
  if ((def.required || def.updatedAt) && !def.autoId) {
    parts.push("NOT NULL");
  }
  if (def.unique && !def.autoId) {
    parts.push("UNIQUE");
  }

  const defaultExpr = sqlDefaultClause(def, provider);
  if (defaultExpr) {
    parts.push(defaultExpr);
  }

  if (def.references) {
    const target = resolveReferenceField(def.references, modelMap);
    parts.push(`REFERENCES ${tableNameForModel(target.modelName)}(${toSnakeCase(target.fieldName)})`);
  }

  return parts.join(" ");
}

function createTableSQL(
  model: ModelDefinition,
  provider: DbProvider,
  modelMap: Map<string, ModelDefinition>,
  tableNameOverride?: string,
): string {
  const tableName = tableNameOverride ?? tableNameForModel(model);
  const cols = Object.entries(model.fields).map(([name, def]) => `  ${columnDef(name, def, provider, modelMap)}`);
  return `CREATE TABLE ${tableName} (\n${cols.join(",\n")}\n)`;
}

function dropTableSQL(tableName: string, provider: DbProvider): string {
  switch (provider) {
    case "sqlite":
    case "libsql":
    case "postgres":
    case "mysql":
      return `DROP TABLE IF EXISTS ${tableName}`;
  }
}

function addColumnSQL(
  tableName: string,
  fieldName: string,
  def: FieldDefinition,
  provider: DbProvider,
  modelMap: Map<string, ModelDefinition>,
): string {
  return `ALTER TABLE ${tableName} ADD COLUMN ${columnDef(fieldName, def, provider, modelMap)}`;
}

function renameColumnSQL(
  tableName: string,
  fromFieldName: string,
  toFieldName: string,
): string {
  return `ALTER TABLE ${tableName} RENAME COLUMN ${toSnakeCase(fromFieldName)} TO ${toSnakeCase(toFieldName)}`;
}

function renameTableSQL(fromTableName: string, toTableName: string, provider: DbProvider): string {
  switch (provider) {
    case "mysql":
      return `RENAME TABLE ${fromTableName} TO ${toTableName}`;
    case "sqlite":
    case "libsql":
    case "postgres":
      return `ALTER TABLE ${fromTableName} RENAME TO ${toTableName}`;
  }
}

function indexName(tableName: string, idx: IndexDefinition): string {
  return `idx_${tableName}_${idx.fields.map(toSnakeCase).join("_")}`;
}

function createIndexSQL(tableName: string, idx: IndexDefinition, provider: DbProvider): string {
  const idxName = indexName(tableName, idx);
  const unique = idx.unique ? "UNIQUE " : "";
  const cols = idx.fields.map((fieldName) => {
    const col = toSnakeCase(fieldName);
    return idx.order ? `${col} ${idx.order.toUpperCase()}` : col;
  });

  switch (provider) {
    case "sqlite":
    case "libsql":
    case "postgres":
      return `CREATE ${unique}INDEX IF NOT EXISTS ${idxName} ON ${tableName} (${cols.join(", ")})`;
    case "mysql":
      return `CREATE ${unique}INDEX ${idxName} ON ${tableName} (${cols.join(", ")})`;
  }
}

function dropIndexSQL(tableName: string, idx: IndexDefinition, provider: DbProvider): string {
  const idxName = indexName(tableName, idx);
  switch (provider) {
    case "sqlite":
    case "libsql":
    case "postgres":
      return `DROP INDEX IF EXISTS ${idxName}`;
    case "mysql":
      return `DROP INDEX ${idxName} ON ${tableName}`;
  }
}

interface TableInfo {
  tableName: string;
  model: ModelDefinition;
}

function tableInfo(model: ModelDefinition): TableInfo {
  return { tableName: tableNameForModel(model), model };
}

export type MigrationIssueCode =
  | "DROP_TABLE"
  | "DROP_COLUMN"
  | "ALTER_COLUMN"
  | "DROP_INDEX"
  | "RENAME_COLUMN";

export interface MigrationIssue {
  code: MigrationIssueCode;
  message: string;
  tableName: string;
  fieldName?: string;
  destructive: boolean;
}

export interface MigrationPlan {
  provider: DbProvider;
  statements: string[];
  issues: MigrationIssue[];
  safe: boolean;
}

export interface MigrationOptions {
  provider?: DbProvider;
  allowDestructive?: boolean;
  strict?: boolean;
}

function resolveMigrationOptions(options?: DbProvider | MigrationOptions): Required<MigrationOptions> {
  if (!options) {
    return { provider: "sqlite", allowDestructive: false, strict: false };
  }
  if (typeof options === "string") {
    return { provider: options, allowDestructive: false, strict: false };
  }
  return {
    provider: options.provider ?? "sqlite",
    allowDestructive: options.allowDestructive ?? false,
    strict: options.strict ?? false,
  };
}

function isBlockingIssue(issue: MigrationIssue): boolean {
  return issue.code !== "RENAME_COLUMN";
}

interface ColumnRename {
  fromFieldName: string;
  toFieldName: string;
}

function detectColumnRenames(
  fromModel: ModelDefinition,
  toModel: ModelDefinition,
): ColumnRename[] {
  const removed = Object.keys(fromModel.fields).filter((fieldName) => !(fieldName in toModel.fields));
  const added = Object.keys(toModel.fields).filter((fieldName) => !(fieldName in fromModel.fields));
  const used = new Set<string>();
  const renames: ColumnRename[] = [];

  for (const toFieldName of added) {
    const matches = removed.filter((fromFieldName) =>
      !used.has(fromFieldName) &&
      stableFieldSignature(fromModel.fields[fromFieldName]!) === stableFieldSignature(toModel.fields[toFieldName]!)
    );
    if (matches.length === 1) {
      const fromFieldName = matches[0]!;
      used.add(fromFieldName);
      renames.push({ fromFieldName, toFieldName });
    }
  }

  return renames;
}

function tempTableName(tableName: string): string {
  return `__capstan_tmp_${tableName}`;
}

function buildTableRewriteSQL(
  fromModel: ModelDefinition,
  toModel: ModelDefinition,
  provider: DbProvider,
  modelMap: Map<string, ModelDefinition>,
  renames: ColumnRename[],
): string[] {
  const tableName = tableNameForModel(toModel);
  const tempName = tempTableName(tableName);
  const renamedFields = new Map(renames.map((rename) => [rename.toFieldName, rename.fromFieldName] as const));
  const copyColumns = Object.keys(toModel.fields)
    .map((fieldName) => {
      const sourceFieldName = renamedFields.get(fieldName) ?? (fieldName in fromModel.fields ? fieldName : null);
      if (!sourceFieldName) {
        return null;
      }
      return {
        targetColumn: toSnakeCase(fieldName),
        sourceColumn: toSnakeCase(sourceFieldName),
      };
    })
    .filter((entry): entry is { targetColumn: string; sourceColumn: string } => entry !== null);

  const statements = [createTableSQL(toModel, provider, modelMap, tempName)];
  if (copyColumns.length > 0) {
    statements.push(
      `INSERT INTO ${tempName} (${copyColumns.map((entry) => entry.targetColumn).join(", ")}) ` +
      `SELECT ${copyColumns.map((entry) => entry.sourceColumn).join(", ")} FROM ${tableName}`,
    );
  }
  statements.push(dropTableSQL(tableName, provider));
  statements.push(renameTableSQL(tempName, tableName, provider));
  for (const idx of toModel.indexes) {
    statements.push(createIndexSQL(tableName, idx, provider));
  }
  return statements;
}

export function planMigration(
  fromModels: ModelDefinition[],
  toModels: ModelDefinition[],
  options?: DbProvider | MigrationOptions,
): MigrationPlan {
  const resolved = resolveMigrationOptions(options);
  const statements: string[] = [];
  const issues: MigrationIssue[] = [];

  const fromMap = new Map<string, TableInfo>();
  for (const model of fromModels) {
    const info = tableInfo(model);
    fromMap.set(info.tableName, info);
  }

  const toMap = new Map<string, TableInfo>();
  for (const model of toModels) {
    const info = tableInfo(model);
    toMap.set(info.tableName, info);
  }
  const modelMap = new Map<string, ModelDefinition>([
    ...fromModels.map((model) => [model.name, model] as const),
    ...toModels.map((model) => [model.name, model] as const),
  ]);

  for (const [tableName] of fromMap) {
    if (!toMap.has(tableName)) {
      issues.push({
        code: "DROP_TABLE",
        tableName,
        destructive: true,
        message: `Table "${tableName}" no longer exists in the target model set.`,
      });
      if (resolved.allowDestructive) {
        statements.push(dropTableSQL(tableName, resolved.provider));
      }
    }
  }

  for (const [tableName, toInfo] of toMap) {
    const fromInfo = fromMap.get(tableName);
    if (!fromInfo) {
      statements.push(createTableSQL(toInfo.model, resolved.provider, modelMap));
      for (const idx of toInfo.model.indexes) {
        statements.push(createIndexSQL(tableName, idx, resolved.provider));
      }
      continue;
    }

    const fromFieldNames = new Set(Object.keys(fromInfo.model.fields));
    const toFieldNames = new Set(Object.keys(toInfo.model.fields));
    const renames = detectColumnRenames(fromInfo.model, toInfo.model);
    const renamedFrom = new Set(renames.map((rename) => rename.fromFieldName));
    const renamedTo = new Set(renames.map((rename) => rename.toFieldName));
    const addedFieldNames = [...toFieldNames].filter((fieldName) => !fromFieldNames.has(fieldName) && !renamedTo.has(fieldName));
    const removedFieldNames = [...fromFieldNames].filter((fieldName) => !toFieldNames.has(fieldName) && !renamedFrom.has(fieldName));
    const changedFieldNames = Object.keys(toInfo.model.fields).filter((fieldName) =>
      fieldName in fromInfo.model.fields &&
      stableFieldSignature(fromInfo.model.fields[fieldName]!) !== stableFieldSignature(toInfo.model.fields[fieldName]!)
    );

    for (const rename of renames) {
      issues.push({
        code: "RENAME_COLUMN",
        tableName,
        fieldName: `${rename.fromFieldName}->${rename.toFieldName}`,
        destructive: false,
        message: `Column "${tableName}.${rename.fromFieldName}" was renamed to "${rename.toFieldName}".`,
      });
    }

    for (const fieldName of removedFieldNames) {
      issues.push({
        code: "DROP_COLUMN",
        tableName,
        fieldName,
        destructive: true,
        message: `Column "${tableName}.${fieldName}" no longer exists in the target model set.`,
      });
    }

    const needsRewrite = changedFieldNames.length > 0 || removedFieldNames.length > 0;
    const canRewrite = removedFieldNames.length === 0 || resolved.allowDestructive;

    if (needsRewrite && canRewrite) {
      statements.push(...buildTableRewriteSQL(fromInfo.model, toInfo.model, resolved.provider, modelMap, renames));
    } else {
      for (const rename of renames) {
        statements.push(renameColumnSQL(tableName, rename.fromFieldName, rename.toFieldName));
      }

      for (const fieldName of addedFieldNames) {
        statements.push(addColumnSQL(tableName, fieldName, toInfo.model.fields[fieldName]!, resolved.provider, modelMap));
      }

      for (const fieldName of changedFieldNames) {
        issues.push({
          code: "ALTER_COLUMN",
          tableName,
          fieldName,
          destructive: false,
          message: `Column "${tableName}.${fieldName}" changed shape and requires a table rewrite migration.`,
        });
      }
    }

    const existingIndexes = new Map(
      fromInfo.model.indexes.map((idx) => [indexSignature(idx), idx] as const),
    );
    const nextIndexes = new Map(
      toInfo.model.indexes.map((idx) => [indexSignature(idx), idx] as const),
    );

    if (!needsRewrite || !canRewrite) {
      for (const [signature, idx] of nextIndexes) {
        if (!existingIndexes.has(signature)) {
          statements.push(createIndexSQL(tableName, idx, resolved.provider));
        }
      }

      for (const [signature, idx] of existingIndexes) {
        if (!nextIndexes.has(signature)) {
          issues.push({
            code: "DROP_INDEX",
            tableName,
            destructive: true,
            message: `Index "${indexName(tableName, idx)}" no longer exists in the target model set.`,
          });
          if (resolved.allowDestructive) {
            statements.push(dropIndexSQL(tableName, idx, resolved.provider));
          }
        }
      }
    }
  }

  return {
    provider: resolved.provider,
    statements,
    issues,
    safe: issues.every((issue) => !isBlockingIssue(issue)),
  };
}

export function generateMigration(
  fromModels: ModelDefinition[],
  toModels: ModelDefinition[],
  options?: DbProvider | MigrationOptions,
): string[] {
  const resolved = resolveMigrationOptions(options);
  const plan = planMigration(fromModels, toModels, resolved);

  if (resolved.strict && plan.issues.some((issue) => isBlockingIssue(issue))) {
    const details = plan.issues
      .map((issue) => `- ${issue.code}: ${issue.message}`)
      .join("\n");
    throw new Error(`Unsafe or unsupported migration changes detected:\n${details}`);
  }

  return plan.statements;
}

export function applyMigration(db: { $client: { exec: (sql: string) => void } }, sql: string[]): void {
  if (sql.length === 0) return;

  const client = db.$client;
  client.exec("BEGIN TRANSACTION");
  try {
    for (const stmt of sql) {
      client.exec(stmt);
    }
    client.exec("COMMIT");
  } catch (err) {
    client.exec("ROLLBACK");
    throw err;
  }
}

function createTrackingTableSQL(provider: DbProvider): string {
  switch (provider) {
    case "postgres":
      return `CREATE TABLE IF NOT EXISTS _capstan_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
)`;
    case "mysql":
      return `CREATE TABLE IF NOT EXISTS _capstan_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
    case "sqlite":
    case "libsql":
    default:
      return `CREATE TABLE IF NOT EXISTS _capstan_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;
  }
}

export interface MigrationDbClient {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    run: (...params: unknown[]) => unknown;
    get: (...params: unknown[]) => unknown;
  };
}

export function ensureTrackingTable(client: MigrationDbClient, provider: DbProvider = "sqlite"): void {
  client.exec(createTrackingTableSQL(provider));
}

export interface AsyncMigrationDbClient {
  query: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
  transaction: <T>(fn: (client: AsyncMigrationDbClient) => Promise<T>) => Promise<T>;
}

function trackingNamePlaceholder(provider: DbProvider): string {
  return provider === "postgres" ? "$1" : "?";
}

export async function ensureTrackingTableAsync(
  client: AsyncMigrationDbClient,
  provider: DbProvider = "sqlite",
): Promise<void> {
  await client.execute(createTrackingTableSQL(provider));
}

export function getAppliedMigrations(client: MigrationDbClient): string[] {
  const rows = client.prepare(
    "SELECT name FROM _capstan_migrations ORDER BY id ASC",
  ).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

export async function getAppliedMigrationsAsync(client: AsyncMigrationDbClient): Promise<string[]> {
  const rows = await client.query("SELECT name FROM _capstan_migrations ORDER BY id ASC");
  return rows.map((row) => String(row.name));
}

export interface MigrationStatus {
  applied: Array<{ name: string; appliedAt: string }>;
  pending: string[];
}

export function getMigrationStatus(
  client: MigrationDbClient,
  allMigrationNames: string[],
  provider: DbProvider = "sqlite",
): MigrationStatus {
  ensureTrackingTable(client, provider);

  const rows = client.prepare(
    "SELECT name, applied_at FROM _capstan_migrations ORDER BY id ASC",
  ).all() as Array<{ name: string; applied_at: string }>;

  const appliedSet = new Set(rows.map((row) => row.name));

  return {
    applied: rows.map((row) => ({ name: row.name, appliedAt: row.applied_at })),
    pending: allMigrationNames.filter((name) => !appliedSet.has(name)),
  };
}

export async function getMigrationStatusAsync(
  client: AsyncMigrationDbClient,
  allMigrationNames: string[],
  provider: DbProvider = "sqlite",
): Promise<MigrationStatus> {
  await ensureTrackingTableAsync(client, provider);

  const rows = await client.query(
    "SELECT name, applied_at FROM _capstan_migrations ORDER BY id ASC",
  ) as Array<{ name: string; applied_at: string }>;

  const appliedSet = new Set(rows.map((row) => row.name));

  return {
    applied: rows.map((row) => ({ name: row.name, appliedAt: row.applied_at })),
    pending: allMigrationNames.filter((name) => !appliedSet.has(name)),
  };
}

export function applyTrackedMigrations(
  client: MigrationDbClient,
  migrations: Array<{ name: string; sql: string }>,
  provider: DbProvider = "sqlite",
): string[] {
  ensureTrackingTable(client, provider);

  const applied = getAppliedMigrations(client);
  const appliedSet = new Set(applied);

  const pending = migrations.filter((migration) => !appliedSet.has(migration.name));
  if (pending.length === 0) return [];

  const executed: string[] = [];

  for (const migration of pending) {
    const statements = migration.sql
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0 && !statement.startsWith("--"));

    client.exec("BEGIN TRANSACTION");
    try {
      for (const stmt of statements) {
        client.exec(stmt);
      }
      client.prepare(
        "INSERT INTO _capstan_migrations (name) VALUES (?)",
      ).run(migration.name);
      client.exec("COMMIT");
      executed.push(migration.name);
    } catch (err) {
      client.exec("ROLLBACK");
      throw err;
    }
  }

  return executed;
}

export async function applyTrackedMigrationsAsync(
  client: AsyncMigrationDbClient,
  migrations: Array<{ name: string; sql: string }>,
  provider: DbProvider = "sqlite",
): Promise<string[]> {
  await ensureTrackingTableAsync(client, provider);

  const applied = await getAppliedMigrationsAsync(client);
  const appliedSet = new Set(applied);

  const pending = migrations.filter((migration) => !appliedSet.has(migration.name));
  if (pending.length === 0) return [];

  const executed: string[] = [];

  for (const migration of pending) {
    const statements = migration.sql
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0 && !statement.startsWith("--"));

    await client.transaction(async (tx) => {
      for (const stmt of statements) {
        await tx.execute(stmt);
      }
      await tx.execute(
        `INSERT INTO _capstan_migrations (name) VALUES (${trackingNamePlaceholder(provider)})`,
        [migration.name],
      );
    });
    executed.push(migration.name);
  }

  return executed;
}

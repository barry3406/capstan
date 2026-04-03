import {
  findModelByReference,
  findPrimaryKeyField,
  inferRelationForeignKey,
  resolveManyToManyRelation,
  resolveReferenceField,
  resolveTargetRelationForeignKey,
  tableNameForModel,
  toSnakeCase,
} from "./naming.js";
import type { PrepareWriteOptions } from "./write.js";
import { prepareCreateData, prepareUpdateData } from "./write.js";
import type { DbProvider, FieldDefinition, ModelDefinition, RelationDefinition } from "./types.js";

type RecordRow = Record<string, unknown>;

export interface SqlMutationResult {
  affectedRows: number;
  rows?: RecordRow[];
}

export interface SqlRuntimeAdapter {
  provider: DbProvider;
  query: (sql: string, params?: unknown[]) => Promise<RecordRow[]>;
  execute: (sql: string, params?: unknown[]) => Promise<SqlMutationResult>;
  transaction: <T>(fn: (adapter: SqlRuntimeAdapter) => Promise<T>) => Promise<T>;
}

export interface QueryOrder {
  field: string;
  direction?: "asc" | "desc";
}

export interface FindManyOptions {
  where?: Record<string, unknown>;
  orderBy?: QueryOrder | QueryOrder[];
  limit?: number;
  offset?: number;
  with?: string[];
}

export interface ModelRepository<M extends ModelDefinition = ModelDefinition> {
  readonly model: M;
  readonly tableName: string;
  readonly primaryKeyField: string | null;
  count: (where?: Record<string, unknown>) => Promise<number>;
  findMany: (options?: FindManyOptions) => Promise<Array<RecordRow>>;
  findById: (id: unknown, options?: Omit<FindManyOptions, "where" | "limit" | "offset">) => Promise<RecordRow | null>;
  create: (input: Record<string, unknown>, options?: PrepareWriteOptions) => Promise<RecordRow>;
  update: (id: unknown, input: Record<string, unknown>, options?: PrepareWriteOptions) => Promise<RecordRow | null>;
  delete: (id: unknown) => Promise<boolean>;
  relate: (id: unknown, relationName: string, options?: Omit<FindManyOptions, "where">) => Promise<unknown>;
}

export interface DatabaseRuntime {
  db: unknown;
  provider: DbProvider;
  close: () => void | Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<RecordRow[]>;
  execute: (sql: string, params?: unknown[]) => Promise<SqlMutationResult>;
  applyMigration: (statements: string[]) => Promise<void>;
  registerModels: (models: ModelDefinition[]) => DatabaseRuntime;
  model: <M extends ModelDefinition>(model: M | string) => ModelRepository<M>;
  transaction: <T>(fn: (database: DatabaseRuntime) => Promise<T>) => Promise<T>;
  readonly models: Record<string, ModelRepository<ModelDefinition>>;
}

function quoteIdentifier(provider: DbProvider, identifier: string): string {
  if (provider === "mysql") {
    return `\`${identifier.replace(/`/g, "``")}\``;
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

function placeholder(provider: DbProvider, index: number): string {
  return provider === "postgres" ? `$${index}` : "?";
}

function valuePlaceholderList(provider: DbProvider, start: number, count: number): string {
  return Array.from({ length: count }, (_, offset) => placeholder(provider, start + offset)).join(", ");
}

function encodeFieldValue(field: FieldDefinition, value: unknown, provider: DbProvider): unknown {
  if (value === undefined) return value;
  if (value === null) return null;

  switch (field.type) {
    case "boolean":
      if (provider === "sqlite" || provider === "libsql") {
        return value ? 1 : 0;
      }
      return value;
    case "json":
      return JSON.stringify(value);
    case "vector":
      if (provider === "postgres") {
        return Array.isArray(value) ? `[${value.join(",")}]` : value;
      }
      return JSON.stringify(value);
    default:
      return value;
  }
}

function decodeFieldValue(field: FieldDefinition, value: unknown, provider: DbProvider): unknown {
  if (value === undefined || value === null) return value;

  switch (field.type) {
    case "boolean":
      if (provider === "sqlite" || provider === "libsql" || typeof value === "number") {
        return Boolean(value);
      }
      return value;
    case "json":
      if (typeof value === "string") {
        return JSON.parse(value);
      }
      return value;
    case "vector":
      if (Array.isArray(value)) return value;
      if (typeof value === "string") {
        return JSON.parse(value);
      }
      return value;
    default:
      return value;
  }
}

function selectListForModel(model: ModelDefinition, provider: DbProvider, tableAlias?: string): string {
  const prefix = tableAlias ? `${quoteIdentifier(provider, tableAlias)}.` : "";
  return Object.keys(model.fields)
    .map((fieldName) =>
      `${prefix}${quoteIdentifier(provider, toSnakeCase(fieldName))} AS ${quoteIdentifier(provider, fieldName)}`
    )
    .join(", ");
}

function mapRowToModel(model: ModelDefinition, row: RecordRow, provider: DbProvider): RecordRow {
  const mapped: RecordRow = {};
  for (const [fieldName, field] of Object.entries(model.fields)) {
    const raw = row[fieldName] ?? row[toSnakeCase(fieldName)];
    mapped[fieldName] = decodeFieldValue(field, raw, provider);
  }
  return mapped;
}

function assertField(model: ModelDefinition, fieldName: string): FieldDefinition {
  const field = model.fields[fieldName];
  if (!field) {
    throw new Error(`Unknown field "${fieldName}" for model "${model.name}".`);
  }
  return field;
}

function normalizeWhere(
  model: ModelDefinition,
  where: Record<string, unknown> | undefined,
  provider: DbProvider,
  startIndex = 1,
  tableAlias?: string,
): { clause: string; params: unknown[]; nextIndex: number } {
  if (!where || Object.keys(where).length === 0) {
    return { clause: "", params: [], nextIndex: startIndex };
  }

  const params: unknown[] = [];
  const parts: string[] = [];
  let index = startIndex;
  const prefix = tableAlias ? `${quoteIdentifier(provider, tableAlias)}.` : "";

  for (const [fieldName, rawValue] of Object.entries(where)) {
    if (rawValue === undefined) continue;
    const field = assertField(model, fieldName);
    const column = `${prefix}${quoteIdentifier(provider, toSnakeCase(fieldName))}`;

    if (Array.isArray(rawValue)) {
      if (rawValue.length === 0) {
        parts.push("1 = 0");
        continue;
      }
      parts.push(`${column} IN (${valuePlaceholderList(provider, index, rawValue.length)})`);
      for (const value of rawValue) {
        params.push(encodeFieldValue(field, value, provider));
      }
      index += rawValue.length;
      continue;
    }

    parts.push(`${column} = ${placeholder(provider, index)}`);
    params.push(encodeFieldValue(field, rawValue, provider));
    index += 1;
  }

  if (parts.length === 0) {
    return { clause: "", params, nextIndex: index };
  }

  return {
    clause: ` WHERE ${parts.join(" AND ")}`,
    params,
    nextIndex: index,
  };
}

function normalizeOrderBy(
  model: ModelDefinition,
  provider: DbProvider,
  orderBy?: QueryOrder | QueryOrder[],
  tableAlias?: string,
): string {
  if (!orderBy) return "";
  const items = Array.isArray(orderBy) ? orderBy : [orderBy];
  if (items.length === 0) return "";

  const prefix = tableAlias ? `${quoteIdentifier(provider, tableAlias)}.` : "";
  const clauses = items.map((entry) => {
    assertField(model, entry.field);
    const direction = entry.direction?.toUpperCase() === "DESC" ? "DESC" : "ASC";
    return `${prefix}${quoteIdentifier(provider, toSnakeCase(entry.field))} ${direction}`;
  });

  return clauses.length > 0 ? ` ORDER BY ${clauses.join(", ")}` : "";
}

function normalizePagination(limit?: number, offset?: number): string {
  const parts: string[] = [];
  if (limit !== undefined) {
    parts.push(` LIMIT ${Math.max(0, Math.trunc(limit))}`);
  }
  if (offset !== undefined) {
    if (limit === undefined) {
      parts.push(" LIMIT -1");
    }
    parts.push(` OFFSET ${Math.max(0, Math.trunc(offset))}`);
  }
  return parts.join("");
}

function relationModel(
  relation: RelationDefinition,
  modelMap: Map<string, ModelDefinition>,
): ModelDefinition {
  const model = findModelByReference(relation.model, modelMap);
  if (!model) {
    throw new Error(`Unknown related model "${relation.model}".`);
  }
  return model;
}

function buildRelationMetadata(
  sourceModel: ModelDefinition,
  relationName: string,
  relation: RelationDefinition,
  modelMap: Map<string, ModelDefinition>,
): { targetModel: ModelDefinition; sourceField: string; targetField: string; through?: ReturnType<typeof resolveManyToManyRelation> } {
  const targetModel = relationModel(relation, modelMap);

  switch (relation.kind) {
    case "belongsTo":
      {
        const foreignKey = inferRelationForeignKey(relation);
        const reference = sourceModel.fields[foreignKey]?.references;
        const targetField = reference
          ? resolveReferenceField(reference, modelMap).fieldName
          : (findPrimaryKeyField(targetModel) ?? "id");
        return {
          targetModel,
          sourceField: foreignKey,
          targetField,
        };
      }
    case "hasMany":
    case "hasOne":
      return {
        targetModel,
        sourceField: findPrimaryKeyField(sourceModel) ?? "id",
        targetField: resolveTargetRelationForeignKey(sourceModel, relation, modelMap),
      };
    case "manyToMany": {
      const through = resolveManyToManyRelation(sourceModel, relation, modelMap);
      if (!through) {
        throw new Error(
          `Relation "${sourceModel.name}.${relationName}" must resolve an explicit through model with source and target foreign keys.`,
        );
      }
      return {
        targetModel,
        sourceField: through.sourcePrimaryKey,
        targetField: through.targetPrimaryKey,
        through,
      };
    }
  }
}

function buildRuntime(
  db: unknown,
  provider: DbProvider,
  close: () => void | Promise<void>,
  adapter: SqlRuntimeAdapter,
  initialModels?: Iterable<ModelDefinition>,
): DatabaseRuntime {
  const modelMap = new Map<string, ModelDefinition>();
  const repositoryMap = new Map<string, ModelRepository<ModelDefinition>>();

  const runtime = {} as DatabaseRuntime;

  function repositoryFor<M extends ModelDefinition>(input: M | string): ModelRepository<M> {
    const model = typeof input === "string"
      ? (modelMap.get(input) ?? findModelByReference(input, modelMap))
      : input;
    if (!model) {
      throw new Error(`Model "${String(input)}" is not registered in this database runtime.`);
    }

    if (!repositoryMap.has(model.name)) {
      repositoryMap.set(model.name, createModelRepository(model));
    }

    return repositoryMap.get(model.name)! as ModelRepository<M>;
  }

  function register(models: ModelDefinition[]): DatabaseRuntime {
    for (const model of models) {
      modelMap.set(model.name, model);
    }
    return runtime;
  }

  async function loadRelationRows(
    sourceModel: ModelDefinition,
    rows: RecordRow[],
    relationName: string,
    relation: RelationDefinition,
  ): Promise<void> {
    if (rows.length === 0) return;

    const meta = buildRelationMetadata(sourceModel, relationName, relation, modelMap);

    if (relation.kind === "manyToMany") {
      const through = meta.through!;
      const sourceIds = [...new Set(rows.map((row) => row[through.sourcePrimaryKey]).filter((value) => value !== undefined))];
      if (sourceIds.length === 0) {
        for (const row of rows) {
          row[relationName] = [];
        }
        return;
      }

      const throughTable = tableNameForModel(through.throughModel);
      const throughSourceColumn = toSnakeCase(through.sourceForeignKey);
      const throughTargetColumn = toSnakeCase(through.targetForeignKey);
      const joinRows = await adapter.query(
        `SELECT ${quoteIdentifier(provider, throughSourceColumn)} AS ${quoteIdentifier(provider, "__source")},
                ${quoteIdentifier(provider, throughTargetColumn)} AS ${quoteIdentifier(provider, "__target")}
         FROM ${quoteIdentifier(provider, throughTable)}
         WHERE ${quoteIdentifier(provider, throughSourceColumn)} IN (${valuePlaceholderList(provider, 1, sourceIds.length)})`,
        sourceIds.map((value) =>
          encodeFieldValue(through.throughModel.fields[through.sourceForeignKey]!, value, provider)
        ),
      );

      const targetIds = [...new Set(joinRows.map((row) => row.__target).filter((value) => value !== undefined))];
      const targetRows = targetIds.length > 0
        ? await repositoryFor(meta.targetModel).findMany({
            where: { [through.targetPrimaryKey]: targetIds },
          })
        : [];
      const targetMap = new Map(targetRows.map((row) => [row[through.targetPrimaryKey], row]));
      const grouped = new Map<unknown, RecordRow[]>();

      for (const joinRow of joinRows) {
        const sourceId = joinRow.__source;
        const target = targetMap.get(joinRow.__target);
        if (!grouped.has(sourceId)) {
          grouped.set(sourceId, []);
        }
        if (target) {
          grouped.get(sourceId)!.push(target);
        }
      }

      for (const row of rows) {
        row[relationName] = grouped.get(row[through.sourcePrimaryKey]) ?? [];
      }
      return;
    }

    if (relation.kind === "belongsTo") {
      const foreignKeys = [...new Set(rows.map((row) => row[meta.sourceField]).filter((value) => value !== undefined && value !== null))];
      if (foreignKeys.length === 0) {
        for (const row of rows) {
          row[relationName] = null;
        }
        return;
      }

      const targetRows = await repositoryFor(meta.targetModel).findMany({
        where: { [meta.targetField]: foreignKeys },
      });
      const targetMap = new Map(targetRows.map((row) => [row[meta.targetField], row]));

      for (const row of rows) {
        row[relationName] = targetMap.get(row[meta.sourceField]) ?? null;
      }
      return;
    }

    const sourceIds = [...new Set(rows.map((row) => row[meta.sourceField]).filter((value) => value !== undefined && value !== null))];
    if (sourceIds.length === 0) {
      for (const row of rows) {
        row[relationName] = relation.kind === "hasOne" ? null : [];
      }
      return;
    }

    const targetRows = await repositoryFor(meta.targetModel).findMany({
      where: { [meta.targetField]: sourceIds },
    });

    const grouped = new Map<unknown, RecordRow[]>();
    for (const targetRow of targetRows) {
      const key = targetRow[meta.targetField];
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(targetRow);
    }

    for (const row of rows) {
      const related = grouped.get(row[meta.sourceField]) ?? [];
      row[relationName] = relation.kind === "hasOne" ? (related[0] ?? null) : related;
    }
  }

  async function attachRelations(model: ModelDefinition, rows: RecordRow[], includes?: string[]): Promise<RecordRow[]> {
    if (!includes || includes.length === 0 || rows.length === 0) {
      return rows;
    }

    for (const relationName of includes) {
      const relation = model.relations[relationName];
      if (!relation) {
        throw new Error(`Unknown relation "${model.name}.${relationName}".`);
      }
      await loadRelationRows(model, rows, relationName, relation);
    }

    return rows;
  }

  async function loadRelationValue(
    sourceModel: ModelDefinition,
    row: RecordRow,
    relationName: string,
    relation: RelationDefinition,
    options?: Omit<FindManyOptions, "where">,
  ): Promise<unknown> {
    const meta = buildRelationMetadata(sourceModel, relationName, relation, modelMap);

    if (relation.kind === "manyToMany") {
      const through = meta.through!;
      const sourceId = row[through.sourcePrimaryKey];
      if (sourceId === undefined || sourceId === null) {
        return [];
      }

      const throughTable = tableNameForModel(through.throughModel);
      const throughTargetColumn = toSnakeCase(through.targetForeignKey);
      const joinRows = await adapter.query(
        `SELECT ${quoteIdentifier(provider, throughTargetColumn)} AS ${quoteIdentifier(provider, "__target")}
         FROM ${quoteIdentifier(provider, throughTable)}
         WHERE ${quoteIdentifier(provider, toSnakeCase(through.sourceForeignKey))} = ${placeholder(provider, 1)}`,
        [
          encodeFieldValue(
            through.throughModel.fields[through.sourceForeignKey]!,
            sourceId,
            provider,
          ),
        ],
      );

      const targetIds = [...new Set(joinRows.map((joinRow) => joinRow.__target).filter((value) => value !== undefined && value !== null))];
      if (targetIds.length === 0) {
        return [];
      }

      return repositoryFor(meta.targetModel).findMany({
        where: { [through.targetPrimaryKey]: targetIds },
        ...(options?.orderBy ? { orderBy: options.orderBy } : {}),
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
        ...(options?.offset !== undefined ? { offset: options.offset } : {}),
      });
    }

    if (relation.kind === "belongsTo") {
      const foreignKeyValue = row[meta.sourceField];
      if (foreignKeyValue === undefined || foreignKeyValue === null) {
        return null;
      }

      const related = await repositoryFor(meta.targetModel).findMany({
        where: { [meta.targetField]: foreignKeyValue },
        ...(options?.orderBy ? { orderBy: options.orderBy } : {}),
        limit: 1,
      });
      return related[0] ?? null;
    }

    const sourceKeyValue = row[meta.sourceField];
    if (sourceKeyValue === undefined || sourceKeyValue === null) {
      return relation.kind === "hasOne" ? null : [];
    }

    const related = await repositoryFor(meta.targetModel).findMany({
      where: { [meta.targetField]: sourceKeyValue },
      ...(options?.orderBy ? { orderBy: options.orderBy } : {}),
      ...((options?.limit !== undefined || relation.kind === "hasOne")
        ? { limit: options?.limit ?? 1 }
        : {}),
      ...(options?.offset !== undefined ? { offset: options.offset } : {}),
    });

    return relation.kind === "hasOne" ? (related[0] ?? null) : related;
  }

  function createModelRepository<M extends ModelDefinition>(model: M): ModelRepository<M> {
    const tableName = tableNameForModel(model);
    const primaryKeyField = findPrimaryKeyField(model);

    async function findMany(options?: FindManyOptions): Promise<RecordRow[]> {
      const where = normalizeWhere(model, options?.where, provider);
      const orderBy = normalizeOrderBy(model, provider, options?.orderBy);
      const pagination = normalizePagination(options?.limit, options?.offset);
      const sql =
        `SELECT ${selectListForModel(model, provider)} FROM ${quoteIdentifier(provider, tableName)}` +
        `${where.clause}${orderBy}${pagination}`;
      const rows = await adapter.query(sql, where.params);
      const mapped = rows.map((row) => mapRowToModel(model, row, provider));
      return attachRelations(model, mapped, options?.with);
    }

    async function findById(
      id: unknown,
      options?: Omit<FindManyOptions, "where" | "limit" | "offset">,
    ): Promise<RecordRow | null> {
      if (!primaryKeyField) {
        throw new Error(`Model "${model.name}" does not expose a stable primary key field.`);
      }
      const query: FindManyOptions = {
        where: { [primaryKeyField]: id },
        limit: 1,
      };
      if (options?.with) {
        query.with = options.with;
      }
      const rows = await findMany(query);
      return rows[0] ?? null;
    }

    async function count(where?: Record<string, unknown>): Promise<number> {
      const normalized = normalizeWhere(model, where, provider);
      const rows = await adapter.query(
        `SELECT COUNT(*) AS ${quoteIdentifier(provider, "count")} FROM ${quoteIdentifier(provider, tableName)}${normalized.clause}`,
        normalized.params,
      );
      return Number(rows[0]?.count ?? 0);
    }

    async function create(input: Record<string, unknown>, options?: PrepareWriteOptions): Promise<RecordRow> {
      if (!primaryKeyField) {
        throw new Error(`Model "${model.name}" does not expose a stable primary key field.`);
      }

      const values = await prepareCreateData(model, input, options);
      const entries = Object.entries(values).filter(([, value]) => value !== undefined);
      const columns = entries.map(([fieldName]) => quoteIdentifier(provider, toSnakeCase(fieldName)));
      const params = entries.map(([fieldName, value]) =>
        encodeFieldValue(model.fields[fieldName]!, value, provider)
      );

      await adapter.execute(
        `INSERT INTO ${quoteIdentifier(provider, tableName)} (${columns.join(", ")}) VALUES (${valuePlaceholderList(provider, 1, params.length)})`,
        params,
      );

      return (await findById(values[primaryKeyField]))!;
    }

    async function update(
      id: unknown,
      input: Record<string, unknown>,
      options?: PrepareWriteOptions,
    ): Promise<RecordRow | null> {
      if (!primaryKeyField) {
        throw new Error(`Model "${model.name}" does not expose a stable primary key field.`);
      }

      const values = await prepareUpdateData(model, input, options);
      const entries = Object.entries(values).filter(([, value]) => value !== undefined);
      if (entries.length === 0) {
        return findById(id);
      }

      const setClause = entries.map(([fieldName], index) =>
        `${quoteIdentifier(provider, toSnakeCase(fieldName))} = ${placeholder(provider, index + 1)}`
      ).join(", ");
      const params = entries.map(([fieldName, value]) =>
        encodeFieldValue(model.fields[fieldName]!, value, provider)
      );
      params.push(encodeFieldValue(model.fields[primaryKeyField] ?? { type: "string" }, id, provider));

      await adapter.execute(
        `UPDATE ${quoteIdentifier(provider, tableName)} SET ${setClause} WHERE ${quoteIdentifier(provider, toSnakeCase(primaryKeyField))} = ${placeholder(provider, params.length)}`,
        params,
      );

      return findById(id);
    }

    async function remove(id: unknown): Promise<boolean> {
      if (!primaryKeyField) {
        throw new Error(`Model "${model.name}" does not expose a stable primary key field.`);
      }

      const result = await adapter.execute(
        `DELETE FROM ${quoteIdentifier(provider, tableName)} WHERE ${quoteIdentifier(provider, toSnakeCase(primaryKeyField))} = ${placeholder(provider, 1)}`,
        [encodeFieldValue(model.fields[primaryKeyField] ?? { type: "string" }, id, provider)],
      );
      return result.affectedRows > 0;
    }

    async function relate(
      id: unknown,
      relationName: string,
      options?: Omit<FindManyOptions, "where">,
    ): Promise<unknown> {
      if (!primaryKeyField) {
        throw new Error(`Model "${model.name}" does not expose a stable primary key field.`);
      }
      const row = await findById(id);
      if (!row) return null;
      const relation = model.relations[relationName];
      if (!relation) {
        throw new Error(`Unknown relation "${model.name}.${relationName}".`);
      }
      return loadRelationValue(model, row, relationName, relation, options);
    }

    return {
      model,
      tableName,
      primaryKeyField,
      count,
      findMany,
      findById,
      create,
      update,
      delete: remove,
      relate,
    };
  }

  runtime.db = db;
  runtime.provider = provider;
  runtime.close = close;
  runtime.query = (sql, params) => adapter.query(sql, params);
  runtime.execute = (sql, params) => adapter.execute(sql, params);
  runtime.applyMigration = async (statements) => {
    if (statements.length === 0) return;
    await runtime.transaction(async (tx) => {
      for (const statement of statements) {
        await tx.execute(statement);
      }
    });
  };
  runtime.registerModels = register;
  runtime.model = repositoryFor;
  runtime.transaction = async <T>(fn: (database: DatabaseRuntime) => Promise<T>) => {
    return adapter.transaction(async (transactionAdapter) => {
      const transactionRuntime = buildRuntime(db, provider, close, transactionAdapter, modelMap.values());
      return fn(transactionRuntime);
    });
  };
  Object.defineProperty(runtime, "models", {
    enumerable: true,
    get() {
      const entries = [...modelMap.values()].map((model) => [model.name, repositoryFor(model)] as const);
      return Object.fromEntries(entries);
    },
  });

  if (initialModels) {
    register([...initialModels]);
  }

  return runtime;
}

export function createDatabaseRuntime(
  db: unknown,
  provider: DbProvider,
  close: () => void | Promise<void>,
  adapter: SqlRuntimeAdapter,
  initialModels?: Iterable<ModelDefinition>,
): DatabaseRuntime {
  return buildRuntime(db, provider, close, adapter, initialModels);
}

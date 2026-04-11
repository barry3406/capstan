import { autoIdSchemaExpr, columnMapping, columnMappingForReference, providerMeta } from "./dialect.js";
import { findPrimaryKeyField, inferRelationForeignKey, resolveManyToManyRelation, resolveReferenceField, resolveTargetRelationForeignKey, tableNameForModel, tableVarForModel, toSnakeCase } from "./naming.js";
import type { DbProvider, FieldDefinition, ModelDefinition, RelationDefinition } from "./types.js";

function jsString(val: unknown): string {
  if (typeof val === "string") {
    return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return String(val);
}

function runtimeTimestampExpr(field: FieldDefinition, provider: DbProvider): string {
  if (field.type === "date") {
    return `new Date().toISOString().slice(0, 10)`;
  }
  if (provider === "sqlite" || provider === "libsql") {
    return `new Date().toISOString()`;
  }
  return `new Date()`;
}

function indexName(tableName: string, fields: string[]): string {
  return `idx_${tableName}_${fields.map(toSnakeCase).join("_")}`;
}

function buildIndexExpr(
  tableName: string,
  idx: ModelDefinition["indexes"][number],
  provider: DbProvider,
): string {
  const builder = idx.unique ? "uniqueIndex" : "index";
  const columns = idx.fields.map((fieldName) => {
    if (provider === "postgres" && idx.order) {
      return `table.${fieldName}.${idx.order}()`;
    }
    return `table.${fieldName}`;
  });
  return `${builder}("${indexName(tableName, idx.fields)}").on(${columns.join(", ")})`;
}

function buildRelationExpr(
  sourceModel: ModelDefinition,
  sourceVar: string,
  relationName: string,
  relation: RelationDefinition,
  modelMap: Map<string, ModelDefinition>,
): string | null {
  const targetModel = modelMap.get(relation.model);
  if (!targetModel) return null;

  const targetVar = tableVarForModel(targetModel);

  switch (relation.kind) {
    case "belongsTo": {
      const foreignKey = inferRelationForeignKey(relation);
      if (!(foreignKey in sourceModel.fields)) {
        return null;
      }
      const targetField = sourceModel.fields[foreignKey]?.references
        ? resolveReferenceField(sourceModel.fields[foreignKey]!.references!, modelMap).fieldName
        : (findPrimaryKeyField(targetModel) ?? "id");
      return `${relationName}: one(${targetVar}, { fields: [${sourceVar}.${foreignKey}], references: [${targetVar}.${targetField}] })`;
    }
    case "hasMany":
      return `${relationName}: many(${targetVar})`;
    case "hasOne":
      return `${relationName}: one(${targetVar})`;
    case "manyToMany":
      return null;
  }
}

function buildRelationMetadataExpr(
  sourceModel: ModelDefinition,
  relationName: string,
  relation: RelationDefinition,
  modelMap: Map<string, ModelDefinition>,
): string | null {
  const targetModel = modelMap.get(relation.model);
  if (!targetModel && relation.kind !== "manyToMany") {
    return null;
  }

  switch (relation.kind) {
    case "belongsTo":
      {
        const foreignKey = inferRelationForeignKey(relation);
        const targetField = sourceModel.fields[foreignKey]?.references
          ? resolveReferenceField(sourceModel.fields[foreignKey]!.references!, modelMap).fieldName
          : (findPrimaryKeyField(targetModel!) ?? "id");
        return `${relationName}: { kind: "belongsTo", model: "${relation.model}", foreignKey: "${foreignKey}", targetKey: "${targetField}" }`;
      }
    case "hasMany":
      return `${relationName}: { kind: "hasMany", model: "${relation.model}", foreignKey: "${resolveTargetRelationForeignKey(sourceModel, relation, modelMap)}", sourceKey: "${findPrimaryKeyField(sourceModel) ?? "id"}" }`;
    case "hasOne":
      return `${relationName}: { kind: "hasOne", model: "${relation.model}", foreignKey: "${resolveTargetRelationForeignKey(sourceModel, relation, modelMap)}", sourceKey: "${findPrimaryKeyField(sourceModel) ?? "id"}" }`;
    case "manyToMany": {
      const resolved = resolveManyToManyRelation(sourceModel, relation, modelMap);
      if (!resolved) {
        return `${relationName}: { kind: "manyToMany", model: "${relation.model}", through: ${relation.through ? `"${relation.through}"` : "null"}, resolved: false }`;
      }
      return `${relationName}: { kind: "manyToMany", model: "${relation.model}", through: "${resolved.throughModel.name}", throughTable: "${tableNameForModel(resolved.throughModel)}", sourceForeignKey: "${resolved.sourceForeignKey}", targetForeignKey: "${resolved.targetForeignKey}", sourceKey: "${resolved.sourcePrimaryKey}", targetKey: "${resolved.targetPrimaryKey}", resolved: true }`;
    }
  }
}

function buildColumnExpr(
  fieldName: string,
  def: FieldDefinition,
  provider: DbProvider,
  modelMap: Map<string, ModelDefinition>,
): { expr: string; imports: string[]; needsSql: boolean } {
  const colName = toSnakeCase(fieldName);

  if (def.autoId) {
    return autoIdSchemaExpr(colName, provider);
  }

  const referencedField = def.references
    ? (() => {
        const target = resolveReferenceField(def.references, modelMap);
        return modelMap.get(target.modelName)?.fields[target.fieldName];
      })()
    : undefined;
  const mapping = referencedField
    ? columnMappingForReference(referencedField, provider)
    : columnMapping(def.type, provider, def.dimensions);
  let expr = mapping.config
    ? `${mapping.builder}("${colName}", ${mapping.config})`
    : `${mapping.builder}("${colName}")`;

  if (def.required || def.updatedAt) {
    expr += ".notNull()";
  }
  if (def.unique) {
    expr += ".unique()";
  }
  if (def.references) {
    const target = resolveReferenceField(def.references, modelMap);
    const targetVar = tableVarForModel(target.modelName);
    expr += `.references(() => ${targetVar}.${target.fieldName})`;
  }

  let needsSql = false;
  if (def.default !== undefined) {
    if (def.default === "now") {
      expr += `.default(sql\`${providerMeta(provider).nowDefaultSql}\`)`;
      needsSql = true;
    } else if (typeof def.default === "string") {
      expr += `.default(${jsString(def.default)})`;
    } else if (typeof def.default === "boolean" || typeof def.default === "number") {
      expr += `.default(${String(def.default)})`;
    } else if (typeof def.default === "object") {
      expr += `.default(${jsString(JSON.stringify(def.default))})`;
    } else {
      expr += `.default(${jsString(def.default)})`;
    }
  }

  if (def.updatedAt) {
    if (def.default === undefined) {
      expr += `.$defaultFn(() => ${runtimeTimestampExpr(def, provider)})`;
    }
    expr += `.$onUpdateFn(() => ${runtimeTimestampExpr(def, provider)})`;
  }

  return { expr, imports: [mapping.import], needsSql };
}

export function generateDrizzleSchema(
  models: ModelDefinition[],
  provider: DbProvider = "sqlite",
): string {
  const meta = providerMeta(provider);
  const modelMap = new Map(models.map((model) => [model.name, model]));

  const neededImports = new Set<string>([meta.tableBuilder]);
  let needsSql = false;
  let needsRelations = false;
  let hasRelationComments = false;

  for (const model of models) {
    for (const [fieldName, def] of Object.entries(model.fields)) {
      const result = buildColumnExpr(fieldName, def, provider, modelMap);
      for (const imp of result.imports) {
        neededImports.add(imp);
      }
      if (result.needsSql) {
        needsSql = true;
      }
    }

    if (model.indexes.length > 0) {
      neededImports.add("index");
      neededImports.add("uniqueIndex");
    }

    for (const relation of Object.values(model.relations)) {
      if (relation.kind === "manyToMany") {
        hasRelationComments = true;
      } else {
        needsRelations = true;
      }
    }
  }

  const lines: string[] = [];
  lines.push(`import { ${[...neededImports].sort().join(", ")} } from "${meta.importModule}";`);
  if (needsSql || models.some((model) =>
    Object.values(model.fields).some((field) => field.autoId),
  )) {
    lines.push(`import { sql${needsRelations ? ", relations" : ""} } from "drizzle-orm";`);
  } else if (needsRelations) {
    lines.push(`import { relations } from "drizzle-orm";`);
  }

  for (const model of models) {
    const tableName = tableNameForModel(model);
    const varName = tableVarForModel(model);

    lines.push("");
    const fields = Object.entries(model.fields);
    if (model.indexes.length > 0) {
      lines.push(`export const ${varName} = ${meta.tableBuilder}("${tableName}", {`);
    } else {
      lines.push(`export const ${varName} = ${meta.tableBuilder}("${tableName}", {`);
    }

    for (const [fieldName, def] of fields) {
      const result = buildColumnExpr(fieldName, def, provider, modelMap);
      lines.push(`  ${fieldName}: ${result.expr},`);
    }

    if (model.indexes.length === 0) {
      lines.push("});");
    } else {
      lines.push("}, (table) => [");
      for (const idx of model.indexes) {
        lines.push(`  ${buildIndexExpr(tableName, idx, provider)},`);
      }
      lines.push("]);");
    }
  }

  if (needsRelations || hasRelationComments) {
    for (const model of models) {
      const varName = tableVarForModel(model);
      const relationLines: string[] = [];
      const relationMetadataLines: string[] = [];
      let skippedManyToMany = false;

      for (const [relationName, relation] of Object.entries(model.relations)) {
        const line = buildRelationExpr(model, varName, relationName, relation, modelMap);
        if (line) {
          relationLines.push(`  ${line},`);
        } else if (relation.kind === "manyToMany") {
          skippedManyToMany = true;
        }
        const metadataLine = buildRelationMetadataExpr(model, relationName, relation, modelMap);
        if (metadataLine) {
          relationMetadataLines.push(`  ${metadataLine},`);
        }
      }

      if (relationLines.length === 0 && !skippedManyToMany && relationMetadataLines.length === 0) {
        continue;
      }

      lines.push("");
      if (skippedManyToMany) {
        lines.push(`// ${model.name}: many-to-many relations require an explicit join model and are not generated automatically.`);
      }
      if (relationMetadataLines.length > 0) {
        lines.push(`export const ${varName}RelationMetadata = {`);
        lines.push(...relationMetadataLines);
        lines.push("} as const;");
        lines.push("");
      }
      if (relationLines.length > 0) {
        lines.push(`export const ${varName}Relations = relations(${varName}, ({ one, many }) => ({`);
        lines.push(...relationLines);
        lines.push("}));");
      }
    }
  }

  return lines.join("\n") + "\n";
}

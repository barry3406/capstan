import type { FieldDefinition, ModelDefinition, RelationDefinition } from "./types.js";

export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

export function lowerFirst(str: string): string {
  if (str.length === 0) return str;
  return str.charAt(0).toLowerCase() + str.slice(1);
}

export function pluralizeModelName(name: string): string {
  const lower = lowerFirst(name);
  if (lower.endsWith("y") && !/[aeiou]y$/i.test(lower)) {
    return lower.slice(0, -1) + "ies";
  }
  if (lower.endsWith("s") || lower.endsWith("x") || lower.endsWith("sh") || lower.endsWith("ch") || lower.endsWith("z")) {
    return lower + "es";
  }
  return lower + "s";
}

export function tableNameForModel(model: Pick<ModelDefinition, "name"> | string): string {
  return pluralizeModelName(typeof model === "string" ? model : model.name);
}

export function tableVarForModel(model: Pick<ModelDefinition, "name"> | string): string {
  return tableNameForModel(model);
}

export function inferRelationForeignKey(relation: RelationDefinition): string {
  return relation.foreignKey ?? `${lowerFirst(relation.model)}Id`;
}

export function inferTargetRelationForeignKey(
  sourceModel: Pick<ModelDefinition, "name"> | string,
  relation: RelationDefinition,
): string {
  return relation.foreignKey ?? `${lowerFirst(typeof sourceModel === "string" ? sourceModel : sourceModel.name)}Id`;
}

export function resolveTargetRelationForeignKey(
  sourceModel: ModelDefinition,
  relation: RelationDefinition,
  modelMap: Map<string, ModelDefinition>,
): string {
  if (relation.foreignKey) {
    return relation.foreignKey;
  }

  const targetModel = findModelByReference(relation.model, modelMap);
  if (targetModel) {
    for (const [fieldName, field] of Object.entries(targetModel.fields)) {
      if (!field.references) continue;
      const target = parseReferenceTarget(field.references);
      if (target.modelName === sourceModel.name) {
        return fieldName;
      }
    }
  }

  return inferTargetRelationForeignKey(sourceModel, relation);
}

export function autoFieldNames(model: ModelDefinition): Set<string> {
  const names = new Set<string>();
  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (field.autoId || field.updatedAt) {
      names.add(fieldName);
    }
  }
  return names;
}

export function updatedAtFieldNames(model: ModelDefinition): string[] {
  const names: string[] = [];
  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (field.updatedAt) {
      names.push(fieldName);
    }
  }
  return names;
}

export function findPrimaryKeyField(model: ModelDefinition): string | null {
  if ("id" in model.fields) return "id";
  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (field.autoId) return fieldName;
  }
  const uniqueRequiredFields = Object.entries(model.fields)
    .filter(([, field]) => field.unique)
    .map(([fieldName]) => fieldName);
  if (uniqueRequiredFields.length === 1) {
    return uniqueRequiredFields[0]!;
  }
  return null;
}

export interface ReferenceTarget {
  modelName: string;
  fieldName?: string;
}

export function parseReferenceTarget(reference: string): ReferenceTarget {
  const [modelName, fieldName] = reference.split(".", 2);
  return fieldName ? { modelName: modelName!, fieldName } : { modelName: modelName! };
}

export function resolveReferenceField(
  reference: string,
  modelMap?: Map<string, ModelDefinition>,
): ReferenceTarget & { fieldName: string } {
  const parsed = parseReferenceTarget(reference);
  if (parsed.fieldName) {
    return { modelName: parsed.modelName, fieldName: parsed.fieldName };
  }

  const targetModel = modelMap?.get(parsed.modelName);
  return {
    modelName: parsed.modelName,
    fieldName: targetModel ? (findPrimaryKeyField(targetModel) ?? "id") : "id",
  };
}

export function findModelByReference(
  reference: string,
  modelMap: Map<string, ModelDefinition>,
): ModelDefinition | null {
  const direct = modelMap.get(reference);
  if (direct) return direct;

  for (const model of modelMap.values()) {
    if (
      model.name === reference ||
      lowerFirst(model.name) === reference ||
      tableNameForModel(model) === reference ||
      toSnakeCase(tableNameForModel(model)).replace(/^_/, "") === reference ||
      toSnakeCase(model.name).replace(/^_/, "") === reference
    ) {
      return model;
    }
  }

  return null;
}

export interface ManyToManyResolution {
  throughModel: ModelDefinition;
  sourceForeignKey: string;
  targetForeignKey: string;
  sourcePrimaryKey: string;
  targetPrimaryKey: string;
}

export function resolveManyToManyRelation(
  sourceModel: ModelDefinition,
  relation: RelationDefinition,
  modelMap: Map<string, ModelDefinition>,
): ManyToManyResolution | null {
  if (relation.kind !== "manyToMany" || !relation.through) {
    return null;
  }

  const throughModel = findModelByReference(relation.through, modelMap);
  const targetModel = findModelByReference(relation.model, modelMap);
  if (!throughModel || !targetModel) {
    return null;
  }

  const sourcePrimaryKey = findPrimaryKeyField(sourceModel) ?? "id";
  const targetPrimaryKey = findPrimaryKeyField(targetModel) ?? "id";

  let sourceForeignKey: string | null = null;
  let targetForeignKey: string | null = null;

  for (const [fieldName, field] of Object.entries(throughModel.fields)) {
    if (!field.references) continue;
    const target = parseReferenceTarget(field.references);
    if (target.modelName === sourceModel.name && sourceForeignKey === null) {
      sourceForeignKey = fieldName;
    }
    if (target.modelName === relation.model && targetForeignKey === null) {
      targetForeignKey = fieldName;
    }
  }

  if (sourceForeignKey === null) {
    const inferred = inferTargetRelationForeignKey(sourceModel, {
      kind: "hasMany",
      model: throughModel.name,
    });
    if (inferred in throughModel.fields) {
      sourceForeignKey = inferred;
    }
  }

  if (targetForeignKey === null) {
    const inferred = inferRelationForeignKey({
      kind: "belongsTo",
      model: relation.model,
    });
    if (inferred in throughModel.fields) {
      targetForeignKey = inferred;
    }
  }

  if (!sourceForeignKey || !targetForeignKey) {
    return null;
  }

  return {
    throughModel,
    sourceForeignKey,
    targetForeignKey,
    sourcePrimaryKey,
    targetPrimaryKey,
  };
}

export function stableFieldSignature(field: FieldDefinition): string {
  return JSON.stringify({
    type: field.type,
    required: field.required ?? false,
    unique: field.unique ?? false,
    default: field.default ?? null,
    min: field.min ?? null,
    max: field.max ?? null,
    enum: field.enum ?? null,
    dimensions: field.dimensions ?? null,
    updatedAt: field.updatedAt ?? false,
    autoId: field.autoId ?? false,
    references: field.references ?? null,
  });
}

export function indexSignature(index: { fields: string[]; unique?: boolean; order?: "asc" | "desc" }): string {
  return JSON.stringify({
    fields: index.fields,
    unique: index.unique ?? false,
    order: index.order ?? null,
  });
}

export function cloneDefaultValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

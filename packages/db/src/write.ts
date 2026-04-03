import type { EmbeddingConfig } from "./embedding.js";
import { cloneDefaultValue } from "./naming.js";
import type { FieldDefinition, ModelDefinition } from "./types.js";

export interface PrepareWriteOptions {
  now?: Date;
  embeddings?: Array<EmbeddingConfig & { modelName?: string }> | (EmbeddingConfig & { modelName?: string });
}

type RecordInput = Record<string, unknown>;

function assertKnownFields(model: ModelDefinition, input: RecordInput): void {
  for (const key of Object.keys(input)) {
    if (!(key in model.fields)) {
      throw new Error(`Unknown field "${key}" for model "${model.name}".`);
    }
  }
}

function validateFieldValue(model: ModelDefinition, fieldName: string, field: FieldDefinition, value: unknown): void {
  if (value === undefined) return;
  if (value === null) {
    if (field.required || field.updatedAt || field.autoId) {
      throw new Error(`Field "${model.name}.${fieldName}" cannot be null.`);
    }
    return;
  }

  switch (field.type) {
    case "string":
    case "text":
      if (typeof value !== "string") {
        throw new Error(`Field "${model.name}.${fieldName}" must be a string.`);
      }
      if (field.min !== undefined && value.length < field.min) {
        throw new Error(`Field "${model.name}.${fieldName}" must be at least ${field.min} characters.`);
      }
      if (field.max !== undefined && value.length > field.max) {
        throw new Error(`Field "${model.name}.${fieldName}" must be at most ${field.max} characters.`);
      }
      break;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`Field "${model.name}.${fieldName}" must be a YYYY-MM-DD string.`);
      }
      break;
    case "datetime":
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw new Error(`Field "${model.name}.${fieldName}" must be a valid datetime string.`);
      }
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`Field "${model.name}.${fieldName}" must be an integer.`);
      }
      if (field.min !== undefined && value < field.min) {
        throw new Error(`Field "${model.name}.${fieldName}" must be at least ${field.min}.`);
      }
      if (field.max !== undefined && value > field.max) {
        throw new Error(`Field "${model.name}.${fieldName}" must be at most ${field.max}.`);
      }
      break;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error(`Field "${model.name}.${fieldName}" must be a number.`);
      }
      if (field.min !== undefined && value < field.min) {
        throw new Error(`Field "${model.name}.${fieldName}" must be at least ${field.min}.`);
      }
      if (field.max !== undefined && value > field.max) {
        throw new Error(`Field "${model.name}.${fieldName}" must be at most ${field.max}.`);
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new Error(`Field "${model.name}.${fieldName}" must be a boolean.`);
      }
      break;
    case "vector":
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || Number.isNaN(entry))) {
        throw new Error(`Field "${model.name}.${fieldName}" must be a numeric vector.`);
      }
      if (field.dimensions !== undefined && value.length !== field.dimensions) {
        throw new Error(
          `Field "${model.name}.${fieldName}" must contain exactly ${field.dimensions} dimensions.`,
        );
      }
      break;
    case "json":
      break;
  }

  if (field.enum && !field.enum.includes(value as string)) {
    throw new Error(
      `Field "${model.name}.${fieldName}" must be one of: ${field.enum.join(", ")}.`,
    );
  }
}

function validateRequiredFields(model: ModelDefinition, payload: RecordInput): void {
  for (const [fieldName, field] of Object.entries(model.fields)) {
    if ((field.required || field.updatedAt || field.autoId) && payload[fieldName] === undefined) {
      throw new Error(`Missing required field "${model.name}.${fieldName}".`);
    }
  }
}

function nowValue(field: FieldDefinition, now: Date): unknown {
  switch (field.type) {
    case "date":
      return now.toISOString().slice(0, 10);
    case "datetime":
      return now.toISOString();
    default:
      return now.toISOString();
  }
}

function embeddingConfigsForModel(
  model: ModelDefinition,
  embeddings?: PrepareWriteOptions["embeddings"],
): Array<EmbeddingConfig & { modelName?: string }> {
  const list = embeddings === undefined ? [] : Array.isArray(embeddings) ? embeddings : [embeddings];
  return list.filter((config) => config.modelName === undefined || config.modelName === model.name);
}

async function applyEmbeddings(
  model: ModelDefinition,
  payload: RecordInput,
  embeddings?: PrepareWriteOptions["embeddings"],
): Promise<void> {
  for (const config of embeddingConfigsForModel(model, embeddings)) {
    const sourceValue = payload[config.sourceField];
    if (sourceValue === undefined || sourceValue === null) continue;
    if (typeof sourceValue !== "string") {
      throw new Error(
        `Embedding source field "${config.sourceField}" on model "${model.name}" must resolve to a string.`,
      );
    }

    const vectors = await config.adapter.embed([sourceValue]);
    const vector = vectors[0];
    if (!vector) {
      throw new Error(
        `Embedding adapter for model "${model.name}" returned no embedding for "${config.sourceField}".`,
      );
    }

    const vectorField = model.fields[config.vectorField];
    if (vectorField?.dimensions !== undefined && vector.length !== vectorField.dimensions) {
      throw new Error(
        `Embedding dimensions mismatch for "${model.name}.${config.vectorField}": expected ${vectorField.dimensions}, received ${vector.length}.`,
      );
    }

    payload[config.vectorField] = vector;
  }
}

async function prepareWrite(
  mode: "create" | "update",
  model: ModelDefinition,
  input: RecordInput,
  options?: PrepareWriteOptions,
): Promise<RecordInput> {
  const now = options?.now ?? new Date();
  const payload: RecordInput = { ...input };
  assertKnownFields(model, payload);

  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (mode === "create") {
      if (field.autoId && payload[fieldName] === undefined) {
        payload[fieldName] = globalThis.crypto.randomUUID();
      }

      if (payload[fieldName] === undefined && field.default !== undefined) {
        payload[fieldName] = field.default === "now" ? nowValue(field, now) : cloneDefaultValue(field.default);
      }
    }

    if (field.updatedAt) {
      payload[fieldName] = nowValue(field, now);
    }
  }

  await applyEmbeddings(model, payload, options?.embeddings);

  if (mode === "create") {
    validateRequiredFields(model, payload);
  }

  for (const [fieldName, field] of Object.entries(model.fields)) {
    validateFieldValue(model, fieldName, field, payload[fieldName]);
  }
  return payload;
}

export async function prepareCreateData(
  model: ModelDefinition,
  input: RecordInput,
  options?: PrepareWriteOptions,
): Promise<RecordInput> {
  return prepareWrite("create", model, input, options);
}

export async function prepareUpdateData(
  model: ModelDefinition,
  input: RecordInput,
  options?: PrepareWriteOptions,
): Promise<RecordInput> {
  return prepareWrite("update", model, input, options);
}

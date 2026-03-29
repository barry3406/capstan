import type { FieldDefinition, RelationDefinition, IndexDefinition, ModelDefinition, ScalarType } from "./types.js";

// ---------------------------------------------------------------------------
// Field builder helpers
// ---------------------------------------------------------------------------

type FieldOptions = Omit<FieldDefinition, "type">;

function makeField(type: ScalarType, opts?: FieldOptions): FieldDefinition {
  const def: FieldDefinition = { type };
  if (opts) {
    if (opts.required !== undefined) def.required = opts.required;
    if (opts.unique !== undefined) def.unique = opts.unique;
    if (opts.default !== undefined) def.default = opts.default;
    if (opts.min !== undefined) def.min = opts.min;
    if (opts.max !== undefined) def.max = opts.max;
    if (opts.enum !== undefined) def.enum = opts.enum;
    if (opts.updatedAt !== undefined) def.updatedAt = opts.updatedAt;
    if (opts.autoId !== undefined) def.autoId = opts.autoId;
    if (opts.references !== undefined) def.references = opts.references;
  }
  return def;
}

export const field = {
  /**
   * Primary key field — auto-generated UUID, required, unique.
   */
  id(): FieldDefinition {
    return { type: "string", autoId: true, required: true, unique: true };
  },

  /**
   * Short string field (maps to TEXT in SQLite).
   */
  string(opts?: FieldOptions): FieldDefinition {
    return makeField("string", opts);
  },

  /**
   * Long text field (maps to TEXT in SQLite).
   */
  text(opts?: FieldOptions): FieldDefinition {
    return makeField("text", opts);
  },

  /**
   * Integer field (maps to INTEGER in SQLite).
   */
  integer(opts?: FieldOptions): FieldDefinition {
    return makeField("integer", opts);
  },

  /**
   * Floating-point number field (maps to REAL in SQLite).
   */
  number(opts?: FieldOptions): FieldDefinition {
    return makeField("number", opts);
  },

  /**
   * Boolean field (maps to INTEGER with 0/1 in SQLite).
   */
  boolean(opts?: FieldOptions): FieldDefinition {
    return makeField("boolean", opts);
  },

  /**
   * Date-only field (stored as TEXT ISO-8601 in SQLite).
   */
  date(opts?: FieldOptions): FieldDefinition {
    return makeField("date", opts);
  },

  /**
   * Datetime field (stored as TEXT ISO-8601 in SQLite).
   */
  datetime(opts?: FieldOptions): FieldDefinition {
    return makeField("datetime", opts);
  },

  /**
   * JSON field (stored as TEXT with JSON serialisation in SQLite).
   */
  json<_T = unknown>(opts?: FieldOptions): FieldDefinition {
    return makeField("json", opts);
  },

  /**
   * Enum field — stored as TEXT with a constrained set of values.
   *
   * @example
   *   field.enum(["open", "closed"], { default: "open" })
   */
  enum(values: readonly string[], opts?: FieldOptions): FieldDefinition {
    return makeField("string", { ...opts, enum: values });
  },
};

// ---------------------------------------------------------------------------
// Relation helpers
// ---------------------------------------------------------------------------

interface RelationOptions {
  foreignKey?: string;
  through?: string;
}

export const relation = {
  belongsTo(model: string, opts?: RelationOptions): RelationDefinition {
    return { kind: "belongsTo", model, ...opts };
  },

  hasMany(model: string, opts?: RelationOptions): RelationDefinition {
    return { kind: "hasMany", model, ...opts };
  },

  hasOne(model: string, opts?: RelationOptions): RelationDefinition {
    return { kind: "hasOne", model, ...opts };
  },

  manyToMany(model: string, opts?: RelationOptions): RelationDefinition {
    return { kind: "manyToMany", model, ...opts };
  },
};

// ---------------------------------------------------------------------------
// defineModel
// ---------------------------------------------------------------------------

export function defineModel(
  name: string,
  config: {
    fields: Record<string, FieldDefinition>;
    relations?: Record<string, RelationDefinition>;
    indexes?: IndexDefinition[];
  },
): ModelDefinition {
  return {
    name,
    fields: config.fields,
    relations: config.relations ?? {},
    indexes: config.indexes ?? [],
  };
}

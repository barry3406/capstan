export type ScalarType = "string" | "integer" | "number" | "boolean" | "date" | "datetime" | "text" | "json" | "vector";

export interface FieldDefinition {
  type: ScalarType;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  enum?: readonly string[];
  /** Number of dimensions for vector fields */
  dimensions?: number;
  /** Auto-set to current time on update */
  updatedAt?: boolean;
  /** Auto-generate UUID */
  autoId?: boolean;
  /** Reference to another model */
  references?: string;
}

export type RelationKind = "belongsTo" | "hasMany" | "hasOne" | "manyToMany";

export interface RelationDefinition {
  kind: RelationKind;
  model: string;
  foreignKey?: string;
  through?: string;
}

export interface IndexDefinition {
  fields: string[];
  unique?: boolean;
  order?: "asc" | "desc";
}

export interface ModelDefinition {
  name: string;
  fields: Record<string, FieldDefinition>;
  relations: Record<string, RelationDefinition>;
  indexes: IndexDefinition[];
}

export type DbProvider = "sqlite" | "postgres" | "mysql" | "libsql";

export interface DatabaseConfig {
  provider: DbProvider;
  url: string;
}

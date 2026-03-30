export { defineModel, field, relation } from "./model.js";
export { generateDrizzleSchema } from "./schema.js";
export { createDatabase } from "./client.js";
export type { DatabaseInstance } from "./client.js";
export {
  generateMigration,
  applyMigration,
  ensureTrackingTable,
  getAppliedMigrations,
  getMigrationStatus,
  applyTrackedMigrations,
} from "./migrate.js";
export type { MigrationDbClient, MigrationStatus } from "./migrate.js";
export { generateCrudRoutes, pluralize } from "./crud.js";
export type { CrudRouteFiles } from "./crud.js";
export { defineEmbedding, openaiEmbeddings } from "./embedding.js";
export type { EmbeddingAdapter, EmbeddingConfig, OpenAIEmbeddingOptions } from "./embedding.js";
export { cosineDistance, findNearest, hybridSearch } from "./search.js";
export type { VectorItem, ScoredResult, HybridItem, HybridSearchOptions } from "./search.js";
export type {
  ModelDefinition,
  FieldDefinition,
  RelationDefinition,
  IndexDefinition,
  DatabaseConfig,
  DbProvider,
  ScalarType,
} from "./types.js";

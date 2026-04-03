export { defineModel, field, relation } from "./model.js";
export { generateDrizzleSchema } from "./schema.js";
export { createDatabase } from "./client.js";
export type { DatabaseInstance } from "./client.js";
export {
  planMigration,
  generateMigration,
  applyMigration,
  ensureTrackingTable,
  getAppliedMigrations,
  getMigrationStatus,
  applyTrackedMigrations,
} from "./migrate.js";
export type { MigrationDbClient, MigrationIssue, MigrationIssueCode, MigrationOptions, MigrationPlan, MigrationStatus } from "./migrate.js";
export { createDatabaseRuntime } from "./runtime.js";
export type { DatabaseRuntime, FindManyOptions, ModelRepository, QueryOrder, SqlMutationResult, SqlRuntimeAdapter } from "./runtime.js";
export { createCrudRepository, createCrudRuntime, generateCrudRoutes, pluralize } from "./crud.js";
export type { CrudQueryOptions, CrudRouteFiles, CrudRuntime } from "./crud.js";
export { defineEmbedding, openaiEmbeddings } from "./embedding.js";
export type { EmbeddingAdapter, EmbeddingConfig, OpenAIEmbeddingOptions } from "./embedding.js";
export { cosineDistance, findNearest, hybridSearch } from "./search.js";
export type { VectorItem, ScoredResult, HybridItem, HybridSearchOptions } from "./search.js";
export { prepareCreateData, prepareUpdateData } from "./write.js";
export type { PrepareWriteOptions } from "./write.js";
export type {
  ModelDefinition,
  FieldDefinition,
  RelationDefinition,
  IndexDefinition,
  DatabaseConfig,
  DbProvider,
  ScalarType,
} from "./types.js";

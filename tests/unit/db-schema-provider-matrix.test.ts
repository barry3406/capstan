import { describe, expect, it } from "bun:test";
import { defineModel, field, generateDrizzleSchema, relation } from "@zauso-ai/capstan-db";

function makeAuthoringModels() {
  const organization = defineModel("Organization", {
    fields: {
      slug: field.string({ required: true, unique: true }),
      name: field.string({ required: true }),
    },
  });

  const author = defineModel("Author", {
    fields: {
      authorId: field.id(),
      orgSlug: field.string({ references: "Organization.slug", required: true }),
      email: field.string({ required: true, unique: true }),
      displayName: field.string({ required: true, min: 2, max: 80 }),
      isActive: field.boolean({ default: true }),
      createdAt: field.datetime({ default: "now" }),
      updatedAt: field.datetime({ updatedAt: true }),
      embedding: field.vector(4),
    },
    relations: {
      organization: relation.belongsTo("Organization", { foreignKey: "orgSlug" }),
      posts: relation.hasMany("Post"),
      profile: relation.hasOne("Profile"),
    },
    indexes: [
      { fields: ["email"], unique: true },
      { fields: ["displayName"], order: "desc" },
    ],
  });

  const post = defineModel("Post", {
    fields: {
      id: field.id(),
      authorId: field.string({ references: "Author.authorId", required: true }),
      title: field.string({ required: true }),
      body: field.text(),
      status: field.enum(["draft", "published"], { default: "draft" }),
      metadata: field.json(),
    },
    relations: {
      author: relation.belongsTo("Author", { foreignKey: "authorId" }),
      tags: relation.manyToMany("Tag", { through: "PostTag" }),
    },
    indexes: [
      { fields: ["authorId"] },
      { fields: ["status", "title"] },
    ],
  });

  const profile = defineModel("Profile", {
    fields: {
      id: field.id(),
      authorId: field.string({ references: "Author.authorId", required: true }),
      bio: field.text(),
    },
    relations: {
      author: relation.belongsTo("Author", { foreignKey: "authorId" }),
    },
  });

  const tag = defineModel("Tag", {
    fields: {
      id: field.id(),
      label: field.string({ required: true }),
    },
  });

  const postTag = defineModel("PostTag", {
    fields: {
      id: field.id(),
      postId: field.string({ references: "Post", required: true }),
      tagId: field.string({ references: "Tag", required: true }),
    },
  });

  return [organization, author, post, profile, tag, postTag];
}

describe("generateDrizzleSchema provider matrix", () => {
  it("sqlite schema includes custom reference targets, runtime timestamps, indexes, and relation exports", () => {
    const schema = generateDrizzleSchema(makeAuthoringModels(), "sqlite");

    expect(schema).toContain('import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"');
    expect(schema).toContain('import { sql, relations } from "drizzle-orm"');

    expect(schema).toContain('export const organizations = sqliteTable("organizations"');
    expect(schema).toContain('slug: text("slug").notNull().unique()');

    expect(schema).toContain('export const authors = sqliteTable("authors"');
    expect(schema).toContain('authorId: text("author_id").primaryKey().default(sql`');
    expect(schema).toContain('orgSlug: text("org_slug").notNull().references(() => organizations.slug)');
    expect(schema).toContain('email: text("email").notNull().unique()');
    expect(schema).toContain('displayName: text("display_name").notNull()');
    expect(schema).toContain('isActive: integer("is_active", { mode: "boolean" }).default(true)');
    expect(schema).toContain('createdAt: text("created_at").default(sql`(datetime(\'now\'))`)');
    expect(schema).toContain('updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString())');
    expect(schema).toContain('embedding: text("embedding", { mode: "json" })');

    expect(schema).toContain('uniqueIndex("idx_authors_email").on(table.email)');
    expect(schema).toContain('index("idx_authors_display_name").on(table.displayName)');
    expect(schema).toContain('index("idx_posts_author_id").on(table.authorId)');
    expect(schema).toContain('index("idx_posts_status_title").on(table.status, table.title)');

    expect(schema).toContain('export const authorsRelations = relations(authors, ({ one, many }) => ({');
    expect(schema).toContain('organization: one(organizations, { fields: [authors.orgSlug], references: [organizations.slug] })');
    expect(schema).toContain('posts: many(posts)');
    expect(schema).toContain('profile: one(profiles)');
    expect(schema).toContain('export const postsRelations = relations(posts, ({ one, many }) => ({');
    expect(schema).toContain('author: one(authors, { fields: [posts.authorId], references: [authors.authorId] })');
    expect(schema).toContain('many-to-many relations require an explicit join model');
    expect(schema).toContain('export const postsRelationMetadata = {');
    expect(schema).toContain('tags: { kind: "manyToMany", model: "Tag", through: "PostTag"');
    expect(schema).toContain('sourceForeignKey: "postId"');
    expect(schema).toContain('targetForeignKey: "tagId"');
  });

  it("postgres schema uses pg-native columns and explicit custom primary-key references", () => {
    const schema = generateDrizzleSchema(makeAuthoringModels(), "postgres");

    expect(schema).toContain('from "drizzle-orm/pg-core"');
    expect(schema).toContain('uuid("author_id").primaryKey().defaultRandom()');
    expect(schema).toContain('authorId: uuid("author_id").notNull().references(() => authors.authorId)');
    expect(schema).toContain('varchar("org_slug", { length: 255 }).notNull().references(() => organizations.slug)');
    expect(schema).toContain('varchar("email", { length: 255 }).notNull().unique()');
    expect(schema).toContain('boolean("is_active").default(true)');
    expect(schema).toContain('timestamp("created_at").default(sql`now()`');
    expect(schema).toContain('timestamp("updated_at").notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())');
    expect(schema).toContain('vector("embedding", { dimensions: 4 })');
    expect(schema).toContain('jsonb("metadata")');
    expect(schema).toContain('index("idx_authors_display_name").on(table.displayName.desc())');
    expect(schema).toContain('author: one(authors, { fields: [posts.authorId], references: [authors.authorId] })');
    expect(schema).toContain('organization: one(organizations, { fields: [authors.orgSlug], references: [organizations.slug] })');
  });

  it("mysql schema uses mysql-native columns, sql defaults, and explicit reference fields", () => {
    const schema = generateDrizzleSchema(makeAuthoringModels(), "mysql");

    expect(schema).toContain('from "drizzle-orm/mysql-core"');
    expect(schema).toContain('varchar("author_id", { length: 36 }).primaryKey().default(sql`(UUID())`)');
    expect(schema).toContain('varchar("org_slug", { length: 255 }).notNull().references(() => organizations.slug)');
    expect(schema).toContain('varchar("email", { length: 255 }).notNull().unique()');
    expect(schema).toContain('boolean("is_active").default(true)');
    expect(schema).toContain('datetime("created_at").default(sql`CURRENT_TIMESTAMP`)');
    expect(schema).toContain('datetime("updated_at").notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())');
    expect(schema).toContain('json("embedding")');
    expect(schema).toContain('json("metadata")');
    expect(schema).toContain('author: one(authors, { fields: [posts.authorId], references: [authors.authorId] })');
  });

  it("resolves plain references against a model's non-id primary key", () => {
    const account = defineModel("Account", {
      fields: {
        slug: field.string({ required: true, unique: true }),
      },
    });
    const invoice = defineModel("Invoice", {
      fields: {
        id: field.id(),
        accountSlug: field.string({ references: "Account", required: true }),
      },
    });

    const sqlite = generateDrizzleSchema([account, invoice], "sqlite");
    const postgres = generateDrizzleSchema([account, invoice], "postgres");

    expect(sqlite).toContain('.references(() => accounts.slug)');
    expect(postgres).toContain('.references(() => accounts.slug)');
  });

  it("supports explicit Model.field reference syntax", () => {
    const organization = defineModel("Organization", {
      fields: {
        id: field.id(),
        slug: field.string({ required: true, unique: true }),
      },
    });
    const repository = defineModel("Repository", {
      fields: {
        id: field.id(),
        organizationSlug: field.string({ references: "Organization.slug" }),
      },
    });

    const schema = generateDrizzleSchema([organization, repository], "sqlite");
    expect(schema).toContain('.references(() => organizations.slug)');
  });

  it("keeps relation export generation stable even when a model only contains relation comments", () => {
    const left = defineModel("Left", {
      fields: { id: field.id() },
      relations: {
        rights: relation.manyToMany("Right", { through: "LeftRight" }),
      },
    });
    const right = defineModel("Right", {
      fields: { id: field.id() },
    });

    const schema = generateDrizzleSchema([left, right], "sqlite");
    expect(schema).toContain("// Left: many-to-many relations require an explicit join model");
    expect(schema).not.toContain("export const leftsRelations = relations");
    expect(schema).toContain('leftsRelationMetadata = {');
    expect(schema).toContain('rights: { kind: "manyToMany", model: "Right", through: "LeftRight", resolved: false }');
  });

  it("renders composite indexes across providers", () => {
    const event = defineModel("Event", {
      fields: {
        id: field.id(),
        tenantId: field.string({ required: true }),
        kind: field.string({ required: true }),
        sequence: field.integer({ required: true }),
      },
      indexes: [
        { fields: ["tenantId", "kind"], unique: true },
        { fields: ["sequence"], order: "desc" },
      ],
    });

    const sqlite = generateDrizzleSchema([event], "sqlite");
    const postgres = generateDrizzleSchema([event], "postgres");
    const mysql = generateDrizzleSchema([event], "mysql");

    expect(sqlite).toContain('uniqueIndex("idx_events_tenant_id_kind").on(table.tenantId, table.kind)');
    expect(sqlite).toContain('index("idx_events_sequence").on(table.sequence)');

    expect(postgres).toContain('uniqueIndex("idx_events_tenant_id_kind").on(table.tenantId, table.kind)');
    expect(postgres).toContain('index("idx_events_sequence").on(table.sequence.desc())');

    expect(mysql).toContain('uniqueIndex("idx_events_tenant_id_kind").on(table.tenantId, table.kind)');
    expect(mysql).toContain('index("idx_events_sequence").on(table.sequence)');
  });

  it("maps every scalar family coherently in a mixed model", () => {
    const model = defineModel("Everything", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
        description: field.text(),
        age: field.integer(),
        score: field.number(),
        enabled: field.boolean(),
        birthday: field.date(),
        seenAt: field.datetime(),
        metadata: field.json(),
        embedding: field.vector(8),
      },
    });

    const sqlite = generateDrizzleSchema([model], "sqlite");
    const postgres = generateDrizzleSchema([model], "postgres");
    const mysql = generateDrizzleSchema([model], "mysql");

    expect(sqlite).toContain('text("name").notNull()');
    expect(sqlite).toContain('text("description")');
    expect(sqlite).toContain('integer("age")');
    expect(sqlite).toContain('real("score")');
    expect(sqlite).toContain('integer("enabled", { mode: "boolean" })');
    expect(sqlite).toContain('text("birthday")');
    expect(sqlite).toContain('text("seen_at")');
    expect(sqlite).toContain('text("metadata", { mode: "json" })');
    expect(sqlite).toContain('text("embedding", { mode: "json" })');

    expect(postgres).toContain('varchar("name", { length: 255 }).notNull()');
    expect(postgres).toContain('text("description")');
    expect(postgres).toContain('integer("age")');
    expect(postgres).toContain('doublePrecision("score")');
    expect(postgres).toContain('boolean("enabled")');
    expect(postgres).toContain('date("birthday")');
    expect(postgres).toContain('timestamp("seen_at")');
    expect(postgres).toContain('jsonb("metadata")');
    expect(postgres).toContain('vector("embedding", { dimensions: 8 })');

    expect(mysql).toContain('varchar("name", { length: 255 }).notNull()');
    expect(mysql).toContain('text("description")');
    expect(mysql).toContain('int("age")');
    expect(mysql).toContain('double("score")');
    expect(mysql).toContain('boolean("enabled")');
    expect(mysql).toContain('date("birthday")');
    expect(mysql).toContain('datetime("seen_at")');
    expect(mysql).toContain('json("metadata")');
    expect(mysql).toContain('json("embedding")');
  });
});

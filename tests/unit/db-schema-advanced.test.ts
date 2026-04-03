import { describe, expect, it } from "bun:test";
import { defineModel, field, generateDrizzleSchema, relation } from "@zauso-ai/capstan-db";

describe("generateDrizzleSchema advanced features", () => {
  it("adds provider-aware auto id defaults for every supported provider", () => {
    const model = defineModel("User", {
      fields: { id: field.id() },
    });

    expect(generateDrizzleSchema([model], "sqlite")).toContain("randomblob");
    expect(generateDrizzleSchema([model], "postgres")).toContain('uuid("id").primaryKey().defaultRandom()');
    expect(generateDrizzleSchema([model], "mysql")).toContain("default(sql`(UUID())`)");
  });

  it("adds runtime-managed updatedAt defaults and onUpdate hooks", () => {
    const model = defineModel("Post", {
      fields: {
        id: field.id(),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const schema = generateDrizzleSchema([model], "sqlite");
    expect(schema).toContain(".$defaultFn(() => new Date().toISOString())");
    expect(schema).toContain(".$onUpdateFn(() => new Date().toISOString())");
  });

  it("generates foreign-key references directly on columns", () => {
    const user = defineModel("User", {
      fields: { id: field.id() },
    });
    const post = defineModel("Post", {
      fields: {
        id: field.id(),
        userId: field.string({ references: "User" }),
      },
    });

    const schema = generateDrizzleSchema([user, post], "postgres");
    expect(schema).toContain('.references(() => users.id)');
  });

  it("aligns reference column storage with referenced uuid primary keys on postgres", () => {
    const user = defineModel("User", {
      fields: { id: field.id() },
    });
    const session = defineModel("Session", {
      fields: {
        id: field.id(),
        userId: field.string({ references: "User", required: true }),
      },
    });

    const schema = generateDrizzleSchema([user, session], "postgres");
    expect(schema).toContain('userId: uuid("user_id").notNull().references(() => users.id)');
  });

  it("generates table indexes in the extra config callback", () => {
    const model = defineModel("Post", {
      fields: {
        id: field.id(),
        title: field.string(),
        createdAt: field.datetime(),
      },
      indexes: [
        { fields: ["title"], unique: true },
        { fields: ["createdAt"], order: "desc" },
      ],
    });

    const schema = generateDrizzleSchema([model], "postgres");
    expect(schema).toContain("(table) => [");
    expect(schema).toContain('uniqueIndex("idx_posts_title")');
    expect(schema).toContain("table.createdAt.desc()");
  });

  it("generates Drizzle relations for belongsTo, hasMany, and hasOne", () => {
    const user = defineModel("User", {
      fields: {
        id: field.id(),
        profileId: field.string({ references: "Profile" }),
      },
      relations: {
        posts: relation.hasMany("Post"),
        profile: relation.hasOne("Profile"),
      },
    });
    const profile = defineModel("Profile", {
      fields: { id: field.id() },
    });
    const post = defineModel("Post", {
      fields: {
        id: field.id(),
        userId: field.string({ references: "User" }),
      },
      relations: {
        author: relation.belongsTo("User", { foreignKey: "userId" }),
      },
    });

    const schema = generateDrizzleSchema([user, profile, post], "sqlite");
    expect(schema).toContain("export const usersRelations = relations(users");
    expect(schema).toContain("posts: many(posts)");
    expect(schema).toContain("profile: one(profiles)");
    expect(schema).toContain("author: one(users, { fields: [posts.userId], references: [users.id] })");
  });

  it("emits explicit many-to-many metadata alongside the schema comment", () => {
    const user = defineModel("User", {
      fields: { id: field.id() },
      relations: {
        tags: relation.manyToMany("Tag", { through: "user_tag" }),
      },
    });
    const tag = defineModel("Tag", {
      fields: { id: field.id() },
    });
    const userTag = defineModel("UserTag", {
      fields: {
        id: field.id(),
        userId: field.string({ references: "User", required: true }),
        tagId: field.string({ references: "Tag", required: true }),
      },
    });

    const schema = generateDrizzleSchema([user, tag, userTag], "sqlite");
    expect(schema).toContain("many-to-many relations require an explicit join model");
    expect(schema).toContain("export const usersRelationMetadata = {");
    expect(schema).toContain('tags: { kind: "manyToMany", model: "Tag", through: "UserTag"');
    expect(schema).toContain('sourceForeignKey: "userId"');
    expect(schema).toContain('targetForeignKey: "tagId"');
  });
});

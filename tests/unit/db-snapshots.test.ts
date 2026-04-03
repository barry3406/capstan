import { describe, expect, it } from "bun:test";
import { defineModel, field, generateDrizzleSchema, generateMigration, relation } from "@zauso-ai/capstan-db";

describe("db schema and migration snapshots", () => {
  it("matches the expected sqlite schema for a representative relational model set", () => {
    const team = defineModel("Team", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
    });
    const member = defineModel("Member", {
      fields: {
        memberId: field.id(),
        teamSlug: field.string({ references: "Team.slug", required: true }),
        email: field.string({ required: true, unique: true }),
        role: field.enum(["owner", "editor", "viewer"] as const, { default: "viewer" }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
      relations: {
        team: relation.belongsTo("Team", { foreignKey: "teamSlug" }),
      },
      indexes: [
        { fields: ["email"], unique: true },
        { fields: ["teamSlug", "role"] },
      ],
    });

    const schema = generateDrizzleSchema([team, member], "sqlite");
    expect(schema).toContain(`
export const teams = sqliteTable("teams", {
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});
`.trim());

    expect(schema).toContain(`
export const members = sqliteTable("members", {
  memberId: text("member_id").primaryKey().default(sql\``.trim());
    expect(schema).toContain(`
  teamSlug: text("team_slug").notNull().references(() => teams.slug),
  email: text("email").notNull().unique(),
  role: text("role").default("viewer"),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("idx_members_email").on(table.email),
  index("idx_members_team_slug_role").on(table.teamSlug, table.role),
]);
`.trim());

    expect(schema).toContain(`
export const membersRelations = relations(members, ({ one, many }) => ({
  team: one(teams, { fields: [members.teamSlug], references: [teams.slug] }),
}));
`.trim());
  });

  it("matches the expected postgres schema shape for the same model set", () => {
    const team = defineModel("Team", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
    });
    const member = defineModel("Member", {
      fields: {
        memberId: field.id(),
        teamSlug: field.string({ references: "Team.slug", required: true }),
        email: field.string({ required: true, unique: true }),
        role: field.enum(["owner", "editor", "viewer"] as const, { default: "viewer" }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
      relations: {
        team: relation.belongsTo("Team", { foreignKey: "teamSlug" }),
      },
      indexes: [
        { fields: ["email"], unique: true },
        { fields: ["teamSlug", "role"] },
      ],
    });

    const schema = generateDrizzleSchema([team, member], "postgres");
    expect(schema).toContain(`
export const teams = pgTable("teams", {
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
});
`.trim());

    expect(schema).toContain(`
export const members = pgTable("members", {
  memberId: uuid("member_id").primaryKey().defaultRandom(),
  teamSlug: varchar("team_slug", { length: 255 }).notNull().references(() => teams.slug),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: varchar("role", { length: 255 }).default("viewer"),
  updatedAt: timestamp("updated_at").notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, (table) => [
  uniqueIndex("idx_members_email").on(table.email),
  index("idx_members_team_slug_role").on(table.teamSlug, table.role),
]);
`.trim());
  });

  it("matches the expected mysql schema shape for the same model set", () => {
    const team = defineModel("Team", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
    });
    const member = defineModel("Member", {
      fields: {
        memberId: field.id(),
        teamSlug: field.string({ references: "Team.slug", required: true }),
        email: field.string({ required: true, unique: true }),
        role: field.enum(["owner", "editor", "viewer"] as const, { default: "viewer" }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
      relations: {
        team: relation.belongsTo("Team", { foreignKey: "teamSlug" }),
      },
      indexes: [
        { fields: ["email"], unique: true },
        { fields: ["teamSlug", "role"] },
      ],
    });

    const schema = generateDrizzleSchema([team, member], "mysql");
    expect(schema).toContain(`
export const teams = mysqlTable("teams", {
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
});
`.trim());

    expect(schema).toContain(`
export const members = mysqlTable("members", {
  memberId: varchar("member_id", { length: 36 }).primaryKey().default(sql\`(UUID())\`),
  teamSlug: varchar("team_slug", { length: 255 }).notNull().references(() => teams.slug),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: varchar("role", { length: 255 }).default("viewer"),
  updatedAt: datetime("updated_at").notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, (table) => [
  uniqueIndex("idx_members_email").on(table.email),
  index("idx_members_team_slug_role").on(table.teamSlug, table.role),
]);
`.trim());
  });

  it("matches representative sqlite migration output for new models", () => {
    const team = defineModel("Team", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
    });
    const member = defineModel("Member", {
      fields: {
        memberId: field.id(),
        teamSlug: field.string({ references: "Team.slug", required: true }),
        email: field.string({ required: true, unique: true }),
        role: field.enum(["owner", "editor", "viewer"] as const, { default: "viewer" }),
      },
      indexes: [
        { fields: ["email"], unique: true },
        { fields: ["teamSlug", "role"] },
      ],
    });

    const sql = generateMigration([], [team, member], "sqlite").join(";\n");
    expect(sql).toContain(`
CREATE TABLE teams (
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
)
`.trim());

    expect(sql).toContain(`
CREATE TABLE members (
  member_id TEXT PRIMARY KEY DEFAULT `.trim());
    expect(sql).toContain(`
  team_slug TEXT NOT NULL REFERENCES teams(slug),
  email TEXT NOT NULL UNIQUE DEFAULT`.trim().replace(" DEFAULT", ""));
    expect(sql).toContain(`
  role TEXT DEFAULT 'viewer'
)
`.trim());
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email ON members (email)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_members_team_slug_role ON members (team_slug, role)');
  });

  it("matches representative postgres migration output for new models", () => {
    const team = defineModel("Team", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
    });
    const member = defineModel("Member", {
      fields: {
        memberId: field.id(),
        teamSlug: field.string({ references: "Team.slug", required: true }),
        email: field.string({ required: true, unique: true }),
        role: field.enum(["owner", "editor", "viewer"] as const, { default: "viewer" }),
      },
      indexes: [
        { fields: ["email"], unique: true },
        { fields: ["teamSlug", "role"] },
      ],
    });

    const sql = generateMigration([], [team, member], "postgres").join(";\n");
    expect(sql).toContain(`
CREATE TABLE teams (
  slug VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL
)
`.trim());
    expect(sql).toContain(`
CREATE TABLE members (
  member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_slug VARCHAR(255) NOT NULL REFERENCES teams(slug),
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(255) DEFAULT 'viewer'
)
`.trim());
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email ON members (email)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_members_team_slug_role ON members (team_slug, role)');
  });

  it("matches representative mysql migration output for new models", () => {
    const team = defineModel("Team", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
    });
    const member = defineModel("Member", {
      fields: {
        memberId: field.id(),
        teamSlug: field.string({ references: "Team.slug", required: true }),
        email: field.string({ required: true, unique: true }),
        role: field.enum(["owner", "editor", "viewer"] as const, { default: "viewer" }),
      },
      indexes: [
        { fields: ["email"], unique: true },
        { fields: ["teamSlug", "role"] },
      ],
    });

    const sql = generateMigration([], [team, member], "mysql").join(";\n");
    expect(sql).toContain(`
CREATE TABLE teams (
  slug VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL
)
`.trim());
    expect(sql).toContain(`
CREATE TABLE members (
  member_id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  team_slug VARCHAR(255) NOT NULL REFERENCES teams(slug),
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(255) DEFAULT 'viewer'
)
`.trim());
    expect(sql).toContain('CREATE UNIQUE INDEX idx_members_email ON members (email)');
    expect(sql).toContain('CREATE INDEX idx_members_team_slug_role ON members (team_slug, role)');
  });
});

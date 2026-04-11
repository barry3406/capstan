import { describe, expect, it } from "bun:test";
import { defineModel, field, generateCrudRoutes, generateDrizzleSchema, generateMigration, planMigration, prepareCreateData, prepareUpdateData, relation } from "@zauso-ai/capstan-db";

describe("db reference and contract regressions", () => {
  it("keeps schema, migration, and CRUD aligned around a custom primary key", () => {
    const organization = defineModel("Organization", {
      fields: {
        slug: field.string({ required: true, unique: true }),
        name: field.string({ required: true }),
      },
    });
    const project = defineModel("Project", {
      fields: {
        projectId: field.id(),
        organizationSlug: field.string({ references: "Organization", required: true }),
        name: field.string({ required: true }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
      relations: {
        organization: relation.belongsTo("Organization", { foreignKey: "organizationSlug" }),
      },
    });

    const schema = generateDrizzleSchema([organization, project], "sqlite");
    const migration = generateMigration([], [organization, project], "sqlite").join(";\n");
    const crud = generateCrudRoutes(project);
    const detail = crud.find((file) => file.path === "projects/[id].api.ts")?.content ?? "";

    expect(schema).toContain('.references(() => organizations.slug)');
    expect(schema).toContain('organization: one(organizations, { fields: [projects.organizationSlug], references: [organizations.slug] })');
    expect(migration).toContain("organization_slug TEXT NOT NULL REFERENCES organizations(slug)");
    expect(detail).toContain("eq(projects.projectId, params.id)");
  });

  it("prefers explicit Model.field references over inferred primary keys", () => {
    const organization = defineModel("Organization", {
      fields: {
        id: field.id(),
        slug: field.string({ required: true, unique: true }),
      },
    });
    const repository = defineModel("Repository", {
      fields: {
        id: field.id(),
        organizationSlug: field.string({ references: "Organization.slug", required: true }),
      },
    });

    const schema = generateDrizzleSchema([organization, repository], "postgres");
    const migration = generateMigration([], [organization, repository], "postgres").join(";\n");

    expect(schema).toContain('.references(() => organizations.slug)');
    expect(schema).not.toContain('.references(() => organizations.id)');
    expect(migration).toContain("REFERENCES organizations(slug)");
    expect(migration).not.toContain("REFERENCES organizations(id)");
  });

  it("uses inferred primary keys when the reference omits the field name", () => {
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

    const schema = generateDrizzleSchema([account, invoice], "mysql");
    const migration = generateMigration([], [account, invoice], "mysql").join(";\n");

    expect(schema).toContain('.references(() => accounts.slug)');
    expect(migration).toContain("REFERENCES accounts(slug)");
  });

  it("reports accurate migration issues for custom-key models", () => {
    const before = defineModel("Repository", {
      fields: {
        repositoryId: field.id(),
        organizationSlug: field.string({ references: "Organization.slug", required: true }),
        name: field.string({ required: true }),
      },
      indexes: [{ fields: ["organizationSlug"] }],
    });
    const after = defineModel("Repository", {
      fields: {
        repositoryId: field.id(),
        organizationSlug: field.string({ references: "Organization.slug", required: true }),
        visibility: field.string({ default: "private" }),
      },
    });

    const plan = planMigration([before], [after], "sqlite");
    expect(plan.issues.map((issue) => issue.code).sort()).toEqual(["DROP_COLUMN", "DROP_INDEX"]);
    expect(plan.statements).toContain(
      "ALTER TABLE repositories ADD COLUMN visibility TEXT DEFAULT 'private'",
    );
  });

  it("throws clear errors when create validation fails on string, enum, and vector fields", async () => {
    const model = defineModel("Dataset", {
      fields: {
        id: field.id(),
        name: field.string({ required: true, min: 4 }),
        mode: field.enum(["train", "test"] as const),
        embedding: field.vector(2),
      },
    });

    await expect(
      prepareCreateData(model, { name: "abc" }),
    ).rejects.toThrow('Field "Dataset.name" must be at least 4 characters');
    await expect(
      prepareCreateData(model, { name: "valid", mode: "prod" }),
    ).rejects.toThrow('Field "Dataset.mode" must be one of: train, test');
    await expect(
      prepareCreateData(model, { name: "valid", embedding: [1, 2, 3] }),
    ).rejects.toThrow('Field "Dataset.embedding" must contain exactly 2 dimensions');
  });

  it("throws clear errors when update validation fails on numeric and temporal fields", async () => {
    const model = defineModel("Metric", {
      fields: {
        id: field.id(),
        count: field.integer({ min: 1, max: 10 }),
        score: field.number({ min: 0, max: 1 }),
        observedOn: field.date(),
        observedAt: field.datetime(),
      },
    });

    await expect(
      prepareUpdateData(model, { count: 0 }),
    ).rejects.toThrow('Field "Metric.count" must be at least 1');
    await expect(
      prepareUpdateData(model, { score: 2 }),
    ).rejects.toThrow('Field "Metric.score" must be at most 1');
    await expect(
      prepareUpdateData(model, { observedOn: "04/03/2026" }),
    ).rejects.toThrow('Field "Metric.observedOn" must be a YYYY-MM-DD string');
    await expect(
      prepareUpdateData(model, { observedAt: "bad" }),
    ).rejects.toThrow('Field "Metric.observedAt" must be a valid datetime string');
  });

  it("does not lose relation comments when only many-to-many relations are present", () => {
    const user = defineModel("User", {
      fields: { id: field.id() },
      relations: {
        teams: relation.manyToMany("Team", { through: "TeamMember" }),
      },
    });
    const team = defineModel("Team", {
      fields: { id: field.id() },
    });
    const teamMember = defineModel("TeamMember", {
      fields: {
        id: field.id(),
        userId: field.string({ references: "User", required: true }),
        teamId: field.string({ references: "Team", required: true }),
      },
    });

    const schema = generateDrizzleSchema([user, team, teamMember], "postgres");
    expect(schema).toContain("// User: many-to-many relations require an explicit join model");
    expect(schema).toContain('export const usersRelationMetadata = {');
    expect(schema).toContain('teams: { kind: "manyToMany", model: "Team", through: "TeamMember"');
  });

  it("serializes custom-reference contracts into generated CRUD routes", () => {
    const repository = defineModel("Repository", {
      fields: {
        repositoryId: field.id(),
        organizationSlug: field.string({ references: "Organization.slug", required: true }),
        name: field.string({ required: true }),
      },
    });

    const files = generateCrudRoutes(repository);
    const index = files.find((file) => file.path === "repositories/index.api.ts")?.content ?? "";
    const detail = files.find((file) => file.path === "repositories/[id].api.ts")?.content ?? "";

    expect(index).toContain('"references": "Organization.slug"');
    expect(detail).toContain("eq(repositories.repositoryId, params.id)");
  });

  it("maintains safe-by-default migration behavior even with multiple destructive changes", () => {
    const before = defineModel("Deployment", {
      fields: {
        id: field.id(),
        environment: field.string(),
        revision: field.string(),
      },
      indexes: [{ fields: ["environment", "revision"] }],
    });
    const after = defineModel("Deployment", {
      fields: {
        id: field.id(),
        revision: field.integer(),
      },
    });

    const plan = planMigration([before], [after], "postgres");
    const sql = generateMigration([before], [after], "postgres");

    expect(plan.issues.map((issue) => issue.code).sort()).toEqual([
      "ALTER_COLUMN",
      "DROP_COLUMN",
      "DROP_INDEX",
    ]);
    expect(sql).toEqual([]);
  });

  it("still emits additive SQL when destructive issues exist in the same migration plan", () => {
    const before = defineModel("Artifact", {
      fields: {
        id: field.id(),
        checksum: field.string(),
        obsolete: field.string(),
      },
    });
    const after = defineModel("Artifact", {
      fields: {
        id: field.id(),
        checksum: field.string(),
        digestAlgorithm: field.string({ default: "sha256" }),
      },
    });

    const plan = planMigration([before], [after], "sqlite");
    expect(plan.statements).toContain(
      "ALTER TABLE artifacts ADD COLUMN digest_algorithm TEXT DEFAULT 'sha256'",
    );
    expect(plan.issues).toEqual([
      expect.objectContaining({
        code: "DROP_COLUMN",
        fieldName: "obsolete",
      }),
    ]);
  });

  it("keeps runtime defaults intact when validation passes", async () => {
    const model = defineModel("Build", {
      fields: {
        id: field.id(),
        name: field.string({ required: true }),
        channel: field.enum(["stable", "preview"] as const, { default: "stable" }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const payload = await prepareCreateData(model, { name: "nightly" });
    expect(payload.channel).toBe("stable");
    expect(typeof payload.updatedAt).toBe("string");
    expect(typeof payload.id).toBe("string");
  });
});

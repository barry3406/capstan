import { describe, expect, it } from "bun:test";
import { defineModel, field, generateCrudRoutes } from "@zauso-ai/capstan-db";

describe("generateCrudRoutes", () => {
  it("routes create and update writes through the runtime prepare helpers", () => {
    const model = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        updatedAt: field.datetime({ updatedAt: true }),
      },
    });

    const files = generateCrudRoutes(model);
    const indexFile = files.find((file) => file.path === "tickets/index.api.ts");
    const detailFile = files.find((file) => file.path === "tickets/[id].api.ts");

    expect(indexFile?.content).toContain('import { prepareCreateData } from "@zauso-ai/capstan-db"');
    expect(indexFile?.content).toContain("await prepareCreateData(model, input)");
    expect(detailFile?.content).toContain('import { prepareUpdateData } from "@zauso-ai/capstan-db"');
    expect(detailFile?.content).toContain("await prepareUpdateData(model, input)");
  });

  it("serializes the model contract into the generated route files", () => {
    const model = defineModel("Ticket", {
      fields: {
        id: field.id(),
        title: field.string({ required: true }),
        status: field.enum(["open", "closed"], { default: "open" }),
      },
    });

    const [indexFile] = generateCrudRoutes(model);
    expect(indexFile.content).toContain('const model = {');
    expect(indexFile.content).toContain('"status"');
    expect(indexFile.content).toContain('"default": "open"');
  });

  it("maps vector fields to a bounded numeric array schema", () => {
    const model = defineModel("Document", {
      fields: {
        id: field.id(),
        embedding: field.vector(3),
      },
    });

    const [indexFile] = generateCrudRoutes(model);
    expect(indexFile.content).toContain("z.array(z.number()).length(3)");
  });
});

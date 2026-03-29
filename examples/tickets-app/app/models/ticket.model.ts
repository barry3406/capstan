import { defineModel, field } from "@zauso-ai/capstan-db";

export const Ticket = defineModel("ticket", {
  fields: {
    id: field.id(),
    title: field.string({ required: true, min: 1, max: 200 }),
    description: field.text(),
    status: field.enum(["open", "in_progress", "closed"], { default: "open" }),
    priority: field.enum(["low", "medium", "high"], { default: "medium" }),
    assignee: field.string(),
    createdAt: field.datetime({ default: "now" }),
    updatedAt: field.datetime({ updatedAt: true }),
  },
});

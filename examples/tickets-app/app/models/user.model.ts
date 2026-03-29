import { defineModel, field } from "@zauso-ai/capstan-db";

export const User = defineModel("user", {
  fields: {
    id: field.id(),
    email: field.string({ required: true, unique: true }),
    name: field.string({ required: true }),
    role: field.enum(["admin", "member", "viewer"], { default: "member" }),
    createdAt: field.datetime({ default: "now" }),
  },
});

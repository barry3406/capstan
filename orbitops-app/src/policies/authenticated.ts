import type { PolicyDefinition } from "../types.js";

export const authenticatedPolicy = {
  "key": "authenticated",
  "title": "Authenticated Access",
  "description": "Allows access only for authenticated operators.",
  "effect": "allow"
} satisfies PolicyDefinition;

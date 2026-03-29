import type { PolicyDefinition } from "../types.js";

export const tenantScopedPolicy = {
  "key": "tenantScoped",
  "title": "Tenant Scoped Access",
  "description": "Allows access only when a request is correctly scoped to one tenant.",
  "effect": "allow"
} satisfies PolicyDefinition;

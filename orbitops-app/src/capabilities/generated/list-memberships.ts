import type {
  CapabilityDefinition
} from "../../types.js";

export const listMembershipsCapability = {
  "key": "listMemberships",
  "title": "List Memberships",
  "description": "Read membership assignments for organizations.",
  "mode": "read",
  "resources": [
    "membership",
    "organization",
    "user"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;

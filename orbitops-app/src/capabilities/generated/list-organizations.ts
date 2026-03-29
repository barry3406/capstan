import type {
  CapabilityDefinition
} from "../../types.js";

export const listOrganizationsCapability = {
  "key": "listOrganizations",
  "title": "List Organizations",
  "description": "Read the organizations that scope work inside the application.",
  "mode": "read",
  "resources": [
    "organization"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;

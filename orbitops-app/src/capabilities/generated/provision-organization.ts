import type {
  CapabilityDefinition
} from "../../types.js";

export const provisionOrganizationCapability = {
  "key": "provisionOrganization",
  "title": "Provision Organization",
  "description": "Create a new organization in a controlled way.",
  "mode": "write",
  "input": {
    "name": {
      "type": "string",
      "required": true
    },
    "slug": {
      "type": "string",
      "required": true
    }
  },
  "resources": [
    "organization"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;

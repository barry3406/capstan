import type { ViewDefinition } from "../../types.js";

export const organizationListView = {
  "key": "organizationList",
  "title": "Organizations",
  "kind": "list",
  "resource": "organization",
  "capability": "listOrganizations"
} satisfies ViewDefinition;

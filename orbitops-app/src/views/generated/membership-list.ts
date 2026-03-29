import type { ViewDefinition } from "../../types.js";

export const membershipListView = {
  "key": "membershipList",
  "title": "Memberships",
  "kind": "list",
  "resource": "membership",
  "capability": "listMemberships"
} satisfies ViewDefinition;

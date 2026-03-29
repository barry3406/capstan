import type { ViewDefinition } from "../../types.js";

export const renewalOpportunityListView = {
  "key": "renewalOpportunityList",
  "title": "续费机会列表",
  "kind": "list",
  "resource": "renewalOpportunity",
  "capability": "listRenewalOpportunities"
} satisfies ViewDefinition;

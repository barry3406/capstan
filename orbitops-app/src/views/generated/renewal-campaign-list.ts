import type { ViewDefinition } from "../../types.js";

export const renewalCampaignListView = {
  "key": "renewalCampaignList",
  "title": "续费活动列表",
  "kind": "list",
  "resource": "renewalCampaign",
  "capability": "listRenewalCampaigns"
} satisfies ViewDefinition;

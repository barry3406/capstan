import type { ViewDefinition } from "../../types.js";

export const pricingPlanListView = {
  "key": "pricingPlanList",
  "title": "价格计划列表",
  "kind": "list",
  "resource": "pricingPlan",
  "capability": "listPricingPlans"
} satisfies ViewDefinition;

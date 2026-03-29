import type { TaskDefinition } from "../types.js";

export const resolveDisputeCaseTaskTask = {
  "key": "resolveDisputeCaseTask",
  "title": "Resolve Dispute Case Task",
  "description": "调查并解决账单争议。",
  "kind": "durable",
  "artifacts": [
    "disputeResolutionReport"
  ]
} satisfies TaskDefinition;

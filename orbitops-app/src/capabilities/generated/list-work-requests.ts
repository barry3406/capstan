import type {
  CapabilityDefinition
} from "../../types.js";

export const listWorkRequestsCapability = {
  "key": "listWorkRequests",
  "title": "List Work Requests",
  "description": "Read the work requests currently tracked by the workflow system.",
  "mode": "read",
  "resources": [
    "workRequest"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;

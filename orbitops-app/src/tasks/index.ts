import type { TaskDefinition } from "../types.js";

import { activateSalesOrderTaskTask } from "./activate-sales-order-task.js";
import { collectBillingInvoiceTaskTask } from "./collect-billing-invoice-task.js";
import { decideApprovalRequestTaskTask } from "./decide-approval-request-task.js";
import { launchRenewalCampaignTaskTask } from "./launch-renewal-campaign-task.js";
import { manageServiceSubscriptionTaskTask } from "./manage-service-subscription-task.js";
import { processRefundRequestTaskTask } from "./process-refund-request-task.js";
import { processWorkRequestTaskTask } from "./process-work-request-task.js";
import { reconcileReconciliationCaseTaskTask } from "./reconcile-reconciliation-case-task.js";
import { resolveDisputeCaseTaskTask } from "./resolve-dispute-case-task.js";
import { resolveExceptionCaseTaskTask } from "./resolve-exception-case-task.js";
import { reviewCustomerAccountTaskTask } from "./review-customer-account-task.js";
import { syncIntegrationConnectionTaskTask } from "./sync-integration-connection-task.js";

export const tasks: readonly TaskDefinition[] = [
  activateSalesOrderTaskTask,
  collectBillingInvoiceTaskTask,
  decideApprovalRequestTaskTask,
  launchRenewalCampaignTaskTask,
  manageServiceSubscriptionTaskTask,
  processRefundRequestTaskTask,
  processWorkRequestTaskTask,
  reconcileReconciliationCaseTaskTask,
  resolveDisputeCaseTaskTask,
  resolveExceptionCaseTaskTask,
  reviewCustomerAccountTaskTask,
  syncIntegrationConnectionTaskTask
];

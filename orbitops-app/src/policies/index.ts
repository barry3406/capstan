import type { PolicyDefinition } from "../types.js";

import { approvalRequestApprovalRequiredPolicy } from "./approval-request-approval-required.js";
import { authenticatedPolicy } from "./authenticated.js";
import { billingInvoiceApprovalRequiredPolicy } from "./billing-invoice-approval-required.js";
import { customerAccountApprovalRequiredPolicy } from "./customer-account-approval-required.js";
import { disputeCaseApprovalRequiredPolicy } from "./dispute-case-approval-required.js";
import { exceptionCaseApprovalRequiredPolicy } from "./exception-case-approval-required.js";
import { integrationConnectionApprovalRequiredPolicy } from "./integration-connection-approval-required.js";
import { reconciliationCaseApprovalRequiredPolicy } from "./reconciliation-case-approval-required.js";
import { refundRequestApprovalRequiredPolicy } from "./refund-request-approval-required.js";
import { renewalCampaignApprovalRequiredPolicy } from "./renewal-campaign-approval-required.js";
import { salesOrderApprovalRequiredPolicy } from "./sales-order-approval-required.js";
import { serviceSubscriptionApprovalRequiredPolicy } from "./service-subscription-approval-required.js";
import { tenantScopedPolicy } from "./tenant-scoped.js";
import { workflowApprovalRequiredPolicy } from "./workflow-approval-required.js";

export const policies: readonly PolicyDefinition[] = [
  approvalRequestApprovalRequiredPolicy,
  authenticatedPolicy,
  billingInvoiceApprovalRequiredPolicy,
  customerAccountApprovalRequiredPolicy,
  disputeCaseApprovalRequiredPolicy,
  exceptionCaseApprovalRequiredPolicy,
  integrationConnectionApprovalRequiredPolicy,
  reconciliationCaseApprovalRequiredPolicy,
  refundRequestApprovalRequiredPolicy,
  renewalCampaignApprovalRequiredPolicy,
  salesOrderApprovalRequiredPolicy,
  serviceSubscriptionApprovalRequiredPolicy,
  tenantScopedPolicy,
  workflowApprovalRequiredPolicy
];

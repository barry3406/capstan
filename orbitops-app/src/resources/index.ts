import type { ResourceDefinition } from "../types.js";

import { approvalRequestResource } from "./approval-request.js";
import { auditNoteResource } from "./audit-note.js";
import { billingInvoiceResource } from "./billing-invoice.js";
import { commercialContractResource } from "./commercial-contract.js";
import { customerAccountResource } from "./customer-account.js";
import { customerContactResource } from "./customer-contact.js";
import { disputeCaseResource } from "./dispute-case.js";
import { exceptionCaseResource } from "./exception-case.js";
import { integrationConnectionResource } from "./integration-connection.js";
import { memberResource } from "./member.js";
import { membershipResource } from "./membership.js";
import { organizationResource } from "./organization.js";
import { paymentRecordResource } from "./payment-record.js";
import { pricingPlanResource } from "./pricing-plan.js";
import { productCatalogItemResource } from "./product-catalog-item.js";
import { reconciliationCaseResource } from "./reconciliation-case.js";
import { refundRequestResource } from "./refund-request.js";
import { renewalCampaignResource } from "./renewal-campaign.js";
import { renewalOpportunityResource } from "./renewal-opportunity.js";
import { roleResource } from "./role.js";
import { salesOrderResource } from "./sales-order.js";
import { salesOrderLineResource } from "./sales-order-line.js";
import { serviceSubscriptionResource } from "./service-subscription.js";
import { syncJobResource } from "./sync-job.js";
import { userResource } from "./user.js";
import { workRequestResource } from "./work-request.js";
import { workspaceResource } from "./workspace.js";

export const resources: readonly ResourceDefinition[] = [
  approvalRequestResource,
  auditNoteResource,
  billingInvoiceResource,
  commercialContractResource,
  customerAccountResource,
  customerContactResource,
  disputeCaseResource,
  exceptionCaseResource,
  integrationConnectionResource,
  memberResource,
  membershipResource,
  organizationResource,
  paymentRecordResource,
  pricingPlanResource,
  productCatalogItemResource,
  reconciliationCaseResource,
  refundRequestResource,
  renewalCampaignResource,
  renewalOpportunityResource,
  roleResource,
  salesOrderResource,
  salesOrderLineResource,
  serviceSubscriptionResource,
  syncJobResource,
  userResource,
  workRequestResource,
  workspaceResource
];

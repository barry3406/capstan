import type { ViewDefinition } from "../types.js";

import { approvalRequestDetailView } from "./generated/approval-request-detail.js";
import { approvalRequestFormView } from "./generated/approval-request-form.js";
import { approvalRequestListView } from "./generated/approval-request-list.js";
import { auditNoteFormView } from "./generated/audit-note-form.js";
import { auditNoteListView } from "./generated/audit-note-list.js";
import { billingInvoiceDetailView } from "./generated/billing-invoice-detail.js";
import { billingInvoiceFormView } from "./generated/billing-invoice-form.js";
import { billingInvoiceListView } from "./generated/billing-invoice-list.js";
import { commercialContractFormView } from "./generated/commercial-contract-form.js";
import { commercialContractListView } from "./generated/commercial-contract-list.js";
import { customerAccountDetailView } from "./generated/customer-account-detail.js";
import { customerAccountFormView } from "./generated/customer-account-form.js";
import { customerAccountListView } from "./generated/customer-account-list.js";
import { customerContactFormView } from "./generated/customer-contact-form.js";
import { customerContactListView } from "./generated/customer-contact-list.js";
import { disputeCaseDetailView } from "./generated/dispute-case-detail.js";
import { disputeCaseFormView } from "./generated/dispute-case-form.js";
import { disputeCaseListView } from "./generated/dispute-case-list.js";
import { exceptionCaseDetailView } from "./generated/exception-case-detail.js";
import { exceptionCaseFormView } from "./generated/exception-case-form.js";
import { exceptionCaseListView } from "./generated/exception-case-list.js";
import { integrationConnectionDetailView } from "./generated/integration-connection-detail.js";
import { integrationConnectionFormView } from "./generated/integration-connection-form.js";
import { integrationConnectionListView } from "./generated/integration-connection-list.js";
import { memberFormView } from "./generated/member-form.js";
import { memberListView } from "./generated/member-list.js";
import { membershipListView } from "./generated/membership-list.js";
import { organizationListView } from "./generated/organization-list.js";
import { paymentRecordFormView } from "./generated/payment-record-form.js";
import { paymentRecordListView } from "./generated/payment-record-list.js";
import { pricingPlanFormView } from "./generated/pricing-plan-form.js";
import { pricingPlanListView } from "./generated/pricing-plan-list.js";
import { productCatalogItemFormView } from "./generated/product-catalog-item-form.js";
import { productCatalogItemListView } from "./generated/product-catalog-item-list.js";
import { reconciliationCaseDetailView } from "./generated/reconciliation-case-detail.js";
import { reconciliationCaseFormView } from "./generated/reconciliation-case-form.js";
import { reconciliationCaseListView } from "./generated/reconciliation-case-list.js";
import { refundRequestDetailView } from "./generated/refund-request-detail.js";
import { refundRequestFormView } from "./generated/refund-request-form.js";
import { refundRequestListView } from "./generated/refund-request-list.js";
import { renewalCampaignDetailView } from "./generated/renewal-campaign-detail.js";
import { renewalCampaignFormView } from "./generated/renewal-campaign-form.js";
import { renewalCampaignListView } from "./generated/renewal-campaign-list.js";
import { renewalOpportunityFormView } from "./generated/renewal-opportunity-form.js";
import { renewalOpportunityListView } from "./generated/renewal-opportunity-list.js";
import { salesOrderDetailView } from "./generated/sales-order-detail.js";
import { salesOrderFormView } from "./generated/sales-order-form.js";
import { salesOrderLineFormView } from "./generated/sales-order-line-form.js";
import { salesOrderLineListView } from "./generated/sales-order-line-list.js";
import { salesOrderListView } from "./generated/sales-order-list.js";
import { serviceSubscriptionDetailView } from "./generated/service-subscription-detail.js";
import { serviceSubscriptionFormView } from "./generated/service-subscription-form.js";
import { serviceSubscriptionListView } from "./generated/service-subscription-list.js";
import { syncJobFormView } from "./generated/sync-job-form.js";
import { syncJobListView } from "./generated/sync-job-list.js";
import { userFormView } from "./generated/user-form.js";
import { userListView } from "./generated/user-list.js";
import { workRequestDetailView } from "./generated/work-request-detail.js";
import { workRequestFormView } from "./generated/work-request-form.js";
import { workRequestListView } from "./generated/work-request-list.js";
import { workspaceFormView } from "./generated/workspace-form.js";
import { workspaceListView } from "./generated/workspace-list.js";

export const views: readonly ViewDefinition[] = [
  approvalRequestDetailView,
  approvalRequestFormView,
  approvalRequestListView,
  auditNoteFormView,
  auditNoteListView,
  billingInvoiceDetailView,
  billingInvoiceFormView,
  billingInvoiceListView,
  commercialContractFormView,
  commercialContractListView,
  customerAccountDetailView,
  customerAccountFormView,
  customerAccountListView,
  customerContactFormView,
  customerContactListView,
  disputeCaseDetailView,
  disputeCaseFormView,
  disputeCaseListView,
  exceptionCaseDetailView,
  exceptionCaseFormView,
  exceptionCaseListView,
  integrationConnectionDetailView,
  integrationConnectionFormView,
  integrationConnectionListView,
  memberFormView,
  memberListView,
  membershipListView,
  organizationListView,
  paymentRecordFormView,
  paymentRecordListView,
  pricingPlanFormView,
  pricingPlanListView,
  productCatalogItemFormView,
  productCatalogItemListView,
  reconciliationCaseDetailView,
  reconciliationCaseFormView,
  reconciliationCaseListView,
  refundRequestDetailView,
  refundRequestFormView,
  refundRequestListView,
  renewalCampaignDetailView,
  renewalCampaignFormView,
  renewalCampaignListView,
  renewalOpportunityFormView,
  renewalOpportunityListView,
  salesOrderDetailView,
  salesOrderFormView,
  salesOrderLineFormView,
  salesOrderLineListView,
  salesOrderListView,
  serviceSubscriptionDetailView,
  serviceSubscriptionFormView,
  serviceSubscriptionListView,
  syncJobFormView,
  syncJobListView,
  userFormView,
  userListView,
  workRequestDetailView,
  workRequestFormView,
  workRequestListView,
  workspaceFormView,
  workspaceListView
];

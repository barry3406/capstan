import type {
  CapabilityDefinition,
  CapabilityExecutionResult
} from "../types.js";

import { activateSalesOrderCapability } from "./generated/activate-sales-order.js";
import { activateSalesOrder } from "./activate-sales-order.js";
import { addAuditNoteCapability } from "./generated/add-audit-note.js";
import { addAuditNote } from "./add-audit-note.js";
import { collectBillingInvoiceCapability } from "./generated/collect-billing-invoice.js";
import { collectBillingInvoice } from "./collect-billing-invoice.js";
import { configureIntegrationConnectionCapability } from "./generated/configure-integration-connection.js";
import { configureIntegrationConnection } from "./configure-integration-connection.js";
import { createSalesOrderCapability } from "./generated/create-sales-order.js";
import { createSalesOrder } from "./create-sales-order.js";
import { decideApprovalRequestCapability } from "./generated/decide-approval-request.js";
import { decideApprovalRequest } from "./decide-approval-request.js";
import { inviteUserCapability } from "./generated/invite-user.js";
import { inviteUser } from "./invite-user.js";
import { issueBillingInvoiceCapability } from "./generated/issue-billing-invoice.js";
import { issueBillingInvoice } from "./issue-billing-invoice.js";
import { launchRenewalCampaignCapability } from "./generated/launch-renewal-campaign.js";
import { launchRenewalCampaign } from "./launch-renewal-campaign.js";
import { listApprovalRequestsCapability } from "./generated/list-approval-requests.js";
import { listApprovalRequests } from "./list-approval-requests.js";
import { listAuditNotesCapability } from "./generated/list-audit-notes.js";
import { listAuditNotes } from "./list-audit-notes.js";
import { listBillingInvoicesCapability } from "./generated/list-billing-invoices.js";
import { listBillingInvoices } from "./list-billing-invoices.js";
import { listCommercialContractsCapability } from "./generated/list-commercial-contracts.js";
import { listCommercialContracts } from "./list-commercial-contracts.js";
import { listCustomerAccountsCapability } from "./generated/list-customer-accounts.js";
import { listCustomerAccounts } from "./list-customer-accounts.js";
import { listCustomerContactsCapability } from "./generated/list-customer-contacts.js";
import { listCustomerContacts } from "./list-customer-contacts.js";
import { listDisputeCasesCapability } from "./generated/list-dispute-cases.js";
import { listDisputeCases } from "./list-dispute-cases.js";
import { listExceptionCasesCapability } from "./generated/list-exception-cases.js";
import { listExceptionCases } from "./list-exception-cases.js";
import { listIntegrationConnectionsCapability } from "./generated/list-integration-connections.js";
import { listIntegrationConnections } from "./list-integration-connections.js";
import { listMembersCapability } from "./generated/list-members.js";
import { listMembers } from "./list-members.js";
import { listMembershipsCapability } from "./generated/list-memberships.js";
import { listMemberships } from "./list-memberships.js";
import { listOrganizationsCapability } from "./generated/list-organizations.js";
import { listOrganizations } from "./list-organizations.js";
import { listPaymentRecordsCapability } from "./generated/list-payment-records.js";
import { listPaymentRecords } from "./list-payment-records.js";
import { listPricingPlansCapability } from "./generated/list-pricing-plans.js";
import { listPricingPlans } from "./list-pricing-plans.js";
import { listProductCatalogItemsCapability } from "./generated/list-product-catalog-items.js";
import { listProductCatalogItems } from "./list-product-catalog-items.js";
import { listReconciliationCasesCapability } from "./generated/list-reconciliation-cases.js";
import { listReconciliationCases } from "./list-reconciliation-cases.js";
import { listRefundRequestsCapability } from "./generated/list-refund-requests.js";
import { listRefundRequests } from "./list-refund-requests.js";
import { listRenewalCampaignsCapability } from "./generated/list-renewal-campaigns.js";
import { listRenewalCampaigns } from "./list-renewal-campaigns.js";
import { listRenewalOpportunitiesCapability } from "./generated/list-renewal-opportunities.js";
import { listRenewalOpportunities } from "./list-renewal-opportunities.js";
import { listSalesOrderLinesCapability } from "./generated/list-sales-order-lines.js";
import { listSalesOrderLines } from "./list-sales-order-lines.js";
import { listSalesOrdersCapability } from "./generated/list-sales-orders.js";
import { listSalesOrders } from "./list-sales-orders.js";
import { listServiceSubscriptionsCapability } from "./generated/list-service-subscriptions.js";
import { listServiceSubscriptions } from "./list-service-subscriptions.js";
import { listSyncJobsCapability } from "./generated/list-sync-jobs.js";
import { listSyncJobs } from "./list-sync-jobs.js";
import { listUsersCapability } from "./generated/list-users.js";
import { listUsers } from "./list-users.js";
import { listWorkRequestsCapability } from "./generated/list-work-requests.js";
import { listWorkRequests } from "./list-work-requests.js";
import { listWorkspacesCapability } from "./generated/list-workspaces.js";
import { listWorkspaces } from "./list-workspaces.js";
import { manageServiceSubscriptionCapability } from "./generated/manage-service-subscription.js";
import { manageServiceSubscription } from "./manage-service-subscription.js";
import { openDisputeCaseCapability } from "./generated/open-dispute-case.js";
import { openDisputeCase } from "./open-dispute-case.js";
import { openReconciliationCaseCapability } from "./generated/open-reconciliation-case.js";
import { openReconciliationCase } from "./open-reconciliation-case.js";
import { planRenewalCampaignCapability } from "./generated/plan-renewal-campaign.js";
import { planRenewalCampaign } from "./plan-renewal-campaign.js";
import { processRefundRequestCapability } from "./generated/process-refund-request.js";
import { processRefundRequest } from "./process-refund-request.js";
import { processWorkRequestCapability } from "./generated/process-work-request.js";
import { processWorkRequest } from "./process-work-request.js";
import { provisionOrganizationCapability } from "./generated/provision-organization.js";
import { provisionOrganization } from "./provision-organization.js";
import { reconcileReconciliationCaseCapability } from "./generated/reconcile-reconciliation-case.js";
import { reconcileReconciliationCase } from "./reconcile-reconciliation-case.js";
import { recordPaymentRecordCapability } from "./generated/record-payment-record.js";
import { recordPaymentRecord } from "./record-payment-record.js";
import { requestRefundRequestCapability } from "./generated/request-refund-request.js";
import { requestRefundRequest } from "./request-refund-request.js";
import { resolveDisputeCaseCapability } from "./generated/resolve-dispute-case.js";
import { resolveDisputeCase } from "./resolve-dispute-case.js";
import { resolveExceptionCaseCapability } from "./generated/resolve-exception-case.js";
import { resolveExceptionCase } from "./resolve-exception-case.js";
import { reviewCustomerAccountCapability } from "./generated/review-customer-account.js";
import { reviewCustomerAccount } from "./review-customer-account.js";
import { submitApprovalRequestCapability } from "./generated/submit-approval-request.js";
import { submitApprovalRequest } from "./submit-approval-request.js";
import { submitWorkRequestCapability } from "./generated/submit-work-request.js";
import { submitWorkRequest } from "./submit-work-request.js";
import { syncIntegrationConnectionCapability } from "./generated/sync-integration-connection.js";
import { syncIntegrationConnection } from "./sync-integration-connection.js";
import { updateRenewalOpportunityCapability } from "./generated/update-renewal-opportunity.js";
import { updateRenewalOpportunity } from "./update-renewal-opportunity.js";
import { upsertCommercialContractCapability } from "./generated/upsert-commercial-contract.js";
import { upsertCommercialContract } from "./upsert-commercial-contract.js";
import { upsertCustomerAccountCapability } from "./generated/upsert-customer-account.js";
import { upsertCustomerAccount } from "./upsert-customer-account.js";
import { upsertCustomerContactCapability } from "./generated/upsert-customer-contact.js";
import { upsertCustomerContact } from "./upsert-customer-contact.js";
import { upsertExceptionCaseCapability } from "./generated/upsert-exception-case.js";
import { upsertExceptionCase } from "./upsert-exception-case.js";
import { upsertMemberCapability } from "./generated/upsert-member.js";
import { upsertMember } from "./upsert-member.js";
import { upsertPricingPlanCapability } from "./generated/upsert-pricing-plan.js";
import { upsertPricingPlan } from "./upsert-pricing-plan.js";
import { upsertProductCatalogItemCapability } from "./generated/upsert-product-catalog-item.js";
import { upsertProductCatalogItem } from "./upsert-product-catalog-item.js";
import { upsertSalesOrderLineCapability } from "./generated/upsert-sales-order-line.js";
import { upsertSalesOrderLine } from "./upsert-sales-order-line.js";
import { upsertServiceSubscriptionCapability } from "./generated/upsert-service-subscription.js";
import { upsertServiceSubscription } from "./upsert-service-subscription.js";
import { upsertSyncJobCapability } from "./generated/upsert-sync-job.js";
import { upsertSyncJob } from "./upsert-sync-job.js";
import { upsertWorkspaceCapability } from "./generated/upsert-workspace.js";
import { upsertWorkspace } from "./upsert-workspace.js";

export const capabilities: readonly CapabilityDefinition[] = [
  activateSalesOrderCapability,
  addAuditNoteCapability,
  collectBillingInvoiceCapability,
  configureIntegrationConnectionCapability,
  createSalesOrderCapability,
  decideApprovalRequestCapability,
  inviteUserCapability,
  issueBillingInvoiceCapability,
  launchRenewalCampaignCapability,
  listApprovalRequestsCapability,
  listAuditNotesCapability,
  listBillingInvoicesCapability,
  listCommercialContractsCapability,
  listCustomerAccountsCapability,
  listCustomerContactsCapability,
  listDisputeCasesCapability,
  listExceptionCasesCapability,
  listIntegrationConnectionsCapability,
  listMembersCapability,
  listMembershipsCapability,
  listOrganizationsCapability,
  listPaymentRecordsCapability,
  listPricingPlansCapability,
  listProductCatalogItemsCapability,
  listReconciliationCasesCapability,
  listRefundRequestsCapability,
  listRenewalCampaignsCapability,
  listRenewalOpportunitiesCapability,
  listSalesOrderLinesCapability,
  listSalesOrdersCapability,
  listServiceSubscriptionsCapability,
  listSyncJobsCapability,
  listUsersCapability,
  listWorkRequestsCapability,
  listWorkspacesCapability,
  manageServiceSubscriptionCapability,
  openDisputeCaseCapability,
  openReconciliationCaseCapability,
  planRenewalCampaignCapability,
  processRefundRequestCapability,
  processWorkRequestCapability,
  provisionOrganizationCapability,
  reconcileReconciliationCaseCapability,
  recordPaymentRecordCapability,
  requestRefundRequestCapability,
  resolveDisputeCaseCapability,
  resolveExceptionCaseCapability,
  reviewCustomerAccountCapability,
  submitApprovalRequestCapability,
  submitWorkRequestCapability,
  syncIntegrationConnectionCapability,
  updateRenewalOpportunityCapability,
  upsertCommercialContractCapability,
  upsertCustomerAccountCapability,
  upsertCustomerContactCapability,
  upsertExceptionCaseCapability,
  upsertMemberCapability,
  upsertPricingPlanCapability,
  upsertProductCatalogItemCapability,
  upsertSalesOrderLineCapability,
  upsertServiceSubscriptionCapability,
  upsertSyncJobCapability,
  upsertWorkspaceCapability
] as const;

export const capabilityHandlers: Record<
  string,
  (input: Record<string, unknown>) => Promise<CapabilityExecutionResult>
> = {
  "activateSalesOrder": activateSalesOrder,
  "addAuditNote": addAuditNote,
  "collectBillingInvoice": collectBillingInvoice,
  "configureIntegrationConnection": configureIntegrationConnection,
  "createSalesOrder": createSalesOrder,
  "decideApprovalRequest": decideApprovalRequest,
  "inviteUser": inviteUser,
  "issueBillingInvoice": issueBillingInvoice,
  "launchRenewalCampaign": launchRenewalCampaign,
  "listApprovalRequests": listApprovalRequests,
  "listAuditNotes": listAuditNotes,
  "listBillingInvoices": listBillingInvoices,
  "listCommercialContracts": listCommercialContracts,
  "listCustomerAccounts": listCustomerAccounts,
  "listCustomerContacts": listCustomerContacts,
  "listDisputeCases": listDisputeCases,
  "listExceptionCases": listExceptionCases,
  "listIntegrationConnections": listIntegrationConnections,
  "listMembers": listMembers,
  "listMemberships": listMemberships,
  "listOrganizations": listOrganizations,
  "listPaymentRecords": listPaymentRecords,
  "listPricingPlans": listPricingPlans,
  "listProductCatalogItems": listProductCatalogItems,
  "listReconciliationCases": listReconciliationCases,
  "listRefundRequests": listRefundRequests,
  "listRenewalCampaigns": listRenewalCampaigns,
  "listRenewalOpportunities": listRenewalOpportunities,
  "listSalesOrderLines": listSalesOrderLines,
  "listSalesOrders": listSalesOrders,
  "listServiceSubscriptions": listServiceSubscriptions,
  "listSyncJobs": listSyncJobs,
  "listUsers": listUsers,
  "listWorkRequests": listWorkRequests,
  "listWorkspaces": listWorkspaces,
  "manageServiceSubscription": manageServiceSubscription,
  "openDisputeCase": openDisputeCase,
  "openReconciliationCase": openReconciliationCase,
  "planRenewalCampaign": planRenewalCampaign,
  "processRefundRequest": processRefundRequest,
  "processWorkRequest": processWorkRequest,
  "provisionOrganization": provisionOrganization,
  "reconcileReconciliationCase": reconcileReconciliationCase,
  "recordPaymentRecord": recordPaymentRecord,
  "requestRefundRequest": requestRefundRequest,
  "resolveDisputeCase": resolveDisputeCase,
  "resolveExceptionCase": resolveExceptionCase,
  "reviewCustomerAccount": reviewCustomerAccount,
  "submitApprovalRequest": submitApprovalRequest,
  "submitWorkRequest": submitWorkRequest,
  "syncIntegrationConnection": syncIntegrationConnection,
  "updateRenewalOpportunity": updateRenewalOpportunity,
  "upsertCommercialContract": upsertCommercialContract,
  "upsertCustomerAccount": upsertCustomerAccount,
  "upsertCustomerContact": upsertCustomerContact,
  "upsertExceptionCase": upsertExceptionCase,
  "upsertMember": upsertMember,
  "upsertPricingPlan": upsertPricingPlan,
  "upsertProductCatalogItem": upsertProductCatalogItem,
  "upsertSalesOrderLine": upsertSalesOrderLine,
  "upsertServiceSubscription": upsertServiceSubscription,
  "upsertSyncJob": upsertSyncJob,
  "upsertWorkspace": upsertWorkspace
};

import type { ArtifactDefinition } from "../types.js";

import { approvalDecisionRecordArtifact } from "./approval-decision-record.js";
import { customerHealthSnapshotArtifact } from "./customer-health-snapshot.js";
import { disputeResolutionReportArtifact } from "./dispute-resolution-report.js";
import { exceptionResolutionSummaryArtifact } from "./exception-resolution-summary.js";
import { invoiceCollectionReceiptArtifact } from "./invoice-collection-receipt.js";
import { refundExecutionReceiptArtifact } from "./refund-execution-receipt.js";
import { renewalRiskDigestArtifact } from "./renewal-risk-digest.js";
import { revenueReconciliationCaseReportArtifact } from "./revenue-reconciliation-case-report.js";
import { salesOrderActivationReceiptArtifact } from "./sales-order-activation-receipt.js";
import { subscriptionLifecycleRecordArtifact } from "./subscription-lifecycle-record.js";
import { syncHealthReportArtifact } from "./sync-health-report.js";
import { workRequestReportArtifact } from "./work-request-report.js";

export const artifacts: readonly ArtifactDefinition[] = [
  approvalDecisionRecordArtifact,
  customerHealthSnapshotArtifact,
  disputeResolutionReportArtifact,
  exceptionResolutionSummaryArtifact,
  invoiceCollectionReceiptArtifact,
  refundExecutionReceiptArtifact,
  renewalRiskDigestArtifact,
  revenueReconciliationCaseReportArtifact,
  salesOrderActivationReceiptArtifact,
  subscriptionLifecycleRecordArtifact,
  syncHealthReportArtifact,
  workRequestReportArtifact
];

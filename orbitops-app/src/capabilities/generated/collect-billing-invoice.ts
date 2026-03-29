import type {
  CapabilityDefinition
} from "../../types.js";

export const collectBillingInvoiceCapability = {
  "key": "collectBillingInvoice",
  "title": "催收发票",
  "mode": "external",
  "input": {
    "billingInvoiceId": {
      "type": "string",
      "required": true
    }
  },
  "output": {
    "artifact": {
      "type": "json",
      "description": "Produced record payload or reference for artifact \"invoiceCollectionReceipt\"."
    },
    "billingInvoiceId": {
      "type": "string",
      "description": "Stable identifier for the billingInvoice record associated with this execution."
    },
    "status": {
      "type": "string",
      "required": true,
      "description": "Execution status for this capability run."
    },
    "taskRunId": {
      "type": "string",
      "description": "Durable run identifier for task \"collectBillingInvoiceTask\"."
    }
  },
  "resources": [
    "billingInvoice"
  ],
  "task": "collectBillingInvoiceTask",
  "policy": "billingInvoiceApprovalRequired"
} satisfies CapabilityDefinition;

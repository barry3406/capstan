import type { AppGraph } from "../../../packages/app-graph/src/index.ts";

export const billingPackedOperationsAppGraph = {
  version: 1,
  domain: {
    key: "operations",
    title: "Operations Billing Hub",
    description: "A packed operations app that composes tenant and billing primitives."
  },
  packs: [
    {
      key: "tenant",
      options: {
        entityName: "Workspace",
        entityPlural: "Workspaces"
      }
    },
    {
      key: "billing",
      options: {
        subscriptionName: "Service Subscription",
        subscriptionPlural: "Service Subscriptions",
        subscriptionResourceKey: "serviceSubscription",
        invoiceName: "Billing Invoice",
        invoicePlural: "Billing Invoices",
        invoiceResourceKey: "billingInvoice",
        artifactKey: "billingInvoiceCollectionReceipt"
      }
    }
  ],
  resources: [
    {
      key: "project",
      title: "Project",
      fields: {
        name: {
          type: "string",
          required: true
        },
        workspaceId: {
          type: "string",
          required: true
        },
        status: {
          type: "string",
          required: true
        }
      }
    }
  ],
  capabilities: [
    {
      key: "listProjects",
      title: "List Projects",
      description: "Browse projects scoped to one workspace.",
      mode: "read",
      resources: ["project"],
      policy: "tenantScoped"
    }
  ],
  views: [
    {
      key: "projectList",
      title: "Projects",
      kind: "list",
      resource: "project",
      capability: "listProjects"
    }
  ]
} satisfies AppGraph;

export default billingPackedOperationsAppGraph;

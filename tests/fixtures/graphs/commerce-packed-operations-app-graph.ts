import type { AppGraph } from "../../../packages/app-graph/src/index.ts";

export const commercePackedOperationsAppGraph = {
  version: 1,
  domain: {
    key: "operations",
    title: "Operations Commerce Hub",
    description: "A packed operations app that composes tenant and commerce primitives."
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
      key: "commerce",
      options: {
        catalogItemName: "Catalog Item",
        catalogItemPlural: "Catalog Items",
        catalogItemResourceKey: "catalogItem",
        orderName: "Sales Order",
        orderPlural: "Sales Orders",
        orderResourceKey: "salesOrder",
        artifactKey: "salesOrderFulfillmentReceipt"
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

export default commercePackedOperationsAppGraph;

import type { AppGraph } from "../../../packages/app-graph/src/index.ts";

export const connectorPackedOperationsAppGraph = {
  version: 1,
  domain: {
    key: "operations",
    title: "Operations Connector Hub",
    description: "A packed operations app that composes tenant and connector primitives."
  },
  packs: [
    {
      key: "connector",
      options: {
        entityName: "Data Source",
        entityPlural: "Data Sources",
        resourceKey: "dataSource",
        artifactKey: "dataSourceSyncReport"
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

export default connectorPackedOperationsAppGraph;

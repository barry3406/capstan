import { describe, expect, it } from "vitest";
import type { AppGraph } from "../../packages/app-graph/src/index.ts";
import {
  applyAppGraphPacks,
  applyBuiltinAppGraphPacks,
  createDurableEntityPack,
  createLinkedEntityPack,
  listBuiltinGraphPacks,
  resolvePackSelections
} from "../../packages/packs-core/src/index.ts";
import { billingPackedOperationsAppGraph } from "../fixtures/graphs/billing-packed-operations-app-graph.ts";
import { commercePackedOperationsAppGraph } from "../fixtures/graphs/commerce-packed-operations-app-graph.ts";
import { connectorPackedOperationsAppGraph } from "../fixtures/graphs/connector-packed-operations-app-graph.ts";
import { packedOperationsAppGraph } from "../fixtures/graphs/packed-operations-app-graph.ts";
import { revenueOpsPackedOperationsAppGraph } from "../fixtures/graphs/revenue-ops-packed-operations-app-graph.ts";
import { externalGraphPacks } from "../fixtures/packs/external-pack-registry.ts";
import { workflowPackedOperationsAppGraph } from "../fixtures/graphs/workflow-packed-operations-app-graph.ts";

describe("packs-core", () => {
  it("applies built-in pack dependencies and expands a graph deterministically", () => {
    const expanded = applyBuiltinAppGraphPacks(packedOperationsAppGraph);

    expect(expanded.packs?.map((pack) => pack.key)).toEqual(["auth", "tenant"]);
    expect(expanded.resources.map((resource) => resource.key)).toEqual(
      expect.arrayContaining(["project", "user", "role", "workspace", "membership"])
    );
    expect(expanded.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining([
        "listProjects",
        "listUsers",
        "inviteUser",
        "listWorkspaces",
        "provisionWorkspace",
        "listMemberships"
      ])
    );
    expect(expanded.policies?.map((policy) => policy.key)).toEqual(
      expect.arrayContaining(["authenticated", "tenantScoped"])
    );
    expect(expanded.views?.map((view) => view.key)).toEqual(
      expect.arrayContaining(["projectList", "userList", "userForm", "workspaceList", "membershipList"])
    );
  });

  it("resolves dependencies ahead of explicit selections", () => {
    const selections = resolvePackSelections(
      [
        {
          key: "tenant"
        }
      ],
      new Map(listBuiltinGraphPacks().map((pack) => [pack.key, pack]))
    );

    expect(selections.map((selection) => selection.key)).toEqual(["auth", "tenant"]);
  });

  it("resolves connector dependencies through tenant and auth", () => {
    const selections = resolvePackSelections(
      [
        {
          key: "connector"
        }
      ],
      new Map(listBuiltinGraphPacks().map((pack) => [pack.key, pack]))
    );

    expect(selections.map((selection) => selection.key)).toEqual(["auth", "tenant", "connector"]);
  });

  it("resolves billing dependencies through tenant and auth", () => {
    const selections = resolvePackSelections(
      [
        {
          key: "billing"
        }
      ],
      new Map(listBuiltinGraphPacks().map((pack) => [pack.key, pack]))
    );

    expect(selections.map((selection) => selection.key)).toEqual(["auth", "tenant", "billing"]);
  });

  it("resolves commerce dependencies through tenant and auth", () => {
    const selections = resolvePackSelections(
      [
        {
          key: "commerce"
        }
      ],
      new Map(listBuiltinGraphPacks().map((pack) => [pack.key, pack]))
    );

    expect(selections.map((selection) => selection.key)).toEqual(["auth", "tenant", "commerce"]);
  });

  it("resolves revenue ops dependencies through commerce, billing, connector, tenant, and auth", () => {
    const selections = resolvePackSelections(
      [
        {
          key: "revenueOps"
        }
      ],
      new Map(listBuiltinGraphPacks().map((pack) => [pack.key, pack]))
    );

    expect(selections.map((selection) => selection.key)).toEqual([
      "auth",
      "tenant",
      "commerce",
      "billing",
      "connector",
      "revenueOps"
    ]);
  });

  it("applies external pack registries on top of built-in packs", () => {
    const expanded = applyAppGraphPacks(
      {
        version: 1,
        domain: {
          key: "operations",
          title: "External Registry Hub"
        },
        packs: [
          {
            key: "alerts"
          }
        ],
        resources: [],
        capabilities: [],
        views: []
      },
      [...listBuiltinGraphPacks(), ...externalGraphPacks]
    );

    expect(expanded.packs?.map((pack) => pack.key)).toEqual(["auth", "tenant", "alerts"]);
    expect(expanded.resources.map((resource) => resource.key)).toEqual(
      expect.arrayContaining(["alertRule", "organization", "membership", "user"])
    );
    expect(expanded.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining(["listAlertRules", "upsertAlertRule", "probeAlertDelivery"])
    );
    expect(expanded.tasks?.map((task) => task.key)).toEqual(
      expect.arrayContaining(["probeAlertDeliveryTask"])
    );
    expect(expanded.artifacts?.map((artifact) => artifact.key)).toEqual(
      expect.arrayContaining(["alertDeliveryReport"])
    );
  });

  it("builds single-resource durable packs through the public pack DSL", () => {
    const monitoringPack = createDurableEntityPack({
      key: "monitoring",
      title: "Monitoring Pack",
      dependsOn: ["tenant"],
      entity: {
        name: "Monitor",
        fields: {
          name: {
            type: "string",
            required: true
          }
        }
      },
      write: {
        input: {
          name: {
            type: "string",
            required: true
          }
        }
      },
      execute: {
        artifactKind: "report"
      }
    });

    const expanded = applyAppGraphPacks(
      {
        version: 1,
        domain: {
          key: "operations",
          title: "Monitoring Hub"
        },
        packs: [
          {
            key: "monitoring",
            options: {
              entityName: "Health Signal",
              entityPlural: "Health Signals",
              resourceKey: "healthSignal",
              executeCapabilityKey: "probeHealthSignal",
              artifactKey: "healthSignalReport"
            }
          }
        ],
        resources: [],
        capabilities: [],
        views: []
      },
      [...listBuiltinGraphPacks(), monitoringPack]
    );

    expect(expanded.packs?.map((pack) => pack.key)).toEqual(["auth", "tenant", "monitoring"]);
    expect(expanded.resources.map((resource) => resource.key)).toEqual(
      expect.arrayContaining(["healthSignal"])
    );
    expect(expanded.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining(["listHealthSignals", "upsertHealthSignal", "probeHealthSignal"])
    );
    expect(
      expanded.capabilities.find((capability) => capability.key === "probeHealthSignal")?.input
    ).toEqual({
      healthSignalId: {
        type: "string",
        required: true
      }
    });
    expect(expanded.tasks?.map((task) => task.key)).toEqual(
      expect.arrayContaining(["probeHealthSignalTask"])
    );
    expect(expanded.artifacts?.map((artifact) => artifact.key)).toEqual(
      expect.arrayContaining(["healthSignalReport"])
    );
  });

  it("builds linked multi-resource packs through the public pack DSL", () => {
    const dispatchPack = createLinkedEntityPack({
      key: "dispatch",
      title: "Dispatch Pack",
      dependsOn: ["tenant"],
      primary: {
        name: "Shipment Batch",
        plural: "Shipment Batches",
        resourceKey: "shipmentBatch",
        fields: {
          name: {
            type: "string",
            required: true
          }
        }
      },
      secondary: {
        name: "Delivery Run",
        resourceKey: "deliveryRun",
        fields: (names) => ({
          [`${names.primaryResourceKey}Id`]: {
            type: "string",
            required: true
          },
          status: {
            type: "string",
            required: true
          }
        })
      },
      primaryWrite: {
        input: {
          name: {
            type: "string",
            required: true
          }
        }
      },
      secondaryExecute: {
        artifactKind: "record"
      }
    });

    const expanded = applyAppGraphPacks(
      {
        version: 1,
        domain: {
          key: "operations",
          title: "Dispatch Hub"
        },
        packs: [
          {
            key: "dispatch",
            options: {
              secondaryExecuteCapabilityKey: "dispatchDeliveryRun"
            }
          }
        ],
        resources: [],
        capabilities: [],
        views: []
      },
      [...listBuiltinGraphPacks(), dispatchPack]
    );

    expect(expanded.packs?.map((pack) => pack.key)).toEqual(["auth", "tenant", "dispatch"]);
    expect(expanded.resources.map((resource) => resource.key)).toEqual(
      expect.arrayContaining(["shipmentBatch", "deliveryRun"])
    );
    expect(expanded.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining([
        "listShipmentBatches",
        "upsertShipmentBatch",
        "listDeliveryRuns",
        "dispatchDeliveryRun"
      ])
    );
    expect(
      expanded.capabilities.find((capability) => capability.key === "dispatchDeliveryRun")?.input
    ).toEqual({
      deliveryRunId: {
        type: "string",
        required: true
      }
    });
    expect(expanded.tasks?.map((task) => task.key)).toEqual(
      expect.arrayContaining(["dispatchDeliveryRunTask"])
    );
    expect(expanded.artifacts?.map((artifact) => artifact.key)).toEqual(
      expect.arrayContaining(["deliveryRunArtifact"])
    );
  });

  it("expands the workflow pack into durable tasks, approval policies, and artifacts", () => {
    const expanded = applyBuiltinAppGraphPacks(workflowPackedOperationsAppGraph);

    expect(expanded.packs?.map((pack) => pack.key)).toEqual(["auth", "tenant", "workflow"]);
    expect(expanded.resources.map((resource) => resource.key)).toEqual(
      expect.arrayContaining(["changeRequest", "workspace", "membership", "user"])
    );
    expect(expanded.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining([
        "listChangeRequests",
        "submitChangeRequest",
        "processChangeRequest"
      ])
    );
    expect(expanded.tasks?.map((task) => task.key)).toEqual(
      expect.arrayContaining(["processChangeRequestTask"])
    );
    expect(expanded.artifacts?.map((artifact) => artifact.key)).toEqual(
      expect.arrayContaining(["changeRequestReport"])
    );
    expect(expanded.policies?.map((policy) => policy.key)).toEqual(
      expect.arrayContaining(["workflowApprovalRequired"])
    );
    expect(expanded.views?.map((view) => view.key)).toEqual(
      expect.arrayContaining(["changeRequestList", "changeRequestForm", "changeRequestDetail"])
    );
  });

  it("expands the connector pack into external sync capabilities and artifacts", () => {
    const expanded = applyBuiltinAppGraphPacks(connectorPackedOperationsAppGraph);

    expect(expanded.packs?.map((pack) => pack.key)).toEqual(["auth", "tenant", "connector"]);
    expect(expanded.resources.map((resource) => resource.key)).toEqual(
      expect.arrayContaining(["dataSource", "organization", "membership", "user"])
    );
    expect(expanded.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining([
        "listDataSources",
        "configureDataSource",
        "syncDataSource"
      ])
    );
    expect(expanded.tasks?.map((task) => task.key)).toEqual(
      expect.arrayContaining(["syncDataSourceTask"])
    );
    expect(expanded.artifacts?.map((artifact) => artifact.key)).toEqual(
      expect.arrayContaining(["dataSourceSyncReport"])
    );
    expect(expanded.policies?.map((policy) => policy.key)).toEqual(
      expect.arrayContaining(["connectorSyncApprovalRequired"])
    );
    expect(expanded.views?.map((view) => view.key)).toEqual(
      expect.arrayContaining(["dataSourceList", "dataSourceForm", "dataSourceDetail"])
    );
  });

  it("expands the billing pack into subscriptions, invoices, and collection receipts", () => {
    const expanded = applyBuiltinAppGraphPacks(billingPackedOperationsAppGraph);

    expect(expanded.packs?.map((pack) => pack.key)).toEqual(["auth", "tenant", "billing"]);
    expect(expanded.resources.map((resource) => resource.key)).toEqual(
      expect.arrayContaining([
        "serviceSubscription",
        "billingInvoice",
        "workspace",
        "membership",
        "user"
      ])
    );
    expect(expanded.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining([
        "listServiceSubscriptions",
        "provisionServiceSubscription",
        "listBillingInvoices",
        "collectBillingInvoicePayment"
      ])
    );
    expect(expanded.tasks?.map((task) => task.key)).toEqual(
      expect.arrayContaining(["collectBillingInvoicePaymentTask"])
    );
    expect(expanded.artifacts?.map((artifact) => artifact.key)).toEqual(
      expect.arrayContaining(["billingInvoiceCollectionReceipt"])
    );
    expect(expanded.policies?.map((policy) => policy.key)).toEqual(
      expect.arrayContaining(["billingCollectionApprovalRequired"])
    );
    expect(expanded.views?.map((view) => view.key)).toEqual(
      expect.arrayContaining([
        "serviceSubscriptionList",
        "serviceSubscriptionForm",
        "billingInvoiceList",
        "billingInvoiceDetail"
      ])
    );
  });

  it("expands the commerce pack into catalog, order, and fulfillment primitives", () => {
    const expanded = applyBuiltinAppGraphPacks(commercePackedOperationsAppGraph);

    expect(expanded.packs?.map((pack) => pack.key)).toEqual(["auth", "tenant", "commerce"]);
    expect(expanded.resources.map((resource) => resource.key)).toEqual(
      expect.arrayContaining(["catalogItem", "salesOrder", "workspace", "membership", "user"])
    );
    expect(expanded.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining([
        "listCatalogItems",
        "upsertCatalogItem",
        "listSalesOrders",
        "fulfillSalesOrder"
      ])
    );
    expect(expanded.tasks?.map((task) => task.key)).toEqual(
      expect.arrayContaining(["fulfillSalesOrderTask"])
    );
    expect(expanded.artifacts?.map((artifact) => artifact.key)).toEqual(
      expect.arrayContaining(["salesOrderFulfillmentReceipt"])
    );
    expect(expanded.policies?.map((policy) => policy.key)).toEqual(
      expect.arrayContaining(["commerceFulfillmentApprovalRequired"])
    );
    expect(expanded.views?.map((view) => view.key)).toEqual(
      expect.arrayContaining([
        "catalogItemList",
        "catalogItemForm",
        "salesOrderList",
        "salesOrderDetail"
      ])
    );
  });

  it("expands the revenue ops pack into starter primitives plus a reconciliation layer", () => {
    const expanded = applyBuiltinAppGraphPacks(revenueOpsPackedOperationsAppGraph);

    expect(expanded.packs?.map((pack) => pack.key)).toEqual([
      "auth",
      "tenant",
      "commerce",
      "billing",
      "connector",
      "revenueOps"
    ]);
    expect(expanded.resources.map((resource) => resource.key)).toEqual(
      expect.arrayContaining([
        "catalogItem",
        "order",
        "subscription",
        "invoice",
        "connector",
        "revenueOpsException"
      ])
    );
    expect(expanded.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining([
        "listCatalogItems",
        "listOrders",
        "listSubscriptions",
        "listConnectors",
        "reconcileRevenueOps"
      ])
    );
    expect(expanded.tasks?.map((task) => task.key)).toEqual(
      expect.arrayContaining(["reconcileRevenueOpsTask"])
    );
    expect(expanded.artifacts?.map((artifact) => artifact.key)).toEqual(
      expect.arrayContaining(["revenueOpsDigest"])
    );
    expect(expanded.policies?.map((policy) => policy.key)).toEqual(
      expect.arrayContaining(["revenueOpsApprovalRequired"])
    );
    expect(expanded.views?.map((view) => view.key)).toEqual(
      expect.arrayContaining([
        "revenueOpsExceptionList",
        "revenueOpsExceptionForm",
        "revenueOpsExceptionDetail"
      ])
    );
  });

  it("rejects conflicting pack contributions against existing graph keys", () => {
    const conflictingGraph: AppGraph = {
      ...packedOperationsAppGraph,
      resources: [
        ...packedOperationsAppGraph.resources,
        {
          key: "user",
          title: "Conflicting User",
          fields: {
            email: {
              type: "string",
              required: true
            }
          }
        }
      ]
    };

    expect(() => applyBuiltinAppGraphPacks(conflictingGraph)).toThrowError(
      'Pack "auth" cannot contribute resource "user" because the key already exists.'
    );
  });

  it("rejects duplicate or unknown pack selections", () => {
    expect(() =>
      applyBuiltinAppGraphPacks({
        ...packedOperationsAppGraph,
        packs: [
          {
            key: "tenant"
          },
          {
            key: "tenant"
          }
        ]
      })
    ).toThrowError('Duplicate pack selection "tenant".');

    expect(() =>
      applyAppGraphPacks(
        {
          ...packedOperationsAppGraph,
          packs: [
            {
              key: "missing"
            }
          ]
        },
        listBuiltinGraphPacks()
      )
    ).toThrowError('Unknown pack "missing".');
  });
});

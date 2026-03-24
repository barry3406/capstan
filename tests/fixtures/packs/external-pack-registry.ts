import { createDurableEntityPack } from "../../../packages/packs-core/src/index.ts";

const alertsPack = createDurableEntityPack({
  key: "alerts",
  title: "Alerts Pack",
  description: "Adds alert rules, durable probe tasks, and delivery reports.",
  dependsOn: ["tenant"],
  entity: {
    name: "Alert Rule",
    resourceKey: "alertRule",
    description: "A notification rule that can be probed through a durable delivery task.",
    fields: {
      name: {
        type: "string",
        required: true
      },
      channel: {
        type: "string",
        required: true
      },
      status: {
        type: "string",
        required: true,
        constraints: {
          enum: ["draft", "active", "muted"]
        }
      }
    }
  },
  list: {
    capabilityKey: "listAlertRules",
    title: "List Alert Rules",
    viewTitle: "Alert Rules"
  },
  write: {
    capabilityKey: "upsertAlertRule",
    title: "Upsert Alert Rule",
    input: {
      name: {
        type: "string",
        required: true
      },
      channel: {
        type: "string",
        required: true
      }
    },
    viewTitle: "Alert Rule Form"
  },
  execute: {
    capabilityKey: "probeAlertDelivery",
    title: "Probe Alert Delivery",
    taskKey: "probeAlertDeliveryTask",
    taskTitle: "Probe Alert Delivery Task",
    taskDescription: "Durably probes one alert rule delivery path and records the result.",
    artifactKey: "alertDeliveryReport",
    artifactTitle: "Alert Delivery Report",
    artifactDescription: "A delivery report produced after one alert rule probe completes.",
    artifactKind: "report",
    approvalPolicyKey: "alertProbeApprovalRequired",
    approvalTitle: "Alert Probe Approval Required",
    approvalDescription: "Requires approval before one alert delivery probe may continue.",
    input: {
      alertRuleId: {
        type: "string",
        required: true
      }
    },
    viewTitle: "Alert Rule Detail"
  }
});

export const externalGraphPacks = [alertsPack];
export const packRegistry = externalGraphPacks;
export default externalGraphPacks;

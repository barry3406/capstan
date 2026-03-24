import type { AppGraph } from "../../../packages/app-graph/src/index.ts";
import { createDurableEntityPack } from "../../../packages/packs-core/src/index.ts";

export const modulePackRegistry = [
  createDurableEntityPack({
    key: "signals",
    title: "Signals Pack",
    description: "Adds signal definitions, durable probes, and generated reports.",
    dependsOn: ["tenant"],
    entity: {
      name: "Signal",
      resourceKey: "signal",
      description: "A monitored operational signal that can be probed durably.",
      fields: {
        name: {
          type: "string",
          required: true
        },
        source: {
          type: "string",
          required: true
        },
        status: {
          type: "string",
          required: true,
          constraints: {
            enum: ["healthy", "warning", "critical"]
          }
        }
      }
    },
    list: {
      capabilityKey: "listSignals",
      title: "List Signals",
      viewTitle: "Signals"
    },
    write: {
      capabilityKey: "upsertSignal",
      title: "Upsert Signal",
      input: {
        name: {
          type: "string",
          required: true
        },
        source: {
          type: "string",
          required: true
        }
      },
      viewTitle: "Signal Form"
    },
    execute: {
      capabilityKey: "probeSignal",
      title: "Probe Signal",
      taskKey: "probeSignalTask",
      taskTitle: "Probe Signal Task",
      taskDescription: "Durably probes one signal and records the result.",
      artifactKey: "signalReport",
      artifactTitle: "Signal Report",
      artifactDescription: "A report produced after one signal probe completes.",
      artifactKind: "report",
      approvalPolicyKey: "signalProbeApprovalRequired",
      approvalTitle: "Signal Probe Approval Required",
      approvalDescription: "Requires approval before a signal probe may continue.",
      input: {
        signalId: {
          type: "string",
          required: true
        }
      },
      viewTitle: "Signal Detail"
    }
  })
];

export const packRegistry = modulePackRegistry;

export const appGraph = {
  version: 1,
  domain: {
    key: "operations",
    title: "Operations Module Pack Hub",
    description: "A graph module that exports its own inline pack registry."
  },
  packs: [
    {
      key: "signals"
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

export default appGraph;

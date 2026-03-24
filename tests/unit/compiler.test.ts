import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AppGraph } from "../../packages/app-graph/src/index.ts";
import { compileAppGraph } from "../../packages/compiler/src/index.ts";
import { basicAppGraph } from "../fixtures/graphs/basic-app-graph.ts";
import { packedOperationsAppGraph } from "../fixtures/graphs/packed-operations-app-graph.ts";

describe("compileAppGraph", () => {
  it("projects a graph into a deterministic file plan", () => {
    const files = compileAppGraph(basicAppGraph);
    const paths = files.map((file) => file.path);

    expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)));
    expect(paths).toEqual(
      expect.arrayContaining([
        ".capstan/graph-metadata.json",
        "AGENTS.md",
        "README.md",
        "agent-surface.json",
        "capstan.app.json",
        "capstan.migrations.json",
        "capstan.release-env.json",
        "capstan.release.json",
        "human-surface.html",
        "package.json",
        "src/agent-surface/http.ts",
        "src/agent-surface/index.ts",
        "src/agent-surface/mcp.ts",
        "src/agent-surface/a2a.ts",
        "src/agent-surface/transport.ts",
        "src/assertions/index.ts",
        "src/control-plane/index.ts",
        "src/capabilities/index.ts",
        "src/capabilities/generated/list-tickets.ts",
        "src/human-surface/index.ts",
        "src/release/index.ts",
        "src/resources/ticket.ts",
        "src/views/generated/ticket-list.ts"
      ])
    );

    const packageFile = files.find((file) => file.path === "package.json");
    const controlPlane = files.find((file) => file.path === "src/control-plane/index.ts");
    const metadataFile = files.find((file) => file.path === ".capstan/graph-metadata.json");
    const agentsGuideFile = files.find((file) => file.path === "AGENTS.md");
    const agentSurfaceFile = files.find((file) => file.path === "agent-surface.json");
    const releaseContractFile = files.find((file) => file.path === "capstan.release.json");
    const releaseEnvironmentSnapshotFile = files.find(
      (file) => file.path === "capstan.release-env.json"
    );
    const releaseMigrationPlanFile = files.find(
      (file) => file.path === "capstan.migrations.json"
    );
    const agentSurfaceModule = files.find((file) => file.path === "src/agent-surface/index.ts");
    const agentTransportModule = files.find(
      (file) => file.path === "src/agent-surface/transport.ts"
    );
    const agentHttpModule = files.find((file) => file.path === "src/agent-surface/http.ts");
    const agentMcpModule = files.find((file) => file.path === "src/agent-surface/mcp.ts");
    const agentA2aModule = files.find((file) => file.path === "src/agent-surface/a2a.ts");
    const assertionsModule = files.find((file) => file.path === "src/assertions/index.ts");
    const humanSurfaceFile = files.find((file) => file.path === "human-surface.html");
    const humanSurfaceModule = files.find((file) => file.path === "src/human-surface/index.ts");
    const releaseModule = files.find((file) => file.path === "src/release/index.ts");

    expect(packageFile?.contents).toContain('"name": "operations-app"');
    expect(agentsGuideFile?.contents).toContain("# Capstan Agent Guide");
    expect(agentsGuideFile?.contents).toContain("## Safe To Edit");
    expect(agentsGuideFile?.contents).toContain("## Framework-Owned Paths");
    expect(agentsGuideFile?.contents).toContain("## Official Starter Prompt");
    expect(agentsGuideFile?.contents).toContain("Start from the upstream Capstan brief or App Graph");
    expect(agentsGuideFile?.contents).toContain("src/capabilities/*.ts");
    expect(agentsGuideFile?.contents).toContain("npx capstan verify . --json");
    expect(controlPlane?.contents).toContain("export const controlPlane");
    expect(controlPlane?.contents).toContain('domain: "operations"');
    expect(controlPlane?.contents).toContain("export function resource");
    expect(controlPlane?.contents).toContain("export function listAttentionItems");
    expect(controlPlane?.contents).toContain("export function listAttentionQueues");
    expect(controlPlane?.contents).toContain("export async function executeAction");
    expect(controlPlane?.contents).toContain("export async function startTaskAction");
    expect(controlPlane?.contents).toContain("export function listWorkflowRuns");
    expect(controlPlane?.contents).toContain("export function getWorkflowRun");
    expect(controlPlane?.contents).toContain("export async function advanceWorkflowRun");
    expect(controlPlane?.contents).toContain("WorkflowAttentionSummary");
    expect(controlPlane?.contents).toContain("workflowAttention");
    expect(controlPlane?.contents).toContain("export async function execute");
    expect(controlPlane?.contents).toContain("export function task");
    expect(controlPlane?.contents).toContain("export function artifact");
    expect(controlPlane?.contents).toContain("export async function startTask");
    expect(controlPlane?.contents).toContain("export function getTaskRun");
    expect(controlPlane?.contents).toContain("export function listTaskRuns");
    expect(controlPlane?.contents).toContain("export function getArtifactRecord");
    expect(controlPlane?.contents).toContain("export function listArtifactRecords");
    expect(controlPlane?.contents).toContain("ArtifactRecord");
    expect(controlPlane?.contents).toContain('operation: "executeAction"');
    expect(controlPlane?.contents).toContain('kind: "workflow_run"');
    expect(controlPlane?.contents).toContain('operation: "startTaskAction"');
    expect(controlPlane?.contents).toContain('operation: "listWorkflowRuns"');
    expect(controlPlane?.contents).toContain('operation: "getWorkflowRun"');
    expect(controlPlane?.contents).toContain('operation: "advanceWorkflowRun"');
    expect(controlPlane?.contents).toContain("contextSchema");
    expect(controlPlane?.contents).toContain("taskStart");
    expect(controlPlane?.contents).toContain("ResourceRouteActionWorkflow");
    expect(controlPlane?.contents).toContain("starter_run_recipe");
    expect(controlPlane?.contents).toContain("controlPlane:");
    expect(controlPlane?.contents).toContain("resolve_block");
    expect(controlPlane?.contents).toContain("harness:start");
    expect(controlPlane?.contents).toContain("_capstanRoute");
    expect(controlPlane?.contents).toContain("_capstanRelation");
    expect(controlPlane?.contents).toContain("getTask");
    expect(controlPlane?.contents).toContain("getArtifact");
    expect(metadataFile?.contents).toContain('"normalizedVersion": 1');
    expect(agentSurfaceFile?.contents).toContain('"entrypoints"');
    expect(agentSurfaceFile?.contents).toContain('"resources"');
    expect(agentSurfaceFile?.contents).toContain('"resource"');
    expect(agentSurfaceFile?.contents).toContain('"executeAction"');
    expect(agentSurfaceFile?.contents).toContain('"startTaskAction"');
    expect(agentSurfaceFile?.contents).toContain('"execution"');
    expect(agentSurfaceFile?.contents).toContain('"transport"');
    expect(agentSurfaceFile?.contents).toContain('"http_rpc"');
    expect(agentSurfaceFile?.contents).toContain('"mcp"');
    expect(agentSurfaceFile?.contents).toContain('"a2a"');
    expect(agentSurfaceFile?.contents).toContain('"auth"');
    expect(agentSurfaceFile?.contents).toContain('"approval_required"');
    expect(agentSurfaceFile?.contents).toContain('"search"');
    expect(agentSurfaceModule?.contents).toContain("export const agentSurface");
    expect(agentSurfaceModule?.contents).toContain("renderAgentSurfaceManifest");
    expect(agentTransportModule?.contents).toContain("handleAgentSurfaceRequest");
    expect(agentTransportModule?.contents).toContain("createAgentSurfaceTransport");
    expect(agentTransportModule?.contents).toContain("AgentSurfaceAuthorizationContext");
    expect(agentTransportModule?.contents).toContain('operation: "manifest"');
    expect(agentTransportModule?.contents).toContain('operation: "resource"');
    expect(agentTransportModule?.contents).toContain('operation: "listAttentionItems"');
    expect(agentTransportModule?.contents).toContain('operation: "listAttentionQueues"');
    expect(agentTransportModule?.contents).toContain('operation: "executeAction"');
    expect(agentTransportModule?.contents).toContain('operation: "startTaskAction"');
    expect(agentTransportModule?.contents).toContain('operation: "listWorkflowRuns"');
    expect(agentTransportModule?.contents).toContain('operation: "getWorkflowRun"');
    expect(agentTransportModule?.contents).toContain('operation: "advanceWorkflowRun"');
    expect(agentHttpModule?.contents).toContain("handleAgentSurfaceHttpRequest");
    expect(agentHttpModule?.contents).toContain("createAgentSurfaceHttpTransport");
    expect(agentHttpModule?.contents).toContain('path === "/rpc"');
    expect(agentHttpModule?.contents).toContain('path === "/attention-items"');
    expect(agentHttpModule?.contents).toContain('path === "/attention-queues"');
    expect(agentHttpModule?.contents).toContain('segments[0] === "routes"');
    expect(agentHttpModule?.contents).toContain('segments[0] === "resources"');
    expect(agentHttpModule?.contents).toContain('"x-capstan-operation"');
    expect(agentMcpModule?.contents).toContain("listAgentSurfaceMcpTools");
    expect(agentMcpModule?.contents).toContain("createAgentSurfaceMcpAdapter");
    expect(agentMcpModule?.contents).toContain("callAgentSurfaceMcpTool");
    expect(agentMcpModule?.contents).toContain('"capstan_resource"');
    expect(agentMcpModule?.contents).toContain('"capstan_list_attention_items"');
    expect(agentMcpModule?.contents).toContain('"capstan_list_attention_queues"');
    expect(agentMcpModule?.contents).toContain('"capstan_execute_action"');
    expect(agentMcpModule?.contents).toContain('"capstan_start_task_action"');
    expect(agentMcpModule?.contents).toContain('"capstan_list_workflow_runs"');
    expect(agentMcpModule?.contents).toContain('"capstan_get_workflow_run"');
    expect(agentMcpModule?.contents).toContain('"capstan_advance_workflow_run"');
    expect(agentMcpModule?.contents).toContain('"capstan_start_task"');
    expect(agentA2aModule?.contents).toContain("createAgentSurfaceA2aAdapter");
    expect(agentA2aModule?.contents).toContain("getAgentSurfaceA2aCard");
    expect(agentA2aModule?.contents).toContain("sendAgentSurfaceA2aMessage");
    expect(agentA2aModule?.contents).toContain('protocol: "a2a"');
    expect(agentA2aModule?.contents).toContain('operation: "listAttentionItems"');
    expect(agentA2aModule?.contents).toContain('operation: "listAttentionQueues"');
    expect(agentA2aModule?.contents).toContain('resource:');
    expect(assertionsModule?.contents).toContain("export const appAssertions");
    expect(assertionsModule?.contents).toContain("runAppAssertions");
    expect(assertionsModule?.contents).toContain("customAssertions");
    expect(releaseContractFile?.contents).toContain('"preview"');
    expect(releaseContractFile?.contents).toContain('"healthChecks"');
    expect(releaseContractFile?.contents).toContain('"inputs"');
    expect(releaseContractFile?.contents).toContain('"verify_pass"');
    expect(releaseEnvironmentSnapshotFile?.contents).toContain('"environments"');
    expect(releaseEnvironmentSnapshotFile?.contents).toContain('"preview"');
    expect(releaseMigrationPlanFile?.contents).toContain('"generatedBy": "capstan"');
    expect(releaseMigrationPlanFile?.contents).toContain('"status": "safe"');
    expect(releaseModule?.contents).toContain("export const releaseContract");
    expect(releaseModule?.contents).toContain("export const releaseEnvironmentSnapshot");
    expect(releaseModule?.contents).toContain("export const releaseMigrationPlan");
    expect(releaseModule?.contents).toContain("renderReleaseContract");
    expect(releaseModule?.contents).toContain("renderReleaseEnvironmentSnapshot");
    expect(releaseModule?.contents).toContain("renderReleaseMigrationPlan");
    expect(humanSurfaceFile?.contents).toContain("Capstan Human Surface");
    expect(humanSurfaceFile?.contents).toContain("Operator Console");
    expect(humanSurfaceFile?.contents).toContain("Ticket Detail");
    expect(humanSurfaceFile?.contents).toContain('data-route-result-output="ticketList"');
    expect(humanSurfaceFile?.contents).toContain('data-route-result-state="idle"');
    expect(humanSurfaceFile?.contents).toContain('import { mountHumanSurfaceBrowser } from "./dist/human-surface/index.js"');
    expect(humanSurfaceModule?.contents).toContain(
      'import { execute, listAttentionItems, listAttentionQueues } from "../control-plane/index.js";'
    );
    expect(humanSurfaceModule?.contents).toContain("export function mountHumanSurfaceBrowser");
    expect(humanSurfaceModule?.contents).toContain("resourceRecords");
    expect(humanSurfaceModule?.contents).toContain("data-route-table-body");
    expect(humanSurfaceModule?.contents).toContain("data-console-attention-output");
    expect(humanSurfaceModule?.contents).toContain("data-console-attention-inbox");
    expect(humanSurfaceModule?.contents).toContain("data-console-attention-preset-inbox");
    expect(humanSurfaceModule?.contents).toContain("data-console-attention-preset-queue");
    expect(humanSurfaceModule?.contents).toContain("data-console-supervision-refresh");
    expect(humanSurfaceModule?.contents).toContain("data-console-supervision-queue-status");
    expect(humanSurfaceModule?.contents).toContain("data-console-supervision-history-resume");
    expect(humanSurfaceModule?.contents).toContain("data-console-supervision-clear-history");
    expect(humanSurfaceModule?.contents).toContain("data-route-attention-output");
    expect(humanSurfaceModule?.contents).toContain("data-route-attention-handoff");
    expect(humanSurfaceModule?.contents).toContain("data-route-attention-handoff-open");
    expect(humanSurfaceModule?.contents).toContain("data-attention-queue");
    expect(humanSurfaceModule?.contents).toContain("renderAttentionProjection");
    expect(humanSurfaceModule?.contents).toContain("renderConsoleAttentionProjection");
    expect(humanSurfaceModule?.contents).toContain("renderAttentionHandoffControls");
    expect(humanSurfaceModule?.contents).toContain("supervisionWorkspace");
    expect(humanSurfaceModule?.contents).toContain("supervisionWorkspaceHistory");
    expect(humanSurfaceModule?.contents).toContain("supervisionWorkspaceSlots");
    expect(humanSurfaceModule?.contents).toContain("supervisionWorkspaceSlotSummaries");
    expect(humanSurfaceModule?.contents).toContain("seenAttentionIds");
    expect(humanSurfaceModule?.contents).toContain("newOpenCount");
    expect(humanSurfaceModule?.contents).toContain("autoSlotKey");
    expect(humanSurfaceModule?.contents).toContain('mode?: HumanSurfaceSupervisionWorkspaceSlotMode');
    expect(humanSurfaceModule?.contents).toContain("supervisionWorkspaceStorageKey");
    expect(humanSurfaceModule?.contents).toContain("restoreSupervisionWorkspaceState");
    expect(humanSurfaceModule?.contents).toContain("persistSupervisionWorkspaceState");
    expect(humanSurfaceModule?.contents).toContain("autoSaveAttentionPresetToSlot");
    expect(humanSurfaceModule?.contents).toContain("refreshSupervisionWorkspaceSlotSummaries");
    expect(humanSurfaceModule?.contents).toContain("renderSupervisionWorkspaceSlotSummaries");
    expect(humanSurfaceModule?.contents).toContain("renderSupervisionWorkspaceSlots");
    expect(humanSurfaceModule?.contents).toContain("data-console-supervision-slot-open");
    expect(humanSurfaceModule?.contents).toContain("data-console-supervision-slot-summary-open");
    expect(humanSurfaceModule?.contents).toContain("data-console-supervision-slot-summary-queue");
    expect(humanSurfaceModule?.contents).toContain("data-console-supervision-slot-save");
    expect(humanSurfaceModule?.contents).toContain("data-console-supervision-slot-clear");
    expect(humanSurfaceModule?.contents).toContain("version: 4");
    expect(humanSurfaceModule?.contents).toContain("workspaceSlot");
    expect(humanSurfaceModule?.contents).toContain("supervisionWorkspaceSlotSummaries:");
    expect(humanSurfaceModule?.contents).toContain("renderSupervisionWorkspaceHistory");
    expect(humanSurfaceModule?.contents).toContain("attentionHandoffs");
    expect(humanSurfaceModule?.contents).toContain("activeAttentionPreset");
    expect(humanSurfaceModule?.contents).toContain("parent?: HumanSurfaceAttentionHandoff");
    expect(humanSurfaceModule?.contents).toContain("console.attention.preset.queue");
    expect(humanSurfaceModule?.contents).toContain('"redacted"');
  });

  it("produces a deterministic generated file snapshot", () => {
    const files = compileAppGraph(basicAppGraph);
    const snapshot = files.map((file) => ({
      path: file.path,
      sha256: createHash("sha256").update(file.contents).digest("hex")
    }));

    expect(snapshot).toMatchSnapshot();
  });

  it("respects an explicit app name when generating the package manifest", () => {
    const files = compileAppGraph(basicAppGraph, {
      appName: "Support Hub"
    });
    const packageFile = files.find((file) => file.path === "package.json");

    expect(packageFile?.contents).toContain('"name": "support-hub"');
  });

  it("refuses to compile invalid graphs", () => {
    const invalidGraph: AppGraph = {
      ...basicAppGraph,
      capabilities: []
    };

    expect(() => compileAppGraph(invalidGraph)).toThrowError(
      "Cannot compile an invalid App Graph"
    );
  });

  it("expands built-in packs before generating the application skeleton", () => {
    const files = compileAppGraph(packedOperationsAppGraph);
    const appGraphJson = files.find((file) => file.path === "capstan.app.json");
    const readme = files.find((file) => file.path === "README.md");

    expect(appGraphJson?.contents).toContain('"auth"');
    expect(appGraphJson?.contents).toContain('"tenant"');
    expect(appGraphJson?.contents).toContain('"workspace"');
    expect(appGraphJson?.contents).toContain('"inviteUser"');
    expect(readme?.contents).toContain("## Included Packs");
    expect(readme?.contents).toContain("`tenant`");
  });

  it("compiles legacy graphs through the normalized output path", () => {
    const legacyGraph: AppGraph = {
      domain: {
        key: " operations ",
        title: " Operations Console "
      },
      resources: [
        {
          key: "ticket",
          title: "Ticket",
          fields: {
            status: {
              type: "string",
              required: true
            },
            title: {
              type: "string",
              required: true
            }
          }
        }
      ],
      capabilities: [
        {
          key: "listTickets",
          title: "List Tickets",
          mode: "read",
          resources: ["ticket"]
        }
      ]
    };

    const files = compileAppGraph(legacyGraph);
    const appFile = files.find((file) => file.path === "capstan.app.json");
    const metadataFile = files.find((file) => file.path === ".capstan/graph-metadata.json");

    expect(appFile?.contents).toContain('"version": 1');
    expect(metadataFile?.contents).toContain('"sourceVersion": 0');
    expect(metadataFile?.contents).toContain('"upgraded": true');
  });
});

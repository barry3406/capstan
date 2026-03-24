import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { repoRoot } from "../helpers/paths.ts";
import { runCapstanCli, runTypeScriptBuild } from "../helpers/run-cli.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("packed generated app", () => {
  it("exposes pack-provided capabilities and views through the generated app surfaces", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-pack-e2e-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/packed-operations-app-graph.json",
      outputDir
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    expect(buildResult.exitCode).toBe(0);

    const runtimeModule = (await import(
      `${pathToFileURL(join(outputDir, "dist/index.js")).href}?t=${Date.now()}`
    )) as {
      renderAgentSurfaceManifest: () => string;
      renderHumanSurfaceDocument: () => string;
      controlPlane: {
        search(query?: string): {
          capabilities: Array<{ key: string }>;
          tasks: Array<{ key: string }>;
          artifacts: Array<{ key: string }>;
        };
      };
    };

    const manifest = runtimeModule.renderAgentSurfaceManifest();
    const humanSurface = runtimeModule.renderHumanSurfaceDocument();
    const searchResult = runtimeModule.controlPlane.search();

    expect(manifest).toContain('"listWorkspaces"');
    expect(manifest).toContain('"inviteUser"');
    expect(humanSurface).toContain("Workspaces");
    expect(humanSurface).toContain("Invite User");
    expect(searchResult.capabilities.map((capability) => capability.key)).toEqual(
      expect.arrayContaining(["listProjects", "listUsers", "inviteUser", "listWorkspaces"])
    );
  }, 20_000);

  it("runs a workflow-pack task and produces its artifact through the generated runtime", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-pack-workflow-e2e-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/workflow-packed-operations-app-graph.json",
      outputDir
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/process-change-request.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { processChangeRequestCapability } from "./generated/process-change-request.js";',
        "",
        "export async function processChangeRequest(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: processChangeRequestCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      approved: true,",
        "      artifacts: {",
        "        changeRequestReport: {",
        '          reportId: "workflow-pack-001",',
        '          changeRequestId: String(input.changeRequestId ?? "CR-001")',
        "        }",
        "      }",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    expect(buildResult.exitCode).toBe(0);

    const runtimeModule = (await import(
      `${pathToFileURL(join(outputDir, "dist/index.js")).href}?t=${Date.now()}`
    )) as {
      controlPlane: {
        startTask(key: string, input?: Record<string, unknown>): Promise<{
          id: string;
          status: string;
          artifacts: Array<{ id: string; artifactKey: string; payload: { reportId: string } }>;
        }>;
        listTaskRuns(taskKey?: string): Array<{ id: string; taskKey: string }>;
        listArtifactRecords(artifactKey?: string): Array<{
          id: string;
          artifactKey: string;
          payload: { reportId: string };
        }>;
      };
      renderAgentSurfaceManifest: () => string;
    };

    const taskRun = await runtimeModule.controlPlane.startTask("processChangeRequestTask", {
      changeRequestId: "CR-9001"
    });
    expect(taskRun.status).toBe("completed");
    expect(taskRun.artifacts).toHaveLength(1);
    expect(taskRun.artifacts[0]?.payload.reportId).toBe("workflow-pack-001");

    const taskRuns = runtimeModule.controlPlane.listTaskRuns("processChangeRequestTask");
    expect(taskRuns).toHaveLength(1);

    const artifactRecords = runtimeModule.controlPlane.listArtifactRecords("changeRequestReport");
    expect(artifactRecords).toHaveLength(1);
    expect(artifactRecords[0]?.payload.reportId).toBe("workflow-pack-001");
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"processChangeRequestTask"');
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"changeRequestReport"');
  }, 20_000);

  it("runs a connector-pack sync task and produces its sync artifact through the generated runtime", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-pack-connector-e2e-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/connector-packed-operations-app-graph.json",
      outputDir
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/sync-data-source.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { syncDataSourceCapability } from "./generated/sync-data-source.js";',
        "",
        "export async function syncDataSource(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: syncDataSourceCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      synced: true,",
        "      artifacts: {",
        "        dataSourceSyncReport: {",
        '          reportId: "connector-pack-001",',
        '          dataSourceId: String(input.dataSourceId ?? "DS-001")',
        "        }",
        "      }",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    expect(buildResult.exitCode).toBe(0);

    const runtimeModule = (await import(
      `${pathToFileURL(join(outputDir, "dist/index.js")).href}?t=${Date.now()}`
    )) as {
      controlPlane: {
        startTask(key: string, input?: Record<string, unknown>): Promise<{
          id: string;
          status: string;
          artifacts: Array<{ id: string; artifactKey: string; payload: { reportId: string } }>;
        }>;
        listTaskRuns(taskKey?: string): Array<{ id: string; taskKey: string }>;
        listArtifactRecords(artifactKey?: string): Array<{
          id: string;
          artifactKey: string;
          payload: { reportId: string };
        }>;
      };
      renderAgentSurfaceManifest: () => string;
    };

    const taskRun = await runtimeModule.controlPlane.startTask("syncDataSourceTask", {
      dataSourceId: "DS-9001"
    });
    expect(taskRun.status).toBe("completed");
    expect(taskRun.artifacts).toHaveLength(1);
    expect(taskRun.artifacts[0]?.payload.reportId).toBe("connector-pack-001");

    const taskRuns = runtimeModule.controlPlane.listTaskRuns("syncDataSourceTask");
    expect(taskRuns).toHaveLength(1);

    const artifactRecords = runtimeModule.controlPlane.listArtifactRecords("dataSourceSyncReport");
    expect(artifactRecords).toHaveLength(1);
    expect(artifactRecords[0]?.payload.reportId).toBe("connector-pack-001");
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"syncDataSourceTask"');
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"dataSourceSyncReport"');
  }, 30_000);

  it("runs a billing-pack collection task and produces its receipt artifact through the generated runtime", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-pack-billing-e2e-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/billing-packed-operations-app-graph.json",
      outputDir
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/collect-billing-invoice-payment.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { collectBillingInvoicePaymentCapability } from "./generated/collect-billing-invoice-payment.js";',
        "",
        "export async function collectBillingInvoicePayment(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: collectBillingInvoicePaymentCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      collected: true,",
        "      artifacts: {",
        "        billingInvoiceCollectionReceipt: {",
        '          receiptId: "billing-pack-001",',
        '          billingInvoiceId: String(input.billingInvoiceId ?? "INV-001")',
        "        }",
        "      }",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    expect(buildResult.exitCode).toBe(0);

    const runtimeModule = (await import(
      `${pathToFileURL(join(outputDir, "dist/index.js")).href}?t=${Date.now()}`
    )) as {
      controlPlane: {
        startTask(key: string, input?: Record<string, unknown>): Promise<{
          id: string;
          status: string;
          artifacts: Array<{ id: string; artifactKey: string; payload: { receiptId: string } }>;
        }>;
        listTaskRuns(taskKey?: string): Array<{ id: string; taskKey: string }>;
        listArtifactRecords(artifactKey?: string): Array<{
          id: string;
          artifactKey: string;
          payload: { receiptId: string };
        }>;
      };
      renderAgentSurfaceManifest: () => string;
    };

    const taskRun = await runtimeModule.controlPlane.startTask("collectBillingInvoicePaymentTask", {
      billingInvoiceId: "INV-9001"
    });
    expect(taskRun.status).toBe("completed");
    expect(taskRun.artifacts).toHaveLength(1);
    expect(taskRun.artifacts[0]?.payload.receiptId).toBe("billing-pack-001");

    const taskRuns = runtimeModule.controlPlane.listTaskRuns("collectBillingInvoicePaymentTask");
    expect(taskRuns).toHaveLength(1);

    const artifactRecords = runtimeModule.controlPlane.listArtifactRecords(
      "billingInvoiceCollectionReceipt"
    );
    expect(artifactRecords).toHaveLength(1);
    expect(artifactRecords[0]?.payload.receiptId).toBe("billing-pack-001");
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain(
      '"collectBillingInvoicePaymentTask"'
    );
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain(
      '"billingInvoiceCollectionReceipt"'
    );
  }, 20_000);

  it("runs a commerce-pack fulfillment task and produces its fulfillment artifact through the generated runtime", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-pack-commerce-e2e-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/commerce-packed-operations-app-graph.json",
      outputDir
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/fulfill-sales-order.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { fulfillSalesOrderCapability } from "./generated/fulfill-sales-order.js";',
        "",
        "export async function fulfillSalesOrder(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: fulfillSalesOrderCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      fulfilled: true,",
        "      artifacts: {",
        "        salesOrderFulfillmentReceipt: {",
        '          receiptId: "commerce-pack-001",',
        '          salesOrderId: String(input.salesOrderId ?? "SO-001")',
        "        }",
        "      }",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    expect(buildResult.exitCode).toBe(0);

    const runtimeModule = (await import(
      `${pathToFileURL(join(outputDir, "dist/index.js")).href}?t=${Date.now()}`
    )) as {
      controlPlane: {
        startTask(key: string, input?: Record<string, unknown>): Promise<{
          id: string;
          status: string;
          artifacts: Array<{ id: string; artifactKey: string; payload: { receiptId: string } }>;
        }>;
        listTaskRuns(taskKey?: string): Array<{ id: string; taskKey: string }>;
        listArtifactRecords(artifactKey?: string): Array<{
          id: string;
          artifactKey: string;
          payload: { receiptId: string };
        }>;
      };
      renderAgentSurfaceManifest: () => string;
    };

    const taskRun = await runtimeModule.controlPlane.startTask("fulfillSalesOrderTask", {
      salesOrderId: "SO-9001"
    });
    expect(taskRun.status).toBe("completed");
    expect(taskRun.artifacts).toHaveLength(1);
    expect(taskRun.artifacts[0]?.payload.receiptId).toBe("commerce-pack-001");

    const taskRuns = runtimeModule.controlPlane.listTaskRuns("fulfillSalesOrderTask");
    expect(taskRuns).toHaveLength(1);

    const artifactRecords = runtimeModule.controlPlane.listArtifactRecords(
      "salesOrderFulfillmentReceipt"
    );
    expect(artifactRecords).toHaveLength(1);
    expect(artifactRecords[0]?.payload.receiptId).toBe("commerce-pack-001");
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"fulfillSalesOrderTask"');
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"salesOrderFulfillmentReceipt"');
  }, 20_000);

  it("runs a revenue-ops starter task and produces its digest artifact through the generated runtime", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-pack-revenue-ops-e2e-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/revenue-ops-packed-operations-app-graph.json",
      outputDir
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/reconcile-revenue-ops.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { reconcileRevenueOpsCapability } from "./generated/reconcile-revenue-ops.js";',
        "",
        "export async function reconcileRevenueOps(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: reconcileRevenueOpsCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      reconciled: true,",
        "      artifacts: {",
        "        revenueOpsDigest: {",
        '          digestId: "revenue-ops-pack-001",',
        '          tenantId: String(input.tenantId ?? "tenant-001")',
        "        }",
        "      }",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    expect(buildResult.exitCode).toBe(0);

    const runtimeModule = (await import(
      `${pathToFileURL(join(outputDir, "dist/index.js")).href}?t=${Date.now()}`
    )) as {
      controlPlane: {
        startTask(key: string, input?: Record<string, unknown>): Promise<{
          id: string;
          status: string;
          artifacts: Array<{ id: string; artifactKey: string; payload: { digestId: string } }>;
        }>;
        listTaskRuns(taskKey?: string): Array<{ id: string; taskKey: string }>;
        listArtifactRecords(artifactKey?: string): Array<{
          id: string;
          artifactKey: string;
          payload: { digestId: string };
        }>;
      };
      renderAgentSurfaceManifest: () => string;
    };

    const taskRun = await runtimeModule.controlPlane.startTask("reconcileRevenueOpsTask", {
      tenantId: "tenant-9001"
    });
    expect(taskRun.status).toBe("completed");
    expect(taskRun.artifacts).toHaveLength(1);
    expect(taskRun.artifacts[0]?.payload.digestId).toBe("revenue-ops-pack-001");

    const taskRuns = runtimeModule.controlPlane.listTaskRuns("reconcileRevenueOpsTask");
    expect(taskRuns).toHaveLength(1);

    const artifactRecords = runtimeModule.controlPlane.listArtifactRecords("revenueOpsDigest");
    expect(artifactRecords).toHaveLength(1);
    expect(artifactRecords[0]?.payload.digestId).toBe("revenue-ops-pack-001");
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"reconcileRevenueOpsTask"');
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"revenueOpsDigest"');
  }, 20_000);

  it("runs a task from an external pack registry and produces its artifact through the generated runtime", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-pack-external-e2e-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/external-packed-operations-app-graph.json",
      outputDir,
      "--pack-registry",
      "./tests/fixtures/packs/external-pack-registry.ts"
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/probe-alert-delivery.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { probeAlertDeliveryCapability } from "./generated/probe-alert-delivery.js";',
        "",
        "export async function probeAlertDelivery(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: probeAlertDeliveryCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      delivered: true,",
        "      artifacts: {",
        "        alertDeliveryReport: {",
        '          reportId: "external-pack-001",',
        '          alertRuleId: String(input.alertRuleId ?? "AR-001")',
        "        }",
        "      }",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    expect(buildResult.exitCode).toBe(0);

    const runtimeModule = (await import(
      `${pathToFileURL(join(outputDir, "dist/index.js")).href}?t=${Date.now()}`
    )) as {
      controlPlane: {
        startTask(key: string, input?: Record<string, unknown>): Promise<{
          id: string;
          status: string;
          artifacts: Array<{ id: string; artifactKey: string; payload: { reportId: string } }>;
        }>;
        listTaskRuns(taskKey?: string): Array<{ id: string; taskKey: string }>;
        listArtifactRecords(artifactKey?: string): Array<{
          id: string;
          artifactKey: string;
          payload: { reportId: string };
        }>;
      };
      renderAgentSurfaceManifest: () => string;
    };

    const taskRun = await runtimeModule.controlPlane.startTask("probeAlertDeliveryTask", {
      alertRuleId: "AR-9001"
    });
    expect(taskRun.status).toBe("completed");
    expect(taskRun.artifacts).toHaveLength(1);
    expect(taskRun.artifacts[0]?.payload.reportId).toBe("external-pack-001");

    const taskRuns = runtimeModule.controlPlane.listTaskRuns("probeAlertDeliveryTask");
    expect(taskRuns).toHaveLength(1);

    const artifactRecords = runtimeModule.controlPlane.listArtifactRecords("alertDeliveryReport");
    expect(artifactRecords).toHaveLength(1);
    expect(artifactRecords[0]?.payload.reportId).toBe("external-pack-001");
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"probeAlertDeliveryTask"');
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"alertDeliveryReport"');
  });

  it("runs a task from an inline module pack registry and produces its artifact through the generated runtime", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-pack-module-inline-e2e-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/module-packed-operations-app-graph.ts",
      outputDir
    ]);
    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/probe-signal.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { probeSignalCapability } from "./generated/probe-signal.js";',
        "",
        "export async function probeSignal(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: probeSignalCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      probed: true,",
        "      artifacts: {",
        "        signalReport: {",
        '          reportId: "module-pack-001",',
        '          signalId: String(input.signalId ?? "SIG-001")',
        "        }",
        "      }",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    expect(buildResult.exitCode).toBe(0);

    const runtimeModule = (await import(
      `${pathToFileURL(join(outputDir, "dist/index.js")).href}?t=${Date.now()}`
    )) as {
      controlPlane: {
        startTask(key: string, input?: Record<string, unknown>): Promise<{
          id: string;
          status: string;
          artifacts: Array<{ id: string; artifactKey: string; payload: { reportId: string } }>;
        }>;
        listTaskRuns(taskKey?: string): Array<{ id: string; taskKey: string }>;
        listArtifactRecords(artifactKey?: string): Array<{
          id: string;
          artifactKey: string;
          payload: { reportId: string };
        }>;
      };
      renderAgentSurfaceManifest: () => string;
    };

    const taskRun = await runtimeModule.controlPlane.startTask("probeSignalTask", {
      signalId: "SIG-9001"
    });
    expect(taskRun.status).toBe("completed");
    expect(taskRun.artifacts).toHaveLength(1);
    expect(taskRun.artifacts[0]?.payload.reportId).toBe("module-pack-001");

    const taskRuns = runtimeModule.controlPlane.listTaskRuns("probeSignalTask");
    expect(taskRuns).toHaveLength(1);

    const artifactRecords = runtimeModule.controlPlane.listArtifactRecords("signalReport");
    expect(artifactRecords).toHaveLength(1);
    expect(artifactRecords[0]?.payload.reportId).toBe("module-pack-001");
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"probeSignalTask"');
    expect(runtimeModule.renderAgentSurfaceManifest()).toContain('"signalReport"');
  });
});

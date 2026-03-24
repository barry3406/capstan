import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { repoRoot } from "../helpers/paths.ts";
import { runCapstanCli, runTypeScriptBuild, runTypeScriptCheck } from "../helpers/run-cli.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Capstan CLI packs", () => {
  it("inspects and scaffolds a graph with built-in packs", async () => {
    const inspectResult = await runCapstanCli([
      "graph:inspect",
      "./tests/fixtures/graphs/packed-operations-app-graph.json"
    ]);

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stdout).toContain('"packs": 2');
    expect(inspectResult.stdout).toContain('"workspace"');
    expect(inspectResult.stdout).toContain('"membership"');
    expect(inspectResult.stdout).toContain('"authenticated"');

    const outputDir = await mkdtemp(join(tmpdir(), "capstan-packed-"));
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
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(typecheckResult.exitCode).toBe(0);

    const appGraphJson = await readFile(join(outputDir, "capstan.app.json"), "utf8");
    const agentsGuide = await readFile(join(outputDir, "AGENTS.md"), "utf8");
    const readme = await readFile(join(outputDir, "README.md"), "utf8");
    const agentManifest = await readFile(join(outputDir, "agent-surface.json"), "utf8");

    expect(appGraphJson).toContain('"packs"');
    expect(appGraphJson).toContain('"auth"');
    expect(appGraphJson).toContain('"tenant"');
    expect(appGraphJson).toContain('"workspace"');
    expect(appGraphJson).toContain('"membership"');
    expect(appGraphJson).toContain('"listWorkspaces"');
    expect(appGraphJson).toContain('"inviteUser"');
    expect(readme).toContain("## Included Packs");
    expect(readme).toContain("`auth`");
    expect(readme).toContain("`tenant`");
    expect(agentsGuide).toContain("## App Snapshot");
    expect(agentsGuide).toContain("`auth`");
    expect(agentsGuide).toContain("`tenant`");
    expect(agentsGuide).toContain("## Official Starter Prompt");
    expect(agentManifest).toContain('"listWorkspaces"');
    expect(agentManifest).toContain('"inviteUser"');
  }, 15000);

  it("scaffolds a workflow-packed graph with durable task and artifact surfaces", async () => {
    const inspectResult = await runCapstanCli([
      "graph:inspect",
      "./tests/fixtures/graphs/workflow-packed-operations-app-graph.json"
    ]);

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stdout).toContain('"packs": 3');
    expect(inspectResult.stdout).toContain('"changeRequest"');
    expect(inspectResult.stdout).toContain('"processChangeRequestTask"');
    expect(inspectResult.stdout).toContain('"changeRequestReport"');

    const outputDir = await mkdtemp(join(tmpdir(), "capstan-workflow-packed-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/workflow-packed-operations-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(typecheckResult.exitCode).toBe(0);

    const appGraphJson = await readFile(join(outputDir, "capstan.app.json"), "utf8");
    const agentManifest = await readFile(join(outputDir, "agent-surface.json"), "utf8");
    const controlPlane = await readFile(join(outputDir, "src/control-plane/index.ts"), "utf8");
    const artifactIndex = await readFile(join(outputDir, "src/artifacts/index.ts"), "utf8");

    expect(appGraphJson).toContain('"workflow"');
    expect(appGraphJson).toContain('"changeRequest"');
    expect(appGraphJson).toContain('"processChangeRequestTask"');
    expect(appGraphJson).toContain('"changeRequestReport"');
    expect(agentManifest).toContain('"processChangeRequest"');
    expect(agentManifest).toContain('"processChangeRequestTask"');
    expect(agentManifest).toContain('"changeRequestReport"');
    expect(controlPlane).toContain("export async function startTask");
    expect(artifactIndex).toContain("changeRequestReportArtifact");
  }, 15000);

  it("scaffolds a connector-packed graph with external sync surfaces", async () => {
    const inspectResult = await runCapstanCli([
      "graph:inspect",
      "./tests/fixtures/graphs/connector-packed-operations-app-graph.json"
    ]);

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stdout).toContain('"packs": 3');
    expect(inspectResult.stdout).toContain('"dataSource"');
    expect(inspectResult.stdout).toContain('"syncDataSourceTask"');
    expect(inspectResult.stdout).toContain('"dataSourceSyncReport"');

    const outputDir = await mkdtemp(join(tmpdir(), "capstan-connector-packed-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/connector-packed-operations-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(typecheckResult.exitCode).toBe(0);

    const appGraphJson = await readFile(join(outputDir, "capstan.app.json"), "utf8");
    const agentManifest = await readFile(join(outputDir, "agent-surface.json"), "utf8");
    const artifactIndex = await readFile(join(outputDir, "src/artifacts/index.ts"), "utf8");

    expect(appGraphJson).toContain('"connector"');
    expect(appGraphJson).toContain('"dataSource"');
    expect(appGraphJson).toContain('"syncDataSourceTask"');
    expect(appGraphJson).toContain('"dataSourceSyncReport"');
    expect(agentManifest).toContain('"syncDataSource"');
    expect(agentManifest).toContain('"syncDataSourceTask"');
    expect(agentManifest).toContain('"dataSourceSyncReport"');
    expect(artifactIndex).toContain("dataSourceSyncReportArtifact");
  }, 15000);

  it("scaffolds a billing-packed graph with subscription, invoice, and receipt surfaces", async () => {
    const inspectResult = await runCapstanCli([
      "graph:inspect",
      "./tests/fixtures/graphs/billing-packed-operations-app-graph.json"
    ]);

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stdout).toContain('"packs": 3');
    expect(inspectResult.stdout).toContain('"serviceSubscription"');
    expect(inspectResult.stdout).toContain('"billingInvoice"');
    expect(inspectResult.stdout).toContain('"collectBillingInvoicePaymentTask"');
    expect(inspectResult.stdout).toContain('"billingInvoiceCollectionReceipt"');

    const outputDir = await mkdtemp(join(tmpdir(), "capstan-billing-packed-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/billing-packed-operations-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(typecheckResult.exitCode).toBe(0);

    const appGraphJson = await readFile(join(outputDir, "capstan.app.json"), "utf8");
    const agentManifest = await readFile(join(outputDir, "agent-surface.json"), "utf8");
    const artifactIndex = await readFile(join(outputDir, "src/artifacts/index.ts"), "utf8");

    expect(appGraphJson).toContain('"billing"');
    expect(appGraphJson).toContain('"serviceSubscription"');
    expect(appGraphJson).toContain('"billingInvoice"');
    expect(appGraphJson).toContain('"collectBillingInvoicePaymentTask"');
    expect(appGraphJson).toContain('"billingInvoiceCollectionReceipt"');
    expect(agentManifest).toContain('"collectBillingInvoicePayment"');
    expect(agentManifest).toContain('"collectBillingInvoicePaymentTask"');
    expect(agentManifest).toContain('"billingInvoiceCollectionReceipt"');
    expect(artifactIndex).toContain("billingInvoiceCollectionReceiptArtifact");
  }, 15000);

  it("scaffolds a commerce-packed graph with catalog, order, and fulfillment surfaces", async () => {
    const inspectResult = await runCapstanCli([
      "graph:inspect",
      "./tests/fixtures/graphs/commerce-packed-operations-app-graph.json"
    ]);

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stdout).toContain('"packs": 3');
    expect(inspectResult.stdout).toContain('"catalogItem"');
    expect(inspectResult.stdout).toContain('"salesOrder"');
    expect(inspectResult.stdout).toContain('"fulfillSalesOrderTask"');
    expect(inspectResult.stdout).toContain('"salesOrderFulfillmentReceipt"');

    const outputDir = await mkdtemp(join(tmpdir(), "capstan-commerce-packed-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/commerce-packed-operations-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(typecheckResult.exitCode).toBe(0);

    const appGraphJson = await readFile(join(outputDir, "capstan.app.json"), "utf8");
    const agentManifest = await readFile(join(outputDir, "agent-surface.json"), "utf8");
    const artifactIndex = await readFile(join(outputDir, "src/artifacts/index.ts"), "utf8");

    expect(appGraphJson).toContain('"commerce"');
    expect(appGraphJson).toContain('"catalogItem"');
    expect(appGraphJson).toContain('"salesOrder"');
    expect(appGraphJson).toContain('"fulfillSalesOrderTask"');
    expect(appGraphJson).toContain('"salesOrderFulfillmentReceipt"');
    expect(agentManifest).toContain('"fulfillSalesOrder"');
    expect(agentManifest).toContain('"fulfillSalesOrderTask"');
    expect(agentManifest).toContain('"salesOrderFulfillmentReceipt"');
    expect(artifactIndex).toContain("salesOrderFulfillmentReceiptArtifact");
  }, 15000);

  it("scaffolds a revenue-ops starter graph with reconciler surfaces and dependent domain packs", async () => {
    const inspectResult = await runCapstanCli([
      "graph:inspect",
      "./tests/fixtures/graphs/revenue-ops-packed-operations-app-graph.json"
    ]);

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stdout).toContain('"packs": 6');
    expect(inspectResult.stdout).toContain('"catalogItem"');
    expect(inspectResult.stdout).toContain('"subscription"');
    expect(inspectResult.stdout).toContain('"connector"');
    expect(inspectResult.stdout).toContain('"revenueOpsException"');
    expect(inspectResult.stdout).toContain('"reconcileRevenueOpsTask"');
    expect(inspectResult.stdout).toContain('"revenueOpsDigest"');

    const outputDir = await mkdtemp(join(tmpdir(), "capstan-revenue-ops-packed-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/revenue-ops-packed-operations-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(typecheckResult.exitCode).toBe(0);

    const appGraphJson = await readFile(join(outputDir, "capstan.app.json"), "utf8");
    const agentManifest = await readFile(join(outputDir, "agent-surface.json"), "utf8");
    const artifactIndex = await readFile(join(outputDir, "src/artifacts/index.ts"), "utf8");

    expect(appGraphJson).toContain('"revenueOps"');
    expect(appGraphJson).toContain('"catalogItem"');
    expect(appGraphJson).toContain('"subscription"');
    expect(appGraphJson).toContain('"connector"');
    expect(appGraphJson).toContain('"revenueOpsException"');
    expect(appGraphJson).toContain('"reconcileRevenueOpsTask"');
    expect(appGraphJson).toContain('"revenueOpsDigest"');
    expect(agentManifest).toContain('"reconcileRevenueOps"');
    expect(agentManifest).toContain('"reconcileRevenueOpsTask"');
    expect(agentManifest).toContain('"revenueOpsDigest"');
    expect(artifactIndex).toContain("revenueOpsDigestArtifact");
  }, 15000);

  it("scaffolds a graph from an external pack registry", async () => {
    const inspectResult = await runCapstanCli([
      "graph:inspect",
      "./tests/fixtures/graphs/external-packed-operations-app-graph.json",
      "--pack-registry",
      "./tests/fixtures/packs/external-pack-registry.ts"
    ]);

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stdout).toContain('"packs": 3');
    expect(inspectResult.stdout).toContain('"alertRule"');
    expect(inspectResult.stdout).toContain('"probeAlertDeliveryTask"');
    expect(inspectResult.stdout).toContain('"alertDeliveryReport"');

    const outputDir = await mkdtemp(join(tmpdir(), "capstan-external-packed-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/external-packed-operations-app-graph.json",
      outputDir,
      "--pack-registry",
      "./tests/fixtures/packs/external-pack-registry.ts"
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(typecheckResult.exitCode).toBe(0);

    const appGraphJson = await readFile(join(outputDir, "capstan.app.json"), "utf8");
    const agentManifest = await readFile(join(outputDir, "agent-surface.json"), "utf8");
    const artifactIndex = await readFile(join(outputDir, "src/artifacts/index.ts"), "utf8");

    expect(appGraphJson).toContain('"alerts"');
    expect(appGraphJson).toContain('"alertRule"');
    expect(appGraphJson).toContain('"probeAlertDeliveryTask"');
    expect(appGraphJson).toContain('"alertDeliveryReport"');
    expect(agentManifest).toContain('"probeAlertDelivery"');
    expect(agentManifest).toContain('"probeAlertDeliveryTask"');
    expect(agentManifest).toContain('"alertDeliveryReport"');
    expect(artifactIndex).toContain("alertDeliveryReportArtifact");
  }, 15000);

  it("scaffolds a graph module that exports its own inline pack registry", async () => {
    const inspectResult = await runCapstanCli([
      "graph:inspect",
      "./tests/fixtures/graphs/module-packed-operations-app-graph.ts"
    ]);

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stdout).toContain('"packs": 3');
    expect(inspectResult.stdout).toContain('"signal"');
    expect(inspectResult.stdout).toContain('"probeSignalTask"');
    expect(inspectResult.stdout).toContain('"signalReport"');

    const outputDir = await mkdtemp(join(tmpdir(), "capstan-module-packed-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/module-packed-operations-app-graph.ts",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(typecheckResult.exitCode).toBe(0);

    const appGraphJson = await readFile(join(outputDir, "capstan.app.json"), "utf8");
    const agentManifest = await readFile(join(outputDir, "agent-surface.json"), "utf8");
    const artifactIndex = await readFile(join(outputDir, "src/artifacts/index.ts"), "utf8");

    expect(appGraphJson).toContain('"signals"');
    expect(appGraphJson).toContain('"signal"');
    expect(appGraphJson).toContain('"probeSignalTask"');
    expect(appGraphJson).toContain('"signalReport"');
    expect(agentManifest).toContain('"probeSignal"');
    expect(agentManifest).toContain('"probeSignalTask"');
    expect(agentManifest).toContain('"signalReport"');
    expect(artifactIndex).toContain("signalReportArtifact");
  }, 15000);
});

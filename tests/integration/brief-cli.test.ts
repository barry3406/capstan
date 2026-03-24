import { access, mkdtemp, readFile, rm } from "node:fs/promises";
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

describe("Capstan brief CLI", () => {
  it("validates a JSON brief fixture", async () => {
    const result = await runCapstanCli([
      "brief:check",
      "./tests/fixtures/briefs/revenue-ops-saas-brief.json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Capstan brief is valid.");
  });

  it("validates an ESM brief fixture", async () => {
    const result = await runCapstanCli([
      "brief:check",
      "./tests/fixtures/briefs/revenue-ops-saas-brief.ts"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Capstan brief is valid.");
  });

  it("loads inline pack registries from an ESM brief module", async () => {
    const inspectResult = await runCapstanCli([
      "brief:inspect",
      "./tests/fixtures/briefs/module-packed-alerts-brief.ts"
    ]);

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stdout).toContain('"alerts"');
    expect(inspectResult.stdout).toContain('"alertRule"');
    expect(inspectResult.stdout).toContain('"probeAlertDeliveryTask"');
    expect(inspectResult.stdout).toContain('"alertDeliveryReport"');

    const outputDir = await mkdtemp(join(tmpdir(), "capstan-brief-inline-pack-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "brief:scaffold",
      "./tests/fixtures/briefs/module-packed-alerts-brief.ts",
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

    const graphJson = await readFile(join(outputDir, "capstan.app.json"), "utf8");
    const manifestJson = await readFile(join(outputDir, "agent-surface.json"), "utf8");

    expect(graphJson).toContain('"alerts"');
    expect(graphJson).toContain('"alertRule"');
    expect(graphJson).toContain('"probeAlertDeliveryTask"');
    expect(graphJson).toContain('"alertDeliveryReport"');
    expect(manifestJson).toContain('"probeAlertDelivery"');
    expect(manifestJson).toContain('"alertDeliveryReport"');
  }, 15000);

  it("compiles a brief into an expanded graph", async () => {
    const result = await runCapstanCli([
      "brief:graph",
      "./tests/fixtures/briefs/revenue-ops-saas-brief.json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"customerAccount"');
    expect(result.stdout).toContain('"revenueOpsException"');
    expect(result.stdout).toContain('"revenueOpsDigest"');
    expect(result.stdout).toContain('"primaryRenewalCampaign"');
    expect(result.stdout).toContain('"renewalCampaigns"');
    expect(result.stdout).toContain('"primaryRenewalCampaignId"');
    expect(result.stdout).toContain('"renewalCampaignIds"');
    expect(result.stdout).toContain('"taskRunId"');
    expect(result.stdout).toContain('"artifact"');
    expect(result.stdout).toContain('"tenantScoped"');
  });

  it("infers packs from application profile and modules before compiling the graph", async () => {
    const result = await runCapstanCli([
      "brief:inspect",
      "./tests/fixtures/briefs/inferred-revenue-ops-saas-brief.json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"profile": "saas"');
    expect(result.stdout).toContain('"inferred"');
    expect(result.stdout).toContain('"revenueOps"');
    expect(result.stdout).toContain('"commerce"');
    expect(result.stdout).toContain('"billing"');
    expect(result.stdout).toContain('"connector"');
    expect(result.stdout).toContain('"artifactKey": "inferredRevenueOpsDigest"');
  });

  it("accepts a zero-entity starter brief driven entirely by inferred packs", async () => {
    const checkResult = await runCapstanCli([
      "brief:check",
      "./tests/fixtures/briefs/starter-revenue-ops-saas-brief.json"
    ]);

    expect(checkResult.exitCode).toBe(0);
    expect(checkResult.stdout).toContain("Capstan brief is valid.");

    const graphResult = await runCapstanCli([
      "brief:graph",
      "./tests/fixtures/briefs/starter-revenue-ops-saas-brief.json"
    ]);

    expect(graphResult.exitCode).toBe(0);
    expect(graphResult.stdout).toContain('"auth"');
    expect(graphResult.stdout).toContain('"tenant"');
    expect(graphResult.stdout).toContain('"revenueOps"');
    expect(graphResult.stdout).toContain('"revenueOpsException"');
    expect(graphResult.stdout).toContain('"starterRevenueOpsDigest"');
  });

  it("scaffolds a brief into a compiling generated application", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-brief-scaffold-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "brief:scaffold",
      "./tests/fixtures/briefs/revenue-ops-saas-brief.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);
    expect(scaffoldResult.stdout).toContain("Scaffolded");

    await expect(access(join(outputDir, "src/resources/customer-account.ts"))).resolves.toBeUndefined();
    await expect(
      access(join(outputDir, "src/capabilities/generated/review-customer-account.ts"))
    ).resolves.toBeUndefined();
    await expect(access(join(outputDir, "src/agent-surface/index.ts"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "capstan.app.json"))).resolves.toBeUndefined();

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(typecheckResult.exitCode).toBe(0);

    const graphJson = await readFile(join(outputDir, "capstan.app.json"), "utf8");
    const manifestJson = await readFile(join(outputDir, "agent-surface.json"), "utf8");
    const humanSurfaceHtml = await readFile(join(outputDir, "human-surface.html"), "utf8");

    expect(graphJson).toContain('"customerAccount"');
    expect(graphJson).toContain('"renewalCampaign"');
    expect(graphJson).toContain('"revenueOpsException"');
    expect(graphJson).toContain('"primaryRenewalCampaignId"');
    expect(graphJson).toContain('"renewalCampaignIds"');
    expect(manifestJson).toContain('"customerAccountReview"');
    expect(manifestJson).toContain('"revenueOpsDigest"');
    expect(humanSurfaceHtml).toContain("Related Records");
    expect(humanSurfaceHtml).toContain("Primary Renewal Campaign");
    expect(humanSurfaceHtml).toContain("Customer Account Primary Renewal Campaign Detail");
    expect(humanSurfaceHtml).toContain("Open Customer Account Primary Renewal Campaign Detail");
    expect(humanSurfaceHtml).toContain("Open Customer Account Subscriptions List");
    expect(humanSurfaceHtml).toContain("Open Customer Account Orders List");
    expect(humanSurfaceHtml).toContain(
      'data-related-path="/resources/customer-account/relations/primary-renewal-campaign/detail"'
    );
    expect(humanSurfaceHtml).toContain(
      'data-related-path="/resources/customer-account/relations/subscriptions/list"'
    );
    expect(humanSurfaceHtml).toContain(
      'data-related-path="/resources/customer-account/relations/orders/list"'
    );
    expect(humanSurfaceHtml).toContain("Primary Renewal Campaign Id");
    expect(humanSurfaceHtml).toContain("Renewal Campaign Ids");
    expect(humanSurfaceHtml).toContain("Subscription Ids");
    expect(humanSurfaceHtml).toContain("Order Ids");
  }, 15000);

  it("scaffolds a starter brief into a compiling generated application", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-brief-starter-scaffold-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "brief:scaffold",
      "./tests/fixtures/briefs/starter-revenue-ops-saas-brief.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);
    expect(scaffoldResult.stdout).toContain("Scaffolded");

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(typecheckResult.exitCode).toBe(0);

    const graphJson = await readFile(join(outputDir, "capstan.app.json"), "utf8");
    const manifestJson = await readFile(join(outputDir, "agent-surface.json"), "utf8");

    expect(graphJson).toContain('"auth"');
    expect(graphJson).toContain('"tenant"');
    expect(graphJson).toContain('"revenueOps"');
    expect(graphJson).toContain('"catalogItem"');
    expect(graphJson).toContain('"subscription"');
    expect(graphJson).toContain('"revenueOpsException"');
    expect(graphJson).toContain('"starterRevenueOpsDigest"');
    expect(manifestJson).toContain('"reconcileRevenueOps"');
    expect(manifestJson).toContain('"reconcileRevenueOpsTask"');
    expect(manifestJson).toContain('"starterRevenueOpsDigest"');
  }, 15000);
});
